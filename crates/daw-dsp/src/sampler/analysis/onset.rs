/// Onset detection algorithms: SuperFlux (universal), HFC (percussive),
/// and Complex Domain (melodic).
///
/// All operate on STFT frames computed from overlapping windows.
/// The output is an onset strength signal (ODF — onset detection function),
/// which is then peak-picked to find onset positions.
///
/// SuperFlux (Böck & Widmer, 2013): Spectral flux with maximum filter for
/// vibrato robustness. Universal — works well on all content types.
///
/// HFC (High-Frequency Content): Weights higher bins more heavily, making it
/// responsive to percussive transients with high-frequency energy.
///
/// Complex Domain (Duxbury et al., 2003): Combines magnitude and phase
/// deviation, making it sensitive to both tonal and transient onsets.
/// Best for melodic content.
use std::f32::consts::PI;

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_FFT_SIZE: usize = 1024;
const DEFAULT_HOP_SIZE: usize = 441; // ~10ms at 44100Hz
const MAX_FILTER_WIDTH: usize = 3;

// ── Onset Detection Function (ODF) ────────────────────────────────────

/// Result of onset detection: frame indices where onsets were found.
#[derive(Debug, Clone)]
pub struct OnsetResult {
    /// Frame indices (in source samples) where onsets were detected.
    pub positions: Vec<u32>,
    /// The raw onset detection function (one value per STFT frame).
    pub odf: Vec<f32>,
    /// Hop size used (for converting frame indices to time).
    pub hop_size: usize,
}

/// Configuration for onset detection.
#[derive(Debug, Clone)]
pub struct OnsetConfig {
    pub fft_size: usize,
    pub hop_size: usize,
    pub sample_rate: u32,
    /// Adaptive threshold: number of past frames to average.
    pub pre_avg: usize,
    /// Adaptive threshold: number of future frames to average.
    pub post_avg: usize,
    /// Threshold multiplier (higher = fewer onsets).
    pub threshold: f32,
    /// Minimum interval between onsets (seconds).
    pub min_interval_secs: f32,
    /// Zero-crossing snap window (samples). Onsets snap to nearest zero-crossing.
    pub zc_snap_window: usize,
}

impl Default for OnsetConfig {
    fn default() -> Self {
        Self {
            fft_size: DEFAULT_FFT_SIZE,
            hop_size: DEFAULT_HOP_SIZE,
            sample_rate: 44100,
            pre_avg: 12,
            post_avg: 6,
            threshold: 1.5,
            min_interval_secs: 0.03,
            zc_snap_window: 25,
        }
    }
}

// ── SuperFlux ──────────────────────────────────────────────────────────

/// SuperFlux onset detection — robust against vibrato.
///
/// Computes spectral flux between consecutive STFT frames, using a
/// maximum filter over frequency bins to suppress vibrato-induced
/// spectral movement.
pub fn detect_superflux(samples: &[f32], config: &OnsetConfig) -> OnsetResult {
    let spectrogram = compute_magnitude_spectrogram(samples, config.fft_size, config.hop_size);
    let num_frames = spectrogram.len();
    let num_bins = config.fft_size / 2 + 1;

    if num_frames < 2 {
        return OnsetResult {
            positions: vec![],
            odf: vec![],
            hop_size: config.hop_size,
        };
    }

    // Compute SuperFlux ODF
    let mut odf = Vec::with_capacity(num_frames);
    odf.push(0.0); // First frame has no predecessor.

    for frame_idx in 1..num_frames {
        let prev = &spectrogram[frame_idx - 1];
        let curr = &spectrogram[frame_idx];

        // Apply max filter to previous frame (vibrato suppression).
        let mut prev_filtered = vec![0.0f32; num_bins];
        for bin in 0..num_bins {
            let lo = bin.saturating_sub(MAX_FILTER_WIDTH);
            let hi = (bin + MAX_FILTER_WIDTH + 1).min(num_bins);
            let mut max_val = 0.0f32;
            for filtered_bin in lo..hi {
                max_val = max_val.max(prev[filtered_bin]);
            }
            prev_filtered[bin] = max_val;
        }

        // Spectral flux: sum of positive differences (half-wave rectification).
        let mut flux = 0.0f32;
        for bin in 0..num_bins {
            let diff = curr[bin] - prev_filtered[bin];
            if diff > 0.0 {
                flux += diff;
            }
        }

        odf.push(flux);
    }

    // Peak picking with adaptive threshold
    let positions = pick_peaks(&odf, samples, config);

    OnsetResult {
        positions,
        odf,
        hop_size: config.hop_size,
    }
}

// ── HFC (High-Frequency Content) ──────────────────────────────────────

/// HFC onset detection — optimized for percussive/transient content.
///
/// Weights each frequency bin by its bin index, emphasizing high-frequency
/// energy that accompanies percussive attacks.
pub fn detect_hfc(samples: &[f32], config: &OnsetConfig) -> OnsetResult {
    let spectrogram = compute_magnitude_spectrogram(samples, config.fft_size, config.hop_size);
    let num_frames = spectrogram.len();

    let mut odf = Vec::with_capacity(num_frames);

    for frame in &spectrogram {
        let mut hfc_val = 0.0f32;
        for (bin, &mag) in frame.iter().enumerate() {
            // Weight by bin index — higher bins contribute more.
            hfc_val += mag * mag * (bin as f32 + 1.0);
        }
        odf.push(hfc_val);
    }

    let positions = pick_peaks(&odf, samples, config);

    OnsetResult {
        positions,
        odf,
        hop_size: config.hop_size,
    }
}

// ── Complex Domain ────────────────────────────────────────────────────

/// Complex Domain onset detection — best for melodic/tonal content.
///
/// Measures the Euclidean distance between the predicted and actual
/// complex spectrum for each frame. The prediction assumes stationary
/// magnitude and linear phase progression. Deviations from this model
/// indicate onsets.
pub fn detect_complex_domain(samples: &[f32], config: &OnsetConfig) -> OnsetResult {
    let (mag_spec, phase_spec) =
        compute_complex_spectrogram(samples, config.fft_size, config.hop_size);
    let num_frames = mag_spec.len();
    let num_bins = config.fft_size / 2 + 1;

    if num_frames < 3 {
        return OnsetResult {
            positions: vec![],
            odf: vec![],
            hop_size: config.hop_size,
        };
    }

    let mut odf = Vec::with_capacity(num_frames);
    odf.push(0.0);
    odf.push(0.0);

    for frame_idx in 2..num_frames {
        let mut cd_sum = 0.0f32;

        for bin in 0..num_bins {
            let mag_curr = mag_spec[frame_idx][bin];
            let mag_prev = mag_spec[frame_idx - 1][bin];

            let phase_curr = phase_spec[frame_idx][bin];
            let phase_prev = phase_spec[frame_idx - 1][bin];
            let phase_prev2 = phase_spec[frame_idx - 2][bin];

            // Predicted phase: linear extrapolation from two previous frames.
            let phase_predicted = 2.0 * phase_prev - phase_prev2;

            // Target (predicted) complex value using previous magnitude + predicted phase.
            let target_real = mag_prev * phase_predicted.cos();
            let target_imag = mag_prev * phase_predicted.sin();

            // Actual complex value.
            let actual_real = mag_curr * phase_curr.cos();
            let actual_imag = mag_curr * phase_curr.sin();

            // Euclidean distance between predicted and actual.
            let dr = actual_real - target_real;
            let di = actual_imag - target_imag;
            cd_sum += (dr * dr + di * di).sqrt();
        }

        odf.push(cd_sum);
    }

    let positions = pick_peaks(&odf, samples, config);

    OnsetResult {
        positions,
        odf,
        hop_size: config.hop_size,
    }
}

// ── Peak Picking ───────────────────────────────────────────────────────

/// Adaptive peak picking with threshold, minimum interval, and zero-crossing snap.
fn pick_peaks(odf: &[f32], samples: &[f32], config: &OnsetConfig) -> Vec<u32> {
    let num_frames = odf.len();
    if num_frames == 0 {
        return vec![];
    }

    let min_interval_frames =
        (config.min_interval_secs * config.sample_rate as f32 / config.hop_size as f32) as usize;

    let mut positions = Vec::new();
    let mut last_onset_frame: Option<usize> = None;

    for frame_idx in 1..num_frames.saturating_sub(1) {
        // Local maximum check.
        if odf[frame_idx] <= odf[frame_idx - 1] || odf[frame_idx] <= odf[frame_idx + 1] {
            continue;
        }

        // Adaptive threshold: mean of surrounding frames × multiplier.
        let pre_start = frame_idx.saturating_sub(config.pre_avg);
        let post_end = (frame_idx + config.post_avg + 1).min(num_frames);

        let window = &odf[pre_start..post_end];
        let mean = window.iter().sum::<f32>() / window.len() as f32;
        let adaptive_threshold = mean * config.threshold;

        if odf[frame_idx] < adaptive_threshold {
            continue;
        }

        // Minimum interval check.
        if let Some(last) = last_onset_frame {
            if frame_idx - last < min_interval_frames {
                continue;
            }
        }

        // Convert frame index to sample position.
        let sample_pos = frame_idx * config.hop_size;

        // Snap to nearest zero-crossing.
        let snapped = snap_to_zero_crossing(samples, sample_pos, config.zc_snap_window);

        positions.push(snapped as u32);
        last_onset_frame = Some(frame_idx);
    }

    positions
}

/// Find the nearest zero-crossing within a window around a given position.
fn snap_to_zero_crossing(samples: &[f32], position: usize, window: usize) -> usize {
    let start = position.saturating_sub(window);
    let end = (position + window).min(samples.len().saturating_sub(1));

    let mut best_pos = position;
    let mut best_dist = window + 1;

    for idx in start..end {
        if idx + 1 >= samples.len() {
            break;
        }
        // Zero crossing: sign change between adjacent samples.
        if (samples[idx] >= 0.0) != (samples[idx + 1] >= 0.0) {
            let dist = if idx >= position {
                idx - position
            } else {
                position - idx
            };
            if dist < best_dist {
                best_dist = dist;
                best_pos = idx;
            }
        }
    }

    best_pos
}

// ── Spectrogram Computation ────────────────────────────────────────────

/// Compute a complex spectrogram returning both magnitude and phase.
///
/// Returns (magnitudes, phases), each a Vec of frames with `fft_size/2 + 1` bins.
fn compute_complex_spectrogram(
    samples: &[f32],
    fft_size: usize,
    hop_size: usize,
) -> (Vec<Vec<f32>>, Vec<Vec<f32>>) {
    let num_bins = fft_size / 2 + 1;
    let num_frames = if samples.len() >= fft_size {
        (samples.len() - fft_size) / hop_size + 1
    } else {
        0
    };

    let window: Vec<f32> = (0..fft_size)
        .map(|n| 0.5 * (1.0 - (2.0 * PI * n as f32 / fft_size as f32).cos()))
        .collect();

    let mut mag_spec = Vec::with_capacity(num_frames);
    let mut phase_spec = Vec::with_capacity(num_frames);

    for frame_idx in 0..num_frames {
        let start = frame_idx * hop_size;
        let mut magnitudes = vec![0.0f32; num_bins];
        let mut phases = vec![0.0f32; num_bins];

        for bin in 0..num_bins {
            let mut real = 0.0f32;
            let mut imag = 0.0f32;
            let freq = 2.0 * PI * bin as f32 / fft_size as f32;

            for n in 0..fft_size {
                let sample = if start + n < samples.len() {
                    samples[start + n] * window[n]
                } else {
                    0.0
                };
                real += sample * (freq * n as f32).cos();
                imag -= sample * (freq * n as f32).sin();
            }

            magnitudes[bin] = (real * real + imag * imag).sqrt();
            phases[bin] = imag.atan2(real);
        }

        mag_spec.push(magnitudes);
        phase_spec.push(phases);
    }

    (mag_spec, phase_spec)
}

/// Compute a magnitude spectrogram using a simple DFT.
///
/// Returns a Vec of frames, each containing `fft_size/2 + 1` magnitude bins.
fn compute_magnitude_spectrogram(
    samples: &[f32],
    fft_size: usize,
    hop_size: usize,
) -> Vec<Vec<f32>> {
    let num_bins = fft_size / 2 + 1;
    let num_frames = if samples.len() >= fft_size {
        (samples.len() - fft_size) / hop_size + 1
    } else {
        0
    };

    // Precompute Hann window.
    let window: Vec<f32> = (0..fft_size)
        .map(|n| 0.5 * (1.0 - (2.0 * PI * n as f32 / fft_size as f32).cos()))
        .collect();

    let mut spectrogram = Vec::with_capacity(num_frames);

    for frame_idx in 0..num_frames {
        let start = frame_idx * hop_size;
        let mut magnitudes = vec![0.0f32; num_bins];

        // Simple DFT for each bin (no FFT library dependency).
        // This is O(N*K) but runs offline in the analysis thread, not RT.
        for (bin, mag) in magnitudes.iter_mut().enumerate() {
            let mut real = 0.0f32;
            let mut imag = 0.0f32;
            let freq = 2.0 * PI * bin as f32 / fft_size as f32;

            for n in 0..fft_size {
                let sample = if start + n < samples.len() {
                    samples[start + n] * window[n]
                } else {
                    0.0
                };
                real += sample * (freq * n as f32).cos();
                imag -= sample * (freq * n as f32).sin();
            }

            *mag = (real * real + imag * imag).sqrt();
        }

        spectrogram.push(magnitudes);
    }

    spectrogram
}
