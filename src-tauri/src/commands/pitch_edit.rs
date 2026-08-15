use daw_dsp::knead::pitch_edit::{
    CompiledDeltaMap, NoteSegment, PitchContour, PitchPoint, PITCH_DETECTION_ALGORITHM,
};
use daw_dsp::knead::psola::{psola_process_offline_inplace, PsolaConfig};
use daw_dsp::knead::yin::{yin_frame, YinConfig};
use hound::{WavReader, WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::filesystem;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProgress {
    pub analysis_id: String,
    pub progress: f32,
}

#[tauri::command]
pub async fn analyze_pitch(
    app: AppHandle,
    analysis_id: String,
    audio_path: String,
) -> Result<PitchContour, String> {
    let audio_path = filesystem::resolve_existing_file_path(&audio_path)?;
    tokio::task::spawn_blocking(move || {
        let mut reader =
            WavReader::open(&audio_path).map_err(|e| format!("Failed to open WAV: {}", e))?;

        let spec = reader.spec();
        let sample_rate = spec.sample_rate as f32;
        let channels = spec.channels as usize;

        let samples: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => {
                let all: Vec<f32> = reader.samples::<f32>().filter_map(Result::ok).collect();
                all.into_iter().step_by(channels).collect()
            }
            hound::SampleFormat::Int => {
                let max = match spec.bits_per_sample {
                    16 => i16::MAX as f32,
                    24 => 8388607.0, // 2^23 - 1
                    32 => i32::MAX as f32,
                    _ => 1.0,
                };
                let all: Vec<i32> = reader.samples::<i32>().filter_map(Result::ok).collect();
                all.into_iter()
                    .step_by(channels)
                    .map(|s| s as f32 / max)
                    .collect()
            }
        };

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

            if i > 0 && i % (num_frames / 10).max(1) == 0 {
                let progress = i as f32 / num_frames as f32;
                let _ = app.emit(
                    "pitch-analysis-progress",
                    AnalysisProgress {
                        analysis_id: analysis_id.clone(),
                        progress,
                    },
                );
            }
        }

        let _ = app.emit(
            "pitch-analysis-progress",
            AnalysisProgress {
                analysis_id,
                progress: 1.0,
            },
        );

        Ok(PitchContour {
            points,
            sample_rate: spec.sample_rate,
            hop_size: hop_size as u32,
            algorithm: PITCH_DETECTION_ALGORITHM.to_string(),
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PitchCommitRequest {
    pub input_audio_path: String,
    pub output_audio_path: String,
    pub segments: Vec<NoteSegment>,
    pub contour: PitchContour,
}

#[tauri::command]
pub async fn commit_pitch_edit(request: PitchCommitRequest) -> Result<(), String> {
    let input_audio_path = filesystem::resolve_existing_file_path(&request.input_audio_path)?;
    let output_audio_path = filesystem::resolve_writable_file_path(&request.output_audio_path)?;
    tokio::task::spawn_blocking(move || {
        let mut reader =
            WavReader::open(&input_audio_path).map_err(|e| format!("Failed to open WAV: {}", e))?;

        let spec = reader.spec();
        let sample_rate = spec.sample_rate as f32;
        let channels = spec.channels as usize;

        // We only support mono or the left channel of stereo for the PSOLA processing
        // for now to keep things focused on the core feature.
        let mut samples: Vec<f32> = Vec::new();
        match spec.sample_format {
            hound::SampleFormat::Float => {
                let all: Vec<f32> = reader.samples::<f32>().filter_map(Result::ok).collect();
                samples = all.into_iter().step_by(channels).collect();
            }
            hound::SampleFormat::Int => {
                let max = match spec.bits_per_sample {
                    16 => i16::MAX as f32,
                    24 => 8388607.0,
                    32 => i32::MAX as f32,
                    _ => 1.0,
                };
                let all: Vec<i32> = reader.samples::<i32>().filter_map(Result::ok).collect();
                samples = all
                    .into_iter()
                    .step_by(channels)
                    .map(|s| s as f32 / max)
                    .collect();
            }
        }

        let map = CompiledDeltaMap::compile(&request.segments, sample_rate, samples.len(), 256);

        // Build target F0 curve using the original contour + map deltas
        let mut target_f0_curve = vec![0.0_f32; samples.len()];
        let mut pitch_marks = Vec::new();

        // Simple epoch extraction from contour: place a mark at every fundamental period
        let mut current_sample = 0.0;
        while (current_sample as usize) < samples.len() {
            let idx = current_sample as usize;

            // Find the closest point in the contour
            let point_idx = (idx / request.contour.hop_size as usize)
                .min(request.contour.points.len().saturating_sub(1));

            if let Some(pt) = request.contour.points.get(point_idx) {
                if pt.voiced && pt.frequency_hz > 20.0 {
                    pitch_marks.push(idx);

                    let shift_semitones = map.get_shift_at(idx);
                    let ratio = 2.0_f32.powf(shift_semitones / 12.0);
                    let target_hz = pt.frequency_hz * ratio;

                    // Fill curve ahead roughly one source period (up to the
                    // next mark) — filling one target period leaves zero
                    // stretches that read as "no shift" downstream.
                    let period = (sample_rate / pt.frequency_hz).max(1.0);
                    let end_idx = ((current_sample + period) as usize).min(target_f0_curve.len());
                    for i in idx..end_idx {
                        target_f0_curve[i] = target_hz;
                    }

                    current_sample += sample_rate / pt.frequency_hz;
                    continue;
                }
            }

            // Unvoiced or missing data, just skip forward
            current_sample += sample_rate / 100.0; // 10ms default skip
        }

        let cfg = PsolaConfig {
            sample_rate,
            max_semitones_transparent: 4.0,
            grain_rate: 1.0,
        };

        let mut out_samples = vec![0.0_f32; samples.len()];
        let mut scratch = vec![0.0_f32; (sample_rate / 20.0) as usize * 4]; // Max grain size

        psola_process_offline_inplace(
            &samples,
            &pitch_marks,
            &target_f0_curve,
            &cfg,
            &mut scratch,
            &mut out_samples,
        );

        // Write the output file
        let mut writer = WavWriter::create(
            &output_audio_path,
            WavSpec {
                channels: 1,
                sample_rate: spec.sample_rate,
                bits_per_sample: 32,
                sample_format: hound::SampleFormat::Float,
            },
        )
        .map_err(|e| format!("Failed to create output WAV: {}", e))?;

        for sample in out_samples {
            writer
                .write_sample(sample)
                .map_err(|e| format!("Failed to write sample: {}", e))?;
        }
        writer
            .finalize()
            .map_err(|e| format!("Failed to finalize output WAV: {}", e))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
