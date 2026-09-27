//! Fermenter's global compressor documents "auto-makeup gain" that
//! "compensates for gain reduction". Makeup is a boost, never a cut: a signal
//! that never reaches the threshold is not compressed, so it must leave the
//! compressor at unity or louder, never quieter.
//!
//! `Compressor::process_block` (`fermenter/effects.rs`) computes
//! `makeup = (1/ratio - 1) * threshold / 20` and applies `10^(-makeup/20)`.
//! For any negative threshold and ratio > 1 that is below 1, so engaging the
//! compressor turns the whole synth down, including material it never touches.

use daw_dsp::fermenter::effects::Compressor;

const SAMPLE_RATE: f32 = 48_000.0;
const FRAMES: usize = 4_800;

/// Cases whose input sits 20 dB below their threshold, so the compressor
/// never crosses the threshold and the makeup path is the only gain applied:
/// (threshold dB, ratio, constant input level).
const BELOW_THRESHOLD_CASES: [(f32, f32, f32); 2] = [
    // −40 dBFS, 20 dB under the descriptor's default −20 dB threshold.
    (-20.0, 4.0, 0.01),
    // −80 dBFS, 20 dB under the −60 dB floor of the threshold range.
    (-60.0, 20.0, 0.0001),
];

/// The gain applied to a constant input at `frame`, one block after `new()`.
fn below_threshold_gain_at(threshold_db: f32, ratio: f32, input: f32, frame: usize) -> f32 {
    let mut compressor = Compressor::new();
    let mut left = [input; FRAMES].to_vec();
    let mut right = [input; FRAMES].to_vec();
    // Descriptor defaults: attack 10 ms, release 100 ms; mix fully wet.
    compressor.process_block(
        &mut left,
        &mut right,
        threshold_db,
        ratio,
        10.0,
        100.0,
        1.0,
        SAMPLE_RATE,
    );
    left[frame] / input
}

#[test]
fn unity_ratio_is_transparent_control() {
    let gain = below_threshold_gain_at(-20.0, 1.0, 0.01, FRAMES - 1);
    assert!((gain - 1.0).abs() < 1e-6, "ratio 1:1 gain {gain}");
}

#[test]
fn auto_makeup_never_cuts_a_signal_below_threshold() {
    for (threshold_db, ratio, input) in BELOW_THRESHOLD_CASES {
        let gain = below_threshold_gain_at(threshold_db, ratio, input, FRAMES - 1);
        let gain_db = 20.0 * gain.log10();
        let input_db = 20.0 * input.log10();
        assert!(
            gain >= 1.0 - 1e-6,
            "threshold {threshold_db} dB, ratio {ratio}:1: a {input_db:.0} dBFS signal that \
             never crosses the threshold left the compressor at {gain_db:.2} dB (gain {gain})"
        );
    }
}

/// The settled read alone cannot see a smoothed transient: a makeup gain that
/// ramps in across the attack window ends at the same settled value and keeps
/// the settled read green while cutting the first milliseconds of every hit.
///
/// Invariant covering the transient: the makeup path must not cut at ANY
/// sample. Below the threshold the gain is the full `makeup_lin` ≥ 1 from the
/// first sample on — untouched material leaves at unity or louder, transient
/// included — so a sample inside the attack/release settle window must sit at
/// or above unity, and at the settled makeup gain rather than a ramp-in.
#[test]
fn auto_makeup_does_not_cut_inside_the_attack_release_settle_window() {
    for (threshold_db, ratio, input) in BELOW_THRESHOLD_CASES {
        let settled = below_threshold_gain_at(threshold_db, ratio, input, FRAMES - 1);
        // Sample 0 and 1 ms in — both inside the 10 ms attack settle window.
        for frame in [0, 48] {
            let gain = below_threshold_gain_at(threshold_db, ratio, input, frame);
            let gain_db = 20.0 * gain.log10();
            assert!(
                gain >= 1.0 - 1e-6,
                "threshold {threshold_db} dB, ratio {ratio}:1: sample {frame} inside the \
                 settle window left the compressor at {gain_db:.2} dB (gain {gain})"
            );
            assert!(
                (gain - settled).abs() < 1e-6 * settled,
                "threshold {threshold_db} dB, ratio {ratio}:1: sample {frame} must carry the \
                 full settled makeup gain, not a ramp-in: {gain} vs {settled}"
            );
        }
    }
}
