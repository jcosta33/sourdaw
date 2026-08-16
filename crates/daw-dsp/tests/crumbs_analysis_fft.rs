//! The offline analysis FFT must be the direct DFT it replaced (audit F8).
//!
//! `crumbs::analysis` used to transform each STFT frame with a per-bin direct
//! DFT — O(fft_size × num_bins) per frame, which the calling Tauri command paid
//! synchronously and which took seconds to minutes on realistic sample lengths.
//! The transform is now an in-crate radix-2 FFT.
//!
//! Everything downstream of the spectrogram — spectral flux, peak picking,
//! tempo estimation — reads magnitudes and phases with a fixed sign convention,
//! so "faster" is only acceptable if it is also "the same numbers". The
//! reference DFT is written out inside this file rather than imported, so the
//! comparison keeps its meaning after the source it checks was swapped.

use std::f32::consts::PI;

use daw_dsp::crumbs::analysis::fft::RealFftPlan;
use daw_dsp::crumbs::analysis::onset::{detect_superflux, OnsetConfig};

/// The shipped analysis size. 8 and 64 bracket it from below so a bug in the
/// smallest butterfly stages cannot hide behind averaging at 1024.
const ANALYSIS_FFT_SIZE: usize = 1024;

/// Deterministic pseudo-random source: a 64-bit LCG with the Knuth/MMIX
/// multiplier, top 24 bits scaled to `[-1, 1)`. Seeded rather than random so a
/// failure is reproducible, and in-file rather than a dependency because this
/// crate keeps its dependency set minimal.
fn lcg_noise(len: usize, seed: u64) -> Vec<f32> {
    let mut state = seed;
    (0..len)
        .map(|_| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((state >> 40) as f32 / (1u64 << 24) as f32) * 2.0 - 1.0
        })
        .collect()
}

/// Magnitude floor, as a fraction of the frame's peak bin, below which phase is
/// not compared.
///
/// The gate is a statement about the *reference*, not about the FFT. At 1024
/// points the direct f32 DFT accumulates 1024 sequential roundings per bin;
/// measured against an f64 evaluation of the same sum on this fixture, its
/// worst complex error is 5.1e-3 while the FFT's is 1.5e-5 — the transform
/// being checked is the accurate one, by two orders of magnitude. A complex
/// error `e` displaces the angle of a bin of magnitude `m` by up to `e / m`, so
/// holding phase agreement to 1e-3 rad needs `m >= 5.1e-3 / 1e-3 ≈ 0.10 ×
/// peak`. Below that the assertion would be measuring the reference's noise.
/// Magnitude carries no such condition and is compared on every bin.
const PHASE_MAGNITUDE_GATE: f32 = 0.15;

/// The transform the analysis used before the swap: `X[k] = Σ x[n]·e^{-2πikn/N}`
/// evaluated bin by bin, with `real += x·cos` and `imag -= x·sin`. Returns the
/// interleaved-free `(real, imag)` pair per bin for bins `0..=N/2`.
fn reference_dft(input: &[f32]) -> Vec<(f32, f32)> {
    let size = input.len();

    (0..size / 2 + 1)
        .map(|bin| {
            let mut real = 0.0f32;
            let mut imag = 0.0f32;
            let freq = 2.0 * PI * bin as f32 / size as f32;

            for (n, &sample) in input.iter().enumerate() {
                real += sample * (freq * n as f32).cos();
                imag -= sample * (freq * n as f32).sin();
            }

            (real, imag)
        })
        .collect()
}

/// Smallest signed difference between two angles, so a bin sitting on the `±π`
/// branch cut does not read as a full 2π disagreement.
fn wrapped_phase_diff(a: f32, b: f32) -> f32 {
    let mut diff = a - b;
    while diff > PI {
        diff -= 2.0 * PI;
    }
    while diff < -PI {
        diff += 2.0 * PI;
    }
    diff
}

fn assert_fft_matches_dft(size: usize, seed: u64) {
    let input = lcg_noise(size, seed);

    let mut plan = RealFftPlan::new(size);
    plan.forward(&input);
    let mut magnitudes = vec![0.0f32; plan.num_bins()];
    let mut phases = vec![0.0f32; plan.num_bins()];
    plan.magnitudes_into(&mut magnitudes);
    plan.phases_into(&mut phases);

    let expected = reference_dft(&input);

    assert_eq!(
        magnitudes.len(),
        expected.len(),
        "size {size}: bin count changed"
    );

    let expected_magnitudes: Vec<f32> = expected
        .iter()
        .map(|&(real, imag)| (real * real + imag * imag).sqrt())
        .collect();
    let peak = expected_magnitudes
        .iter()
        .fold(0.0f32, |acc, &mag| acc.max(mag));
    assert!(peak > 0.0, "size {size}: fixture carries no energy");

    let mut compared_phases = 0usize;

    for bin in 0..magnitudes.len() {
        let (expected_real, expected_imag) = expected[bin];
        let expected_magnitude = expected_magnitudes[bin];

        let error = (magnitudes[bin] - expected_magnitude).abs();
        assert!(
            error <= 1e-3 * peak,
            "size {size} bin {bin}: magnitude {} vs direct DFT {expected_magnitude} \
             (error {error}, tolerance {})",
            magnitudes[bin],
            1e-3 * peak
        );

        // The whole complex value, which is what the complex-domain onset
        // detector actually differences between frames. Subsumes magnitude and
        // phase in one ungated statement.
        let real = magnitudes[bin] * phases[bin].cos();
        let imag = magnitudes[bin] * phases[bin].sin();
        let complex_error =
            ((real - expected_real).powi(2) + (imag - expected_imag).powi(2)).sqrt();
        assert!(
            complex_error <= 1e-3 * peak,
            "size {size} bin {bin}: complex value ({real}, {imag}) vs direct DFT \
             ({expected_real}, {expected_imag}) — error {complex_error}, tolerance {}",
            1e-3 * peak
        );

        if expected_magnitude < PHASE_MAGNITUDE_GATE * peak {
            continue;
        }
        compared_phases += 1;

        let expected_phase = expected_imag.atan2(expected_real);
        let diff = wrapped_phase_diff(phases[bin], expected_phase);
        assert!(
            diff.abs() <= 1e-3,
            "size {size} bin {bin}: phase {} vs direct DFT {expected_phase} (diff {diff} rad)",
            phases[bin]
        );
    }

    // Without this the phase gate could quietly swallow the whole spectrum and
    // the phase claim would hold vacuously.
    assert!(
        compared_phases * 2 >= magnitudes.len(),
        "size {size}: only {compared_phases} of {} bins cleared the phase gate; \
         the phase comparison is no longer meaningful",
        magnitudes.len()
    );
}

#[test]
fn the_fft_matches_a_direct_dft_at_size_8() {
    assert_fft_matches_dft(8, 0x1833_0008);
}

#[test]
fn the_fft_matches_a_direct_dft_at_size_64() {
    assert_fft_matches_dft(64, 0x1833_0040);
}

#[test]
fn the_fft_matches_a_direct_dft_at_the_analysis_size() {
    assert_fft_matches_dft(ANALYSIS_FFT_SIZE, 0x1833_0400);
}

/// A real spectrum is Hermitian, so the bins the plan reports have to be the
/// half that carries all the information: `N/2 + 1` of them, DC through
/// Nyquist. Reporting `N/2` or `N` would leave the onset detectors reading a
/// different bin count than `fft_size / 2 + 1`, which they compute themselves.
#[test]
fn the_plan_reports_the_hermitian_half_of_the_spectrum() {
    let plan = RealFftPlan::new(ANALYSIS_FFT_SIZE);

    assert_eq!(plan.size(), ANALYSIS_FFT_SIZE);
    assert_eq!(plan.num_bins(), ANALYSIS_FFT_SIZE / 2 + 1);
}

// ── Behaviour guard ───────────────────────────────────────────────────────

const SAMPLE_RATE: u32 = 44_100;
/// Well clear of the 30 ms minimum-onset interval and of the 1024-sample
/// analysis window, so each click is an isolated event rather than two clicks
/// sharing a frame.
const CLICK_INTERVAL: usize = 11_025;
const CLICKS: usize = 6;
/// The decay of one click, short relative to `CLICK_INTERVAL`.
const CLICK_FRAMES: usize = 900;

/// Sample position of click `click`. The track opens with one interval of
/// silence so that no attack sits under the Hann taper of the very first
/// analysis frame, where the detector has no predecessor frame to flux against.
fn click_position(click: usize) -> usize {
    (click + 1) * CLICK_INTERVAL
}

/// A click track with instantaneous attacks at exactly [`click_position`].
/// A decaying 2 kHz burst is what a spectral-flux detector is built to find,
/// and the attack positions are the ground truth this test asserts against —
/// they come from the fixture's construction, not from any previous run of the
/// detector.
fn click_track() -> Vec<f32> {
    let mut samples = vec![0.0f32; CLICK_INTERVAL * (CLICKS + 2)];
    for click in 0..CLICKS {
        let start = click_position(click);
        for frame in 0..CLICK_FRAMES {
            let t = frame as f32 / SAMPLE_RATE as f32;
            let decay = (-t * 220.0).exp();
            let phase = t * 2_000.0 * std::f32::consts::TAU;
            samples[start + frame] = phase.sin() * decay * 0.9;
        }
    }
    samples
}

/// SuperFlux over the FFT-backed spectrogram must still find the clicks where
/// the fixture puts them.
///
/// The tolerance is the detector's own resolution, not slack: an onset is
/// reported at a frame boundary (`hop_size` = 441 samples) and then snapped to
/// a zero crossing inside `zc_snap_window`, and the flux peak follows the
/// attack by up to one analysis window. A detector that lost the transform's
/// sign convention, its windowing, or its bin ordering would not land inside
/// this band at all — it would report a different number of onsets.
#[test]
fn superflux_finds_the_clicks_the_fixture_places() {
    let samples = click_track();
    let config = OnsetConfig {
        sample_rate: SAMPLE_RATE,
        ..OnsetConfig::default()
    };

    let result = detect_superflux(&samples, &config);

    assert_eq!(
        result.positions.len(),
        CLICKS,
        "expected one onset per click, got {:?}",
        result.positions
    );

    // One analysis window plus one hop plus the zero-crossing snap window.
    let tolerance = config.fft_size + config.hop_size + config.zc_snap_window;
    for (click, &position) in result.positions.iter().enumerate() {
        let expected = click_position(click);
        let distance = (position as i64 - expected as i64).unsigned_abs() as usize;
        assert!(
            distance <= tolerance,
            "click {click} is at sample {expected} but was reported at {position} \
             ({distance} samples away, tolerance {tolerance})"
        );
    }
}
