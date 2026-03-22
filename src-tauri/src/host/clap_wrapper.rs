/// Real CLAP plugin wrapper — loads .clap shared libraries and hosts them.
///
/// Flow: dlopen → clap_entry.init() → factory.create_plugin(host, id) → plugin.activate() → plugin.process()

use crate::commands::plugins::PluginParameter;
use crate::host::clap_host_impl::create_host_descriptor;
use crate::host::traits::AudioPlugin;
use clap_sys::entry::clap_plugin_entry;
use clap_sys::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::plugin::clap_plugin;
use clap_sys::process::clap_process;
use clap_sys::audio_buffer::clap_audio_buffer;
use clap_sys::events::{
    clap_input_events, clap_output_events, clap_event_header,
    clap_event_param_value, CLAP_EVENT_PARAM_VALUE, CLAP_CORE_EVENT_SPACE_ID,
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
    pub fn new(plugin_path: &str, plugin_id: &str) -> Result<Self, String> {
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
            let sample_rate = 44100.0;
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
}

impl AudioPlugin for ClapWrapper {
    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
        if !self.activated || self.plugin.is_null() {
            // Passthrough — copy input to output
            for (ch, out) in outputs.iter_mut().enumerate() {
                if ch < inputs.len() {
                    let len = num_samples.min(inputs[ch].len()).min(out.len());
                    out[..len].copy_from_slice(&inputs[ch][..len]);
                }
            }
            return;
        }

        unsafe {
            let plugin_ref = &*self.plugin;
            let process_fn = match plugin_ref.process {
                Some(f) => f,
                None => return,
            };

            // Build CLAP audio buffers from our slices
            let num_channels = inputs.len().min(2) as u32;

            // Input buffer: copy to a local buffer since CLAP wants *mut f32
            let mut input_data: Vec<Vec<f32>> = inputs.iter()
                .take(2)
                .map(|ch| ch[..num_samples.min(ch.len())].to_vec())
                .collect();

            let mut input_ptrs: Vec<*mut f32> = input_data.iter_mut()
                .map(|ch| ch.as_mut_ptr())
                .collect();

            // Output buffer
            let mut output_data: Vec<Vec<f32>> = (0..num_channels)
                .map(|_| vec![0.0f32; num_samples])
                .collect();

            let mut output_ptrs: Vec<*mut f32> = output_data.iter_mut()
                .map(|ch| ch.as_mut_ptr())
                .collect();

            let input_buffer = clap_audio_buffer {
                data32: input_ptrs.as_mut_ptr() as *const *const f32,
                data64: ptr::null_mut(),
                channel_count: num_channels,
                latency: 0,
                constant_mask: 0,
            };

            let mut output_buffer = clap_audio_buffer {
                data32: output_ptrs.as_mut_ptr() as *const *const f32,
                data64: ptr::null_mut(),
                channel_count: num_channels,
                latency: 0,
                constant_mask: 0,
            };

            let process_data = clap_process {
                steady_time: -1,
                frames_count: num_samples as u32,
                transport: ptr::null(),
                audio_inputs: &input_buffer,
                audio_outputs: &mut output_buffer,
                audio_inputs_count: 1,
                audio_outputs_count: 1,
                in_events: &EMPTY_INPUT_EVENTS,
                out_events: &EMPTY_OUTPUT_EVENTS,
            };

            let _status = process_fn(self.plugin, &process_data);

            // Copy output back to the caller's buffers
            for (ch_idx, out_ch) in outputs.iter_mut().enumerate() {
                if ch_idx < output_data.len() {
                    let len = num_samples.min(out_ch.len()).min(output_data[ch_idx].len());
                    out_ch[..len].copy_from_slice(&output_data[ch_idx][..len]);
                }
            }
        }
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
                    unit: String::new(), // CLAP doesn't expose units in param_info directly
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
