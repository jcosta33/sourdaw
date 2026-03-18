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
use clap_sys::process::{clap_process, clap_process_status, CLAP_PROCESS_CONTINUE};
use clap_sys::audio_buffer::clap_audio_buffer;
use clap_sys::events::{clap_input_events, clap_output_events, clap_event_header};
use libloading::Library;
use std::ffi::{CStr, CString};
use std::os::raw::c_void;
use std::ptr;

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

            // 8. Activate the plugin
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
            })
        }
    }

    /// Get the plugin descriptor info for scanning.
    pub fn get_name(&self) -> &str {
        &self.name
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

    fn set_parameter(&mut self, _param_id: u32, _value: f64) {
        // TODO: Implement via CLAP_EXT_PARAMS extension
        // Would need to query the params extension during init and cache it
    }

    fn get_parameters(&self) -> Vec<PluginParameter> {
        // TODO: Query CLAP_EXT_PARAMS for parameter list
        vec![]
    }

    fn get_state(&self) -> Vec<u8> {
        // TODO: Implement via CLAP_EXT_STATE extension
        vec![]
    }

    fn set_state(&mut self, _state: &[u8]) {
        // TODO: Implement via CLAP_EXT_STATE extension
    }
}

impl Drop for ClapWrapper {
    fn drop(&mut self) {
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
