use serde::{Deserialize, Serialize};

/// A single parameter exposed by a native plugin.
/// This is the canonical DTO for plugin parameter metadata and values,
/// shared between the plugin host internals and the Tauri command surface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginParameter {
    pub id: u32,
    pub name: String,
    pub value: f64,
    pub default_value: f64,
    pub min_value: f64,
    pub max_value: f64,
    pub unit: Option<String>,
    pub is_automatable: bool,
}
