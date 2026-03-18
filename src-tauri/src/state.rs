use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use crate::host::traits::AudioPlugin;

pub struct PluginInstanceData {
    pub plugin: Box<dyn AudioPlugin>,
}

pub struct AppState {
    /// Active plugin instances keyed by instance_id.
    pub plugins: Arc<Mutex<HashMap<String, PluginInstanceData>>>,
    /// Registry mapping plugin_id → (file_path, clap_plugin_id).
    /// Populated by scan_plugins so load_plugin can find the library.
    pub plugin_registry: Arc<Mutex<HashMap<String, PluginRegistryEntry>>>,
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
        }
    }
}
