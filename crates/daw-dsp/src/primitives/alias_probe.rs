//! Aliasing measurement for oversampling tests.
//!
//! Test-only: every consumer is a `#[cfg(test)]` module. Lives beside
//! [`crate::primitives::oversample`] rather than inside a device module so a
//! rate-conversion test does not have to reach into an engine to measure
//! itself.

/// Single-bin energy via Goertzel — enough to compare harmonic bins
/// against fold-back bins without pulling in an FFT dependency.
pub fn bin_magnitude(samples: &[f32], freq_hz: f32, sample_rate: f32) -> f32 {
    let omega = 2.0 * std::f32::consts::PI * freq_hz / sample_rate;
    let coeff = 2.0 * omega.cos();
    let mut s1 = 0.0_f32;
    let mut s2 = 0.0_f32;
    for &x in samples {
        let s0 = x + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    (s1 * s1 + s2 * s2 - coeff * s1 * s2).max(0.0).sqrt() / samples.len() as f32
}

/// A 7 kHz drive at 48 kHz puts the true harmonics at 7k/14k/21k and folds
/// everything above Nyquist onto bins that are *not* harmonics of 7 kHz:
/// 28k→20k, 35k→13k, 42k→6k, 49k→1k. The ratio of fold-back energy to
/// harmonic energy is therefore a direct aliasing readout.
pub const PROBE_FUNDAMENTAL_HZ: f32 = 7_000.0;
pub const HARMONIC_BINS_HZ: [f32; 3] = [7_000.0, 14_000.0, 21_000.0];
pub const ALIAS_BINS_HZ: [f32; 4] = [1_000.0, 6_000.0, 13_000.0, 20_000.0];

/// Alias-to-harmonic energy ratio for a rendered block.
pub fn alias_to_harmonic_ratio(samples: &[f32], sample_rate: f32) -> f32 {
    let harmonic: f32 = HARMONIC_BINS_HZ
        .iter()
        .map(|&f| bin_magnitude(samples, f, sample_rate))
        .sum();
    let alias: f32 = ALIAS_BINS_HZ
        .iter()
        .map(|&f| bin_magnitude(samples, f, sample_rate))
        .sum();
    alias / harmonic.max(1.0e-12)
}

pub fn drive_tone(index: usize, sample_rate: f32, amplitude: f32) -> f32 {
    let phase = 2.0 * std::f32::consts::PI * PROBE_FUNDAMENTAL_HZ * index as f32 / sample_rate;
    phase.sin() * amplitude
}
