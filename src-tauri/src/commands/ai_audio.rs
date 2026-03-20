use serde::{Deserialize, Serialize};

/// AI MIDI generation using ONNX Runtime.
/// Loads SkyTNT-style MIDI transformer model for note generation.

#[derive(Debug, Serialize, Deserialize)]
pub struct MidiGenerationRequest {
    /// Seed notes as (pitch, velocity, start_beat, duration_beats)
    pub seed_notes: Vec<(u8, u8, f64, f64)>,
    /// Target number of notes to generate
    pub target_notes: u32,
    /// Temperature for sampling (0.5-1.5)
    pub temperature: f64,
    /// Top-k sampling (0 = greedy)
    pub top_k: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeneratedNote {
    pub pitch: u8,
    pub velocity: u8,
    pub start_beat: f64,
    pub duration_beats: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MidiGenerationResult {
    pub notes: Vec<GeneratedNote>,
    pub model_used: String,
    pub generation_time_ms: u64,
}

/// Generate MIDI notes using an ONNX model.
/// In production, loads a SkyTNT-style MIDI transformer via ort crate.
#[tauri::command]
pub async fn generate_midi_ai(
    request: MidiGenerationRequest,
) -> Result<MidiGenerationResult, String> {
    let start = std::time::Instant::now();

    // In production:
    // 1. Load ONNX model: ort::Session::builder()?.commit_from_file("midi_model.onnx")?
    // 2. Tokenize seed_notes into REMI/Compound Word tokens
    // 3. Run autoregressive generation with temperature sampling
    // 4. Decode output tokens back to MIDI note events

    // Algorithmic fallback: generate continuation based on seed note patterns
    let mut notes: Vec<GeneratedNote> = Vec::new();
    let seed_len = request.seed_notes.len();

    if seed_len == 0 {
        // Generate a C major arpeggio as default
        let pitches = [60, 64, 67, 72, 67, 64];
        for i in 0..request.target_notes.min(64) {
            let pitch = pitches[i as usize % pitches.len()];
            notes.push(GeneratedNote {
                pitch,
                velocity: 80,
                start_beat: i as f64 * 0.5,
                duration_beats: 0.45,
            });
        }
    } else {
        // Continue pattern from seed notes
        let last_beat = request.seed_notes
            .last()
            .map(|(_, _, s, d)| s + d)
            .unwrap_or(0.0);

        for i in 0..request.target_notes.min(64) {
            let seed_idx = i as usize % seed_len;
            let (pitch, vel, _, dur) = request.seed_notes[seed_idx];

            // Slight variation
            let pitch_var = ((i as i16 / seed_len as i16) * 12) as i16;
            let new_pitch = (pitch as i16 + pitch_var).clamp(0, 127) as u8;

            notes.push(GeneratedNote {
                pitch: new_pitch,
                velocity: vel,
                start_beat: last_beat + i as f64 * dur,
                duration_beats: dur,
            });
        }
    }

    Ok(MidiGenerationResult {
        notes,
        model_used: "algorithmic-fallback".into(),
        generation_time_ms: start.elapsed().as_millis() as u64,
    })
}

// ── Audio Denoising (DeepFilterNet pattern) ─────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct DenoiseRequest {
    /// Interleaved audio samples (f32)
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u32,
    /// Noise reduction strength 0.0-1.0
    pub strength: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DenoiseResult {
    pub samples: Vec<f32>,
    pub noise_floor_db: f64,
    pub processing_time_ms: u64,
}

/// Denoise audio using spectral subtraction (fallback).
/// In production, uses DeepFilterNet via the `deep_filter` or `df` crate.
#[tauri::command]
pub async fn denoise_audio(
    request: DenoiseRequest,
) -> Result<DenoiseResult, String> {
    let start = std::time::Instant::now();
    let strength = request.strength.clamp(0.0, 1.0);

    // Simple spectral gate noise reduction (placeholder for DeepFilterNet)
    // Real implementation: df::tract::DfTract::new(df_params, &model_path)?
    let mut output = request.samples.clone();
    let frame_size = 1024_usize;
    let hop = frame_size / 4;

    // Estimate noise floor from first 0.5s
    let noise_frames = (request.sample_rate as f64 * 0.5 / hop as f64) as usize;
    let mut noise_power = 0.0_f64;
    let noise_sample_count = noise_frames * hop;
    for s in output.iter().take(noise_sample_count.min(output.len())) {
        noise_power += (*s as f64) * (*s as f64);
    }
    noise_power /= noise_sample_count.max(1) as f64;
    let noise_floor_db = 10.0 * noise_power.max(1e-12).log10();

    // Apply simple noise gate
    let threshold = (noise_power * (1.0 + strength * 3.0)).sqrt() as f32;
    for sample in output.iter_mut() {
        if sample.abs() < threshold {
            *sample *= (1.0 - strength as f32) * 0.1;
        }
    }

    Ok(DenoiseResult {
        samples: output,
        noise_floor_db,
        processing_time_ms: start.elapsed().as_millis() as u64,
    })
}
