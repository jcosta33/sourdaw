//! Crossing the Q = 10 oversampling threshold must not change the level
//! (audit F14).
//!
//! `TptSvf` switches its integrators to twice the sample rate above Q = 10 to
//! keep high resonance stable. That switch is meant to be inaudible in the
//! passband: it is a numerical stability measure, not a gain stage. It halved
//! the input before both sub-sample ticks — the correction a *zero-stuffed*
//! upsampler needs, applied to a zero-order hold that does not need it — so
//! nudging the resonance knob from Q = 9.9 to Q = 10.1 dropped everything the
//! filter passed by 6 dB.
//!
//! Measured at a tone two decades below cutoff, where a lowpass is flat and Q
//! has no bearing on the answer, so the two sides of the threshold have to
//! agree.

use daw_dsp::crumbs::filter::{normalized_resonance_from_q, TptSvf};
use daw_dsp::crumbs::types::FilterType;

const SAMPLE_RATE: f32 = 48_000.0;
const CUTOFF_HZ: f32 = 5_000.0;
/// Two decades below cutoff: deep passband, no resonant peak nearby.
const TONE_HZ: f32 = 50.0;
const TONE_PEAK: f32 = 0.5;
/// Long enough for the filter state to settle and for whole cycles of the tone
/// to dominate the measurement.
const FRAMES: usize = 48_000;
const SETTLE_FRAMES: usize = 4_800;

/// The Q the oversampling branch switches at.
const THRESHOLD_Q: f32 = 10.0;

fn passband_rms(q: f32) -> f64 {
    let mut filter = TptSvf::new(SAMPLE_RATE);
    filter.set_params(CUTOFF_HZ, normalized_resonance_from_q(q));

    let mut sum_squares = 0.0_f64;
    let mut counted = 0_usize;
    for frame in 0..FRAMES {
        let phase = frame as f32 / SAMPLE_RATE * TONE_HZ * std::f32::consts::TAU;
        let out = filter.process_mono(phase.sin() * TONE_PEAK, FilterType::Lowpass);
        if frame >= SETTLE_FRAMES {
            sum_squares += (out as f64) * (out as f64);
            counted += 1;
        }
    }
    (sum_squares / counted as f64).sqrt()
}

fn decibels(ratio: f64) -> f64 {
    20.0 * ratio.log10()
}

#[test]
fn passband_level_is_continuous_across_the_oversampling_threshold() {
    let below = passband_rms(THRESHOLD_Q - 0.1);
    let above = passband_rms(THRESHOLD_Q + 0.1);

    // Both sides must be passing the tone, or "they match" would be satisfied
    // by two silences.
    let reference = TONE_PEAK as f64 / std::f64::consts::SQRT_2;
    assert!(
        below > reference * 0.5,
        "the non-oversampled side rendered {below:.4} rms against a {reference:.4} input; the \
         filter is not passing its passband and the comparison below is meaningless"
    );

    let jump = decibels(above / below).abs();
    assert!(
        jump < 1.0,
        "crossing Q = {THRESHOLD_Q} moved the passband by {jump:.2} dB ({below:.4} rms below the \
         threshold, {above:.4} above); the 2x path is applying a gain change the knob does not \
         ask for"
    );
}

/// The oversampled path must still be a filter: unity in the passband, and
/// stopping what is above cutoff.
#[test]
fn the_oversampled_path_still_attenuates_above_cutoff() {
    let mut filter = TptSvf::new(SAMPLE_RATE);
    filter.set_params(CUTOFF_HZ, normalized_resonance_from_q(THRESHOLD_Q + 0.1));

    let mut peak = 0.0_f32;
    for frame in 0..FRAMES {
        let phase = frame as f32 / SAMPLE_RATE * 18_000.0 * std::f32::consts::TAU;
        let out = filter.process_mono(phase.sin() * TONE_PEAK, FilterType::Lowpass);
        if frame >= SETTLE_FRAMES {
            peak = peak.max(out.abs());
        }
    }

    assert!(
        peak < TONE_PEAK * 0.2,
        "an 18 kHz tone came through a 5 kHz lowpass at peak {peak:.4}; averaging the two \
         sub-sample ticks has stopped decimating"
    );
}
