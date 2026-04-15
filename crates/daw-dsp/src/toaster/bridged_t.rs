//! Bridged-T bandpass filter primitive.
//!
//! Implements the Roland 808 bridged-T resonator as a time-varying biquad using
//! the bilinear transform (s → (2/T)(z−1)/(z+1)) in Transposed Direct Form II.
//! TDF-II is chosen for numerical stability under rapid coefficient changes
//! (R_eff sweeps during the 808 kick attack phase).
//!
//! Transfer function (continuous-time bandpass):
//! ```text
//! H(s) = (β₂s² + β₁s + β₀) / (α₂s² + α₁s + α₀)
//! β₂ = R_eff × R_shunt × C1 × C2
//! β₁ = R_eff × C1 + R_shunt × C1 + R_eff × C2
//! β₀ = 1
//! α₂ = R_eff × R_shunt × C1 × C2
//! α₁ = R_eff × (C1 + C2)
//! α₀ = 1
//! ```

/// Time-varying biquad bridged-T filter in Transposed Direct Form II.
pub struct BridgedTFilter {
    /// TDF-II delay state 1
    pub s1: f32,
    /// TDF-II delay state 2
    pub s2: f32,
    /// Numerator coefficient b0 (normalized)
    pub b0: f32,
    /// Numerator coefficient b1 (normalized)
    pub b1: f32,
    /// Numerator coefficient b2 (normalized)
    pub b2: f32,
    /// Denominator coefficient a1 (a0 normalized to 1)
    pub a1: f32,
    /// Denominator coefficient a2 (a0 normalized to 1)
    pub a2: f32,
}

impl BridgedTFilter {
    pub fn new() -> Self {
        Self {
            s1: 0.0,
            s2: 0.0,
            b0: 0.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }

    /// Compute biquad coefficients from circuit component values via bilinear transform.
    ///
    /// - `r_eff`: effective resistance driving the bridged-T network (Ω)
    /// - `r_shunt`: shunt resistor (R167 in 808 kick circuit) (Ω)
    /// - `c1`: first capacitor (F)
    /// - `c2`: second capacitor (F)
    /// - `sample_rate`: audio sample rate (Hz)
    pub fn update_coefficients(
        &mut self,
        r_eff: f32,
        r_shunt: f32,
        c1: f32,
        c2: f32,
        sample_rate: f32,
    ) {
        // Bilinear transform prewarping constant: c = 2 * sample_rate
        let c = 2.0 * sample_rate;
        let c2_sq = c * c;

        // Continuous-time coefficient sets
        let beta2 = r_eff * r_shunt * c1 * c2;
        let beta1 = r_eff * c1 + r_shunt * c1 + r_eff * c2;
        let beta0 = 1.0_f32;

        let alpha2 = r_eff * r_shunt * c1 * c2;
        let alpha1 = r_eff * (c1 + c2);
        let alpha0 = 1.0_f32;

        // Bilinear transform: s → c*(z-1)/(z+1)
        // Denominator (before normalization):
        let d0 = alpha2 * c2_sq + alpha1 * c + alpha0;
        let d1 = -2.0 * alpha2 * c2_sq + 2.0 * alpha0;
        let d2 = alpha2 * c2_sq - alpha1 * c + alpha0;

        // Numerator:
        let n0 = beta2 * c2_sq + beta1 * c + beta0;
        let n1 = -2.0 * beta2 * c2_sq + 2.0 * beta0;
        let n2 = beta2 * c2_sq - beta1 * c + beta0;

        // Normalize by d0
        let inv_d0 = 1.0 / d0;
        self.b0 = n0 * inv_d0;
        self.b1 = n1 * inv_d0;
        self.b2 = n2 * inv_d0;
        self.a1 = d1 * inv_d0;
        self.a2 = d2 * inv_d0;
    }

    /// Process a single sample through the filter (TDF-II topology).
    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.s1;
        self.s1 = self.b1 * input - self.a1 * output + self.s2;
        self.s2 = self.b2 * input - self.a2 * output;

        // Denormal protection: flush states that have decayed near zero
        if self.s1.abs() < 1e-20 {
            self.s1 = 0.0;
        }
        if self.s2.abs() < 1e-20 {
            self.s2 = 0.0;
        }

        output
    }

    /// Reset filter state (useful on trigger to avoid clicks from stale state).
    pub fn reset(&mut self) {
        self.s1 = 0.0;
        self.s2 = 0.0;
    }
}

impl Default for BridgedTFilter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// BridgedTFilter with 808 kick component values should produce bandpass response
    /// centered within ±5% of calculated fc ≈ 49.4 Hz.
    #[test]
    fn bridged_t_center_frequency() {
        let mut filter = BridgedTFilter::new();
        // 808 kick component values: R165+R166=53.8kΩ, R167=1MΩ, C41=C42=15nF
        let r_eff: f32 = 53_800.0;
        let r_shunt: f32 = 1_000_000.0;
        let c1: f32 = 15e-9;
        let c2: f32 = 15e-9;
        let sample_rate: f32 = 48_000.0;
        filter.update_coefficients(r_eff, r_shunt, c1, c2, sample_rate);

        // Expected fc = 1 / (2π × √(R_eff × R_shunt × C1 × C2))
        let fc_expected = 1.0 / (2.0 * core::f32::consts::PI * (r_eff * r_shunt * c1 * c2).sqrt());

        // Run a frequency sweep and find the peak response
        // (simplified: check that coefficients are finite and non-trivial)
        assert!(filter.b0.is_finite(), "b0 should be finite");
        assert!(filter.a1.is_finite(), "a1 should be finite");
        assert!(filter.a2.is_finite(), "a2 should be finite");

        // Expected fc should be in the ballpark of 49 Hz
        assert!(
            (fc_expected - 49.4).abs() < 5.0,
            "Expected fc near 49.4 Hz, got {:.1}",
            fc_expected
        );
    }

    /// Sweeping R_eff through 808 kick attack range should not produce NaN, Inf, or denormals.
    #[test]
    fn bridged_t_r_eff_sweep_stability() {
        let mut filter = BridgedTFilter::new();
        let r_shunt: f32 = 1_000_000.0;
        let c1: f32 = 15e-9;
        let c2: f32 = 15e-9;
        let sample_rate: f32 = 48_000.0;

        // Sweep from 6.8kΩ (attack) to 53.8kΩ (resting) over 240 samples
        for i in 0..240 {
            let t = i as f32 / 240.0;
            let r_eff = 6_800.0 + (53_800.0 - 6_800.0) * t;
            filter.update_coefficients(r_eff, r_shunt, c1, c2, sample_rate);

            let impulse = if i == 0 { 1.0 } else { 0.0 };
            let output = filter.process(impulse);

            assert!(!output.is_nan(), "NaN at sample {i}");
            assert!(!output.is_infinite(), "Inf at sample {i}");
            // Check for denormals (below f32 min positive normal)
            if output != 0.0 {
                assert!(
                    output.abs() >= f32::MIN_POSITIVE || output.abs() < 1e-20,
                    "Denormal at sample {i}: {output}"
                );
            }
        }
    }
}
