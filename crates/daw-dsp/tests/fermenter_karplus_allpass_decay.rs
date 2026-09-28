//! ADR 0023: the Karplus-Strong loop reads its delay line through a
//! first-order allpass, not linear interpolation, with the fractional delay
//! held inside [0.1, 1.1].
//!
//! Physical expectation. The loop gain is deliberately near unity, so the
//! string's decay should be set by the feedback lowpass alone. Linear
//! interpolation is not a pure delay: its magnitude response
//! `|(1-f) + f·z^-1| = sqrt((1-f)² + f² + 2f(1-f)·cos ω)` drops below 1 at
//! every frequency above DC, so each pass around the loop damps the
//! fundamental by exactly that factor. At a pitch whose loop-delay fraction
//! sits near 0.5 the per-pass loss is `cos(ω/2)`, which decays the
//! oscillation far faster than the loop gain alone predicts. The first-order
//! allpass `y[n] = C·x[n] + x[n-1] − C·y[n-1]` with `C = (1-Δ)/(1+Δ)`
//! (Jaffe & Smith 1983, Eq. 12 and 17) has unity magnitude at every
//! frequency for any real C — its numerator and denominator are complex
//! conjugates — so it retunes the loop without touching its decay. That is
//! the ADR's "existing patches ring longer" consequence, and this spec pins
//! it as an observable.
//!
//! Both reads (and the feedback lowpass) pass DC at unity gain, so the
//! excitation's DC offset never decays in either build. Every measurement
//! below first-differences the render, which removes that inaudible residue
//! while leaving the oscillation's decay rate untouched.

use daw_dsp::fermenter::physical::KarplusStrong;

const SAMPLE_RATE: f32 = 48_000.0;
/// Loop delay 24.5 samples → fraction 0.5, where linear interpolation's
/// damping for an in-tune pitch is largest.
const HALF_FRACTION_DELAY: f32 = 24.5;
/// Loop delay 24.05 samples → fraction 0.05, below the [0.1, 1.1] window,
/// so the read must move one sample into the integer part.
const SMALL_FRACTION_DELAY: f32 = 24.05;
const RING_SECONDS: f32 = 2.0;
/// Envelope floor for the decay measurement, on the differenced signal:
/// well under the oscillation level and well above its f32 noise.
const FLOOR: f32 = 1e-4;

/// One sustained pluck at `damping`. Damping 0 makes the feedback lowpass a
/// passthrough (`coeff = 1`), so the linear-interpolation prediction below is
/// the linear loop's entire damping, not an approximation of it. The engine's
/// xorshift excitation is seeded identically for every fresh instance, so
/// renders are deterministic without an external seed.
fn pluck(delay_samples: f32, damping: f32, seconds: f32) -> Vec<f32> {
    let freq = SAMPLE_RATE / delay_samples;
    let mut string = KarplusStrong::new(SAMPLE_RATE);
    string.set_damping(damping);
    string.excite(freq, freq, SAMPLE_RATE, 0.9);
    let frames = (seconds * SAMPLE_RATE) as usize;
    let mut out = Vec::with_capacity(frames);
    for _ in 0..frames {
        out.push(string.tick(freq, SAMPLE_RATE));
    }
    out
}

/// First difference: removes the loop's undecaying DC residue without
/// touching a mode's decay rate.
fn oscillation(samples: &[f32]) -> Vec<f32> {
    samples.windows(2).map(|pair| pair[1] - pair[0]).collect()
}

/// Time until the differenced signal's envelope falls below `FLOOR` for
/// good, in seconds.
fn decay_time(samples: &[f32]) -> f32 {
    let last_above = samples
        .iter()
        .rposition(|sample| sample.abs() > FLOOR)
        .expect("a plucked string must be audible at some point");
    (last_above + 1) as f32 / SAMPLE_RATE
}

/// The decay the linear-interpolation read must produce: its magnitude
/// response at the fundamental, applied once per loop pass, starting from
/// the differenced pluck's first-cycle peak.
fn linear_predicted_decay(delay_samples: f32, samples: &[f32]) -> f32 {
    let freq = SAMPLE_RATE / delay_samples;
    let omega = std::f32::consts::TAU * freq / SAMPLE_RATE;
    let frac = delay_samples - delay_samples.floor();
    let gain =
        ((1.0 - frac).powi(2) + frac * frac + 2.0 * frac * (1.0 - frac) * omega.cos()).sqrt();
    let initial = samples
        .iter()
        .take(delay_samples as usize + 1)
        .map(|sample| sample.abs())
        .fold(0.0f32, f32::max);
    (initial / FLOOR).ln() / (freq * -(gain.ln()))
}

#[test]
fn karplus_string_at_half_fraction_rings_longer_than_linear_interpolation_predicts() {
    let samples = oscillation(&pluck(HALF_FRACTION_DELAY, 0.0, RING_SECONDS));
    let measured = decay_time(&samples);
    let predicted = linear_predicted_decay(HALF_FRACTION_DELAY, &samples);
    assert!(
        measured > predicted * 2.0,
        "the allpass string must outlast the linear-interpolation prediction: \
         measured decay to {FLOOR} = {measured:.3} s, linear prediction = {predicted:.3} s"
    );
}

/// The decay the feedback lowpass alone must produce at a nonzero damping,
/// derived from the same loop-gain bookkeeping the module doc uses for the
/// linear case. The engine's lowpass is
///
/// ```text
/// filtered = coeff·x + (1 − coeff)·state   →   H(z) = coeff / (1 − a·z⁻¹),
/// ```
///
/// with `coeff = 1 − damping/2` and `a = 1 − coeff`. It passes DC at unity
/// (the doc's "feedback lowpass" exception above), so at the loop's
/// fundamental, ω = 2π·f/fs, one pass around the loop multiplies the
/// oscillation by exactly
///
/// ```text
/// g = coeff / sqrt(1 + a² − 2a·cos ω)
/// ```
///
/// (the allpass read is unity-magnitude at every frequency, so it contributes
/// nothing). The loop turns f = fs/delay passes per second, so the envelope
/// decays as g^(f·t) and reaches the measurement floor after
///
/// ```text
/// t = ln(A₀/FLOOR) / (f·(−ln g)),
/// ```
///
/// starting from A₀, the differenced pluck's first-cycle peak — the same
/// assumption `linear_predicted_decay` makes. A tolerance of a factor two on
/// each side absorbs what that assumption ignores (the excitation's energy in
/// faster-decaying upper modes, and the few-sample phase lag the one-pole adds
/// to the loop delay); the doubling-damping mutation of `coeff` moves the
/// prediction by more than a factor four at this damping, well outside it.
fn onepole_predicted_decay(delay_samples: f32, damping: f32, samples: &[f32]) -> f32 {
    let freq = SAMPLE_RATE / delay_samples;
    let omega = std::f32::consts::TAU * freq / SAMPLE_RATE;
    let coeff = 1.0 - damping * 0.5;
    let a = 1.0 - coeff;
    let gain = coeff / (1.0 + a * a - 2.0 * a * omega.cos()).sqrt();
    let initial = samples
        .iter()
        .take(delay_samples as usize + 1)
        .map(|sample| sample.abs())
        .fold(0.0f32, f32::max);
    (initial / FLOOR).ln() / (freq * -(gain.ln()))
}

/// The pinned damping zero only exercises the passthrough extreme, where
/// `coeff = 1 − damping/2` and `coeff = 1 − damping` agree — a wrong damping
/// scale is invisible there. At a real damping the lowpass sets the decay, and
/// the measured envelope must match the loop-gain prediction above: not decay
/// faster (over-damped — the coefficient's distance from unity halved), not
/// slower (under-damped), but the documented one-pole rate.
#[test]
fn karplus_decay_at_nonzero_damping_matches_the_one_pole_feedback_prediction() {
    let damping = 0.5;
    let samples = oscillation(&pluck(HALF_FRACTION_DELAY, damping, RING_SECONDS));
    let measured = decay_time(&samples);
    let predicted = onepole_predicted_decay(HALF_FRACTION_DELAY, damping, &samples);
    assert!(
        measured > predicted * 0.5 && measured < predicted * 2.0,
        "at damping {damping} the string must decay at the feedback lowpass's rate: \
         measured decay to {FLOOR} = {measured:.3} s, one-pole prediction = \
         {predicted:.3} s"
    );
}

/// Normalized-autocorrelation pitch estimate with parabolic sub-lag
/// refinement — the probe family `tests/fermenter_karplus_glide.rs` uses,
/// resolved below one lag because a whole-sample pitch error is exactly the
/// off-by-one this spec exists to catch.
fn sustained_pitch(samples: &[f32], expected: f32) -> f32 {
    let min_lag = (SAMPLE_RATE / (expected * 1.1)) as usize;
    let max_lag = (SAMPLE_RATE / (expected * 0.9)) as usize;
    let mut correlations = vec![0.0f32; max_lag - min_lag + 1];
    let mut best_lag = min_lag;
    let mut best_correlation = f32::NEG_INFINITY;
    for lag in min_lag..=max_lag {
        let mut product_sum = 0.0;
        let mut leading_energy = 0.0;
        let mut trailing_energy = 0.0;
        for index in 0..samples.len() - lag {
            let leading = samples[index];
            let trailing = samples[index + lag];
            product_sum += leading * trailing;
            leading_energy += leading * leading;
            trailing_energy += trailing * trailing;
        }
        let normalization = (leading_energy * trailing_energy).sqrt();
        if normalization <= f32::EPSILON {
            continue;
        }
        let correlation = product_sum / normalization;
        correlations[lag - min_lag] = correlation;
        if correlation > best_correlation {
            best_correlation = correlation;
            best_lag = lag;
        }
    }
    let refined = if best_lag > min_lag && best_lag < max_lag {
        let left = correlations[best_lag - 1 - min_lag];
        let centre = correlations[best_lag - min_lag];
        let right = correlations[best_lag + 1 - min_lag];
        let denominator = left - 2.0 * centre + right;
        let shift = if denominator.abs() > f32::EPSILON {
            0.5 * (left - right) / denominator
        } else {
            0.0
        };
        best_lag as f32 + shift.clamp(-0.5, 0.5)
    } else {
        best_lag as f32
    };
    SAMPLE_RATE / refined
}

/// The [0.1, 1.1] window moves a fraction below 0.1 into the integer part.
/// The loop delay — and therefore the pitch — must not move with it: at a
/// loop delay of 24.05 samples the rendered pitch must sit within 1.5% of
/// 48000/24.05 Hz, far tighter than the ~4% (70-cent) error a one-sample
/// shift of the loop delay would produce.
#[test]
fn karplus_pitch_holds_when_the_fraction_shifts_into_the_integer_part() {
    let samples = oscillation(&pluck(SMALL_FRACTION_DELAY, 0.0, 0.5));
    let expected = SAMPLE_RATE / SMALL_FRACTION_DELAY;
    let measured = sustained_pitch(&samples[4_096..4_096 + 16_384], expected);
    assert!(
        (measured / expected - 1.0).abs() < 0.015,
        "loop delay {SMALL_FRACTION_DELAY} must keep its pitch when the fraction \
         shifts into the integer part: measured {measured:.1} Hz, expected {expected:.1} Hz"
    );
}
