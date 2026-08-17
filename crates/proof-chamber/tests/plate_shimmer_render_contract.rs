//! Does Shimmer render a pitch shift, or does it render noise?
//!
//! Every other shimmer assertion in this crate is a *stability* assertion: the
//! output stays finite, stays under a ceiling, and settles. All three hold for
//! a stage that emits broadband hiss, and all three hold for a stage that emits
//! nothing at all — `plate_shimmer_stability.rs` passes with the granular
//! shifter deleted. What the control claims on the panel is narrower and is not
//! covered anywhere: Shimmer Pitch offers a **fifth up** and an **octave up**,
//! and the tail is supposed to come back carrying that interval.
//!
//! So the measurement is a spectral one, taken on a sustained tone rather than
//! a burst: with the shifter inside the tank feedback and Amount at full, the
//! selected partial has to be *there*, well clear of the spectral floor around
//! it, and it has to be the up-shift rather than its downward mirror.
//!
//! Both rates, because the grain length is derived from the sample rate
//! (`GranularShifter::new`) and a rate-dependent error is invisible at one.
//!
//! # Why this test is `#[ignore]`d
//!
//! It is red against the shipped engine, and it pins two defects in
//! `src/proof_chamber.rs` that both have to be repaired before it can go green:
//!
//! * **The phase increment runs the read pointer the wrong way** (`:320`-`:324`).
//!   `read = write_pos - grain_size * phase` with `phase += (ratio - 1) / gs`
//!   walks the read pointer *backwards* relative to the write pointer, so the
//!   grain plays slower than real time. A ratio of 1.5 resamples at 0.5x — an
//!   octave **down**, not a fifth up — and a ratio of 2.0 pins the pointer
//!   still, which is not a pitch shift in either direction.
//! * **One `GranularShifter` is shared by both tank halves** (`:454` declares
//!   it, `:653` builds one, `:906` and `:936` step it once for the left half
//!   and once for the right). Its delay line therefore holds the two halves
//!   *interleaved*, one sample each, and the `±8`-sample read jitter (`:318`
//!   -`:319`) is redrawn per sample, so consecutive grain reads land on
//!   alternating channels at random. The shifted signal that comes back is a
//!   per-sample scramble of two unrelated tank signals, which is why the
//!   measured tail carries a flat noise floor from 1 kHz to Nyquist and no
//!   pitched partial anywhere.
//!
//! Un-ignore this when the shifter is repaired. The `10x` floor margin below is
//! deliberately far under what a working shifter should deliver — the
//! fundamental sits some 300x over the same floor — so a repair that lands
//! under it has not made Shimmer audible and the number is not the thing to
//! move.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATES: [f32; 2] = [44_100.0, 48_000.0];
const BLOCK: usize = 128;

/// Low enough that every partial up to the fourth shift stays well inside the
/// band, and not a divisor of either sample rate.
const TONE_HZ: f32 = 220.0;

/// Two seconds of tone; the analysis window is its second half, by which point
/// the shifter has recirculated through the tank many times over.
const SUSTAIN_SECONDS: f32 = 2.0;

/// `shimmer_pitch` is a two-position switch in `ProofChamber::set_param`:
/// below 0.5 selects the 1.5 ratio, at or above selects 2.0.
const PITCH_SETTINGS: [(f32, f32, &str); 2] = [(0.0, 1.5, "fifth up"), (1.0, 2.0, "octave up")];

/// How far over the surrounding spectral floor the shifted partial has to
/// stand before it counts as present rather than as part of the noise.
const FLOOR_MARGIN: f32 = 10.0;

/// How far the up-shifted partial has to stand over its downward mirror. This
/// is the direction claim on its own: a shifter running backwards puts its
/// energy at `f / ratio` instead of `f * ratio`.
const DIRECTION_MARGIN: f32 = 4.0;

/// Multiples of the tone that are neither the fundamental nor any partial the
/// two ratios can produce (`1.5^k`, `2^k`, and their mirrors), so the median of
/// their magnitudes describes the noise between the partials.
const FLOOR_PROBES: [f32; 6] = [1.15, 1.31, 1.72, 2.6, 3.9, 5.3];

/// Render a sustained tone through the plate with Shimmer engaged, returning
/// the left channel of the second half of the tone.
///
/// `damping` is at 0 and `high_cut` wide open on purpose: the question is what
/// the shifter puts into the tank, and the shipped tone controls would
/// attenuate the upper partials the measurement is looking for before they
/// reached the output. `mod_depth` is 0 so the only thing modulating the tail
/// is the shifter itself.
fn render_shimmer_tail(sample_rate: f32, pitch_setting: f32) -> Vec<f32> {
    let mut instance = ProofChamberInstance::new(sample_rate);
    for (name, value) in [
        ("algorithm", 0.0),
        ("mix", 1.0),
        ("decay", 0.85),
        ("damping", 0.0),
        ("size", 0.8),
        ("early_late", 1.0),
        ("high_cut", 20_000.0),
        ("low_cut", 20.0),
        ("mod_depth", 0.0),
        ("shimmer", 1.0),
        ("shimmer_amount", 1.0),
        ("shimmer_pitch", pitch_setting),
    ] {
        instance.set_param(name, value);
    }

    let frames = (sample_rate * SUSTAIN_SECONDS) as usize;
    let mut output = Vec::with_capacity(frames);
    let mut index = 0;
    while index < frames {
        let block = (frames - index).min(BLOCK);
        let input: Vec<f32> = (0..block)
            .map(|offset| {
                let phase = (index + offset) as f32 / sample_rate * TONE_HZ * std::f32::consts::TAU;
                0.4 * phase.sin()
            })
            .collect();
        let ptr = instance.process(&input, &input, block as u32);
        assert!(!ptr.is_null(), "process returned a null buffer");
        for offset in 0..block {
            let sample = unsafe { *ptr.add(offset) };
            assert!(
                sample.is_finite(),
                "non-finite output at frame {}",
                index + offset
            );
            output.push(sample);
        }
        index += block;
    }

    output.split_off(frames / 2)
}

/// Magnitude of `freq` in `samples`, by direct evaluation of the one DFT bin
/// that matters over a Hann-windowed block.
///
/// A bin rather than a filter because the partials of interest sit at
/// non-integer ratios of any convenient block length, and a fitted bin does not
/// care where they land.
fn bin_magnitude(samples: &[f32], sample_rate: f32, freq: f32) -> f32 {
    let len = samples.len();
    let omega = std::f64::consts::TAU * f64::from(freq) / f64::from(sample_rate);
    let mut real = 0.0_f64;
    let mut imaginary = 0.0_f64;
    for (index, sample) in samples.iter().enumerate() {
        let window = 0.5 * (1.0 - (std::f64::consts::TAU * index as f64 / len as f64).cos());
        let value = f64::from(*sample) * window;
        real += value * (omega * index as f64).cos();
        imaginary += value * (omega * index as f64).sin();
    }
    ((real * real + imaginary * imaginary).sqrt() / len as f64) as f32
}

/// Median magnitude across `FLOOR_PROBES`: what the spectrum reads between the
/// partials, which is what a partial has to stand above to be one.
fn spectral_floor(samples: &[f32], sample_rate: f32) -> f32 {
    let mut magnitudes: Vec<f32> = FLOOR_PROBES
        .iter()
        .map(|multiple| bin_magnitude(samples, sample_rate, TONE_HZ * multiple))
        .collect();
    magnitudes.sort_by(|a, b| a.partial_cmp(b).expect("finite magnitudes"));
    (magnitudes[magnitudes.len() / 2 - 1] + magnitudes[magnitudes.len() / 2]) * 0.5
}

#[test]
#[ignore = "pins the plate's dead Shimmer path — the inverted grain phase increment (src/proof_chamber.rs:320-324) and the single GranularShifter shared across both tank halves (src/proof_chamber.rs:454, :653, :906, :936). Red until the shimmer repair lane lands."]
fn shimmer_puts_its_selected_interval_into_the_tail() {
    for sample_rate in SAMPLE_RATES {
        for (setting, ratio, label) in PITCH_SETTINGS {
            let tail = render_shimmer_tail(sample_rate, setting);

            let fundamental = bin_magnitude(&tail, sample_rate, TONE_HZ);
            let shifted = bin_magnitude(&tail, sample_rate, TONE_HZ * ratio);
            let mirror = bin_magnitude(&tail, sample_rate, TONE_HZ / ratio);
            let floor = spectral_floor(&tail, sample_rate);

            assert!(
                fundamental > floor * FLOOR_MARGIN,
                "{label} at {sample_rate:.0} Hz: the input tone itself is not clear of the \
                 spectral floor (fundamental {fundamental:e}, floor {floor:e}), so this render \
                 cannot say anything about a partial either — the stimulus or the render \
                 settings moved, not the shifter"
            );

            assert!(
                shifted > floor * FLOOR_MARGIN,
                "{label} at {sample_rate:.0} Hz: nothing is sounding at {:.1} Hz. Shimmer's \
                 partial measures {shifted:e} against a spectral floor of {floor:e} \
                 ({:.1}x, needs {FLOOR_MARGIN:.0}x), while the fundamental measures \
                 {fundamental:e}. The stage is adding noise to the tank, not an interval.",
                TONE_HZ * ratio,
                shifted / floor.max(1e-12)
            );

            assert!(
                shifted > mirror * DIRECTION_MARGIN,
                "{label} at {sample_rate:.0} Hz: Shimmer is shifting the wrong way. \
                 {:.1} Hz measures {shifted:e} and its downward mirror {:.1} Hz measures \
                 {mirror:e} ({:.2}x, needs {DIRECTION_MARGIN:.0}x). The control offers an \
                 interval up.",
                TONE_HZ * ratio,
                TONE_HZ / ratio,
                shifted / mirror.max(1e-12)
            );
        }
    }
}
