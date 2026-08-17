use std::sync::Arc;

use sourdaw_native::commands::midi as native;

use crate::events::TauriEventSink;

use super::binary_ipc::raw_body_bytes;

pub use sourdaw_native::commands::midi::{MidiDeviceInfo, MidiState, PushState};

#[tauri::command]
pub fn list_midi_inputs() -> Result<Vec<MidiDeviceInfo>, String> {
    native::list_midi_inputs()
}

#[tauri::command]
pub fn open_midi_input(
    port_index: usize,
    app: tauri::AppHandle,
    midi_state: tauri::State<'_, MidiState>,
) -> Result<String, String> {
    native::open_midi_input(port_index, Arc::new(TauriEventSink::new(app)), &midi_state)
}

#[tauri::command]
pub fn close_midi_input(midi_state: tauri::State<'_, MidiState>) -> Result<(), String> {
    native::close_midi_input(&midi_state)
}

#[tauri::command]
pub async fn open_push_transport(
    model: String,
    app: tauri::AppHandle,
    push_state: tauri::State<'_, PushState>,
) -> Result<(), String> {
    native::open_push_transport(model, Arc::new(TauriEventSink::new(app)), &push_state).await
}

/// Send one raw MIDI message to the connected Push.
///
/// Raw-body: the whole invoke message is the MIDI payload.
#[tauri::command]
pub async fn send_push_midi(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
    push_state: tauri::State<'_, PushState>,
) -> Result<(), String> {
    let bytes = raw_body_bytes(&request, "send_push_midi")?;
    native::send_push_midi(bytes, Arc::new(TauriEventSink::new(app)), &push_state).await
}

/// Write one Push 2 display frame chunk.
///
/// Raw-body: the whole invoke message is the frame payload.
#[tauri::command]
pub async fn write_push2_display(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
    push_state: tauri::State<'_, PushState>,
) -> Result<(), String> {
    let bytes = raw_body_bytes(&request, "write_push2_display")?;
    native::write_push2_display(bytes, Arc::new(TauriEventSink::new(app)), &push_state).await
}

#[tauri::command]
pub async fn close_push_transport(push_state: tauri::State<'_, PushState>) -> Result<(), String> {
    native::close_push_transport(&push_state).await
}
