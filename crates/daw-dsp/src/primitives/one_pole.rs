//! Time constant → one-pole coefficient.
//!
//! A one-pole smoother `y += (1 - p)·(x - y)` with pole `p = e^(-1/n)` covers
//! `1 - 1/e` (≈63%) of a step in `n` samples. These functions compute only
//! that pole. Every device decides for itself what a zero, negative, NaN or
//! sub-sample time means — clamp it, snap instantly, freeze, or use the
//! complement `1 - p` — and does so visibly at its own call site, because the
//! copies these replaced disagree there and merging the edges would move
//! their output.

/// Pole for a time constant of `samples` samples: `e^(-1/samples)`.
///
/// Unguarded: `0` gives `0.0`, a negative count gives a pole above 1, NaN
/// stays NaN.
#[inline]
pub fn pole_from_samples(samples: f32) -> f32 {
    (-1.0 / samples).exp()
}

/// Pole for a time constant of `ms` milliseconds at `sample_rate`.
///
/// Evaluates `ms * 0.001 * sample_rate` as one left-to-right product before
/// the reciprocal, which is the operation order the device copies used; a
/// seconds-based caller must not route through here by scaling to
/// milliseconds first, because `(s * 1000) * 0.001 * sr` does not round to
/// `s * sr`.
#[inline]
pub fn pole_from_ms(ms: f32, sample_rate: f32) -> f32 {
    pole_from_samples(ms * 0.001 * sample_rate)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RATE: f32 = 48_000.0;

    const MS_POINTS: [f32; 9] = [-1.0, 0.0, 0.005, 0.01, 0.1, 1.0, 5.0, 200.0, f32::NAN];

    /// The expression every millisecond-based device copy evaluated.
    fn original_ms_pole(ms: f32, sample_rate: f32) -> f32 {
        (-1.0 / (ms * 0.001 * sample_rate)).exp()
    }

    #[test]
    fn pole_from_ms_matches_the_device_expression_bit_for_bit_at_edge_points() {
        for sample_rate in [SAMPLE_RATE, 44_100.0, 96_000.0] {
            for ms in MS_POINTS {
                assert_eq!(
                    pole_from_ms(ms, sample_rate).to_bits(),
                    original_ms_pole(ms, sample_rate).to_bits(),
                    "pole_from_ms({ms}, {sample_rate}) moved off the device expression"
                );
            }
        }
    }

    #[test]
    fn pole_from_samples_matches_the_seconds_expression_bit_for_bit() {
        for seconds in [1.0e-5_f32, 1.0 / 48_000.0, 0.001, 0.01, 0.3] {
            let samples = seconds * SAMPLE_RATE;
            assert_eq!(
                pole_from_samples(samples).to_bits(),
                (-1.0 / samples).exp().to_bits(),
                "pole_from_samples({samples}) moved off the device expression"
            );
        }
    }

    /// Pins measured pole bits at 48 kHz, so an edit that moves the evaluation
    /// fails here even if it changes the reference expression above in the
    /// same way.
    #[test]
    fn pole_values_at_48k_are_pinned() {
        assert_eq!(pole_from_ms(0.01, SAMPLE_RATE).to_bits(), 0x3dff_0173);
        assert_eq!(pole_from_ms(0.005, SAMPLE_RATE).to_bits(), 0x3c7e_03e3);
        assert_eq!(pole_from_ms(5.0, SAMPLE_RATE).to_bits(), 0x3f7e_ef80);
        assert_eq!(pole_from_ms(200.0, SAMPLE_RATE).to_bits(), 0x3f7f_f92c);
        assert_eq!(pole_from_ms(0.0, SAMPLE_RATE), 0.0);
        assert!(pole_from_ms(-1.0, SAMPLE_RATE) > 1.0);
        assert!(pole_from_ms(f32::NAN, SAMPLE_RATE).is_nan());
        assert_eq!(
            (1.0 - pole_from_samples(0.001 * SAMPLE_RATE)).to_bits(),
            0x3ca8_e6c0
        );
    }

    /// `0.001 * sample_rate` rounds up at both rates (48 kHz gives
    /// 48.000004), so grouping the product as `ms * (0.001 * sample_rate)`
    /// lands one ulp away from the left-to-right `(ms * 0.001) * sample_rate`
    /// at these points. The values were found by search; most points agree
    /// under either grouping, which is why the pins above do not catch it.
    #[test]
    fn pole_from_ms_keeps_the_left_to_right_product_order() {
        // Regrouped, these give 0x3f6da4cd and 0x3f7a7a8c.
        assert_eq!(pole_from_ms(0.28, SAMPLE_RATE).to_bits(), 0x3f6d_a4cc);
        assert_eq!(pole_from_ms(1.04, 44_100.0).to_bits(), 0x3f7a_7a8b);
    }
}
