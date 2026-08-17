use std::sync::Arc;

use sourdaw_native::commands::speech as native;

use crate::events::TauriEventSink;

pub use sourdaw_native::commands::speech::{AsrStatus, DictationState};

#[tauri::command]
pub async fn load_whisper_model(
    model_path: String,
    state: tauri::State<'_, DictationState>,
) -> Result<AsrStatus, String> {
    native::load_whisper_model(model_path, &state).await
}

#[tauri::command]
pub async fn ensure_whisper_ready(
    state: tauri::State<'_, DictationState>,
) -> Result<AsrStatus, String> {
    native::ensure_whisper_ready(&state).await
}

#[tauri::command]
pub async fn start_dictation(
    app: tauri::AppHandle,
    state: tauri::State<'_, DictationState>,
) -> Result<(), String> {
    native::start_dictation(Arc::new(TauriEventSink::new(app)), &state).await
}

#[tauri::command]
pub fn stop_dictation(state: tauri::State<'_, DictationState>) -> Result<(), String> {
    native::stop_dictation(&state)
}

#[tauri::command]
pub async fn get_asr_status(state: tauri::State<'_, DictationState>) -> Result<AsrStatus, String> {
    native::get_asr_status(&state).await
}
