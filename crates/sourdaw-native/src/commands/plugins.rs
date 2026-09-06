//! Plugin scanning, loading, and parameter management.

use crate::commands::graph::{self, StripReportPayload};
use crate::host::native_bridge::{HostedPluginSlot, SharedHostedPlugin};
use crate::host::plugin_registry_store::{
    PersistedPluginEntry, PersistedQuarantineEntry, PluginRegistryStore, RescanClaim, ScanRow,
};
use crate::host::plugin_scan_policy::PluginScanPolicy;
use crate::host::plugin_scan_worker;
use crate::host::plugin_window::{NoWindowHost, PluginWindowHost};
use crate::host::ui_thread::lend_on_ui_thread;
use crate::state::{AppState, PluginInstanceData, PluginRegistryEntry};
use cpal::traits::{DeviceTrait, HostTrait};
use daw_engine::plugin_slot::MidiNoteEvent;
use daw_engine::scheduler::HOSTED_PLUGIN_RESERVE;
use daw_engine::timeline::DeviceKind;
use daw_plugin_host::scanner::{
    self, PluginFormat, QuarantinedPlugin, ScanResult, ScannedDescriptor, ScannedInstance,
    ScannedPlugin,
};
use daw_plugin_host::{AudioPlugin, ClapWrapper, HostedPluginRuntime, HostedRuntime, Vst3Wrapper};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

// Re-export PluginParameter from daw-plugin-host for TypeScript binding generation
pub use daw_plugin_host::PluginParameter;

// ── Types ───────────────────────────────────────────────────────────────
use daw_core::{PluginId, PluginInstanceId};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInstance {
    pub instance_id: PluginInstanceId,
    pub plugin_id: PluginId,
    pub name: String,
    pub parameters: Vec<PluginParameter>,
    pub is_active: bool,
    /// Raw CLAP latency, in frames of the engine rate the caller supplied to
    /// activate this instance. Informational only: `latency_ms` is the same
    /// figure already converted against that rate, and duplicating the
    /// conversion is how the two drift apart.
    pub latency_samples: u32,
    /// Latency in milliseconds, converted host-side at the activation sample rate.
    /// This is the value the frontend feeds into latency compensation.
    pub latency_ms: f64,
    /// How long the plugin keeps sounding after its input stops — a reverb's
    /// decay, a delay's repeats — in frames of that same activation rate.
    ///
    /// Frames rather than milliseconds, unlike the latency beside it: both
    /// formats reserve the top of the range for a tail that never ends, and a
    /// converted sentinel is an ordinary duration nothing downstream can tell
    /// apart from a real one.
    ///
    /// Read at load like the latency, and revised the same way when the plugin
    /// announces a new one — over `plugin-tail-changed` rather than in this
    /// value, which is the reading at load and nothing later.
    pub tail_samples: u32,
    pub engine_plugin_id: Option<usize>,
}

/// A native `unload_plugin`'s reply.
///
/// `reports` is the final chain of every strip an unloaded instance's release
/// touched, exactly as `apply_graph_commands`'s own `reports` describe a
/// batch — because an unload changes native strip state with no batch of its
/// own, and a caller whose mirror of that state only ever updates from a
/// batch's reports would otherwise go stale the moment an unload releases a
/// chain entry, landing its next insert at the wrong native index.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUnloadReply {
    pub unloaded_instance_ids: Vec<String>,
    pub errors: Vec<String>,
    pub reports: Vec<StripReportPayload>,
}
static PLUGIN_LIFECYCLE_GATES: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PLUGIN_RUNTIME_GATE: tokio::sync::RwLock<()> = tokio::sync::RwLock::const_new(());

/// A `PLUGIN_RUNTIME_GATE` guard that records its own release.
///
/// Every sweep of the retirement vec is contracted to run with the gate free,
/// and the moment the gate becomes free is a guard's drop. Binding the record
/// to that drop is what makes the contract observable: a guard widened back to
/// function scope, or handed out of the frame that took it, then reports the
/// release it actually performs rather than the one a statement standing beside
/// the sweep claims for it.
///
/// Production holds the bare guard — outside `cfg(test)` this name is the
/// guard's own type and [`observe_gate_release`] is the identity.
#[cfg(test)]
struct ObservedGateGuard<G>(Option<G>);

#[cfg(test)]
impl<G> Drop for ObservedGateGuard<G> {
    /// The gate is let go before the release is recorded, so the record never
    /// runs ahead of the thing it reports.
    fn drop(&mut self) {
        self.0.take();
        note_teardown_event(TeardownEvent::RuntimeGateReleased);
    }
}

#[cfg(not(test))]
type ObservedGateGuard<G> = G;

#[cfg(test)]
fn observe_gate_release<G>(guard: G) -> ObservedGateGuard<G> {
    ObservedGateGuard(Some(guard))
}

#[cfg(not(test))]
fn observe_gate_release<G>(guard: G) -> ObservedGateGuard<G> {
    guard
}

struct PluginLifecycleLease {
    instance_id: String,
    gate: Arc<tokio::sync::Mutex<()>>,
    _guard: tokio::sync::OwnedMutexGuard<()>,
}
impl Drop for PluginLifecycleLease {
    fn drop(&mut self) {
        let mut gates = PLUGIN_LIFECYCLE_GATES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let is_current_gate = gates
            .get(&self.instance_id)
            .is_some_and(|current| Arc::ptr_eq(current, &self.gate));
        if is_current_gate && Arc::strong_count(&self.gate) == 3 {
            gates.remove(&self.instance_id);
        }
    }
}
fn plugin_lifecycle_gate(instance_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut gates = PLUGIN_LIFECYCLE_GATES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Arc::clone(
        gates
            .entry(instance_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
    )
}
async fn lock_plugin_lifecycle(instance_id: &str) -> PluginLifecycleLease {
    let gate = plugin_lifecycle_gate(instance_id);
    let guard = Arc::clone(&gate).lock_owned().await;
    PluginLifecycleLease {
        instance_id: instance_id.to_string(),
        gate,
        _guard: guard,
    }
}
/// The same lease, refused rather than waited for.
///
/// For [`attach_dormant_plugins`], which runs inside a graph batch holding the
/// registry guard and so cannot await anything. A lease it cannot take means a
/// load or unload owns this instance right now: the attach leaves it dormant
/// and the next batch tries again, which is the same answer an engine refusal
/// gets.
fn try_lock_plugin_lifecycle(instance_id: &str) -> Option<PluginLifecycleLease> {
    let gate = plugin_lifecycle_gate(instance_id);
    let guard = Arc::clone(&gate).try_lock_owned().ok()?;
    Some(PluginLifecycleLease {
        instance_id: instance_id.to_string(),
        gate,
        _guard: guard,
    })
}
fn remove_engine_plugin_record_after_scheduler_removal<EnginePluginRecord>(
    engine_plugins: &mut HashMap<String, EnginePluginRecord>,
    instance_id: &str,
    scheduler_removal_result: Result<(), String>,
) -> Result<Option<EnginePluginRecord>, String> {
    scheduler_removal_result?;
    Ok(engine_plugins.remove(instance_id))
}

// ── Scanning commands ───────────────────────────────────────────────────

/// The most plugin files a single scan will index.
///
/// `pub(crate)` because the persisted registry derives its own row cap from it
/// (`host::plugin_registry_store`): a document carrying more rows than a scan
/// can produce was not written by one. The two bounds have to move together, or
/// the cap quietly stops meaning what it says.
pub(crate) const MAX_SCAN_CANDIDATES: usize = 256;

/// The whole enumeration's clock.
///
/// Sized against the shell supervisor that owns the scan invocation
/// (`electron/scan.ts`, 120 s): this has to fit inside that bound with room for
/// the response to be built and returned, or the supervisor kills a walk that
/// was about to answer and the user sees a failure instead of a partial list.
///
/// It only has to cover the candidates a run actually inspects. An unchanged
/// file's rows are reused without spawning a helper, so a settled plugin folder
/// costs the walk almost nothing however large it is, and this budget is spent
/// on what is new or changed.
const MAX_SCAN_DURATION: Duration = Duration::from_secs(90);
static PLUGIN_SCAN_PERMIT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

/// The two clocks a scan runs under.
///
/// `walk` bounds the whole enumeration; `candidate` is what a single
/// candidate's helper is handed, and it is never divided — see
/// [`covers_a_whole_candidate`]. Passed in rather than read from the constants
/// so a test can prove both rules in milliseconds.
#[derive(Debug, Clone, Copy)]
struct ScanBudget {
    walk: Duration,
    candidate: Duration,
}

/// The budget every production scan runs under.
const PRODUCTION_SCAN_BUDGET: ScanBudget = ScanBudget {
    walk: MAX_SCAN_DURATION,
    candidate: plugin_scan_worker::WORKER_TIMEOUT,
};

/// Whether `deadline` still leaves room to hand a candidate its whole budget.
///
/// A helper started with the walk's leftover is killed for the walk's clock
/// rather than its own, and it reports that as a helper timeout — which
/// [`quarantine_if_process_failure`] cannot tell from a plugin that genuinely
/// hangs, so the walk would permanently blame a plugin for a budget it was
/// never given. A candidate is therefore started whole or not started.
fn covers_a_whole_candidate(deadline: Instant, budget: ScanBudget) -> bool {
    deadline.saturating_duration_since(Instant::now()) >= budget.candidate
}

/// Drop every candidate whose path an earlier one already claimed.
///
/// Order preserving, which a `sort` + `dedup` is not: two authorized roots can
/// nest, or resolve to the same folder, and the survivor has to be the copy the
/// higher-priority root offered.
fn retain_first_candidate_per_path(candidates: &mut Vec<scanner::ScanCandidate>) {
    let mut claimed_paths = HashSet::new();
    candidates.retain(|candidate| claimed_paths.insert(candidate.path.clone()));
}

/// Drop every plugin whose format-scoped identity an earlier one already
/// claimed.
///
/// One plugin installed in two roots is one plugin. The scan meets the roots in
/// priority order, so the first copy of an identity is the one the user
/// installed most deliberately, and the shadowed copies never reach the registry
/// or the browser. This is the VST3 specification's own rule for its folders —
/// first found for a class id wins — read against the identity field every
/// format now fills.
///
/// A plugin with no identity is never deduplicated: an absent id is not evidence
/// that two files are the same plugin.
fn retain_first_plugin_per_identity(plugins: &mut Vec<ScannedPlugin>) {
    let mut claimed_identities = HashSet::new();
    plugins.retain(|plugin| {
        plugin.descriptor_id.is_empty()
            || claimed_identities.insert((plugin.format.clone(), plugin.descriptor_id.clone()))
    });
}

/// Pair every scanned plugin with the registry keys it answers to.
///
/// Two keys per scanned plugin, on purpose. The primary key is `ScannedPlugin::id`,
/// a hash of the file path — which is exactly why it is fragile: move the plugin
/// or install a version under a new path and a saved project's recorded id
/// resolves nothing. The secondary key is the plugin's own descriptor id — the
/// CLAP descriptor id, or the VST3 class id — which carries no path and
/// therefore survives the move.
///
/// Additive by construction: every primary key is claimed first and a
/// descriptor id may only fill a vacancy, never displace one. Nothing that
/// resolves today stops resolving, and there is no migration to run. Making the
/// descriptor id primary would be the stronger fix, but it would change every
/// saved project's recorded id at once — deliberately not done here, and it
/// stays available once there is a migration story.
///
/// An empty descriptor id is never a key: a format with no identity of its own
/// would otherwise have every plugin collide on `""`.
///
/// The most registry keys [`key_scanned_plugins`] writes for one scanned
/// plugin: its path hash, and its own descriptor id.
///
/// `pub(crate)` because the persisted registry multiplies its row cap by it
/// (`host::plugin_registry_store`). The producer owns the number, so a key this
/// function starts writing raises that cap in the same edit rather than
/// silently overflowing a bound restated elsewhere — which would refuse, at
/// every launch, a document this build's own scan wrote.
pub(crate) const SCANNED_PLUGIN_KEY_CAPACITY: usize = 2;

/// The one keying rule, so the in-memory lookup table and the persisted
/// registry cannot come to disagree about which keys resolve a plugin.
fn key_scanned_plugins(plugins: &[ScannedPlugin]) -> Vec<ScanRow> {
    let claimed_primary_keys: HashSet<&str> =
        plugins.iter().map(|plugin| plugin.id.as_str()).collect();
    let mut claimed_descriptor_keys = HashSet::new();

    plugins
        .iter()
        .map(|plugin| {
            let mut keys = Vec::with_capacity(SCANNED_PLUGIN_KEY_CAPACITY);
            keys.push(plugin.id.clone());
            let takes_descriptor_key = !plugin.descriptor_id.is_empty()
                && !claimed_primary_keys.contains(plugin.descriptor_id.as_str())
                && claimed_descriptor_keys.insert(plugin.descriptor_id.clone());
            if takes_descriptor_key {
                keys.push(plugin.descriptor_id.clone());
            }
            debug_assert!(
                keys.len() <= SCANNED_PLUGIN_KEY_CAPACITY,
                "the registry row cap multiplies by SCANNED_PLUGIN_KEY_CAPACITY, so a plugin \
                 keyed more times than that writes rows the reader will refuse"
            );
            ScanRow {
                keys,
                plugin: plugin.clone(),
            }
        })
        .collect()
}

/// Build the lookup table `load_plugin` resolves against, under
/// [`key_scanned_plugins`]'s keys.
fn index_scanned_plugins(plugins: &[ScannedPlugin]) -> HashMap<String, PluginRegistryEntry> {
    key_scanned_plugins(plugins)
        .into_iter()
        .flat_map(|row| {
            let entry = PluginRegistryEntry::from_scanned(&row.plugin);
            row.keys.into_iter().map(move |key| (key, entry.clone()))
        })
        .collect()
}

/// Replace the scanned roots' share of the registry with this scan's results.
///
/// Recovers a poisoned lock instead of skipping the write. Skipping it let the
/// scan report success with a full plugin list while the registry stayed as it
/// was, so every later `load_plugin` refused with "not found in registry. Run a
/// scan first" — for a scan the user had just run, with no way to tell the two
/// apart. The registry is a lookup table derived entirely from this scan's own
/// results, so no panic elsewhere can leave it in a state this rebuild does not
/// correct.
///
/// The same retention runs against the registry store's persisted view.
/// `persist` unions the live registry over that view rather than replacing it,
/// so a plugin this scan found gone would otherwise be written back out of the
/// view's own copy and survive its own uninstall forever.
fn publish_scan_results_in_registry(
    plugin_registry: &Mutex<HashMap<String, PluginRegistryEntry>>,
    registry_store: &PluginRegistryStore,
    authorized_paths: &[PathBuf],
    scanned_paths: &[PathBuf],
    scan_complete: bool,
    plugins: &[ScannedPlugin],
) {
    let survives_this_scan = |path: &Path| {
        if scan_complete {
            return !authorized_paths.iter().any(|root| path.starts_with(root));
        }
        !scanned_paths.iter().any(|scanned| scanned == path)
    };

    registry_store.apply_completed_scan_removals(survives_this_scan);

    let mut registry = plugin_registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    registry.retain(|_, entry| survives_this_scan(Path::new(&entry.path)));
    registry.extend(index_scanned_plugins(plugins));
}

/// Read the registry file into the in-memory registry, once per process.
///
/// On the blocking pool: hydration stats every persisted plugin file and
/// canonicalizes its path, and the async runtime's worker threads are not the
/// place to do that.
async fn hydrate_plugin_registry(state: &AppState) {
    let plugin_registry = Arc::clone(&state.plugin_registry);
    let registry_store = Arc::clone(&state.plugin_registry_store);
    if let Err(error) = tokio::task::spawn_blocking(move || {
        registry_store.hydrate_into(&plugin_registry, &PluginScanPolicy::platform_defaults());
    })
    .await
    {
        eprintln!("[Plugin] Could not load the plugin scan registry: {error}");
    }
}

/// Write a completed scan's rows back to the registry file.
///
/// The scan's own results, not a snapshot of the in-memory registry: the row a
/// later scan reuses has to be the whole of what this scan learned, and the
/// registry holds only the columns activation reads. Rows this scan did not
/// produce — another root's, hydrated earlier — are already in the store's
/// persisted view and survive the union `persist` performs.
async fn persist_scanned_plugins(state: &AppState, plugins: &[ScannedPlugin]) {
    let rows = key_scanned_plugins(plugins);
    let registry_store = Arc::clone(&state.plugin_registry_store);
    if let Err(error) = tokio::task::spawn_blocking(move || registry_store.persist(&rows)).await {
        eprintln!("[Plugin] Could not save the plugin scan registry: {error}");
    }
}

/// Milliseconds since the unix epoch, for a quarantine record's timestamp.
fn quarantine_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Quarantine `path` if `error` is a scan helper process failure — a crash or
/// a timeout, never a data-level refusal. Shared by the descriptor and
/// instance passes: a hung or crashed instance helper poisons a scan exactly
/// like a hung or crashed descriptor helper does, and both need the same
/// escape hatch or a single bad candidate can exhaust the whole scan's
/// deadline on every run.
fn quarantine_if_process_failure(registry_store: &PluginRegistryStore, path: &Path, error: &str) {
    if plugin_scan_worker::is_process_failure(error) {
        registry_store.quarantine_failure(path, error.to_string(), quarantine_timestamp_ms());
    }
}

/// Apply one instance-pass outcome to its descriptor row.
///
/// Success fills in parameters and capabilities. Failure always leaves the
/// `parameter_metadata_reason` fallback — the candidate's descriptor has
/// already been published into `plugins` for this scan regardless of how the
/// instance pass went, so that row still needs a reason for its missing
/// capability fields — and additionally quarantines `path` when the failure
/// is a process failure (a crash or a timeout), the same escape hatch the
/// descriptor pass already has: an instance helper that hangs or crashes is
/// exactly as capable of poisoning every future scan of this candidate as a
/// descriptor helper that does.
fn apply_instance_scan_result(
    descriptor: &mut ScannedDescriptor,
    instance: Result<ScannedInstance, String>,
    registry_store: &PluginRegistryStore,
    path: &Path,
) {
    match instance {
        Ok(instance) => {
            descriptor.parameters = Some(instance.parameters);
            descriptor.capabilities = Some(instance.capabilities);
        }
        Err(error) => {
            quarantine_if_process_failure(registry_store, path, &error);
            descriptor.parameter_metadata_reason =
                Some(scanner::PARAMETER_METADATA_UNAVAILABLE_REASON.to_string());
        }
    }
}

/// `retry_quarantined` is the AC-002 escape hatch: `false` is every ordinary
/// scan, which skips a quarantined candidate without spawning its helper and
/// never clears the record. `true` — a user-initiated full rescan — clears
/// every quarantine record it encounters before that candidate's helper runs,
/// so a fresh crash re-quarantines from a clean slate and a clean run leaves
/// nothing behind.
///
/// A scan that runs out of its budget still answers `Ok`: it returns the
/// plugins it did reach and names the limit on the `errors` channel beside
/// them, rather than withholding the list behind a failure. Every candidate
/// the walk starts is handed the whole per-candidate budget or is not started
/// at all, so a helper timeout is always that candidate's own and never the
/// walk's clock running out on it.
pub async fn scan_plugins(
    paths: Vec<String>,
    retry_quarantined: bool,
    state: &AppState,
) -> Result<ScanResult, String> {
    scan_plugins_with_policy(
        paths,
        retry_quarantined,
        PluginScanPolicy::platform_defaults(),
        state,
    )
    .await
}

/// `scan_policy` is a parameter so a test can scan a fixture directory without
/// touching the platform's real plugin folders. Production reaches this only
/// through [`scan_plugins`], which always supplies
/// [`PluginScanPolicy::platform_defaults`].
async fn scan_plugins_with_policy(
    paths: Vec<String>,
    retry_quarantined: bool,
    scan_policy: PluginScanPolicy,
    state: &AppState,
) -> Result<ScanResult, String> {
    scan_plugins_with_backend(
        paths,
        retry_quarantined,
        scan_policy,
        PRODUCTION_SCAN_BUDGET,
        state,
        plugin_scan_worker::scan_descriptor_metadata,
        plugin_scan_worker::scan_instance_metadata,
    )
    .await
}

/// `budget` and `scan_descriptor`/`scan_instance` are parameters so a test can
/// reach the deadline in milliseconds and inject a scan outcome — success, a
/// crash, a timeout — without spawning a real worker process, the same way
/// [`resolve_registry_entry`]'s rescan closure lets a targeted-rescan test
/// inject one without a real subprocess. Production reaches this only through
/// [`scan_plugins_with_policy`], which always supplies
/// [`PRODUCTION_SCAN_BUDGET`], [`plugin_scan_worker::scan_descriptor_metadata`]
/// and [`plugin_scan_worker::scan_instance_metadata`].
///
/// Two rules the budget carries. `budget.walk` bounds the enumeration and
/// nothing else: a walk cut short reports the limit through `errors` and still
/// returns everything it found, published into the registry, as a complete
/// scan does. `budget.candidate` is indivisible: a candidate reached with less
/// than that left is skipped rather than handed a truncated bound, because a
/// helper killed early is quarantined for a timeout the walk caused.
async fn scan_plugins_with_backend(
    paths: Vec<String>,
    retry_quarantined: bool,
    scan_policy: PluginScanPolicy,
    budget: ScanBudget,
    state: &AppState,
    scan_descriptor: impl Fn(PluginFormat, &Path, Duration) -> Result<Vec<ScannedDescriptor>, String>
        + Send
        + 'static,
    scan_instance: impl Fn(PluginFormat, &Path, &str, Duration) -> Result<ScannedInstance, String>
        + Send
        + 'static,
) -> Result<ScanResult, String> {
    let permit = PLUGIN_SCAN_PERMIT
        .try_acquire()
        .map_err(|_| "Plugin scan already in progress".to_string())?;
    // Before the scan, not after: the publisher below replaces the scanned
    // roots' share of the registry and leaves the rest standing, so a registry
    // that has not yet been hydrated would have the persisted entries for every
    // *other* root written out of the file by the save that follows.
    hydrate_plugin_registry(state).await;
    let start = std::time::Instant::now();
    let requested_paths: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let registry_store = Arc::clone(&state.plugin_registry_store);

    let deadline = start + budget.walk;
    let (plugins, errors, notices, scanned_paths, scan_complete, authorized_paths) =
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            // Authorization is filesystem work — an existence check, a symlink
            // check per path component, and `canonicalize` — on paths a caller
            // supplied, so it belongs on the blocking pool beside the walk it
            // gates rather than on the async runtime's thread.
            let (scan_roots, mut scan_errors) = authorize_scan_roots(&scan_policy, requested_paths);
            let authorized_paths = scan_roots.clone();
            let mut candidates = Vec::new();
            let mut notices = Vec::new();
            let mut scan_complete = true;
            for path in scan_roots {
                let root_begins_at = candidates.len();
                let root_completed = scanner::scan_directory_bounded(
                    &path,
                    &mut candidates,
                    &mut scan_errors,
                    &mut notices,
                    (MAX_SCAN_CANDIDATES, deadline),
                );
                // Sorted within the root and never across roots. Directory order
                // is whatever the filesystem hands back, so a root has to be
                // sorted to scan the same way twice; the roots themselves are
                // ranked by priority, and a global sort would throw that ranking
                // away and let an alphabetically earlier folder shadow the
                // per-user one.
                candidates[root_begins_at..].sort();
                if !root_completed {
                    let message = if candidates.len() >= MAX_SCAN_CANDIDATES {
                        "Plugin scan candidate limit exceeded"
                    } else {
                        "Plugin scan time limit exceeded"
                    };
                    scan_errors.push(message.to_string());
                    scan_complete = false;
                    break;
                }
            }
            retain_first_candidate_per_path(&mut candidates);
            // Every path this walk actually found, regardless of whether its
            // helper ran — the removal predicate below needs the full set to
            // tell "gone from disk" from "skipped because quarantined".
            let still_present_candidate_paths: HashSet<PathBuf> = candidates
                .iter()
                .map(|candidate| candidate.path.clone())
                .collect();
            let mut plugins = Vec::new();
            let mut scanned_paths = Vec::new();
            for candidate in candidates {
                if !covers_a_whole_candidate(deadline, budget) {
                    scan_errors.push("Plugin scan time limit exceeded".to_string());
                    scan_complete = false;
                    break;
                }
                scanned_paths.push(candidate.path.clone());

                let mut retried_from_quarantine = false;
                if retry_quarantined {
                    retried_from_quarantine =
                        registry_store.is_quarantined(&candidate.path).is_some();
                    registry_store.clear_quarantine(&candidate.path);
                } else if registry_store.is_quarantined(&candidate.path).is_some() {
                    // Skipped, not retried: a binary whose helper already
                    // crashed or timed out stays quarantined through every
                    // ordinary scan (AC-002). It is still named in the scan
                    // response below, via `quarantined_snapshot`.
                    continue;
                }

                // A DAW rescans what is new or changed and takes the rest from
                // its database — a settled plugin folder is not re-inspected
                // every time the user asks for a scan. The rows the last scan
                // wrote for an unchanged file are that scan's whole answer, so
                // republishing them costs no helper process and no budget.
                //
                // A candidate the user is explicitly retrying is never reused:
                // asking for the retry is asking for the helper to run.
                if !retried_from_quarantine {
                    if let Some(rows) = registry_store.reusable_rows(&candidate.path, &scan_policy)
                    {
                        plugins.extend(rows);
                        continue;
                    }
                }

                match scan_descriptor(candidate.format, &candidate.path, budget.candidate) {
                    // One bundle may declare several plugins — CLAP's factory is
                    // count/index shaped — and each gets its own inspection and
                    // its own row. A file that declares one keeps producing
                    // exactly the row it always did.
                    Ok(mut bundle) => {
                        for descriptor in &mut bundle {
                            // One inspection worker answers parameters and
                            // capabilities together, so they succeed and fail
                            // together. When it does not run, both stay `None`
                            // and `scanned_plugin` records why — a capability
                            // field this scan never asked for must never be
                            // published as a measured zero.
                            let instance = if covers_a_whole_candidate(deadline, budget) {
                                scan_instance(
                                    candidate.format,
                                    &candidate.path,
                                    &descriptor.descriptor_id,
                                    budget.candidate,
                                )
                            } else {
                                // Not a truncated attempt: "deadline" is a
                                // data-level refusal, so the row keeps its
                                // reason and the binary is not blamed.
                                Err("deadline".to_string())
                            };
                            apply_instance_scan_result(
                                descriptor,
                                instance,
                                &registry_store,
                                &candidate.path,
                            );
                        }
                        plugins.extend(scanner::scanned_bundle_plugins(&candidate.path, bundle));
                    }
                    Err(error) => {
                        quarantine_if_process_failure(&registry_store, &candidate.path, &error);
                        scan_errors.push(format!("{}: {error}", candidate.path.display()))
                    }
                }
            }
            retain_first_plugin_per_identity(&mut plugins);
            // Deliberately not `publish_scan_results_in_registry`'s predicate:
            // that one drops every registry entry under a scanned root and
            // rebuilds from what this scan found, which for a *skipped*
            // quarantined candidate would clear its record on this very scan.
            // A quarantine record is only dropped once this walk proves the
            // file genuinely gone — its root fully scanned, and not among the
            // candidates found there.
            registry_store.apply_quarantine_removals(|path| {
                !(scan_complete
                    && authorized_paths.iter().any(|root| path.starts_with(root))
                    && !still_present_candidate_paths.contains(path))
            });
            (
                plugins,
                scan_errors,
                notices,
                scanned_paths,
                scan_complete,
                authorized_paths,
            )
        })
        .await
        .map_err(|error| format!("Plugin scan task failed: {error}"))?;

    // Populate the plugin registry so load_plugin can find them. The scanner
    // already read every CLAP descriptor; this used to re-`dlopen` each one to
    // recover the id it had thrown away.
    publish_scan_results_in_registry(
        &state.plugin_registry,
        &state.plugin_registry_store,
        &authorized_paths,
        &scanned_paths,
        scan_complete,
        &plugins,
    );
    persist_scanned_plugins(state, &plugins).await;

    let quarantined: Vec<QuarantinedPlugin> = state
        .plugin_registry_store
        .quarantined_snapshot()
        .into_iter()
        .map(|entry: PersistedQuarantineEntry| QuarantinedPlugin {
            path: entry.path,
            reason: entry.reason,
            quarantined_at_ms: entry.quarantined_at_ms,
        })
        .collect();

    Ok(ScanResult {
        plugins,
        errors,
        notices,
        scan_duration_ms: start.elapsed().as_millis() as u64,
        quarantined,
        complete: scan_complete,
        // The same paths the registry retention above ran against, so a caller
        // merging this result into an older list applies the rule the registry
        // already applied to its own rows.
        scanned_paths: scanned_paths
            .iter()
            .map(|path| path.display().to_string())
            .collect(),
    })
}

pub async fn get_default_plugin_paths() -> Result<Vec<String>, String> {
    Ok(PluginScanPolicy::platform_defaults().allowed_roots_as_strings())
}

/// The scan roots this policy allows, in the platform's own priority order,
/// paired with the reasons the rest were refused.
///
/// The path kept is the canonical one the policy authorized, not the caller's
/// spelling of it: the checks are made against the canonical path, so walking
/// anything else walks a directory the policy never looked at.
///
/// The ranking is the point of the sort. Which copy of a plugin installed in two
/// folders wins is decided by the order the roots are walked in, and that
/// decision belongs to the platform's priority order — per-user, then
/// machine-wide, then network — not to the order a caller happened to list them.
/// The sort is stable, so roots the platform does not list keep the caller's
/// order among themselves and come last.
///
/// A platform default root that is not a directory is skipped in silence,
/// because every scan requests all of them and a machine that has never
/// installed a format has none of that format's folders. Reporting those would
/// make the ordinary state of a machine look like a failed scan. A root under
/// one — a folder the user added — is still refused by name: the user typed it,
/// so its absence is theirs to see and fix.
///
/// Two requested roots that authorize to the same canonical folder — a Linux
/// distribution's `/usr/lib64 -> /usr/lib` symlink hands out exactly this —
/// keep only the first: pushing both would walk that folder's bundles twice
/// before `retain_first_candidate_per_path` runs, and a large-enough folder
/// walked twice exhausts `MAX_SCAN_CANDIDATES` on its own duplicate and drops
/// every root behind it.
fn authorize_scan_roots(
    policy: &PluginScanPolicy,
    requested: Vec<PathBuf>,
) -> (Vec<PathBuf>, Vec<String>) {
    let mut authorized = Vec::new();
    let mut already_authorized = HashSet::new();
    let mut errors = Vec::new();

    for path in requested {
        let canonical = match policy.authorize_scan_root(&path) {
            Ok(canonical) => canonical,
            Err(error) => {
                errors.push(error);
                continue;
            }
        };
        if !canonical.is_dir() {
            if !policy.is_platform_default_root(&canonical) {
                errors.push(format!("Not a directory: {}", path.display()));
            }
            continue;
        }
        if !already_authorized.insert(canonical.clone()) {
            continue;
        }
        authorized.push(canonical);
    }

    authorized.sort_by_key(|path| policy.root_rank(path).unwrap_or(usize::MAX));
    (authorized, errors)
}

/// Whether the production scan policy would authorize `path` as a scan root.
///
/// The settings UI's add-a-folder action runs on this verdict, so it can only
/// offer what a scan can honor — the same authority `scan_plugins` enforces,
/// asked before the path is saved instead of being rejected on every scan
/// after. Every refusal reason (empty, relative, symlinked, outside the
/// platform roots) collapses to `false`: the caller needs the verdict, and
/// the user-facing wording is the renderer's, which names the roots.
pub async fn is_scan_path_authorized(path: String) -> Result<bool, String> {
    Ok(PluginScanPolicy::platform_defaults()
        .authorize_scan_root(Path::new(&path))
        .is_ok())
}

// ── Activation-time registry resolution ─────────────────────────────────

/// How long the one targeted rescan an activation miss is allowed may run.
///
/// It is a single file through the same bounded child-process worker a full
/// scan uses, so this only has to cover one plugin's descriptor read — and it
/// is a user waiting on a plugin they asked for, not a background sweep.
const TARGETED_RESCAN_TIMEOUT: Duration = Duration::from_secs(10);

fn read_registry_entry(
    plugin_registry: &Mutex<HashMap<String, PluginRegistryEntry>>,
    plugin_id: &str,
) -> Option<PluginRegistryEntry> {
    // Recovered, not refused, for the same reason the publisher recovers:
    // the registry is a lookup table rebuilt wholesale by every scan, so a
    // panic elsewhere leaves no state a reader must distrust. Refusing here
    // meant a poisoned lock let the scan publish while every later load
    // failed forever with a lock error the user could do nothing about.
    plugin_registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(plugin_id)
        .cloned()
}

fn plugin_gone_from_last_known_path(entry: &PersistedPluginEntry, reason: &str) -> String {
    format!(
        "Plugin '{}' could not be loaded from its last known location {}: {reason}. It has been moved, removed or replaced since it was scanned — reinstall it there, or scan the folder it lives in now.",
        entry.plugin.name, entry.plugin.path
    )
}

/// Resolve the id a saved project recorded to the registry entry that activates
/// it.
///
/// Three steps, in order, and the order is the point:
///
/// 1. hydrate the persisted registry, so a relaunched app resolves a saved
///    project's plugins with no scan at all;
/// 2. read the registry;
/// 3. on a miss, rescan the plugin's last known location — once, bounded, one
///    file — and take the result if the file is still a loadable plugin.
///
/// A miss that survives step 3 is a plugin that is no longer where it was, and
/// the refusal says so and names it. It used to say "run a scan first", which
/// was wrong in the case that produced it almost every time: the user *had*
/// scanned, in a previous session, and the message sent them to repeat work
/// that would not have helped.
///
/// The rescan is injected so the resolution order can be tested without a real
/// CLAP file and a child process; production passes [`rescan_plugin_file`].
///
/// Step 3 happens at most once per registry key per process, and the store
/// holds that record — see `PluginRegistryStore::claim_rescan`. Nothing above
/// this function bounds how often a miss is asked for: `activateExternalPlugin`
/// drops its in-flight guard when activation fails, and the frontend rebuilds a
/// project's live strip on every transport start, firing one activation per
/// external device. A per-attempt rescan turns "this project's plugins moved"
/// into one scan-worker child process per plugin per Play.
///
/// The rescan deliberately does not take `PLUGIN_SCAN_PERMIT`. That permit
/// serializes directory sweeps — hundreds of candidates, thirty seconds — and
/// this is one file, once per key per process, single-flighted. Running it
/// alongside a sweep is bounded and convergent: both writers mutate the
/// registry under its own mutex, `publish_scan_results_in_registry` drops a
/// rescanned row only when the sweep covered that root and did not find it (in
/// which case the row is wrong), and `persist` unions rather than replaces, so
/// neither save can erase the other's rows whichever order they land in.
/// Queueing behind the permit instead would park a blocking-pool thread for up
/// to the sweep's full duration; refusing on contention instead would record a
/// negative verdict that has nothing to do with the plugin.
fn resolve_registry_entry(
    plugin_registry: &Mutex<HashMap<String, PluginRegistryEntry>>,
    registry_store: &PluginRegistryStore,
    scan_policy: &PluginScanPolicy,
    plugin_id: &str,
    rescan: impl FnOnce(&str, &Path, &str, &str) -> Result<ScannedPlugin, String>,
) -> Result<PluginRegistryEntry, String> {
    registry_store.hydrate_into(plugin_registry, scan_policy);

    if let Some(entry) = read_registry_entry(plugin_registry, plugin_id) {
        return Ok(entry);
    }

    let Some(last_known) = registry_store.last_known_entry(plugin_id) else {
        return Err(format!(
            "Plugin {plugin_id} is not in the plugin registry and no scanned location is recorded for it. Scan the folder it is installed in to add it."
        ));
    };

    let attempt = match registry_store.claim_rescan(plugin_id) {
        RescanClaim::Granted(attempt) => attempt,
        RescanClaim::Refused(reason) => return Err(reason),
        RescanClaim::InProgress => {
            return Err(format!(
                "Plugin '{}' is already being looked for at {}. Try again once that finishes.",
                last_known.plugin.name, last_known.plugin.path
            ));
        }
    };

    let last_known_path = PathBuf::from(&last_known.plugin.path);
    // The rescan reads the path the policy resolved and authorized, which is the
    // only path the checks above actually looked at. It also carries the
    // persisted descriptor id: a requested key that no longer matches a row —
    // the path re-spelled, the vendor renamed a plugin — still names a plugin
    // to the persisted row, and that is the one to load.
    let rescanned = match scan_policy
        .authorize_scan_root(&last_known_path)
        .and_then(|authorized| {
            rescan(
                &last_known.plugin.format,
                &authorized,
                plugin_id,
                &last_known.plugin.descriptor_id,
            )
        }) {
        Ok(rescanned) => rescanned,
        Err(reason) => {
            let refusal = plugin_gone_from_last_known_path(&last_known, &reason);
            attempt.refuse(refusal.clone());
            return Err(refusal);
        }
    };
    attempt.resolved();

    // The requested key first, so the saved project resolves; the plugin's own
    // keys additively, which is the same rule `key_scanned_plugins` follows —
    // nothing that resolves today stops resolving. The requested key is carried
    // into the persisted row too: it is what the saved project actually
    // recorded, and dropping it would send the next launch back through this
    // rescan.
    let entry = PluginRegistryEntry::from_scanned(&rescanned);
    let mut keys = vec![plugin_id.to_string()];
    {
        let mut registry = plugin_registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        registry.insert(plugin_id.to_string(), entry.clone());
        for own_key in [&rescanned.id, &rescanned.descriptor_id] {
            if own_key.is_empty() || keys.contains(own_key) {
                continue;
            }
            keys.push(own_key.clone());
            registry
                .entry(own_key.clone())
                .or_insert_with(|| entry.clone());
        }
    }
    registry_store.persist(&[ScanRow {
        keys,
        plugin: rescanned,
    }]);

    Ok(entry)
}

/// The one bounded rescan an activation miss gets: a single file, through the
/// same child-process worker the full scan uses, so the application process
/// still never loads a plugin entry point during discovery.
///
/// Parameter metadata is not re-read. Activation does not need it, and it is a
/// second child process for a user who is waiting.
///
/// The file may be a multi-plugin bundle, so the row the requested registry key
/// names is the row returned: a key that names a bundle sibling by its
/// descriptor id must not resolve to the bundle's first plugin. When the key
/// itself matches nothing — the path was re-spelled, the vendor renamed the
/// plugin — the persisted descriptor id says which plugin of the bundle the
/// user was actually using, and that row is returned; guessing the bundle's
/// first plugin would load a different plugin and hand it the sibling's state.
fn rescan_plugin_file(
    format: &str,
    path: &Path,
    plugin_id: &str,
    last_known_descriptor_id: &str,
) -> Result<ScannedPlugin, String> {
    // The format comes off the persisted row rather than from the extension:
    // the row is what the scan that wrote it claimed, and re-deriving it here
    // would let a rename decide which extractor loads the file.
    let format = PluginFormat::from_wire_name(format)
        .ok_or_else(|| format!("Unknown plugin format: {format}"))?;
    let bundle =
        plugin_scan_worker::scan_descriptor_metadata(format, path, TARGETED_RESCAN_TIMEOUT)?;
    let scanned = scanner::scanned_bundle_plugins(path, bundle);
    let requested = pick_rescanned_bundle_row(&scanned, plugin_id, last_known_descriptor_id)
        .ok_or_else(|| {
            format!(
                "Plugin file at {} declared no plugin matching '{}' or the last known plugin '{}'. The bundle changed since it was scanned — rescan the folder it lives in now.",
                path.display(),
                plugin_id,
                last_known_descriptor_id
            )
        })?;
    Ok(requested.clone())
}

/// The one row of a rescanned bundle a registry miss resolves to.
///
/// The requested key is either a row's own registry id or its descriptor id —
/// the same two keys [`index_scanned_plugins`] publishes — and a bundle sibling
/// is addressed by its descriptor id. A key naming none of the rows is the
/// stale-key case, and the persisted descriptor id answers it: the row that
/// descriptor names is the plugin the user was using. When that names nothing
/// either, there is no honest row left to return — the bundle changed, and the
/// answer is the caller's error, not a guess at the first plugin.
fn pick_rescanned_bundle_row<'a>(
    scanned: &'a [ScannedPlugin],
    plugin_id: &str,
    last_known_descriptor_id: &str,
) -> Option<&'a ScannedPlugin> {
    scanned
        .iter()
        .find(|plugin| plugin.id == plugin_id || plugin.descriptor_id == plugin_id)
        .or_else(|| {
            if last_known_descriptor_id.is_empty() {
                return None;
            }
            scanned
                .iter()
                .find(|plugin| plugin.descriptor_id == last_known_descriptor_id)
        })
}

/// Resolve on the blocking pool: hydration reads the registry file and the
/// targeted rescan waits on a child process, and neither belongs on an async
/// runtime worker.
async fn resolve_plugin_registry_entry(
    plugin_id: &str,
    state: &AppState,
) -> Result<PluginRegistryEntry, String> {
    let plugin_registry = Arc::clone(&state.plugin_registry);
    let registry_store = Arc::clone(&state.plugin_registry_store);
    let plugin_id = plugin_id.to_string();
    tokio::task::spawn_blocking(move || {
        resolve_registry_entry(
            &plugin_registry,
            &registry_store,
            &PluginScanPolicy::platform_defaults(),
            &plugin_id,
            rescan_plugin_file,
        )
    })
    .await
    .map_err(|error| format!("Plugin registry lookup failed: {error}"))?
}

// ── Instance lifecycle commands ─────────────────────────────────────────

/// The host backend a registry row's format resolves to.
///
/// An enum rather than a bool so [`create_hosted_runtime`]'s factory switch
/// stays exhaustive: adding a backend adds an arm the compiler demands be
/// written, instead of a string somebody remembers to add to a `match`.
#[derive(Clone, Copy)]
enum HostBackend {
    /// `ClapWrapper`.
    Clap,
    /// `Vst3Wrapper`.
    Vst3,
}

impl HostBackend {
    /// How this format is named to a user, in the spelling its own vendors use.
    /// Not the wire name: `vst3` is a protocol token and "VST3" is a word.
    fn display_name(self) -> &'static str {
        match self {
            Self::Clap => "CLAP",
            Self::Vst3 => "VST3",
        }
    }
}

/// Look a persisted format string up in the host-backend registry.
///
/// The instantiation counterpart of `plugin_scan_worker`'s scan registry, and
/// deliberately a second lookup: scanning a format and hosting it are different
/// capabilities, and a format arrives at the first before the second.
///
/// A recognised format with no backend refuses in the scanner's own words, so
/// the reason a user is given for skipping the file during a scan is the reason
/// they are given for refusing to activate it — see
/// `.agents/decisions/0031-native-plugin-format-strategy.md`. A name that is not
/// a format at all is not something that decision covers, so it says only that.
fn host_backend(format: &str) -> Result<HostBackend, String> {
    let Some(recognised) = PluginFormat::from_wire_name(format) else {
        return Err(format!("Unknown plugin format: {format}"));
    };

    match recognised {
        PluginFormat::Clap => Ok(HostBackend::Clap),
        PluginFormat::Vst3 => Ok(HostBackend::Vst3),
        unhosted => Err(match unhosted.scan_support() {
            scanner::FormatScanSupport::NoExtractor(refusal) => refusal.to_string(),
            // A format Sourdaw can scan but cannot yet host. None is in that
            // state today; the moment one is, this is the honest thing to say
            // about it, and it is not a sentence ADR 0031 has wording for.
            scanner::FormatScanSupport::Extractor => {
                format!("No host backend for plugin format {}", unhosted.wire_name())
            }
        }),
    }
}

/// The rate the output device runs at by default.
///
/// Not the activation rate, and no longer used as one: a hosted plugin
/// processes the audio the engine renders, on the engine's own clock, whatever
/// the device prefers.
/// This is kept only as the reference [`engine_rate_divergence_note`] compares
/// against, so the two never diverge silently. Falling back to 48 kHz when no
/// device answers keeps the comparison from failing on a machine with no output
/// device at all.
fn default_output_sample_rate() -> f64 {
    cpal::default_host()
        .default_output_device()
        .and_then(|device| device.default_output_config().ok())
        .map(|config| config.sample_rate() as f64)
        .unwrap_or(48000.0)
}

/// The rate to activate a plugin at, or the reason this load cannot proceed.
///
/// The renderer's engine rate and nothing else. A plugin activated at a rate
/// other than the one its audio is rendered at mistunes every internal
/// coefficient it derives from that rate, and every samples→ms conversion made
/// against it — its reported latency included — is wrong by the ratio.
///
/// A rate that is not a positive, finite number is refused rather than
/// substituted: the substitute is exactly the silent guess this seam exists to
/// remove, and the caller can only fix what it is told.
fn engine_activation_sample_rate(engine_sample_rate: f64) -> Result<f64, String> {
    if !engine_sample_rate.is_finite() || engine_sample_rate <= 0.0 {
        return Err(format!(
            "Cannot activate a plugin at an engine sample rate of {engine_sample_rate}: the rate must be a positive number of hertz"
        ));
    }
    Ok(engine_sample_rate)
}

/// What to say when the engine's rate is not the one the device prefers, or
/// `None` when they agree.
///
/// The two used to be assumed identical, and the assumption was wrong on every
/// machine whose default device is not 48 kHz. It is a legitimate state — the
/// browser resamples at the device boundary — but not a silent one: a plugin
/// heard at the wrong pitch or a latency figure off by 8.8% is otherwise a
/// mystery with nothing in the log to start from.
fn engine_rate_divergence_note(engine_sample_rate: f64, device_sample_rate: f64) -> Option<String> {
    if engine_sample_rate == device_sample_rate {
        return None;
    }
    Some(format!(
        "[Plugin] activating at the engine sample rate {engine_sample_rate} Hz; the default output device reports {device_sample_rate} Hz"
    ))
}

/// Construct and activate one plugin. The only format-specific step in a load.
///
/// Everything after it — the latency query, the notifier, the engine
/// registration, the instance record — is written against
/// `HostedRuntime` and does not know which format it is holding.
fn create_hosted_runtime(
    backend: HostBackend,
    path: &str,
    descriptor_id: &str,
    sample_rate: f64,
) -> Result<HostedRuntime, String> {
    match backend {
        HostBackend::Clap => {
            ClapWrapper::new(path, descriptor_id, sample_rate).map(HostedRuntime::from)
        }
        HostBackend::Vst3 => {
            Vst3Wrapper::new(Path::new(path), descriptor_id, sample_rate).map(HostedRuntime::from)
        }
    }
}

/// Ask a freshly loaded runtime whether it offers an editor, on the shell's UI
/// thread.
///
/// For VST3 the question is itself an editor call — `createView` is the only
/// "has an editor" query the format defines, so asking it means creating and
/// releasing a real view — and the load asks before any window exists, on the
/// worker that took the load. The ask is carried to the shell's thread exactly
/// like the open it precedes; the worker holds no control gate at this point
/// (the runtime is still unregistered), so the carry closes no cycle. CLAP's
/// answer reads the descriptor's `gui` extension and never reaches the plugin,
/// so the carry is one harmless hop there — uniform rather than format-aware,
/// so the rule stays "every editor call crosses", whatever a format's answer is
/// drawn from.
///
/// Standing alone, like [`insert_engine_plugin_record`], because the load path
/// needs a real plugin library before this point and the thread contract has to
/// stay observable against a plugin that records its caller.
fn editor_support_on_ui_thread<P: AudioPlugin + ?Sized + 'static>(
    windows_host: &dyn PluginWindowHost,
    runtime: &mut P,
) -> Result<bool, String> {
    lend_on_ui_thread(windows_host, runtime, |runtime| runtime.has_gui())
}

pub async fn load_plugin(
    plugin_id: PluginId,
    instance_id: PluginInstanceId,
    engine_sample_rate: f64,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<PluginInstance, String> {
    load_plugin_with_backend(
        plugin_id,
        instance_id,
        engine_sample_rate,
        windows_host,
        state,
        create_hosted_runtime,
    )
    .await
}

/// `create_runtime` is a parameter so a test can inject a fixture runtime —
/// one whose editor-support ask records its caller — without loading a real
/// plugin library, the same way [`scan_plugins_with_backend`]'s
/// `scan_descriptor`/`scan_instance` let a scan test inject a scan outcome.
/// Production reaches this only through [`load_plugin`], which always supplies
/// [`create_hosted_runtime`].
///
/// Holds no lock of its own: the runtime and lifecycle guards live inside
/// [`load_plugin_under_runtime_gate`] and are gone by the time this resumes,
/// so the sweep below runs with `PLUGIN_RUNTIME_GATE` free.
async fn load_plugin_with_backend(
    plugin_id: PluginId,
    instance_id: PluginInstanceId,
    engine_sample_rate: f64,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
    create_runtime: impl Fn(HostBackend, &str, &str, f64) -> Result<HostedRuntime, String>,
) -> Result<PluginInstance, String> {
    let instance = load_plugin_under_runtime_gate(
        plugin_id,
        instance_id,
        engine_sample_rate,
        windows_host,
        state,
        create_runtime,
    )
    .await?;

    if instance.engine_plugin_id.is_some() {
        // A load is the moment the process is about to want the memory a
        // previous unload could not free yet. Sweep once the new instance is
        // safely in the scheduler, the engine lock is released, and —
        // crucially — `PLUGIN_RUNTIME_GATE` itself is free: the gate is fair,
        // so running a retired plugin's teardown under it would park a
        // queued `unload_all_plugin_runtimes` writer, and every later
        // `try_read` attach, for as long as that third-party teardown takes.
        state.sweep_retired_engine_plugins();
    }

    Ok(instance)
}

/// The guarded body of [`load_plugin_with_backend`]: returns the loaded
/// [`PluginInstance`] without sweeping anything.
///
/// The rate check and the registry resolution run first, holding nothing —
/// resolution can wait on a bounded child-process rescan, and the gate is fair.
/// `PLUGIN_RUNTIME_GATE` and the instance's lifecycle lease are taken directly
/// after that resolution. The lifecycle lease is held to the end of this body
/// on every exit. The runtime gate is held to the end of this body only on
/// exits that do not pass through [`refuse_load`]: that helper takes the gate
/// by value and releases it before the runtime's own teardown, so a refusal
/// exit added after `create_runtime` must return through `refuse_load` rather
/// than the bare reason, or it would tear the runtime down still holding the
/// gate. Never call this directly outside that wrapper: the sweep the wrapper
/// runs afterward depends on this frame, and both guards it took, being gone.
async fn load_plugin_under_runtime_gate(
    plugin_id: PluginId,
    instance_id: PluginInstanceId,
    engine_sample_rate: f64,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
    create_runtime: impl Fn(HostBackend, &str, &str, f64) -> Result<HostedRuntime, String>,
) -> Result<PluginInstance, String> {
    // The rate is decided before anything is resolved, locked or constructed:
    // it is the caller's own input, refusing it costs nothing, and a load that
    // cannot state its rate must not reach a plugin's entry point at all.
    let sample_rate = engine_activation_sample_rate(engine_sample_rate)?;

    // Resolution runs before the runtime gate is taken, not under it. It reads
    // the registry file and can wait on a bounded child-process rescan, and it
    // touches no runtime state at all — no `plugins`, no `engine_plugins`, no
    // engine — so nothing the gate protects is in scope. Holding the gate in
    // read mode across that wait was the whole exposure: `PLUGIN_RUNTIME_GATE`
    // is a fair `RwLock`, so one queued writer (`unload_all_plugin_runtimes`,
    // which the quit path runs) blocks behind the rescan and every later reader
    // blocks behind the writer.
    let entry = resolve_plugin_registry_entry(&plugin_id.0, state).await?;
    let _runtime_guard = observe_gate_release(PLUGIN_RUNTIME_GATE.read().await);
    let _lifecycle_guard = lock_plugin_lifecycle(&instance_id.0).await;
    ensure_plugin_instance_id_available(&state, &instance_id.0)?;

    // The session limit on engine-owned hosted instances comes before any
    // engine dependency and before the plugin library is even constructed:
    // the effect table's hosted-plugin reserve is sized to exactly this
    // number, so a load past
    // it must refuse here, where the error reaches the user rather than dying
    // as a counter on the callback. Checked against the instance map, which
    // counts the session's hosted instances whether or not a stream is
    // currently running — the limit is the session's, not the stream's.
    // This early check is ergonomics; the ceiling itself is re-decided
    // inside the insert section's critical section
    // (`insert_engine_plugin_record`), which is what closes the
    // count-then-act race this check cannot.
    {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|error| format!("Failed to lock engine_plugins: {error}"))?;
        ensure_hosted_plugin_session_headroom(&engine_plugins)?;
    }

    let backend = host_backend(&entry.format)?;

    // A descriptor id is the key a plugin's own entry point resolves a class by:
    // a reverse-DNS identifier for CLAP, a class CID for VST3. The display name
    // is not one: substituting it produced a wrapper failure that named a plugin
    // that was found and blamed something else, and two plugins sharing a display
    // name would have resolved to each other. An empty id means the scan of this
    // file yielded no usable descriptor, so say that, and say which file.
    if entry.descriptor_id.is_empty() {
        return Err(format!(
            "{} plugin {} reports no descriptor id in the registry entry for {}. Rescan the plugin directory.",
            backend.display_name(),
            entry.path,
            plugin_id.0
        ));
    }
    let descriptor_id = entry.descriptor_id.clone();

    if let Some(note) = engine_rate_divergence_note(sample_rate, default_output_sample_rate()) {
        eprintln!("{note}");
    }

    let mut wrapper = create_runtime(backend, &entry.path, &descriptor_id, sample_rate)?;
    let name = wrapper.get_name().to_string();
    // A wrapper is built even when the plugin's own `activate` says no, so this
    // is where a load learns it. Refused whether or not an engine is running,
    // because nothing ever activates a parked runtime afterwards: the flag is
    // written at construction and by the engine-owned latency restart, so an
    // instance parked in this state is refused by every attach for the rest of
    // the session — each one paying a lifecycle lease, two map locks and the
    // engine lock under the graph registry, every batch, forever.
    //
    // Refused through `refuse_load`, like every other exit from here to the
    // handover: the runtime gate goes before the plugin's teardown, and the
    // instance's lifecycle lease stays held until this function returns.
    if !wrapper.is_activated() {
        let reason = activation_refusal_reason(&name);
        return Err(refuse_load(wrapper, reason, _runtime_guard));
    }
    let params = wrapper.get_parameters();
    // Asked on the shell's UI thread because, for VST3, the question is a real
    // `createView` — the only "has an editor" query the format has — and this
    // load ask is the one place a view is created before any window exists. The
    // backend caches the answer, so every later capability read
    // (`is_plugin_gui_supported`, the open path's own check) answers from it
    // without touching the plugin.
    //
    // Matched rather than `?`-ed: this ask crosses to the shell's UI thread and
    // that crossing has a deadline (`lend_on_ui_thread`), so a shell whose main
    // loop is wedged returns an error here with an activated plugin in hand.
    let has_gui = match editor_support_on_ui_thread(windows_host, &mut wrapper) {
        Ok(has_gui) => has_gui,
        Err(reason) => return Err(refuse_load(wrapper, reason, _runtime_guard)),
    };
    // Query the plugin's latency on the control thread while it is active (the
    // wrapper just activated it) — both formats define the value only for an
    // active plugin. Captured before the wrapper moves into the engine-owned
    // runtime below.
    //
    // The conversion to milliseconds happens HERE, against `sample_rate` —
    // the exact rate this plugin was activated with, which is the caller's
    // own engine rate. Milliseconds rather than frames because the value is
    // reported again over the latency-change event, from a path that has no
    // caller to ask, and a compensation figure must not depend on which side
    // divided.
    let latency_samples = wrapper.latency_samples();
    let latency_ms = wrapper.latency_ms();
    // Read on the same control-thread visit, and left in frames: see
    // `PluginInstance::tail_samples` for why this one does not convert.
    let tail_samples = wrapper.tail_samples();

    // Wake the latency watcher when this instance flags a runtime latency
    // change, so the plugin's own notification — CLAP's `latency.changed()`
    // plus `request_restart()`, VST3's `restartComponent(kLatencyChanged)` —
    // reaches the frontend as a `plugin-latency-changed` event. Installed
    // before the wrapper is handed to the audio thread.
    let notified_instance_id = instance_id.0.clone();
    if !wrapper.set_latency_change_notifier(Box::new(move || {
        crate::host::latency_watcher::notify_latency_change(&notified_instance_id);
    })) {
        eprintln!(
            "[Plugin] latency notifier already installed for instance {}",
            instance_id.0
        );
    }

    // Send the plugin to the native audio thread for real-time processing.
    //
    // The engine lock is held for the registration and for nothing else. Both
    // of the other outcomes carry the runtime out of the block untouched,
    // because dropping one destroys the plugin: CLAP and VST3 both run
    // deactivate, destroy and the entry point's deinit on the calling thread,
    // and the quit cascade takes this same lock from the shell's JS thread
    // (`shutdown::remove_runtimes_from_scheduler`). A teardown that long, under
    // this lock, is the shell's whole UI thread waiting on a plugin's own
    // shutdown.
    let outcome = {
        // A poisoned engine slot is an exit like any other here, and it holds an
        // activated runtime: `?` on it would drop that runtime by reverse
        // declaration order, under the gate.
        let mut engine_guard = match state.engine.lock() {
            Ok(engine_guard) => engine_guard,
            Err(error) => {
                let reason = format!("Failed to lock engine: {error}");
                return Err(refuse_load(wrapper, reason, _runtime_guard));
            }
        };
        match engine_guard.as_mut() {
            Some(engine) => match register_runtime_with_engine(
                engine,
                state,
                &instance_id.0,
                wrapper,
                &name,
                &params,
                has_gui,
                entry.chain_kind,
            ) {
                Ok(registration) => EngineHandover::Registered(registration),
                Err(refusal) => EngineHandover::Refused(refusal),
            },
            None => EngineHandover::NoEngine(wrapper),
        }
    };

    let engine_plugin_id = match outcome {
        EngineHandover::Registered(registration) => {
            install_host_request_wake(&instance_id.0, &registration.runtime);
            Some(registration.engine_plugin_id)
        }
        EngineHandover::Refused(refusal) => {
            // The engine lock left scope with the block above; `refuse_load`
            // takes the runtime gate from here so that the release is stated
            // rather than left to the order the scopes happen to end in.
            let Some(runtime) = refusal.runtime else {
                // The refusal could not get the runtime back out of its owner
                // (see `RegistrationRefusal::recovered`), so this path tears
                // nothing down and has nothing to order.
                return Err(refusal.reason);
            };
            return Err(refuse_load(runtime, refusal.reason, _runtime_guard));
        }
        EngineHandover::NoEngine(wrapper) => {
            eprintln!("[Plugin] Warning: native engine not running, plugin won't process audio");
            // Dormant, not lost: `attach_dormant_plugins` registers this
            // instance on the engine's first graph batch, from the very
            // record written here.
            //
            // The map this parks into is the one exit left holding the runtime,
            // so a poisoned `plugins` refuses through the same helper: until the
            // insert below lands, this wrapper is still the load's to tear down.
            let mut plugins = match state.plugins.lock() {
                Ok(plugins) => plugins,
                Err(error) => {
                    let reason = format!("Failed to lock plugins: {error}");
                    return Err(refuse_load(wrapper, reason, _runtime_guard));
                }
            };
            plugins.insert(
                instance_id.0.clone(),
                PluginInstanceData {
                    plugin: wrapper,
                    name: name.clone(),
                    parameters: params.clone(),
                    has_gui,
                    chain_kind: entry.chain_kind,
                },
            );
            None
        }
    };

    let instance = PluginInstance {
        instance_id: instance_id.clone(),
        plugin_id: plugin_id.clone(),
        name,
        parameters: params,
        is_active: true,
        latency_samples,
        latency_ms,
        tail_samples,
        engine_plugin_id,
    };

    Ok(instance)
}

fn ensure_plugin_instance_id_available(state: &AppState, instance_id: &str) -> Result<(), String> {
    let plugins = state
        .plugins
        .lock()
        .map_err(|error| format!("Failed to lock plugins: {error}"))?;
    let engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|error| format!("Failed to lock engine_plugins: {error}"))?;

    if plugins.contains_key(instance_id) || engine_plugins.contains_key(instance_id) {
        return Err(format!("Plugin instance already exists: {instance_id}"));
    }
    Ok(())
}

/// Refuse when the session already holds its ceiling of engine-owned hosted
/// instances.
///
/// Nothing native enumerates hosted instances — the map is unbounded, keyed by
/// instance id — so the ceiling is stated by the engine
/// (`HOSTED_PLUGIN_RESERVE`) and enforced here, control-side, where the
/// refusal reaches the user. The effect table's hosted-plugin reserve is sized
/// to exactly this number, so
/// a load past it must never reach the audio thread: its refusal is a counter
/// the loader cannot read, and the plugin it refused would sit in the rack
/// passing dry audio forever.
///
/// Takes the map its caller holds: `load_plugin`'s early check wraps its own
/// brief acquisition (ergonomics — fail before the library is constructed),
/// while the insert section calls this under the guard it inserts against,
/// which is the ceiling that closes the count-then-act race.
fn ensure_hosted_plugin_session_headroom(
    engine_plugins: &HashMap<String, crate::state::EnginePluginInstanceData>,
) -> Result<(), String> {
    if engine_plugins.len() >= HOSTED_PLUGIN_RESERVE {
        return Err(format!(
            "the session hosts its maximum of {HOSTED_PLUGIN_RESERVE} native plugin instances"
        ));
    }
    Ok(())
}

/// The insert section of `load_plugin`: the session ceiling re-decided in
/// the same critical section as the insert, and the one place a hosted
/// instance record is created.
///
/// The early check at the top of `load_plugin` is ergonomics — it fails a
/// hopeless load before the plugin library is even constructed — but it
/// reads the count under a lock it drops, and two concurrent loads with
/// distinct instance ids can both pass it. This is the ceiling: whatever
/// count this critical section sees, it also inserts against, so nothing
/// slips past `HOSTED_PLUGIN_RESERVE` between its early check and its
/// insert. A refusal here is clean: `load_plugin` reaches this section
/// having reserved only a monotonic plugin id (never reused, safe to burn) —
/// no engine command has been pushed and no record exists.
///
/// Standing alone, engine-free, on purpose: reaching `load_plugin`'s engine
/// section needs an activated plugin and a live engine handle, so this seam
/// is where the ceiling's atomicity with the insert is tested.
fn insert_engine_plugin_record(
    state: &AppState,
    instance_id: &str,
    record: crate::state::EnginePluginInstanceData,
) -> Result<(), String> {
    let mut engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|error| format!("Failed to lock engine_plugins: {error}"))?;
    ensure_hosted_plugin_session_headroom(&engine_plugins)?;
    engine_plugins.insert(instance_id.to_string(), record);
    Ok(())
}

/// How long the registration waits for the RT seam to install the plugin's
/// host-request wake.
///
/// The same bound every other control visit uses. The wait is normally nothing
/// — the instance was registered a moment ago — and the deadline is there for
/// an audio thread already inside a block that never completes.
const HOST_REQUEST_WAKE_INSTALL_TIMEOUT: Duration = Duration::from_secs(2);

/// Why a plugin that would not activate is refused.
///
/// One wording for both the load's own check and the engine registration's
/// guard, because they are the same refusal reaching a caller by two routes and
/// a caller that matched on one of them would miss the other. The format is
/// behind both: `create_hosted_runtime` was the last step that knew one, so this
/// names the plugin rather than its backend.
fn activation_refusal_reason(name: &str) -> String {
    format!("plugin '{name}' failed to activate for engine-owned runtime")
}

/// Refuse a load that has already built its runtime, in the order a refusal has
/// to happen in.
///
/// The runtime gate is released first and the plugin's own teardown —
/// `deactivate`, `destroy`, `deinit_entry`, third-party code of unbounded
/// duration — runs after it. `PLUGIN_RUNTIME_GATE` is fair, so a quit-path
/// `unload_all_plugin_runtimes` queued for the write behind that teardown parks
/// every later load and unload behind itself, and each graph batch's `try_read`
/// attach fails outright for as long as it lasts.
///
/// The instance's lifecycle lease is deliberately **not** released here: it
/// stays with the caller until it returns. That lease holds off exactly one
/// thing — another operation on this same instance — and that is the operation
/// which must wait. A refusal reaches the renderer as a load error the musician
/// retries on the same device; released early, the retry takes the free lease,
/// passes [`ensure_plugin_instance_id_available`] because the refused instance
/// is in no map, and calls the plugin's entry point on the very bundle this
/// teardown is still running `deinit_entry` and `dlclose` on.
///
/// Takes the guard by value so that the release is this function's own
/// statement rather than a scope ending somewhere below. The runtime gate and
/// the lifecycle lease are function-scope in [`load_plugin_under_runtime_gate`],
/// so reverse declaration order is what each exit between the runtime's
/// construction and its handover would otherwise fall back on — which is the
/// teardown-under-the-gate this exists to prevent.
fn refuse_load(
    runtime: HostedRuntime,
    reason: String,
    gate: ObservedGateGuard<tokio::sync::RwLockReadGuard<'_, ()>>,
) -> String {
    drop(gate);
    drop(runtime);
    reason
}

/// What a refused load did, in the order it did it.
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TeardownEvent {
    RuntimeGateReleased,
    RuntimeTornDown,
}

#[cfg(test)]
thread_local! {
    /// One thread's own record of that order.
    ///
    /// Thread-local because `PLUGIN_RUNTIME_GATE` is process-global: a parallel
    /// test holding it in read mode makes any direct observation of the gate
    /// answer for that test rather than for this load. A sequence answers
    /// instead — and between the release in [`refuse_load`] and the runtime's
    /// drop there is no await, so the two events are adjacent on whichever
    /// thread ran the refusal.
    ///
    /// The three ordering tests named for sweeping retired runtimes only after
    /// releasing the runtime gate record the release from the guard's own drop
    /// inside the loading body, then the teardown from the sweep in the
    /// wrapper, with an `.await?` between the two. That gap still answers here
    /// because [`crate::block_on_test`] drives each test on a current-thread
    /// runtime, so the task carrying both events never migrates to another
    /// thread across the await.
    ///
    /// Every release entry is written by [`ObservedGateGuard`]'s own drop, so
    /// the sequence carries where each guard actually ended rather than where a
    /// statement claimed it had.
    static TEARDOWN_EVENTS: std::cell::RefCell<Vec<TeardownEvent>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
fn note_teardown_event(event: TeardownEvent) {
    TEARDOWN_EVENTS.with(|events| events.borrow_mut().push(event));
}

/// Take this thread's sequence, leaving it empty for the next observation.
#[cfg(test)]
fn take_teardown_events() -> Vec<TeardownEvent> {
    TEARDOWN_EVENTS.with(|events| std::mem::take(&mut *events.borrow_mut()))
}

/// What the engine took, for the caller to report.
struct EngineRegistration {
    engine_plugin_id: usize,
    /// The owner the audio thread now reads through, handed back so the caller
    /// can install the host-request wake once the engine lock is gone — see
    /// [`install_host_request_wake`].
    runtime: Arc<SharedHostedPlugin>,
}

/// How a load's visit to the engine ended, carried out of the engine lock's
/// scope before it is acted on.
///
/// Every variant that still owns a runtime exists so that owning it is the
/// caller's problem outside the lock: dropping a runtime destroys the plugin,
/// and parking one takes a second lock. Neither belongs inside the engine's
/// critical section — see the block in [`load_plugin_under_runtime_gate`].
enum EngineHandover {
    Registered(EngineRegistration),
    Refused(RegistrationRefusal),
    NoEngine(HostedRuntime),
}

/// A registration the engine would not take.
struct RegistrationRefusal {
    reason: String,
    /// The runtime, handed back so the caller can park the instance again and
    /// retry on the next batch ([`attach_dormant_plugins`]) or drop it clear of
    /// the engine lock ([`load_plugin_under_runtime_gate`]).
    ///
    /// `None` only when the runtime could not be got back at all: see
    /// [`RegistrationRefusal::recovered`].
    runtime: Option<HostedRuntime>,
}

impl RegistrationRefusal {
    /// A refusal that arrived before the runtime moved into the shared owner,
    /// so it never left the caller's hands.
    fn parked(reason: String, runtime: HostedRuntime) -> Self {
        Self {
            reason,
            runtime: Some(runtime),
        }
    }

    /// A refusal that arrived after the move, taking the runtime back out of
    /// the owner.
    ///
    /// The engine holds nothing on either of these paths: the record insert
    /// refuses before any command is pushed and drops the record it was handed,
    /// and a refused `add_hosted_plugin` drops the slot with the command it
    /// could not push. So the owner is sole-held by the time this runs, and the
    /// instance is recoverable rather than spent — the alternative is a device
    /// the renderer still shows whose native instance is gone.
    ///
    /// Sole ownership is proven rather than assumed. A `try_unwrap` that fails
    /// means some other holder is still inside the wrapper, and handing that
    /// runtime to a second owner would be the real defect; the refusal then says
    /// the instance is gone, which is at least true.
    fn recovered(reason: String, shared: Arc<SharedHostedPlugin>) -> Self {
        match Arc::try_unwrap(shared) {
            Ok(owner) => Self {
                reason,
                runtime: Some(owner.into_inner()),
            },
            Err(_) => Self {
                reason,
                runtime: None,
            },
        }
    }
}

/// Hand one runtime to a running engine: reserve its id, record the instance,
/// and register the slot.
///
/// The one copy of that sequence. A load reaches it with a runtime it has just
/// built ([`load_plugin_under_runtime_gate`]); the engine's first graph batch
/// reaches it with a runtime that has been sitting dormant since a load found
/// no engine ([`attach_dormant_plugins`]). Two copies would let the two paths
/// drift, and the dormant one is exactly the path nobody exercises by hand.
///
/// Takes the runtime by value because registering it moves it into the shared
/// owner the audio thread reads through. Every refusal hands it back — before
/// the move it was never given away, and after the move it is taken back out of
/// an owner nothing else holds (see [`RegistrationRefusal::recovered`]) — so a
/// refused registration costs the caller a retry rather than the instance.
///
/// Called with the engine lock held, and takes `engine_plugins` under it, which
/// is the load path's order and the only order any engine-then-map path here
/// uses. Everything that has to wait on the instance itself is therefore the
/// caller's, once that lock is gone: see [`install_host_request_wake`].
fn register_runtime_with_engine(
    engine: &mut daw_engine::EngineHandle,
    state: &AppState,
    instance_id: &str,
    runtime: HostedRuntime,
    name: &str,
    parameters: &[PluginParameter],
    has_gui: bool,
    chain_kind: DeviceKind,
) -> Result<EngineRegistration, RegistrationRefusal> {
    // The load refuses an unactivated plugin before anything is parked, so
    // reaching this is a runtime that lost its activation after it was built.
    // Kept as a guard because handing one to the engine is unrecoverable: it
    // renders nothing and answers no parameter for the rest of the session.
    if !runtime.is_activated() {
        return Err(RegistrationRefusal::parked(
            activation_refusal_reason(name),
            runtime,
        ));
    }

    // The scheduler's effect table is shared with the project's native devices
    // and the crumbs capture slot, so a plugin can be refused by a table this
    // path never populated. Refuse before anything is registered: past this
    // point the id is reserved, the instance is in `engine_plugins` with its
    // GUI and parameters, and the load reports success — while the audio
    // thread's own refusal is a counter it cannot return to the user, leaving a
    // plugin in the rack that passes dry audio forever.
    if let Err(reason) = engine.ensure_effect_table_headroom(1) {
        return Err(RegistrationRefusal::parked(reason, runtime));
    }

    let id = engine.reserve_plugin_id();

    // Take the parameter-event queue before the runtime is handed to the audio
    // thread. Held on the record so the drain reaches it without the control
    // seam — see `EnginePluginInstanceData`.
    let parameter_events = AudioPlugin::parameter_event_queue(&runtime);

    // Read while the runtime is still exclusively ours. Both formats define the
    // figure only for an activated plugin, and the guard above proved that; once
    // the runtime is shared, reaching it again waits on the control gate an open
    // editor can hold.
    let latency_frames = <HostedRuntime as HostedPluginRuntime>::latency_samples(&runtime) as usize;

    let shared_plugin = Arc::new(SharedHostedPlugin::new(runtime));

    // The record insert re-decides the session ceiling inside its own critical
    // section — see `insert_engine_plugin_record`. A refusal there leaves
    // nothing behind: the id above is a burned monotonic counter, and no engine
    // command has been pushed yet. The
    // record it could not insert is dropped inside, which is what leaves the
    // owner sole-held for the recovery below.
    if let Err(reason) = insert_engine_plugin_record(
        state,
        instance_id,
        crate::state::EnginePluginInstanceData {
            engine_plugin_id: id,
            runtime: Arc::clone(&shared_plugin),
            name: name.to_string(),
            parameters: parameters.to_vec(),
            has_gui,
            chain_kind,
            parameter_events,
        },
    ) {
        return Err(RegistrationRefusal::recovered(reason, shared_plugin));
    }

    // The slot gets a clone rather than the owner itself: a refused push drops
    // the slot it was handed, and with it the last reference, so an owner given
    // away here would take the runtime down with a refusal the caller was about
    // to recover from.
    if let Err(error) = engine.add_hosted_plugin(
        id,
        Box::new(HostedPluginSlot::new(Arc::clone(&shared_plugin))),
    ) {
        // The engine refused the registration (a full effect table, or the
        // ring): unwind the record under a fresh acquisition, same order as
        // every other engine-then-map path, so the map never carries an
        // instance the engine never took. Unwound before the recovery below,
        // because the record holds a reference of its own.
        match state.engine_plugins.lock() {
            Ok(mut engine_plugins) => {
                engine_plugins.remove(instance_id);
            }
            Err(lock_error) => {
                return Err(RegistrationRefusal::recovered(
                    format!("Failed to lock engine_plugins: {lock_error}"),
                    shared_plugin,
                ));
            }
        }
        return Err(RegistrationRefusal::recovered(error, shared_plugin));
    }

    // Past the registration, on the same control-thread visit that read the
    // figure, and never before it: the command names an effect id, and the
    // graph refuses one its table does not hold yet. A push that fails leaves
    // the instance registered and sounding — uncompensated until the next
    // latency change, which is a worse mix rather than a broken one, so it is
    // reported and not unwound.
    if let Err(error) = engine.set_effect_latency(id, latency_frames) {
        eprintln!("[Plugin] failed to publish latency for instance {instance_id}: {error}");
    }

    Ok(EngineRegistration {
        engine_plugin_id: id,
        runtime: shared_plugin,
    })
}

/// Mark one registered instance as one whose plugin-initiated asks get carried
/// off the calling thread — the watcher wakes for the `[main-thread]` asks (a
/// state change, a parameter rescan), and the drain thread answers the
/// `[thread-safe]` ones (an editor resize, a flush).
///
/// Engine-owned only, because both carriers reach an instance through
/// `engine_plugins`: one the engine never took is not reachable from there, and
/// installing the wake on one would have the plugin told its resize was accepted
/// by a follow-up that could never run. So it is installed past every refusal
/// rather than on the runtime before it moved — the wake is a `OnceLock`, first
/// install wins for the instance's whole life, and a refusal hands the runtime
/// back to be parked. A parked instance carrying a wake answers `request_resize`
/// with true while `apply_pending_editor_resizes` walks only `engine_plugins`, so
/// the plugin lays its editor out to a size no window will ever take.
///
/// **Called clear of `state.engine`.** Reaching the runtime waits twice: on the
/// instance's non-RT control gate, which an open editor holds across the
/// plugin's own `open_gui`, and then on the RT seam for as long as
/// [`HOST_REQUEST_WAKE_INSTALL_TIMEOUT`]. Under the engine lock either wait
/// would park every graph batch, every transport update and the quit cascade
/// behind a third party's editor code, so both callers install once their engine
/// guard is out of scope — the way `unload_plugin_runtime` keeps its own control
/// visit outside that lock. Waiting under the instance's own lifecycle gate is
/// the point rather than a cost: what that gate holds off is another operation
/// on this same instance.
///
/// A wake that could not be installed is reported and nothing else: the
/// registration itself succeeded, and the plugin gets the answer a host with no
/// follow-up gives.
fn install_host_request_wake(instance_id: &str, runtime: &SharedHostedPlugin) {
    let requesting_instance_id = instance_id.to_string();
    if let Err(error) = runtime.with_control(HOST_REQUEST_WAKE_INSTALL_TIMEOUT, |plugin| {
        plugin.set_plugin_host_request_notifier(Box::new(move |request| {
            crate::host::plugin_host_requests::notify_plugin_host_request(
                &requesting_instance_id,
                request,
            );
        }));
        Ok(())
    }) {
        eprintln!(
            "[Plugin] instance '{instance_id}' will not carry its own host requests: {error}"
        );
    }
}

/// One instance the engine has just taken, for the batch that started it to
/// report back.
pub struct AttachedPlugin {
    pub instance_id: String,
    pub engine_plugin_id: usize,
}

/// Register the instances that were loaded while no engine was running, up to
/// the `limit` the caller reserved room for.
///
/// The engine starts lazily, on the first graph batch, so a plugin loaded
/// before the first Play is parked in `state.plugins` with no engine plugin id.
/// Nothing used to move it out again: it stayed dormant, rendering nothing, for
/// the rest of the session. This is what moves it, called by
/// `apply_graph_commands` right after the crumbs slot it mirrors.
///
/// Each attach pushes one command onto the ring the caller's batch just filled,
/// so the caller reserves that many slots before sending it and passes the same
/// number here. Honouring it is what makes the reservation exact: an instance
/// parked after the caller counted is left dormant rather than pushed onto a
/// ring with no room for it, and the next batch — the roll that follows a
/// topology within one start sequence — counts it and takes it.
///
/// Synchronous, unlike every other lifecycle path here, because its caller
/// holds the graph registry guard across its own body and so cannot await: the
/// two lifecycle gates are therefore *tried* rather than waited on, and a gate
/// held by a concurrent load or unload leaves the instance dormant for the next
/// batch — the same answer an engine refusal gets.
///
/// Locks in the load path's order, `PLUGIN_RUNTIME_GATE` then the per-instance
/// lifecycle gate then `plugins` then `engine` then `engine_plugins`, and never
/// holds `plugins` across the engine lock — nor `engine` across anything else.
/// No path here nests those two at all, which is what leaves no order for a
/// cycle to close.
pub fn attach_dormant_plugins(
    state: &AppState,
    limit: usize,
) -> Result<Vec<AttachedPlugin>, String> {
    if limit == 0 {
        return Ok(Vec::new());
    }

    let Ok(_runtime_guard) = PLUGIN_RUNTIME_GATE.try_read() else {
        return Err("the plugin runtime gate is held by another operation".to_string());
    };

    // Sorted, because the map's own order is arbitrary and a short reservation
    // is exactly when the order decides who waits: the same session, played
    // twice, must not attach a different subset. Instance ids are stable, so
    // this is a total order the caller can predict.
    let dormant_instance_ids: Vec<String> = {
        let plugins = state
            .plugins
            .lock()
            .map_err(|error| format!("Failed to lock plugins: {error}"))?;
        let mut ids: Vec<String> = plugins.keys().cloned().collect();
        ids.sort();
        ids
    };

    let mut attached = Vec::new();
    for instance_id in dormant_instance_ids {
        // Refusals cost the caller nothing, so only an instance actually taken
        // spends a reserved slot.
        if attached.len() == limit {
            break;
        }
        match attach_one_dormant_plugin(state, &instance_id) {
            Ok(Some(plugin)) => attached.push(plugin),
            Ok(None) => {}
            Err(reason) => {
                eprintln!(
                    "[Plugin] instance '{instance_id}' could not attach to the engine: {reason}"
                );
            }
        }
    }

    Ok(attached)
}

/// `Ok(None)` when there was nothing left to do: the instance was unloaded
/// between the scan above and this acquisition of its lifecycle gate.
fn attach_one_dormant_plugin(
    state: &AppState,
    instance_id: &str,
) -> Result<Option<AttachedPlugin>, String> {
    let Some(_lifecycle_guard) = try_lock_plugin_lifecycle(instance_id) else {
        return Err("a load or unload holds this instance".to_string());
    };

    // The same ergonomic check the load path makes for the same reason: refuse
    // a hopeless registration before the runtime leaves the dormant map, so a
    // session already at its ceiling parks the instance rather than spending
    // it. `insert_engine_plugin_record` is still the ceiling.
    {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|error| format!("Failed to lock engine_plugins: {error}"))?;
        ensure_hosted_plugin_session_headroom(&engine_plugins)?;
    }

    let Some(dormant) = ({
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|error| format!("Failed to lock plugins: {error}"))?;
        plugins.remove(instance_id)
    }) else {
        return Ok(None);
    };
    let PluginInstanceData {
        plugin,
        name,
        parameters,
        has_gui,
        chain_kind,
    } = dormant;

    let registration = {
        let mut engine_guard = state
            .engine
            .lock()
            .map_err(|error| format!("Failed to lock engine: {error}"))?;
        match engine_guard.as_mut() {
            Some(engine) => register_runtime_with_engine(
                engine,
                state,
                instance_id,
                plugin,
                &name,
                &parameters,
                has_gui,
                chain_kind,
            ),
            None => Err(RegistrationRefusal::parked(
                "no native engine is running".to_string(),
                plugin,
            )),
        }
    };

    match registration {
        Ok(registration) => {
            install_host_request_wake(instance_id, &registration.runtime);
            Ok(Some(AttachedPlugin {
                instance_id: instance_id.to_string(),
                engine_plugin_id: registration.engine_plugin_id,
            }))
        }
        Err(refusal) => {
            // Park it again, outside the engine lock, so the next batch tries
            // it once more. A refusal hands the runtime back whether or not it
            // had already moved into the shared owner; the one case that cannot
            // is an owner some other holder is still inside, and there the
            // instance really is gone.
            if let Some(runtime) = refusal.runtime {
                state
                    .plugins
                    .lock()
                    .map_err(|error| format!("Failed to lock plugins: {error}"))?
                    .insert(
                        instance_id.to_string(),
                        PluginInstanceData {
                            plugin: runtime,
                            name,
                            parameters,
                            has_gui,
                            chain_kind,
                        },
                    );
            }
            Err(refusal.reason)
        }
    }
}

fn remove_plugin_window(
    instance_id: &str,
    windows_host: Option<&dyn PluginWindowHost>,
    state: &AppState,
) {
    let window_label = match state.plugin_windows.lock() {
        Ok(mut windows) => windows.remove(instance_id),
        Err(poisoned) => poisoned.into_inner().remove(instance_id),
    };
    if let (Some(windows_host), Some(label)) = (windows_host, window_label) {
        windows_host.destroy_window(&label);
    }
}

pub async fn unload_plugin(
    instance_id: Option<PluginInstanceId>,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<PluginUnloadReply, String> {
    match instance_id {
        Some(instance_id) => {
            let mut reply = PluginUnloadReply::default();
            {
                let _runtime_guard = observe_gate_release(PLUGIN_RUNTIME_GATE.read().await);
                match unload_plugin_runtime(&instance_id.0, Some(windows_host), state).await {
                    Ok(reports) => {
                        reply.unloaded_instance_ids.push(instance_id.0);
                        reply.reports = reports;
                    }
                    Err(error) => reply.errors.push(error),
                }
            }
            // The read guard above ends with the block, not with this
            // function: `unload_plugin_runtime` no longer sweeps, so this is
            // the moment a retired runtime's teardown is safe to run. Run it
            // here rather than under the guard — `PLUGIN_RUNTIME_GATE` is
            // fair, so a queued `unload_all_plugin_runtimes` writer would
            // otherwise wait out third-party teardown of unbounded length.
            state.sweep_retired_engine_plugins();
            Ok(reply)
        }
        None => unload_all_plugin_runtimes(Some(windows_host), state).await,
    }
}

/// Fold per-instance strip reports from a cascade into one entry per strip,
/// keeping the last.
///
/// Each report is built from the registry as it stood right after its own
/// instance's release committed, so a strip two cascade instances shared
/// carries an earlier, incomplete chain in its first report and the final
/// one in its last — keeping the last is keeping the true final chain,
/// without a second pass over the registry once the cascade is done.
fn dedupe_strip_reports_keeping_last(reports: Vec<StripReportPayload>) -> Vec<StripReportPayload> {
    let mut deduped: Vec<StripReportPayload> = Vec::new();
    for report in reports {
        match deduped.iter_mut().find(|entry| entry.id == report.id) {
            Some(entry) => *entry = report,
            None => deduped.push(report),
        }
    }
    deduped
}

async fn unload_all_plugin_runtimes(
    windows_host: Option<&dyn PluginWindowHost>,
    state: &AppState,
) -> Result<PluginUnloadReply, String> {
    let mut reply = PluginUnloadReply::default();
    let mut reports = Vec::new();
    {
        let _runtime_guard = observe_gate_release(PLUGIN_RUNTIME_GATE.write().await);
        let instance_ids = {
            let plugins = state
                .plugins
                .lock()
                .map_err(|error| format!("Failed to lock plugins: {error}"))?;
            let engine_plugins = state
                .engine_plugins
                .lock()
                .map_err(|error| format!("Failed to lock engine_plugins: {error}"))?;
            plugins
                .keys()
                .chain(engine_plugins.keys())
                .cloned()
                .collect::<BTreeSet<_>>()
        };
        for instance_id in instance_ids {
            match unload_plugin_runtime(&instance_id, windows_host, state).await {
                Ok(strip_reports) => {
                    reply.unloaded_instance_ids.push(instance_id);
                    reports.extend(strip_reports);
                }
                Err(error) => reply.errors.push(error),
            }
        }
    }
    // One sweep for the whole cascade, after the write guard above is gone:
    // the gate has to be free either way, and a sweep per instance inside the
    // loop would only repeat the same wait under it once per instance.
    state.sweep_retired_engine_plugins();
    reply.reports = dedupe_strip_reports_keeping_last(reports);
    Ok(reply)
}

/// The thread this unload's editor teardown must run on.
///
/// An unload can run with no window host at all — a shell may lose its windows
/// before its last instance — and [`NoWindowHost`] says so: the editor calls then
/// run on this thread, which is the only one left to run them on.
fn editor_thread(windows_host: Option<&dyn PluginWindowHost>) -> &dyn PluginWindowHost {
    windows_host.unwrap_or(&NoWindowHost)
}

/// Take the instance's chain entries out of the live graph, then retire it.
///
/// Order is the whole point. A chain entry naming a retired effect is not
/// counted anywhere — `resolve_effect` returns `None` on a failed
/// effect-table lookup, and both `TrackDeviceChain::run_device` and
/// `run_generator` return without processing it, a hosted instance being
/// spliced as a generator — so it is a silent passthrough for as long as it
/// stands, and on a rolling engine no topology replacement ever arrives to
/// clear it. Retiring first would therefore open that hole for the rest of the
/// session; releasing first closes it before the hole can exist.
///
/// Both guards are held across the pair so the release ops and the retirement
/// reach the ring from one producer with nothing interleaved. They are taken
/// registry-then-engine, the order `apply_graph_commands` takes them in, which
/// is what keeps a concurrent batch from deadlocking against this one.
///
/// The removal is computed on a working clone and committed only once the ring
/// has taken the batch, the law `map_batch` follows: a batch the ring refused
/// is not a fence, and a registry that had already forgotten a chain entry the
/// engine still holds could never name it again — the caller's later
/// `remove-device` would find no device and do nothing.
///
/// Answers with the strip reports for every strip the release actually
/// touched, built from the committed clone after the ring has taken the
/// batch — never from the working clone before it, which could describe a
/// release the engine went on to refuse. A refused release, or one with
/// nothing to release, reports no strip.
fn release_then_retire_engine_plugin(
    engine_plugin_id: usize,
    state: &AppState,
) -> Result<Vec<StripReportPayload>, String> {
    let mut registry = state
        .graph
        .lock()
        .map_err(|error| format!("Failed to lock graph registry: {}", error))?;
    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|error| format!("Failed to lock engine: {}", error))?;
    let Some(engine) = engine_guard.as_mut() else {
        return Err("Native engine not running".to_string());
    };

    let mut working = registry.clone();
    let release = working.release_engine_plugin(engine_plugin_id);
    let mut reports = Vec::new();
    if !release.ops.is_empty() {
        // The reserved slot is the `RemovePlugin` push below: the
        // retirement must not find the ring full behind the release.
        match engine.send_graph_batch_with_headroom(release.ops, 1) {
            Ok(()) => {
                working.record_fenced_batch();
                reports = graph::strip_reports(&working, &release.touched_strip_ids);
                *registry = working;
            }
            Err(error) => {
                // Logged and carried on, with the clone discarded. The
                // retirement still goes: refusing here would abandon an unload
                // the caller has already begun, and the entry the registry
                // keeps is what lets a later batch unlink it. No report is
                // owed for a release the registry never committed.
                eprintln!(
                    "[Plugin] chain release before unload was refused: {:?}",
                    error
                );
            }
        }
    }

    engine.remove_plugin(engine_plugin_id)?;
    Ok(reports)
}

/// Tear one instance's runtime out of the engine and the plugin maps.
///
/// Never sweeps the retirement vec: this always runs with the caller's
/// `PLUGIN_RUNTIME_GATE` guard held — `unload_plugin`'s read guard for a
/// keyed unload, `unload_all_plugin_runtimes`'s write guard for the quit
/// cascade — so a sweep in here would tear a retired plugin's runtime down
/// under that same fair gate. The caller sweeps once its own guard is gone.
async fn unload_plugin_runtime(
    instance_id: &str,
    windows_host: Option<&dyn PluginWindowHost>,
    state: &AppState,
) -> Result<Vec<StripReportPayload>, String> {
    let _lifecycle_guard = lock_plugin_lifecycle(instance_id).await;
    let command_plugin = {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;
        plugins.remove(instance_id)
    };
    if let Some(mut instance) = command_plugin {
        // Removing a device closes its editor, and closing an editor is the same
        // thread-affine lifecycle a GUI command runs: `close_gui` reaches VST3
        // `removed` and CLAP `gui.destroy`, and running them on this worker
        // un-parents an NSView off the main thread.
        let _ = lend_on_ui_thread(
            editor_thread(windows_host),
            &mut instance.plugin,
            |plugin| plugin.close_gui(),
        );
        remove_plugin_window(instance_id, windows_host, state);
        // A command-owned instance names no chain entry: it never bound to
        // a strip, so there is no strip to report.
        return Ok(Vec::new());
    }

    let engine_plugin = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        let engine_plugin = engine_plugins.get(instance_id);
        if let Some(instance) = engine_plugin {
            instance.runtime.begin_unload();
        }
        engine_plugin.map(|instance| (instance.engine_plugin_id, Arc::clone(&instance.runtime)))
    };

    if let Some((engine_plugin_id, runtime)) = engine_plugin {
        let scheduler_removal_result = release_then_retire_engine_plugin(engine_plugin_id, state);
        let reports = match scheduler_removal_result {
            Ok(reports) => reports,
            Err(error) => {
                runtime.cancel_unload();
                return Err(error);
            }
        };

        state.retain_retired_engine_plugin(Arc::clone(&runtime));

        if let Err(error) =
            runtime.with_unload_control(std::time::Duration::from_secs(2), |plugin| {
                lend_on_ui_thread(editor_thread(windows_host), plugin, |plugin| {
                    plugin.close_gui()
                })
            })
        {
            eprintln!("[Plugin] GUI cleanup failed during unload: {error}");
        }

        remove_plugin_window(instance_id, windows_host, state);

        match state.engine_plugins.lock() {
            Ok(mut engine_plugins) => {
                let _ = remove_engine_plugin_record_after_scheduler_removal(
                    &mut engine_plugins,
                    instance_id,
                    Ok(()),
                );
            }
            Err(poisoned) => {
                let mut engine_plugins = poisoned.into_inner();
                let _ = remove_engine_plugin_record_after_scheduler_removal(
                    &mut engine_plugins,
                    instance_id,
                    Ok(()),
                );
            }
        }
        runtime.retire();

        // This runtime is not a sweep candidate yet even once the caller's
        // guard is gone: `runtime` is still a live reference here and the
        // scheduler removal was only queued, so the caller's sweep frees the
        // previous generation, not this one.
        drop(runtime);
        return Ok(reports);
    }

    // A keyed unload is a convergence operation: the requested runtime being
    // absent already satisfies its postcondition. This also makes a retry safe
    // when the process stopped after native teardown but before its durable
    // command-batch checkpoint advanced. No runtime means no chain entry to
    // have released, so there is no strip to report either.
    Ok(Vec::new())
}

// ── Parameter commands ──────────────────────────────────────────────────

fn update_parameter_cache_after_enqueue(
    parameters: &mut [PluginParameter],
    param_id: u32,
    value: f64,
    enqueue_result: Result<(), String>,
) -> Result<(), String> {
    enqueue_result?;

    if let Some(parameter) = parameters
        .iter_mut()
        .find(|parameter| parameter.id == param_id)
    {
        parameter.value = value;
    }

    Ok(())
}

pub async fn set_plugin_parameter(
    instance_id: PluginInstanceId,
    param_id: u32,
    value: f64,
    state: &AppState,
) -> Result<(), String> {
    {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;

        if let Some(instance) = plugins.get_mut(&instance_id.0) {
            instance.plugin.set_parameter(param_id, value);
            return Ok(());
        }
    }

    // Resolve the runtime under the map lock and release it before the write.
    // `enqueue_parameter` blocks unbounded on the instance's non-RT control
    // lock, so holding the map lock across the write parks every other reader of
    // this map for as long as control is held.
    let runtime = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        match engine_plugins.get(&instance_id.0) {
            Some(instance) => Arc::clone(&instance.runtime),
            None => return Err(format!("No plugin instance: {}", instance_id.0)),
        }
    };

    let enqueue_result = runtime.enqueue_parameter(param_id, value);

    let mut engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
    match engine_plugins.get_mut(&instance_id.0) {
        // An unload+reload during the write leaves a different runtime under
        // the same id. The value was written to the old one, so it is not this
        // instance's value and must not enter its cache.
        Some(instance) if Arc::ptr_eq(&instance.runtime, &runtime) => {
            update_parameter_cache_after_enqueue(
                &mut instance.parameters,
                param_id,
                value,
                enqueue_result,
            )
        }
        _ => enqueue_result,
    }
}

pub async fn get_plugin_parameters(
    instance_id: PluginInstanceId,
    state: &AppState,
) -> Result<Vec<PluginParameter>, String> {
    {
        let plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;

        if let Some(instance) = plugins.get(&instance_id.0) {
            return Ok(instance.plugin.get_parameters());
        }
    }

    let runtime = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        match engine_plugins.get(&instance_id.0) {
            Some(instance) => {
                instance.runtime.ensure_public_control_allowed()?;
                Arc::clone(&instance.runtime)
            }
            None => return Err(format!("No plugin instance: {}", instance_id.0)),
        }
    };

    // Poll the plugin rather than answer from the cache. The cache only ever
    // recorded writes this host made, so a user turning a knob in the plugin's
    // own editor left it stale forever — and every reader of this command, UI
    // and automation alike, read the value from before the user touched it.
    //
    // The lock is released first: the poll runs on the control seam, which can
    // wait on the audio thread, and holding the instance map across that would
    // stall every other command for the same reason.
    let polled_parameters = runtime.poll_parameters(std::time::Duration::from_secs(2))?;

    let mut engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
    let instance = engine_plugins
        .get_mut(&instance_id.0)
        .ok_or_else(|| format!("No plugin instance: {}", instance_id.0))?;

    // An unload+reload during the poll leaves a different runtime under the same
    // id. The snapshot describes the runtime that is gone, so it neither
    // overwrites this record's cache nor is answered as this record's values.
    let is_same_runtime = Arc::ptr_eq(&instance.runtime, &runtime);

    if let Some(parameters) = polled_parameters {
        // A write accepted between the poll and here is newer than the snapshot
        // and is already in the cache; storing the snapshot would revert it —
        // the exact knob snap-back this path exists to prevent.
        if is_same_runtime && !runtime.has_pending_parameter_writes() {
            instance.parameters = parameters;
        }
    }
    Ok(instance.parameters.clone())
}

/// Read a loaded plugin instance's opaque state chunk.
///
/// Shared by the command layer so the transport can change without the lookup
/// order (command-owned instances first, then engine-owned runtimes) changing
/// with it. The instance lookup is the authorization gate: plugin state is keyed
/// by instance id, not addressed by path, so no filesystem allowlist applies.
fn read_plugin_state_chunk(instance_id: &str, state: &AppState) -> Result<Vec<u8>, String> {
    {
        let plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;

        if let Some(instance) = plugins.get(instance_id) {
            return instance.plugin.get_state();
        }
    }

    let runtime = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        engine_plugins
            .get(instance_id)
            .map(|instance| Arc::clone(&instance.runtime))
    };
    if let Some(runtime) = runtime {
        return runtime.get_state_after_pending_parameters_drain(std::time::Duration::from_secs(2));
    }

    Err(format!("No plugin instance: {}", instance_id))
}

/// Restore a loaded plugin instance's opaque state chunk.
///
/// Takes a borrowed slice so the raw IPC body can be handed straight through
/// without a copy.
fn write_plugin_state_chunk(
    instance_id: &str,
    plugin_state: &[u8],
    state: &AppState,
) -> Result<(), String> {
    {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;

        if let Some(instance) = plugins.get_mut(instance_id) {
            instance.plugin.set_state(plugin_state)?;
            return Ok(());
        }
    }

    // Resolve the runtime under the map lock and release it before the restore.
    // `set_state_invalidating_pending_parameters` waits up to 2 s for control
    // access and then runs the plugin's own `set_state`, so holding the map lock
    // across that work parks every other reader of this map for seconds.
    let runtime = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        match engine_plugins.get(instance_id) {
            Some(instance) => Arc::clone(&instance.runtime),
            None => return Err(format!("No plugin instance: {}", instance_id)),
        }
    };

    let refreshed_parameters = runtime.set_state_invalidating_pending_parameters(
        std::time::Duration::from_secs(2),
        plugin_state,
    )?;

    let mut engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
    if let Some(instance) = engine_plugins.get_mut(instance_id) {
        // An unload+reload during the restore leaves a different runtime under
        // the same id; the parameters the old one reported are not its values.
        if Arc::ptr_eq(&instance.runtime, &runtime) {
            instance.parameters = refreshed_parameters;
        }
    }
    Ok(())
}

/// Read a plugin instance's opaque state chunk as raw bytes.
///
/// The shell carries the result verbatim rather than as a JSON array of decimal
/// numbers — the latter costs ~3.57x the raw length for the high-entropy bytes
/// real plugin state is made of (OE-5 / WB-5 / M-109).
///
/// Only the *response* needs to be binary here: the request carries nothing but
/// the instance id, so it stays an ordinary argument exactly as
/// `read_file_bytes` keeps its path.
pub async fn get_plugin_state_bytes(
    instance_id: PluginInstanceId,
    state: &AppState,
) -> Result<Vec<u8>, String> {
    read_plugin_state_chunk(&instance_id.0, state)
}

/// Restore a plugin instance's opaque state chunk from raw bytes.
///
/// The chunk arrives as bytes rather than as a JSON number array, so it crosses
/// at exactly its byte length; the instance id travels beside it because the
/// byte channel carries the payload and nothing else. How the shell addresses
/// the payload is its own business.
pub async fn set_plugin_state_bytes(
    instance_id: String,
    plugin_state: &[u8],
    state: &AppState,
) -> Result<(), String> {
    write_plugin_state_chunk(&instance_id, plugin_state, state)
}

// ── Native audio engine ────────────────────────────────────────────────
//
// There is no explicit start command. The engine's recorded bootstrap (#1984)
// is lazy start inside `commands::graph::apply_graph_commands`: the audio
// stream spawns when the first graph batch arrives, and a machine where it
// cannot start rejects that batch with an `engine-not-running:` reason. The
// old `start_native_engine` command was deleted with that decision — it had
// no caller in any shipped build, and a second unconditioned start entry
// point beside the lazy one would be two bootstraps to keep honest.

/// Send a MIDI note event to a native plugin on the audio thread (lock-free).
pub async fn send_plugin_midi(
    engine_plugin_id: usize,
    note: u8,
    velocity: u8,
    channel: i16,
    is_note_on: bool,
    state: &AppState,
) -> Result<(), String> {
    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|e| format!("Failed to lock engine: {}", e))?;
    let engine = engine_guard.as_mut().ok_or("Native engine not running")?;

    engine.send_midi_note(
        engine_plugin_id,
        MidiNoteEvent {
            note,
            velocity,
            channel,
            is_note_on,
            probability_cutoff: daw_engine::midi_fx::PROBABILITY_CUTOFF_RANGE,
            project_probability_seed: 0,
            clip_id_hash: 0,
            event_id_hash: 0,
            absolute_occurrence_index: 0,
            frame_offset: 0,
        },
    )
}

/// Resolve the engine plugin id an instance was registered under.
///
/// Split out because two commands need the same lookup and the same refusal:
/// an instance with no engine-owned runtime has nothing on the audio thread to
/// address, and guessing an id would address whichever plugin happens to hold
/// it.
fn engine_plugin_id_for_instance(instance_id: &str, state: &AppState) -> Result<usize, String> {
    let engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
    engine_plugins
        .get(instance_id)
        .map(|data| data.engine_plugin_id)
        .ok_or_else(|| format!("No engine plugin for instance {}", instance_id))
}

/// Bypass or un-bypass a natively hosted plugin on the audio thread.
///
/// Keyed by `instance_id`: the engine plugin id is reserved inside the audio
/// engine and the frontend has no reliable way to learn it.
///
/// Bypass is not unloading. The instance, its parameters and its editor stay
/// exactly as they were — the professional convention — and only its processing
/// stops, so re-enabling it is instant rather than a reload.
pub async fn set_plugin_bypass(
    instance_id: String,
    bypassed: bool,
    state: &AppState,
) -> Result<(), String> {
    let engine_plugin_id = engine_plugin_id_for_instance(&instance_id, state)?;

    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|e| format!("Failed to lock engine: {}", e))?;
    let engine = engine_guard.as_mut().ok_or("Native engine not running")?;

    engine.set_bypass(engine_plugin_id, bypassed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::plugin_registry_store::{scanned_binary_location, scanned_file_path};
    use crate::host::plugin_window::testing::DedicatedUiWindowHost;
    use crate::host::plugin_window::PluginEditorWindow;
    use crate::host::ui_thread::{UiThread, UiThreadTask};
    use crate::state::EnginePluginInstanceData;
    use daw_core::PluginInstanceId;
    use std::path::Path;

    /// The rate a caller's engine renders at. Every load a test makes states
    /// one, because every load the product makes does.
    const TEST_ENGINE_SAMPLE_RATE: f64 = 48_000.0;

    /// `PLUGIN_SCAN_PERMIT` is process-global and maps contention to the
    /// in-band "Plugin scan already in progress" error, which a scan test
    /// running beside another would misread as its own behaviour under the
    /// parallel harness — so every test that reaches the permit serializes
    /// through this lock for its full duration.
    static SCAN_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// What this thread did immediately before the refused runtime went down.
    ///
    /// The one ordering a refusal owes: `PLUGIN_RUNTIME_GATE` released, and only
    /// then the plugin's own `deactivate`, `destroy` and `deinit_entry`.
    fn event_before_teardown(events: &[TeardownEvent]) -> Option<TeardownEvent> {
        let teardown = events
            .iter()
            .position(|event| *event == TeardownEvent::RuntimeTornDown)?;
        teardown.checked_sub(1).map(|before| events[before])
    }

    /// A shell whose UI thread never answers: it has a thread of its own, so
    /// every editor call has to cross to it, and it refuses to carry one.
    ///
    /// Which is what a wedged main loop looks like from this side — the real
    /// implementation gives up on its own deadline (`lend_on_ui_thread`) and
    /// reports the same shape of error.
    struct UnreachableUiWindowHost;

    impl UiThread for UnreachableUiWindowHost {
        fn is_ui_thread(&self) -> bool {
            false
        }

        fn run_on_ui_thread(&self, _task: &Arc<UiThreadTask>) -> Result<(), String> {
            Err("The shell's UI thread did not take the editor call".to_string())
        }
    }

    impl PluginWindowHost for UnreachableUiWindowHost {
        fn window_exists(&self, _label: &str) -> bool {
            false
        }

        fn create_editor_window(
            &self,
            _label: &str,
            _title: &str,
            _instance_id: &str,
        ) -> Result<Box<dyn PluginEditorWindow>, String> {
            Err("This host cannot create plugin editor windows".to_string())
        }

        fn destroy_window(&self, _label: &str) {}

        fn hide_window(&self, _label: &str) {}

        fn show_window(&self, _label: &str) {}
    }

    fn plugin_parameter(id: u32, value: f64) -> PluginParameter {
        PluginParameter {
            id,
            name: format!("Param {id}"),
            value,
            default_value: 0.0,
            min_value: 0.0,
            max_value: 1.0,
            unit: None,
            is_automatable: true,
        }
    }

    fn insert_engine_owned_fixture(state: &AppState, instance_id: &str, state_bytes: Vec<u8>) {
        let mut wrapper = ClapWrapper::new_engine_owned_command_fixture(
            "Engine Owned Fixture",
            state_bytes,
            true,
        );
        wrapper.set_engine_owned_command_fixture_parameters(vec![plugin_parameter(7, 0.25)]);
        let parameters = wrapper.get_parameters();
        let runtime = Arc::new(SharedHostedPlugin::new(wrapper.into()));
        let mut engine_plugins = state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available");
        engine_plugins.insert(
            instance_id.to_string(),
            EnginePluginInstanceData {
                engine_plugin_id: 17,
                runtime,
                name: "Engine Owned Fixture".to_string(),
                parameters,
                has_gui: true,
                chain_kind: DeviceKind::Effect,
                parameter_events: None,
            },
        );
    }

    fn engine_fixture_runtime(state: &AppState, instance_id: &str) -> Arc<SharedHostedPlugin> {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available");
        Arc::clone(
            &engine_plugins
                .get(instance_id)
                .expect("engine fixture should exist")
                .runtime,
        )
    }

    /// A bypass toggle addressed to an instance the engine never took must say
    /// so. Resolving it to a default id would silence, or un-silence, whichever
    /// plugin happens to hold that id.
    #[test]
    fn bypassing_an_instance_with_no_engine_runtime_names_the_instance() {
        let state = AppState::default();

        let refusal =
            crate::block_on_test(set_plugin_bypass("never-loaded".to_string(), true, &state));

        assert_eq!(
            refusal,
            Err("No engine plugin for instance never-loaded".to_string())
        );
    }

    /// The instance resolves, so the refusal has to come from the next step —
    /// there is no audio thread to carry the command. A single generic error
    /// for both cases would leave a user unable to tell a missing plugin from a
    /// stopped engine.
    #[test]
    fn bypassing_a_resolved_instance_without_a_running_engine_reports_the_engine() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "instance-bypass", Vec::new());

        let refusal = crate::block_on_test(set_plugin_bypass(
            "instance-bypass".to_string(),
            true,
            &state,
        ));

        assert_eq!(refusal, Err("Native engine not running".to_string()));
    }

    /// Every command keyed by instance id must resolve the same engine plugin:
    /// a bypass that resolved differently from a parameter write would mute a
    /// plugin the user is still editing.
    #[test]
    fn every_command_resolves_one_instance_to_the_same_engine_plugin_id() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "instance-shared-lookup", Vec::new());

        assert_eq!(
            engine_plugin_id_for_instance("instance-shared-lookup", &state),
            Ok(17)
        );
    }

    fn unique_temp_scan_root(test_name: &str) -> PathBuf {
        let unique_suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "sourdaw-{test_name}-{}-{unique_suffix}",
            std::process::id()
        ))
    }

    /// The cache only ever recorded writes this host made, so a knob turned in
    /// the plugin's own editor never reached any reader of this command.
    #[test]
    fn get_plugin_parameters_reports_a_change_made_inside_the_plugin() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "instance-plugin-side-change", Vec::new());
        let runtime = engine_fixture_runtime(&state, "instance-plugin-side-change");

        // The user moved the control in the plugin's editor: the plugin's value
        // changed and the host wrote nothing.
        runtime
            .with_control(Duration::from_secs(2), |plugin| {
                plugin.set_engine_owned_command_fixture_parameters(vec![plugin_parameter(7, 0.9)]);
                Ok(())
            })
            .expect("fixture control access should succeed");

        let parameters = crate::block_on_test(get_plugin_parameters(
            PluginInstanceId("instance-plugin-side-change".to_string()),
            &state,
        ))
        .expect("parameters should resolve");

        assert_eq!(
            parameters.iter().map(|p| p.value).collect::<Vec<_>>(),
            vec![0.9],
            "a parameter changed inside the plugin must reach the command"
        );
    }

    /// The other half: a host write that the audio thread has not applied yet is
    /// newer than anything the plugin can report, so polling must not roll it
    /// back to the value it is about to replace.
    #[test]
    fn get_plugin_parameters_keeps_a_write_the_audio_thread_has_not_applied() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "instance-pending-write", Vec::new());

        crate::block_on_test(set_plugin_parameter(
            PluginInstanceId("instance-pending-write".to_string()),
            7,
            0.75,
            &state,
        ))
        .expect("the parameter write should be accepted");

        let parameters = crate::block_on_test(get_plugin_parameters(
            PluginInstanceId("instance-pending-write".to_string()),
            &state,
        ))
        .expect("parameters should resolve");

        assert_eq!(
            parameters.iter().map(|p| p.value).collect::<Vec<_>>(),
            vec![0.75],
            "a queued write must not be reported as the value it is replacing"
        );
    }

    /// Replace the record under an instance id with a fresh runtime — exactly
    /// as an unload followed by a reload of the same id does — for a caller
    /// already inside the map's critical section. The interleaving tests
    /// install the replacement under one held lock so no racing command can
    /// observe the id absent or half-replaced.
    fn reload_engine_owned_record(
        engine_plugins: &mut HashMap<String, EnginePluginInstanceData>,
        instance_id: &str,
        replacement: EnginePluginInstanceData,
    ) {
        engine_plugins.remove(instance_id);
        engine_plugins.insert(instance_id.to_string(), replacement);
    }

    /// Build the record [`reload_engine_owned_record`] installs. Kept separate
    /// from the swap so the swap is exactly two map operations under the held
    /// lock, and so a choreography can place this real construction work
    /// deliberately on one side of a gate rather than paying it inside the
    /// critical section.
    fn reloaded_engine_owned_record(parameter_value: f64) -> EnginePluginInstanceData {
        let mut wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Reloaded Fixture", Vec::new(), true);
        wrapper.set_engine_owned_command_fixture_parameters(vec![plugin_parameter(
            7,
            parameter_value,
        )]);
        let parameters = wrapper.get_parameters();
        EnginePluginInstanceData {
            engine_plugin_id: 18,
            runtime: Arc::new(SharedHostedPlugin::new(wrapper.into())),
            name: "Reloaded Fixture".to_string(),
            parameters,
            has_gui: true,
            chain_kind: DeviceKind::Effect,
            parameter_events: None,
        }
    }

    /// Take `engine_plugins` while a command is parked on its runtime's control
    /// gate, or name the phase and fail: these commands release the map before
    /// their control wait, so a lock that never frees is exactly the regression
    /// the swap tests guard against.
    ///
    /// A polled condition wait on a real contention point — `try_lock` plus
    /// `yield_now`, bounded by a deadline — not a wall-clock ordering: the wait
    /// ends when the map is actually free, and the deadline only converts a
    /// would-be hang into a loud failure.
    fn lock_engine_plugins_for_the_swap<'state>(
        state: &'state AppState,
        phase: &str,
    ) -> std::sync::MutexGuard<'state, HashMap<String, EnginePluginInstanceData>> {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Ok(engine_plugins) = state.engine_plugins.try_lock() {
                return engine_plugins;
            }
            assert!(
                Instant::now() < deadline,
                "{phase} must free engine_plugins while it waits for plugin control"
            );
            std::thread::yield_now();
        }
    }

    /// Wait until the command thread under test is provably past its runtime
    /// resolution: resolving clones the record's `Arc`, so the strong count
    /// rising above the pre-spawn `baseline` is that resolve made observable.
    ///
    /// The raised count is stable, not a transient to be missed — the command
    /// parks on the control gate this choreography holds, and only leaves the
    /// command — dropping its clone — after that gate opens. A command that
    /// resolved before a swap therefore holds the runtime the swap replaces,
    /// whatever the scheduler does with it in between.
    fn wait_for_the_command_resolve(
        runtime: &Arc<SharedHostedPlugin>,
        baseline: usize,
        phase: &str,
    ) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Arc::strong_count(runtime) <= baseline {
            assert!(
                Instant::now() < deadline,
                "{phase} must resolve the runtime it addresses before the choreography proceeds"
            );
            std::thread::yield_now();
        }
    }

    fn parameter_values(parameters: &[PluginParameter]) -> Vec<f64> {
        parameters.iter().map(|parameter| parameter.value).collect()
    }

    /// `set_plugin_parameter` used to hold the `engine_plugins` map lock across
    /// `enqueue_parameter`, which blocks unbounded on the instance's non-RT
    /// control lock — so a plugin holding control parked every other reader of
    /// that map with it. The map must be free while the control write is in
    /// flight.
    ///
    /// And once it is free, an unload+reload can land in that window: the value
    /// went to the runtime that is gone, so it must not be written onto the
    /// record that replaced it.
    ///
    /// The interleaving is constructed with gates, not sleeps: the control
    /// holder parks the write on the runtime's real control gate, the reload
    /// replaces the record while that gate is still held, and the gate is
    /// handed back only once the replacement is installed — so the write can
    /// never complete against the record it resolved.
    #[test]
    fn set_plugin_parameter_frees_the_map_during_the_write_and_refuses_a_swapped_record() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "instance-swapped-write", Vec::new());
        let runtime = engine_fixture_runtime(&state, "instance-swapped-write");

        std::thread::scope(|scope| {
            let (control_held, control_gate_taken) = std::sync::mpsc::channel();
            let state_ref = &state;
            let resolve_baseline = Arc::strong_count(&runtime);
            // The holder owns the runtime's control gate — the mutex and the
            // access seam beneath it — for its whole closure, and the closure
            // performs the swap itself. The swap waits for the writer's
            // resolve to become observable: resolving clones the record's
            // `Arc`, so the count rising above its pre-spawn baseline proves
            // the writer holds the OLD runtime — a writer the scheduler
            // parked mid-command can therefore never resolve the replacement
            // and legitimately write to it. The map must be free for the
            // swap — the first half of this contract — and the replacement
            // goes in under one critical section while the gate is still
            // held, so the write-back always meets a swapped record.
            let control_holder = scope.spawn(move || {
                runtime.with_control(Duration::from_secs(5), |_plugin| {
                    control_held.send(()).expect("the test is still listening");
                    wait_for_the_command_resolve(&runtime, resolve_baseline, "the writer");
                    let replacement = reloaded_engine_owned_record(0.25);
                    let mut engine_plugins =
                        lock_engine_plugins_for_the_swap(state_ref, "set_plugin_parameter");
                    reload_engine_owned_record(
                        &mut engine_plugins,
                        "instance-swapped-write",
                        replacement,
                    );
                    Ok(())
                })
            });
            control_gate_taken
                .recv_timeout(Duration::from_secs(5))
                .expect("the control holder must take the gate before the write runs");

            let writer = scope.spawn(move || {
                crate::block_on_test(set_plugin_parameter(
                    PluginInstanceId("instance-swapped-write".to_string()),
                    7,
                    0.75,
                    state_ref,
                ))
            });

            assert_eq!(writer.join().expect("writer thread"), Ok(()));
            control_holder
                .join()
                .expect("control holder thread")
                .expect("fixture control access should succeed");
        });

        let engine_plugins = state.engine_plugins.lock().expect("engine_plugins lock");
        let instance = engine_plugins
            .get("instance-swapped-write")
            .expect("the reloaded record should exist");
        assert_eq!(
            parameter_values(&instance.parameters),
            vec![0.25],
            "a write addressed to the unloaded runtime must not land on its replacement"
        );
    }

    /// The state-restore path had the same defect on a longer timescale: it held
    /// the `engine_plugins` map across a 2 s control timeout plus the plugin's
    /// own `set_state`, so a slow plugin parked the audio relay for seconds. And
    /// once the map is free, an unload+reload can land in that window: the
    /// parameters the dead runtime reported are not the replacement's.
    ///
    /// The interleaving is constructed with gates, not sleeps: the control
    /// holder parks the restore on the runtime's real control gate, the reload
    /// replaces the record while that gate is still held, and the gate is
    /// handed back only once the replacement is installed — so the restore can
    /// never complete against the record it resolved.
    #[test]
    fn write_plugin_state_chunk_frees_the_map_during_the_restore_and_refuses_a_swapped_record() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "instance-swapped-restore", Vec::new());
        let runtime = engine_fixture_runtime(&state, "instance-swapped-restore");
        runtime
            .with_control(Duration::from_secs(2), |plugin| {
                plugin.set_engine_owned_command_fixture_parameters(vec![plugin_parameter(7, 0.9)]);
                Ok(())
            })
            .expect("fixture control access should succeed");

        std::thread::scope(|scope| {
            let (control_held, control_gate_taken) = std::sync::mpsc::channel();
            let state_ref = &state;
            let resolve_baseline = Arc::strong_count(&runtime);
            // The holder owns the runtime's control gate — the mutex and the
            // access seam beneath it — for its whole closure, and the closure
            // performs the swap itself. The swap waits for the writer's
            // resolve to become observable: resolving clones the record's
            // `Arc`, so the count rising above its pre-spawn baseline proves
            // the writer holds the OLD runtime, whatever the scheduler does.
            // The map must be free for the swap — the first half of this
            // contract — and the replacement goes in under one critical
            // section while the gate is still held, so the write-back always
            // meets a swapped record.
            let control_holder = scope.spawn(move || {
                runtime.with_control(Duration::from_secs(5), |_plugin| {
                    control_held.send(()).expect("the test is still listening");
                    wait_for_the_command_resolve(&runtime, resolve_baseline, "the writer");
                    let replacement = reloaded_engine_owned_record(0.25);
                    let mut engine_plugins =
                        lock_engine_plugins_for_the_swap(state_ref, "write_plugin_state_chunk");
                    reload_engine_owned_record(
                        &mut engine_plugins,
                        "instance-swapped-restore",
                        replacement,
                    );
                    Ok(())
                })
            });
            control_gate_taken
                .recv_timeout(Duration::from_secs(5))
                .expect("the control holder must take the gate before the restore runs");

            let writer = scope.spawn(move || {
                write_plugin_state_chunk("instance-swapped-restore", &[9, 8, 7], state_ref)
            });

            assert_eq!(writer.join().expect("writer thread"), Ok(()));
            control_holder
                .join()
                .expect("control holder thread")
                .expect("fixture control access should succeed");
        });

        let engine_plugins = state.engine_plugins.lock().expect("engine_plugins lock");
        assert_eq!(
            parameter_values(
                &engine_plugins
                    .get("instance-swapped-restore")
                    .expect("the reloaded record should exist")
                    .parameters
            ),
            vec![0.25],
            "a restore addressed to the unloaded runtime must not refresh its replacement's cache"
        );
    }

    /// Same window on the read side: an unload+reload between the poll and the
    /// cache write-back makes `get_mut` resolve a NEW record, and the dead
    /// plugin's parameters used to be stored onto it and returned as its own.
    ///
    /// The interleaving is constructed with gates, not sleeps: the control
    /// holder parks the poll on the runtime's real control gate, the reload
    /// replaces the record while that gate is still held, and the gate is
    /// handed back only once the replacement is installed — so the poll can
    /// never complete against the record it resolved.
    #[test]
    fn get_plugin_parameters_refuses_to_store_a_dead_runtimes_poll_onto_its_replacement() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "instance-swapped-poll", Vec::new());
        let runtime = engine_fixture_runtime(&state, "instance-swapped-poll");
        runtime
            .with_control(Duration::from_secs(2), |plugin| {
                plugin.set_engine_owned_command_fixture_parameters(vec![plugin_parameter(7, 0.9)]);
                Ok(())
            })
            .expect("fixture control access should succeed");

        let polled = std::thread::scope(|scope| {
            let (control_held, control_gate_taken) = std::sync::mpsc::channel();
            let state_ref = &state;
            let resolve_baseline = Arc::strong_count(&runtime);
            // The holder owns the runtime's control gate — the mutex and the
            // access seam beneath it — for its whole closure, and the closure
            // performs the swap itself. The swap waits for the reader's
            // resolve to become observable: resolving clones the record's
            // `Arc`, so the count rising above its pre-spawn baseline proves
            // the reader holds the OLD runtime, whatever the scheduler does.
            // The map must be free for the swap, and the replacement goes in
            // under one critical section while the gate is still held, so the
            // poll always describes the dead runtime and the write-back
            // always meets a swapped record.
            let control_holder = scope.spawn(move || {
                runtime.with_control(Duration::from_secs(5), |_plugin| {
                    control_held.send(()).expect("the test is still listening");
                    wait_for_the_command_resolve(&runtime, resolve_baseline, "the reader");
                    let replacement = reloaded_engine_owned_record(0.25);
                    let mut engine_plugins =
                        lock_engine_plugins_for_the_swap(state_ref, "get_plugin_parameters");
                    reload_engine_owned_record(
                        &mut engine_plugins,
                        "instance-swapped-poll",
                        replacement,
                    );
                    Ok(())
                })
            });
            control_gate_taken
                .recv_timeout(Duration::from_secs(5))
                .expect("the control holder must take the gate before the poll runs");

            let reader = scope.spawn(move || {
                crate::block_on_test(get_plugin_parameters(
                    PluginInstanceId("instance-swapped-poll".to_string()),
                    state_ref,
                ))
            });

            let polled = reader.join().expect("reader thread");
            control_holder
                .join()
                .expect("control holder thread")
                .expect("fixture control access should succeed");
            polled
        })
        .expect("parameters should resolve");

        assert_eq!(
            parameter_values(&polled),
            vec![0.25],
            "the replacement instance must answer with its own values, not the dead runtime's"
        );
        let engine_plugins = state.engine_plugins.lock().expect("engine_plugins lock");
        assert_eq!(
            parameter_values(
                &engine_plugins
                    .get("instance-swapped-poll")
                    .expect("the reloaded record should exist")
                    .parameters
            ),
            vec![0.25],
            "the replacement instance's cache must be untouched by the dead runtime's poll"
        );
    }

    /// The other hole in the same window: a parameter write accepted after the
    /// poll was determined is newer than the poll, and the cache already holds
    /// it. Storing the poll on top reverts it — the exact knob snap-back
    /// `poll_parameters` claims to prevent.
    ///
    /// The window is constructed with gates, not sleeps: the map is taken only
    /// once the reader's resolve is observable, is held from before the poll
    /// may run until the newer write and its cache entry are both in, and the
    /// write is enqueued after a control round trip that queues behind the
    /// reader's poll — so the write-back meets a cache that is newer than the
    /// poll, and no schedule of correct code fails.
    #[test]
    fn get_plugin_parameters_does_not_revert_a_write_accepted_during_the_poll() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "instance-late-write", Vec::new());
        let runtime = engine_fixture_runtime(&state, "instance-late-write");
        runtime
            .with_control(Duration::from_secs(2), |plugin| {
                plugin.set_engine_owned_command_fixture_parameters(vec![plugin_parameter(7, 0.9)]);
                Ok(())
            })
            .expect("fixture control access should succeed");

        let polled = std::thread::scope(|scope| {
            let (control_held, control_gate_taken) = std::sync::mpsc::channel();
            let (let_poll_run, poll_may_run) = std::sync::mpsc::channel();
            let (go_hold_map, hold_map) = std::sync::mpsc::channel();
            let (map_held, map_was_held) = std::sync::mpsc::channel();

            // The holder owns the runtime's control gate for its whole
            // closure and opens it only on this thread's say-so — which is
            // sent once the map below is held — so the reader's write-back
            // can never run before the newer write is in the cache.
            let event_runtime = Arc::clone(&runtime);
            let state_ref = &state;
            let resolve_baseline = Arc::strong_count(&runtime);
            let control_holder = scope.spawn(move || {
                runtime.with_control(Duration::from_secs(5), |_plugin| {
                    control_held.send(()).expect("the test is still listening");
                    poll_may_run
                        .recv_timeout(Duration::from_secs(5))
                        .expect("the test opens the gate once the map is held");
                    Ok(())
                })
            });
            control_gate_taken
                .recv_timeout(Duration::from_secs(5))
                .expect("the control holder must take the gate before the poll runs");

            let reader = scope.spawn(move || {
                crate::block_on_test(get_plugin_parameters(
                    PluginInstanceId("instance-late-write".to_string()),
                    state_ref,
                ))
            });

            // Holds the map across the reader's poll, then lands the write in
            // that window exactly as `set_plugin_parameter` does: enqueue,
            // then record it in the cache.
            let map_holder = scope.spawn(move || {
                hold_map
                    .recv_timeout(Duration::from_secs(5))
                    .expect("the test asks for the map once the reader runs");

                // The map is taken only once the reader's resolve is
                // observable: resolving clones the record's `Arc`, so the
                // count rising above the pre-spawn baseline proves the reader
                // is inside the command with this runtime. From there the
                // still-closed gate leaves the poll the only step it can
                // take, so the enqueue below cannot land before the reader
                // has even resolved.
                wait_for_the_command_resolve(&event_runtime, resolve_baseline, "the reader");

                let mut engine_plugins =
                    lock_engine_plugins_for_the_swap(state_ref, "get_plugin_parameters");
                map_held.send(()).expect("the test is still listening");

                // The gate above is still closed, so the reader parks on the
                // control mutex and this round trip queues behind it; the
                // reader holds that mutex across its whole poll, so this
                // returning means the reader's snapshot is taken and the
                // enqueued write is the newer one. The one escape is a reader
                // descheduled between its resolve and the mutex: this then
                // runs uncontended and the enqueue precedes the poll, whose
                // own pending check refuses the window for this run — that
                // schedule leaves the write-back guard unexercised but no
                // schedule of correct code fails.
                event_runtime
                    .with_control(Duration::from_secs(2), |_plugin| Ok(()))
                    .expect("fixture control access should succeed");
                event_runtime
                    .enqueue_parameter(7, 0.75)
                    .expect("the queued write should be accepted");
                engine_plugins
                    .get_mut("instance-late-write")
                    .expect("fixture should exist")
                    .parameters = vec![plugin_parameter(7, 0.75)];
            });

            go_hold_map
                .send(())
                .expect("the map holder is still waiting");
            map_was_held
                .recv_timeout(Duration::from_secs(5))
                .expect("the map must be held before the poll may run");
            let_poll_run
                .send(())
                .expect("the control holder is still parked in its gate");

            let polled = reader.join().expect("reader thread");
            control_holder
                .join()
                .expect("control holder thread")
                .expect("fixture control access should succeed");
            map_holder.join().expect("map holder thread");
            polled
        })
        .expect("parameters should resolve");

        assert_eq!(
            parameter_values(&polled),
            vec![0.75],
            "a write accepted during the poll must not be reverted by the poll's write-back"
        );
        let engine_plugins = state.engine_plugins.lock().expect("engine_plugins lock");
        assert_eq!(
            parameter_values(
                &engine_plugins
                    .get("instance-late-write")
                    .expect("fixture should exist")
                    .parameters
            ),
            vec![0.75],
            "the cache must keep the newer write, not the older poll"
        );
    }

    /// The scan publisher recovers a poisoned registry lock, so the registry is
    /// populated. The reader refused it, which turned the poison into "every
    /// load fails forever with a lock error" — a state no user action clears.
    #[test]
    fn load_plugin_reads_past_a_poisoned_registry_lock() {
        let state = AppState::default();

        let poisoning = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = state
                .plugin_registry
                .lock()
                .expect("first lock should succeed");
            panic!("poison the registry lock");
        }));
        assert!(poisoning.is_err());
        assert!(state.plugin_registry.is_poisoned());

        publish_scan_results_in_registry(
            &state.plugin_registry,
            &state.plugin_registry_store,
            &[],
            &[],
            true,
            &[scanned("aaaa1111", "com.vendor.reverb", "clap")],
        );

        let error = crate::block_on_test(load_plugin(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("poisoned-registry-instance".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
        ))
        .expect_err("a fake plugin path cannot load");

        assert!(
            error.starts_with("Failed to load CLAP plugin at /plugins/aaaa1111.clap:"),
            "the load must get past the registry read and fail at the library, got: {error}"
        );
    }

    /// The session-limit predicate itself, at the ceiling, in the wording
    /// that names it: past the limit the effect table's hosted-plugin reserve
    /// has no slot left, and the audio thread's own
    /// refusal is a counter nothing propagates — the plugin would load, open
    /// its editor, and pass dry audio forever. The predicate is only part of
    /// the guarantee: the load path's early call is pinned by
    /// `load_plugin_refuses_at_the_hosted_session_ceiling_before_loading_the_library`,
    /// and the insert section's re-decision of the ceiling by
    /// `the_engine_plugin_insert_section_re_checks_the_ceiling_with_the_insert`.
    #[test]
    fn the_hosted_plugin_session_ceiling_predicate_refuses_with_the_limit_named() {
        let state = AppState::default();
        for index in 0..HOSTED_PLUGIN_RESERVE {
            insert_engine_owned_fixture(&state, &format!("instance-{index}"), Vec::new());
        }

        let refusal = {
            let engine_plugins = state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock should be available");
            ensure_hosted_plugin_session_headroom(&engine_plugins)
                .expect_err("a session at the ceiling must refuse the next instance")
        };
        assert_eq!(
            refusal,
            format!(
                "the session hosts its maximum of {HOSTED_PLUGIN_RESERVE} native plugin instances"
            )
        );

        // Unloading is what makes room: one below the ceiling admits again.
        state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available")
            .remove("instance-0");
        {
            let engine_plugins = state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock should be available");
            assert!(ensure_hosted_plugin_session_headroom(&engine_plugins).is_ok());
        }
    }

    /// The insert section re-decides the session ceiling under the same lock
    /// it inserts against — the closure for the count-then-act race the
    /// early check cannot close: it reads the count under a lock it drops,
    /// so two concurrent loads at count N-1 both pass it. Tested at the seam
    /// that carries the check because reaching `load_plugin`'s engine
    /// section needs an activated plugin and a live engine handle;
    /// `insert_engine_plugin_record` is deliberately engine-free and is the
    /// only place a hosted-instance record is created. At the ceiling the
    /// insert refuses with the ceiling's own message and the record never
    /// lands; one below, it lands.
    #[test]
    fn the_engine_plugin_insert_section_re_checks_the_ceiling_with_the_insert() {
        fn record() -> crate::state::EnginePluginInstanceData {
            crate::state::EnginePluginInstanceData {
                engine_plugin_id: 4_096,
                runtime: Arc::new(SharedHostedPlugin::new(
                    ClapWrapper::new_engine_owned_command_fixture(
                        "Re-check Fixture",
                        Vec::new(),
                        false,
                    )
                    .into(),
                )),
                name: "Re-check Fixture".to_string(),
                parameters: Vec::new(),
                has_gui: false,
                chain_kind: DeviceKind::Effect,
                parameter_events: None,
            }
        }

        let state = AppState::default();
        for index in 0..HOSTED_PLUGIN_RESERVE {
            insert_engine_owned_fixture(&state, &format!("instance-{index}"), Vec::new());
        }

        let refusal = insert_engine_plugin_record(&state, "instance-overflow", record())
            .expect_err("the insert section must refuse at the ceiling");
        assert_eq!(
            refusal,
            format!(
                "the session hosts its maximum of {HOSTED_PLUGIN_RESERVE} native plugin instances"
            )
        );
        assert!(
            !state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock should be available")
                .contains_key("instance-overflow"),
            "a refused insert must leave no record behind"
        );

        // Unloading is what makes room, and then the insert lands.
        state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available")
            .remove("instance-0");
        insert_engine_plugin_record(&state, "instance-room", record())
            .expect("an insert one below the ceiling must land");
        assert!(state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available")
            .contains_key("instance-room"));
    }

    /// A refusal that arrives after the runtime has already moved into the
    /// shared owner still hands it back. The engine took nothing — the insert
    /// refused before a single command was pushed — so the alternative is a
    /// device the renderer still shows with no native instance behind it, for
    /// the rest of the session.
    ///
    /// Driven at this seam because it is the only refusal past the move a test
    /// can reach: `attach_one_dormant_plugin` checks the same ceiling before it
    /// removes the instance, so the attach path refuses one step earlier.
    #[test]
    fn a_registration_refused_after_the_move_hands_the_runtime_back() {
        let state = AppState::default();
        for index in 0..HOSTED_PLUGIN_RESERVE {
            insert_engine_owned_fixture(&state, &format!("instance-{index}"), Vec::new());
        }

        let (mut engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        let runtime: HostedRuntime =
            ClapWrapper::new_engine_owned_command_fixture("Recovered Fixture", Vec::new(), false)
                .into();

        let refusal = register_runtime_with_engine(
            &mut engine,
            &state,
            "recovered-instance",
            runtime,
            "Recovered Fixture",
            &[],
            false,
            DeviceKind::Effect,
        )
        .err()
        .expect("a session at its ceiling must refuse the record insert");

        assert_eq!(
            refusal.reason,
            format!(
                "the session hosts its maximum of {HOSTED_PLUGIN_RESERVE} native plugin instances"
            )
        );
        let recovered = refusal
            .runtime
            .expect("a refusal the engine never acted on gives the runtime back to be parked");
        assert_eq!(
            AudioPlugin::get_name(&recovered),
            "Recovered Fixture",
            "the runtime handed back is the one that was handed in"
        );
        assert!(
            !state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock should be available")
                .contains_key("recovered-instance"),
            "a refused registration leaves no record behind either"
        );
        // And it comes back clean. The host-request wake is a `OnceLock` — one
        // install for the instance's whole life, with no way to take it off —
        // and a parked instance carrying one answers `request_resize` with true
        // while the follow-up that would honour it walks only `engine_plugins`,
        // so the plugin lays its editor out to a size no window ever takes. A
        // successful install here is the proof that nothing was installed
        // before.
        assert!(
            recovered.set_plugin_host_request_notifier(Box::new(|_| {})),
            "a runtime handed back to be parked must carry no host-request wake"
        );
    }

    /// A plugin with a lookahead or an FFT window declares its latency at
    /// activation and never flags a change afterwards, so the registration is
    /// the only visit that can carry the figure to the graph. Without it the
    /// effect registers at zero and every route parallel to the plugin stays
    /// ahead of it for the rest of the session.
    #[test]
    fn registering_a_latent_plugin_publishes_its_declared_latency_with_a_dry_delay() {
        let state = AppState::default();
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);

        let mut wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Latent Fixture", Vec::new(), false);
        wrapper.set_engine_owned_command_fixture_latency_samples(512);
        let runtime: HostedRuntime = wrapper.into();

        let registration = register_runtime_with_engine(
            &mut engine,
            &state,
            "latent-instance",
            runtime,
            "Latent Fixture",
            &[],
            false,
            DeviceKind::Effect,
        );
        let Ok(registration) = registration else {
            panic!("a fresh session registers the instance");
        };

        let mut published = Vec::new();
        while let Ok(command) = command_rx.pop() {
            if let daw_engine::scheduler::GraphCommand::SetEffectLatency {
                effect_id,
                latency_frames,
                dry_delay,
            } = command
            {
                published.push((effect_id, latency_frames, dry_delay.is_some()));
            }
        }

        assert_eq!(
            published,
            vec![(registration.engine_plugin_id, 512, true)],
            "the registration publishes the plugin's own declared latency, \
             and the dry line that holds a bypassed pass at it"
        );
    }

    /// A load the running engine refuses tears its runtime down holding nothing:
    /// not the engine lock, not the runtime gate, not the lifecycle lease.
    ///
    /// Destroying a plugin runs its own `deactivate`, `destroy` and `deinit` on
    /// this thread, for as long as the plugin takes. Under the engine lock that
    /// is the shell's quit cascade waiting on third-party code; under
    /// `PLUGIN_RUNTIME_GATE`, which is fair, it is a queued
    /// `unload_all_plugin_runtimes` writer and — behind that writer — every
    /// later load and unload, plus each graph batch's `try_read` attach failing
    /// outright for the whole window. The fixture reports what this thread still
    /// held when it went down.
    ///
    /// Reached by crossing the session ceiling from inside the injected
    /// constructor, which is the one moment between the load's early ergonomic
    /// check and the registration that re-decides it: that is the count-then-act
    /// race `insert_engine_plugin_record` exists to close, and the only way this
    /// path's post-move refusal happens with a plugin that activated properly.
    #[test]
    fn a_load_the_engine_refuses_tears_its_runtime_down_holding_no_lock() {
        let state = Arc::new(AppState::default());
        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        publish_scan_results_in_registry(
            &state.plugin_registry,
            &state.plugin_registry_store,
            &[],
            &[],
            true,
            &[scanned("aaaa1111", "com.vendor.reverb", "clap")],
        );

        let engine_free_at_teardown = Arc::new(std::sync::atomic::AtomicBool::new(false));
        take_teardown_events();

        let error = crate::block_on_test(load_plugin_with_backend(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("refused-by-the-engine".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                // The ceiling is crossed here, after the load read it and before
                // the registration reads it again.
                for index in 0..HOSTED_PLUGIN_RESERVE {
                    insert_engine_owned_fixture(&state, &format!("ceiling-{index}"), Vec::new());
                }
                let mut wrapper = ClapWrapper::new_engine_owned_command_fixture(
                    "Refused By The Engine",
                    Vec::new(),
                    false,
                );
                let observed_state = Arc::clone(&state);
                let engine_free = Arc::clone(&engine_free_at_teardown);
                wrapper.observe_engine_owned_command_fixture_teardown(Box::new(move || {
                    note_teardown_event(TeardownEvent::RuntimeTornDown);
                    engine_free.store(
                        observed_state.engine.try_lock().is_ok(),
                        std::sync::atomic::Ordering::SeqCst,
                    );
                }));
                Ok(HostedRuntime::from(wrapper))
            },
        ))
        .expect_err("a session already at its ceiling must refuse the load");

        assert!(
            error.contains("native plugin instances"),
            "the caller is told the session is full, got: {error}"
        );
        assert!(
            !state
                .plugins
                .lock()
                .expect("plugins lock should be available")
                .contains_key("refused-by-the-engine"),
            "a refused load parks nothing: the caller owns no instance to retry"
        );
        assert!(
            !state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock should be available")
                .contains_key("refused-by-the-engine"),
            "and the engine kept none of it"
        );
        let events = take_teardown_events();
        assert!(
            events.contains(&TeardownEvent::RuntimeTornDown),
            "the refused runtime must actually have been torn down, not leaked"
        );
        assert!(
            engine_free_at_teardown.load(std::sync::atomic::Ordering::SeqCst),
            "a plugin's teardown must not run under the engine lock: the quit \
             cascade takes it from the shell's UI thread"
        );
        assert_eq!(
            event_before_teardown(&events),
            Some(TeardownEvent::RuntimeGateReleased),
            "nor under the runtime gate, which is fair: a quit's write request \
             queued behind this teardown parks every later load and unload, and \
             fails every batch's attach outright. Got: {events:?}"
        );
    }

    /// The editor-support ask is an exit like the refusals, and it holds an
    /// activated plugin when it fails.
    ///
    /// It is the one step between the runtime's construction and its handover
    /// that leaves this thread entirely: the answer for VST3 is a real
    /// `createView`, so the ask crosses to the shell's UI thread and comes back
    /// with an error when that thread cannot take it. Nothing about the plugin
    /// is wrong at that point — it activated — so the load has a live runtime to
    /// tear down, and it owes that teardown the same order every other refusal
    /// owes it.
    #[test]
    fn a_load_whose_editor_ask_never_reached_the_shell_tears_down_off_the_runtime_gate() {
        let state = Arc::new(AppState::default());
        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        publish_scan_results_in_registry(
            &state.plugin_registry,
            &state.plugin_registry_store,
            &[],
            &[],
            true,
            &[scanned("aaaa1111", "com.vendor.reverb", "clap")],
        );

        let engine_free_at_teardown = Arc::new(std::sync::atomic::AtomicBool::new(false));
        take_teardown_events();

        let error = crate::block_on_test(load_plugin_with_backend(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("editor-ask-unanswered".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &UnreachableUiWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                let mut wrapper = ClapWrapper::new_engine_owned_command_fixture(
                    "Editor Ask Unanswered",
                    Vec::new(),
                    true,
                );
                let observed_state = Arc::clone(&state);
                let engine_free = Arc::clone(&engine_free_at_teardown);
                wrapper.observe_engine_owned_command_fixture_teardown(Box::new(move || {
                    note_teardown_event(TeardownEvent::RuntimeTornDown);
                    engine_free.store(
                        observed_state.engine.try_lock().is_ok(),
                        std::sync::atomic::Ordering::SeqCst,
                    );
                }));
                Ok(HostedRuntime::from(wrapper))
            },
        ))
        .expect_err("a load whose editor ask never ran must not report a loaded plugin");

        assert!(
            error.contains("UI thread"),
            "the caller is told the shell never took the ask, got: {error}"
        );
        assert!(
            !state
                .plugins
                .lock()
                .expect("plugins lock should be available")
                .contains_key("editor-ask-unanswered"),
            "a load refused before the handover parks nothing"
        );
        assert!(
            !state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock should be available")
                .contains_key("editor-ask-unanswered"),
            "and hands the engine nothing"
        );
        let events = take_teardown_events();
        assert!(
            events.contains(&TeardownEvent::RuntimeTornDown),
            "the runtime it built must actually have been torn down, not leaked"
        );
        assert!(
            engine_free_at_teardown.load(std::sync::atomic::Ordering::SeqCst),
            "a plugin's teardown must not run under the engine lock: the quit \
             cascade takes it from the shell's UI thread"
        );
        assert_eq!(
            event_before_teardown(&events),
            Some(TeardownEvent::RuntimeGateReleased),
            "nor under the runtime gate, which is fair: a quit's write request \
             queued behind this teardown parks every later load and unload, and \
             fails every batch's attach outright. Got: {events:?}"
        );
    }

    /// The load path installs the host-request wake with no lock of the app's
    /// held.
    ///
    /// Installing one crosses the runtime's access seam, which waits on the
    /// instance's control gate — held across the plugin's own `open_gui` while
    /// an editor opens — and then on the audio thread's claim for as long as the
    /// bounded seam allows. Under `state.engine` that wait is every graph batch,
    /// every transport update and the shell's own quit cascade parked behind a
    /// third party's editor code. The fixture reports what the installing thread
    /// held at the moment it was installed.
    #[test]
    fn a_load_installs_the_host_request_wake_with_the_engine_lock_free() {
        let state = Arc::new(AppState::default());
        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        publish_scan_results_in_registry(
            &state.plugin_registry,
            &state.plugin_registry_store,
            &[],
            &[],
            true,
            &[scanned("aaaa1111", "com.vendor.reverb", "clap")],
        );

        let installs = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let engine_free_at_install = Arc::new(std::sync::atomic::AtomicBool::new(false));

        crate::block_on_test(load_plugin_with_backend(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("wake-installed".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                let mut wrapper =
                    ClapWrapper::new_engine_owned_command_fixture("Wake Loaded", Vec::new(), false);
                let observed_state = Arc::clone(&state);
                let installs = Arc::clone(&installs);
                let engine_free = Arc::clone(&engine_free_at_install);
                wrapper.observe_engine_owned_command_fixture_notifier_install(Box::new(
                    move || {
                        installs.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        engine_free.store(
                            observed_state.engine.try_lock().is_ok(),
                            std::sync::atomic::Ordering::SeqCst,
                        );
                    },
                ));
                Ok(HostedRuntime::from(wrapper))
            },
        ))
        .expect("a load against a running engine must succeed");

        assert_eq!(
            installs.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "an engine-owned instance must carry its own host requests"
        );
        assert!(
            engine_free_at_install.load(std::sync::atomic::Ordering::SeqCst),
            "the wake must be installed with the engine lock free: the wait is \
             the plugin's, and everything behind that lock would wait with it"
        );
    }

    /// A load resolves the registry entry the scan wrote, and an `"instrument"`
    /// category is the one scan answer that must carry through registration as
    /// `Generator`: the engine-owned record this load produces is exactly what
    /// `commands::graph::map_device` reads back when the panel later splices
    /// this instance into a strip, so a dropped kind here is a silenced clip
    /// two modules away.
    #[test]
    fn a_loaded_instrument_registers_its_generator_kind() {
        let state = Arc::new(AppState::default());
        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        publish_scan_results_in_registry(
            &state.plugin_registry,
            &state.plugin_registry_store,
            &[],
            &[],
            true,
            &[ScannedPlugin {
                category: "instrument".to_string(),
                ..scanned("instrument1111", "com.vendor.synth", "clap")
            }],
        );

        crate::block_on_test(load_plugin_with_backend(
            PluginId("instrument1111".to_string()),
            PluginInstanceId("instrument-instance".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                Ok(HostedRuntime::from(
                    ClapWrapper::new_engine_owned_command_fixture(
                        "Synth Fixture",
                        Vec::new(),
                        false,
                    ),
                ))
            },
        ))
        .expect("an instrument load against a running engine must succeed");

        assert_eq!(
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .get("instrument-instance")
                .expect("the load must have registered the instance")
                .chain_kind,
            DeviceKind::Generator,
            "an instrument's registry category must carry through to the engine record"
        );
    }

    /// The dormant-attach path is a second route onto the engine record the
    /// load path above already covers: an instance parked in `state.plugins`
    /// before an engine existed carries its own scanned `chain_kind`, and
    /// `attach_one_dormant_plugin` must carry that through to the engine
    /// record exactly as `register_runtime_with_engine` does for a fresh
    /// load, or a project reopened before the engine started would silence
    /// every instrument it holds the moment it attaches.
    #[test]
    fn a_dormant_instrument_attaches_as_a_generator() {
        let state = Arc::new(AppState::default());
        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Dormant Synth", Vec::new(), false);
        state
            .plugins
            .lock()
            .expect("plugins lock should be available")
            .insert(
                "dormant-instrument".to_string(),
                PluginInstanceData {
                    plugin: HostedRuntime::from(wrapper),
                    name: "Dormant Synth".to_string(),
                    parameters: Vec::new(),
                    has_gui: false,
                    chain_kind: DeviceKind::Generator,
                },
            );

        attach_dormant_plugins(&state, 1).expect("the dormant instance must reach the engine");

        assert_eq!(
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .get("dormant-instrument")
                .expect("the attach must have registered the instance")
                .chain_kind,
            DeviceKind::Generator,
            "a dormant instrument's chain kind must carry through the attach"
        );
    }

    /// And the attach path does the same, for the same reason.
    ///
    /// It is the worse of the two: `apply_graph_commands` holds the graph
    /// registry across this call as well, so an install under the engine lock
    /// here parks the next batch behind a plugin's editor twice over.
    #[test]
    fn an_attach_installs_the_host_request_wake_with_the_engine_lock_free() {
        let state = Arc::new(AppState::default());
        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let installs = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let engine_free_at_install = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let mut wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Wake Attached", Vec::new(), false);
        {
            let observed_state = Arc::clone(&state);
            let installs = Arc::clone(&installs);
            let engine_free = Arc::clone(&engine_free_at_install);
            wrapper.observe_engine_owned_command_fixture_notifier_install(Box::new(move || {
                installs.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                engine_free.store(
                    observed_state.engine.try_lock().is_ok(),
                    std::sync::atomic::Ordering::SeqCst,
                );
            }));
        }

        state
            .plugins
            .lock()
            .expect("plugins lock should be available")
            .insert(
                "wake-attached".to_string(),
                PluginInstanceData {
                    plugin: HostedRuntime::from(wrapper),
                    name: "Wake Attached".to_string(),
                    parameters: Vec::new(),
                    has_gui: false,
                    chain_kind: DeviceKind::Effect,
                },
            );

        let attached =
            attach_dormant_plugins(&state, 1).expect("the dormant instance must reach the engine");

        let taken: Vec<&str> = attached
            .iter()
            .map(|plugin| plugin.instance_id.as_str())
            .collect();
        assert_eq!(
            taken,
            ["wake-attached"],
            "the attach must have taken the dormant instance"
        );
        assert_eq!(
            installs.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "an instance the engine took must carry its own host requests"
        );
        assert!(
            engine_free_at_install.load(std::sync::atomic::Ordering::SeqCst),
            "the wake must be installed with the engine lock free: the wait is \
             the plugin's, and everything behind that lock would wait with it"
        );
    }

    /// The attach takes at most the number of instances its caller reserved
    /// ring slots for, and leaves the rest parked.
    ///
    /// The caller counts the dormant instances before it sends its batch, and
    /// the batch fills the ring it sizes. An instance parked between that count
    /// and this call has no slot behind the batch, so taking it would push onto
    /// a full ring and re-park it anyway — a wasted registration and a wasted
    /// engine id. Left alone, it is counted by the next batch: the roll that
    /// follows a topology within one start sequence.
    #[test]
    fn the_attach_takes_no_more_instances_than_its_caller_reserved_room_for() {
        let state = AppState::default();
        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        for instance_id in ["counted-instance", "parked-after-the-count"] {
            state
                .plugins
                .lock()
                .expect("plugins lock should be available")
                .insert(
                    instance_id.to_string(),
                    crate::state::PluginInstanceData::dormant_fixture(HostedRuntime::from(
                        ClapWrapper::new_engine_owned_command_fixture(
                            "Dormant Fixture",
                            Vec::new(),
                            false,
                        ),
                    )),
                );
        }

        let attached =
            attach_dormant_plugins(&state, 1).expect("the reserved instance must reach the engine");

        assert_eq!(
            attached.len(),
            1,
            "one slot was reserved, so one instance may be taken: {:?}",
            attached
                .iter()
                .map(|plugin| plugin.instance_id.as_str())
                .collect::<Vec<_>>()
        );
        let taken = attached[0].instance_id.clone();
        let left = state
            .plugins
            .lock()
            .expect("plugins lock should be available");
        assert_eq!(
            left.len(),
            1,
            "the instance beyond the reservation stays parked for the next batch"
        );
        assert!(
            !left.contains_key(&taken),
            "and the one still parked is not the one that was taken"
        );
        let engine_plugins = state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available");
        assert!(
            engine_plugins.contains_key(&taken),
            "the engine holds exactly the instance the attach reported"
        );
        assert_eq!(
            engine_plugins.len(),
            1,
            "and nothing else was handed over on the way"
        );
    }

    /// A plugin that never activated is refused with no engine running too,
    /// rather than parked for an attach that can only ever refuse it.
    ///
    /// Nothing re-activates a parked runtime: the flag is written when the
    /// wrapper is built and by the engine-owned latency restart, which a parked
    /// instance never reaches. Parked, it would be picked up by every batch for
    /// the rest of the session — a lifecycle lease, both plugin maps and the
    /// engine lock, taken under the graph registry, on every apply — and refused
    /// each time. The caller is told at the load instead, where it can show the
    /// failure to the musician.
    #[test]
    fn a_load_with_no_engine_refuses_a_plugin_that_never_activated_rather_than_parking_it() {
        let state = Arc::new(AppState::default());
        publish_scan_results_in_registry(
            &state.plugin_registry,
            &state.plugin_registry_store,
            &[],
            &[],
            true,
            &[scanned("aaaa1111", "com.vendor.reverb", "clap")],
        );

        let lease_held_at_teardown = Arc::new(std::sync::atomic::AtomicBool::new(false));
        take_teardown_events();

        let error = crate::block_on_test(load_plugin_with_backend(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("never-activated-dormant".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                let mut wrapper = ClapWrapper::new_engine_owned_command_fixture(
                    "Never Activated",
                    Vec::new(),
                    false,
                );
                wrapper.deactivate_engine_owned_command_fixture();
                let lease_held = Arc::clone(&lease_held_at_teardown);
                wrapper.observe_engine_owned_command_fixture_teardown(Box::new(move || {
                    note_teardown_event(TeardownEvent::RuntimeTornDown);
                    lease_held.store(
                        try_lock_plugin_lifecycle("never-activated-dormant").is_none(),
                        std::sync::atomic::Ordering::SeqCst,
                    );
                }));
                Ok(HostedRuntime::from(wrapper))
            },
        ))
        .expect_err("a plugin that never activated must not load, engine or no engine");

        assert!(
            state
                .engine
                .lock()
                .expect("the engine slot is readable")
                .is_none(),
            "the refusal under test is the one a load takes with no engine running"
        );
        assert!(
            error.contains("failed to activate"),
            "the caller is told what the plugin did, got: {error}"
        );
        assert!(
            !state
                .plugins
                .lock()
                .expect("plugins lock should be available")
                .contains_key("never-activated-dormant"),
            "and nothing is parked: an attach could only refuse it, once per batch, forever"
        );
        let events = take_teardown_events();
        assert!(
            events.contains(&TeardownEvent::RuntimeTornDown),
            "the refused runtime must actually have been torn down, not leaked"
        );
        assert_eq!(
            event_before_teardown(&events),
            Some(TeardownEvent::RuntimeGateReleased),
            "and it must go down with the runtime gate already released: that \
             gate is fair, so a quit's write request queued behind this teardown \
             parks every later load and unload, and fails every batch's attach \
             outright. Got: {events:?}"
        );
        assert!(
            lease_held_at_teardown.load(std::sync::atomic::Ordering::SeqCst),
            "and with the instance's own lease still held: a refusal reaches the \
             musician as a load error they retry on the same device, and a retry \
             that took this lease would call the plugin's entry point on the \
             bundle this teardown is still running deinit_entry and dlclose on"
        );
    }

    /// A load's own sweep may only ever reach a runtime the runtime gate has
    /// already let go of — not one it is still torn down while holding.
    ///
    /// Fixture A is loaded, then unloaded: its runtime lands in
    /// `retired_engine_plugins`, still held by the `AddHostedPlugin`
    /// command this command-capture engine never drained, exactly as a real
    /// scheduler holds it between a queued removal and the audio thread
    /// dropping the slot. Draining the ring is this test's stand-in for that
    /// drop, and it is what makes A reclaimable. Fixture B's load is the next
    /// moment the process asks for that memory: its own success sweeps the
    /// retirement vec, and A's teardown must land only after that load's own
    /// runtime gate guard is gone.
    #[test]
    fn a_load_sweeps_retired_runtimes_only_after_releasing_the_runtime_gate() {
        let state = Arc::new(AppState::default());
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        publish_scan_results_in_registry(
            &state.plugin_registry,
            &state.plugin_registry_store,
            &[],
            &[],
            true,
            &[scanned("aaaa1111", "com.vendor.reverb", "clap")],
        );

        take_teardown_events();

        crate::block_on_test(load_plugin_with_backend(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("fixture-a".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                let mut wrapper =
                    ClapWrapper::new_engine_owned_command_fixture("Fixture A", Vec::new(), false);
                wrapper.observe_engine_owned_command_fixture_teardown(Box::new(|| {
                    note_teardown_event(TeardownEvent::RuntimeTornDown);
                }));
                Ok(HostedRuntime::from(wrapper))
            },
        ))
        .expect("fixture A loads");

        let unload_response = crate::block_on_test(unload_plugin(
            Some(PluginInstanceId("fixture-a".to_string())),
            &NoWindowHost,
            &state,
        ))
        .expect("the unload call itself does not fail");
        assert_eq!(
            unload_response.errors,
            Vec::<String>::new(),
            "fixture A must unload cleanly, or the reclaim below proves nothing"
        );

        // The scheduler's own acknowledgment: draining the ring drops the
        // `AddHostedPlugin` slot that load pushed, which is the only
        // other owner of A's runtime once the maps have forgotten it.
        while command_rx.pop().is_ok() {}

        take_teardown_events();

        crate::block_on_test(load_plugin_with_backend(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("fixture-b".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                Ok(HostedRuntime::from(
                    ClapWrapper::new_engine_owned_command_fixture("Fixture B", Vec::new(), false),
                ))
            },
        ))
        .expect("fixture B loads");

        assert_eq!(
            take_teardown_events(),
            vec![
                TeardownEvent::RuntimeGateReleased,
                TeardownEvent::RuntimeTornDown
            ],
            "B's load must release its own runtime gate guard before sweeping \
             A's retired runtime down"
        );
    }

    /// A keyed unload's own sweep is subject to the identical rule: it may
    /// reach a retired runtime only once the gate guard *this* unload took is
    /// gone, never while `unload_plugin_runtime` is still running under it.
    ///
    /// Fixture A is loaded and unloaded first, but the ring that holds its
    /// last reference is deliberately left undrained until after fixture C
    /// also loads — so C's own load sweeps an empty retirement vec, and A
    /// only becomes reclaimable afterward. That isolates the sweep under
    /// test to C's *unload*: it is the one call whose sweep can still reach
    /// A, and its own runtime gate guard is what must be gone first.
    #[test]
    fn a_keyed_unload_sweeps_retired_runtimes_only_after_releasing_the_runtime_gate() {
        let state = Arc::new(AppState::default());
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        publish_scan_results_in_registry(
            &state.plugin_registry,
            &state.plugin_registry_store,
            &[],
            &[],
            true,
            &[scanned("aaaa1111", "com.vendor.reverb", "clap")],
        );

        take_teardown_events();

        crate::block_on_test(load_plugin_with_backend(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("fixture-a".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                let mut wrapper =
                    ClapWrapper::new_engine_owned_command_fixture("Fixture A", Vec::new(), false);
                wrapper.observe_engine_owned_command_fixture_teardown(Box::new(|| {
                    note_teardown_event(TeardownEvent::RuntimeTornDown);
                }));
                Ok(HostedRuntime::from(wrapper))
            },
        ))
        .expect("fixture A loads");

        crate::block_on_test(unload_plugin(
            Some(PluginInstanceId("fixture-a".to_string())),
            &NoWindowHost,
            &state,
        ))
        .expect("fixture A unloads");

        // A is still held by the queued `AddHostedPlugin` its own load
        // pushed, so it is not reclaimable yet: C's load, next, sweeps a
        // retirement vec it cannot free anything from.
        crate::block_on_test(load_plugin_with_backend(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("fixture-c".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                Ok(HostedRuntime::from(
                    ClapWrapper::new_engine_owned_command_fixture("Fixture C", Vec::new(), false),
                ))
            },
        ))
        .expect("fixture C loads");

        // The scheduler's own acknowledgment, now that both A's removal and
        // C's addition are queued: draining drops both commands' slots, and
        // A becomes reclaimable only at this point.
        while command_rx.pop().is_ok() {}

        take_teardown_events();

        let unload_response = crate::block_on_test(unload_plugin(
            Some(PluginInstanceId("fixture-c".to_string())),
            &NoWindowHost,
            &state,
        ))
        .expect("the unload call itself does not fail");
        assert_eq!(
            unload_response.errors,
            Vec::<String>::new(),
            "fixture C must unload cleanly"
        );

        assert_eq!(
            take_teardown_events(),
            vec![
                TeardownEvent::RuntimeGateReleased,
                TeardownEvent::RuntimeTornDown
            ],
            "C's own unload must release its runtime gate guard before its \
             sweep reaches A's now-reclaimable runtime"
        );
    }

    /// The quit cascade's sweep answers to the same rule on the gate's write
    /// side: `unload_all_plugin_runtimes` holds one write guard across every
    /// instance it tears down, and the single sweep that follows may reach a
    /// retired runtime only once that guard is gone.
    ///
    /// Staged as the keyed case is. Fixture A is loaded and unloaded while the
    /// ring still holds its last reference, so fixture D's load sweeps a
    /// retirement vec it can free nothing from; draining the ring afterward is
    /// what makes A reclaimable, and the cascade is then the one remaining call
    /// whose sweep can reach it.
    #[test]
    fn the_quit_cascade_sweeps_retired_runtimes_only_after_releasing_the_runtime_gate() {
        let state = Arc::new(AppState::default());
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        publish_scan_results_in_registry(
            &state.plugin_registry,
            &state.plugin_registry_store,
            &[],
            &[],
            true,
            &[scanned("aaaa1111", "com.vendor.reverb", "clap")],
        );

        take_teardown_events();

        crate::block_on_test(load_plugin_with_backend(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("fixture-a".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                let mut wrapper =
                    ClapWrapper::new_engine_owned_command_fixture("Fixture A", Vec::new(), false);
                wrapper.observe_engine_owned_command_fixture_teardown(Box::new(|| {
                    note_teardown_event(TeardownEvent::RuntimeTornDown);
                }));
                Ok(HostedRuntime::from(wrapper))
            },
        ))
        .expect("fixture A loads");

        crate::block_on_test(unload_plugin(
            Some(PluginInstanceId("fixture-a".to_string())),
            &NoWindowHost,
            &state,
        ))
        .expect("fixture A unloads");

        // A is still held by the queued `AddHostedPlugin` its own load
        // pushed, so it is not reclaimable yet: D's load, next, sweeps a
        // retirement vec it cannot free anything from.
        crate::block_on_test(load_plugin_with_backend(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("fixture-d".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                Ok(HostedRuntime::from(
                    ClapWrapper::new_engine_owned_command_fixture("Fixture D", Vec::new(), false),
                ))
            },
        ))
        .expect("fixture D loads");

        // The scheduler's own acknowledgment, now that both A's removal and
        // D's addition are queued: draining drops both commands' slots, and
        // A becomes reclaimable only at this point.
        while command_rx.pop().is_ok() {}

        take_teardown_events();

        let cascade_response = crate::block_on_test(unload_plugin(None, &NoWindowHost, &state))
            .expect("the cascade call itself does not fail");
        assert_eq!(
            cascade_response.errors,
            Vec::<String>::new(),
            "fixture D must unload cleanly"
        );

        assert_eq!(
            take_teardown_events(),
            vec![
                TeardownEvent::RuntimeGateReleased,
                TeardownEvent::RuntimeTornDown
            ],
            "the cascade must release its runtime gate write guard before its \
             sweep reaches A's now-reclaimable runtime"
        );
    }

    /// The reservation counts instances the engine took, not instances tried.
    ///
    /// A refusal pushes no command and spends no reserved slot, so an instance
    /// the engine turns down must not cost the one behind it its place. The two
    /// are told apart by attaching in id order with a refusing instance first:
    /// a limit that counted attempts would stop on the refusal and leave the
    /// engine holding nothing, on a batch that reserved room for one.
    #[test]
    fn a_refused_instance_does_not_spend_the_slot_reserved_for_another() {
        let state = AppState::default();
        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        // Sorts first, and never activated, so the attach reaches it first and
        // refuses it.
        let mut refusing =
            ClapWrapper::new_engine_owned_command_fixture("Unactivated Fixture", Vec::new(), false);
        refusing.deactivate_engine_owned_command_fixture();
        let mut plugins = state
            .plugins
            .lock()
            .expect("plugins lock should be available");
        plugins.insert(
            "a-refuses-to-attach".to_string(),
            crate::state::PluginInstanceData::dormant_fixture(HostedRuntime::from(refusing)),
        );
        plugins.insert(
            "b-attaches".to_string(),
            crate::state::PluginInstanceData::dormant_fixture(HostedRuntime::from(
                ClapWrapper::new_engine_owned_command_fixture("Dormant Fixture", Vec::new(), false),
            )),
        );
        drop(plugins);

        let attached = attach_dormant_plugins(&state, 1)
            .expect("a refused instance is that instance's problem, not the attach's");

        let taken: Vec<&str> = attached
            .iter()
            .map(|plugin| plugin.instance_id.as_str())
            .collect();
        assert_eq!(
            taken,
            ["b-attaches"],
            "the refusal ahead of it must not have spent the reserved slot"
        );
        assert!(
            state
                .plugins
                .lock()
                .expect("plugins lock should be available")
                .contains_key("a-refuses-to-attach"),
            "and the refused instance stays parked for a later batch to retry"
        );
        assert!(
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock should be available")
                .contains_key("b-attaches"),
            "the engine holds the instance the attach reported"
        );
    }

    /// The activation rate is the caller's, not this machine's. A plugin is fed
    /// audio the caller's engine rendered, so the device's own preference
    /// decides nothing here — it used to decide everything, and a 44.1 kHz
    /// default device ran every plugin off its own clock.
    #[test]
    fn the_activation_rate_is_the_supplied_engine_rate_and_never_the_devices_own() {
        let device_rate = default_output_sample_rate();
        let engine_rate = device_rate + 1_000.0;

        assert_eq!(engine_activation_sample_rate(engine_rate), Ok(engine_rate));
        assert_ne!(
            engine_activation_sample_rate(engine_rate),
            Ok(device_rate),
            "the device's own rate must not survive as the activation rate"
        );
    }

    /// A rate that is not a rate is refused, and the refusal says which one it
    /// was given. Substituting a default here is the silent guess this seam
    /// exists to remove.
    #[test]
    fn an_engine_rate_that_is_not_a_positive_number_is_refused_by_its_own_value() {
        // Zero renders as the single character "0", which a substring check
        // finds in almost any message — including one that named a different
        // rate entirely. It gets the whole message compared instead.
        assert_eq!(
            engine_activation_sample_rate(0.0).expect_err("0 Hz is not a rate"),
            "Cannot activate a plugin at an engine sample rate of 0: the rate must be a positive number of hertz"
        );

        for rate in [-48_000.0, f64::NAN, f64::INFINITY] {
            let refusal = engine_activation_sample_rate(rate)
                .expect_err("a rate that is not a positive number must refuse");
            assert!(
                refusal.contains(&format!("{rate}")),
                "the refusal must name the rate it was given, got: {refusal}"
            );
        }
    }

    /// The refusal is the load's, not just the predicate's: a load with no
    /// usable rate stops before it resolves a registry entry or reaches a
    /// plugin's entry point. The registry is deliberately left empty — with
    /// the guard unwired this same load fails as "Plugin not found", so the
    /// exact message pins the call site and its position.
    #[test]
    fn load_plugin_refuses_a_non_positive_engine_rate_before_resolving_anything() {
        let state = AppState::default();

        let error = crate::block_on_test(load_plugin(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("rateless-instance".to_string()),
            0.0,
            &NoWindowHost,
            &state,
        ))
        .expect_err("a load with no usable engine rate must refuse");

        assert_eq!(
            error,
            engine_activation_sample_rate(0.0).expect_err("0 Hz is not a rate"),
            "the refusal must be the rate guard's own message, not a later failure"
        );
    }

    /// A divergence between the two rates is a legitimate state — the browser
    /// resamples at the device boundary — but never a silent one. Both numbers
    /// are reported, because either one alone leaves the reader guessing which
    /// side is wrong.
    #[test]
    fn an_engine_rate_that_differs_from_the_devices_is_reported_with_both_numbers() {
        let note = engine_rate_divergence_note(48_000.0, 44_100.0)
            .expect("a divergent pair must be reported");

        assert!(note.contains("48000"), "the engine rate is missing: {note}");
        assert!(note.contains("44100"), "the device rate is missing: {note}");
    }

    /// Nothing is said when there is nothing to say. A note on every load would
    /// bury the one load that matters.
    #[test]
    fn an_engine_rate_matching_the_device_reports_no_divergence() {
        assert_eq!(engine_rate_divergence_note(48_000.0, 48_000.0), None);
    }

    /// Wiring: the ceiling the predicate states is the one the load path
    /// itself enforces, before the plugin library is even constructed. A
    /// session at the ceiling loading a resolvable registry entry must get
    /// the ceiling message — with the call unwired, this same load proceeds
    /// to the library and fails as "Failed to load CLAP plugin at ...", so
    /// the exact message pins the call site.
    #[test]
    fn load_plugin_refuses_at_the_hosted_session_ceiling_before_loading_the_library() {
        let state = AppState::default();
        for index in 0..HOSTED_PLUGIN_RESERVE {
            insert_engine_owned_fixture(&state, &format!("instance-{index}"), Vec::new());
        }
        publish_scan_results_in_registry(
            &state.plugin_registry,
            &state.plugin_registry_store,
            &[],
            &[],
            true,
            &[scanned("aaaa1111", "com.vendor.reverb", "clap")],
        );

        let error = crate::block_on_test(load_plugin(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("over-ceiling-instance".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
        ))
        .expect_err("a load at the hosted session ceiling must refuse");

        assert_eq!(
            error,
            format!(
                "the session hosts its maximum of {HOSTED_PLUGIN_RESERVE} native plugin instances"
            ),
            "the refusal must be the ceiling's own message, not a later failure"
        );
    }

    /// A shell whose UI thread never takes an editor lend — what the real
    /// seam's deadline produces when the shell is gone or stuck. Standing in
    /// for the give-up rather than reproducing its wait, because a host that
    /// hangs proves nothing about what broke.
    struct LendRefusingWindowHost;

    impl UiThread for LendRefusingWindowHost {
        fn is_ui_thread(&self) -> bool {
            false
        }

        fn run_on_ui_thread(&self, _task: &Arc<UiThreadTask>) -> Result<(), String> {
            Err("the shell's UI thread did not take the editor call".to_string())
        }
    }

    impl PluginWindowHost for LendRefusingWindowHost {
        fn window_exists(&self, _label: &str) -> bool {
            false
        }

        fn create_editor_window(
            &self,
            _label: &str,
            _title: &str,
            _instance_id: &str,
        ) -> Result<Box<dyn PluginEditorWindow>, String> {
            Err("This host cannot create plugin editor windows".to_string())
        }

        fn destroy_window(&self, _label: &str) {}
        fn hide_window(&self, _label: &str) {}
        fn show_window(&self, _label: &str) {}
    }

    /// A plugin that records the thread its editor support was asked on. The
    /// real VST3 backend's ask is a `createView` — the format has no other
    /// "has an editor" query — so this stands in for exactly the call the load
    /// path must not make on its own worker.
    struct EditorSupportThreadPlugin {
        offered: bool,
        asked_on: Arc<Mutex<Vec<std::thread::ThreadId>>>,
    }

    impl AudioPlugin for EditorSupportThreadPlugin {
        fn has_gui(&self) -> bool {
            self.asked_on
                .lock()
                .expect("asked-on log")
                .push(std::thread::current().id());
            self.offered
        }

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

    /// The editor-support helper's own contract, apart from any load: the ask
    /// is an editor call for VST3 — a real `createView` before any window
    /// exists — so it has to reach the plugin on the shell's UI thread like the
    /// open it precedes, not on the worker that took it. Both answers cross: a
    /// plugin that offers an editor and one that does not must keep their own
    /// answer through the hop.
    #[test]
    fn editor_support_keeps_the_plugins_answer_across_the_thread_hop() {
        for offered in [true, false] {
            let asked_on = Arc::new(Mutex::new(Vec::new()));
            let mut plugin = EditorSupportThreadPlugin {
                offered,
                asked_on: Arc::clone(&asked_on),
            };
            let windows = DedicatedUiWindowHost::start();

            let answer = editor_support_on_ui_thread(&windows, &mut plugin)
                .expect("the ask must be answered");

            assert_eq!(
                answer, offered,
                "the plugin's own answer must survive the hop, whatever it is"
            );
            assert_eq!(
                *asked_on.lock().expect("asked-on log"),
                [windows.thread_id],
                "the editor-support ask must reach the plugin on the shell's thread and nowhere \
                 else"
            );
            assert_ne!(
                windows.thread_id,
                std::thread::current().id(),
                "the fake shell thread must not be this one, or this test proves nothing"
            );
        }
    }

    /// The registry row the load-path tests resolve. The format is `clap`
    /// because the runtime they inject is a CLAP fixture; nothing else in the
    /// row reaches the plugin, whose construction the test replaces.
    fn register_editor_support_fixture(state: &AppState) {
        state
            .plugin_registry
            .lock()
            .expect("plugin registry lock should be available")
            .insert(
                "editor-support-fixture".to_string(),
                PluginRegistryEntry {
                    path: "/plugins/editor-support-fixture.clap".to_string(),
                    stable_id: "editor-support-fixture".to_string(),
                    descriptor_id: "com.sourdaw.editor-support-fixture".to_string(),
                    format: "clap".to_string(),
                    name: "Editor Support Fixture".to_string(),
                    num_inputs: 2,
                    num_outputs: 2,
                    has_custom_ui: true,
                    capability_metadata_reason: None,
                    chain_kind: DeviceKind::Effect,
                },
            );
    }

    /// The load path's own routing, one level deeper than the helper test
    /// above: the ask has to cross inside the real `load_plugin`, from the
    /// worker that took the load, against a runtime the load itself
    /// constructed. The fixture records the thread its support was asked on,
    /// so the assertion is the plugin's own observation of its caller.
    #[test]
    fn loading_a_plugin_asks_its_editor_support_on_the_shells_ui_thread() {
        let state = AppState::default();
        register_editor_support_fixture(&state);
        let wrapper = ClapWrapper::new_engine_owned_command_fixture(
            "Editor Support Fixture",
            Vec::new(),
            true,
        );
        let asked_on = wrapper
            .engine_owned_command_fixture_editor_support_threads()
            .expect("the command fixture records its editor-support asks");
        let runtime_slot = Arc::new(Mutex::new(Some(HostedRuntime::from(wrapper))));
        let slot = Arc::clone(&runtime_slot);
        let windows = DedicatedUiWindowHost::start();

        let instance = crate::block_on_test(load_plugin_with_backend(
            PluginId("editor-support-fixture".to_string()),
            PluginInstanceId("editor-support-instance".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &windows,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                slot.lock()
                    .expect("fixture runtime slot")
                    .take()
                    .ok_or_else(|| "the fixture runtime is single-use".to_string())
            },
        ))
        .expect("the fixture plugin should load");

        assert_ne!(
            windows.thread_id,
            std::thread::current().id(),
            "the fake shell thread must not be this one, or this test proves nothing"
        );
        assert_eq!(
            instance.name, "Editor Support Fixture",
            "the loaded instance must be the fixture the load constructed"
        );
        assert!(
            state
                .plugins
                .lock()
                .expect("plugins lock")
                .contains_key("editor-support-instance"),
            "a load with no engine behind it keeps its plugin in the command-owned map"
        );
        assert_eq!(
            *asked_on.lock().expect("editor-support ask log"),
            [windows.thread_id],
            "the load's editor-support ask must reach the plugin on the shell's thread and \
             nowhere else"
        );
    }

    /// A shell whose UI thread cannot take the lend — the give-up the real
    /// seam's deadline produces. Swallowing it (`.unwrap_or(false)`) would
    /// report a successful load whose plugin has its GUI permanently hidden,
    /// so the load must refuse with the lend's own failure and leave no
    /// instance behind.
    #[test]
    fn a_load_whose_editor_support_lend_never_lands_refuses_the_plugin() {
        let state = AppState::default();
        register_editor_support_fixture(&state);
        let wrapper = ClapWrapper::new_engine_owned_command_fixture(
            "Editor Support Fixture",
            Vec::new(),
            true,
        );
        let asked_on = wrapper
            .engine_owned_command_fixture_editor_support_threads()
            .expect("the command fixture records its editor-support asks");
        let runtime_slot = Arc::new(Mutex::new(Some(HostedRuntime::from(wrapper))));
        let slot = Arc::clone(&runtime_slot);

        let error = crate::block_on_test(load_plugin_with_backend(
            PluginId("editor-support-fixture".to_string()),
            PluginInstanceId("lend-refused-instance".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &LendRefusingWindowHost,
            &state,
            |_backend, _path, _descriptor_id, _sample_rate| {
                slot.lock()
                    .expect("fixture runtime slot")
                    .take()
                    .ok_or_else(|| "the fixture runtime is single-use".to_string())
            },
        ))
        .expect_err("a load whose editor-support lend fails must refuse");

        assert_eq!(
            error, "the shell's UI thread did not take the editor call",
            "the refusal must be the lend's own failure, not a later one"
        );
        assert!(
            asked_on.lock().expect("editor-support ask log").is_empty(),
            "a lend that never landed must not have reached the plugin either"
        );
        assert!(
            !state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .contains_key("lend-refused-instance")
                && !state
                    .plugins
                    .lock()
                    .expect("plugins lock")
                    .contains_key("lend-refused-instance"),
            "a refused load must leave no instance behind"
        );
    }

    /// An empty descriptor id used to be replaced by the display name, which is
    /// not a CLAP id: the load failed later, blaming the plugin's own entry
    /// point for an id this host invented.
    #[test]
    fn load_plugin_refuses_a_clap_entry_with_no_descriptor_id() {
        let state = AppState::default();
        state
            .plugin_registry
            .lock()
            .expect("plugin registry lock should be available")
            .insert(
                "clap-without-descriptor-id".to_string(),
                PluginRegistryEntry {
                    path: "/plugins/no-descriptor-id.clap".to_string(),
                    stable_id: "clap-without-descriptor-id".to_string(),
                    descriptor_id: String::new(),
                    format: "clap".to_string(),
                    name: "Nameless".to_string(),
                    num_inputs: 2,
                    num_outputs: 2,
                    has_custom_ui: false,
                    capability_metadata_reason: None,
                    chain_kind: DeviceKind::Effect,
                },
            );

        let result = crate::block_on_test(load_plugin(
            PluginId("clap-without-descriptor-id".to_string()),
            PluginInstanceId("clap-instance".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
        ));

        let error = result.expect_err("a registry entry with no CLAP id must not load");
        // Exact, because the substitute id produced a library-load failure that
        // also named the file: only the refusal's own wording distinguishes
        // "this entry carries no CLAP id" from "the file would not load".
        assert_eq!(
            error,
            "CLAP plugin /plugins/no-descriptor-id.clap reports no descriptor id in the registry \
             entry for clap-without-descriptor-id. Rescan the plugin directory."
        );
        assert!(
            !state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .contains_key("clap-instance")
                && !state
                    .plugins
                    .lock()
                    .expect("plugins lock")
                    .contains_key("clap-instance"),
            "a refused load must leave no instance behind"
        );
    }

    #[test]
    fn scan_plugins_rejects_arbitrary_renderer_raw_path_without_grant() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let state = AppState::default();
        let scan_root = unique_temp_scan_root("raw-plugin-scan-path");
        std::fs::create_dir_all(&scan_root).expect("temp scan root should be created");

        let result = crate::block_on_test(scan_plugins(
            vec![scan_root.display().to_string()],
            false,
            &state,
        ))
        .expect("scan command should return policy errors in-band");
        let _ = std::fs::remove_dir_all(&scan_root);

        assert!(result.plugins.is_empty());
        assert!(
            result
                .errors
                .iter()
                .any(|error| error.contains("Unauthorized plugin scan path")),
            "errors should reject the raw renderer path: {:?}",
            result.errors
        );

        let registry = state
            .plugin_registry
            .lock()
            .expect("plugin registry lock should be available");
        assert!(registry.is_empty());
    }

    /// A real temporary directory, resolved. The system temp directory reaches
    /// these tests through `/var`, which is a symlink on macOS — and the scan
    /// policy refuses any path with a symlink component, so an unresolved temp
    /// root is refused before the ordering it is meant to exercise is reached.
    fn created_temp_scan_root(test_name: &str) -> PathBuf {
        let root = unique_temp_scan_root(test_name);
        std::fs::create_dir_all(&root).expect("temp scan root should be created");
        std::fs::canonicalize(&root).expect("a directory that was just created resolves")
    }

    /// AC-001: a candidate already quarantined must not be handed to a scan
    /// helper on an ordinary scan — proven here by the absence of any error
    /// naming it, since a spawned helper reading this garbage file would
    /// produce one — and the scan response must still name it, not drop it
    /// silently.
    #[test]
    fn a_quarantined_candidate_is_skipped_and_still_named_in_the_response() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("quarantine-skip");
        let plugin_path = root.join("Hostile.clap");
        std::fs::write(&plugin_path, b"not a real clap bundle")
            .expect("fixture plugin file should be written");
        let policy = PluginScanPolicy::with_allowed_roots(vec![root.clone()]);

        let state = AppState::default();
        state.plugin_registry_store.quarantine_failure(
            &plugin_path,
            "Plugin scan helper exited unsuccessfully for Hostile.clap".to_string(),
            1_700_000_000_000,
        );

        let result = crate::block_on_test(scan_plugins_with_policy(
            vec![root.display().to_string()],
            false,
            policy,
            &state,
        ))
        .expect("a default scan over an authorized root should succeed");
        let _ = std::fs::remove_dir_all(&root);

        assert!(
            result.plugins.is_empty(),
            "a quarantined candidate must not be scanned: {:?}",
            result.plugins
        );
        assert!(
            !result
                .errors
                .iter()
                .any(|error| error.contains("Hostile.clap")),
            "a skipped candidate must not spawn a helper, which would have produced its own \
             error for this unparseable fixture: {:?}",
            result.errors
        );
        let quarantined = result
            .quarantined
            .iter()
            .find(|entry| entry.path == plugin_path.display().to_string())
            .expect("the scan response must name the quarantined binary, not drop it silently");
        assert_eq!(
            quarantined.reason,
            "Plugin scan helper exited unsuccessfully for Hostile.clap"
        );
    }

    /// AC-002: a retry clears the record before the helper runs, rather than
    /// leaving the skip in place. Proven two ways: an error appears for the
    /// path — a skipped candidate never reaches the helper, so never produces
    /// one — and the seeded sentinel timestamp is gone, which only happens if
    /// the old record was cleared before this run's own attempt (the fixture
    /// is not a real CLAP bundle, so the helper fails again and the run's own
    /// failure, dated to now rather than to the sentinel, replaces it).
    #[test]
    fn retrying_quarantined_clears_the_record_before_the_helper_runs() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("quarantine-retry");
        let plugin_path = root.join("Recovering.clap");
        std::fs::write(&plugin_path, b"not a real clap bundle")
            .expect("fixture plugin file should be written");
        let policy = PluginScanPolicy::with_allowed_roots(vec![root.clone()]);

        let state = AppState::default();
        const SEEDED_SENTINEL_TIMESTAMP: u64 = 1;
        state.plugin_registry_store.quarantine_failure(
            &plugin_path,
            "Plugin scan helper timed out".to_string(),
            SEEDED_SENTINEL_TIMESTAMP,
        );

        let result = crate::block_on_test(scan_plugins_with_policy(
            vec![root.display().to_string()],
            true,
            policy,
            &state,
        ))
        .expect("a retry scan over an authorized root should succeed");
        let _ = std::fs::remove_dir_all(&root);

        assert!(
            result
                .errors
                .iter()
                .any(|error| error.contains("Recovering.clap")),
            "a retried candidate must actually reach the helper, not stay skipped: {:?}",
            result.errors
        );
        if let Some(entry) = result
            .quarantined
            .iter()
            .find(|entry| entry.path == plugin_path.display().to_string())
        {
            assert_ne!(
                entry.quarantined_at_ms, SEEDED_SENTINEL_TIMESTAMP,
                "a record surviving the retry must be this run's own failure, not the \
                 pre-retry record left untouched"
            );
        }
    }

    fn fake_successful_descriptor_scan(
        _format: PluginFormat,
        _path: &Path,
        _timeout: Duration,
    ) -> Result<Vec<ScannedDescriptor>, String> {
        Ok(vec![descriptor("com.vendor.recovered")])
    }

    fn fake_successful_instance_scan(
        _format: PluginFormat,
        _path: &Path,
        _plugin_id: &str,
        _timeout: Duration,
    ) -> Result<ScannedInstance, String> {
        Ok(scanner::ScannedInstance::default())
    }

    /// The regression the existing retry test cannot see: it only proves the
    /// helper *ran*, not that a *successful* retry actually leaves the
    /// candidate un-quarantined. A retry whose helper fixes nothing and one
    /// whose helper genuinely succeeds both need the pre-retry record gone —
    /// this covers the success case by injecting a scan outcome instead of
    /// spawning a real worker process, the way
    /// `an_activation_miss_rescans_the_last_known_path_once` injects a rescan
    /// outcome.
    #[test]
    fn retrying_quarantined_clears_the_record_when_the_helper_succeeds() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("quarantine-retry-success");
        let plugin_path = root.join("Recovered.clap");
        std::fs::write(&plugin_path, b"clap-bytes").expect("fixture plugin file should be written");
        let policy = PluginScanPolicy::with_allowed_roots(vec![root.clone()]);

        let state = AppState::default();
        state.plugin_registry_store.quarantine_failure(
            &plugin_path,
            "Plugin scan helper timed out".to_string(),
            1,
        );

        let result = crate::block_on_test(scan_plugins_with_backend(
            vec![root.display().to_string()],
            true,
            policy,
            PRODUCTION_SCAN_BUDGET,
            &state,
            fake_successful_descriptor_scan,
            fake_successful_instance_scan,
        ))
        .expect("a retry scan whose helper succeeds should succeed");
        let _ = std::fs::remove_dir_all(&root);

        assert!(
            !result.plugins.is_empty(),
            "the injected success must actually publish a plugin: {:?}",
            result.plugins
        );
        assert!(
            result.complete,
            "a walk that reached every candidate is authoritative for the whole root"
        );
        assert_eq!(
            result.scanned_paths,
            vec![plugin_path.display().to_string()],
            "a complete walk names every candidate it reached"
        );
        assert!(
            state
                .plugin_registry_store
                .is_quarantined(&plugin_path)
                .is_none(),
            "a fixed plugin must not keep its quarantine badge after a successful retry"
        );
        assert!(
            result
                .quarantined
                .iter()
                .all(|entry| entry.path != plugin_path.display().to_string()),
            "the scan response must not still name a candidate the retry just cleared: {:?}",
            result.quarantined
        );
    }

    /// Every call one fake scan backend saw: the candidate it was asked
    /// about, and the bound the walk handed it.
    type ScanCallLog = Arc<Mutex<Vec<(PathBuf, Duration)>>>;

    fn scan_call_log() -> ScanCallLog {
        Arc::new(Mutex::new(Vec::new()))
    }

    fn record_scan_call(log: &ScanCallLog, path: &Path, timeout: Duration) {
        log.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push((path.to_path_buf(), timeout));
    }

    fn scan_calls_for(log: &ScanCallLog, path: &Path) -> usize {
        log.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|(called_path, _)| called_path == path)
            .count()
    }

    fn recorded_scan_timeouts(log: &ScanCallLog) -> Vec<Duration> {
        log.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .map(|(_, timeout)| *timeout)
            .collect()
    }

    fn time_limit_errors(errors: &[String]) -> usize {
        errors
            .iter()
            .filter(|error| error.as_str() == "Plugin scan time limit exceeded")
            .count()
    }

    /// A walk that runs out of its budget answers with what it found. The
    /// failure used to replace the whole result, so every plugin already
    /// scanned — and already published into the registry — was withheld from
    /// the caller, who saw an error and an empty list (#3505). A safety limit
    /// reached is reported beside the list, never in front of it (ADR 0031).
    #[test]
    fn an_incomplete_walk_returns_the_plugins_it_found_beside_the_limit_error() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("incomplete-walk-partial-results");
        let first = root.join("A-First.clap");
        let second = root.join("B-Second.clap");
        std::fs::write(&first, b"clap-bytes").expect("fixture plugin file should be written");
        std::fs::write(&second, b"clap-bytes").expect("fixture plugin file should be written");
        let policy = PluginScanPolicy::with_allowed_roots(vec![root.clone()]);
        let budget = ScanBudget {
            walk: Duration::from_millis(300),
            candidate: Duration::from_millis(100),
        };

        let descriptor_calls = scan_call_log();
        let descriptor_log = Arc::clone(&descriptor_calls);
        let state = AppState::default();

        let result = crate::block_on_test(scan_plugins_with_backend(
            vec![root.display().to_string()],
            false,
            policy,
            budget,
            &state,
            move |_format, path, timeout| {
                record_scan_call(&descriptor_log, path, timeout);
                // Outlasts the walk, so the second candidate is reached with
                // the budget already spent.
                std::thread::sleep(Duration::from_millis(350));
                Ok(vec![descriptor("com.vendor.found-before-the-limit")])
            },
            fake_successful_instance_scan,
        ))
        .expect("a walk cut short must still answer with the plugins it found");
        let _ = std::fs::remove_dir_all(&root);

        let found: Vec<&str> = result
            .plugins
            .iter()
            .map(|plugin| plugin.descriptor_id.as_str())
            .collect();
        assert_eq!(
            found,
            vec!["com.vendor.found-before-the-limit"],
            "the plugin scanned before the limit must reach the caller, and the candidate the \
             walk never started must not"
        );
        assert_eq!(
            time_limit_errors(&result.errors),
            1,
            "the limit belongs on the failures channel, exactly once: {:?}",
            result.errors
        );
        assert!(
            !result.complete,
            "a walk that stopped at its limit must say so, or the caller cannot tell how far \
             this result reaches"
        );
        assert_eq!(
            result.scanned_paths,
            vec![first.display().to_string()],
            "the result is authoritative for the candidates the walk reached, and no others"
        );
        assert_eq!(scan_calls_for(&descriptor_calls, &first), 1);
        assert_eq!(
            scan_calls_for(&descriptor_calls, &second),
            0,
            "a candidate the walk had no budget for must never reach a helper"
        );
        assert!(
            state
                .plugin_registry_store
                .is_quarantined(&second)
                .is_none(),
            "a candidate the walk never started must not be blamed for the walk's own budget"
        );
        let registry = state
            .plugin_registry
            .lock()
            .expect("plugin registry lock should be available");
        assert!(
            registry
                .values()
                .any(|entry| entry.path == first.display().to_string()),
            "publication into the registry must happen for an incomplete walk too: {:?}",
            registry.keys().collect::<Vec<_>>()
        );
    }

    /// A candidate is handed its whole budget or is not started. Handing it
    /// the walk's leftover killed it early and quarantined it for a timeout
    /// the walk caused, which is a permanent record against a plugin that was
    /// never given its own bound (#3505).
    #[test]
    fn a_candidate_is_never_started_with_a_truncated_budget() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("whole-candidate-budget");
        let first = root.join("A-First.clap");
        let second = root.join("B-Second.clap");
        std::fs::write(&first, b"clap-bytes").expect("fixture plugin file should be written");
        std::fs::write(&second, b"clap-bytes").expect("fixture plugin file should be written");
        let policy = PluginScanPolicy::with_allowed_roots(vec![root.clone()]);
        let budget = ScanBudget {
            walk: Duration::from_millis(400),
            candidate: Duration::from_millis(100),
        };

        let descriptor_calls = scan_call_log();
        let instance_calls = scan_call_log();
        let descriptor_log = Arc::clone(&descriptor_calls);
        let instance_log = Arc::clone(&instance_calls);
        let state = AppState::default();

        let result = crate::block_on_test(scan_plugins_with_backend(
            vec![root.display().to_string()],
            false,
            policy,
            budget,
            &state,
            move |_format, path, timeout| {
                record_scan_call(&descriptor_log, path, timeout);
                std::thread::sleep(Duration::from_millis(50));
                Ok(vec![descriptor("com.vendor.first")])
            },
            move |_format, path, _plugin_id, timeout| {
                record_scan_call(&instance_log, path, timeout);
                // Leaves the walk with less than a whole candidate budget, so
                // the second candidate is reached with a truncated one on
                // offer.
                std::thread::sleep(Duration::from_millis(320));
                Ok(scanner::ScannedInstance::default())
            },
        ))
        .expect("a walk cut short must still answer with the plugins it found");
        let _ = std::fs::remove_dir_all(&root);

        let handed_out: Vec<Duration> = recorded_scan_timeouts(&descriptor_calls)
            .into_iter()
            .chain(recorded_scan_timeouts(&instance_calls))
            .collect();
        assert!(
            !handed_out.is_empty()
                && handed_out
                    .iter()
                    .all(|timeout| *timeout == budget.candidate),
            "every started pass must get the whole per-candidate budget: {handed_out:?}"
        );
        assert_eq!(scan_calls_for(&descriptor_calls, &first), 1);
        assert_eq!(scan_calls_for(&instance_calls, &first), 1);
        assert_eq!(
            scan_calls_for(&descriptor_calls, &second),
            0,
            "a candidate that cannot be given its whole budget must not be started"
        );
        assert!(
            state
                .plugin_registry_store
                .is_quarantined(&second)
                .is_none(),
            "the skipped candidate must carry no quarantine record"
        );
        assert_eq!(
            time_limit_errors(&result.errors),
            1,
            "the skip belongs on the failures channel: {:?}",
            result.errors
        );
    }

    /// The instance pass obeys the same rule inside a bundle: near the
    /// deadline it is skipped, not truncated. A truncated instance helper
    /// reports a timeout, and `quarantine_if_process_failure` cannot tell that
    /// from a plugin that hangs on `create_plugin`.
    #[test]
    fn an_instance_pass_is_skipped_rather_than_truncated_near_the_deadline() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("instance-pass-skipped-near-deadline");
        let bundle_path = root.join("Bundle.clap");
        std::fs::write(&bundle_path, b"clap-bytes").expect("fixture plugin file should be written");
        let policy = PluginScanPolicy::with_allowed_roots(vec![root.clone()]);
        let budget = ScanBudget {
            walk: Duration::from_millis(300),
            candidate: Duration::from_millis(100),
        };

        let instance_calls = scan_call_log();
        let instance_log = Arc::clone(&instance_calls);
        let state = AppState::default();

        let result = crate::block_on_test(scan_plugins_with_backend(
            vec![root.display().to_string()],
            false,
            policy,
            budget,
            &state,
            |_format, _path, _timeout| {
                // Spends most of the walk, so neither of the two plugins this
                // bundle declares can be given a whole instance budget.
                std::thread::sleep(Duration::from_millis(250));
                Ok(vec![
                    descriptor("com.vendor.bundle-one"),
                    descriptor("com.vendor.bundle-two"),
                ])
            },
            move |_format, path, _plugin_id, timeout| {
                record_scan_call(&instance_log, path, timeout);
                Ok(scanner::ScannedInstance::default())
            },
        ))
        .expect("a bundle whose instance passes are skipped is still a published bundle");
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(
            scan_calls_for(&instance_calls, &bundle_path),
            0,
            "an instance pass with less than a whole budget left must not be started"
        );
        assert_eq!(
            result.plugins.len(),
            2,
            "both plugins the bundle declares stay published: {:?}",
            result.plugins
        );
        assert!(
            result
                .plugins
                .iter()
                .all(|plugin| plugin.path == bundle_path.display().to_string()
                    && plugin.parameter_metadata_reason.as_deref()
                        == Some(scanner::PARAMETER_METADATA_UNAVAILABLE_REASON)),
            "a row whose instance pass never ran must say why its parameters are missing: {:?}",
            result.plugins
        );
        assert!(
            state
                .plugin_registry_store
                .is_quarantined(&bundle_path)
                .is_none(),
            "running out of walk budget is not evidence against the binary"
        );
    }

    // ── Reuse of unchanged rows: a scan re-inspects what changed ────────────

    /// A budget no fake backend can exhaust, so a reuse test observes reuse
    /// rather than a walk running out of time.
    const UNCONSTRAINED_SCAN_BUDGET: ScanBudget = ScanBudget {
        walk: Duration::from_secs(30),
        candidate: Duration::from_millis(100),
    };

    /// App state whose registry store is a real file, so a second scan in one
    /// test meets the rows the first scan persisted. `AppState::default` is
    /// deliberately file-less and can carry nothing between scans.
    fn state_with_registry_file(root: &Path) -> AppState {
        AppState {
            plugin_registry_store: Arc::new(PluginRegistryStore::at(
                root.join("plugin-registry.json"),
            )),
            ..AppState::default()
        }
    }

    /// The row a scanned VST3 bundle produces, as far as the module resolver
    /// reads it: the bundle path and the format. Nothing else about a row
    /// decides where its binary lives.
    fn vst3_bundle_row(bundle: &Path) -> ScannedPlugin {
        ScannedPlugin {
            id: scanner::stable_id(bundle),
            name: "Vendor Reverb".to_string(),
            vendor: "Vendor".to_string(),
            format: "vst3".to_string(),
            category: "effect".to_string(),
            path: bundle.display().to_string(),
            version: "1.0.0".to_string(),
            descriptor_id: "com.vendor.bundled".to_string(),
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 0,
            has_custom_ui: true,
            parameters: Some(Vec::new()),
            parameter_metadata_reason: None,
            capability_metadata_reason: None,
        }
    }

    /// A descriptor whose identity is the file's own stem, so two fixture
    /// plugins are two identities and neither deduplicates the other away.
    fn descriptor_for(path: &Path) -> scanner::ScannedDescriptor {
        let stem = path
            .file_stem()
            .expect("a fixture plugin file has a stem")
            .to_string_lossy();
        descriptor(&format!("com.vendor.{stem}"))
    }

    /// A descriptor backend that records every call and answers from the path.
    fn recording_descriptor_scan(
        log: ScanCallLog,
    ) -> impl Fn(PluginFormat, &Path, Duration) -> Result<Vec<ScannedDescriptor>, String> + Send + 'static
    {
        move |_format, path, timeout| {
            record_scan_call(&log, path, timeout);
            Ok(vec![descriptor_for(path)])
        }
    }

    /// An instance backend that records every call and answers successfully,
    /// which is what makes a row eligible for reuse.
    fn recording_instance_scan(
        log: ScanCallLog,
    ) -> impl Fn(PluginFormat, &Path, &str, Duration) -> Result<ScannedInstance, String> + Send + 'static
    {
        move |_format, path, _plugin_id, timeout| {
            record_scan_call(&log, path, timeout);
            Ok(ScannedInstance::default())
        }
    }

    fn scan_fixture_root(
        root: &Path,
        retry_quarantined: bool,
        state: &AppState,
        descriptor_calls: &ScanCallLog,
        instance_calls: &ScanCallLog,
    ) -> ScanResult {
        crate::block_on_test(scan_plugins_with_backend(
            vec![root.display().to_string()],
            retry_quarantined,
            PluginScanPolicy::with_allowed_roots(vec![root.to_path_buf()]),
            UNCONSTRAINED_SCAN_BUDGET,
            state,
            recording_descriptor_scan(Arc::clone(descriptor_calls)),
            recording_instance_scan(Arc::clone(instance_calls)),
        ))
        .expect("a scan over an authorized fixture root should succeed")
    }

    /// The defect (#3505): every scan spawned a descriptor helper and an
    /// instance helper for every candidate, so a settled plugin folder paid the
    /// whole per-candidate cost again on every run and a large one could not
    /// finish inside the walk's budget at all. A DAW rescans what is new or
    /// changed.
    ///
    /// Mutation this catches: removing the `reusable_rows` branch from the
    /// candidate loop makes the second scan's call counts non-zero; publishing
    /// anything but the persisted row verbatim, or publishing the rows of one
    /// file out of their recorded order, fails the field-for-field equality.
    #[test]
    fn a_second_scan_of_unchanged_files_spawns_no_helper_and_republishes_the_same_rows() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("reuse-unchanged");
        let first_plugin = root.join("A-First.clap");
        let second_plugin = root.join("B-Second.clap");
        std::fs::write(&first_plugin, b"clap-bytes").expect("fixture plugin should be written");
        std::fs::write(&second_plugin, b"clap-bytes").expect("fixture plugin should be written");
        let state = state_with_registry_file(&root);

        let first_scan =
            scan_fixture_root(&root, false, &state, &scan_call_log(), &scan_call_log());

        let descriptor_calls = scan_call_log();
        let instance_calls = scan_call_log();
        let second_scan =
            scan_fixture_root(&root, false, &state, &descriptor_calls, &instance_calls);
        let _ = std::fs::remove_dir_all(&root);

        for path in [&first_plugin, &second_plugin] {
            assert_eq!(
                scan_calls_for(&descriptor_calls, path),
                0,
                "an unchanged candidate must not be handed to a descriptor helper again: {}",
                path.display()
            );
            assert_eq!(
                scan_calls_for(&instance_calls, path),
                0,
                "an unchanged candidate must not be handed to an instance helper again: {}",
                path.display()
            );
        }
        assert_eq!(
            first_scan.plugins.len(),
            2,
            "the fixture must produce a row for each of its two files: {:?}",
            first_scan.plugins
        );
        assert_eq!(
            serde_json::to_value(&second_scan.plugins).expect("scanned rows should serialize"),
            serde_json::to_value(&first_scan.plugins).expect("scanned rows should serialize"),
            "a reused row is the row the previous scan published, field for field and in order"
        );
    }

    /// The fingerprint is what separates "already scanned" from "unchanged": a
    /// plugin updated in place keeps its path, so reuse keyed on the path alone
    /// would pin the old version's metadata until the user reinstalled
    /// elsewhere.
    ///
    /// Mutation this catches: dropping the fingerprint check from
    /// `reusable_rows` leaves the changed file's call count at zero and its
    /// name at the first scan's.
    #[test]
    fn a_candidate_whose_file_changed_is_rescanned_and_its_row_replaced() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("reuse-changed-file");
        let unchanged = root.join("A-Unchanged.clap");
        let updated = root.join("B-Updated.clap");
        std::fs::write(&unchanged, b"clap-bytes").expect("fixture plugin should be written");
        std::fs::write(&updated, b"clap-bytes").expect("fixture plugin should be written");
        let state = state_with_registry_file(&root);

        scan_fixture_root(&root, false, &state, &scan_call_log(), &scan_call_log());
        std::fs::write(&updated, b"clap-bytes-version-2")
            .expect("the plugin should be updated in place");

        let descriptor_calls = scan_call_log();
        let updated_path = updated.clone();
        let descriptor_log = Arc::clone(&descriptor_calls);
        let second_scan = crate::block_on_test(scan_plugins_with_backend(
            vec![root.display().to_string()],
            false,
            PluginScanPolicy::with_allowed_roots(vec![root.clone()]),
            UNCONSTRAINED_SCAN_BUDGET,
            &state,
            move |_format, path, timeout| {
                record_scan_call(&descriptor_log, path, timeout);
                let mut answered = descriptor_for(path);
                if path == updated_path {
                    answered.name = Some("Second Edition".to_string());
                }
                Ok(vec![answered])
            },
            recording_instance_scan(scan_call_log()),
        ))
        .expect("a scan over an authorized fixture root should succeed");
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(
            scan_calls_for(&descriptor_calls, &updated),
            1,
            "a file whose bytes changed since the scan must be read again"
        );
        assert_eq!(
            scan_calls_for(&descriptor_calls, &unchanged),
            0,
            "the file that did not change must still be reused"
        );
        let updated_row = second_scan
            .plugins
            .iter()
            .find(|plugin| plugin.path == updated.display().to_string())
            .expect("the rescanned file must be in the result");
        assert_eq!(
            updated_row.name, "Second Edition",
            "the rescan's row replaces the stale one rather than standing beside it"
        );
    }

    /// Reuse has to converge on a complete answer, not freeze an incomplete
    /// one. A row whose instance inspection was refused knows less about the
    /// plugin than a scan can learn, so leaving the file alone must not stop
    /// the next scan from asking again.
    ///
    /// Mutation this catches: dropping the `instance_inspection_answered` test
    /// from `reusable_rows` reuses the refused row, leaving the call count at
    /// zero and the parameter reason in place forever.
    #[test]
    fn a_row_whose_instance_inspection_was_refused_is_rescanned_though_the_file_is_unchanged() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("reuse-refused-inspection");
        let plugin_path = root.join("Reverb.clap");
        std::fs::write(&plugin_path, b"clap-bytes").expect("fixture plugin should be written");
        let state = state_with_registry_file(&root);

        let first_scan = crate::block_on_test(scan_plugins_with_backend(
            vec![root.display().to_string()],
            false,
            PluginScanPolicy::with_allowed_roots(vec![root.clone()]),
            UNCONSTRAINED_SCAN_BUDGET,
            &state,
            recording_descriptor_scan(scan_call_log()),
            // A data-level refusal, not a process failure: the candidate is not
            // quarantined, it just has no parameter contract recorded.
            |_format, _path, _plugin_id, _timeout| Err("deadline".to_string()),
        ))
        .expect("a scan whose instance pass is refused still publishes the descriptor row");
        assert_eq!(
            first_scan
                .plugins
                .first()
                .expect("the fixture must produce a row")
                .parameter_metadata_reason
                .as_deref(),
            Some(scanner::PARAMETER_METADATA_UNAVAILABLE_REASON),
            "the fixture must record a refused inspection, or this test proves nothing"
        );

        let descriptor_calls = scan_call_log();
        let second_scan =
            scan_fixture_root(&root, false, &state, &descriptor_calls, &scan_call_log());
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(
            scan_calls_for(&descriptor_calls, &plugin_path),
            1,
            "a row that never learned the plugin's parameters must be asked again"
        );
        assert_eq!(
            second_scan
                .plugins
                .first()
                .expect("the rescan must produce a row")
                .parameter_metadata_reason,
            None,
            "the scan that finally answers must leave a complete row behind"
        );
    }

    /// Reuse must not become a way back in for a quarantined binary. The
    /// candidate is skipped before the reuse branch is reached, so a row it
    /// left behind from a healthier session stays out of the list.
    ///
    /// Mutation this catches: moving the reuse branch above the quarantine
    /// handling republishes the quarantined plugin into the result.
    #[test]
    fn a_quarantined_candidates_row_is_never_reused_into_an_ordinary_scan() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("reuse-quarantined-skip");
        let plugin_path = root.join("Hostile.clap");
        std::fs::write(&plugin_path, b"clap-bytes").expect("fixture plugin should be written");
        let state = state_with_registry_file(&root);

        let first_scan =
            scan_fixture_root(&root, false, &state, &scan_call_log(), &scan_call_log());
        assert_eq!(
            first_scan.plugins.len(),
            1,
            "the fixture must leave a reusable row behind: {:?}",
            first_scan.plugins
        );
        state.plugin_registry_store.quarantine_failure(
            &plugin_path,
            "Plugin scan helper timed out".to_string(),
            1,
        );

        let descriptor_calls = scan_call_log();
        let second_scan =
            scan_fixture_root(&root, false, &state, &descriptor_calls, &scan_call_log());
        let _ = std::fs::remove_dir_all(&root);

        assert!(
            second_scan.plugins.is_empty(),
            "a quarantined candidate must not reach the list, reused or scanned: {:?}",
            second_scan.plugins
        );
        assert_eq!(
            scan_calls_for(&descriptor_calls, &plugin_path),
            0,
            "a quarantined candidate must not be handed to a helper on an ordinary scan"
        );
    }

    /// Asking for a quarantine retry is asking for that binary's helper to run.
    /// Everything else in the folder is still unchanged, and re-inspecting it
    /// would make the retry cost a full sweep.
    ///
    /// Mutation this catches: reusing the retried candidate's row leaves its
    /// call count at zero; skipping reuse for the whole run whenever
    /// `retry_quarantined` is set makes the healthy candidate's count non-zero.
    #[test]
    fn a_quarantine_retry_rescans_that_candidate_and_reuses_the_unchanged_ones() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("reuse-quarantine-retry");
        let quarantined = root.join("A-Recovered.clap");
        let healthy = root.join("B-Healthy.clap");
        std::fs::write(&quarantined, b"clap-bytes").expect("fixture plugin should be written");
        std::fs::write(&healthy, b"clap-bytes").expect("fixture plugin should be written");
        let state = state_with_registry_file(&root);

        scan_fixture_root(&root, false, &state, &scan_call_log(), &scan_call_log());
        state.plugin_registry_store.quarantine_failure(
            &quarantined,
            "Plugin scan helper timed out".to_string(),
            1,
        );

        let descriptor_calls = scan_call_log();
        let retry_scan =
            scan_fixture_root(&root, true, &state, &descriptor_calls, &scan_call_log());
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(
            scan_calls_for(&descriptor_calls, &quarantined),
            1,
            "the candidate the user asked to retry must actually be read again"
        );
        assert_eq!(
            scan_calls_for(&descriptor_calls, &healthy),
            0,
            "a retry is not a reason to re-inspect every other file in the folder"
        );
        assert_eq!(
            retry_scan.plugins.len(),
            2,
            "both files belong in the retry's result: {:?}",
            retry_scan.plugins
        );
    }

    /// A descriptor backend for a bundle whose factory declares two plugins, in
    /// a fixed order. Their identities differ, so both survive the scan's
    /// per-identity retention and the order they came back in is observable.
    fn recording_two_plugin_descriptor_scan(
        log: ScanCallLog,
    ) -> impl Fn(PluginFormat, &Path, Duration) -> Result<Vec<ScannedDescriptor>, String> + Send + 'static
    {
        move |_format, path, timeout| {
            record_scan_call(&log, path, timeout);
            Ok(vec![
                descriptor("com.vendor.first"),
                descriptor("com.vendor.second"),
            ])
        }
    }

    /// A VST3 descriptor backend that records every call and answers with the
    /// name the caller chose, so a replaced row is visible in the result.
    fn recording_vst3_descriptor_scan(
        log: ScanCallLog,
        name: &'static str,
    ) -> impl Fn(PluginFormat, &Path, Duration) -> Result<Vec<ScannedDescriptor>, String> + Send + 'static
    {
        move |_format, path, timeout| {
            record_scan_call(&log, path, timeout);
            let mut answered = descriptor("com.vendor.bundled");
            answered.format = "vst3".to_string();
            answered.name = Some(name.to_string());
            Ok(vec![answered])
        }
    }

    /// The path a scan records is the candidate the walk found, and for a VST3
    /// bundle that candidate is a directory. A directory's size and
    /// modification time describe its own listing, so rewriting the module
    /// inside it — which is what an in-place plugin update is — moves neither.
    /// Fingerprinting the candidate would therefore call an updated plugin
    /// unchanged and republish the old version's metadata for as long as the
    /// bundle's entries stayed put.
    ///
    /// Mutation this catches: fingerprinting `plugin.path` instead of
    /// `scanned_file_path`'s answer leaves the second scan's call count at zero
    /// and its row at the first scan's name.
    #[test]
    fn a_bundle_whose_module_changed_is_rescanned_though_its_directory_did_not() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("reuse-bundle-module");
        let bundle = root.join("Reverb.vst3");
        std::fs::create_dir_all(&bundle).expect("the bundle directory should be created");

        // Where this platform's loader expects the module. Asked rather than
        // spelled out, so the fixture is the layout the product resolves and
        // not a second copy of it that can drift.
        let module = scanned_binary_location(&vst3_bundle_row(&bundle))
            .expect("every supported platform names where a VST3 module belongs");
        std::fs::create_dir_all(module.parent().expect("a module path has a parent"))
            .expect("the module's directory should be created");
        std::fs::write(&module, b"vst3-bytes").expect("the fixture module should be written");
        let state = state_with_registry_file(&root);

        let scan_with = |name: &'static str, descriptors: &ScanCallLog, instances: &ScanCallLog| {
            crate::block_on_test(scan_plugins_with_backend(
                vec![root.display().to_string()],
                false,
                PluginScanPolicy::with_allowed_roots(vec![root.clone()]),
                UNCONSTRAINED_SCAN_BUDGET,
                &state,
                recording_vst3_descriptor_scan(Arc::clone(descriptors), name),
                recording_instance_scan(Arc::clone(instances)),
            ))
            .expect("a scan over an authorized fixture root should succeed")
        };

        let first_scan = scan_with("First Edition", &scan_call_log(), &scan_call_log());
        assert_eq!(
            first_scan.plugins.len(),
            1,
            "the bundle fixture must leave a reusable row behind: {:?}",
            first_scan.plugins
        );

        // An in-place update: the module is rewritten at a different length,
        // and no entry of any directory in the bundle is created or removed.
        std::fs::write(&module, b"vst3-bytes-of-the-second-edition")
            .expect("the module should be updated in place");

        let descriptor_calls = scan_call_log();
        let instance_calls = scan_call_log();
        let second_scan = scan_with("Second Edition", &descriptor_calls, &instance_calls);
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(
            scan_calls_for(&descriptor_calls, &bundle),
            1,
            "a bundle whose module changed must be read again"
        );
        assert_eq!(
            scan_calls_for(&instance_calls, &bundle),
            1,
            "the rescan must inspect an instance of the updated module"
        );
        assert_eq!(
            second_scan
                .plugins
                .first()
                .expect("the rescan must produce a row")
                .name,
            "Second Edition",
            "the published row must be the updated module's, not the previous scan's"
        );
    }

    /// What the persisted registry still resolves on the next launch: a fresh
    /// store over the same file, hydrated through the same policy. Nothing
    /// carries over but what reached the disk, which is the property a row has
    /// to have for a saved project to reopen.
    fn registry_after_relaunch(root: &Path) -> HashMap<String, PluginRegistryEntry> {
        let registry = Mutex::new(HashMap::new());
        PluginRegistryStore::at(root.join("plugin-registry.json")).hydrate_into(
            &registry,
            &PluginScanPolicy::with_allowed_roots(vec![root.to_path_buf()]),
        );
        registry
            .into_inner()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// macOS loads a bundle through `CFBundleCreate`, which takes the
    /// executable `Info.plist` names and is under no obligation to name it
    /// after the bundle. Resolving only the stem-named path would leave such a
    /// plugin with no resolvable binary, and the module that actually changes
    /// on an update would never be the one fingerprinted.
    ///
    /// The directory holds more than the module, which is why the pick has to
    /// be both filtered and ordered: a dot-prefixed sidecar is not an
    /// executable, and among the ones that are, only a deterministic choice
    /// makes two runs agree about which file the plugin's version is.
    ///
    /// Mutations this catches: dropping the `Contents/MacOS` fallback from the
    /// macOS VST3 branch falls back to the bundle directory, whose timestamps
    /// do not move when the module is rewritten, so the final scan reuses and
    /// its call counts stay at zero; taking the first `read_dir` entry instead
    /// of the lowest name resolves the companion, and dropping the dot-prefix
    /// filter resolves the sidecar — both fail the resolution assertion, and
    /// both then track a file whose rewriting is not a plugin update.
    #[test]
    #[cfg(target_os = "macos")]
    fn a_vst3_bundle_whose_executable_is_not_named_after_its_stem_is_fingerprinted_by_it() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("reuse-bundle-renamed-module");
        let bundle = root.join("Reverb.vst3");
        let executables = bundle.join("Contents").join("MacOS");
        std::fs::create_dir_all(&executables).expect("the bundle directory should be created");
        // What `CFBundleExecutable` points at is named for the product, not the
        // bundle. Beside it: a second executable, and the sidecar Finder leaves
        // in any directory a user has looked at. The module is the lowest real
        // name of the three, and `.DS_Store` sorts below all of them.
        let module = executables.join("Engine");
        let companion = executables.join("VendorEngine");
        let sidecar = executables.join(".DS_Store");
        for path in [&module, &companion, &sidecar] {
            std::fs::write(path, b"vst3-bytes").expect("the fixture file should be written");
        }
        assert_eq!(
            scanned_binary_location(&vst3_bundle_row(&bundle)).as_deref(),
            Some(module.as_path()),
            "the lowest real executable name decides, and a dot-prefixed sidecar is not one"
        );
        let state = state_with_registry_file(&root);

        let scan_with = |name: &'static str, descriptors: &ScanCallLog, instances: &ScanCallLog| {
            crate::block_on_test(scan_plugins_with_backend(
                vec![root.display().to_string()],
                false,
                PluginScanPolicy::with_allowed_roots(vec![root.clone()]),
                UNCONSTRAINED_SCAN_BUDGET,
                &state,
                recording_vst3_descriptor_scan(Arc::clone(descriptors), name),
                recording_instance_scan(Arc::clone(instances)),
            ))
            .expect("a scan over an authorized fixture root should succeed")
        };

        scan_with("First Edition", &scan_call_log(), &scan_call_log());
        assert!(
            registry_after_relaunch(&root).contains_key(&scanner::stable_id(&bundle)),
            "a bundle whose module resolved must leave a row a relaunch can resolve"
        );

        // A file beside the module is not the module. Rewriting it is not a
        // plugin update, and must not cost the walk a helper.
        std::fs::write(&companion, b"a-companion-of-an-entirely-different-length")
            .expect("the companion should be rewritten in place");
        let bystander_calls = scan_call_log();
        scan_with("Never Published", &bystander_calls, &scan_call_log());
        assert_eq!(
            scan_calls_for(&bystander_calls, &bundle),
            0,
            "rewriting a file the bundle does not load must not invalidate its row"
        );

        std::fs::write(&module, b"vst3-bytes-of-the-second-edition")
            .expect("the module should be updated in place");

        let descriptor_calls = scan_call_log();
        let instance_calls = scan_call_log();
        let second_scan = scan_with("Second Edition", &descriptor_calls, &instance_calls);
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(
            scan_calls_for(&descriptor_calls, &bundle),
            1,
            "the executable the bundle actually loads is the one that decides staleness"
        );
        assert_eq!(
            scan_calls_for(&instance_calls, &bundle),
            1,
            "the rescan must inspect an instance of the updated module"
        );
        assert_eq!(
            second_scan
                .plugins
                .first()
                .expect("the rescan must produce a row")
                .name,
            "Second Edition",
            "the published row must be the updated module's, not the previous scan's"
        );
    }

    /// A bundle this build cannot resolve a module inside is still a plugin the
    /// scan found and published, and dropping its row would mean the next
    /// launch could not activate it — the exact failure this store exists to
    /// prevent. It falls back to the weaker directory fingerprint the store
    /// gave every plugin before modules were resolved at all.
    ///
    /// Mutation this catches: removing the candidate-path fallback from
    /// `scanned_file_path` persists nothing for this bundle, and the relaunch
    /// resolves no row for it.
    #[test]
    fn a_bundle_with_no_resolvable_module_keeps_its_row() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("reuse-bundle-unresolvable");
        let bundle = root.join("Reverb.vst3");
        // A bundle directory and nothing this build recognises inside it.
        std::fs::create_dir_all(&bundle).expect("the bundle directory should be created");
        let state = state_with_registry_file(&root);

        let scan_with = |descriptors: &ScanCallLog, instances: &ScanCallLog| {
            crate::block_on_test(scan_plugins_with_backend(
                vec![root.display().to_string()],
                false,
                PluginScanPolicy::with_allowed_roots(vec![root.clone()]),
                UNCONSTRAINED_SCAN_BUDGET,
                &state,
                recording_vst3_descriptor_scan(Arc::clone(descriptors), "Unresolvable Edition"),
                recording_instance_scan(Arc::clone(instances)),
            ))
            .expect("a scan over an authorized fixture root should succeed")
        };

        let first_scan = scan_with(&scan_call_log(), &scan_call_log());
        assert_eq!(
            first_scan.plugins.len(),
            1,
            "the scan must publish the bundle it found: {:?}",
            first_scan.plugins
        );
        assert!(
            scanned_file_path(&first_scan.plugins[0]).is_some(),
            "a bundle with no resolvable module still has a path to fingerprint"
        );

        scan_with(&scan_call_log(), &scan_call_log());
        let relaunched = registry_after_relaunch(&root);
        let _ = std::fs::remove_dir_all(&root);

        assert!(
            relaunched.contains_key(&scanner::stable_id(&bundle)),
            "the row must survive both scans and be there for the next launch: {:?}",
            relaunched.keys().collect::<Vec<_>>()
        );
    }

    /// The row a targeted activation rescan leaves behind: a descriptor was
    /// read and no instance was ever created, so there is neither a parameter
    /// contract nor a reason for its absence. Nobody asked — which is not the
    /// same as asked and refused, and it must not pin an un-inspected plugin
    /// out of every future scan.
    ///
    /// Mutation this catches: relaxing `instance_inspection_answered` from
    /// `&&` to `||` makes this row reusable, leaving the instance call count at
    /// zero and the plugin's parameters unknown forever.
    #[test]
    fn a_row_no_instance_inspection_ever_ran_for_is_rescanned() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("reuse-uninspected-row");
        let plugin_path = root.join("Reverb.clap");
        std::fs::write(&plugin_path, b"clap-bytes").expect("fixture plugin should be written");
        let state = state_with_registry_file(&root);

        let uninspected = ScannedPlugin {
            id: scanner::stable_id(&plugin_path),
            name: "Vendor Reverb".to_string(),
            vendor: "Vendor".to_string(),
            format: "clap".to_string(),
            category: "effect".to_string(),
            path: plugin_path.display().to_string(),
            version: "1.0.0".to_string(),
            descriptor_id: "com.vendor.reverb".to_string(),
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 0,
            has_custom_ui: true,
            parameters: None,
            parameter_metadata_reason: None,
            capability_metadata_reason: None,
        };
        state.plugin_registry_store.persist(&[ScanRow {
            keys: vec![uninspected.id.clone()],
            plugin: uninspected,
        }]);

        let instance_calls = scan_call_log();
        let scan = scan_fixture_root(&root, false, &state, &scan_call_log(), &instance_calls);
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(
            scan_calls_for(&instance_calls, &plugin_path),
            1,
            "a row nothing ever inspected an instance for must be inspected now"
        );
        assert!(
            scan.plugins
                .first()
                .expect("the rescan must produce a row")
                .parameters
                .is_some(),
            "the scan that finally inspects the plugin must record its parameters: {:?}",
            scan.plugins
        );
    }

    /// One file can declare several plugins, and their order is the factory's,
    /// not the registry's. The rows are keyed by identity, so nothing in the
    /// stored map recovers that order — only the recorded position does. A
    /// browse list that reordered a multi-plugin bundle on the first scan that
    /// reused it would move plugins under the user's cursor for no reason.
    ///
    /// Mutation this catches: sorting `reusable_rows` by
    /// `Reverse(bundle_position)`, or dropping the sort for the map's own key
    /// order, reverses or scrambles the second scan's rows against the first's.
    #[test]
    fn a_reused_files_plugins_come_back_in_the_order_its_factory_declared() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("reuse-bundle-order");
        let bundle_path = root.join("Duo.clap");
        std::fs::write(&bundle_path, b"clap-bytes").expect("fixture plugin should be written");
        let state = state_with_registry_file(&root);

        let scan_with = |descriptors: &ScanCallLog, instances: &ScanCallLog| {
            crate::block_on_test(scan_plugins_with_backend(
                vec![root.display().to_string()],
                false,
                PluginScanPolicy::with_allowed_roots(vec![root.clone()]),
                UNCONSTRAINED_SCAN_BUDGET,
                &state,
                recording_two_plugin_descriptor_scan(Arc::clone(descriptors)),
                recording_instance_scan(Arc::clone(instances)),
            ))
            .expect("a scan over an authorized fixture root should succeed")
        };

        let first_scan = scan_with(&scan_call_log(), &scan_call_log());
        assert_eq!(
            first_scan.plugins.len(),
            2,
            "the fixture bundle must declare two plugins: {:?}",
            first_scan.plugins
        );

        let descriptor_calls = scan_call_log();
        let second_scan = scan_with(&descriptor_calls, &scan_call_log());
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(
            scan_calls_for(&descriptor_calls, &bundle_path),
            0,
            "an unchanged multi-plugin bundle must not be read again"
        );
        assert_eq!(
            second_scan
                .plugins
                .iter()
                .map(|plugin| plugin.descriptor_id.as_str())
                .collect::<Vec<_>>(),
            first_scan
                .plugins
                .iter()
                .map(|plugin| plugin.descriptor_id.as_str())
                .collect::<Vec<_>>(),
            "a reused file's plugins keep the order its factory declared them in"
        );
    }

    /// The other half of AC-002: the default incremental path must never
    /// clear a quarantine record on its own, whatever else the scan finds.
    #[test]
    fn a_default_scan_never_clears_a_quarantine_record() {
        let _scan_serial = SCAN_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = created_temp_scan_root("quarantine-default-no-retry");
        let plugin_path = root.join("StillHostile.clap");
        std::fs::write(&plugin_path, b"not a real clap bundle")
            .expect("fixture plugin file should be written");
        let policy = PluginScanPolicy::with_allowed_roots(vec![root.clone()]);

        let state = AppState::default();
        const SEEDED_SENTINEL_TIMESTAMP: u64 = 1;
        state.plugin_registry_store.quarantine_failure(
            &plugin_path,
            "Plugin scan helper timed out".to_string(),
            SEEDED_SENTINEL_TIMESTAMP,
        );

        let result = crate::block_on_test(scan_plugins_with_policy(
            vec![root.display().to_string()],
            false,
            policy,
            &state,
        ))
        .expect("a default scan over an authorized root should succeed");
        let _ = std::fs::remove_dir_all(&root);

        // Not just "still quarantined": a record a helper attempt overwrote
        // and re-quarantined would also read `is_some()`, so the timestamp has
        // to be the untouched sentinel and the helper must never have been
        // reached at all.
        let quarantined = state
            .plugin_registry_store
            .is_quarantined(&plugin_path)
            .expect("a default scan must never silently clear a quarantine record");
        assert_eq!(
            quarantined.quarantined_at_ms, SEEDED_SENTINEL_TIMESTAMP,
            "the record must be the untouched original, not a fresh one from a re-attempt"
        );
        assert!(
            !result
                .errors
                .iter()
                .any(|error| error.contains("StillHostile.clap")),
            "a default scan must never spawn a helper for a quarantined candidate: {:?}",
            result.errors
        );
    }

    /// The instance pass gets the same quarantine escape hatch the descriptor
    /// pass already has (#2911). Before this, an instance-pass process
    /// failure was discarded into the `parameter_metadata_reason` fallback
    /// and never reached `is_process_failure` at all — so a candidate whose
    /// `create_plugin` call hangs would exhaust `MAX_SCAN_DURATION` on every
    /// single scan, without ever quarantining, rather than being isolated
    /// after its first failure.
    #[test]
    fn an_instance_pass_process_failure_quarantines_the_bundle() {
        let store = PluginRegistryStore::in_memory_only();
        let path = Path::new("/plugins/HangsOnActivate.clap");
        let mut row = descriptor("com.vendor.hangs-on-activate");

        apply_instance_scan_result(
            &mut row,
            Err("Plugin scan helper timed out".to_string()),
            &store,
            path,
        );

        assert_eq!(
            row.parameter_metadata_reason.as_deref(),
            Some(scanner::PARAMETER_METADATA_UNAVAILABLE_REASON),
            "the fallback must still apply so the published row explains its missing fields"
        );
        assert!(
            store.is_quarantined(path).is_some(),
            "an instance helper timeout must quarantine the bundle, exactly like a descriptor \
             helper timeout does"
        );
    }

    /// The other half: a data-level instance-pass refusal — the descriptor
    /// pass succeeded, the deadline ran out, or the response was malformed —
    /// is never evidence the binary itself is dangerous, so it must not
    /// quarantine.
    #[test]
    fn an_instance_pass_data_level_refusal_does_not_quarantine() {
        let store = PluginRegistryStore::in_memory_only();
        let path = Path::new("/plugins/RanOutOfTime.clap");
        let mut row = descriptor("com.vendor.ran-out-of-time");

        apply_instance_scan_result(&mut row, Err("deadline".to_string()), &store, path);

        assert_eq!(
            row.parameter_metadata_reason.as_deref(),
            Some(scanner::PARAMETER_METADATA_UNAVAILABLE_REASON)
        );
        assert!(
            store.is_quarantined(path).is_none(),
            "a deadline miss is not a process failure and must not quarantine the bundle"
        );
    }

    /// The scan keeps the first copy of a plugin it meets, so the order the
    /// roots are walked in is what decides which install of a twice-installed
    /// plugin gets hosted. That decision belongs to the platform's priority
    /// order — per-user before machine-wide before network — and a caller
    /// listing its paths the other way round must not reverse it.
    #[test]
    fn scan_roots_are_walked_in_the_platforms_priority_order_not_the_callers() {
        let per_user = created_temp_scan_root("priority-per-user");
        let machine_wide = created_temp_scan_root("priority-machine-wide");
        let policy =
            PluginScanPolicy::with_allowed_roots(vec![per_user.clone(), machine_wide.clone()]);

        let (ordered, errors) =
            authorize_scan_roots(&policy, vec![machine_wide.clone(), per_user.clone()]);

        let _ = std::fs::remove_dir_all(&per_user);
        let _ = std::fs::remove_dir_all(&machine_wide);
        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(
            ordered
                .iter()
                .map(|path| path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(""))
                .collect::<Vec<_>>(),
            vec![
                per_user
                    .file_name()
                    .and_then(|name| name.to_str())
                    .expect("named"),
                machine_wide
                    .file_name()
                    .and_then(|name| name.to_str())
                    .expect("named"),
            ],
            "the caller listed the machine-wide root first and it was walked first"
        );
    }

    /// An unauthorized or missing root is refused by name rather than walked,
    /// and the rest of the request still scans.
    #[test]
    fn an_unauthorized_root_is_refused_without_stopping_the_others() {
        let allowed = created_temp_scan_root("mixed-authorized");
        let policy = PluginScanPolicy::with_allowed_roots(vec![allowed.clone()]);

        let (ordered, errors) = authorize_scan_roots(
            &policy,
            vec![PathBuf::from("/definitely/not/granted"), allowed.clone()],
        );

        let _ = std::fs::remove_dir_all(&allowed);
        assert_eq!(ordered.len(), 1);
        assert!(
            errors
                .iter()
                .any(|error| error.contains("Unauthorized plugin scan path")),
            "{errors:?}"
        );
    }

    /// Every scan requests all of the platform's default roots, and an ordinary
    /// machine has never created most of them. Reported as errors they made a
    /// scan that enumerated everything look like a failed one (#3497). The root
    /// that is there is still scanned, which is the unchanged half.
    #[test]
    fn an_absent_default_root_is_skipped_without_an_error() {
        let present = created_temp_scan_root("absent-default-present");
        let absent = unique_temp_scan_root("absent-default-missing");
        let policy = PluginScanPolicy::with_allowed_roots(vec![present.clone(), absent.clone()]);

        let (ordered, errors) = authorize_scan_roots(&policy, vec![absent, present.clone()]);

        let _ = std::fs::remove_dir_all(&present);
        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(ordered, vec![present]);
    }

    /// A folder the user added under a default root is theirs, so its absence
    /// is a mistake they can see and fix — the settings panel shows it red.
    #[test]
    fn an_absent_user_added_root_is_still_an_error() {
        let root = created_temp_scan_root("absent-user-added");
        let missing_child = root.join("Vendor");
        let policy = PluginScanPolicy::with_allowed_roots(vec![root.clone()]);

        let (ordered, errors) = authorize_scan_roots(&policy, vec![missing_child]);

        let _ = std::fs::remove_dir_all(&root);
        assert!(ordered.is_empty(), "{ordered:?}");
        assert!(
            errors.iter().any(|error| error.contains("Not a directory")),
            "{errors:?}"
        );
    }

    /// A Linux distribution's `/usr/lib64 -> /usr/lib` symlink authorizes
    /// `/usr/lib/vst3` and `/usr/lib64/vst3` to the same canonical folder.
    /// Walking that folder twice before dedup-by-path runs is what let a
    /// 130-bundle real install exhaust `MAX_SCAN_CANDIDATES` on its own
    /// duplicate and drop every scan root behind it.
    #[cfg(unix)]
    #[test]
    fn authorize_scan_roots_dedupes_two_requests_that_share_a_canonical_root() {
        let temp_root = unique_temp_scan_root("authorize-scan-roots-dedupe");
        let real_root = temp_root.join("real");
        let real_vst3 = real_root.join("VST3");
        let linked_root = temp_root.join("linked");
        std::fs::create_dir_all(&real_vst3).expect("real VST3 root should be created");
        std::os::unix::fs::symlink(&real_root, &linked_root)
            .expect("linked root symlink should be created");

        let linked_vst3 = linked_root.join("VST3");
        let policy =
            PluginScanPolicy::with_allowed_roots(vec![real_vst3.clone(), linked_vst3.clone()]);

        let (ordered, errors) = authorize_scan_roots(&policy, vec![real_vst3.clone(), linked_vst3]);

        let expected = std::fs::canonicalize(&real_vst3).expect("real VST3 root should resolve");
        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(
            ordered,
            vec![expected],
            "both roots resolve to the same canonical folder and must be walked once"
        );
    }

    #[test]
    fn get_default_plugin_paths_returns_authorized_native_scan_roots() {
        let paths = crate::block_on_test(get_default_plugin_paths())
            .expect("default plugin paths should resolve");
        let scan_policy = PluginScanPolicy::platform_defaults();

        assert!(!paths.is_empty());
        for path in paths {
            assert!(scan_policy.authorize_scan_root(Path::new(&path)).is_ok());
        }
    }

    /// A VST3 descriptor id is the class CID, and the bundle's factory resolves
    /// a class by it. An empty one means the scan of this file yielded nothing
    /// usable, so the load refuses by name — before the bundle is opened, which
    /// is what keeps a registry row pointing at a path that no longer exists
    /// from executing anything.
    #[test]
    fn load_plugin_refuses_a_vst3_entry_with_no_descriptor_id() {
        let state = AppState::default();
        state
            .plugin_registry
            .lock()
            .expect("plugin registry lock should be available")
            .insert(
                "vst3-fixture".to_string(),
                PluginRegistryEntry {
                    path: "/plugins/should-not-be-loaded.vst3".to_string(),
                    stable_id: "vst3-fixture".to_string(),
                    descriptor_id: String::new(),
                    format: "vst3".to_string(),
                    name: "Nameless VST3".to_string(),
                    num_inputs: 0,
                    num_outputs: 0,
                    has_custom_ui: false,
                    capability_metadata_reason: Some(
                        scanner::CAPABILITY_METADATA_UNAVAILABLE_REASON.to_string(),
                    ),
                    chain_kind: DeviceKind::Effect,
                },
            );

        let result = crate::block_on_test(load_plugin(
            PluginId("vst3-fixture".to_string()),
            PluginInstanceId("vst3-instance".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
        ));

        match result {
            Err(error) => assert_eq!(
                error,
                "VST3 plugin /plugins/should-not-be-loaded.vst3 reports no descriptor id in the registry entry for vst3-fixture. Rescan the plugin directory."
            ),
            Ok(instance) => panic!("a VST3 row with no class id unexpectedly loaded: {instance:?}"),
        }
        insert_engine_owned_fixture(&state, "vst3-instance", vec![1, 2, 3]);
        let duplicate = crate::block_on_test(load_plugin(
            PluginId("vst3-fixture".to_string()),
            PluginInstanceId("vst3-instance".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
        ));
        assert_eq!(
            duplicate.unwrap_err(),
            "Plugin instance already exists: vst3-instance"
        );
    }

    /// Activation refuses in the same words the scan skipped the file in, and
    /// each one names the format and the reason. A user who is told "VST2 is
    /// not supported" in one place and "unknown plugin format" in the other has
    /// been given two different stories about one file.
    #[test]
    fn every_refused_format_names_itself_and_its_reason_at_activation() {
        for (plugin_id, path, format, expected) in [
            (
                "vst2-refusal",
                "/plugins/Vendor.vst",
                "vst2",
                scanner::VST2_REFUSAL,
            ),
            (
                "au-refusal",
                "/plugins/Vendor.component",
                "au",
                scanner::AUDIO_UNIT_REFUSAL,
            ),
        ] {
            let state = AppState::default();
            state
                .plugin_registry
                .lock()
                .expect("plugin registry lock should be available")
                .insert(
                    plugin_id.to_string(),
                    PluginRegistryEntry {
                        path: path.to_string(),
                        stable_id: plugin_id.to_string(),
                        descriptor_id: String::new(),
                        format: format.to_string(),
                        name: "Refused".to_string(),
                        num_inputs: 0,
                        num_outputs: 0,
                        has_custom_ui: false,
                        capability_metadata_reason: Some(
                            scanner::CAPABILITY_METADATA_UNAVAILABLE_REASON.to_string(),
                        ),
                        chain_kind: DeviceKind::Effect,
                    },
                );

            let result = crate::block_on_test(load_plugin(
                PluginId(plugin_id.to_string()),
                PluginInstanceId(format!("{plugin_id}-instance")),
                TEST_ENGINE_SAMPLE_RATE,
                &NoWindowHost,
                &state,
            ));

            match result {
                Err(error) => assert_eq!(error, expected, "wrong refusal for {format}"),
                Ok(instance) => panic!("{format} unexpectedly loaded: {instance:?}"),
            }
        }
    }

    /// The instantiation switch is a registry lookup over `PluginFormat`, not a
    /// comparison against format strings written out here.
    ///
    /// Driven by `PluginFormat::ALL`, so it sees every recognised format rather
    /// than the ones this test thought of. Two things fail if the inline string
    /// match comes back: a recognised format that the match forgot falls into
    /// its "unknown format" arm, which the second assertion catches; and a
    /// refusal written out here instead of taken from the scanner diverges from
    /// `unsupported_format_refusal`, which the first one catches.
    #[test]
    fn the_host_backend_lookup_answers_for_every_recognised_format() {
        for format in PluginFormat::ALL {
            let wire_name = format.wire_name();
            let looked_up = host_backend(wire_name);

            match scanner::unsupported_format_refusal(wire_name) {
                Some(refusal) => {
                    let error = looked_up
                        .err()
                        .unwrap_or_else(|| panic!("{wire_name} must not be hostable"));
                    assert_eq!(
                        error, refusal,
                        "{wire_name} must refuse in the scanner's own words"
                    );
                    assert!(
                        !error.starts_with("Unknown plugin format"),
                        "{wire_name} is a format Sourdaw recognises and must never be reported as unknown"
                    );
                }
                None => assert!(
                    looked_up.is_ok(),
                    "{wire_name} carries no refusal, so it must resolve to a host backend"
                ),
            }
        }
    }

    /// The other half: which formats are hostable, named. This fails the moment
    /// a backend is registered, which is the point — registering one is a
    /// packet, not an edit.
    #[test]
    fn only_the_implemented_formats_have_a_host_backend() {
        for format in PluginFormat::ALL {
            let hostable = host_backend(format.wire_name()).is_ok();
            assert_eq!(
                hostable,
                matches!(format, PluginFormat::Clap | PluginFormat::Vst3),
                "{} hostability disagrees with the registry",
                format.wire_name()
            );
        }
    }

    /// A format the registry has never carried is still not silently accepted.
    #[test]
    fn an_unrecognised_format_is_refused_by_name() {
        let state = AppState::default();
        state
            .plugin_registry
            .lock()
            .expect("plugin registry lock should be available")
            .insert(
                "unknown-format".to_string(),
                PluginRegistryEntry {
                    path: "/plugins/Vendor.mystery".to_string(),
                    stable_id: "unknown-format".to_string(),
                    descriptor_id: String::new(),
                    format: "mystery".to_string(),
                    name: "Mystery".to_string(),
                    num_inputs: 0,
                    num_outputs: 0,
                    has_custom_ui: false,
                    capability_metadata_reason: Some(
                        scanner::CAPABILITY_METADATA_UNAVAILABLE_REASON.to_string(),
                    ),
                    chain_kind: DeviceKind::Effect,
                },
            );

        let result = crate::block_on_test(load_plugin(
            PluginId("unknown-format".to_string()),
            PluginInstanceId("unknown-instance".to_string()),
            TEST_ENGINE_SAMPLE_RATE,
            &NoWindowHost,
            &state,
        ));

        assert_eq!(result.unwrap_err(), "Unknown plugin format: mystery");
    }

    #[test]
    fn bulk_unload_waits_for_inflight_load_or_unload_access() {
        crate::block_on_test(async {
            let state = AppState::default();
            let _runtime_operation = PLUGIN_RUNTIME_GATE.read().await;
            let blocked = tokio::time::timeout(
                Duration::from_millis(10),
                unload_all_plugin_runtimes(None, &state),
            )
            .await;
            assert!(blocked.is_err());
        });
    }

    #[test]
    fn unload_preserves_failed_engine_owner_and_cleans_command_owner() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "active-instance", vec![1, 2, 3]);
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Command Fixture", vec![], true);
        let instance = PluginInstanceData::dormant_fixture(HostedRuntime::from(wrapper));
        state
            .plugins
            .lock()
            .expect("plugins lock")
            .insert("command-instance".into(), instance);
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert("command-instance".into(), "command-window".into());
        let unload_all = crate::block_on_test(unload_all_plugin_runtimes(None, &state));
        let unload_all = unload_all.expect("bulk inventory should complete");
        assert_eq!(unload_all.unloaded_instance_ids, ["command-instance"]);
        assert_eq!(unload_all.errors, ["Native engine not running"]);
        let windows = state.plugin_windows.lock().expect("plugin_windows lock");
        assert!(windows.is_empty());
    }

    /// Removing a device while its editor is open closes that editor, and the
    /// close is the same thread-affine lifecycle a GUI command runs: it reaches
    /// VST3 `removed` and CLAP `gui.destroy`. An unload that ran it on the
    /// executor's worker un-parents an `NSView` off the main thread, which on
    /// macOS is a crash rather than a mistake — and no GUI command is involved,
    /// so nothing in `plugin_gui` covers this path.
    #[test]
    fn unloading_an_instance_closes_its_editor_on_the_shell_thread() {
        let state = AppState::default();
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Command Fixture", vec![], true);
        let gui_threads = wrapper
            .engine_owned_command_fixture_gui_threads()
            .expect("the command fixture records its editor lifecycle threads");
        state.plugins.lock().expect("plugins lock").insert(
            "command-instance".into(),
            PluginInstanceData::dormant_fixture(HostedRuntime::from(wrapper)),
        );
        let windows = DedicatedUiWindowHost::start();

        crate::block_on_test(unload_plugin(
            Some(PluginInstanceId("command-instance".to_string())),
            &windows,
            &state,
        ))
        .expect("the instance should unload");

        assert_eq!(
            gui_threads.lock().expect("gui thread log").clone(),
            [windows.thread_id],
            "the editor close an unload performs must run on the shell's thread"
        );
        assert_ne!(
            windows.thread_id,
            std::thread::current().id(),
            "the fake shell thread must not be this one, or this test proves nothing"
        );
    }

    #[test]
    fn keyed_unload_is_idempotent_after_the_instance_is_already_absent() {
        let state = AppState::default();
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Command Fixture", vec![], true);
        state.plugins.lock().expect("plugins lock").insert(
            "command-instance".into(),
            PluginInstanceData::dormant_fixture(HostedRuntime::from(wrapper)),
        );

        let first = crate::block_on_test(unload_plugin_runtime("command-instance", None, &state));
        let retry = crate::block_on_test(unload_plugin_runtime("command-instance", None, &state));

        assert_eq!(first, Ok(Vec::new()));
        assert_eq!(retry, Ok(Vec::new()));
        assert!(!state
            .plugins
            .lock()
            .expect("plugins lock")
            .contains_key("command-instance"));
    }

    /// The unload-relevant commands the engine received, in ring order.
    ///
    /// `GraphCommand` carries whole clips and has no `Debug`, so the shape is
    /// reduced to names, and the fence beside them is dropped: what these
    /// cases are about is which of the two arrived first.
    fn released_then_retired(
        commands: &mut rtrb::Consumer<daw_engine::scheduler::GraphCommand>,
    ) -> Vec<&'static str> {
        let mut order = Vec::new();
        while let Ok(command) = commands.pop() {
            match command {
                daw_engine::scheduler::GraphCommand::RemoveTrackDevice { .. } => {
                    order.push("release")
                }
                daw_engine::scheduler::GraphCommand::RemovePlugin(_) => order.push("retire"),
                _ => {}
            }
        }
        order
    }

    /// One track strip whose only device borrows the engine-owned fixture.
    fn strip_binding_the_fixture() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "commands": [{
                "kind": "create-track-strip", "trackId": "lead", "name": "Lead",
                "state": { "gain": 1.0, "pan": 0, "muted": false, "soloGated": false,
                           "vcaMultiplier": 1 },
                "devices": [
                    { "id": "d-plugin", "name": "Engine Owned Fixture", "type": "plugin",
                      "bypassed": false, "parameterValues": {},
                      "externalPluginId": "com.fixture", "externalInstanceId": "inst-1" }
                ],
                "honorMuted": true, "contributesAudio": true
            }]
        })
    }

    /// The registry's count of fences the engine has been handed.
    fn fenced_batches(state: &AppState) -> u64 {
        state
            .graph
            .lock()
            .expect("graph registry lock")
            .fenced_batches()
    }

    /// Build the strip that binds the fixture and drain what building it
    /// pushed, so what stays on the ring afterwards is the unload's alone.
    fn bind_the_fixture_to_a_strip(
        state: &AppState,
        commands: &mut rtrb::Consumer<daw_engine::scheduler::GraphCommand>,
    ) {
        let applied = crate::block_on_test(crate::commands::graph::apply_graph_commands(
            strip_binding_the_fixture(),
            state,
            &crate::commands::crumbs::CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");
        assert_eq!(
            applied["application"], "applied",
            "the strip must bind the attached instance, or nothing is released later"
        );
        while commands.pop().is_ok() {}
    }

    /// Push empty batches until the engine's command ring holds only
    /// `free_slots` free slots, so a batch needing more than that is refused
    /// rather than queued.
    fn leave_command_ring_with_free_slots(
        state: &AppState,
        commands: &rtrb::Consumer<daw_engine::scheduler::GraphCommand>,
        free_slots: usize,
    ) {
        let mut engine_guard = state.engine.lock().expect("engine lock");
        let engine = engine_guard.as_mut().expect("the engine is running");
        while commands.buffer().capacity() - commands.slots() > free_slots {
            engine
                .send_graph_batch_with_headroom(Vec::new(), 0)
                .expect("an empty batch fits while the ring still has room");
        }
    }

    /// An unload releases the instance's chain entry before it retires the
    /// instance. A chain entry naming a retired effect is not counted anywhere
    /// — the scheduler's `run_device` returns on a failed effect-table lookup
    /// — and a rolling engine gets no topology replacement to clear it, so the
    /// two commands are ordered rather than merely both present.
    ///
    /// The release is its own fence, so the registry's count advances by one:
    /// a release that reached the ring unnumbered would leave every later
    /// batch's stamp held against a horizon the engine had already passed.
    #[test]
    fn unloading_a_bound_instance_releases_its_chain_entry_before_retiring_it() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "inst-1", vec![]);
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        bind_the_fixture_to_a_strip(&state, &mut command_rx);
        let fences_before = fenced_batches(&state);

        crate::block_on_test(unload_plugin_runtime("inst-1", None, &state))
            .expect("the bound instance unloads");

        assert_eq!(
            released_then_retired(&mut command_rx),
            vec!["release", "retire"],
            "the chain entry leaves the graph before the effect it names is retired"
        );
        assert_eq!(
            fenced_batches(&state),
            fences_before + 1,
            "the release the engine took is one fence, and the registry numbers it"
        );
    }

    /// No strip holds this instance, so there is nothing to release and the
    /// unload is the retirement alone: the release must not manufacture a
    /// chain command for a graph that never named the instance, nor number a
    /// fence for a batch it never sent.
    #[test]
    fn unloading_an_unbound_instance_only_retires_it() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "inst-1", vec![]);
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        let fences_before = fenced_batches(&state);

        crate::block_on_test(unload_plugin_runtime("inst-1", None, &state))
            .expect("the unbound instance unloads");

        assert_eq!(
            released_then_retired(&mut command_rx),
            vec!["retire"],
            "an instance in no chain is retired without a release before it"
        );
        assert_eq!(
            fenced_batches(&state),
            fences_before,
            "no batch was sent, so no fence is numbered"
        );
    }

    /// A release the ring refuses is not a release, so the registry keeps the
    /// device and the strip keeps its chain entry. Forgetting them here would
    /// leave the engine's chain naming an effect the retirement is about to
    /// free, with the next `remove-device` finding no device and doing
    /// nothing — the entry would stand until a topology replacement a rolling
    /// engine never gets.
    #[test]
    fn an_unload_whose_chain_release_is_refused_keeps_the_device_in_the_registry() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "inst-1", vec![]);
        let (engine, mut command_rx, retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        bind_the_fixture_to_a_strip(&state, &mut command_rx);
        let fences_before = fenced_batches(&state);

        // The release wants three slots: its one op, that batch's fence, and
        // the retirement's reservation. Two are left, and a reclaimer that is
        // gone refuses the channel swap that would otherwise make room.
        leave_command_ring_with_free_slots(&state, &command_rx, 2);
        drop(retired_adoption_rx);

        let reports = crate::block_on_test(unload_plugin_runtime("inst-1", None, &state))
            .expect("the unload still retires the instance");

        let registry = state.graph.lock().expect("graph registry lock");
        assert!(
            registry.holds_device("d-plugin"),
            "a release the engine refused must leave the device in the registry"
        );
        assert_eq!(
            registry.strip_chain("lead"),
            ["d-plugin"],
            "a release the engine refused must leave the entry in the strip's chain"
        );
        assert_eq!(
            registry.fenced_batches(),
            fences_before,
            "a batch the ring refused is not a fence"
        );
        drop(registry);
        assert_eq!(
            released_then_retired(&mut command_rx),
            vec!["retire"],
            "the refused release reached no ring, so only the retirement did"
        );
        assert!(
            reports.is_empty(),
            "a release the engine refused reports no strip, got: {:?}",
            reports
        );
    }

    /// One track strip whose chain binds three engine-owned fixtures, in
    /// order — for a test that unloads the middle one and reads what the
    /// other two leave behind.
    fn strip_binding_three_fixtures() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "commands": [{
                "kind": "create-track-strip", "trackId": "lead", "name": "Lead",
                "state": { "gain": 1.0, "pan": 0, "muted": false, "soloGated": false,
                           "vcaMultiplier": 1 },
                "devices": [
                    { "id": "d-comp", "name": "Comp", "type": "plugin",
                      "bypassed": false, "parameterValues": {},
                      "externalPluginId": "com.fixture", "externalInstanceId": "inst-comp" },
                    { "id": "d-proq", "name": "Pro-Q", "type": "plugin",
                      "bypassed": false, "parameterValues": {},
                      "externalPluginId": "com.fixture", "externalInstanceId": "inst-proq" },
                    { "id": "d-limiter", "name": "Limiter", "type": "plugin",
                      "bypassed": false, "parameterValues": {},
                      "externalPluginId": "com.fixture", "externalInstanceId": "inst-limiter" }
                ],
                "honorMuted": true, "contributesAudio": true
            }]
        })
    }

    /// One track strip whose chain binds two engine-owned fixtures — for a
    /// test that unloads both in one cascade and reads the strip's one final
    /// report.
    fn strip_binding_two_fixtures() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "commands": [{
                "kind": "create-track-strip", "trackId": "lead", "name": "Lead",
                "state": { "gain": 1.0, "pan": 0, "muted": false, "soloGated": false,
                           "vcaMultiplier": 1 },
                "devices": [
                    { "id": "d-a", "name": "A", "type": "plugin",
                      "bypassed": false, "parameterValues": {},
                      "externalPluginId": "com.fixture", "externalInstanceId": "inst-a" },
                    { "id": "d-b", "name": "B", "type": "plugin",
                      "bypassed": false, "parameterValues": {},
                      "externalPluginId": "com.fixture", "externalInstanceId": "inst-b" }
                ],
                "honorMuted": true, "contributesAudio": true
            }]
        })
    }

    /// Build the strip that binds three fixtures and drain what building it
    /// pushed, so what stays on the ring afterwards is the unload's alone.
    fn bind_three_fixtures_to_a_strip(
        state: &AppState,
        commands: &mut rtrb::Consumer<daw_engine::scheduler::GraphCommand>,
    ) {
        let applied = crate::block_on_test(crate::commands::graph::apply_graph_commands(
            strip_binding_three_fixtures(),
            state,
            &crate::commands::crumbs::CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");
        assert_eq!(
            applied["application"], "applied",
            "the strip must bind all three attached instances, or nothing is released later"
        );
        while commands.pop().is_ok() {}
    }

    /// Build the strip that binds two fixtures and drain what building it
    /// pushed, so what stays on the ring afterwards is the cascade's alone.
    fn bind_two_fixtures_to_a_strip(
        state: &AppState,
        commands: &mut rtrb::Consumer<daw_engine::scheduler::GraphCommand>,
    ) {
        let applied = crate::block_on_test(crate::commands::graph::apply_graph_commands(
            strip_binding_two_fixtures(),
            state,
            &crate::commands::crumbs::CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");
        assert_eq!(
            applied["application"], "applied",
            "the strip must bind both attached instances, or nothing is released later"
        );
        while commands.pop().is_ok() {}
    }

    /// Like [`insert_engine_owned_fixture`], with an explicit engine plugin
    /// id — needed once a test binds more than one fixture to the same
    /// strip, where the fixture helper's fixed id would collide.
    fn insert_engine_owned_fixture_with_id(
        state: &AppState,
        instance_id: &str,
        engine_plugin_id: usize,
    ) {
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Engine Owned Fixture", Vec::new(), true);
        let parameters = wrapper.get_parameters();
        let runtime = Arc::new(SharedHostedPlugin::new(wrapper.into()));
        let mut engine_plugins = state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available");
        engine_plugins.insert(
            instance_id.to_string(),
            EnginePluginInstanceData {
                engine_plugin_id,
                runtime,
                name: "Engine Owned Fixture".to_string(),
                parameters,
                has_gui: true,
                chain_kind: DeviceKind::Effect,
                parameter_events: None,
            },
        );
    }

    /// The reply's `reports` mirror what the strip's chain still holds after
    /// one bound instance releases from it: the two devices this unload does
    /// not touch, in their original chain order.
    #[test]
    fn unloading_a_bound_instance_reports_the_strips_released_chain() {
        let state = AppState::default();
        insert_engine_owned_fixture_with_id(&state, "inst-comp", 201);
        insert_engine_owned_fixture_with_id(&state, "inst-proq", 202);
        insert_engine_owned_fixture_with_id(&state, "inst-limiter", 203);
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        bind_three_fixtures_to_a_strip(&state, &mut command_rx);

        let unload_response = crate::block_on_test(unload_plugin(
            Some(PluginInstanceId("inst-proq".to_string())),
            &NoWindowHost,
            &state,
        ))
        .expect("the bound instance unloads");

        assert_eq!(
            unload_response.reports,
            vec![graph::StripReportPayload {
                kind: "track",
                id: "lead".to_string(),
                device_ids: vec!["d-comp".to_string(), "d-limiter".to_string()],
            }],
            "the reply must report the strip's final chain with the unloaded \
             instance's device gone and the others in their original order, \
             got: {:?}",
            unload_response.reports
        );
    }

    /// An instance no strip holds releases no chain entry, so the reply
    /// reports no strip.
    #[test]
    fn unloading_an_unbound_instance_reports_no_strip() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "inst-1", vec![]);
        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let unload_response = crate::block_on_test(unload_plugin(
            Some(PluginInstanceId("inst-1".to_string())),
            &NoWindowHost,
            &state,
        ))
        .expect("the unbound instance unloads");

        assert!(
            unload_response.reports.is_empty(),
            "an instance no strip holds must report no strip, got: {:?}",
            unload_response.reports
        );
    }

    /// A strip two cascade-unloaded instances share must appear once in the
    /// reply, carrying its final chain — not once per instance that touched
    /// it, each with an intermediate one.
    #[test]
    fn an_unkeyed_unload_reports_each_released_strip_once_with_its_final_chain() {
        let state = AppState::default();
        insert_engine_owned_fixture_with_id(&state, "inst-a", 301);
        insert_engine_owned_fixture_with_id(&state, "inst-b", 302);
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        bind_two_fixtures_to_a_strip(&state, &mut command_rx);

        let cascade_response = crate::block_on_test(unload_plugin(None, &NoWindowHost, &state))
            .expect("the cascade call itself does not fail");

        assert_eq!(
            cascade_response.reports,
            vec![graph::StripReportPayload {
                kind: "track",
                id: "lead".to_string(),
                device_ids: Vec::new(),
            }],
            "the strip both instances shared must appear exactly once, \
             carrying its final (empty) chain, got: {:?}",
            cascade_response.reports
        );
    }

    /// The wire reply is a hand-maintained mirror on the TypeScript side;
    /// pin its spellings the way `graph`'s own result payload pins its own.
    #[test]
    fn the_unload_reply_serializes_with_the_contract_spellings() {
        let reply = serde_json::to_string(&PluginUnloadReply {
            unloaded_instance_ids: vec!["inst-1".to_string()],
            errors: vec!["inst-2: still mid-unload".to_string()],
            reports: vec![graph::StripReportPayload {
                kind: "track",
                id: "lead".to_string(),
                device_ids: vec!["d-comp".to_string()],
            }],
        })
        .expect("the unload reply serializes");
        assert_eq!(
            reply,
            concat!(
                r#"{"unloadedInstanceIds":["inst-1"],"errors":["inst-2: still mid-unload"],"#,
                r#""reports":[{"kind":"track","id":"lead","deviceIds":["d-comp"]}]}"#
            )
        );
    }

    #[test]
    fn get_plugin_state_reads_engine_owned_runtime_owner_through_command_state() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", vec![1, 2, 3]);

        let result = read_plugin_state_chunk("engine-owned-fixture", &state);

        assert_eq!(result, Ok(vec![1, 2, 3]));
    }

    #[test]
    fn set_plugin_state_writes_engine_owned_runtime_owner_through_command_state() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", vec![1, 2, 3]);

        let set_result = write_plugin_state_chunk("engine-owned-fixture", &[9, 8, 7], &state);
        let get_result = read_plugin_state_chunk("engine-owned-fixture", &state);

        assert_eq!(set_result, Ok(()));
        assert_eq!(get_result, Ok(vec![9, 8, 7]));
    }

    /// The body's contract is the bytes; how they cross the wire is the
    /// shell's business.
    #[test]
    fn get_plugin_state_bytes_returns_the_stored_chunk() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", vec![1, 2, 3]);

        let response = crate::block_on_test(get_plugin_state_bytes(
            PluginInstanceId("engine-owned-fixture".to_string()),
            &state,
        ))
        .expect("state read should succeed");

        assert_eq!(response, vec![1, 2, 3]);
    }

    #[test]
    fn get_plugin_state_bytes_preserves_zero_and_high_bytes_verbatim() {
        let state = AppState::default();
        let chunk = vec![0u8, 1, 127, 128, 200, 254, 255, 0];
        insert_engine_owned_fixture(&state, "engine-owned-fixture", chunk.clone());

        let response = crate::block_on_test(get_plugin_state_bytes(
            PluginInstanceId("engine-owned-fixture".to_string()),
            &state,
        ))
        .expect("state read should succeed");

        assert_eq!(response, chunk);
    }

    #[test]
    fn plugin_state_round_trips_every_byte_value_through_the_shared_chunk_accessors() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", Vec::new());
        let chunk: Vec<u8> = (0..=255u8).collect();

        write_plugin_state_chunk("engine-owned-fixture", &chunk, &state)
            .expect("state write should succeed");
        let restored = read_plugin_state_chunk("engine-owned-fixture", &state)
            .expect("state read should succeed");

        assert_eq!(restored, chunk);
    }

    #[test]
    fn plugin_state_accessors_reject_an_unknown_instance() {
        let state = AppState::default();

        let read = read_plugin_state_chunk("no-such-instance", &state);
        let write = write_plugin_state_chunk("no-such-instance", &[1], &state);

        assert_eq!(
            read,
            Err("No plugin instance: no-such-instance".to_string())
        );
        assert_eq!(
            write,
            Err("No plugin instance: no-such-instance".to_string())
        );
    }

    #[test]
    fn update_parameter_cache_after_enqueue_updates_only_after_success() {
        let mut parameters = vec![plugin_parameter(7, 0.25)];

        let result = update_parameter_cache_after_enqueue(&mut parameters, 7, 0.75, Ok(()));

        assert!(result.is_ok());
        assert_eq!(parameters[0].value, 0.75);
    }

    #[test]
    fn update_parameter_cache_after_enqueue_preserves_cache_when_queue_is_full() {
        let mut parameters = vec![plugin_parameter(7, 0.25)];

        let result = update_parameter_cache_after_enqueue(
            &mut parameters,
            7,
            0.75,
            Err("Pending parameter queue full for plugin 'test'".to_string()),
        );

        assert_eq!(
            result,
            Err("Pending parameter queue full for plugin 'test'".to_string())
        );
        assert_eq!(parameters[0].value, 0.25);
    }

    #[test]
    fn update_parameter_cache_after_enqueue_preserves_cache_when_runtime_is_unavailable() {
        let mut parameters = vec![plugin_parameter(7, 0.25)];

        let result = update_parameter_cache_after_enqueue(
            &mut parameters,
            7,
            0.75,
            Err("No engine-owned plugin instance: test".to_string()),
        );

        assert_eq!(
            result,
            Err("No engine-owned plugin instance: test".to_string())
        );
        assert_eq!(parameters[0].value, 0.25);
    }

    #[test]
    fn remove_engine_plugin_record_after_scheduler_removal_preserves_record_on_queue_failure() {
        let mut engine_plugins =
            std::collections::HashMap::from([("engine-owned-1".to_string(), 42_u32)]);

        let result = remove_engine_plugin_record_after_scheduler_removal(
            &mut engine_plugins,
            "engine-owned-1",
            Err("Audio command queue full".to_string()),
        );

        assert_eq!(result, Err("Audio command queue full".to_string()));
        assert_eq!(engine_plugins.get("engine-owned-1"), Some(&42_u32));
    }

    #[test]
    fn remove_engine_plugin_record_after_scheduler_removal_removes_record_after_acceptance() {
        let mut engine_plugins =
            std::collections::HashMap::from([("engine-owned-1".to_string(), 42_u32)]);

        let result = remove_engine_plugin_record_after_scheduler_removal(
            &mut engine_plugins,
            "engine-owned-1",
            Ok(()),
        );

        assert_eq!(result, Ok(Some(42_u32)));
        assert!(!engine_plugins.contains_key("engine-owned-1"));
    }

    // ── Registry indexing: path hash primary, descriptor id secondary ───
    //
    // A plugin's persisted id is a hash of its file path, so moving or
    // upgrading the plugin changes the id and a saved project stops resolving.
    // The CLAP descriptor carries a path-independent id, which the scanner now
    // keeps. Indexing under both means a project that recorded either one
    // resolves — strictly additive: the path hash is inserted first and is never
    // displaced, so nothing that resolves today stops resolving.

    fn scanned(id: &str, descriptor_id: &str, format: &str) -> ScannedPlugin {
        ScannedPlugin {
            id: id.to_string(),
            name: format!("Plugin {id}"),
            vendor: "Vendor".to_string(),
            format: format.to_string(),
            category: "effect".to_string(),
            path: format!("/plugins/{id}.clap"),
            version: "1.0.0".to_string(),
            descriptor_id: descriptor_id.to_string(),
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 0,
            has_custom_ui: true,
            parameters: Some(vec![]),
            parameter_metadata_reason: None,
            capability_metadata_reason: None,
        }
    }

    // ── Scan deduplication: one plugin, however many copies are installed ──

    fn candidate(path: &str, format: PluginFormat) -> scanner::ScanCandidate {
        scanner::ScanCandidate {
            path: PathBuf::from(path),
            format,
        }
    }

    /// The rule the VST3 specification states for its own folders, applied to
    /// the identity field every hosted format fills.
    #[test]
    fn a_plugin_found_in_two_roots_keeps_the_higher_priority_copy() {
        let mut plugins = vec![
            scanned("user-copy", "com.vendor.reverb", "vst3"),
            scanned("system-copy", "com.vendor.reverb", "vst3"),
        ];

        retain_first_plugin_per_identity(&mut plugins);

        assert_eq!(
            plugins.iter().map(|plugin| &plugin.id).collect::<Vec<_>>(),
            ["user-copy"],
            "the copy the earlier root offered is the one the host keeps"
        );
    }

    /// Two formats may legitimately reuse one vendor identifier, and a CLAP and
    /// a VST3 build of the same plugin are two different plugins to load.
    #[test]
    fn one_identity_under_two_formats_is_two_plugins() {
        let mut plugins = vec![
            scanned("clap-build", "com.vendor.reverb", "clap"),
            scanned("vst3-build", "com.vendor.reverb", "vst3"),
        ];

        retain_first_plugin_per_identity(&mut plugins);

        assert_eq!(plugins.len(), 2);
    }

    /// An absent identity is not evidence that two files are the same plugin,
    /// so a scan that could not read one must not collapse the rest onto it.
    #[test]
    fn plugins_with_no_identity_are_never_deduplicated() {
        let mut plugins = vec![
            scanned("first-unreadable", "", "vst3"),
            scanned("second-unreadable", "", "vst3"),
        ];

        retain_first_plugin_per_identity(&mut plugins);

        assert_eq!(plugins.len(), 2);
    }

    /// Two authorized roots can nest, so the same file can be walked twice. The
    /// survivor is the first sighting, which is the higher-priority root's.
    #[test]
    fn a_path_walked_under_two_roots_is_scanned_once() {
        let mut candidates = vec![
            candidate("/user/Reverb.vst3", PluginFormat::Vst3),
            candidate("/system/Delay.vst3", PluginFormat::Vst3),
            candidate("/user/Reverb.vst3", PluginFormat::Vst3),
        ];

        retain_first_candidate_per_path(&mut candidates);

        assert_eq!(
            candidates,
            vec![
                candidate("/user/Reverb.vst3", PluginFormat::Vst3),
                candidate("/system/Delay.vst3", PluginFormat::Vst3),
            ],
            "deduplication must not reorder the roots it was given"
        );
    }

    /// A temp plugin folder, a registry file next to it, and a policy that
    /// authorizes only that folder — the platform defaults are the developer's
    /// real plugin directories and no test may write into those.
    struct PersistedRegistryFixture {
        root: PathBuf,
    }

    impl PersistedRegistryFixture {
        fn create(test_name: &str) -> Self {
            // Canonical: the scan policy refuses any path with a symlink
            // component, and the platform temp directory reaches through one on
            // macOS. Left uncanonicalized, every hydration here would refuse for
            // that reason instead of the one under test.
            let root = std::fs::canonicalize(std::env::temp_dir())
                .expect("the temp directory should resolve")
                .join(
                    unique_temp_scan_root(test_name)
                        .file_name()
                        .expect("the unique root should have a name"),
                );
            std::fs::create_dir_all(root.join("plugins"))
                .expect("test plugin folder should be created");
            Self { root }
        }

        fn scan_policy(&self) -> PluginScanPolicy {
            PluginScanPolicy::with_allowed_roots(vec![self.root.join("plugins")])
        }

        /// A store over the fixture's registry file. Called again for the next
        /// launch: nothing carries over but what reached the file.
        fn store(&self) -> PluginRegistryStore {
            PluginRegistryStore::at(self.root.join("plugin-registry.json"))
        }

        fn write_plugin_file(&self, file_name: &str, contents: &[u8]) -> PathBuf {
            let path = self.root.join("plugins").join(file_name);
            std::fs::write(&path, contents).expect("test plugin file should be written");
            path
        }

        fn persist(&self, plugin_id: &str, path: &Path) {
            self.store().persist(&[ScanRow {
                keys: vec![plugin_id.to_string()],
                plugin: ScannedPlugin {
                    id: plugin_id.to_string(),
                    name: "Vendor Reverb".to_string(),
                    vendor: "Vendor".to_string(),
                    format: "clap".to_string(),
                    category: "effect".to_string(),
                    path: path.display().to_string(),
                    version: "1.0.0".to_string(),
                    descriptor_id: "com.vendor.reverb".to_string(),
                    num_inputs: 2,
                    num_outputs: 2,
                    num_parameters: 0,
                    has_custom_ui: true,
                    parameters: Some(Vec::new()),
                    parameter_metadata_reason: None,
                    capability_metadata_reason: None,
                },
            }]);
        }
    }

    impl Drop for PersistedRegistryFixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    /// The defect this packet closes: a saved project reopened in a new session
    /// resolved nothing, because the registry only ever lived in the process
    /// that scanned. Activation must resolve from the persisted registry with
    /// no scan and no rescan.
    #[test]
    fn an_activation_resolves_a_persisted_plugin_with_no_scan_this_session() {
        let fixture = PersistedRegistryFixture::create("activation-hydrate");
        let plugin_path = fixture.write_plugin_file("Reverb.clap", b"clap-bytes");
        fixture.persist("aaaa1111", &plugin_path);

        let next_launch_registry = Mutex::new(HashMap::new());
        let entry = resolve_registry_entry(
            &next_launch_registry,
            &fixture.store(),
            &fixture.scan_policy(),
            "aaaa1111",
            |_format, path, _plugin_id, _descriptor_id| {
                panic!("a hydrated registry must resolve without rescanning {path:?}")
            },
        )
        .expect("the persisted plugin must resolve in a new session");

        assert_eq!(entry.path, plugin_path.display().to_string());
        assert_eq!(entry.descriptor_id, "com.vendor.reverb");
    }

    /// A plugin updated in place fails hydration's staleness check, which is
    /// correct — and would strand the user if it ended there. One bounded
    /// rescan of the file the registry already knows about is the difference
    /// between "your project opens" and "go and rescan".
    #[test]
    fn an_activation_miss_rescans_the_last_known_path_once() {
        let fixture = PersistedRegistryFixture::create("activation-rescan");
        let plugin_path = fixture.write_plugin_file("Reverb.clap", b"clap-bytes");
        fixture.persist("aaaa1111", &plugin_path);
        std::fs::write(&plugin_path, b"clap-bytes-version-2")
            .expect("the plugin should be updated in place");

        let rescans = std::cell::Cell::new(0);
        let registry = Mutex::new(HashMap::new());
        let store = fixture.store();
        let entry = resolve_registry_entry(
            &registry,
            &store,
            &fixture.scan_policy(),
            "aaaa1111",
            |format, path, _plugin_id, _descriptor_id| {
                rescans.set(rescans.get() + 1);
                // The rescan is told which format to read the file as, from the
                // row that recorded it. Deriving it from the extension here
                // instead would let a rename pick the extractor.
                assert_eq!(
                    format, "clap",
                    "the targeted rescan must be handed the persisted row's format"
                );
                Ok(ScannedPlugin {
                    id: "aaaa1111".to_string(),
                    name: "Vendor Reverb 2".to_string(),
                    vendor: "Vendor".to_string(),
                    format: "clap".to_string(),
                    category: "effect".to_string(),
                    path: path.display().to_string(),
                    version: "2.0.0".to_string(),
                    descriptor_id: "com.vendor.reverb".to_string(),
                    // A targeted rescan reads the descriptor only, so it
                    // reports no capabilities and no parameters, and says so.
                    num_inputs: 0,
                    num_outputs: 0,
                    num_parameters: 0,
                    has_custom_ui: false,
                    parameters: None,
                    parameter_metadata_reason: None,
                    capability_metadata_reason: Some(
                        scanner::CAPABILITY_METADATA_UNAVAILABLE_REASON.to_string(),
                    ),
                })
            },
        )
        .expect("a plugin still at its last known path must resolve");

        assert_eq!(entry.name, "Vendor Reverb 2");
        assert_eq!(rescans.get(), 1, "the miss gets one rescan, not a sweep");
        assert_eq!(
            registry
                .lock()
                .expect("registry lock")
                .get("aaaa1111")
                .expect("the rescan result must be in the registry")
                .name,
            "Vendor Reverb 2"
        );

        // And it is durable: the refreshed fingerprint means the next launch
        // hydrates it instead of rescanning again.
        let next_launch_registry = Mutex::new(HashMap::new());
        fixture
            .store()
            .hydrate_into(&next_launch_registry, &fixture.scan_policy());
        assert_eq!(
            next_launch_registry
                .lock()
                .expect("registry lock")
                .get("aaaa1111")
                .expect("the rescan result must have been saved")
                .name,
            "Vendor Reverb 2"
        );
    }

    /// The rescan is bounded per process, not per attempt. `activateExternalPlugin`
    /// releases its in-flight guard when activation fails, and the frontend
    /// rebuilds a project's live strip on every transport start, so a project
    /// whose plugins have all moved asks again on every Play — once per plugin.
    /// Each unbounded ask is a scan-worker child process that runs up to the
    /// rescan timeout.
    #[test]
    fn a_miss_already_rescanned_this_process_does_not_rescan_again() {
        let fixture = PersistedRegistryFixture::create("activation-rescan-once");
        let plugin_path = fixture.write_plugin_file("Reverb.clap", b"clap-bytes");
        fixture.persist("aaaa1111", &plugin_path);
        std::fs::remove_file(&plugin_path).expect("the plugin should be removable");

        let store = fixture.store();
        let registry = Mutex::new(HashMap::new());
        let rescans = std::cell::Cell::new(0);
        // Borrows the counter rather than owning it, so the same closure can be
        // handed to both calls: the point of the test is that only one of them
        // reaches it.
        let rescan = |_format: &str, path: &Path, _plugin_id: &str, _descriptor_id: &str| {
            rescans.set(rescans.get() + 1);
            Err::<ScannedPlugin, String>(format!("no such file: {}", path.display()))
        };

        let first = resolve_registry_entry(
            &registry,
            &store,
            &fixture.scan_policy(),
            "aaaa1111",
            rescan,
        )
        .expect_err("a removed plugin must not resolve");
        let second = resolve_registry_entry(
            &registry,
            &store,
            &fixture.scan_policy(),
            "aaaa1111",
            rescan,
        )
        .expect_err("a removed plugin must not resolve");

        assert_eq!(
            rescans.get(),
            1,
            "the second activation must answer from the recorded refusal, not spawn another scan"
        );
        assert_eq!(
            second, first,
            "the recorded refusal must be the one the user already saw"
        );
    }

    /// "Run a scan first" was wrong nearly every time it was shown: the user
    /// had scanned, in the session that recorded this plugin, and rescanning
    /// would not have found it because it is not there any more. Say what
    /// happened, and to which plugin.
    #[test]
    fn an_activation_miss_names_the_plugin_and_its_last_known_path() {
        let fixture = PersistedRegistryFixture::create("activation-moved");
        let plugin_path = fixture.write_plugin_file("Reverb.clap", b"clap-bytes");
        fixture.persist("aaaa1111", &plugin_path);
        std::fs::remove_file(&plugin_path).expect("the plugin should be removable");

        let error = resolve_registry_entry(
            &Mutex::new(HashMap::new()),
            &fixture.store(),
            &fixture.scan_policy(),
            "aaaa1111",
            |_format, path, _plugin_id, _descriptor_id| {
                Err(format!("no such file: {}", path.display()))
            },
        )
        .expect_err("a removed plugin must not resolve");

        assert!(
            error.contains("Vendor Reverb") && error.contains(&plugin_path.display().to_string()),
            "the refusal must name the plugin and where it was last seen, got: {error}"
        );
        assert!(
            !error.contains("Run a scan first"),
            "a plugin that moved is not a plugin that was never scanned, got: {error}"
        );
    }

    #[test]
    fn a_scanned_plugin_resolves_by_its_path_hash() {
        let registry = index_scanned_plugins(&[scanned("aaaa1111", "com.vendor.reverb", "clap")]);

        let entry = registry.get("aaaa1111").expect("path hash resolves");
        assert_eq!(entry.path, "/plugins/aaaa1111.clap");
        assert_eq!(entry.descriptor_id, "com.vendor.reverb");
    }

    /// The persisted registry's row cap multiplies by
    /// `SCANNED_PLUGIN_KEY_CAPACITY`, and this is the producer the number
    /// describes. A cap above what the producer writes wastes nothing, but a
    /// cap below it makes the reader refuse a document this build's own scan
    /// wrote — at every launch, with no recovery but deleting the file.
    ///
    /// Mutation this catches: moving the constant without moving the keying,
    /// or keying a plugin an extra way without raising the constant.
    #[test]
    fn key_scanned_plugins_fills_the_capacity_the_registry_row_cap_multiplies_by() {
        let rows = key_scanned_plugins(&[scanned("aaaa1111", "com.vendor.reverb", "clap")]);

        let [row] = rows.as_slice() else {
            panic!("one scanned plugin is one row, got {}", rows.len());
        };
        assert_eq!(
            row.keys.len(),
            SCANNED_PLUGIN_KEY_CAPACITY,
            "a plugin with its own descriptor id takes every key the row cap \
             budgets for it, got {:?}",
            row.keys
        );
    }

    #[test]
    fn the_same_plugin_also_resolves_by_its_descriptor_id_after_it_moves() {
        let registry = index_scanned_plugins(&[scanned("aaaa1111", "com.vendor.reverb", "clap")]);

        // A project that recorded the descriptor id survives the file moving,
        // because the descriptor id does not encode the path.
        let entry = registry
            .get("com.vendor.reverb")
            .expect("descriptor id resolves the same plugin");
        assert_eq!(entry.path, "/plugins/aaaa1111.clap");
    }

    #[test]
    fn a_descriptor_id_never_displaces_a_path_hash_entry() {
        // Contrived collision: one plugin's descriptor id equals another's path
        // hash. The path hash is the primary key and must win, or an existing
        // project would silently start resolving to a different plugin.
        let registry = index_scanned_plugins(&[
            scanned("collides", "unrelated.id", "clap"),
            scanned("bbbb2222", "collides", "clap"),
        ]);

        let entry = registry.get("collides").expect("primary key survives");
        assert_eq!(
            entry.path, "/plugins/collides.clap",
            "the path-hash owner keeps the key"
        );
    }

    /// A poisoned registry lock used to be swallowed, so the scan returned
    /// plugins while the registry stayed empty and every later load blamed the
    /// user for not scanning.
    ///
    /// This exercises the publisher against a bare `Mutex`, not the `scan_plugins`
    /// command: the command path is covered by reading plus the reader-side test
    /// `load_plugin_reads_past_a_poisoned_registry_lock`, which drives the whole
    /// publish-then-load sequence through the managed state.
    #[test]
    fn a_poisoned_registry_still_receives_the_scan_results() {
        let plugin_registry: Mutex<HashMap<String, PluginRegistryEntry>> =
            Mutex::new(HashMap::new());

        let poisoning = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = plugin_registry.lock().expect("first lock should succeed");
            panic!("poison the registry lock");
        }));
        assert!(poisoning.is_err());
        assert!(plugin_registry.is_poisoned());

        publish_scan_results_in_registry(
            &plugin_registry,
            &PluginRegistryStore::in_memory_only(),
            &[],
            &[],
            true,
            &[scanned("aaaa1111", "com.vendor.reverb", "clap")],
        );

        let registry = plugin_registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(
            registry.contains_key("aaaa1111"),
            "a scan that reports plugins must leave them resolvable"
        );
    }

    #[test]
    fn a_plugin_with_no_descriptor_id_is_indexed_once() {
        // VST3 and AU carry no CLAP descriptor, and an empty id must never
        // become a key that every such plugin fights over.
        let registry = index_scanned_plugins(&[
            scanned("cccc3333", "", "vst3"),
            scanned("dddd4444", "", "au"),
        ]);

        assert_eq!(registry.len(), 2);
        assert!(!registry.contains_key(""));
    }

    #[test]
    fn scan_path_authorization_query_round_trips_the_scan_policy_verdict() {
        // The verdict the settings UI gates a saved scan folder on must be
        // the verdict the scan itself enforces for the same path: `true` for
        // a platform root, `false` for a path outside them.
        let allowed_root = PluginScanPolicy::platform_defaults()
            .allowed_roots_as_strings()
            .first()
            .expect("platform default plugin roots should exist")
            .clone();
        let refused_path = std::env::temp_dir()
            .join("sourdaw-ungranted-query-root")
            .display()
            .to_string();

        let allowed = crate::block_on_test(is_scan_path_authorized(allowed_root))
            .expect("query should answer");
        let refused = crate::block_on_test(is_scan_path_authorized(refused_path))
            .expect("query should answer");

        assert!(allowed, "a platform default root must be authorized");
        assert!(
            !refused,
            "a path outside the platform roots must be refused"
        );
    }

    // ── Multi-plugin bundles ────────────────────────────────────────────────

    /// A bundle rescanned at activation resolves the sibling the key names: a
    /// saved project that recorded the second plugin's descriptor id must get
    /// the second plugin back, not the bundle's first.
    #[test]
    fn a_rescanned_bundle_resolves_the_sibling_the_key_names() {
        let bundle = scanner::scanned_bundle_plugins(
            Path::new("/plugins/TwoPlugins.clap"),
            vec![
                descriptor("com.vendor.first"),
                descriptor("com.vendor.second"),
            ],
        );

        let picked = pick_rescanned_bundle_row(&bundle, "com.vendor.second", "irrelevant")
            .expect("a bundle sibling is addressed by its descriptor id");
        assert_eq!(picked.descriptor_id, "com.vendor.second");

        assert!(
            pick_rescanned_bundle_row(&[], "any", "com.vendor.first").is_none(),
            "an empty bundle is a refusal, not a guess"
        );
    }

    /// A stale key — the path re-spelled so its hash changed, or a vendor id
    /// that no longer matches — must still load the plugin the user was using,
    /// which the persisted descriptor id names. Guessing the bundle's first
    /// plugin here would load a different plugin and hand it the sibling's
    /// state blob.
    #[test]
    fn a_stale_key_resolves_through_the_last_known_descriptor_id() {
        let bundle = scanner::scanned_bundle_plugins(
            Path::new("/plugins/TwoPlugins.clap"),
            vec![
                descriptor("com.vendor.first"),
                descriptor("com.vendor.second"),
            ],
        );

        let picked = pick_rescanned_bundle_row(&bundle, "stale-key", "com.vendor.second")
            .expect("the persisted descriptor id still names a plugin in the bundle");
        assert_eq!(
            picked.descriptor_id, "com.vendor.second",
            "the sibling the user was using loads, not the bundle's first plugin"
        );

        // A single-plugin bundle recovers the same way: the requested key is
        // the old path hash and the descriptor id names the one row there is.
        let single = scanner::scanned_bundle_plugins(
            Path::new("/plugins/Moved.clap"),
            vec![descriptor("com.vendor.only")],
        );
        let recovered = pick_rescanned_bundle_row(&single, "old-path-hash", "com.vendor.only")
            .expect("a moved single-plugin bundle still resolves");
        assert_eq!(
            recovered.id,
            scanner::stable_id(Path::new("/plugins/Moved.clap"))
        );
    }

    /// When neither the key nor the persisted descriptor id names a row, the
    /// bundle genuinely changed and there is no honest row to return.
    #[test]
    fn a_stale_key_with_no_matching_descriptor_id_is_an_error_not_a_guess() {
        let bundle = scanner::scanned_bundle_plugins(
            Path::new("/plugins/TwoPlugins.clap"),
            vec![
                descriptor("com.vendor.first"),
                descriptor("com.vendor.second"),
            ],
        );

        assert!(
            pick_rescanned_bundle_row(&bundle, "stale-key", "com.vendor.renamed-away").is_none(),
            "no matching key and no matching descriptor id must refuse, not load the first plugin"
        );

        assert!(
            pick_rescanned_bundle_row(&bundle, "stale-key", "").is_none(),
            "a format with no descriptor id has nothing to fall back on"
        );
    }

    fn descriptor(descriptor_id: &str) -> scanner::ScannedDescriptor {
        scanner::ScannedDescriptor {
            format: "clap".to_string(),
            name: Some(format!("Plugin {descriptor_id}")),
            vendor: "Vendor".to_string(),
            descriptor_id: descriptor_id.to_string(),
            version: "1.0.0".to_string(),
            category: "effect".to_string(),
            parameters: None,
            parameter_metadata_reason: None,
            capabilities: None,
        }
    }
}
