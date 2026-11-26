//! Real CLAP plugin wrapper — loads .clap shared libraries and hosts them.
//!
//! Flow: dlopen → clap_entry.init() → factory.create_plugin(host, id) → plugin.activate() → plugin.process()
//!
//! RT-safety: `process_audio_internal` and `process_with_midi` are called on the audio thread,
//! or on an offline instance's render thread — CLAP's `[audio-thread]` either way.
//! All scratch buffers are preallocated in `new` — no heap allocation occurs
//! on the RT path.

/// Maximum audio buffer size this host supports (must match the max_frames_count passed to activate).
///
/// Lockstep restatement of `daw_engine::audio_thread::MAX_CALLBACK_FRAMES`:
/// no crate edge exists from this crate to the engine, so the value is
/// restated here per the lockstep rule, and `sourdaw-native`'s
/// `host/native_bridge.rs` welds the pair with a compile-time equality assert.
/// A figure below the engine's callback ceiling would not fail loudly: both
/// process paths — `process_audio_internal` here and the VST3 wrapper —
/// clamp `num_samples` to `MAX_BUFFER`, so a larger callback would be
/// silently truncated to this many frames per block.
pub const MAX_BUFFER: usize = 4096;

/// The fewest frames this host promises a `process` call will carry, stated
/// to `activate` as `min_frames_count`.
///
/// One, the floor CLAP bounds the range by, because it is the only promise the
/// engine keeps: a callback is split at a loop seam into spans as short as the
/// distance to the loop end, and a device may run at any period. Promising more
/// lets a plugin size scratch or assert from a bound the host then breaks.
pub const MIN_PROCESS_FRAMES: u32 = 1;
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
#[cfg(unix)]
use crate::editor_run_loop::{register_editor_run_loop, EditorRunLoopRegistration};
use crate::parameter_events::{
    PluginParameterEvent, PluginParameterEventKind, PluginParameterEventQueue,
};
use crate::params::PluginParameter;
use crate::scanner::{
    category_from_clap_features, clap_library_path, owned_feature_list, ScanError,
};
use crate::traits::{
    signal_pending_process_refusal, AudioPlugin, EditorClosed, EditorVisibility, EditorWindowAsks,
    EditorWindowResizer, HostMidiEvent, HostParameterUpdate, HostTransport, HostedPluginRuntime,
    PluginError, PluginHostRequestNotifier, ProcessMode, ProcessingGate, SharedEditorWindow,
    MAX_MIDI_EVENTS_PER_BLOCK,
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
    clap_gui_resize_hints, clap_plugin_gui, clap_window, clap_window_handle, CLAP_EXT_GUI,
    CLAP_WINDOW_API_COCOA,
};
use clap_sys::ext::latency::{clap_plugin_latency, CLAP_EXT_LATENCY};
use clap_sys::ext::note_ports::{
    clap_note_port_info, clap_plugin_note_ports, CLAP_EXT_NOTE_PORTS, CLAP_NOTE_DIALECT_CLAP,
};
use clap_sys::ext::params::{
    clap_param_info, clap_plugin_params, CLAP_EXT_PARAMS, CLAP_PARAM_IS_AUTOMATABLE,
    CLAP_PARAM_IS_ENUM, CLAP_PARAM_IS_HIDDEN, CLAP_PARAM_IS_READONLY, CLAP_PARAM_IS_STEPPED,
};
use clap_sys::ext::render::{clap_plugin_render, CLAP_EXT_RENDER, CLAP_RENDER_OFFLINE};
use clap_sys::ext::state::{clap_plugin_state, CLAP_EXT_STATE};
use clap_sys::ext::tail::{clap_plugin_tail, CLAP_EXT_TAIL};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::fixedpoint::{CLAP_BEATTIME_FACTOR, CLAP_SECTIME_FACTOR};
use clap_sys::host::clap_host;
use clap_sys::plugin::clap_plugin;
use clap_sys::process::{clap_process, clap_process_status, CLAP_PROCESS_ERROR, CLAP_PROCESS_TAIL};
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
    /// Host descriptor — the plugin holds a pointer to it, so it must outlive
    /// the plugin. Never read after construction; held for its lifetime.
    _host: Box<clap_host>,
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
    /// The window this plugin's editor is drawn into, for answering what the
    /// plugin asks of it. Installed and released with the resizer.
    editor_window: Option<SharedEditorWindow>,
    /// This instance's place in the shared editor pump, which services the
    /// timers and descriptors it registered through `clap.timer-support` and
    /// `clap.posix-fd-support`. Taken only once construction has succeeded, so a
    /// failed load leaves nothing behind in the pump, and given up first in
    /// `Drop`, so no pass can call into the instance while it is torn down.
    /// The shell pumps only on Linux, and only while an editor is open.
    #[cfg(unix)]
    run_loop_registration: Option<EditorRunLoopRegistration>,
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
    /// Whether the plugin's most recent *successful* process call returned
    /// `CLAP_PROCESS_TAIL` — the plugin's own word that the host should now
    /// "rely upon the plugin's tail to determine if the plugin should continue
    /// to process". Written by the audio thread from the status each block
    /// answers with; read by [`Self::is_tail_active`] from the control path,
    /// the same split the process-failure latch uses.
    tail_mode_reported: bool,
    /// Whether the plugin has returned `CLAP_PROCESS_ERROR`. Raised by the audio
    /// thread, which may not allocate or take the I/O lock, and read by the
    /// control path, which is the only thread that may report it.
    process_refused: bool,
    /// Whether a block passed through untouched because the plugin was not in
    /// the processing state while the host wanted it there — its start was
    /// refused. A requested stop is not this. Raised by the audio thread, read
    /// by the control path, like the process-failure latch above. The block is
    /// still passed through: only a caller that needs every block processed
    /// (an offline print) refuses on it.
    processing_start_refused: bool,
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
    /// The block's input list in time order, as indexes into the two scratch
    /// lists above (see [`merge_event_order`]). Preallocated at both lists'
    /// capacities together; cleared and refilled each block, never reallocated.
    event_order_scratch: Vec<u32>,
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
    /// Run at the top of `set_parameter`, `get_parameters`, `get_state`,
    /// `set_state`, `open_gui` and `close_gui`, standing in for the vendor code
    /// each of them reaches.
    ///
    /// Third-party code of unbounded duration again, so a host's lock
    /// discipline around these calls is a contract: an observer that blocks is
    /// how a test holds a call inside the plugin and reads what that holds up.
    vendor_call_observer: Option<Box<dyn Fn() + Send + Sync>>,
}

#[cfg(feature = "engine-owned-command-fixture")]
fn observe_vendor_call(fixture: &EngineOwnedCommandFixture) {
    if let Some(observe) = fixture.vendor_call_observer.as_ref() {
        observe();
    }
}

#[cfg(feature = "engine-owned-command-fixture")]
fn record_gui_lifecycle_thread(fixture: &EngineOwnedCommandFixture) {
    fixture
        .gui_lifecycle_threads
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .push(std::thread::current().id());
}

// SAFETY: the only non-`Send` fields are raw pointers: into this struct's own
// boxed scratch and host descriptor (heap addresses that move with it), and to
// the entry, instance and extension structs the plugin owns, which are not tied
// to the creating thread. CLAP binds each *call* to a thread, not the objects;
// this type does not enforce that — the embedding host does, by constructing and
// dropping on its UI thread and reaching the wrapper only through its exclusive
// access seam (`SharedHostedPlugin` in `sourdaw-native`).
unsafe impl Send for ClapWrapper {}
// SAFETY: `&self` methods call into the plugin (`get_parameters`, `get_state`,
// `latency_samples`, `tail_samples`, `get_gui_size`, `editor_can_resize`), so
// shared access from two threads at once is not sound from this type alone. It
// holds because the embedding host's access seam serialises every reference,
// shared or exclusive, to one holder at a time.
unsafe impl Sync for ClapWrapper {}

// ── Declared audio bus layout ───────────────────────────────────────────

/// One direction's scratch audio, the channel pointers into it, and the buffer
/// descriptors the plugin is handed.
type PortBuffers = (Box<[f32]>, Vec<*mut f32>, Vec<clap_audio_buffer>);

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
    ///
    /// Held for the arrays' lifetime and never read as a value — the buffer
    /// tables below point into what these fields keep alive — for the same
    /// reason `Vst3Module` holds its platform module and host context.
    #[allow(dead_code)]
    input_channel_ptrs: Vec<*mut f32>,
    #[allow(dead_code)]
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
    fn declared(input_ports: &[u32], output_ports: &[u32]) -> Result<Self, ClapError> {
        let build = |ports: &[u32], direction: PortDirection| -> Result<PortBuffers, ClapError> {
            let total_channels: u32 = ports.iter().copied().try_fold(0u32, |sum, channels| {
                sum.checked_add(channels)
                    .filter(|_| channels > 0)
                    .ok_or(ClapError::PortChannelCountUnusable { direction })
            })?;
            if total_channels > MAX_RUNTIME_AUDIO_CHANNELS {
                return Err(ClapError::AudioChannelCountExceedsBounds { direction });
            }
            let mut scratch = vec![0.0f32; total_channels as usize * MAX_BUFFER].into_boxed_slice();
            let mut pointers = Vec::with_capacity(total_channels as usize);
            for channel in 0..total_channels as usize {
                // SAFETY: `scratch` holds `total_channels * MAX_BUFFER` samples and
                // `channel < total_channels`, so the offset stays inside the allocation.
                pointers.push(unsafe { scratch.as_mut_ptr().add(channel * MAX_BUFFER) });
            }
            let buffers = ports
                .iter()
                .scan(0usize, |offset, channels| {
                    let port = clap_audio_buffer {
                        // `clap_audio_buffer.data32` is `*mut *mut f32` for both
                        // directions; the input buffers are read-only by
                        // contract, and the cast states the struct's shape.
                        // SAFETY: `offset` is the sum of the earlier ports' channel
                        // counts, each > 0, so it is below `pointers.len()` (the total).
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

        let (input_scratch, input_channel_ptrs, input_buffers) =
            build(input_ports, PortDirection::Input)?;
        let (output_scratch, output_channel_ptrs, output_buffers) =
            build(output_ports, PortDirection::Output)?;
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

/// Build the output list for a call that hands the plugin no parameter values,
/// so that every event it emits is its own.
///
/// The list is a two-field struct built on the caller's stack, and its `ctx` is
/// the queue's address — an `Arc` allocation made at load, whose address never
/// moves. Nothing here allocates.
///
/// # Safety
/// The returned list borrows `queue`, and the plugin may only write through it
/// during the `flush` call it is handed to. The caller passes it by reference
/// into one call and drops it there.
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
    // SAFETY: `list` is non-null (checked above) and is the list
    // `capture_output_events` built, which the plugin may only use during the call.
    let queue = unsafe { (*list).ctx } as *const PluginParameterEventQueue;
    if queue.is_null() {
        return true;
    }

    // SAFETY: `ctx` is the address of the load-time `Arc` queue that
    // `capture_output_events` borrowed for this call, so it is live.
    let queue = unsafe { &*queue };
    // SAFETY: `event` is non-null (checked above) and CLAP requires it to point at a
    // live event header for the duration of `try_push`.
    let event = unsafe { &*event };
    // SAFETY: CLAP's output-list contract is that `event` heads an allocation of
    // `event.size` bytes, which is `capture_header`'s precondition.
    unsafe { capture_header(queue, event, &[]) }
}

/// The parameter values one `process` block hands the plugin, by raw parts.
///
/// Raw because the values live in the wrapper's own `parameter_scratch`, which
/// `process_audio_internal`'s `&mut self` forbids borrowing alongside it —
/// the same reason the input list's `EventListCtx` holds raw pointers.
#[derive(Clone, Copy)]
struct BlockHostWrites {
    events: *const clap_event_param_value,
    count: usize,
}

impl BlockHostWrites {
    /// A block that carries no host writes.
    const NONE: Self = Self {
        events: ptr::null(),
        count: 0,
    };

    /// # Safety
    /// Unless `count` is zero, `events` must point at `count` initialised
    /// values that stay unmodified for `'a`.
    unsafe fn as_slice<'a>(self) -> &'a [clap_event_param_value] {
        if self.count == 0 {
            return &[];
        }
        // SAFETY: non-empty, so this function's own contract holds for the parts.
        unsafe { std::slice::from_raw_parts(self.events, self.count) }
    }
}

/// The context a call that may carry host writes hands its capture list.
///
/// Lives on the caller's stack for the duration of one `flush` or `process`
/// call, like the input events it accompanies. Nothing here is allocated.
struct HostWriteCapture<'a> {
    queue: &'a PluginParameterEventQueue,
    /// The parameter values the host handed the plugin on this call: the one
    /// `set_parameter` writes, or a block's automation, or none. A
    /// `CLAP_EVENT_PARAM_VALUE` the plugin emits for one of these ids during
    /// this same call is the plugin repeating back what it was told, not an
    /// edit the user made.
    written: &'a [clap_event_param_value],
}

/// Build the output list for a call that may hand the plugin **host-written**
/// parameter values — `set_parameter`'s `flush`, and every `process` block.
///
/// A plugin is free to echo an applied value straight back as an output event —
/// wrapper-generated plugins routinely do — and the ordinary capture list cannot
/// tell that echo from a user turning the same knob in the plugin's editor. Fed
/// to the renderer it would mark the project dirty on every automation point
/// played back, which is the same echo the VST3 half avoids by writing host
/// values through a queue the observers never see.
///
/// So each written parameter's value is dropped for the length of that one
/// call. Every other parameter still passes: a plugin whose macro moves three
/// dependent controls is reporting three real changes, and those are the events
/// this capture exists for. The suppression never outlives the call, because a
/// user edit of the same control on the next block is a real one.
///
/// # Accepted bound
/// A plugin that clamps, quantises or otherwise *corrects* a value it was
/// handed — by `set_parameter` or by a block's automation — reports that
/// correction on this same call, and it is dropped with the echo. The host's
/// recorded value is then the one it wrote until the plugin's next edit or a
/// parameter rescan re-reads the contract. Distinguishing a correction from an
/// echo needs a comparison the CLAP event carries no basis for — the plugin
/// reports the value, never whether it changed it.
fn capture_host_write_events(capture: &mut HostWriteCapture) -> clap_output_events {
    clap_output_events {
        ctx: capture as *mut HostWriteCapture as *mut c_void,
        try_push: Some(host_write_try_push),
    }
}

/// Take one event the plugin produced during a call that may carry host writes.
///
/// Same real-time contract as [`output_events_try_push`]: it runs on the audio
/// thread inside `process`, and on whatever thread called `set_parameter`.
unsafe extern "C" fn host_write_try_push(
    list: *const clap_output_events,
    event: *const clap_event_header,
) -> bool {
    if list.is_null() || event.is_null() {
        return false;
    }
    // SAFETY: `list` is non-null (checked above) and is the list
    // `capture_host_write_events` built for the current `flush` or `process` call.
    let capture = unsafe { (*list).ctx } as *const HostWriteCapture;
    if capture.is_null() {
        return true;
    }

    // SAFETY: `ctx` is the caller's stack `HostWriteCapture`, which outlives the
    // single `flush` or `process` call the list was handed to.
    let capture = unsafe { &*capture };
    // SAFETY: `event` is non-null (checked above) and CLAP requires it to point at a
    // live event header for the duration of `try_push`.
    let event = unsafe { &*event };
    // SAFETY: CLAP's output-list contract is that `event` heads an allocation of
    // `event.size` bytes, which is `capture_header`'s precondition.
    unsafe { capture_header(capture.queue, event, capture.written) }
}

/// Decode one header and store it, unless it echoes one of the `written` values.
///
/// Shared by both capture lists so the two can never decode differently: the
/// only thing that separates them is which parameters, if any, are suppressed.
///
/// # Safety
/// `header` must point at a live `clap_event_header` whose `size` describes the
/// allocation it heads.
unsafe fn capture_header(
    queue: &PluginParameterEventQueue,
    header: &clap_event_header,
    written: &[clap_event_param_value],
) -> bool {
    if header.space_id != CLAP_CORE_EVENT_SPACE_ID {
        return true;
    }

    // SAFETY: this function's own `# Safety` contract is `read_output_event`'s.
    let Some(captured) = (unsafe { read_output_event(header) }) else {
        return true;
    };

    // Absorbed rather than refused: the plugin did nothing wrong, and telling it
    // the push failed would have it re-send an event the host will drop again.
    if is_echo_of_host_write(&captured, written) {
        return true;
    }

    queue.push(captured)
}

/// Whether this event is the plugin repeating a value the host just wrote.
///
/// Only a value event can be an echo. A gesture boundary is the plugin
/// reporting that a user took hold of the control, which a host write never
/// produces and which must reach the host even for the written parameter.
///
/// A linear scan on the audio thread: `written` is at most
/// `MAX_PARAMETER_EVENTS` long, and nothing here allocates.
fn is_echo_of_host_write(event: &PluginParameterEvent, written: &[clap_event_param_value]) -> bool {
    matches!(event.kind, PluginParameterEventKind::Value)
        && written.iter().any(|value| value.param_id == event.param_id)
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
            // SAFETY: the header's type is PARAM_VALUE and its declared size covers a
            // `clap_event_param_value` (checked above), which begins with this header.
            let event =
                unsafe { &*(header as *const clap_event_header as *const clap_event_param_value) };
            Some(PluginParameterEvent::value(event.param_id, event.value))
        }
        CLAP_EVENT_PARAM_GESTURE_BEGIN | CLAP_EVENT_PARAM_GESTURE_END => {
            if (header.size as usize) < mem::size_of::<clap_event_param_gesture>() {
                return None;
            }
            // SAFETY: the header's type is a gesture event and its declared size covers
            // a `clap_event_param_gesture` (checked above), which begins with this header.
            let event = unsafe {
                &*(header as *const clap_event_header as *const clap_event_param_gesture)
            };
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
    // SAFETY: the plugin calls `get` only on the list `set_parameter` handed to
    // `flush`, a live stack `clap_input_events` for the duration of that call.
    let ctx = unsafe { (*list).ctx } as *const SingleEventCtx;
    // SAFETY: that list's `ctx` is `set_parameter`'s stack `SingleEventCtx`, which
    // outlives the `flush` call.
    unsafe { &(*ctx).event.header as *const clap_event_header }
}

// ── Stream helpers for state save/load ──────────────────────────────────

unsafe extern "C" fn ostream_write(
    stream: *const clap_ostream,
    buffer: *const c_void,
    size: u64,
) -> i64 {
    // `from_raw_parts` needs a non-null pointer even for an empty slice.
    if size == 0 {
        return 0;
    }
    if buffer.is_null() {
        return -1;
    }
    // SAFETY: the plugin calls `write` only on the stream `get_state` handed to
    // `save`, a live stack `clap_ostream` for the duration of that call.
    let ctx = unsafe { (*stream).ctx } as *mut Vec<u8>;
    // SAFETY: that stream's `ctx` is `get_state`'s stack `buffer`, which outlives
    // `save` and is not otherwise touched while the plugin writes.
    let vec = unsafe { &mut *ctx };
    // SAFETY: CLAP's `write` contract hands `size` readable bytes at `buffer`.
    let slice = unsafe { std::slice::from_raw_parts(buffer as *const u8, size as usize) };
    vec.extend_from_slice(slice);
    size as i64
}

unsafe extern "C" fn istream_read(
    stream: *const clap_istream,
    buffer: *mut c_void,
    size: u64,
) -> i64 {
    // `copy_nonoverlapping` needs a non-null destination even for zero bytes.
    if size == 0 {
        return 0;
    }
    if buffer.is_null() {
        return -1;
    }
    // SAFETY: the plugin calls `read` only on the stream `set_state` handed to
    // `load`, a live stack `clap_istream` for the duration of that call.
    let ctx = unsafe { (*stream).ctx } as *mut StreamCursor;
    // SAFETY: that stream's `ctx` is `set_state`'s stack `cursor`, which outlives
    // `load` and is not otherwise touched while the plugin reads.
    let cursor = unsafe { &mut *ctx };
    let remaining = cursor.data.len() - cursor.pos;
    let to_read = (size as usize).min(remaining);
    if to_read == 0 {
        return 0;
    }
    let src = &cursor.data[cursor.pos..cursor.pos + to_read];
    // SAFETY: CLAP's `read` contract hands `size` writable bytes at `buffer`, and
    // `to_read <= size`; `src` is host memory, so the ranges cannot overlap.
    unsafe { ptr::copy_nonoverlapping(src.as_ptr(), buffer as *mut u8, to_read) };
    cursor.pos += to_read;
    to_read as i64
}

/// Which way a CLAP audio port carries signal, as a refusal names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PortDirection {
    Input,
    Output,
}

impl PortDirection {
    const fn label(self) -> &'static str {
        match self {
            Self::Input => "input",
            Self::Output => "output",
        }
    }
}

/// Why a CLAP plugin could not be loaded, saved, restored, re-activated, or
/// driven through its editor.
///
/// Every variant is built on the control path. The process path reports a
/// refusal through flags and never builds one of these.
#[derive(Debug)]
pub enum ClapError {
    /// The plugin path does not resolve to a loadable library.
    LibraryPath(ScanError),
    /// The dynamic loader refused the library.
    LibraryNotLoaded {
        plugin_path: String,
        cause: libloading::Error,
    },
    /// The library exports no `clap_entry`.
    NoEntrySymbol {
        plugin_path: String,
        cause: libloading::Error,
    },
    /// The library's `clap_entry` is null.
    NullEntry,
    /// The plugin path contains a NUL byte.
    InvalidPluginPath,
    /// `clap_entry.init` returned false.
    EntryInitFailed,
    /// The entry has no `get_factory`.
    NoFactoryLookup,
    /// The entry returned no plugin factory.
    NullFactory,
    /// The plugin id contains a NUL byte.
    InvalidPluginId,
    /// The factory has no `create_plugin`.
    NoCreatePlugin,
    /// The factory returned no instance for the id.
    InstanceNotCreated { plugin_id: String },
    /// `plugin.init` returned false.
    PluginInitFailed,
    /// The plugin requires real-time rendering and was asked to render offline.
    RequiresRealtime { name: String },
    /// `clap.render` refused offline rendering.
    OfflineRefused { name: String },
    /// `clap.audio-ports` has no `count`.
    AudioPortsNoCount { direction: PortDirection },
    /// `clap.audio-ports` reports more ports than the runtime carries.
    AudioPortCountExceedsBounds { direction: PortDirection },
    /// `clap.audio-ports` has no `get`.
    AudioPortsNoInfo { direction: PortDirection },
    /// `clap.audio-ports` returned false for a port it counted.
    AudioPortNoInfo {
        direction: PortDirection,
        index: u32,
    },
    /// A declared port carries zero channels, or the total overflows.
    PortChannelCountUnusable { direction: PortDirection },
    /// The declared ports carry more channels than the runtime carries.
    AudioChannelCountExceedsBounds { direction: PortDirection },
    /// `state.load` returned false.
    StateLoadFailed { name: String },
    /// `state.save` returned false.
    StateSaveRefused { name: String },
    /// The plugin has no editor.
    GuiUnsupported,
    /// The editor is already open.
    GuiAlreadyOpen,
    /// `gui.is_api_supported` refused this platform's embedded API.
    EmbeddedGuiUnsupported { name: String },
    /// `clap.gui` has no `create`.
    GuiNoCreate,
    /// `gui.create` returned false.
    GuiCreateFailed { name: String },
    /// `gui.set_parent` returned false.
    GuiSetParentFailed { name: String },
    /// The command fixture has no open editor to resize.
    FixtureNoEditorToResize,
    /// The command fixture has no open editor to re-scale.
    FixtureNoEditorToRescale,
    /// The open editor cannot be resized by the host.
    NoResizableEditor { name: String },
    /// No editor is open to resize.
    NoEditorToResize { name: String },
    /// `gui.adjust_size` refused the request.
    EditorSizeRefused { name: String },
    /// `gui.set_size` refused the adjusted size.
    AdjustedSizeRefused { name: String },
    /// The display scale is not finite and positive.
    InvalidContentScale { name: String, scale: f64 },
    /// No editor is open to re-scale.
    NoEditorToRescale { name: String },
    /// `gui.get_size` states no size at the new display scale.
    NoSizeAtScale { name: String },
    /// `plugin.activate` returned false after a latency change.
    LatencyReactivationFailed { name: String },
}

impl std::fmt::Display for ClapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::LibraryPath(error) => write!(f, "{error}"),
            Self::LibraryNotLoaded { plugin_path, cause } => {
                write!(f, "Failed to load CLAP plugin at {plugin_path}: {cause}")
            }
            Self::NoEntrySymbol { plugin_path, cause } => {
                write!(f, "No clap_entry symbol in {plugin_path}: {cause}")
            }
            Self::NullEntry => f.write_str("clap_entry symbol is null"),
            Self::InvalidPluginPath => f.write_str("Invalid plugin path"),
            Self::EntryInitFailed => f.write_str("clap_entry.init() returned false"),
            Self::NoFactoryLookup => f.write_str("clap_entry has no get_factory"),
            Self::NullFactory => f.write_str("Plugin factory is null"),
            Self::InvalidPluginId => f.write_str("Invalid plugin ID"),
            Self::NoCreatePlugin => f.write_str("Factory has no create_plugin function"),
            Self::InstanceNotCreated { plugin_id } => {
                write!(f, "Failed to create plugin instance: {plugin_id}")
            }
            Self::PluginInitFailed => f.write_str("plugin.init() returned false"),
            Self::RequiresRealtime { name } => write!(
                f,
                "[CLAP] '{name}' requires real-time rendering and cannot render offline"
            ),
            Self::OfflineRefused { name } => write!(f, "[CLAP] '{name}' refused to render offline"),
            Self::AudioPortsNoCount { direction } => write!(
                f,
                "CLAP {} audio-ports has no count callback",
                direction.label()
            ),
            Self::AudioPortCountExceedsBounds { direction } => write!(
                f,
                "CLAP {} audio port count exceeds runtime bounds",
                direction.label()
            ),
            Self::AudioPortsNoInfo { direction } => write!(
                f,
                "CLAP {} audio-ports has no info callback",
                direction.label()
            ),
            Self::AudioPortNoInfo { direction, index } => write!(
                f,
                "CLAP {} audio port {index} returned no port info",
                direction.label()
            ),
            Self::PortChannelCountUnusable { direction } => write!(
                f,
                "CLAP {} port declares an unusable channel count",
                direction.label()
            ),
            Self::AudioChannelCountExceedsBounds { direction } => write!(
                f,
                "CLAP {} audio channel count exceeds runtime bounds",
                direction.label()
            ),
            Self::StateLoadFailed { name } => write!(f, "[CLAP] state.load() failed for {name}"),
            Self::StateSaveRefused { name } => {
                write!(f, "[CLAP] '{name}' refused to save its state")
            }
            Self::GuiUnsupported => f.write_str("Plugin does not support GUI"),
            Self::GuiAlreadyOpen => f.write_str("GUI is already open"),
            Self::EmbeddedGuiUnsupported { name } => write!(
                f,
                "Plugin '{name}' does not support embedded GUI on this platform"
            ),
            Self::GuiNoCreate => f.write_str("Plugin GUI has no create function"),
            Self::GuiCreateFailed { name } => write!(f, "Plugin '{name}' gui.create() failed"),
            Self::GuiSetParentFailed { name } => {
                write!(f, "Plugin '{name}' gui.set_parent() failed")
            }
            Self::FixtureNoEditorToResize => f.write_str("Plugin has no open editor to resize"),
            Self::FixtureNoEditorToRescale => f.write_str("Plugin has no open editor to re-scale"),
            Self::NoResizableEditor { name } => {
                write!(f, "Plugin '{name}' has no resizable open editor")
            }
            Self::NoEditorToResize { name } => {
                write!(f, "Plugin '{name}' has no open editor to resize")
            }
            Self::EditorSizeRefused { name } => {
                write!(f, "Plugin '{name}' refused the requested editor size")
            }
            Self::AdjustedSizeRefused { name } => write!(
                f,
                "Plugin '{name}' refused to move to the adjusted editor size"
            ),
            Self::InvalidContentScale { name, scale } => write!(
                f,
                "Plugin '{name}' cannot be told a display scale of {scale}"
            ),
            Self::NoEditorToRescale { name } => {
                write!(f, "Plugin '{name}' has no open editor to re-scale")
            }
            Self::NoSizeAtScale { name } => write!(
                f,
                "Plugin '{name}' states no editor size at the new display scale"
            ),
            Self::LatencyReactivationFailed { name } => write!(
                f,
                "[CLAP] reactivation for latency change failed for {name}"
            ),
        }
    }
}

impl std::error::Error for ClapError {}

impl From<ScanError> for ClapError {
    fn from(error: ScanError) -> Self {
        Self::LibraryPath(error)
    }
}

struct StreamCursor {
    data: Vec<u8>,
    pos: usize,
}

fn state_load_result(plugin_name: &str, loaded: bool) -> Result<(), ClapError> {
    if loaded {
        return Ok(());
    }

    Err(ClapError::StateLoadFailed {
        name: plugin_name.to_string(),
    })
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

/// Room for one parameter's value text; a longer answer is the plugin's to
/// truncate, and one that fills it without terminating reads as no text.
const CLAP_PARAMETER_TEXT_CAPACITY: usize = 256;

/// The step count the seam reports for a CLAP parameter: 0 when continuous,
/// else the span of its range, at least 1 so a stepped parameter is never
/// read as continuous.
fn clap_step_count(info: &clap_param_info) -> u32 {
    if info.flags & CLAP_PARAM_IS_STEPPED == 0 {
        return 0;
    }
    ((info.max_value - info.min_value).round() as u32).max(1)
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
    pub fn new(plugin_path: &str, plugin_id: &str, sample_rate: f64) -> Result<Self, ClapError> {
        Self::new_with_mode(plugin_path, plugin_id, sample_rate, ProcessMode::Realtime)
    }

    /// [`ClapWrapper::new`], with the process mode the instance renders in.
    ///
    /// `Offline` asks the plugin, through `clap.render`, to render offline
    /// before it is activated, and refuses construction when it cannot. A
    /// plugin without `clap.render` does not distinguish the two modes and is
    /// loaded as it is. `Realtime` tells the plugin nothing: it is CLAP's
    /// default.
    pub fn new_with_mode(
        plugin_path: &str,
        plugin_id: &str,
        sample_rate: f64,
        mode: ProcessMode,
    ) -> Result<Self, ClapError> {
        let path = Path::new(plugin_path);
        let library_path = clap_library_path(path)?;
        // 1. Load the shared library
        // SAFETY: loading runs the bundle's initialisers, which is what hosting a
        // CLAP bundle means; this path is the user's chosen, already-resolved bundle,
        // loaded on the host's UI thread as the crate's lifecycle rule requires.
        let library = unsafe { Library::new(&library_path) }.map_err(|cause| {
            ClapError::LibraryNotLoaded {
                plugin_path: plugin_path.to_string(),
                cause,
            }
        })?;

        // 2. Get the clap_entry symbol
        // SAFETY: CLAP defines `clap_entry` as an exported `clap_plugin_entry`
        // struct, so the symbol's address read as `*const clap_plugin_entry` is
        // correctly typed; `library` outlives the `Symbol` borrow.
        let entry: libloading::Symbol<*const clap_plugin_entry> =
            unsafe { library.get(b"clap_entry\0") }.map_err(|cause| ClapError::NoEntrySymbol {
                plugin_path: plugin_path.to_string(),
                cause,
            })?;

        let entry_ptr = *entry;
        if entry_ptr.is_null() {
            return Err(ClapError::NullEntry);
        }

        // SAFETY: `entry_ptr` is non-null (checked above) and points into `library`,
        // which stays loaded for the whole of this function.
        let entry_ref = unsafe { &*entry_ptr };

        // 3. Call init. A false return leaves the entry not initialised, so
        //    the spec's init/deinit pairing never starts — same rule as the
        //    scan-time loader in `scanner.rs`.
        if let Some(init_fn) = entry_ref.init {
            let path_c = CString::new(plugin_path).map_err(|_| ClapError::InvalidPluginPath)?;
            // SAFETY: `init_fn` is the entry's own `init`, matched as `Some`; it gets
            // the NUL-terminated bundle path, which `path_c` keeps alive for the call.
            let ok = unsafe { init_fn(path_c.as_ptr()) };
            if !ok {
                return Err(ClapError::EntryInitFailed);
            }
        }

        // 4-9. `load_initialized_entry` owns the back half of the entry's
        // init/deinit pairing on every path out — including its own
        // failures, which is why the `?` below cannot leak an init.
        // SAFETY: the entry's `init` returned true above (or it declares none), and
        // `library` is attached to the returned wrapper below, so it stays loaded for
        // the wrapper's life; on failure it is dropped only after the deinit.
        let mut wrapper =
            unsafe { Self::load_initialized_entry(entry_ptr, plugin_id, sample_rate, mode) }?;

        // The entry and plugin pointers the wrapper holds are only sound
        // while this library stays loaded, so it is attached before the
        // wrapper escapes this function.
        wrapper._library = Some(library);
        Ok(wrapper)
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
        mode: ProcessMode,
    ) -> Result<Self, ClapError> {
        // SAFETY: this fn's own contract: `entry_ptr` is a live entry whose `init`
        // succeeded, which is `create_instance_from_entry`'s precondition.
        let loaded =
            unsafe { Self::create_instance_from_entry(entry_ptr, plugin_id, sample_rate, mode) };
        match loaded {
            Ok(wrapper) => Ok(wrapper),
            Err(error) => {
                // No wrapper exists to carry the deinit, so it runs here —
                // the capture-then-deinit shape the scan-time loader uses.
                // SAFETY: the entry is initialised (this fn's contract), still loaded,
                // and no instance survives the failed load, so `deinit` may run once.
                unsafe { deinit_entry(entry_ptr) };
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
        mode: ProcessMode,
    ) -> Result<Self, ClapError> {
        // 4. Get the plugin factory
        let factory_id = CLAP_PLUGIN_FACTORY_ID.as_ptr();
        // SAFETY: `entry_ptr` points to a live, initialised entry (this fn's contract).
        let factory_ptr = if let Some(get_factory) = unsafe { (*entry_ptr).get_factory } {
            // SAFETY: `get_factory` is the initialised entry's own callback, matched
            // as `Some`, given the static NUL-terminated `CLAP_PLUGIN_FACTORY_ID`.
            unsafe { get_factory(factory_id) }
        } else {
            return Err(ClapError::NoFactoryLookup);
        };

        if factory_ptr.is_null() {
            return Err(ClapError::NullFactory);
        }

        // SAFETY: non-null (checked above), and CLAP defines the object returned for
        // `CLAP_PLUGIN_FACTORY_ID` as a `clap_plugin_factory` living as long as the entry.
        let factory = unsafe { &*(factory_ptr as *const clap_plugin_factory) };

        // 5. Create host descriptor
        // Pin per-instance host callback state into the descriptor BEFORE the
        // plugin is created, so latency-change callbacks can reach this instance.
        let host_state = Box::new(HostCallbackState::default());
        let mut host = Box::new(create_host_descriptor());
        host.host_data = (&*host_state as *const HostCallbackState) as *mut c_void;
        let host_ptr: *const clap_host = &*host;

        // 6. Create the plugin instance
        let id_c = CString::new(plugin_id).map_err(|_| ClapError::InvalidPluginId)?;

        let create_plugin = factory.create_plugin.ok_or(ClapError::NoCreatePlugin)?;

        // SAFETY: `create_plugin` is the factory's own callback, matched as `Some`;
        // `host_ptr` points into the `host` box and `id_c` is NUL-terminated, both
        // alive for the call (and `host` for the instance's life, via the wrapper).
        let plugin = unsafe { create_plugin(factory, host_ptr, id_c.as_ptr()) };
        if plugin.is_null() {
            return Err(ClapError::InstanceNotCreated {
                plugin_id: plugin_id.to_string(),
            });
        }

        // 7. Init the plugin
        // SAFETY: non-null (checked above); the factory's instance stays live until
        // `destroy`, which nothing calls before this reference's last use.
        let plugin_ref = unsafe { &*plugin };
        if let Some(init_fn) = plugin_ref.init {
            // SAFETY: `init_fn` is the instance's own `init`, matched as `Some`, called
            // once on the freshly created instance as CLAP requires before any other call.
            let ok = unsafe { init_fn(plugin) };
            if !ok {
                // SAFETY: the live, never-activated instance created above, on the
                // loading (main) thread; this error path does not use it again.
                unsafe { destroy_abandoned_instance(plugin) };
                return Err(ClapError::PluginInitFailed);
            }
        }

        // Read the plugin name
        let name = if !plugin_ref.desc.is_null() {
            // SAFETY: non-null (checked above); CLAP keeps the descriptor valid for
            // the instance's life.
            let desc = unsafe { &*plugin_ref.desc };
            if !desc.name.is_null() {
                // SAFETY: non-null (checked above); CLAP requires descriptor strings
                // to be NUL-terminated and to live as long as the descriptor.
                unsafe { CStr::from_ptr(desc.name) }
                    .to_string_lossy()
                    .into_owned()
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
        // SAFETY: `plugin_ref` is the live instance initialised above, queried on the
        // loading (main) thread, and `T` is the struct CLAP defines for the id.
        let params_ext =
            unsafe { Self::query_extension::<clap_plugin_params>(plugin_ref, CLAP_EXT_PARAMS) };
        // SAFETY: as above — live initialised instance, main thread, matching `T`.
        let state_ext =
            unsafe { Self::query_extension::<clap_plugin_state>(plugin_ref, CLAP_EXT_STATE) };
        // SAFETY: as above — live initialised instance, main thread, matching `T`.
        let gui_ext = unsafe { Self::query_extension::<clap_plugin_gui>(plugin_ref, CLAP_EXT_GUI) };
        // SAFETY: as above — live initialised instance, main thread, matching `T`.
        let latency_ext =
            unsafe { Self::query_extension::<clap_plugin_latency>(plugin_ref, CLAP_EXT_LATENCY) };
        // SAFETY: as above — live initialised instance, main thread, matching `T`.
        let tail_ext =
            unsafe { Self::query_extension::<clap_plugin_tail>(plugin_ref, CLAP_EXT_TAIL) };
        // SAFETY: the instance is live, initialised and not yet activated (activation
        // is step 9 below), and this is the loading (main) thread.
        let audio = match unsafe { Self::read_audio_bus_layout(plugin_ref) } {
            Ok(audio) => audio,
            Err(error) => {
                // SAFETY: the live, initialised, never-activated instance created
                // above, on the loading (main) thread; this error path does not use
                // it again.
                unsafe { destroy_abandoned_instance(plugin) };
                return Err(error);
            }
        };
        // SAFETY: `plugin` is the live, initialised, non-null instance created above.
        let is_instrument = unsafe { descriptor_declares_instrument(plugin) };
        // SAFETY: `plugin_ref` is the live initialised instance, on the main thread.
        let accepts_note_events = unsafe { Self::reads_note_input_ports(plugin_ref) };

        if !params_ext.is_null() {
            eprintln!("[CLAP] Plugin '{}' supports CLAP_EXT_PARAMS", name);
        }
        if !state_ext.is_null() {
            eprintln!("[CLAP] Plugin '{}' supports CLAP_EXT_STATE", name);
        }
        if !gui_ext.is_null() {
            eprintln!("[CLAP] Plugin '{}' supports CLAP_EXT_GUI", name);
        }

        // `clap.render` is `[main-thread]` and its mode is set before
        // activation. A refusal tears the instance down as an `init` failure
        // does: the plugin was initialised and never activated.
        // SAFETY: `plugin_ref` is the live instance created and initialised above,
        // not yet active (activation is step 9 below), on the loading (main) thread.
        let render_mode = unsafe { Self::enter_render_mode(plugin_ref, &name, mode) };
        if let Err(error) = render_mode {
            // SAFETY: the live, initialised, never-activated instance created above,
            // on the loading (main) thread; this error path does not use it again.
            unsafe { destroy_abandoned_instance(plugin) };
            return Err(error);
        }

        // 9. Activate the plugin. Activation is [main-thread]; entering the
        //    processing state is [audio-thread], so it stops here and the
        //    first block picks it up through the gate.
        // SAFETY: `plugin` is the live, initialised, still-deactivated instance created
        // above, activated here on the loading (main) thread.
        let activated = unsafe { activate_plugin(plugin, sample_rate) };
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

        // Last, so every failure exit above leaves nothing in the pump.
        // SAFETY: `plugin` is the live instance initialised above, on the loading
        // (main) thread, and the wrapper built below gives the registration up
        // before it destroys the instance.
        #[cfg(unix)]
        let run_loop_registration = Some(unsafe { join_editor_pump(&host_state, plugin) });

        Ok(Self {
            _library: None,
            entry: entry_ptr,
            plugin,
            _host: host,
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
            editor_window: None,
            #[cfg(unix)]
            run_loop_registration,
            processing,
            transport_scratch: Box::new(empty_transport_event()),
            has_transport: false,
            steady_time: 0,
            tail_mode_reported: false,
            process_refused: false,
            processing_start_refused: false,
            process_refusal_reported: false,
            audio,
            is_instrument,
            accepts_note_events,
            editor_content_scale: crate::traits::DEFAULT_EDITOR_CONTENT_SCALE,
            midi_scratch: Vec::with_capacity(MAX_MIDI_EVENTS_PER_BLOCK),
            parameter_scratch: Vec::with_capacity(MAX_PARAMETER_EVENTS),
            event_order_scratch: event_order_scratch(),
            parameter_events: Arc::new(PluginParameterEventQueue::default()),
            #[cfg(feature = "engine-owned-command-fixture")]
            command_fixture: None,
        })
    }

    /// The rate `daw_engine::engine_handle_for_command_capture` reports.
    ///
    /// A fixture handed to that engine has to match it, so the constructor's
    /// default matches: a test only calls
    /// `set_engine_owned_command_fixture_sample_rate` to create a deliberate
    /// mismatch.
    #[cfg(feature = "engine-owned-command-fixture")]
    const ENGINE_OWNED_COMMAND_FIXTURE_SAMPLE_RATE: f64 = 48_000.0;

    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn new_engine_owned_command_fixture(name: &str, state: Vec<u8>, has_gui: bool) -> Self {
        Self {
            _library: None,
            entry: ptr::null(),
            plugin: ptr::null(),
            _host: Box::new(create_host_descriptor()),
            activated: true,
            name: name.to_string(),
            sample_rate: Self::ENGINE_OWNED_COMMAND_FIXTURE_SAMPLE_RATE,
            params_ext: ptr::null(),
            state_ext: ptr::null(),
            gui_ext: ptr::null(),
            latency_ext: ptr::null(),
            tail_ext: ptr::null(),
            host_state: Box::new(HostCallbackState::default()),
            gui_open: false,
            editor_resizer: None,
            editor_window: None,
            #[cfg(unix)]
            run_loop_registration: None,
            processing: Arc::new(ProcessingGate::fixture_already_processing()),
            transport_scratch: Box::new(empty_transport_event()),
            has_transport: false,
            steady_time: 0,
            tail_mode_reported: false,
            process_refused: false,
            processing_start_refused: false,
            process_refusal_reported: false,
            audio: AudioBusLayout::portless(),
            is_instrument: false,
            accepts_note_events: true,
            editor_content_scale: crate::traits::DEFAULT_EDITOR_CONTENT_SCALE,
            midi_scratch: Vec::with_capacity(MAX_MIDI_EVENTS_PER_BLOCK),
            parameter_scratch: Vec::with_capacity(MAX_PARAMETER_EVENTS),
            event_order_scratch: event_order_scratch(),
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
                vendor_call_observer: None,
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

    /// Stage the rate this fixture reports as its activation rate.
    ///
    /// The constructor's default already matches the engine fixture, so a
    /// test calls this only to create a deliberate mismatch — a runtime
    /// activated at a rate other than the engine's own, to exercise the
    /// registration guard that parks it.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn set_engine_owned_command_fixture_sample_rate(&mut self, sample_rate: f64) {
        self.sample_rate = sample_rate;
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

    /// Be told — and held up, if the observer blocks — every time this
    /// fixture's `set_parameter`, `get_parameters`, `get_state`, `set_state`,
    /// `open_gui` or `close_gui` runs.
    ///
    /// Each of those is a vendor call of unbounded duration in a real plugin,
    /// and a fixture has no plugin to be slow; an observer that waits on a
    /// channel is how a downstream host test keeps one inside the plugin while
    /// it checks what else still runs.
    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn observe_engine_owned_command_fixture_vendor_calls(
        &mut self,
        observe: Box<dyn Fn() + Send + Sync>,
    ) {
        if let Some(fixture) = self.command_fixture.as_mut() {
            fixture.vendor_call_observer = Some(observe);
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

    /// Put an initialised, inactive plugin into the requested render mode.
    ///
    /// Only `Offline` asks anything, so a realtime load makes exactly the
    /// calls it always has. A plugin that declares a hard real-time
    /// requirement, or whose `set` refuses offline rendering, cannot serve an
    /// offline render and is refused by name.
    ///
    /// # Safety
    /// `plugin_ref` must be a live, initialised, inactive `clap_plugin`.
    unsafe fn enter_render_mode(
        plugin_ref: &clap_plugin,
        name: &str,
        mode: ProcessMode,
    ) -> Result<(), ClapError> {
        if mode == ProcessMode::Realtime {
            return Ok(());
        }
        // SAFETY: this fn's contract makes `plugin_ref` a live, initialised instance
        // on its main thread, and `clap_plugin_render` is the struct CLAP defines
        // for `CLAP_EXT_RENDER`.
        let render =
            unsafe { Self::query_extension::<clap_plugin_render>(plugin_ref, CLAP_EXT_RENDER) };
        if render.is_null() {
            return Ok(());
        }
        // SAFETY: a non-null extension pointer addresses the plugin's static
        // `clap_plugin_render`, live for the plugin's life.
        let render = unsafe { &*render };
        let plugin = plugin_ref as *const clap_plugin;
        let hard_realtime = render
            .has_hard_realtime_requirement
            .is_some_and(|requires| {
                // SAFETY: the render extension's own `[main-thread]` callback, matched as
                // `Some`, called on the live, inactive plugin it belongs to.
                unsafe { requires(plugin) }
            });
        if hard_realtime {
            return Err(ClapError::RequiresRealtime {
                name: name.to_string(),
            });
        }
        let accepted = render.set.is_some_and(|set| {
            // SAFETY: the render extension's own `[main-thread & !active]` `set`,
            // matched as `Some`, called on the live plugin before activation.
            unsafe { set(plugin, CLAP_RENDER_OFFLINE) }
        });
        if !accepted {
            return Err(ClapError::OfflineRefused {
                name: name.to_string(),
            });
        }
        Ok(())
    }

    /// Query a plugin extension by ID. Returns null if not supported.
    ///
    /// # Safety
    /// `plugin_ref` must be a live, initialised `clap_plugin` instance (or a test
    /// double whose callbacks are sound), queried on the thread that owns its
    /// main-thread calls, and `T` must be the struct type CLAP defines for `ext_id`.
    unsafe fn query_extension<T>(plugin_ref: &clap_plugin, ext_id: &CStr) -> *const T {
        if let Some(get_ext) = plugin_ref.get_extension {
            // SAFETY: `get_ext` is the instance's own `get_extension`, matched as `Some`;
            // it is called with that live instance (this fn's contract) and a
            // NUL-terminated id `ext_id` keeps alive for the call.
            let ptr = unsafe { get_ext(plugin_ref as *const clap_plugin, ext_id.as_ptr()) };
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
    ///
    /// # Safety
    /// `plugin_ref` must be a live, initialised, deactivated `clap_plugin` instance
    /// (or a sound test double), called on the thread that owns its main-thread calls.
    unsafe fn read_audio_bus_layout(plugin_ref: &clap_plugin) -> Result<AudioBusLayout, ClapError> {
        // SAFETY: this fn's contract is `query_extension`'s, and
        // `clap_plugin_audio_ports` is the struct CLAP defines for `CLAP_EXT_AUDIO_PORTS`.
        let extension = unsafe {
            Self::query_extension::<clap_plugin_audio_ports>(plugin_ref, CLAP_EXT_AUDIO_PORTS)
        };
        if extension.is_null() {
            return Ok(AudioBusLayout::portless());
        }
        // SAFETY: non-null (checked above); CLAP keeps an extension struct valid for
        // the life of the instance, which outlives this call.
        let audio_ports = unsafe { &*extension };
        let read_direction = |is_input: bool| -> Result<Vec<u32>, ClapError> {
            let direction = if is_input {
                PortDirection::Input
            } else {
                PortDirection::Output
            };
            let count = audio_ports
                .count
                .ok_or(ClapError::AudioPortsNoCount { direction })?;
            // SAFETY: `count` is the extension's own callback, matched as `Some`, called
            // on the live, deactivated instance on its main thread (this fn's contract).
            let count = unsafe { count(plugin_ref as *const clap_plugin, is_input) };
            if count > MAX_RUNTIME_AUDIO_PORTS {
                return Err(ClapError::AudioPortCountExceedsBounds { direction });
            }
            let get = audio_ports
                .get
                .ok_or(ClapError::AudioPortsNoInfo { direction })?;
            let mut channels = Vec::with_capacity(count as usize);
            for index in 0..count {
                // SAFETY: `clap_audio_port_info` is a C struct of integers, a char
                // array and a raw pointer, for all of which all-zero bytes are valid.
                let mut info: clap_audio_port_info = unsafe { mem::zeroed() };
                // SAFETY: `get` is the extension's own callback, matched as `Some`;
                // `index < count`, and `info` is a live, writable out-parameter.
                if !unsafe { get(plugin_ref as *const clap_plugin, index, is_input, &mut info) } {
                    return Err(ClapError::AudioPortNoInfo { direction, index });
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
    ///
    /// # Safety
    /// `plugin_ref` must be a live, initialised `clap_plugin` instance (or a sound
    /// test double), called on the thread that owns its main-thread calls.
    unsafe fn reads_note_input_ports(plugin_ref: &clap_plugin) -> bool {
        // SAFETY: this fn's contract is `query_extension`'s, and
        // `clap_plugin_note_ports` is the struct CLAP defines for `CLAP_EXT_NOTE_PORTS`.
        let extension = unsafe {
            Self::query_extension::<clap_plugin_note_ports>(plugin_ref, CLAP_EXT_NOTE_PORTS)
        };
        if extension.is_null() {
            return false;
        }
        // SAFETY: non-null (checked above); CLAP keeps an extension struct valid for
        // the life of the instance, which outlives this call.
        let note_ports = unsafe { &*extension };
        let Some(count) = note_ports.count else {
            return false;
        };
        // SAFETY: `count` is the extension's own callback, matched as `Some`, called
        // on the live instance on its main thread (this fn's contract).
        let input_ports = unsafe { count(plugin_ref as *const clap_plugin, true) };
        if input_ports > MAX_RUNTIME_AUDIO_PORTS {
            return false;
        }
        let Some(get) = note_ports.get else {
            return false;
        };
        (0..input_ports).any(|index| {
            // SAFETY: `clap_note_port_info` is a C struct of integers and a char
            // array, for all of which all-zero bytes are valid.
            let mut info: clap_note_port_info = unsafe { mem::zeroed() };
            // SAFETY: `get` is the extension's own callback, matched as `Some`;
            // `index < input_ports`, and `info` is a live, writable out-parameter.
            (unsafe { get(plugin_ref as *const clap_plugin, index, true, &mut info) })
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

    /// The rate this instance was activated at.
    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
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
        // SAFETY: non-null (checked above); `gui_ext` is the plugin's own extension
        // struct from load, valid while the instance `self` owns is alive.
        let gui = unsafe { &*self.gui_ext };
        let get_size = gui.get_size?;
        let mut width: u32 = 0;
        let mut height: u32 = 0;
        // SAFETY: `get_size` is the extension's callback, matched as `Some`, called on
        // the live instance `self.plugin` (non-null, checked above) with live out-params.
        if unsafe { get_size(self.plugin, &mut width, &mut height) } {
            Some((width, height))
        } else {
            None
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
    pub fn open_gui(&mut self, handle_ptr: *mut c_void) -> Result<(u32, u32), ClapError> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            record_gui_lifecycle_thread(fixture);
            observe_vendor_call(fixture);
            if !fixture.has_gui {
                return Err(ClapError::GuiUnsupported);
            }
            if self.gui_open {
                return Err(ClapError::GuiAlreadyOpen);
            }

            self.host_state.discard_editor_window_asks();
            self.gui_open = true;
            return Ok((800, 600));
        }

        if self.gui_ext.is_null() || self.plugin.is_null() {
            return Err(ClapError::GuiUnsupported);
        }

        if self.gui_open {
            return Err(ClapError::GuiAlreadyOpen);
        }

        // Anything a previous editor asked of its window is about that window.
        self.host_state.discard_editor_window_asks();

        // SAFETY: non-null (checked above); `gui_ext` is the plugin's own extension
        // struct from load, valid while the instance `self` owns is alive.
        let gui = unsafe { &*self.gui_ext };
        let api = Self::platform_api();

        // 1. Check API support
        if let Some(is_supported) = gui.is_api_supported {
            // SAFETY: the extension's callback, matched as `Some`, on the live
            // instance `self.plugin`; `api` is a static NUL-terminated CLAP API id.
            if !unsafe { is_supported(self.plugin, api.as_ptr(), false) } {
                return Err(ClapError::EmbeddedGuiUnsupported {
                    name: self.name.clone(),
                });
            }
        }

        // 2. Create GUI
        let create = gui.create.ok_or(ClapError::GuiNoCreate)?;
        // SAFETY: the extension's `create`, unwrapped above, on the live instance with
        // the static API id; no editor is open (`gui_open` checked above).
        if !unsafe { create(self.plugin, api.as_ptr(), false) } {
            return Err(ClapError::GuiCreateFailed {
                name: self.name.clone(),
            });
        }

        // 3. Set scale — the host's stated display scale, defaulting to
        //    1.0 until one arrives. Called here because CLAP places it
        //    between create and get_size; a plugin that prefers the OS's
        //    own value ignores it, which the spec allows. Skipped for
        //    cocoa, whose logical-pixel sizes already carry the OS scale —
        //    see [`Self::scale_applies_to`].
        if Self::scale_applies_to(api) {
            if let Some(set_scale) = gui.set_scale {
                // SAFETY: the extension's callback, matched as `Some`, on the live
                // instance after a successful `create`.
                unsafe { set_scale(self.plugin, self.editor_content_scale) };
            }
        }

        // 4. Get size
        let mut width: u32 = 800;
        let mut height: u32 = 600;
        if let Some(get_size) = gui.get_size {
            // SAFETY: the extension's callback, matched as `Some`, on the live
            // instance after `create`, with two live out-parameters.
            unsafe { get_size(self.plugin, &mut width, &mut height) };
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
            // SAFETY: the extension's callback, matched as `Some`, on the live
            // instance after `create`; `window` is a stack value alive for the call,
            // carrying the caller's native handle for this platform's API.
            if !unsafe { set_parent(self.plugin, &window) } {
                // Clean up
                if let Some(destroy) = gui.destroy {
                    // SAFETY: the extension's callback, matched as `Some`, destroying
                    // the editor `create` made above; it is not used again.
                    unsafe { destroy(self.plugin) };
                }
                return Err(ClapError::GuiSetParentFailed {
                    name: self.name.clone(),
                });
            }
        }

        // 6. Show
        if let Some(show) = gui.show {
            // SAFETY: the extension's callback, matched as `Some`, on the live
            // instance whose editor was created and parented above.
            unsafe { show(self.plugin) };
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
        self.editor_window = None;
        self.host_state.set_editor_resize_available(false);
    }

    /// Install the window this editor is drawn into, so what the plugin asks
    /// of it — to be shown, hidden, or closed, or to have its resizability
    /// re-read — has somewhere to go. Released with the resizer.
    pub fn set_editor_window(&mut self, window: SharedEditorWindow) {
        self.editor_window = Some(window);
    }

    /// The window the pending asks go to, leaving them recorded. Control path
    /// only; no plugin call.
    pub fn editor_window_with_pending_asks(&self) -> Option<SharedEditorWindow> {
        if !self.host_state.has_pending_editor_window_asks() {
            return None;
        }
        self.editor_window.clone()
    }

    /// Take what the plugin asked of its editor window, with the window to
    /// answer it through. Control path only; no plugin call.
    ///
    /// Nothing is taken while no window is installed: the asks wait for the
    /// next open, which discards them as belonging to a window that is gone.
    pub fn take_editor_window_asks(&mut self) -> Option<(EditorWindowAsks, SharedEditorWindow)> {
        let window = self.editor_window.clone()?;
        let asks = self.host_state.take_editor_window_asks();
        if asks.is_empty() {
            return None;
        }
        Some((asks, window))
    }

    /// Carry out what the plugin asked of its editor window. **On the thread
    /// that owns the window** — every answer calls into the editor.
    ///
    /// A closed editor is answered alone: the other asks were about a view
    /// that no longer exists.
    pub fn answer_editor_window_asks(&mut self, asks: EditorWindowAsks) {
        if let Some(closed) = asks.closed {
            self.acknowledge_editor_closed(closed);
            return;
        }
        if let Some(visibility) = asks.visibility {
            self.apply_editor_visibility(visibility);
        }
        if asks.resize_hints_changed {
            let resizable = self.editor_can_resize();
            if let Some(window) = self.editor_window.as_ref() {
                window.set_resizable(resizable);
            }
        }
    }

    /// End the editor session the plugin ended. **Window thread only.**
    ///
    /// gui.h: with `was_destroyed` the host must call `destroy` to acknowledge,
    /// and the view is already gone, so it is not hidden first. The window is
    /// destroyed last, once the editor has left it; the shell's close path then
    /// drops the editor record and tells the renderer the editor closed, as it
    /// does for a window the user closed.
    fn acknowledge_editor_closed(&mut self, closed: EditorClosed) {
        let window = self.editor_window.clone();

        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            record_gui_lifecycle_thread(fixture);
            self.gui_open = false;
            self.release_editor_window_resizer();
            if let Some(window) = window {
                window.destroy();
            }
            return;
        }

        if self.gui_open && !self.gui_ext.is_null() && !self.plugin.is_null() {
            // SAFETY: non-null (checked above); `gui_ext` is the plugin's own extension
            // struct from load, valid while the instance `self` owns is alive.
            let gui = unsafe { &*self.gui_ext };
            if !closed.was_destroyed {
                if let Some(hide) = gui.hide {
                    // SAFETY: the extension's callback, matched as `Some`, on the live
                    // instance whose editor the plugin reports closed but not destroyed.
                    unsafe { hide(self.plugin) };
                }
            }
            if let Some(destroy) = gui.destroy {
                // SAFETY: the extension's callback, matched as `Some`, acknowledging the
                // editor the plugin reported closed; `gui_open` is cleared below so no
                // later close destroys it again.
                unsafe { destroy(self.plugin) };
            }
        }

        self.gui_open = false;
        self.release_editor_window_resizer();
        if let Some(window) = window {
            window.destroy();
        }
    }

    /// Show or hide the editor and its window together. **Window thread only.**
    fn apply_editor_visibility(&mut self, visibility: EditorVisibility) {
        let Some(window) = self.editor_window.clone() else {
            return;
        };

        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            record_gui_lifecycle_thread(fixture);
            match visibility {
                EditorVisibility::Show => window.show(),
                EditorVisibility::Hide => window.hide(),
            }
            return;
        }

        // SAFETY: window thread, which is `open_gui_extension`'s contract; the
        // extension outlives this borrow of `self`.
        let gui = unsafe { self.open_gui_extension() };
        match visibility {
            EditorVisibility::Show => {
                if let Some(show) = gui.and_then(|gui| gui.show) {
                    // SAFETY: the extension's callback, matched as `Some`, on the live
                    // instance whose editor is open (`open_gui_extension` returned it).
                    unsafe { show(self.plugin) };
                }
                window.show();
            }
            EditorVisibility::Hide => {
                if let Some(hide) = gui.and_then(|gui| gui.hide) {
                    // SAFETY: the extension's callback, matched as `Some`, on the live
                    // instance whose editor is open (`open_gui_extension` returned it).
                    unsafe { hide(self.plugin) };
                }
                window.hide();
            }
        }
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
        // SAFETY: non-null (checked above); the plugin's extension struct from load,
        // valid while the instance `self` owns is alive, which bounds the borrow.
        Some(unsafe { &*self.gui_ext })
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

        // SAFETY: control path only, which is `open_gui_extension`'s contract; the
        // extension outlives this borrow of `self`.
        let Some(gui) = (unsafe { self.open_gui_extension() }) else {
            return false;
        };
        let Some(can_resize) = gui.can_resize else {
            return false;
        };
        // SAFETY: the extension's callback, matched as `Some`, on the live instance
        // whose editor is open (`open_gui_extension` returned `Some`).
        if !unsafe { can_resize(self.plugin) } {
            return false;
        }
        self.resize_hints_allow_some_axis(gui)
    }

    /// Whether the plugin's resize hints leave the user an axis to drag along.
    ///
    /// A plugin with no hints has stated no constraint, so `can_resize` stands.
    /// One that refuses both axes is not resizable whatever `can_resize` said.
    fn resize_hints_allow_some_axis(&self, gui: &clap_plugin_gui) -> bool {
        let Some(get_resize_hints) = gui.get_resize_hints else {
            return true;
        };
        let mut hints = clap_gui_resize_hints {
            can_resize_horizontally: true,
            can_resize_vertically: true,
            preserve_aspect_ratio: false,
            aspect_ratio_width: 0,
            aspect_ratio_height: 0,
        };
        // SAFETY: the extension's callback, matched as `Some`, on the live instance
        // whose editor is open, with one live out-parameter.
        if !unsafe { get_resize_hints(self.plugin, &mut hints) } {
            return true;
        }
        hints.can_resize_horizontally || hints.can_resize_vertically
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
    pub fn request_editor_size(
        &mut self,
        width: u32,
        height: u32,
    ) -> Result<(u32, u32), ClapError> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            record_gui_lifecycle_thread(fixture);
            if !self.gui_open {
                return Err(ClapError::FixtureNoEditorToResize);
            }
            self.resize_host_window(width, height);
            return Ok((width, height));
        }

        if !self.editor_can_resize() {
            return Err(ClapError::NoResizableEditor {
                name: self.name.clone(),
            });
        }

        let previous = self.get_gui_size();
        let (mut granted_width, mut granted_height) = self.to_plugin_units((width, height));
        // SAFETY: control path only, which is `open_gui_extension`'s contract; the
        // extension outlives this borrow of `self`.
        let Some(gui) = (unsafe { self.open_gui_extension() }) else {
            return Err(ClapError::NoEditorToResize {
                name: self.name.clone(),
            });
        };

        if let Some(adjust_size) = gui.adjust_size {
            // SAFETY: the extension's callback, matched as `Some`, on the live instance
            // with an open editor, with two live out-parameters.
            if !unsafe { adjust_size(self.plugin, &mut granted_width, &mut granted_height) } {
                return Err(ClapError::EditorSizeRefused {
                    name: self.name.clone(),
                });
            }
        }

        let granted = self.to_logical_units((granted_width, granted_height));
        self.resize_host_window(granted.0, granted.1);

        if let Some(set_size) = gui.set_size {
            // SAFETY: the extension's callback, matched as `Some`, on the live instance
            // with an open editor.
            if !unsafe { set_size(self.plugin, granted_width, granted_height) } {
                if let Some(previous) = previous {
                    let (width, height) = self.to_logical_units(previous);
                    self.resize_host_window(width, height);
                }
                return Err(ClapError::AdjustedSizeRefused {
                    name: self.name.clone(),
                });
            }
        }

        Ok(granted)
    }

    /// Restate the display scale for an editor that is already open, reporting
    /// the size its host window must take now. **Control path only.**
    ///
    /// The scale is kept as well as applied, so an editor closed and reopened on
    /// the display it was moved to opens at the scale it is on. The size is
    /// re-read rather than assumed: `set_scale` is what makes a plugin lay itself
    /// out at the new density, and `get_size` is the only way to learn what that
    /// came to.
    pub fn apply_editor_content_scale(&mut self, scale: f64) -> Result<(u32, u32), ClapError> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            record_gui_lifecycle_thread(fixture);
            let Some((width, height)) = self.get_gui_size().filter(|_| self.gui_open) else {
                return Err(ClapError::FixtureNoEditorToRescale);
            };
            self.editor_content_scale = scale;
            self.resize_host_window(width, height);
            return Ok((width, height));
        }

        if !(scale.is_finite() && scale > 0.0) {
            return Err(ClapError::InvalidContentScale {
                name: self.name.clone(),
                scale,
            });
        }
        self.editor_content_scale = scale;

        // SAFETY: control path only, which is `open_gui_extension`'s contract; the
        // extension outlives this borrow of `self`.
        let Some(gui) = (unsafe { self.open_gui_extension() }) else {
            return Err(ClapError::NoEditorToRescale {
                name: self.name.clone(),
            });
        };
        // Skipped for cocoa for the same reason the open path skips it:
        // its logical sizes already carry the OS scale.
        if Self::scale_applies_to(Self::platform_api()) {
            if let Some(set_scale) = gui.set_scale {
                // SAFETY: the extension's callback, matched as `Some`, on the live
                // instance with an open editor.
                unsafe { set_scale(self.plugin, scale) };
            }
        }

        let stated = self
            .get_gui_size()
            .ok_or_else(|| ClapError::NoSizeAtScale {
                name: self.name.clone(),
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

        // SAFETY: non-null (checked above); `params_ext` is the plugin's own extension
        // struct from load, valid while the instance `self` owns is alive.
        let params = unsafe { &*self.params_ext };
        let Some(flush) = params.flush else {
            return false;
        };
        let out_events = capture_output_events(&self.parameter_events);
        // SAFETY: the extension's `flush`, matched as `Some`, on the live instance while
        // it is not processing (checked above), which CLAP makes a main-thread call; both
        // event lists outlive the call.
        unsafe { flush(self.plugin, &EMPTY_INPUT_EVENTS, &out_events) };
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
            observe_vendor_call(fixture);
            self.gui_open = false;
            return;
        }

        if self.gui_ext.is_null() || self.plugin.is_null() || !self.gui_open {
            return;
        }

        // SAFETY: non-null (checked above); `gui_ext` is the plugin's own extension
        // struct from load, valid while the instance `self` owns is alive.
        let gui = unsafe { &*self.gui_ext };

        if let Some(hide) = gui.hide {
            // SAFETY: the extension's callback, matched as `Some`, on the live instance
            // whose editor is open (`gui_open` checked above).
            unsafe { hide(self.plugin) };
        }
        if let Some(destroy) = gui.destroy {
            // SAFETY: the extension's callback, matched as `Some`, destroying the open
            // editor; `gui_open` is cleared below so it is not destroyed twice.
            unsafe { destroy(self.plugin) };
        }

        self.gui_open = false;
        eprintln!("[CLAP] Closed GUI for '{}'", self.name);
    }

    /// Process audio with MIDI note events.
    ///
    /// RT-safe: reuses `self.midi_scratch` (preallocated in `new`), which holds
    /// [`MAX_MIDI_EVENTS_PER_BLOCK`] events — a full engine block.
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
    ///
    /// Each update's `sample_offset` becomes its event's `time`, and the plugin
    /// reads parameter values and notes as one list in non-decreasing time, as
    /// CLAP requires of `in_events`. Both slices arrive in non-decreasing time
    /// already; at one time a parameter value is listed ahead of a note, so a
    /// note sounds with the value written for its own sample.
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
            self.process_audio_internal(
                inputs,
                outputs,
                num_samples,
                &EMPTY_INPUT_EVENTS,
                BlockHostWrites::NONE,
            );
            return;
        }

        fill_note_scratch(&mut self.midi_scratch, midi_events);
        self.parameter_scratch.clear();
        for update in parameter_updates.iter().take(MAX_PARAMETER_EVENTS) {
            self.parameter_scratch.push(clap_event_param_value {
                header: clap_event_header {
                    size: mem::size_of::<clap_event_param_value>() as u32,
                    time: update.sample_offset,
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
        merge_event_order(
            &mut self.event_order_scratch,
            &self.parameter_scratch,
            &self.midi_scratch,
        );

        // Raw pointer into the scratch vec — safe because process_audio_internal
        // does not touch event scratch (it only uses input_scratch/output_scratch/plugin).
        let midi_events_ptr: *const clap_event_note = self.midi_scratch.as_ptr();
        let midi_events_count = self.midi_scratch.len() as u32;
        let parameter_events_ptr: *const clap_event_param_value = self.parameter_scratch.as_ptr();
        let parameter_events_count = self.parameter_scratch.len() as u32;
        let event_order_ptr: *const u32 = self.event_order_scratch.as_ptr();

        struct EventListCtx {
            midi_events: *const clap_event_note,
            midi_count: u32,
            parameter_events: *const clap_event_param_value,
            parameter_count: u32,
            /// `midi_count + parameter_count` entries, each naming an event by
            /// the unmerged index: parameters first, then notes.
            order: *const u32,
        }

        unsafe extern "C" fn event_list_size(list: *const clap_input_events) -> u32 {
            // SAFETY: the plugin calls `size` only on the list handed to the
            // `process` call below, a live stack `clap_input_events` for its duration.
            let ctx = unsafe { (*list).ctx } as *const EventListCtx;
            // SAFETY: that list's `ctx` is the stack `EventListCtx` below, which
            // outlives the `process` call.
            let midi_count = unsafe { (*ctx).midi_count };
            // SAFETY: as above — the live stack `EventListCtx`.
            let parameter_count = unsafe { (*ctx).parameter_count };
            midi_count + parameter_count
        }

        unsafe extern "C" fn event_list_get(
            list: *const clap_input_events,
            index: u32,
        ) -> *const clap_event_header {
            // SAFETY: the plugin calls `get` only on the list handed to the
            // `process` call below, a live stack `clap_input_events` for its duration.
            let ctx = unsafe { (*list).ctx } as *const EventListCtx;
            // SAFETY: that list's `ctx` is the stack `EventListCtx` below, which
            // outlives the `process` call.
            let parameter_count = unsafe { (*ctx).parameter_count };
            // SAFETY: as above — the live stack `EventListCtx`.
            let midi_count = unsafe { (*ctx).midi_count };
            if index >= parameter_count + midi_count {
                return ptr::null();
            }
            // SAFETY: as above — the live stack `EventListCtx`.
            let order = unsafe { (*ctx).order };
            // SAFETY: `order` is `event_order_scratch.as_ptr()`, filled with
            // exactly `parameter_count + midi_count` entries, and `index` is below that.
            let entry = unsafe { order.add(index as usize) };
            // SAFETY: `entry` points at an initialised element of
            // `event_order_scratch`, untouched while `process` runs.
            let index = unsafe { *entry };
            if index < parameter_count {
                // SAFETY: as above — the live stack `EventListCtx`.
                let parameter_events = unsafe { (*ctx).parameter_events };
                // SAFETY: `parameter_events` is `parameter_scratch.as_ptr()` with
                // `parameter_count == len`, and `index < parameter_count`.
                let event = unsafe { parameter_events.add(index as usize) };
                // SAFETY: `event` points at an initialised element of `parameter_scratch`,
                // untouched while `process` runs.
                return unsafe { &(*event).header as *const clap_event_header };
            }

            let midi_index = index - parameter_count;
            if midi_index >= midi_count {
                return ptr::null();
            }
            // SAFETY: as above — the live stack `EventListCtx`.
            let midi_events = unsafe { (*ctx).midi_events };
            // SAFETY: `midi_events` is `midi_scratch.as_ptr()` with `midi_count == len`,
            // and `midi_index < midi_count`.
            let event = unsafe { midi_events.add(midi_index as usize) };
            // SAFETY: `event` points at an initialised element of `midi_scratch`,
            // untouched while `process` runs.
            unsafe { &(*event).header as *const clap_event_header }
        }

        let mut ctx = EventListCtx {
            midi_events: midi_events_ptr,
            midi_count: midi_events_count,
            parameter_events: parameter_events_ptr,
            parameter_count: parameter_events_count,
            order: event_order_ptr,
        };
        let input_events = clap_input_events {
            ctx: &mut ctx as *mut EventListCtx as *mut c_void,
            size: Some(event_list_size),
            get: Some(event_list_get),
        };

        let host_writes = BlockHostWrites {
            events: parameter_events_ptr,
            count: parameter_events_count as usize,
        };
        self.process_audio_internal(inputs, outputs, num_samples, &input_events, host_writes);
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
                // SAFETY: the instance's own callback, read by `plugin_callback` only
                // when `self.plugin` is non-null; this fn runs on the audio thread,
                // where CLAP places `start_processing`, on an activated instance.
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
            // SAFETY: the instance's own callback, read only when `self.plugin` is
            // non-null; called on the audio thread, where CLAP places
            // `stop_processing`, while the gate says the plugin is processing.
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
        // SAFETY: non-null (checked above); the live instance created in `new` and
        // owned by `self` until drop, so it outlives this borrow.
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
            // SAFETY: non-null (checked above); the live instance owned by `self`.
            if let Some(stop_processing) = unsafe { (*self.plugin).stop_processing } {
                // SAFETY: the instance's own callback, matched as `Some`, on a plugin
                // still processing. Off the audio thread is the deviation documented
                // above; `&mut self` excludes a concurrent `process` on this instance.
                unsafe { stop_processing(self.plugin) };
            }
        }
        self.processing.mark_stopped();
        self.processing.count_off_audio_thread_stop();
    }

    /// Internal process method that accepts a custom input events list.
    ///
    /// `host_writes` names the parameter values `in_events` carries, so their
    /// echoes are not captured as plugin edits.
    ///
    /// RT-safe: uses preallocated `input_scratch`/`output_scratch`. Stack-allocates pointer
    /// arrays. No heap allocation on the hot path.
    fn process_audio_internal(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        in_events: &clap_input_events,
        host_writes: BlockHostWrites,
    ) {
        if !self.activated || self.plugin.is_null() {
            copy_inputs_to_outputs(inputs, outputs, num_samples);
            return;
        }

        // This is the audio thread, or an offline instance's render thread —
        // CLAP's [audio-thread] either way — which is the only thread CLAP allows to
        // enter or leave the processing state — so this is where the control
        // thread's intent is carried out.
        self.sync_processing_state();

        if !self.processing.is_processing() {
            // Either the plugin refused to start, or a stop has been requested
            // and performed. Either way it must not be handed a block.
            if self.processing.wants_processing() {
                self.processing_start_refused = true;
            }
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
                // SAFETY: `host_writes` describes `parameter_scratch` or nothing, and
                // nothing touches `parameter_scratch` while this block runs.
                let written = unsafe { host_writes.as_slice() };
                let mut capture = HostWriteCapture {
                    queue: &self.parameter_events,
                    written,
                };
                let out_events = capture_host_write_events(&mut capture);
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
                // SAFETY: the instance's `process`, read only when `self.plugin` is
                // non-null, on the audio thread of an activated, processing plugin;
                // `process_data` and everything it points to outlive the call.
                let status = unsafe { process_fn(self.plugin, &process_data) };
                self.advance_steady_time(n_samp);
                if process_failed(status) {
                    // A plugin with no audio ports wrote no audio to invalidate:
                    // the block passes through its slot either way, and the
                    // failure costs only the output events this call was made
                    // for. Recording it is all the host can honestly do.
                    self.latch_process_refusal();
                } else {
                    self.observe_tail_status(status);
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

        // SAFETY: non-null (checked at entry); the live instance owned by `self`.
        let plugin_ref = unsafe { &*self.plugin };
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

        // SAFETY: `host_writes` describes `parameter_scratch` or nothing, and
        // nothing touches `parameter_scratch` while this block runs.
        let written = unsafe { host_writes.as_slice() };
        let mut capture = HostWriteCapture {
            queue: &self.parameter_events,
            written,
        };
        let out_events = capture_host_write_events(&mut capture);
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

        // SAFETY: the instance's `process`, matched as `Some`, on the thread that runs
        // its blocks (CLAP's audio thread, offline included), for an activated,
        // processing plugin. The buffer tables match its declared ports
        // and point into scratch sized for `MAX_BUFFER >= n_samp` frames, and every
        // pointer in `process_data` outlives the call.
        let status = unsafe { process_fn(self.plugin, &process_data) };
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

        self.observe_tail_status(status);

        if self.audio.output_buffers.is_empty() {
            // A successful process with no declared output bus is an
            // input-only analyzer: it taps the signal and produces none of
            // its own, so the dry block continues past it — the same rule
            // the VST3 backend applies when no output bus exists. Leaving
            // the caller's buffers alone here mutes the track, because the
            // slot copies its zeroed scratch back over them.
            copy_inputs_to_outputs(inputs, outputs, num_samples);
        } else {
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

    /// Record what a successful process status said about the plugin's tail.
    ///
    /// Audio thread. `CLAP_PROCESS_TAIL` is the plugin entering tail mode: the
    /// status whose answer is "rely upon the plugin's tail to determine if the
    /// plugin should continue to process". Every other success answers the
    /// question one way or another — `CONTINUE`, `CONTINUE_IF_NOT_QUIET` and
    /// `SLEEP` all describe a plugin that is not deferring to its tail — so the
    /// observation tracks the last status, it does not latch. Only a *success*
    /// updates it: CLAP defines the error as output the host must discard, so an
    /// error reports nothing about the tail and the last observation stands.
    fn observe_tail_status(&mut self, status: clap_process_status) {
        self.tail_mode_reported = status == CLAP_PROCESS_TAIL;
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
/// still has something to add. `TAIL` is recorded as the tail-mode observation
/// (`observe_tail_status`); this host changes nothing about its pumping for any
/// of them because it processes continuously.
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
    // SAFETY: the `||` reads `(*plugin)` only once `plugin` is known non-null, and a
    // non-null `plugin` is live (this fn's contract).
    if plugin.is_null() || unsafe { (*plugin).desc.is_null() } {
        return false;
    }
    // SAFETY: `plugin` is non-null and live (checked above, this fn's contract).
    let desc = unsafe { (*plugin).desc };
    // SAFETY: `desc` is non-null (checked above) and outlives the plugin, as CLAP
    // requires of `clap_plugin.desc`.
    let features = unsafe { (*desc).features };
    // SAFETY: CLAP defines `features` as null or a null-terminated array of
    // NUL-terminated strings owned by the descriptor, which is still alive.
    let features = unsafe { owned_feature_list(features) };
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
    for (channel, source) in inputs.iter().enumerate().take(channels) {
        let destination = &mut audio.input_scratch[channel * MAX_BUFFER..][..n_samp];
        let len = source.len().min(n_samp);
        destination[..len].copy_from_slice(&source[..len]);
        destination[len..].fill(0.0);
    }
}

/// Copy the declared output scratch back onto the engine's stereo bus.
///
/// Only the *main* output port — the first declared one — is the engine's
/// stereo return. Its own channel count decides how many scratch channels are
/// copied, and every later port is auxiliary: its buses go to their own
/// scratch, which nothing reads, because an unconnected auxiliary signal that
/// leaked into the return would sit directly in the mix. Declared channel 0 is
/// the engine's left and channel 1 its right. A main port declaring a single
/// channel is mono, and a mono plugin on a stereo bus sounds from the middle —
/// every DAW duplicates it to both channels, where a literal copy would leave
/// the right channel silent.
fn read_output_scratch(audio: &AudioBusLayout, outputs: &mut [&mut [f32]], n_samp: usize) {
    let main_port_channels = audio
        .output_buffers
        .first()
        .map_or(0, |main_port| main_port.channel_count as usize);
    let copy_channel = |channel: usize, out: &mut [f32]| {
        let len = n_samp.min(out.len());
        out[..len].copy_from_slice(&audio.output_scratch[channel * MAX_BUFFER..][..len]);
    };
    if outputs.is_empty() {
        return;
    }
    match main_port_channels {
        0 => {}
        1 => {
            if let Some(left) = outputs.first_mut() {
                copy_channel(0, left);
            }
            if let Some(right) = outputs.get_mut(1) {
                copy_channel(0, right);
            }
        }
        _ => {
            for (channel, out) in outputs.iter_mut().enumerate() {
                if channel >= main_port_channels {
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
    // SAFETY: `entry_ptr` is a live entry in a still-loaded library (this fn's contract).
    if let Some(deinit) = unsafe { (*entry_ptr).deinit } {
        // SAFETY: the entry's own `deinit`, matched as `Some`, run once after every
        // instance is destroyed and before the library unloads (this fn's contract).
        unsafe { deinit() };
    }
}

/// Hand an instance's run loop the plugin it delivers to, then put it in the
/// shared editor pump. Timers and descriptors the plugin registered during
/// `init` are already in the run loop, and fire from the next pass.
///
/// # Safety
/// `plugin` must be the live, initialised instance whose `host_data` is
/// `host_state`, called on its main thread, and the returned registration must
/// be dropped before the instance is destroyed.
#[cfg(unix)]
unsafe fn join_editor_pump(
    host_state: &HostCallbackState,
    plugin: *const clap_plugin,
) -> EditorRunLoopRegistration {
    // SAFETY: the live, initialised instance on its main thread, outliving the
    // registration returned below (this fn's contract).
    unsafe { host_state.run_loop().attach(plugin) };
    register_editor_run_loop(Arc::clone(host_state.run_loop()))
}

/// Destroy an instance a load is abandoning before the wrapper takes ownership
/// of it, so the entry's later `deinit` never runs with a live instance.
///
/// # Safety
/// `plugin` must be a live `clap_plugin` returned by `create_plugin`, never
/// activated, called on its main thread and not used again after this call.
unsafe fn destroy_abandoned_instance(plugin: *const clap_plugin) {
    // SAFETY: `plugin` is a live instance (this fn's contract).
    if let Some(destroy) = unsafe { (*plugin).destroy } {
        // SAFETY: the instance's own `destroy`, matched as `Some`, called once on the
        // never-activated instance, which is not used again (this fn's contract).
        unsafe { destroy(plugin) };
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
    // SAFETY: non-null (checked above) and live (this fn's contract).
    match unsafe { (*plugin).activate } {
        // SAFETY: the instance's own `activate`, matched as `Some`, on a live instance
        // not yet activated (this fn's contract); `MAX_BUFFER` is the block ceiling
        // `process_audio_internal` clamps every block to.
        Some(activate) => unsafe {
            activate(plugin, sample_rate, MIN_PROCESS_FRAMES, MAX_BUFFER as u32)
        },
        None => false,
    }
}

/// A zeroed transport event with only its header filled, used as the
/// preallocated slot the audio thread refills in place.
fn empty_transport_event() -> clap_event_transport {
    // SAFETY: `clap_event_transport` is a C struct of integers and floats, for all
    // of which all-zero bytes are valid.
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

/// Refill `order` with the block's input list in non-decreasing time: a stable
/// merge of the parameter values and the notes, each already in time order,
/// naming an event by its unmerged index — parameter `i` as `i`, note `j` as
/// `parameters.len() + j`. At one time the parameter value goes first, so a
/// note sounds with the value written for its own sample. `order` was reserved
/// at both lists' capacities together, so the pushes never reallocate.
fn merge_event_order(
    order: &mut Vec<u32>,
    parameters: &[clap_event_param_value],
    notes: &[clap_event_note],
) {
    order.clear();
    let (mut parameter, mut note) = (0, 0);
    while parameter < parameters.len() || note < notes.len() {
        let parameter_first = note == notes.len()
            || (parameter < parameters.len()
                && parameters[parameter].header.time <= notes[note].header.time);
        if parameter_first {
            order.push(parameter as u32);
            parameter += 1;
        } else {
            order.push((parameters.len() + note) as u32);
            note += 1;
        }
    }
}

/// An empty merge-order scratch reserved for a full block of parameter values
/// and notes, so `merge_event_order` never grows it on the audio thread.
fn event_order_scratch() -> Vec<u32> {
    Vec::with_capacity(MAX_PARAMETER_EVENTS + MAX_MIDI_EVENTS_PER_BLOCK)
}

/// Refill the block's note scratch from the host's events.
///
/// Each event's `frame_offset` becomes the CLAP header's `time`, which is what
/// makes an instrument sound a note on the sample it was written on rather than
/// at the head of whichever block carried it. The scratch was reserved once at
/// [`MAX_MIDI_EVENTS_PER_BLOCK`], the most the seam hands over in one call, so
/// the `take` never cuts a caller's events: it only stops a caller breaking
/// that contract from growing the scratch on the audio thread.
fn fill_note_scratch(scratch: &mut Vec<clap_event_note>, midi_events: &[HostMidiEvent]) {
    scratch.clear();
    for event in midi_events.iter().take(MAX_MIDI_EVENTS_PER_BLOCK) {
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

/// Refill a preallocated transport event from the host timeline.
///
/// Writes every field in place — no allocation, safe to call from the audio
/// thread. Beat and second positions are CLAP fixed point, and the flags say
/// which fields carry meaning so a plugin does not read a zero as a real value.
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
///
/// # Safety
/// Each pointer must be null or live: `latency_ext` the latency extension struct
/// `plugin` returned (or a stub whose `get` is sound for `plugin`), and `plugin` a
/// live instance in the state CLAP requires for `get` — main thread, active.
unsafe fn read_latency_ext(
    latency_ext: *const clap_plugin_latency,
    plugin: *const clap_plugin,
) -> u32 {
    if latency_ext.is_null() || plugin.is_null() {
        return 0;
    }
    // SAFETY: non-null (checked above) and live (this fn's contract).
    match unsafe { (*latency_ext).get } {
        // SAFETY: the extension's `get`, matched as `Some`, on the live non-null
        // instance it belongs to, in the state this fn's contract requires.
        Some(get) => unsafe { get(plugin) },
        None => 0,
    }
}

/// Read a CLAP plugin's reported processing tail through its tail extension.
///
/// Zero when the extension pointer, its `get` callback, or the plugin pointer is
/// null — CLAP's own default for a plugin that does not implement `clap.tail`,
/// which is "no tail". Free function so it can be unit-tested against a stub
/// `clap_plugin_tail` without a live plugin.
///
/// # Safety
/// Each pointer must be null or live: `tail_ext` the tail extension struct
/// `plugin` returned (or a stub whose `get` is sound for `plugin`), and `plugin` a
/// live instance, called on the main or audio thread as CLAP permits for `get`.
unsafe fn read_tail_ext(tail_ext: *const clap_plugin_tail, plugin: *const clap_plugin) -> u32 {
    if tail_ext.is_null() || plugin.is_null() {
        return 0;
    }
    // SAFETY: non-null (checked above) and live (this fn's contract).
    match unsafe { (*tail_ext).get } {
        // SAFETY: the extension's `get`, matched as `Some`, on the live non-null
        // instance it belongs to (this fn's contract).
        Some(get) => unsafe { get(plugin) },
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
        // SAFETY: both pointers are null or the instance `self` owns and the latency
        // extension it returned at load; the plugin is active (checked above), and this
        // is the control path the doc above requires.
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
        // SAFETY: both pointers are null or the instance `self` owns and the tail
        // extension it returned at load, both alive while `self` is.
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

    /// Whether the plugin is actively draining a tail it declared.
    ///
    /// True only while all three hold: the plugin is activated and still in the
    /// processing state, its most recent *successful* process call returned
    /// `CLAP_PROCESS_TAIL` — CLAP's "rely upon the plugin's tail to determine
    /// if the plugin should continue to process" — and the tail it reports now
    /// is non-zero. A plugin that answers `CONTINUE`, `CONTINUE_IF_NOT_QUIET`
    /// or `SLEEP` has said the tail question is settled; a tail decayed to zero
    /// is done draining; and a plugin that left the processing state has no
    /// tail at all. Main/control thread only, like the other readers of what
    /// the audio thread recorded.
    pub fn is_tail_active(&self) -> bool {
        self.activated
            && self.processing.is_processing()
            && self.tail_mode_reported
            && self.tail_samples() > 0
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
    pub fn reactivate_for_latency(&mut self) -> Result<u32, ClapError> {
        if self.plugin.is_null() {
            return Ok(self.latency_samples());
        }

        if self.activated {
            self.force_stop_processing_off_audio_thread();
        }

        // SAFETY: non-null (checked above); the live instance owned by `self`.
        let plugin_ref = unsafe { &*self.plugin };

        if self.activated {
            if let Some(deactivate) = plugin_ref.deactivate {
                // SAFETY: the instance's own callback, matched as `Some`, on an active
                // instance whose processing was stopped above; `&mut self` under the
                // control seam excludes a concurrent `process`.
                unsafe { deactivate(self.plugin) };
            }
            self.activated = false;
        }

        if let Some(activate_fn) = plugin_ref.activate {
            // SAFETY: the instance's own callback, matched as `Some`, on an instance
            // deactivated above (or never active); `MAX_BUFFER` is the block ceiling
            // `process_audio_internal` clamps to.
            if !unsafe {
                activate_fn(
                    self.plugin,
                    self.sample_rate,
                    MIN_PROCESS_FRAMES,
                    MAX_BUFFER as u32,
                )
            } {
                return Err(ClapError::LatencyReactivationFailed {
                    name: self.name.clone(),
                });
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

        Ok(self.latency_samples())
    }

    /// Whether the plugin has flagged a latency change not yet polled. Reads
    /// the host's flag only; the plugin is not called.
    pub fn has_pending_latency_change(&self) -> bool {
        self.host_state.is_latency_dirty()
    }

    /// If the plugin flagged a latency change (via `clap_host_latency.changed()`
    /// or `request_restart()`), reactivate and re-read latency, returning
    /// `Some(new_samples)`. Returns `Ok(None)` when nothing changed. The flag is
    /// consumed (read-and-cleared) whether or not a reactivation follows.
    /// Main/control-thread only.
    pub fn poll_latency_change(&mut self) -> Result<Option<u32>, ClapError> {
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

    /// Answer a `clap_host::request_callback` ask: one pending request becomes
    /// one `clap_plugin::on_main_thread` call. Main/control thread only.
    ///
    /// The call is the ask's whole point — the plugin parked a worker result or
    /// an editor update on it — so a flag drained without the call would be
    /// the old no-op with extra steps. Coalescing is the read-and-clear flag's
    /// own doing: a burst of asks before this visit is one call, which
    /// completes the parked work either way. A wrapper whose plugin is absent
    /// (the fixture) or whose descriptor declares no `on_main_thread` consumes
    /// the ask without the call: there is nothing to re-enter, and re-arming
    /// would spin the carrier against a plugin that can never answer.
    fn service_main_thread_callback(&mut self) {
        if !self.host_state.take_main_thread_callback_requested() {
            return;
        }

        if self.plugin.is_null() {
            return;
        }
        // SAFETY: non-null (checked above); `plugin` is a live instance for the
        // wrapper's whole life.
        if let Some(on_main_thread) = unsafe { (*self.plugin).on_main_thread } {
            // SAFETY: the instance's own callback, matched as `Some`. CLAP marks
            // `on_main_thread` [main-thread] — the control seam's caller guarantees
            // exclusivity, and this host's control path is its main-thread service.
            unsafe { on_main_thread(self.plugin) };
        }
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
        self.process_audio_internal(
            inputs,
            outputs,
            num_samples,
            &EMPTY_INPUT_EVENTS,
            BlockHostWrites::NONE,
        );
    }

    fn set_parameter(&mut self, param_id: u32, value: f64) {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            observe_vendor_call(fixture);
            return;
        }

        if self.params_ext.is_null() || self.plugin.is_null() {
            return;
        }

        // SAFETY: non-null (checked above); `params_ext` is the plugin's own extension
        // struct from load, valid while the instance `self` owns is alive.
        let params = unsafe { &*self.params_ext };

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
                written: std::slice::from_ref(&ctx.event),
            };
            let out_events = capture_host_write_events(&mut capture);
            // SAFETY: the extension's `flush`, matched as `Some`, on the live non-null
            // instance; `input_events`, `ctx`, `capture` and `out_events` are stack
            // values that outlive the call, matching what their callbacks dereference.
            unsafe { flush(self.plugin, &input_events, &out_events) };
        }
    }

    fn get_parameters(&self) -> Vec<PluginParameter> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            observe_vendor_call(fixture);
            return fixture.parameters.clone();
        }

        if self.params_ext.is_null() || self.plugin.is_null() {
            return vec![];
        }

        // SAFETY: non-null (checked above); `params_ext` is the plugin's own extension
        // struct from load, valid while the instance `self` owns is alive.
        let params = unsafe { &*self.params_ext };
        let count_fn = match params.count {
            Some(f) => f,
            None => return vec![],
        };
        let get_info_fn = match params.get_info {
            Some(f) => f,
            None => return vec![],
        };

        // SAFETY: the extension's `count`, matched as `Some`, on the live non-null
        // instance `self` owns.
        let count = unsafe { count_fn(self.plugin) };
        let mut result = Vec::with_capacity(count as usize);

        for i in 0..count {
            // SAFETY: `clap_param_info` is a C struct of integers, floats, char arrays
            // and a raw pointer, for all of which all-zero bytes are valid.
            let mut info: clap_param_info = unsafe { mem::zeroed() };
            // SAFETY: the extension's `get_info`, matched as `Some`, on the live
            // instance with `i < count` and a live, writable out-parameter.
            if !unsafe { get_info_fn(self.plugin, i, &mut info) } {
                continue;
            }

            // Skip hidden or read-only params
            if info.flags & CLAP_PARAM_IS_HIDDEN != 0 {
                continue;
            }

            // Read the current value
            let mut current_value = info.default_value;
            if let Some(get_value) = params.get_value {
                // SAFETY: the extension's `get_value`, matched as `Some`, on the live
                // instance for an id it just reported, with a live out-parameter.
                unsafe { get_value(self.plugin, info.id, &mut current_value) };
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
                display_text: self.parameter_value_text(info.id, current_value),
                step_count: clap_step_count(&info),
                is_list: info.flags & CLAP_PARAM_IS_ENUM != 0,
                is_read_only: is_readonly,
            });
        }

        result
    }

    fn parameter_value_text(&self, param_id: u32, value: f64) -> Option<String> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            observe_vendor_call(fixture);
            return fixture
                .parameters
                .iter()
                .find(|parameter| parameter.id == param_id)
                .and_then(|parameter| parameter.display_text.clone());
        }

        if self.params_ext.is_null() || self.plugin.is_null() {
            return None;
        }

        // SAFETY: non-null (checked above); `params_ext` is the plugin's own extension
        // struct from load, valid while the instance `self` owns is alive.
        let params = unsafe { &*self.params_ext };
        let value_to_text = params.value_to_text?;
        let mut buffer = [0 as std::os::raw::c_char; CLAP_PARAMETER_TEXT_CAPACITY];
        // SAFETY: the extension's `value_to_text`, matched as `Some`, on the live
        // instance with a writable buffer of the capacity passed beside it.
        let answered = unsafe {
            value_to_text(
                self.plugin,
                param_id,
                value,
                buffer.as_mut_ptr(),
                CLAP_PARAMETER_TEXT_CAPACITY as u32,
            )
        };
        if !answered {
            return None;
        }
        bounded_parameter_name(&buffer).filter(|text| !text.is_empty())
    }

    /// The plugin's saved state, or its refusal to produce one.
    ///
    /// A plugin that implements no state extension has no state, and empty is
    /// the true answer for it. A plugin whose `save` fails has state it would not
    /// give, and answering empty there tells the project it saved when it did
    /// not.
    fn get_state(&self) -> Result<Vec<u8>, PluginError> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            observe_vendor_call(fixture);
            return Ok(fixture.state.clone());
        }

        if self.state_ext.is_null() || self.plugin.is_null() {
            return Ok(vec![]);
        }

        // SAFETY: non-null (checked above); `state_ext` is the plugin's own extension
        // struct from load, valid while the instance `self` owns is alive.
        let state = unsafe { &*self.state_ext };
        let Some(save_fn) = state.save else {
            return Ok(vec![]);
        };

        let mut buffer: Vec<u8> = Vec::new();
        let ostream = clap_ostream {
            ctx: &mut buffer as *mut Vec<u8> as *mut c_void,
            write: Some(ostream_write),
        };

        // SAFETY: the extension's `save`, matched as `Some`, on the live non-null
        // instance; `ostream` and the `buffer` its `ctx` names outlive the call.
        if !unsafe { save_fn(self.plugin, &ostream) } {
            return Err(ClapError::StateSaveRefused {
                name: self.name.clone(),
            }
            .into());
        }
        Ok(buffer)
    }

    fn set_state(&mut self, state_data: &[u8]) -> Result<(), PluginError> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_mut() {
            observe_vendor_call(fixture);
            fixture.state = state_data.to_vec();
            return Ok(());
        }

        if self.state_ext.is_null() || self.plugin.is_null() {
            return Ok(());
        }

        {
            // SAFETY: non-null (checked above); `state_ext` is the plugin's own
            // extension struct from load, valid while the instance `self` owns is alive.
            let state = unsafe { &*self.state_ext };
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

            // SAFETY: the extension's `load`, matched as `Some`, on the live non-null
            // instance; `istream` and the `cursor` its `ctx` names outlive the call.
            let loaded = unsafe { load_fn(self.plugin, &istream) };
            state_load_result(&self.name, loaded)?;
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

    fn open_gui(&mut self, handle_ptr: *mut c_void) -> Result<(u32, u32), PluginError> {
        Ok(ClapWrapper::open_gui(self, handle_ptr)?)
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

    fn set_editor_window(&mut self, window: SharedEditorWindow) {
        ClapWrapper::set_editor_window(self, window)
    }

    fn editor_window_with_pending_asks(&self) -> Option<SharedEditorWindow> {
        ClapWrapper::editor_window_with_pending_asks(self)
    }

    fn take_editor_window_asks(&mut self) -> Option<(EditorWindowAsks, SharedEditorWindow)> {
        ClapWrapper::take_editor_window_asks(self)
    }

    fn answer_editor_window_asks(&mut self, asks: EditorWindowAsks) {
        ClapWrapper::answer_editor_window_asks(self, asks)
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
    /// Read once at load; the note port list may only change while the plugin
    /// is deactivated, and an instance never goes back to deactivated once
    /// loaded.
    ///
    /// This answer is forwarded, not consulted: no engine site routes by it.
    /// The scheduler drains timed notes to every native slot's
    /// `process_with_events` with no capability branch, and `native_bridge`
    /// only stores and forwards the value — so a plugin that declares no note
    /// input (an EQ, an analyzer) is still handed whatever events the engine
    /// drains. The VST3 wrapper is the one wrapper that gates its own event
    /// staging on its bus answer. Routing by this answer is a decision the
    /// engine does not make yet; if it ever does, that behaviour change
    /// belongs with #3124 (#3907).
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

    fn request_editor_size(&mut self, width: u32, height: u32) -> Result<(u32, u32), PluginError> {
        Ok(ClapWrapper::request_editor_size(self, width, height)?)
    }

    fn apply_editor_content_scale(&mut self, scale: f64) -> Result<(u32, u32), PluginError> {
        Ok(ClapWrapper::apply_editor_content_scale(self, scale)?)
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

    fn poll_latency_change(&mut self) -> Result<Option<u32>, PluginError> {
        Ok(ClapWrapper::poll_latency_change(self)?)
    }

    fn service_main_thread_callback(&mut self) {
        ClapWrapper::service_main_thread_callback(self)
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

    fn is_tail_active(&self) -> bool {
        ClapWrapper::is_tail_active(self)
    }

    fn take_tail_change(&mut self) -> Option<u32> {
        ClapWrapper::take_tail_change(self)
    }

    fn report_plugin_observations(&mut self) {
        ClapWrapper::report_plugin_observations(self)
    }

    fn has_failed_a_process_call(&self) -> bool {
        self.process_refused
    }

    fn has_passed_a_block_unprocessed(&self) -> bool {
        self.processing_start_refused
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

        // Out of the editor pump before any teardown, and waiting out a pass
        // already inside this instance: a pass calls `on_timer` and `on_fd`,
        // which must not overlap `destroy`. The run loop itself lives on in
        // `host_state` until the fields drop, after `destroy`.
        #[cfg(unix)]
        drop(self.run_loop_registration.take());

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
            // SAFETY: non-null (checked above); the instance `self` owns is still live,
            // since only the `destroy` below ends it.
            let plugin_ref = unsafe { &*self.plugin };

            if self.activated {
                if let Some(deactivate) = plugin_ref.deactivate {
                    // SAFETY: the instance's own callback, matched as `Some`, on an
                    // active instance whose processing was stopped just above.
                    unsafe { deactivate(self.plugin) };
                }
            }

            if let Some(destroy) = plugin_ref.destroy {
                // SAFETY: the instance's own callback, matched as `Some`, called once;
                // `plugin_ref` is not read after it, and drop never touches the
                // instance again.
                unsafe { destroy(self.plugin) };
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
            // SAFETY: a non-null `entry` is the initialised entry `new` loaded; the one
            // instance it made was handed to `destroy` above, and `_library` (a field,
            // dropped after this body) still has the DSO mapped.
            unsafe { deinit_entry(self.entry) };
        }
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
        let mut scratch = Vec::with_capacity(MAX_MIDI_EVENTS_PER_BLOCK);

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

    /// The scratch is reserved once and refilled in place. A caller breaking
    /// the seam's per-call bound cannot make it grow on the audio thread.
    #[test]
    fn a_caller_past_the_seams_bound_cannot_grow_the_scratch() {
        let mut scratch = Vec::with_capacity(MAX_MIDI_EVENTS_PER_BLOCK);
        let notes: Vec<HostMidiEvent> = (0..MAX_MIDI_EVENTS_PER_BLOCK + 4)
            .map(|index| host_note(60, 100, 0, true, index as u32))
            .collect();

        fill_note_scratch(&mut scratch, &notes);

        assert_eq!(scratch.len(), MAX_MIDI_EVENTS_PER_BLOCK);
        assert_eq!(scratch.capacity(), MAX_MIDI_EVENTS_PER_BLOCK);
    }

    // ── Event delivery at the engine's per-block capacity ───────────────

    /// One entry a plugin's `process` read from the host's input event list,
    /// in list order: the event type, the header's time, and the note key or
    /// the parameter id it addresses.
    type ReadEvent = (u16, u32, u32);

    /// What the reading stub saw on its last `process` call. Serialised by the
    /// lock below because tests run in parallel and this static is shared.
    static READ_EVENTS: std::sync::Mutex<Vec<ReadEvent>> = std::sync::Mutex::new(Vec::new());
    static EVENT_READ_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Read the whole input event list through the plugin-facing `size`/`get`
    /// pair, the way a plugin does. An entry the list will not hand back is
    /// recorded as type `u16::MAX`, so a short list cannot pass as a full one.
    unsafe extern "C" fn stub_process_reading_events(
        _plugin: *const clap_plugin,
        process: *const clap_process,
    ) -> i32 {
        let mut read = read_events();
        read.clear();
        // SAFETY: the host hands a live process struct for the length of this call.
        let in_events = unsafe { (*process).in_events };
        // SAFETY: and a live, non-null input event list inside it.
        let events = unsafe { &*in_events };
        let (Some(size), Some(get)) = (events.size, events.get) else {
            return CLAP_PROCESS_CONTINUE;
        };
        // SAFETY: the list's own `size`, matched as `Some`, on that live list.
        for index in 0..unsafe { size(events) } {
            // SAFETY: the list's own `get`, matched as `Some`, with `index < size`.
            let header = unsafe { get(events, index) };
            if header.is_null() {
                read.push((u16::MAX, 0, 0));
                continue;
            }
            // SAFETY: a non-null header `get` returns is live for this call.
            let type_ = unsafe { (*header).type_ };
            let addressed = match type_ {
                CLAP_EVENT_NOTE_ON | CLAP_EVENT_NOTE_OFF => {
                    // SAFETY: a note-typed header heads a `clap_event_note`.
                    (unsafe { (*(header as *const clap_event_note)).key }) as u32
                }
                // SAFETY: a param-value-typed header heads a `clap_event_param_value`.
                CLAP_EVENT_PARAM_VALUE => unsafe {
                    (*(header as *const clap_event_param_value)).param_id
                },
                _ => u32::MAX,
            };
            // SAFETY: the same live header as above.
            let type_ = unsafe { (*header).type_ };
            // SAFETY: the same live header as above.
            let time = unsafe { (*header).time };
            read.push((type_, time, addressed));
        }
        CLAP_PROCESS_CONTINUE
    }

    /// The read log, recovered from a poisoned lock so one failing case cannot
    /// turn the next into a poison panic that hides its own result.
    fn read_events() -> std::sync::MutexGuard<'static, Vec<ReadEvent>> {
        READ_EVENTS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn event_read_test_guard() -> std::sync::MutexGuard<'static, ()> {
        EVENT_READ_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn event_reading_wrapper() -> ClapWrapper {
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        plugin.process = Some(stub_process_reading_events);
        stub_wrapper(Box::into_raw(Box::new(plugin)) as *const clap_plugin)
    }

    /// A full engine block of notes: alternating on and off, each on its own
    /// key and frame, so a dropped, reordered or re-stamped event is visible.
    fn full_block_of_notes() -> Vec<HostMidiEvent> {
        (0..MAX_MIDI_EVENTS_PER_BLOCK as u32)
            .map(|index| host_note(index as u8, 100, 0, index % 2 == 0, index))
            .collect()
    }

    fn expected_notes(notes: &[HostMidiEvent]) -> Vec<ReadEvent> {
        notes
            .iter()
            .map(|note| {
                let type_ = if note.is_note_on {
                    CLAP_EVENT_NOTE_ON
                } else {
                    CLAP_EVENT_NOTE_OFF
                };
                (type_, note.frame_offset, u32::from(note.note))
            })
            .collect()
    }

    fn process_events(
        wrapper: &mut ClapWrapper,
        notes: &[HostMidiEvent],
        updates: &[HostParameterUpdate],
    ) {
        let silence = [0.0f32; 256];
        let mut out_l = [0.0f32; 256];
        let mut out_r = [0.0f32; 256];
        let inputs: [&[f32]; 2] = [&silence, &silence];
        let mut outputs: [&mut [f32]; 2] = [&mut out_l, &mut out_r];
        wrapper.process_with_midi_and_parameters(&inputs, &mut outputs, 256, notes, updates);
    }

    /// The slot hands a wrapper up to one engine block of events per call and
    /// then counts them delivered. Every one of them — the note-offs past the
    /// old 64-event cut included — must be in the list the plugin reads, in
    /// order, with its frame offset.
    #[test]
    fn every_event_of_a_full_engine_block_reaches_the_plugins_event_list() {
        let _guard = event_read_test_guard();
        let mut wrapper = event_reading_wrapper();
        let notes = full_block_of_notes();
        assert!(
            !notes[65].is_note_on,
            "the block carries a note-off past index 64"
        );

        process_events(&mut wrapper, &notes, &[]);

        assert_eq!(*read_events(), expected_notes(&notes));
    }

    /// Parameter values and notes share one list. A block full of both must
    /// hand the plugin all of each — parameters first, at the block's head,
    /// then every note — with neither crowding the other out.
    #[test]
    fn a_full_block_of_parameters_and_notes_reaches_the_plugin_whole() {
        let _guard = event_read_test_guard();
        let mut wrapper = event_reading_wrapper();
        let notes = full_block_of_notes();
        let updates: Vec<HostParameterUpdate> = (0..MAX_PARAMETER_EVENTS as u32)
            .map(|param_id| HostParameterUpdate {
                param_id: 1_000 + param_id,
                value: 0.5,
                sample_offset: 0,
            })
            .collect();

        process_events(&mut wrapper, &notes, &updates);

        let mut expected: Vec<ReadEvent> = updates
            .iter()
            .map(|update| (CLAP_EVENT_PARAM_VALUE, 0, update.param_id))
            .collect();
        expected.extend(expected_notes(&notes));
        assert_eq!(*read_events(), expected);
    }

    /// A parameter update's sample offset becomes its header's `time`, and
    /// parameter values and notes are merged into one list in non-decreasing
    /// time, as CLAP requires of `in_events`. At one time a parameter value is
    /// read ahead of a note, so a note sounds with the value written for its
    /// own sample. Two points for one parameter both reach the plugin, in order.
    #[test]
    fn parameter_values_and_notes_reach_the_plugin_merged_in_time_order() {
        let _guard = event_read_test_guard();
        let mut wrapper = event_reading_wrapper();
        let notes = [
            host_note(60, 100, 0, true, 10),
            host_note(60, 0, 0, false, 100),
        ];
        let updates = [
            HostParameterUpdate {
                param_id: 4,
                value: 0.2,
                sample_offset: 10,
            },
            HostParameterUpdate {
                param_id: 4,
                value: 0.8,
                sample_offset: 200,
            },
        ];

        process_events(&mut wrapper, &notes, &updates);

        assert_eq!(
            *read_events(),
            vec![
                (CLAP_EVENT_PARAM_VALUE, 10, 4),
                (CLAP_EVENT_NOTE_ON, 10, 60),
                (CLAP_EVENT_NOTE_OFF, 100, 60),
                (CLAP_EVENT_PARAM_VALUE, 200, 4),
            ]
        );
    }

    /// Merging a full block of parameter values and notes into one time-ordered
    /// list fills the order scratch to its bound, and it was reserved when the
    /// wrapper was built: the block allocates nothing. Measured with the
    /// crate's per-thread counting allocator over the first `process` call.
    /// Mutation: build the wrapper with a zero-capacity `event_order_scratch`
    /// — the merge allocates on the audio thread.
    #[test]
    fn a_full_merged_block_performs_no_heap_allocation() {
        let _guard = event_read_test_guard();
        let mut wrapper = event_reading_wrapper();
        let notes = full_block_of_notes();
        let updates: Vec<HostParameterUpdate> = (0..MAX_PARAMETER_EVENTS as u32)
            .map(|param_id| HostParameterUpdate {
                param_id: 1_000 + param_id,
                value: 0.5,
                sample_offset: (param_id * 3) % 256,
            })
            .collect();
        // The stub's own log grows with the events it reads; reserving it here
        // keeps that growth out of the count without a warm-up block, which
        // would also grow the order scratch and hide an unreserved one.
        read_events().reserve(MAX_PARAMETER_EVENTS + MAX_MIDI_EVENTS_PER_BLOCK);

        let before = crate::allocation_counter::allocation_count();
        process_events(&mut wrapper, &notes, &updates);
        let after = crate::allocation_counter::allocation_count();

        assert_eq!(
            read_events().len(),
            MAX_PARAMETER_EVENTS + MAX_MIDI_EVENTS_PER_BLOCK,
            "the measured block was not the full one"
        );
        assert_eq!(
            after - before,
            0,
            "the merged block allocated {} times",
            after - before
        );
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
        // SAFETY: the host only queries with a NUL-terminated `CLAP_EXT_*` id.
        let id = unsafe { CStr::from_ptr(id) };
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
            // SAFETY: a test stores here the address of a wrapper's boxed
            // `HostCallbackState`, which outlives every activation it triggers.
            unsafe { (*(target as *const HostCallbackState)).mark_latency_dirty() };
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
                // SAFETY: a test stores here the address of a wrapper's boxed
                // `HostCallbackState`, which outlives every activation it triggers.
                unsafe { (*(target as *const HostCallbackState)).mark_latency_dirty() };
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
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
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
        // SAFETY: every caller passes a leaked, boxed stub `clap_plugin`, live for
        // the rest of the test process.
        let plugin_ref = unsafe { &*plugin };
        // SAFETY: a sound stub instance and the struct CLAP defines for the id.
        let latency_ext = unsafe {
            ClapWrapper::query_extension::<clap_plugin_latency>(plugin_ref, CLAP_EXT_LATENCY)
        };
        // Queried the same way the loader does, so a stub that declares
        // `clap.tail` is hosted exactly as a real plugin declaring it would be.
        // SAFETY: as above — the live stub instance, matching `T` for the id.
        let tail_ext =
            unsafe { ClapWrapper::query_extension::<clap_plugin_tail>(plugin_ref, CLAP_EXT_TAIL) };
        // Mirrors what a successful load leaves behind: activated, and asking to
        // process as soon as the audio thread next runs the plugin.
        let processing = Arc::new(ProcessingGate::default());
        processing.request_start();
        ClapWrapper {
            _library: None,
            entry: ptr::null(),
            plugin,
            _host: Box::new(create_host_descriptor()),
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
            editor_window: None,
            #[cfg(unix)]
            run_loop_registration: None,
            processing,
            transport_scratch: Box::new(empty_transport_event()),
            has_transport: false,
            steady_time: 0,
            tail_mode_reported: false,
            process_refused: false,
            processing_start_refused: false,
            process_refusal_reported: false,
            audio,
            // Derived from the stub's own descriptor, the way the loader
            // derives it, so a stub declaring `instrument` is hosted exactly as
            // a real plugin declaring it would be.
            // SAFETY: `plugin` is the live stub instance; its `desc` is null or a
            // leaked stub descriptor.
            is_instrument: unsafe { descriptor_declares_instrument(plugin) },
            accepts_note_events: true,
            editor_content_scale: crate::traits::DEFAULT_EDITOR_CONTENT_SCALE,
            midi_scratch: Vec::with_capacity(MAX_MIDI_EVENTS_PER_BLOCK),
            parameter_scratch: Vec::with_capacity(MAX_PARAMETER_EVENTS),
            event_order_scratch: event_order_scratch(),
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
        // SAFETY: a null extension and the live leaked stub instance.
        assert_eq!(unsafe { read_latency_ext(ptr::null(), plugin) }, 0);

        // After wiring: query the extension the stub advertises, then read it.
        // SAFETY: `plugin` is a leaked boxed stub, live for the test process.
        let plugin_ref = unsafe { &*plugin };
        // SAFETY: the live stub instance, and the struct CLAP defines for the id.
        let ext = unsafe {
            ClapWrapper::query_extension::<clap_plugin_latency>(plugin_ref, CLAP_EXT_LATENCY)
        };
        assert!(!ext.is_null(), "stub advertises CLAP_EXT_LATENCY");

        STUB_LATENCY.store(0, Ordering::Relaxed);
        // SAFETY: the stub's static latency extension and its live instance.
        assert_eq!(unsafe { read_latency_ext(ext, plugin) }, 0);
        STUB_LATENCY.store(512, Ordering::Relaxed);
        // SAFETY: the stub's static latency extension and its live instance.
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

    /// The `[thread-safe]` route: a restart recorded through the wait-free
    /// entry — no channel wake, only the flag and the hint — must be serviced
    /// by the same poll a channel wake feeds. Deleting the notify here is not
    /// the fix; this is the serviceability half of #3745.
    #[test]
    fn a_thread_safe_restart_recorded_without_a_wake_is_still_serviced_by_the_poll() {
        let _guard = LATENCY_TEST_LOCK.lock().unwrap();
        let _hint_guard = crate::clap_host::LATENCY_REQUERY_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        STUB_LATENCY.store(512, Ordering::Relaxed);
        crate::clap_host::take_pending_latency_requery_signal();
        let mut wrapper = stub_wrapper(stub_plugin_ptr());

        wrapper.host_state.flag_latency_requery();

        assert!(
            crate::clap_host::take_pending_latency_requery_signal(),
            "the wait-free hint is raised for the control path"
        );
        assert_eq!(
            wrapper.poll_latency_change().expect("the re-query runs"),
            Some(512),
            "the recorded restart is serviced: latency is re-read"
        );
        assert!(
            !wrapper.host_state.take_latency_dirty(),
            "the flag the restart left behind is consumed by servicing it"
        );
    }

    // ── on_main_thread servicing (#3746) ───────────────────────────────────

    /// How many times a stub plugin's `on_main_thread` ran. Shared because the
    /// stub must be a leaked C descriptor; serialised by the lock below.
    static MAIN_THREAD_CALLBACKS: AtomicUsize = AtomicUsize::new(0);
    static MAIN_THREAD_CALLBACK_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    unsafe extern "C" fn stub_on_main_thread(_plugin: *const clap_plugin) {
        MAIN_THREAD_CALLBACKS.fetch_add(1, Ordering::Relaxed);
    }

    /// A leaked stub `clap_plugin` that declares `on_main_thread`, the core
    /// descriptor entry a conforming plugin relies on. Leaked so the pointer
    /// outlives the test.
    fn main_thread_stub_plugin_ptr() -> *const clap_plugin {
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        plugin.on_main_thread = Some(stub_on_main_thread);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    /// Pin a stub wrapper's per-instance host state into its host descriptor,
    /// exactly as the loader does before the plugin is created, so the
    /// plugin's own callbacks find it through `host_data`.
    fn pin_host_state(wrapper: &mut ClapWrapper) {
        wrapper._host.host_data = (&*wrapper.host_state as *const HostCallbackState) as *mut c_void;
    }

    /// The issue's own repro: a plugin raises `request_callback` — twice, to
    /// prove coalescing — and a control visit services the ask. The callback
    /// used to be a no-op, so the counter stayed at zero forever and the
    /// plugin's deferred main-thread work never completed.
    #[test]
    fn a_request_callback_ask_reaches_on_main_thread_once_per_service() {
        let _guard = MAIN_THREAD_CALLBACK_TEST_LOCK.lock().unwrap();
        // The callback raises the process-wide hint, which other tests assert.
        let _signal_guard = crate::clap_host::MAIN_THREAD_CALLBACK_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        MAIN_THREAD_CALLBACKS.store(0, Ordering::Relaxed);
        let mut wrapper = stub_wrapper(main_thread_stub_plugin_ptr());
        pin_host_state(&mut wrapper);

        // Through the descriptor, the only route a real plugin has.
        let request_callback = wrapper
            ._host
            .request_callback
            .expect("the host descriptor installs request_callback");
        // SAFETY: the descriptor's own callback, called with that live boxed
        // descriptor, whose `host_data` was pinned to this wrapper's state above.
        unsafe { request_callback(&*wrapper._host) };
        // SAFETY: as above.
        unsafe { request_callback(&*wrapper._host) };

        wrapper.service_main_thread_callback();
        assert_eq!(
            MAIN_THREAD_CALLBACKS.load(Ordering::Relaxed),
            1,
            "a burst of asks coalesces into one on_main_thread call"
        );

        // Nothing left pending: a second visit with no ask behind it is a
        // no-op, so one restart cannot loop.
        wrapper.service_main_thread_callback();
        assert_eq!(MAIN_THREAD_CALLBACKS.load(Ordering::Relaxed), 1);

        // A fresh ask is recorded and serviced in its turn.
        // SAFETY: as above — the live, pinned host descriptor.
        unsafe { request_callback(&*wrapper._host) };
        wrapper.service_main_thread_callback();
        assert_eq!(MAIN_THREAD_CALLBACKS.load(Ordering::Relaxed), 2);
    }

    /// A service visit with no ask behind it must not call the plugin: the
    /// carrier drains on schedule, and the plugin's `on_main_thread` is
    /// contract work it is owed only for the asks it raised.
    #[test]
    fn a_service_visit_with_no_pending_ask_does_not_call_the_plugin() {
        let _guard = MAIN_THREAD_CALLBACK_TEST_LOCK.lock().unwrap();
        MAIN_THREAD_CALLBACKS.store(0, Ordering::Relaxed);
        let mut wrapper = stub_wrapper(main_thread_stub_plugin_ptr());

        wrapper.service_main_thread_callback();

        assert_eq!(
            MAIN_THREAD_CALLBACKS.load(Ordering::Relaxed),
            0,
            "nothing was asked for, so nothing ran"
        );
    }

    #[test]
    fn poll_latency_change_swallows_a_flag_its_own_reactivation_provoked() {
        let _guard = LATENCY_TEST_LOCK.lock().unwrap();
        STUB_LATENCY.store(64, Ordering::Relaxed);

        // A plugin that re-flags from inside activate() — without the post-poll
        // clear this schedules an endless reactivate/re-query loop.
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
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

        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
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
        assert!(state_load_result("fixture", true).is_ok());
    }

    #[test]
    fn state_load_result_returns_error_when_clap_load_fails() {
        let refusal = state_load_result("fixture", false).expect_err("load returned false");

        assert!(matches!(&refusal, ClapError::StateLoadFailed { name } if name == "fixture"));
        assert_eq!(
            refusal.to_string(),
            "[CLAP] state.load() failed for fixture"
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
        // SAFETY: `plugin` came from `Box::into_raw` in a recording `create_plugin`,
        // and the host calls `destroy` once per instance.
        drop(unsafe { Box::from_raw(plugin as *mut clap_plugin) });
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

        // SAFETY: a static fake entry with no `init` to have run, live for the process.
        let wrapper = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const RECORDING_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
                ProcessMode::Realtime,
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

        // SAFETY: a static fake entry with no `init` to have run, live for the process.
        let error = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const NULL_FACTORY_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
                ProcessMode::Realtime,
            )
        }
        .err()
        .expect("an entry whose factory query returns null must not load");

        assert!(matches!(error, ClapError::NullFactory));
        assert_eq!(error.to_string(), "Plugin factory is null");
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

        // SAFETY: a static fake entry with no `init` to have run, live for the process.
        let error = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const FAILING_PLUGIN_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
                ProcessMode::Realtime,
            )
        }
        .err()
        .expect("a plugin whose init returns false must not load");

        assert!(matches!(error, ClapError::PluginInitFailed));
        assert_eq!(error.to_string(), "plugin.init() returned false");
        assert_eq!(
            entry_lifecycle(),
            ["plugin_destroy", "entry_deinit"],
            "the deepest early return still destroys the half-built instance and deinits"
        );
    }

    unsafe extern "C" fn one_audio_port_count(_plugin: *const clap_plugin, _is_input: bool) -> u32 {
        1
    }

    unsafe extern "C" fn failing_audio_port_get(
        _plugin: *const clap_plugin,
        _index: u32,
        _is_input: bool,
        _info: *mut clap_audio_port_info,
    ) -> bool {
        false
    }

    static UNREADABLE_AUDIO_PORTS: clap_plugin_audio_ports = clap_plugin_audio_ports {
        count: Some(one_audio_port_count),
        get: Some(failing_audio_port_get),
    };

    unsafe extern "C" fn unreadable_ports_get_extension(
        _plugin: *const clap_plugin,
        id: *const i8,
    ) -> *const c_void {
        // SAFETY: the host only queries with a NUL-terminated `CLAP_EXT_*` id.
        if unsafe { CStr::from_ptr(id) } == CLAP_EXT_AUDIO_PORTS {
            return &raw const UNREADABLE_AUDIO_PORTS as *const c_void;
        }
        ptr::null()
    }

    /// A recording plugin that initialises but whose port list cannot be read.
    unsafe extern "C" fn unreadable_ports_create_plugin(
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
            get_extension: Some(unreadable_ports_get_extension),
            on_main_thread: None,
        }))
    }

    static UNREADABLE_PORTS_FACTORY: clap_plugin_factory = clap_plugin_factory {
        get_plugin_count: None,
        get_plugin_descriptor: None,
        create_plugin: Some(unreadable_ports_create_plugin),
    };

    unsafe extern "C" fn unreadable_ports_get_factory(_factory_id: *const i8) -> *const c_void {
        &raw const UNREADABLE_PORTS_FACTORY as *const c_void
    }

    static UNREADABLE_PORTS_ENTRY: clap_plugin_entry = clap_plugin_entry {
        clap_version: CLAP_VERSION,
        init: None,
        deinit: Some(recording_entry_deinit),
        get_factory: Some(unreadable_ports_get_factory),
    };

    #[test]
    fn defect_6764_an_unreadable_port_layout_destroys_the_instance_before_deinit() {
        let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
        clear_entry_lifecycle();

        // SAFETY: a static fake entry with no `init` to have run, live for the process.
        let error = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const UNREADABLE_PORTS_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
                ProcessMode::Realtime,
            )
        }
        .err()
        .expect("a plugin whose port list cannot be read must not load");

        assert!(matches!(
            error,
            ClapError::AudioPortNoInfo {
                direction: PortDirection::Input,
                index: 0
            }
        ));
        assert_eq!(
            error.to_string(),
            "CLAP input audio port 0 returned no port info"
        );
        assert_eq!(
            entry_lifecycle(),
            ["plugin_init", "plugin_destroy", "entry_deinit"],
            "the initialised instance is destroyed once, before the entry deinits"
        );
    }

    #[test]
    fn defect_6764_a_null_stream_write_forms_no_slice_and_refuses_a_nonzero_size() {
        let mut written: Vec<u8> = Vec::new();
        let ostream = clap_ostream {
            ctx: &mut written as *mut Vec<u8> as *mut c_void,
            write: Some(ostream_write),
        };

        // SAFETY: `ostream` is a live stream whose `ctx` is `written`; a null buffer is
        // exactly the plugin input under test.
        let empty = unsafe { ostream_write(&ostream, ptr::null(), 0) };
        // SAFETY: as above.
        let refused = unsafe { ostream_write(&ostream, ptr::null(), 3) };

        assert_eq!(
            (empty, refused),
            (0, -1),
            "zero bytes write nothing; a null buffer claiming bytes is an error"
        );
        assert!(written.is_empty(), "no byte may be read from a null buffer");
    }

    #[test]
    fn defect_6764_a_null_stream_read_forms_no_slice_and_refuses_a_nonzero_size() {
        let mut cursor = StreamCursor {
            data: vec![1, 2, 3],
            pos: 0,
        };
        let istream = clap_istream {
            ctx: &mut cursor as *mut StreamCursor as *mut c_void,
            read: Some(istream_read),
        };

        // SAFETY: `istream` is a live stream whose `ctx` is `cursor`; a null buffer is
        // exactly the plugin input under test.
        let empty = unsafe { istream_read(&istream, ptr::null_mut(), 0) };
        // SAFETY: as above.
        let refused = unsafe { istream_read(&istream, ptr::null_mut(), 3) };

        assert_eq!(
            (empty, refused),
            (0, -1),
            "zero bytes read nothing; a null destination claiming room is an error"
        );
        assert_eq!(cursor.pos, 0, "a refused read consumes no state bytes");
    }

    #[test]
    fn each_instance_of_an_entry_deinits_once_from_its_own_drop() {
        let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
        clear_entry_lifecycle();

        // SAFETY: a static fake entry with no `init` to have run, live for the process.
        let first = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const RECORDING_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
                ProcessMode::Realtime,
            )
        }
        .expect("the recording fake loads");
        // SAFETY: as above — the static fake entry.
        let second = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const RECORDING_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
                ProcessMode::Realtime,
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

    // ── Offline construction through clap.render ────────────────────────

    const RENDER_ACCEPTING_PLUGIN_ID: &str = "org.sourdaw.test.render-accepting";
    const RENDER_REFUSING_PLUGIN_ID: &str = "org.sourdaw.test.render-refusing";

    unsafe extern "C" fn render_no_hard_requirement(_plugin: *const clap_plugin) -> bool {
        false
    }

    unsafe extern "C" fn render_set_accepting(
        _plugin: *const clap_plugin,
        mode: clap_sys::ext::render::clap_plugin_render_mode,
    ) -> bool {
        if mode == CLAP_RENDER_OFFLINE {
            record_lifecycle_call("render_set_offline");
        }
        true
    }

    unsafe extern "C" fn render_set_refusing(
        _plugin: *const clap_plugin,
        _mode: clap_sys::ext::render::clap_plugin_render_mode,
    ) -> bool {
        record_lifecycle_call("render_set_refused");
        false
    }

    static ACCEPTING_RENDER: clap_plugin_render = clap_plugin_render {
        has_hard_realtime_requirement: Some(render_no_hard_requirement),
        set: Some(render_set_accepting),
    };

    static REFUSING_RENDER: clap_plugin_render = clap_plugin_render {
        has_hard_realtime_requirement: Some(render_no_hard_requirement),
        set: Some(render_set_refusing),
    };

    unsafe extern "C" fn accepting_render_get_extension(
        _plugin: *const clap_plugin,
        id: *const i8,
    ) -> *const c_void {
        // SAFETY: the host passes a NUL-terminated extension id.
        if unsafe { CStr::from_ptr(id) } == CLAP_EXT_RENDER {
            return &raw const ACCEPTING_RENDER as *const c_void;
        }
        ptr::null()
    }

    unsafe extern "C" fn refusing_render_get_extension(
        _plugin: *const clap_plugin,
        id: *const i8,
    ) -> *const c_void {
        // SAFETY: the host passes a NUL-terminated extension id.
        if unsafe { CStr::from_ptr(id) } == CLAP_EXT_RENDER {
            return &raw const REFUSING_RENDER as *const c_void;
        }
        ptr::null()
    }

    /// A recording plugin whose `clap.render` accepts or refuses offline
    /// rendering, chosen by the id the host asks for.
    unsafe extern "C" fn render_create_plugin(
        _factory: *const clap_plugin_factory,
        _host: *const clap_host,
        plugin_id: *const i8,
    ) -> *const clap_plugin {
        let get_extension =
            // SAFETY: the host passes a NUL-terminated plugin id.
            if unsafe { CStr::from_ptr(plugin_id) }.to_bytes() == RENDER_REFUSING_PLUGIN_ID.as_bytes() {
                refusing_render_get_extension
            } else {
                accepting_render_get_extension
            };
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
            get_extension: Some(get_extension),
            on_main_thread: None,
        }))
    }

    static RENDER_FACTORY: clap_plugin_factory = clap_plugin_factory {
        get_plugin_count: None,
        get_plugin_descriptor: None,
        create_plugin: Some(render_create_plugin),
    };

    unsafe extern "C" fn render_get_factory(_factory_id: *const i8) -> *const c_void {
        &raw const RENDER_FACTORY as *const c_void
    }

    static RENDER_ENTRY: clap_plugin_entry = clap_plugin_entry {
        clap_version: CLAP_VERSION,
        init: None,
        deinit: Some(recording_entry_deinit),
        get_factory: Some(render_get_factory),
    };

    fn load_render_fake(plugin_id: &str, mode: ProcessMode) -> Result<ClapWrapper, ClapError> {
        // SAFETY: `RENDER_ENTRY` is a static fake entry with no `init` to have run,
        // live for the process, so it satisfies the "initialised entry" contract.
        unsafe {
            ClapWrapper::load_initialized_entry(&raw const RENDER_ENTRY, plugin_id, 48_000.0, mode)
        }
    }

    #[test]
    fn an_offline_load_sets_offline_rendering_before_activating() {
        let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
        clear_entry_lifecycle();

        let wrapper = load_render_fake(RENDER_ACCEPTING_PLUGIN_ID, ProcessMode::Offline)
            .expect("a plugin accepting offline rendering loads offline");

        assert_eq!(
            entry_lifecycle(),
            ["plugin_init", "render_set_offline", "plugin_activate"],
            "clap.render's mode is a [main-thread & !active] call, so it precedes activation"
        );
        drop(wrapper);
    }

    #[test]
    fn a_realtime_load_never_tells_the_plugin_a_render_mode() {
        let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
        clear_entry_lifecycle();

        let wrapper = load_render_fake(RENDER_ACCEPTING_PLUGIN_ID, ProcessMode::Realtime)
            .expect("the plugin loads realtime");

        assert_eq!(entry_lifecycle(), ["plugin_init", "plugin_activate"]);
        drop(wrapper);
    }

    #[test]
    fn a_plugin_refusing_offline_rendering_is_refused_by_name_and_torn_down() {
        let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
        clear_entry_lifecycle();

        let error = load_render_fake(RENDER_REFUSING_PLUGIN_ID, ProcessMode::Offline)
            .err()
            .expect("a plugin whose render.set refuses offline must not load offline");

        assert!(matches!(&error, ClapError::OfflineRefused { .. }));
        assert_eq!(
            error.to_string(),
            format!("[CLAP] '{RENDER_REFUSING_PLUGIN_ID}' refused to render offline")
        );
        assert_eq!(
            entry_lifecycle(),
            [
                "plugin_init",
                "render_set_refused",
                "plugin_destroy",
                "entry_deinit"
            ],
            "the refused instance is destroyed unactivated and its entry still deinits"
        );
    }

    #[test]
    fn a_plugin_without_clap_render_loads_offline_unchanged() {
        let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
        clear_entry_lifecycle();

        // SAFETY: a static fake entry with no `init` to have run, live for the process.
        let wrapper = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const RECORDING_ENTRY,
                LIFECYCLE_PLUGIN_ID,
                48_000.0,
                ProcessMode::Offline,
            )
        }
        .expect("a plugin that does not distinguish modes loads offline");

        assert!(wrapper.is_activated());
        assert_eq!(entry_lifecycle(), ["plugin_init", "plugin_activate"]);
    }

    // ── Construction exits and the editor pump (#6736) ──────────────────
    //
    // Every way a load can fail once an instance exists, and the success path
    // for contrast. Each row's fake records its lifecycle calls and the thread
    // `destroy` ran on, and keeps a weak handle on the instance's run loop:
    // once the load has returned an error, nothing — the pump least of all —
    // may still hold it.

    #[cfg(unix)]
    mod construction_exits {
        use super::*;
        use crate::clap_run_loop::ClapRunLoop;
        use crate::editor_run_loop::{is_pumped, ServicedRunLoop};
        use std::sync::{Mutex, Weak};
        use std::thread::ThreadId;

        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        enum Exit {
            Loads,
            InitFails,
            PortsUnreadable,
            RequiresRealtime,
            RefusesOffline,
        }

        static EXIT: Mutex<Exit> = Mutex::new(Exit::Loads);
        static RUN_LOOP: Mutex<Option<Weak<ClapRunLoop>>> = Mutex::new(None);
        static DESTROYED_ON: Mutex<Option<ThreadId>> = Mutex::new(None);
        /// Whether the instance was still in the editor pump when `destroy` ran.
        static PUMPED_AT_DESTROY: Mutex<Option<bool>> = Mutex::new(None);

        fn exit() -> Exit {
            *EXIT.lock().unwrap()
        }

        /// Keep a weak handle on the run loop of the instance being initialised,
        /// reached the way a plugin reaches its host: through `host_data`.
        unsafe extern "C" fn observing_init(plugin: *const clap_plugin) -> bool {
            record_lifecycle_call("plugin_init");
            // SAFETY: `plugin` is the fake `observing_create_plugin` built, whose
            // `plugin_data` is the live host the factory was handed.
            let host = unsafe { (*plugin).plugin_data } as *const clap_host;
            // SAFETY: the host the wrapper built, whose `host_data` is its pinned state.
            let state = unsafe { (*host).host_data } as *const HostCallbackState;
            // SAFETY: as above; the state outlives the instance.
            let run_loop = unsafe { &*state }.run_loop();
            run_loop.register_timer(10);
            *RUN_LOOP.lock().unwrap() = Some(Arc::downgrade(run_loop));
            exit() != Exit::InitFails
        }

        unsafe extern "C" fn observing_destroy(plugin: *const clap_plugin) {
            *DESTROYED_ON.lock().unwrap() = Some(std::thread::current().id());
            let pumped = observed_run_loop().is_some_and(|run_loop| {
                let run_loop: Arc<dyn ServicedRunLoop> = run_loop;
                is_pumped(&run_loop)
            });
            *PUMPED_AT_DESTROY.lock().unwrap() = Some(pumped);
            // SAFETY: the instance the host is destroying, from `Box::into_raw`.
            unsafe { recording_plugin_destroy(plugin) };
        }

        unsafe extern "C" fn hard_realtime(_plugin: *const clap_plugin) -> bool {
            true
        }

        static HARD_REALTIME_RENDER: clap_plugin_render = clap_plugin_render {
            has_hard_realtime_requirement: Some(hard_realtime),
            set: Some(render_set_accepting),
        };

        unsafe extern "C" fn observing_get_extension(
            _plugin: *const clap_plugin,
            id: *const i8,
        ) -> *const c_void {
            // SAFETY: the host passes a NUL-terminated extension id.
            let id = unsafe { CStr::from_ptr(id) };
            match exit() {
                Exit::PortsUnreadable if id == CLAP_EXT_AUDIO_PORTS => {
                    &raw const UNREADABLE_AUDIO_PORTS as *const c_void
                }
                Exit::RequiresRealtime if id == CLAP_EXT_RENDER => {
                    &raw const HARD_REALTIME_RENDER as *const c_void
                }
                Exit::RefusesOffline if id == CLAP_EXT_RENDER => {
                    &raw const REFUSING_RENDER as *const c_void
                }
                _ => ptr::null(),
            }
        }

        unsafe extern "C" fn observing_create_plugin(
            _factory: *const clap_plugin_factory,
            host: *const clap_host,
            _plugin_id: *const i8,
        ) -> *const clap_plugin {
            Box::into_raw(Box::new(clap_plugin {
                desc: ptr::null(),
                plugin_data: host.cast_mut().cast(),
                init: Some(observing_init),
                destroy: Some(observing_destroy),
                activate: Some(recording_plugin_activate),
                deactivate: Some(recording_plugin_deactivate),
                start_processing: None,
                stop_processing: None,
                reset: None,
                process: None,
                get_extension: Some(observing_get_extension),
                on_main_thread: None,
            }))
        }

        static OBSERVING_FACTORY: clap_plugin_factory = clap_plugin_factory {
            get_plugin_count: None,
            get_plugin_descriptor: None,
            create_plugin: Some(observing_create_plugin),
        };

        unsafe extern "C" fn observing_get_factory(_factory_id: *const i8) -> *const c_void {
            &raw const OBSERVING_FACTORY as *const c_void
        }

        static OBSERVING_ENTRY: clap_plugin_entry = clap_plugin_entry {
            clap_version: CLAP_VERSION,
            init: None,
            deinit: Some(recording_entry_deinit),
            get_factory: Some(observing_get_factory),
        };

        fn load(row: Exit, mode: ProcessMode) -> Result<ClapWrapper, ClapError> {
            *EXIT.lock().unwrap() = row;
            *RUN_LOOP.lock().unwrap() = None;
            *DESTROYED_ON.lock().unwrap() = None;
            *PUMPED_AT_DESTROY.lock().unwrap() = None;
            clear_entry_lifecycle();
            // SAFETY: a static fake entry with no `init` to have run, live for the process.
            unsafe {
                ClapWrapper::load_initialized_entry(
                    &raw const OBSERVING_ENTRY,
                    LIFECYCLE_PLUGIN_ID,
                    48_000.0,
                    mode,
                )
            }
        }

        fn observed_run_loop() -> Option<Arc<ClapRunLoop>> {
            RUN_LOOP.lock().unwrap().as_ref().and_then(Weak::upgrade)
        }

        #[test]
        fn every_failure_exit_destroys_before_deinit_on_the_loading_thread_and_leaves_no_pump_entry(
        ) {
            let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
            let rows: [(Exit, ProcessMode, &[&str]); 4] = [
                (
                    Exit::InitFails,
                    ProcessMode::Realtime,
                    &["plugin_init", "plugin_destroy", "entry_deinit"],
                ),
                (
                    Exit::PortsUnreadable,
                    ProcessMode::Realtime,
                    &["plugin_init", "plugin_destroy", "entry_deinit"],
                ),
                (
                    Exit::RequiresRealtime,
                    ProcessMode::Offline,
                    &["plugin_init", "plugin_destroy", "entry_deinit"],
                ),
                (
                    Exit::RefusesOffline,
                    ProcessMode::Offline,
                    &[
                        "plugin_init",
                        "render_set_refused",
                        "plugin_destroy",
                        "entry_deinit",
                    ],
                ),
            ];

            for (row, mode, lifecycle) in rows {
                let error = load(row, mode).err();
                let error = error.unwrap_or_else(|| panic!("{row:?} must not load"));
                let expected_error = match row {
                    Exit::InitFails => matches!(error, ClapError::PluginInitFailed),
                    Exit::PortsUnreadable => matches!(error, ClapError::AudioPortNoInfo { .. }),
                    Exit::RequiresRealtime => matches!(error, ClapError::RequiresRealtime { .. }),
                    Exit::RefusesOffline => matches!(error, ClapError::OfflineRefused { .. }),
                    Exit::Loads => false,
                };
                assert!(expected_error, "{row:?} failed as {error}");
                assert_eq!(entry_lifecycle(), lifecycle, "{row:?}");
                assert_eq!(
                    *DESTROYED_ON.lock().unwrap(),
                    Some(std::thread::current().id()),
                    "{row:?} destroys on the thread that loaded it"
                );
                assert_eq!(
                    *PUMPED_AT_DESTROY.lock().unwrap(),
                    Some(false),
                    "{row:?} never joined the pump"
                );
                assert!(
                    RUN_LOOP.lock().unwrap().is_some(),
                    "{row:?} reached init, so it had a run loop to leave behind"
                );
                assert!(
                    observed_run_loop().is_none(),
                    "{row:?} left its run loop alive — the pump still holds it"
                );
            }
        }

        #[test]
        fn a_loaded_instance_is_pumped_until_its_drop_and_then_released() {
            let _guard = ENTRY_LIFECYCLE_LOCK.lock().unwrap();
            let wrapper = load(Exit::Loads, ProcessMode::Realtime).expect("the fake loads");

            let run_loop: Arc<dyn ServicedRunLoop> =
                observed_run_loop().expect("a live instance keeps its run loop");
            assert!(
                is_pumped(&run_loop),
                "a constructed instance joins the pump"
            );
            drop(run_loop);

            drop(wrapper);
            assert_eq!(
                *PUMPED_AT_DESTROY.lock().unwrap(),
                Some(false),
                "the instance leaves the pump before it is destroyed"
            );
            assert_eq!(
                entry_lifecycle(),
                [
                    "plugin_init",
                    "plugin_activate",
                    "plugin_deactivate",
                    "plugin_destroy",
                    "entry_deinit",
                ]
            );
            assert!(
                observed_run_loop().is_none(),
                "a dropped instance leaves the pump"
            );
        }
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

    /// An instance the host never installed a wake on — one loaded before the
    /// native engine ran — still has its editor drain, so a resize its window
    /// can take is accepted and applied rather than refused.
    #[test]
    fn an_editor_resize_is_applied_with_a_window_and_no_wake_installed() {
        let _guard = RESIZE_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut wrapper = stub_wrapper(stub_plugin_ptr());
        wrapper.set_editor_window_resizer(Arc::new(|_, _| {}));

        assert!(wrapper.host_state.request_editor_resize(1024, 768));
        assert_eq!(wrapper.apply_pending_editor_resize(), Some((1024, 768)));
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
        // SAFETY: the host hands a live process struct for the length of this call.
        let transport = unsafe { (*process).transport };
        let captured = if transport.is_null() {
            CapturedTransport::default()
        } else {
            // SAFETY: a non-null transport is the wrapper's boxed scratch event,
            // live and not written while `process` runs.
            let transport = unsafe { &*transport };
            CapturedTransport {
                present: true,
                flags: transport.flags,
                tempo: transport.tempo,
                tsig_num: transport.tsig_num,
                tsig_denom: transport.tsig_denom,
                song_pos_beats: transport.song_pos_beats,
                song_pos_seconds: transport.song_pos_seconds,
            }
        };
        *CAPTURED_TRANSPORT.lock().unwrap() = Some(captured);
        CLAP_PROCESS_CONTINUE
    }

    /// A stub that counts its processing transitions and records the transport
    /// it was handed, so a test can tell which thread drove each transition.
    fn counting_plugin_ptr() -> *const clap_plugin {
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
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

        // SAFETY: a leaked, never-activated stub instance.
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
        // SAFETY: the host hands a live process struct, unwritten for this call.
        let process = unsafe { &*process };
        let captured = CapturedBuffers {
            input_count: process.audio_inputs_count,
            output_count: process.audio_outputs_count,
            first_input_channels: if process.audio_inputs_count > 0 {
                // SAFETY: a non-zero count means `audio_inputs` heads that many rows.
                unsafe { (*process.audio_inputs).channel_count }
            } else {
                0
            },
            first_output_channels: if process.audio_outputs_count > 0 {
                // SAFETY: a non-zero count means `audio_outputs` heads that many rows.
                unsafe { (*process.audio_outputs).channel_count }
            } else {
                0
            },
            second_input_channels: if process.audio_inputs_count > 1 {
                // SAFETY: a count above one means row 1 exists.
                let second = unsafe { process.audio_inputs.add(1) };
                // SAFETY: row 1 of the host's live input table.
                unsafe { (*second).channel_count }
            } else {
                0
            },
        };
        *CAPTURED_BUFFERS.lock().unwrap() = Some(captured);
        for buffer_index in 0..process.audio_outputs_count {
            // SAFETY: `buffer_index < audio_outputs_count`, the table's row count.
            let row = unsafe { process.audio_outputs.add(buffer_index as usize) };
            // SAFETY: a live row of the host's output table, which no one else touches
            // during `process`.
            let buffer = unsafe { &mut *row };
            for channel in 0..buffer.channel_count {
                // `data32` is an array of per-channel pointers; the samples
                // live behind each entry, exactly as a plugin reads them.
                // SAFETY: `channel < channel_count`, the row's pointer-array length.
                let channel_pointer = unsafe { buffer.data32.add(channel as usize) };
                // SAFETY: a live entry of that pointer array.
                let channel_data = unsafe { *channel_pointer };
                // SAFETY: each channel is `MAX_BUFFER >= frames_count` host-owned samples.
                let samples = unsafe {
                    std::slice::from_raw_parts_mut(channel_data, process.frames_count as usize)
                };
                samples.fill((channel + 1) as f32);
            }
        }
        CLAP_PROCESS_CONTINUE
    }

    fn buffer_capturing_plugin_ptr() -> *const clap_plugin {
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
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

    // ── Auxiliary output ports never reach the stereo main return ─────────
    //
    // The return is the MAIN output port alone. This stub writes port `p`'s
    // channel `c` with the constant `(p + 1) * 10 + c`, so a scratch channel
    // that leaks into the return shows up as a number the main port never
    // produced — the issue's own oracle (main=.25, aux=.75) with clearer
    // figures.

    /// Records that the plugin processed, and fills every declared output
    /// channel with its port-distinct constant.
    unsafe extern "C" fn stub_process_port_distinct_output(
        _plugin: *const clap_plugin,
        process: *const clap_process,
    ) -> i32 {
        // SAFETY: the host hands a live process struct, unwritten for this call.
        let process = unsafe { &*process };
        for buffer_index in 0..process.audio_outputs_count {
            // SAFETY: `buffer_index < audio_outputs_count`, the table's row count.
            let row = unsafe { process.audio_outputs.add(buffer_index as usize) };
            // SAFETY: a live row of the host's output table, which no one else touches
            // during `process`.
            let buffer = unsafe { &mut *row };
            for channel in 0..buffer.channel_count {
                // SAFETY: `channel < channel_count`, the row's pointer-array length.
                let channel_pointer = unsafe { buffer.data32.add(channel as usize) };
                // SAFETY: a live entry of that pointer array.
                let channel_data = unsafe { *channel_pointer };
                // SAFETY: each channel is `MAX_BUFFER >= frames_count` host-owned samples.
                let samples = unsafe {
                    std::slice::from_raw_parts_mut(channel_data, process.frames_count as usize)
                };
                samples.fill(((buffer_index + 1) * 10 + channel) as f32);
            }
        }
        CLAP_PROCESS_CONTINUE
    }

    fn port_distinct_output_plugin_ptr() -> *const clap_plugin {
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        plugin.process = Some(stub_process_port_distinct_output);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    /// The issue's own oracle: a mono main plus a mono auxiliary. The mono
    /// main is duplicated to both audible channels, and the auxiliary's
    /// signal — the right channel of this return, before the fix — is heard
    /// nowhere.
    #[test]
    fn a_mono_auxiliary_output_is_kept_out_of_the_stereo_main_return() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();
        let layout = AudioBusLayout::declared(&[1], &[1, 1]).expect("[1, 1] layout builds");
        let mut wrapper = stub_wrapper_over(layout, port_distinct_output_plugin_ptr());

        let (left, right) = process_stereo_block(&mut wrapper, 0.0, 0.0);

        assert_eq!(
            (left, right),
            (10.0, 10.0),
            "the main port's mono channel is duplicated to the return; the auxiliary's \
             signal (11.0) is heard nowhere"
        );
    }

    /// A wider auxiliary behind a mono main changes nothing: the copied width
    /// follows the main port, not the total declared channel count.
    #[test]
    fn a_stereo_auxiliary_output_is_kept_out_of_the_stereo_main_return() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();
        let layout = AudioBusLayout::declared(&[1], &[1, 2]).expect("[1, 2] layout builds");
        let mut wrapper = stub_wrapper_over(layout, port_distinct_output_plugin_ptr());

        let (left, right) = process_stereo_block(&mut wrapper, 0.0, 0.0);

        assert_eq!(
            (left, right),
            (10.0, 10.0),
            "the main port's mono channel fills the return; the auxiliary's 11.0 and 12.0 \
             are heard nowhere"
        );
    }

    /// A stereo main port keeps both of its channels: the main-port width is
    /// what is copied, and an auxiliary behind a full-width main is invisible
    /// to a return that was already reading main channels only.
    #[test]
    fn a_stereo_main_port_before_an_auxiliary_still_returns_both_channels() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();
        let layout = AudioBusLayout::declared(&[1], &[2, 1]).expect("[2, 1] layout builds");
        let mut wrapper = stub_wrapper_over(layout, port_distinct_output_plugin_ptr());

        let (left, right) = process_stereo_block(&mut wrapper, 0.0, 0.0);

        assert_eq!(
            (left, right),
            (10.0, 11.0),
            "both main-port channels are returned; the auxiliary's 12.0 is heard nowhere"
        );
    }

    // ── Input-only analyzers pass the dry block through ────────────────────
    //
    // A plugin with audio inputs and zero audio outputs — a spectrum analyzer,
    // a loudness meter — is not the portless note effect: it has an input port
    // to be fed every block, and its slot must still carry the dry signal.
    // `HostedPluginSlot` hands the wrapper its zeroed scratch and copies
    // whatever the wrapper leaves there back over the track, so a wrapper that
    // leaves the caller's buffers alone mutes the input.

    /// What the signal-inspecting stub saw, shared across the analyzer and
    /// generator tests and serialised by `BUFFER_TEST_LOCK` like the other
    /// capture statics.
    static INSPECTED_SAW: std::sync::Mutex<Option<(f32, f32)>> = std::sync::Mutex::new(None);
    static INSPECTED_PROCESS_CALLS: AtomicUsize = AtomicUsize::new(0);

    /// A plugin that inspects its input port's first frame and writes no audio
    /// of its own, answering CONTINUE like a healthy plugin. The declared bus
    /// layout makes it an input-only analyzer (`[2]` in, nothing out) or a
    /// zero-input generator (nothing in, `[2]` out).
    unsafe extern "C" fn stub_process_signal_inspecting(
        _plugin: *const clap_plugin,
        process: *const clap_process,
    ) -> i32 {
        INSPECTED_PROCESS_CALLS.fetch_add(1, Ordering::Relaxed);
        // SAFETY: the host hands a live process struct, unwritten for this call.
        let process = unsafe { &*process };
        *CAPTURED_BUFFERS.lock().unwrap() = Some(CapturedBuffers {
            input_count: process.audio_inputs_count,
            output_count: process.audio_outputs_count,
            ..CapturedBuffers::default()
        });
        if process.audio_inputs_count > 0 {
            // SAFETY: a non-zero count means `audio_inputs` heads a live row.
            let buffer = unsafe { &*process.audio_inputs };
            if buffer.channel_count >= 2 {
                // SAFETY: the row's channel-pointer array has `channel_count >= 2` entries.
                let left_channel = unsafe { *buffer.data32 };
                // SAFETY: each channel holds at least one host-owned sample.
                let left = unsafe { *left_channel };
                // SAFETY: entry 1 exists, as `channel_count >= 2`.
                let right_pointer = unsafe { buffer.data32.add(1) };
                // SAFETY: a live entry of the pointer array.
                let right_channel = unsafe { *right_pointer };
                // SAFETY: each channel holds at least one host-owned sample.
                let right = unsafe { *right_channel };
                *INSPECTED_SAW.lock().unwrap() = Some((left, right));
            }
        }
        CLAP_PROCESS_CONTINUE
    }

    fn signal_inspecting_plugin_ptr() -> *const clap_plugin {
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        plugin.process = Some(stub_process_signal_inspecting);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    #[test]
    fn an_input_only_analyzer_sees_the_block_on_its_input_port_and_the_dry_audio_survives() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();
        *INSPECTED_SAW.lock().unwrap() = None;
        INSPECTED_PROCESS_CALLS.store(0, Ordering::Relaxed);
        let layout = AudioBusLayout::declared(&[2], &[]).expect("analyzer layout builds");
        let mut wrapper = stub_wrapper_over(layout, signal_inspecting_plugin_ptr());

        // The output arrays start zeroed, exactly like the slot's out_l/out_r
        // scratch that gets copied back over the engine's channels.
        let (left, right) = process_stereo_block(&mut wrapper, 0.25, 0.5);

        let captured = captured_buffers();
        assert_eq!(
            (captured.input_count, captured.output_count),
            (1, 0),
            "the analyzer has its declared input port handed to it — not the portless note-effect shape"
        );
        assert_eq!(INSPECTED_PROCESS_CALLS.load(Ordering::Relaxed), 1);
        assert_eq!(
            INSPECTED_SAW.lock().unwrap().unwrap(),
            (0.25, 0.5),
            "the analyzer receives the dry signal on its input port every process call"
        );
        assert_eq!(
            (left, right),
            (0.25, 0.5),
            "the dry audio survives the slot instead of being muted by its zeroed scratch"
        );
    }

    #[test]
    fn a_zero_input_generator_yields_only_its_own_output_never_the_dry_input() {
        let _guard = BUFFER_TEST_LOCK.lock().unwrap();
        *INSPECTED_SAW.lock().unwrap() = None;
        INSPECTED_PROCESS_CALLS.store(0, Ordering::Relaxed);
        let layout = AudioBusLayout::declared(&[], &[2]).expect("generator layout builds");
        let mut wrapper = stub_wrapper_over(layout, signal_inspecting_plugin_ptr());

        let (left, right) = process_stereo_block(&mut wrapper, 0.25, 0.5);

        let captured = captured_buffers();
        assert_eq!(
            (captured.input_count, captured.output_count),
            (0, 1),
            "the generator is handed its output port and no input buffer"
        );
        assert_eq!(INSPECTED_PROCESS_CALLS.load(Ordering::Relaxed), 1);
        assert!(
            INSPECTED_SAW.lock().unwrap().is_none(),
            "no input port exists to inspect"
        );
        assert_eq!(
            (left, right),
            (0.0, 0.0),
            "a generator that writes nothing stays silent — the fed input must not pass through it"
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

        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(audio_ports_get_extension);

        // SAFETY: a stack stub whose only callback is the sound `get_extension` above.
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
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut bare: clap_plugin = unsafe { mem::zeroed() };
        bare.get_extension = Some(stub_get_extension);
        // SAFETY: a stack stub whose only callback is the sound `get_extension` above.
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
            // SAFETY: `plugin` came from `Box::into_raw` in `port_declaring_create_plugin`,
            // and the host calls `destroy` once per instance.
            drop(unsafe { Box::from_raw(plugin as *mut clap_plugin) });
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

        // SAFETY: a static fake entry with no `init` to have run, live for the process.
        let wrapper = unsafe {
            ClapWrapper::load_initialized_entry(
                &raw const PORT_DECLARING_ENTRY,
                "org.sourdaw.test.port-declaring",
                48_000.0,
                ProcessMode::Realtime,
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
        // SAFETY: non-null (checked above); the host passes a live, writable out-param.
        unsafe {
            *info = clap_audio_port_info {
                id: index,
                name: [0; clap_sys::string_sizes::CLAP_NAME_SIZE],
                flags: 0,
                channel_count,
                port_type: ptr::null(),
                in_place_pair: clap_sys::id::CLAP_INVALID_ID,
            }
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
        // SAFETY: the host only queries with a NUL-terminated `CLAP_EXT_*` id.
        if unsafe { CStr::from_ptr(id) } == CLAP_EXT_AUDIO_PORTS {
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
        // SAFETY: non-null (checked above); the host passes a live, writable out-param.
        unsafe {
            *info = clap_note_port_info {
                id: 0,
                supported_dialects: NOTE_PORT_DIALECTS.load(Ordering::Relaxed),
                preferred_dialect: 0,
                name: [0; clap_sys::string_sizes::CLAP_NAME_SIZE],
            }
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
        // SAFETY: the host only queries with a NUL-terminated `CLAP_EXT_*` id.
        if unsafe { CStr::from_ptr(id) } == CLAP_EXT_NOTE_PORTS {
            return &raw const STUB_NOTE_PORTS as *const c_void;
        }
        ptr::null()
    }

    #[test]
    fn a_plugin_declaring_a_clap_dialect_note_input_accepts_midi() {
        let _guard = NOTE_PORTS_TEST_LOCK.lock().unwrap();
        NOTE_PORT_DIALECTS.store(CLAP_NOTE_DIALECT_CLAP, Ordering::Relaxed);
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(note_ports_get_extension);

        assert!(
            // SAFETY: a stack stub whose only callback is the sound `get_extension`.
            unsafe { ClapWrapper::reads_note_input_ports(&plugin) },
            "an input port speaking the dialect this host's events are in takes those events"
        );
    }

    #[test]
    fn a_plugin_with_no_note_ports_extension_refuses_midi() {
        let _guard = NOTE_PORTS_TEST_LOCK.lock().unwrap();
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension); // answers everything but note ports

        assert!(
            // SAFETY: a stack stub whose only callback is the sound `get_extension`.
            !unsafe { ClapWrapper::reads_note_input_ports(&plugin) },
            "no clap.note-ports means no note input, per the spec's own rule"
        );
    }

    #[test]
    fn a_plugin_whose_ports_speak_only_midi_family_dialects_refuses_midi() {
        let _guard = NOTE_PORTS_TEST_LOCK.lock().unwrap();
        use clap_sys::ext::note_ports::CLAP_NOTE_DIALECT_MIDI;
        NOTE_PORT_DIALECTS.store(CLAP_NOTE_DIALECT_MIDI, Ordering::Relaxed);
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(note_ports_get_extension);

        assert!(
            // SAFETY: a stack stub whose only callback is the sound `get_extension`.
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
            // SAFETY: non-null (checked above); the host passes a static
            // NUL-terminated `CLAP_WINDOW_API_*` string.
            *NEGOTIATED_GUI_API.lock().unwrap() = unsafe { CStr::from_ptr(api) }
                .to_string_lossy()
                .into_owned();
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
        // SAFETY: the host passes two live, writable `u32` out-parameters.
        unsafe { *width = 640 };
        // SAFETY: as above.
        unsafe { *height = 480 };
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
        // SAFETY: the host only queries with a NUL-terminated `CLAP_EXT_*` id.
        if unsafe { CStr::from_ptr(id) } == CLAP_EXT_GUI {
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
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(scale_recording_get_extension);
        let plugin_ptr = Box::into_raw(Box::new(plugin)) as *const clap_plugin;
        // SAFETY: `plugin_ptr` is the leaked boxed stub just built, live for the test.
        let plugin_ref = unsafe { &*plugin_ptr };
        // SAFETY: the live stub instance, and the struct CLAP defines for the id.
        let gui_ext =
            unsafe { ClapWrapper::query_extension::<clap_plugin_gui>(plugin_ref, CLAP_EXT_GUI) };
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
        // SAFETY: the host passes two live, writable `u32` in/out parameters.
        let requested_width = unsafe { *width };
        // SAFETY: as above.
        let requested_height = unsafe { *height };
        record_editor_step(format!("adjust_size({requested_width}x{requested_height})"));
        // SAFETY: as above.
        unsafe { *width = 800 };
        // SAFETY: as above.
        unsafe { *height = 600 };
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
        // SAFETY: the host passes two live, writable `u32` out-parameters.
        unsafe { *width = stated_width };
        // SAFETY: as above.
        unsafe { *height = stated_height };
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
        // SAFETY: the host only queries with a NUL-terminated `CLAP_EXT_*` id.
        if unsafe { CStr::from_ptr(id) } == CLAP_EXT_GUI {
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
        // SAFETY: the host only queries with a NUL-terminated `CLAP_EXT_*` id.
        if unsafe { CStr::from_ptr(id) } == CLAP_EXT_GUI {
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

        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(get_extension);
        let plugin_ptr = Box::into_raw(Box::new(plugin)) as *const clap_plugin;
        // SAFETY: `plugin_ptr` is the leaked boxed stub just built, live for the test.
        let plugin_ref = unsafe { &*plugin_ptr };
        // SAFETY: the live stub instance, and the struct CLAP defines for the id.
        let gui_ext =
            unsafe { ClapWrapper::query_extension::<clap_plugin_gui>(plugin_ref, CLAP_EXT_GUI) };
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
            matches!(refusal, ClapError::NoResizableEditor { .. }),
            "got: {refusal}"
        );
        assert_eq!(
            refusal.to_string(),
            "Plugin 'stub' has no resizable open editor"
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
        // SAFETY: the host hands a live process struct for the length of this call.
        for buffer_index in 0..unsafe { (*process).audio_inputs_count } {
            // SAFETY: as above.
            let inputs = unsafe { (*process).audio_inputs };
            // SAFETY: `buffer_index < audio_inputs_count`, the table's row count.
            let buffer = unsafe { inputs.add(buffer_index as usize) };
            // SAFETY: a live row of the host's input table.
            for channel in 0..unsafe { (*buffer).channel_count } {
                // SAFETY: the same live row.
                let channels = unsafe { (*buffer).data32 };
                // SAFETY: `channel < channel_count`, the pointer array's length.
                let channel_pointer = unsafe { channels.add(channel as usize) };
                // SAFETY: a live entry of that pointer array.
                let channel_data = unsafe { *channel_pointer };
                // SAFETY: each channel holds at least one host-owned sample.
                sampled.push(unsafe { *channel_data });
            }
        }
        // Keep the output write the other stubs perform, so the block still
        // carries observable audio.
        // SAFETY: forwards the same live process struct the host handed this call.
        unsafe { stub_process_buffer_capturing(_plugin, process) }
    }

    fn input_sampling_plugin_ptr() -> *const clap_plugin {
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
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
            // SAFETY: `clap_param_info` is integers, floats, char arrays and a raw
            // pointer, for all of which all-zero bytes are valid.
            let mut parameter: clap_param_info = unsafe { mem::zeroed() };
            // Every name byte set, no terminator: the exact array that made
            // `CStr::from_ptr` read past `name` and into `module`.
            parameter.name = [b'n' as std::os::raw::c_char; CLAP_NAME_SIZE];
            parameter.module = [0; CLAP_PATH_SIZE];
            parameter.id = 11;
            parameter.min_value = 0.0;
            parameter.max_value = 1.0;
            parameter.default_value = 0.5;
            // SAFETY: non-null (checked above); the host passes a live, writable out-param.
            unsafe { *info = parameter };
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

    unsafe extern "C" fn text_parameter_count(_plugin: *const clap_plugin) -> u32 {
        2
    }

    unsafe extern "C" fn text_parameter_info(
        _plugin: *const clap_plugin,
        index: u32,
        info: *mut clap_param_info,
    ) -> bool {
        if index > 1 || info.is_null() {
            return false;
        }
        // SAFETY: `clap_param_info` is integers, floats, char arrays and a raw
        // pointer, for all of which all-zero bytes are valid.
        let mut parameter: clap_param_info = unsafe { mem::zeroed() };
        // The stepped parameter's range is -2..2, so its step count (4) is the
        // span, which neither its maximum nor its minimum alone gives.
        let (id, name, flags, min_value, max_value) = if index == 0 {
            (
                21,
                b"Shape",
                CLAP_PARAM_IS_AUTOMATABLE
                    | CLAP_PARAM_IS_STEPPED
                    | CLAP_PARAM_IS_ENUM
                    | CLAP_PARAM_IS_READONLY,
                -2.0,
                2.0,
            )
        } else {
            (22, b"Level", CLAP_PARAM_IS_AUTOMATABLE, 0.0, 1.0)
        };
        for (slot, byte) in parameter.name.iter_mut().zip(name) {
            *slot = *byte as std::os::raw::c_char;
        }
        parameter.id = id;
        parameter.flags = flags;
        parameter.min_value = min_value;
        parameter.max_value = max_value;
        // SAFETY: non-null (checked above); the host passes a live, writable out-param.
        unsafe { *info = parameter };
        true
    }

    unsafe extern "C" fn text_parameter_value(
        _plugin: *const clap_plugin,
        _id: u32,
        value: *mut f64,
    ) -> bool {
        // SAFETY: the host passes a live, writable out-param.
        unsafe { *value = 2.0 };
        true
    }

    /// Answers text for the stepped parameter; the other refuses, after writing
    /// text anyway, so only the refusal itself can keep that text from the host.
    unsafe extern "C" fn text_parameter_value_to_text(
        _plugin: *const clap_plugin,
        id: u32,
        value: f64,
        out_buffer: *mut std::os::raw::c_char,
        out_buffer_capacity: u32,
    ) -> bool {
        let text = if id == 21 {
            format!("Saw {value}\0")
        } else {
            format!("Refused {value}\0")
        };
        assert!(text.len() <= out_buffer_capacity as usize);
        for (offset, byte) in text.bytes().enumerate() {
            // SAFETY: `offset` is within the capacity the host passed (asserted above).
            unsafe { *out_buffer.add(offset) = byte as std::os::raw::c_char };
        }
        id == 21
    }

    static TEXT_PARAMETERS: clap_plugin_params = clap_plugin_params {
        count: Some(text_parameter_count),
        get_info: Some(text_parameter_info),
        get_value: Some(text_parameter_value),
        value_to_text: Some(text_parameter_value_to_text),
        text_to_value: None,
        flush: None,
    };

    #[test]
    fn the_parameter_list_carries_display_text_step_count_and_flags() {
        let mut wrapper = stub_wrapper(stub_plugin_ptr());
        wrapper.params_ext = &raw const TEXT_PARAMETERS;

        let parameters = AudioPlugin::get_parameters(&wrapper);

        let shape = &parameters[0];
        assert_eq!(shape.display_text.as_deref(), Some("Saw 2"));
        assert_eq!(shape.step_count, 4);
        assert!(shape.is_list);
        assert!(shape.is_read_only);
        assert!(
            !shape.is_automatable,
            "a read-only parameter is never automatable"
        );

        let level = &parameters[1];
        assert_eq!(
            level.display_text, None,
            "a plugin whose value_to_text returns false has no text"
        );
        assert_eq!(level.step_count, 0);
        assert!(!level.is_list);
        assert!(!level.is_read_only);
        assert!(level.is_automatable);
    }

    #[test]
    fn the_text_of_a_value_comes_from_the_plugin() {
        let mut wrapper = stub_wrapper(stub_plugin_ptr());
        wrapper.params_ext = &raw const TEXT_PARAMETERS;

        assert_eq!(
            AudioPlugin::parameter_value_text(&wrapper, 21, 3.0).as_deref(),
            Some("Saw 3")
        );
        assert_eq!(AudioPlugin::parameter_value_text(&wrapper, 22, 0.5), None);
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
    ///
    /// # Safety
    /// `out_events` must point to a live `clap_output_events` whose `try_push` is
    /// sound to call for the duration of this call — the list a host just handed.
    unsafe fn emit_staged_events(out_events: *const clap_output_events) {
        // SAFETY: `out_events` is live (this fn's contract).
        let Some(try_push) = (unsafe { (*out_events).try_push }) else {
            return;
        };
        let staged = EMITTED_EVENTS.lock().unwrap().clone();
        let mut answers = Vec::with_capacity(staged.len());
        for event in staged {
            let accepted = match event.kind {
                PluginParameterEventKind::Value => {
                    let value = param_value_event(event.param_id, event.value);
                    // SAFETY: the list's own `try_push`, matched as `Some`, on the live
                    // list, with a header heading a correctly sized stack event.
                    unsafe { try_push(out_events, &value.header) }
                }
                PluginParameterEventKind::GestureBegin | PluginParameterEventKind::GestureEnd => {
                    let gesture = gesture_event(
                        event.param_id,
                        matches!(event.kind, PluginParameterEventKind::GestureBegin),
                    );
                    // SAFETY: the list's own `try_push`, matched as `Some`, on the live
                    // list, with a header heading a correctly sized stack event.
                    unsafe { try_push(out_events, &gesture.header) }
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
        // SAFETY: the host hands a live process struct for the length of this call.
        let out_events = unsafe { (*process).out_events };
        // SAFETY: the host's live output list for this `process` call.
        unsafe { emit_staged_events(out_events) };
        CLAP_PROCESS_CONTINUE
    }

    unsafe extern "C" fn stub_params_flush_emitting(
        _plugin: *const clap_plugin,
        _in_events: *const clap_input_events,
        out_events: *const clap_output_events,
    ) {
        FLUSH_CALLS.fetch_add(1, Ordering::Relaxed);
        // SAFETY: the host's live output list for this `flush` call.
        unsafe { emit_staged_events(out_events) };
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
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
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

        // SAFETY: `list` borrows the live `queue`, and the header heads a correctly
        // sized stack note event.
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

        // SAFETY: `list` borrows the live `queue`, and the header heads a correctly
        // sized stack event.
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

        // SAFETY: `list` borrows the live `queue`; the header heads a full stack event
        // whose declared size is deliberately short, which the callee checks first.
        assert!(unsafe { output_events_try_push(&list, &value.header) });
        // SAFETY: as above.
        assert!(unsafe { output_events_try_push(&list, &gesture.header) });

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

        // SAFETY: `list` borrows the live `queue`, and the header heads a correctly
        // sized stack event.
        assert!(unsafe { output_events_try_push(&list, &first.header) });
        // SAFETY: as above.
        assert!(!unsafe { output_events_try_push(&list, &second.header) });

        assert_eq!(queue.take_dropped(), 1);
    }

    #[test]
    fn a_null_event_or_list_is_refused_rather_than_dereferenced() {
        let queue = PluginParameterEventQueue::default();
        let list = capture_output_events(&queue);
        let value = param_value_event(1, 0.1);

        // SAFETY: the callee checks both pointers for null before any dereference;
        // `list` borrows the live `queue`.
        assert!(!unsafe { output_events_try_push(&list, ptr::null()) });
        // SAFETY: as above; the header heads a correctly sized stack event.
        assert!(!unsafe { output_events_try_push(ptr::null(), &value.header) });
    }

    /// The suppressing list is handed to third-party code on the same terms as
    /// the ordinary one, so it owes the same refusal. A plugin that pushes a null
    /// header must be told no, not dereferenced.
    #[test]
    fn the_host_write_list_refuses_a_null_event_or_list_rather_than_dereferencing_it() {
        let queue = PluginParameterEventQueue::default();
        let written = [param_value_event(1, 0.0)];
        let mut capture = HostWriteCapture {
            queue: &queue,
            written: &written,
        };
        let list = capture_host_write_events(&mut capture);
        let value = param_value_event(2, 0.1);

        // SAFETY: the callee checks both pointers for null before any dereference;
        // `list` borrows the live stack `capture`.
        assert!(!unsafe { host_write_try_push(&list, ptr::null()) });
        // SAFETY: as above; the header heads a correctly sized stack event.
        assert!(!unsafe { host_write_try_push(ptr::null(), &value.header) });

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

        // SAFETY: `list` is a live stack list whose null `ctx` the callee checks
        // before use; the header heads a correctly sized stack event.
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

    /// A stub `process` that behaves like a wrapper-generated plugin: every
    /// parameter value it is handed as an input event comes straight back as an
    /// output event for the same id, followed by whatever the test staged.
    unsafe extern "C" fn stub_process_echoing_inputs(
        _plugin: *const clap_plugin,
        process: *const clap_process,
    ) -> i32 {
        // SAFETY: the host hands a live process struct for the length of this call.
        let in_events = unsafe { (*process).in_events };
        // SAFETY: as above — the live process struct.
        let out_events = unsafe { (*process).out_events };
        // SAFETY: the host's live input list for this `process` call.
        let size = unsafe { (*in_events).size };
        // SAFETY: as above — the live input list.
        let get = unsafe { (*in_events).get };
        // SAFETY: the host's live output list for this `process` call.
        let try_push = unsafe { (*out_events).try_push };
        let (Some(size), Some(get), Some(try_push)) = (size, get, try_push) else {
            return CLAP_PROCESS_ERROR;
        };
        // SAFETY: the list's own `size`, on the live list.
        let count = unsafe { size(in_events) };
        for index in 0..count {
            // SAFETY: the list's own `get`, on the live list, with `index < size`.
            let header = unsafe { get(in_events, index) };
            // SAFETY: a non-null header the host's list returned is live for the call.
            if header.is_null() || unsafe { (*header).type_ } != CLAP_EVENT_PARAM_VALUE {
                continue;
            }
            // SAFETY: a PARAM_VALUE header heads a `clap_event_param_value`.
            let input = unsafe { &*(header as *const clap_event_param_value) };
            let echo = param_value_event(input.param_id, input.value);
            // SAFETY: the list's own `try_push`, on the live list, with a header
            // heading a correctly sized stack event.
            unsafe { try_push(out_events, &echo.header) };
        }
        // SAFETY: the host's live output list for this `process` call.
        unsafe { emit_staged_events(out_events) };
        CLAP_PROCESS_CONTINUE
    }

    fn echoing_plugin_ptr() -> *const clap_plugin {
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        plugin.process = Some(stub_process_echoing_inputs);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    /// Drive one block carrying `updates` through the entry point the engine
    /// uses for automation.
    fn process_one_block_with_updates(wrapper: &mut ClapWrapper, updates: &[HostParameterUpdate]) {
        let left = [0.0f32; 8];
        let right = [0.0f32; 8];
        let mut out_l = [0.0f32; 8];
        let mut out_r = [0.0f32; 8];
        let inputs: [&[f32]; 2] = [&left, &right];
        let mut outputs: [&mut [f32]; 2] = [&mut out_l, &mut out_r];
        wrapper.process_with_parameter_updates(&inputs, &mut outputs, 8, updates);
    }

    /// Automation reaches a CLAP plugin as input events on `process`, and the
    /// plugin's echo of it is no more a user edit than the one `set_parameter`
    /// drops. Captured, every automated block marks the project dirty. Both
    /// `process` branches build their own output list, so both are driven.
    #[test]
    fn the_value_a_plugin_echoes_back_from_automation_on_process_is_not_reported_as_an_edit() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        for layout in [AudioBusLayout::portless(), stereo_layout()] {
            stage_emitted_events(vec![PluginParameterEvent::value(9, 0.10)]);
            let mut wrapper = stub_wrapper_over(layout, echoing_plugin_ptr());

            process_one_block_with_updates(
                &mut wrapper,
                &[HostParameterUpdate {
                    param_id: 8,
                    value: 0.44,
                    sample_offset: 0,
                }],
            );

            assert_eq!(
                captured_events(&wrapper),
                vec![PluginParameterEvent::value(9, 0.10)],
                "the automated parameter's echo is dropped and an unrelated edit still passes"
            );
        }
    }

    /// A block that carries no automation suppresses nothing: the same value
    /// for the same id is then the user's own edit in the plugin's editor.
    #[test]
    fn a_value_emitted_on_a_block_without_host_writes_still_reaches_the_host() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        for layout in [AudioBusLayout::portless(), stereo_layout()] {
            stage_emitted_events(vec![PluginParameterEvent::value(8, 0.44)]);
            let mut wrapper = stub_wrapper_over(layout, echoing_plugin_ptr());

            process_one_block(&mut wrapper);

            assert_eq!(
                captured_events(&wrapper),
                vec![PluginParameterEvent::value(8, 0.44)]
            );
        }
    }

    /// Only a value can be an echo on `process` too. A gesture on an automated
    /// parameter is a user taking hold of it — the start of an automation
    /// override — and swallowing it would leave the boundary unpaired.
    #[test]
    fn a_gesture_on_an_automated_parameter_during_process_still_reaches_the_host() {
        let _guard = EMIT_TEST_LOCK.lock().unwrap();
        for layout in [AudioBusLayout::portless(), stereo_layout()] {
            stage_emitted_events(vec![
                PluginParameterEvent::gesture_begin(8),
                PluginParameterEvent::gesture_end(8),
            ]);
            let mut wrapper = stub_wrapper_over(layout, echoing_plugin_ptr());

            process_one_block_with_updates(
                &mut wrapper,
                &[HostParameterUpdate {
                    param_id: 8,
                    value: 0.44,
                    sample_offset: 0,
                }],
            );

            assert_eq!(
                captured_events(&wrapper),
                vec![
                    PluginParameterEvent::gesture_begin(8),
                    PluginParameterEvent::gesture_end(8),
                ]
            );
        }
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
        // SAFETY: the host hands a live process struct, unwritten for this call.
        let process = unsafe { &*process };
        for buffer_index in 0..process.audio_outputs_count {
            // SAFETY: `buffer_index < audio_outputs_count`, the table's row count.
            let row = unsafe { process.audio_outputs.add(buffer_index as usize) };
            // SAFETY: a live row of the host's output table, which no one else touches
            // during `process`.
            let buffer = unsafe { &mut *row };
            for channel in 0..buffer.channel_count {
                // SAFETY: `channel < channel_count`, the row's pointer-array length.
                let channel_pointer = unsafe { buffer.data32.add(channel as usize) };
                // SAFETY: a live entry of that pointer array.
                let channel_data = unsafe { *channel_pointer };
                // SAFETY: each channel is `MAX_BUFFER >= frames_count` host-owned samples.
                let samples = unsafe {
                    std::slice::from_raw_parts_mut(channel_data, process.frames_count as usize)
                };
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

        // SAFETY: `clap_plugin_descriptor` is a version struct of integers and raw
        // pointers, for all of which all-zero bytes are valid.
        let mut descriptor: clap_plugin_descriptor = unsafe { mem::zeroed() };
        descriptor.features = feature_pointers.as_ptr();

        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
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
            // SAFETY: the host hands a live process struct for the length of this call.
            .push(unsafe { (*process).steady_time });
        CLAP_PROCESS_CONTINUE
    }

    fn steady_time_plugin_ptr() -> *const clap_plugin {
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
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
        // SAFETY: the host only queries with a NUL-terminated `CLAP_EXT_*` id.
        if unsafe { CStr::from_ptr(id) } == CLAP_EXT_TAIL {
            return &STUB_TAIL_EXT as *const clap_plugin_tail as *const c_void;
        }
        // SAFETY: forwards the same instance and NUL-terminated id the host passed.
        unsafe { stub_get_extension(plugin, id) }
    }

    fn tail_plugin_ptr() -> *const clap_plugin {
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
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
        // `mark_tail_dirty` raises the process-wide tail hint, which the
        // host-callback tests read back as read-and-clear.
        let _hint_guard = crate::clap_host::TAIL_SIGNAL_TEST_LOCK
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

    /// The status stub answering `clap.tail` too, so a test can drive the
    /// process result and the tail declaration independently — the two answers
    /// [`ClapWrapper::is_tail_active`] reads together.
    fn tail_status_plugin_ptr() -> *const clap_plugin {
        // SAFETY: `clap_plugin` is raw pointers and `Option` fn pointers, for which
        // all-zero bytes are null and `None`.
        let mut plugin: clap_plugin = unsafe { mem::zeroed() };
        plugin.get_extension = Some(stub_get_extension_with_tail);
        plugin.activate = Some(stub_activate);
        plugin.deactivate = Some(stub_deactivate);
        plugin.start_processing = Some(stub_start_processing);
        plugin.stop_processing = Some(stub_stop_processing);
        plugin.process = Some(stub_process_with_status);
        Box::into_raw(Box::new(plugin)) as *const clap_plugin
    }

    /// The tests below stage both the process status and the tail, so both
    /// locks are taken — STATUS first, the order the process-status tests
    /// already use, so no two tests ever take the same two locks in opposite
    /// orders.
    fn lock_status_and_tail() -> (
        std::sync::MutexGuard<'static, ()>,
        std::sync::MutexGuard<'static, ()>,
    ) {
        let status = STATUS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let tail = TAIL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        (status, tail)
    }

    /// The plugin answers `CLAP_PROCESS_TAIL` and still declares frames to
    /// drain: that is the state the spec tells the host to keep processing, and
    /// it clears the moment the plugin stops claiming tail mode — `CONTINUE` is
    /// its word that the tail question is settled, whatever the declared tail
    /// says.
    #[test]
    fn a_tail_status_surfaces_while_it_lasts_and_clears_when_the_plugin_retracts_it() {
        let (_status, _tail) = lock_status_and_tail();
        STUB_TAIL.store(4_800, Ordering::Relaxed);
        STUB_PROCESS_STATUS.store(CLAP_PROCESS_TAIL, Ordering::Relaxed);
        let mut wrapper = stub_wrapper_over(stereo_layout(), tail_status_plugin_ptr());
        assert!(
            !HostedPluginRuntime::is_tail_active(&wrapper),
            "nothing has been processed yet, so nothing claims a tail"
        );

        process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

        assert!(HostedPluginRuntime::is_tail_active(&wrapper));
        assert_eq!(wrapper.tail_samples(), 4_800);

        STUB_PROCESS_STATUS.store(CLAP_PROCESS_CONTINUE, Ordering::Relaxed);
        process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

        assert!(
            !HostedPluginRuntime::is_tail_active(&wrapper),
            "a status that is not CLAP_PROCESS_TAIL ends tail mode"
        );
    }

    /// `CONTINUE`, `CONTINUE_IF_NOT_QUIET` and `SLEEP` each answer the tail
    /// question with "nothing to defer to", whatever the extension declares.
    #[test]
    fn the_other_success_statuses_never_surface_a_tail() {
        let (_status, _tail) = lock_status_and_tail();
        STUB_TAIL.store(4_800, Ordering::Relaxed);
        for status in [
            CLAP_PROCESS_CONTINUE,
            CLAP_PROCESS_CONTINUE_IF_NOT_QUIET,
            CLAP_PROCESS_SLEEP,
        ] {
            STUB_PROCESS_STATUS.store(status, Ordering::Relaxed);
            let mut wrapper = stub_wrapper_over(stereo_layout(), tail_status_plugin_ptr());

            process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

            assert!(
                !HostedPluginRuntime::is_tail_active(&wrapper),
                "status {status} is not a tail claim and must not surface one"
            );
        }
    }

    /// The spec keeps the host processing "while the tail is non-zero": a
    /// `CLAP_PROCESS_TAIL` answer over a declaration that has decayed to zero
    /// is a tail that is done, not one to schedule.
    #[test]
    fn a_tail_status_over_a_zero_declaration_is_not_active() {
        let (_status, _tail) = lock_status_and_tail();
        STUB_TAIL.store(0, Ordering::Relaxed);
        STUB_PROCESS_STATUS.store(CLAP_PROCESS_TAIL, Ordering::Relaxed);
        let mut wrapper = stub_wrapper_over(stereo_layout(), tail_status_plugin_ptr());

        process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

        assert!(
            !HostedPluginRuntime::is_tail_active(&wrapper),
            "the plugin claims tail mode but declares nothing left to drain"
        );
    }

    /// A plugin that left the processing state has no tail: the gate stop is
    /// what `deactivate` waits for, and the observation reads it rather than
    /// trusting a status from a block that will never come.
    #[test]
    fn leaving_the_processing_state_clears_the_tail_activity() {
        let (_status, _tail) = lock_status_and_tail();
        STUB_TAIL.store(4_800, Ordering::Relaxed);
        STUB_PROCESS_STATUS.store(CLAP_PROCESS_TAIL, Ordering::Relaxed);
        let mut wrapper = stub_wrapper_over(stereo_layout(), tail_status_plugin_ptr());
        process_block_over_stale_output(&mut wrapper, 0.25, 0.5);
        assert!(HostedPluginRuntime::is_tail_active(&wrapper));

        // The stop the control path requests is performed by the next block's
        // state sync — which is therefore also the last process call.
        wrapper.processing.request_stop();
        process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

        assert!(
            !HostedPluginRuntime::is_tail_active(&wrapper),
            "a plugin out of the processing state is not draining anything"
        );
    }

    /// CLAP defines the error as output the host must discard — it is a failure,
    /// not a word about the tail — so the last successful observation stands
    /// until a successful status revises it.
    #[test]
    fn a_failed_block_leaves_the_last_tail_observation_standing() {
        let (_status, _tail) = lock_status_and_tail();
        STUB_TAIL.store(4_800, Ordering::Relaxed);
        STUB_PROCESS_STATUS.store(CLAP_PROCESS_TAIL, Ordering::Relaxed);
        let mut wrapper = stub_wrapper_over(stereo_layout(), tail_status_plugin_ptr());
        process_block_over_stale_output(&mut wrapper, 0.25, 0.5);
        assert!(HostedPluginRuntime::is_tail_active(&wrapper));

        STUB_PROCESS_STATUS.store(CLAP_PROCESS_ERROR, Ordering::Relaxed);
        process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

        assert!(
            HostedPluginRuntime::is_tail_active(&wrapper),
            "an error block reports nothing about the tail; the last \
             successful status still governs"
        );
    }

    /// The portless path reads the status for its output events; a note
    /// processor that reports a tail there is surfaced the same way.
    #[test]
    fn a_portless_plugin_that_reports_a_tail_is_surfaced_too() {
        let (_status, _tail) = lock_status_and_tail();
        STUB_TAIL.store(4_800, Ordering::Relaxed);
        STUB_PROCESS_STATUS.store(CLAP_PROCESS_TAIL, Ordering::Relaxed);
        let mut wrapper = stub_wrapper_over(AudioBusLayout::portless(), tail_status_plugin_ptr());

        process_block_over_stale_output(&mut wrapper, 0.25, 0.5);

        assert!(
            HostedPluginRuntime::is_tail_active(&wrapper),
            "the portless process path reads the status too"
        );
    }
}
