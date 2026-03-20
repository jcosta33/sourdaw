use serde::{Deserialize, Serialize};
use std::io::Cursor;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

#[derive(Debug, Serialize, Deserialize)]
pub struct DecodedAudio {
    pub sample_rate: u32,
    pub channels: u32,
    pub samples: Vec<Vec<f32>>,
    pub duration_seconds: f64,
    pub codec: String,
}

/// Decode audio file bytes using symphonia.
/// Supports WAV, FLAC, MP3, OGG/Vorbis, AAC, ALAC, and more.
#[tauri::command]
pub async fn decode_audio_file(file_bytes: Vec<u8>) -> Result<DecodedAudio, String> {
    let cursor = Cursor::new(file_bytes);
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let hint = Hint::new();
    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();
    let decoder_opts = DecoderOptions::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| format!("Failed to probe audio format: {e}"))?;

    let mut format_reader = probed.format;

    let track = format_reader
        .default_track()
        .ok_or("No audio track found")?;

    let codec_name = track
        .codec_params
        .codec
        .to_string();

    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or("Unknown sample rate")?;

    let channels = track
        .codec_params
        .channels
        .map(|c| c.count() as u32)
        .unwrap_or(2);

    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &decoder_opts)
        .map_err(|e| format!("Failed to create decoder: {e}"))?;

    let mut channel_samples: Vec<Vec<f32>> = (0..channels).map(|_| Vec::new()).collect();

    loop {
        let packet = match format_reader.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => return Err(format!("Read error: {e}")),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = decoder
            .decode(&packet)
            .map_err(|e| format!("Decode error: {e}"))?;

        let spec = *decoded.spec();
        let num_frames = decoded.frames();
        let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        let samples = sample_buf.samples();

        for (frame_idx, chunk) in samples.chunks(channels as usize).enumerate() {
            let _ = frame_idx;
            for (ch, &s) in chunk.iter().enumerate() {
                if ch < channel_samples.len() {
                    channel_samples[ch].push(s);
                }
            }
        }
    }

    let total_samples = channel_samples.first().map(|c| c.len()).unwrap_or(0);
    let duration_seconds = total_samples as f64 / sample_rate as f64;

    Ok(DecodedAudio {
        sample_rate,
        channels,
        samples: channel_samples,
        duration_seconds,
        codec: codec_name,
    })
}

/// Stream-decode large audio files in chunks for disk streaming.
/// Returns metadata first, then streams chunks via Tauri channels.
#[derive(Debug, Serialize, Deserialize)]
pub struct AudioStreamMeta {
    pub sample_rate: u32,
    pub channels: u32,
    pub total_frames: u64,
    pub codec: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioChunk {
    pub offset_frames: u64,
    pub samples: Vec<Vec<f32>>,
}

#[tauri::command]
pub async fn get_audio_file_metadata(
    file_path: String,
) -> Result<AudioStreamMeta, String> {
    let file = std::fs::File::open(&file_path)
        .map_err(|e| format!("Failed to open file: {e}"))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let hint = Hint::new();
    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| format!("Failed to probe: {e}"))?;

    let track = probed
        .format
        .default_track()
        .ok_or("No audio track")?;

    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let channels = track.codec_params.channels.map(|c| c.count() as u32).unwrap_or(2);
    let total_frames = track.codec_params.n_frames.unwrap_or(0);
    let codec = track.codec_params.codec.to_string();

    Ok(AudioStreamMeta {
        sample_rate,
        channels,
        total_frames,
        codec,
    })
}
