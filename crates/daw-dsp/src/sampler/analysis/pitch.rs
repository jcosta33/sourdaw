/// Pitch detection wrapper for the sampler.
///
/// Uses Knead's YIN algorithm with multi-window analysis to detect the
/// fundamental frequency of a sample. Returns the detected root MIDI note
/// and frequency. Analyzes multiple windows across the sample and takes
/// the median result for robustness.

use crate::knead::yin::{yin_frame, YinConfig, YinResult};

// ── Configuration ──────────────────────────────────────────────────────

const ANALYSIS_FRAME_SIZE: usize = 2048;
const MAX_ANALYSIS_WINDOWS: usize = 16;
const YIN_THRESHOLD: f32 = 0.15;
const MIN_PITCH_HZ: f32 = 30.0;
const MAX_PITCH_HZ: f32 = 4000.0;

// ── Result ─────────────────────────────────────────────────────────────

/// Result of pitch detection on a sample.
#[derive(Debug, Clone, Copy)]
pub struct PitchResult {
    /// Detected fundamental frequency in Hz, if found.
    pub frequency_hz: Option<f32>,
    /// Corresponding MIDI note number (A4 = 69 = 440Hz).
    pub midi_note: Option<u8>,
    /// Confidence (0.0–1.0), derived from YIN periodicity.
    pub confidence: f32,
}

// ── Detection ──────────────────────────────────────────────────────────

/// Detect the pitch of an audio sample.
///
/// Analyzes up to `MAX_ANALYSIS_WINDOWS` evenly-spaced windows across
/// the sample, runs YIN on each, and returns the median detected pitch.
/// Skips the first 10% and last 10% of the sample to avoid transients
/// and release tails.
pub fn detect_pitch(samples: &[f32], sample_rate: f32) -> PitchResult {
    if samples.len() < ANALYSIS_FRAME_SIZE {
        return PitchResult {
            frequency_hz: None,
            midi_note: None,
            confidence: 0.0,
        };
    }

    let yin_config = YinConfig {
        sample_rate,
        frame_size: ANALYSIS_FRAME_SIZE,
        f0_min: MIN_PITCH_HZ,
        f0_max: MAX_PITCH_HZ,
        cmnd_threshold: YIN_THRESHOLD,
    };

    // Pre-allocate work buffers for YIN.
    let max_tau = (sample_rate / MIN_PITCH_HZ).ceil() as usize + 1;
    let buf_size = max_tau.max(ANALYSIS_FRAME_SIZE);
    let mut work_d = vec![0.0f32; buf_size];
    let mut work_cmnd = vec![0.0f32; buf_size];

    // Skip first/last 10% of the sample (transient/tail avoidance).
    let skip = samples.len() / 10;
    let analysis_start = skip;
    let analysis_end = samples.len().saturating_sub(skip);
    let analysis_len = analysis_end - analysis_start;

    if analysis_len < ANALYSIS_FRAME_SIZE {
        return PitchResult {
            frequency_hz: None,
            midi_note: None,
            confidence: 0.0,
        };
    }

    // Calculate window positions (evenly spaced).
    let num_windows = ((analysis_len - ANALYSIS_FRAME_SIZE) / (ANALYSIS_FRAME_SIZE / 2))
        .min(MAX_ANALYSIS_WINDOWS)
        .max(1);

    let step = if num_windows > 1 {
        (analysis_len - ANALYSIS_FRAME_SIZE) / (num_windows - 1)
    } else {
        0
    };

    // Run YIN on each window, collect valid results.
    let mut detected_freqs: Vec<f32> = Vec::with_capacity(num_windows);
    let mut total_periodicity = 0.0f32;

    for window_idx in 0..num_windows {
        let offset = analysis_start + window_idx * step;
        let frame = &samples[offset..offset + ANALYSIS_FRAME_SIZE];

        let result: YinResult = yin_frame(frame, &yin_config, &mut work_d, &mut work_cmnd);

        if let Some(freq) = result.f0_hz {
            if freq >= MIN_PITCH_HZ && freq <= MAX_PITCH_HZ {
                detected_freqs.push(freq);
                total_periodicity += result.periodicity;
            }
        }
    }

    if detected_freqs.is_empty() {
        return PitchResult {
            frequency_hz: None,
            midi_note: None,
            confidence: 0.0,
        };
    }

    // Take the median frequency for robustness.
    detected_freqs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
    let median_freq = detected_freqs[detected_freqs.len() / 2];

    // Convert to MIDI note.
    let midi_float = 69.0 + 12.0 * (median_freq / 440.0).log2();
    let midi_note = midi_float.round() as u8;

    let confidence = total_periodicity / detected_freqs.len() as f32;

    PitchResult {
        frequency_hz: Some(median_freq),
        midi_note: Some(midi_note.min(127)),
        confidence: confidence.clamp(0.0, 1.0),
    }
}

/// Convert a frequency in Hz to the nearest MIDI note number.
pub fn hz_to_midi(freq_hz: f32) -> u8 {
    let midi = 69.0 + 12.0 * (freq_hz / 440.0).log2();
    (midi.round() as u8).min(127)
}

/// Convert a MIDI note number to frequency in Hz.
pub fn midi_to_hz(note: u8) -> f32 {
    440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
}
