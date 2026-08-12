use serde::{Deserialize, Serialize};

pub const PITCH_DETECTION_ALGORITHM: &str = "yin";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PitchPoint {
    pub time_ms: f32,
    pub frequency_hz: f32,
    pub confidence: f32,
    pub voiced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PitchContour {
    pub points: Vec<PitchPoint>,
    pub sample_rate: u32,
    pub hop_size: u32,
    pub algorithm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PitchCommitRequest {
    pub input_audio_path: String,
    pub output_audio_path: String,
    pub segments: Vec<NoteSegment>,
    pub contour: PitchContour,
}

/// Represents a single discrete pitch segment (e.g., a "blob" in the UI).
/// The audio thread interpolates shifts between these segments if needed,
/// or applies them directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteSegment {
    /// Start time in milliseconds within the clip
    pub start_time_ms: f32,
    /// End time in milliseconds within the clip
    pub end_time_ms: f32,
    /// The shift in semitones to apply (e.g., +1.0 = up one semitone)
    pub shift_semitones: f32,
}

/// The IPC command sent from the UI to update a clip's pitch profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PitchEditCommand {
    /// Target clip ID
    pub clip_id: String,
    /// The new sequence of note segments
    pub segments: Vec<NoteSegment>,
}

/// An audio-thread-safe lookup table for pitch deltas.
/// We compile the `NoteSegment` vector into a dense flat array (e.g. 1 value per 256 samples)
/// to ensure O(1) lock-free reads during synthesis.
pub struct CompiledDeltaMap {
    /// Hop size in samples (e.g. 256). Each value in `deltas` covers this many samples.
    pub hop_size: usize,
    /// The actual semitone shift values over time.
    pub deltas: Vec<f32>,
}

impl CompiledDeltaMap {
    /// Create an empty delta map.
    pub fn empty() -> Self {
        Self {
            hop_size: 256,
            deltas: Vec::new(),
        }
    }

    /// Compile a list of NoteSegments into a dense array for a given audio length and sample rate.
    pub fn compile(
        segments: &[NoteSegment],
        sample_rate: f32,
        total_samples: usize,
        hop_size: usize,
    ) -> Self {
        let num_frames = (total_samples + hop_size - 1) / hop_size;
        let mut deltas = vec![0.0_f32; num_frames];

        for segment in segments {
            let start_sample = (segment.start_time_ms / 1000.0 * sample_rate) as usize;
            let end_sample = (segment.end_time_ms / 1000.0 * sample_rate) as usize;

            let start_frame = start_sample / hop_size;
            let end_frame = (end_sample / hop_size).min(num_frames);

            for i in start_frame..end_frame {
                deltas[i] = segment.shift_semitones;
            }
        }

        Self { hop_size, deltas }
    }

    /// Lock-free O(1) lookup. Given a sample index, returns the shift in semitones.
    #[inline(always)]
    pub fn get_shift_at(&self, sample_index: usize) -> f32 {
        if self.deltas.is_empty() {
            return 0.0;
        }
        let frame = sample_index / self.hop_size;
        if frame < self.deltas.len() {
            self.deltas[frame]
        } else {
            0.0
        }
    }
}

use crate::knead::psola::{psola_process_offline_inplace, PsolaConfig};
use crate::knead::yin::{yin_frame, YinConfig};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn analyze_pitch_wasm(samples: &[f32], sample_rate: f32) -> String {
    let hop_size = 256;
    let frame_size = 2048;

    let yin_config = YinConfig {
        sample_rate,
        frame_size,
        f0_min: 50.0,
        f0_max: 1000.0,
        cmnd_threshold: 0.15,
    };

    let max_tau = (sample_rate / 50.0).ceil() as usize + 1;
    let buf_size = max_tau.max(frame_size);
    let mut work_d = vec![0.0f32; buf_size];
    let mut work_cmnd = vec![0.0f32; buf_size];

    let num_frames = if samples.len() > frame_size {
        (samples.len() - frame_size) / hop_size
    } else {
        0
    };

    let mut points = Vec::with_capacity(num_frames);

    for i in 0..num_frames {
        let offset = i * hop_size;
        let frame = &samples[offset..offset + frame_size];

        let result = yin_frame(frame, &yin_config, &mut work_d, &mut work_cmnd);

        let time_ms = (offset as f32 / sample_rate) * 1000.0;

        points.push(PitchPoint {
            time_ms,
            frequency_hz: result.f0_hz.unwrap_or(0.0),
            confidence: result.periodicity,
            voiced: result.f0_hz.is_some(),
        });
    }

    let contour = PitchContour {
        points,
        sample_rate: sample_rate as u32,
        hop_size: hop_size as u32,
        algorithm: PITCH_DETECTION_ALGORITHM.to_string(),
    };

    serde_json::to_string(&contour).unwrap_or_else(|_| "{}".to_string())
}

#[wasm_bindgen]
pub fn commit_pitch_edit_wasm(
    samples: &[f32],
    sample_rate: f32,
    segments_json: &str,
    contour_json: &str,
) -> Vec<f32> {
    let segments: Vec<NoteSegment> = serde_json::from_str(segments_json).unwrap_or_default();
    let contour: PitchContour =
        serde_json::from_str(contour_json).unwrap_or_else(|_| PitchContour {
            points: vec![],
            sample_rate: sample_rate as u32,
            hop_size: 256,
            algorithm: PITCH_DETECTION_ALGORITHM.to_string(),
        });

    let map = CompiledDeltaMap::compile(&segments, sample_rate, samples.len(), 256);

    let mut target_f0_curve = vec![0.0_f32; samples.len()];
    let mut pitch_marks = Vec::new();

    let mut current_sample = 0.0;
    while (current_sample as usize) < samples.len() {
        let idx = current_sample as usize;

        let point_idx =
            (idx / contour.hop_size as usize).min(contour.points.len().saturating_sub(1));

        if let Some(pt) = contour.points.get(point_idx) {
            if pt.voiced && pt.frequency_hz > 20.0 {
                pitch_marks.push(idx);

                let shift_semitones = map.get_shift_at(idx);
                let ratio = 2.0_f32.powf(shift_semitones / 12.0);
                let target_hz = pt.frequency_hz * ratio;

                // Fill the curve up to the next mark (one source period) —
                // filling only one target period leaves zero stretches that
                // read as "no shift" downstream.
                let period = (sample_rate / pt.frequency_hz).max(1.0);
                let end_idx = ((current_sample + period) as usize).min(target_f0_curve.len());
                for i in idx..end_idx {
                    target_f0_curve[i] = target_hz;
                }

                current_sample += sample_rate / pt.frequency_hz;
                continue;
            }
        }

        current_sample += sample_rate / 100.0; // 10ms default skip
    }

    let cfg = PsolaConfig {
        sample_rate,
        max_semitones_transparent: 4.0,
        ..PsolaConfig::default()
    };

    let mut out_samples = vec![0.0_f32; samples.len()];
    let mut scratch = vec![0.0_f32; (sample_rate / 20.0) as usize * 4];

    psola_process_offline_inplace(
        samples,
        &pitch_marks,
        &target_f0_curve,
        &cfg,
        &mut scratch,
        &mut out_samples,
    );

    out_samples
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    #[test]
    fn pitch_analysis_reports_the_algorithm_it_runs() {
        let contour: PitchContour =
            serde_json::from_str(&analyze_pitch_wasm(&[], 44_100.0)).unwrap();
        assert_eq!(contour.algorithm, "yin");
    }

    /// Harmonically rich periodic signal (see engine tests: PSOLA needs
    /// epochs; a pure sine is pathological TD-PSOLA input).
    fn pitched(freq: f32, sample_rate: f32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| {
                let mut s = 0.0_f32;
                for h in 1..=8 {
                    s += (TAU * freq * h as f32 * i as f32 / sample_rate).sin() / h as f32;
                }
                s * 0.8
            })
            .collect()
    }

    /// Dominant f0 via autocorrelation.
    fn estimate_f0(samples: &[f32], sample_rate: f32) -> f32 {
        let lo = (sample_rate / 1000.0) as usize;
        let hi = ((sample_rate / 50.0) as usize).min(samples.len() / 2);
        let mut best = 0.0_f32;
        let mut best_tau = 0usize;
        for tau in lo..=hi {
            let mut r = 0.0_f32;
            for i in 0..samples.len() - tau {
                r += samples[i] * samples[i + tau];
            }
            if r > best {
                best = r;
                best_tau = tau;
            }
        }
        assert!(best_tau > 0, "no pitch detected");
        sample_rate / best_tau as f32
    }

    /// Signal-in/signal-out end-to-end through the exact exports the Knead
    /// module's commitPitchEdit drives: analyze_pitch_wasm -> contour,
    /// commit_pitch_edit_wasm -> rendered samples.
    #[test]
    fn commit_pitch_edit_shifts_voiced_segment_up_octave() {
        let sr = 44100.0_f32;
        let samples = pitched(220.0, sr, sr as usize);
        let contour_json = analyze_pitch_wasm(&samples, sr);
        let segments = serde_json::to_string(&vec![NoteSegment {
            start_time_ms: 0.0,
            end_time_ms: 1000.0,
            shift_semitones: 12.0,
        }])
        .unwrap();

        let out = commit_pitch_edit_wasm(&samples, sr, &segments, &contour_json);
        assert_eq!(out.len(), samples.len());

        let f0 = estimate_f0(&out[8192..12288], sr);
        let err_cents = 1200.0 * (f0 / 440.0).log2().abs();
        assert!(
            err_cents < 60.0,
            "committed f0 {f0:.1} Hz, expected ~440 Hz ({err_cents:.0} cents off)"
        );
    }

    /// Zero shift must return the input essentially unmodified.
    #[test]
    fn commit_pitch_edit_zero_shift_is_transparent() {
        let sr = 44100.0_f32;
        let samples = pitched(220.0, sr, sr as usize);
        let contour_json = analyze_pitch_wasm(&samples, sr);
        let segments = serde_json::to_string(&vec![NoteSegment {
            start_time_ms: 0.0,
            end_time_ms: 1000.0,
            shift_semitones: 0.0,
        }])
        .unwrap();

        let out = commit_pitch_edit_wasm(&samples, sr, &segments, &contour_json);
        let n = out.len().min(samples.len());
        let mut num = 0.0f32;
        let mut den = 0.0f32;
        for i in 0..n {
            num += (out[i] - samples[i]).powi(2);
            den += samples[i].powi(2);
        }
        let rel_err = (num / den.max(1e-9)).sqrt();
        assert!(
            rel_err < 0.25,
            "zero-shift commit diverged from input (rel err {rel_err:.3})"
        );
    }
}
