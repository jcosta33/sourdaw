//! µ-law (mu-law) companding codec.
//!
//! Models the LinnDrum's AM6070 µ-law companding DAC.
//! µ-255 law expansion produces warmer low-level detail than linear 8-bit quantization.
//! Effective dynamic range: ~72–78 dB (equivalent to 12–13 linear bits).

/// µ-255 law expansion: convert compressed 8-bit value to linear float in [-1, 1].
///
/// The sign bit is bit 7 of the compressed byte.
/// Magnitude is bits 0..6.
pub fn mu_law_expand(compressed: u8) -> f32 {
    let mu: f32 = 255.0;
    let sign = if compressed & 0x80 != 0 {
        -1.0_f32
    } else {
        1.0
    };
    let magnitude = (compressed & 0x7F) as f32 / 127.0;
    sign * (1.0 / mu) * ((1.0 + mu).powf(magnitude) - 1.0)
}

/// µ-255 law compression: convert linear float in [-1, 1] to compressed 8-bit value.
///
/// Inverse of `mu_law_expand`.
pub fn mu_law_compress(linear: f32) -> u8 {
    let mu: f32 = 255.0;
    let x = linear.clamp(-1.0, 1.0);
    let sign_bit: u8 = if x < 0.0 { 0x80 } else { 0x00 };
    let magnitude = (mu * x.abs()).ln_1p() / (1.0 + mu).ln();
    let encoded = (magnitude * 127.0).round() as u8;
    sign_bit | encoded.min(0x7F)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// mu_law_expand(0x00) should be close to 0.0.
    #[test]
    fn mu_law_zero_maps_to_zero() {
        let v = mu_law_expand(0x00);
        assert!(v.abs() < 0.01, "mu_law_expand(0x00) = {v}, expected ≈ 0.0");
    }

    /// mu_law_expand(0x7F) should be close to +full-scale.
    #[test]
    fn mu_law_max_positive_maps_to_full_scale() {
        let v = mu_law_expand(0x7F);
        assert!(
            (v - 1.0).abs() < 0.01,
            "mu_law_expand(0x7F) = {v:.4}, expected ≈ 1.0"
        );
    }

    /// mu_law_expand(0xFF) should be close to −full-scale.
    #[test]
    fn mu_law_max_negative_maps_to_neg_full_scale() {
        let v = mu_law_expand(0xFF);
        assert!(
            (v + 1.0).abs() < 0.01,
            "mu_law_expand(0xFF) = {v:.4}, expected ≈ -1.0"
        );
    }

    /// mu_law_expand should produce monotonically increasing output for monotonically
    /// increasing magnitude (i.e., for 0x00..=0x7F).
    #[test]
    fn mu_law_expand_is_monotonic() {
        let mut prev = mu_law_expand(0x00);
        for i in 1u8..=0x7F {
            let v = mu_law_expand(i);
            assert!(
                v >= prev,
                "mu_law_expand not monotonic at {i}: {v:.6} < {prev:.6}"
            );
            prev = v;
        }
    }

    /// Compress then expand should round-trip within quantization noise.
    #[test]
    fn mu_law_round_trip() {
        let test_values = [0.0_f32, 0.1, 0.5, 0.9, 1.0, -0.1, -0.5, -1.0];
        for &v in &test_values {
            let compressed = mu_law_compress(v);
            let expanded = mu_law_expand(compressed);
            // Round-trip error should be within one quantization step
            // µ-law has 127 steps per sign, so max error ≈ 1/127 ≈ 0.008
            let error = (v - expanded).abs();
            assert!(
                error < 0.02,
                "Round-trip error {error:.4} for input {v}: compressed={compressed:#04x}, expanded={expanded:.4}"
            );
        }
    }

    /// µ-law expanded values should have better resolution at low levels than linear 8-bit.
    /// At a value of 0.01, µ-law resolution should be ~16× finer than linear 8-bit.
    #[test]
    fn mu_law_better_low_level_resolution() {
        // Near zero, µ-law steps are much smaller than linear steps
        let v0 = mu_law_expand(0x00);
        let v1 = mu_law_expand(0x01);
        let mu_step = v1 - v0;

        // Linear 8-bit step (unsigned, 256 levels)
        let linear_step = 2.0 / 255.0_f32; // ≈ 0.0078

        // µ-law near-zero step should be much smaller than linear 8-bit
        assert!(
            mu_step < linear_step * 0.1,
            "µ-law step {mu_step:.6} should be much smaller than linear 8-bit step {linear_step:.4}"
        );
    }
}
