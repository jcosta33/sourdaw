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
const MAX_RECOVERABLE_PACKET_ERRORS: u64 = 256;

/// Decoded PCM in the per-channel (planar) layout.
///
/// Every channel holds exactly the same number of samples: the decoder only
/// accumulates whole frames, so a truncated trailing frame is dropped rather
/// than leaving the leading lanes one sample longer than the trailing ones.
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

/// Decoded PCM as a single interleaved buffer — the layout Web Audio and the
/// wasm bridge consume.
///
/// This is the shape the decoder accumulates natively. Callers that want the
/// interleaved layout take it directly instead of paying for a planar copy plus
/// a re-interleave, so the peak footprint is one PCM buffer rather than two.
#[derive(Debug)]
pub struct InterleavedAudio {
    pub sample_rate: u32,
    /// Channel count reported by the *decoder*, not by the container.
    pub channels: u32,
    /// `[L0, R0, L1, R1, …]`; length is always `channels * frame_count`.
    pub interleaved: Vec<f32>,
    pub duration_seconds: f64,
    pub codec: String,
    /// Total recoverable packets discarded while decoding this file.
    pub decode_warning_count: u64,
    /// Recoverable packet corruption encountered while decoding this file.
    pub decode_warnings: Vec<String>,
}

impl InterleavedAudio {
    /// Frames present in the buffer. Zero when the channel count is zero.
    pub fn frame_count(&self) -> usize {
        if self.channels == 0 {
            return 0;
        }
        self.interleaved.len() / self.channels as usize
    }
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
    decode_from_stream(MediaSourceStream::new(Box::new(file), Default::default())).map(to_planar)
}

/// Decode audio from an in-memory byte buffer.
/// Use this when bytes are already loaded (e.g. from a network fetch or embedded archive).
pub fn decode_audio_file_bytes(file_bytes: Vec<u8>) -> Result<DecodedAudio, String> {
    decode_audio_file_bytes_interleaved(file_bytes).map(to_planar)
}

/// Decode audio from an in-memory byte buffer straight into the interleaved
/// layout, skipping the planar intermediate entirely.
///
/// Prefer this over `decode_audio_file_bytes` when the consumer wants
/// interleaved PCM (the browser/wasm path): it halves peak PCM memory, because
/// the decoded file is never held in both layouts at once.
pub fn decode_audio_file_bytes_interleaved(
    file_bytes: Vec<u8>,
) -> Result<InterleavedAudio, String> {
    decode_from_stream(MediaSourceStream::new(
        Box::new(Cursor::new(file_bytes)),
        Default::default(),
    ))
}

/// Split an interleaved buffer into per-channel lanes.
///
/// `InterleavedAudio` is only ever produced with `channels >= 1` and a length
/// that is an exact multiple of it, so every lane comes out the same length.
fn to_planar(audio: InterleavedAudio) -> DecodedAudio {
    let channels = audio.channels.max(1) as usize;
    let frames = audio.interleaved.len() / channels;
    let mut samples: Vec<Vec<f32>> = (0..channels).map(|_| Vec::with_capacity(frames)).collect();

    for frame in audio.interleaved.chunks_exact(channels) {
        for (channel, &sample) in frame.iter().enumerate() {
            samples[channel].push(sample);
        }
    }

    DecodedAudio {
        sample_rate: audio.sample_rate,
        channels: audio.channels,
        samples,
        duration_seconds: audio.duration_seconds,
        codec: audio.codec,
        decode_warning_count: audio.decode_warning_count,
        decode_warnings: audio.decode_warnings,
    }
}

fn decode_from_stream(mss: MediaSourceStream) -> Result<InterleavedAudio, String> {
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
    // The container's declaration is validated here (a zero-channel track is
    // rejected before any decode work) but it never lays out samples: symphonia
    // interleaves per the *decoded* buffer's spec, and a container that
    // disagrees with the in-band configuration — an ALAC magic cookie, say —
    // would otherwise smear the stream across the wrong lanes with nothing
    // reported. The layout count comes from each decoded packet instead.
    channel_count(audio_params)?;
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(audio_params, &decoder_opts)
        .map_err(|e| format!("Failed to create decoder: {e}"))?;

    let mut accumulator = InterleavedAccumulator::default();
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
            let channels = decoded.spec().channels().count() as u32;
            let mut interleaved = Vec::new();
            decoded.copy_to_vec_interleaved(&mut interleaved);
            DecodedPacket {
                channels,
                interleaved,
            }
        });
        append_decoded_packet(decoded, &mut accumulator, &mut diagnostics)?;
    }

    build_interleaved_audio(sample_rate, accumulator, codec_name, diagnostics)
}

/// One decoded packet together with the channel count its own spec declares.
struct DecodedPacket {
    channels: u32,
    interleaved: Vec<f32>,
}

/// Accumulates decoded packets as one interleaved buffer.
///
/// Two invariants hold for every buffer that leaves here: the channel count is
/// the decoder's and is identical across every packet, and the sample count is
/// an exact multiple of it — a truncated trailing frame is dropped rather than
/// left to skew one lane against another.
#[derive(Default)]
struct InterleavedAccumulator {
    channels: Option<u32>,
    samples: Vec<f32>,
}

impl InterleavedAccumulator {
    fn append(&mut self, packet: DecodedPacket) -> Result<(), String> {
        if packet.channels == 0 {
            return Err("Decoded packet declares zero channels".to_string());
        }

        match self.channels {
            None => self.channels = Some(packet.channels),
            Some(established) if established != packet.channels => {
                return Err(format!(
                    "Audio stream changes channel count mid-file: {} then {}",
                    established, packet.channels
                ));
            }
            Some(_) => {}
        }

        let frame_size = packet.channels as usize;
        let whole_frames = packet.interleaved.len() - packet.interleaved.len() % frame_size;
        self.samples
            .extend_from_slice(&packet.interleaved[..whole_frames]);

        Ok(())
    }
}

fn build_interleaved_audio(
    sample_rate: u32,
    accumulator: InterleavedAccumulator,
    codec: String,
    diagnostics: DecodeDiagnostics,
) -> Result<InterleavedAudio, String> {
    let channels = accumulator.channels.unwrap_or(0);
    let total_frames = if channels == 0 {
        0
    } else {
        accumulator.samples.len() / channels as usize
    };

    if total_frames == 0 {
        if diagnostics.warning_count > 0 {
            return Err(format!(
                "Audio file contains no decodable frames after skipping {} corrupt packets",
                diagnostics.warning_count
            ));
        }
        return Err("Audio file contains no decodable frames".to_string());
    }
    let duration_seconds = total_frames as f64 / sample_rate as f64;

    Ok(InterleavedAudio {
        sample_rate,
        channels,
        interleaved: accumulator.samples,
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
    decoded: Result<DecodedPacket, SymphoniaError>,
    accumulator: &mut InterleavedAccumulator,
    diagnostics: &mut DecodeDiagnostics,
) -> Result<(), String> {
    let packet = match decoded {
        Ok(packet) => packet,
        Err(error @ SymphoniaError::DecodeError(_)) | Err(error @ SymphoniaError::IoError(_)) => {
            if diagnostics.warning_count >= MAX_RECOVERABLE_PACKET_ERRORS {
                return Err(format!(
                    "Audio decode aborted after {MAX_RECOVERABLE_PACKET_ERRORS} recoverable packet errors"
                ));
            }
            diagnostics.record(&error);
            return Ok(());
        }
        Err(error) => return Err(format!("Decode error: {error}")),
    };

    accumulator.append(packet)
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

    fn packet(channels: u32, interleaved: Vec<f32>) -> Result<DecodedPacket, SymphoniaError> {
        Ok(DecodedPacket {
            channels,
            interleaved,
        })
    }

    #[test]
    fn recoverable_packet_errors_are_reported_without_aborting_later_packets() {
        let mut accumulator = InterleavedAccumulator::default();
        let mut diagnostics = DecodeDiagnostics::default();
        let packets = [
            packet(2, vec![0.1, 1.1]),
            Err(SymphoniaError::DecodeError("corrupt frame")),
            Err(SymphoniaError::IoError(IoError::new(
                ErrorKind::UnexpectedEof,
                "truncated frame",
            ))),
            packet(2, vec![0.2, 1.2]),
        ];

        for packet in packets {
            append_decoded_packet(packet, &mut accumulator, &mut diagnostics)
                .expect("recoverable packet errors must not abort decoding");
        }

        let audio = to_planar(
            build_interleaved_audio(48_000, accumulator, "test".to_string(), diagnostics)
                .expect("surviving frames must decode"),
        );
        assert_eq!(audio.samples, vec![vec![0.1, 0.2], vec![1.1, 1.2]]);
        assert_eq!(
            audio.decode_warnings,
            vec!["malformed stream: corrupt frame", "truncated frame",]
        );
        assert_eq!(audio.decode_warning_count, 2);
    }

    #[test]
    fn retained_decode_warnings_are_bounded() {
        let mut accumulator = InterleavedAccumulator::default();
        let mut diagnostics = DecodeDiagnostics::default();

        for _ in 0..100 {
            append_decoded_packet(
                Err(SymphoniaError::DecodeError("corrupt frame")),
                &mut accumulator,
                &mut diagnostics,
            )
            .expect("recoverable packet errors must not abort decoding");
        }

        assert_eq!(diagnostics.warning_count, 100);
        assert_eq!(diagnostics.warnings.len(), MAX_RETAINED_DECODE_WARNINGS);
    }

    #[test]
    fn decoded_packet_spec_lays_out_the_lanes_not_the_container_declaration() {
        // The container declares stereo (the `channel_count` default when it
        // omits the field); the decoder hands back 3-channel packets. Splitting
        // by the container count would smear the stream across two lanes and
        // report `channels: 2` downstream.
        let mut accumulator = InterleavedAccumulator::default();
        let mut diagnostics = DecodeDiagnostics::default();

        append_decoded_packet(
            packet(3, vec![0.1, 1.1, 2.1, 0.2, 1.2, 2.2]),
            &mut accumulator,
            &mut diagnostics,
        )
        .expect("a well-formed packet must be accepted");

        let audio = to_planar(
            build_interleaved_audio(48_000, accumulator, "test".to_string(), diagnostics)
                .expect("decode must succeed"),
        );

        assert_eq!(audio.channels, 3);
        assert_eq!(
            audio.samples,
            vec![vec![0.1, 0.2], vec![1.1, 1.2], vec![2.1, 2.2]]
        );
    }

    #[test]
    fn a_packet_that_changes_the_channel_count_aborts_the_decode() {
        let mut accumulator = InterleavedAccumulator::default();
        let mut diagnostics = DecodeDiagnostics::default();

        append_decoded_packet(
            packet(2, vec![0.1, 1.1]),
            &mut accumulator,
            &mut diagnostics,
        )
        .expect("the first packet establishes the channel count");

        let error = append_decoded_packet(packet(1, vec![0.2]), &mut accumulator, &mut diagnostics)
            .expect_err("a mid-stream channel-count change must not be absorbed silently");

        assert_eq!(
            error,
            "Audio stream changes channel count mid-file: 2 then 1"
        );
    }

    #[test]
    fn a_truncated_trailing_frame_is_dropped_instead_of_skewing_the_lanes() {
        // A partial final frame used to land in the leading channels only,
        // leaving lanes of unequal length that the wasm bridge then zero-padded
        // with fabricated silence.
        let mut accumulator = InterleavedAccumulator::default();
        let mut diagnostics = DecodeDiagnostics::default();

        append_decoded_packet(
            packet(2, vec![0.1, 1.1, 0.2]),
            &mut accumulator,
            &mut diagnostics,
        )
        .expect("a ragged packet must be accepted after truncation");

        let audio = build_interleaved_audio(48_000, accumulator, "test".to_string(), diagnostics)
            .expect("decode must succeed");

        assert_eq!(audio.interleaved, vec![0.1, 1.1]);
        assert_eq!(audio.frame_count(), 1);
        assert_eq!(to_planar(audio).samples, vec![vec![0.1], vec![1.1]]);
    }

    #[test]
    fn recoverable_packet_errors_abort_at_the_work_budget() {
        let mut accumulator = InterleavedAccumulator::default();
        let mut diagnostics = DecodeDiagnostics::default();

        for _ in 0..MAX_RECOVERABLE_PACKET_ERRORS {
            append_decoded_packet(
                Err(SymphoniaError::DecodeError("corrupt frame")),
                &mut accumulator,
                &mut diagnostics,
            )
            .expect("errors within the recovery budget remain recoverable");
        }

        let error = append_decoded_packet(
            Err(SymphoniaError::DecodeError("corrupt frame")),
            &mut accumulator,
            &mut diagnostics,
        )
        .expect_err("the first packet beyond the recovery budget must abort");

        assert_eq!(
            error,
            "Audio decode aborted after 256 recoverable packet errors"
        );
    }

    #[test]
    fn decode_fails_when_no_audio_frames_survive() {
        let result = build_interleaved_audio(
            48_000,
            InterleavedAccumulator {
                channels: Some(2),
                samples: Vec::new(),
            },
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
        let mut accumulator = InterleavedAccumulator::default();
        let mut diagnostics = DecodeDiagnostics::default();

        let error = append_decoded_packet(
            Err(SymphoniaError::ResetRequired),
            &mut accumulator,
            &mut diagnostics,
        )
        .expect_err("reset-required is not a recoverable packet error");

        assert_eq!(error, "Decode error: decoder needs to be reset");
        assert_eq!(diagnostics.warning_count, 0);
        assert!(diagnostics.warnings.is_empty());
    }
}
