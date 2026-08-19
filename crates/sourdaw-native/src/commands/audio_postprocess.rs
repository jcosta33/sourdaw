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
///
/// The whole-file read/process/write runs on a blocking worker thread so an
/// async caller (and, through it, the shell's main thread) never stalls for
/// the duration of a multi-minute file.
pub async fn post_process_audio(request: PostProcessRequest) -> Result<String, String> {
    let total_seconds = validate_post_process_request(&request)?;

    let input = filesystem::resolve_existing_file_path(&request.input_path)?;
    let output = filesystem::resolve_writable_file_path(&request.output_path)?;

    tokio::task::spawn_blocking(move || {
        // 1. Open the input WAV and validate the target sample budget from
        //    the header alone — a request destined for rejection must fail
        //    before the whole (potentially multi-GB) file is collected and
        //    f32-expanded into memory.
        let reader = open_wav(&input)?;
        let spec = reader.spec();
        let target_samples =
            resolve_target_samples(total_seconds, spec.sample_rate, spec.channels)?;

        // 2. Read input samples
        let (mut audio, sample_rate, channels) = collect_wav_samples(reader)?;

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
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
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

/// Attach the failing sample's position to a sample-read error.
///
/// A corrupt or truncated file must fail the whole command: substituting a
/// default for an unreadable sample would silently damage the audio it then
/// writes back out.
fn describe_sample_error<S>(index: usize, sample: hound::Result<S>) -> Result<S, String> {
    sample.map_err(|e| format!("WAV sample read error at sample index {index}: {e}"))
}

/// Open a WAV file without reading its samples, so callers can validate the
/// header (sample rate, channel count) before committing to a whole-file read.
fn open_wav(path: &Path) -> Result<WavReader<std::io::BufReader<std::fs::File>>, String> {
    WavReader::open(path).map_err(|e| format!("WAV read error: {e}"))
}

/// Collect every sample from an already-open reader into per-channel `f32`
/// buffers. Split from `open_wav` so the sample-budget check can run between
/// the two on the header alone.
fn collect_wav_samples(
    reader: WavReader<std::io::BufReader<std::fs::File>>,
) -> Result<(Vec<Vec<f32>>, u32, u16), String> {
    let spec = reader.spec();
    let channels = spec.channels as usize;
    let sample_rate = spec.sample_rate;

    let all_samples: Vec<f32> = match spec.sample_format {
        SampleFormat::Float => reader
            .into_samples::<f32>()
            .enumerate()
            .map(|(index, sample)| describe_sample_error(index, sample))
            .collect::<Result<_, _>>()?,
        SampleFormat::Int => {
            let bits_per_sample = validate_int_bits_per_sample(spec.bits_per_sample)?;
            let max_val = (1i64 << (bits_per_sample - 1)) as f32;
            reader
                .into_samples::<i32>()
                .enumerate()
                .map(|(index, sample)| {
                    describe_sample_error(index, sample).map(|s| s as f32 / max_val)
                })
                .collect::<Result<_, _>>()?
        }
    };

    let samples_per_ch = all_samples.len() / channels;
    let mut per_channel = vec![vec![0.0f32; samples_per_ch]; channels];
    for (i, &s) in all_samples.iter().enumerate() {
        per_channel[i % channels][i / channels] = s;
    }

    Ok((per_channel, sample_rate, spec.channels))
}

/// Open-then-collect convenience used by tests that exercise the read path
/// end to end; production code opens and collects separately so the sample
/// budget is validated in between.
#[cfg(test)]
fn read_wav(path: &Path) -> Result<(Vec<Vec<f32>>, u32, u16), String> {
    collect_wav_samples(open_wav(path)?)
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
    write_wav_atomically(path, spec, |writer| write_all_samples(writer, data))
}

/// Stream every sample into an already-open writer. Split from `write_wav`
/// so `write_wav_atomically` can be exercised with an injected failure.
fn write_all_samples(
    writer: &mut WavWriter<std::io::BufWriter<std::fs::File>>,
    data: &[Vec<f32>],
) -> Result<(), String> {
    let length = data[0].len();
    for i in 0..length {
        for ch in data.iter() {
            writer
                .write_sample(ch[i])
                .map_err(|e| format!("Write error: {e}"))?;
        }
    }
    Ok(())
}

/// Write a WAV so that `path` is replaced only by a complete, finalized file.
///
/// `WavWriter::create` truncates its target immediately, so writing straight
/// to `path` would destroy any pre-existing render there and — on a mid-write
/// or finalize failure such as disk full — leave a truncated, headerless WAV
/// that a later existence check mistakes for the render. Instead the file is
/// written to a unique sibling temp path (same directory, so the same allowed
/// root and the same filesystem) and renamed onto `path` only after
/// `finalize` succeeds; rename is atomic on the same filesystem, matching the
/// model-download pattern. On any failure the temp file is removed
/// best-effort and `path` is left exactly as it was.
fn write_wav_atomically(
    path: &Path,
    spec: WavSpec,
    write_samples: impl FnOnce(&mut WavWriter<std::io::BufWriter<std::fs::File>>) -> Result<(), String>,
) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "WAV write error: output path has no file name".to_string())?;
    let temp_path = path.with_file_name(format!("{file_name}.{}.tmp", uuid::Uuid::new_v4()));

    let write_result = (|| {
        let mut writer =
            WavWriter::create(&temp_path, spec).map_err(|e| format!("WAV write error: {e}"))?;
        write_samples(&mut writer)?;
        writer
            .finalize()
            .map_err(|e| format!("Finalize error: {e}"))
    })();

    match write_result {
        Ok(()) => std::fs::rename(&temp_path, path).map_err(|e| {
            let _ = std::fs::remove_file(&temp_path);
            format!("WAV write error: failed to move finished file into place: {e}")
        }),
        Err(error) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(error)
        }
    }
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
    #[tokio::test]
    async fn post_process_audio_returns_an_error_instead_of_panicking_on_malicious_input() {
        let result = post_process_audio(request(f32::NAN, u32::MAX, None)).await;
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

    /// A short-lived on-disk WAV under the system temp dir (an allowed native
    /// file root), removed when dropped so parallel test runs never collide.
    struct TempWav {
        path: std::path::PathBuf,
    }

    impl TempWav {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "sourdaw-postprocess-{label}-{}.wav",
                uuid::Uuid::new_v4()
            ));
            Self { path }
        }
    }

    impl Drop for TempWav {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    fn write_wav_file(path: &Path, sample_format: SampleFormat, sample_count: usize) {
        let spec = WavSpec {
            channels: 1,
            sample_rate: 44_100,
            bits_per_sample: match sample_format {
                SampleFormat::Float => 32,
                SampleFormat::Int => 16,
            },
            sample_format,
        };
        let mut writer = WavWriter::create(path, spec).unwrap();
        for i in 0..sample_count {
            match sample_format {
                SampleFormat::Float => writer.write_sample(0.1f32 * (i % 3) as f32).unwrap(),
                SampleFormat::Int => writer.write_sample(100i16 * (i % 3) as i16).unwrap(),
            }
        }
        writer.finalize().unwrap();
    }

    /// Cut the file short *after* the header is finalized, so the data
    /// chunk's declared length still promises samples the file no longer
    /// holds — the on-disk shape of an interrupted or corrupted write.
    fn truncate_file(path: &Path, bytes_removed: u64) {
        let len = std::fs::metadata(path).unwrap().len();
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_len(len - bytes_removed).unwrap();
    }

    /// Regression: `read_wav` used to map every failed float-sample read to
    /// `0.0`, so a truncated file produced silently damaged audio instead of
    /// an error. The error must name the failing position: 100 4-byte
    /// samples minus 5 bytes leaves 98 whole samples, so index 98 fails.
    #[test]
    fn read_wav_errors_on_a_truncated_float_wav_instead_of_silencing_samples() {
        let wav = TempWav::new("truncated-float");
        write_wav_file(&wav.path, SampleFormat::Float, 100);
        truncate_file(&wav.path, 5);

        let error = read_wav(&wav.path).unwrap_err();
        assert!(
            error.contains("WAV sample read error at sample index 98"),
            "error must name the failing sample position, got: {error}"
        );
    }

    /// Regression: the integer branch had the same defect (`unwrap_or(0)`),
    /// which decodes to digital silence at full scale.
    #[test]
    fn read_wav_errors_on_a_truncated_int_wav_instead_of_silencing_samples() {
        let wav = TempWav::new("truncated-int");
        write_wav_file(&wav.path, SampleFormat::Int, 100);
        truncate_file(&wav.path, 3);

        let error = read_wav(&wav.path).unwrap_err();
        assert!(
            error.contains("WAV sample read error at sample index"),
            "error must name the failing sample position, got: {error}"
        );
    }

    /// The full command must surface the corrupt-sample error through its
    /// async/spawn_blocking plumbing rather than writing a damaged output.
    #[tokio::test]
    async fn post_process_audio_propagates_a_corrupt_sample_error() {
        let input = TempWav::new("corrupt-input");
        let output = TempWav::new("corrupt-output");
        write_wav_file(&input.path, SampleFormat::Float, 100);
        truncate_file(&input.path, 5);

        let mut req = request(120.0, 1, None);
        req.input_path = input.path.to_string_lossy().into_owned();
        req.output_path = output.path.to_string_lossy().into_owned();

        let error = post_process_audio(req).await.unwrap_err();
        assert!(
            error.contains("WAV sample read error at sample index"),
            "error must name the failing sample position, got: {error}"
        );
        assert!(
            !output.path.exists(),
            "a failed read must not leave an output file behind"
        );
    }

    /// The async command still completes end to end for a healthy file —
    /// this fails if the `spawn_blocking` move broke path resolution or the
    /// result plumbing.
    #[tokio::test]
    async fn post_process_audio_processes_a_valid_wav_end_to_end() {
        let input = TempWav::new("valid-input");
        let output = TempWav::new("valid-output");
        write_wav_file(&input.path, SampleFormat::Float, 4_410);

        let mut req = request(120.0, 1, None);
        req.input_path = input.path.to_string_lossy().into_owned();
        req.output_path = output.path.to_string_lossy().into_owned();

        let written = post_process_audio(req).await.unwrap();
        let (audio, sample_rate, channels) = read_wav(Path::new(&written)).unwrap();
        assert_eq!(sample_rate, 44_100);
        assert_eq!(channels, 1);
        // 4 beats/bar at 120 bpm over 1 bar is 2s: 88_200 samples.
        assert_eq!(audio[0].len(), 88_200);
    }

    fn float_spec() -> WavSpec {
        WavSpec {
            channels: 1,
            sample_rate: 44_100,
            bits_per_sample: 32,
            sample_format: SampleFormat::Float,
        }
    }

    /// List sibling temp files left behind for `output` — the atomic write
    /// path must clean these up on failure. The output file name is
    /// uuid-unique per test, so a prefix scan of its directory is precise.
    fn leftover_temp_files(output: &Path) -> Vec<std::path::PathBuf> {
        let file_name = output.file_name().unwrap().to_string_lossy().into_owned();
        std::fs::read_dir(output.parent().unwrap())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                name.starts_with(&file_name) && name.ends_with(".tmp")
            })
            .collect()
    }

    /// Regression: `write_wav` used to hand the real output path straight to
    /// `WavWriter::create`, which truncates it immediately — a subsequent
    /// write or finalize failure (disk full, I/O fault) returned an error
    /// while a truncated, headerless WAV sat at the output path and any
    /// pre-existing valid render there had already been destroyed. A failure
    /// injected mid-write, after real bytes have hit the writer, must leave a
    /// pre-existing output byte-for-byte untouched and no temp file behind.
    #[test]
    fn a_mid_write_failure_leaves_a_pre_existing_output_untouched() {
        let output = TempWav::new("atomic-write-failure");
        write_wav_file(&output.path, SampleFormat::Float, 50);
        let bytes_before = std::fs::read(&output.path).unwrap();

        let error = write_wav_atomically(&output.path, float_spec(), |writer| {
            // Real samples reach the temp file before the injected failure,
            // mirroring an I/O fault partway through a render.
            writer
                .write_sample(0.5f32)
                .map_err(|e| format!("Write error: {e}"))?;
            Err("injected write failure".to_string())
        })
        .unwrap_err();

        assert_eq!(error, "injected write failure");
        assert_eq!(
            std::fs::read(&output.path).unwrap(),
            bytes_before,
            "a failed write must leave the pre-existing output byte-for-byte intact"
        );
        assert!(
            leftover_temp_files(&output.path).is_empty(),
            "the temp file must be removed after a failed write"
        );
    }

    /// The same failure against a not-yet-existing output must not create
    /// anything at the output path — a truncated file there would satisfy a
    /// later existence check and masquerade as the render.
    #[test]
    fn a_mid_write_failure_creates_nothing_at_a_missing_output_path() {
        let output = TempWav::new("atomic-write-failure-missing");

        let error = write_wav_atomically(&output.path, float_spec(), |writer| {
            writer
                .write_sample(0.5f32)
                .map_err(|e| format!("Write error: {e}"))?;
            Err("injected write failure".to_string())
        })
        .unwrap_err();

        assert_eq!(error, "injected write failure");
        assert!(
            !output.path.exists(),
            "a failed write must not leave a file at the output path"
        );
        assert!(
            leftover_temp_files(&output.path).is_empty(),
            "the temp file must be removed after a failed write"
        );
    }

    /// The success path must land the finished WAV at the output path (via
    /// rename) and leave no temp sibling behind.
    #[test]
    fn a_successful_write_replaces_the_output_and_leaves_no_temp_file() {
        let output = TempWav::new("atomic-write-success");
        write_wav_file(&output.path, SampleFormat::Float, 50);

        let data = vec![vec![0.25f32; 100]];
        write_wav(&output.path, &data, 44_100, 1).unwrap();

        let (audio, sample_rate, channels) = read_wav(&output.path).unwrap();
        assert_eq!(sample_rate, 44_100);
        assert_eq!(channels, 1);
        assert_eq!(audio[0].len(), 100);
        assert!(
            leftover_temp_files(&output.path).is_empty(),
            "the temp file must be renamed away on success"
        );
    }
}
