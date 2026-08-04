//! Crust's oversampling cascade — 1x / 4x / 8x / 16x / 32x.
//!
//! The crate's shared [`crate::primitives::oversample::OversamplingChain`] tops
//! out at 8x, and Crust's panel offers 16x and 32x as well. Rather than widen
//! the shared `MAX_FACTOR` (which would grow the inline buffer of every device
//! that uses it), Crust cascades the shared half-band
//! [`Oversampler2x`] itself up to five stages.
//!
//! Cascade shape follows the shared chain's documented rule exactly: stage `s`
//! is driven once per sample of *its own* input rate, in time order, so each
//! delay line advances at the rate it filters and each cutoff sits an octave
//! above the stage below it. Driving a stage once per base sample instead would
//! collapse every cutoff onto stage 1's and compound the passband droop.
//!
//! Allocation-free: every stage and both scratch buffers are inline, so
//! changing the factor is safe on the audio thread.

use crate::primitives::oversample::Oversampler2x;

/// Largest factor the panel offers.
pub const MAX_FACTOR: usize = 32;
/// Half-band stages needed for [`MAX_FACTOR`] (2^5 = 32).
const MAX_STAGES: usize = 5;

/// Round a requested factor down to a supported power of two in 1..=32.
///
/// Values between the supported steps must not survive as themselves: the
/// cascade only builds power-of-two stages, and a factor of 3 or 12 would emit
/// a slice no decimation pass can consume.
pub fn normalize_factor(requested: usize) -> usize {
    if requested >= 32 {
        return 32;
    }
    if requested >= 16 {
        return 16;
    }
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

fn stages_for(factor: usize) -> usize {
    match factor {
        32 => 5,
        16 => 4,
        8 => 3,
        4 => 2,
        2 => 1,
        _ => 0,
    }
}

/// Single-channel oversampling cascade.
pub struct CrustOversampler {
    stages: [Oversampler2x; MAX_STAGES],
    factor: usize,
    front: [f32; MAX_FACTOR],
    back: [f32; MAX_FACTOR],
}

impl CrustOversampler {
    pub fn new(factor: usize) -> Self {
        Self {
            stages: [
                Oversampler2x::new(),
                Oversampler2x::new(),
                Oversampler2x::new(),
                Oversampler2x::new(),
                Oversampler2x::new(),
            ],
            factor: normalize_factor(factor),
            front: [0.0; MAX_FACTOR],
            back: [0.0; MAX_FACTOR],
        }
    }

    pub fn factor(&self) -> usize {
        self.factor
    }

    /// Swap to a new factor. Resets the stage histories, because a stage that
    /// resumes at a different rate would filter a delay line captured at the
    /// old one.
    pub fn set_factor(&mut self, factor: usize) {
        let normalized = normalize_factor(factor);
        if normalized == self.factor {
            return;
        }
        self.factor = normalized;
        self.reset();
    }

    pub fn reset(&mut self) {
        for stage in &mut self.stages {
            stage.reset();
        }
        self.front = [0.0; MAX_FACTOR];
        self.back = [0.0; MAX_FACTOR];
    }

    /// Upsample one base-rate sample into `factor` samples, in time order.
    pub fn upsample(&mut self, input: f32) -> &[f32] {
        self.front[0] = input;
        let mut length = 1_usize;

        for stage_index in 0..stages_for(self.factor) {
            let stage = &mut self.stages[stage_index];
            for sample_index in 0..length {
                let (first, second) = stage.upsample(self.front[sample_index]);
                self.back[sample_index * 2] = first;
                self.back[sample_index * 2 + 1] = second;
            }
            length *= 2;
            self.front[..length].copy_from_slice(&self.back[..length]);
        }

        &self.front[..length]
    }

    /// Decimate `factor` processed samples back to one base-rate sample.
    ///
    /// Stages unwind in reverse order so each one decimates the rate it
    /// interpolated. `Oversampler2x` keeps independent up- and down-sampling
    /// delay lines, so one instance per stage serves both directions.
    pub fn downsample(&mut self, processed: &[f32]) -> f32 {
        let mut length = self.factor.min(processed.len());
        if length == 0 {
            return 0.0;
        }
        self.front[..length].copy_from_slice(&processed[..length]);

        let stages = stages_for(self.factor);
        for offset in 0..stages {
            let stage = &mut self.stages[stages - 1 - offset];
            let pairs = length / 2;
            for pair_index in 0..pairs {
                self.back[pair_index] =
                    stage.downsample(self.front[pair_index * 2], self.front[pair_index * 2 + 1]);
            }
            length = pairs;
            self.front[..length].copy_from_slice(&self.back[..length]);
        }

        self.front[0]
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_factor, CrustOversampler};

    #[test]
    fn unsupported_factors_round_down_to_a_power_of_two() {
        assert_eq!(normalize_factor(0), 1);
        assert_eq!(normalize_factor(3), 2);
        assert_eq!(normalize_factor(12), 8);
        assert_eq!(normalize_factor(31), 16);
        assert_eq!(normalize_factor(64), 32);
    }

    /// A round trip with no processing in between must return the signal, not a
    /// rescaled copy: a mis-normalized cascade shows up here as a level error.
    #[test]
    fn round_trip_preserves_level_at_every_factor() {
        for factor in [1_usize, 4, 8, 16, 32] {
            let mut chain = CrustOversampler::new(factor);
            let mut peak_out = 0.0_f32;
            // Skip the filter's group delay before measuring.
            for n in 0..4_000 {
                let input = (2.0 * std::f32::consts::PI * 1_000.0 * n as f32 / 48_000.0).sin();
                let up: [f32; 32] = {
                    let slice = chain.upsample(input);
                    let mut copy = [0.0_f32; 32];
                    copy[..slice.len()].copy_from_slice(slice);
                    copy
                };
                let out = chain.downsample(&up[..factor]);
                if n > 500 {
                    peak_out = peak_out.max(out.abs());
                }
            }
            assert!(
                (0.95..=1.05).contains(&peak_out),
                "factor {factor} round trip must return unity, measured {peak_out:.4}"
            );
        }
    }
}
