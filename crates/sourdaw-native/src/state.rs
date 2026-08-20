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
    /// None until the first `apply_graph_commands` batch lazily starts it
    /// (#1984). Declared before engine-owned runtime maps so app teardown
    /// drops the stream before active CLAP runtimes.
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
    /// Audio bridge handles keyed by engine_plugin_id.
    ///
    /// Only the crumbs sampler writes this map, and nothing reads it: the
    /// producer wiring that would feed those rings is missing and tracked
    /// separately. A CLAP instance's handle is not here — it lives on its
    /// `EnginePluginInstanceData`, because the relay resolves it by instance id
    /// on the audio relay path.
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
    /// Decoded timeline material, keyed by the app's stable source id.
    ///
    /// This is the native realisation of `AudioGraphClipSource.sourceId`
    /// (`src/modules/AudioEngine/models/AudioGraphBackend.ts`): the identity
    /// crosses the seam, the PCM is registered here once through
    /// `register_timeline_sample`, and every `schedule-clip` resolves the id
    /// against this pool. Control-side only — the audio thread receives copies
    /// already built into `TimelineClip`s.
    pub timeline_samples: Arc<Mutex<HashMap<String, TimelineSample>>>,
    /// The control-side registry that resolves the app's string strip, device
    /// and sample ids onto the engine's `usize` node ids, plus the strip facts
    /// (kind, VCA fold, chain occupancy) batch validation needs. See
    /// `commands::graph`.
    pub graph: Arc<Mutex<crate::commands::graph::GraphRegistry>>,
    /// Offline mapping sessions: probe registries `map_graph_batch` keeps
    /// across one render's applies so the TS backend's `prior` does not
    /// re-cross the wire every batch (#2225). Control-side only, LRU-capped;
    /// see `commands::graph::GraphMappingSessions`.
    pub graph_mapping_sessions: Arc<Mutex<crate::commands::graph::GraphMappingSessions>>,
}

/// One registered piece of timeline material: planar stereo PCM and the rate
/// it was decoded at.
///
/// `right` is empty for mono material, matching `daw_engine::TimelineClip`'s
/// own convention, and `sample_rate` is the *material's* rate — a clip
/// scheduled onto an engine running at a different rate is converted at the
/// clip's `playback_rate` (rate conversion, not time stretch).
pub struct TimelineSample {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
    pub sample_rate: f32,
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
            timeline_samples: Arc::new(Mutex::new(HashMap::new())),
            graph: Arc::new(Mutex::new(crate::commands::graph::GraphRegistry::default())),
            graph_mapping_sessions: Arc::new(Mutex::new(
                crate::commands::graph::GraphMappingSessions::default(),
            )),
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

/// Move every retired runtime the scheduler has already released out of the vec
/// and hand it back to the caller — *without* dropping it.
///
/// The retirement vec exists so the CPAL callback never final-drops a hosted
/// plugin: removal from the scheduler is *queued*, so at the moment a runtime is
/// retired the audio thread may still be holding — and processing — the
/// `ClapPluginSlot` that owns the second `Arc`. Freeing then is a use-after-free
/// on the audio thread.
///
/// The scheduler's own `Arc` is therefore the acknowledgment: when the slot is
/// dropped, that clone goes with it, and a retirement entry whose strong count
/// is back to 1 is provably referenced by nothing but this vec. An entry the
/// scheduler still holds keeps a count above 1 and survives every sweep — the
/// conservatism is unchanged, this only marks the point at which it stops being
/// needed.
///
/// The released entries are *returned* rather than freed here because dropping
/// one runs CLAP teardown — arbitrary third-party code, including a plugin's
/// `destroy`, which may take unbounded time. See `sweep_retired_runtimes` for
/// the lock discipline that depends on this.
fn take_released_retired_runtimes<Runtime>(
    retired_runtimes: &mut Vec<Arc<Runtime>>,
) -> Vec<Arc<Runtime>> {
    let (released_runtimes, scheduler_held_runtimes): (Vec<_>, Vec<_>) =
        std::mem::take(retired_runtimes)
            .into_iter()
            .partition(|retired_runtime| Arc::strong_count(retired_runtime) == 1);
    *retired_runtimes = scheduler_held_runtimes;
    released_runtimes
}

/// Reclaim every released runtime in a retirement vec, running its teardown
/// outside the retirement critical section.
///
/// Dropping a released runtime runs CLAP `deactivate`/`destroy` — third-party
/// code of unbounded duration. Doing that while the retirement mutex is held
/// would park every concurrent `retain_retired_engine_plugin` (i.e. every
/// unload) for the whole teardown, so the released entries are taken out under
/// the lock, the guard is released, and only then are they dropped.
fn sweep_retired_runtimes<Runtime>(retired_runtimes: &Mutex<Vec<Arc<Runtime>>>) {
    let released_runtimes = {
        let mut retired_runtimes = match retired_runtimes.lock() {
            Ok(retired_runtimes) => retired_runtimes,
            Err(poisoned) => poisoned.into_inner(),
        };
        take_released_retired_runtimes(&mut retired_runtimes)
    };

    // Guard released. CLAP teardown runs here, on this non-RT thread, with the
    // retirement mutex free.
    drop(released_runtimes);
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
    /// the load and unload paths and once more at app exit — the moments a
    /// plugin's memory is about to be wanted again, plus the terminal one — and
    /// frees only runtimes the scheduler has demonstrably released. Teardown
    /// runs with the retirement mutex free; see `sweep_retired_runtimes`.
    pub fn sweep_retired_engine_plugins(&self) {
        sweep_retired_runtimes(&self.retired_engine_plugins);
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
    fn taking_released_runtimes_removes_one_the_scheduler_has_released() {
        let mut retired_runtimes = vec![Arc::new(17_u32)];

        let released_runtimes = take_released_retired_runtimes(&mut retired_runtimes);

        assert!(retired_runtimes.is_empty());
        assert_eq!(released_runtimes.len(), 1);
    }

    /// The other half of the same invariant, and the reason the vec exists:
    /// while the scheduler still holds the runtime, the audio thread may still
    /// be processing it. Freeing then is a use-after-free.
    #[test]
    fn taking_released_runtimes_keeps_one_the_scheduler_still_references() {
        let scheduler_reference = Arc::new(17_u32);
        let mut retired_runtimes = vec![Arc::clone(&scheduler_reference)];

        assert!(take_released_retired_runtimes(&mut retired_runtimes).is_empty());
        assert_eq!(retired_runtimes.len(), 1);
        assert!(Arc::ptr_eq(&retired_runtimes[0], &scheduler_reference));

        // Releasing the scheduler's reference is the acknowledgment the sweep
        // waits for; the next sweep reclaims it.
        drop(scheduler_reference);
        assert_eq!(
            take_released_retired_runtimes(&mut retired_runtimes).len(),
            1
        );

        assert!(retired_runtimes.is_empty());
    }

    /// A sweep never sees a vec of one kind: an unload retires a runtime while
    /// earlier ones are still held by the scheduler. Exactly the released ones
    /// must leave, and the held ones must survive in place.
    #[test]
    fn a_mixed_retirement_vec_loses_only_the_released_runtimes() {
        let first_scheduler_reference = Arc::new(1_u32);
        let second_scheduler_reference = Arc::new(2_u32);
        let mut retired_runtimes = vec![
            Arc::new(10_u32),
            Arc::clone(&first_scheduler_reference),
            Arc::new(11_u32),
            Arc::clone(&second_scheduler_reference),
            Arc::new(12_u32),
        ];

        let released_runtimes = take_released_retired_runtimes(&mut retired_runtimes);

        assert_eq!(
            released_runtimes.iter().map(|r| **r).collect::<Vec<_>>(),
            vec![10, 11, 12],
            "every runtime the scheduler released must be handed back"
        );
        assert_eq!(retired_runtimes.len(), 2);
        assert!(Arc::ptr_eq(
            &retired_runtimes[0],
            &first_scheduler_reference
        ));
        assert!(Arc::ptr_eq(
            &retired_runtimes[1],
            &second_scheduler_reference
        ));
    }

    /// Dropping a released runtime runs CLAP teardown — third-party code of
    /// unbounded duration. Running it under the retirement mutex parks every
    /// concurrent unload for its whole duration, so the sweep must release the
    /// guard first. Observed by asking, from inside the teardown itself,
    /// whether the retirement lock is free.
    struct RetirementLockProbe {
        retired_runtimes: Arc<Mutex<Vec<Arc<RetirementLockProbe>>>>,
        retirement_lock_was_free: Arc<std::sync::atomic::AtomicBool>,
    }

    impl Drop for RetirementLockProbe {
        fn drop(&mut self) {
            let retirement_lock_was_free = self.retired_runtimes.try_lock().is_ok();
            self.retirement_lock_was_free.store(
                retirement_lock_was_free,
                std::sync::atomic::Ordering::Relaxed,
            );
        }
    }

    #[test]
    fn teardown_runs_after_the_retirement_guard_is_released() {
        let retired_runtimes: Arc<Mutex<Vec<Arc<RetirementLockProbe>>>> =
            Arc::new(Mutex::new(Vec::new()));
        let retirement_lock_was_free = Arc::new(std::sync::atomic::AtomicBool::new(false));
        retired_runtimes
            .lock()
            .expect("retirement lock")
            .push(Arc::new(RetirementLockProbe {
                retired_runtimes: Arc::clone(&retired_runtimes),
                retirement_lock_was_free: Arc::clone(&retirement_lock_was_free),
            }));

        sweep_retired_runtimes(&retired_runtimes);

        assert!(
            retirement_lock_was_free.load(std::sync::atomic::Ordering::Relaxed),
            "CLAP teardown must not run inside the retirement critical section"
        );
        assert!(retired_runtimes.lock().expect("retirement lock").is_empty());
    }

    /// Load/unload cycling is what accumulates retirements, so the sweep has to
    /// hold across repeats, not just once.
    ///
    /// The command fixture's CLAP plugin pointer is null, so no real CLAP
    /// teardown runs here: what this pins is the Arc-count logic that decides
    /// *when* teardown is allowed, not the teardown itself.
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
