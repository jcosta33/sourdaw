//! Fermenter's stereo delay recomputed its delay length from `time_ms` on
//! every block with no memory of the previous length, so a time change
//! between blocks moved the read tap to the new position in one step — a
//! full-swing discontinuity in the wet signal, heard as a click (issue
//! #4648).
//!
//! The fix glides the read tap (tape-style pitch bend): the effective length
//! is slewed toward the target at most 0.5 samples of delay per sample of
//! audio, so the tap's content rate never leaves [0.5, 1.5] samples per
//! output sample and the wet signal never steps. These specs pin both halves
//! of the contract: no step at the change, and the tap genuinely arriving at
//! the new length.

use daw_dsp::fermenter::effects::StereoDelay;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
/// 200 ms and 800 ms at the test rate: the lengths on either side of the
/// scripted change.
const OLD_DELAY_SAMPLES: f32 = 9_600.0;
const NEW_DELAY_SAMPLES: f32 = 38_400.0;
/// Peak spacing that counts as a distinct echo; the linear interpolator
/// smears a one-sample pulse over at most a few samples while the tap sweeps.
const PEAK_MERGE_SAMPLES: usize = 32;

fn sine(n: usize) -> f32 {
    0.5 * (core::f32::consts::TAU * 137.0 * n as f32 / SAMPLE_RATE).sin()
}

/// Charge a delay at 200 ms with a sine and feedback, fully wet so the
/// output is the wet path alone. Returns the last output sample and the
/// steady-state sample-to-sample slope of the wet output.
fn fill_at_200ms(delay: &mut StereoDelay, blocks: usize) -> (f32, f32) {
    let mut last_left = 0.0f32;
    let mut steady_slope = 0.0f32;
    for block in 0..blocks {
        let mut left: Vec<f32> = (0..BLOCK).map(|i| sine(block * BLOCK + i)).collect();
        let mut right = left.clone();
        delay.process_block(&mut left, &mut right, 200.0, 0.5, 1.0);
        let slope = left
            .windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .fold(0.0f32, f32::max);
        last_left = left[BLOCK - 1];
        // The slope window must cover at least the span of history a glide
        // can replay, so the bound below cannot be beaten by content the
        // window never saw.
        if block + SLOPE_WINDOW_BLOCKS >= blocks {
            steady_slope = steady_slope.max(slope);
        }
    }
    (last_left, steady_slope)
}

const SLOPE_WINDOW_BLOCKS: usize = 250;

/// Run `blocks` silent input blocks at `time_ms`, optionally writing a
/// one-sample impulse into the left input at `impulse_at` within this call,
/// and return both wet outputs.
fn render_silent_post_change(
    delay: &mut StereoDelay,
    blocks: usize,
    time_ms: f32,
    feedback: f32,
    impulse_at: Option<usize>,
) -> (Vec<f32>, Vec<f32>) {
    let mut wet_l = Vec::with_capacity(blocks * BLOCK);
    let mut wet_r = Vec::with_capacity(blocks * BLOCK);
    for _ in 0..blocks {
        let mut left = vec![0.0; BLOCK];
        let mut right = vec![0.0; BLOCK];
        if let Some(i) = impulse_at {
            left[i] = 0.9;
        }
        delay.process_block(&mut left, &mut right, time_ms, feedback, 1.0);
        wet_l.extend_from_slice(&left);
        wet_r.extend_from_slice(&right);
    }
    (wet_l, wet_r)
}

/// Local maxima above the bed floor, merged within `PEAK_MERGE_SAMPLES`.
fn echo_peaks(wet: &[f32], floor: f32) -> Vec<usize> {
    let mut peaks: Vec<usize> = Vec::new();
    let mut group_max: Option<usize> = None;
    for (i, &s) in wet.iter().enumerate() {
        if s.abs() <= floor {
            continue;
        }
        match group_max {
            Some(current) if i - current <= PEAK_MERGE_SAMPLES => {
                if s.abs() > wet[current].abs() {
                    group_max = Some(i);
                }
            }
            _ => {
                if let Some(current) = group_max.take() {
                    peaks.push(current);
                }
                group_max = Some(i);
            }
        }
    }
    if let Some(current) = group_max {
        peaks.push(current);
    }
    peaks
}

/// (a) A time change must not step the wet signal. During the glide the tap
/// reads content at most 1.5 samples per output sample (1 realtime + 0.5
/// slew), so the steepest wet sample-to-sample change is 1.5x the measured
/// steady-state slope, with headroom for the interpolator and f32. The
/// pre-fix code jumped the tap 28 800 samples at the boundary — most of the
/// signal's full swing in one sample.
#[test]
fn time_change_does_not_step_the_wet_output_at_the_block_boundary() {
    let mut delay = StereoDelay::new(SAMPLE_RATE);
    let fill_blocks = 400; // 51 200 samples: buffer charged, echoes established
    let (last_left, steady_slope) = fill_at_200ms(&mut delay, fill_blocks);

    // The change: 200 ms -> 800 ms between blocks; the sine keeps playing.
    let mut post: Vec<f32> = Vec::with_capacity(200 * BLOCK);
    let mut left: Vec<f32> = (0..BLOCK).map(|i| sine(fill_blocks * BLOCK + i)).collect();
    let mut right = left.clone();
    delay.process_block(&mut left, &mut right, 800.0, 0.5, 1.0);
    post.extend_from_slice(&left);
    for block in 1..200 {
        let mut left: Vec<f32> = (0..BLOCK)
            .map(|i| sine((fill_blocks + block) * BLOCK + i))
            .collect();
        let mut right = left.clone();
        delay.process_block(&mut left, &mut right, 800.0, 0.5, 1.0);
        post.extend_from_slice(&left);
    }

    let boundary_step = (post[0] - last_left).abs();
    let glide_slope = post
        .windows(2)
        .map(|w| (w[1] - w[0]).abs())
        .fold(0.0f32, f32::max);

    // 1.5 = the slew law's content-rate ceiling; 1.25 = headroom for the
    // linear interpolator's fractional weighting and f32 rounding.
    let bound = steady_slope * 1.5 * 1.25;
    assert!(
        boundary_step <= bound,
        "the block boundary stepped by {boundary_step} (bound {bound} = 1.875 x steady slope {steady_slope})"
    );
    assert!(
        glide_slope <= bound,
        "the wet slewed by {glide_slope} inside the glide (bound {bound})"
    );
}

/// (b) The tap must eventually sit at the new length. A pulse written as the
/// last sample before the change is kept circulating by feedback, and the
/// echo train it leaves behind settles at the new spacing.
///
/// The bend itself is visible in where the pulse is *picked up*: gliding
/// from the old to the new length, the tap sweeps back through the buffered
/// audio at half speed and replays the pulse after `2 x (old - 1)` output
/// samples, while an instant jump defers it to a full new length. The charge
/// train parks long before the change so the swept region stays quiet except
/// for known pulses.
#[test]
fn a_pulse_written_before_the_change_circulates_at_the_new_length() {
    let mut delay = StereoDelay::new(SAMPLE_RATE);
    let fill_blocks = 500; // 64 000 samples

    for block in 0..fill_blocks - 1 {
        let mut left = vec![0.0; BLOCK];
        let mut right = vec![0.0; BLOCK];
        for i in 0..BLOCK {
            let n = block * BLOCK + i;
            // Park the train so that even its third-generation ping-pong
            // echo (last pulse + 38 400) stays below the swept region,
            // which begins 9 600 samples before the change.
            if n % 2_400 == 0 && n <= 14_400 {
                left[i] = 0.4;
                right[i] = 0.4;
            }
        }
        delay.process_block(&mut left, &mut right, 200.0, 0.5, 1.0);
    }
    // The contracted pulse: the final sample written before the change.
    let mut left = vec![0.0; BLOCK];
    let mut right = vec![0.0; BLOCK];
    left[BLOCK - 1] = 0.9;
    delay.process_block(&mut left, &mut right, 200.0, 0.5, 1.0);

    // Long enough for the glide to settle (2 x 28 800 samples) and for the
    // circulating pulse to re-emerge several times at the settled spacing.
    // Ping-pong moves the pulse between channels every circulation, so both
    // channels carry every second generation.
    let (wet_l, wet_r) = render_silent_post_change(&mut delay, 1_700, 800.0, 0.5, None);

    let mut peaks = echo_peaks(&wet_l, 0.02);
    peaks.extend(echo_peaks(&wet_r, 0.02));
    peaks.sort_unstable();
    assert!(
        peaks.len() >= 5,
        "expected at least 5 circulating echoes, found {}",
        peaks.len()
    );
    let sweep_pickup = 2.0 * (OLD_DELAY_SAMPLES - 1.0);
    let first = peaks[0] as f32;
    assert!(
        (first - sweep_pickup).abs() <= 96.0,
        "the pre-change pulse was picked up at {first}, expected ~{sweep_pickup} \
         (a jump defers it to {NEW_DELAY_SAMPLES})"
    );
    let last_spacing = (peaks[peaks.len() - 1] - peaks[peaks.len() - 2]) as f32;
    assert!(
        (last_spacing - NEW_DELAY_SAMPLES).abs() <= 64.0,
        "the eventual echo spacing is {last_spacing}, expected ~{NEW_DELAY_SAMPLES}"
    );
}

/// (b, direct) After the glide has settled, a fresh impulse emerges exactly
/// one new length after it is written, and nothing emerges at the old
/// length. Pins the eventual tap position without echo-train bookkeeping.
#[test]
fn a_fresh_impulse_after_the_change_emerges_at_the_new_length() {
    let mut delay = StereoDelay::new(SAMPLE_RATE);
    fill_at_200ms(&mut delay, 400);

    // The glide spans 2 x (38 400 - 9 600) = 57 600 samples = 450 blocks;
    // the impulse is the last sample of the block that follows.
    let settle_blocks = 450;
    let (mut wet, _) = render_silent_post_change(&mut delay, settle_blocks, 800.0, 0.0, None);
    let bed = &wet[wet.len() - 100..];
    assert!(
        bed.iter().all(|s| s.abs() < 1.0e-6),
        "the wet bed did not settle to silence before the impulse"
    );
    let (impulse_l, _) = render_silent_post_change(&mut delay, 1, 800.0, 0.0, Some(BLOCK - 1));
    wet.extend(impulse_l);
    let (tail, _) = render_silent_post_change(&mut delay, 320, 800.0, 0.0, None);
    wet.extend(tail);
    let impulse_at = settle_blocks * BLOCK + BLOCK - 1;

    let window = |centre: usize| &wet[centre - 64..centre + 64];
    let at_new_length = window(impulse_at + NEW_DELAY_SAMPLES as usize)
        .iter()
        .fold(0.0f32, |m, s| m.max(s.abs()));
    let at_old_length = window(impulse_at + OLD_DELAY_SAMPLES as usize)
        .iter()
        .fold(0.0f32, |m, s| m.max(s.abs()));
    assert!(
        at_new_length > 0.5,
        "the impulse never emerged {NEW_DELAY_SAMPLES} samples later (peak {at_new_length})"
    );
    assert!(
        at_old_length < 0.01,
        "energy emerged at the old {OLD_DELAY_SAMPLES}-sample length (peak {at_old_length})"
    );
}
