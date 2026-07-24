//! Shared biquad primitive for the realism layer.
//!
//! Transposed direct form II (RBJ-style coefficients). Allocation-free,
//! `Copy`, suitable for the audio hot path. Design helpers cover the
//! filter shapes the realism layer needs: peaking, bandpass, low-shelf,
//! high-shelf.

use crate::primitives::flush_denormal;
use std::f32::consts::TAU;

#[derive(Debug, Clone, Copy)]
pub struct Biquad {
    /// b0/a0
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
    /// Transposed-DFII state.
    z1: f32,
    z2: f32,
}

impl Default for Biquad {
    fn default() -> Self {
        Self::passthrough()
    }
}

impl Biquad {
    pub const fn passthrough() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }

    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        let y = flush_denormal(self.b0 * x + self.z1);
        // DSP-2: body/sympathetic resonators here are high-Q and ring for
        // seconds, so both TDF-II state words land in the subnormal range on
        // every note tail unless they are flushed.
        self.z1 = flush_denormal(self.b1 * x - self.a1 * y + self.z2);
        self.z2 = flush_denormal(self.b2 * x - self.a2 * y);
        y
    }

    /// Replace coefficients but keep filter state — used for live tweaks.
    pub fn set_coeffs(&mut self, b0: f32, b1: f32, b2: f32, a1: f32, a2: f32) {
        self.b0 = b0;
        self.b1 = b1;
        self.b2 = b2;
        self.a1 = a1;
        self.a2 = a2;
    }

    /// RBJ peaking EQ. `f0` Hz, `q` dimensionless, `gain_db` peak gain.
    pub fn peaking(f0: f32, q: f32, gain_db: f32, sample_rate: f32) -> Self {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = TAU * (f0 / sample_rate).clamp(1e-6, 0.499);
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q.max(1e-3));

        let a0 = 1.0 + alpha / a;
        let inv_a0 = 1.0 / a0;
        let b0 = (1.0 + alpha * a) * inv_a0;
        let b1 = (-2.0 * cos_w0) * inv_a0;
        let b2 = (1.0 - alpha * a) * inv_a0;
        let a1 = (-2.0 * cos_w0) * inv_a0;
        let a2 = (1.0 - alpha / a) * inv_a0;

        Self {
            b0,
            b1,
            b2,
            a1,
            a2,
            z1: 0.0,
            z2: 0.0,
        }
    }

    /// RBJ bandpass (constant 0 dB peak). `f0` center, `q` selectivity.
    pub fn bandpass(f0: f32, q: f32, sample_rate: f32) -> Self {
        let w0 = TAU * (f0 / sample_rate).clamp(1e-6, 0.499);
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q.max(1e-3));

        let a0 = 1.0 + alpha;
        let inv_a0 = 1.0 / a0;
        let b0 = alpha * inv_a0;
        let b1 = 0.0;
        let b2 = -alpha * inv_a0;
        let a1 = (-2.0 * cos_w0) * inv_a0;
        let a2 = (1.0 - alpha) * inv_a0;

        Self {
            b0,
            b1,
            b2,
            a1,
            a2,
            z1: 0.0,
            z2: 0.0,
        }
    }

    /// RBJ high-shelf (slope S=1).
    pub fn high_shelf(f0: f32, gain_db: f32, sample_rate: f32) -> Self {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = TAU * (f0 / sample_rate).clamp(1e-6, 0.499);
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        // Bristow-Johnson cookbook shelf α with S=1: α = sin(w0)/2 · √2.
        let alpha = sin_w0 * 0.5 * std::f32::consts::SQRT_2;
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

        let a_plus = a + 1.0;
        let a_minus = a - 1.0;

        let a0 = a_plus - a_minus * cos_w0 + two_sqrt_a_alpha;
        let inv_a0 = 1.0 / a0;
        let b0 = (a * (a_plus + a_minus * cos_w0 + two_sqrt_a_alpha)) * inv_a0;
        let b1 = (-2.0 * a * (a_minus + a_plus * cos_w0)) * inv_a0;
        let b2 = (a * (a_plus + a_minus * cos_w0 - two_sqrt_a_alpha)) * inv_a0;
        let a1 = (2.0 * (a_minus - a_plus * cos_w0)) * inv_a0;
        let a2 = (a_plus - a_minus * cos_w0 - two_sqrt_a_alpha) * inv_a0;

        Self {
            b0,
            b1,
            b2,
            a1,
            a2,
            z1: 0.0,
            z2: 0.0,
        }
    }

    /// RBJ low-shelf (slope S=1).
    pub fn low_shelf(f0: f32, gain_db: f32, sample_rate: f32) -> Self {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = TAU * (f0 / sample_rate).clamp(1e-6, 0.499);
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        // Bristow-Johnson cookbook shelf α with S=1: α = sin(w0)/2 · √2.
        let alpha = sin_w0 * 0.5 * std::f32::consts::SQRT_2;
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

        let a_plus = a + 1.0;
        let a_minus = a - 1.0;

        let a0 = a_plus + a_minus * cos_w0 + two_sqrt_a_alpha;
        let inv_a0 = 1.0 / a0;
        let b0 = (a * (a_plus - a_minus * cos_w0 + two_sqrt_a_alpha)) * inv_a0;
        let b1 = (2.0 * a * (a_minus - a_plus * cos_w0)) * inv_a0;
        let b2 = (a * (a_plus - a_minus * cos_w0 - two_sqrt_a_alpha)) * inv_a0;
        let a1 = (-2.0 * (a_minus + a_plus * cos_w0)) * inv_a0;
        let a2 = (a_plus + a_minus * cos_w0 - two_sqrt_a_alpha) * inv_a0;

        Self {
            b0,
            b1,
            b2,
            a1,
            a2,
            z1: 0.0,
            z2: 0.0,
        }
    }
}
