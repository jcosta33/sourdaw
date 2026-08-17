use sourdaw_native::commands::link as native;

pub use sourdaw_native::commands::link::{LinkState, LinkStatus};

#[tauri::command]
pub async fn enable_link(state: tauri::State<'_, LinkState>) -> Result<LinkStatus, String> {
    native::enable_link(&state).await
}

#[tauri::command]
pub async fn disable_link(state: tauri::State<'_, LinkState>) -> Result<(), String> {
    native::disable_link(&state).await
}

#[tauri::command]
pub async fn set_link_tempo(tempo: f64, state: tauri::State<'_, LinkState>) -> Result<(), String> {
    native::set_link_tempo(tempo, &state).await
}

#[tauri::command]
pub async fn get_link_status(state: tauri::State<'_, LinkState>) -> Result<LinkStatus, String> {
    native::get_link_status(&state).await
}

#[tauri::command]
pub async fn link_start_playing(state: tauri::State<'_, LinkState>) -> Result<(), String> {
    native::link_start_playing(&state).await
}

#[tauri::command]
pub async fn link_stop_playing(state: tauri::State<'_, LinkState>) -> Result<(), String> {
    native::link_stop_playing(&state).await
}
