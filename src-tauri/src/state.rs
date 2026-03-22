use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{Arc, Mutex};
use crate::host::traits::AudioPlugin;
use crate::host::clap_wrapper::ClapWrapper;

pub struct PluginInstanceData {
    pub plugin: Box<dyn AudioPlugin>,
}

impl PluginInstanceData {
    /// Check if this plugin instance supports a custom GUI.
    pub fn has_gui(&self) -> bool {
        if let Some(clap) = self.as_clap() {
            clap.has_gui()
        } else {
            false
        }
    }

    /// Get the display name of this plugin.
    pub fn get_name(&self) -> &str {
        if let Some(clap) = self.as_clap() {
            clap.get_name()
        } else {
            "Plugin"
        }
    }

    /// Open the plugin GUI, parenting it into the given native handle.
    pub fn open_gui(&mut self, handle_ptr: *mut c_void) -> Result<(u32, u32), String> {
        if let Some(clap) = self.as_clap_mut() {
            clap.open_gui(handle_ptr)
        } else {
            Err("Plugin does not support GUI (not a CLAP plugin)".to_string())
        }
    }

    /// Close the plugin GUI.
    pub fn close_gui(&mut self) {
        if let Some(clap) = self.as_clap_mut() {
            clap.close_gui();
        }
    }

    /// Downcast to ClapWrapper (immutable) via the as_any trait method.
    fn as_clap(&self) -> Option<&ClapWrapper> {
        self.plugin.as_any().downcast_ref::<ClapWrapper>()
    }

    /// Downcast to ClapWrapper (mutable) via the as_any_mut trait method.
    fn as_clap_mut(&mut self) -> Option<&mut ClapWrapper> {
        self.plugin.as_any_mut().downcast_mut::<ClapWrapper>()
    }
}

pub struct AppState {
    /// Active plugin instances keyed by instance_id.
    pub plugins: Arc<Mutex<HashMap<String, PluginInstanceData>>>,
    /// Registry mapping plugin_id → (file_path, clap_plugin_id).
    /// Populated by scan_plugins so load_plugin can find the library.
    pub plugin_registry: Arc<Mutex<HashMap<String, PluginRegistryEntry>>>,
    /// Open plugin GUI windows, keyed by instance_id → window label.
    pub plugin_windows: Arc<Mutex<HashMap<String, String>>>,
}

#[derive(Clone, Debug)]
pub struct PluginRegistryEntry {
    pub path: String,
    pub clap_id: String,
    pub format: String,
    pub name: String,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            plugins: Arc::new(Mutex::new(HashMap::new())),
            plugin_registry: Arc::new(Mutex::new(HashMap::new())),
            plugin_windows: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
