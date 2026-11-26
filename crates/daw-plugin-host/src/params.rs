use serde::{Deserialize, Serialize};

/// A single parameter exposed by a native plugin.
/// This is the canonical DTO for plugin parameter metadata and values,
/// shared between the plugin host internals and the native command surface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginParameter {
    pub id: u32,
    pub name: String,
    pub value: f64,
    pub default_value: f64,
    pub min_value: f64,
    pub max_value: f64,
    pub unit: Option<String>,
    /// Whether automation may drive the parameter. A read-only parameter is
    /// never automatable, so this folds `is_read_only` in.
    pub is_automatable: bool,
    /// The plugin's own text for `value`, or `None` when the plugin offers
    /// none (no text call, a refusal, or an empty answer).
    pub display_text: Option<String>,
    /// How many steps the parameter has: 0 is continuous, 1 a toggle, and
    /// more a stepped control with `step_count + 1` positions.
    pub step_count: u32,
    /// The plugin marks the parameter as a list of named choices.
    pub is_list: bool,
    /// The plugin reports the parameter and nobody edits it, such as a meter.
    pub is_read_only: bool,
}
