//! Shared biquad filter — used across EQ, crossovers, and sidechain filters.
//! RBJ Audio EQ Cookbook coefficients. f64 for coefficient computation, f32 for processing.

use crate::primitives::flush_denormal;
use core::f64::consts::PI;

#[derive(Clone)]
pub struct BiquadCoeffs {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
}

impl BiquadCoeffs {
    pub fn unity() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }

    pub fn peak(freq: f64, gain_db: f64, q: f64, sr: f64) -> Self {
        let a = 10.0_f64.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let a0 = 1.0 + alpha / a;
        Self::normalize(
            1.0 + alpha * a,
            -2.0 * w0.cos(),
            1.0 - alpha * a,
            a0,
            -2.0 * w0.cos(),
            1.0 - alpha / a,
        )
    }

    pub fn low_shelf(freq: f64, gain_db: f64, q: f64, sr: f64) -> Self {
        let a = 10.0_f64.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
        Self::normalize(
            a * ((a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha),
            2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0),
            a * ((a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha),
            (a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha,
            -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0),
            (a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha,
        )
    }

    pub fn high_shelf(freq: f64, gain_db: f64, q: f64, sr: f64) -> Self {
        let a = 10.0_f64.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
        Self::normalize(
            a * ((a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0),
            a * ((a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha),
            (a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha,
            2.0 * ((a - 1.0) - (a + 1.0) * cos_w0),
            (a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha,
        )
    }

    pub fn lowpass(freq: f64, q: f64, sr: f64) -> Self {
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        Self::normalize(
            (1.0 - cos_w0) / 2.0,
            1.0 - cos_w0,
            (1.0 - cos_w0) / 2.0,
            1.0 + alpha,
            -2.0 * cos_w0,
            1.0 - alpha,
        )
    }

    pub fn highpass(freq: f64, q: f64, sr: f64) -> Self {
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        Self::normalize(
            (1.0 + cos_w0) / 2.0,
            -(1.0 + cos_w0),
            (1.0 + cos_w0) / 2.0,
            1.0 + alpha,
            -2.0 * cos_w0,
            1.0 - alpha,
        )
    }

    pub fn bandpass(freq: f64, q: f64, sr: f64) -> Self {
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        Self::normalize(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos_w0, 1.0 - alpha)
    }

    fn normalize(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Self {
        let inv = 1.0 / a0;
        Self {
            b0: (b0 * inv) as f32,
            b1: (b1 * inv) as f32,
            b2: (b2 * inv) as f32,
            a1: (a1 * inv) as f32,
            a2: (a2 * inv) as f32,
        }
    }
}

#[derive(Clone)]
pub struct BiquadState {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl BiquadState {
    pub fn new() -> Self {
        Self {
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    #[inline]
    pub fn process(&mut self, input: f32, c: &BiquadCoeffs) -> f32 {
        let raw = c.b0 * input + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
        // DSP-2: the recursive y-state decays geometrically into the subnormal
        // range once input goes silent. Flushing `raw` once keeps both the
        // stored state and the returned sample out of microcode-trap territory.
        let out = flush_denormal(raw);
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = out;
        out
    }

    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

#[cfg(test)]
mod denormal_tests {
    use super::{BiquadCoeffs, BiquadState};

    /// Unguarded Direct-Form-I recursion — what `BiquadState::process` was
    /// before DSP-2. Kept in the test so the failure mode is demonstrated, not
    /// asserted from memory.
    #[derive(Default)]
    struct UnguardedDf1 {
        x1: f32,
        x2: f32,
        y1: f32,
        y2: f32,
    }

    impl UnguardedDf1 {
        fn process(&mut self, input: f32, c: &BiquadCoeffs) -> f32 {
            let out =
                c.b0 * input + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
            self.x2 = self.x1;
            self.x1 = input;
            self.y2 = self.y1;
            self.y1 = out;
            out
        }
    }

    fn ringing_coeffs() -> BiquadCoeffs {
        BiquadCoeffs::lowpass(2_000.0, 4.0, 48_000.0)
    }

    const SILENT_TAIL: usize = 60_000;

    #[test]
    fn unguarded_feedback_state_decays_into_the_subnormal_range() {
        let coeffs = ringing_coeffs();
        let mut unguarded = UnguardedDf1::default();
        unguarded.process(1.0, &coeffs);

        let mut first_subnormal = None;
        for _ in 0..SILENT_TAIL {
            let out = unguarded.process(0.0, &coeffs);
            if out != 0.0 && !out.is_normal() && first_subnormal.is_none() {
                first_subnormal = Some(out);
            }
        }

        let value = first_subnormal.expect(
            "an unguarded IIR fed to silence must land in the subnormal range — \
             if this stops happening the guard below is testing nothing",
        );
        assert!(
            value.abs() < f32::MIN_POSITIVE,
            "raw unguarded state {value:e} must be below the normal boundary {:e}",
            f32::MIN_POSITIVE
        );
        assert!(value != 0.0, "raw unguarded state must be a nonzero subnormal");
        assert!(
            !unguarded.y1.is_normal(),
            "the stored state itself ends subnormal, not just one output sample"
        );
    }

    #[test]
    fn guarded_feedback_state_flushes_to_exact_zero() {
        let coeffs = ringing_coeffs();
        let mut guarded = BiquadState::new();
        guarded.process(1.0, &coeffs);

        for _ in 0..SILENT_TAIL {
            let out = guarded.process(0.0, &coeffs);
            assert!(
                out == 0.0 || out.is_normal(),
                "guarded output {out:e} must never be subnormal"
            );
        }

        assert_eq!(guarded.y1, 0.0, "recursive state must reach exact zero");
        assert_eq!(guarded.y2, 0.0);
    }

    #[test]
    fn guard_is_bit_exact_while_the_signal_stays_in_normal_range() {
        // Transparency companion to the #732 sanitize guard: for every sample
        // where the unguarded reference is still normal, guarded output must
        // match it bit for bit.
        let coeffs = ringing_coeffs();
        let mut guarded = BiquadState::new();
        let mut unguarded = UnguardedDf1::default();

        let mut compared = 0;
        for index in 0..SILENT_TAIL {
            let input = if index == 0 { 1.0 } else { 0.0 };
            let reference = unguarded.process(input, &coeffs);
            let actual = guarded.process(input, &coeffs);
            if reference == 0.0 || reference.is_normal() {
                assert_eq!(
                    actual.to_bits(),
                    reference.to_bits(),
                    "sample {index} diverged while still in normal range"
                );
                compared += 1;
            } else {
                break;
            }
        }

        assert!(
            compared > 100,
            "expected a long normal-range run to compare, got {compared} samples"
        );
    }
}
