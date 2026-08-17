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

/// Denoise audio using a noise-floor-keyed downward expander.
///
/// The whole-buffer DSP runs on the blocking pool so a long clip never
/// stalls a tokio worker thread.
///
/// NOTE: This is a simple DSP fallback. The `deep_filter` Rust crate
/// (DeepFilterNet3) is the intended replacement but is currently broken
/// against tract 0.22+. Once upstream fixes the `symbol_table` → `symbols`
/// API change, swap this out.
pub async fn denoise_audio(request: DenoiseRequest) -> Result<DenoiseResult, String> {
    tokio::task::spawn_blocking(move || denoise_audio_blocking(request))
        .await
        .map_err(|e| format!("Denoise task failed: {e}"))?
}

/// Length of the analysis window at the head of the clip, in seconds.
const NOISE_WINDOW_SECONDS: f64 = 0.5;

fn denoise_audio_blocking(request: DenoiseRequest) -> Result<DenoiseResult, String> {
    let start = std::time::Instant::now();
    let strength = request.strength.clamp(0.0, 1.0);

    let mut output = request.samples;

    let noise_power = estimate_noise_power(&output, request.sample_rate);
    let noise_floor_db = 10.0 * noise_power.max(1e-12).log10();

    // Strength 0 is bit-exact pass-through: skipping the loop (rather than
    // multiplying by a computed gain of 1.0) guarantees it.
    if strength > 0.0 {
        let threshold = (noise_power * (1.0 + strength * 3.0)).sqrt() as f32;
        // A zero threshold (digital-silence analysis window) would make
        // `abs / threshold` NaN; there is nothing to expand below it anyway.
        if threshold > 0.0 {
            let strength = strength as f32;
            for sample in output.iter_mut() {
                let abs = sample.abs();
                if abs < threshold {
                    *sample *= expander_gain(abs / threshold, strength);
                }
            }
        }
    }

    Ok(DenoiseResult {
        samples: output,
        noise_floor_db,
        processing_time_ms: start.elapsed().as_millis() as u64,
    })
}

/// Estimate the noise power (mean squared sample value) from up to the first
/// [`NOISE_WINDOW_SECONDS`] of audio.
///
/// The mean divides by the number of samples actually summed, so a clip
/// shorter than the window is averaged over what exists instead of being
/// diluted by the nominal window length.
fn estimate_noise_power(samples: &[f32], sample_rate: u32) -> f64 {
    let hop = 1024_usize;
    let noise_frames = (sample_rate as f64 * NOISE_WINDOW_SECONDS / hop as f64) as usize;
    let counted = (noise_frames * hop).min(samples.len());
    let mut noise_power = 0.0_f64;
    for s in samples.iter().take(counted) {
        noise_power += (*s as f64) * (*s as f64);
    }
    noise_power / counted.max(1) as f64
}

/// Gain applied to a sample below the expander threshold, where
/// `ratio = |sample| / threshold` is in `[0, 1)`.
///
/// The curve is a dry/wet blend between unity and a quadratic expander:
///
/// `gain = (1 - strength) + strength * ratio²`
///
/// which makes it, by construction:
/// - identity at `strength == 0` (`gain == 1` for every ratio);
/// - continuous in `strength` on `[0, 1]`, with no jump at either end;
/// - continuous at the threshold for every strength (`gain → 1` as
///   `ratio → 1`, matching the unity gain above the threshold);
/// - monotone: non-decreasing in `ratio`, non-increasing in `strength`, and
///   the output level `ratio * gain` is non-decreasing in the input level;
/// - a full quadratic expander at `strength == 1` (`gain == ratio²`, i.e. a
///   3:1 downward expansion slope in dB, and silence stays silence).
fn expander_gain(ratio: f32, strength: f32) -> f32 {
    (1.0 - strength) + strength * ratio * ratio
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(samples: Vec<f32>, sample_rate: u32, strength: f64) -> DenoiseRequest {
        DenoiseRequest {
            samples,
            sample_rate,
            channels: 1,
            strength,
        }
    }

    /// An arbitrary buffer with material well below any plausible threshold:
    /// a quiet "noise" head followed by louder content, signs mixed.
    fn arbitrary_buffer() -> Vec<f32> {
        (0..4096)
            .map(|i| {
                let quiet = 0.01 * ((i % 7) as f32 - 3.0);
                let loud = 0.8 * ((i % 5) as f32 - 2.0);
                if i < 2048 {
                    quiet
                } else {
                    quiet + loud
                }
            })
            .collect()
    }

    /// Regression: at strength 0 the old curve still multiplied every
    /// sub-threshold sample by `ratio + (1 - ratio) * 0.05 < 1`, so "denoise
    /// amount 0" attenuated quiet material instead of passing the dry signal.
    #[test]
    fn strength_zero_is_a_bit_exact_pass_through() {
        let input = arbitrary_buffer();
        let result = denoise_audio_blocking(request(input.clone(), 48_000, 0.0)).unwrap();
        assert_eq!(result.samples.len(), input.len());
        for (out, original) in result.samples.iter().zip(input.iter()) {
            assert_eq!(out.to_bits(), original.to_bits());
        }
    }

    /// Regression: a clip shorter than the 0.5 s analysis window summed only
    /// the samples that exist but divided by the nominal window length,
    /// underestimating the floor. 1 000 samples at constant ±0.5 have a true
    /// mean power of 0.25, i.e. a floor of exactly 10·log10(0.25) dB.
    #[test]
    fn short_clip_noise_floor_matches_the_true_power_of_what_was_summed() {
        let samples: Vec<f32> = (0..1000)
            .map(|i| if i % 2 == 0 { 0.5 } else { -0.5 })
            .collect();
        let result = denoise_audio_blocking(request(samples, 48_000, 0.0)).unwrap();
        let expected_db = 10.0 * 0.25_f64.log10();
        assert!(
            (result.noise_floor_db - expected_db).abs() < 1e-9,
            "noise_floor_db = {}, expected {}",
            result.noise_floor_db,
            expected_db
        );
    }

    #[test]
    fn estimate_noise_power_averages_over_the_samples_actually_summed() {
        // Shorter than the window: mean over the 4 real samples, not the
        // nominal 23 552-sample window at 48 kHz.
        let power = estimate_noise_power(&[0.5, -0.5, 0.5, -0.5], 48_000);
        assert!((power - 0.25).abs() < 1e-9);
        // Longer than the window: only the window is summed and divided by.
        let long: Vec<f32> = vec![0.5; 30_000];
        let power = estimate_noise_power(&long, 48_000);
        assert!((power - 0.25).abs() < 1e-9);
    }

    /// Pin the curve at a mid strength so the blend cannot drift silently.
    #[test]
    fn expander_gain_is_pinned_at_mid_strength() {
        assert_eq!(expander_gain(0.0, 0.5), 0.5);
        assert_eq!(expander_gain(0.5, 0.5), 0.625);
        assert_eq!(expander_gain(1.0, 0.5), 1.0);
    }

    /// Regression: the old curve jumped from `1 - strength` to 1 at the
    /// threshold. The blend must meet unity at ratio 1 for every strength
    /// and be monotone in both arguments.
    #[test]
    fn expander_gain_is_continuous_at_the_threshold_and_monotone() {
        for i in 0..=10 {
            let strength = i as f32 / 10.0;
            assert_eq!(expander_gain(1.0, strength), 1.0);
        }
        // Non-decreasing in ratio at fixed strength.
        let mut previous = expander_gain(0.0, 0.7);
        for i in 1..=100 {
            let gain = expander_gain(i as f32 / 100.0, 0.7);
            assert!(gain >= previous);
            previous = gain;
        }
        // Non-increasing in strength at fixed ratio.
        let mut previous = expander_gain(0.3, 0.0);
        for i in 1..=100 {
            let gain = expander_gain(0.3, i as f32 / 100.0);
            assert!(gain <= previous);
            previous = gain;
        }
        // Silence stays silence at full strength; no residual gain floor.
        assert_eq!(expander_gain(0.0, 1.0), 0.0);
    }

    /// A digitally silent clip must come back silent (no NaN from a zero
    /// threshold) at any strength.
    #[test]
    fn digital_silence_stays_silent_at_full_strength() {
        let result = denoise_audio_blocking(request(vec![0.0; 2048], 48_000, 1.0)).unwrap();
        assert!(result.samples.iter().all(|s| *s == 0.0));
    }

    /// The async command is a `spawn_blocking` wrapper around the same body.
    #[tokio::test]
    async fn async_command_matches_the_blocking_body() {
        let input = arbitrary_buffer();
        let from_command = denoise_audio(request(input.clone(), 48_000, 0.6))
            .await
            .unwrap();
        let from_body = denoise_audio_blocking(request(input, 48_000, 0.6)).unwrap();
        assert_eq!(from_command.samples, from_body.samples);
        assert_eq!(from_command.noise_floor_db, from_body.noise_floor_db);
    }
}
