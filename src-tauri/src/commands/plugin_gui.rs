use sourdaw_native::commands::plugin_gui as native;
use sourdaw_native::state::AppState;

use crate::windows::TauriWindowHost;

pub use sourdaw_native::commands::plugin_gui::PluginGuiInfo;

#[tauri::command]
pub async fn is_plugin_gui_supported(
    instance_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    native::is_plugin_gui_supported(instance_id, &state).await
}

/// MUST stay async — creating windows from a synchronous Tauri command
/// deadlocks on Windows.
#[tauri::command]
pub async fn open_plugin_gui(
    instance_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<PluginGuiInfo, String> {
    native::open_plugin_gui(instance_id, &TauriWindowHost::new(app), &state).await
}

#[tauri::command]
pub async fn close_plugin_gui(
    instance_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    native::close_plugin_gui(instance_id, &TauriWindowHost::new(app), &state).await
}

#[tauri::command]
pub async fn close_all_plugin_guis(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<sourdaw_native::commands::plugins::PluginUnloadResult, String> {
    native::close_all_plugin_guis(&TauriWindowHost::new(app), &state).await
}

#[tauri::command]
pub async fn hide_all_plugin_guis(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    native::hide_all_plugin_guis(&TauriWindowHost::new(app), &state).await
}

#[tauri::command]
pub async fn show_all_plugin_guis(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    native::show_all_plugin_guis(&TauriWindowHost::new(app), &state).await
}
