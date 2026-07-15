use std::path::{Path, PathBuf};

use daw_io::{AudioStreamMeta, DecodedAudio};
use serde::Serialize;

use super::filesystem;

#[derive(Debug, Serialize)]
pub struct DecodedAudioResponse {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u32,
    pub duration_ms: f64,
    pub total_frames: u64,
}

impl From<DecodedAudio> for DecodedAudioResponse {
    fn from(decoded: DecodedAudio) -> Self {
        let channels = decoded.channels as usize;
        let total_frames = decoded.samples.first().map_or(0, Vec::len);
        let mut samples = Vec::with_capacity(total_frames.saturating_mul(channels));

        for frame in 0..total_frames {
            for channel in 0..channels {
                let sample = decoded
                    .samples
                    .get(channel)
                    .and_then(|channel_samples| channel_samples.get(frame))
                    .copied()
                    .unwrap_or(0.0);
                samples.push(sample);
            }
        }

        Self {
            samples,
            sample_rate: decoded.sample_rate,
            channels: decoded.channels,
            duration_ms: decoded.duration_seconds * 1000.0,
            total_frames: total_frames as u64,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AudioFileInfoResponse {
    pub path: String,
    pub name: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub duration_ms: f64,
    pub total_frames: u64,
    pub codec: String,
    pub size_bytes: u64,
}

fn resolve_audio_metadata(file_path: &str) -> Result<(PathBuf, AudioStreamMeta), String> {
    let resolved_path = filesystem::resolve_existing_file_path(file_path)?;
    let path_string = resolved_path.to_string_lossy().into_owned();
    let metadata = daw_io::get_audio_file_metadata(&path_string)?;
    Ok((resolved_path, metadata))
}

fn map_audio_file_info(
    path: &Path,
    size_bytes: u64,
    metadata: AudioStreamMeta,
) -> Result<AudioFileInfoResponse, String> {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .ok_or_else(|| "Audio file path has no file name".to_string())?;
    let duration_ms = if metadata.sample_rate == 0 {
        0.0
    } else {
        metadata.total_frames as f64 * 1000.0 / metadata.sample_rate as f64
    };

    Ok(AudioFileInfoResponse {
        path: path.to_string_lossy().into_owned(),
        name,
        sample_rate: metadata.sample_rate,
        channels: metadata.channels,
        duration_ms,
        total_frames: metadata.total_frames,
        codec: metadata.codec,
        size_bytes,
    })
}

/// Decode an audio file from disk. Supports WAV, FLAC, MP3, OGG/Vorbis, AAC, ALAC, and more.
/// Takes a file path rather than bytes to avoid loading the entire file through the IPC boundary.
#[tauri::command]
pub async fn decode_audio_file(file_path: String) -> Result<DecodedAudioResponse, String> {
    let file_path = filesystem::resolve_existing_file_path(&file_path)?;
    let file_path = file_path.to_string_lossy().to_string();
    daw_io::decode_audio_file(&file_path).map(DecodedAudioResponse::from)
}

/// Read metadata from an audio file on disk without fully decoding it.
#[tauri::command]
pub async fn get_audio_file_info(file_path: String) -> Result<AudioFileInfoResponse, String> {
    let (resolved_path, metadata) = resolve_audio_metadata(&file_path)?;
    let size_bytes = std::fs::metadata(&resolved_path)
        .map_err(|error| format!("Failed to read audio file metadata: {error}"))?
        .len();
    map_audio_file_info(&resolved_path, size_bytes, metadata)
}

/// Backward-compatible metadata command name for native callers that use the Rust source name.
#[tauri::command]
pub async fn get_audio_file_metadata(file_path: String) -> Result<AudioStreamMeta, String> {
    let (_, metadata) = resolve_audio_metadata(&file_path)?;
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_decoded_audio_to_the_frontend_contract() {
        let response = DecodedAudioResponse::from(DecodedAudio {
            sample_rate: 48_000,
            channels: 2,
            samples: vec![vec![1.0, -1.0], vec![0.5, -0.5]],
            duration_seconds: 2.0 / 48_000.0,
            codec: "pcm".to_string(),
        });

        assert_eq!(response.samples, vec![1.0, 0.5, -1.0, -0.5]);
        assert_eq!(response.sample_rate, 48_000);
        assert_eq!(response.channels, 2);
        assert_eq!(response.total_frames, 2);
        assert_eq!(response.duration_ms, 2.0 / 48_000.0 * 1000.0);

        let serialized = serde_json::to_value(&response).expect("response should serialize");
        assert_eq!(
            serialized["samples"],
            serde_json::json!([1.0, 0.5, -1.0, -0.5])
        );
        assert!(serialized.get("duration_seconds").is_none());
    }

    #[test]
    fn maps_audio_file_info_to_the_frontend_contract() {
        let response = map_audio_file_info(
            Path::new("/tmp/track.wav"),
            1_024,
            AudioStreamMeta {
                sample_rate: 48_000,
                channels: 2,
                total_frames: 96_000,
                codec: "pcm".to_string(),
            },
        )
        .expect("file info should map");

        let serialized = serde_json::to_value(&response).expect("response should serialize");
        assert_eq!(serialized["path"], "/tmp/track.wav");
        assert_eq!(serialized["name"], "track.wav");
        assert_eq!(serialized["sample_rate"], 48_000);
        assert_eq!(serialized["channels"], 2);
        assert_eq!(serialized["duration_ms"], 2_000.0);
        assert_eq!(serialized["total_frames"], 96_000);
        assert_eq!(serialized["codec"], "pcm");
        assert_eq!(serialized["size_bytes"], 1_024);
    }
}
