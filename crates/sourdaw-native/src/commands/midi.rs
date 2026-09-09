use crate::events::{EventSink, EventSinkExt};
use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use rusb::{Context, DeviceHandle, UsbContext};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Info about a MIDI input port, sent to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct MidiDeviceInfo {
    pub index: usize,
    /// The identity a saved selection is keyed on. midir's own port id where
    /// the backend supplies a usable one — the CoreMIDI unique id on macOS,
    /// the device-interface path on Windows — and the name/ordinal fallback of
    /// [`assign_port_ids`] where it does not. `index` is the handle
    /// `open_midi_input` takes and is only valid for this enumeration.
    pub id: String,
    pub name: String,
}

/// Payload emitted for each incoming MIDI message.
#[derive(Debug, Clone, Serialize)]
pub struct MidiMessagePayload {
    pub port: String,
    pub timestamp: u64,
    pub data: Vec<u8>,
}

const MIN_MIDI_MESSAGE_BYTES: usize = 2;
const MAX_MIDI_MESSAGE_BYTES: usize = 3;
const PUSH2_VENDOR_ID: u16 = 0x2982;
const PUSH2_PRODUCT_ID: u16 = 0x1967;
const PUSH2_DISPLAY_INTERFACE: u8 = 0;
const PUSH2_DISPLAY_ENDPOINT: u8 = 0x01;
const PUSH2_DISPLAY_HEADER_BYTES: usize = 16;
const PUSH2_DISPLAY_PAYLOAD_BYTES: usize = 160 * 2_048;
const PUSH2_MAX_MIDI_BYTES: usize = 23;
const PUSH2_USB_TIMEOUT: Duration = Duration::from_secs(1);

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

impl MidiState {
    /// Close the open input connection, answering whether there was one.
    ///
    /// This is the exit cascade's MIDI step: a poisoned lock is still read
    /// (the slot's content survives a panic elsewhere) because exit is the
    /// last chance the device handle has to be released at all, and refusing
    /// to read it would turn one panic elsewhere into a device held until the
    /// process dies.
    pub fn close_open_input(&self) -> bool {
        let mut connection = crate::state::locked_or_poisoned(&self.connection);
        connection.take().is_some_and(|connection| {
            connection.close();
            true
        })
    }
}

#[cfg(test)]
impl MidiState {
    /// Adopt an already-open connection, for tests that need a `MidiState`
    /// holding one without a physical device to open.
    pub(crate) fn with_connection_for_test(connection: MidiInputConnection<()>) -> Self {
        Self {
            connection: Mutex::new(Some(connection)),
        }
    }
}

struct PushConnection {
    model: String,
    midi_input: MidiInputConnection<()>,
    midi_output: MidiOutputConnection,
    display: Option<DeviceHandle<Context>>,
}

pub struct PushState {
    connection: Arc<Mutex<Option<PushConnection>>>,
}

impl Default for PushState {
    fn default() -> Self {
        Self {
            connection: Arc::new(Mutex::new(None)),
        }
    }
}

fn is_push2_live_port(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    normalized.contains("ableton push 2") && !normalized.contains("user")
}

fn is_push3_user_port(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    normalized.contains("ableton push 3") && normalized.contains("user")
}

fn is_push_port(name: &str, model: &str) -> bool {
    if model == "push2" {
        return is_push2_live_port(name);
    }
    if model == "push3" {
        return is_push3_user_port(name);
    }
    false
}

fn unique_push_port_index(names: &[String], model: &str) -> Result<usize, String> {
    let matching = names
        .iter()
        .enumerate()
        .filter_map(|(index, name)| is_push_port(name, model).then_some(index))
        .collect::<Vec<_>>();
    match matching.as_slice() {
        [index] => Ok(*index),
        [] => Err(format!("Ableton {model} MIDI port was not found")),
        _ => Err(format!(
            "Multiple Ableton {model} MIDI ports were found; connect one device"
        )),
    }
}

fn is_push2_usb_device(vendor_id: u16, product_id: u16) -> bool {
    vendor_id == PUSH2_VENDOR_ID && product_id == PUSH2_PRODUCT_ID
}

fn is_push2_display_payload_size(size: usize) -> bool {
    size == PUSH2_DISPLAY_HEADER_BYTES || size == PUSH2_DISPLAY_PAYLOAD_BYTES
}

fn open_push2_display() -> Result<DeviceHandle<Context>, String> {
    let context = Context::new().map_err(|error| format!("Failed to initialize USB: {error}"))?;
    let devices = context
        .devices()
        .map_err(|error| format!("Failed to enumerate USB devices: {error}"))?;

    let mut matched_device = None;
    for device in devices.iter() {
        let descriptor = device
            .device_descriptor()
            .map_err(|error| format!("Failed to read USB descriptor: {error}"))?;
        if !is_push2_usb_device(descriptor.vendor_id(), descriptor.product_id()) {
            continue;
        }

        if matched_device.is_some() {
            return Err(
                "Multiple Ableton Push 2 USB displays were found; connect one device".to_owned(),
            );
        }
        matched_device = Some(device);
    }

    if let Some(device) = matched_device {
        let handle = device
            .open()
            .map_err(|error| format!("Failed to open Push 2 USB display: {error}"))?;
        handle
            .claim_interface(PUSH2_DISPLAY_INTERFACE)
            .map_err(|error| format!("Failed to claim Push 2 display interface: {error}"))?;
        return Ok(handle);
    }

    Err("Ableton Push 2 USB display was not found".to_owned())
}

fn close_push_connection(active: PushConnection) {
    active.midi_input.close();
    if let Some(display) = active.display {
        let _ = display.release_interface(PUSH2_DISPLAY_INTERFACE);
    }
}

async fn run_push_transport_task<Task, Output>(task: Task) -> Result<Output, String>
where
    Task: FnOnce() -> Output + Send + 'static,
    Output: Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|error| format!("Push transport task failed: {error}"))
}

fn push2_midi_payload(port: &str, timestamp: u64, message: &[u8]) -> Option<MidiMessagePayload> {
    if message.is_empty() || message.len() > PUSH2_MAX_MIDI_BYTES {
        return None;
    }
    Some(MidiMessagePayload {
        port: port.to_owned(),
        timestamp,
        data: message.to_vec(),
    })
}

fn open_push_transport_blocking(
    model: String,
    events: Arc<dyn EventSink>,
    connection: Arc<Mutex<Option<PushConnection>>>,
) -> Result<(), String> {
    if model != "push2" && model != "push3" {
        return Err("Unsupported Ableton Push model".to_owned());
    }
    let mut connection = connection
        .lock()
        .map_err(|error| format!("Push 2 lock error: {error}"))?;
    if let Some(active) = connection.as_ref() {
        if active.model == model {
            return Ok(());
        }
        return Err(format!(
            "Ableton {} is already connected; disconnect it before opening {model}",
            active.model
        ));
    }

    let midi_output = MidiOutput::new("sourdaw-push-output")
        .map_err(|error| format!("Failed to create Push MIDI output: {error}"))?;
    let output_ports = midi_output.ports();
    let output_names = output_ports
        .iter()
        .map(|port| midi_output.port_name(port).unwrap_or_default())
        .collect::<Vec<_>>();
    let output_index = unique_push_port_index(&output_names, &model)?;
    let output_port = &output_ports[output_index];
    let midi_output = midi_output
        .connect(output_port, "sourdaw-push-output")
        .map_err(|error| format!("Failed to open Push MIDI output: {error}"))?;

    let midi_input = MidiInput::new("sourdaw-push-input")
        .map_err(|error| format!("Failed to create Push MIDI input: {error}"))?;
    let input_ports = midi_input.ports();
    let input_names = input_ports
        .iter()
        .map(|port| midi_input.port_name(port).unwrap_or_default())
        .collect::<Vec<_>>();
    let input_index = unique_push_port_index(&input_names, &model)?;
    let input_port = &input_ports[input_index];
    let port_name = midi_input
        .port_name(input_port)
        .unwrap_or_else(|_| format!("Ableton {model}"));
    let display = if model == "push2" {
        Some(open_push2_display()?)
    } else {
        None
    };
    let midi_input = midi_input
        .connect(
            input_port,
            "sourdaw-push-input",
            move |timestamp, message, _| {
                let Some(payload) = push2_midi_payload(&port_name, timestamp, message) else {
                    return;
                };
                events.emit("push-midi-message", payload);
            },
            (),
        )
        .map_err(|error| format!("Failed to open Push MIDI input: {error}"))?;

    *connection = Some(PushConnection {
        model,
        midi_input,
        midi_output,
        display,
    });
    Ok(())
}

pub async fn open_push_transport(
    model: String,
    events: Arc<dyn EventSink>,
    push_state: &PushState,
) -> Result<(), String> {
    let connection = Arc::clone(&push_state.connection);
    run_push_transport_task(move || open_push_transport_blocking(model, events, connection)).await?
}

fn send_push_midi_blocking(
    bytes: Vec<u8>,
    events: Arc<dyn EventSink>,
    connection: Arc<Mutex<Option<PushConnection>>>,
) -> Result<(), String> {
    let mut connection = connection
        .lock()
        .map_err(|error| format!("Push 2 lock error: {error}"))?;
    let active = connection
        .as_mut()
        .ok_or_else(|| "Ableton Push is not connected".to_owned())?;
    let result = active
        .midi_output
        .send(&bytes)
        .map_err(|error| format!("Failed to send Push MIDI: {error}"));
    if result.is_err() {
        let model = active.model.clone();
        if let Some(active) = connection.take() {
            close_push_connection(active);
        }
        events.emit("push-disconnected", model);
    }
    result
}

/// Send one raw MIDI message to the connected Push.
///
/// The payload arrives as bytes the shell already unwrapped from its transport,
/// so the size rule below is the only gate and it reads the same under either
/// shell.
pub async fn send_push_midi(
    bytes: &[u8],
    events: Arc<dyn EventSink>,
    push_state: &PushState,
) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > PUSH2_MAX_MIDI_BYTES {
        return Err("Push MIDI payload has an invalid size".to_owned());
    }
    let bytes = bytes.to_vec();
    let connection = Arc::clone(&push_state.connection);
    run_push_transport_task(move || send_push_midi_blocking(bytes, events, connection)).await?
}

fn write_push2_display_blocking(
    bytes: Vec<u8>,
    events: Arc<dyn EventSink>,
    connection: Arc<Mutex<Option<PushConnection>>>,
) -> Result<(), String> {
    let mut connection = connection
        .lock()
        .map_err(|error| format!("Push 2 lock error: {error}"))?;
    let active = connection
        .as_mut()
        .ok_or_else(|| "Ableton Push 2 is not connected".to_owned())?;
    let display = active
        .display
        .as_ref()
        .ok_or_else(|| "The connected Push model has no host-writable display".to_owned())?;
    let result = display
        .write_bulk(PUSH2_DISPLAY_ENDPOINT, &bytes, PUSH2_USB_TIMEOUT)
        .map_err(|error| format!("Failed to write Push 2 display: {error}"))
        .and_then(|written| {
            if written == bytes.len() {
                return Ok(());
            }
            Err(format!(
                "Push 2 display wrote {written} of {} bytes",
                bytes.len()
            ))
        });
    if result.is_err() {
        let model = active.model.clone();
        if let Some(active) = connection.take() {
            close_push_connection(active);
        }
        events.emit("push-disconnected", model);
    }
    result
}

/// Write one Push 2 display frame chunk over USB bulk.
pub async fn write_push2_display(
    bytes: &[u8],
    events: Arc<dyn EventSink>,
    push_state: &PushState,
) -> Result<(), String> {
    if !is_push2_display_payload_size(bytes.len()) {
        return Err("Push 2 display payload has an invalid size".to_owned());
    }
    let bytes = bytes.to_vec();
    let connection = Arc::clone(&push_state.connection);
    run_push_transport_task(move || write_push2_display_blocking(bytes, events, connection)).await?
}

fn close_push_transport_blocking(
    connection: Arc<Mutex<Option<PushConnection>>>,
) -> Result<(), String> {
    let mut connection = connection
        .lock()
        .map_err(|error| format!("Push 2 lock error: {error}"))?;
    if let Some(active) = connection.take() {
        close_push_connection(active);
    }
    Ok(())
}

pub async fn close_push_transport(push_state: &PushState) -> Result<(), String> {
    let connection = Arc::clone(&push_state.connection);
    run_push_transport_task(move || close_push_transport_blocking(connection)).await?
}

/// The id midir reports for a port that carries no identity. CoreMIDI maps an
/// endpoint without a system-assigned unique id to `unwrap_or(0)`, so several
/// such endpoints all read "0"; an empty string means the backend had nothing
/// at all. Neither distinguishes ports, so both fall back to names.
const DEGENERATE_PORT_ID: &str = "0";

/// Whether midir's own port id can serve as the persisted-selection identity.
fn is_usable_port_id(raw_id: &str) -> bool {
    !raw_id.is_empty() && raw_id != DEGENERATE_PORT_ID
}

/// The persisted-selection id for every port of one enumeration, in order.
///
/// A port whose midir id is usable keeps it — on macOS and Windows that id is
/// stable across replugs, so the user's saved selection follows the device.
/// A port without one (or on a backend whose ids are not) falls back to the
/// name scheme this identity used before ids crossed the wire (#2016): a
/// unique name is the id, and only ports that share a name are qualified as
/// `name #ordinal`, by their ordinal among the same-named fallback ports so an
/// unrelated device joining or leaving cannot renumber them.
///
/// Pure so the fallback rule is testable without any device attached.
pub(super) fn assign_port_ids(ports: &[(String, String)]) -> Vec<String> {
    let mut fallback_totals: HashMap<&str, usize> = HashMap::new();
    for (raw_id, name) in ports {
        if !is_usable_port_id(raw_id) {
            *fallback_totals.entry(name.as_str()).or_default() += 1;
        }
    }

    let mut fallback_ordinals: HashMap<&str, usize> = HashMap::new();
    ports
        .iter()
        .map(|(raw_id, name)| {
            if is_usable_port_id(raw_id) {
                return raw_id.clone();
            }
            let name = name.as_str();
            let ordinal = fallback_ordinals.entry(name).or_default();
            let this = *ordinal;
            *ordinal += 1;
            match fallback_totals.get(name) {
                Some(1) | None => name.to_owned(),
                Some(_) => format!("{name} #{this}"),
            }
        })
        .collect()
}

/// List all available MIDI input ports.
///
/// Enumeration never opens a device: `MidiInput::new` plus `ports()` reads the
/// system's port table only.
pub fn list_midi_inputs() -> Result<Vec<MidiDeviceInfo>, String> {
    let midi_in = MidiInput::new("sourdaw-enumerate")
        .map_err(|e| format!("Failed to create MIDI input: {e}"))?;

    let ports = midi_in.ports();
    let named: Vec<(String, String)> = ports
        .iter()
        .enumerate()
        .map(|(i, port)| {
            let name = midi_in
                .port_name(port)
                .unwrap_or_else(|_| format!("Port {i}"));
            (port.id(), name)
        })
        .collect();
    let ids = assign_port_ids(&named);

    Ok(named
        .into_iter()
        .zip(ids)
        .enumerate()
        .map(|(index, ((_, name), id))| MidiDeviceInfo { index, id, name })
        .collect())
}

/// Open a MIDI input port by index. Incoming MIDI messages are forwarded
/// to the frontend as `midi-message` events.
pub fn open_midi_input(
    port_index: usize,
    events: Arc<dyn EventSink>,
    midi_state: &MidiState,
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
                events.emit("midi-message", payload);
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
pub fn close_midi_input(midi_state: &MidiState) -> Result<(), String> {
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

    #[test]
    fn push2_transport_boundary_selects_only_live_ports_and_exact_usb_identity() {
        assert!(is_push2_live_port("Ableton Push 2 Live Port"));
        assert!(is_push2_live_port("Ableton Push 2"));
        assert!(!is_push2_live_port("Ableton Push 2 User Port"));
        assert!(!is_push2_live_port("Ableton Push 3 Live Port"));
        assert!(is_push3_user_port("Ableton Push 3 User Port"));
        assert!(!is_push3_user_port("Ableton Push 3 Live Port"));

        assert!(is_push2_usb_device(0x2982, 0x1967));
        assert!(!is_push2_usb_device(0x2982, 0x1968));
        assert!(!is_push2_usb_device(0x1234, 0x1967));

        let unique = vec![
            "Other Controller".to_owned(),
            "Ableton Push 2 Live Port".to_owned(),
        ];
        assert_eq!(unique_push_port_index(&unique, "push2").unwrap(), 1);
        let ambiguous = vec![
            "Ableton Push 2 Live Port".to_owned(),
            "Ableton Push 2".to_owned(),
        ];
        assert!(unique_push_port_index(&ambiguous, "push2")
            .unwrap_err()
            .contains("Multiple"));
    }

    #[test]
    fn push2_display_boundary_accepts_only_protocol_frame_chunks() {
        assert!(is_push2_display_payload_size(16));
        assert!(is_push2_display_payload_size(160 * 2_048));
        assert!(!is_push2_display_payload_size(0));
        assert!(!is_push2_display_payload_size(17));
        assert!(!is_push2_display_payload_size(160 * 2_048 + 1));
    }

    #[test]
    fn push_transport_tasks_leave_the_calling_thread() {
        let caller = std::thread::current().id();
        let worker =
            crate::block_on_test(run_push_transport_task(|| std::thread::current().id())).unwrap();
        assert_ne!(worker, caller);
    }

    fn port(raw_id: &str, name: &str) -> (String, String) {
        (raw_id.to_owned(), name.to_owned())
    }

    #[test]
    fn a_usable_backend_id_is_the_identity_even_when_names_collide() {
        // Two units of one controller are distinct device instances on Windows
        // and macOS: their midir ids differ, so nothing may qualify them.
        let ports = vec![port("254", "MPK Mini"), port("817", "MPK Mini")];

        assert_eq!(assign_port_ids(&ports), vec!["254", "817"]);
    }

    #[test]
    fn a_lone_nameless_backend_id_falls_back_to_the_bare_name() {
        let ports = vec![
            port("254", "Launchkey"),
            port(DEGENERATE_PORT_ID, "MPK Mini"),
        ];

        assert_eq!(assign_port_ids(&ports), vec!["254", "MPK Mini"]);
    }

    #[test]
    fn degenerate_ids_on_same_named_ports_are_qualified_by_ordinal() {
        // CoreMIDI's unwrap_or(0) collapses every endpoint without a unique id
        // to the same "0", so two such units differ by nothing but their name
        // — and only those are qualified, by ordinal among themselves.
        let ports = vec![
            port(DEGENERATE_PORT_ID, "MPK Mini"),
            port(DEGENERATE_PORT_ID, "Built-in"),
            port(DEGENERATE_PORT_ID, "MPK Mini"),
        ];

        assert_eq!(
            assign_port_ids(&ports),
            vec!["MPK Mini #0", "Built-in", "MPK Mini #1"]
        );
    }

    #[test]
    fn fallback_ordinals_do_not_renumber_when_an_unrelated_port_leaves() {
        let before = vec![
            port(DEGENERATE_PORT_ID, "MPK Mini"),
            port(DEGENERATE_PORT_ID, "Built-in"),
            port(DEGENERATE_PORT_ID, "MPK Mini"),
        ];
        let after = vec![
            port(DEGENERATE_PORT_ID, "MPK Mini"),
            port(DEGENERATE_PORT_ID, "MPK Mini"),
        ];

        assert_eq!(
            assign_port_ids(&after),
            assign_port_ids(&before)
                .into_iter()
                .filter(|id| id != "Built-in")
                .collect::<Vec<_>>(),
            "an unrelated port leaving must not shift the survivors' ordinals"
        );
    }

    #[test]
    fn an_empty_backend_id_is_as_unusable_as_the_degenerate_one() {
        let ports = vec![port("", "Solo Controller")];

        assert_eq!(assign_port_ids(&ports), vec!["Solo Controller"]);
    }

    /// A virtual port is the only device-free way to prove end-to-end that one
    /// port's id survives a second enumeration through a second `MidiInput`
    /// instance — the exact question a saved selection asks on the next
    /// launch. The stand-in for a hardware *source* is a virtual *output*
    /// port: an input's own virtual port is a destination endpoint and never
    /// lists in an input enumeration. Unix-only: `create_virtual` has no
    /// Windows implementation.
    #[cfg(unix)]
    #[test]
    fn a_virtual_port_keeps_its_id_across_enumerations_and_instances() {
        use midir::os::unix::VirtualOutput;

        let midi_out = MidiOutput::new("sourdaw-id-stability-server").expect("test MidiOutput");
        let _virtual_source = midi_out
            .create_virtual("sourdaw-virtual-id-test")
            .expect("virtual source port");

        let enumerate = || list_midi_inputs().expect("enumeration must succeed");
        let find = |devices: &[MidiDeviceInfo]| {
            devices
                .iter()
                .find(|device| device.name == "sourdaw-virtual-id-test")
                .expect("the virtual port must be visible to a fresh enumeration")
                .id
                .clone()
        };

        let first = find(&enumerate());
        let second = find(&enumerate());

        assert_eq!(
            first, second,
            "the same physical port must not change identity between enumerations"
        );
    }
}
