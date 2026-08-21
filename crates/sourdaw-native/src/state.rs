use crate::host::native_bridge::SharedHostedPlugin;
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

/// Every method here reaches the plugin through `AudioPlugin` and nothing else.
///
/// These four used to downcast to `ClapWrapper` and answer "no editor", "not a
/// CLAP plugin" or nothing at all for anything else — which made the CLAP-only
/// assumption invisible at the call site and wrong for any second format. The
/// honest answers now live on the trait, where a backend states its own, and
/// `as_any`/`as_any_mut` are gone with the downcasts they existed for.
impl PluginInstanceData {
    /// Check if this plugin instance supports a custom GUI.
    pub fn has_gui(&self) -> bool {
        self.plugin.has_gui()
    }

    /// Get the display name of this plugin.
    pub fn get_name(&self) -> &str {
        self.plugin.get_name()
    }

    /// Open the plugin GUI, parenting it into the given native handle.
    pub fn open_gui(&mut self, handle_ptr: *mut c_void) -> Result<(u32, u32), String> {
        self.plugin.open_gui(handle_ptr)
    }

    /// Close the plugin GUI.
    pub fn close_gui(&mut self) {
        self.plugin.close_gui();
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

/// The command-side producer end of every crumbs sampler's record bridge.
///
/// One struct so the record feed takes exactly one lock per block: the bridge
/// handles and the de-interleave scratch they share come back together, the
/// same one-lock discipline `process_plugin_audio` keeps for the CLAP relay.
/// The lock is command-side only — the native audio callback pops the far end
/// of these rings through the scheduler and never touches this struct.
pub struct CrumbsRecordFeed {
    /// Bridge handles keyed by engine_plugin_id. Holds only crumbs bridges:
    /// CLAP handles live on their `EnginePluginInstanceData`.
    pub bridges: HashMap<usize, PluginAudioBridgeHandle>,
    /// De-interleave scratch refilled in place by every `feed_record_input`
    /// call, then copied into each bridge's preallocated block. Never grows
    /// past `MAX_BLOCK_FRAMES`: an oversized block is refused before the
    /// de-interleave, mirroring `process_plugin_audio`.
    pub scratch: PluginRelayScratch,
}

impl Default for CrumbsRecordFeed {
    fn default() -> Self {
        Self {
            bridges: HashMap::new(),
            scratch: PluginRelayScratch::default(),
        }
    }
}

pub struct EnginePluginInstanceData {
    pub engine_plugin_id: usize,
    pub runtime: Arc<SharedHostedPlugin>,
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
    /// Native audio engine handle (audio-owner thread + lock-free scheduler).
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
    /// The crumbs samplers' record feed: bridge handles keyed by
    /// engine_plugin_id, plus the shared de-interleave scratch the feed
    /// command refills per block. Only crumbs registration writes the map;
    /// `feed_record_input` reads it once per monitored-input block.
    /// A CLAP instance's handle is not here — it lives on its
    /// `EnginePluginInstanceData`, because the relay resolves it by instance id
    /// on the audio relay path.
    pub audio_bridges: Arc<Mutex<CrumbsRecordFeed>>,
    /// Retired engine-owned runtimes kept alive after scheduler removal is
    /// queued so the render callback never final-drops a hosted plugin. Declared
    /// after `engine` so app teardown drops the stream before these runtimes.
    ///
    /// Entries leave only through `sweep_retired_engine_plugins`, and only once
    /// the scheduler has released its own `Arc` — see that method for the
    /// invariant.
    pub retired_engine_plugins: Arc<Mutex<Vec<Arc<SharedHostedPlugin>>>>,
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
    /// The durable half of `plugin_registry`: the file a scan writes and the
    /// first plugin-touching command reads back, so a relaunched app resolves
    /// a saved project's plugins without a manual scan. Control-side only —
    /// every method on it touches the filesystem. See
    /// `host::plugin_registry_store`.
    pub plugin_registry_store: Arc<crate::host::plugin_registry_store::PluginRegistryStore>,
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
    /// `ScannedPlugin::id`: the hash of the path this plugin was scanned at.
    /// Carried on the entry, not just used as its key, because an entry is also
    /// reachable under the CLAP descriptor id and still has to be able to say
    /// which scanned file it came from.
    pub stable_id: String,
    /// The plugin's own move-survivable descriptor identity — CLAP's reverse-DNS
    /// id, VST3's class CID. Empty when the scan read no usable descriptor.
    pub descriptor_id: String,
    pub format: String,
    pub name: String,
    /// Total audio channels the plugin declared through `clap.audio-ports` when
    /// it was scanned, and whether it implements `clap.gui`.
    ///
    /// `capability_metadata_reason` is present exactly when these three are
    /// unqueried defaults rather than facts — a targeted activation rescan, for
    /// one, reads the descriptor only and never creates the instance these
    /// answers come from. Read the counts without reading the reason and a
    /// default becomes indistinguishable from a measurement.
    pub num_inputs: u32,
    pub num_outputs: u32,
    pub has_custom_ui: bool,
    pub capability_metadata_reason: Option<String>,
}

impl AppState {
    /// App state whose plugin registry is backed by the scan registry file in
    /// the platform's app-data directory. The production constructor.
    ///
    /// `Default` deliberately gives an in-memory store instead. A test that
    /// builds an `AppState` must not read — or rewrite — the developer's own
    /// scanned plugin database, and a default that reaches the real file would
    /// make every such test do exactly that.
    pub fn with_persisted_plugin_registry() -> Self {
        Self {
            plugin_registry_store: Arc::new(
                crate::host::plugin_registry_store::PluginRegistryStore::at_default_location(),
            ),
            ..Self::default()
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            engine: Arc::new(Mutex::new(None)),
            plugins: Arc::new(Mutex::new(HashMap::new())),
            engine_plugins: Arc::new(Mutex::new(HashMap::new())),
            plugin_registry: Arc::new(Mutex::new(HashMap::new())),
            plugin_windows: Arc::new(Mutex::new(HashMap::new())),
            audio_bridges: Arc::new(Mutex::new(CrumbsRecordFeed::default())),
            retired_engine_plugins: Arc::new(Mutex::new(Vec::new())),
            bridge_input_blocks_refused: Arc::new(AtomicU64::new(0)),
            timeline_samples: Arc::new(Mutex::new(HashMap::new())),
            graph: Arc::new(Mutex::new(crate::commands::graph::GraphRegistry::default())),
            graph_mapping_sessions: Arc::new(Mutex::new(
                crate::commands::graph::GraphMappingSessions::default(),
            )),
            plugin_registry_store: Arc::new(
                crate::host::plugin_registry_store::PluginRegistryStore::in_memory_only(),
            ),
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
/// The retirement vec exists so the render callback never final-drops a hosted
/// plugin: removal from the scheduler is *queued*, so at the moment a runtime is
/// retired the audio thread may still be holding — and processing — the
/// `HostedPluginSlot` that owns the second `Arc`. Freeing then is a use-after-free
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

    pub fn retain_retired_engine_plugin(&self, runtime: Arc<SharedHostedPlugin>) {
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

    /// A hosted plugin that is not a `ClapWrapper`.
    ///
    /// The four methods below used to be reachable only by downcasting the
    /// boxed plugin to that one concrete type, so a backend like this one got
    /// "Plugin", "no editor" and a refusal naming CLAP no matter what it
    /// implemented. Restore either downcast and every assertion in
    /// `a_non_clap_backend_is_reached_through_the_trait` fails.
    struct EditorBackedTestPlugin {
        editor_open: Arc<std::sync::atomic::AtomicBool>,
    }

    impl AudioPlugin for EditorBackedTestPlugin {
        fn process(&mut self, _: &[&[f32]], _: &mut [&mut [f32]], _: usize) {}

        fn set_parameter(&mut self, _: u32, _: f64) {}

        fn get_parameters(&self) -> Vec<PluginParameter> {
            Vec::new()
        }

        fn get_state(&self) -> Vec<u8> {
            Vec::new()
        }

        fn set_state(&mut self, _: &[u8]) -> Result<(), String> {
            Ok(())
        }

        fn get_name(&self) -> &str {
            "Test Backend Plugin"
        }

        fn has_gui(&self) -> bool {
            true
        }

        fn open_gui(&mut self, _: *mut c_void) -> Result<(u32, u32), String> {
            self.editor_open
                .store(true, std::sync::atomic::Ordering::SeqCst);
            Ok((640, 480))
        }

        fn close_gui(&mut self) {
            self.editor_open
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }

    /// A backend that overrides none of the four and takes the trait defaults.
    struct SilentTestPlugin;

    impl AudioPlugin for SilentTestPlugin {
        fn process(&mut self, _: &[&[f32]], _: &mut [&mut [f32]], _: usize) {}

        fn set_parameter(&mut self, _: u32, _: f64) {}

        fn get_parameters(&self) -> Vec<PluginParameter> {
            Vec::new()
        }

        fn get_state(&self) -> Vec<u8> {
            Vec::new()
        }

        fn set_state(&mut self, _: &[u8]) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn a_non_clap_backend_is_reached_through_the_trait() {
        let editor_open = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut instance = PluginInstanceData {
            plugin: Box::new(EditorBackedTestPlugin {
                editor_open: Arc::clone(&editor_open),
            }),
        };

        assert_eq!(instance.get_name(), "Test Backend Plugin");
        assert!(
            instance.has_gui(),
            "a backend that reports an editor must be believed"
        );
        assert_eq!(
            instance.open_gui(std::ptr::null_mut()),
            Ok((640, 480)),
            "the editor size must come from the plugin, not from a downcast that missed"
        );
        assert!(
            editor_open.load(std::sync::atomic::Ordering::SeqCst),
            "open_gui must mark the editor open"
        );

        instance.close_gui();
        assert!(
            !editor_open.load(std::sync::atomic::Ordering::SeqCst),
            "close_gui must mark the editor closed"
        );
    }

    /// The defaults are answers a backend can stand behind, and none of them
    /// names a format: "not a CLAP plugin" was a true statement about the wrong
    /// subject, and it will be wrong again for the next format.
    #[test]
    fn a_backend_with_no_editor_refuses_without_naming_a_format() {
        let mut instance = PluginInstanceData {
            plugin: Box::new(SilentTestPlugin),
        };

        assert_eq!(instance.get_name(), "Plugin");
        assert!(!instance.has_gui());

        let refusal = instance
            .open_gui(std::ptr::null_mut())
            .expect_err("a plugin with no editor cannot open one");
        assert_eq!(refusal, "Plugin does not support GUI");
        assert!(
            !refusal.contains("CLAP"),
            "the refusal must describe the plugin, not the format it is not: {refusal}"
        );

        // A plugin with no editor has nothing to close, and closing it is not an
        // error a caller has to guard against.
        instance.close_gui();
    }

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
            let runtime = Arc::new(SharedHostedPlugin::new(
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
