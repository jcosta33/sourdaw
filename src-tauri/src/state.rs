use crate::host::native_bridge::SharedClapPlugin;
use daw_engine::audio_bridge::PluginAudioBridgeHandle;
use daw_engine::EngineHandle;
use daw_plugin_host::AudioPlugin;
use daw_plugin_host::ClapWrapper;
use daw_plugin_host::PluginParameter;
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::Duration;

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

pub struct EnginePluginInstanceData {
    pub engine_plugin_id: usize,
    pub runtime: Arc<SharedClapPlugin>,
    pub name: String,
    pub parameters: Vec<PluginParameter>,
    pub has_gui: bool,
}

pub struct AppState {
    /// Native audio engine handle (cpal thread + lock-free scheduler).
    /// None until start_native_engine is called. Declared before engine-owned
    /// runtime maps so app teardown drops the stream before active CLAP runtimes.
    pub engine: Arc<Mutex<Option<EngineHandle>>>,
    /// Active plugin instances keyed by instance_id.
    pub plugins: Arc<Mutex<HashMap<String, PluginInstanceData>>>,
    /// Engine-owned plugin instances keyed by UI/runtime instance_id.
    pub engine_plugins: Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>,
    /// Registry mapping plugin_id → (file_path, clap_plugin_id).
    /// Populated by scan_plugins so load_plugin can find the library.
    pub plugin_registry: Arc<Mutex<HashMap<String, PluginRegistryEntry>>>,
    /// Open plugin GUI windows, keyed by instance_id → window label.
    pub plugin_windows: Arc<Mutex<HashMap<String, String>>>,
    /// Audio bridge handles for each plugin instance (main thread side).
    /// Keyed by engine_plugin_id.
    pub audio_bridges: Arc<Mutex<HashMap<usize, PluginAudioBridgeHandle>>>,
    /// Retired engine-owned runtimes kept alive after scheduler removal is
    /// queued so the CPAL callback never final-drops a hosted plugin. Declared
    /// after `engine` so app teardown drops the stream before these runtimes.
    pub retired_engine_plugins: Arc<Mutex<Vec<Arc<SharedClapPlugin>>>>,
    /// Input blocks `process_plugin_audio` could not hand to a bridge because
    /// its input ring was full. Each one is audio the plugin never saw, and on
    /// the native sampler's record feed it is a hole in the recording — so the
    /// refusal is counted and reported through `engine_rt_diagnostics` rather
    /// than discarded with the block.
    pub bridge_input_blocks_refused: Arc<AtomicU64>,
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
            engine: Arc::new(Mutex::new(None)),
            plugins: Arc::new(Mutex::new(HashMap::new())),
            engine_plugins: Arc::new(Mutex::new(HashMap::new())),
            plugin_registry: Arc::new(Mutex::new(HashMap::new())),
            plugin_windows: Arc::new(Mutex::new(HashMap::new())),
            audio_bridges: Arc::new(Mutex::new(HashMap::new())),
            retired_engine_plugins: Arc::new(Mutex::new(Vec::new())),
            bridge_input_blocks_refused: Arc::new(AtomicU64::new(0)),
        }
    }
}

fn retain_runtime_once<Runtime>(retired_runtimes: &mut Vec<Arc<Runtime>>, runtime: Arc<Runtime>) {
    if retired_runtimes
        .iter()
        .any(|retired_runtime| Arc::ptr_eq(retired_runtime, &runtime))
    {
        return;
    }

    retired_runtimes.push(runtime);
}

impl AppState {
    pub fn with_engine_plugin_control<ResultValue>(
        &self,
        instance_id: &str,
        operation: impl FnOnce(&mut ClapWrapper) -> Result<ResultValue, String>,
    ) -> Result<ResultValue, String> {
        let runtime = {
            let engine_plugins = self
                .engine_plugins
                .lock()
                .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
            engine_plugins
                .get(instance_id)
                .map(|instance| Arc::clone(&instance.runtime))
                .ok_or_else(|| format!("No engine-owned plugin instance: {}", instance_id))?
        };

        runtime.with_control(Duration::from_secs(2), operation)
    }

    pub fn retain_retired_engine_plugin(&self, runtime: Arc<SharedClapPlugin>) {
        match self.retired_engine_plugins.lock() {
            Ok(mut retired_plugins) => {
                retain_runtime_once(&mut retired_plugins, runtime);
            }
            Err(poisoned) => {
                let mut retired_plugins = poisoned.into_inner();
                retain_runtime_once(&mut retired_plugins, runtime);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retain_runtime_once_pushes_new_runtime() {
        let runtime = Arc::new(17_u32);
        let mut retired_runtimes = Vec::new();

        retain_runtime_once(&mut retired_runtimes, Arc::clone(&runtime));

        assert_eq!(retired_runtimes.len(), 1);
        assert!(Arc::ptr_eq(&retired_runtimes[0], &runtime));
    }

    #[test]
    fn retain_runtime_once_dedupes_same_runtime_arc() {
        let runtime = Arc::new(17_u32);
        let mut retired_runtimes = Vec::new();

        retain_runtime_once(&mut retired_runtimes, Arc::clone(&runtime));
        retain_runtime_once(&mut retired_runtimes, Arc::clone(&runtime));

        assert_eq!(retired_runtimes.len(), 1);
        assert!(Arc::ptr_eq(&retired_runtimes[0], &runtime));
    }

    #[test]
    fn retain_runtime_once_keeps_distinct_runtimes() {
        let first_runtime = Arc::new(17_u32);
        let second_runtime = Arc::new(17_u32);
        let mut retired_runtimes = Vec::new();

        retain_runtime_once(&mut retired_runtimes, Arc::clone(&first_runtime));
        retain_runtime_once(&mut retired_runtimes, Arc::clone(&second_runtime));

        assert_eq!(retired_runtimes.len(), 2);
        assert!(Arc::ptr_eq(&retired_runtimes[0], &first_runtime));
        assert!(Arc::ptr_eq(&retired_runtimes[1], &second_runtime));
    }
}
