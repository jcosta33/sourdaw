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

use crate::clap_host::create_host_descriptor;
use crate::params::PluginParameter;
use crate::traits::AudioPlugin;
use clap_sys::entry::clap_plugin_entry;
use clap_sys::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::plugin::clap_plugin;
use clap_sys::process::clap_process;
use clap_sys::audio_buffer::clap_audio_buffer;
use clap_sys::events::{
    clap_input_events, clap_output_events, clap_event_header,
    clap_event_param_value, clap_event_note,
    CLAP_EVENT_PARAM_VALUE, CLAP_EVENT_NOTE_ON, CLAP_EVENT_NOTE_OFF,
    CLAP_CORE_EVENT_SPACE_ID,
};
use clap_sys::ext::params::{
    clap_plugin_params, clap_param_info, CLAP_EXT_PARAMS,
    CLAP_PARAM_IS_AUTOMATABLE, CLAP_PARAM_IS_HIDDEN, CLAP_PARAM_IS_READONLY,
};
use clap_sys::ext::state::{clap_plugin_state, CLAP_EXT_STATE};
use clap_sys::ext::gui::{
    clap_plugin_gui, clap_window, clap_window_handle,
    CLAP_EXT_GUI, CLAP_WINDOW_API_COCOA, CLAP_WINDOW_API_WIN32, CLAP_WINDOW_API_X11,
};
use clap_sys::stream::{clap_istream, clap_ostream};
use libloading::Library;
use std::ffi::{CStr, CString, c_void};
use std::ptr;
use std::mem;

/// Holds a loaded CLAP plugin instance and its associated resources.
pub struct ClapWrapper {
    /// The dynamically loaded shared library — must outlive the plugin instance.
    _library: Library,
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
    /// Whether the GUI is currently open.
    gui_open: bool,
    /// Preallocated input channel scratch (2 ch × MAX_BUFFER samples). No RT allocation.
    input_scratch: Box<[[f32; MAX_BUFFER]; 2]>,
    /// Preallocated output channel scratch (2 ch × MAX_BUFFER samples). No RT allocation.
    output_scratch: Box<[[f32; MAX_BUFFER]; 2]>,
    /// Preallocated MIDI event scratch list. Cleared + refilled each block, never reallocated.
    midi_scratch: Vec<clap_event_note>,
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
                let path_c = CString::new(plugin_path)
                    .map_err(|_| "Invalid plugin path")?;
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
            let host = Box::new(create_host_descriptor());
            let host_ptr: *const clap_host = &*host;

            // 6. Create the plugin instance
            let id_c = CString::new(plugin_id)
                .map_err(|_| "Invalid plugin ID")?;

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
            let params_ext = Self::query_extension::<clap_plugin_params>(plugin_ref, CLAP_EXT_PARAMS);
            let state_ext = Self::query_extension::<clap_plugin_state>(plugin_ref, CLAP_EXT_STATE);
            let gui_ext = Self::query_extension::<clap_plugin_gui>(plugin_ref, CLAP_EXT_GUI);

            if !params_ext.is_null() {
                eprintln!("[CLAP] Plugin '{}' supports CLAP_EXT_PARAMS", name);
            }
            if !state_ext.is_null() {
                eprintln!("[CLAP] Plugin '{}' supports CLAP_EXT_STATE", name);
            }
            if !gui_ext.is_null() {
                eprintln!("[CLAP] Plugin '{}' supports CLAP_EXT_GUI", name);
            }

            // 9. Activate the plugin
            let mut activated = false;
            if let Some(activate_fn) = plugin_ref.activate {
                let ok = activate_fn(plugin, sample_rate, 32, 4096);
                if ok {
                    activated = true;
                    // Start processing
                    if let Some(start_processing) = plugin_ref.start_processing {
                        start_processing(plugin);
                    }
                } else {
                    eprintln!("[CLAP] Warning: plugin.activate() returned false for {}", name);
                }
            }

            eprintln!("[CLAP] Loaded plugin: {} (activated={})", name, activated);

            Ok(Self {
                _library: library,
                plugin,
                host,
                activated,
                name,
                sample_rate,
                params_ext,
                state_ext,
                gui_ext,
                gui_open: false,
                input_scratch: Box::new([[0.0f32; MAX_BUFFER]; 2]),
                output_scratch: Box::new([[0.0f32; MAX_BUFFER]; 2]),
                midi_scratch: Vec::with_capacity(MAX_MIDI),
            })
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

    // ── GUI support ─────────────────────────────────────────────────────

    /// Returns true if the plugin provides a custom GUI.
    pub fn has_gui(&self) -> bool {
        !self.gui_ext.is_null()
    }

    /// Returns true if the GUI is currently open.
    pub fn is_gui_open(&self) -> bool {
        self.gui_open
    }

    /// Get the preferred GUI size (width, height) if the plugin has a GUI.
    /// Must be called AFTER gui.create() for most plugins.
    pub fn get_gui_size(&self) -> Option<(u32, u32)> {
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
        { CLAP_WINDOW_API_COCOA }
        #[cfg(target_os = "windows")]
        { CLAP_WINDOW_API_WIN32 }
        #[cfg(target_os = "linux")]
        { CLAP_WINDOW_API_X11 }
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
                    return Err(format!("Plugin '{}' does not support embedded GUI on this platform", self.name));
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
                    { clap_window_handle { cocoa: handle_ptr } }
                    #[cfg(target_os = "windows")]
                    { clap_window_handle { win32: handle_ptr } }
                    #[cfg(target_os = "linux")]
                    { clap_window_handle { x11: handle_ptr as u64 } }
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
            eprintln!("[CLAP] Opened GUI for '{}' ({}x{})", self.name, width, height);
            Ok((width, height))
        }
    }

    /// Close (hide + destroy) the plugin GUI.
    pub fn close_gui(&mut self) {
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
        if !self.activated || self.plugin.is_null() || midi_events.is_empty() {
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
                    type_: if is_on { CLAP_EVENT_NOTE_ON } else { CLAP_EVENT_NOTE_OFF },
                    flags: 0,
                },
                note_id: -1,
                port_index: 0,
                channel: ch,
                key: note as i16,
                velocity: vel as f64 / 127.0,
            });
        }

        // Raw pointer into the scratch vec — safe because process_audio_internal
        // does not touch midi_scratch (it only uses input_scratch/output_scratch/plugin).
        let events_ptr: *const clap_event_note = self.midi_scratch.as_ptr();
        let events_count = self.midi_scratch.len() as u32;

        struct EventListCtx {
            events: *const clap_event_note,
            count: u32,
        }

        unsafe extern "C" fn event_list_size(list: *const clap_input_events) -> u32 {
            let ctx = (*list).ctx as *const EventListCtx;
            (*ctx).count
        }

        unsafe extern "C" fn event_list_get(
            list: *const clap_input_events,
            index: u32,
        ) -> *const clap_event_header {
            let ctx = (*list).ctx as *const EventListCtx;
            if index >= (*ctx).count {
                return ptr::null();
            }
            &(*(*ctx).events.add(index as usize)).header as *const clap_event_header
        }

        let mut ctx = EventListCtx { events: events_ptr, count: events_count };
        let input_events = clap_input_events {
            ctx: &mut ctx as *mut EventListCtx as *mut c_void,
            size: Some(event_list_size),
            get: Some(event_list_get),
        };

        self.process_audio_internal(inputs, outputs, num_samples, &input_events);
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
            for (ch, out) in outputs.iter_mut().enumerate() {
                if ch < inputs.len() {
                    let len = num_samples.min(inputs[ch].len()).min(out.len());
                    out[..len].copy_from_slice(&inputs[ch][..len]);
                }
            }
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
                data32: in_ptrs.as_ptr() as *const *const f32,
                data64: ptr::null_mut(),
                channel_count: n_ch as u32,
                latency: 0,
                constant_mask: 0,
            };

            let mut output_buffer = clap_audio_buffer {
                data32: out_ptrs.as_ptr() as *const *const f32,
                data64: ptr::null_mut(),
                channel_count: n_ch as u32,
                latency: 0,
                constant_mask: 0,
            };

            let process_data = clap_process {
                steady_time: -1,
                frames_count: n_samp as u32,
                transport: ptr::null(),
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

    fn set_state(&mut self, state_data: &[u8]) {
        if self.state_ext.is_null() || self.plugin.is_null() {
            return;
        }

        unsafe {
            let state = &*self.state_ext;
            let load_fn = match state.load {
                Some(f) => f,
                None => return,
            };

            let mut cursor = StreamCursor {
                data: state_data.to_vec(),
                pos: 0,
            };

            let istream = clap_istream {
                ctx: &mut cursor as *mut StreamCursor as *mut c_void,
                read: Some(istream_read),
            };

            let ok = load_fn(self.plugin, &istream);
            if !ok {
                eprintln!("[CLAP] state.load() failed for {}", self.name);
            }
        }
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}

impl Drop for ClapWrapper {
    fn drop(&mut self) {
        // Close GUI if it's still open
        if self.gui_open {
            self.close_gui();
        }

        if !self.plugin.is_null() {
            unsafe {
                let plugin_ref = &*self.plugin;

                if self.activated {
                    if let Some(stop_processing) = plugin_ref.stop_processing {
                        stop_processing(self.plugin);
                    }
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
