//! dB ↔ linear-amplitude conversion laws shared across device families.

/// Smallest linear amplitude the dB meters convert. Below it a reading is
/// noise-floor territory: 20·log10 of anything this small is a meaningless
/// several-hundred-minus-dB figure, so every meter reports the silence floor
/// (`crate::proof::metering::SILENCE_DB`) instead. The amplitude-domain
/// floors of proof, crust, gluten, and the detector paths all gate on this
/// one bound; the RMS taps work in mean-square and gate on a `1e-20` floor
/// there instead (`gluten/detector.rs`, `proof/metering.rs`).
pub const LINEAR_TO_DB_FLOOR: f32 = 1e-10;

/// Decibels to a linear amplitude multiplier, `10^(dB/20)`.
///
/// No floor: `-inf` dB is exactly `0.0` and NaN stays NaN, so a caller that
/// needs a silence floor or input validation applies it itself. Gluten's
/// detector path keeps its own `exp2` form (`gluten::gain_computer`), which
/// is a different float evaluation and does not round to the same bits.
#[inline]
pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each point must reproduce the expression the device copies used before
    /// they were merged, bit for bit — the shared law may not move any output.
    #[test]
    fn db_to_linear_matches_the_powf_law_bit_for_bit_at_edge_points() {
        let points = [
            6.0_f32,
            0.0,
            -0.3,
            -60.0,
            -120.0,
            -200.0,
            f32::NEG_INFINITY,
            f32::NAN,
        ];
        for db in points {
            let expected = 10.0_f32.powf(db / 20.0);
            assert_eq!(
                db_to_linear(db).to_bits(),
                expected.to_bits(),
                "db_to_linear({db}) moved off the powf law"
            );
        }
    }

    #[test]
    fn db_to_linear_has_no_floor_at_minus_infinity_and_propagates_nan() {
        assert_eq!(db_to_linear(f32::NEG_INFINITY).to_bits(), 0.0_f32.to_bits());
        assert!(db_to_linear(f32::NAN).is_nan());
        assert_eq!(db_to_linear(0.0), 1.0);
        assert_eq!(db_to_linear(-200.0).to_bits(), 0x2edb_e6ff);
    }
}
