//! Crust's channel-link controls pick their moment from the direction of the
//! linked target, not from each channel's own required gain.
//!
//! The limiter blends each channel between its own required gain and the
//! linked (deeper of the two) requirement, and two controls scale that blend:
//! `link_transient` while the linked target is pulling the channel down — the
//! catch — and `link_release` while it sits above the channel's current gain —
//! recovery. The branch used to be chosen from the channel's *own* required
//! gain instead, which is the wrong signal on a one-sided peak: the channel
//! that owns the burst already equals the linked target, so link_transient
//! multiplied zero, and the untouched channel (required gain 1.0, never below
//! its current gain) always took link_release. A left-only burst therefore
//! ducked the right channel through channelLinkRelease at the catch and
//! channelLinkTransient did nothing at all — the opposite of what the engine
//! comment beside the branch promised.
//!
//! Every guard here drives a real [`TruePeakLimiter`] and reads the applied
//! per-channel gain, recovered exactly by dividing each output sample by the
//! known delayed input the limiter multiplied it by. Rendered-output or
//! metered claims would blur the two channels together; the defect is precisely
//! about which channel took which control.
//!
//! The stimulus throughout is the issue's: 48 kHz, a −1 dBTP ceiling, 2 ms
//! look-ahead, and a 12-sample burst at 3.0 over a 0.1 sine bed, burst in the
//! left channel only. A fast fixed release (20 ms, auto off) keeps the
//! recovery observable inside a short render; nothing else about the envelope
//! is negotiated.

use daw_dsp::crust::limiter::TruePeakLimiter;

const SAMPLE_RATE: f32 = 48_000.0;
const CEILING_DB: f32 = -1.0;
const LOOKAHEAD_MS: f32 = 2.0;
const BED_AMPLITUDE: f32 = 0.1;
const BURST_LEVEL: f32 = 3.0;
const BURST_AT: usize = 3_000;
const BURST_LEN: usize = 12;
const RENDER_LEN: usize = 12_000;

/// Samples discarded from the tail when asserting recovery is complete — far
/// longer than the 20 ms release needs from the depth this stimulus reaches.
const RECOVERY_TAIL: usize = 2_000;

/// Minimum magnitude of the known delayed input for the division that
/// recovers the applied gain to be read; below it the entry stays unmeasured.
const DIVISOR_FLOOR: f32 = 0.02;

struct GainTrajectory {
    left: Vec<f32>,
    right: Vec<f32>,
}

fn bed(n: usize) -> f32 {
    BED_AMPLITUDE * (2.0 * std::f32::consts::PI * 220.0 * n as f32 / SAMPLE_RATE).sin()
}

/// The programme the detector is fed, sample by sample. The burst rides the
/// left channel only; the right carries the bed alone.
fn input(n: usize, side: Side) -> f32 {
    let burst = if side == Side::Left && (BURST_AT..BURST_AT + BURST_LEN).contains(&n) {
        BURST_LEVEL
    } else {
        0.0
    };
    bed(n) + burst
}

#[derive(Clone, Copy, PartialEq)]
enum Side {
    Left,
    Right,
}

/// Render the stimulus and recover the applied per-channel gain at every
/// sample where the known delayed input is loud enough to divide by.
///
/// The limiter multiplies the sample leaving its delay line by the gain it
/// just advanced, so `output[n] / input[n - latency]` *is* the applied gain —
/// no meter, no approximation. Unmeasurable samples (silence before the delay
/// line fills, zero crossings) are `NaN` and every aggregation below skips
/// them.
fn render_link(link_transient: f32, link_release: f32) -> GainTrajectory {
    let mut limiter = TruePeakLimiter::new(SAMPLE_RATE);
    limiter.set_true_peak(true);
    limiter.set_ceiling_db(CEILING_DB);
    limiter.set_lookahead_ms(LOOKAHEAD_MS);
    limiter.set_attack_ms(0.0);
    limiter.set_release_auto(false);
    limiter.set_release_ms(20.0);
    limiter.set_link(link_transient, link_release);
    let latency = limiter.latency_samples();

    let mut trajectory = GainTrajectory {
        left: vec![f32::NAN; RENDER_LEN],
        right: vec![f32::NAN; RENDER_LEN],
    };
    for n in 0..RENDER_LEN {
        let (out_left, out_right) =
            limiter.process_sample(input(n, Side::Left), input(n, Side::Right));
        if n < latency {
            continue;
        }
        let detected_left = input(n - latency, Side::Left);
        let detected_right = input(n - latency, Side::Right);
        if detected_left.abs() > DIVISOR_FLOOR {
            trajectory.left[n] = out_left / detected_left;
        }
        if detected_right.abs() > DIVISOR_FLOOR {
            trajectory.right[n] = out_right / detected_right;
        }
    }
    trajectory
}

/// Deepest gain reduction the channel applied, 1.0 for none.
fn deepest(trajectory: &[f32]) -> f32 {
    // `f32::min` returns the non-NaN operand, so unmeasured entries drop out.
    trajectory.iter().copied().fold(1.0, f32::min)
}

/// Deepest gain still applied over the render's tail: well under 1.0 there
/// means the channel never came back.
fn unrecovered_depth(trajectory: &[f32]) -> f32 {
    deepest(&trajectory[RENDER_LEN - RECOVERY_TAIL..])
}

#[test]
fn at_transient_link_zero_a_one_sided_transient_leaves_the_quiet_channel_un_ducked() {
    // The control's whole claim, at the setting that used to be a lie: with
    // the transient link off, the untouched side of a one-sided burst must not
    // move, whatever the release link does. Before the direction fix the right
    // channel followed the burst down through link_release (−21.5 dB at
    // release 100) and channelLinkTransient could not stop it.
    for release in [0.0, 1.0] {
        let rendered = render_link(0.0, release);
        let right_depth = deepest(&rendered.right);
        assert!(
            right_depth > 0.99,
            "at transient link 0 and release link {release} the untouched channel still \
             ducked to a gain of {right_depth:.3} — the catch is being governed by the \
             wrong control"
        );
        // The burst side really limits, so the guard above proves something.
        let left_depth = deepest(&rendered.left);
        assert!(
            left_depth < 0.5,
            "the burst side only reached a gain of {left_depth:.3} — the stimulus is not \
             driving the limiter and this guard cannot see the link at all"
        );
    }
}

#[test]
fn at_full_transient_link_the_quiet_channel_ducks_with_the_catch() {
    // The other end of the same control: full transient link ducks both
    // channels by the linked (deeper) requirement, so the untouched side
    // mirrors the burst side's depth.
    let rendered = render_link(1.0, 1.0);
    let left_depth = deepest(&rendered.left);
    let right_depth = deepest(&rendered.right);
    assert!(
        right_depth < 0.5,
        "at full transient link the untouched channel only reached a gain of \
         {right_depth:.3} — it is not following the catch"
    );
    assert!(
        (right_depth - left_depth).abs() < 0.02,
        "full transient link ducked the burst side to {left_depth:.3} but the untouched \
         side only to {right_depth:.3} — the channels are not sharing one linked target"
    );
}

#[test]
fn the_release_link_neither_catches_nor_holds_the_quiet_side_of_a_one_sided_transient() {
    // channelLinkRelease governs how channels recover together; it must not
    // decide how far the untouched side ducks at the catch. With the transient
    // link at full, both release settings catch the quiet side fully and both
    // let it return to unity once the burst has left the look-ahead window.
    let held = render_link(1.0, 1.0);
    let released = render_link(1.0, 0.0);

    let held_depth = deepest(&held.right);
    let released_depth = deepest(&released.right);
    assert!(
        released_depth < 0.5,
        "at release link 0 the untouched channel stayed at a gain of {released_depth:.3} \
         — the catch fell to the release link instead of the transient link"
    );
    assert!(
        (released_depth - held_depth).abs() < 0.02,
        "the release link decided the catch: release 100 ducked the untouched side to \
         {held_depth:.3} but release 0 to {released_depth:.3}"
    );

    for (label, rendered) in [("release 100", &held), ("release 0", &released)] {
        for (side, trajectory) in [("burst", &rendered.left), ("untouched", &rendered.right)] {
            let tail = unrecovered_depth(trajectory);
            assert!(
                tail > 0.99,
                "{side} channel at {label} was still held at a gain of {tail:.3} at the \
                 end of the render — nothing over the ceiling remains, so the recovery \
                 never completed"
            );
        }
    }
}

#[test]
fn at_full_link_both_channels_catch_and_recover_on_one_trajectory() {
    // "The channels recover together": at full link on both controls the two
    // channels are driven by the same linked target from the same state, so
    // their applied gains have to agree sample for sample — one catch, one
    // recovery, no image wander.
    let rendered = render_link(1.0, 1.0);
    for n in 0..RENDER_LEN {
        let (left, right) = (rendered.left[n], rendered.right[n]);
        if left.is_nan() || right.is_nan() {
            continue;
        }
        assert!(
            (left - right).abs() < 1e-6,
            "at full link the channels diverged at sample {n}: burst side {left:.6}, \
             untouched side {right:.6}"
        );
    }
}
