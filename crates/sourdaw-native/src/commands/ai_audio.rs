use serde::{Deserialize, Serialize};

/// Ceiling shared with the offline-render sample pool: ten minutes at 48 kHz.
/// An over-long clip is a command error; the PCM `Vec<f32>` is never allocated.
pub const MAX_DENOISE_SAMPLES: usize = 48_000 * 600;

const BYTES_PER_SAMPLE: usize = 4;

#[derive(Debug, Serialize, Deserialize)]
pub struct DenoiseRequest {
    pub sample_rate: u32,
    /// Channel-planar PCM: `[ch0 frames…][ch1 frames…]…`, where
    /// `frames = samples.len() / channels`.
    pub channels: u32,
    pub strength: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DenoiseResult {
    pub samples: Vec<u8>,
    pub noise_floor_db: f64,
    pub processing_time_ms: u64,
}

struct DenoisePcm {
    samples: Vec<f32>,
    sample_rate: u32,
    channels: u32,
    strength: f64,
}

struct DenoisePcmResult {
    samples: Vec<f32>,
    noise_floor_db: f64,
    processing_time_ms: u64,
}

/// Sample count of a Float32 LE payload, or a command error.
///
/// Length is decided from the byte length alone, before any `Vec<f32>` is
/// allocated, so an over-long clip is rejected rather than copied into PCM.
pub fn denoise_pcm_sample_count(byte_len: usize) -> Result<usize, String> {
    if byte_len % BYTES_PER_SAMPLE != 0 {
        return Err(format!(
            "Denoise PCM byte length {byte_len} is not a whole number of f32 samples"
        ));
    }
    let count = byte_len / BYTES_PER_SAMPLE;
    if count > MAX_DENOISE_SAMPLES {
        return Err(format!(
            "Denoise clip length {count} samples exceeds the {MAX_DENOISE_SAMPLES}-sample ceiling"
        ));
    }
    Ok(count)
}

fn decode_denoise_pcm(bytes: &[u8]) -> Result<Vec<f32>, String> {
    let count = denoise_pcm_sample_count(bytes.len())?;
    let mut samples = Vec::with_capacity(count);
    for chunk in bytes.chunks_exact(BYTES_PER_SAMPLE) {
        samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(samples)
}

fn encode_denoise_pcm(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * BYTES_PER_SAMPLE);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

/// Denoise audio using a noise-floor-keyed downward expander.
///
/// Samples arrive as Float32 little-endian bytes. The DSP pass runs off the
/// async worker via `spawn_blocking`.
///
/// This curve is mirrored by the browser fallback in
/// `src/modules/AiGeneration/useCases/actions/handleAiDenoiseClip.ts`: the
/// same Denoise action must render the same audio in every runtime. Change
/// them in lockstep.
///
/// A model-backed replacement requires separate artifact admission.
pub async fn denoise_audio(
    request: DenoiseRequest,
    samples: Vec<u8>,
) -> Result<DenoiseResult, String> {
    let pcm = decode_denoise_pcm(&samples)?;
    tokio::task::spawn_blocking(move || {
        let processed = denoise_audio_blocking(DenoisePcm {
            samples: pcm,
            sample_rate: request.sample_rate,
            channels: request.channels,
            strength: request.strength,
        })?;
        Ok(DenoiseResult {
            samples: encode_denoise_pcm(&processed.samples),
            noise_floor_db: processed.noise_floor_db,
            processing_time_ms: processed.processing_time_ms,
        })
    })
    .await
    .map_err(|e| format!("Denoise task failed: {e}"))?
}

/// Length of the analysis window at the head of the clip, in seconds.
const NOISE_WINDOW_SECONDS: f64 = 0.5;

/// Exponent scale `K` of the expansion curve `gain = ratio^(strength * K)`.
/// See [`expander_gain`] for the resulting slope and depth.
const EXPANSION_EXPONENT_SCALE: f32 = 5.0;

/// Envelope-follower attack, in seconds. Fast enough that onsets above the
/// floor open the gate without audible clipping of the attack transient.
const ENVELOPE_ATTACK_SECONDS: f32 = 0.002;

/// Envelope-follower release, in seconds. Slow enough that the gain rides
/// the signal's level, not its waveform — see [`expander_gain`].
const ENVELOPE_RELEASE_SECONDS: f32 = 0.1;

fn denoise_audio_blocking(request: DenoisePcm) -> Result<DenoisePcmResult, String> {
    let start = std::time::Instant::now();
    let strength = request.strength.clamp(0.0, 1.0);
    let channels = validate_channel_layout(request.samples.len(), request.channels)?;
    let frames = request.samples.len() / channels;
    let mut output = request.samples;

    let noise_power = estimate_noise_power(&output, request.sample_rate, channels);
    let noise_floor_db = 10.0 * noise_power.max(1e-12).log10();

    // Strength 0 is bit-exact pass-through: skipping the loop (rather than
    // multiplying by a computed gain of 1.0) guarantees it.
    if strength > 0.0 && frames > 0 {
        let threshold = (noise_power * (1.0 + strength * 3.0)).sqrt() as f32;
        let strength = strength as f32;
        let attack = envelope_coefficient(request.sample_rate, ENVELOPE_ATTACK_SECONDS);
        let release = envelope_coefficient(request.sample_rate, ENVELOPE_RELEASE_SECONDS);
        for channel in output.chunks_exact_mut(frames) {
            // Each channel owns an envelope so a preceding channel cannot
            // alter the gain at the start of the next channel plane.
            let mut envelope = 0.0_f32;
            for sample in channel {
                let abs = sample.abs();
                let coefficient = if abs > envelope { attack } else { release };
                envelope = abs + coefficient * (envelope - abs);
                // `envelope < threshold` is false when the threshold is 0 (a
                // digitally silent analysis window), so silence passes through.
                if envelope < threshold {
                    *sample *= expander_gain(envelope / threshold, strength);
                }
            }
        }
    }

    Ok(DenoisePcmResult {
        samples: output,
        noise_floor_db,
        processing_time_ms: start.elapsed().as_millis() as u64,
    })
}

/// One-pole smoothing coefficient for a time constant in seconds.
fn envelope_coefficient(sample_rate: u32, time_seconds: f32) -> f32 {
    (-1.0 / (time_seconds * sample_rate as f32)).exp()
}

/// Estimate the noise power (mean squared sample value) from up to the first
/// [`NOISE_WINDOW_SECONDS`] of audio.
///
/// The mean divides by the number of samples actually summed, so a clip
/// shorter than the window is averaged over what exists instead of being
/// diluted by the nominal window length.
fn validate_channel_layout(sample_count: usize, channels: u32) -> Result<usize, String> {
    if channels == 0 {
        return Err("Denoise channel count must be at least 1".to_owned());
    }
    let channels = channels as usize;
    if sample_count % channels != 0 {
        return Err(format!(
            "Denoise sample count {sample_count} must be divisible by channel count {channels}"
        ));
    }
    Ok(channels)
}

fn estimate_noise_power(samples: &[f32], sample_rate: u32, channels: usize) -> f64 {
    let frames = samples.len() / channels;
    let hop = 1024_usize;
    let noise_frames = (sample_rate as f64 * NOISE_WINDOW_SECONDS / hop as f64) as usize;
    let counted_frames = (noise_frames * hop).min(frames);
    let mut noise_power = 0.0_f64;
    for channel in 0..channels {
        let channel_start = channel * frames;
        for sample in &samples[channel_start..channel_start + counted_frames] {
            noise_power += (*sample as f64) * (*sample as f64);
        }
    }
    noise_power / (counted_frames * channels).max(1) as f64
}

/// Gain applied below the expander threshold, where
/// `ratio = envelope / threshold` is in `[0, 1)`.
///
/// The curve is a variable-ratio downward expander:
///
/// `gain = ratio^(strength * K)`, `K =` [`EXPANSION_EXPONENT_SCALE`]
///
/// which makes it, by construction:
/// - identity at `strength == 0` (`gain == ratio⁰ == 1` for every
///   `ratio > 0`; the caller additionally skips processing entirely so the
///   pass-through is bit-exact);
/// - continuous at the threshold for every strength (`gain → 1` as
///   `ratio → 1`, matching the unity gain above the threshold);
/// - monotone: non-decreasing in `ratio`, non-increasing in `strength`;
/// - silence stays silence for any `strength > 0` (`gain == 0` at
///   `ratio == 0`, no residual gain floor);
/// - a steady-state downward expansion slope of `(1 + strength * K) : 1` in
///   dB below the threshold. The threshold sits `sqrt(1 + 3 * strength)`
///   above the estimated floor RMS, so material at the noise floor gets
///   `ratio = 1 / sqrt(1 + 3 * strength)`: about −17.2 dB at the shipped
///   strength 0.7, −30.1 dB at strength 1 (pinned in tests below).
///
/// Callers must key `ratio` off the smoothed envelope, never the
/// instantaneous sample — see the follower in `denoise_audio_blocking`.
fn expander_gain(ratio: f32, strength: f32) -> f32 {
    ratio.powf(strength * EXPANSION_EXPONENT_SCALE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(samples: Vec<f32>, sample_rate: u32, strength: f64) -> DenoisePcm {
        DenoisePcm {
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
        let power = estimate_noise_power(&[0.5, -0.5, 0.5, -0.5], 48_000, 1);
        assert!((power - 0.25).abs() < 1e-9);
        // Longer than the window: only the window is summed and divided by.
        let long: Vec<f32> = vec![0.5; 30_000];
        let power = estimate_noise_power(&long, 48_000, 1);
        assert!((power - 0.25).abs() < 1e-9);
    }

    /// Pin the curve at a mid strength so it cannot drift silently.
    /// `0.5^2.5 = 1 / (4 * sqrt(2))`.
    #[test]
    fn expander_gain_is_pinned_at_mid_strength() {
        assert_eq!(expander_gain(0.0, 0.5), 0.0);
        assert!((expander_gain(0.5, 0.5) - 0.176_776_7).abs() < 1e-6);
        assert_eq!(expander_gain(1.0, 0.5), 1.0);
    }

    /// Pin the shipped-strength depth: every call site passes strength 0.7,
    /// and material at the estimated noise floor sits at
    /// `ratio = 1 / sqrt(1 + 3 * 0.7)`. The curve must attenuate it by
    /// about −17.2 dB — a gate depth that is audible as a denoise, unlike
    /// the −5.6 dB the folded blend curve had collapsed to.
    #[test]
    fn shipped_strength_depth_at_the_noise_floor_is_pinned() {
        let noise_floor_ratio = 1.0 / (1.0_f32 + 3.0 * 0.7).sqrt();
        let gain_db = 20.0 * expander_gain(noise_floor_ratio, 0.7).log10();
        assert!(
            (gain_db - (-17.19)).abs() < 0.05,
            "noise-floor gain at strength 0.7 = {gain_db} dB, expected about -17.19 dB"
        );
    }

    /// Regression: the original curve jumped from `1 - strength` to 1 at
    /// the threshold. The curve must meet unity at ratio 1 for every
    /// strength and be monotone in both arguments.
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

    /// A digitally silent clip comes back silent at any strength: the
    /// threshold is 0 and `envelope < threshold` never admits a sample.
    #[test]
    fn digital_silence_stays_silent_at_full_strength() {
        let result = denoise_audio_blocking(request(vec![0.0; 2048], 48_000, 1.0)).unwrap();
        assert!(result.samples.iter().all(|s| *s == 0.0));
    }

    /// Amplitude of the tone at `frequency` over a window holding an
    /// integer number of its cycles.
    fn tone_amplitude(samples: &[f32], sample_rate: f64, frequency: f64) -> f64 {
        let mut real = 0.0_f64;
        let mut imaginary = 0.0_f64;
        for (index, sample) in samples.iter().enumerate() {
            let phase = 2.0 * std::f64::consts::PI * frequency * index as f64 / sample_rate;
            real += *sample as f64 * phase.cos();
            imaginary += *sample as f64 * phase.sin();
        }
        2.0 * real.hypot(imaginary) / samples.len() as f64
    }

    /// Regression: deriving the gain from the instantaneous `|x|` made the
    /// sub-threshold branch a memoryless waveshaper — a sub-threshold sine
    /// came back with double-digit-percent odd-harmonic distortion instead
    /// of attenuation. With the envelope follower the gain rides the level,
    /// so the tone is attenuated (fundamental clearly reduced) while total
    /// harmonic distortion stays low.
    #[test]
    fn sub_threshold_sine_is_attenuated_not_distorted() {
        let sample_rate = 48_000_u32;
        let frequency = 480.0_f64;
        let amplitude = 0.1_f32;
        let samples: Vec<f32> = (0..48_000)
            .map(|i| {
                amplitude
                    * (2.0 * std::f64::consts::PI * frequency * i as f64 / sample_rate as f64).sin()
                        as f32
            })
            .collect();

        // The clip is its own noise estimate: threshold = rms * sqrt(3.1),
        // so the whole sine sits below the threshold at strength 0.7.
        let result = denoise_audio_blocking(request(samples, sample_rate, 0.7)).unwrap();

        // Analyze the second half only: past the follower's settling and an
        // integer 240 cycles of the fundamental.
        let window = &result.samples[24_000..48_000];
        let fundamental = tone_amplitude(window, sample_rate as f64, frequency);
        let mut harmonic_power = 0.0_f64;
        for harmonic in 2..=5 {
            let level = tone_amplitude(window, sample_rate as f64, frequency * harmonic as f64);
            harmonic_power += level * level;
        }
        let thd = harmonic_power.sqrt() / fundamental;

        assert!(
            thd < 0.05,
            "THD of a sub-threshold sine = {:.4} ({:.1}%), must stay under 5%",
            thd,
            thd * 100.0
        );
        // The expander still works: the tone is well below unity but not
        // gated to nothing (envelope rides near the peak, above the floor
        // RMS, so the depth here is shallower than the noise-floor pin).
        assert!(
            fundamental < 0.6 * amplitude as f64 && fundamental > 0.1 * amplitude as f64,
            "fundamental after denoise = {fundamental}"
        );
    }

    /// Full-path depth pin, mirrored sample-for-sample by the browser
    /// fallback spec in `handleAiDenoiseClip.spec.ts`: a constant-level
    /// ±0.01 clip is its own noise floor, the envelope settles at 0.01, and
    /// the steady-state gain at strength 0.7 is
    /// `(1 / sqrt(3.1))^3.5 ≈ 0.1382` (−17.2 dB).
    #[test]
    fn steady_state_depth_at_the_noise_floor_matches_the_pin_through_the_full_path() {
        let samples: Vec<f32> = (0..4800)
            .map(|i| if i % 2 == 0 { 0.01 } else { -0.01 })
            .collect();
        let result = denoise_audio_blocking(request(samples, 48_000, 0.7)).unwrap();
        let tail = result.samples[4799].abs();
        let expected = 0.01 * 0.138_16_f32;
        assert!(
            (tail - expected).abs() < 0.02 * expected,
            "steady-state output level = {tail}, expected about {expected}"
        );
    }

    /// The async command is a `spawn_blocking` wrapper around the same body.
    #[tokio::test]
    async fn async_command_matches_the_blocking_body() {
        let input = arbitrary_buffer();
        let from_command = denoise_audio(
            DenoiseRequest {
                sample_rate: 48_000,
                channels: 1,
                strength: 0.6,
            },
            encode_denoise_pcm(&input),
        )
        .await
        .unwrap();
        let from_body = denoise_audio_blocking(request(input, 48_000, 0.6)).unwrap();
        assert_eq!(from_command.samples, encode_denoise_pcm(&from_body.samples));
        assert_eq!(from_command.noise_floor_db, from_body.noise_floor_db);
    }

    #[test]
    fn denoise_pcm_sample_count_rejects_over_long_clips_without_allocating_pcm() {
        assert_eq!(
            denoise_pcm_sample_count(MAX_DENOISE_SAMPLES * BYTES_PER_SAMPLE).unwrap(),
            MAX_DENOISE_SAMPLES
        );
        let over = denoise_pcm_sample_count((MAX_DENOISE_SAMPLES + 1) * BYTES_PER_SAMPLE);
        let error = over.expect_err("over-long clip must be a command error");
        assert!(
            error.contains("ceiling"),
            "expected a ceiling error, got {error}"
        );
    }

    #[test]
    fn decode_denoise_pcm_rejects_over_long_clips_before_allocating_pcm() {
        let bytes = vec![0u8; (MAX_DENOISE_SAMPLES + 1) * BYTES_PER_SAMPLE];
        let error = decode_denoise_pcm(&bytes).expect_err("over-long clip must be a command error");
        assert!(
            error.contains("ceiling"),
            "expected a ceiling error, got {error}"
        );
    }

    #[test]
    fn denoise_pcm_round_trip_is_little_endian() {
        let bytes = [0_u8, 0, 0x80, 0x3f, 0, 0, 0x80, 0xbf];
        let decoded = decode_denoise_pcm(&bytes).unwrap();
        assert_eq!(decoded, vec![1.0, -1.0]);
        assert_eq!(encode_denoise_pcm(&decoded), bytes);
    }

    #[tokio::test]
    async fn unaligned_payload_is_a_command_error() {
        let error = denoise_audio(
            DenoiseRequest {
                sample_rate: 48_000,
                channels: 1,
                strength: 0.0,
            },
            vec![0, 1, 2],
        )
        .await
        .expect_err("unaligned bytes must be a command error");
        assert!(
            error.contains("whole number"),
            "expected an alignment error, got {error}"
        );
    }

    #[test]
    fn stereo_denoise_preserves_distinct_channel_planes() {
        let left = vec![0.01, -0.02, 0.03, -0.04];
        let right = vec![0.4, 0.3, -0.2, -0.1];
        let samples = [left.clone(), right.clone()].concat();
        let result = denoise_audio_blocking(DenoisePcm {
            samples,
            sample_rate: 48_000,
            channels: 2,
            strength: 0.0,
        })
        .unwrap();

        assert_eq!(&result.samples[..left.len()], left);
        assert_eq!(&result.samples[left.len()..], right);
    }

    #[test]
    fn stereo_noise_floor_is_shared_across_all_channel_samples() {
        let frames = 1024;
        let mut samples = vec![0.01; frames];
        samples.extend(vec![1.0; frames]);
        let result = denoise_audio_blocking(DenoisePcm {
            samples,
            sample_rate: 48_000,
            channels: 2,
            strength: 0.0,
        })
        .unwrap();
        let expected_power = (0.01_f64.powi(2) + 1.0) / 2.0;
        let expected_db = 10.0 * expected_power.log10();

        assert!(
            (result.noise_floor_db - expected_db).abs() < 1e-9,
            "noise_floor_db = {}, expected {expected_db}",
            result.noise_floor_db
        );
    }

    #[test]
    fn stereo_channels_use_independent_envelopes() {
        let channel: Vec<f32> = (0..4800)
            .map(|index| if index % 2 == 0 { 0.01 } else { -0.01 })
            .collect();
        let result = denoise_audio_blocking(DenoisePcm {
            samples: [channel.clone(), channel.clone()].concat(),
            sample_rate: 48_000,
            channels: 2,
            strength: 0.7,
        })
        .unwrap();

        assert_eq!(
            &result.samples[..channel.len()],
            &result.samples[channel.len()..]
        );
    }

    #[tokio::test]
    async fn channel_count_must_divide_the_sample_count() {
        let error = denoise_audio(
            DenoiseRequest {
                sample_rate: 48_000,
                channels: 2,
                strength: 0.0,
            },
            encode_denoise_pcm(&[0.1, 0.2, 0.3]),
        )
        .await
        .expect_err("odd stereo sample count must be a command error");

        assert!(error.contains("divisible"), "unexpected error: {error}");
    }

    #[tokio::test]
    async fn zero_channels_is_a_command_error() {
        let error = denoise_audio(
            DenoiseRequest {
                sample_rate: 48_000,
                channels: 0,
                strength: 0.0,
            },
            encode_denoise_pcm(&[0.1, 0.2]),
        )
        .await
        .expect_err("zero channels must be a command error");

        assert!(error.contains("at least 1"), "unexpected error: {error}");
    }
}
