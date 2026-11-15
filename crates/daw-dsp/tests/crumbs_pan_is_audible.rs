//! `CrumbsParam::Pan` must reach the voice pan target.
//!
//! The Pan arm of `set_param` was an explicit no-op: the descriptor declared
//! the parameter, the panel and automation lanes wrote it, and the value
//! landed nowhere. This guard renders one note with the pan fully right and
//! asserts the channels actually split — with the no-op arm restored, both
//! channels carry the mono source equally and the ratio collapses to 1.

#![allow(clippy::unwrap_used, reason = "tests assert by unwrapping")]

use daw_dsp::crumbs::CrumbsInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

/// A mono fixture loud enough to measure but not so loud the output limiter
/// (absent here, but cheap to avoid) or clamping ever matters.
fn fixture_pcm(frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|i| {
            let t = i as f32;
            0.5 * (t * 0.11).sin() + 0.2 * (t * 0.037).cos()
        })
        .collect()
}

/// # Safety
///
/// `ptr` must point to at least `frames` initialised, aligned `f32` values that
/// stay valid and unmodified for the duration of the call.
unsafe fn read_channel(ptr: *const f32, frames: usize) -> Vec<f32> {
    // SAFETY: the function's `# Safety` contract guarantees `ptr` is non-null, aligned and
    // valid for `frames` initialised `f32` reads, and the slice is copied out before returning.
    unsafe { std::slice::from_raw_parts(ptr, frames) }.to_vec()
}

fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()))
}

fn panned_note(pan: f32) -> (f32, f32) {
    // Long enough that the note is still sustaining well past the pan
    // smoother's 10 ms time constant (40 blocks ≈ 107 ms of material), so the
    // measured block sits several time constants in.
    let pcm = fixture_pcm(40 * BLOCK);
    let mut instance = CrumbsInstance::new(SAMPLE_RATE);
    let sample_id = instance.add_sample(pcm.to_vec(), 1, SAMPLE_RATE as u32);
    instance.set_active_sample(sample_id);
    instance.set_param("attack", 0.0);
    instance.set_param("pan", pan);

    instance.note_on(60, 100);
    // The voice's pan rides a 10 ms one-pole smoother; ~30 blocks (80 ms,
    // eight time constants) leaves a residual far below the assertion's
    // tolerance.
    for _ in 0..30 {
        let _ = instance.process(BLOCK as u32);
    }
    let left_ptr = instance.process(BLOCK as u32);
    // SAFETY: `left_ptr` is the start of `CrumbsInstance`'s output buffer, which `new` allocates
    // at `2 * MAX_BLOCK_SIZE` (4096 per channel) floats; `process` just zeroed and filled the
    // first `BLOCK = 128` of the left channel, and nothing mutates the instance during the copy.
    let left = unsafe { read_channel(left_ptr, BLOCK) };
    // SAFETY: `get_right_ptr` is that buffer offset by `MAX_BLOCK_SIZE`, so the right channel
    // holds 4096 floats; the same `process` call filled its first `BLOCK = 128`, and nothing
    // mutates the instance during the copy.
    let right = unsafe { read_channel(instance.get_right_ptr(), BLOCK) };
    (peak(&left), peak(&right))
}

#[test]
fn a_fully_right_pan_shifts_the_note_into_the_right_channel() {
    let (left, right) = panned_note(1.0);

    assert!(
        right > 0.05,
        "the panned note rendered ~silence (right peak {right}); the fixture is broken"
    );
    // Constant-power pan at +1 leaves the left channel at 0 gain; allow the
    // smoothing ramp's first samples, not a working copy of the signal.
    assert!(
        left < right * 0.05,
        "pan fully right left left peak at {left} against right {right}; the pan parameter is \
         not reaching the voice"
    );
}

#[test]
fn a_centred_pan_keeps_the_note_symmetrical() {
    // The other direction: the wiring must not bias the default. Centre is
    // the shipped default, so this pins the identity the panel opens with.
    let (left, right) = panned_note(0.0);

    assert!(
        (left - right).abs() < 0.02,
        "centred pan split the channels ({left} vs {right}); the base pan is not neutral at 0"
    );
}
