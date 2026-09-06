/// Real CLAP plugin wrapper — loads .clap shared libraries and hosts them.
///
/// Flow: dlopen → clap_entry.init() → factory.create_plugin(host, id) → plugin.activate() → plugin.process()
///
/// RT-safety: `process_audio_internal` and `process_with_midi` are called on the audio thread.
/// All scratch buffers are preallocated in `new` — no heap allocation occurs
/// on the RT path.

/// Maximum audio buffer size this host supports (must match the max_frames_count passed to activate).
const MAX_BUFFER: usize = 4096;
/// Maximum MIDI events processed per audio block. Events beyond this are silently dropped.
const MAX_MIDI: usize = 64;
/// Maximum parameter events processed per audio block. Extra pending values remain host-side.
const MAX_PARAMETER_EVENTS: usize = 64;

/// The most audio ports, per direction, the runtime will wire for one plugin.
///
/// The same bound and reason as the scanner's: `count` is a plugin-supplied
/// `u32` and an untrusted allocation bound here, because each declared port
/// costs a buffer table row. Real plugins declare a handful.
const MAX_RUNTIME_AUDIO_PORTS: u32 = 64;

/// The most audio channels, per direction, a runtime layout will allocate for.
///
/// Scratch is channels × MAX_BUFFER samples per direction, so the cap is a
/// memory bound: a plugin declaring an absurd channel count on a legal number
/// of ports is describing something no host can feed.
const MAX_RUNTIME_AUDIO_CHANNELS: u32 = 256;

/// How many deactivate/reactivate/re-query passes one `poll_latency_change` will
/// make before giving up on settling. Each extra pass exists to catch a
/// `request_restart()` that landed during the previous one; the cap keeps a
/// plugin that re-flags from inside every `activate()` from spinning forever.
const MAX_LATENCY_REQUERY_PASSES: u32 = 4;

use crate::clap_host::{create_host_descriptor, HostCallbackState, LatencyChangeNotifier};
use crate::parameter_events::{
    PluginParameterEvent, PluginParameterEventKind, PluginParameterEventQueue,
};
use crate::params::PluginParameter;
use crate::scanner::{category_from_clap_features, clap_library_path, owned_feature_list};
use crate::traits::{
    signal_pending_process_refusal, AudioPlugin, EditorWindowResizer, HostMidiEvent,
    HostParameterUpdate, HostTransport, HostedPluginRuntime, PluginHostRequestNotifier,
    ProcessingGate,
};
use clap_sys::audio_buffer::clap_audio_buffer;
use clap_sys::entry::clap_plugin_entry;
use clap_sys::events::{
    clap_event_header, clap_event_note, clap_event_param_gesture, clap_event_param_value,
    clap_event_transport, clap_input_events, clap_output_events, CLAP_CORE_EVENT_SPACE_ID,
    CLAP_EVENT_NOTE_OFF, CLAP_EVENT_NOTE_ON, CLAP_EVENT_PARAM_GESTURE_BEGIN,
    CLAP_EVENT_PARAM_GESTURE_END, CLAP_EVENT_PARAM_VALUE, CLAP_EVENT_TRANSPORT,
    CLAP_TRANSPORT_HAS_BEATS_TIMELINE, CLAP_TRANSPORT_HAS_SECONDS_TIMELINE,
    CLAP_TRANSPORT_HAS_TEMPO, CLAP_TRANSPORT_HAS_TIME_SIGNATURE, CLAP_TRANSPORT_IS_PLAYING,
};
use clap_sys::ext::audio_ports::{
    clap_audio_port_info, clap_plugin_audio_ports, CLAP_EXT_AUDIO_PORTS,
};
#[cfg(target_os = "windows")]
use clap_sys::ext::gui::CLAP_WINDOW_API_WIN32;
#[cfg(target_os = "linux")]
use clap_sys::ext::gui::CLAP_WINDOW_API_X11;
use clap_sys::ext::gui::{
    clap_plugin_gui, clap_window, clap_window_handle, CLAP_EXT_GUI, CLAP_WINDOW_API_COCOA,
};
use clap_sys::ext::latency::{clap_plugin_latency, CLAP_EXT_LATENCY};
use clap_sys::ext::note_ports::{
    clap_note_port_info, clap_plugin_note_ports, CLAP_EXT_NOTE_PORTS, CLAP_NOTE_DIALECT_CLAP,
};
use clap_sys::ext::params::{
    clap_param_info, clap_plugin_params, CLAP_EXT_PARAMS, CLAP_PARAM_IS_AUTOMATABLE,
    CLAP_PARAM_IS_HIDDEN, CLAP_PARAM_IS_READONLY,
};
use clap_sys::ext::state::{clap_plugin_state, CLAP_EXT_STATE};
use clap_sys::ext::tail::{clap_plugin_tail, CLAP_EXT_TAIL};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::fixedpoint::{CLAP_BEATTIME_FACTOR, CLAP_SECTIME_FACTOR};
use clap_sys::host::clap_host;
use clap_sys::plugin::clap_plugin;
use clap_sys::process::{clap_process, clap_process_status, CLAP_PROCESS_ERROR};
use clap_sys::stream::{clap_istream, clap_ostream};
use libloading::Library;
use std::ffi::{c_void, CStr, CString};
use std::mem;
use std::path::Path;
use std::ptr;
use std::sync::Arc;
#[cfg(feature = "engine-owned-command-fixture")]
use std::sync::Mutex;

/// Holds a loaded CLAP plugin instance and its associated resources.
pub struct ClapWrapper {
    /// The dynamically loaded shared library — must outlive the plugin instance.
    _library: Option<Library>,
    /// The bundle's `clap_entry`. Its `init` ran before this wrapper existed;
    /// its `deinit` runs in `Drop`, after the plugin instance is destroyed and
    /// — because a `Drop` body runs before any field drops — while `_library`
    /// still has the DSO mapped. Null for fixture wrappers that loaded no bundle.
    entry: *const clap_plugin_entry,
    /// Pointer to the clap_plugin struct.
    plugin: *const clap_plugin,
    /// Host descriptor — must outlive the plugin.
    host: Box<clap_host>,
    /// Whether the plugin has been activated.
    activated: bool,
    /// Plugin name for logging.
    name: String,
    /// Sample rate the plugin was activated with.
    sample_rate: f64,
    /// Cached pointer to the plugin's params extension (may be null).
    params_ext: *const clap_plugin_params,
    /// Cached pointer to the plugin's state extension (may be null).
    state_ext: *const clap_plugin_state,
    /// Cached pointer to the plugin's GUI extension (may be null).
    gui_ext: *const clap_plugin_gui,
    /// Cached pointer to the plugin's latency extension (may be null).
    latency_ext: *const clap_plugin_latency,
    /// Cached pointer to the plugin's tail extension (may be null).
    tail_ext: *const clap_plugin_tail,
    /// Per-instance host callback state, pinned into `host.host_data`. Owns the
    /// latency-dirty flag the plugin sets via `clap_host_latency.changed()` /
    /// `request_restart()`. Must outlive the plugin (dropped after it in field order).
    host_state: Box<HostCallbackState>,
    /// Whether the GUI is currently open.
    gui_open: bool,
    /// How the host resizes the window this plugin's editor is drawn into.
    /// Installed before the editor opens, because the request it answers arrives
    /// from inside the plugin after the open has returned. Dropped on close: a
    /// window that has gone away is not one to resize.
    editor_resizer: Option<EditorWindowResizer>,
    /// Split ownership of the CLAP processing state. Shared with the runtime
    /// owner so an unload can request a stop without touching the wrapper.
    processing: Arc<ProcessingGate>,
    /// Preallocated transport event refilled in place each block — the audio
    /// thread never allocates one.
    transport_scratch: Box<clap_event_transport>,
    /// Whether the host has supplied a timeline yet. Until it has, the plugin
    /// gets a null transport, which CLAP defines as "no timeline available".
    has_transport: bool,
    /// Frames handed to the plugin since this activation began, which is what
    /// CLAP's `steady_time` is: "a steady sample time counter … not counting the
    /// steady time of the transport", monotonic and coherent with the block
    /// sizes. Reset by every activation, because the counter describes one
    /// activation and a plugin taken through a deactivate/reactivate cycle is
    /// entitled to start again from zero. Written on the audio thread only, and
    /// a plain field because that thread is the only one that touches it.
    steady_time: i64,
    /// Whether the plugin has returned `CLAP_PROCESS_ERROR`. Raised by the audio
    /// thread, which may not allocate or take the I/O lock, and read by the
    /// control path, which is the only thread that may report it.
    process_refused: bool,
    /// Whether that refusal has already been reported. A plugin that fails every
    /// block would otherwise print once per control visit for the rest of the
    /// session.
    process_refusal_reported: bool,
    /// The plugin's declared audio port layout and the preallocated buffers
    /// that honour it. Replaces a hardcoded stereo pair that ignored the
    /// declaration entirely.
    audio: AudioBusLayout,
    /// Whether the plugin's own descriptor calls it an instrument. Read once at
    /// load, because the descriptor is fixed for the instance's life and the
    /// audio thread may not walk the C strings it is written in.
    is_instrument: bool,
    /// Whether the plugin declared at least one note input port speaking the
    /// dialect this host's note events are in. Read once at load; a plugin
    /// that declares none never gains one while it lives.
    accepts_note_events: bool,
    /// The display scale the host stated for this plugin's editor, or the
    /// default when none was stated before the editor opened.
    editor_content_scale: f64,
    /// Preallocated MIDI event scratch list. Cleared + refilled each block, never reallocated.
    midi_scratch: Vec<clap_event_note>,
    /// Preallocated parameter event scratch list. Cleared + refilled each block, never reallocated.
    parameter_scratch: Vec<clap_event_param_value>,
    /// Where the plugin's *own* parameter events land — the mirror of
    /// `parameter_scratch`, which carries host writes the other way.
    ///
    /// Allocated once at load and shared with the drain, so the audio thread
    /// only ever writes into memory that already exists.
    parameter_events: Arc<PluginParameterEventQueue>,
    #[cfg(feature = "engine-owned-command-fixture")]
    command_fixture: Option<EngineOwnedCommandFixture>,
}

#[cfg(feature = "engine-owned-command-fixture")]
struct EngineOwnedCommandFixture {
    state: Vec<u8>,
    has_gui: bool,
    /// The answer the fixture's open editor gives to "do you accept a size the
    /// host chose".
    ///
    /// Separate from `has_gui` because the two are independent in every real
    /// plugin — a fixed-layout editor has a GUI and refuses host sizing — and a
    /// fixture that derived one from the other could only ever be driven through
    /// the arm that says yes. Defaults to `has_gui`, so a fixture nobody
    /// configures answers exactly as it did before this knob existed.
    editor_resizable: bool,
    /// Values the fixture answers `get_parameters` with. Writable so a test can
    /// stage a change the host never made — the plugin-side edit a user performs
    /// in the plugin's own editor.
    parameters: Vec<PluginParameter>,
    /// Frames the fixture declares as its own latency, standing in for a
    /// plugin's `clap.latency` reading.
    latency_samples: u32,
    /// Every thread the fixture's editor lifecycle was called on, in order.
    ///
    /// The `gui` extension is `[main-thread]`, so which thread reached the
    /// plugin is the contract — not an implementation detail — and a host that
    /// gets it wrong is unobservable from anything else the fixture answers.
    gui_lifecycle_threads: Arc<Mutex<Vec<std::thread::ThreadId>>>,
    /// Every thread the fixture's editor support was asked on, in order.
    ///
    /// A separate log rather than the lifecycle one because the two questions
    /// draw different crowds: support is asked by the load path and the
    /// capability commands, the lifecycle only by the open/close path, and a
    /// host may be wrong about one and right about the other.
    editor_support_threads: Arc<Mutex<Vec<std::thread::ThreadId>>>,
    /// Run at the top of this wrapper's teardown, standing in for the plugin
    /// calls a real drop makes — `deactivate`, `destroy`, the entry point's
    /// `deinit`.
    ///
    /// Which is third-party code of unbounded duration, so *when* a host drops a
    /// runtime is a contract and not an implementation detail: dropping one
    /// inside a lock the rest of the app takes stalls everything behind it. A
    /// fixture has no plugin to be slow, so the only way a host can prove it
    /// drops in the clear is to be told the moment it does.
    teardown_observer: Option<Box<dyn Fn() + Send + Sync>>,
    /// Run as this fixture's host-request wake is installed.
    ///
    /// Installing one reaches the runtime through the host's own access seam,
    /// which waits on whatever holds the instance — so *where* a host installs
    /// is a contract for the same reason teardown is, and the only way to prove
    /// it is to be told what the installing thread was holding at the time.
    notifier_install_observer: Option<Box<dyn Fn() + Send + Sync>>,
}

#[cfg(feature = "engine-owned-command-fixture")]
fn record_gui_lifecycle_thread(fixture: &EngineOwnedCommandFixture) {
    fixture
        .gui_lifecycle_threads
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .push(std::thread::current().id());
}

// SAFETY: The clap_plugin is required to be thread-safe by the CLAP spec.
// The host struct is pinned via Box and not mutated after creation.
unsafe impl Send for ClapWrapper {}
unsafe impl Sync for ClapWrapper {}

// ── Declared audio bus layout ───────────────────────────────────────────

/// The plugin's declared audio port layout and the preallocated buffers that
/// honour it.
///
/// CLAP's process contract is explicit: "Audio buffers, they must have the
/// same count as specified by `clap_plugin_audio_ports->count()`. The index
/// maps to `clap_plugin_audio_ports->get()`" — one `clap_audio_buffer` per
/// declared port, each carrying that port's own channel count. The port list
/// is readable only while the plugin is deactivated, so it is read once at
/// load and the tables are built there; the audio thread fills and reads
/// scratch and performs no allocation and no pointer arithmetic of its own.
///
/// A plugin that does not implement `clap.audio-ports` "won't have audio
/// ports" — the spec's own words — so it is handed zero buffers and its slot
/// passes audio through, which is the truthful treatment of a note effect.
struct AudioBusLayout {
    /// One flat sample scratch per direction, sized to that direction's
    /// declared channels × MAX_BUFFER and carved up per port by the buffer
    /// tables below. Channels past the engine's stereo pair stay zeroed on the
    /// way in: the input buffers are read-only to the plugin, so nothing
    /// re-dirties them between blocks.
    input_scratch: Box<[f32]>,
    output_scratch: Box<[f32]>,
    /// The per-channel pointer arrays each direction's buffer table points
    /// into. Owned here because `clap_audio_buffer.data32` holds a raw address
    /// only: the table stays valid exactly as long as this storage does.
    input_channel_ptrs: Vec<*mut f32>,
    output_channel_ptrs: Vec<*mut f32>,
    /// The `clap_audio_buffer` table itself, one row per declared port with
    /// that port's own channel count and a channel pointer array carved out
    /// of the scratch above. Every pointer is computed once at load against
    /// scratch whose address never moves for the wrapper's life.
    input_buffers: Vec<clap_audio_buffer>,
    output_buffers: Vec<clap_audio_buffer>,
}

impl AudioBusLayout {
    /// The layout of a plugin that declares no audio ports.
    fn portless() -> Self {
        Self {
            input_scratch: Box::new([]),
            output_scratch: Box::new([]),
            input_channel_ptrs: Vec::new(),
            output_channel_ptrs: Vec::new(),
            input_buffers: Vec::new(),
            output_buffers: Vec::new(),
        }
    }

    /// The layout for a declared port list: channel counts per port, inputs
    /// then outputs, in declaration order.
    ///
    /// Free of any plugin call so the buffer arithmetic is testable against
    /// plain numbers, and so the load path only owes the reading.
    fn declared(input_ports: &[u32], output_ports: &[u32]) -> Result<Self, String> {
        let build =
            |ports: &[u32],
             direction: &str|
             -> Result<(Box<[f32]>, Vec<*mut f32>, Vec<clap_audio_buffer>), String> {
                let total_channels: u32 =
                    ports.iter().copied().try_fold(0u32, |sum, channels| {
                        sum.checked_add(channels)
                            .filter(|_| channels > 0)
                            .ok_or_else(|| {
                                format!("CLAP {direction} port declares an unusable channel count")
                            })
                    })?;
                if total_channels > MAX_RUNTIME_AUDIO_CHANNELS {
                    return Err(format!(
                        "CLAP {direction} audio channel count exceeds runtime bounds"
                    ));
                }
                let mut scratch =
                    vec![0.0f32; total_channels as usize * MAX_BUFFER].into_boxed_slice();
                let mut pointers = Vec::with_capacity(total_channels as usize);
                for channel in 0..total_channels as usize {
                    pointers.push(unsafe { scratch.as_mut_ptr().add(channel * MAX_BUFFER) });
                }
                let buffers = ports
                    .iter()
                    .scan(0usize, |offset, channels| {
                        let port = clap_audio_buffer {
                            // `clap_audio_buffer.data32` is `*mut *mut f32` for both
                            // directions; the input buffers are read-only by
                            // contract, and the cast states the struct's shape.
                            data32: unsafe { pointers.as_ptr().add(*offset) } as *mut *mut f32,
                            data64: ptr::null_mut(),
                            channel_count: *channels,
                            latency: 0,
                            constant_mask: 0,
                        };
                        *offset += *channels as usize;
                        Some(port)
                    })
                    .collect();
                Ok((scratch, pointers, buffers))
            };

        let (input_scratch, input_channel_ptrs, input_buffers) = build(input_ports, "input")?;
        let (output_scratch, output_channel_ptrs, output_buffers) = build(output_ports, "output")?;
        Ok(Self {
            input_scratch,
            output_scratch,
            input_channel_ptrs,
            output_channel_ptrs,
            input_buffers,
            output_buffers,
        })
    }
}

/// Empty input events list (no MIDI/parameter events for now).
static EMPTY_INPUT_EVENTS: clap_input_events = clap_input_events {
    ctx: ptr::null_mut(),
    size: Some(empty_events_size),
    get: Some(empty_events_get),
};

unsafe extern "C" fn empty_events_size(_list: *const clap_input_events) -> u32 {
    0
}

unsafe extern "C" fn empty_events_get(
    _list: *const clap_input_events,
    _index: u32,
) -> *const clap_event_header {
    ptr::null()
}

// ── Plugin → host output events ─────────────────────────────────────────

/// Build the output list the plugin writes its own events into.
///
/// The list is a two-field struct built on the caller's stack, and its `ctx` is
/// the queue's address — an `Arc` allocation made at load, whose address never
/// moves. Nothing here allocates, which is what lets `process_audio_internal`
/// build one per block on the audio thread.
///
/// # Safety
/// The returned list borrows `queue`, and the plugin may only write through it
/// during the `process`/`flush` call it is handed to. Both callers pass it by
/// reference into one call and drop it there.
fn capture_output_events(queue: &PluginParameterEventQueue) -> clap_output_events {
    clap_output_events {
        ctx: queue as *const PluginParameterEventQueue as *mut c_void,
        try_push: Some(output_events_try_push),
    }
}

/// Take one event the plugin produced. **Called on the audio thread inside
/// `process()`, so every line of it is real-time critical.**
///
/// Why each step is safe there:
///
/// * the header read is a plain load through a pointer the plugin owns for the
///   duration of the call;
/// * the type and size checks are branches;
/// * the push is [`PluginParameterEventQueue::push`], which is wait-free by
///   construction — bounded atomics into memory allocated at load, and no
///   allocation, lock, syscall or division;
/// * nothing logs. `eprintln!` locks stderr and makes a write syscall, which is
///   why an event this host does not model is dropped in silence rather than
///   reported from here.
///
/// An event the host does not model is absorbed and answered `true`: this host
/// has no note-output or MIDI-output path, and telling a plugin its note-end
/// could not be pushed would have it retry an event nothing will ever take. An
/// event the host *does* model and cannot store is answered `false`, which CLAP
/// defines and which lets a plugin re-send on its next block.
unsafe extern "C" fn output_events_try_push(
    list: *const clap_output_events,
    event: *const clap_event_header,
) -> bool {
    if list.is_null() || event.is_null() {
        return false;
    }
    let queue = (*list).ctx as *const PluginParameterEventQueue;
    if queue.is_null() {
        return true;
    }

    capture_header(&*queue, &*event, None)
}

/// The context a host-initiated write hands its capture list.
///
/// Lives on the caller's stack for the duration of one `flush` call, like the
/// input event it accompanies. Nothing here is allocated.
struct HostWriteCapture<'a> {
    queue: &'a PluginParameterEventQueue,
    /// The parameter the host just wrote. A `CLAP_EVENT_PARAM_VALUE` the plugin
    /// emits for it during this same call is the plugin repeating back what it
    /// was told, not an edit the user made.
    written_param_id: u32,
}

/// Build the output list for a **host-initiated** parameter write.
///
/// A plugin is free to echo an applied value straight back as an output event —
/// wrapper-generated plugins routinely do — and the ordinary capture list cannot
/// tell that echo from a user turning the same knob in the plugin's editor. Fed
/// to the renderer it would mark the project dirty on every automation point
/// played back, which is the same echo the VST3 half avoids by writing host
/// values through a queue the observers never see.
///
/// So the write's own parameter is dropped for the length of that one call.
/// Every other parameter still passes: a plugin whose macro moves three
/// dependent controls is reporting three real changes, and those are the events
/// this capture exists for.
///
/// # Accepted bound
/// A plugin that clamps, quantises or otherwise *corrects* the value it was
/// handed reports that correction on this same call, and it is dropped with the
/// echo. The host's recorded value is then the one it wrote until the plugin's
/// next edit or a parameter rescan re-reads the contract. Distinguishing a
/// correction from an echo needs a comparison the CLAP event carries no basis
/// for — the plugin reports the value, never whether it changed it.
fn capture_host_write_events(capture: &mut HostWriteCapture) -> clap_output_events {
    clap_output_events {
        ctx: capture as *mut HostWriteCapture as *mut c_void,
        try_push: Some(host_write_try_push),
    }
}

/// Take one event the plugin produced while answering a host write.
///
/// Same real-time contract as [`output_events_try_push`] — this runs on whatever
/// thread called `set_parameter`, which is the control path today, and is held
/// to the audio-thread rules anyway so the two lists cannot drift apart.
unsafe extern "C" fn host_write_try_push(
    list: *const clap_output_events,
    event: *const clap_event_header,
) -> bool {
    if list.is_null() || event.is_null() {
        return false;
    }
    let capture = (*list).ctx as *const HostWriteCapture;
    if capture.is_null() {
        return true;
    }

    let capture = &*capture;
    capture_header(capture.queue, &*event, Some(capture.written_param_id))
}

/// Decode one header and store it, unless it is the echo of `written_param_id`.
///
/// Shared by both capture lists so the two can never decode differently: the
/// only thing that separates them is which parameter, if any, is suppressed.
///
/// # Safety
/// `header` must point at a live `clap_event_header` whose `size` describes the
/// allocation it heads.
unsafe fn capture_header(
    queue: &PluginParameterEventQueue,
    header: &clap_event_header,
    written_param_id: Option<u32>,
) -> bool {
    if header.space_id != CLAP_CORE_EVENT_SPACE_ID {
        return true;
    }

    let Some(captured) = read_output_event(header) else {
        return true;
    };

    // Absorbed rather than refused: the plugin did nothing wrong, and telling it
    // the push failed would have it re-send an event the host will drop again.
    if is_echo_of_host_write(&captured, written_param_id) {
        return true;
    }

    queue.push(captured)
}

/// Whether this event is the plugin repeating a value the host just wrote.
///
/// Only a value event can be an echo. A gesture boundary is the plugin
/// reporting that a user took hold of the control, which a host write never
/// produces and which must reach the host even for the written parameter.
fn is_echo_of_host_write(event: &PluginParameterEvent, written_param_id: Option<u32>) -> bool {
    matches!(event.kind, PluginParameterEventKind::Value)
        && written_param_id == Some(event.param_id)
}

/// Read one core-space header as an event this host models, or `None`.
///
/// Split from the callback so the decoding — which event types are taken, and
/// the size check that makes each cast legal — is testable without a plugin, and
/// so the callback body stays short enough to read as real-time code.
///
/// # Safety
/// `header` must point at a live `clap_event_header` whose `size` describes the
/// allocation it heads, which is exactly the CLAP output-list contract.
unsafe fn read_output_event(header: &clap_event_header) -> Option<PluginParameterEvent> {
    match header.type_ {
        CLAP_EVENT_PARAM_VALUE => {
            // A plugin that under-declares its own event's size is describing a
            // shorter allocation than the cast reads. Refuse rather than read
            // past it — the same failure the scanner refuses on parameter names.
            if (header.size as usize) < mem::size_of::<clap_event_param_value>() {
                return None;
            }
            let event = &*(header as *const clap_event_header as *const clap_event_param_value);
            Some(PluginParameterEvent::value(event.param_id, event.value))
        }
        CLAP_EVENT_PARAM_GESTURE_BEGIN | CLAP_EVENT_PARAM_GESTURE_END => {
            if (header.size as usize) < mem::size_of::<clap_event_param_gesture>() {
                return None;
            }
            let event = &*(header as *const clap_event_header as *const clap_event_param_gesture);
            Some(if header.type_ == CLAP_EVENT_PARAM_GESTURE_BEGIN {
                PluginParameterEvent::gesture_begin(event.param_id)
            } else {
                PluginParameterEvent::gesture_end(event.param_id)
            })
        }
        _ => None,
    }
}

// ── Single-event input list for param flush ─────────────────────────────

/// Context for a single-event input list used during param flush.
struct SingleEventCtx {
    event: clap_event_param_value,
}

unsafe extern "C" fn single_event_size(_list: *const clap_input_events) -> u32 {
    1
}

unsafe extern "C" fn single_event_get(
    list: *const clap_input_events,
    _index: u32,
) -> *const clap_event_header {
    let ctx = (*list).ctx as *const SingleEventCtx;
    &(*ctx).event.header as *const clap_event_header
}

// ── Stream helpers for state save/load ──────────────────────────────────

unsafe extern "C" fn ostream_write(
    stream: *const clap_ostream,
    buffer: *const c_void,
    size: u64,
) -> i64 {
    let vec = &mut *((*stream).ctx as *mut Vec<u8>);
    let slice = std::slice::from_raw_parts(buffer as *const u8, size as usize);
    vec.extend_from_slice(slice);
    size as i64
}

unsafe extern "C" fn istream_read(
    stream: *const clap_istream,
    buffer: *mut c_void,
    size: u64,
) -> i64 {
    let cursor = &mut *((*stream).ctx as *mut StreamCursor);
    let remaining = cursor.data.len() - cursor.pos;
    let to_read = (size as usize).min(remaining);
    if to_read == 0 {
        return 0;
    }
    let src = &cursor.data[cursor.pos..cursor.pos + to_read];
    ptr::copy_nonoverlapping(src.as_ptr(), buffer as *mut u8, to_read);
    cursor.pos += to_read;
    to_read as i64
}

struct StreamCursor {
    data: Vec<u8>,
    pos: usize,
}

fn state_load_result(plugin_name: &str, loaded: bool) -> Result<(), String> {
    if loaded {
        return Ok(());
    }

    Err(format!("[CLAP] state.load() failed for {}", plugin_name))
}

/// Read a display string out of a fixed-size CLAP char array, or `None` when it
/// carries no terminator within its own bounds.
///
/// `CStr::from_ptr` on one of these arrays trusts the plugin to have placed a
/// NUL somewhere; a name that fills the array reads past it. The scanner has
/// always failed closed on exactly this; the runtime host owes it the same
/// refusal rather than an unbounded read.
fn bounded_parameter_name(value: &[std::os::raw::c_char]) -> Option<String> {
    let length = value.iter().position(|character| *character == 0)?;
    let bytes = value[..length]
        .iter()
        .map(|character| *character as u8)
        .collect::<Vec<_>>();
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

impl ClapWrapper {
    /// Load a CLAP plugin from a shared library path.
    ///
    /// `plugin_path`: Path to the .clap file (shared library)
    /// `plugin_id`: The CLAP plugin ID to instantiate (from the descriptor)
    /// `sample_rate`: The rate the engine rendering this plugin's audio runs at,
    ///   supplied by the caller. It is not the output device's rate: the two can
    ///   differ, and the plugin only ever sees engine-rendered audio, so
    ///   activating on the device's clock detunes everything the plugin does.
    pub fn new(plugin_path: &str, plugin_id: &str, sample_rate: f64) -> Result<Self, String> {
        let path = Path::new(plugin_path);
        let library_path = clap_library_path(path)?;
        unsafe {
            // 1. Load the shared library
            let library = Library::new(&library_path)
                .map_err(|e| format!("Failed to load CLAP plugin at {}: {}", plugin_path, e))?;

            // 2. Get the clap_entry symbol
            let entry: libloading::Symbol<*const clap_plugin_entry> = library
                .get(b"clap_entry\0")
                .map_err(|e| format!("No clap_entry symbol in {}: {}", plugin_path, e))?;

            let entry_ptr = *entry;
            if entry_ptr.is_null() {
                return Err("clap_entry symbol is null".to_string());
            }

            let entry_ref = &*entry_ptr;

            // 3. Call init. A false return leaves the entry not initialised, so
            //    the spec's init/deinit pairing never starts — same rule as the
            //    scan-time loader in `scanner.rs`.
            if let Some(init_fn) = entry_ref.init {
                let path_c = CString::new(plugin_path).map_err(|_| "Invalid plugin path")?;
                let ok = init_fn(path_c.as_ptr());
                if !ok {
                    return Err("clap_entry.init() returned false".to_string());
                }
            }

            // 4-9. `load_initialized_entry` owns the back half of the entry's
            // init/deinit pairing on every path out — including its own
            // failures, which is why the `?` below cannot leak an init.
            let mut wrapper = Self::load_initialized_entry(entry_ptr, plugin_id, sample_rate)?;

            // The entry and plugin pointers the wrapper holds are only sound
            // while this library stays loaded, so it is attached before the
            // wrapper escapes this function.
            wrapper._library = Some(library);
            Ok(wrapper)
        }
    }

    /// Load one plugin instance from an entry whose `init` has already run.
    ///
    /// The CLAP spec pairs `clap_entry.init`/`deinit` per entry, with `deinit`
    /// after every plugin instance is destroyed and before the library is
    /// unloaded. A bundle may register global resources in `init` and release
    /// them only in `deinit`, so a load path that skips it leaks per
    /// load/unload cycle and can fault when the library unloads code a
    /// registration still points at. This function keeps that pairing whole on
    /// every path: on failure it deinits before returning, and on success the
    /// returned wrapper's `Drop` deinits after destroying the plugin. `new`
    /// attaches the owning `Library` to the wrapper afterwards.
    ///
    /// # Safety
    /// `entry_ptr` must point to a `clap_plugin_entry` whose `init` succeeded,
    /// and whose library stays loaded for as long as the returned wrapper lives.
    unsafe fn load_initialized_entry(
        entry_ptr: *const clap_plugin_entry,
        plugin_id: &str,
        sample_rate: f64,
    ) -> Result<Self, String> {
        let loaded = Self::create_instance_from_entry(entry_ptr, plugin_id, sample_rate);
        match loaded {
            Ok(wrapper) => Ok(wrapper),
            Err(error) => {
                // No wrapper exists to carry the deinit, so it runs here —
                // the capture-then-deinit shape the scan-time loader uses.
                deinit_entry(entry_ptr);
                Err(error)
            }
        }
    }

    /// Factory query through activation, producing a wrapper that does not yet
    /// own the library the entry lives in (`new` attaches it) but records the
    /// entry so its `Drop` can deinit.
    ///
    /// # Safety
    /// `entry_ptr` must point to a live, initialised `clap_plugin_entry`.
    unsafe fn create_instance_from_entry(
        entry_ptr: *const clap_plugin_entry,
        plugin_id: &str,
        sample_rate: f64,
    ) -> Result<Self, String> {
        // 4. Get the plugin factory
        let factory_id = CLAP_PLUGIN_FACTORY_ID.as_ptr() as *const i8;
        let factory_ptr = if let Some(get_factory) = (*entry_ptr).get_factory {
            get_factory(factory_id)
        } else {
            return Err("clap_entry has no get_factory".to_string());
        };

        if factory_ptr.is_null() {
            return Err("Plugin factory is null".to_string());
        }

        let factory = &*(factory_ptr as *const clap_plugin_factory);

        // 5. Create host descriptor
        // Pin per-instance host callback state into the descriptor BEFORE the
        // plugin is created, so latency-change callbacks can reach this instance.
        let host_state = Box::new(HostCallbackState::default());
        let mut host = Box::new(create_host_descriptor());
        host.host_data = (&*host_state as *const HostCallbackState) as *mut c_void;
        let host_ptr: *const clap_host = &*host;

        // 6. Create the plugin instance
        let id_c = CString::new(plugin_id).map_err(|_| "Invalid plugin ID")?;

        let create_plugin = factory
            .create_plugin
            .ok_or("Factory has no create_plugin function")?;

        let plugin = create_plugin(factory, host_ptr, id_c.as_ptr());
        if plugin.is_null() {
            return Err(format!("Failed to create plugin instance: {}", plugin_id));
        }

        // 7. Init the plugin
        let plugin_ref = &*plugin;
        if let Some(init_fn) = plugin_ref.init {
            let ok = init_fn(plugin);
            if !ok {
                if let Some(destroy) = plugin_ref.destroy {
                    destroy(plugin);
                }
                return Err("plugin.init() returned false".to_string());
            }
        }

        // Read the plugin name
        let name = if !plugin_ref.desc.is_null() {
            let desc = &*plugin_ref.desc;
            if !desc.name.is_null() {
                CStr::from_ptr(desc.name).to_string_lossy().into_owned()
            } else {
                plugin_id.to_string()
            }
        } else {
            plugin_id.to_string()
        };

        // 8. Query extensions BEFORE activation. The audio-ports read is more
        //    than a capability probe: CLAP allows the port list to be read only
        //    while the plugin is deactivated, and the buffers handed to
        //    `process()` must match it — so the layout is read now or never.
        let params_ext = Self::query_extension::<clap_plugin_params>(plugin_ref, CLAP_EXT_PARAMS);
        let state_ext = Self::query_extension::<clap_plugin_state>(plugin_ref, CLAP_EXT_STATE);
        let gui_ext = Self::query_extension::<clap_plugin_gui>(plugin_ref, CLAP_EXT_GUI);
        let latency_ext =
            Self::query_extension::<clap_plugin_latency>(plugin_ref, CLAP_EXT_LATENCY);
        let tail_ext = Self::query_extension::<clap_plugin_tail>(plugin_ref, CLAP_EXT_TAIL);
        let audio = Self::read_audio_bus_layout(plugin_ref)?;
        let is_instrument = descriptor_declares_instrument(plugin);
        let accepts_note_events = Self::reads_note_input_ports(plugin_ref);

        if !params_ext.is_null() {
            eprintln!("[CLAP] Plugin '{}' supports CLAP_EXT_PARAMS", name);
        }
        if !state_ext.is_null() {
            eprintln!("[CLAP] Plugin '{}' supports CLAP_EXT_STATE", name);
        }
        if !gui_ext.is_null() {
            eprintln!("[CLAP] Plugin '{}' supports CLAP_EXT_GUI", name);
        }

        // 9. Activate the plugin. Activation is [main-thread]; entering the
        //    processing state is [audio-thread], so it stops here and the
        //    first block picks it up through the gate.
        let activated = activate_plugin(plugin, sample_rate);
        if !activated {
            eprintln!(
                "[CLAP] Warning: plugin.activate() returned false for {}",
                name
            );
        }

        let processing = Arc::new(ProcessingGate::default());
        if activated {
            processing.request_start();
        }

        eprintln!("[CLAP] Loaded plugin: {} (activated={})", name, activated);

        Ok(Self {
            _library: None,
            entry: entry_ptr,
            plugin,
            host,
            activated,
            name,
            sample_rate,
            params_ext,
            state_ext,
            gui_ext,
            latency_ext,
            tail_ext,
            host_state,
            gui_open: false,
            editor_resizer: None,
            processing,
            transport_scratch: Box::new(empty_transport_event()),
            has_transport: false,
            steady_time: 0,
            process_refused: false,
            process_refusal_reported: false,
            audio,
            is_instrument,
            accepts_note_events,
            editor_content_scale: crate::traits::DEFAULT_EDITOR_CONTENT_SCALE,
            midi_scratch: Vec::with_capacity(MAX_MIDI),
            parameter_scratch: Vec::with_capacity(MAX_PARAMETER_EVENTS),
            parameter_events: Arc::new(PluginParameterEventQueue::default()),
            #[cfg(feature = "engine-owned-command-fixture")]
            command_fixture: None,
        })
    }

    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn new_engine_owned_command_fixture(name: &str, state: Vec<u8>, has_gui: bool) -> Self {
        Self {
            _library: None,
            entry: ptr::null(),
            plugin: ptr::null(),
            host: Box::new(create_host_descriptor()),
            activated: true,
            name: name.to_string(),
            sample_rate: 0.0,
            params_ext: ptr::null(),
            state_ext: ptr::null(),
            gui_ext: ptr::null(),
            latency_ext: ptr::null(),
            tail_ext: ptr::null(),
            host_state: Box::new(HostCallbackState::default()),
            gui_open: false,
            editor_resizer: None,
            processing: Arc::new(ProcessingGate::fixture_already_processing()),
            transport_scratch: Box::new(empty_transport_event()),
            has_transport: false,
            steady_time: 0,
            process_refused: false,
            process_refusal_reported: false,
            audio: AudioBusLayout::portless(),
            is_instrument: false,
            accepts_note_events: true,
            editor_content_scale: crate::traits::DEFAULT_EDITOR_CONTENT_SCALE,
            midi_scratch: Vec::with_capacity(MAX_MIDI),
            parameter_scratch: Vec::with_capacity(MAX_PARAMETER_EVENTS),
            parameter_events: Arc::new(PluginParameterEventQueue::default()),
            command_fixture: Some(EngineOwnedCommandFixture {
                state,
                has_gui,
                editor_resizable: has_gui,
                parameters: Vec::new(),
                latency_samples: 0,
                gui_lifecycle_threads: Arc::new(Mutex::new(Vec::new())),
                editor_support_threads: Arc::new(Mutex::new(Vec::new())),
                teardown_observer: None,
                notifier_install_observer: None,
            }),
        }
    }

    /// The log every editor lifecycle call on this fixture writes its thread to.
    ///
    /// Handed out as a handle rather than read back through the runtime,
    /// because by the time a host has one the plugin is behind an access seam a
    /// test cannot reach around.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn engine_owned_command_fixture_gui_threads(
        &self,
    ) -> Option<Arc<Mutex<Vec<std::thread::ThreadId>>>> {
        self.command_fixture
            .as_ref()
            .map(|fixture| Arc::clone(&fixture.gui_lifecycle_threads))
    }

    /// The log every editor-support ask on this fixture writes its thread to.
    /// Handed out as a handle for the same reason the lifecycle log is.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn engine_owned_command_fixture_editor_support_threads(
        &self,
    ) -> Option<Arc<Mutex<Vec<std::thread::ThreadId>>>> {
        self.command_fixture
            .as_ref()
            .map(|fixture| Arc::clone(&fixture.editor_support_threads))
    }

    /// Stage the values the fixture reports from `get_parameters`.
    ///
    /// Stands in for a plugin-side parameter change: the plugin's own editor
    /// moved a control, so the plugin's current values no longer match anything
    /// the host wrote.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn set_engine_owned_command_fixture_parameters(
        &mut self,
        parameters: Vec<PluginParameter>,
    ) {
        if let Some(fixture) = self.command_fixture.as_mut() {
            fixture.parameters = parameters;
        }
    }

    /// Stage the latency the fixture declares, in frames of the rate it was
    /// activated with.
    ///
    /// Stands in for a plugin with a lookahead or an FFT window. A host has to
    /// compensate that figure across every route the instance sits on, and no
    /// fixture could otherwise report one — there is no latency extension
    /// behind a fixture to read.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn set_engine_owned_command_fixture_latency_samples(&mut self, latency_samples: u32) {
        if let Some(fixture) = self.command_fixture.as_mut() {
            fixture.latency_samples = latency_samples;
        }
    }

    /// Stage the answer the fixture's open editor gives to a host-chosen size.
    ///
    /// Stands in for a fixed-layout editor, which is the arm no fixture could
    /// otherwise reach: `open_gui` refuses a fixture with no GUI, so a host
    /// driving the open path end to end could only ever see the resizable
    /// answer, and a window told the wrong thing gives every fixed editor a
    /// draggable frame the plugin will refuse.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn set_engine_owned_command_fixture_editor_resizable(&mut self, editor_resizable: bool) {
        if let Some(fixture) = self.command_fixture.as_mut() {
            fixture.editor_resizable = editor_resizable;
        }
    }

    /// Be told the moment this fixture is torn down.
    ///
    /// Stands in for the plugin's own `deactivate`/`destroy`/`deinit`, which is
    /// where a host pays for dropping a runtime in the wrong place: those calls
    /// run on the dropping thread, take as long as the plugin takes, and a host
    /// that makes them inside a lock another thread needs has hung that thread
    /// for the duration. The observer runs at the top of the teardown, so it can
    /// read what the dropping thread still holds.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn observe_engine_owned_command_fixture_teardown(
        &mut self,
        observe: Box<dyn Fn() + Send + Sync>,
    ) {
        if let Some(fixture) = self.command_fixture.as_mut() {
            fixture.teardown_observer = Some(observe);
        }
    }

    /// Be told the moment this fixture's host-request wake is installed.
    ///
    /// The install crosses the host's access seam, which waits on the control
    /// gate an open editor holds and then on the audio thread's own claim. A
    /// host that installs under a lock the rest of the app takes has parked
    /// everything behind that wait, and no other answer of this wrapper's shows
    /// it — so the observer runs during the install, where it can read what the
    /// installing thread still holds.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn observe_engine_owned_command_fixture_notifier_install(
        &mut self,
        observe: Box<dyn Fn() + Send + Sync>,
    ) {
        if let Some(fixture) = self.command_fixture.as_mut() {
            fixture.notifier_install_observer = Some(observe);
        }
    }

    /// Leave a fixture unactivated, as a plugin whose `activate` failed is.
    ///
    /// A fixture has no plugin to fail an activation, and a host cannot make one
    /// fail from outside: the wrapper activates during construction. This is the
    /// only way a downstream host can drive the path that refuses to register an
    /// unactivated runtime with the engine.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn deactivate_engine_owned_command_fixture(&mut self) {
        if self.command_fixture.is_some() {
            self.activated = false;
        }
    }

    /// The host callback state a fixture's plugin would call into.
    ///
    /// Stands in for the plugin raising a host callback: a crate that hosts this
    /// fixture can arm `request_flush` or `rescan` exactly as a real plugin
    /// does, and read the flag back to prove a follow-up consumed it. Without
    /// it a downstream watcher's follow-up has no way to be driven at all, and
    /// its only test would be that nothing happens.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn engine_owned_command_fixture_host_state(&self) -> &HostCallbackState {
        &self.host_state
    }

    /// Latch a process failure on a fixture, exactly as the audio thread does:
    /// the wrapper's own flag, and the process-wide hint that wakes the control
    /// path. A fixture has no plugin to fail a real block, so this is the only
    /// way a downstream host can drive the visit that reports one.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn latch_engine_owned_command_fixture_process_refusal(&mut self) {
        self.latch_process_refusal();
    }

    /// Whether the recorded failure has already been said out loud. Read back to
    /// prove the visit reported it, and reported it once.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn engine_owned_command_fixture_refusal_reported(&self) -> bool {
        self.process_refusal_reported
    }

    /// Query a plugin extension by ID. Returns null if not supported.
    unsafe fn query_extension<T>(plugin_ref: &clap_plugin, ext_id: &CStr) -> *const T {
        if let Some(get_ext) = plugin_ref.get_extension {
            let ptr = get_ext(plugin_ref as *const clap_plugin, ext_id.as_ptr());
            if ptr.is_null() {
                return ptr::null();
            }
            ptr as *const T
        } else {
            ptr::null()
        }
    }

    /// Read the plugin's declared audio port layout.
    ///
    /// Must run before `activate`: CLAP states the port scan "has to be done
    /// while the plugin is deactivated". A plugin without `clap.audio-ports`
    /// has no audio ports — the spec's own rule — and loads as portless rather
    /// than as the stereo pair a hardcode would invent. A plugin whose port
    /// list cannot be read in full is refused: half a port list is a buffer
    /// table this host cannot honestly build.
    unsafe fn read_audio_bus_layout(plugin_ref: &clap_plugin) -> Result<AudioBusLayout, String> {
        let extension =
            Self::query_extension::<clap_plugin_audio_ports>(plugin_ref, CLAP_EXT_AUDIO_PORTS);
        if extension.is_null() {
            return Ok(AudioBusLayout::portless());
        }
        let audio_ports = &*extension;
        let read_direction = |is_input: bool| -> Result<Vec<u32>, String> {
            let direction = if is_input { "input" } else { "output" };
            let count = audio_ports
                .count
                .ok_or_else(|| format!("CLAP {direction} audio-ports has no count callback"))?;
            let count = count(plugin_ref as *const clap_plugin, is_input);
            if count > MAX_RUNTIME_AUDIO_PORTS {
                return Err(format!(
                    "CLAP {direction} audio port count exceeds runtime bounds"
                ));
            }
            let get = audio_ports
                .get
                .ok_or_else(|| format!("CLAP {direction} audio-ports has no info callback"))?;
            let mut channels = Vec::with_capacity(count as usize);
            for index in 0..count {
                let mut info: clap_audio_port_info = mem::zeroed();
                if !get(plugin_ref as *const clap_plugin, index, is_input, &mut info) {
                    return Err(format!(
                        "CLAP {direction} audio port {index} returned no port info"
                    ));
                }
                channels.push(info.channel_count);
            }
            Ok(channels)
        };
        let inputs = read_direction(true)?;
        let outputs = read_direction(false)?;
        AudioBusLayout::declared(&inputs, &outputs)
    }

    /// Whether the plugin takes note events in the dialect this host sends.
    ///
    /// The host's note events are `clap_event_note` — the CLAP dialect — so
    /// the truthful answer is whether any *input* note port lists that
    /// dialect. A plugin with no `clap.note-ports` has no note input at all,
    /// and a plugin whose ports speak only MIDI-family dialects cannot read
    /// what this host would send it; both answer `false` rather than have
    /// events routed at a port that will not understand them.
    unsafe fn reads_note_input_ports(plugin_ref: &clap_plugin) -> bool {
        let extension =
            Self::query_extension::<clap_plugin_note_ports>(plugin_ref, CLAP_EXT_NOTE_PORTS);
        if extension.is_null() {
            return false;
        }
        let note_ports = &*extension;
        let Some(count) = note_ports.count else {
            return false;
        };
        let input_ports = count(plugin_ref as *const clap_plugin, true);
        if input_ports > MAX_RUNTIME_AUDIO_PORTS {
            return false;
        }
        let Some(get) = note_ports.get else {
            return false;
        };
        (0..input_ports).any(|index| {
            let mut info: clap_note_port_info = mem::zeroed();
            get(plugin_ref as *const clap_plugin, index, true, &mut info)
                && info.supported_dialects & CLAP_NOTE_DIALECT_CLAP != 0
        })
    }

    /// Get the plugin descriptor info for scanning.
    pub fn get_name(&self) -> &str {
        &self.name
    }

    /// Returns true if the plugin was successfully activated.
    pub fn is_activated(&self) -> bool {
        self.activated
    }

    // ── GUI support ─────────────────────────────────────────────────────

    /// Returns true if the plugin provides a custom GUI.
    pub fn has_gui(&self) -> bool {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            // Recorded because the real VST3 backend answers this question with
            // a `createView` — an editor call — so a host that asks it on the
            // wrong thread is misbehaving in a way only the callee can see.
            fixture
                .editor_support_threads
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(std::thread::current().id());
            return fixture.has_gui;
        }

        !self.gui_ext.is_null()
    }

    /// Returns true if the GUI is currently open.
    pub fn is_gui_open(&self) -> bool {
        self.gui_open
    }

    /// Get the preferred GUI size (width, height) if the plugin has a GUI.
    /// Must be called AFTER gui.create() for most plugins.
    pub fn get_gui_size(&self) -> Option<(u32, u32)> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            return if fixture.has_gui {
                Some((800, 600))
            } else {
                None
            };
        }

        if self.gui_ext.is_null() || self.plugin.is_null() {
            return None;
        }
        unsafe {
            let gui = &*self.gui_ext;
            let get_size = gui.get_size?;
            let mut width: u32 = 0;
            let mut height: u32 = 0;
            if get_size(self.plugin, &mut width, &mut height) {
                Some((width, height))
            } else {
                None
            }
        }
    }

    /// Get the platform-specific window API string for CLAP.
    fn platform_api() -> &'static CStr {
        #[cfg(target_os = "macos")]
        {
            CLAP_WINDOW_API_COCOA
        }
        #[cfg(target_os = "windows")]
        {
            CLAP_WINDOW_API_WIN32
        }
        #[cfg(target_os = "linux")]
        {
            CLAP_WINDOW_API_X11
        }
    }

    /// Whether `clap_plugin_gui.set_scale` applies to a window API.
    ///
    /// gui.h's own rule: set_scale is "an absolute GUI scaling factor" for APIs
    /// in physical pixels, and should not be used for one "rel[ying] upon
    /// logical pixels" — which is exactly what it says about cocoa. Telling a
    /// cocoa editor a 2.0 host scale double-sizes it, because the OS already
    /// applied that scale in logical size; JUCE wrappers honor the call, so the
    /// host is the one who must not make it.
    fn scale_applies_to(api: &CStr) -> bool {
        api != CLAP_WINDOW_API_COCOA
    }

    /// How many plugin-stated units one logical window unit is worth here.
    ///
    /// gui.h states editor sizes in physical pixels for win32 and x11, and in
    /// logical pixels for cocoa — the same split [`Self::scale_applies_to`]
    /// encodes, because it is the same clause of the spec. The shell's window
    /// seam is logical everywhere, so a physical-pixel API converts by the
    /// display scale and cocoa converts by nothing.
    ///
    /// A scale nothing could be sized by converts nothing rather than
    /// destroying every size that crosses.
    fn plugin_units_per_logical_unit(&self) -> f64 {
        if !Self::scale_applies_to(Self::platform_api()) {
            return 1.0;
        }
        if self.editor_content_scale.is_finite() && self.editor_content_scale > 0.0 {
            self.editor_content_scale
        } else {
            crate::traits::DEFAULT_EDITOR_CONTENT_SCALE
        }
    }

    /// A size scaled by `factor`, rounded, and never scaled away to nothing: a
    /// window of zero extent is not a smaller editor, it is no editor.
    fn scaled_size((width, height): (u32, u32), factor: f64) -> (u32, u32) {
        let convert = |value: u32| {
            (f64::from(value) * factor)
                .round()
                .clamp(1.0, f64::from(u32::MAX)) as u32
        };
        (convert(width), convert(height))
    }

    /// A size the plugin stated, in the logical units the window seam sizes in.
    fn to_logical_units(&self, size: (u32, u32)) -> (u32, u32) {
        Self::scaled_size(size, 1.0 / self.plugin_units_per_logical_unit())
    }

    /// A size the host holds, in the units this platform's `gui` extension
    /// speaks.
    fn to_plugin_units(&self, size: (u32, u32)) -> (u32, u32) {
        Self::scaled_size(size, self.plugin_units_per_logical_unit())
    }

    /// Open the plugin GUI, parenting it into the given native window handle.
    ///
    /// `handle_ptr` is the platform-specific handle:
    /// - macOS: NSView* (as *mut c_void)
    /// - Windows: HWND (as *mut c_void)
    /// - Linux: X11 Window ID (as c_ulong)
    ///
    /// CLAP GUI lifecycle (exact order):
    /// 1. gui.is_api_supported(api, false)
    /// 2. gui.create(api, false)
    /// 3. gui.set_scale(scale)
    /// 4. gui.get_size(&w, &h)
    /// 5. gui.set_parent(window)
    /// 6. gui.show()
    pub fn open_gui(&mut self, handle_ptr: *mut c_void) -> Result<(u32, u32), String> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            record_gui_lifecycle_thread(fixture);
            if !fixture.has_gui {
                return Err("Plugin does not support GUI".to_string());
            }
            if self.gui_open {
                return Err("GUI is already open".to_string());
            }

            self.gui_open = true;
            return Ok((800, 600));
        }

        if self.gui_ext.is_null() || self.plugin.is_null() {
            return Err("Plugin does not support GUI".to_string());
        }

        if self.gui_open {
            return Err("GUI is already open".to_string());
        }

        unsafe {
            let gui = &*self.gui_ext;
            let api = Self::platform_api();

            // 1. Check API support
            if let Some(is_supported) = gui.is_api_supported {
                if !is_supported(self.plugin, api.as_ptr(), false) {
                    return Err(format!(
                        "Plugin '{}' does not support embedded GUI on this platform",
                        self.name
                    ));
                }
            }

            // 2. Create GUI
            let create = gui.create.ok_or("Plugin GUI has no create function")?;
            if !create(self.plugin, api.as_ptr(), false) {
                return Err(format!("Plugin '{}' gui.create() failed", self.name));
            }

            // 3. Set scale — the host's stated display scale, defaulting to
            //    1.0 until one arrives. Called here because CLAP places it
            //    between create and get_size; a plugin that prefers the OS's
            //    own value ignores it, which the spec allows. Skipped for
            //    cocoa, whose logical-pixel sizes already carry the OS scale —
            //    see [`Self::scale_applies_to`].
            if Self::scale_applies_to(api) {
                if let Some(set_scale) = gui.set_scale {
                    set_scale(self.plugin, self.editor_content_scale);
                }
            }

            // 4. Get size
            let mut width: u32 = 800;
            let mut height: u32 = 600;
            if let Some(get_size) = gui.get_size {
                get_size(self.plugin, &mut width, &mut height);
            }

            // 5. Set parent — build the clap_window with the native handle
            let window = clap_window {
                api: api.as_ptr(),
                specific: {
                    #[cfg(target_os = "macos")]
                    {
                        clap_window_handle { cocoa: handle_ptr }
                    }
                    #[cfg(target_os = "windows")]
                    {
                        clap_window_handle { win32: handle_ptr }
                    }
                    #[cfg(target_os = "linux")]
                    {
                        clap_window_handle {
                            x11: handle_ptr as u64,
                        }
                    }
                },
            };

            if let Some(set_parent) = gui.set_parent {
                if !set_parent(self.plugin, &window) {
                    // Clean up
                    if let Some(destroy) = gui.destroy {
                        destroy(self.plugin);
                    }
                    return Err(format!("Plugin '{}' gui.set_parent() failed", self.name));
                }
            }

            // 6. Show
            if let Some(show) = gui.show {
                show(self.plugin);
            }

            self.gui_open = true;
            // Reported in the window seam's units, like every other size that
            // leaves here: `get_size` answered in the plugin's.
            let opened = self.to_logical_units((width, height));
            eprintln!(
                "[CLAP] Opened GUI for '{}' ({}x{})",
                self.name, opened.0, opened.1
            );
            Ok(opened)
        }
    }

    /// Install how the host resizes the window this editor is drawn into.
    ///
    /// Both halves of the answer move together: the wrapper holds the resizer
    /// the control path calls, and the host callback state holds the fact that
    /// there is one, because the plugin's own callback has to decide whether to
    /// accept a resize without reaching the wrapper.
    pub fn set_editor_window_resizer(&mut self, resize: EditorWindowResizer) {
        self.editor_resizer = Some(resize);
        self.host_state.set_editor_resize_available(true);
    }

    /// Stop answering resize requests. Called wherever the editor's host window
    /// stops existing.
    fn release_editor_window_resizer(&mut self) {
        self.editor_resizer = None;
        self.host_state.set_editor_resize_available(false);
    }

    /// Resize the window this editor is drawn into, where the host gave one.
    ///
    /// Absent for a caller that opened the editor with no window — the scan
    /// worker and the tests both do — in which case there is nothing to move.
    fn resize_host_window(&self, width: u32, height: u32) {
        if let Some(resize) = self.editor_resizer.as_ref() {
            resize(width, height);
        }
    }

    /// The `gui` extension of an editor that is open, or nothing.
    ///
    /// Every host-initiated editor operation asks for this first: `can_resize`,
    /// `adjust_size` and `set_size` are all `[main-thread]` calls against a GUI
    /// that exists, and asking a plugin whose editor was never created is a call
    /// into a plugin state the format does not define.
    ///
    /// # Safety
    /// The returned reference borrows the plugin's own extension struct, which
    /// lives as long as the plugin does. Control path only.
    unsafe fn open_gui_extension(&self) -> Option<&clap_plugin_gui> {
        if self.gui_ext.is_null() || self.plugin.is_null() || !self.gui_open {
            return None;
        }
        Some(&*self.gui_ext)
    }

    /// Whether the plugin accepts a size the host chose.
    ///
    /// `clap_plugin_gui.can_resize` is the plugin's own answer, and a plugin
    /// that does not implement it has not said yes: gui.h defines the whole
    /// host-driven resize sequence as reachable only when it returns true.
    pub fn editor_can_resize(&self) -> bool {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            return fixture.editor_resizable && self.gui_open;
        }

        // SAFETY: control path only; the extension outlives this borrow.
        unsafe {
            let Some(gui) = self.open_gui_extension() else {
                return false;
            };
            match gui.can_resize {
                Some(can_resize) => can_resize(self.plugin),
                None => false,
            }
        }
    }

    /// Resize the editor because the host's window was resized, reporting the
    /// size the plugin adjusted the request to. **Control path only.**
    ///
    /// gui.h's own host-driven sequence: ask `adjust_size` for a size the plugin
    /// will run at, then hand it that size through `set_size`. The host window
    /// moves between the two — the order VST3 states outright, and the one every
    /// embedded editor depends on, because a plugin told to lay out at a size
    /// its window has not taken yet lays out against the window it is still in.
    ///
    /// A plugin that refuses the adjusted size leaves the host holding a window
    /// it moved for nothing, so the refusal puts the window back before it is
    /// reported.
    ///
    /// The size arrives and leaves in the window seam's logical units; the
    /// plugin is asked and told in its own, which on win32 and x11 are physical
    /// pixels.
    pub fn request_editor_size(&mut self, width: u32, height: u32) -> Result<(u32, u32), String> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            record_gui_lifecycle_thread(fixture);
            if !self.gui_open {
                return Err("Plugin has no open editor to resize".to_string());
            }
            self.resize_host_window(width, height);
            return Ok((width, height));
        }

        if !self.editor_can_resize() {
            return Err(format!(
                "Plugin '{}' has no resizable open editor",
                self.name
            ));
        }

        let previous = self.get_gui_size();
        let (mut granted_width, mut granted_height) = self.to_plugin_units((width, height));
        // SAFETY: control path only, with the editor open; every call below is
        // one this platform's `gui` extension declared.
        unsafe {
            let Some(gui) = self.open_gui_extension() else {
                return Err(format!(
                    "Plugin '{}' has no open editor to resize",
                    self.name
                ));
            };

            if let Some(adjust_size) = gui.adjust_size {
                if !adjust_size(self.plugin, &mut granted_width, &mut granted_height) {
                    return Err(format!(
                        "Plugin '{}' refused the requested editor size",
                        self.name
                    ));
                }
            }

            let granted = self.to_logical_units((granted_width, granted_height));
            self.resize_host_window(granted.0, granted.1);

            if let Some(set_size) = gui.set_size {
                if !set_size(self.plugin, granted_width, granted_height) {
                    if let Some(previous) = previous {
                        let (width, height) = self.to_logical_units(previous);
                        self.resize_host_window(width, height);
                    }
                    return Err(format!(
                        "Plugin '{}' refused to move to the adjusted editor size",
                        self.name
                    ));
                }
            }

            Ok(granted)
        }
    }

    /// Restate the display scale for an editor that is already open, reporting
    /// the size its host window must take now. **Control path only.**
    ///
    /// The scale is kept as well as applied, so an editor closed and reopened on
    /// the display it was moved to opens at the scale it is on. The size is
    /// re-read rather than assumed: `set_scale` is what makes a plugin lay itself
    /// out at the new density, and `get_size` is the only way to learn what that
    /// came to.
    pub fn apply_editor_content_scale(&mut self, scale: f64) -> Result<(u32, u32), String> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            record_gui_lifecycle_thread(fixture);
            let Some((width, height)) = self.get_gui_size().filter(|_| self.gui_open) else {
                return Err("Plugin has no open editor to re-scale".to_string());
            };
            self.editor_content_scale = scale;
            self.resize_host_window(width, height);
            return Ok((width, height));
        }

        if !(scale.is_finite() && scale > 0.0) {
            return Err(format!(
                "Plugin '{}' cannot be told a display scale of {scale}",
                self.name
            ));
        }
        self.editor_content_scale = scale;

        // SAFETY: control path only, with the editor open.
        unsafe {
            let Some(gui) = self.open_gui_extension() else {
                return Err(format!(
                    "Plugin '{}' has no open editor to re-scale",
                    self.name
                ));
            };
            // Skipped for cocoa for the same reason the open path skips it:
            // its logical sizes already carry the OS scale.
            if Self::scale_applies_to(Self::platform_api()) {
                if let Some(set_scale) = gui.set_scale {
                    set_scale(self.plugin, scale);
                }
            }
        }

        let stated = self.get_gui_size().ok_or_else(|| {
            format!(
                "Plugin '{}' states no editor size at the new display scale",
                self.name
            )
        })?;
        // Converted through the scale just stored: what the plugin lays out at
        // the new density is stated in its own units, and the window it sits in
        // is sized in the seam's.
        let (width, height) = self.to_logical_units(stated);
        self.resize_host_window(width, height);
        Ok((width, height))
    }

    /// Apply a size the plugin asked for through `clap_host_gui.request_resize`,
    /// reporting what was applied. Control path only — it reaches the shell's
    /// window server.
    pub fn apply_pending_editor_resize(&mut self) -> Option<(u32, u32)> {
        let requested = self.host_state.take_editor_resize()?;
        let resize = self.editor_resizer.as_ref()?;
        // The plugin asked in its own units; the window is sized in the seam's.
        let (width, height) = self.to_logical_units(requested);
        resize(width, height);
        Some((width, height))
    }

    /// Install the wake fired for this host's `[main-thread]` asks, answered off
    /// the calling thread. First install wins; a second call reports `false`.
    ///
    /// The install also gates the `[thread-safe]` asks' acceptance — the drain
    /// thread that answers them serves exactly the instances the native engine
    /// took, which is exactly where this is installed.
    pub fn set_plugin_host_request_notifier(&self, notifier: PluginHostRequestNotifier) -> bool {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(observe) = self
            .command_fixture
            .as_ref()
            .and_then(|fixture| fixture.notifier_install_observer.as_ref())
        {
            observe();
        }
        self.host_state.set_request_notifier(notifier)
    }

    /// The queue this plugin's own parameter events land in. Clone it to drain
    /// without holding the wrapper.
    pub fn parameter_event_queue(&self) -> Arc<PluginParameterEventQueue> {
        Arc::clone(&self.parameter_events)
    }

    /// Answer a `clap_host_params.request_flush` by calling `params.flush()`.
    /// **Control path only.**
    ///
    /// CLAP splits `flush` by thread on the processing state: while the plugin
    /// is being handed blocks it is `[audio-thread]`, and the plugin's output
    /// comes back through `process()` anyway — so a request that arrives while
    /// processing is answered by doing nothing here and letting the next block
    /// carry it. Only the `!processing` case is this thread's to make.
    ///
    /// The flag is taken first and unconditionally: an ask answered by the audio
    /// path is answered, and leaving the flag set would flush again the moment
    /// the plugin stopped.
    pub fn flush_parameters_off_audio_thread(&mut self) -> bool {
        if !self.host_state.take_parameters_flush() {
            return false;
        }
        if self.processing.is_processing() {
            return false;
        }
        if self.params_ext.is_null() || self.plugin.is_null() {
            return false;
        }

        unsafe {
            let params = &*self.params_ext;
            let Some(flush) = params.flush else {
                return false;
            };
            let out_events = capture_output_events(&self.parameter_events);
            flush(self.plugin, &EMPTY_INPUT_EVENTS, &out_events);
        }
        true
    }

    /// Close (hide + destroy) the plugin GUI.
    pub fn close_gui(&mut self) {
        // Before the early returns below: whether the plugin had an editor to
        // destroy or not, this instance no longer has a host window, and a
        // resize accepted against one that is gone is a resize nothing applies.
        self.release_editor_window_resizer();

        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            record_gui_lifecycle_thread(fixture);
            self.gui_open = false;
            return;
        }

        if self.gui_ext.is_null() || self.plugin.is_null() || !self.gui_open {
            return;
        }

        unsafe {
            let gui = &*self.gui_ext;

            if let Some(hide) = gui.hide {
                hide(self.plugin);
            }
            if let Some(destroy) = gui.destroy {
                destroy(self.plugin);
            }
        }

        self.gui_open = false;
        eprintln!("[CLAP] Closed GUI for '{}'", self.name);
    }

    /// Process audio with MIDI note events.
    ///
    /// RT-safe: reuses `self.midi_scratch` (preallocated in `new`). Events beyond `MAX_MIDI`
    /// per block are dropped — callers should batch at a reasonable granularity.
    pub fn process_with_midi(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        midi_events: &[HostMidiEvent],
    ) {
        self.process_with_midi_and_parameters(inputs, outputs, num_samples, midi_events, &[]);
    }

    /// Process audio with pending CLAP parameter value events.
    pub fn process_with_parameter_updates(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        parameter_updates: &[HostParameterUpdate],
    ) {
        self.process_with_midi_and_parameters(inputs, outputs, num_samples, &[], parameter_updates);
    }

    /// Process audio with MIDI and CLAP parameter events.
    ///
    /// RT-safe: reuses preallocated MIDI and parameter scratch vectors. Values beyond
    /// the fixed capacities are ignored by this block; the engine-side pending queue
    /// is sized to this same bound, so accepted parameter updates fit here.
    pub fn process_with_midi_and_parameters(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        midi_events: &[HostMidiEvent],
        parameter_updates: &[HostParameterUpdate],
    ) {
        if !self.activated
            || self.plugin.is_null()
            || (midi_events.is_empty() && parameter_updates.is_empty())
        {
            self.process_audio_internal(inputs, outputs, num_samples, &EMPTY_INPUT_EVENTS);
            return;
        }

        fill_note_scratch(&mut self.midi_scratch, midi_events);
        self.parameter_scratch.clear();
        for update in parameter_updates.iter().take(MAX_PARAMETER_EVENTS) {
            self.parameter_scratch.push(clap_event_param_value {
                header: clap_event_header {
                    size: mem::size_of::<clap_event_param_value>() as u32,
                    time: 0,
                    space_id: CLAP_CORE_EVENT_SPACE_ID,
                    type_: CLAP_EVENT_PARAM_VALUE,
                    flags: 0,
                },
                param_id: update.param_id,
                cookie: ptr::null_mut(),
                note_id: -1,
                port_index: -1,
                channel: -1,
                key: -1,
                value: update.value,
            });
        }

        // Raw pointer into the scratch vec — safe because process_audio_internal
        // does not touch event scratch (it only uses input_scratch/output_scratch/plugin).
        let midi_events_ptr: *const clap_event_note = self.midi_scratch.as_ptr();
        let midi_events_count = self.midi_scratch.len() as u32;
        let parameter_events_ptr: *const clap_event_param_value = self.parameter_scratch.as_ptr();
        let parameter_events_count = self.parameter_scratch.len() as u32;

        struct EventListCtx {
            midi_events: *const clap_event_note,
            midi_count: u32,
            parameter_events: *const clap_event_param_value,
            parameter_count: u32,
        }

        unsafe extern "C" fn event_list_size(list: *const clap_input_events) -> u32 {
            let ctx = (*list).ctx as *const EventListCtx;
            (*ctx).midi_count + (*ctx).parameter_count
        }

        unsafe extern "C" fn event_list_get(
            list: *const clap_input_events,
            index: u32,
        ) -> *const clap_event_header {
            let ctx = (*list).ctx as *const EventListCtx;
            if index < (*ctx).parameter_count {
                return &(*(*ctx).parameter_events.add(index as usize)).header
                    as *const clap_event_header;
            }

            let midi_index = index - (*ctx).parameter_count;
            if midi_index >= (*ctx).midi_count {
                return ptr::null();
            }
            &(*(*ctx).midi_events.add(midi_index as usize)).header as *const clap_event_header
        }

        let mut ctx = EventListCtx {
            midi_events: midi_events_ptr,
            midi_count: midi_events_count,
            parameter_events: parameter_events_ptr,
            parameter_count: parameter_events_count,
        };
        let input_events = clap_input_events {
            ctx: &mut ctx as *mut EventListCtx as *mut c_void,
            size: Some(event_list_size),
            get: Some(event_list_get),
        };

        self.process_audio_internal(inputs, outputs, num_samples, &input_events);
    }

    /// The processing gate shared with this plugin's runtime owner. Clone it to
    /// request a stop, or to observe whether one has been carried out, without
    /// holding the wrapper.
    pub fn processing_gate(&self) -> Arc<ProcessingGate> {
        Arc::clone(&self.processing)
    }

    /// Supply the host timeline the next block hands the plugin.
    ///
    /// Refills the preallocated transport event in place, so this is safe to
    /// call from the audio thread immediately before `process`.
    pub fn set_transport(&mut self, transport: HostTransport) {
        fill_transport_event(&mut self.transport_scratch, transport);
        self.has_transport = true;
    }

    /// Carry out whatever processing-state transition the control thread asked
    /// for. **Audio thread only** — it is the caller's thread affinity that
    /// makes these CLAP calls legal.
    ///
    /// The runtime owner also calls this on a block it will not process, so an
    /// instance on its way out still leaves the processing state on the right
    /// thread.
    pub fn sync_processing_state(&mut self) {
        let wants = self.processing.wants_processing();
        if wants == self.processing.is_processing() {
            return;
        }

        if wants {
            let started = match self.plugin_callback(|plugin_ref| plugin_ref.start_processing) {
                // A plugin with no callback is always free to process; one that
                // is not loaded at all is not.
                Some(start_processing) => unsafe { start_processing(self.plugin) },
                None => !self.plugin.is_null(),
            };
            if started {
                self.processing.mark_started();
            }
            return;
        }

        if let Some(stop_processing) = self.plugin_callback(|plugin_ref| plugin_ref.stop_processing)
        {
            unsafe { stop_processing(self.plugin) };
        }
        self.processing.mark_stopped();
    }

    /// Read one optional callback off the loaded plugin, or `None` when nothing
    /// is loaded. Keeps the null check in one place instead of at each use.
    fn plugin_callback<Callback>(
        &self,
        select: impl FnOnce(&clap_plugin) -> Option<Callback>,
    ) -> Option<Callback> {
        if self.plugin.is_null() {
            return None;
        }
        select(unsafe { &*self.plugin })
    }

    /// Leave the processing state from a thread that is not the audio thread.
    ///
    /// Only correct when no further block will ever arrive — an unload, or a
    /// deactivate/reactivate cycle that holds the wrapper exclusively — because
    /// CLAP requires processing to have stopped before `deactivate`, and by then
    /// the audio thread has no way to do it. Prefer
    /// `ProcessingGate::request_stop` plus a block; this counts every time it
    /// has to step in, so the deviation stays visible.
    pub fn force_stop_processing_off_audio_thread(&mut self) {
        self.processing.request_stop();

        if !self.processing.is_processing() {
            // The audio thread already stopped it, or it never started.
            return;
        }

        if !self.plugin.is_null() {
            unsafe {
                if let Some(stop_processing) = (*self.plugin).stop_processing {
                    stop_processing(self.plugin);
                }
            }
        }
        self.processing.mark_stopped();
        self.processing.count_off_audio_thread_stop();
    }

    /// Internal process method that accepts a custom input events list.
    ///
    /// RT-safe: uses preallocated `input_scratch`/`output_scratch`. Stack-allocates pointer
    /// arrays. No heap allocation on the hot path.
    fn process_audio_internal(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        in_events: &clap_input_events,
    ) {
        if !self.activated || self.plugin.is_null() {
            copy_inputs_to_outputs(inputs, outputs, num_samples);
            return;
        }

        // This is the audio thread, which is the only thread CLAP allows to
        // enter or leave the processing state — so this is where the control
        // thread's intent is carried out.
        self.sync_processing_state();

        if !self.processing.is_processing() {
            // Either the plugin refused to start, or a stop has been requested
            // and performed. Either way it must not be handed a block.
            copy_inputs_to_outputs(inputs, outputs, num_samples);
            return;
        }

        let n_samp = num_samples.min(MAX_BUFFER);

        // A plugin that declares no audio ports processes no audio: hand the
        // block back untouched and still call process — a note effect owes the
        // host its output events, and it still gets the timeline. This used to
        // feed such a plugin a stereo pair and copy its untouched scratch out,
        // silently muting the track.
        if self.audio.input_buffers.is_empty() && self.audio.output_buffers.is_empty() {
            if let Some(process_fn) = self.plugin_callback(|plugin_ref| plugin_ref.process) {
                // A null transport tells the plugin the host has no timeline,
                // which is only the truth while none has been supplied.
                let transport = if self.has_transport {
                    &*self.transport_scratch as *const clap_event_transport
                } else {
                    ptr::null()
                };
                let out_events = capture_output_events(&self.parameter_events);
                let process_data = clap_process {
                    steady_time: self.steady_time,
                    frames_count: n_samp as u32,
                    transport,
                    audio_inputs: ptr::null(),
                    audio_outputs: ptr::null_mut(),
                    audio_inputs_count: 0,
                    audio_outputs_count: 0,
                    in_events,
                    out_events: &out_events,
                };
                let status = unsafe { process_fn(self.plugin, &process_data) };
                self.advance_steady_time(n_samp);
                if process_failed(status) {
                    // A plugin with no audio ports wrote no audio to invalidate:
                    // the block passes through its slot either way, and the
                    // failure costs only the output events this call was made
                    // for. Recording it is all the host can honestly do.
                    self.latch_process_refusal();
                }
            }
            copy_inputs_to_outputs(inputs, outputs, num_samples);
            return;
        }

        // Copy the engine's channels into the declared input scratch. The
        // engine's bus is stereo; a plugin declaring more channels gets the
        // rest as the silence they were zeroed to at load, and one declaring
        // fewer reads the leading channels. No allocation on the RT path.
        fill_input_scratch(&mut self.audio, inputs, n_samp);
        // Zero the whole output scratch: the plugin is not obliged to write
        // every channel it was handed, and the previous block's audio must not
        // leak into this one.
        self.audio.output_scratch.fill(0.0);

        unsafe {
            let plugin_ref = &*self.plugin;
            let process_fn = match plugin_ref.process {
                Some(f) => f,
                None => return,
            };

            // The buffer tables were built at load against this same scratch,
            // so this only names them — no per-block pointer arithmetic.
            let input_buffers = self.audio.input_buffers.as_ptr();
            let output_buffers = self.audio.output_buffers.as_mut_ptr();

            // A null transport tells the plugin the host has no timeline, so it
            // is only sent while that is actually true. Once the host supplies
            // one, the preallocated event is passed by pointer — the plugin
            // reads it during this call and never retains it.
            let transport = if self.has_transport {
                &*self.transport_scratch as *const clap_event_transport
            } else {
                ptr::null()
            };

            let out_events = capture_output_events(&self.parameter_events);
            let process_data = clap_process {
                steady_time: self.steady_time,
                frames_count: n_samp as u32,
                transport,
                audio_inputs: input_buffers,
                audio_outputs: output_buffers,
                audio_inputs_count: self.audio.input_buffers.len() as u32,
                audio_outputs_count: self.audio.output_buffers.len() as u32,
                in_events,
                out_events: &out_events,
            };

            let status = process_fn(self.plugin, &process_data);
            self.advance_steady_time(n_samp);

            if process_failed(status) {
                self.latch_process_refusal();
                // CLAP defines the error as "the plugin failed to process, and
                // the output buffers are in an undefined state", so the output
                // scratch is not audio and is never copied out. What reaches the
                // bus instead is what ADR 0021 DG-003 decides for a failed slot:
                // only an effect with a valid dry input passes it, because
                // muting a crashed EQ takes the track with it. An instrument
                // falls silent even when it declares an input port — the
                // Surge XT shape, where routed audio feeds the oscillators — and
                // its slot is a synth voice, not a path that signal was ever
                // meant to travel through.
                //
                // What the plugin calls itself decides that; the input bus only
                // stands in when the descriptor says nothing, and a plugin with
                // no input bus has no dry signal to pass whatever it claims.
                //
                // The failure invalidates the scratch, not the caller's
                // `inputs` — `fill_input_scratch` copies out of them — so this
                // block's dry signal is still there to pass.
                //
                // A hard switch, like the bypass paths above: DG-003's ramp into
                // the failure signal is failure-policy machinery that arrives
                // with the rest of that policy.
                if self.is_instrument || self.audio.input_buffers.is_empty() {
                    silence_outputs(outputs, n_samp);
                } else {
                    copy_inputs_to_outputs(inputs, outputs, num_samples);
                }
                return;
            }

            read_output_scratch(&self.audio, outputs, n_samp);
        }
    }

    /// Charge one processed block to the activation's steady sample clock.
    ///
    /// Saturating because CLAP types `steady_time` as a signed 64-bit frame
    /// count and requires it to be increasing: at 48 kHz the saturation point is
    /// six million years away, and wrapping into negatives there would hand a
    /// plugin a counter that ran backwards.
    fn advance_steady_time(&mut self, frames: usize) {
        self.steady_time = self.steady_time.saturating_add(frames as i64);
    }

    /// Record a process failure, and wake the control path the first time.
    ///
    /// Audio thread. The store happens on the first failing block only: a plugin
    /// failing every block latches once and then costs one bool test, and the
    /// control path is told once about news it can only report once.
    fn latch_process_refusal(&mut self) {
        if self.process_refused {
            return;
        }
        self.process_refused = true;
        signal_pending_process_refusal();
    }

    /// Say out loud what the audio thread recorded.
    ///
    /// The audio thread cannot report anything itself — it may not allocate or
    /// take the I/O lock — so what it saw is left as a flag for the control path
    /// to read. Latched, so a plugin that fails every block still produces one
    /// line.
    fn report_plugin_observations(&mut self) {
        if !self.process_refused || self.process_refusal_reported {
            return;
        }
        self.process_refusal_reported = true;
        eprintln!(
            "[CLAP] '{}' failed a process call; the host did not use its output for those blocks",
            self.name
        );
    }
}

/// Whether a process status means the block's output is not the plugin's.
///
/// CLAP defines every other status as a success: `CONTINUE`,
/// `CONTINUE_IF_NOT_QUIET`, `TAIL` and `SLEEP` all describe whether the plugin
/// still has something to add, which is a scheduling hint this host does not act
/// on because it processes continuously. Only the error invalidates the block.
fn process_failed(status: clap_process_status) -> bool {
    status == CLAP_PROCESS_ERROR
}

/// Whether the plugin's descriptor calls it an instrument.
///
/// Read through the same feature mapping the scanner categorises with, so the
/// browser and the audio path cannot disagree about what a plugin is. A plugin
/// that declares no features, or none this host recognises, is not an
/// instrument — the same default the scanner falls back to.
///
/// # Safety
///
/// `plugin` is either null or a live plugin whose descriptor outlives it, which
/// CLAP requires of `clap_plugin.desc`.
unsafe fn descriptor_declares_instrument(plugin: *const clap_plugin) -> bool {
    if plugin.is_null() || (*plugin).desc.is_null() {
        return false;
    }
    let features = owned_feature_list((*(*plugin).desc).features);
    category_from_clap_features(&features) == "instrument"
}

/// Write silence over the engine's bus, for a block whose output the plugin
/// did not produce.
fn silence_outputs(outputs: &mut [&mut [f32]], num_samples: usize) {
    for out in outputs.iter_mut() {
        let len = num_samples.min(out.len());
        out[..len].fill(0.0);
    }
}

/// Copy the engine's stereo channels into the declared input scratch.
///
/// Only the first declared port is connected to the engine's bus — the DAW
/// convention for sidechain and auxiliary input ports is that an unconnected
/// port gets silence, and this host has nothing to feed one with. Engine
/// channel *i* therefore lands in the first port's channel *i*; every channel
/// past the first port's count belongs to a later port and keeps its load-time
/// zeros, which is sound because the plugin may not write input buffers. A
/// former bug wired the engine's right channel into a `[1, 1]` bundle's second
/// port — the sidechain detector of a compressor tracking the very signal it
/// was meant to duck against.
fn fill_input_scratch(audio: &mut AudioBusLayout, inputs: &[&[f32]], n_samp: usize) {
    let connected_channels = audio
        .input_buffers
        .first()
        .map_or(0, |main_port| main_port.channel_count as usize);
    let channels = (inputs.len().min(2)).min(connected_channels);
    for channel in 0..channels {
        let destination = &mut audio.input_scratch[channel * MAX_BUFFER..][..n_samp];
        let source = &inputs[channel];
        let len = source.len().min(n_samp);
        destination[..len].copy_from_slice(&source[..len]);
        destination[len..].fill(0.0);
    }
}

/// Copy the declared output scratch back onto the engine's stereo bus.
///
/// Declared channel 0 is the engine's left and channel 1 its right. A plugin
/// declaring a single output channel is mono, and a mono plugin on a stereo bus
/// sounds from the middle — every DAW duplicates it to both channels, where a
/// literal copy would leave the right channel silent. Channels past the second
/// are the plugin's to compute and the stereo bus's to drop.
fn read_output_scratch(audio: &AudioBusLayout, outputs: &mut [&mut [f32]], n_samp: usize) {
    let declared = audio.output_channel_ptrs.len();
    let copy_channel = |channel: usize, out: &mut [f32]| {
        let len = n_samp.min(out.len());
        out[..len].copy_from_slice(&audio.output_scratch[channel * MAX_BUFFER..][..len]);
    };
    match (declared, outputs.len()) {
        (0, _) => {}
        (1, _) => {
            if let Some(left) = outputs.first_mut() {
                copy_channel(0, left);
            }
            if let Some(right) = outputs.get_mut(1) {
                copy_channel(0, right);
            }
        }
        (_, 0) => {}
        _ => {
            for (channel, out) in outputs.iter_mut().enumerate() {
                if channel >= declared {
                    break;
                }
                copy_channel(channel, out);
            }
        }
    }
}

/// Pass the block through unchanged, for every case where the plugin must not
/// be handed it: not activated, or not in the CLAP processing state, or without
/// declared audio ports.
fn copy_inputs_to_outputs(inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
    for (ch, out) in outputs.iter_mut().enumerate() {
        if ch < inputs.len() {
            let len = num_samples.min(inputs[ch].len()).min(out.len());
            out[..len].copy_from_slice(&inputs[ch][..len]);
        }
    }
}

/// Run the entry's `deinit` — the half of the CLAP init/deinit pairing that
/// releases whatever the bundle registered globally during `init`.
///
/// # Safety
/// `entry_ptr` must point to a live, initialised `clap_plugin_entry` whose
/// library is still loaded; after every plugin instance created through it has
/// been destroyed, as the spec requires.
unsafe fn deinit_entry(entry_ptr: *const clap_plugin_entry) {
    if let Some(deinit) = (*entry_ptr).deinit {
        deinit();
    }
}

/// Activate a plugin at the given sample rate, and do nothing else.
///
/// Kept separate from entering the processing state on purpose: CLAP marks
/// `activate` `[main-thread]` and `start_processing` `[audio-thread]`, so a
/// loader that does both has already violated the thread model by the time the
/// plugin sees its first block. Free function so a test can prove the loader
/// path leaves `start_processing` alone.
///
/// # Safety
/// `plugin` must be a live `clap_plugin` that has not been activated.
unsafe fn activate_plugin(plugin: *const clap_plugin, sample_rate: f64) -> bool {
    if plugin.is_null() {
        return false;
    }
    match (*plugin).activate {
        Some(activate) => activate(plugin, sample_rate, 32, 4096),
        None => false,
    }
}

/// A zeroed transport event with only its header filled, used as the
/// preallocated slot the audio thread refills in place.
fn empty_transport_event() -> clap_event_transport {
    let mut transport: clap_event_transport = unsafe { mem::zeroed() };
    transport.header = clap_event_header {
        size: mem::size_of::<clap_event_transport>() as u32,
        time: 0,
        space_id: CLAP_CORE_EVENT_SPACE_ID,
        type_: CLAP_EVENT_TRANSPORT,
        flags: 0,
    };
    transport
}

/// Refill a preallocated transport event from the host timeline.
///
/// Writes every field in place — no allocation, safe to call from the audio
/// thread. Beat and second positions are CLAP fixed point, and the flags say
/// which fields carry meaning so a plugin does not read a zero as a real value.
/// Refill the block's note scratch from the host's events.
///
/// Each event's `frame_offset` becomes the CLAP header's `time`, which is what
/// makes an instrument sound a note on the sample it was written on rather than
/// at the head of whichever block carried it. Events past [`MAX_MIDI`] are
/// dropped: the scratch was reserved once and growing it here would allocate on
/// the audio thread.
fn fill_note_scratch(scratch: &mut Vec<clap_event_note>, midi_events: &[HostMidiEvent]) {
    scratch.clear();
    for event in midi_events.iter().take(MAX_MIDI) {
        scratch.push(clap_event_note {
            header: clap_event_header {
                size: mem::size_of::<clap_event_note>() as u32,
                time: event.frame_offset,
                space_id: CLAP_CORE_EVENT_SPACE_ID,
                type_: if event.is_note_on {
                    CLAP_EVENT_NOTE_ON
                } else {
                    CLAP_EVENT_NOTE_OFF
                },
                flags: 0,
            },
            note_id: -1,
            port_index: 0,
            channel: event.channel,
            key: i16::from(event.note),
            velocity: f64::from(event.velocity) / 127.0,
        });
    }
}

fn fill_transport_event(target: &mut clap_event_transport, source: HostTransport) {
    let mut flags = CLAP_TRANSPORT_HAS_TEMPO
        | CLAP_TRANSPORT_HAS_TIME_SIGNATURE
        | CLAP_TRANSPORT_HAS_BEATS_TIMELINE
        | CLAP_TRANSPORT_HAS_SECONDS_TIMELINE;
    if source.is_playing {
        flags |= CLAP_TRANSPORT_IS_PLAYING;
    }

    target.flags = flags;
    target.tempo = source.tempo;
    target.tempo_inc = 0.0;
    target.tsig_num = source.time_sig_num;
    target.tsig_denom = source.time_sig_denom;
    target.song_pos_beats = (source.song_pos_beats * CLAP_BEATTIME_FACTOR as f64) as i64;
    target.song_pos_seconds = (source.song_pos_seconds * CLAP_SECTIME_FACTOR as f64) as i64;
    // Loop and bar reporting are not modelled by the host yet; the flags above
    // deliberately omit CLAP_TRANSPORT_IS_LOOP_ACTIVE so these read as absent
    // rather than as a loop from bar zero to bar zero.
    target.loop_start_beats = 0;
    target.loop_end_beats = 0;
    target.loop_start_seconds = 0;
    target.loop_end_seconds = 0;
    target.bar_start = 0;
    target.bar_number = 0;
}

/// Read a CLAP plugin's reported latency through its latency extension.
/// Returns 0 when the extension pointer, its `get` callback, or the plugin
/// pointer is null. Free function so it can be unit-tested against a stub
/// `clap_plugin_latency` without a live plugin.
unsafe fn read_latency_ext(
    latency_ext: *const clap_plugin_latency,
    plugin: *const clap_plugin,
) -> u32 {
    if latency_ext.is_null() || plugin.is_null() {
        return 0;
    }
    match (*latency_ext).get {
        Some(get) => get(plugin),
        None => 0,
    }
}

/// Read a CLAP plugin's reported processing tail through its tail extension.
///
/// Zero when the extension pointer, its `get` callback, or the plugin pointer is
/// null — CLAP's own default for a plugin that does not implement `clap.tail`,
/// which is "no tail". Free function so it can be unit-tested against a stub
/// `clap_plugin_tail` without a live plugin.
unsafe fn read_tail_ext(tail_ext: *const clap_plugin_tail, plugin: *const clap_plugin) -> u32 {
    if tail_ext.is_null() || plugin.is_null() {
        return 0;
    }
    match (*tail_ext).get {
        Some(get) => get(plugin),
        None => 0,
    }
}

impl ClapWrapper {
    /// The plugin's current reported latency in samples. `0` when the plugin has
    /// no latency extension or is not active — CLAP defines `clap_plugin_latency.get`
    /// as `[main-thread & (being-activated | active)]`, so it is only meaningful
    /// while active. Call from the main/control thread only.
    pub fn latency_samples(&self) -> u32 {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            return fixture.latency_samples;
        }

        if !self.activated {
            return 0;
        }
        unsafe { read_latency_ext(self.latency_ext, self.plugin) }
    }

    /// The plugin's current reported latency in **milliseconds**.
    ///
    /// CLAP reports latency as a frame count in the clock the plugin was
    /// ACTIVATED with (`self.sample_rate`, the engine rate the caller supplied).
    /// Converting here keeps the frame count and the milliseconds derived from
    /// one rate: a consumer that re-derived it against a rate of its own — a
    /// device default, a hardcoded 48 kHz — would silently mis-scale it.
    pub fn latency_ms(&self) -> f64 {
        if !self.sample_rate.is_finite() || self.sample_rate <= 0.0 {
            return 0.0;
        }
        f64::from(self.latency_samples()) / self.sample_rate * 1000.0
    }

    /// The plugin's current reported processing tail in frames of the rate it
    /// was activated with. `0` when it declares no `clap.tail`, which is the
    /// spec's own answer for a plugin without the extension.
    ///
    /// Not gated on activation: CLAP annotates `clap_plugin_tail.get`
    /// `[main-thread & audio-thread]` and states no activation precondition,
    /// unlike latency, which is only defined while active.
    pub fn tail_samples(&self) -> u32 {
        unsafe { read_tail_ext(self.tail_ext, self.plugin) }
    }

    /// Take a tail change the plugin flagged through `clap_host_tail.changed`,
    /// answering the tail it reports now. `None` when nothing was flagged.
    ///
    /// The flag is consumed whether or not the value moved, because the flag
    /// records that the plugin spoke, not that the answer differs.
    /// Main/control-thread only.
    pub fn take_tail_change(&mut self) -> Option<u32> {
        if !self.host_state.take_tail_dirty() {
            return None;
        }
        Some(self.tail_samples())
    }

    /// Install the wake fired when this plugin flags a runtime latency change.
    /// Call before the wrapper reaches the audio thread. First install wins; a
    /// second call changes nothing and reports `false`.
    pub fn set_latency_change_notifier(&self, notifier: LatencyChangeNotifier) -> bool {
        self.host_state.set_latency_notifier(notifier)
    }

    /// Deactivate then reactivate the plugin so a runtime latency change can be
    /// re-read, and return the freshly queried latency. CLAP forbids latency
    /// changes while active, so latency is only re-queried after this cycle.
    ///
    /// Main/control-thread only: the caller (the `SharedHostedPlugin` control seam)
    /// holds the exclusive control lock, so the RT `process` path cannot run
    /// concurrently — which is also why the audio thread cannot perform the stop
    /// this cycle needs, and why the off-audio-thread fallback is used and
    /// counted here. Restarting is left to the first block after the cycle.
    pub fn reactivate_for_latency(&mut self) -> Result<u32, String> {
        if self.plugin.is_null() {
            return Ok(self.latency_samples());
        }

        if self.activated {
            self.force_stop_processing_off_audio_thread();
        }

        unsafe {
            let plugin_ref = &*self.plugin;

            if self.activated {
                if let Some(deactivate) = plugin_ref.deactivate {
                    deactivate(self.plugin);
                }
                self.activated = false;
            }

            if let Some(activate_fn) = plugin_ref.activate {
                if !activate_fn(self.plugin, self.sample_rate, 32, 4096) {
                    return Err(format!(
                        "[CLAP] reactivation for latency change failed for {}",
                        self.name
                    ));
                }
                self.activated = true;
                // A new activation is a new steady clock: the counter describes
                // one activation, and carrying the old one across would hand the
                // plugin frames it was never given.
                self.steady_time = 0;
                // The next audio block re-enters the processing state, on the
                // thread CLAP requires for it.
                self.processing.request_start();
            }
        }

        Ok(self.latency_samples())
    }

    /// If the plugin flagged a latency change (via `clap_host_latency.changed()`
    /// or `request_restart()`), reactivate and re-read latency, returning
    /// `Some(new_samples)`. Returns `Ok(None)` when nothing changed. The flag is
    /// consumed (read-and-cleared) whether or not a reactivation follows.
    /// Main/control-thread only.
    pub fn poll_latency_change(&mut self) -> Result<Option<u32>, String> {
        self.report_plugin_observations();

        if !self.host_state.take_latency_dirty() {
            return Ok(None);
        }

        let mut latency = self.reactivate_for_latency()?;

        // A flag raised WHILE that cycle ran is ambiguous, and the two cases are
        // indistinguishable from here:
        //
        //   a) the plugin re-flagged from inside its own activate() — the value
        //      just read already covers it, another pass is wasted work;
        //   b) an independent `request_restart()` landed from another thread
        //      (CLAP allows it from any thread, unlike `changed()`) — CLAP cannot
        //      report that latency until a FURTHER cycle completes.
        //
        // So re-query instead of clearing. Clearing blindly would resolve (b) as
        // a lost update: the queued wake reads a false flag, no event fires, and
        // compensation stays stale until some unrelated later change happens by.
        // A wasted cycle is cheap; a dropped change is silent and long-lived.
        for _ in 1..MAX_LATENCY_REQUERY_PASSES {
            if !self.host_state.take_latency_dirty() {
                return Ok(Some(latency));
            }
            latency = self.reactivate_for_latency()?;
        }

        // Bounded so case (a) cannot spin forever: a plugin that re-flags on every
        // activate never lets the loop settle. Drop the flag and report the last
        // value read — the alternative is an unbounded reactivation loop.
        if self.host_state.take_latency_dirty() {
            eprintln!(
                "[CLAP] '{}' re-flagged a latency change on all {} re-query passes; \
                 reporting the last value read and dropping the flag",
                self.name, MAX_LATENCY_REQUERY_PASSES
            );
        }
        Ok(Some(latency))
    }

    /// Expose the per-instance host callback state for tests and control-path
    /// callers that need to arm the latency-dirty flag directly.
    #[cfg(test)]
    fn host_callback_state(&self) -> &HostCallbackState {
        &self.host_state
    }
}

impl AudioPlugin for ClapWrapper {
    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
        self.process_audio_internal(inputs, outputs, num_samples, &EMPTY_INPUT_EVENTS);
    }

    fn set_parameter(&mut self, param_id: u32, value: f64) {
        if self.params_ext.is_null() || self.plugin.is_null() {
            return;
        }

        unsafe {
            let params = &*self.params_ext;

            // Build a single param-value event
            let mut ctx = SingleEventCtx {
                event: clap_event_param_value {
                    header: clap_event_header {
                        size: mem::size_of::<clap_event_param_value>() as u32,
                        time: 0,
                        space_id: CLAP_CORE_EVENT_SPACE_ID,
                        type_: CLAP_EVENT_PARAM_VALUE,
                        flags: 0,
                    },
                    param_id,
                    cookie: ptr::null_mut(),
                    note_id: -1,
                    port_index: -1,
                    channel: -1,
                    key: -1,
                    value,
                },
            };

            let input_events = clap_input_events {
                ctx: &mut ctx as *mut SingleEventCtx as *mut c_void,
                size: Some(single_event_size),
                get: Some(single_event_get),
            };

            if let Some(flush) = params.flush {
                // A parameter whose value depends on the one just written comes
                // back here and is a real change worth capturing. The written
                // parameter's own value is not — see `capture_host_write_events`.
                let mut capture = HostWriteCapture {
                    queue: &self.parameter_events,
                    written_param_id: param_id,
                };
                let out_events = capture_host_write_events(&mut capture);
                flush(self.plugin, &input_events, &out_events);
            }
        }
    }

    fn get_parameters(&self) -> Vec<PluginParameter> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            return fixture.parameters.clone();
        }

        if self.params_ext.is_null() || self.plugin.is_null() {
            return vec![];
        }

        unsafe {
            let params = &*self.params_ext;
            let count_fn = match params.count {
                Some(f) => f,
                None => return vec![],
            };
            let get_info_fn = match params.get_info {
                Some(f) => f,
                None => return vec![],
            };

            let count = count_fn(self.plugin);
            let mut result = Vec::with_capacity(count as usize);

            for i in 0..count {
                let mut info: clap_param_info = mem::zeroed();
                if !get_info_fn(self.plugin, i, &mut info) {
                    continue;
                }

                // Skip hidden or read-only params
                if info.flags & CLAP_PARAM_IS_HIDDEN != 0 {
                    continue;
                }

                // Read the current value
                let mut current_value = info.default_value;
                if let Some(get_value) = params.get_value {
                    get_value(self.plugin, info.id, &mut current_value);
                }

                // The name lives in a fixed-size array the plugin owns; a name
                // that fills every byte without terminating reads past the
                // array the moment it is treated as a C string. A parameter
                // whose name cannot be read within its own bounds is skipped,
                // exactly as one whose `get_info` refused to answer.
                let Some(name) = bounded_parameter_name(&info.name) else {
                    continue;
                };

                let is_automatable = info.flags & CLAP_PARAM_IS_AUTOMATABLE != 0;
                let is_readonly = info.flags & CLAP_PARAM_IS_READONLY != 0;

                result.push(PluginParameter {
                    id: info.id,
                    name,
                    value: current_value,
                    default_value: info.default_value,
                    min_value: info.min_value,
                    max_value: info.max_value,
                    unit: None, // CLAP does not expose units in clap_param_info
                    is_automatable: is_automatable && !is_readonly,
                });
            }

            result
        }
    }

    /// The plugin's saved state, or its refusal to produce one.
    ///
    /// A plugin that implements no state extension has no state, and empty is
    /// the true answer for it. A plugin whose `save` fails has state it would not
    /// give, and answering empty there tells the project it saved when it did
    /// not.
    fn get_state(&self) -> Result<Vec<u8>, String> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            return Ok(fixture.state.clone());
        }

        if self.state_ext.is_null() || self.plugin.is_null() {
            return Ok(vec![]);
        }

        unsafe {
            let state = &*self.state_ext;
            let Some(save_fn) = state.save else {
                return Ok(vec![]);
            };

            let mut buffer: Vec<u8> = Vec::new();
            let ostream = clap_ostream {
                ctx: &mut buffer as *mut Vec<u8> as *mut c_void,
                write: Some(ostream_write),
            };

            if !save_fn(self.plugin, &ostream) {
                return Err(format!("[CLAP] '{}' refused to save its state", self.name));
            }
            Ok(buffer)
        }
    }

    fn set_state(&mut self, state_data: &[u8]) -> Result<(), String> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_mut() {
            fixture.state = state_data.to_vec();
            return Ok(());
        }

        if self.state_ext.is_null() || self.plugin.is_null() {
            return Ok(());
        }

        unsafe {
            let state = &*self.state_ext;
            let load_fn = match state.load {
                Some(f) => f,
                None => return Ok(()),
            };

            let mut cursor = StreamCursor {
                data: state_data.to_vec(),
                pos: 0,
            };

            let istream = clap_istream {
                ctx: &mut cursor as *mut StreamCursor as *mut c_void,
                read: Some(istream_read),
            };

            state_load_result(&self.name, load_fn(self.plugin, &istream))?;
        }

        Ok(())
    }

    // The seam's GUI four. Every body below is the inherent method of the same
    // name, reached through an explicit `ClapWrapper::` path: an inherent
    // associated item shadows a trait one, so these forward rather than recurse.
    // Forwarding rather than relocating keeps each unsafe CLAP body byte-for-byte
    // what it was before this trait existed.
    fn get_name(&self) -> &str {
        ClapWrapper::get_name(self)
    }

    fn has_gui(&self) -> bool {
        ClapWrapper::has_gui(self)
    }

    fn open_gui(&mut self, handle_ptr: *mut c_void) -> Result<(u32, u32), String> {
        ClapWrapper::open_gui(self, handle_ptr)
    }

    fn close_gui(&mut self) {
        ClapWrapper::close_gui(self)
    }

    fn set_editor_window_resizer(&mut self, resize: EditorWindowResizer) {
        ClapWrapper::set_editor_window_resizer(self, resize)
    }

    fn apply_pending_editor_resize(&mut self) -> Option<(u32, u32)> {
        ClapWrapper::apply_pending_editor_resize(self)
    }

    fn take_state_dirty(&mut self) -> bool {
        self.host_state.take_state_dirty()
    }

    fn take_parameters_rescan(&mut self) -> bool {
        self.host_state.take_parameters_rescan()
    }

    fn flush_parameters_off_audio_thread(&mut self) -> bool {
        ClapWrapper::flush_parameters_off_audio_thread(self)
    }

    fn parameter_event_queue(&self) -> Option<Arc<PluginParameterEventQueue>> {
        Some(ClapWrapper::parameter_event_queue(self))
    }

    /// The plugin's own answer, from `clap.note-ports`, not the seam's default.
    ///
    /// A plugin that declares no note input — an EQ, an analyzer — has no
    /// business being routed events, and the engine's slot decides routing by
    /// exactly this answer. Read once at load; the note port list may only
    /// change while the plugin is deactivated, and an instance never goes back
    /// to deactivated once loaded.
    fn accepts_midi(&self) -> bool {
        self.accepts_note_events
    }

    /// The display scale the host's editor window runs at, for the next
    /// `open_gui` to hand the plugin via `clap_plugin_gui.set_scale`.
    ///
    /// CLAP's GUI sequence places `set_scale` between `create` and `get_size`,
    /// and the value is the host's to state: a plugin told 1.0 on a 2.0 screen
    /// lays its editor out at half size.
    fn set_editor_content_scale(&mut self, scale: f64) {
        if scale.is_finite() && scale > 0.0 {
            self.editor_content_scale = scale;
        }
    }

    fn editor_can_resize(&self) -> bool {
        ClapWrapper::editor_can_resize(self)
    }

    fn request_editor_size(&mut self, width: u32, height: u32) -> Result<(u32, u32), String> {
        ClapWrapper::request_editor_size(self, width, height)
    }

    fn apply_editor_content_scale(&mut self, scale: f64) -> Result<(u32, u32), String> {
        ClapWrapper::apply_editor_content_scale(self, scale)
    }
}

/// CLAP's implementation of the runtime seam. Same forwarding rule as the
/// `AudioPlugin` impl above: the bodies stay in the inherent `impl ClapWrapper`
/// blocks, which is what keeps the RT and control paths textually unchanged.
impl HostedPluginRuntime for ClapWrapper {
    fn is_activated(&self) -> bool {
        ClapWrapper::is_activated(self)
    }

    fn processing_gate(&self) -> Arc<ProcessingGate> {
        ClapWrapper::processing_gate(self)
    }

    fn sync_processing_state(&mut self) {
        ClapWrapper::sync_processing_state(self)
    }

    fn set_transport(&mut self, transport: HostTransport) {
        ClapWrapper::set_transport(self, transport)
    }

    fn process_with_parameter_updates(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        parameter_updates: &[HostParameterUpdate],
    ) {
        ClapWrapper::process_with_parameter_updates(
            self,
            inputs,
            outputs,
            num_samples,
            parameter_updates,
        )
    }

    fn process_with_midi_and_parameters(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        midi_events: &[HostMidiEvent],
        parameter_updates: &[HostParameterUpdate],
    ) {
        ClapWrapper::process_with_midi_and_parameters(
            self,
            inputs,
            outputs,
            num_samples,
            midi_events,
            parameter_updates,
        )
    }

    fn poll_latency_change(&mut self) -> Result<Option<u32>, String> {
        ClapWrapper::poll_latency_change(self)
    }

    fn latency_ms(&self) -> f64 {
        ClapWrapper::latency_ms(self)
    }

    fn latency_samples(&self) -> u32 {
        ClapWrapper::latency_samples(self)
    }

    fn tail_samples(&self) -> u32 {
        ClapWrapper::tail_samples(self)
    }

    fn take_tail_change(&mut self) -> Option<u32> {
        ClapWrapper::take_tail_change(self)
    }

    fn report_plugin_observations(&mut self) {
        ClapWrapper::report_plugin_observations(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clap_host::RESIZE_SIGNAL_TEST_LOCK;

    // ── Note events ─────────────────────────────────────────────────────

    fn host_note(
        note: u8,
        velocity: u8,
        channel: i16,
        is_note_on: bool,
        frame_offset: u32,
    ) -> HostMidiEvent {
        HostMidiEvent {
            note,
            velocity,
            channel,
            is_note_on,
            frame_offset,
        }
    }

    /// CLAP addresses an event by the sample it lands on, in the event header's
    /// `time`. Stamping every note at zero would collapse a block's worth of
    /// timing onto its first frame, so a phrase written across a block would
    /// sound as a chord at its head.
    #[test]
    fn a_notes_frame_offset_becomes_the_event_headers_time() {
        let mut scratch = Vec::with_capacity(MAX_MIDI);

        fill_note_scratch(
            &mut scratch,
            &[
                host_note(60, 100, 1, true, 0),
                host_note(64, 100, 1, true, 37),
                host_note(64, 0, 1, false, 511),
            ],
        );

        let stamps: Vec<(u32, u16, i16)> = scratch
            .iter()
            .map(|event| (event.header.time, event.header.type_, event.key))
            .collect();
        assert_eq!(
            stamps,
            vec![
                (0, CLAP_EVENT_NOTE_ON, 60),
                (37, CLAP_EVENT_NOTE_ON, 64),
                (511, CLAP_EVENT_NOTE_OFF, 64),
            ]
        );
    }

    /// The scratch is reserved once and refilled in place, so a block carrying
    /// more notes than it holds drops the tail rather than growing on the audio
    /// thread.
    #[test]
    fn a_block_past_the_scratch_capacity_keeps_the_prefix_that_fits() {
        let mut scratch = Vec::with_capacity(MAX_MIDI);
        let notes: Vec<HostMidiEvent> = (0..MAX_MIDI + 4)
            .map(|index| host_note(60, 100, 0, true, index as u32))
            .collect();

        fill_note_scratch(&mut scratch, &notes);

        assert_eq!(scratch.len(), MAX_MIDI);
        assert_eq!(scratch[MAX_MIDI - 1].header.time, MAX_MIDI as u32 - 1);
        assert_eq!(scratch.capacity(), MAX_MIDI);
    }

    // ── Latency query + change notification (PH-4) ──────────────────────

    use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

    // Latency the stub plugin reports on its next `get`. Serialised by the lock
    // below because Rust runs tests in parallel and this static is shared.
    static STUB_LATENCY: AtomicU32 = AtomicU32::new(0);
    static LATENCY_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    unsafe extern "C" fn stub_latency_get(_plugin: *const clap_plugin) -> u32 {
        STUB_LATENCY.load(Ordering::Relaxed)
    }

    static STUB_LATENCY_EXT: clap_plugin_latency = clap_plugin_latency {
        get: Some(stub_latency_get),
    };

    unsafe extern "C" fn stub_get_extension(
        _plugin: *const clap_plugin,
        id: *const i8,
    ) -> *const c_void {
        let id = CStr::from_ptr(id);
        if id == CLAP_EXT_LATENCY {
            return &STUB_LATENCY_EXT as *const clap_plugin_latency as *const c_void;
        }
        ptr::null()
    }

    unsafe extern "C" fn stub_activate(
        _plugin: *const clap_plugin,
        _sample_rate: f64,
        _min_frames: u32,
        _max_frames: u32,
    ) -> bool {
        true
    }
    /// Address of the `HostCallbackState` that `stub_activate_reflagging` should
    /// re-flag, mimicking a plugin that calls `clap_host_latency.changed()` from
    /// inside `activate()`. `0` disables the behaviour.
    static REFLAG_TARGET: AtomicUsize = AtomicUsize::new(0);

    unsafe extern "C" fn stub_activate_reflagging(
        _plugin: *const clap_plugin,
        _sample_rate: f64,
        _min_frames: u32,
        _max_frames: u32,
    ) -> bool {
        let target = REFLAG_TARGET.load(Ordering::Relaxed);
        if target != 0 {
            (*(target as *const HostCallbackState)).mark_latency_dirty();
        }
        true
    }

    /// Models an INDEPENDENT `request_restart()` landing from another thread while
    /// a re-query is already in flight. On the first activation it raises the flag
    /// but leaves the reported latency alone — CLAP cannot surface the new value
    /// until a further cycle completes — and only the second activation applies
    /// it. A host that clears the flag after one pass loses this change entirely.
    static RACE_TARGET: AtomicUsize = AtomicUsize::new(0);
    static RACE_ACTIVATIONS: AtomicU32 = AtomicU32::new(0);
    static RACE_PENDING_LATENCY: AtomicU32 = AtomicU32::new(0);

    unsafe extern "C" fn stub_activate_racing(
        _plugin: *const clap_plugin,
        _sample_rate: f64,
        _min_frames: u32,
        _max_frames: u32,
    ) -> bool {
        let pass = RACE_ACTIVATIONS.fetch_add(1, Ordering::Relaxed);
        if pass == 0 {
            let target = RACE_TARGET.load(Ordering::Relaxed);
            if target != 0 {
                (*(target as *const HostCallbackState)).mark_latency_dirty();
            }
        } else if pass == 1 {
            STUB_LATENCY.store(
                RACE_PENDING_LATENCY.load(Ordering::Relaxed),
                Ordering::Relaxed,
            );
        }
        true
    }

    unsafe extern "C" fn stub_deactivate(_plugin: *const clap_plugin) {}
    unsafe extern "C" fn stub_start_processing(_plugin: *const clap_plugin) -> bool {
        true
    }
    unsafe extern "C" fn stub_stop_processing(_plugin: *const clap_plugin) {}

    /// A leaked stub `clap_plugin` that advertises CLAP_EXT_LATENCY and supports
    /// the activate/deactivate lifecycle. Leaked so the pointer outlives the test.
    fn stub_plugin_ptr() -> *const clap_plugin {
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    fn stub_wrapper(plugin: *const clap_plugin) -> ClapWrapper {
        stub_wrapper_over(stub_audio_layout(), plugin)
    }

    /// The layout a stub wrapper processes with, overridable per test.
    fn stub_wrapper_over(audio: AudioBusLayout, plugin: *const clap_plugin) -> ClapWrapper {
        let latency_ext = unsafe {
            ClapWrapper::query_extension::<clap_plugin_latency>(&*plugin, CLAP_EXT_LATENCY)
        };
        // Queried the same way the loader does, so a stub that declares
        // `clap.tail` is hosted exactly as a real plugin declaring it would be.
        let tail_ext =
            unsafe { ClapWrapper::query_extension::<clap_plugin_tail>(&*plugin, CLAP_EXT_TAIL) };
        // Mirrors what a successful load leaves behind: activated, and asking to
        // process as soon as the audio thread next runs the plugin.
        let processing = Arc::new(ProcessingGate::default());
        processing.request_start();
        ClapWrapper {
            _library: None,
            entry: ptr::null(),
            plugin,
            host: Box::new(create_host_descriptor()),
            activated: true,
            name: "stub".to_string(),
            sample_rate: 48_000.0,
            params_ext: ptr::null(),
            state_ext: ptr::null(),
            gui_ext: ptr::null(),
            latency_ext,
            tail_ext,
            host_state: Box::new(HostCallbackState::default()),
            gui_open: false,
            editor_resizer: None,
            processing,
            transport_scratch: Box::new(empty_transport_event()),
            has_transport: false,
            steady_time: 0,
            process_refused: false,
            process_refusal_reported: false,
            audio,
            // Derived from the stub's own descriptor, the way the loader
            // derives it, so a stub declaring `instrument` is hosted exactly as
            // a real plugin declaring it would be.
            is_instrument: unsafe { descriptor_declares_instrument(plugin) },
            accepts_note_events: true,
            editor_content_scale: crate::traits::DEFAULT_EDITOR_CONTENT_SCALE,
            midi_scratch: Vec::with_capacity(MAX_MIDI),
            parameter_scratch: Vec::with_capacity(MAX_PARAMETER_EVENTS),
            parameter_events: Arc::new(PluginParameterEventQueue::default()),
            #[cfg(feature = "engine-owned-command-fixture")]
            command_fixture: None,
        }
    }

    /// The stubs used by the transport and processing-state tests declare no
    /// audio-ports extension, which loads as portless.
    fn stub_audio_layout() -> AudioBusLayout {
        AudioBusLayout::portless()
    }

    #[test]
    fn read_latency_ext_is_zero_without_the_extension_and_the_reported_value_with_it() {
        let _guard = LATENCY_TEST_LOCK.lock().unwrap();
        let plugin = stub_plugin_ptr();

        // Before wiring: no latency extension queried -> host sees 0.
        assert_eq!(unsafe { read_latency_ext(ptr::null(), plugin) }, 0);

        // After wiring: query the extension the stub advertises, then read it.
        let ext = unsafe {
            ClapWrapper::query_extension::<clap_plugin_latency>(&*plugin, CLAP_EXT_LATENCY)
        };
        assert!(!ext.is_null(), "stub advertises CLAP_EXT_LATENCY");

        STUB_LATENCY.store(0, Ordering::Relaxed);
        assert_eq!(unsafe { read_latency_ext(ext, plugin) }, 0);
        STUB_LATENCY.store(512, Ordering::Relaxed);
        assert_eq!(unsafe { read_latency_ext(ext, plugin) }, 512);
    }

    #[test]
    fn latency_samples_reflects_the_active_plugin_and_zero_when_inactive() {
        let _guard = LATENCY_TEST_LOCK.lock().unwrap();
        STUB_LATENCY.store(128, Ordering::Relaxed);
        let mut wrapper = stub_wrapper(stub_plugin_ptr());

        assert_eq!(wrapper.latency_samples(), 128);
        wrapper.activated = false;
        assert_eq!(
            wrapper.latency_samples(),
            0,
            "inactive plugin reports no latency"
        );
    }

    #[test]
    fn poll_latency_change_requeries_only_after_the_plugin_flags_a_change() {
        let _guard = LATENCY_TEST_LOCK.lock().unwrap();
        STUB_LATENCY.store(64, Ordering::Relaxed);
        let mut wrapper = stub_wrapper(stub_plugin_ptr());

        // No change flagged -> no re-query, no reactivation.
        assert_eq!(wrapper.poll_latency_change().unwrap(), None);
        assert_eq!(wrapper.latency_samples(), 64);

        // Plugin reports a latency change (as clap_host_latency.changed would),
        // then the reported latency moves.
        wrapper.host_callback_state().mark_latency_dirty();
        STUB_LATENCY.store(1024, Ordering::Relaxed);
        assert_eq!(
            wrapper.poll_latency_change().unwrap(),
            Some(1024),
            "a flagged change reactivates and re-reads the new latency"
        );

        // Flag consumed -> the next poll is a no-op.
        assert_eq!(wrapper.poll_latency_change().unwrap(), None);
    }

    #[test]
    fn poll_latency_change_swallows_a_flag_its_own_reactivation_provoked() {
        let _guard = LATENCY_TEST_LOCK.lock().unwrap();
        STUB_LATENCY.store(64, Ordering::Relaxed);

        // A plugin that re-flags from inside activate() — without the post-poll
        // clear this schedules an endless reactivate/re-query loop.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate_reflagging);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        let mut wrapper = stub_wrapper(Box::into_raw(Box::new(plugin)) as *const clap_plugin);

        REFLAG_TARGET.store(
            (&*wrapper.host_state as *const HostCallbackState) as usize,
            Ordering::Relaxed,
        );
        wrapper.host_callback_state().mark_latency_dirty();
        STUB_LATENCY.store(2048, Ordering::Relaxed);

        assert_eq!(wrapper.poll_latency_change().unwrap(), Some(2048));
        assert_eq!(
            wrapper.poll_latency_change().unwrap(),
            None,
            "the flag activate() re-raised is consumed, not carried into another cycle"
        );

        REFLAG_TARGET.store(0, Ordering::Relaxed);
    }

    #[test]
    fn poll_latency_change_keeps_a_restart_that_landed_during_the_reactivation() {
        let _guard = LATENCY_TEST_LOCK.lock().unwrap();
        STUB_LATENCY.store(64, Ordering::Relaxed);
        RACE_ACTIVATIONS.store(0, Ordering::Relaxed);
        RACE_PENDING_LATENCY.store(900, Ordering::Relaxed);

        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate_racing);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        let mut wrapper = stub_wrapper(Box::into_raw(Box::new(plugin)) as *const clap_plugin);

        RACE_TARGET.store(
            (&*wrapper.host_state as *const HostCallbackState) as usize,
            Ordering::Relaxed,
        );
        wrapper.host_callback_state().mark_latency_dirty();

        // `request_restart()` is callable from ANY thread, so a second one can
        // land mid-cycle. Clearing the flag after a single pass would report the
        // stale 64 and drop the concurrent change on the floor: the queued wake
        // would read a false flag and never emit.
        assert_eq!(
            wrapper.poll_latency_change().unwrap(),
            Some(900),
            "a restart raised during the reactivation window must still be re-queried"
        );
        assert_eq!(
            wrapper.poll_latency_change().unwrap(),
            None,
            "once settled, the flag is consumed and the next poll is a no-op"
        );

        RACE_TARGET.store(0, Ordering::Relaxed);
    }

    #[test]
    fn latency_ms_converts_at_the_rate_the_plugin_activated_with() {
        let _guard = LATENCY_TEST_LOCK.lock().unwrap();
        STUB_LATENCY.store(2205, Ordering::Relaxed);
        let mut wrapper = stub_wrapper(stub_plugin_ptr());

        // 2205 frames at the 44.1 kHz activation rate is 50 ms — NOT the 45.9375 ms
        // a 48 kHz consumer would compute from the same sample count.
        wrapper.sample_rate = 44_100.0;
        assert_eq!(wrapper.latency_ms(), 50.0);

        // Same plugin, different activation rate -> different milliseconds.
        wrapper.sample_rate = 96_000.0;
        assert_eq!(wrapper.latency_ms(), 2205.0 / 96_000.0 * 1000.0);

        // A nonsense rate cannot produce an infinite compensation value.
        wrapper.sample_rate = 0.0;
        assert_eq!(wrapper.latency_ms(), 0.0);

        // An inactive plugin reports no latency, so no milliseconds either.
        wrapper.sample_rate = 48_000.0;
        wrapper.activated = false;
        assert_eq!(wrapper.latency_ms(), 0.0);
    }

    #[test]
    fn state_load_result_returns_ok_when_clap_load_succeeds() {
        assert_eq!(state_load_result("fixture", true), Ok(()));
    }

    #[test]
    fn state_load_result_returns_error_when_clap_load_fails() {
        assert_eq!(
            state_load_result("fixture", false),
            Err("[CLAP] state.load() failed for fixture".to_string())
        );
    }

    // ── Entry init/deinit pairing on unload ─────────────────────────────
    //
    // CLAP pairs `clap_entry.init`/`deinit` per entry: a bundle may register
    // global resources in init and release them only in deinit. The wrapper
    // loads one library per instance, so each instance's init owes exactly one
    // deinit — from its own Drop, after its plugin is destroyed.

    use clap_sys::version::CLAP_VERSION;

    static ENTRY_LIFECYCLE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    /// Every entry- and plugin-level lifecycle call the fakes below record, in
    /// order. A Mutex<Vec<_>> rather than counters because the claim under
    /// test is ordering, not just occurrence.
    static ENTRY_LIFECYCLE_CALLS: std::sync::Mutex<Vec<&'static str>> =
        std::sync::Mutex::new(Vec::new());

    fn clear_entry_lifecycle() {
        ENTRY_LIFECYCLE_CALLS.lock().unwrap().clear();
    }

    fn entry_lifecycle() -> Vec<&'static str> {
        ENTRY_LIFECYCLE_CALLS.lock().unwrap().clone()
    }

    fn record_lifecycle_call(call: &'static str) {
        ENTRY_LIFECYCLE_CALLS.lock().unwrap().push(call);
    }

    unsafe extern "C" fn recording_entry_deinit() {
        record_lifecycle_call("entry_deinit");
    }

    unsafe extern "C" fn recording_get_factory(_factory_id: *const i8) -> *const c_void {
        &raw const RECORDING_FACTORY as *const c_void
    }

    unsafe extern "C" fn null_get_factory(_factory_id: *const i8) -> *const c_void {
        ptr::null()
    }

    unsafe extern "C" fn failing_get_factory(_factory_id: *const i8) -> *const c_void {
        &raw const FAILING_PLUGIN_FACTORY as *const c_void
    }

    unsafe extern "C" fn recording_plugin_init(_plugin: *const clap_plugin) -> bool {
        record_lifecycle_call("plugin_init");
        true
    }

    unsafe extern "C" fn failing_plugin_init(_plugin: *const clap_plugin) -> bool {
        false
    }

    unsafe extern "C" fn recording_plugin_activate(
        _plugin: *const clap_plugin,
        _sample_rate: f64,
        _min_frames: u32,
        _max_frames: u32,
    ) -> bool {
        record_lifecycle_call("plugin_activate");
        true
    }

    unsafe extern "C" fn recording_plugin_deactivate(_plugin: *const clap_plugin) {
        record_lifecycle_call("plugin_deactivate");
    }

    unsafe extern "C" fn recording_plugin_destroy(plugin: *const clap_plugin) {
        record_lifecycle_call("plugin_destroy");
        // Reclaim the instance memory create_plugin leaked, exactly as a real
        // plugin's destroy frees what create_plugin allocated.
        drop(Box::from_raw(plugin as *mut clap_plugin));
    }

    /// A fresh recording plugin per create call — two instances of one entry
    /// must never share one clap_plugin.
    unsafe extern "C" fn recording_create_plugin(
        _factory: *const clap_plugin_factory,
        _host: *const clap_host,
        _plugin_id: *const i8,
    ) -> *const clap_plugin {
        Box::into_raw(Box::new(clap_plugin {
            desc: ptr::null(),
            plugin_data: ptr::null_mut(),
            init: Some(recording_plugin_init),
            destroy: Some(recording_plugin_destroy),
            activate: Some(recording_plugin_activate),
            deactivate: Some(recording_plugin_deactivate),
            start_processing: None,
            stop_processing: None,
            reset: None,
            process: None,
            get_extension: None,
            on_main_thread: None,
        }))
    }

    unsafe extern "C" fn failing_create_plugin(
        _factory: *const clap_plugin_factory,
        _host: *const clap_host,
        _plugin_id: *const i8,
    ) -> *const clap_plugin {
        Box::into_raw(Box::new(clap_plugin {
            desc: ptr::null(),
            plugin_data: ptr::null_mut(),
            init: Some(failing_plugin_init),
            destroy: Some(recording_plugin_destroy),
            activate: Some(recording_plugin_activate),
            deactivate: Some(recording_plugin_deactivate),
            start_processing: None,
            stop_processing: None,
            reset: None,
            process: None,
            get_extension: None,
            on_main_thread: None,
        }))
    }

    static RECORDING_FACTORY: clap_plugin_factory = clap_plugin_factory {
        get_plugin_count: None,
        get_plugin_descriptor: None,
        create_plugin: Some(recording_create_plugin),
    };

    static FAILING_PLUGIN_FACTORY: clap_plugin_factory = clap_plugin_factory {
        get_plugin_count: None,
        get_plugin_descriptor: None,
        create_plugin: Some(failing_create_plugin),
    };

    static RECORDING_ENTRY: clap_plugin_entry = clap_plugin_entry {
        clap_version: CLAP_VERSION,
        init: None,
        deinit: Some(recording_entry_deinit),
        get_factory: Some(recording_get_factory),
    };

    static NULL_FACTORY_ENTRY: clap_plugin_entry = clap_plugin_entry {
        clap_version: CLAP_VERSION,
        init: None,
        deinit: Some(recording_entry_deinit),
        get_factory: Some(null_get_factory),
    };

    static FAILING_PLUGIN_ENTRY: clap_plugin_entry = clap_plugin_entry {
        clap_version: CLAP_VERSION,
        init: None,
        deinit: Some(recording_entry_deinit),
        get_factory: Some(failing_get_factory),
    };

    const LIFECYCLE_PLUGIN_ID: &str = "org.sourdaw.test.entry-lifecycle";

    #[test]
    fn a_dropped_wrapper_deinits_the_entry_after_destroying_the_plugin() {
        let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
        clear_entry_lifecycle();

        let wrapper = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const RECORDING_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
            )
        }
        .expect("the recording fake loads");

        drop(wrapper);

        assert_eq!(
            entry_lifecycle(),
            [
                "plugin_init",
                "plugin_activate",
                "plugin_deactivate",
                "plugin_destroy",
                "entry_deinit",
            ],
            "deinit must run exactly once, after the instance's deactivate/destroy — \
             the CLAP spec places it after every plugin instance is destroyed"
        );
    }

    #[test]
    fn a_load_that_fails_after_entry_init_still_deinits_the_entry() {
        let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
        clear_entry_lifecycle();

        let error = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const NULL_FACTORY_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
            )
        }
        .err()
        .expect("an entry whose factory query returns null must not load");

        assert_eq!(error, "Plugin factory is null");
        assert_eq!(
            entry_lifecycle(),
            ["entry_deinit"],
            "every early return after a successful init must release the entry it initialised"
        );
    }

    #[test]
    fn a_plugin_init_failure_destroys_the_instance_and_still_deinits_the_entry() {
        let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
        clear_entry_lifecycle();

        let error = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const FAILING_PLUGIN_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
            )
        }
        .err()
        .expect("a plugin whose init returns false must not load");

        assert_eq!(error, "plugin.init() returned false");
        assert_eq!(
            entry_lifecycle(),
            ["plugin_destroy", "entry_deinit"],
            "the deepest early return still destroys the half-built instance and deinits"
        );
    }

    #[test]
    fn each_instance_of_an_entry_deinits_once_from_its_own_drop() {
        let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
        clear_entry_lifecycle();

        let first = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const RECORDING_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
            )
        }
        .expect("the recording fake loads");
        let second = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const RECORDING_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
            )
        }
        .expect("the recording fake loads");

        drop(first);
        assert_eq!(
            entry_lifecycle(),
            [
                "plugin_init",
                "plugin_activate",
                "plugin_init",
                "plugin_activate",
                "plugin_deactivate",
                "plugin_destroy",
                "entry_deinit",
            ],
            "one instance down: one destroy/deinit pair, and only for the dropped one"
        );

        drop(second);
        assert_eq!(
            entry_lifecycle(),
            [
                "plugin_init",
                "plugin_activate",
                "plugin_init",
                "plugin_activate",
                "plugin_deactivate",
                "plugin_destroy",
                "entry_deinit",
                "plugin_deactivate",
                "plugin_destroy",
                "entry_deinit",
            ],
            "the sibling instance stays paired to its own init until its own drop — \
             the host loads one entry per instance, so no shared owner defers deinit"
        );
    }

    // ── Plugin-initiated host requests: editor resize + state dirty ─────

    /// The size a plugin asks for has to arrive at the host window intact.
    /// Asserting the dimensions rather than the call is the whole point: the
    /// old callback answered `true` and dropped them, which a "the resizer ran"
    /// assertion would have accepted.
    #[test]
    fn a_resize_request_reaches_the_host_window_carrying_its_dimensions() {
        // The accepted ask raises the process-wide resize hint, so this test
        // must serialise against every asserter of that hint, which all live
        // in the host module's tests.
        let _guard = RESIZE_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut wrapper = stub_wrapper(stub_plugin_ptr());
        let applied: Arc<std::sync::Mutex<Vec<(u32, u32)>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = Arc::clone(&applied);
        assert!(wrapper.set_plugin_host_request_notifier(Box::new(|_| {})));
        wrapper.set_editor_window_resizer(Arc::new(move |width, height| {
            sink.lock().expect("resize log").push((width, height));
        }));

        assert!(
            wrapper.host_state.request_editor_resize(1024, 768),
            "an open editor with a wake installed accepts the request"
        );
        assert_eq!(wrapper.apply_pending_editor_resize(), Some((1024, 768)));

        assert_eq!(
            applied.lock().expect("resize log").as_slice(),
            [(1024, 768)],
            "the window is resized to the size the plugin named"
        );
        assert_eq!(
            wrapper.apply_pending_editor_resize(),
            None,
            "one request resizes the window once, not on every later control-path visit"
        );
    }

    /// Closing the editor takes its window away, so a size accepted against it
    /// must stop being answerable — otherwise the next editor opens at the
    /// previous one's size.
    #[test]
    fn closing_the_editor_stops_the_backend_answering_resize_requests() {
        // The ask accepted before the close raises the process-wide resize
        // hint, so this test must serialise against every asserter of it.
        let _guard = RESIZE_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut wrapper = stub_wrapper(stub_plugin_ptr());
        assert!(wrapper.set_plugin_host_request_notifier(Box::new(|_| {})));
        wrapper.set_editor_window_resizer(Arc::new(|_, _| {}));
        assert!(wrapper.host_state.request_editor_resize(1024, 768));

        wrapper.close_gui();

        assert!(
            !wrapper.host_state.request_editor_resize(640, 480),
            "with no window to resize the request is refused rather than accepted and dropped"
        );
        assert_eq!(
            wrapper.apply_pending_editor_resize(),
            None,
            "the size accepted before the close is discarded with the window"
        );
    }

    /// An instance the host never installed a wake on — one the native engine
    /// did not take, whose asks nothing would ever carry to the control path —
    /// must refuse the resize rather than accept it and drop it. A refused
    /// plugin lays itself out at the size it has; an accepted one waits forever
    /// for a window that never changes.
    #[test]
    fn an_editor_resize_is_refused_while_no_wake_carries_it_to_the_control_path() {
        let mut wrapper = stub_wrapper(stub_plugin_ptr());
        wrapper.set_editor_window_resizer(Arc::new(|_, _| {}));

        assert!(!wrapper.host_state.request_editor_resize(1024, 768));
        assert_eq!(wrapper.apply_pending_editor_resize(), None);
    }

    /// An edit inside the plugin's own editor has to cross from the callback
    /// thread to the control path, and be reported exactly once so the project
    /// is marked dirty per edit rather than on every later wake.
    #[test]
    fn a_state_dirty_signal_crosses_to_the_control_path_and_is_consumed_once() {
        let mut wrapper = stub_wrapper(stub_plugin_ptr());
        assert!(!AudioPlugin::take_state_dirty(&mut wrapper));

        wrapper.host_state.mark_state_dirty();

        assert!(AudioPlugin::take_state_dirty(&mut wrapper));
        assert!(!AudioPlugin::take_state_dirty(&mut wrapper));
    }

    // ── Processing-state thread affinity + transport forwarding ─────────
    //
    // CLAP annotates `start_processing`/`stop_processing` `[audio-thread]`.
    // These tests pin the transition to the audio path and prove the
    // off-audio-thread fallback is a counted exception, not the norm.

    static PROCESSING_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static STUB_START_CALLS: AtomicU32 = AtomicU32::new(0);
    static STUB_STOP_CALLS: AtomicU32 = AtomicU32::new(0);

    /// What the stub plugin saw in `clap_process.transport` on its last block.
    #[derive(Clone, Copy, Default)]
    struct CapturedTransport {
        present: bool,
        flags: u32,
        tempo: f64,
        tsig_num: u16,
        tsig_denom: u16,
        song_pos_beats: i64,
        song_pos_seconds: i64,
    }

    static CAPTURED_TRANSPORT: std::sync::Mutex<Option<CapturedTransport>> =
        std::sync::Mutex::new(None);

    fn captured_transport() -> CapturedTransport {
        CAPTURED_TRANSPORT
            .lock()
            .unwrap()
            .expect("stub plugin should have processed at least one block")
    }

    /// The thread that last performed each processing transition. This is what
    /// makes the affinity claim checkable: ordering says *when* a transition
    /// ran, only a thread id says *where*.
    static START_CALLER_THREAD: std::sync::Mutex<Option<std::thread::ThreadId>> =
        std::sync::Mutex::new(None);
    static STOP_CALLER_THREAD: std::sync::Mutex<Option<std::thread::ThreadId>> =
        std::sync::Mutex::new(None);

    unsafe extern "C" fn stub_start_processing_counting(_plugin: *const clap_plugin) -> bool {
        STUB_START_CALLS.fetch_add(1, Ordering::Relaxed);
        *START_CALLER_THREAD.lock().unwrap() = Some(std::thread::current().id());
        true
    }

    unsafe extern "C" fn stub_stop_processing_counting(_plugin: *const clap_plugin) {
        STUB_STOP_CALLS.fetch_add(1, Ordering::Relaxed);
        *STOP_CALLER_THREAD.lock().unwrap() = Some(std::thread::current().id());
    }

    unsafe extern "C" fn stub_process_capturing(
        _plugin: *const clap_plugin,
        process: *const clap_process,
    ) -> i32 {
        let transport = (*process).transport;
        let captured = if transport.is_null() {
            CapturedTransport::default()
        } else {
            CapturedTransport {
                present: true,
                flags: (*transport).flags,
                tempo: (*transport).tempo,
                tsig_num: (*transport).tsig_num,
                tsig_denom: (*transport).tsig_denom,
                song_pos_beats: (*transport).song_pos_beats,
                song_pos_seconds: (*transport).song_pos_seconds,
            }
        };
        *CAPTURED_TRANSPORT.lock().unwrap() = Some(captured);
        CLAP_PROCESS_CONTINUE
    }

    /// A stub that counts its processing transitions and records the transport
    /// it was handed, so a test can tell which thread drove each transition.
    fn counting_plugin_ptr() -> *const clap_plugin {
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing_counting);
        plugin.stop_processing = Some(stub_stop_processing_counting);
        plugin.process = Some(stub_process_capturing);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    fn reset_processing_counters() {
        STUB_START_CALLS.store(0, Ordering::Relaxed);
        STUB_STOP_CALLS.store(0, Ordering::Relaxed);
        *CAPTURED_TRANSPORT.lock().unwrap() = None;
        *START_CALLER_THREAD.lock().unwrap() = None;
        *STOP_CALLER_THREAD.lock().unwrap() = None;
    }

    /// Drive one block through the RT entry point the audio thread uses.
    fn process_one_block(wrapper: &mut ClapWrapper) {
        let left = [0.0f32; 8];
        let right = [0.0f32; 8];
        let mut out_l = [0.0f32; 8];
        let mut out_r = [0.0f32; 8];
        let inputs: [&[f32]; 2] = [&left, &right];
        let mut outputs: [&mut [f32]; 2] = [&mut out_l, &mut out_r];
        wrapper.process(&inputs, &mut outputs, 8);
    }

    #[test]
    fn activation_does_not_start_processing_off_the_audio_thread() {
        let _guard = PROCESSING_TEST_LOCK.lock().unwrap();
        reset_processing_counters();
        let plugin = counting_plugin_ptr();

        let activated = unsafe { activate_plugin(plugin, 48_000.0) };

        assert!(activated, "the stub activates successfully");
        assert_eq!(
            STUB_START_CALLS.load(Ordering::Relaxed),
            0,
            "CLAP marks start_processing [audio-thread]; the loader thread must not call it"
        );
    }

    #[test]
    fn the_first_audio_block_starts_processing_exactly_once() {
        let _guard = PROCESSING_TEST_LOCK.lock().unwrap();
        reset_processing_counters();
        let mut wrapper = stub_wrapper(counting_plugin_ptr());

        assert_eq!(
            STUB_START_CALLS.load(Ordering::Relaxed),
            0,
            "constructing the wrapper starts nothing"
        );

        process_one_block(&mut wrapper);
        assert_eq!(
            STUB_START_CALLS.load(Ordering::Relaxed),
            1,
            "the first block on the audio thread performs the start transition"
        );

        process_one_block(&mut wrapper);
        assert_eq!(
            STUB_START_CALLS.load(Ordering::Relaxed),
            1,
            "a plugin already processing is not restarted every block"
        );
    }

    #[test]
    fn a_requested_stop_is_performed_by_the_next_audio_block_not_by_the_requester() {
        let _guard = PROCESSING_TEST_LOCK.lock().unwrap();
        reset_processing_counters();
        let mut wrapper = stub_wrapper(counting_plugin_ptr());
        process_one_block(&mut wrapper);

        let gate = wrapper.processing_gate();
        gate.request_stop();

        assert_eq!(
            STUB_STOP_CALLS.load(Ordering::Relaxed),
            0,
            "requesting a stop must not call stop_processing on the requesting thread"
        );
        assert!(
            !gate.has_stopped(),
            "the stop is not complete until the audio thread performs it"
        );

        process_one_block(&mut wrapper);

        assert_eq!(
            STUB_STOP_CALLS.load(Ordering::Relaxed),
            1,
            "the next audio block performs the stop transition"
        );
        assert!(gate.has_stopped(), "the audio thread acknowledges the stop");
        assert_eq!(
            gate.off_audio_thread_stops(),
            0,
            "no fallback was needed while the audio thread was still pumping"
        );
    }

    /// The claim the rest of this section only approximates: both transitions
    /// happen on the thread that runs `process`, and on no other. Ordering tests
    /// cannot separate "the audio thread did it" from "the control thread did it
    /// at the right moment" — a thread id can, and a host that starts processing
    /// from its loader or stops it from its control path fails here by identity
    /// even if every call count is correct.
    #[test]
    fn both_processing_transitions_run_on_the_thread_that_calls_process() {
        let _guard = PROCESSING_TEST_LOCK.lock().unwrap();
        reset_processing_counters();
        let control_thread = std::thread::current().id();
        let mut wrapper = stub_wrapper(counting_plugin_ptr());

        // The gate is the control thread's only handle on processing state.
        let gate = wrapper.processing_gate();

        // Block one, on the audio thread: this is where the start must happen.
        let first = std::thread::spawn(move || {
            let here = std::thread::current().id();
            process_one_block(&mut wrapper);
            (here, wrapper)
        });
        let (audio_thread_id, mut wrapper) = first.join().unwrap();

        // The stop is *requested here*, on the control thread, and deliberately
        // not while any block is running. A host that performs the transition in
        // the requester records `control_thread` against STOP_CALLER_THREAD.
        gate.request_stop();

        // Block two, on the audio thread again: this is where the stop must land.
        let second = std::thread::spawn(move || {
            let here = std::thread::current().id();
            process_one_block(&mut wrapper);
            (here, wrapper)
        });
        let (second_block_thread_id, wrapper) = second.join().unwrap();

        assert_ne!(
            audio_thread_id, control_thread,
            "the test is only meaningful if process actually ran off the control thread"
        );
        assert_eq!(
            *START_CALLER_THREAD.lock().unwrap(),
            Some(audio_thread_id),
            "start_processing is [audio-thread]: it must run on the thread that called process"
        );
        assert_eq!(
            *STOP_CALLER_THREAD.lock().unwrap(),
            Some(second_block_thread_id),
            "stop_processing is [audio-thread]: the block carries it out, not the requester"
        );
        assert_ne!(
            *STOP_CALLER_THREAD.lock().unwrap(),
            Some(control_thread),
            "the thread that requested the stop must never be the one that performed it"
        );
        assert_eq!(
            wrapper.processing_gate().off_audio_thread_stops(),
            0,
            "the audio thread was pumping, so no counted deviation was needed"
        );
    }

    #[test]
    fn a_stop_the_audio_thread_never_performed_falls_back_and_is_counted() {
        let _guard = PROCESSING_TEST_LOCK.lock().unwrap();
        reset_processing_counters();
        let mut wrapper = stub_wrapper(counting_plugin_ptr());
        process_one_block(&mut wrapper);
        wrapper.processing_gate().request_stop();

        // The slot left the graph, so no further block will ever arrive.
        wrapper.force_stop_processing_off_audio_thread();

        assert_eq!(
            STUB_STOP_CALLS.load(Ordering::Relaxed),
            1,
            "the plugin is still stopped before deactivate, as CLAP requires"
        );
        assert_eq!(
            wrapper.processing_gate().off_audio_thread_stops(),
            1,
            "the spec deviation is counted rather than hidden"
        );
    }

    #[test]
    fn a_plugin_that_never_processed_needs_no_stop_at_all() {
        let _guard = PROCESSING_TEST_LOCK.lock().unwrap();
        reset_processing_counters();
        let mut wrapper = stub_wrapper(counting_plugin_ptr());

        wrapper.force_stop_processing_off_audio_thread();

        assert_eq!(
            STUB_STOP_CALLS.load(Ordering::Relaxed),
            0,
            "start_processing never ran, so there is nothing to stop"
        );
        assert_eq!(
            wrapper.processing_gate().off_audio_thread_stops(),
            0,
            "skipping an unnecessary stop is not a spec deviation"
        );
    }

    #[test]
    fn process_hands_the_plugin_no_transport_until_the_host_supplies_one() {
        let _guard = PROCESSING_TEST_LOCK.lock().unwrap();
        reset_processing_counters();
        let mut wrapper = stub_wrapper(counting_plugin_ptr());

        process_one_block(&mut wrapper);

        assert!(
            !captured_transport().present,
            "CLAP reads a null transport as 'host has no timeline', which is the truth here"
        );
    }

    #[test]
    fn process_forwards_the_transport_the_host_supplied() {
        let _guard = PROCESSING_TEST_LOCK.lock().unwrap();
        reset_processing_counters();
        let mut wrapper = stub_wrapper(counting_plugin_ptr());

        wrapper.set_transport(HostTransport {
            tempo: 137.5,
            time_sig_num: 7,
            time_sig_denom: 8,
            is_playing: true,
            song_pos_beats: 2.5,
            song_pos_seconds: 1.25,
        });
        process_one_block(&mut wrapper);

        let transport = captured_transport();
        assert!(transport.present, "the plugin receives a transport struct");
        assert_eq!(transport.tempo, 137.5);
        assert_eq!((transport.tsig_num, transport.tsig_denom), (7, 8));
        assert_eq!(
            transport.song_pos_beats,
            (2.5 * CLAP_BEATTIME_FACTOR as f64) as i64,
            "beat position is carried in CLAP fixed point, not raw beats"
        );
        assert_eq!(
            transport.song_pos_seconds,
            (1.25 * CLAP_SECTIME_FACTOR as f64) as i64,
            "seconds position is carried in CLAP fixed point"
        );
        assert_eq!(
            transport.flags
                & (CLAP_TRANSPORT_HAS_TEMPO
                    | CLAP_TRANSPORT_HAS_TIME_SIGNATURE
                    | CLAP_TRANSPORT_HAS_BEATS_TIMELINE
                    | CLAP_TRANSPORT_HAS_SECONDS_TIMELINE),
            CLAP_TRANSPORT_HAS_TEMPO
                | CLAP_TRANSPORT_HAS_TIME_SIGNATURE
                | CLAP_TRANSPORT_HAS_BEATS_TIMELINE
                | CLAP_TRANSPORT_HAS_SECONDS_TIMELINE,
            "every field the host actually fills is flagged as present"
        );
        assert_ne!(
            transport.flags & CLAP_TRANSPORT_IS_PLAYING,
            0,
            "a rolling transport reports as playing"
        );
    }

    #[test]
    fn a_stopped_transport_clears_the_playing_flag_and_keeps_the_position() {
        let _guard = PROCESSING_TEST_LOCK.lock().unwrap();
        reset_processing_counters();
        let mut wrapper = stub_wrapper(counting_plugin_ptr());

        wrapper.set_transport(HostTransport {
            tempo: 90.0,
            time_sig_num: 3,
            time_sig_denom: 4,
            is_playing: false,
            song_pos_beats: 6.0,
            song_pos_seconds: 4.0,
        });
        process_one_block(&mut wrapper);

        let transport = captured_transport();
        assert_eq!(
            transport.flags & CLAP_TRANSPORT_IS_PLAYING,
            0,
            "a parked transport must not tell tempo-synced plugins to run"
        );
        assert_eq!(transport.tempo, 90.0);
        assert_eq!(
            transport.song_pos_beats,
            (6.0 * CLAP_BEATTIME_FACTOR as f64) as i64,
            "the parked playhead position is still reported"
        );
    }

    #[test]
    fn a_transport_update_between_blocks_reaches_the_next_block() {
        let _guard = PROCESSING_TEST_LOCK.lock().unwrap();
        reset_processing_counters();
        let mut wrapper = stub_wrapper(counting_plugin_ptr());

        wrapper.set_transport(HostTransport {
            tempo: 120.0,
            time_sig_num: 4,
            time_sig_denom: 4,
            is_playing: true,
            song_pos_beats: 0.0,
            song_pos_seconds: 0.0,
        });
        process_one_block(&mut wrapper);
        assert_eq!(captured_transport().song_pos_beats, 0);

        wrapper.set_transport(HostTransport {
            tempo: 120.0,
            time_sig_num: 4,
            time_sig_denom: 4,
            is_playing: true,
            song_pos_beats: 1.0,
            song_pos_seconds: 0.5,
        });
        process_one_block(&mut wrapper);

        assert_eq!(
            captured_transport().song_pos_beats,
            CLAP_BEATTIME_FACTOR,
            "the playhead the host advanced is the one the plugin sees"
        );
    }

    // ── Audio buffers follow the plugin's declared ports ──────────────────
    //
    // CLAP's process contract: the buffers "must have the same count as
    // specified by clap_plugin_audio_ports->count(). The index maps to
    // clap_plugin_audio_ports->get()." These tests are what fails if the host
    // goes back to handing every plugin one hardcoded stereo pair.

    /// What the stub plugin's process saw in the buffer tables of one block.
    #[derive(Clone, Copy, Default)]
    struct CapturedBuffers {
        input_count: u32,
        output_count: u32,
        first_input_channels: u32,
        first_output_channels: u32,
        second_input_channels: u32,
    }

    static CAPTURED_BUFFERS: std::sync::Mutex<Option<CapturedBuffers>> =
        std::sync::Mutex::new(None);
    static BUFFER_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Fills declared output channel `channel` with a constant so the engine's
    /// copy-back can be observed, and records the buffer table shape.
    unsafe extern "C" fn stub_process_buffer_capturing(
        _plugin: *const clap_plugin,
        process: *const clap_process,
    ) -> i32 {
        *CAPTURED_BUFFERS.lock().unwrap() = Some(CapturedBuffers {
            input_count: (*process).audio_inputs_count,
            output_count: (*process).audio_outputs_count,
            first_input_channels: if (*process).audio_inputs_count > 0 {
                (*(*process).audio_inputs).channel_count
            } else {
                0
            },
            first_output_channels: if (*process).audio_outputs_count > 0 {
                (*(*process).audio_outputs).channel_count
            } else {
                0
            },
            second_input_channels: if (*process).audio_inputs_count > 1 {
                (*(*process).audio_inputs.add(1)).channel_count
            } else {
                0
            },
        });
        for buffer_index in 0..(*process).audio_outputs_count {
            let buffer = &mut *(*process).audio_outputs.add(buffer_index as usize);
            for channel in 0..buffer.channel_count {
                // `data32` is an array of per-channel pointers; the samples
                // live behind each entry, exactly as a plugin reads them.
                let channel_data = *(buffer.data32.add(channel as usize));
                let samples =
                    std::slice::from_raw_parts_mut(channel_data, (*process).frames_count as usize);
                samples.fill((channel + 1) as f32);
            }
        }
        CLAP_PROCESS_CONTINUE
    }

    fn buffer_capturing_plugin_ptr() -> *const clap_plugin {
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        plugin.process = Some(stub_process_buffer_capturing);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    fn captured_buffers() -> CapturedBuffers {
        CAPTURED_BUFFERS
            .lock()
            .unwrap()
            .expect("stub plugin should have processed at least one block")
    }

    fn process_stereo_block(wrapper: &mut ClapWrapper, left: f32, right: f32) -> (f32, f32) {
        let input_left = [left; 8];
        let input_right = [right; 8];
        let mut out_left = [0.0f32; 8];
        let mut out_right = [0.0f32; 8];
        let inputs: [&[f32]; 2] = [&input_left, &input_right];
        let mut outputs: [&mut [f32]; 2] = [&mut out_left, &mut out_right];
        wrapper.process(&inputs, &mut outputs, 8);
        (out_left[3], out_right[3])
    }

    #[test]
    fn a_mono_plugin_receives_one_channel_and_sounds_from_the_middle() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();
        let layout = AudioBusLayout::declared(&[1], &[1]).expect("mono layout builds");
        let mut wrapper = stub_wrapper_over(layout, buffer_capturing_plugin_ptr());

        let (left, right) = process_stereo_block(&mut wrapper, 0.25, 0.5);

        let captured = captured_buffers();
        assert_eq!(
            (captured.input_count, captured.output_count),
            (1, 1),
            "one declared port per direction is one buffer per direction"
        );
        assert_eq!(captured.first_input_channels, 1);
        assert_eq!(
            captured.first_output_channels, 1,
            "a mono port is handed one channel, not the engine's stereo pair"
        );
        assert_eq!(
            (left, right),
            (1.0, 1.0),
            "a mono plugin on a stereo bus is duplicated to both channels, not silent on the right"
        );
    }

    #[test]
    fn each_declared_port_gets_its_own_buffer_and_channel_count() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();
        // A stereo main input plus a mono sidechain in; a stereo pair out.
        let layout = AudioBusLayout::declared(&[2, 1], &[2]).expect("layout builds");
        let mut wrapper = stub_wrapper_over(layout, buffer_capturing_plugin_ptr());

        process_stereo_block(&mut wrapper, 0.1, 0.2);

        let captured = captured_buffers();
        assert_eq!(captured.input_count, 2, "two declared input ports");
        assert_eq!(
            captured.first_input_channels, 2,
            "the main input port keeps its two channels"
        );
        assert_eq!(
            captured.second_input_channels, 1,
            "the sidechain port is its own buffer with its own channel count"
        );
        assert_eq!(captured.output_count, 1);
    }

    #[test]
    fn a_plugin_with_no_audio_ports_processes_no_audio_and_passes_the_block_through() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();
        let mut wrapper =
            stub_wrapper_over(AudioBusLayout::portless(), buffer_capturing_plugin_ptr());

        let (left, right) = process_stereo_block(&mut wrapper, 0.25, 0.5);

        let captured = captured_buffers();
        assert_eq!(
            (captured.input_count, captured.output_count),
            (0, 0),
            "a plugin without clap.audio-ports has no audio ports to be handed"
        );
        assert_eq!(
            (left, right),
            (0.25, 0.5),
            "a note effect's slot passes audio through instead of muting the track"
        );
    }

    #[test]
    fn a_stereo_declaration_keeps_behaving_as_it_always_did() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();
        let layout = AudioBusLayout::declared(&[2], &[2]).expect("stereo layout builds");
        let mut wrapper = stub_wrapper_over(layout, buffer_capturing_plugin_ptr());

        let (left, right) = process_stereo_block(&mut wrapper, 0.0, 0.0);

        let captured = captured_buffers();
        assert_eq!(
            (captured.input_count, captured.output_count),
            (1, 1),
            "the common case — one stereo port per direction — is unchanged"
        );
        assert_eq!(captured.first_input_channels, 2);
        assert_eq!(captured.first_output_channels, 2);
        assert_eq!(
            (left, right),
            (1.0, 2.0),
            "stereo output channels map onto the engine's left and right"
        );
    }

    #[test]
    fn a_layout_refuses_portless_and_absurd_channel_declarations() {
        assert!(
            AudioBusLayout::declared(&[0], &[2]).is_err(),
            "a port declaring no channels cannot be fed"
        );
        assert!(
            AudioBusLayout::declared(&[2], &[MAX_RUNTIME_AUDIO_CHANNELS + 1]).is_err(),
            "a channel count past the runtime bound is a memory refusal, not an allocation"
        );
    }

    /// The load-time half of the fix: the layout the wrapper processes with is
    /// the one the plugin declared through `clap.audio-ports`, read before
    /// activation where CLAP says the port list is readable. A hardcoded
    /// stereo pair cannot produce this fixture's asymmetric answer.
    #[test]
    fn the_layout_comes_from_the_plugins_own_port_list() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();

        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(audio_ports_get_extension);

        let layout = unsafe { ClapWrapper::read_audio_bus_layout(&plugin) }
            .expect("a plugin describing its ports loads");

        let input_channels: Vec<u32> = layout
            .input_buffers
            .iter()
            .map(|buffer| buffer.channel_count)
            .collect();
        let output_channels: Vec<u32> = layout
            .output_buffers
            .iter()
            .map(|buffer| buffer.channel_count)
            .collect();
        assert_eq!(
            (input_channels.as_slice(), output_channels.as_slice()),
            ([2, 1].as_slice(), [2].as_slice()),
            "stereo main plus mono sidechain in, stereo out — exactly what the plugin declared"
        );

        // And a plugin that does not implement the extension is portless, which
        // is the spec's rule, not a default.
        let mut bare: clap_plugin = unsafe { mem::zeroed() };
        bare.get_extension = Some(stub_get_extension);
        let portless = unsafe { ClapWrapper::read_audio_bus_layout(&bare) }
            .expect("a plugin without audio-ports loads");
        assert!(portless.input_buffers.is_empty() && portless.output_buffers.is_empty());
    }

    /// The wiring half: a wrapper built by the real load path carries the
    /// declared layout into its buffer tables. Reverting the load to a
    /// hardcoded stereo pair fails here even though the reader itself is
    /// correct.
    #[test]
    fn a_loaded_wrapper_processes_with_the_layout_the_plugin_declared() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();

        unsafe extern "C" fn port_declaring_plugin_init(_plugin: *const clap_plugin) -> bool {
            true
        }

        unsafe extern "C" fn port_declaring_plugin_destroy(plugin: *const clap_plugin) {
            drop(Box::from_raw(plugin as *mut clap_plugin));
        }

        unsafe extern "C" fn port_declaring_create_plugin(
            _factory: *const clap_plugin_factory,
            _host: *const clap_host,
            _plugin_id: *const i8,
        ) -> *const clap_plugin {
            Box::into_raw(Box::new(clap_plugin {
                desc: ptr::null(),
                plugin_data: ptr::null_mut(),
                init: Some(port_declaring_plugin_init),
                destroy: Some(port_declaring_plugin_destroy),
                activate: Some(stub_activate),
                deactivate: Some(stub_deactivate),
                start_processing: None,
                stop_processing: None,
                reset: None,
                process: None,
                get_extension: Some(audio_ports_get_extension),
                on_main_thread: None,
            }))
        }

        static PORT_DECLARING_FACTORY: clap_plugin_factory = clap_plugin_factory {
            get_plugin_count: None,
            get_plugin_descriptor: None,
            create_plugin: Some(port_declaring_create_plugin),
        };

        unsafe extern "C" fn port_declaring_get_factory(_factory_id: *const i8) -> *const c_void {
            &raw const PORT_DECLARING_FACTORY as *const c_void
        }

        static PORT_DECLARING_ENTRY: clap_plugin_entry = clap_plugin_entry {
            clap_version: CLAP_VERSION,
            init: None,
            deinit: None,
            get_factory: Some(port_declaring_get_factory),
        };

        let wrapper = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const PORT_DECLARING_ENTRY,
                "org.sourdaw.test.port-declaring",
                48_000.0,
            )
        }
        .expect("a plugin describing its ports loads");

        let input_channels: Vec<u32> = wrapper
            .audio
            .input_buffers
            .iter()
            .map(|buffer| buffer.channel_count)
            .collect();
        let output_channels: Vec<u32> = wrapper
            .audio
            .output_buffers
            .iter()
            .map(|buffer| buffer.channel_count)
            .collect();
        assert_eq!(
            (input_channels.as_slice(), output_channels.as_slice()),
            ([2, 1].as_slice(), [2].as_slice()),
            "the load path wires the declaration into the buffers process will hand the plugin"
        );
    }

    /// A plugin's port description, answering the runtime's audio-ports query
    /// with an asymmetric layout: a stereo main input plus a mono sidechain,
    /// and a stereo output. Shared by the reader test and the load-wiring test
    /// so both fail against the same hardcode.
    unsafe extern "C" fn stub_audio_port_count(_plugin: *const clap_plugin, is_input: bool) -> u32 {
        if is_input {
            2
        } else {
            1
        }
    }

    unsafe extern "C" fn stub_audio_port_get(
        _plugin: *const clap_plugin,
        index: u32,
        is_input: bool,
        info: *mut clap_audio_port_info,
    ) -> bool {
        if info.is_null() {
            return false;
        }
        let channel_count = match (is_input, index) {
            (true, 0) => 2,
            (true, 1) => 1,
            (false, 0) => 2,
            _ => return false,
        };
        *info = clap_audio_port_info {
            id: index,
            name: [0; clap_sys::string_sizes::CLAP_NAME_SIZE],
            flags: 0,
            channel_count,
            port_type: ptr::null(),
            in_place_pair: clap_sys::id::CLAP_INVALID_ID,
        };
        true
    }

    static DECLARED_AUDIO_PORTS: clap_plugin_audio_ports = clap_plugin_audio_ports {
        count: Some(stub_audio_port_count),
        get: Some(stub_audio_port_get),
    };

    unsafe extern "C" fn audio_ports_get_extension(
        _plugin: *const clap_plugin,
        id: *const i8,
    ) -> *const c_void {
        if CStr::from_ptr(id) == CLAP_EXT_AUDIO_PORTS {
            return &raw const DECLARED_AUDIO_PORTS as *const c_void;
        }
        ptr::null()
    }

    // ── Note ports decide whether events are routed ───────────────────────

    static NOTE_PORTS_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    unsafe extern "C" fn stub_note_port_count(_plugin: *const clap_plugin, is_input: bool) -> u32 {
        if is_input {
            1
        } else {
            0
        }
    }

    static NOTE_PORT_DIALECTS: AtomicU32 = AtomicU32::new(0);

    unsafe extern "C" fn stub_note_port_get(
        _plugin: *const clap_plugin,
        _index: u32,
        _is_input: bool,
        info: *mut clap_note_port_info,
    ) -> bool {
        if info.is_null() {
            return false;
        }
        *info = clap_note_port_info {
            id: 0,
            supported_dialects: NOTE_PORT_DIALECTS.load(Ordering::Relaxed),
            preferred_dialect: 0,
            name: [0; clap_sys::string_sizes::CLAP_NAME_SIZE],
        };
        true
    }

    static STUB_NOTE_PORTS: clap_plugin_note_ports = clap_plugin_note_ports {
        count: Some(stub_note_port_count),
        get: Some(stub_note_port_get),
    };

    unsafe extern "C" fn note_ports_get_extension(
        _plugin: *const clap_plugin,
        id: *const i8,
    ) -> *const c_void {
        if CStr::from_ptr(id) == CLAP_EXT_NOTE_PORTS {
            return &raw const STUB_NOTE_PORTS as *const c_void;
        }
        ptr::null()
    }

    #[test]
    fn a_plugin_declaring_a_clap_dialect_note_input_accepts_midi() {
        let _guard = NOTE_PORTS_TEST_LOCK.lock().unwrap();
        NOTE_PORT_DIALECTS.store(CLAP_NOTE_DIALECT_CLAP, Ordering::Relaxed);
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(note_ports_get_extension);

        assert!(
            unsafe { ClapWrapper::reads_note_input_ports(&plugin) },
            "an input port speaking the dialect this host's events are in takes those events"
        );
    }

    #[test]
    fn a_plugin_with_no_note_ports_extension_refuses_midi() {
        let _guard = NOTE_PORTS_TEST_LOCK.lock().unwrap();
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension); // answers everything but note ports

        assert!(
            !unsafe { ClapWrapper::reads_note_input_ports(&plugin) },
            "no clap.note-ports means no note input, per the spec's own rule"
        );
    }

    #[test]
    fn a_plugin_whose_ports_speak_only_midi_family_dialects_refuses_midi() {
        let _guard = NOTE_PORTS_TEST_LOCK.lock().unwrap();
        use clap_sys::ext::note_ports::CLAP_NOTE_DIALECT_MIDI;
        NOTE_PORT_DIALECTS.store(CLAP_NOTE_DIALECT_MIDI, Ordering::Relaxed);
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(note_ports_get_extension);

        assert!(
            !unsafe { ClapWrapper::reads_note_input_ports(&plugin) },
            "this host sends clap_event_note; a port that does not list the CLAP dialect cannot read them"
        );
    }

    /// The wrapper must forward its own answer, not the seam's default `true`
    /// — that default routed notes at every effect in the rack.
    #[test]
    fn the_wrapper_answers_accepts_midi_from_its_own_note_port_query() {
        let mut wrapper = stub_wrapper(stub_plugin_ptr());
        assert!(AudioPlugin::accepts_midi(&wrapper));

        wrapper.accepts_note_events = false;

        assert!(!AudioPlugin::accepts_midi(&wrapper));
    }

    // ── The editor is told the host's display scale ───────────────────────

    static GUI_SCALE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static SCALES_PASSED_TO_PLUGIN: std::sync::Mutex<Vec<f64>> = std::sync::Mutex::new(Vec::new());

    unsafe extern "C" fn scale_recording_set_scale(
        _plugin: *const clap_plugin,
        scale: f64,
    ) -> bool {
        SCALES_PASSED_TO_PLUGIN.lock().unwrap().push(scale);
        true
    }

    /// The window API string the last editor open negotiated, so a test can
    /// state which API's set_scale rules were in play.
    static NEGOTIATED_GUI_API: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

    unsafe extern "C" fn always_supported(
        _plugin: *const clap_plugin,
        api: *const i8,
        _is_floating: bool,
    ) -> bool {
        if !api.is_null() {
            *NEGOTIATED_GUI_API.lock().unwrap() =
                CStr::from_ptr(api).to_string_lossy().into_owned();
        }
        true
    }

    unsafe extern "C" fn succeeding_create(
        _plugin: *const clap_plugin,
        _api: *const i8,
        _is_floating: bool,
    ) -> bool {
        true
    }

    unsafe extern "C" fn stub_gui_get_size(
        _plugin: *const clap_plugin,
        width: *mut u32,
        height: *mut u32,
    ) -> bool {
        *width = 640;
        *height = 480;
        true
    }

    unsafe extern "C" fn succeeding_set_parent(
        _plugin: *const clap_plugin,
        _window: *const clap_window,
    ) -> bool {
        true
    }

    unsafe extern "C" fn scale_recording_get_extension(
        _plugin: *const clap_plugin,
        id: *const i8,
    ) -> *const c_void {
        static SCALE_RECORDING_GUI: clap_plugin_gui = clap_plugin_gui {
            is_api_supported: Some(always_supported),
            get_preferred_api: None,
            create: Some(succeeding_create),
            destroy: None,
            set_scale: Some(scale_recording_set_scale),
            get_size: Some(stub_gui_get_size),
            can_resize: None,
            get_resize_hints: None,
            adjust_size: None,
            set_size: None,
            set_parent: Some(succeeding_set_parent),
            set_transient: None,
            suggest_title: None,
            show: None,
            hide: None,
        };
        if CStr::from_ptr(id) == CLAP_EXT_GUI {
            return &raw const SCALE_RECORDING_GUI as *const c_void;
        }
        ptr::null()
    }

    /// The host states its display scale before the editor opens; a plugin
    /// told 1.0 on a 2.0 screen lays its editor out at half size. The old code
    /// hardcoded 1.0 and dropped whatever the host had stated.
    ///
    /// The expectation is the platform's, because the open path this drives is:
    /// win32 and x11 are told the host's scale, and cocoa — whose logical sizes
    /// already carry the OS scale — is told nothing at all.
    #[test]
    fn opening_the_editor_hands_the_plugin_the_host_stated_scale() {
        let _guard = GUI_SCALE_TEST_LOCK.lock().unwrap();
        SCALES_PASSED_TO_PLUGIN.lock().unwrap().clear();
        NEGOTIATED_GUI_API.lock().unwrap().clear();
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(scale_recording_get_extension);
        let plugin_ptr = Box::into_raw(Box::new(plugin)) as *const clap_plugin;
        let gui_ext =
            unsafe { ClapWrapper::query_extension::<clap_plugin_gui>(&*plugin_ptr, CLAP_EXT_GUI) };
        let mut wrapper = stub_wrapper(plugin_ptr);
        wrapper.gui_ext = gui_ext;

        wrapper.set_editor_content_scale(2.0);
        wrapper
            .open_gui(ptr::null_mut())
            .expect("the recording gui opens");

        assert_eq!(
            NEGOTIATED_GUI_API.lock().unwrap().as_str(),
            ClapWrapper::platform_api().to_str().expect("api is utf-8"),
            "the test opens the editor through this platform's own window API"
        );
        let stated: &[f64] = if ClapWrapper::scale_applies_to(ClapWrapper::platform_api()) {
            &[2.0]
        } else {
            &[]
        };
        assert_eq!(
            SCALES_PASSED_TO_PLUGIN.lock().unwrap().as_slice(),
            stated,
            "set_scale receives the host's display scale, not a hardcoded 1.0, and a \
             logical-pixel API receives no scale at all"
        );
    }

    #[test]
    fn an_unusable_scale_is_ignored_rather_than_stored() {
        let mut wrapper = stub_wrapper(stub_plugin_ptr());

        wrapper.set_editor_content_scale(0.0);
        wrapper.set_editor_content_scale(-1.0);
        wrapper.set_editor_content_scale(f64::NAN);

        assert_eq!(
            wrapper.editor_content_scale,
            crate::traits::DEFAULT_EDITOR_CONTENT_SCALE,
            "a scale with no meaning cannot replace the one that has a default"
        );
    }

    /// gui.h's own rule: set_scale is for physical-pixel window APIs, and
    /// cocoa "uses logical size, don't call set_scale". The OS already applied
    /// the scale in a cocoa editor's logical size, so a host that passes its
    /// 2.0 on top of that double-sizes the editor — and JUCE wrappers honor
    /// the call, so the host is the one who must not make it.
    #[test]
    fn set_scale_is_skipped_for_the_logical_pixel_cocoa_api() {
        use clap_sys::ext::gui::{
            CLAP_WINDOW_API_COCOA, CLAP_WINDOW_API_WIN32, CLAP_WINDOW_API_X11,
        };

        assert!(!ClapWrapper::scale_applies_to(CLAP_WINDOW_API_COCOA));
        assert!(ClapWrapper::scale_applies_to(CLAP_WINDOW_API_X11));
        assert!(ClapWrapper::scale_applies_to(CLAP_WINDOW_API_WIN32));
    }

    /// The same clause decides the units: a window API told a scale states its
    /// sizes in physical pixels, and the seam converts them. Rounded, and
    /// floored at one — a size scaled away to nothing is not a smaller editor,
    /// it is no editor.
    #[test]
    fn a_size_crossing_the_unit_boundary_is_rounded_and_never_reaches_zero() {
        assert_eq!(ClapWrapper::scaled_size((500, 450), 2.0), (1000, 900));
        assert_eq!(
            ClapWrapper::scaled_size((1001, 751), 1.0 / 1.25),
            (801, 601)
        );
        assert_eq!(ClapWrapper::scaled_size((1, 1), 1.0 / 100.0), (1, 1));
    }

    // ── The host's window and the editor's size move together ─────────────

    static EDITOR_RESIZE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    /// Every step of the host-driven resize sequence, in the order it happened:
    /// the plugin's own calls and the host's window moves in one log, because
    /// the order between them is the contract.
    static EDITOR_RESIZE_TRACE: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
    /// The size `get_size` states, which `set_size` and `set_scale` both move.
    static STATED_EDITOR_SIZE: std::sync::Mutex<(u32, u32)> =
        std::sync::Mutex::new(UNSCALED_EDITOR);
    /// The editor's size at a scale of 1, which a stated scale is applied to.
    const UNSCALED_EDITOR: (u32, u32) = (640, 480);

    fn record_editor_step(step: String) {
        EDITOR_RESIZE_TRACE.lock().unwrap().push(step);
    }

    fn editor_steps() -> Vec<String> {
        EDITOR_RESIZE_TRACE.lock().unwrap().clone()
    }

    unsafe extern "C" fn resizable_can_resize(_plugin: *const clap_plugin) -> bool {
        true
    }

    /// A plugin that only runs at one size, which is what `adjust_size` is for.
    unsafe extern "C" fn quantising_adjust_size(
        _plugin: *const clap_plugin,
        width: *mut u32,
        height: *mut u32,
    ) -> bool {
        record_editor_step(format!("adjust_size({}x{})", *width, *height));
        *width = 800;
        *height = 600;
        true
    }

    unsafe extern "C" fn recording_set_size(
        _plugin: *const clap_plugin,
        width: u32,
        height: u32,
    ) -> bool {
        record_editor_step(format!("set_size({width}x{height})"));
        *STATED_EDITOR_SIZE.lock().unwrap() = (width, height);
        true
    }

    unsafe extern "C" fn stated_get_size(
        _plugin: *const clap_plugin,
        width: *mut u32,
        height: *mut u32,
    ) -> bool {
        let (stated_width, stated_height) = *STATED_EDITOR_SIZE.lock().unwrap();
        *width = stated_width;
        *height = stated_height;
        true
    }

    /// A plugin that lays itself out at the density it is told, the way a real
    /// one on a physical-pixel window API does.
    unsafe extern "C" fn scale_following_set_scale(
        _plugin: *const clap_plugin,
        scale: f64,
    ) -> bool {
        record_editor_step(format!("set_scale({scale})"));
        *STATED_EDITOR_SIZE.lock().unwrap() = (
            (f64::from(UNSCALED_EDITOR.0) * scale) as u32,
            (f64::from(UNSCALED_EDITOR.1) * scale) as u32,
        );
        true
    }

    unsafe extern "C" fn resizable_get_extension(
        _plugin: *const clap_plugin,
        id: *const i8,
    ) -> *const c_void {
        static RESIZABLE_GUI: clap_plugin_gui = clap_plugin_gui {
            is_api_supported: Some(always_supported),
            get_preferred_api: None,
            create: Some(succeeding_create),
            destroy: None,
            set_scale: Some(scale_following_set_scale),
            get_size: Some(stated_get_size),
            can_resize: Some(resizable_can_resize),
            get_resize_hints: None,
            adjust_size: Some(quantising_adjust_size),
            set_size: Some(recording_set_size),
            set_parent: Some(succeeding_set_parent),
            set_transient: None,
            suggest_title: None,
            show: None,
            hide: None,
        };
        if CStr::from_ptr(id) == CLAP_EXT_GUI {
            return &raw const RESIZABLE_GUI as *const c_void;
        }
        ptr::null()
    }

    /// The same editor without the three calls gui.h defines the host-driven
    /// resize sequence in terms of — which is how a fixed-size CLAP editor
    /// declares itself.
    unsafe extern "C" fn fixed_size_get_extension(
        _plugin: *const clap_plugin,
        id: *const i8,
    ) -> *const c_void {
        static FIXED_SIZE_GUI: clap_plugin_gui = clap_plugin_gui {
            is_api_supported: Some(always_supported),
            get_preferred_api: None,
            create: Some(succeeding_create),
            destroy: None,
            set_scale: Some(scale_following_set_scale),
            get_size: Some(stated_get_size),
            can_resize: None,
            get_resize_hints: None,
            adjust_size: None,
            set_size: None,
            set_parent: Some(succeeding_set_parent),
            set_transient: None,
            suggest_title: None,
            show: None,
            hide: None,
        };
        if CStr::from_ptr(id) == CLAP_EXT_GUI {
            return &raw const FIXED_SIZE_GUI as *const c_void;
        }
        ptr::null()
    }

    /// A wrapper whose editor is open over the given `gui` extension, with the
    /// host's window seam recording into the same trace the plugin's calls do.
    fn wrapper_with_open_editor(
        get_extension: unsafe extern "C" fn(*const clap_plugin, *const i8) -> *const c_void,
    ) -> ClapWrapper {
        *STATED_EDITOR_SIZE.lock().unwrap() = UNSCALED_EDITOR;
        EDITOR_RESIZE_TRACE.lock().unwrap().clear();

        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(get_extension);
        let plugin_ptr = Box::into_raw(Box::new(plugin)) as *const clap_plugin;
        let gui_ext =
            unsafe { ClapWrapper::query_extension::<clap_plugin_gui>(&*plugin_ptr, CLAP_EXT_GUI) };
        let mut wrapper = stub_wrapper(plugin_ptr);
        wrapper.gui_ext = gui_ext;
        wrapper.set_editor_window_resizer(Arc::new(|width, height| {
            record_editor_step(format!("window({width}x{height})"));
        }));
        wrapper
            .open_gui(ptr::null_mut())
            .expect("the recording gui opens");
        EDITOR_RESIZE_TRACE.lock().unwrap().clear();
        wrapper
    }

    /// The user drags the window; the plugin decides what it will run at. A host
    /// that applies its own number leaves the editor drawing outside its window,
    /// and one that tells the plugin before moving the window has it lay out
    /// against the shape it is leaving.
    #[test]
    fn a_host_window_resize_lands_on_the_size_the_plugin_adjusted_it_to() {
        let _guard = EDITOR_RESIZE_TEST_LOCK.lock().unwrap();
        let mut wrapper = wrapper_with_open_editor(resizable_get_extension);

        let granted = wrapper
            .request_editor_size(1000, 900)
            .expect("a resizable editor must accept an adjusted size");

        assert_eq!(
            granted,
            (800, 600),
            "the seam must report what adjust_size wrote, which is the size the window snaps to"
        );
        assert_eq!(
            editor_steps(),
            [
                "adjust_size(1000x900)",
                "window(800x600)",
                "set_size(800x600)"
            ],
            "the window must be moved to the adjusted size before the plugin is told to move into it"
        );
    }

    /// `can_resize` is the plugin's own answer, and gui.h defines the whole
    /// host-driven sequence as reachable only through it. A host that asks
    /// anyway drags a fixed-layout editor into a shape it never agreed to.
    #[test]
    fn a_fixed_size_editor_is_never_asked_for_a_size_the_host_chose() {
        let _guard = EDITOR_RESIZE_TEST_LOCK.lock().unwrap();
        let mut wrapper = wrapper_with_open_editor(fixed_size_get_extension);

        assert!(!wrapper.editor_can_resize());

        let refusal = wrapper
            .request_editor_size(1000, 900)
            .expect_err("a fixed-size editor must refuse a host-chosen size");

        assert!(
            refusal.contains("no resizable open editor"),
            "got: {refusal}"
        );
        assert_eq!(
            editor_steps(),
            Vec::<String>::new(),
            "neither the plugin nor the window may move for a refused resize"
        );
    }

    /// A window dragged to a display of another density has to tell the editor,
    /// and then find out what the editor became: the plugin lays itself out
    /// again, and the window it sits in has to follow it.
    ///
    /// The two sides speak different units. On win32 and x11 the editor states
    /// physical pixels, so an editor that doubles at a 2.0 scale is drawing the
    /// same window at twice the density — and a host that passed that number
    /// straight to its logical window seam would double the window instead,
    /// leaving the editor in the corner of a window four times its area.
    #[test]
    fn a_display_scale_change_restates_the_scale_and_resizes_the_window_to_what_it_produced() {
        let _guard = EDITOR_RESIZE_TEST_LOCK.lock().unwrap();
        let mut wrapper = wrapper_with_open_editor(resizable_get_extension);

        let granted = wrapper
            .apply_editor_content_scale(2.0)
            .expect("an open editor must accept the scale of the display it moved to");

        let physical_pixels = ClapWrapper::scale_applies_to(ClapWrapper::platform_api());
        // cocoa states logical sizes that already carry the OS scale, so it is
        // told nothing and lays out nothing again.
        let stated_by_plugin = if physical_pixels {
            (1280, 960)
        } else {
            UNSCALED_EDITOR
        };
        assert_eq!(
            *STATED_EDITOR_SIZE.lock().unwrap(),
            stated_by_plugin,
            "the plugin lays itself out in its own units, got: {:?}",
            editor_steps()
        );
        assert_eq!(
            granted,
            UNSCALED_EDITOR,
            "the window keeps its logical size on every platform: a denser display \
             redraws the editor, it does not grow the window, got: {:?}",
            editor_steps()
        );
        assert_eq!(
            editor_steps().last(),
            Some(&format!(
                "window({}x{})",
                UNSCALED_EDITOR.0, UNSCALED_EDITOR.1
            )),
            "the window must end at the logical size the re-scaled editor states"
        );
        assert_eq!(
            wrapper.editor_content_scale, 2.0,
            "the scale is kept, so an editor reopened on that display opens at it"
        );
    }

    /// The host chooses in the units its window seam speaks, and gui.h states
    /// the plugin's in physical pixels for win32 and x11. A host that skips the
    /// conversion asks a plugin on a 2.0 display for half the size the user
    /// dragged to, and then sizes the window to twice what the plugin granted.
    #[test]
    fn a_host_resize_crosses_the_seam_in_the_units_each_side_speaks() {
        let _guard = EDITOR_RESIZE_TEST_LOCK.lock().unwrap();
        let mut wrapper = wrapper_with_open_editor(resizable_get_extension);
        wrapper.set_editor_content_scale(2.0);
        EDITOR_RESIZE_TRACE.lock().unwrap().clear();

        let granted = wrapper
            .request_editor_size(500, 450)
            .expect("a resizable editor must accept an adjusted size");

        // `quantising_adjust_size` answers 800x600 in the plugin's own units,
        // whatever it was asked for.
        let physical_pixels = ClapWrapper::scale_applies_to(ClapWrapper::platform_api());
        let asked = if physical_pixels {
            "adjust_size(1000x900)"
        } else {
            "adjust_size(500x450)"
        };
        let expected = if physical_pixels {
            (400, 300)
        } else {
            (800, 600)
        };
        assert_eq!(
            granted, expected,
            "the seam must report the adjusted size in the window's units"
        );
        assert_eq!(
            editor_steps(),
            [
                asked.to_string(),
                format!("window({}x{})", expected.0, expected.1),
                "set_size(800x600)".to_string()
            ],
            "the plugin is asked and told in its units, and the window moved in the seam's"
        );
    }

    // ── Sidechain input ports get silence, not leftover engine channels ───

    /// The first sample each declared input channel carried on the last block,
    /// in declaration order — what a plugin's detector on any port actually
    /// saw.
    static SAMPLED_INPUT_CHANNELS: std::sync::Mutex<Vec<f32>> = std::sync::Mutex::new(Vec::new());

    unsafe extern "C" fn stub_process_input_sampling(
        _plugin: *const clap_plugin,
        process: *const clap_process,
    ) -> i32 {
        let mut sampled = SAMPLED_INPUT_CHANNELS.lock().unwrap();
        sampled.clear();
        for buffer_index in 0..(*process).audio_inputs_count {
            let buffer = (*process).audio_inputs.add(buffer_index as usize);
            for channel in 0..(*buffer).channel_count {
                let channel_data = *(*buffer).data32.add(channel as usize);
                sampled.push(*channel_data);
            }
        }
        // Keep the output write the other stubs perform, so the block still
        // carries observable audio.
        stub_process_buffer_capturing(_plugin, process)
    }

    fn input_sampling_plugin_ptr() -> *const clap_plugin {
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        plugin.process = Some(stub_process_input_sampling);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    /// A `[1, 1]` compressor — mono main, mono sidechain — must see the
    /// engine's left on its main port and silence on the sidechain. The old
    /// positional mapping wired the engine's right channel into the sidechain
    /// detector: the compressor ducked against the very signal it was
    /// processing.
    #[test]
    fn a_sidechain_input_port_receives_silence_not_the_engines_right_channel() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();
        let layout = AudioBusLayout::declared(&[1, 1], &[1]).expect("layout builds");
        let mut wrapper = stub_wrapper_over(layout, input_sampling_plugin_ptr());

        process_stereo_block(&mut wrapper, 0.7, 0.9);

        let sampled = SAMPLED_INPUT_CHANNELS.lock().unwrap().clone();
        assert_eq!(
            sampled,
            vec![0.7, 0.0],
            "main port carries the engine's left; the unconnected sidechain port stays silent"
        );
    }

    // ── Parameter names are read within their own bounds ──────────────────

    #[test]
    fn bounded_parameter_name_reads_a_terminated_name_and_refuses_an_unterminated_one() {
        let mut terminated = [0 as std::os::raw::c_char; 64];
        let name: Vec<std::os::raw::c_char> = b"Gain\0"
            .iter()
            .map(|byte| *byte as std::os::raw::c_char)
            .collect();
        terminated[..name.len()].copy_from_slice(&name);
        assert_eq!(bounded_parameter_name(&terminated).as_deref(), Some("Gain"));

        let unterminated = [b'x' as std::os::raw::c_char; 64];
        assert_eq!(
            bounded_parameter_name(&unterminated),
            None,
            "a name with no terminator inside its own array cannot be read as a C string"
        );
    }

    #[test]
    fn a_parameter_whose_name_fills_its_array_is_skipped_not_read_past_it() {
        use clap_sys::string_sizes::{CLAP_NAME_SIZE, CLAP_PATH_SIZE};

        unsafe extern "C" fn unterminated_parameter_count(_plugin: *const clap_plugin) -> u32 {
            1
        }

        unsafe extern "C" fn unterminated_parameter_info(
            _plugin: *const clap_plugin,
            index: u32,
            info: *mut clap_param_info,
        ) -> bool {
            if index != 0 || info.is_null() {
                return false;
            }
            let mut parameter: clap_param_info = mem::zeroed();
            // Every name byte set, no terminator: the exact array that made
            // `CStr::from_ptr` read past `name` and into `module`.
            parameter.name = [b'n' as std::os::raw::c_char; CLAP_NAME_SIZE];
            parameter.module = [0; CLAP_PATH_SIZE];
            parameter.id = 11;
            parameter.min_value = 0.0;
            parameter.max_value = 1.0;
            parameter.default_value = 0.5;
            *info = parameter;
            true
        }

        static UNTERMINATED_PARAMETERS: clap_plugin_params = clap_plugin_params {
            count: Some(unterminated_parameter_count),
            get_info: Some(unterminated_parameter_info),
            get_value: None,
            value_to_text: None,
            text_to_value: None,
            flush: None,
        };

        let mut wrapper = stub_wrapper(stub_plugin_ptr());
        wrapper.params_ext = &raw const UNTERMINATED_PARAMETERS;

        assert!(
            AudioPlugin::get_parameters(&wrapper).is_empty(),
            "a parameter whose name cannot be read within its own bounds is skipped, like one whose get_info refused"
        );
    }

    // ── Plugin → host parameter events (#2984) ──────────────────────────
    //
    // Before this, the output list accepted every event and discarded it, so a
    // user turning a knob in a plugin's own editor changed the plugin and told
    // the host nothing. These pin what now reaches the host and what does not.

    /// What the stub plugin should write into `out_events` on its next call.
    /// Serialised by the lock below because the stub is a process-wide static.
    static EMITTED_EVENTS: std::sync::Mutex<Vec<PluginParameterEvent>> =
        std::sync::Mutex::new(Vec::new());
    static EMIT_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    /// What `try_push` answered for each emitted event, in order.
    static EMIT_ANSWERS: std::sync::Mutex<Vec<bool>> = std::sync::Mutex::new(Vec::new());

    fn stage_emitted_events(events: Vec<PluginParameterEvent>) {
        *EMITTED_EVENTS.lock().unwrap() = events;
        EMIT_ANSWERS.lock().unwrap().clear();
    }

    fn emit_answers() -> Vec<bool> {
        EMIT_ANSWERS.lock().unwrap().clone()
    }

    /// Write the staged events onto a real CLAP output list, exactly as a plugin
    /// would: one correctly sized struct per event, headed by its own header.
    unsafe fn emit_staged_events(out_events: *const clap_output_events) {
        let Some(try_push) = (*out_events).try_push else {
            return;
        };
        let staged = EMITTED_EVENTS.lock().unwrap().clone();
        let mut answers = Vec::with_capacity(staged.len());
        for event in staged {
            let accepted = match event.kind {
                PluginParameterEventKind::Value => {
                    let value = param_value_event(event.param_id, event.value);
                    try_push(out_events, &value.header)
                }
                PluginParameterEventKind::GestureBegin | PluginParameterEventKind::GestureEnd => {
                    let gesture = gesture_event(
                        event.param_id,
                        matches!(event.kind, PluginParameterEventKind::GestureBegin),
                    );
                    try_push(out_events, &gesture.header)
                }
            };
            answers.push(accepted);
        }
        *EMIT_ANSWERS.lock().unwrap() = answers;
    }

    fn param_value_event(param_id: u32, value: f64) -> clap_event_param_value {
        clap_event_param_value {
            header: clap_event_header {
                size: mem::size_of::<clap_event_param_value>() as u32,
                time: 0,
                space_id: CLAP_CORE_EVENT_SPACE_ID,
                type_: CLAP_EVENT_PARAM_VALUE,
                flags: 0,
            },
            param_id,
            cookie: ptr::null_mut(),
            note_id: -1,
            port_index: -1,
            channel: -1,
            key: -1,
            value,
        }
    }

    fn gesture_event(param_id: u32, begin: bool) -> clap_event_param_gesture {
        clap_event_param_gesture {
            header: clap_event_header {
                size: mem::size_of::<clap_event_param_gesture>() as u32,
                time: 0,
                space_id: CLAP_CORE_EVENT_SPACE_ID,
                type_: if begin {
                    CLAP_EVENT_PARAM_GESTURE_BEGIN
                } else {
                    CLAP_EVENT_PARAM_GESTURE_END
                },
                flags: 0,
            },
            param_id,
        }
    }

    unsafe extern "C" fn stub_process_emitting(
        _plugin: *const clap_plugin,
        process: *const clap_process,
    ) -> i32 {
        emit_staged_events((*process).out_events);
        CLAP_PROCESS_CONTINUE
    }

    unsafe extern "C" fn stub_params_flush_emitting(
        _plugin: *const clap_plugin,
        _in_events: *const clap_input_events,
        out_events: *const clap_output_events,
    ) {
        FLUSH_CALLS.fetch_add(1, Ordering::Relaxed);
        emit_staged_events(out_events);
    }

    static FLUSH_CALLS: AtomicU32 = AtomicU32::new(0);

    static EMITTING_PARAMS: clap_plugin_params = clap_plugin_params {
        count: None,
        get_info: None,
        get_value: None,
        value_to_text: None,
        text_to_value: None,
        flush: Some(stub_params_flush_emitting),
    };

    fn emitting_plugin_ptr() -> *const clap_plugin {
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        plugin.process = Some(stub_process_emitting);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    fn captured_events(wrapper: &ClapWrapper) -> Vec<PluginParameterEvent> {
        let mut events = Vec::new();
        wrapper.parameter_event_queue().drain(&mut events);
        events
    }

    /// AC-001. Reverting `out_events` to a list that answers `true` and discards
    /// — which is what it was — leaves this queue empty.
    #[test]
    fn a_value_the_plugin_emits_during_process_reaches_the_host() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        stage_emitted_events(vec![PluginParameterEvent::value(12, 0.75)]);
        let mut wrapper = stub_wrapper(emitting_plugin_ptr());

        process_one_block(&mut wrapper);

        assert_eq!(
            captured_events(&wrapper),
            vec![PluginParameterEvent::value(12, 0.75)]
        );
    }

    /// AC-003. The bracket has to survive the crossing in order, or a recorder
    /// cannot tell one held ride from a run of separate nudges.
    #[test]
    fn a_bracketed_ride_reaches_the_host_with_its_gesture_boundaries_in_order() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        stage_emitted_events(vec![
            PluginParameterEvent::gesture_begin(4),
            PluginParameterEvent::value(4, 0.2),
            PluginParameterEvent::value(4, 0.6),
            PluginParameterEvent::gesture_end(4),
        ]);
        let mut wrapper = stub_wrapper(emitting_plugin_ptr());

        process_one_block(&mut wrapper);

        assert_eq!(
            captured_events(&wrapper),
            vec![
                PluginParameterEvent::gesture_begin(4),
                PluginParameterEvent::value(4, 0.2),
                PluginParameterEvent::value(4, 0.6),
                PluginParameterEvent::gesture_end(4),
            ]
        );
        assert_eq!(emit_answers(), vec![true; 4]);
    }

    /// A plugin with no audio ports still gets `process()` and still owes the
    /// host its output events — a note effect's editor is not a second-class one.
    #[test]
    fn a_portless_plugins_events_reach_the_host_too() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        stage_emitted_events(vec![PluginParameterEvent::value(1, 0.3)]);
        let mut wrapper = stub_wrapper_over(AudioBusLayout::portless(), emitting_plugin_ptr());

        process_one_block(&mut wrapper);

        assert_eq!(
            captured_events(&wrapper),
            vec![PluginParameterEvent::value(1, 0.3)]
        );
    }

    /// The event types this host has no path for are absorbed as they always
    /// were: answering `false` would have a plugin retry a note-end forever.
    #[test]
    fn an_event_the_host_does_not_model_is_absorbed_rather_than_captured() {
        let queue = PluginParameterEventQueue::default();
        let list = capture_output_events(&queue);
        let note = clap_event_note {
            header: clap_event_header {
                size: mem::size_of::<clap_event_note>() as u32,
                time: 0,
                space_id: CLAP_CORE_EVENT_SPACE_ID,
                type_: CLAP_EVENT_NOTE_ON,
                flags: 0,
            },
            note_id: -1,
            port_index: 0,
            channel: 0,
            key: 60,
            velocity: 1.0,
        };

        let accepted = unsafe { output_events_try_push(&list, &note.header) };

        assert!(accepted);
        assert!(!queue.has_pending());
    }

    /// Event spaces other than the core one carry other vendors' event layouts.
    /// Reading one as a `clap_event_param_value` reads a struct that is not
    /// there and publishes whatever the bytes happened to be.
    #[test]
    fn an_event_from_a_foreign_event_space_is_not_read_as_a_parameter() {
        let queue = PluginParameterEventQueue::default();
        let list = capture_output_events(&queue);
        let mut event = param_value_event(3, 0.9);
        event.header.space_id = CLAP_CORE_EVENT_SPACE_ID + 1;

        let accepted = unsafe { output_events_try_push(&list, &event.header) };

        assert!(accepted, "a foreign space is absorbed, not refused");
        assert!(!queue.has_pending());
    }

    /// A plugin that under-declares its event's size is describing a shorter
    /// allocation than the cast reads. The same refusal the scanner already
    /// makes for a parameter name that never terminates.
    #[test]
    fn an_undersized_parameter_event_is_refused_rather_than_read_past() {
        let queue = PluginParameterEventQueue::default();
        let list = capture_output_events(&queue);
        let mut value = param_value_event(3, 0.9);
        value.header.size = mem::size_of::<clap_event_header>() as u32;
        let mut gesture = gesture_event(3, true);
        gesture.header.size = 1;

        unsafe {
            assert!(output_events_try_push(&list, &value.header));
            assert!(output_events_try_push(&list, &gesture.header));
        }

        assert!(!queue.has_pending());
    }

    /// CLAP defines `false` from `try_push`, and it is the truthful answer to a
    /// queue with no room: the plugin may send the event again on its next
    /// block, where an acceptance would have lost it for good.
    #[test]
    fn a_full_queue_refuses_the_plugins_push_rather_than_pretending_to_take_it() {
        let queue = PluginParameterEventQueue::with_capacity(1);
        let list = capture_output_events(&queue);
        let first = param_value_event(1, 0.1);
        let second = param_value_event(2, 0.2);

        unsafe {
            assert!(output_events_try_push(&list, &first.header));
            assert!(!output_events_try_push(&list, &second.header));
        }

        assert_eq!(queue.take_dropped(), 1);
    }

    #[test]
    fn a_null_event_or_list_is_refused_rather_than_dereferenced() {
        let queue = PluginParameterEventQueue::default();
        let list = capture_output_events(&queue);
        let value = param_value_event(1, 0.1);

        unsafe {
            assert!(!output_events_try_push(&list, ptr::null()));
            assert!(!output_events_try_push(ptr::null(), &value.header));
        }
    }

    /// The suppressing list is handed to third-party code on the same terms as
    /// the ordinary one, so it owes the same refusal. A plugin that pushes a null
    /// header must be told no, not dereferenced.
    #[test]
    fn the_host_write_list_refuses_a_null_event_or_list_rather_than_dereferencing_it() {
        let queue = PluginParameterEventQueue::default();
        let mut capture = HostWriteCapture {
            queue: &queue,
            written_param_id: 1,
        };
        let list = capture_host_write_events(&mut capture);
        let value = param_value_event(2, 0.1);

        unsafe {
            assert!(!host_write_try_push(&list, ptr::null()));
            assert!(!host_write_try_push(ptr::null(), &value.header));
        }

        let mut taken = Vec::new();
        queue.drain(&mut taken);
        assert!(taken.is_empty());
    }

    /// A list with no capture behind it can only come from the host building one
    /// wrong. Absorbed rather than refused, exactly as the ordinary list does with
    /// a null queue: a refusal would have the plugin re-send an event no capture
    /// exists to take.
    #[test]
    fn the_host_write_list_absorbs_an_event_when_it_carries_no_capture() {
        let value = param_value_event(2, 0.1);
        let list = clap_output_events {
            ctx: ptr::null_mut(),
            try_push: Some(host_write_try_push),
        };

        unsafe {
            assert!(host_write_try_push(&list, &value.header));
        }
    }

    /// AC-002. `request_flush` exists precisely for the plugin that is not being
    /// handed blocks — transport stopped, editor open — and until this the
    /// callback was a comment.
    #[test]
    fn a_flush_the_plugin_requested_runs_off_the_audio_thread_and_captures() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        stage_emitted_events(vec![PluginParameterEvent::value(8, 0.44)]);
        FLUSH_CALLS.store(0, Ordering::Relaxed);
        let mut wrapper = stub_wrapper(emitting_plugin_ptr());
        wrapper.params_ext = &raw const EMITTING_PARAMS;
        wrapper.processing.request_stop();
        wrapper.host_state.request_parameters_flush();

        assert!(wrapper.flush_parameters_off_audio_thread());

        assert_eq!(FLUSH_CALLS.load(Ordering::Relaxed), 1);
        assert_eq!(
            captured_events(&wrapper),
            vec![PluginParameterEvent::value(8, 0.44)]
        );
    }

    /// `flush` is `[audio-thread]` while the plugin is processing, and its output
    /// comes back through `process()` there anyway. Calling it from here would
    /// break the format's own threading rule for no gain.
    #[test]
    fn a_flush_request_that_arrives_while_processing_is_left_to_the_next_block() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        stage_emitted_events(vec![PluginParameterEvent::value(8, 0.44)]);
        FLUSH_CALLS.store(0, Ordering::Relaxed);
        let mut wrapper = stub_wrapper(emitting_plugin_ptr());
        wrapper.params_ext = &raw const EMITTING_PARAMS;
        wrapper.host_state.request_parameters_flush();
        // The gate's audio-thread truth, reached the only way a block does.
        process_one_block(&mut wrapper);
        captured_events(&wrapper);
        assert!(wrapper.processing.is_processing());

        assert!(!wrapper.flush_parameters_off_audio_thread());

        assert_eq!(FLUSH_CALLS.load(Ordering::Relaxed), 0);
    }

    /// The flag is taken whatever happens next, or a request answered by the
    /// audio path would flush again the moment the plugin stopped.
    #[test]
    fn a_flush_request_is_spent_by_the_visit_that_read_it() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        stage_emitted_events(Vec::new());
        FLUSH_CALLS.store(0, Ordering::Relaxed);
        let mut wrapper = stub_wrapper(emitting_plugin_ptr());
        wrapper.params_ext = &raw const EMITTING_PARAMS;
        wrapper.processing.request_stop();
        wrapper.host_state.request_parameters_flush();

        assert!(wrapper.flush_parameters_off_audio_thread());
        assert!(
            !wrapper.flush_parameters_off_audio_thread(),
            "a second visit with nothing pending must not call the plugin again"
        );

        assert_eq!(FLUSH_CALLS.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn a_visit_with_no_flush_request_pending_does_not_call_the_plugin() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        stage_emitted_events(Vec::new());
        FLUSH_CALLS.store(0, Ordering::Relaxed);
        let mut wrapper = stub_wrapper(emitting_plugin_ptr());
        wrapper.params_ext = &raw const EMITTING_PARAMS;
        wrapper.processing.request_stop();

        assert!(!wrapper.flush_parameters_off_audio_thread());
        assert_eq!(FLUSH_CALLS.load(Ordering::Relaxed), 0);
    }

    /// A host write is not a plugin edit. Wrapper-generated plugins echo the
    /// applied value straight back as an output event, and captured it would
    /// reach the renderer as an edit the user made — marking the project dirty
    /// on every automation point played back. Capturing that echo here is
    /// exactly the bug `queue_host_parameter_write` avoids on the VST3 half.
    #[test]
    fn the_value_a_host_write_echoes_back_is_not_reported_as_a_plugin_edit() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        stage_emitted_events(vec![
            // The plugin repeating what it was just told.
            PluginParameterEvent::value(8, 0.44),
            // A different control the write moved with it: a real change, and
            // the whole reason this flush captures at all.
            PluginParameterEvent::value(9, 0.10),
        ]);
        let mut wrapper = stub_wrapper(emitting_plugin_ptr());
        wrapper.params_ext = &raw const EMITTING_PARAMS;

        AudioPlugin::set_parameter(&mut wrapper, 8, 0.44);

        assert_eq!(
            captured_events(&wrapper),
            vec![PluginParameterEvent::value(9, 0.10)],
            "the written parameter's echo is dropped and every dependent change still passes"
        );
    }

    /// Only a value can be an echo. A plugin that opens a gesture while
    /// answering a host write is reporting that a user took hold of the control,
    /// and swallowing that would leave the boundary unpaired.
    #[test]
    fn a_gesture_on_the_written_parameter_still_reaches_the_host() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        stage_emitted_events(vec![
            PluginParameterEvent::gesture_begin(8),
            PluginParameterEvent::value(8, 0.44),
        ]);
        let mut wrapper = stub_wrapper(emitting_plugin_ptr());
        wrapper.params_ext = &raw const EMITTING_PARAMS;

        AudioPlugin::set_parameter(&mut wrapper, 8, 0.44);

        assert_eq!(
            captured_events(&wrapper),
            vec![PluginParameterEvent::gesture_begin(8)]
        );
    }

    /// The suppression is scoped to the one call that carries the write. A
    /// plugin's own later edit of that same parameter is an ordinary edit.
    #[test]
    fn the_written_parameter_is_only_suppressed_for_the_call_that_wrote_it() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        stage_emitted_events(vec![PluginParameterEvent::value(8, 0.44)]);
        let mut wrapper = stub_wrapper(emitting_plugin_ptr());
        wrapper.params_ext = &raw const EMITTING_PARAMS;

        AudioPlugin::set_parameter(&mut wrapper, 8, 0.44);
        assert!(captured_events(&wrapper).is_empty());

        stage_emitted_events(vec![PluginParameterEvent::value(8, 0.90)]);
        process_one_block(&mut wrapper);

        assert_eq!(
            captured_events(&wrapper),
            vec![PluginParameterEvent::value(8, 0.90)]
        );
    }

    /// The rescan ask has to survive from the plugin's callback to the control
    /// path through the seam the runtime owner actually calls.
    #[test]
    fn a_rescan_the_plugin_raised_is_read_back_through_the_seam() {
        let mut wrapper = stub_wrapper(stub_plugin_ptr());

        assert!(!AudioPlugin::take_parameters_rescan(&mut wrapper));
        wrapper.host_state.mark_parameters_rescan();

        assert!(AudioPlugin::take_parameters_rescan(&mut wrapper));
        assert!(!AudioPlugin::take_parameters_rescan(&mut wrapper));
    }

    // ── Process status ────────────────────────────────────────────────────
    //
    // CLAP's `process()` answers with a status, and `CLAP_PROCESS_ERROR` means
    // "the plugin failed to process, and the output buffers are in an undefined
    // state". A host that discards the answer plays those buffers.

    use crate::traits::{take_pending_process_refusal_signal, PROCESS_REFUSAL_HINT_TEST_LOCK};
    use clap_sys::process::{
        CLAP_PROCESS_CONTINUE, CLAP_PROCESS_CONTINUE_IF_NOT_QUIET, CLAP_PROCESS_SLEEP,
        CLAP_PROCESS_TAIL,
    };
    use std::sync::atomic::AtomicI32;

    /// What the failing stub leaves in the output buffers before answering. Not
    /// audio, and the value the bus carries if the host copies it out anyway.
    const UNDEFINED_SAMPLE: f32 = 0.75;
    /// What the engine's output buffer already holds when a block starts — the
    /// previous block, which a host that neither writes nor silences leaves
    /// sounding.
    const STALE_SAMPLE: f32 = -0.5;
    /// CLAP's primary category for a plugin that generates rather than
    /// processes, as it appears in `clap_plugin_descriptor.features`.
    const INSTRUMENT_FEATURE: &CStr = c"instrument";

    static STUB_PROCESS_STATUS: AtomicI32 = AtomicI32::new(CLAP_PROCESS_CONTINUE);
    static STATUS_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Writes into every declared output channel and *then* answers with the
    /// staged status — the exact shape CLAP's "undefined state" describes, and
    /// the one a stub that wrote nothing could not tell from a correct host.
    unsafe extern "C" fn stub_process_with_status(
        _plugin: *const clap_plugin,
        process: *const clap_process,
    ) -> clap_process_status {
        for buffer_index in 0..(*process).audio_outputs_count {
            let buffer = &mut *(*process).audio_outputs.add(buffer_index as usize);
            for channel in 0..buffer.channel_count {
                let channel_data = *(buffer.data32.add(channel as usize));
                let samples =
                    std::slice::from_raw_parts_mut(channel_data, (*process).frames_count as usize);
                samples.fill(UNDEFINED_SAMPLE);
            }
        }
        STUB_PROCESS_STATUS.load(Ordering::Relaxed)
    }

    fn status_plugin_ptr() -> *const clap_plugin {
        status_plugin_ptr_with_features(&[])
    }

    /// The same failing stub, behind a descriptor declaring `features`.
    ///
    /// Leaked deliberately: CLAP requires `clap_plugin.desc` to outlive the
    /// plugin, and the stub plugin itself is leaked for the same reason.
    fn status_plugin_ptr_with_features(features: &[&'static CStr]) -> *const clap_plugin {
        use clap_sys::plugin::clap_plugin_descriptor;

        let mut feature_pointers: Vec<*const std::os::raw::c_char> =
            features.iter().map(|feature| feature.as_ptr()).collect();
        feature_pointers.push(ptr::null());
        let feature_pointers: &'static [*const std::os::raw::c_char] = Vec::leak(feature_pointers);

        let mut descriptor: clap_plugin_descriptor = unsafe { mem::zeroed() };
        descriptor.features = feature_pointers.as_ptr();

        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.desc = Box::leak(Box::new(descriptor));
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        plugin.process = Some(stub_process_with_status);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    /// Render one block into an output bus that already holds the previous
    /// block, and answer what it carries afterwards.
    ///
    /// Pre-filled deliberately: a host that returns without writing leaves the
    /// stale block sounding, and an output buffer the test zeroed itself would
    /// read as silence either way.
    fn process_block_over_stale_output(
        wrapper: &mut ClapWrapper,
        left: f32,
        right: f32,
    ) -> (f32, f32) {
        let input_left = [left; 8];
        let input_right = [right; 8];
        let mut out_left = [STALE_SAMPLE; 8];
        let mut out_right = [STALE_SAMPLE; 8];
        let inputs: [&[f32]; 2] = [&input_left, &input_right];
        let mut outputs: [&mut [f32]; 2] = [&mut out_left, &mut out_right];
        wrapper.process(&inputs, &mut outputs, 8);
        (out_left[3], out_right[3])
    }

    fn stereo_layout() -> AudioBusLayout {
        AudioBusLayout::declared(&[2], &[2]).expect("stereo layout builds")
    }

    /// ADR 0021 DG-003: a failed slot that has a dry input passes it, and
    /// all-zero was rejected by name because a crashed EQ would mute the track.
    /// The three sentinels tell the three wrong answers apart: the plugin's
    /// undefined buffers, the previous block left standing, and silence.
    #[test]
    fn a_failed_effect_passes_its_dry_input_rather_than_the_undefined_output() {
        let _guard = STATUS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        STUB_PROCESS_STATUS.store(CLAP_PROCESS_ERROR, Ordering::Relaxed);
        let mut wrapper = stub_wrapper_over(stereo_layout(), status_plugin_ptr());

        let (left, right) = process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

        assert_eq!(
            (left, right),
            (0.25, 0.5),
            "a failed effect keeps its slot open with the dry signal: neither \
             its undefined buffers nor the previous block may reach the bus"
        );
        assert!(
            wrapper.process_refused,
            "the failure is recorded for the control path to report"
        );
    }

    /// The other half of DG-003: an instrument has no dry input to pass, and
    /// passing the engine's buffer would put whatever fed the slot on the bus.
    #[test]
    fn a_failed_instrument_falls_silent_because_it_has_no_dry_input() {
        let _guard = STATUS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        STUB_PROCESS_STATUS.store(CLAP_PROCESS_ERROR, Ordering::Relaxed);
        let layout = AudioBusLayout::declared(&[], &[2]).expect("an output-only layout builds");
        let mut wrapper = stub_wrapper_over(layout, status_plugin_ptr());

        let (left, right) = process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

        assert_eq!(
            (left, right),
            (0.0, 0.0),
            "a generator with no input bus has no dry signal, so its failed \
             slot is silent rather than passing what was fed to it"
        );
        assert!(wrapper.process_refused);
    }

    /// DG-003 groups instruments with the effects that have no valid dry input,
    /// and an instrument is what the plugin says it is rather than what its port
    /// list implies. A synth that takes routed audio into its oscillators — the
    /// Surge XT shape — declares an input port and still has no dry signal its
    /// failed slot could honestly pass, so passing that routed signal out of a
    /// synth slot at unity is the wrong answer twice over.
    #[test]
    fn a_failed_instrument_that_declares_an_input_port_still_falls_silent() {
        let _guard = STATUS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        STUB_PROCESS_STATUS.store(CLAP_PROCESS_ERROR, Ordering::Relaxed);
        let plugin = status_plugin_ptr_with_features(&[INSTRUMENT_FEATURE]);
        let mut wrapper = stub_wrapper_over(stereo_layout(), plugin);

        let (left, right) = process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

        assert_eq!(
            (left, right),
            (0.0, 0.0),
            "a failed instrument is silent whatever it declared for input: not \
             its undefined buffers, not the previous block, and not the signal \
             that was routed into it"
        );
        assert!(wrapper.process_refused);
    }

    #[test]
    fn every_other_status_is_a_success_whose_output_reaches_the_bus() {
        let _guard = STATUS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for status in [
            CLAP_PROCESS_CONTINUE,
            CLAP_PROCESS_CONTINUE_IF_NOT_QUIET,
            CLAP_PROCESS_TAIL,
            CLAP_PROCESS_SLEEP,
        ] {
            STUB_PROCESS_STATUS.store(status, Ordering::Relaxed);
            let mut wrapper = stub_wrapper_over(stereo_layout(), status_plugin_ptr());

            let (left, right) = process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

            assert_eq!(
                (left, right),
                (UNDEFINED_SAMPLE, UNDEFINED_SAMPLE),
                "status {status} is a success and its audio must play"
            );
            assert!(
                !wrapper.process_refused,
                "status {status} is not a failure and must not be recorded as one"
            );
        }
    }

    /// The portless path calls `process` for the output events a note effect
    /// owes the host, so it has a status to read as well.
    #[test]
    fn a_portless_plugin_that_fails_records_it_and_still_passes_the_block() {
        let _guard = STATUS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        STUB_PROCESS_STATUS.store(CLAP_PROCESS_ERROR, Ordering::Relaxed);
        let mut wrapper = stub_wrapper_over(AudioBusLayout::portless(), status_plugin_ptr());

        let (left, right) = process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

        assert_eq!(
            (left, right),
            (0.25, 0.5),
            "a plugin with no audio ports produced no audio to invalidate, so \
             its slot still passes the block"
        );
        assert!(
            wrapper.process_refused,
            "the portless path reads the status too"
        );
    }

    /// The audio thread may not print, so it latches the failure and raises the
    /// process-wide hint the control path wakes on. Raised on the first failing
    /// block and not again: the store is news, and a plugin failing every block
    /// has no further news to deliver at block rate.
    ///
    /// Reporting itself is driven by the recurring visit that reads this hint —
    /// covered where that visit lives, in `sourdaw-native`.
    #[test]
    fn a_failed_block_latches_and_wakes_the_control_path_once() {
        let _guard = STATUS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // Both backends raise the one process-wide hint, so the VST3 test that
        // reads it is held off while this one owns it.
        let _hint_guard = PROCESS_REFUSAL_HINT_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        STUB_PROCESS_STATUS.store(CLAP_PROCESS_ERROR, Ordering::Relaxed);
        take_pending_process_refusal_signal();
        let mut wrapper = stub_wrapper_over(stereo_layout(), status_plugin_ptr());

        process_block_over_stale_output(&mut wrapper, 0.25, 0.5);
        assert!(
            !wrapper.process_refusal_reported,
            "the audio thread records the failure and reports nothing itself"
        );
        assert!(
            take_pending_process_refusal_signal(),
            "the first failing block wakes the control path"
        );

        process_block_over_stale_output(&mut wrapper, 0.25, 0.5);
        assert!(
            !take_pending_process_refusal_signal(),
            "a plugin already latched must not store to the hint on every block"
        );
    }

    // ── steady_time ──────────────────────────────────────────────────────
    //
    // CLAP: "a steady sample time counter … it must be monotonically increasing
    // and coherent with the block sizes". `-1` means the host has none, which
    // stops a plugin from placing anything on that clock.

    static CAPTURED_STEADY_TIMES: std::sync::Mutex<Vec<i64>> = std::sync::Mutex::new(Vec::new());
    static STEADY_TIME_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    unsafe extern "C" fn stub_process_recording_steady_time(
        _plugin: *const clap_plugin,
        process: *const clap_process,
    ) -> clap_process_status {
        CAPTURED_STEADY_TIMES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push((*process).steady_time);
        CLAP_PROCESS_CONTINUE
    }

    fn steady_time_plugin_ptr() -> *const clap_plugin {
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        plugin.process = Some(stub_process_recording_steady_time);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    fn take_captured_steady_times() -> Vec<i64> {
        std::mem::take(
            &mut *CAPTURED_STEADY_TIMES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        )
    }

    #[test]
    fn steady_time_advances_by_each_block_on_both_process_paths() {
        let _guard = STEADY_TIME_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        for (path, layout) in [
            ("portless", AudioBusLayout::portless()),
            ("ported", stereo_layout()),
        ] {
            take_captured_steady_times();
            let mut wrapper = stub_wrapper_over(layout, steady_time_plugin_ptr());

            process_one_block(&mut wrapper);
            process_one_block(&mut wrapper);
            process_one_block(&mut wrapper);

            assert_eq!(
                take_captured_steady_times(),
                vec![0, 8, 16],
                "the {path} path starts the activation's clock at zero and \
                 charges it the frames of each block it hands over"
            );
        }
    }

    /// The counter describes one activation. A plugin taken through a
    /// deactivate/reactivate cycle is entitled to a clock that starts again,
    /// and one carried across would place its first block eight frames in.
    #[test]
    fn steady_time_restarts_at_zero_after_a_reactivation() {
        let _guard = STEADY_TIME_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        take_captured_steady_times();
        let mut wrapper = stub_wrapper_over(stereo_layout(), steady_time_plugin_ptr());

        process_one_block(&mut wrapper);
        process_one_block(&mut wrapper);
        wrapper
            .reactivate_for_latency()
            .expect("the stub reactivates");
        process_one_block(&mut wrapper);

        assert_eq!(take_captured_steady_times(), vec![0, 8, 0]);
    }

    // ── Tail ─────────────────────────────────────────────────────────────

    static STUB_TAIL: AtomicU32 = AtomicU32::new(0);
    static TAIL_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    unsafe extern "C" fn stub_tail_get(_plugin: *const clap_plugin) -> u32 {
        STUB_TAIL.load(Ordering::Relaxed)
    }

    static STUB_TAIL_EXT: clap_plugin_tail = clap_plugin_tail {
        get: Some(stub_tail_get),
    };

    unsafe extern "C" fn stub_get_extension_with_tail(
        plugin: *const clap_plugin,
        id: *const i8,
    ) -> *const c_void {
        if CStr::from_ptr(id) == CLAP_EXT_TAIL {
            return &STUB_TAIL_EXT as *const clap_plugin_tail as *const c_void;
        }
        stub_get_extension(plugin, id)
    }

    fn tail_plugin_ptr() -> *const clap_plugin {
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension_with_tail);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    #[test]
    fn a_declared_tail_is_what_the_runtime_seam_reports() {
        let _guard = TAIL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        STUB_TAIL.store(4_800, Ordering::Relaxed);
        let wrapper = stub_wrapper(tail_plugin_ptr());

        assert_eq!(HostedPluginRuntime::tail_samples(&wrapper), 4_800);
    }

    /// CLAP's own answer for a plugin that does not implement `clap.tail`: no
    /// tail. Not an infinite one, which is what the top of the range means.
    #[test]
    fn a_plugin_without_the_tail_extension_reports_no_tail() {
        let wrapper = stub_wrapper(stub_plugin_ptr());

        assert_eq!(wrapper.tail_samples(), 0);
    }

    #[test]
    fn a_flagged_tail_change_answers_the_value_the_plugin_reports_now() {
        let _guard = TAIL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        STUB_TAIL.store(1_000, Ordering::Relaxed);
        let mut wrapper = stub_wrapper(tail_plugin_ptr());

        assert_eq!(
            wrapper.take_tail_change(),
            None,
            "nothing was flagged, so nothing is pending"
        );

        // What `clap_host_tail.changed` does from the plugin's audio thread.
        wrapper.host_state.mark_tail_dirty();
        STUB_TAIL.store(96_000, Ordering::Relaxed);

        assert_eq!(
            HostedPluginRuntime::take_tail_change(&mut wrapper),
            Some(96_000),
            "the flag is answered by re-reading the plugin, not by a cached value"
        );
        assert_eq!(
            wrapper.take_tail_change(),
            None,
            "one flagged change is answered once"
        );
    }
}

impl Drop for ClapWrapper {
    fn drop(&mut self) {
        // First, so the observer sees what the dropping thread holds before any
        // of the teardown below has run.
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(observe) = self
            .command_fixture
            .as_ref()
            .and_then(|fixture| fixture.teardown_observer.as_ref())
        {
            observe();
        }

        // Close GUI if it's still open
        if self.gui_open {
            self.close_gui();
        }

        // Last resort: a dropped instance is already out of the graph, so no
        // block is coming to perform the stop that `deactivate` requires. If the
        // audio thread already stopped it — the normal case once the runtime
        // owner requests the stop first — this does nothing and counts nothing.
        self.force_stop_processing_off_audio_thread();

        if !self.plugin.is_null() {
            unsafe {
                let plugin_ref = &*self.plugin;

                if self.activated {
                    if let Some(deactivate) = plugin_ref.deactivate {
                        deactivate(self.plugin);
                    }
                }

                if let Some(destroy) = plugin_ref.destroy {
                    destroy(self.plugin);
                }
            }
            eprintln!("[CLAP] Unloaded plugin: {}", self.name);
        }

        // The CLAP spec pairs `clap_entry.init`/`deinit` per entry, and places
        // `deinit` after every plugin instance is destroyed. A bundle may
        // register global resources in `init` and release them only in
        // `deinit`, so a dropped wrapper that skips this leaks them per
        // load/unload cycle — and one whose library unloads while still
        // registered faults when the registration is next touched. This Drop
        // body runs before any field drops, so `_library` still has the DSO
        // mapped and `deinit`'s code is callable. Null for fixture wrappers.
        if !self.entry.is_null() {
            unsafe { deinit_entry(self.entry) };
        }
    }
}
