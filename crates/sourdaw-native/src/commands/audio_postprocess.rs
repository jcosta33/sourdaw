use hound::{SampleFormat, WavReader, WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::path::Path;

use super::filesystem;

#[derive(Debug, Serialize, Deserialize)]
pub struct PostProcessRequest {
    pub input_path: String,
    pub output_path: String,
    pub target_bpm: f32,
    pub target_bars: u32,
    pub beats_per_bar: Option<u32>,
}

/// Post-process a generated WAV: trim/pad to exact bar length,
/// normalize, and apply loop-friendly fades.
pub fn post_process_audio(request: PostProcessRequest) -> Result<String, String> {
    let input = filesystem::resolve_existing_file_path(&request.input_path)?;
    let output = filesystem::resolve_writable_file_path(&request.output_path)?;
    let beats_per_bar = request.beats_per_bar.unwrap_or(4);

    // 1. Read input WAV
    let (mut audio, sample_rate, channels) = read_wav(&input)?;

    // 2. Calculate target length in samples
    let seconds_per_bar = (beats_per_bar as f32 * 60.0) / request.target_bpm;
    let total_seconds = seconds_per_bar * request.target_bars as f32;
    let target_samples = (total_seconds * sample_rate as f32) as usize;

    // 3. Trim or pad to exact bar length
    for ch in audio.iter_mut() {
        ch.resize(target_samples, 0.0);
    }

    // 4. Normalize to -1 dB headroom
    normalize(&mut audio, 0.89);

    // 5. Apply 10 ms equal-power fade at loop boundaries
    let fade_samples = (0.010 * sample_rate as f32) as usize;
    apply_fade(&mut audio, fade_samples);

    // 6. Write output
    write_wav(&output, &audio, sample_rate, channels)?;

    Ok(output.to_string_lossy().into_owned())
}

// ── WAV I/O ──────────────────────────────────────────────────────────────

fn read_wav(path: &Path) -> Result<(Vec<Vec<f32>>, u32, u16), String> {
    let reader = WavReader::open(path).map_err(|e| format!("WAV read error: {e}"))?;
    let spec = reader.spec();
    let channels = spec.channels as usize;
    let sample_rate = spec.sample_rate;

    let all_samples: Vec<f32> = match spec.sample_format {
        SampleFormat::Float => reader
            .into_samples::<f32>()
            .map(|s| s.unwrap_or(0.0))
            .collect(),
        SampleFormat::Int => {
            let max_val = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .into_samples::<i32>()
                .map(|s| s.unwrap_or(0) as f32 / max_val)
                .collect()
        }
    };

    let samples_per_ch = all_samples.len() / channels;
    let mut per_channel = vec![vec![0.0f32; samples_per_ch]; channels];
    for (i, &s) in all_samples.iter().enumerate() {
        per_channel[i % channels][i / channels] = s;
    }

    Ok((per_channel, sample_rate, spec.channels))
}

fn write_wav(
    path: &Path,
    data: &[Vec<f32>],
    sample_rate: u32,
    channels: u16,
) -> Result<(), String> {
    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 32,
        sample_format: SampleFormat::Float,
    };
    let mut writer = WavWriter::create(path, spec).map_err(|e| format!("WAV write error: {e}"))?;

    let length = data[0].len();
    for i in 0..length {
        for ch in data.iter() {
            writer
                .write_sample(ch[i])
                .map_err(|e| format!("Write error: {e}"))?;
        }
    }
    writer
        .finalize()
        .map_err(|e| format!("Finalize error: {e}"))?;
    Ok(())
}

// ── DSP ──────────────────────────────────────────────────────────────────

fn normalize(data: &mut [Vec<f32>], target_peak: f32) {
    let peak = data
        .iter()
        .flat_map(|ch| ch.iter())
        .fold(0.0f32, |acc, &s| acc.max(s.abs()));
    if peak > 1e-8 {
        let gain = target_peak / peak;
        for ch in data.iter_mut() {
            for s in ch.iter_mut() {
                *s *= gain;
            }
        }
    }
}

fn apply_fade(data: &mut [Vec<f32>], fade_samples: usize) {
    for ch in data.iter_mut() {
        let len = ch.len();
        let fade = fade_samples.min(len / 2);
        for i in 0..fade {
            let t = i as f32 / fade as f32;
            let gain = (t * std::f32::consts::FRAC_PI_2).sin();
            ch[i] *= gain;
            ch[len - 1 - i] *= gain;
        }
    }
}
