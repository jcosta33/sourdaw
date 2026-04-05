use midir::{MidiInput, MidiInputConnection};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Info about a MIDI input port, sent to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct MidiDeviceInfo {
    pub index: usize,
    pub name: String,
}

/// Payload emitted for each incoming MIDI message via Tauri events.
#[derive(Debug, Clone, Serialize)]
pub struct MidiMessagePayload {
    pub port: String,
    pub timestamp: u64,
    pub data: Vec<u8>,
}

/// Managed state: holds the active MIDI input connection.
pub struct MidiState {
    connection: Mutex<Option<MidiInputConnection<()>>>,
}

impl Default for MidiState {
    fn default() -> Self {
        Self {
            connection: Mutex::new(None),
        }
    }
}

/// List all available MIDI input ports.
#[tauri::command]
pub fn list_midi_inputs() -> Result<Vec<MidiDeviceInfo>, String> {
    let midi_in = MidiInput::new("sourdaw-enumerate")
        .map_err(|e| format!("Failed to create MIDI input: {e}"))?;

    let ports = midi_in.ports();
    let mut devices = Vec::with_capacity(ports.len());

    for (i, port) in ports.iter().enumerate() {
        let name = midi_in
            .port_name(port)
            .unwrap_or_else(|_| format!("Port {i}"));
        devices.push(MidiDeviceInfo { index: i, name });
    }

    Ok(devices)
}

/// Open a MIDI input port by index. Incoming MIDI messages are forwarded
/// to the frontend via the `midi-message` Tauri event.
#[tauri::command]
pub fn open_midi_input(
    port_index: usize,
    app: AppHandle,
    midi_state: tauri::State<'_, MidiState>,
) -> Result<String, String> {
    // Close any existing connection first
    {
        let mut conn_guard = midi_state
            .connection
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        if let Some(conn) = conn_guard.take() {
            conn.close();
        }
    }

    let midi_in =
        MidiInput::new("sourdaw-input").map_err(|e| format!("Failed to create MIDI input: {e}"))?;

    let ports = midi_in.ports();
    let port = ports.get(port_index).ok_or_else(|| {
        format!(
            "Port index {port_index} out of range (found {} ports)",
            ports.len()
        )
    })?;

    let port_name = midi_in
        .port_name(port)
        .unwrap_or_else(|_| format!("Port {port_index}"));

    let app_handle = app.clone();
    let name_for_callback = port_name.clone();
    let connection = midi_in
        .connect(
            port,
            "sourdaw-midi-listener",
            move |timestamp, message, _| {
                let payload = MidiMessagePayload {
                    port: name_for_callback.clone(),
                    timestamp,
                    data: message.to_vec(),
                };
                let _ = app_handle.emit("midi-message", payload);
            },
            (),
        )
        .map_err(|e| format!("Failed to open MIDI port: {e}"))?;

    let mut conn_guard = midi_state
        .connection
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    *conn_guard = Some(connection);

    Ok(port_name)
}

/// Close the currently open MIDI input port.
#[tauri::command]
pub fn close_midi_input(midi_state: tauri::State<'_, MidiState>) -> Result<(), String> {
    let mut conn_guard = midi_state
        .connection
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    if let Some(conn) = conn_guard.take() {
        conn.close();
    }
    Ok(())
}
