use std::collections::HashMap;

use sourdaw_native::commands::collab as native;

pub use daw_collab::discovery::NearbySession;
pub use sourdaw_native::commands::collab::{CollabState, MergeResultResponse};

#[tauri::command]
pub fn collab_create_project(
    state: tauri::State<'_, CollabState>,
    name: String,
    sample_rate: u32,
) -> Result<bool, String> {
    native::collab_create_project(&state, name, sample_rate)
}

#[tauri::command]
pub fn collab_save_bundle(
    state: tauri::State<'_, CollabState>,
    path: String,
) -> Result<bool, String> {
    native::collab_save_bundle(&state, path)
}

#[tauri::command]
pub fn collab_load_bundle(
    state: tauri::State<'_, CollabState>,
    path: String,
) -> Result<HashMap<String, Vec<u8>>, String> {
    native::collab_load_bundle(&state, path)
}

#[tauri::command]
pub fn collab_get_document_state(
    state: tauri::State<'_, CollabState>,
    doc_id: String,
) -> Result<serde_json::Value, String> {
    native::collab_get_document_state(&state, doc_id)
}

#[tauri::command]
pub fn collab_merge_bundle(
    state: tauri::State<'_, CollabState>,
    path: String,
) -> Result<MergeResultResponse, String> {
    native::collab_merge_bundle(&state, path)
}

#[tauri::command]
pub fn collab_apply_change(
    state: tauri::State<'_, CollabState>,
    doc_id: String,
    change_bytes: Vec<u8>,
) -> Result<bool, String> {
    native::collab_apply_change(&state, doc_id, change_bytes)
}

#[tauri::command]
pub fn collab_start_advertising(
    state: tauri::State<'_, CollabState>,
    session_id: String,
    host_name: String,
    project_name: String,
    port: u16,
    approval_required: bool,
) -> Result<bool, String> {
    native::collab_start_advertising(
        &state,
        session_id,
        host_name,
        project_name,
        port,
        approval_required,
    )
}

#[tauri::command]
pub fn collab_stop_advertising(state: tauri::State<'_, CollabState>) -> Result<bool, String> {
    native::collab_stop_advertising(&state)
}

#[tauri::command]
pub fn collab_start_browsing(state: tauri::State<'_, CollabState>) -> Result<bool, String> {
    native::collab_start_browsing(&state)
}

#[tauri::command]
pub fn collab_stop_browsing(state: tauri::State<'_, CollabState>) -> Result<bool, String> {
    native::collab_stop_browsing(&state)
}

#[tauri::command]
pub fn collab_get_nearby_sessions(
    state: tauri::State<'_, CollabState>,
) -> Result<Vec<NearbySession>, String> {
    native::collab_get_nearby_sessions(&state)
}
