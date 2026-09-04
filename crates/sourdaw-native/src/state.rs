use crate::host::native_bridge::SharedHostedPlugin;
use crate::host::ui_thread::UiThread;
use daw_engine::audio_bridge::{PluginAudioBridgeHandle, MAX_BLOCK_FRAMES};
use daw_engine::EngineHandle;
use daw_plugin_host::scanner::ScannedPlugin;
// The trait, the resizer and the raw handle are how a plugin's editor is
// reached, and no production body here does that any more: the stores hold
// concrete runtimes, and every editor call lives in `commands::plugin_gui`.
// The fixtures below still implement the trait, so the imports stay for them.
#[cfg(test)]
use daw_plugin_host::AudioPlugin;
#[cfg(test)]
use daw_plugin_host::EditorWindowResizer;
use daw_plugin_host::HostedRuntime;
use daw_plugin_host::PluginParameter;
use daw_plugin_host::PluginParameterEventQueue;
use std::collections::HashMap;
#[cfg(test)]
use std::ffi::c_void;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, TryLockError};
use std::time::Duration;

/// An instance the command layer owns outright, because no engine was running
/// when it was loaded.
///
/// The runtime is held as the concrete `HostedRuntime` the loader built rather
/// than behind `dyn AudioPlugin`: the engine takes this very value when it
/// starts (`commands::plugins::attach_dormant_plugins`), and the shared runtime
/// owner it is handed to is generic over the backend, so a trait object could
/// never be attached at all. Every editor call still reaches the plugin through
/// `AudioPlugin`, whose `HostedRuntime` implementation delegates to the backend
/// this instance actually is.
///
/// `name`, `parameters` and `has_gui` mirror `EnginePluginInstanceData`: they
/// are what the load read off the plugin, and the attach registers the instance
/// under exactly those rather than asking a plugin that has since been edited.
pub struct PluginInstanceData {
    pub plugin: HostedRuntime,
    pub name: String,
    pub parameters: Vec<PluginParameter>,
    pub has_gui: bool,
}

impl PluginInstanceData {
    /// A dormant record around a runtime, read off the runtime itself.
    ///
    /// The load path spells the three fields out instead, from the values it
    /// already read while the plugin was in its hands — it is the load's own
    /// reading that the attach must register under. This is for the tests that
    /// park a fixture runtime and care about none of them.
    #[cfg(test)]
    pub fn dormant_fixture(plugin: HostedRuntime) -> Self {
        Self {
            name: plugin.get_name().to_string(),
            parameters: plugin.get_parameters(),
            has_gui: plugin.has_gui(),
            plugin,
        }
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
    /// The queue this plugin writes its own parameter edits into.
    ///
    /// Cloned off the runtime once at load and held here rather than reached
    /// through the control seam on every drain: that seam can wait on the audio
    /// thread, which bypasses a plugin whose lock is held, so draining through
    /// it would trade a knob's latency for a dropout. `None` for a backend that
    /// reports no plugin-side edits.
    pub parameter_events: Option<Arc<PluginParameterEventQueue>>,
}

/// The signal one editor teardown completes on.
///
/// A reopen that claims a stale editor's record tears the editor behind it
/// down on its own thread, and the OS-close report that lost the same claim
/// must not answer the shell until that teardown is done: the shell destroys
/// the window the moment the report returns, and both plugin formats un-parent
/// an editor from a live parent or from nothing at all. The loser waits on
/// this signal; the claiming reopen completes it once its teardown returns.
///
/// A condvar pair rather than an atomic flag because the loser has to park
/// rather than poll — the report already crossed a thread to get here, and
/// spinning it for a whole teardown would take that thread back from the
/// executor the teardown itself is running on.
#[derive(Default)]
pub struct EditorTeardownSignal {
    completed: Mutex<bool>,
    completed_notify: Condvar,
}

impl EditorTeardownSignal {
    /// Mark the teardown complete and wake every waiter. Idempotent.
    pub fn complete(&self) {
        *self
            .completed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
        self.completed_notify.notify_all();
    }

    /// Wait until [`Self::complete`] ran, or `bound` elapses.
    ///
    /// Answers whether the teardown completed. The bound exists because no
    /// teardown is worth parking a report behind forever: the claiming reopen
    /// is itself bounded by the editor-call deadlines, and the shell holds its
    /// own destroy deadline besides — see the caller for how this bound is
    /// sized against that one.
    pub fn wait_until_completed(&self, bound: Duration) -> bool {
        let deadline = std::time::Instant::now() + bound;
        let mut completed = self
            .completed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while !*completed {
            let now = std::time::Instant::now();
            if now >= deadline {
                return false;
            }
            let (guard, timed_out) = self
                .completed_notify
                .wait_timeout(completed, deadline - now)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            completed = guard;
            if timed_out.timed_out() {
                return *completed;
            }
        }
        true
    }
}

/// The host's plugin editor window bookkeeping.
///
/// Two maps behind the one mutex the whole editor lifecycle already shares:
/// the recorded window labels, and the teardown handshake for records a reopen
/// has claimed but not yet finished tearing down. Behind one mutex because
/// claiming a record and registering the handshake that claim owes are a
/// single step — a report that loses the claim must find the teardown it is
/// held to, with no gap between the record's removal and the registration
/// naming who is tearing the editor down.
///
/// The wait itself never happens under this mutex: the claimant registers,
/// tears the editor down with the lock released, and completes; the loser
/// takes the signal out, drops the guard, and parks on the signal alone.
#[derive(Default)]
pub struct PluginWindowRecords {
    /// Recorded editor windows, keyed by instance id → window label. A label
    /// names one opening — see
    /// [`plugin_editor_window_label`](crate::host::plugin_window::plugin_editor_window_label).
    labels: HashMap<String, String>,
    /// The teardown in flight for a claimed record, keyed by instance id.
    /// Present only between a reopen's claim of a stale record and the
    /// completion of the teardown that claim owns.
    teardowns: HashMap<String, Arc<EditorTeardownSignal>>,
}

impl PluginWindowRecords {
    /// The instance's recorded editor window label, if it has one.
    pub fn get(&self, instance_id: &str) -> Option<&String> {
        self.labels.get(instance_id)
    }

    /// Record the window label of one editor opening.
    pub fn insert(&mut self, instance_id: String, window_label: String) {
        self.labels.insert(instance_id, window_label);
    }

    /// Remove the instance's recorded window label and answer it.
    ///
    /// Handshake state is not touched: it belongs to the claim that put it
    /// there, and only that claim's completion takes it back out.
    pub fn remove(&mut self, instance_id: &str) -> Option<String> {
        self.labels.remove(instance_id)
    }

    /// Whether no editor window is recorded — the question the shutdown and
    /// unload passes ask as "is there any editor left?".
    pub fn is_empty(&self) -> bool {
        self.labels.is_empty()
    }

    /// Every instance with a recorded editor window.
    pub fn instance_ids(&self) -> impl Iterator<Item = &str> {
        self.labels.keys().map(String::as_str)
    }

    /// Every recorded window label.
    pub fn labels(&self) -> impl Iterator<Item = &str> {
        self.labels.values().map(String::as_str)
    }

    /// Take every recorded window label, leaving none behind.
    ///
    /// For the pass that destroys every editor window: the labels come out and
    /// the record empties in the one step, under the lock the caller holds.
    pub fn take_labels(&mut self) -> Vec<String> {
        std::mem::take(&mut self.labels).into_values().collect()
    }

    /// Register the teardown a claiming reopen is about to run.
    ///
    /// Replaces any teardown still registered for the instance: a claim that
    /// never completed has nothing left to wait for once a newer claim owns
    /// the editor, and that older claim's waiters are bounded anyway.
    pub fn register_teardown(&mut self, instance_id: &str, signal: Arc<EditorTeardownSignal>) {
        self.teardowns.insert(instance_id.to_string(), signal);
    }

    /// The teardown in flight for the instance, if a claim is mid-teardown.
    pub fn teardown_in_flight(&self, instance_id: &str) -> Option<Arc<EditorTeardownSignal>> {
        self.teardowns.get(instance_id).cloned()
    }

    /// Forget the registered teardown, but only if it is still this one.
    ///
    /// A newer claim may have replaced it, and taking that one out would leave
    /// the new claim's losing reports nothing to find.
    pub fn forget_teardown(&mut self, instance_id: &str, signal: &Arc<EditorTeardownSignal>) {
        let still_this_one = self
            .teardowns
            .get(instance_id)
            .is_some_and(|registered| Arc::ptr_eq(registered, signal));
        if still_this_one {
            self.teardowns.remove(instance_id);
        }
    }
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
    /// Open plugin GUI windows and the teardown handshake that holds a losing
    /// OS-close report behind the claiming reopen's teardown, keyed by
    /// instance id. One mutex, because claiming a record and registering the
    /// teardown that claim owes are a single step — see
    /// [`PluginWindowRecords`].
    pub plugin_windows: Arc<Mutex<PluginWindowRecords>>,
    /// Retired engine-owned runtimes kept alive after scheduler removal is
    /// queued so the render callback never final-drops a hosted plugin. Declared
    /// after `engine` so app teardown drops the stream before these runtimes.
    ///
    /// Entries leave only through `sweep_retired_engine_plugins`, and only once
    /// the scheduler has released its own `Arc` — see that method for the
    /// invariant.
    pub retired_engine_plugins: Arc<Mutex<Vec<Arc<SharedHostedPlugin>>>>,
    /// Input blocks `process_plugin_audio` could not hand to a bridge because
    /// its input ring was full. Each one is audio the hosted plugin never saw,
    /// so the refusal is counted and reported through `engine_rt_diagnostics`
    /// rather than discarded with the block.
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
///
/// The channels are shared, not owned: one registration allocates the PCM once
/// and every clip scheduled over it holds the same allocation. Material is
/// immutable once registered — re-registering an id replaces the whole sample —
/// so there is nothing for sharing to race against, and the clips a project
/// makes of one take (loop passes, comp regions, gap fills) cost a pointer each
/// instead of a copy each.
pub struct TimelineSample {
    pub left: Arc<[f32]>,
    pub right: Arc<[f32]>,
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

impl PluginRegistryEntry {
    /// The registry row a scanned plugin resolves to.
    ///
    /// The single mapping from a scan result to a registry row: the scan's own
    /// index, the persisted registry and the activation rescan all go through
    /// it, so none of them can come to disagree about what a scanned plugin
    /// means.
    ///
    /// `capability_metadata_reason` travels with the values it qualifies and is
    /// never dropped on the way through. A row that kept the counts and lost
    /// the reason would state as fact what the scan recorded as unknown.
    pub fn from_scanned(plugin: &ScannedPlugin) -> Self {
        Self {
            path: plugin.path.clone(),
            stable_id: plugin.id.clone(),
            descriptor_id: plugin.descriptor_id.clone(),
            format: plugin.format.clone(),
            name: plugin.name.clone(),
            num_inputs: plugin.num_inputs,
            num_outputs: plugin.num_outputs,
            has_custom_ui: plugin.has_custom_ui,
            capability_metadata_reason: plugin.capability_metadata_reason.clone(),
        }
    }
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
            plugin_windows: Arc::new(Mutex::new(PluginWindowRecords::default())),
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

/// Every live plugin instance taken out of the stores, for a caller that is
/// about to tear them down.
pub struct LivePluginInstances {
    /// Instances the command layer owns outright. Dropping one is its whole
    /// teardown, because nothing else holds it.
    pub command_owned: Vec<PluginInstanceData>,
    /// Engine-owned instances. Their runtimes are shared — the scheduler and
    /// the watcher threads hold clones — so dropping one runs the plugin's
    /// teardown only once every other clone is gone.
    pub engine_owned: Vec<EnginePluginInstanceData>,
    /// One message per store this pass could not take at all, so its instances
    /// are still in it. A store, not a name: a store that would not open cannot
    /// be read for the names it holds.
    pub left_in_a_busy_store: Vec<String>,
}

/// What the report says about command-owned instances the exit pass could not
/// reach. Their teardown did not run.
const COMMAND_OWNED_STORE_WAS_BUSY: &str =
    "Command-owned plugin instances were busy; they were not torn down";

/// Take a lock whose data stays usable after a panic elsewhere.
///
/// Every store here is a plain map or vec: a thread that panicked mid-write left
/// it consistent enough to keep serving, and refusing to read it would turn one
/// panic into a whole subsystem — teardown included — that can never run again.
pub(crate) fn locked_or_poisoned<Value>(lock: &Mutex<Value>) -> MutexGuard<'_, Value> {
    match lock.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Take a store's lock, refusing rather than parking when this is the shell's
/// UI thread.
///
/// `None` means the store was busy and the caller must do without it. Only the
/// UI thread refuses: a worker may hold one of these across an editor call it
/// needs the UI thread to run (`commands::plugin_gui`), so the UI thread waiting
/// here waits for itself. Every other caller is a worker, and a worker waiting
/// closes no cycle.
///
/// A poisoned store is still handed over, for the reason
/// [`locked_or_poisoned`] gives: teardown is exactly what must survive a panic
/// somewhere else.
fn claimed_unless_the_ui_thread_would_park<'store, Value, Ui: UiThread + ?Sized>(
    lock: &'store Mutex<Value>,
    ui: &Ui,
) -> Option<MutexGuard<'store, Value>> {
    if !ui.is_ui_thread() {
        return Some(locked_or_poisoned(lock));
    }

    match lock.try_lock() {
        Ok(guard) => Some(guard),
        Err(TryLockError::WouldBlock) => None,
        Err(TryLockError::Poisoned(poisoned)) => Some(poisoned.into_inner()),
    }
}

/// Empty a store into a vec of its values, every one handed back **undropped**.
///
/// Dropping a plugin instance runs the plugin's own teardown — third-party code
/// of unbounded duration — and running that inside the store's critical section
/// parks every other plugin command for its whole length. So the values leave
/// the guard alive and the caller drops them outside it, the discipline
/// [`sweep_retired_runtimes`] keeps for the retirement vec.
fn take_store_values<Value>(store: &mut HashMap<String, Value>) -> Vec<Value> {
    std::mem::take(store).into_values().collect()
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
/// Dropping a released runtime runs the plugin's own teardown — CLAP
/// `deactivate`/`destroy`, VST3 `setActive(false)`/`terminate` — which is
/// third-party code of unbounded duration. Doing that while the retirement mutex is held
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

    // Guard released. Plugin teardown runs here, on this non-RT thread, with the
    // retirement mutex free.
    drop(released_runtimes);
}

impl AppState {
    pub fn with_engine_plugin_control<ResultValue>(
        &self,
        instance_id: &str,
        operation: impl FnOnce(&mut HostedRuntime) -> Result<ResultValue, String>,
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

    /// The same operation, but refusing an instance whose control gate is busy
    /// rather than waiting for it.
    ///
    /// For callers that must not park: the gate's wait is unbounded, and a
    /// caller running on the shell's UI thread cannot afford one — the worker
    /// holding the gate may itself be waiting for that very thread, and the
    /// refusal is what breaks the cycle. See
    /// [`SharedHostedPlugin::try_with_control`](crate::host::native_bridge::SharedHostedPlugin::try_with_control).
    pub fn try_with_engine_plugin_control<ResultValue>(
        &self,
        instance_id: &str,
        operation: impl FnOnce(&mut HostedRuntime) -> Result<ResultValue, String>,
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

        runtime.try_with_control(Duration::from_secs(2), operation)
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

    /// Take every live plugin instance out of the stores, leaving both empty,
    /// and withdraw each engine-owned runtime's intent to process on the way
    /// out.
    ///
    /// `begin_unload` withdraws the intent to process before the caller queues
    /// the scheduler removal, the order `unload_plugin` keeps: the audio thread
    /// acts on that intent if it visits the instance first, and the wrapper's
    /// own `Drop` performs the stop off the audio thread if it does not. At exit
    /// the removal follows within microseconds, so the off-thread fallback is
    /// the expected path, not the exception — what this ordering buys is that
    /// the stop is never *missed*, whichever side gets there.
    ///
    /// The instances come back undropped. Dropping one runs the plugin's own
    /// teardown, third-party code of unbounded duration, and running that
    /// inside a store's critical section parks every other plugin command for
    /// its whole duration — the discipline `sweep_retired_runtimes` keeps for
    /// the retirement vec.
    ///
    /// `ui` is here because this pass runs on the shell's UI thread at exit, and
    /// the command-owned store is held across editor calls that need that very
    /// thread. Waiting for it there is a deadlock the shell only leaves through
    /// its force-exit, which kills every plugin mid-flight — so the store is
    /// claimed without parking, and a store that will not open is reported
    /// instead of waited for.
    ///
    /// The engine-owned store is taken outright: nothing holds it across an
    /// editor call, so no holder of it is waiting on the thread this pass runs
    /// on.
    pub fn take_live_plugin_instances<Ui: UiThread + ?Sized>(
        &self,
        ui: &Ui,
    ) -> LivePluginInstances {
        let engine_owned = {
            let mut engine_plugins = locked_or_poisoned(&self.engine_plugins);
            for instance in engine_plugins.values() {
                instance.runtime.begin_unload();
            }
            take_store_values(&mut engine_plugins)
        };

        let Some(mut plugins) = claimed_unless_the_ui_thread_would_park(&self.plugins, ui) else {
            return LivePluginInstances {
                command_owned: Vec::new(),
                engine_owned,
                left_in_a_busy_store: vec![COMMAND_OWNED_STORE_WAS_BUSY.to_string()],
            };
        };

        LivePluginInstances {
            command_owned: take_store_values(&mut plugins),
            engine_owned,
            left_in_a_busy_store: Vec::new(),
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
    use crate::host::plugin_window::NoWindowHost;

    /// A hosted plugin that is not a `ClapWrapper`.
    ///
    /// The editor path used to reach a plugin only by downcasting it to that
    /// one concrete type, so a backend like this one got "Plugin", "no editor"
    /// and a refusal naming CLAP no matter what it implemented. Restore either
    /// downcast and every assertion in
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

        fn get_state(&self) -> Result<Vec<u8>, String> {
            Ok(Vec::new())
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

    /// A backend that resizes its own editor, the way a real one does from
    /// inside the plugin's own call into the host.
    struct SelfResizingTestPlugin {
        /// Every editor call in order, so a resizer installed after the open is
        /// visible as one.
        calls: Arc<Mutex<Vec<&'static str>>>,
        resize: Option<EditorWindowResizer>,
    }

    impl AudioPlugin for SelfResizingTestPlugin {
        fn process(&mut self, _: &[&[f32]], _: &mut [&mut [f32]], _: usize) {}

        fn set_parameter(&mut self, _: u32, _: f64) {}

        fn get_parameters(&self) -> Vec<PluginParameter> {
            Vec::new()
        }

        fn get_state(&self) -> Result<Vec<u8>, String> {
            Ok(Vec::new())
        }

        fn set_state(&mut self, _: &[u8]) -> Result<(), String> {
            Ok(())
        }

        fn has_gui(&self) -> bool {
            true
        }

        fn set_editor_window_resizer(&mut self, resize: EditorWindowResizer) {
            self.calls.lock().expect("call log").push("resizer");
            self.resize = Some(resize);
        }

        fn open_gui(&mut self, _: *mut c_void) -> Result<(u32, u32), String> {
            self.calls.lock().expect("call log").push("open");
            // What a view does while it lays itself out against its new parent.
            let resize = self
                .resize
                .as_ref()
                .ok_or_else(|| "the host installed no resizer before the open".to_string())?;
            resize(1024, 768);
            Ok((1024, 768))
        }
    }

    /// The host window a self-resizing editor reaches.
    fn recording_resizer(
        calls: &Arc<Mutex<Vec<&'static str>>>,
    ) -> (EditorWindowResizer, Arc<Mutex<Vec<(u32, u32)>>>) {
        let sizes = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&sizes);
        let calls = Arc::clone(calls);
        let resize: EditorWindowResizer = Arc::new(move |width, height| {
            calls.lock().expect("call log").push("window");
            recorded.lock().expect("sizes").push((width, height));
        });
        (resize, sizes)
    }

    /// A plugin editor resizes itself, and it may do so during the attach — so
    /// the host's window has to be reachable before the editor is opened, not
    /// after it reports a size.
    #[test]
    fn the_window_resizer_reaches_the_plugin_before_its_editor_opens() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let (resize, sizes) = recording_resizer(&calls);
        let mut plugin = SelfResizingTestPlugin {
            calls: Arc::clone(&calls),
            resize: None,
        };

        plugin.set_editor_window_resizer(resize);
        let size = plugin
            .open_gui(std::ptr::null_mut())
            .expect("a plugin given a resizer before the open can use it during one");

        assert_eq!(size, (1024, 768));
        assert_eq!(
            *calls.lock().expect("call log"),
            ["resizer", "open", "window"],
            "the resizer must be installed before the open, and reach the host window from inside it"
        );
        assert_eq!(*sizes.lock().expect("sizes"), [(1024, 768)]);
    }

    /// A backend that overrides no editor method and takes the trait defaults.
    struct SilentTestPlugin;

    impl AudioPlugin for SilentTestPlugin {
        fn process(&mut self, _: &[&[f32]], _: &mut [&mut [f32]], _: usize) {}

        fn set_parameter(&mut self, _: u32, _: f64) {}

        fn get_parameters(&self) -> Vec<PluginParameter> {
            Vec::new()
        }

        fn get_state(&self) -> Result<Vec<u8>, String> {
            Ok(Vec::new())
        }

        fn set_state(&mut self, _: &[u8]) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn a_non_clap_backend_is_reached_through_the_trait() {
        let editor_open = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut plugin = EditorBackedTestPlugin {
            editor_open: Arc::clone(&editor_open),
        };

        assert_eq!(plugin.get_name(), "Test Backend Plugin");
        assert!(
            plugin.has_gui(),
            "a backend that reports an editor must be believed"
        );
        assert_eq!(
            plugin.open_gui(std::ptr::null_mut()),
            Ok((640, 480)),
            "the editor size must come from the plugin, not from a downcast that missed"
        );
        assert!(
            editor_open.load(std::sync::atomic::Ordering::SeqCst),
            "open_gui must mark the editor open"
        );

        plugin.close_gui();
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
        let mut plugin = SilentTestPlugin;

        assert_eq!(plugin.get_name(), "Plugin");
        assert!(!plugin.has_gui());

        let refusal = plugin
            .open_gui(std::ptr::null_mut())
            .expect_err("a plugin with no editor cannot open one");
        assert_eq!(refusal, "Plugin does not support GUI");
        assert!(
            !refusal.contains("CLAP"),
            "the refusal must describe the plugin, not the format it is not: {refusal}"
        );

        // A plugin with no editor has nothing to close, and closing it is not an
        // error a caller has to guard against.
        plugin.close_gui();
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

    /// A command-owned instance that answers, from inside its own teardown,
    /// whether the store it came out of was still locked.
    ///
    /// The same probe shape as `RetirementLockProbe`, for the same question:
    /// plugin teardown is third-party code of unbounded duration, and running
    /// it inside a store's critical section parks every concurrent plugin
    /// command for its whole length.
    type ProbeStore = Arc<Mutex<HashMap<String, StoreLockProbe>>>;

    struct StoreLockProbe {
        store: ProbeStore,
        dropped: Arc<std::sync::atomic::AtomicBool>,
        store_lock_was_free: Arc<std::sync::atomic::AtomicBool>,
    }

    impl Drop for StoreLockProbe {
        fn drop(&mut self) {
            self.store_lock_was_free.store(
                self.store.try_lock().is_ok(),
                std::sync::atomic::Ordering::Relaxed,
            );
            self.dropped
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    /// The seam both plugin stores are drained through
    /// ([`AppState::take_live_plugin_instances`]), probed with a value that
    /// answers from inside its own teardown — a real instance cannot, because
    /// the runtime it holds is the plugin's and has no hook to lend.
    #[test]
    fn taking_a_stores_values_hands_them_back_undropped() {
        let store: ProbeStore = Arc::new(Mutex::new(HashMap::new()));
        let dropped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let store_lock_was_free = Arc::new(std::sync::atomic::AtomicBool::new(false));
        store.lock().expect("probe store lock").insert(
            "command-instance".to_string(),
            StoreLockProbe {
                store: Arc::clone(&store),
                dropped: Arc::clone(&dropped),
                store_lock_was_free: Arc::clone(&store_lock_was_free),
            },
        );

        let taken = {
            let mut guard = store.lock().expect("probe store lock");
            let taken = take_store_values(&mut guard);
            assert!(
                !dropped.load(std::sync::atomic::Ordering::Relaxed),
                "a value dropped inside the drain runs its teardown under the store lock"
            );
            taken
        };

        assert!(store.lock().expect("probe store lock").is_empty());
        drop(taken);

        assert!(
            dropped.load(std::sync::atomic::Ordering::Relaxed),
            "the caller's drop must be what tears the value down"
        );
        assert!(
            store_lock_was_free.load(std::sync::atomic::Ordering::Relaxed),
            "plugin teardown must not run inside the store's critical section"
        );
    }

    #[test]
    fn taking_live_instances_withdraws_each_runtimes_intent_to_process() {
        let state = AppState::default();
        let runtime = Arc::new(SharedHostedPlugin::new(
            daw_plugin_host::ClapWrapper::new_engine_owned_command_fixture(
                "Live Fixture",
                Vec::new(),
                false,
            )
            .into(),
        ));
        let processing = runtime.processing_gate();
        state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .insert(
                "engine-instance".to_string(),
                EnginePluginInstanceData {
                    engine_plugin_id: 41,
                    runtime,
                    name: "Live Fixture".to_string(),
                    parameters: Vec::new(),
                    has_gui: false,
                    bridge: None,
                    relay_scratch: PluginRelayScratch::default(),
                    parameter_events: None,
                },
            );
        assert!(
            processing.wants_processing(),
            "the fixture must start wanted, or the withdrawal below proves nothing"
        );

        let instances = state.take_live_plugin_instances(&NoWindowHost);

        assert_eq!(instances.engine_owned.len(), 1);
        assert!(
            processing.has_pending_stop(),
            "a runtime must leave the store with its stop already requested: the audio thread's chance to perform it ends with the scheduler removal that follows"
        );
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
                )
                .into(),
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
