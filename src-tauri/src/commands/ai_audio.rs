use sourdaw_native::commands::ai_audio as native;

pub use sourdaw_native::commands::ai_audio::{
    DenoiseRequest, DenoiseResult, StemResult, StemSeparationRequest,
};

#[tauri::command]
pub async fn denoise_audio(request: DenoiseRequest) -> Result<DenoiseResult, String> {
    native::denoise_audio(request).await
}

#[tauri::command]
pub async fn separate_stems(request: StemSeparationRequest) -> Result<StemResult, String> {
    native::separate_stems(request).await
}
