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
///
/// This is accumulated lane by lane as packets arrive, never by splitting a
/// finished interleaved buffer — an interleaved intermediate would hold a
/// second full copy of the file's PCM alive for the length of the split.
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
/// Accumulated directly from the decoder's own interleaved packets, so callers
/// that want this layout never pay for a planar copy plus a re-interleave. Peak
/// footprint is one PCM buffer rather than two.
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
/// the entire file into memory before passing it over the desktop IPC boundary.
pub fn decode_audio_file(path: &str) -> Result<DecodedAudio, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open file: {e}"))?;
    build_planar_audio(decode_from_stream(MediaSourceStream::new(
        Box::new(file),
        Default::default(),
    ))?)
}

/// Decode audio from an in-memory byte buffer.
/// Use this when bytes are already loaded (e.g. from a network fetch or embedded archive).
pub fn decode_audio_file_bytes(file_bytes: Vec<u8>) -> Result<DecodedAudio, String> {
    build_planar_audio(decode_from_stream(MediaSourceStream::new(
        Box::new(Cursor::new(file_bytes)),
        Default::default(),
    ))?)
}

/// Decode audio from an in-memory byte buffer straight into the interleaved
/// layout.
///
/// Prefer this over `decode_audio_file_bytes` when the consumer wants
/// interleaved PCM (the browser/wasm path): it hands back exactly what the
/// decoder produced, with no per-frame scatter into lanes.
pub fn decode_audio_file_bytes_interleaved(
    file_bytes: Vec<u8>,
) -> Result<InterleavedAudio, String> {
    build_interleaved_audio(decode_from_stream(MediaSourceStream::new(
        Box::new(Cursor::new(file_bytes)),
        Default::default(),
    ))?)
}

/// Everything a finished decode carries, before it is shaped into a layout.
struct DecodedStream<A> {
    sample_rate: u32,
    codec: String,
    accumulator: A,
    diagnostics: DecodeDiagnostics,
}

fn decode_from_stream<A: PacketAccumulator>(
    mss: MediaSourceStream,
) -> Result<DecodedStream<A>, String> {
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
    // disagrees with the in-band configuration — a CAF audio description
    // against an ALAC magic cookie, say, which symphonia cross-checks against
    // nothing — would otherwise smear the stream across the wrong lanes with
    // nothing reported. The layout count comes from each decoded packet
    // instead.
    channel_count(audio_params)?;
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(audio_params, &decoder_opts)
        .map_err(|e| format!("Failed to create decoder: {e}"))?;

    let mut accumulator = A::default();
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

    Ok(DecodedStream {
        sample_rate,
        codec: codec_name,
        accumulator,
        diagnostics,
    })
}

/// One decoded packet together with the channel count its own spec declares.
struct DecodedPacket {
    channels: u32,
    interleaved: Vec<f32>,
}

/// The channel bookkeeping every accumulator shares.
///
/// Two invariants hold for every buffer that leaves an accumulator: the channel
/// count is the decoder's and is identical across every packet, and only whole
/// frames are kept — a truncated trailing frame is dropped rather than left to
/// skew one lane against another. Both layouts answer to the same rules, so
/// they answer to the same code.
#[derive(Default)]
struct ChannelLayout {
    channels: Option<u32>,
}

impl ChannelLayout {
    /// Establish or confirm the stream's channel count and hand back the
    /// packet's whole-frame prefix.
    fn whole_frames<'packet>(
        &mut self,
        packet: &'packet DecodedPacket,
    ) -> Result<&'packet [f32], String> {
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

        Ok(&packet.interleaved[..whole_frames])
    }

    /// The established channel count, or zero when no packet ever arrived.
    fn channel_count(&self) -> u32 {
        self.channels.unwrap_or(0)
    }
}

/// A sink for decoded packets in one PCM layout.
///
/// Each layout accumulates in its own final shape as packets arrive, so a
/// decode never materializes the file's PCM twice.
trait PacketAccumulator: Default {
    fn append(&mut self, packet: DecodedPacket) -> Result<(), String>;
}

/// Accumulates decoded packets as one interleaved buffer.
#[derive(Default)]
struct InterleavedAccumulator {
    layout: ChannelLayout,
    samples: Vec<f32>,
}

impl PacketAccumulator for InterleavedAccumulator {
    fn append(&mut self, packet: DecodedPacket) -> Result<(), String> {
        let frames = self.layout.whole_frames(&packet)?;
        self.samples.extend_from_slice(frames);

        Ok(())
    }
}

/// Accumulates decoded packets as per-channel lanes, deinterleaving each packet
/// as it arrives.
///
/// Splitting a finished interleaved buffer instead would hold the whole file's
/// PCM in both layouts at once, doubling peak memory for exactly as long as the
/// split takes.
#[derive(Default)]
struct PlanarAccumulator {
    layout: ChannelLayout,
    lanes: Vec<Vec<f32>>,
}

impl PacketAccumulator for PlanarAccumulator {
    fn append(&mut self, packet: DecodedPacket) -> Result<(), String> {
        let frames = self.layout.whole_frames(&packet)?;
        let frame_size = packet.channels as usize;

        if self.lanes.is_empty() {
            self.lanes.resize_with(frame_size, Vec::new);
        }

        for frame in frames.chunks_exact(frame_size) {
            for (lane, &sample) in self.lanes.iter_mut().zip(frame) {
                lane.push(sample);
            }
        }

        Ok(())
    }
}

/// Duration of a decode, or the reason it produced nothing usable.
fn decoded_duration(
    total_frames: usize,
    sample_rate: u32,
    diagnostics: &DecodeDiagnostics,
) -> Result<f64, String> {
    if total_frames == 0 {
        if diagnostics.warning_count > 0 {
            return Err(format!(
                "Audio file contains no decodable frames after skipping {} corrupt packets",
                diagnostics.warning_count
            ));
        }
        return Err("Audio file contains no decodable frames".to_string());
    }

    Ok(total_frames as f64 / sample_rate as f64)
}

fn build_interleaved_audio(
    stream: DecodedStream<InterleavedAccumulator>,
) -> Result<InterleavedAudio, String> {
    let channels = stream.accumulator.layout.channel_count();
    let total_frames = if channels == 0 {
        0
    } else {
        stream.accumulator.samples.len() / channels as usize
    };
    let duration_seconds = decoded_duration(total_frames, stream.sample_rate, &stream.diagnostics)?;

    Ok(InterleavedAudio {
        sample_rate: stream.sample_rate,
        channels,
        interleaved: stream.accumulator.samples,
        duration_seconds,
        codec: stream.codec,
        decode_warning_count: stream.diagnostics.warning_count,
        decode_warnings: stream.diagnostics.warnings,
    })
}

fn build_planar_audio(stream: DecodedStream<PlanarAccumulator>) -> Result<DecodedAudio, String> {
    let channels = stream.accumulator.layout.channel_count();
    let total_frames = stream.accumulator.lanes.first().map_or(0, Vec::len);
    let duration_seconds = decoded_duration(total_frames, stream.sample_rate, &stream.diagnostics)?;

    Ok(DecodedAudio {
        sample_rate: stream.sample_rate,
        channels,
        samples: stream.accumulator.lanes,
        duration_seconds,
        codec: stream.codec,
        decode_warning_count: stream.diagnostics.warning_count,
        decode_warnings: stream.diagnostics.warnings,
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

fn append_decoded_packet<A: PacketAccumulator>(
    decoded: Result<DecodedPacket, SymphoniaError>,
    accumulator: &mut A,
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

    /// A complete single-channel 16-bit PCM WAV carrying `samples`.
    ///
    /// Real bytes through the real probe and the real decoder — the container
    /// wiring is only exercised by a stream symphonia actually reads.
    fn pcm_wav(sample_rate: u32, samples: &[i16]) -> Vec<u8> {
        let data_len = (samples.len() * 2) as u32;
        let mut bytes = Vec::with_capacity(44 + data_len as usize);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
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
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        bytes
    }

    fn pcm_wav_with_sample_rate(sample_rate: u32) -> Vec<u8> {
        pcm_wav(sample_rate, &[0])
    }

    /// Big-endian bit writer, for the one fixture whose payload is a bitstream.
    #[derive(Default)]
    struct BitWriter {
        bytes: Vec<u8>,
        free_bits: u32,
    }

    impl BitWriter {
        fn write(&mut self, value: u32, bits: u32) {
            for index in (0..bits).rev() {
                if self.free_bits == 0 {
                    self.bytes.push(0);
                    self.free_bits = 8;
                }
                let bit = ((value >> index) & 1) as u8;
                *self.bytes.last_mut().expect("a byte is always open") |=
                    bit << (self.free_bits - 1);
                self.free_bits -= 1;
            }
        }
    }

    /// One uncompressed ALAC single-channel element carrying `samples`.
    ///
    /// The uncompressed path writes the samples straight into the bitstream, so
    /// no predictor or rice coder is involved.
    fn alac_mono_frame(samples: &[i16]) -> Vec<u8> {
        let mut writer = BitWriter::default();
        writer.write(0, 3); // Single channel element.
        writer.write(0, 4); // Element instance tag.
        writer.write(0, 12); // Unused header bits.
        writer.write(0, 1); // Not a partial frame.
        writer.write(0, 2); // No sample shift.
        writer.write(1, 1); // Uncompressed.
        for sample in samples {
            writer.write(*sample as u16 as u32, 16);
        }
        writer.bytes
    }

    /// A CAF file whose audio description declares `container_channels` while
    /// its ALAC magic cookie declares one.
    ///
    /// CAF takes the channel count from the audio description chunk and hands
    /// the magic cookie to the decoder untouched, cross-checking neither — so
    /// this is a file a real decoder reads while the container lies about its
    /// shape. Nothing else in symphonia's supported set lets the two disagree:
    /// FLAC's parser refuses frames that contradict STREAMINFO, and the MP4
    /// reader takes ALAC's channel count from the magic cookie itself.
    fn alac_caf(container_channels: u32, samples: &[i16]) -> Vec<u8> {
        const SAMPLE_RATE: u32 = 48_000;
        let frame = alac_mono_frame(samples);
        let frames = samples.len() as u32;

        let mut description = Vec::new();
        description.extend_from_slice(&f64::from(SAMPLE_RATE).to_be_bytes());
        description.extend_from_slice(b"alac");
        description.extend_from_slice(&0u32.to_be_bytes()); // Format flags.
        description.extend_from_slice(&(frame.len() as u32).to_be_bytes()); // Bytes per packet.
        description.extend_from_slice(&frames.to_be_bytes()); // Frames per packet.
        description.extend_from_slice(&container_channels.to_be_bytes());
        description.extend_from_slice(&16u32.to_be_bytes()); // Bits per channel.

        let mut cookie = Vec::new();
        cookie.extend_from_slice(&frames.to_be_bytes()); // Frame length.
        cookie.push(0); // Compatible version.
        cookie.push(16); // Bit depth.
        cookie.extend_from_slice(&[40, 10, 14]); // Rice parameters.
        cookie.push(1); // Channels the decoder will actually produce.
        cookie.extend_from_slice(&255u16.to_be_bytes()); // Max run.
        cookie.extend_from_slice(&(frame.len() as u32).to_be_bytes()); // Max frame bytes.
        cookie.extend_from_slice(&0u32.to_be_bytes()); // Average bit rate.
        cookie.extend_from_slice(&SAMPLE_RATE.to_be_bytes());

        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"caff");
        bytes.extend_from_slice(&1u16.to_be_bytes()); // File version.
        bytes.extend_from_slice(&0u16.to_be_bytes()); // File flags.
        for (id, payload) in [(b"desc", &description), (b"kuki", &cookie)] {
            bytes.extend_from_slice(id);
            bytes.extend_from_slice(&(payload.len() as i64).to_be_bytes());
            bytes.extend_from_slice(payload);
        }
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&((frame.len() + 4) as i64).to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes()); // Edit count.
        bytes.extend_from_slice(&frame);
        bytes
    }

    fn stream<A>(
        sample_rate: u32,
        accumulator: A,
        diagnostics: DecodeDiagnostics,
    ) -> DecodedStream<A> {
        DecodedStream {
            sample_rate,
            codec: "test".to_string(),
            accumulator,
            diagnostics,
        }
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
        let mut accumulator = PlanarAccumulator::default();
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

        let audio = build_planar_audio(stream(48_000, accumulator, diagnostics))
            .expect("surviving frames must decode");
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
        let mut accumulator = PlanarAccumulator::default();
        let mut diagnostics = DecodeDiagnostics::default();

        append_decoded_packet(
            packet(3, vec![0.1, 1.1, 2.1, 0.2, 1.2, 2.2]),
            &mut accumulator,
            &mut diagnostics,
        )
        .expect("a well-formed packet must be accepted");

        let audio = build_planar_audio(stream(48_000, accumulator, diagnostics))
            .expect("decode must succeed");

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
        // with fabricated silence. Both accumulators own the rule, so both are
        // asked to honour it.
        let mut interleaved = InterleavedAccumulator::default();
        let mut planar = PlanarAccumulator::default();
        let mut diagnostics = DecodeDiagnostics::default();

        append_decoded_packet(
            packet(2, vec![0.1, 1.1, 0.2]),
            &mut interleaved,
            &mut diagnostics,
        )
        .expect("a ragged packet must be accepted after truncation");
        append_decoded_packet(
            packet(2, vec![0.1, 1.1, 0.2]),
            &mut planar,
            &mut diagnostics,
        )
        .expect("a ragged packet must be accepted after truncation");

        let audio =
            build_interleaved_audio(stream(48_000, interleaved, DecodeDiagnostics::default()))
                .expect("decode must succeed");

        assert_eq!(audio.interleaved, vec![0.1, 1.1]);
        assert_eq!(audio.frame_count(), 1);
        assert_eq!(
            build_planar_audio(stream(48_000, planar, diagnostics))
                .expect("decode must succeed")
                .samples,
            vec![vec![0.1], vec![1.1]]
        );
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
        let result = build_interleaved_audio(stream(
            48_000,
            InterleavedAccumulator {
                layout: ChannelLayout { channels: Some(2) },
                samples: Vec::new(),
            },
            DecodeDiagnostics {
                warning_count: 2,
                warnings: vec!["first".to_string(), "second".to_string()],
            },
        ));

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

    /// The only test that runs a real container through the real probe and the
    /// real decoder. Everything else hands an accumulator fabricated packets,
    /// which cannot catch a break between the format reader, the decoder, and
    /// the layout the caller receives.
    #[test]
    fn a_pcm_wav_stream_decodes_end_to_end_in_both_layouts() {
        let pcm: [i16; 5] = [0, 8_192, -8_192, 16_384, i16::MIN];
        let expected: Vec<f32> = pcm.iter().map(|s| f32::from(*s) / 32_768.0).collect();

        let planar = decode_audio_file_bytes(pcm_wav(48_000, &pcm))
            .expect("a well-formed PCM WAV must decode");

        assert_eq!(planar.channels, 1);
        assert_eq!(planar.sample_rate, 48_000);
        assert_eq!(planar.samples, vec![expected.clone()]);
        assert_eq!(planar.duration_seconds, 5.0 / 48_000.0);
        assert_eq!(planar.decode_warning_count, 0);
        assert!(planar.decode_warnings.is_empty());

        let interleaved = decode_audio_file_bytes_interleaved(pcm_wav(48_000, &pcm))
            .expect("a well-formed PCM WAV must decode");

        assert_eq!(interleaved.channels, planar.channels);
        assert_eq!(interleaved.sample_rate, planar.sample_rate);
        assert_eq!(interleaved.interleaved, expected);
        assert_eq!(interleaved.frame_count(), pcm.len());
        assert_eq!(interleaved.duration_seconds, planar.duration_seconds);
        assert_eq!(interleaved.codec, planar.codec);
    }

    /// The container's channel declaration must not lay out the samples.
    ///
    /// A CAF/ALAC file can declare one channel count in its audio description
    /// and another in the magic cookie the decoder reads; symphonia checks
    /// neither against the other. Laying the stream out by the container's
    /// count would smear a mono stream across two lanes and report the wrong
    /// channel count downstream, with nothing raised anywhere.
    ///
    /// Two different lies produce the same mono result, so the decode is
    /// demonstrably not consulting the container at all — not merely agreeing
    /// with it by coincidence.
    #[test]
    fn the_decoded_spec_lays_out_the_stream_when_the_container_disagrees() {
        let pcm: [i16; 8] = [0, 4_096, -4_096, 8_192, -8_192, 16_384, i16::MIN, i16::MAX];
        let expected: Vec<Vec<f32>> = vec![pcm.iter().map(|s| f32::from(*s) / 32_768.0).collect()];

        for container_channels in [2, 3] {
            let audio = decode_audio_file_bytes(alac_caf(container_channels, &pcm)).unwrap_or_else(
                |error| {
                    panic!("a CAF declaring {container_channels} channels must decode: {error}")
                },
            );

            assert_eq!(
                audio.channels, 1,
                "the decoder produced one channel; the container claimed {container_channels}"
            );
            assert_eq!(audio.samples, expected);
            assert_eq!(audio.duration_seconds, 8.0 / 48_000.0);
        }
    }

    /// A decode's peak footprint is the PCM it produces. Building the
    /// interleaved buffer first and splitting it into lanes afterwards holds
    /// both layouts alive at once, so the peak is 2× the file's PCM — on a long
    /// import that is the difference between fitting in memory and not.
    ///
    /// The allocator counts a `realloc` as its net change, so ordinary `Vec`
    /// growth does not register as a transient second copy; what this measures
    /// is a second buffer genuinely alive at the same time as the first.
    #[test]
    fn decoding_planar_never_holds_a_second_copy_of_the_pcm() {
        const FRAMES: usize = 1 << 20;
        let pcm_bytes = FRAMES * std::mem::size_of::<f32>();
        let file_bytes = pcm_wav(48_000, &vec![0i16; FRAMES]);

        let (audio, peak_bytes) = peak_allocation::measure(|| {
            decode_audio_file_bytes(file_bytes).expect("the fixture must decode")
        });

        assert_eq!(audio.channels, 1);
        assert_eq!(audio.samples.len(), 1);
        assert_eq!(audio.samples[0].len(), FRAMES);
        // Measured: ~1.02× decoding into lanes, ~1.63× when the interleaved
        // buffer is built first and split afterwards. The bound sits between
        // them with room for the decoder's own working buffers.
        assert!(
            peak_bytes < pcm_bytes * 5 / 4,
            "planar decode peaked at {peak_bytes} bytes holding {pcm_bytes} bytes of PCM: \
             a second full copy of the buffer is alive at the same time as the first"
        );
    }
}

#[cfg(test)]
#[global_allocator]
static PEAK_TRACKING_ALLOCATOR: peak_allocation::PeakTracking = peak_allocation::PeakTracking;

/// Per-thread peak heap measurement, so a memory claim about the decoder can be
/// asserted instead of asserted-about.
///
/// The counters are thread-local, which keeps concurrently running tests out of
/// each other's measurement, and `realloc` is booked as its net size change, so
/// a growing `Vec` is not mistaken for two live buffers.
#[cfg(test)]
mod peak_allocation {
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;

    thread_local! {
        static LIVE: Cell<isize> = const { Cell::new(0) };
        static PEAK: Cell<isize> = const { Cell::new(0) };
    }

    pub struct PeakTracking;

    unsafe impl GlobalAlloc for PeakTracking {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            let ptr = unsafe { System.alloc(layout) };
            if !ptr.is_null() {
                record(layout.size() as isize);
            }
            ptr
        }

        unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
            unsafe { System.dealloc(ptr, layout) };
            record(-(layout.size() as isize));
        }

        unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
            let next = unsafe { System.realloc(ptr, layout, new_size) };
            if !next.is_null() {
                record(new_size as isize - layout.size() as isize);
            }
            next
        }
    }

    fn record(delta: isize) {
        let _ = LIVE.try_with(|live| {
            let next = live.get() + delta;
            live.set(next);
            let _ = PEAK.try_with(|peak| {
                if next > peak.get() {
                    peak.set(next);
                }
            });
        });
    }

    /// Run `body` and report the high-water mark of heap bytes it held live on
    /// this thread, over and above what was already live when it started.
    pub fn measure<T>(body: impl FnOnce() -> T) -> (T, usize) {
        let baseline = LIVE.with(Cell::get);
        PEAK.with(|peak| peak.set(baseline));

        let value = body();

        let peak = PEAK.with(Cell::get);
        (value, (peak - baseline).max(0) as usize)
    }
}
