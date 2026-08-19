use sourdaw_native::commands::audio_postprocess as native;

pub use sourdaw_native::commands::audio_postprocess::PostProcessRequest;

#[tauri::command]
pub async fn post_process_audio(request: PostProcessRequest) -> Result<String, String> {
    native::post_process_audio(request).await
}
