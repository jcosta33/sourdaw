use crate::host::native_bridge::SharedClapPlugin;
use daw_engine::audio_bridge::{PluginAudioBridgeHandle, MAX_BLOCK_FRAMES};
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

/// Preallocated de-interleave scratch for one instance's worklet↔engine relay.
///
/// `process_plugin_audio` runs once per render quantum per bridged plugin, so a
/// `Vec` allocated inside it is allocator churn on the path that services the
/// audio relay. Both buffers are sized once to the largest block the bridge
/// accepts (`MAX_BLOCK_FRAMES`) and refilled in place: the relay clears and
/// pushes, never grows. A block larger than that capacity is refused by
/// `push_input` anyway, so the relay never has a reason to reallocate.
pub struct PluginRelayScratch {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
}

impl Default for PluginRelayScratch {
    fn default() -> Self {
        Self {
            left: Vec::with_capacity(MAX_BLOCK_FRAMES),
            right: Vec::with_capacity(MAX_BLOCK_FRAMES),
        }
    }
}

pub struct EnginePluginInstanceData {
    pub engine_plugin_id: usize,
    pub runtime: Arc<SharedClapPlugin>,
    pub name: String,
    pub parameters: Vec<PluginParameter>,
    pub has_gui: bool,
    /// Main-thread end of this instance's audio bridge.
    ///
    /// Held on the instance record, not in a second map keyed by engine plugin
    /// id, so the relay resolves an instance id to its ring in one lock and one
    /// lookup — and so the ring cannot outlive, or go missing from, the record
    /// that owns it.
    pub bridge: Option<PluginAudioBridgeHandle>,
    pub relay_scratch: PluginRelayScratch,
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
    /// Audio bridge handles for engine-owned slots that are not CLAP plugin
    /// instances, keyed by engine_plugin_id. A CLAP instance's handle lives on
    /// its `EnginePluginInstanceData` instead, because the relay resolves it by
    /// instance id on the audio relay path.
    pub audio_bridges: Arc<Mutex<HashMap<usize, PluginAudioBridgeHandle>>>,
    /// Retired engine-owned runtimes kept alive after scheduler removal is
    /// queued so the CPAL callback never final-drops a hosted plugin. Declared
    /// after `engine` so app teardown drops the stream before these runtimes.
    ///
    /// Entries leave only through `sweep_retired_engine_plugins`, and only once
    /// the scheduler has released its own `Arc` — see that method for the
    /// invariant.
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

/// Drop every retired runtime the scheduler has already released.
///
/// The retirement vec exists so the CPAL callback never final-drops a hosted
/// plugin: removal from the scheduler is *queued*, so at the moment a runtime is
/// retired the audio thread may still be holding — and processing — the
/// `ClapPluginSlot` that owns the second `Arc`. Freeing then is a use-after-free
/// on the audio thread.
///
/// The scheduler's own `Arc` is therefore the acknowledgment: when the slot is
/// dropped, that clone goes with it, and a retirement entry whose strong count
/// is back to 1 is provably referenced by nothing but this vec. Dropping it here
/// runs the CLAP teardown on the calling (non-RT) thread, which is the only
/// thread allowed to do it. An entry the scheduler still holds keeps a count
/// above 1 and survives every sweep — the conservatism is unchanged, this only
/// adds the point at which it stops being needed.
fn drain_released_retired_runtimes<Runtime>(retired_runtimes: &mut Vec<Arc<Runtime>>) {
    retired_runtimes.retain(|retired_runtime| Arc::strong_count(retired_runtime) > 1);
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

    /// Reclamation point for the retirement vec. Runs off the audio thread, on
    /// the load and unload paths — the moments a plugin's memory is about to be
    /// wanted again — and frees only runtimes the scheduler has demonstrably
    /// released. See `drain_released_retired_runtimes`.
    pub fn sweep_retired_engine_plugins(&self) {
        match self.retired_engine_plugins.lock() {
            Ok(mut retired_plugins) => drain_released_retired_runtimes(&mut retired_plugins),
            Err(poisoned) => drain_released_retired_runtimes(&mut poisoned.into_inner()),
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

    /// The retirement vec had no reader, drain or clear anywhere: every
    /// engine-owned unload leaked a fully activated CLAP runtime for the life
    /// of the process. Once the scheduler has dropped its own reference there
    /// is nothing left to protect, and the entry must go.
    #[test]
    fn drain_frees_a_runtime_the_scheduler_has_released() {
        let mut retired_runtimes = vec![Arc::new(17_u32)];

        drain_released_retired_runtimes(&mut retired_runtimes);

        assert!(retired_runtimes.is_empty());
    }

    /// The other half of the same invariant, and the reason the vec exists:
    /// while the scheduler still holds the runtime, the audio thread may still
    /// be processing it. Freeing then is a use-after-free.
    #[test]
    fn drain_keeps_a_runtime_the_scheduler_still_references() {
        let scheduler_reference = Arc::new(17_u32);
        let mut retired_runtimes = vec![Arc::clone(&scheduler_reference)];

        drain_released_retired_runtimes(&mut retired_runtimes);

        assert_eq!(retired_runtimes.len(), 1);
        assert!(Arc::ptr_eq(&retired_runtimes[0], &scheduler_reference));

        // Releasing the scheduler's reference is the acknowledgment the sweep
        // waits for; the next sweep reclaims it.
        drop(scheduler_reference);
        drain_released_retired_runtimes(&mut retired_runtimes);

        assert!(retired_runtimes.is_empty());
    }

    /// Load/unload cycling is what accumulates retirements, so the sweep has to
    /// hold across repeats, not just once.
    #[test]
    fn repeated_retire_and_sweep_cycles_leave_the_retirement_vec_empty() {
        let state = AppState::default();

        for _ in 0..8 {
            let runtime = Arc::new(SharedClapPlugin::new(
                daw_plugin_host::ClapWrapper::new_engine_owned_command_fixture(
                    "retirement fixture",
                    Vec::new(),
                    false,
                ),
            ));
            state.retain_retired_engine_plugin(Arc::clone(&runtime));

            // The scheduler still holds this one, exactly as it does between
            // the queued removal and the audio thread dropping the slot.
            state.sweep_retired_engine_plugins();
            assert_eq!(
                state
                    .retired_engine_plugins
                    .lock()
                    .expect("retirement lock")
                    .len(),
                1,
                "a runtime the scheduler still holds must survive the sweep"
            );

            drop(runtime);
            state.sweep_retired_engine_plugins();
            assert!(
                state
                    .retired_engine_plugins
                    .lock()
                    .expect("retirement lock")
                    .is_empty(),
                "cycling load/unload must not accumulate retired runtimes"
            );
        }
    }
}
