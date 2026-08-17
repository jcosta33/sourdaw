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

/// Upper bound on the post-processed audio's duration.
///
/// `target_bpm`, `target_bars`, and `beats_per_bar` have no in-repo caller
/// today and are otherwise unvalidated: a non-finite or near-zero `bpm`
/// turns `total_seconds` into `inf`/`NaN`, which casts to `usize::MAX`/`0`
/// and panics `Vec::resize` on capacity overflow, while a merely huge finite
/// combination allocates multiple gigabytes per channel. Generated
/// loop-friendly musical material — the only intended use of this command —
/// tops out at a handful of minutes, so one hour is already far beyond any
/// real request and keeps the resulting allocation bounded regardless of
/// which input drove it.
const MAX_TARGET_DURATION_SECONDS: f32 = 3600.0;

/// Upper bound on the resulting sample count *summed across every channel*
/// (~2.75 GB of `f32` storage), checked again at the point of allocation.
/// `total_seconds` alone bounds `target_bpm` and `target_bars`, but the
/// sample rate itself comes from the input WAV's own header, so this is the
/// backstop against a corrupt or extreme header value multiplying back up to
/// an unbounded allocation. Sized for one hour at a generous professional
/// sample rate (192 kHz) *total*, not per channel — `Vec::resize` runs once
/// per channel below, so a per-channel-only bound would still let a
/// multi-channel file multiply past it one `resize` at a time, which is
/// exactly the multi-gigabyte allocation this bound exists to prevent.
const MAX_TARGET_SAMPLES_TOTAL: usize = 192_000 * 3600;

/// Validate a post-process request before any I/O or allocation happens.
/// Returns the resolved target duration in seconds so the caller does not
/// recompute it.
fn validate_post_process_request(request: &PostProcessRequest) -> Result<f32, String> {
    if !request.target_bpm.is_finite() || request.target_bpm <= 0.0 {
        return Err(format!(
            "target_bpm must be a positive finite number, got {}",
            request.target_bpm
        ));
    }

    let beats_per_bar = request.beats_per_bar.unwrap_or(4);
    if beats_per_bar == 0 {
        return Err("beats_per_bar must be greater than zero".to_string());
    }

    if request.target_bars == 0 {
        return Err("target_bars must be greater than zero".to_string());
    }

    let seconds_per_bar = (beats_per_bar as f32 * 60.0) / request.target_bpm;
    let total_seconds = seconds_per_bar * request.target_bars as f32;

    if !total_seconds.is_finite() || total_seconds <= 0.0 {
        return Err(format!(
            "target_bpm/target_bars/beats_per_bar produced a non-finite duration ({total_seconds}s)"
        ));
    }

    if total_seconds > MAX_TARGET_DURATION_SECONDS {
        return Err(format!(
            "target duration {total_seconds}s exceeds the {MAX_TARGET_DURATION_SECONDS}s bound"
        ));
    }

    Ok(total_seconds)
}

/// Resolve the per-channel target sample count for a request whose duration
/// has already been validated, and check the result against
/// `MAX_TARGET_SAMPLES_TOTAL`. Separated from `post_process_audio` so the
/// bound — including the "per channel × channel count" multiplication —
/// is testable without a real WAV file on disk.
///
/// `sample_rate` comes from the input WAV's own header, not from
/// `validate_post_process_request`, so it is checked again here rather than
/// trusted blindly.
fn resolve_target_samples(
    total_seconds: f32,
    sample_rate: u32,
    channels: u16,
) -> Result<usize, String> {
    let target_samples_f64 = f64::from(total_seconds) * f64::from(sample_rate);
    if !target_samples_f64.is_finite() || target_samples_f64 < 0.0 {
        return Err(format!(
            "resulting sample count ({target_samples_f64}) is not a valid size"
        ));
    }
    let target_samples = target_samples_f64 as usize;

    // The budget covers every channel combined — `Vec::resize` runs once per
    // channel below, so bounding only the per-channel count would still let
    // a multi-channel file multiply past it one `resize` at a time.
    target_samples
        .checked_mul(channels as usize)
        .filter(|&total_samples| total_samples <= MAX_TARGET_SAMPLES_TOTAL)
        .ok_or_else(|| {
            format!(
                "resulting sample count ({target_samples} per channel × {channels} channels) exceeds the {MAX_TARGET_SAMPLES_TOTAL}-sample total budget"
            )
        })?;

    Ok(target_samples)
}

/// Post-process a generated WAV: trim/pad to exact bar length,
/// normalize, and apply loop-friendly fades.
pub fn post_process_audio(request: PostProcessRequest) -> Result<String, String> {
    let total_seconds = validate_post_process_request(&request)?;

    let input = filesystem::resolve_existing_file_path(&request.input_path)?;
    let output = filesystem::resolve_writable_file_path(&request.output_path)?;

    // 1. Read input WAV
    let (mut audio, sample_rate, channels) = read_wav(&input)?;

    // 2. Calculate target length in samples
    let target_samples = resolve_target_samples(total_seconds, sample_rate, channels)?;

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

/// Validate an integer-format WAV's `bits_per_sample` before it drives a bit
/// shift.
///
/// hound 3.5.1 overwrites `WavSpec.bits_per_sample` with the format chunk's
/// `wValidBitsPerSample` when the file is `WAVEFORMATEXTENSIBLE`, *after* its
/// own header checks — so a crafted file can carry an out-of-range value
/// (e.g. 200) straight past hound and into `1i64 << (bits_per_sample - 1)`,
/// which panics on shift overflow in debug and silently wraps to the wrong
/// scale in release. `bits_per_sample == 0` panics on unsigned subtraction
/// underflow even in debug alone. 8..=32 covers every bit depth hound's own
/// writer or a real capture device produces.
fn validate_int_bits_per_sample(bits_per_sample: u16) -> Result<u16, String> {
    if !(8..=32).contains(&bits_per_sample) {
        return Err(format!(
            "unsupported WAV bits_per_sample for integer samples: {bits_per_sample} (must be 8..=32)"
        ));
    }
    Ok(bits_per_sample)
}

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
            let bits_per_sample = validate_int_bits_per_sample(spec.bits_per_sample)?;
            let max_val = (1i64 << (bits_per_sample - 1)) as f32;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn request(
        target_bpm: f32,
        target_bars: u32,
        beats_per_bar: Option<u32>,
    ) -> PostProcessRequest {
        PostProcessRequest {
            input_path: "unused.wav".to_string(),
            output_path: "unused-out.wav".to_string(),
            target_bpm,
            target_bars,
            beats_per_bar,
        }
    }

    #[test]
    fn accepts_an_ordinary_request_and_returns_its_duration() {
        // 4 beats/bar at 120 bpm is 2s/bar; 8 bars is 16s.
        let total_seconds = validate_post_process_request(&request(120.0, 8, None)).unwrap();
        assert!((total_seconds - 16.0).abs() < 1e-4);
    }

    /// Regression: a non-finite `target_bpm` used to turn `total_seconds`
    /// into `inf`, which cast to `usize::MAX` and panicked `Vec::resize` on
    /// capacity overflow instead of failing cleanly.
    #[test]
    fn rejects_non_finite_bpm_instead_of_producing_an_infinite_duration() {
        assert!(validate_post_process_request(&request(f32::NAN, 8, None)).is_err());
        assert!(validate_post_process_request(&request(f32::INFINITY, 8, None)).is_err());
        assert!(validate_post_process_request(&request(f32::NEG_INFINITY, 8, None)).is_err());
    }

    #[test]
    fn rejects_zero_or_negative_bpm() {
        assert!(validate_post_process_request(&request(0.0, 8, None)).is_err());
        assert!(validate_post_process_request(&request(-120.0, 8, None)).is_err());
    }

    #[test]
    fn rejects_zero_target_bars_and_zero_beats_per_bar() {
        assert!(validate_post_process_request(&request(120.0, 0, None)).is_err());
        assert!(validate_post_process_request(&request(120.0, 8, Some(0))).is_err());
    }

    /// Regression: a huge but finite `target_bars` (or a tiny `target_bpm`)
    /// used to allocate multiple gigabytes per channel instead of failing.
    #[test]
    fn rejects_a_duration_that_exceeds_the_bound() {
        assert!(validate_post_process_request(&request(120.0, u32::MAX, None)).is_err());
        assert!(validate_post_process_request(&request(0.0001, 8, None)).is_err());
        // Just over the bound at a plain, unremarkable bpm/bars combination.
        assert!(validate_post_process_request(&request(1.0, 61, None)).is_err());
    }

    #[test]
    fn accepts_a_duration_right_at_the_bound() {
        // 4 beats/bar at 1 bpm is 240s/bar; 15 bars is exactly 3600s.
        let total_seconds = validate_post_process_request(&request(1.0, 15, None)).unwrap();
        assert!((total_seconds - MAX_TARGET_DURATION_SECONDS).abs() < 1e-2);
    }

    /// The command must return a command error, not panic, for the exact
    /// shapes described in the defect: this call never reaches `read_wav`
    /// because validation runs first and fails fast.
    #[test]
    fn post_process_audio_returns_an_error_instead_of_panicking_on_malicious_input() {
        let result = post_process_audio(request(f32::NAN, u32::MAX, None));
        assert!(result.is_err());
    }

    /// Regression: the original bound checked the per-channel sample count
    /// alone (192_000 * 3600), so a stereo file just under it still passed —
    /// `Vec::resize` then ran twice, once per channel, allocating roughly
    /// double the budget the bound claimed to enforce. The bound is now a
    /// TOTAL across channels, so the identical per-channel count must be
    /// rejected once `channels` is 2.
    #[test]
    fn rejects_a_stereo_request_just_under_the_old_per_channel_bound_but_over_the_total_budget() {
        let sample_rate = 192_000u32;
        let total_seconds = 3599.99f32; // per channel: just under 691_200_000
        let channels = 2u16;

        let per_channel_only = resolve_target_samples(total_seconds, sample_rate, 1).unwrap();
        assert!(per_channel_only <= MAX_TARGET_SAMPLES_TOTAL);

        let result = resolve_target_samples(total_seconds, sample_rate, channels);
        assert!(result.is_err());
    }

    #[test]
    fn accepts_a_mono_request_exactly_at_the_total_budget() {
        let target_samples = resolve_target_samples(3600.0, 192_000, 1).unwrap();
        assert_eq!(target_samples, MAX_TARGET_SAMPLES_TOTAL);
    }

    #[test]
    fn rejects_a_multi_channel_request_that_multiplies_past_the_total_budget() {
        // A 4-channel file at a modest duration/rate that a per-channel-only
        // bound would pass comfortably, but that exceeds the total budget
        // once every channel's `resize` is counted.
        let result = resolve_target_samples(3600.0, 192_000, 4);
        assert!(result.is_err());
    }

    #[test]
    fn rejects_bits_per_sample_outside_8_to_32() {
        assert!(validate_int_bits_per_sample(0).is_err());
        assert!(validate_int_bits_per_sample(7).is_err());
        // The value hound's own header checks can be bypassed for via a
        // crafted WAVEFORMATEXTENSIBLE `wValidBitsPerSample` field, per the
        // hound 3.5.1 quirk documented on `validate_int_bits_per_sample`.
        assert!(validate_int_bits_per_sample(200).is_err());
        assert!(validate_int_bits_per_sample(u16::MAX).is_err());
    }

    #[test]
    fn accepts_bits_per_sample_within_8_to_32() {
        assert!(validate_int_bits_per_sample(8).is_ok());
        assert!(validate_int_bits_per_sample(16).is_ok());
        assert!(validate_int_bits_per_sample(24).is_ok());
        assert!(validate_int_bits_per_sample(32).is_ok());
    }
}
