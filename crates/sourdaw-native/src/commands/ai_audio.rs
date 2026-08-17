use serde::{Deserialize, Serialize};

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
