use daw_io::{DecodedAudio, AudioStreamMeta};

/// Decode an audio file from disk. Supports WAV, FLAC, MP3, OGG/Vorbis, AAC, ALAC, and more.
/// Takes a file path rather than bytes to avoid loading the entire file through the IPC boundary.
#[tauri::command]
pub async fn decode_audio_file(file_path: String) -> Result<DecodedAudio, String> {
    daw_io::decode_audio_file(&file_path)
}

/// Read metadata from an audio file on disk without fully decoding it.
#[tauri::command]
pub async fn get_audio_file_metadata(file_path: String) -> Result<AudioStreamMeta, String> {
    daw_io::get_audio_file_metadata(&file_path)
}
