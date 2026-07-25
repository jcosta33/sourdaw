//! Per-band oversampling for Bacteria's distortion stage.
//!
//! This module previously claimed to implement "half-band polyphase IIR
//! filters" via a "5th order elliptic half-band IIR (two all-pass branches)".
//! It implemented none of that. Its `AllPassSection::process` stored the
//! *input* in the state register:
//!
//! ```text
//! let output = self.z1 + (input - self.z1) * self.coeff;
//! self.z1 = input;
//! ```
//!
//! which expands to `y[n] = a*x[n] + (1-a)*x[n-1]` — a 2-tap FIR with no pole
//! and therefore no all-pass property at all. A first-order all-pass needs
//! output feedback (`y[n] = a*(x[n] - y[n-1]) + x[n-1]`). The polyphase
//! half-band decomposition is built on each branch being all-pass, so without
//! it neither the elliptic response nor the band splitting held. Measured on
//! a 7 kHz tanh drive at 48 kHz, the old chain rejected only ~10% more
//! fold-back than *no oversampling at all* while attenuating the passband by
//! 7.4 dB (2x) / 13.9 dB (4x), and factor 8 was bit-identical to factor 4
//! because `downsample` never read past index 3 — the "interpolated" samples
//! it fabricated for slots 4..8 were discarded and the third stage was dead.
//!
//! The replacement introduces no new filter math. It cascades the crate's
//! existing, tested 15-tap Kaiser half-band FIR
//! (`proof::oversample::Oversampler2x` — unity-gain normalized, independent
//! up/down delay lines), which is the route `grinder::oversample` took for
//! the DSP-3 fix.
//!
//! Cascade shape: each stage uses ONE filter instance driven once per sample
//! of *its own* input rate — stage 2 runs twice per base sample, stage 3 four
//! times. Giving each phase its own instance instead (as `proof`'s
//! `Oversampler4x` does) makes every stage-2 filter see a base-rate-decimated
//! stream, so its cutoff collapses back onto the stage-1 cutoff and the
//! passband droop compounds: that arrangement measured 0.936x at 7 kHz for 4x
//! where the sequential cascade holds 0.959x.
//!
//! Trade-off versus a genuine polyphase IIR: the FIR is linear-phase but has
//! real group delay (see [`OversamplingChain::latency_samples`]), where a
//! working IIR would have been cheaper and lower-latency at the cost of phase
//! distortion. Bacteria never had the IIR's latency to preserve — the code
//! that claimed it was a 2-tap FIR — so consolidating onto the one tested
//! half-band in the crate costs nothing that existed and removes a second
//! filter implementation to maintain.

use crate::primitives::flush_denormal;
use crate::proof::oversample::Oversampler2x;

/// Largest supported oversampling factor.
pub const MAX_FACTOR: usize = 8;

/// Round a requested factor down to a supported power of two in 1..=8.
///
/// The previous implementation clamped to `1..=8` but only built stages for
/// exactly 1/2/4/8, so a factor of 3, 5, 6 or 7 kept the odd factor with an
/// empty stage vector and panicked on the first `upsample`.
fn normalize_factor(requested: usize) -> usize {
    if requested >= 8 {
        return 8;
    }
    if requested >= 4 {
        return 4;
    }
    if requested >= 2 {
        return 2;
    }
    1
}

/// Read a 2x-rate sample without panicking on a short slice.
///
/// Callers pass exactly `factor` samples; a short slice would be a caller bug,
/// but this runs on the audio thread where a panic is worse than a zero.
#[inline]
fn tap(samples: &[f32], index: usize) -> f32 {
    match samples.get(index) {
        Some(&sample) => sample,
        None => 0.0,
    }
}

/// Configurable oversampling: 1x (bypass), 2x, 4x, 8x.
///
/// Allocation-free — every stage and the interleave buffer are inline, so
/// rebuilding the chain when the `oversampling` parameter changes is safe on
/// the audio thread.
pub struct OversamplingChain {
    /// Base rate to 2x.
    stage1: Oversampler2x,
    /// 2x to 4x. Driven twice per base sample, so its delay line advances at
    /// the 2x rate and its cutoff sits an octave above stage 1's.
    stage2: Oversampler2x,
    /// 4x to 8x. Driven four times per base sample.
    stage3: Oversampler2x,
    factor: usize,
    buffer: [f32; MAX_FACTOR],
}

impl OversamplingChain {
    pub fn new(factor: usize) -> Self {
        Self {
            stage1: Oversampler2x::new(),
            stage2: Oversampler2x::new(),
            stage3: Oversampler2x::new(),
            factor: normalize_factor(factor),
            buffer: [0.0; MAX_FACTOR],
        }
    }

    pub fn factor(&self) -> usize {
        self.factor
    }

    /// Round-trip group delay in base-rate samples.
    ///
    /// One half-band round trip costs 6.5 samples at the rate the stage runs,
    /// and each stage runs at twice the rate of the one below it, so the
    /// stages contribute 6.5, 3.25 and 1.625 base-rate samples.
    pub fn latency_samples(&self) -> f32 {
        match self.factor {
            2 => 6.5,
            4 => 9.75,
            8 => 11.375,
            _ => 0.0,
        }
    }

    /// Upsample one input sample into `factor` output samples, in time order.
    pub fn upsample(&mut self, input: f32) -> &[f32] {
        match self.factor {
            2 => {
                let (first, second) = self.stage1.upsample(input);
                self.buffer[0] = first;
                self.buffer[1] = second;
            }
            4 => {
                let (first, second) = self.stage1.upsample(input);
                let (a0, a1) = self.stage2.upsample(first);
                let (b0, b1) = self.stage2.upsample(second);
                self.buffer[0] = a0;
                self.buffer[1] = a1;
                self.buffer[2] = b0;
                self.buffer[3] = b1;
            }
            8 => {
                let (first, second) = self.stage1.upsample(input);
                let (a0, a1) = self.stage2.upsample(first);
                let (b0, b1) = self.stage2.upsample(second);
                let (a00, a01) = self.stage3.upsample(a0);
                let (a10, a11) = self.stage3.upsample(a1);
                let (b00, b01) = self.stage3.upsample(b0);
                let (b10, b11) = self.stage3.upsample(b1);
                self.buffer[0] = a00;
                self.buffer[1] = a01;
                self.buffer[2] = a10;
                self.buffer[3] = a11;
                self.buffer[4] = b00;
                self.buffer[5] = b01;
                self.buffer[6] = b10;
                self.buffer[7] = b11;
            }
            _ => {
                self.buffer[0] = input;
            }
        }
        &self.buffer[..self.factor]
    }

    /// Downsample `factor` processed samples back to one output sample.
    ///
    /// Mirrors [`Self::upsample`]: each stage decimates the pairs its own
    /// upsampling direction produced, in the same order.
    pub fn downsample(&mut self, samples: &[f32]) -> f32 {
        let output = match self.factor {
            2 => self.stage1.downsample(tap(samples, 0), tap(samples, 1)),
            4 => {
                let first = self.stage2.downsample(tap(samples, 0), tap(samples, 1));
                let second = self.stage2.downsample(tap(samples, 2), tap(samples, 3));
                self.stage1.downsample(first, second)
            }
            8 => {
                let a0 = self.stage3.downsample(tap(samples, 0), tap(samples, 1));
                let a1 = self.stage3.downsample(tap(samples, 2), tap(samples, 3));
                let b0 = self.stage3.downsample(tap(samples, 4), tap(samples, 5));
                let b1 = self.stage3.downsample(tap(samples, 6), tap(samples, 7));
                let first = self.stage2.downsample(a0, a1);
                let second = self.stage2.downsample(b0, b1);
                self.stage1.downsample(first, second)
            }
            _ => tap(samples, 0),
        };
        flush_denormal(output)
    }

    pub fn reset(&mut self) {
        self.stage1.reset();
        self.stage2.reset();
        self.stage3.reset();
        self.buffer = [0.0; MAX_FACTOR];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grinder::oversample::alias_probe::{
        alias_to_harmonic_ratio, bin_magnitude, drive_tone, HARMONIC_BINS_HZ,
        PROBE_FUNDAMENTAL_HZ,
    };

    const SAMPLE_RATE: f32 = 48_000.0;
    const RENDER_LEN: usize = 8_192;
    const DRIVE_AMPLITUDE: f32 = 0.9;

    /// Memoryless stand-in for Bacteria's waveshaper: the fold-back it makes
    /// is the same class the band distortion produces.
    fn hard_drive(x: f32) -> f32 {
        (x * 6.0).tanh()
    }

    fn identity(x: f32) -> f32 {
        x
    }

    /// Render the probe tone through the chain exactly the way `engine.rs`
    /// drives it: upsample, run the stage on every oversampled sample,
    /// decimate.
    fn render_chain(factor: usize, mut stage: impl FnMut(f32) -> f32) -> Vec<f32> {
        let mut chain = OversamplingChain::new(factor);
        let mut processed = [0.0_f32; MAX_FACTOR];
        (0..RENDER_LEN)
            .map(|n| {
                let input = drive_tone(n, SAMPLE_RATE, DRIVE_AMPLITUDE);
                let len = {
                    let up = chain.upsample(input);
                    for (i, &sample) in up.iter().enumerate() {
                        processed[i] = stage(sample);
                    }
                    up.len()
                };
                chain.downsample(&processed[..len])
            })
            .collect()
    }

    /// The nonlinearity with no rate conversion at all — the floor any real
    /// oversampler has to beat by a wide margin.
    fn render_naive() -> Vec<f32> {
        (0..RENDER_LEN)
            .map(|n| hard_drive(drive_tone(n, SAMPLE_RATE, DRIVE_AMPLITUDE)))
            .collect()
    }

    /// Red-first anchor: the undersampled nonlinearity must alias badly, or
    /// the comparisons below prove nothing. Measured 0.173.
    #[test]
    fn undersampled_nonlinearity_aliases_badly() {
        let ratio = alias_to_harmonic_ratio(&render_naive(), SAMPLE_RATE);
        assert!(
            ratio > 0.1,
            "the un-oversampled tanh is supposed to fold back hard (ratio={ratio:.4})"
        );
    }

    /// The bar the old implementation failed. Pre-fix measurements on this
    /// fixture: naive 0.1732, 2x 0.1568 (1.1x), 4x 0.0788 (2.2x, and only
    /// because it attenuated everything by 14 dB), 8x 0.0788 (bit-identical
    /// to 4x). Post-fix every factor rejects far more.
    #[test]
    fn every_factor_rejects_far_more_aliasing_than_no_oversampling() {
        let naive = alias_to_harmonic_ratio(&render_naive(), SAMPLE_RATE);
        for factor in [2_usize, 4, 8] {
            let ratio = alias_to_harmonic_ratio(&render_chain(factor, hard_drive), SAMPLE_RATE);
            assert!(
                ratio * 5.0 < naive,
                "{factor}x oversampling must reject at least 5x more fold-back \
                 than no oversampling (naive={naive:.4}, {factor}x={ratio:.4})"
            );
        }
    }

    /// Rejection has to improve with the factor. The old chain failed this
    /// outright: 8x was bit-identical to 4x.
    #[test]
    fn higher_factors_reject_more_than_lower_factors() {
        let two = alias_to_harmonic_ratio(&render_chain(2, hard_drive), SAMPLE_RATE);
        let four = alias_to_harmonic_ratio(&render_chain(4, hard_drive), SAMPLE_RATE);
        let eight = alias_to_harmonic_ratio(&render_chain(8, hard_drive), SAMPLE_RATE);
        assert!(four < two, "4x must beat 2x (2x={two:.5}, 4x={four:.5})");
        assert!(
            eight < four,
            "8x must beat 4x (4x={four:.5}, 8x={eight:.5}) — it was bit-identical pre-fix"
        );
    }

    /// Rate conversion must be level-neutral. Pre-fix the passband gain was
    /// 0.425 at 2x and 0.202 at 4x/8x — the "aliasing improvement" at 4x was
    /// largely the whole signal being crushed 14 dB.
    #[test]
    fn passband_gain_stays_near_unity_at_every_factor() {
        let reference = bin_magnitude(
            &render_chain(1, identity),
            PROBE_FUNDAMENTAL_HZ,
            SAMPLE_RATE,
        );
        for factor in [2_usize, 4, 8] {
            let measured = bin_magnitude(
                &render_chain(factor, identity),
                PROBE_FUNDAMENTAL_HZ,
                SAMPLE_RATE,
            );
            let gain = measured / reference;
            assert!(
                (0.95..=1.05).contains(&gain),
                "{factor}x round trip must be level-neutral at 7 kHz, got {gain:.4}x"
            );
        }
    }

    /// Anti-aliasing must not eat the wanted harmonics along with the
    /// fold-back. Pre-fix 4x/8x retained only 0.256 against a naive baseline.
    #[test]
    fn wanted_harmonics_survive_the_rate_conversion() {
        let harmonic_energy = |samples: &[f32]| -> f32 {
            HARMONIC_BINS_HZ
                .iter()
                .map(|&f| bin_magnitude(samples, f, SAMPLE_RATE))
                .sum()
        };
        let naive = harmonic_energy(&render_naive());
        for factor in [2_usize, 4, 8] {
            let retention = harmonic_energy(&render_chain(factor, hard_drive)) / naive;
            assert!(
                (0.75..=1.25).contains(&retention),
                "{factor}x must keep the in-band harmonics (retention={retention:.3}x)"
            );
        }
    }

    /// Silence in, exact silence out — no DC or denormal residue leaking into
    /// the downstream band chain.
    #[test]
    fn silence_in_produces_silence_out() {
        for factor in [1_usize, 2, 4, 8] {
            let mut chain = OversamplingChain::new(factor);
            let mut processed = [0.0_f32; MAX_FACTOR];
            for n in 0..512 {
                let len = {
                    let up = chain.upsample(0.0);
                    for (i, &sample) in up.iter().enumerate() {
                        processed[i] = sample;
                    }
                    up.len()
                };
                let out = chain.downsample(&processed[..len]);
                assert_eq!(out, 0.0, "{factor}x leaked {out} at sample {n}");
            }
        }
    }

    /// `reset` must clear every stage's history, so a used chain and a fresh
    /// one track sample-for-sample afterwards.
    #[test]
    fn reset_clears_every_stage_history() {
        let mut processed = [0.0_f32; MAX_FACTOR];
        let mut run = |chain: &mut OversamplingChain, n: usize, amplitude: f32| -> f32 {
            let len = {
                let up = chain.upsample(drive_tone(n, SAMPLE_RATE, amplitude));
                for (i, &sample) in up.iter().enumerate() {
                    processed[i] = hard_drive(sample);
                }
                up.len()
            };
            chain.downsample(&processed[..len])
        };

        let mut used = OversamplingChain::new(8);
        for n in 0..256 {
            run(&mut used, n, 0.9);
        }
        used.reset();

        let mut fresh = OversamplingChain::new(8);
        for n in 0..256 {
            let from_used = run(&mut used, n, 0.4);
            let from_fresh = run(&mut fresh, n, 0.4);
            assert_eq!(from_used, from_fresh, "reset must clear history at sample {n}");
        }
    }

    /// A non-power-of-two factor used to keep the odd factor with an empty
    /// stage vector and panic on the first `upsample`. It must now round down
    /// to a supported factor and produce that many samples.
    #[test]
    fn non_power_of_two_factors_round_down_instead_of_panicking() {
        for (requested, expected) in [(3_usize, 2_usize), (5, 4), (6, 4), (7, 4), (99, 8), (0, 1)] {
            let mut chain = OversamplingChain::new(requested);
            assert_eq!(
                chain.factor(),
                expected,
                "factor {requested} must normalize to {expected}"
            );
            assert_eq!(
                chain.upsample(0.5).len(),
                expected,
                "factor {requested} must emit {expected} samples"
            );
        }
    }

    /// The reported group delay must match the impulse the chain actually
    /// produces, so a host compensating on this number stays aligned.
    #[test]
    fn reported_latency_matches_the_measured_impulse_centroid() {
        for factor in [2_usize, 4, 8] {
            let mut chain = OversamplingChain::new(factor);
            let mut processed = [0.0_f32; MAX_FACTOR];
            let mut numerator = 0.0_f32;
            let mut denominator = 0.0_f32;
            for n in 0..128 {
                let input = if n == 0 { 1.0 } else { 0.0 };
                let len = {
                    let up = chain.upsample(input);
                    for (i, &sample) in up.iter().enumerate() {
                        processed[i] = sample;
                    }
                    up.len()
                };
                let out = chain.downsample(&processed[..len]);
                numerator += n as f32 * out.abs();
                denominator += out.abs();
            }
            let centroid = numerator / denominator;
            let reported = chain.latency_samples();
            assert!(
                (centroid - reported).abs() < 0.5,
                "{factor}x reports {reported} samples of latency but the impulse \
                 centroid sits at {centroid:.3}"
            );
        }
    }
}
