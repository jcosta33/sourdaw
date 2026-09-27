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
/// −40 dBFS, 20 dB under the descriptor's default −20 dB threshold.
const QUIET: f32 = 0.01;

fn below_threshold_gain(threshold_db: f32, ratio: f32) -> f32 {
    let mut compressor = Compressor::new();
    let mut left = [QUIET; FRAMES].to_vec();
    let mut right = [QUIET; FRAMES].to_vec();
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
    left[FRAMES - 1] / QUIET
}

#[test]
fn unity_ratio_is_transparent_control() {
    let gain = below_threshold_gain(-20.0, 1.0);
    assert!((gain - 1.0).abs() < 1e-6, "ratio 1:1 gain {gain}");
}

#[test]
fn auto_makeup_never_cuts_a_signal_below_threshold() {
    for (threshold_db, ratio) in [(-20.0_f32, 4.0_f32), (-60.0, 20.0)] {
        let gain = below_threshold_gain(threshold_db, ratio);
        let gain_db = 20.0 * gain.log10();
        assert!(
            gain >= 1.0 - 1e-6,
            "threshold {threshold_db} dB, ratio {ratio}:1: a −40 dBFS signal that never crosses the \
             threshold left the compressor at {gain_db:.2} dB (gain {gain})"
        );
    }
}
