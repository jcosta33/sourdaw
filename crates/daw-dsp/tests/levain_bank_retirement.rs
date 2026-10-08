//! A Levain bank commit hands the displaced bank to a retired slot instead of
//! dropping it, and `release_retired_bank` frees it later in bounded steps.
//!
//! `device_process_rt.rs` proves the commit trips no allocation guard. This
//! file proves the other half of the claim, that the frees did not vanish:
//! a counting allocator sees none during the commit and sees them during the
//! release, one bounded step at a time.
//!
//! The counters are per thread, so tests running in parallel do not see each
//! other's allocations.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use daw_dsp::levain::LevainInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const SAMPLE_FRAMES: u32 = 480;
const BANK_SAMPLES: u32 = 24;
const STEP_ENTRIES: u32 = 4;
/// Allocations beside the PCM entries that one release step may free: the
/// pool's `Arc` (first step) or, in the last step, the bank's zone-map
/// vectors, transition store, instrument id and the pool's entry vector,
/// with one to spare. Moves only if those structures gain or lose a heap part.
const STEP_STORAGE_FREES: usize = 8;

struct CountingAllocator;

thread_local! {
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
    static DEALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.with(|count| count.set(count.get() + 1));
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        DEALLOCATIONS.with(|count| count.set(count.get() + 1));
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

struct Counted<T> {
    value: T,
    allocations: usize,
    deallocations: usize,
}

fn counted<T>(run: impl FnOnce() -> T) -> Counted<T> {
    ALLOCATIONS.with(|count| count.set(0));
    DEALLOCATIONS.with(|count| count.set(0));
    let value = run();
    Counted {
        value,
        allocations: ALLOCATIONS.with(Cell::get),
        deallocations: DEALLOCATIONS.with(Cell::get),
    }
}

fn pcm() -> Vec<f32> {
    (0..SAMPLE_FRAMES)
        .map(|i| (i as f32 / SAMPLE_RATE * 220.0 * std::f32::consts::TAU).sin() * 0.5)
        .collect()
}

/// Stage a complete bank of `BANK_SAMPLES` samples, one zone and one legato
/// transition per sample, ready to commit.
fn stage_bank(instance: &mut LevainInstance, instrument_id: &str) {
    instance.begin_sample_bank(instrument_id);
    for index in 0..BANK_SAMPLES {
        let sample_id = instance
            .add_sample(pcm(), SAMPLE_FRAMES, 1, SAMPLE_RATE)
            .expect("test sample should fit the bank");
        instance.add_zone(
            index,
            sample_id,
            0,
            60,
            0.0,
            0,
            127,
            0,
            127,
            0,
            1,
            0,
            false,
            1,
            0,
            SAMPLE_FRAMES,
            0,
            0.0,
            0.005,
            0.1,
            1.0,
            0.3,
        );
        instance.add_legato_transition((index % 12) as i8, 0, 3, sample_id, 20.0);
    }
    assert!(instance.build_zone_map(1, 1));
}

fn committed_instance() -> LevainInstance {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    stage_bank(&mut instance, "violin-1");
    assert!(instance.commit_sample_bank());
    instance
}

#[test]
fn a_commit_frees_nothing_and_the_release_steps_free_the_bank_in_bounded_pieces() {
    let mut instance = committed_instance();
    stage_bank(&mut instance, "cello");

    let commit = counted(|| instance.commit_sample_bank());
    assert!(commit.value, "the staged bank should commit");
    assert_eq!(
        (commit.allocations, commit.deallocations),
        (0, 0),
        "a commit must neither allocate nor free"
    );
    assert!(instance.has_retired_bank());

    let mut steps = 0;
    let mut total_frees = 0;
    loop {
        let step = counted(|| instance.release_retired_bank(STEP_ENTRIES));
        steps += 1;
        total_frees += step.deallocations;
        assert_eq!(step.allocations, 0, "releasing must not allocate");
        // Every step is held to the budget, the last one included: the step
        // that empties the slot also drops the bank's non-PCM storage, which
        // `STEP_STORAGE_FREES` allows for, and nothing more.
        assert!(
            step.deallocations <= STEP_ENTRIES as usize + STEP_STORAGE_FREES,
            "step {steps} freed {} allocations, past its {STEP_ENTRIES}-entry budget",
            step.deallocations
        );
        if step.value {
            break;
        }
    }

    assert!(
        steps > 1,
        "the retired bank should take several bounded steps to free, took {steps}"
    );
    assert!(
        total_frees >= BANK_SAMPLES as usize,
        "the release freed only {total_frees} allocations, so the retired PCM was not freed"
    );
    assert!(!instance.has_retired_bank());
    assert!(
        instance.release_retired_bank(STEP_ENTRIES),
        "an empty slot is already released"
    );
}

#[test]
fn releasing_a_pool_a_sibling_shares_only_drops_a_reference() {
    let mut owner = LevainInstance::new(SAMPLE_RATE, 8);
    stage_bank(&mut owner, "violin-1");
    assert!(owner.publish_sample_bank("levain-retirement-shared-bank"));
    assert!(owner.commit_sample_bank());
    let shared_bytes = owner.sample_bank_bytes();
    assert!(shared_bytes > 0.0);

    let mut follower = LevainInstance::new(SAMPLE_RATE, 8);
    follower.begin_sample_bank("violin-1");
    assert!(follower.attach_sample_bank("levain-retirement-shared-bank"));
    assert!(follower.build_zone_map(0, 0));
    assert!(follower.commit_sample_bank());

    stage_bank(&mut follower, "cello");
    assert!(follower.commit_sample_bank());
    assert!(follower.has_retired_bank());

    let release = counted(|| follower.release_retired_bank(STEP_ENTRIES));
    assert!(
        release.value,
        "a shared pool is released by one decrement, in one step"
    );
    assert!(
        release.deallocations < BANK_SAMPLES as usize,
        "the release freed {} allocations, which means it freed the sibling's PCM",
        release.deallocations
    );
    assert_eq!(
        owner.sample_bank_bytes(),
        shared_bytes,
        "the owner's PCM must outlive the follower's release"
    );
}

#[test]
fn beginning_a_bank_after_a_full_paced_release_frees_nothing() {
    let mut instance = committed_instance();
    stage_bank(&mut instance, "cello");
    assert!(instance.commit_sample_bank());
    while !instance.release_retired_bank(STEP_ENTRIES) {}
    assert!(!instance.has_retired_bank());

    let begin = counted(|| instance.begin_sample_bank("viola"));

    assert_eq!(
        begin.deallocations, 0,
        "begin_sample_bank freed {} allocations after the retired bank was fully released",
        begin.deallocations
    );
}

#[test]
fn beginning_the_next_bank_frees_a_retired_bank_nobody_released() {
    let mut instance = committed_instance();
    stage_bank(&mut instance, "cello");
    assert!(instance.commit_sample_bank());
    assert!(instance.has_retired_bank());

    instance.begin_sample_bank("viola");

    assert!(
        !instance.has_retired_bank(),
        "begin_sample_bank must leave the retired slot empty so the next commit can use it"
    );
}
