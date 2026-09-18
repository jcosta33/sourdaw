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

use crate::knead::engine::advance_retune_glide;
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

/// The processed configuration a commit bakes, mirroring what the live Knead
/// worklet applies per quantum: the coarse per-blob shift (the segments),
/// the retune glide between shifts, and the formant-preserve coupling
/// (#2058). A bake omitting either setting diverged from the live sound the
/// user approved, and after commit nothing of the live edit survives to
/// correct it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PitchCommitSettings {
    /// Retune speed in milliseconds — the glide time constant between one
    /// blob's shift and the next; `0` snaps (the pre-#2058 bake behaviour).
    pub retune_speed_ms: f32,
    /// Whether the spectral envelope stays fixed while the fundamental moves.
    pub formant_preserve: bool,
}

/// The offline render plan shared by the native and WASM bounces.
pub(crate) struct CommitRenderPlan {
    target_f0_curve: Vec<f32>,
    grain_rate_curve: Vec<f32>,
    pitch_marks: Vec<usize>,
}

pub(crate) fn build_commit_render_plan(
    sample_rate: f32,
    total_samples: usize,
    map: &CompiledDeltaMap,
    contour: &PitchContour,
    settings: PitchCommitSettings,
) -> CommitRenderPlan {
    // The live worklet advances its retune glide once per analysis frame, so
    // the bake steps the same one-pole glide on the same cadence and a
    // committed render follows the shift trajectory the user heard live.
    let frame_size = YinConfig {
        sample_rate,
        ..YinConfig::default()
    }
    .frame_size;
    let frame_ms = frame_size as f32 * 1000.0 / sample_rate;
    // The live setter refuses non-finite and negative speeds instead of
    // storing them; treat them the same way here — as the snap (`0`).
    let retune_speed_ms = if settings.retune_speed_ms.is_finite() {
        settings.retune_speed_ms.max(0.0)
    } else {
        0.0
    };

    let mut applied_shift_curve = vec![0.0_f32; total_samples];
    let mut applied_shift = 0.0_f32;
    let mut next_frame = 0usize;
    for (index, applied) in applied_shift_curve.iter_mut().enumerate() {
        if index >= next_frame {
            advance_retune_glide(
                &mut applied_shift,
                map.get_shift_at(index),
                retune_speed_ms,
                frame_ms,
            );
            next_frame += frame_size;
        }
        *applied = applied_shift;
    }

    let mut target_f0_curve = vec![0.0_f32; total_samples];
    // Preserved grains read unresampled (rate 1.0); when preservation is off,
    // the shift ratio at that position carries the envelope along.
    let mut grain_rate_curve = vec![1.0_f32; total_samples];
    let mut pitch_marks = Vec::new();

    let mut current_sample = 0.0;
    while (current_sample as usize) < total_samples {
        let idx = current_sample as usize;

        let point_idx =
            (idx / contour.hop_size as usize).min(contour.points.len().saturating_sub(1));

        if let Some(pt) = contour.points.get(point_idx) {
            if pt.voiced && pt.frequency_hz > 20.0 {
                pitch_marks.push(idx);

                let shift_semitones = applied_shift_curve[idx];
                let ratio = 2.0_f32.powf(shift_semitones / 12.0);
                let target_hz = pt.frequency_hz * ratio;

                // Fill the curve up to the next mark (one source period) —
                // filling only one target period leaves zero stretches that
                // read as "no shift" downstream.
                let period = (sample_rate / pt.frequency_hz).max(1.0);
                let end_idx = ((current_sample + period) as usize).min(total_samples);
                for i in idx..end_idx {
                    target_f0_curve[i] = target_hz;
                    if !settings.formant_preserve {
                        grain_rate_curve[i] = ratio;
                    }
                }

                current_sample += sample_rate / pt.frequency_hz;
                continue;
            }
        }

        current_sample += sample_rate / 100.0; // 10ms default skip
    }

    CommitRenderPlan {
        target_f0_curve,
        grain_rate_curve,
        pitch_marks,
    }
}

/// Offline pitch-commit render shared by the WASM bounce and the native
/// desktop command, so both supported renderers bake the same processed
/// configuration (#2058): the coarse segment shifts, the retune glide and the
/// formant-preserve coupling.
pub fn render_pitch_commit(
    samples: &[f32],
    sample_rate: f32,
    segments: &[NoteSegment],
    contour: &PitchContour,
    settings: PitchCommitSettings,
) -> Vec<f32> {
    let map = CompiledDeltaMap::compile(segments, sample_rate, samples.len(), 256);
    let plan = build_commit_render_plan(sample_rate, samples.len(), &map, contour, settings);

    let cfg = PsolaConfig {
        sample_rate,
        max_semitones_transparent: 4.0,
        ..PsolaConfig::default()
    };

    let mut out_samples = vec![0.0_f32; samples.len()];
    let mut scratch = vec![0.0_f32; (sample_rate / 20.0) as usize * 4];

    psola_process_offline_inplace(
        samples,
        &plan.pitch_marks,
        &plan.target_f0_curve,
        &plan.grain_rate_curve,
        &cfg,
        &mut scratch,
        &mut out_samples,
    );

    out_samples
}

#[wasm_bindgen]
pub fn commit_pitch_edit_wasm(
    samples: &[f32],
    sample_rate: f32,
    segments_json: &str,
    contour_json: &str,
    retune_speed_ms: f32,
    formant_preserve: bool,
) -> Vec<f32> {
    let segments: Vec<NoteSegment> = serde_json::from_str(segments_json).unwrap_or_default();
    let contour: PitchContour =
        serde_json::from_str(contour_json).unwrap_or_else(|_| PitchContour {
            points: vec![],
            sample_rate: sample_rate as u32,
            hop_size: 256,
            algorithm: PITCH_DETECTION_ALGORITHM.to_string(),
        });

    render_pitch_commit(
        samples,
        sample_rate,
        &segments,
        &contour,
        PitchCommitSettings {
            retune_speed_ms,
            formant_preserve,
        },
    )
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

        let out = commit_pitch_edit_wasm(&samples, sr, &segments, &contour_json, 0.0, true);
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

        let out = commit_pitch_edit_wasm(&samples, sr, &segments, &contour_json, 0.0, true);
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

    /// A voiced contour at a constant f0, so every mark fills the curve.
    fn constant_voiced_contour(sample_rate: f32, total_samples: usize) -> PitchContour {
        let hop_size = 256usize;
        let points = (0..total_samples.div_ceil(hop_size))
            .map(|i| PitchPoint {
                time_ms: (i * hop_size) as f32 / sample_rate * 1000.0,
                frequency_hz: 200.0,
                confidence: 1.0,
                voiced: true,
            })
            .collect();
        PitchContour {
            points,
            sample_rate: sample_rate as u32,
            hop_size: hop_size as u32,
            algorithm: PITCH_DETECTION_ALGORITHM.to_string(),
        }
    }

    /// The bake must reproduce the retune glide the live worklet applies
    /// between blob shifts (#2058). With retune speed 0 the shift snaps at the
    /// segment boundary; with a real retune speed the baked shift leaves the
    /// boundary partway — gliding down from the previous segment's shift —
    /// exactly like the engine's per-frame one-pole.
    #[test]
    fn commit_render_plan_applies_the_retune_glide_between_segments() {
        let sr = 44_100.0_f32;
        let total_samples = sr as usize; // 1 s
        let contour = constant_voiced_contour(sr, total_samples);
        let segments = vec![
            NoteSegment {
                start_time_ms: 0.0,
                end_time_ms: 500.0,
                shift_semitones: 12.0,
            },
            NoteSegment {
                start_time_ms: 500.0,
                end_time_ms: 1000.0,
                shift_semitones: 0.0,
            },
        ];
        let f0 = 200.0_f32;
        let shifted = f0 * 2.0_f32; // +12 st

        let map = CompiledDeltaMap::compile(&segments, sr, total_samples, 256);
        let snap = build_commit_render_plan(
            sr,
            total_samples,
            &map,
            &contour,
            PitchCommitSettings {
                retune_speed_ms: 0.0,
                formant_preserve: true,
            },
        );
        let glide = build_commit_render_plan(
            sr,
            total_samples,
            &map,
            &contour,
            PitchCommitSettings {
                retune_speed_ms: 200.0,
                formant_preserve: true,
            },
        );

        // Inside the first segment, before the glide from zero has settled.
        let early = 20_000_usize;
        assert_eq!(snap.target_f0_curve[early], shifted);
        assert!(
            glide.target_f0_curve[early] > f0 && glide.target_f0_curve[early] < shifted,
            "glided bake should still be approaching +12 st, got {} Hz",
            glide.target_f0_curve[early]
        );

        // Past the boundary: the first frame start in the second segment is
        // at 22528, and the first mark reading that frame lands at ~22711
        // (marks sit one source period apart), so pick inside its fill span.
        // The snap lands on the new shift immediately, the glide is partway
        // down from it.
        let after = 22_800_usize;
        assert_eq!(snap.target_f0_curve[after], f0);
        assert!(
            glide.target_f0_curve[after] > f0
                && glide.target_f0_curve[after] < shifted
                && glide.target_f0_curve[after] < glide.target_f0_curve[early],
            "glided bake should leave the boundary between segments, got {} Hz",
            glide.target_f0_curve[after]
        );
    }

    /// Formant preserve is an audible live setting (#2058): preserving bakes
    /// unresampled grains everywhere; turning it off bakes the shift ratio as
    /// the grain read rate, and the two renders differ.
    #[test]
    fn commit_render_and_bake_carry_the_formant_preserve_setting() {
        let sr = 44_100.0_f32;
        let samples = pitched(220.0, sr, sr as usize);
        let contour = constant_voiced_contour(sr, samples.len());
        let segments = vec![NoteSegment {
            start_time_ms: 0.0,
            end_time_ms: 1000.0,
            shift_semitones: 12.0,
        }];
        let ratio = 2.0_f32; // +12 st

        let map = CompiledDeltaMap::compile(&segments, sr, samples.len(), 256);
        let preserved = build_commit_render_plan(
            sr,
            samples.len(),
            &map,
            &contour,
            PitchCommitSettings {
                retune_speed_ms: 0.0,
                formant_preserve: true,
            },
        );
        let tracking = build_commit_render_plan(
            sr,
            samples.len(),
            &map,
            &contour,
            PitchCommitSettings {
                retune_speed_ms: 0.0,
                formant_preserve: false,
            },
        );

        assert!(
            preserved.grain_rate_curve.iter().all(|&rate| rate == 1.0),
            "preserved bake must read every grain unresampled"
        );
        assert_eq!(tracking.grain_rate_curve[12_345], ratio);
        assert!(
            tracking.grain_rate_curve.iter().any(|&rate| rate != 1.0),
            "formant-tracking bake must carry the shift ratio as its grain rate"
        );

        // The curves are not just bookkeeping: the setting changes the audio.
        let contour_json = analyze_pitch_wasm(&samples, sr);
        let segments_json = serde_json::to_string(&segments).unwrap();
        let baked_preserved =
            commit_pitch_edit_wasm(&samples, sr, &segments_json, &contour_json, 0.0, true);
        let baked_tracking =
            commit_pitch_edit_wasm(&samples, sr, &segments_json, &contour_json, 0.0, false);
        assert!(
            baked_preserved
                .iter()
                .zip(baked_tracking.iter())
                .any(|(a, b)| (a - b).abs() > 1e-4),
            "formant preserve must change the baked render"
        );
    }
}
