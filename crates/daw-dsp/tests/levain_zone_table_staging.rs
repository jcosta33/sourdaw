//! A Levain bank's zone tables are computed off the render thread and staged
//! into the engine in bounded chunks.
//!
//! The worklet used to call `build_zone_map`, which allocated the LUT, a `Vec`
//! per LUT slot, the arena and the round-robin counters and walked every zone
//! inside one port message. Now `LevainZoneTableBuilder` computes the tables
//! wherever the host runs it, `reserve_zone_tables` reserves their storage (the
//! staging's only allocation), each chunk commit appends at most
//! `LEVAIN_ZONE_TABLE_CHUNK_ENTRIES` entries after checking them, and
//! `seal_zone_tables` installs them in O(1).
//!
//! The counters are per thread, so tests running in parallel do not see each
//! other's allocations.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use daw_dsp::levain::types::{
    AdsrParams, KeyRange, LoopMode, SampleRef, VelRange, Zone, MAX_ARTICULATIONS,
};
use daw_dsp::levain::zone::{ZoneMap, ZoneSpan, ZoneTableStaging};
use daw_dsp::levain::{LevainInstance, LevainZoneTableBuilder, LEVAIN_ZONE_TABLE_CHUNK_ENTRIES};

const SAMPLE_RATE: f32 = 48_000.0;
const CHUNK: usize = LEVAIN_ZONE_TABLE_CHUNK_ENTRIES;
const STEP_ENTRIES: u32 = 4;

struct CountingAllocator;

thread_local! {
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
    static DEALLOCATIONS: Cell<usize> = const { Cell::new(0) };
    static DEALLOCATED_BYTES: Cell<usize> = const { Cell::new(0) };
}

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.with(|count| count.set(count.get() + 1));
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        DEALLOCATIONS.with(|count| count.set(count.get() + 1));
        DEALLOCATED_BYTES.with(|bytes| bytes.set(bytes.get() + layout.size()));
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

struct Counted<T> {
    value: T,
    allocations: usize,
    deallocations: usize,
    deallocated_bytes: usize,
}

fn counted<T>(run: impl FnOnce() -> T) -> Counted<T> {
    ALLOCATIONS.with(|count| count.set(0));
    DEALLOCATIONS.with(|count| count.set(0));
    DEALLOCATED_BYTES.with(|bytes| bytes.set(0));
    let value = run();
    Counted {
        value,
        allocations: ALLOCATIONS.with(Cell::get),
        deallocations: DEALLOCATIONS.with(Cell::get),
        deallocated_bytes: DEALLOCATED_BYTES.with(Cell::get),
    }
}

/// One zone's place in the map: (articulation, mic, lo key, hi key, lo vel, hi vel).
type Placement = (u16, u8, u8, u8, u8, u8);

/// A deterministic zone set with everything the tables must get right:
/// overlapping key ranges, velocity ranges whose top runs past the last
/// bucket, several articulations and mics, slots no zone covers, and zones
/// outside the declared dimensions, which the tables skip.
fn generated_placements(seed: u32, count: usize, articulations: u16, mics: u8) -> Vec<Placement> {
    let mut state = seed.wrapping_mul(2_654_435_761).wrapping_add(1);
    let mut next = |modulus: u32| {
        state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        (state >> 8) % modulus
    };
    (0..count)
        .map(|_| {
            // One in eight lands past the declared dimensions.
            let articulation = next(u32::from(articulations) + 1) as u16;
            let mic = next(u32::from(mics) + 1) as u8;
            // Keys stay in 24..=100, so the edges of the keyboard stay empty.
            let lo_key = 24 + next(70) as u8;
            let hi_key = lo_key + next(7) as u8;
            let lo_vel = next(128) as u8;
            let hi_vel = (u32::from(lo_vel) + next(64)).min(127) as u8;
            (articulation, mic, lo_key, hi_key, lo_vel, hi_vel)
        })
        .collect()
}

fn zone(id: u32, placement: Placement) -> Zone {
    let (articulation, mic, lo_key, hi_key, lo_vel, hi_vel) = placement;
    Zone {
        id,
        key: KeyRange {
            lo: lo_key,
            hi: hi_key,
        },
        vel: VelRange {
            lo: lo_vel,
            hi: hi_vel,
        },
        articulation,
        rr_pos: 0,
        rr_len: 1,
        mic,
        is_release: false,
        sample: SampleRef {
            sample_id: 0,
            root_key: 60,
            tune_cents: 0,
            start: 0,
            end: 0,
            loop_mode: LoopMode::Forward,
            loop_start: 0,
            loop_end: 256,
            loop_crossfade: 0,
        },
        amp_env: AdsrParams::default(),
        gain_db: 0.0,
    }
}

fn add_instance_zone(instance: &mut LevainInstance, id: u32, placement: Placement) {
    let (articulation, mic, lo_key, hi_key, lo_vel, hi_vel) = placement;
    instance.add_zone(
        id,
        0,
        articulation,
        60,
        0.0,
        lo_key,
        hi_key,
        lo_vel,
        hi_vel,
        0,
        1,
        mic,
        false,
        1,
        0,
        256,
        0,
        0.0,
        0.005,
        0.1,
        1.0,
        0.3,
    );
}

/// The builder's tables for `placements`, as (interleaved LUT words, arena).
fn built_tables(placements: &[Placement], articulations: u32, mics: u32) -> (Vec<u32>, Vec<u32>) {
    let mut builder = LevainZoneTableBuilder::new();
    for (id, &(articulation, mic, lo_key, hi_key, lo_vel, hi_vel)) in placements.iter().enumerate()
    {
        builder.add_zone(id as u32, articulation, mic, lo_key, hi_key, lo_vel, hi_vel);
    }
    assert!(builder.build(articulations, mics), "the builder builds");
    (builder.lut(), builder.arena())
}

/// What the worklet does for one chunk message: write the words where the
/// instance says.
fn write_window(instance: &mut LevainInstance, words: &[u32]) {
    assert!(
        words.len() <= instance.zone_table_write_words() as usize,
        "a {}-word chunk does not fit the window",
        words.len()
    );
    let target = instance.zone_table_write_ptr();
    // SAFETY: `target` addresses `zone_table_write_words` words of the
    // instance's window and the chunk fits it; the source is a distinct slice.
    unsafe { std::ptr::copy_nonoverlapping(words.as_ptr(), target, words.len()) };
}

fn commit_lut_chunk(instance: &mut LevainInstance, start: usize, words: &[u32]) -> bool {
    write_window(instance, words);
    instance.commit_zone_lut_chunk(start as u32, (words.len() / 2) as u32)
}

fn commit_arena_chunk(instance: &mut LevainInstance, start: usize, ids: &[u32]) -> bool {
    write_window(instance, ids);
    instance.commit_zone_arena_chunk(start as u32, ids.len() as u32)
}

/// Stage the tables the way the loader does: every LUT chunk, then every
/// arena chunk, each at most one chunk long.
fn stage_chunks(instance: &mut LevainInstance, lut: &[u32], arena: &[u32]) -> bool {
    let lut_ok = lut
        .chunks(2 * CHUNK)
        .enumerate()
        .all(|(index, words)| commit_lut_chunk(instance, index * CHUNK, words));
    let arena_ok = arena
        .chunks(CHUNK)
        .enumerate()
        .all(|(index, ids)| commit_arena_chunk(instance, index * CHUNK, ids));
    lut_ok && arena_ok
}

/// A staged bank holding `placements` as zones and one sample, ready for its
/// tables.
fn staged_instance(placements: &[Placement]) -> LevainInstance {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");
    let pcm: Vec<f32> = (0..256).map(|index| (index as f32 * 0.05).sin()).collect();
    instance
        .add_sample(pcm, 256, 1, SAMPLE_RATE)
        .expect("the staged bank takes the sample");
    for (id, &placement) in placements.iter().enumerate() {
        add_instance_zone(&mut instance, id as u32, placement);
    }
    instance
}

fn lut_entries(lut: &[u32]) -> u32 {
    (lut.len() / 2) as u32
}

#[test]
fn levain_staging_allocates_only_at_reserve_and_nothing_per_chunk_or_at_seal() {
    // Four articulations by two mics is 16,384 LUT slots: two full LUT chunks.
    let placements = generated_placements(7, 600, 4, 2);
    let (lut, arena) = built_tables(&placements, 4, 2);
    assert!(lut.len() / 2 >= 2 * CHUNK && !arena.is_empty());
    let mut instance = staged_instance(&placements);

    let reserve =
        counted(|| instance.reserve_zone_tables(4, 2, lut_entries(&lut), arena.len() as u32));
    assert!(reserve.value, "the reservation is accepted");
    assert_eq!(
        reserve.allocations, 3,
        "the reservation allocates the LUT, the arena and the round-robin counters, once each"
    );
    assert_eq!(reserve.deallocations, 0, "the reservation frees nothing");

    for (index, words) in lut.chunks(2 * CHUNK).enumerate() {
        write_window(&mut instance, words);
        let chunk = counted(|| {
            instance.commit_zone_lut_chunk((index * CHUNK) as u32, (words.len() / 2) as u32)
        });
        assert!(chunk.value, "LUT chunk {index} is accepted");
        assert_eq!(
            (chunk.allocations, chunk.deallocations),
            (0, 0),
            "LUT chunk {index} allocated or freed"
        );
    }
    for (index, ids) in arena.chunks(CHUNK).enumerate() {
        write_window(&mut instance, ids);
        let chunk =
            counted(|| instance.commit_zone_arena_chunk((index * CHUNK) as u32, ids.len() as u32));
        assert!(chunk.value, "arena chunk {index} is accepted");
        assert_eq!(
            (chunk.allocations, chunk.deallocations),
            (0, 0),
            "arena chunk {index} allocated or freed"
        );
    }

    let seal = counted(|| instance.seal_zone_tables());
    assert!(seal.value, "complete tables seal");
    assert_eq!(
        (seal.allocations, seal.deallocations),
        (0, 0),
        "the seal installs the staged tables without building, allocating or freeing"
    );

    let commit = counted(|| instance.commit_sample_bank());
    assert!(commit.value, "the sealed bank commits");
    assert_eq!((commit.allocations, commit.deallocations), (0, 0));
}

#[test]
fn levain_staged_tables_equal_what_build_lut_stores_entry_for_entry() {
    let shapes: [(u32, usize, u16, u8); 4] = [
        (1, 40, 1, 1),
        (2, 300, 3, 2),
        (3, 900, 6, 4),
        (4, 2_000, MAX_ARTICULATIONS as u16, 1),
    ];
    for (seed, count, articulations, mics) in shapes {
        let placements = generated_placements(seed, count, articulations, mics);

        let mut built = ZoneMap::new();
        for (id, &placement) in placements.iter().enumerate() {
            built.add_zone(zone(id as u32, placement));
        }
        built
            .build_lut(usize::from(articulations), usize::from(mics))
            .expect("the generated set builds");
        let (built_lut, built_arena) = built.tables();

        let (lut_words, arena) =
            built_tables(&placements, u32::from(articulations), u32::from(mics));
        let builder_lut: Vec<(u32, u32)> = lut_words
            .chunks_exact(2)
            .map(|pair| (pair[0], pair[1]))
            .collect();
        let stored_lut: Vec<(u32, u32)> = built_lut
            .iter()
            .map(|entry| (entry.offset, u32::from(entry.count)))
            .collect();
        assert_eq!(builder_lut, stored_lut, "seed {seed}: builder LUT");
        assert_eq!(arena, built_arena, "seed {seed}: builder arena");

        let mut staging = ZoneTableStaging::reserve(
            usize::from(articulations),
            usize::from(mics),
            lut_words.len() / 2,
            arena.len(),
        )
        .expect("the reservation is accepted");
        for (index, words) in lut_words.chunks(2 * CHUNK).enumerate() {
            assert!(staging.write_lut_chunk(index * CHUNK, words));
        }
        for (index, ids) in arena.chunks(CHUNK).enumerate() {
            assert!(staging.write_arena_chunk(index * CHUNK, ids, placements.len()));
        }
        let mut staged = ZoneMap::new();
        for (id, &placement) in placements.iter().enumerate() {
            staged.add_zone(zone(id as u32, placement));
        }
        assert!(staging.install_into(&mut staged));
        assert_eq!(
            staged.tables(),
            built.tables(),
            "seed {seed}: staged tables"
        );

        for articulation in 0..=articulations {
            for mic in 0..=mics {
                for note in 0..=127_u8 {
                    for velocity in 0..=127_u8 {
                        assert_eq!(
                            staged.lookup(articulation, mic, note, velocity),
                            built.lookup(articulation, mic, note, velocity),
                            "seed {seed}: lookup ({articulation}, {mic}, {note}, {velocity})"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn levain_the_builder_covers_what_build_lut_covers_and_refuses_what_it_refuses() {
    let spans = [ZoneSpan {
        id: 0,
        articulation: 0,
        mic: 0,
        key: KeyRange { lo: 60, hi: 60 },
        vel: VelRange { lo: 0, hi: 127 },
    }];
    let tables = daw_dsp::levain::zone::build_zone_tables(spans, 1, 1).expect("builds");
    // One note across all sixteen velocity buckets.
    assert_eq!(tables.arena, vec![0; 16]);

    let mut builder = LevainZoneTableBuilder::new();
    builder.add_zone(0, 0, 0, 60, 60, 0, 127);
    assert!(!builder.build(MAX_ARTICULATIONS as u32 + 1, 1));
    assert!(builder.lut().is_empty() && builder.arena().is_empty());
}

#[test]
fn levain_the_staging_refuses_a_chunk_longer_than_one_chunk_whatever_window_the_host_has() {
    let words = vec![0_u32; 2 * (CHUNK + 1)];
    let mut staging =
        ZoneTableStaging::reserve(MAX_ARTICULATIONS, 1, MAX_ARTICULATIONS * 2_048, CHUNK + 1)
            .expect("the reservation is accepted");
    assert!(!staging.write_lut_chunk(0, &words));
    assert!(staging.write_lut_chunk(0, &words[..2 * CHUNK]));
    assert!(!staging.write_arena_chunk(0, &words[..CHUNK + 1], 1));
    assert!(staging.write_arena_chunk(0, &words[..CHUNK], 1));
}

/// Tables for one zone covering one note in all sixteen velocity buckets of
/// one articulation and mic: a 2,048-slot LUT and a 16-entry arena.
fn single_zone_bank() -> (LevainInstance, Vec<u32>, Vec<u32>) {
    let placements = [(0, 0, 60, 60, 0, 127)];
    let (lut, arena) = built_tables(&placements, 1, 1);
    (staged_instance(&placements), lut, arena)
}

#[test]
fn levain_a_reservation_refuses_dimensions_past_the_limits_and_a_lut_size_they_do_not_imply() {
    let (mut instance, lut, arena) = single_zone_bank();
    let arena_entries = arena.len() as u32;

    assert!(!instance.reserve_zone_tables(MAX_ARTICULATIONS as u32 + 1, 1, 0, arena_entries));
    assert!(!instance.reserve_zone_tables(1, 9, 9 * 128 * 16, arena_entries));
    assert!(!instance.reserve_zone_tables(1, 1, lut_entries(&lut) - 1, arena_entries));
    assert!(!instance.reserve_zone_tables(1, 1, lut_entries(&lut) + 1, arena_entries));
    assert!(!instance.reserve_zone_tables(1, 1, lut_entries(&lut), 65_537));

    assert!(instance.reserve_zone_tables(1, 1, lut_entries(&lut), arena_entries));
    assert!(
        !instance.reserve_zone_tables(1, 1, lut_entries(&lut), arena_entries),
        "a second reservation is refused while one is open"
    );
}

#[test]
fn levain_a_reservation_needs_a_staged_bank_with_no_sample_open() {
    let mut idle = LevainInstance::new(SAMPLE_RATE, 8);
    assert!(!idle.reserve_zone_tables(1, 1, 2_048, 0));

    let mut uploading = LevainInstance::new(SAMPLE_RATE, 8);
    uploading.begin_sample_bank("violin-1");
    uploading
        .begin_sample(64, 1, SAMPLE_RATE)
        .expect("the staged bank takes the sample");
    assert!(!uploading.reserve_zone_tables(1, 1, 2_048, 0));
}

#[test]
fn levain_a_lut_chunk_whose_run_reaches_past_the_declared_arena_is_refused_and_appends_nothing() {
    let (mut instance, lut, arena) = single_zone_bank();
    assert!(instance.reserve_zone_tables(1, 1, lut_entries(&lut), arena.len() as u32));

    let mut reaching = lut.clone();
    // The first slot's run ends one entry past the arena.
    reaching[0] = arena.len() as u32;
    reaching[1] = 1;
    assert!(!commit_lut_chunk(&mut instance, 0, &reaching));
    reaching[0] = 0;
    reaching[1] = u32::from(u16::MAX) + 1;
    assert!(!commit_lut_chunk(&mut instance, 0, &reaching));

    assert!(
        stage_chunks(&mut instance, &lut, &arena),
        "the refused chunk appended nothing, so the true tables still stage from slot zero"
    );
    assert!(instance.seal_zone_tables());
}

#[test]
fn levain_an_arena_id_the_bank_holds_no_zone_for_is_refused_and_appends_nothing() {
    let (mut instance, lut, arena) = single_zone_bank();
    assert!(instance.reserve_zone_tables(1, 1, lut_entries(&lut), arena.len() as u32));
    for (index, words) in lut.chunks(2 * CHUNK).enumerate() {
        assert!(commit_lut_chunk(&mut instance, index * CHUNK, words));
    }

    let mut foreign = arena.clone();
    // The bank holds one zone, id 0.
    foreign[3] = 1;
    assert!(!commit_arena_chunk(&mut instance, 0, &foreign));
    assert!(commit_arena_chunk(&mut instance, 0, &arena));
    assert!(instance.seal_zone_tables());
}

#[test]
fn levain_chunks_out_of_order_past_the_end_or_longer_than_one_chunk_are_refused() {
    // Four articulations by two mics: two full LUT chunks.
    let placements = generated_placements(11, 400, 4, 2);
    let (lut, arena) = built_tables(&placements, 4, 2);
    let mut instance = staged_instance(&placements);
    assert!(instance.reserve_zone_tables(4, 2, lut_entries(&lut), arena.len() as u32));
    let first = &lut[..2 * CHUNK];
    let second = &lut[2 * CHUNK..];

    assert!(
        !commit_lut_chunk(&mut instance, CHUNK, second),
        "a chunk ahead of the next slot"
    );
    assert!(commit_lut_chunk(&mut instance, 0, first));
    assert!(
        !commit_lut_chunk(&mut instance, 0, first),
        "a chunk repeating written slots"
    );
    assert!(
        !commit_lut_chunk(&mut instance, CHUNK + 1, second),
        "a chunk one slot late"
    );
    assert!(
        !instance.commit_zone_lut_chunk(CHUNK as u32, (CHUNK + 1) as u32),
        "a chunk longer than the window"
    );
    assert!(
        !instance.commit_zone_lut_chunk(CHUNK as u32, 0),
        "an empty chunk"
    );
    assert!(commit_lut_chunk(&mut instance, CHUNK, second));
    assert!(
        !commit_lut_chunk(&mut instance, lut.len() / 2, &first[..2]),
        "a chunk past the declared LUT"
    );

    let arena_tail = arena.len().min(CHUNK);
    assert!(
        !commit_arena_chunk(&mut instance, 1, &arena[1..arena_tail]),
        "an arena chunk ahead"
    );
    assert!(stage_arena(&mut instance, &arena));
    assert!(
        !commit_arena_chunk(&mut instance, arena.len(), &arena[..1]),
        "an arena chunk past the declared arena"
    );
    assert!(instance.seal_zone_tables());
}

fn stage_arena(instance: &mut LevainInstance, arena: &[u32]) -> bool {
    arena
        .chunks(CHUNK)
        .enumerate()
        .all(|(index, ids)| commit_arena_chunk(instance, index * CHUNK, ids))
}

#[test]
fn levain_a_seal_before_every_entry_is_written_installs_nothing_and_the_bank_cannot_commit() {
    let (mut instance, lut, arena) = single_zone_bank();
    assert!(!instance.seal_zone_tables(), "nothing reserved");
    assert!(instance.reserve_zone_tables(1, 1, lut_entries(&lut), arena.len() as u32));
    for (index, words) in lut.chunks(2 * CHUNK).enumerate() {
        assert!(commit_lut_chunk(&mut instance, index * CHUNK, words));
    }
    assert!(commit_arena_chunk(
        &mut instance,
        0,
        &arena[..arena.len() - 1]
    ));

    assert!(!instance.seal_zone_tables(), "one arena entry is missing");
    assert!(
        !instance.commit_sample_bank(),
        "an unsealed bank is not built, so it never commits"
    );

    assert!(commit_arena_chunk(
        &mut instance,
        arena.len() - 1,
        &arena[arena.len() - 1..]
    ));
    assert!(instance.seal_zone_tables());
    assert!(!instance.seal_zone_tables(), "a second seal is refused");
    assert!(
        !commit_arena_chunk(&mut instance, 0, &arena[..1]),
        "installed tables take no further chunk"
    );
    assert!(instance.commit_sample_bank());
}

#[test]
fn levain_an_abort_mid_staging_frees_nothing_and_the_reservation_retires_with_the_bank() {
    let placements = generated_placements(5, 600, 4, 2);
    let (lut, arena) = built_tables(&placements, 4, 2);
    let mut instance = staged_instance(&placements);
    assert!(instance.reserve_zone_tables(4, 2, lut_entries(&lut), arena.len() as u32));
    assert!(commit_lut_chunk(&mut instance, 0, &lut[..2 * CHUNK]));

    let abort = counted(|| instance.abort_sample_bank());
    assert!(abort.value, "the staged bank retires");
    assert_eq!(
        (abort.allocations, abort.deallocations),
        (0, 0),
        "the abort moves the reservation into the retired slot instead of freeing it"
    );
    assert!(instance.has_retired_bank());

    let lut_bytes = lut.len() / 2 * 8;
    let release = counted(|| {
        let mut steps = 0;
        while !instance.release_retired_bank(STEP_ENTRIES) {
            steps += 1;
            assert!(steps < 1_000, "the release never finishes");
        }
    });
    assert!(
        release.deallocated_bytes >= lut_bytes,
        "the paced release frees the reserved LUT ({lut_bytes} bytes), freed {}",
        release.deallocated_bytes
    );
    assert!(!instance.has_retired_bank());
}
