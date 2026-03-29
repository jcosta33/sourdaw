//! Gain computer — core static characteristic shared by all topologies.
//! Implements the Giannoulis/Massberg/Reiss soft-knee algorithm.

/// Compute gain reduction in dB given input level in dB.
/// Returns a value <= 0 (negative = more compression).
#[inline]
pub fn gain_computer(x_db: f32, threshold: f32, ratio: f32, knee_width: f32) -> f32 {
    let slope = 1.0 - 1.0 / ratio;
    let half_w = knee_width / 2.0;
    let overshoot = x_db - threshold;

    if overshoot <= -half_w {
        // Below knee: no compression
        0.0
    } else if overshoot >= half_w {
        // Above knee: full compression
        -slope * overshoot
    } else {
        // In knee: quadratic interpolation
        -0.5 * slope * (overshoot + half_w) * (overshoot + half_w) / knee_width
    }
}

/// Apply range limit — cap maximum gain reduction.
#[inline]
pub fn apply_range(gr_db: f32, range_db: f32) -> f32 {
    // range_db is positive (e.g. 15.0 = max 15 dB reduction)
    gr_db.max(-range_db)
}

/// Auto-makeup gain (half-compensation method).
#[inline]
pub fn auto_makeup(threshold: f32, ratio: f32) -> f32 {
    let gr_at_0 = (0.0 - threshold).max(0.0) * (1.0 - 1.0 / ratio);
    gr_at_0 / 2.0
}

/// Fast dB to linear conversion using exp2 approximation.
#[inline]
pub fn db_to_linear(db: f32) -> f32 {
    // 10^(db/20) = 2^(db * log2(10)/20) = 2^(db * 0.16609...)
    (db * 0.16609640474436813_f32).exp2()
}

/// Fast linear to dB.
#[inline]
pub fn linear_to_db(linear: f32) -> f32 {
    if linear < 1e-10 {
        -100.0
    } else {
        20.0 * linear.log10()
    }
}
