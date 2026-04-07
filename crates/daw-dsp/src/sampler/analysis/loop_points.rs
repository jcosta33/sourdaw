/// Smart Loop Points — automatic zero-crossing detection and crossfade
/// length calculation for click-free loops.
///
/// Scans the waveform to find optimal loop start/end positions that land
/// on zero crossings with similar waveform shape, minimizing click artifacts.

/// Result of smart loop point detection.
#[derive(Debug, Clone)]
pub struct LoopPointResult {
    /// Optimal loop start position (frame index).
    pub start_frame: u32,
    /// Optimal loop end position (frame index).
    pub end_frame: u32,
    /// Recommended crossfade length (samples).
    pub crossfade_length: u32,
    /// Quality score (0.0 = poor match, 1.0 = perfect).
    pub quality: f32,
}

/// Configuration for loop point detection.
#[derive(Debug, Clone)]
pub struct LoopPointConfig {
    /// Minimum loop length in seconds.
    pub min_loop_secs: f32,
    /// Search window size around candidate points (samples).
    pub search_window: usize,
    /// Correlation window for matching loop start/end shape (samples).
    pub correlation_window: usize,
    /// Minimum crossfade length (samples).
    pub min_crossfade: u32,
    /// Maximum crossfade length (samples).
    pub max_crossfade: u32,
}

impl Default for LoopPointConfig {
    fn default() -> Self {
        Self {
            min_loop_secs: 0.1,
            search_window: 512,
            correlation_window: 256,
            min_crossfade: 50,
            max_crossfade: 500,
        }
    }
}

/// Find optimal loop points by locating zero-crossings with similar waveform shape.
///
/// Strategy:
/// 1. Find all zero-crossings in the sample.
/// 2. For candidate loop-end positions (in the second half of the sample),
///    find the best matching loop-start position (in the first half) using
///    normalized cross-correlation of the surrounding waveform.
/// 3. Select the pair with the highest correlation.
/// 4. Calculate crossfade length based on the local waveform period.
pub fn detect_loop_points(
    samples: &[f32],
    sample_rate: u32,
    config: &LoopPointConfig,
) -> Option<LoopPointResult> {
    let min_loop_frames = (config.min_loop_secs * sample_rate as f32) as usize;
    if samples.len() < min_loop_frames * 2 {
        return None;
    }

    // Find zero crossings.
    let crossings = find_zero_crossings(samples);
    if crossings.len() < 4 {
        return None;
    }

    let half = samples.len() / 2;
    let corr_win = config.correlation_window;

    let mut best_quality = -1.0f32;
    let mut best_start = 0u32;
    let mut best_end = 0u32;

    // Candidate loop-end positions: zero crossings in the second half.
    for &end_pos in &crossings {
        if end_pos < half || end_pos + corr_win >= samples.len() {
            continue;
        }

        // Search for best matching loop-start position.
        for &start_pos in &crossings {
            if start_pos + corr_win >= half {
                break;
            }
            if end_pos - start_pos < min_loop_frames {
                continue;
            }

            // Normalized cross-correlation between waveform shapes.
            let quality = normalized_correlation(
                &samples[start_pos..start_pos + corr_win],
                &samples[end_pos..end_pos + corr_win],
            );

            if quality > best_quality {
                best_quality = quality;
                best_start = start_pos as u32;
                best_end = end_pos as u32;
            }
        }
    }

    if best_quality < 0.0 {
        return None;
    }

    // Calculate crossfade length based on local zero-crossing period.
    let local_period = estimate_local_period(samples, best_end as usize, config.search_window);
    let crossfade = (local_period as u32).clamp(config.min_crossfade, config.max_crossfade);

    Some(LoopPointResult {
        start_frame: best_start,
        end_frame: best_end,
        crossfade_length: crossfade,
        quality: best_quality,
    })
}

/// Find all positive-going zero crossings in the sample.
fn find_zero_crossings(samples: &[f32]) -> Vec<usize> {
    let mut crossings = Vec::new();
    for i in 0..samples.len() - 1 {
        // Positive-going zero crossing.
        if samples[i] <= 0.0 && samples[i + 1] > 0.0 {
            crossings.push(i + 1);
        }
    }
    crossings
}

/// Normalized cross-correlation between two equal-length slices.
/// Returns a value between -1.0 (inverse) and 1.0 (perfect match).
fn normalized_correlation(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    if n == 0 {
        return 0.0;
    }

    let mut sum_ab = 0.0f32;
    let mut sum_aa = 0.0f32;
    let mut sum_bb = 0.0f32;

    for i in 0..n {
        sum_ab += a[i] * b[i];
        sum_aa += a[i] * a[i];
        sum_bb += b[i] * b[i];
    }

    let denom = (sum_aa * sum_bb).sqrt();
    if denom < 1e-10 {
        return 0.0;
    }

    sum_ab / denom
}

/// Estimate the local waveform period by finding the distance between
/// zero crossings near a given position.
fn estimate_local_period(samples: &[f32], position: usize, window: usize) -> usize {
    let start = position.saturating_sub(window);
    let end = (position + window).min(samples.len() - 1);

    let mut prev_crossing = None;
    let mut periods = Vec::new();

    for i in start..end {
        if i + 1 >= samples.len() {
            break;
        }
        if samples[i] <= 0.0 && samples[i + 1] > 0.0 {
            if let Some(prev) = prev_crossing {
                periods.push(i - prev);
            }
            prev_crossing = Some(i);
        }
    }

    if periods.is_empty() {
        return 128; // Fallback default
    }

    // Return median period.
    periods.sort_unstable();
    periods[periods.len() / 2]
}
