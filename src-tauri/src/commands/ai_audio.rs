use sourdaw_native::commands::ai_audio as native;

pub use sourdaw_native::commands::ai_audio::{DenoiseRequest, DenoiseResult};

#[tauri::command]
pub async fn denoise_audio(request: DenoiseRequest) -> Result<DenoiseResult, String> {
    native::denoise_audio(request).await
}
