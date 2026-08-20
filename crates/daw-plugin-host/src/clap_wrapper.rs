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

/// How many deactivate/reactivate/re-query passes one `poll_latency_change` will
/// make before giving up on settling. Each extra pass exists to catch a
/// `request_restart()` that landed during the previous one; the cap keeps a
/// plugin that re-flags from inside every `activate()` from spinning forever.
const MAX_LATENCY_REQUERY_PASSES: u32 = 4;

use crate::clap_host::{create_host_descriptor, HostCallbackState, LatencyChangeNotifier};
use crate::params::PluginParameter;
use crate::traits::{
    AudioPlugin, HostParameterUpdate, HostTransport, HostedPluginRuntime, ProcessingGate,
};
use clap_sys::audio_buffer::clap_audio_buffer;
use clap_sys::entry::clap_plugin_entry;
use clap_sys::events::{
    clap_event_header, clap_event_note, clap_event_param_value, clap_event_transport,
    clap_input_events, clap_output_events, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_NOTE_OFF,
    CLAP_EVENT_NOTE_ON, CLAP_EVENT_PARAM_VALUE, CLAP_EVENT_TRANSPORT,
    CLAP_TRANSPORT_HAS_BEATS_TIMELINE, CLAP_TRANSPORT_HAS_SECONDS_TIMELINE,
    CLAP_TRANSPORT_HAS_TEMPO, CLAP_TRANSPORT_HAS_TIME_SIGNATURE, CLAP_TRANSPORT_IS_PLAYING,
};
use clap_sys::ext::gui::{
    clap_plugin_gui, clap_window, clap_window_handle, CLAP_EXT_GUI, CLAP_WINDOW_API_COCOA,
    CLAP_WINDOW_API_WIN32, CLAP_WINDOW_API_X11,
};
use clap_sys::ext::latency::{clap_plugin_latency, CLAP_EXT_LATENCY};
use clap_sys::ext::params::{
    clap_param_info, clap_plugin_params, CLAP_EXT_PARAMS, CLAP_PARAM_IS_AUTOMATABLE,
    CLAP_PARAM_IS_HIDDEN, CLAP_PARAM_IS_READONLY,
};
use clap_sys::ext::state::{clap_plugin_state, CLAP_EXT_STATE};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::fixedpoint::{CLAP_BEATTIME_FACTOR, CLAP_SECTIME_FACTOR};
use clap_sys::host::clap_host;
use clap_sys::plugin::clap_plugin;
use clap_sys::process::clap_process;
use clap_sys::stream::{clap_istream, clap_ostream};
use libloading::Library;
use std::ffi::{c_void, CStr, CString};
use std::mem;
use std::ptr;
use std::sync::Arc;

/// Holds a loaded CLAP plugin instance and its associated resources.
pub struct ClapWrapper {
    /// The dynamically loaded shared library — must outlive the plugin instance.
    _library: Option<Library>,
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
    /// Per-instance host callback state, pinned into `host.host_data`. Owns the
    /// latency-dirty flag the plugin sets via `clap_host_latency.changed()` /
    /// `request_restart()`. Must outlive the plugin (dropped after it in field order).
    host_state: Box<HostCallbackState>,
    /// Whether the GUI is currently open.
    gui_open: bool,
    /// Split ownership of the CLAP processing state. Shared with the runtime
    /// owner so an unload can request a stop without touching the wrapper.
    processing: Arc<ProcessingGate>,
    /// Preallocated transport event refilled in place each block — the audio
    /// thread never allocates one.
    transport_scratch: Box<clap_event_transport>,
    /// Whether the host has supplied a timeline yet. Until it has, the plugin
    /// gets a null transport, which CLAP defines as "no timeline available".
    has_transport: bool,
    /// Preallocated input channel scratch (2 ch × MAX_BUFFER samples). No RT allocation.
    input_scratch: Box<[[f32; MAX_BUFFER]; 2]>,
    /// Preallocated output channel scratch (2 ch × MAX_BUFFER samples). No RT allocation.
    output_scratch: Box<[[f32; MAX_BUFFER]; 2]>,
    /// Preallocated MIDI event scratch list. Cleared + refilled each block, never reallocated.
    midi_scratch: Vec<clap_event_note>,
    /// Preallocated parameter event scratch list. Cleared + refilled each block, never reallocated.
    parameter_scratch: Vec<clap_event_param_value>,
    #[cfg(feature = "engine-owned-command-fixture")]
    command_fixture: Option<EngineOwnedCommandFixture>,
}

#[cfg(feature = "engine-owned-command-fixture")]
struct EngineOwnedCommandFixture {
    state: Vec<u8>,
    has_gui: bool,
    /// Values the fixture answers `get_parameters` with. Writable so a test can
    /// stage a change the host never made — the plugin-side edit a user performs
    /// in the plugin's own editor.
    parameters: Vec<PluginParameter>,
}

// SAFETY: The clap_plugin is required to be thread-safe by the CLAP spec.
// The host struct is pinned via Box and not mutated after creation.
unsafe impl Send for ClapWrapper {}
unsafe impl Sync for ClapWrapper {}

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

/// Output events (we absorb but ignore plugin-generated events for now).
static EMPTY_OUTPUT_EVENTS: clap_output_events = clap_output_events {
    ctx: ptr::null_mut(),
    try_push: Some(output_events_try_push),
};

unsafe extern "C" fn output_events_try_push(
    _list: *const clap_output_events,
    _event: *const clap_event_header,
) -> bool {
    true // Accept but discard
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

impl ClapWrapper {
    /// Load a CLAP plugin from a shared library path.
    ///
    /// `plugin_path`: Path to the .clap file (shared library)
    /// `plugin_id`: The CLAP plugin ID to instantiate (from the descriptor)
    /// `sample_rate`: The output device sample rate. Must match the running audio engine.
    ///   Query via `cpal::default_host().default_output_device()?.default_output_config()?.sample_rate()`.
    pub fn new(plugin_path: &str, plugin_id: &str, sample_rate: f64) -> Result<Self, String> {
        unsafe {
            // 1. Load the shared library
            let library = Library::new(plugin_path)
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

            // 3. Call init
            if let Some(init_fn) = entry_ref.init {
                let path_c = CString::new(plugin_path).map_err(|_| "Invalid plugin path")?;
                let ok = init_fn(path_c.as_ptr());
                if !ok {
                    return Err("clap_entry.init() returned false".to_string());
                }
            }

            // 4. Get the plugin factory
            let factory_id = CLAP_PLUGIN_FACTORY_ID.as_ptr() as *const i8;
            let factory_ptr = if let Some(get_factory) = entry_ref.get_factory {
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

            // 8. Query extensions BEFORE activation
            let params_ext =
                Self::query_extension::<clap_plugin_params>(plugin_ref, CLAP_EXT_PARAMS);
            let state_ext = Self::query_extension::<clap_plugin_state>(plugin_ref, CLAP_EXT_STATE);
            let gui_ext = Self::query_extension::<clap_plugin_gui>(plugin_ref, CLAP_EXT_GUI);
            let latency_ext =
                Self::query_extension::<clap_plugin_latency>(plugin_ref, CLAP_EXT_LATENCY);

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
                _library: Some(library),
                plugin,
                host,
                activated,
                name,
                sample_rate,
                params_ext,
                state_ext,
                gui_ext,
                latency_ext,
                host_state,
                gui_open: false,
                processing,
                transport_scratch: Box::new(empty_transport_event()),
                has_transport: false,
                input_scratch: Box::new([[0.0f32; MAX_BUFFER]; 2]),
                output_scratch: Box::new([[0.0f32; MAX_BUFFER]; 2]),
                midi_scratch: Vec::with_capacity(MAX_MIDI),
                parameter_scratch: Vec::with_capacity(MAX_PARAMETER_EVENTS),
                #[cfg(feature = "engine-owned-command-fixture")]
                command_fixture: None,
            })
        }
    }

    #[cfg(feature = "engine-owned-command-fixture")]
    #[doc(hidden)]
    pub fn new_engine_owned_command_fixture(name: &str, state: Vec<u8>, has_gui: bool) -> Self {
        Self {
            _library: None,
            plugin: ptr::null(),
            host: Box::new(create_host_descriptor()),
            activated: true,
            name: name.to_string(),
            sample_rate: 0.0,
            params_ext: ptr::null(),
            state_ext: ptr::null(),
            gui_ext: ptr::null(),
            latency_ext: ptr::null(),
            host_state: Box::new(HostCallbackState::default()),
            gui_open: false,
            processing: Arc::new(ProcessingGate::fixture_already_processing()),
            transport_scratch: Box::new(empty_transport_event()),
            has_transport: false,
            input_scratch: Box::new([[0.0f32; MAX_BUFFER]; 2]),
            output_scratch: Box::new([[0.0f32; MAX_BUFFER]; 2]),
            midi_scratch: Vec::with_capacity(MAX_MIDI),
            parameter_scratch: Vec::with_capacity(MAX_PARAMETER_EVENTS),
            command_fixture: Some(EngineOwnedCommandFixture {
                state,
                has_gui,
                parameters: Vec::new(),
            }),
        }
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

            // 3. Set scale (use 1.0 — plugins handle Retina internally on macOS)
            if let Some(set_scale) = gui.set_scale {
                set_scale(self.plugin, 1.0);
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
            eprintln!(
                "[CLAP] Opened GUI for '{}' ({}x{})",
                self.name, width, height
            );
            Ok((width, height))
        }
    }

    /// Close (hide + destroy) the plugin GUI.
    pub fn close_gui(&mut self) {
        #[cfg(feature = "engine-owned-command-fixture")]
        if self.command_fixture.is_some() {
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
        midi_events: &[(u8, u8, i16, bool)], // (note, velocity, channel, is_on)
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
        midi_events: &[(u8, u8, i16, bool)], // (note, velocity, channel, is_on)
        parameter_updates: &[HostParameterUpdate],
    ) {
        if !self.activated
            || self.plugin.is_null()
            || (midi_events.is_empty() && parameter_updates.is_empty())
        {
            self.process_audio_internal(inputs, outputs, num_samples, &EMPTY_INPUT_EVENTS);
            return;
        }

        // Reuse preallocated scratch — no heap allocation on the RT thread.
        self.midi_scratch.clear();
        for &(note, vel, ch, is_on) in midi_events.iter().take(MAX_MIDI) {
            self.midi_scratch.push(clap_event_note {
                header: clap_event_header {
                    size: mem::size_of::<clap_event_note>() as u32,
                    time: 0,
                    space_id: CLAP_CORE_EVENT_SPACE_ID,
                    type_: if is_on {
                        CLAP_EVENT_NOTE_ON
                    } else {
                        CLAP_EVENT_NOTE_OFF
                    },
                    flags: 0,
                },
                note_id: -1,
                port_index: 0,
                channel: ch,
                key: note as i16,
                velocity: vel as f64 / 127.0,
            });
        }
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
        let n_ch = inputs.len().min(2);

        // Copy inputs into scratch — zero allocation on RT path.
        for (ch, src) in inputs.iter().enumerate().take(n_ch) {
            let len = src.len().min(n_samp);
            self.input_scratch[ch][..len].copy_from_slice(&src[..len]);
            self.input_scratch[ch][len..n_samp].fill(0.0);
        }
        for ch in n_ch..2 {
            self.input_scratch[ch][..n_samp].fill(0.0);
        }
        self.output_scratch[0][..n_samp].fill(0.0);
        self.output_scratch[1][..n_samp].fill(0.0);

        unsafe {
            let plugin_ref = &*self.plugin;
            let process_fn = match plugin_ref.process {
                Some(f) => f,
                None => return,
            };

            // Stack-allocated pointer arrays — no heap allocation.
            let in_ptrs: [*const f32; 2] = [
                self.input_scratch[0].as_ptr(),
                self.input_scratch[1].as_ptr(),
            ];
            let out_ptrs: [*mut f32; 2] = [
                self.output_scratch[0].as_mut_ptr(),
                self.output_scratch[1].as_mut_ptr(),
            ];

            let input_buffer = clap_audio_buffer {
                data32: in_ptrs.as_ptr() as *mut *mut f32,
                data64: ptr::null_mut(),
                channel_count: n_ch as u32,
                latency: 0,
                constant_mask: 0,
            };

            let mut output_buffer = clap_audio_buffer {
                data32: out_ptrs.as_ptr() as *mut *mut f32,
                data64: ptr::null_mut(),
                channel_count: n_ch as u32,
                latency: 0,
                constant_mask: 0,
            };

            // A null transport tells the plugin the host has no timeline, so it
            // is only sent while that is actually true. Once the host supplies
            // one, the preallocated event is passed by pointer — the plugin
            // reads it during this call and never retains it.
            let transport = if self.has_transport {
                &*self.transport_scratch as *const clap_event_transport
            } else {
                ptr::null()
            };

            let process_data = clap_process {
                steady_time: -1,
                frames_count: n_samp as u32,
                transport,
                audio_inputs: &input_buffer,
                audio_outputs: &mut output_buffer,
                audio_inputs_count: 1,
                audio_outputs_count: 1,
                in_events,
                out_events: &EMPTY_OUTPUT_EVENTS,
            };

            let _status = process_fn(self.plugin, &process_data);

            for (ch_idx, out_ch) in outputs.iter_mut().enumerate().take(n_ch) {
                let len = n_samp.min(out_ch.len());
                out_ch[..len].copy_from_slice(&self.output_scratch[ch_idx][..len]);
            }
        }
    }
}

/// Pass the block through unchanged, for every case where the plugin must not
/// be handed it: not activated, or not in the CLAP processing state.
fn copy_inputs_to_outputs(inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
    for (ch, out) in outputs.iter_mut().enumerate() {
        if ch < inputs.len() {
            let len = num_samples.min(inputs[ch].len()).min(out.len());
            out[..len].copy_from_slice(&inputs[ch][..len]);
        }
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

impl ClapWrapper {
    /// The plugin's current reported latency in samples. `0` when the plugin has
    /// no latency extension or is not active — CLAP defines `clap_plugin_latency.get`
    /// as `[main-thread & (being-activated | active)]`, so it is only meaningful
    /// while active. Call from the main/control thread only.
    pub fn latency_samples(&self) -> u32 {
        #[cfg(feature = "engine-owned-command-fixture")]
        if self.command_fixture.is_some() {
            return 0;
        }

        if !self.activated {
            return 0;
        }
        unsafe { read_latency_ext(self.latency_ext, self.plugin) }
    }

    /// The plugin's current reported latency in **milliseconds**.
    ///
    /// CLAP reports latency as a frame count in the clock the plugin was
    /// ACTIVATED with (`self.sample_rate`, the CPAL device rate). This wrapper is
    /// the only place that rate is known, so it is the only place the conversion
    /// is sound — a consumer on another clock (e.g. a webview `AudioContext`
    /// running at a different rate) would silently mis-scale the sample count.
    pub fn latency_ms(&self) -> f64 {
        if !self.sample_rate.is_finite() || self.sample_rate <= 0.0 {
            return 0.0;
        }
        f64::from(self.latency_samples()) / self.sample_rate * 1000.0
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
                flush(self.plugin, &input_events, &EMPTY_OUTPUT_EVENTS);
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

                // Extract the name from the fixed-size C char array
                let name = CStr::from_ptr(info.name.as_ptr())
                    .to_string_lossy()
                    .into_owned();

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

    fn get_state(&self) -> Vec<u8> {
        #[cfg(feature = "engine-owned-command-fixture")]
        if let Some(fixture) = self.command_fixture.as_ref() {
            return fixture.state.clone();
        }

        if self.state_ext.is_null() || self.plugin.is_null() {
            return vec![];
        }

        unsafe {
            let state = &*self.state_ext;
            let save_fn = match state.save {
                Some(f) => f,
                None => return vec![],
            };

            let mut buffer: Vec<u8> = Vec::new();
            let ostream = clap_ostream {
                ctx: &mut buffer as *mut Vec<u8> as *mut c_void,
                write: Some(ostream_write),
            };

            let ok = save_fn(self.plugin, &ostream);
            if ok {
                buffer
            } else {
                eprintln!("[CLAP] state.save() failed for {}", self.name);
                vec![]
            }
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
        midi_events: &[(u8, u8, i16, bool)],
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
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let latency_ext = unsafe {
            ClapWrapper::query_extension::<clap_plugin_latency>(&*plugin, CLAP_EXT_LATENCY)
        };
        // Mirrors what a successful load leaves behind: activated, and asking to
        // process as soon as the audio thread next runs the plugin.
        let processing = Arc::new(ProcessingGate::default());
        processing.request_start();
        ClapWrapper {
            _library: None,
            plugin,
            host: Box::new(create_host_descriptor()),
            activated: true,
            name: "stub".to_string(),
            sample_rate: 48_000.0,
            params_ext: ptr::null(),
            state_ext: ptr::null(),
            gui_ext: ptr::null(),
            latency_ext,
            host_state: Box::new(HostCallbackState::default()),
            gui_open: false,
            processing,
            transport_scratch: Box::new(empty_transport_event()),
            has_transport: false,
            input_scratch: Box::new([[0.0f32; MAX_BUFFER]; 2]),
            output_scratch: Box::new([[0.0f32; MAX_BUFFER]; 2]),
            midi_scratch: Vec::with_capacity(MAX_MIDI),
            parameter_scratch: Vec::with_capacity(MAX_PARAMETER_EVENTS),
            #[cfg(feature = "engine-owned-command-fixture")]
            command_fixture: None,
        }
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
        0
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
}

impl Drop for ClapWrapper {
    fn drop(&mut self) {
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
    }
}
