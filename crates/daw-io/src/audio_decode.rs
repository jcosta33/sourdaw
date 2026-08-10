use serde::{Deserialize, Serialize};
use std::io::Cursor;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::codecs::CodecParameters;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

const MAX_RETAINED_DECODE_WARNINGS: usize = 4;

#[derive(Debug, Serialize, Deserialize)]
pub struct DecodedAudio {
    pub sample_rate: u32,
    pub channels: u32,
    pub samples: Vec<Vec<f32>>,
    pub duration_seconds: f64,
    pub codec: String,
    /// Total recoverable packets discarded while decoding this file.
    #[serde(default)]
    pub decode_warning_count: u64,
    /// Recoverable packet corruption encountered while decoding this file.
    #[serde(default)]
    pub decode_warnings: Vec<String>,
}

#[derive(Default)]
struct DecodeDiagnostics {
    warning_count: u64,
    warnings: Vec<String>,
}

impl DecodeDiagnostics {
    fn record(&mut self, error: &SymphoniaError) {
        self.warning_count = self.warning_count.saturating_add(1);
        if self.warnings.len() < MAX_RETAINED_DECODE_WARNINGS {
            self.warnings.push(error.to_string());
        }
    }
}

/// Decode an audio file from disk by path.
/// Supports WAV, FLAC, MP3, OGG/Vorbis, AAC, ALAC, and more.
/// Prefer this over `decode_audio_file_bytes` when the file is on disk — avoids reading
/// the entire file into memory before passing it over the Tauri IPC boundary.
pub fn decode_audio_file(path: &str) -> Result<DecodedAudio, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open file: {e}"))?;
    decode_from_stream(MediaSourceStream::new(Box::new(file), Default::default()))
}

/// Decode audio from an in-memory byte buffer.
/// Use this when bytes are already loaded (e.g. from a network fetch or embedded archive).
pub fn decode_audio_file_bytes(file_bytes: Vec<u8>) -> Result<DecodedAudio, String> {
    decode_from_stream(MediaSourceStream::new(
        Box::new(Cursor::new(file_bytes)),
        Default::default(),
    ))
}

fn decode_from_stream(mss: MediaSourceStream) -> Result<DecodedAudio, String> {
    let hint = Hint::new();
    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();
    let decoder_opts = AudioDecoderOptions::default();

    let mut format_reader = symphonia::default::get_probe()
        .probe(&hint, mss, format_opts, metadata_opts)
        .map_err(|e| format!("Failed to probe audio format: {e}"))?;

    let track = format_reader
        .default_track(TrackType::Audio)
        .ok_or("No audio track found")?;

    let audio_params = match &track.codec_params {
        Some(CodecParameters::Audio(params)) => params,
        _ => return Err("Audio track has no audio codec parameters".to_string()),
    };

    let codec_name = audio_params.codec.to_string();
    let sample_rate = audio_params.sample_rate.ok_or("Unknown sample rate")?;
    if sample_rate == 0 {
        return Err("Audio track declares zero sample rate".to_string());
    }
    let channels = channel_count(audio_params)?;
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(audio_params, &decoder_opts)
        .map_err(|e| format!("Failed to create decoder: {e}"))?;

    let mut channel_samples: Vec<Vec<f32>> = (0..channels).map(|_| Vec::new()).collect();
    let mut diagnostics = DecodeDiagnostics::default();

    loop {
        let packet = match format_reader.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(e) => return Err(format!("Read error: {e}")),
        };

        if packet.track_id != track_id {
            continue;
        }

        let decoded = decoder.decode(&packet).map(|decoded| {
            let mut interleaved = Vec::new();
            decoded.copy_to_vec_interleaved(&mut interleaved);
            interleaved
        });
        append_decoded_packet(decoded, &mut channel_samples, channels, &mut diagnostics)?;
    }

    build_decoded_audio(
        sample_rate,
        channels,
        channel_samples,
        codec_name,
        diagnostics,
    )
}

fn build_decoded_audio(
    sample_rate: u32,
    channels: u32,
    samples: Vec<Vec<f32>>,
    codec: String,
    diagnostics: DecodeDiagnostics,
) -> Result<DecodedAudio, String> {
    let total_samples = samples.first().map(|channel| channel.len()).unwrap_or(0);
    if total_samples == 0 {
        if diagnostics.warning_count > 0 {
            return Err(format!(
                "Audio file contains no decodable frames after skipping {} corrupt packets",
                diagnostics.warning_count
            ));
        }
        return Err("Audio file contains no decodable frames".to_string());
    }
    let duration_seconds = total_samples as f64 / sample_rate as f64;

    Ok(DecodedAudio {
        sample_rate,
        channels,
        samples,
        duration_seconds,
        codec,
        decode_warning_count: diagnostics.warning_count,
        decode_warnings: diagnostics.warnings,
    })
}

fn channel_count(
    audio_params: &symphonia::core::codecs::audio::AudioCodecParameters,
) -> Result<u32, String> {
    let channels = audio_params
        .channels
        .as_ref()
        .map(|channels| channels.count() as u32)
        .unwrap_or(2);
    if channels == 0 {
        return Err("Audio track declares zero channels".to_string());
    }

    Ok(channels)
}

fn append_decoded_packet(
    decoded: Result<Vec<f32>, SymphoniaError>,
    channel_samples: &mut [Vec<f32>],
    channels: u32,
    diagnostics: &mut DecodeDiagnostics,
) -> Result<(), String> {
    let interleaved = match decoded {
        Ok(interleaved) => interleaved,
        Err(error @ SymphoniaError::DecodeError(_)) | Err(error @ SymphoniaError::IoError(_)) => {
            diagnostics.record(&error);
            return Ok(());
        }
        Err(error) => return Err(format!("Decode error: {error}")),
    };

    for chunk in interleaved.chunks(channels as usize) {
        for (channel, &sample) in chunk.iter().enumerate() {
            if channel < channel_samples.len() {
                channel_samples[channel].push(sample);
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Error as IoError, ErrorKind};
    use symphonia::core::audio::Channels;
    use symphonia::core::codecs::audio::AudioCodecParameters;

    fn pcm_wav_with_sample_rate(sample_rate: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&38u32.to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&0i16.to_le_bytes());
        bytes
    }

    #[test]
    fn zero_sample_rate_is_rejected_before_duration_calculation() {
        let error = decode_audio_file_bytes(pcm_wav_with_sample_rate(0))
            .expect_err("zero sample rate must be rejected");

        assert_eq!(error, "Audio track declares zero sample rate");
    }

    #[test]
    fn zero_channel_metadata_is_rejected_before_deinterleave() {
        let mut params = AudioCodecParameters::new();
        params.channels = Some(Channels::None);

        let error = channel_count(&params).expect_err("zero channels must be rejected");

        assert_eq!(error, "Audio track declares zero channels");
    }

    #[test]
    fn recoverable_packet_errors_are_reported_without_aborting_later_packets() {
        let mut channel_samples = vec![Vec::new(), Vec::new()];
        let mut diagnostics = DecodeDiagnostics::default();
        let packets = [
            Ok(vec![0.1, 1.1]),
            Err(SymphoniaError::DecodeError("corrupt frame")),
            Err(SymphoniaError::IoError(IoError::new(
                ErrorKind::UnexpectedEof,
                "truncated frame",
            ))),
            Ok(vec![0.2, 1.2]),
        ];

        for packet in packets {
            append_decoded_packet(packet, &mut channel_samples, 2, &mut diagnostics)
                .expect("recoverable packet errors must not abort decoding");
        }

        assert_eq!(channel_samples, vec![vec![0.1, 0.2], vec![1.1, 1.2]]);
        assert_eq!(
            diagnostics.warnings,
            vec!["malformed stream: corrupt frame", "truncated frame",]
        );
        assert_eq!(diagnostics.warning_count, 2);
    }

    #[test]
    fn retained_decode_warnings_are_bounded() {
        let mut channel_samples = vec![Vec::new()];
        let mut diagnostics = DecodeDiagnostics::default();

        for _ in 0..100 {
            append_decoded_packet(
                Err(SymphoniaError::DecodeError("corrupt frame")),
                &mut channel_samples,
                1,
                &mut diagnostics,
            )
            .expect("recoverable packet errors must not abort decoding");
        }

        assert_eq!(diagnostics.warning_count, 100);
        assert_eq!(diagnostics.warnings.len(), MAX_RETAINED_DECODE_WARNINGS);
    }

    #[test]
    fn decode_fails_when_no_audio_frames_survive() {
        let result = build_decoded_audio(
            48_000,
            2,
            vec![Vec::new(), Vec::new()],
            "test".to_string(),
            DecodeDiagnostics {
                warning_count: 2,
                warnings: vec!["first".to_string(), "second".to_string()],
            },
        );

        assert_eq!(
            result.expect_err("an all-corrupt file must fail"),
            "Audio file contains no decodable frames after skipping 2 corrupt packets"
        );
    }

    #[test]
    fn unrecoverable_packet_error_still_aborts_decode() {
        let mut channel_samples = vec![Vec::new()];
        let mut diagnostics = DecodeDiagnostics::default();

        let error = append_decoded_packet(
            Err(SymphoniaError::ResetRequired),
            &mut channel_samples,
            1,
            &mut diagnostics,
        )
        .expect_err("reset-required is not a recoverable packet error");

        assert_eq!(error, "Decode error: decoder needs to be reset");
        assert_eq!(diagnostics.warning_count, 0);
        assert!(diagnostics.warnings.is_empty());
    }
}
