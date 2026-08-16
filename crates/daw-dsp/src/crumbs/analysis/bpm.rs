/// BPM estimation using autocorrelation of the onset strength signal.
///
/// Implements a simplified Percival-Tzanetakis approach:
///   1. Compute onset detection function (spectral flux)
///   2. Apply generalized autocorrelation (GAC)
///   3. Find the dominant periodicity in the BPM range
///   4. Refine with parabolic interpolation
use super::onset::{detect_superflux, OnsetConfig};

// ── Constants ──────────────────────────────────────────────────────────

const MIN_BPM: f32 = 60.0;
const MAX_BPM: f32 = 200.0;

// ── Result ─────────────────────────────────────────────────────────────

/// Result of BPM estimation.
#[derive(Debug, Clone, Copy)]
pub struct BpmResult {
    /// Estimated BPM, if detected.
    pub bpm: Option<f32>,
    /// Confidence (0.0–1.0) — strength of the dominant periodicity.
    pub confidence: f32,
}

// ── Detection ──────────────────────────────────────────────────────────

/// Estimate the BPM of an audio sample.
///
/// Uses spectral flux onset detection followed by autocorrelation
/// to find the dominant rhythmic periodicity.
pub fn estimate_bpm(samples: &[f32], sample_rate: u32) -> BpmResult {
    let config = OnsetConfig {
        sample_rate,
        ..OnsetConfig::default()
    };

    // Step 1: Get the onset detection function.
    let onset_result = detect_superflux(samples, &config);
    let odf = &onset_result.odf;

    if odf.len() < 4 {
        return BpmResult {
            bpm: None,
            confidence: 0.0,
        };
    }

    // ODF frame rate (frames per second).
    let odf_fps = sample_rate as f32 / config.hop_size as f32;

    // Step 2: Compute autocorrelation over the BPM range.
    let min_lag = (odf_fps * 60.0 / MAX_BPM).floor() as usize;
    let max_lag = (odf_fps * 60.0 / MIN_BPM).ceil() as usize;
    let max_lag = max_lag.min(odf.len() / 2);

    if min_lag >= max_lag || max_lag >= odf.len() {
        return BpmResult {
            bpm: None,
            confidence: 0.0,
        };
    }

    // Normalize ODF (subtract mean, divide by std).
    let mean = odf.iter().sum::<f32>() / odf.len() as f32;
    let variance = odf.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / odf.len() as f32;
    let std_dev = variance.sqrt().max(1e-10);

    let normalized: Vec<f32> = odf.iter().map(|v| (v - mean) / std_dev).collect();

    // Step 3: Autocorrelation for each lag in [min_lag, max_lag].
    let mut acf = vec![0.0f32; max_lag + 1];
    let acf_len = normalized.len();

    for lag in min_lag..=max_lag {
        let mut sum = 0.0f32;
        let overlap = acf_len - lag;
        for idx in 0..overlap {
            sum += normalized[idx] * normalized[idx + lag];
        }
        acf[lag] = sum / overlap as f32;
    }

    // Step 4: Find the peak in the autocorrelation.
    let mut best_lag = min_lag;
    let mut best_val = acf[min_lag];

    // Inclusive of `max_lag`: the ACF is filled over `min_lag..=max_lag`, and an
    // exclusive scan here made the slowest detectable tempo — `MIN_BPM` exactly,
    // which is what `max_lag` was derived from — unreachable. A loop at that
    // tempo reported the strongest lag inside the scanned range instead, i.e.
    // some faster harmonic of itself.
    for lag in (min_lag + 1)..=max_lag {
        if acf[lag] > best_val {
            best_val = acf[lag];
            best_lag = lag;
        }
    }

    if best_val <= 0.0 {
        return BpmResult {
            bpm: None,
            confidence: 0.0,
        };
    }

    // Step 5: Parabolic interpolation for sub-frame precision.
    let refined_lag = if best_lag > min_lag && best_lag < max_lag {
        let alpha = acf[best_lag - 1];
        let beta = acf[best_lag];
        let gamma = acf[best_lag + 1];
        let denom = 2.0 * (2.0 * beta - alpha - gamma);
        if denom.abs() > 1e-10 {
            // A true parabolic vertex around a sampled maximum lies within half
            // a lag of it; anything larger means the three points are nearly
            // collinear and the offset is noise, and an unbounded offset would
            // make the clamped conversion below report a confident garbage
            // tempo.
            let offset = ((alpha - gamma) / denom).clamp(-0.5, 0.5);
            best_lag as f32 + offset
        } else {
            best_lag as f32
        }
    } else {
        best_lag as f32
    };

    // The lag bounds are `floor`/`ceil` quantizations of the tempo range, so a
    // peak at a boundary lag can convert to a tempo a rounding error outside
    // [MIN_BPM, MAX_BPM] — e.g. at 48 kHz the 60 BPM lag is fractional,
    // `max_lag` is its ceiling, and the raw conversion lands just under
    // 60. Every scanned lag is inside the tempo range by construction, so the
    // conversion clamps instead of discarding: rejecting here turned "slowest
    // tempo in range" into `None` at every sample rate where the boundary lag
    // is not an integer.
    let bpm = (60.0 * odf_fps / refined_lag).clamp(MIN_BPM, MAX_BPM);

    // Confidence: normalized autocorrelation peak value.
    let confidence = best_val.clamp(0.0, 1.0);

    BpmResult {
        bpm: Some(bpm),
        confidence,
    }
}
