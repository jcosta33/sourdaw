use std::sync::Arc;

use sourdaw_native::commands::pitch_edit as native;

use crate::events::TauriEventSink;

pub use daw_dsp::knead::pitch_edit::PitchContour;
pub use sourdaw_native::commands::pitch_edit::PitchCommitRequest;

#[tauri::command]
pub async fn analyze_pitch(
    app: tauri::AppHandle,
    analysis_id: String,
    audio_path: String,
) -> Result<PitchContour, String> {
    native::analyze_pitch(Arc::new(TauriEventSink::new(app)), analysis_id, audio_path).await
}

#[tauri::command]
pub async fn commit_pitch_edit(request: PitchCommitRequest) -> Result<(), String> {
    native::commit_pitch_edit(request).await
}
