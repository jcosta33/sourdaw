//! Linear-amplitude → dB conversion laws shared across device families.

/// Smallest linear amplitude the dB meters convert. Below it a reading is
/// noise-floor territory: 20·log10 of anything this small is a meaningless
/// several-hundred-minus-dB figure, so every meter reports the silence floor
/// (`crate::proof::metering::SILENCE_DB`) instead. The peak/RMS meters of
/// proof, crust, gluten, and the detector paths all gate on this one bound.
pub const LINEAR_TO_DB_FLOOR: f32 = 1e-10;
