//! A Levain sample uploads in bounded chunks into storage reserved once.
//!
//! The worklet used to hand `add_sample` a whole decoded sample, so one port
//! message allocated and copied the whole of it on the render thread. Now
//! `begin_sample` reserves the storage, each chunk message copies at most
//! `LEVAIN_SAMPLE_CHUNK_FLOATS` floats into it and allocates nothing, and
//! `seal_sample` publishes the sample.
//!
//! The counters are per thread, so tests running in parallel do not see each
//! other's allocations.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use daw_dsp::levain::{LevainInstance, LEVAIN_SAMPLE_CHUNK_FLOATS};

const SAMPLE_RATE: f32 = 48_000.0;
const CHUNK: usize = LEVAIN_SAMPLE_CHUNK_FLOATS;
/// Three whole chunks and a short one, so the last chunk is partial.
const TOTAL_FLOATS: usize = 3 * CHUNK + 777;
const BLOCK: u32 = 4096;
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

/// Distinct on every float, so a chunk landing one float off changes the audio.
fn pcm(floats: usize) -> Vec<f32> {
    (0..floats)
        .map(|index| (index as f32 * 0.0137).sin() * 0.6 + (index as f32 * 0.00031).cos() * 0.3)
        .collect()
}

/// What the worklet does for one chunk message: write where the engine says,
/// then count the floats.
fn write_chunk(instance: &mut LevainInstance, sample_id: u32, chunk: &[f32]) -> bool {
    let window = instance.sample_write_floats(sample_id) as usize;
    assert!(
        chunk.len() <= window,
        "a {}-float chunk does not fit the {window}-float window",
        chunk.len()
    );
    let target = instance.sample_write_ptr(sample_id);
    assert!(!target.is_null(), "the open sample has a write pointer");
    // SAFETY: `target` addresses `window` floats of reserved storage and the
    // chunk fits it; the source is a distinct slice. The floats are written
    // before the commit that counts them.
    unsafe {
        std::ptr::copy_nonoverlapping(chunk.as_ptr(), target, chunk.len());
        instance.commit_sample_frames(sample_id, chunk.len() as u32)
    }
}

/// A commit the engine must refuse, so it counts no float and the promise to
/// have written them is vacuous.
fn refused_commit(instance: &mut LevainInstance, sample_id: u32, float_count: u32) -> bool {
    // SAFETY: a refused commit reads none of the floats it was asked to count.
    unsafe { instance.commit_sample_frames(sample_id, float_count) }
}

/// Upload `data` the way the loader does: chunk after chunk, then seal.
fn upload(instance: &mut LevainInstance, data: &[f32], channels: u8) -> u32 {
    let frames = (data.len() / usize::from(channels)) as u32;
    let sample_id = instance
        .begin_sample(frames, channels, SAMPLE_RATE)
        .expect("the staged bank takes the sample");
    for chunk in data.chunks(CHUNK) {
        assert!(write_chunk(instance, sample_id, chunk));
    }
    assert!(instance.seal_sample(sample_id));
    sample_id
}

fn add_looping_zone(instance: &mut LevainInstance, sample_id: u32, frames: u32) {
    instance.add_zone(
        0, sample_id, 0, 69, 0.0, 0, 127, 0, 127, 0, 1, 0, false, 1, 0, frames, 0, 0.0, 0.005, 0.1,
        1.0, 0.3,
    );
}

/// Stage `data` into a fresh instance with `upload_with`, commit it and play a
/// held note, returning the left and right output bits of `blocks` blocks.
fn render_bank(
    upload_with: impl FnOnce(&mut LevainInstance, &[f32]) -> u32,
    data: &[f32],
    blocks: usize,
) -> Vec<u32> {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");
    let sample_id = upload_with(&mut instance, data);
    add_looping_zone(&mut instance, sample_id, data.len() as u32);
    assert!(instance.build_zone_map(1, 1));
    assert!(instance.commit_sample_bank());
    instance.note_on(69, 100);
    let mut bits = Vec::new();
    for _ in 0..blocks {
        let left = instance.process(BLOCK);
        let right = instance.get_right_ptr();
        // SAFETY: `process` filled `BLOCK` frames behind both pointers, which
        // stay valid until the next call.
        let (left, right) = unsafe {
            (
                std::slice::from_raw_parts(left, BLOCK as usize),
                std::slice::from_raw_parts(right, BLOCK as usize),
            )
        };
        bits.extend(left.iter().chain(right).map(|value| value.to_bits()));
    }
    bits
}

#[test]
fn a_chunk_allocates_nothing_and_the_reservation_is_the_one_allocation() {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");
    // The first sample also grows the pool's entry table; measure the second,
    // whose table slot is already there.
    upload(&mut instance, &pcm(CHUNK), 1);
    let data = pcm(TOTAL_FLOATS);

    let begin = counted(|| instance.begin_sample(TOTAL_FLOATS as u32, 1, SAMPLE_RATE));
    let sample_id = begin.value.expect("the second sample begins");
    assert_eq!(
        (begin.allocations, begin.deallocations),
        (1, 0),
        "beginning a sample reserves its storage once and frees nothing"
    );

    let mut chunks = 0;
    for chunk in data.chunks(CHUNK) {
        let write = counted(|| write_chunk(&mut instance, sample_id, chunk));
        assert!(write.value);
        assert_eq!(
            (write.allocations, write.deallocations),
            (0, 0),
            "chunk {chunks} must neither allocate nor free"
        );
        chunks += 1;
    }
    assert_eq!(
        chunks, 4,
        "the sample spans three whole chunks and a partial one"
    );

    let seal = counted(|| instance.seal_sample(sample_id));
    assert!(seal.value);
    assert_eq!(
        (seal.allocations, seal.deallocations),
        (0, 0),
        "sealing must neither allocate nor free"
    );
}

#[test]
fn a_chunked_sample_renders_bit_identical_to_the_same_sample_added_whole() {
    let data = pcm(TOTAL_FLOATS);
    let blocks = 14;

    let whole = render_bank(
        |instance, data| {
            instance
                .add_sample(data.to_vec(), data.len() as u32, 1, SAMPLE_RATE)
                .expect("the staged bank takes the sample")
        },
        &data,
        blocks,
    );
    let chunked = render_bank(|instance, data| upload(instance, data, 1), &data, blocks);

    assert!(
        whole.iter().any(|bits| f32::from_bits(*bits).abs() > 1e-4),
        "the reference render is silent, so the comparison proves nothing"
    );
    assert_eq!(chunked, whole);
}

#[test]
fn a_stereo_chunked_sample_renders_bit_identical_to_the_same_sample_added_whole() {
    let data = pcm(2 * TOTAL_FLOATS);
    let blocks = 14;

    let whole = render_bank(
        |instance, data| {
            instance
                .add_sample(data.to_vec(), (data.len() / 2) as u32, 2, SAMPLE_RATE)
                .expect("the staged bank takes the sample")
        },
        &data,
        blocks,
    );
    let chunked = render_bank(|instance, data| upload(instance, data, 2), &data, blocks);

    assert_eq!(chunked, whole);
}

#[test]
fn sealing_a_short_sample_is_refused_and_leaves_it_open() {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");
    let data = pcm(CHUNK + 10);
    let sample_id = instance
        .begin_sample(data.len() as u32, 1, SAMPLE_RATE)
        .expect("the staged bank takes the sample");
    assert!(write_chunk(&mut instance, sample_id, &data[..CHUNK]));

    assert!(!instance.seal_sample(sample_id), "ten floats are missing");
    assert_eq!(instance.sample_write_floats(sample_id), 10);

    assert!(write_chunk(&mut instance, sample_id, &data[CHUNK..]));
    assert!(instance.seal_sample(sample_id));
}

#[test]
fn a_window_never_exceeds_one_chunk_nor_what_the_sample_still_needs() {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");
    let sample_id = instance
        .begin_sample(TOTAL_FLOATS as u32, 1, SAMPLE_RATE)
        .expect("the staged bank takes the sample");
    assert_eq!(instance.sample_write_floats(sample_id) as usize, CHUNK);

    for chunk in pcm(TOTAL_FLOATS).chunks(CHUNK).take(3) {
        assert!(write_chunk(&mut instance, sample_id, chunk));
    }
    assert_eq!(instance.sample_write_floats(sample_id), 777);
}

#[test]
fn a_chunk_for_another_sample_or_past_the_window_is_refused() {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");
    let sample_id = instance
        .begin_sample(TOTAL_FLOATS as u32, 1, SAMPLE_RATE)
        .expect("the staged bank takes the sample");

    assert!(
        instance.sample_write_ptr(sample_id + 1).is_null(),
        "another sample id has no write pointer"
    );
    assert_eq!(instance.sample_write_floats(sample_id + 1), 0);
    assert!(
        !refused_commit(&mut instance, sample_id + 1, 16),
        "a chunk for another sample id is refused"
    );
    assert!(
        !refused_commit(&mut instance, sample_id, CHUNK as u32 + 1),
        "a chunk larger than the chunk ceiling is refused though the sample has room"
    );

    for chunk in pcm(TOTAL_FLOATS).chunks(CHUNK).take(3) {
        assert!(write_chunk(&mut instance, sample_id, chunk));
    }
    assert!(
        !refused_commit(&mut instance, sample_id, 778),
        "a chunk past the sample's capacity is refused"
    );
    let tail = pcm(TOTAL_FLOATS);
    assert!(
        write_chunk(&mut instance, sample_id, &tail[3 * CHUNK..]),
        "the exact remainder is still accepted after the refusals changed nothing"
    );
    assert!(instance.seal_sample(sample_id));
}

#[test]
fn a_second_sample_cannot_begin_while_one_is_open_and_none_begins_without_a_bank() {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    assert_eq!(
        instance.begin_sample(64, 1, SAMPLE_RATE),
        None,
        "no bank is staged"
    );

    instance.begin_sample_bank("violin-1");
    let first = upload(&mut instance, &pcm(64), 1);
    add_looping_zone(&mut instance, first, 64);
    assert!(instance.build_zone_map(1, 1));

    let second = instance
        .begin_sample(64, 1, SAMPLE_RATE)
        .expect("the staged bank takes the sample");
    assert_eq!(second, first + 1);
    assert_eq!(instance.begin_sample(64, 1, SAMPLE_RATE), None);
    assert!(
        !instance.commit_sample_bank(),
        "a bank with an unsealed sample must not commit"
    );

    assert!(write_chunk(&mut instance, second, &pcm(64)));
    assert!(instance.seal_sample(second));
    assert!(
        instance.commit_sample_bank(),
        "the bank commits once every sample is sealed"
    );
}

#[test]
fn an_abort_mid_sample_frees_nothing_and_the_release_steps_free_the_open_sample() {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");
    upload(&mut instance, &pcm(CHUNK), 1);
    let data = pcm(TOTAL_FLOATS);
    let sample_id = instance
        .begin_sample(TOTAL_FLOATS as u32, 1, SAMPLE_RATE)
        .expect("the staged bank takes the sample");
    assert!(write_chunk(&mut instance, sample_id, &data[..CHUNK]));

    let abort = counted(|| instance.abort_sample_bank());

    assert!(abort.value, "the staged bank should have been retired");
    assert_eq!(
        (abort.allocations, abort.deallocations),
        (0, 0),
        "an abort must neither allocate nor free, the open sample included"
    );
    assert!(instance.has_retired_bank());

    let mut freed_bytes = 0;
    loop {
        let step = counted(|| instance.release_retired_bank(STEP_ENTRIES));
        assert_eq!(step.allocations, 0, "releasing must not allocate");
        freed_bytes += step.deallocated_bytes;
        if step.value {
            break;
        }
    }
    assert!(
        freed_bytes >= TOTAL_FLOATS * std::mem::size_of::<f32>(),
        "the release freed {freed_bytes} bytes, so the open sample's storage was not freed by it"
    );
    assert!(!instance.has_retired_bank());
}
