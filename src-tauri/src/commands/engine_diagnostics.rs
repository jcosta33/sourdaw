use sourdaw_native::commands::engine_diagnostics as native;
use sourdaw_native::state::AppState;

pub use sourdaw_native::commands::engine_diagnostics::EngineRtDiagnostics;

#[tauri::command]
pub async fn engine_rt_diagnostics(
    state: tauri::State<'_, AppState>,
) -> Result<EngineRtDiagnostics, String> {
    native::engine_rt_diagnostics(&state).await
}
