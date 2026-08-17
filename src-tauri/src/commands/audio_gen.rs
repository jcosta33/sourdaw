use std::sync::Arc;

use sourdaw_native::commands::audio_gen as native;

use crate::events::TauriEventSink;
use crate::sidecar::TauriSidecarHost;

pub use sourdaw_native::commands::audio_gen::{AudioGenResult, AudioGenState};

#[tauri::command]
pub async fn start_audio_gen_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioGenState>,
) -> Result<(), String> {
    native::start_audio_gen_sidecar(
        Arc::new(TauriSidecarHost::new(app.clone())),
        Arc::new(TauriEventSink::new(app)),
        &state,
    )
    .await
}

#[tauri::command]
pub async fn generate_audio_clip(
    app: tauri::AppHandle,
    prompt: String,
    bpm: Option<f32>,
    key: Option<String>,
    duration_bars: Option<u32>,
    duration_seconds: Option<f32>,
    state: tauri::State<'_, AudioGenState>,
) -> Result<AudioGenResult, String> {
    native::generate_audio_clip(
        Arc::new(TauriSidecarHost::new(app.clone())),
        Arc::new(TauriEventSink::new(app)),
        prompt,
        bpm,
        key,
        duration_bars,
        duration_seconds,
        &state,
    )
    .await
}

#[tauri::command]
pub async fn stop_audio_gen_sidecar(state: tauri::State<'_, AudioGenState>) -> Result<(), String> {
    native::stop_audio_gen_sidecar(&state).await
}
