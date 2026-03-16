use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: String,
    pub duration_ms: u64,
    pub confidence: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AsrStatus {
    pub loaded: bool,
    pub model_name: Option<String>,
}

#[tauri::command]
pub async fn transcribe_audio(audio_path: String) -> Result<TranscriptionResult, String> {
    // Sidecar integration point: spawn whisper-server process
    // For now, return a stub indicating the sidecar is not yet running
    Err(format!(
        "ASR sidecar not available. Audio path: '{}'. Install whisper.cpp sidecar to enable.",
        audio_path
    ))
}

#[tauri::command]
pub async fn get_asr_status() -> Result<AsrStatus, String> {
    Ok(AsrStatus {
        loaded: false,
        model_name: None,
    })
}
