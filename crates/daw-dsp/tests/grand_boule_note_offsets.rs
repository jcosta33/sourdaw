//! Grand Boule's offset-queued note API: a pushed note sounds on its own
//! sample of the block, in the order it was pushed, and a refused push is
//! answered rather than dropped.
//!
//! The immediate API (`note_on`, `note_off`, `note_expression`) is covered by
//! the engine's own unit tests. What is only observable through `process` is
//! *where inside the block* a queued event takes effect, which is what every
//! spec here reads off the rendered samples.

use daw_dsp::grand_boule::GrandBouleInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const NOTE: u8 = 60;
const VELOCITY: f32 = 0.8;

/// Read one channel back out of the pointer `process` returned.
///
/// # Safety
/// `ptr` must point at `frames` readable `f32`s, which is what `process`
/// returns for a block of `frames` — the instance's own channel buffer.
unsafe fn read_channel(ptr: *const f32, frames: usize) -> Vec<f32> {
    assert!(!ptr.is_null(), "process returned a null buffer");
    (0..frames).map(|index| *ptr.add(index)).collect()
}

/// Render one block and return both channels, the way a host reads them.
fn render(instance: &mut GrandBouleInstance, frames: usize) -> (Vec<f32>, Vec<f32>) {
    let left_ptr = instance.process(frames as u32);
    let right_ptr = instance.get_right_ptr();
    // SAFETY: both pointers were derived after the render and name the
    // instance's own channel buffers, which are `GRAND_BOULE_BLOCK_FRAMES`
    // long and never resized; `frames` here is well inside that, and nothing
    // mutates the instance between the render and these reads.
    unsafe {
        (
            read_channel(left_ptr, frames),
            read_channel(right_ptr, frames),
        )
    }
}

fn rms(samples: &[f32]) -> f32 {
    let sum: f32 = samples.iter().map(|sample| sample * sample).sum();
    (sum / samples.len() as f32).sqrt()
}

/// A pushed note sounds from its own sample, and the frames ahead of it are
/// silent.
///
/// The discriminating half is the leading window: an instance that voiced the
/// note at the head of the block — which is what the immediate API does, and
/// what both runtimes did before this API existed — renders the strike's
/// loudest frames inside `[..ONSET)`, where this reads exact zeros.
#[test]
fn a_pushed_note_sounds_from_its_offset_and_not_before() {
    const FRAMES: usize = 300;
    const ONSET: usize = 200;

    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
    assert!(instance.push_note_on(NOTE, VELOCITY, 0, ONSET as u32));

    let (left, right) = render(&mut instance, FRAMES);

    assert!(
        left[..ONSET].iter().all(|sample| *sample == 0.0),
        "the instance sounded before the offset the note was pushed at"
    );
    assert!(
        right[..ONSET].iter().all(|sample| *sample == 0.0),
        "the right channel sounded before the offset the note was pushed at"
    );
    assert!(
        left[ONSET..].iter().any(|sample| *sample != 0.0),
        "the note never sounded at all, so the silence above proves nothing"
    );
}

/// Two events on one sample are applied in the order they were pushed.
///
/// Off-then-on leaves a struck string ringing; on-then-off strikes it and damps
/// it on the same sample. An instance that sorted its list — or applied it
/// backwards — would render the same tail for both programmes, because the two
/// differ in nothing but their order.
#[test]
fn events_on_one_sample_keep_the_order_they_were_pushed_in() {
    const FRAMES: usize = 256;
    const AT: u32 = 64;
    /// Blocks rendered after the pair, far enough past it that a damped string
    /// has died away while a held one is still ringing.
    const TAIL_BLOCKS: usize = 48;

    let tail = |off_first: bool| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
        if off_first {
            assert!(instance.push_note_off(NOTE, AT));
            assert!(instance.push_note_on(NOTE, VELOCITY, 0, AT));
        } else {
            assert!(instance.push_note_on(NOTE, VELOCITY, 0, AT));
            assert!(instance.push_note_off(NOTE, AT));
        }
        render(&mut instance, FRAMES);

        let mut left = Vec::with_capacity(FRAMES * TAIL_BLOCKS);
        for _ in 0..TAIL_BLOCKS {
            let (block_left, _) = render(&mut instance, FRAMES);
            left.extend(block_left);
        }
        left
    };

    let held_left = tail(true);
    let released_left = tail(false);

    assert!(
        rms(&held_left) > 0.0,
        "the note-on after the note-off left nothing ringing, so the comparison \
         below is between two silences"
    );
    assert!(
        rms(&released_left) < rms(&held_left),
        "a note released after it was struck rings as loudly as one struck after \
         a release ({} against {}), so the list was not applied in push order",
        rms(&released_left),
        rms(&held_left)
    );
}

/// The list refuses past its capacity instead of dropping, and `process` frees
/// it again.
///
/// The refusal is the contract the callers depend on: a host that read `false`
/// as "delivered" would silently lose the remainder of a dense block, and one
/// that could not push again after a render would lose every block after the
/// first full one.
#[test]
fn the_event_list_refuses_past_capacity_and_empties_on_process() {
    /// The list's own capacity, spelled independently of the crate's private
    /// constant: reusing it would make this agree with the instance by
    /// construction and pass at whatever size the field happened to have.
    const CAPACITY: usize = 256;

    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
    for index in 0..CAPACITY {
        assert!(
            instance.push_note_on(NOTE, VELOCITY, 0, 0),
            "the list refused event {index}, inside its capacity"
        );
    }
    assert!(
        !instance.push_note_on(NOTE, VELOCITY, 0, 0),
        "the list took an event past its capacity, so a full block overwrites or grows"
    );

    render(&mut instance, 128);

    assert!(
        instance.push_note_on(NOTE, VELOCITY, 0, 0),
        "the list stayed full after a render, so every later block would be refused"
    );
}

/// An offset at or past the block's own length sounds from the first frame of
/// the block after it, never inside this one.
///
/// `process` clamps the split point to the block length, so the event lands
/// after every frame of it. An instance that clamped to `size - 1` instead
/// would sound the note on this block's last sample, which the leading
/// assertion reads as silence.
#[test]
fn an_offset_past_the_block_sounds_from_the_first_frame_of_the_next() {
    const FRAMES: usize = 128;

    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 8);
    assert!(instance.push_note_on(NOTE, VELOCITY, 0, FRAMES as u32));

    let (this_block_left, this_block_right) = render(&mut instance, FRAMES);
    assert!(
        this_block_left.iter().all(|sample| *sample == 0.0)
            && this_block_right.iter().all(|sample| *sample == 0.0),
        "an offset past the block sounded inside it"
    );

    let (next_block_left, _) = render(&mut instance, FRAMES);
    assert!(
        next_block_left[0] != 0.0,
        "the note did not sound from the first frame of the next block"
    );
}
