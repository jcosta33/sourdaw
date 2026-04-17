/// Repitch — simple playback rate change without time correction.
///
/// Changes pitch and duration simultaneously by adjusting the playback
/// speed. A ratio of 2.0 doubles the pitch and halves the duration.
/// Uses the voice's existing cubic Hermite interpolation for quality.
///
/// This is the simplest "warp" mode — no spectral processing needed.

/// Compute the playback speed ratio for a given semitone transposition.
pub fn semitones_to_ratio(semitones: f32) -> f64 {
    2.0_f64.powf(semitones as f64 / 12.0)
}

/// Compute the playback speed ratio for a given cent transposition.
pub fn cents_to_ratio(cents: f32) -> f64 {
    2.0_f64.powf(cents as f64 / 1200.0)
}

/// Compute the semitone offset from a speed ratio.
pub fn ratio_to_semitones(ratio: f64) -> f32 {
    (12.0 * ratio.log2()) as f32
}

/// Compute the playback speed to match a target BPM given the original BPM.
///
/// Returns the ratio `target_bpm / original_bpm`.
pub fn bpm_match_ratio(original_bpm: f32, target_bpm: f32) -> f64 {
    if original_bpm <= 0.0 {
        return 1.0;
    }
    target_bpm as f64 / original_bpm as f64
}
