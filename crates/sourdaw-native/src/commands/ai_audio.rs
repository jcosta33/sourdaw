use audioadapter_buffers::direct::SequentialSliceOfVecs;
use rubato::{
    Async, FixedAsync, Resampler, SincInterpolationParameters, SincInterpolationType,
    WindowFunction,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

use super::{filesystem, model_download};

/// Cached ONNX session for Demucs (avoids reloading 235MB model per call).
static DEMUCS_SESSION: std::sync::OnceLock<Mutex<ort::session::Session>> =
    std::sync::OnceLock::new();

// ── Denoising (spectral gate — placeholder until deep_filter crate is fixed) ─

#[derive(Debug, Serialize, Deserialize)]
pub struct DenoiseRequest {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u32,
    pub strength: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DenoiseResult {
    pub samples: Vec<f32>,
    pub noise_floor_db: f64,
    pub processing_time_ms: u64,
}

/// Denoise audio using spectral noise gating.
///
/// NOTE: This is a simple DSP fallback. The `deep_filter` Rust crate (DeepFilterNet3)
/// is the intended replacement but is currently broken against tract 0.22+.
/// Once upstream fixes the `symbol_table` → `symbols` API change, swap this out.
pub async fn denoise_audio(request: DenoiseRequest) -> Result<DenoiseResult, String> {
    let start = std::time::Instant::now();
    let strength = request.strength.clamp(0.0, 1.0);

    let mut output = request.samples.clone();
    let hop = 1024_usize;

    // Estimate noise floor from first 0.5s
    let noise_frames = (request.sample_rate as f64 * 0.5 / hop as f64) as usize;
    let noise_sample_count = noise_frames * hop;
    let mut noise_power = 0.0_f64;
    for s in output.iter().take(noise_sample_count.min(output.len())) {
        noise_power += (*s as f64) * (*s as f64);
    }
    noise_power /= noise_sample_count.max(1) as f64;
    let noise_floor_db = 10.0 * noise_power.max(1e-12).log10();

    // Apply noise gate with smooth transition
    let threshold = (noise_power * (1.0 + strength * 3.0)).sqrt() as f32;
    for sample in output.iter_mut() {
        let abs = sample.abs();
        if abs < threshold {
            let ratio = abs / threshold;
            *sample *= ratio * (1.0 - strength as f32) + (1.0 - ratio) * 0.05;
        }
    }

    Ok(DenoiseResult {
        samples: output,
        noise_floor_db,
        processing_time_ms: start.elapsed().as_millis() as u64,
    })
}

// ── Stem Separation (Demucs v4 ONNX via ort) ────────────────────────────

const DEMUCS_MODEL_URL: &str =
    "https://huggingface.co/MansfieldPlumbing/Demucs_v4_TRT/resolve/125b3e0aa9b553f625e92a6c2a1cf5d214be2ec0/demucsv4.onnx";
const DEMUCS_MODEL_FILE: &str = "demucsv4.onnx";
const DEMUCS_MODEL_SHA256: &str =
    "4bef152b260bb7ac65daabd591a673195f6c9b0e9eeb330bce6e834530388b0d";
const DEMUCS_MODEL_SIZE_BYTES: u64 = 246_148_867;
const DEMUCS_SAMPLE_RATE: u32 = 44100;
const DEMUCS_SEGMENT_LEN: usize = 343980; // ~7.8s at 44100Hz
const DEMUCS_MODEL: model_download::ModelDownload = model_download::ModelDownload {
    filename: DEMUCS_MODEL_FILE,
    url: DEMUCS_MODEL_URL,
    expected_sha256: DEMUCS_MODEL_SHA256,
    expected_size_bytes: DEMUCS_MODEL_SIZE_BYTES,
};

/// Stem names output by the 6-source Demucs model.
const STEM_NAMES: [&str; 6] = ["drums", "bass", "other", "vocals", "guitar", "piano"];

#[derive(Debug, Serialize, Deserialize)]
pub struct StemSeparationRequest {
    /// Path to a WAV file to separate (avoids sending large audio over JSON IPC)
    pub audio_path: String,
    /// Which stems to return (e.g. ["drums", "vocals"] or ["all"])
    pub stems: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StemResult {
    /// Map of stem name → file path to WAV file in temp dir
    pub stem_paths: std::collections::HashMap<String, String>,
    pub processing_time_ms: u64,
}

/// Separate audio into stems using Demucs v4 ONNX model.
/// Returns file paths to temporary WAV files for each stem.
/// Model (~235MB) auto-downloads from HuggingFace on first use.
pub async fn separate_stems(request: StemSeparationRequest) -> Result<StemResult, String> {
    let start = std::time::Instant::now();

    // Read WAV file
    let audio_path = filesystem::resolve_existing_file_path(&request.audio_path)?;
    let reader =
        hound::WavReader::open(&audio_path).map_err(|e| format!("Failed to read WAV file: {e}"))?;
    let spec = reader.spec();
    let source_rate = spec.sample_rate;
    let channels = spec.channels as usize;

    eprintln!(
        "[Stems] Input: {}Hz, {} channels, {} samples",
        source_rate,
        channels,
        reader.len()
    );

    // Read all samples as f32
    let all_samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .collect::<Result<Vec<f32>, _>>()
            .map_err(|e| format!("WAV read error: {e}"))?,
        hound::SampleFormat::Int => reader
            .into_samples::<i32>()
            .collect::<Result<Vec<i32>, _>>()
            .map_err(|e| format!("WAV read error: {e}"))?
            .into_iter()
            .map(|s| s as f32 / i32::MAX as f32)
            .collect(),
    };

    // Deinterleave to left/right
    let num_frames = all_samples.len() / channels.max(1);
    let (mut left, mut right) = if channels >= 2 {
        let mut l = vec![0.0f32; num_frames];
        let mut r = vec![0.0f32; num_frames];
        for i in 0..num_frames {
            l[i] = all_samples[i * channels];
            r[i] = all_samples[i * channels + 1];
        }
        (l, r)
    } else {
        let mono: Vec<f32> = all_samples.chunks(channels.max(1)).map(|c| c[0]).collect();
        (mono.clone(), mono)
    };

    // Resample to 44100Hz if needed
    if source_rate != DEMUCS_SAMPLE_RATE {
        left = resample(&left, source_rate, DEMUCS_SAMPLE_RATE)?;
        right = resample(&right, source_rate, DEMUCS_SAMPLE_RATE)?;
    }

    // Initialize ONNX session (cached after first load)
    if DEMUCS_SESSION.get().is_none() {
        let model_path = model_download::ensure_model(&DEMUCS_MODEL).await?;

        eprintln!("[Stems] Loading Demucs ONNX model...");
        let session = ort::session::Session::builder()
            .map_err(|e| format!("ORT session builder error: {e}"))?
            .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
            .map_err(|e| format!("ORT optimization error: {e}"))?
            .with_intra_threads(4)
            .map_err(|e| format!("ORT thread config error: {e}"))?
            .commit_from_file(&model_path)
            .map_err(|e| format!("Failed to load Demucs ONNX: {e}"))?;

        let _ = DEMUCS_SESSION.set(Mutex::new(session));
        eprintln!("[Stems] Model loaded and cached");
    }

    let mut session_guard = DEMUCS_SESSION
        .get()
        .ok_or("Demucs session not initialized")?
        .lock()
        .map_err(|e| format!("Session lock error: {e}"))?;

    let total_samples = left.len();

    // Determine which stems to return
    let requested: Vec<&str> = if request.stems.iter().any(|s| s == "all") {
        STEM_NAMES[..4].to_vec() // Default: drums, bass, other, vocals
    } else {
        request
            .stems
            .iter()
            .filter(|s| STEM_NAMES.contains(&s.as_str()))
            .map(|s| s.as_str())
            .collect()
    };

    // Initialize stem accumulators
    let mut stem_data: Vec<(Vec<f32>, Vec<f32>)> = (0..6)
        .map(|_| (vec![0.0f32; total_samples], vec![0.0f32; total_samples]))
        .collect();

    // Process in segments
    let mut offset = 0;
    while offset < total_samples {
        let end = (offset + DEMUCS_SEGMENT_LEN).min(total_samples);
        let seg_len = end - offset;

        // Pad to model's expected segment length
        let mut seg_l = vec![0.0f32; DEMUCS_SEGMENT_LEN];
        let mut seg_r = vec![0.0f32; DEMUCS_SEGMENT_LEN];
        seg_l[..seg_len].copy_from_slice(&left[offset..end]);
        seg_r[..seg_len].copy_from_slice(&right[offset..end]);

        // Build input tensor: [1, 2, DEMUCS_SEGMENT_LEN]
        let mut input_data = vec![0.0f32; 2 * DEMUCS_SEGMENT_LEN];
        input_data[..DEMUCS_SEGMENT_LEN].copy_from_slice(&seg_l);
        input_data[DEMUCS_SEGMENT_LEN..].copy_from_slice(&seg_r);

        let shape = vec![1i64, 2, DEMUCS_SEGMENT_LEN as i64];
        let input_tensor = ort::value::Tensor::from_array((shape, input_data))
            .map_err(|e| format!("Input tensor error: {e}"))?;

        let outputs = session_guard
            .run(ort::inputs![input_tensor])
            .map_err(|e| format!("Demucs inference error: {e}"))?;

        // Output: [1, 6, 2, DEMUCS_SEGMENT_LEN]
        let output_value = &outputs[0];
        let (shape, raw) = output_value
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Output extraction error: {e}"))?;

        let n_stems = shape.get(1).copied().unwrap_or(6) as usize;
        let n_channels = shape.get(2).copied().unwrap_or(2) as usize;
        let seg_out_len = shape.get(3).copied().unwrap_or(DEMUCS_SEGMENT_LEN as i64) as usize;

        for stem_idx in 0..n_stems.min(6) {
            let copy_len = seg_len.min(seg_out_len);
            for ch in 0..n_channels.min(2) {
                let src_offset = stem_idx * n_channels * seg_out_len + ch * seg_out_len;
                let dst = if ch == 0 {
                    &mut stem_data[stem_idx].0
                } else {
                    &mut stem_data[stem_idx].1
                };
                for j in 0..copy_len {
                    dst[offset + j] = raw[src_offset + j];
                }
            }
        }

        offset += DEMUCS_SEGMENT_LEN;
    }

    // Write requested stems as WAV files to temp dir
    let temp_dir = std::env::temp_dir().join("sourdaw_stems");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let mut stem_paths = std::collections::HashMap::new();

    for &name in &requested {
        let idx = STEM_NAMES.iter().position(|&n| n == name);
        let Some(idx) = idx else { continue };

        let (ref stem_l, ref stem_r) = stem_data[idx];

        // Resample back if needed
        let (final_l, final_r) = if source_rate != DEMUCS_SAMPLE_RATE {
            let l = resample(stem_l, DEMUCS_SAMPLE_RATE, source_rate)?;
            let r = resample(stem_r, DEMUCS_SAMPLE_RATE, source_rate)?;
            (l, r)
        } else {
            (stem_l.clone(), stem_r.clone())
        };

        // Write stereo WAV
        let wav_path = temp_dir.join(format!("{name}.wav"));
        write_stereo_wav(&wav_path, &final_l, &final_r, source_rate)?;

        stem_paths.insert(name.to_string(), wav_path.to_string_lossy().into_owned());
    }

    eprintln!(
        "[Stems] Separated {} stems in {}ms",
        stem_paths.len(),
        start.elapsed().as_millis()
    );

    Ok(StemResult {
        stem_paths,
        processing_time_ms: start.elapsed().as_millis() as u64,
    })
}

// ── Shared helpers ───────────────────────────────────────────────────────

fn resample(input: &[f32], src_rate: u32, dst_rate: u32) -> Result<Vec<f32>, String> {
    if input.is_empty() || src_rate == dst_rate {
        return Ok(input.to_vec());
    }

    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: Some(0.95),
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let ratio = f64::from(dst_rate) / f64::from(src_rate);

    let mut resampler = Async::<f64>::new_sinc(ratio, 2.0, &params, 1024, 1, FixedAsync::Input)
        .map_err(|e| format!("Resampler error: {e}"))?;

    let input_f64: Vec<f64> = input.iter().map(|&s| s as f64).collect();
    let frames = input_f64.len();
    let channels = [input_f64];
    let adapter = SequentialSliceOfVecs::new(&channels, 1, frames)
        .map_err(|e| format!("Resampler buffer error: {e}"))?;

    let resampled = resampler
        .process_all(&adapter, frames, None)
        .map_err(|e| format!("Resample error: {e}"))?;

    Ok(resampled.take_data().iter().map(|&s| s as f32).collect())
}

fn write_stereo_wav(
    path: &PathBuf,
    left: &[f32],
    right: &[f32],
    sample_rate: u32,
) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let mut writer =
        hound::WavWriter::create(path, spec).map_err(|e| format!("WAV writer error: {e}"))?;

    let len = left.len().min(right.len());
    for i in 0..len {
        writer
            .write_sample(left[i])
            .map_err(|e| format!("WAV write error: {e}"))?;
        writer
            .write_sample(right[i])
            .map_err(|e| format!("WAV write error: {e}"))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("WAV finalize error: {e}"))?;
    Ok(())
}
