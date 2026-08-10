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

const MIN_MIDI_MESSAGE_BYTES: usize = 2;
const MAX_MIDI_MESSAGE_BYTES: usize = 3;

fn build_midi_message_payload(
    port: &str,
    timestamp: u64,
    message: &[u8],
) -> Option<MidiMessagePayload> {
    if !(MIN_MIDI_MESSAGE_BYTES..=MAX_MIDI_MESSAGE_BYTES).contains(&message.len()) {
        return None;
    }

    Some(MidiMessagePayload {
        port: port.to_owned(),
        timestamp,
        data: message.to_vec(),
    })
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
                let Some(payload) =
                    build_midi_message_payload(&name_for_callback, timestamp, message)
                else {
                    return;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midi_event_source_boundary_admits_only_standard_messages() {
        let note_on = build_midi_message_payload("Controller", 42, &[0x90, 0, 255]).unwrap();
        assert_eq!(note_on.port, "Controller");
        assert_eq!(note_on.timestamp, 42);
        assert_eq!(note_on.data, vec![0x90, 0, 255]);

        let note_off = build_midi_message_payload("Controller", 43, &[0x80, 60]).unwrap();
        assert_eq!(note_off.data, vec![0x80, 60]);

        assert!(build_midi_message_payload("Controller", 44, &[0xf0, 1, 2, 0xf7]).is_none());
        assert!(build_midi_message_payload("Controller", 45, &[0x90]).is_none());
    }
}
