use serde::{Deserialize, Serialize};
use std::io::Cursor;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::codecs::CodecParameters;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

#[derive(Debug, Serialize, Deserialize)]
pub struct DecodedAudio {
    pub sample_rate: u32,
    pub channels: u32,
    pub samples: Vec<Vec<f32>>,
    pub duration_seconds: f64,
    pub codec: String,
    /// Recoverable packet corruption encountered while decoding this file.
    #[serde(default)]
    pub decode_warnings: Vec<String>,
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
    let channels = channel_count(audio_params)?;
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(audio_params, &decoder_opts)
        .map_err(|e| format!("Failed to create decoder: {e}"))?;

    let mut channel_samples: Vec<Vec<f32>> = (0..channels).map(|_| Vec::new()).collect();
    let mut decode_warnings = Vec::new();

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
        append_decoded_packet(
            decoded,
            &mut channel_samples,
            channels,
            &mut decode_warnings,
        )?;
    }

    let total_samples = channel_samples.first().map(|c| c.len()).unwrap_or(0);
    let duration_seconds = total_samples as f64 / sample_rate as f64;

    Ok(DecodedAudio {
        sample_rate,
        channels,
        samples: channel_samples,
        duration_seconds,
        codec: codec_name,
        decode_warnings,
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
    decode_warnings: &mut Vec<String>,
) -> Result<(), String> {
    let interleaved = match decoded {
        Ok(interleaved) => interleaved,
        Err(error @ SymphoniaError::DecodeError(_)) | Err(error @ SymphoniaError::IoError(_)) => {
            decode_warnings.push(format!("Skipped corrupt audio packet: {error}"));
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
        let mut decode_warnings = Vec::new();
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
            append_decoded_packet(packet, &mut channel_samples, 2, &mut decode_warnings)
                .expect("recoverable packet errors must not abort decoding");
        }

        assert_eq!(channel_samples, vec![vec![0.1, 0.2], vec![1.1, 1.2]]);
        assert_eq!(
            decode_warnings,
            vec![
                "Skipped corrupt audio packet: malformed stream: corrupt frame",
                "Skipped corrupt audio packet: truncated frame",
            ]
        );
    }

    #[test]
    fn unrecoverable_packet_error_still_aborts_decode() {
        let mut channel_samples = vec![Vec::new()];
        let mut decode_warnings = Vec::new();

        let error = append_decoded_packet(
            Err(SymphoniaError::ResetRequired),
            &mut channel_samples,
            1,
            &mut decode_warnings,
        )
        .expect_err("reset-required is not a recoverable packet error");

        assert_eq!(error, "Decode error: decoder needs to be reset");
        assert!(decode_warnings.is_empty());
    }
}
