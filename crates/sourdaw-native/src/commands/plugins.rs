//! Plugin scanning, loading, and parameter management.

use crate::host::native_bridge::{ClapPluginSlot, SharedClapPlugin};
use crate::host::plugin_scan_policy::PluginScanPolicy;
use crate::host::plugin_scan_worker;
use crate::host::plugin_window::PluginWindowHost;
use crate::state::{AppState, PluginInstanceData, PluginRegistryEntry};
use cpal::traits::{DeviceTrait, HostTrait};
use daw_engine::audio_bridge::{create_audio_bridge, MAX_BLOCK_FRAMES};
use daw_engine::plugin_slot::{MidiNoteEvent, TransportState};
use daw_engine::EngineHandle;
use daw_plugin_host::scanner::{self, ScanResult, ScannedPlugin};
use daw_plugin_host::{AudioPlugin, ClapWrapper};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering as AtomicOrdering;
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
    /// Raw CLAP latency, in frames of the rate the plugin was activated with.
    /// Informational only — do not convert it outside this process, the frontend
    /// does not share that clock. Use `latency_ms`.
    pub latency_samples: u32,
    /// Latency in milliseconds, converted host-side at the activation sample rate.
    /// This is the value the frontend feeds into latency compensation.
    pub latency_ms: f64,
    pub engine_plugin_id: Option<usize>,
}

pub type PluginUnloadResult = (Vec<String>, Vec<String>);
static PLUGIN_LIFECYCLE_GATES: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PLUGIN_RUNTIME_GATE: tokio::sync::RwLock<()> = tokio::sync::RwLock::const_new(());
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
fn remove_engine_plugin_record_after_scheduler_removal<EnginePluginRecord>(
    engine_plugins: &mut HashMap<String, EnginePluginRecord>,
    instance_id: &str,
    scheduler_removal_result: Result<(), String>,
) -> Result<Option<EnginePluginRecord>, String> {
    scheduler_removal_result?;
    Ok(engine_plugins.remove(instance_id))
}

// ── Scanning commands ───────────────────────────────────────────────────

const MAX_SCAN_CANDIDATES: usize = 256;
const MAX_SCAN_DURATION: Duration = Duration::from_secs(30);
static PLUGIN_SCAN_PERMIT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

/// Build the lookup table `load_plugin` resolves against.
///
/// Two keys per CLAP plugin, on purpose. The primary key is `ScannedPlugin::id`,
/// a hash of the file path — which is exactly why it is fragile: move the plugin
/// or install a version under a new path and a saved project's recorded id
/// resolves nothing. The secondary key is the CLAP descriptor's own id, which
/// carries no path and therefore survives the move.
///
/// Additive by construction: every primary key is inserted first and a
/// descriptor id may only fill a vacancy, never displace one. Nothing that
/// resolves today stops resolving, and there is no migration to run. Making the
/// descriptor id primary would be the stronger fix, but it would change every
/// saved project's recorded id at once — deliberately not done here, and it
/// stays available once there is a migration story.
///
/// An empty descriptor id is never a key: VST3 and AU carry no CLAP descriptor,
/// and they would otherwise all collide on `""`.
fn index_scanned_plugins(plugins: &[ScannedPlugin]) -> HashMap<String, PluginRegistryEntry> {
    let mut registry = HashMap::new();

    for plugin in plugins {
        registry.insert(
            plugin.id.clone(),
            PluginRegistryEntry {
                path: plugin.path.clone(),
                clap_id: plugin.clap_id.clone(),
                format: plugin.format.clone(),
                name: plugin.name.clone(),
            },
        );
    }

    for plugin in plugins {
        if plugin.clap_id.is_empty() {
            continue;
        }
        registry
            .entry(plugin.clap_id.clone())
            .or_insert_with(|| PluginRegistryEntry {
                path: plugin.path.clone(),
                clap_id: plugin.clap_id.clone(),
                format: plugin.format.clone(),
                name: plugin.name.clone(),
            });
    }

    registry
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
fn publish_scan_results_in_registry(
    plugin_registry: &Mutex<HashMap<String, PluginRegistryEntry>>,
    authorized_paths: &[PathBuf],
    scanned_paths: &[PathBuf],
    scan_complete: bool,
    plugins: &[ScannedPlugin],
) {
    let mut registry = plugin_registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    registry.retain(|_, entry| {
        let path = Path::new(&entry.path);
        if scan_complete {
            return !authorized_paths.iter().any(|root| path.starts_with(root));
        }
        !scanned_paths.iter().any(|scanned| scanned == path)
    });
    registry.extend(index_scanned_plugins(plugins));
}

pub async fn scan_plugins(paths: Vec<String>, state: &AppState) -> Result<ScanResult, String> {
    let permit = PLUGIN_SCAN_PERMIT
        .try_acquire()
        .map_err(|_| "Plugin scan already in progress".to_string())?;
    let start = std::time::Instant::now();
    let scan_policy = PluginScanPolicy::platform_defaults();
    let mut authorized_paths = Vec::new();
    let mut errors = Vec::new();

    for scan_path in &paths {
        let path = PathBuf::from(scan_path);
        if let Err(error) = scan_policy.authorize_scan_root(&path) {
            errors.push(error);
            continue;
        }

        if !path.is_dir() {
            errors.push(format!("Not a directory: {}", scan_path));
            continue;
        }
        authorized_paths.push(path);
    }

    let scan_roots = authorized_paths.clone();
    let deadline = start + MAX_SCAN_DURATION;
    let (plugins, scan_errors, scanned_paths, scan_complete) =
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let mut candidates = Vec::new();
            let mut scan_errors = Vec::new();
            let mut scan_complete = true;
            for path in scan_roots {
                if !scanner::scan_directory_bounded(
                    &path,
                    &mut candidates,
                    &mut scan_errors,
                    (MAX_SCAN_CANDIDATES, deadline),
                ) {
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
            candidates.sort();
            candidates.dedup();
            let mut plugins = Vec::new();
            let mut scanned_paths = Vec::new();
            for candidate in candidates {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    scan_errors.push("Plugin scan time limit exceeded".to_string());
                    scan_complete = false;
                    break;
                }
                scanned_paths.push(candidate.clone());
                match plugin_scan_worker::scan_clap_metadata(&candidate, remaining) {
                    Ok(mut metadata) => {
                        let parameter_remaining =
                            deadline.saturating_duration_since(Instant::now());
                        if parameter_remaining.is_zero() {
                            metadata.parameter_metadata_reason =
                                Some(scanner::PARAMETER_METADATA_UNAVAILABLE_REASON.to_string());
                        } else if let Ok(parameters) =
                            plugin_scan_worker::scan_clap_parameter_metadata(
                                &candidate,
                                parameter_remaining,
                            )
                        {
                            metadata.parameters = Some(parameters);
                        } else {
                            metadata.parameter_metadata_reason =
                                Some(scanner::PARAMETER_METADATA_UNAVAILABLE_REASON.to_string());
                        }
                        plugins.push(scanner::scanned_plugin(&candidate, metadata));
                    }
                    Err(error) => scan_errors.push(format!("{}: {error}", candidate.display())),
                }
            }
            (plugins, scan_errors, scanned_paths, scan_complete)
        })
        .await
        .map_err(|error| format!("Plugin scan task failed: {error}"))?;
    errors.extend(scan_errors);

    // Populate the plugin registry so load_plugin can find them. The scanner
    // already read every CLAP descriptor; this used to re-`dlopen` each one to
    // recover the id it had thrown away.
    publish_scan_results_in_registry(
        &state.plugin_registry,
        &authorized_paths,
        &scanned_paths,
        scan_complete,
        &plugins,
    );

    if !scan_complete {
        return Err("Plugin scan did not complete within safety limits".to_string());
    }

    Ok(ScanResult {
        plugins,
        errors,
        scan_duration_ms: start.elapsed().as_millis() as u64,
    })
}

pub async fn get_default_plugin_paths() -> Result<Vec<String>, String> {
    Ok(PluginScanPolicy::platform_defaults().allowed_roots_as_strings())
}

// ── Instance lifecycle commands ─────────────────────────────────────────

pub async fn load_plugin(
    plugin_id: PluginId,
    instance_id: PluginInstanceId,
    state: &AppState,
) -> Result<PluginInstance, String> {
    let _runtime_guard = PLUGIN_RUNTIME_GATE.read().await;
    let _lifecycle_guard = lock_plugin_lifecycle(&instance_id.0).await;
    ensure_plugin_instance_id_available(&state, &instance_id.0)?;
    let entry = {
        // Recovered, not refused, for the same reason the publisher recovers:
        // the registry is a lookup table rebuilt wholesale by every scan, so a
        // panic elsewhere leaves no state a reader must distrust. Refusing here
        // meant a poisoned lock let the scan publish while every later load
        // failed forever with a lock error the user could do nothing about.
        let registry = state
            .plugin_registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        registry.get(&plugin_id.0).cloned().ok_or_else(|| {
            format!(
                "Plugin {} not found in registry. Run a scan first.",
                plugin_id.0
            )
        })?
    };

    match entry.format.as_str() {
        "clap" => {
            // A CLAP id is the descriptor's own reverse-DNS identifier and the
            // key the entry point resolves a plugin by. The display name is not
            // one: substituting it produced a wrapper failure that named a
            // plugin that was found and blamed something else, and two plugins
            // sharing a display name would have resolved to each other. An empty
            // id means the scan of this file yielded no usable descriptor, so
            // say that, and say which file.
            if entry.clap_id.is_empty() {
                return Err(format!(
                    "CLAP plugin {} reports no descriptor id in the registry entry for {}. Rescan the plugin directory.",
                    entry.path, plugin_id.0
                ));
            }
            let clap_id = entry.clap_id.clone();

            // Query the real device sample rate so the plugin is activated at the correct rate.
            let sample_rate = cpal::default_host()
                .default_output_device()
                .and_then(|d| d.default_output_config().ok())
                .map(|c| c.sample_rate() as f64)
                .unwrap_or(48000.0);

            let wrapper = ClapWrapper::new(&entry.path, &clap_id, sample_rate)?;
            let name = wrapper.get_name().to_string();
            let params = wrapper.get_parameters();
            let has_gui = wrapper.has_gui();
            // Query CLAP_EXT_LATENCY on the control thread while the plugin is
            // active (the wrapper just activated it). Captured before the wrapper
            // moves into the engine-owned runtime below.
            //
            // The conversion to milliseconds happens HERE, against `sample_rate` —
            // the exact rate this plugin was activated with. The webview's
            // AudioContext is a different clock domain, so shipping raw frames for
            // it to divide would mis-scale compensation whenever the two rates
            // differ.
            let latency_samples = wrapper.latency_samples();
            let latency_ms = wrapper.latency_ms();

            // Wake the latency watcher when this instance flags a runtime latency
            // change, so `clap_host_latency.changed()` / `request_restart()` reach
            // the frontend as a `plugin-latency-changed` event. Installed before
            // the wrapper is handed to the audio thread.
            let notified_instance_id = instance_id.0.clone();
            if !wrapper.set_latency_change_notifier(Box::new(move || {
                crate::host::latency_watcher::notify_latency_change(&notified_instance_id);
            })) {
                eprintln!(
                    "[Plugin] latency notifier already installed for instance {}",
                    instance_id.0
                );
            }

            // Send the plugin to the native audio thread for real-time processing
            // and create an audio bridge for worklet ↔ Rust data transfer
            let engine_plugin_id = {
                let mut engine_guard = state
                    .engine
                    .lock()
                    .map_err(|e| format!("Failed to lock engine: {}", e))?;
                if let Some(ref mut engine) = *engine_guard {
                    if !wrapper.is_activated() {
                        return Err(format!(
                            "CLAP plugin '{}' failed to activate for engine-owned runtime",
                            name
                        ));
                    }

                    let id = engine.reserve_plugin_id();
                    let (bridge, bridge_handle) = create_audio_bridge(id);
                    let shared_plugin = Arc::new(SharedClapPlugin::new(wrapper));

                    let mut engine_plugins = state
                        .engine_plugins
                        .lock()
                        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
                    engine_plugins.insert(
                        instance_id.0.clone(),
                        crate::state::EnginePluginInstanceData {
                            engine_plugin_id: id,
                            runtime: Arc::clone(&shared_plugin),
                            name: name.clone(),
                            parameters: params.clone(),
                            has_gui,
                            bridge: Some(bridge_handle),
                            relay_scratch: crate::state::PluginRelayScratch::default(),
                        },
                    );

                    if let Err(error) = engine.add_plugin_with_bridge(
                        id,
                        Box::new(ClapPluginSlot::new(shared_plugin)),
                        bridge,
                    ) {
                        engine_plugins.remove(&instance_id.0);
                        return Err(error);
                    }
                    Some(id)
                } else {
                    eprintln!(
                        "[Plugin] Warning: native engine not running, plugin won't process audio"
                    );
                    let mut plugins = state
                        .plugins
                        .lock()
                        .map_err(|e| format!("Failed to lock plugins: {}", e))?;
                    plugins.insert(
                        instance_id.0.clone(),
                        PluginInstanceData {
                            plugin: Box::new(wrapper),
                        },
                    );
                    None
                }
            };

            if engine_plugin_id.is_some() {
                // A load is the moment the process is about to want the memory a
                // previous unload could not free yet. Sweep once the new
                // instance is safely in the scheduler and the engine lock is
                // released — the CLAP teardown a sweep may run belongs on this
                // thread, but not inside another subsystem's critical section.
                state.sweep_retired_engine_plugins();
            }

            let instance = PluginInstance {
                instance_id: instance_id.clone(),
                plugin_id: plugin_id.clone(),
                name,
                parameters: params,
                is_active: true,
                latency_samples,
                latency_ms,
                engine_plugin_id,
            };

            Ok(instance)
        }
        "vst3" => {
            Err("VST3 plugin loading is not supported. CLAP plugins are supported.".to_string())
        }
        "au" => Err(
            "Audio Unit plugin loading is not yet implemented. CLAP plugins are supported."
                .to_string(),
        ),
        _ => Err(format!("Unknown plugin format: {}", entry.format)),
    }
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
) -> Result<PluginUnloadResult, String> {
    match instance_id {
        Some(instance_id) => {
            let _runtime_guard = PLUGIN_RUNTIME_GATE.read().await;
            let mut response = PluginUnloadResult::default();
            match unload_plugin_runtime(&instance_id.0, Some(windows_host), state).await {
                Ok(()) => response.0.push(instance_id.0),
                Err(error) => response.1.push(error),
            }
            Ok(response)
        }
        None => unload_all_plugin_runtimes(Some(windows_host), state).await,
    }
}

async fn unload_all_plugin_runtimes(
    windows_host: Option<&dyn PluginWindowHost>,
    state: &AppState,
) -> Result<PluginUnloadResult, String> {
    let _runtime_guard = PLUGIN_RUNTIME_GATE.write().await;
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
    let mut result = PluginUnloadResult::default();
    for instance_id in instance_ids {
        match unload_plugin_runtime(&instance_id, windows_host, state).await {
            Ok(()) => result.0.push(instance_id),
            Err(error) => result.1.push(error),
        }
    }
    Ok(result)
}

async fn unload_plugin_runtime(
    instance_id: &str,
    windows_host: Option<&dyn PluginWindowHost>,
    state: &AppState,
) -> Result<(), String> {
    let _lifecycle_guard = lock_plugin_lifecycle(instance_id).await;
    let command_plugin = {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;
        plugins.remove(instance_id)
    };
    if let Some(mut instance) = command_plugin {
        instance.close_gui();
        remove_plugin_window(instance_id, windows_host, state);
        return Ok(());
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
        let scheduler_removal_result = {
            let engine_guard = state
                .engine
                .lock()
                .map_err(|e| format!("Failed to lock engine: {}", e));
            match engine_guard {
                Ok(mut engine_guard) => match engine_guard.as_mut() {
                    Some(engine) => engine.remove_plugin(engine_plugin_id),
                    None => Err("Native engine not running".to_string()),
                },
                Err(error) => Err(error),
            }
        };
        if let Err(error) = scheduler_removal_result {
            runtime.cancel_unload();
            return Err(error);
        }

        state.retain_retired_engine_plugin(Arc::clone(&runtime));

        if let Err(error) =
            runtime.with_unload_control(std::time::Duration::from_secs(2), |plugin| {
                plugin.close_gui();
                Ok(())
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

        // The instance record owned this instance's bridge handle, so removing
        // it above already dropped the ring. Nothing keyed by engine_plugin_id
        // is left to clean up.
        //
        // Reclaim what earlier unloads had to keep. This runtime is not a
        // candidate yet — `runtime` is still a live reference here and the
        // scheduler removal was only queued — so the sweep frees the previous
        // generation, not this one.
        drop(runtime);
        state.sweep_retired_engine_plugins();
        return Ok(());
    }

    // A keyed unload is a convergence operation: the requested runtime being
    // absent already satisfies its postcondition. This also makes a retry safe
    // when the process stopped after native teardown but before its durable
    // command-batch checkpoint advanced.
    Ok(())
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
    // lock, and the worklet relay (`process_plugin_audio`) takes this same map
    // lock once per render quantum — holding it across the write parks the
    // relay, and the audio it carries, for as long as control is held.
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

/// Name the shell addresses `set_plugin_state_bytes` by.
///
/// A raw-body transport makes the state chunk the *whole* message, so the
/// instance id cannot ride along as a sibling field — exactly the constraint
/// that put the destination path beside the payload for `write_file_bytes`. The
/// name is shared so both shells report the same thing when it is missing.
pub const PLUGIN_INSTANCE_HEADER: &str = "x-sourdaw-plugin-instance";

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
            return Ok(instance.plugin.get_state());
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
    // access and then runs the plugin's own `set_state`; the worklet relay
    // (`process_plugin_audio`) takes this same map lock once per render quantum,
    // so holding it across that work parks the relay for seconds.
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
/// the payload is its own business — `commands::binary_ipc` owns the validation
/// both shells share.
pub async fn set_plugin_state_bytes(
    instance_id: String,
    plugin_state: &[u8],
    state: &AppState,
) -> Result<(), String> {
    write_plugin_state_chunk(&instance_id, plugin_state, state)
}

// ── Native audio engine ────────────────────────────────────────────────

/// Start the native CPAL audio engine and take the engine-owned plugin path.
///
/// Registered and callable, but nothing in the shipped app calls it yet: the
/// production bootstrap that decides when native processing activates is
/// tracked separately, so `state.engine` stays `None` and `load_plugin` takes
/// the command-owned branch. Everything reached only through `state.engine`
/// runs today under test alone.
pub async fn start_native_engine(state: &AppState) -> Result<String, String> {
    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|e| format!("Failed to lock engine: {}", e))?;

    if engine_guard.is_some() {
        return Ok("Native engine already running".to_string());
    }

    let handle =
        EngineHandle::new().map_err(|e| format!("Failed to start native audio engine: {}", e))?;
    *engine_guard = Some(handle);
    Ok("Native engine started".to_string())
}

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
/// Keyed by `instance_id` for the same reason as `process_plugin_audio`: the
/// engine plugin id is reserved inside the audio engine and the frontend has no
/// reliable way to learn it.
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

/// Update the global transport state for all native plugins (lock-free).
pub async fn update_plugin_transport(
    tempo: f64,
    time_sig_num: u16,
    time_sig_denom: u16,
    is_playing: bool,
    song_pos_beats: f64,
    song_pos_seconds: f64,
    state: &AppState,
) -> Result<(), String> {
    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|e| format!("Failed to lock engine: {}", e))?;
    let engine = engine_guard.as_mut().ok_or("Native engine not running")?;

    engine.set_transport(TransportState {
        tempo,
        time_sig_num,
        time_sig_denom,
        is_playing,
        song_pos_beats,
        song_pos_seconds,
    })
}

/// Process an audio block through a native plugin via the ring-buffer bridge.
/// Called from the main thread (relayed from the AudioWorklet via MessagePort).
///
/// Takes interleaved stereo audio as raw bytes (IEEE 754 little-endian f32,
/// L0,R0,L1,R1,...). Returns processed audio as raw bytes in the same format.
/// Uses the lock-free ring buffer — no mutex on the audio thread.
///
/// Keyed by `instance_id`, not by the engine plugin id. The engine id is
/// reserved inside the audio engine and is meaningless to the frontend: the
/// frontend has no reliable way to learn it, and a placeholder value resolves
/// no bridge at all, which degrades to an unprocessed dry signal rather than to
/// a visible error. The instance id is the identifier both sides already agree
/// on, so the engine id is resolved here, where it is actually known.
///
/// Runs once per render quantum per bridged plugin — ~2.7 ms apart at 48 kHz —
/// so it takes exactly one lock and performs exactly one lookup: the instance
/// record owns its ring and its de-interleave scratch, and both come back
/// together. Two sequential mutex takes on this path were two chances per block
/// to wait behind an unrelated control command.
///
/// The de-interleave scratch is preallocated on the instance, so this path
/// performs no heap allocation except the IPC return value: the processed block
/// is handed to the IPC layer by value, so its buffer cannot be pooled here.
/// `push_input` still stack-constructs a zeroed `AudioBlock` per call before
/// copying into it — that is a stack cost inside the bridge, not an allocation
/// this command can pool away.
pub async fn process_plugin_audio(
    instance_id: String,
    audio_bytes: Vec<u8>,
    state: &AppState,
) -> Result<Vec<u8>, String> {
    let mut engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
    let instance = engine_plugins
        .get_mut(&instance_id)
        .ok_or_else(|| format!("No engine plugin for instance {}", instance_id))?;
    let engine_plugin_id = instance.engine_plugin_id;
    let relay_scratch = &mut instance.relay_scratch;
    let bridge = instance
        .bridge
        .as_mut()
        .ok_or_else(|| format!("No audio bridge for plugin {}", engine_plugin_id))?;

    // Interleaved stereo f32: two samples, four bytes each, per frame.
    const BYTES_PER_FRAME: usize = 2 * std::mem::size_of::<f32>();
    let frames = audio_bytes.len() / BYTES_PER_FRAME;

    // Push input to the audio thread. A refusal means the input ring was full,
    // so this block never reaches the plugin — and on the native sampler's
    // record feed that is a hole in the recording, not a dropped frame of
    // monitoring. It cannot fail the command: the caller is the worklet relay,
    // an error there costs the output block that IS ready below, and the very
    // condition being reported is the engine already running behind. So it is
    // counted where `engine_rt_diagnostics` can see it, alongside the engine's
    // own output-side and backlog counters.
    //
    // A block past the bridge's capacity is refused by `push_input` itself, so
    // it is refused here without de-interleaving it — the scratch stays sized
    // to what the bridge accepts and never has to grow.
    let block_accepted = if frames > MAX_BLOCK_FRAMES {
        false
    } else {
        relay_scratch.left.clear();
        relay_scratch.right.clear();
        for frame in audio_bytes.chunks_exact(BYTES_PER_FRAME) {
            relay_scratch
                .left
                .push(f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]));
            relay_scratch
                .right
                .push(f32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]));
        }
        bridge.push_input(&relay_scratch.left, &relay_scratch.right)
    };

    if !block_accepted {
        state
            .bridge_input_blocks_refused
            .fetch_add(1, AtomicOrdering::Relaxed);
    }

    // Try to pop processed output
    // This may be from the previous block with one block of latency.
    if let Some(output) = bridge.pop_output() {
        // Re-interleave and encode as raw bytes. The block reports its own
        // frame count, so a quantum other than 128 round-trips whole instead of
        // being silently clipped to the first 128 frames.
        let n = output.frames;
        let mut result = Vec::with_capacity(n * BYTES_PER_FRAME);
        for i in 0..n {
            result.extend_from_slice(&output.left[i].to_le_bytes());
            result.extend_from_slice(&output.right[i].to_le_bytes());
        }
        Ok(result)
    } else {
        // No output yet (first block) — return the dry input
        Ok(audio_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::EnginePluginInstanceData;
    use daw_core::PluginInstanceId;
    use std::path::Path;

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
        insert_engine_owned_fixture_with_bridge(state, instance_id, state_bytes, None);
    }

    fn insert_engine_owned_fixture_with_bridge(
        state: &AppState,
        instance_id: &str,
        state_bytes: Vec<u8>,
        bridge: Option<daw_engine::audio_bridge::PluginAudioBridgeHandle>,
    ) {
        let mut wrapper = ClapWrapper::new_engine_owned_command_fixture(
            "Engine Owned Fixture",
            state_bytes,
            true,
        );
        wrapper.set_engine_owned_command_fixture_parameters(vec![plugin_parameter(7, 0.25)]);
        let parameters = wrapper.get_parameters();
        let runtime = Arc::new(SharedClapPlugin::new(wrapper));
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
                bridge,
                relay_scratch: crate::state::PluginRelayScratch::default(),
            },
        );
    }

    fn engine_fixture_runtime(state: &AppState, instance_id: &str) -> Arc<SharedClapPlugin> {
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

    /// `process_plugin_audio` and `set_plugin_bypass` must address the same
    /// plugin for the same instance id: a bypass that resolved differently from
    /// the audio path would mute a plugin the app is still feeding.
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

    /// Regression (F14): `push_input` reports a refusal and the result used to
    /// be discarded, so a block the plugin never saw looked exactly like one it
    /// processed. Refusals must reach the diagnostics surface.
    #[test]
    fn a_refused_input_block_is_counted_while_an_accepted_one_is_not() {
        let state = AppState::default();
        // Hold the RT side alive so the ring refuses only because it is full,
        // not because its consumer went away.
        let (_bridge, bridge_handle) = create_audio_bridge(17);
        insert_engine_owned_fixture_with_bridge(
            &state,
            "instance-input-refusal",
            Vec::new(),
            Some(bridge_handle),
        );

        let block_bytes = vec![0u8; 128 * 2 * 4];

        crate::block_on_test(process_plugin_audio(
            "instance-input-refusal".to_string(),
            block_bytes.clone(),
            &state,
        ))
        .expect("a block with room in the ring should be accepted");
        assert_eq!(
            state
                .bridge_input_blocks_refused
                .load(AtomicOrdering::Relaxed),
            0,
            "an accepted block must not be counted as refused"
        );

        {
            let mut engine_plugins = state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock should be available");
            let bridge = engine_plugins
                .get_mut("instance-input-refusal")
                .and_then(|instance| instance.bridge.as_mut())
                .expect("bridge should be registered");
            let left = [0.0_f32; 128];
            while bridge.push_input(&left, &left) {}
        }

        crate::block_on_test(process_plugin_audio(
            "instance-input-refusal".to_string(),
            block_bytes.clone(),
            &state,
        ))
        .expect("a refused input block must not fail the round trip");
        assert_eq!(
            state
                .bridge_input_blocks_refused
                .load(AtomicOrdering::Relaxed),
            1,
            "a block the plugin never received must be counted"
        );

        // The ring is still full, so this one is refused too. The counter is
        // cumulative since engine start: a store rather than an add would read
        // 1 here and make a stream refusing every period look like one hiccup.
        crate::block_on_test(process_plugin_audio(
            "instance-input-refusal".to_string(),
            block_bytes,
            &state,
        ))
        .expect("a refused input block must not fail the round trip");
        assert_eq!(
            state
                .bridge_input_blocks_refused
                .load(AtomicOrdering::Relaxed),
            2,
            "every refused block must add to the count, not overwrite it"
        );
    }

    /// The relay ran once per render quantum and allocated its de-interleave
    /// buffers every time. They are preallocated on the instance now: the same
    /// storage must serve consecutive blocks, including blocks of different
    /// lengths, without moving.
    ///
    /// Both channels are checked: the relay fills two independent `Vec`s, so a
    /// regression that reallocated only the right one would pass a left-only
    /// assertion. What this cannot see is an added *clone* of the scratch — the
    /// address it reads is the instance's own buffer either way — so the
    /// no-copy property is carried by the code, not by this test.
    #[test]
    fn the_relay_refills_one_preallocated_scratch_buffer_across_blocks() {
        let state = AppState::default();
        let (_bridge, bridge_handle) = create_audio_bridge(17);
        insert_engine_owned_fixture_with_bridge(
            &state,
            "instance-scratch",
            Vec::new(),
            Some(bridge_handle),
        );

        // Both channels, every time: pointer, capacity and length.
        type ScratchShape = ((*const f32, usize, usize), (*const f32, usize, usize));
        let scratch_shape = || -> ScratchShape {
            let engine_plugins = state.engine_plugins.lock().expect("engine_plugins lock");
            let instance = engine_plugins
                .get("instance-scratch")
                .expect("fixture should exist");
            (
                (
                    instance.relay_scratch.left.as_ptr(),
                    instance.relay_scratch.left.capacity(),
                    instance.relay_scratch.left.len(),
                ),
                (
                    instance.relay_scratch.right.as_ptr(),
                    instance.relay_scratch.right.capacity(),
                    instance.relay_scratch.right.len(),
                ),
            )
        };

        let ((left_before, left_capacity_before, _), (right_before, right_capacity_before, _)) =
            scratch_shape();
        assert_eq!(
            (left_capacity_before, right_capacity_before),
            (MAX_BLOCK_FRAMES, MAX_BLOCK_FRAMES),
            "both scratch channels must be sized once to the largest block the bridge accepts"
        );

        crate::block_on_test(process_plugin_audio(
            "instance-scratch".to_string(),
            vec![0u8; 128 * 2 * 4],
            &state,
        ))
        .expect("a 128-frame block should round-trip");
        let (
            (left_after_short, left_capacity_after_short, left_frames_after_short),
            (right_after_short, right_capacity_after_short, right_frames_after_short),
        ) = scratch_shape();
        assert_eq!(
            (left_frames_after_short, right_frames_after_short),
            (128, 128),
            "the block must be de-interleaved into the instance's own scratch, both channels"
        );

        crate::block_on_test(process_plugin_audio(
            "instance-scratch".to_string(),
            vec![0u8; 256 * 2 * 4],
            &state,
        ))
        .expect("a 256-frame block should round-trip");
        let (
            (left_after_long, left_capacity_after_long, left_frames_after_long),
            (right_after_long, right_capacity_after_long, right_frames_after_long),
        ) = scratch_shape();

        assert_eq!(
            (left_frames_after_long, right_frames_after_long),
            (256, 256)
        );
        assert_eq!(
            (
                left_before,
                left_capacity_before,
                right_before,
                right_capacity_before
            ),
            (
                left_after_short,
                left_capacity_after_short,
                right_after_short,
                right_capacity_after_short
            ),
            "the relay must reuse both buffers, not allocate new ones per block"
        );
        assert_eq!(
            (
                left_before,
                left_capacity_before,
                right_before,
                right_capacity_before
            ),
            (
                left_after_long,
                left_capacity_after_long,
                right_after_long,
                right_capacity_after_long
            ),
            "a longer block must fit the preallocated capacity without moving either channel"
        );
    }

    /// A block past the bridge's capacity is refused, and refusing it must not
    /// be the thing that grows the preallocated scratch.
    #[test]
    fn an_oversized_block_is_refused_without_resizing_the_relay_scratch() {
        let state = AppState::default();
        let (_bridge, bridge_handle) = create_audio_bridge(17);
        insert_engine_owned_fixture_with_bridge(
            &state,
            "instance-oversized",
            Vec::new(),
            Some(bridge_handle),
        );

        let oversized = vec![0u8; (MAX_BLOCK_FRAMES + 1) * 2 * 4];
        crate::block_on_test(process_plugin_audio(
            "instance-oversized".to_string(),
            oversized,
            &state,
        ))
        .expect("an oversized block must not fail the round trip");

        assert_eq!(
            state
                .bridge_input_blocks_refused
                .load(AtomicOrdering::Relaxed),
            1,
            "a block the plugin never received must be counted"
        );
        let engine_plugins = state.engine_plugins.lock().expect("engine_plugins lock");
        let instance = engine_plugins
            .get("instance-oversized")
            .expect("fixture should exist");
        assert_eq!(
            instance.relay_scratch.left.capacity(),
            MAX_BLOCK_FRAMES,
            "an oversized block must not grow the scratch past what the bridge accepts"
        );
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

    /// Replace the record under an instance id with a fresh runtime, exactly as
    /// an unload followed by a reload of the same id does.
    fn reload_engine_owned_fixture(state: &AppState, instance_id: &str, parameter_value: f64) {
        state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .remove(instance_id);

        let mut wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Reloaded Fixture", Vec::new(), true);
        wrapper.set_engine_owned_command_fixture_parameters(vec![plugin_parameter(
            7,
            parameter_value,
        )]);
        let parameters = wrapper.get_parameters();
        state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .insert(
                instance_id.to_string(),
                EnginePluginInstanceData {
                    engine_plugin_id: 18,
                    runtime: Arc::new(SharedClapPlugin::new(wrapper)),
                    name: "Reloaded Fixture".to_string(),
                    parameters,
                    has_gui: true,
                    bridge: None,
                    relay_scratch: crate::state::PluginRelayScratch::default(),
                },
            );
    }

    fn parameter_values(parameters: &[PluginParameter]) -> Vec<f64> {
        parameters.iter().map(|parameter| parameter.value).collect()
    }

    /// The relay (`process_plugin_audio`) takes the `engine_plugins` map lock
    /// once per render quantum. `set_plugin_parameter` used to hold that same
    /// lock across `enqueue_parameter`, which blocks unbounded on the instance's
    /// non-RT control lock — so a plugin holding control parked the audio relay
    /// with it. The map must be free while the control write is in flight.
    ///
    /// And once it is free, an unload+reload can land in that window: the value
    /// went to the runtime that is gone, so it must not be written onto the
    /// record that replaced it.
    #[test]
    fn set_plugin_parameter_frees_the_map_during_the_write_and_refuses_a_swapped_record() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "instance-swapped-write", Vec::new());
        let runtime = engine_fixture_runtime(&state, "instance-swapped-write");

        std::thread::scope(|scope| {
            // The plugin owns its control path for longer than the map-lock
            // deadline below, so a command that held the map across the write
            // would hold it past that deadline.
            let control_holder = scope.spawn(|| {
                runtime.with_control(Duration::from_secs(5), |_| {
                    std::thread::sleep(Duration::from_millis(800));
                    Ok(())
                })
            });
            std::thread::sleep(Duration::from_millis(100));

            let writer = scope.spawn(|| {
                crate::block_on_test(set_plugin_parameter(
                    PluginInstanceId("instance-swapped-write".to_string()),
                    7,
                    0.75,
                    &state,
                ))
            });
            std::thread::sleep(Duration::from_millis(100));

            let deadline = Instant::now() + Duration::from_millis(300);
            loop {
                if state.engine_plugins.try_lock().is_ok() {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "set_plugin_parameter must not hold engine_plugins across the control write"
                );
                std::thread::sleep(Duration::from_millis(5));
            }

            reload_engine_owned_fixture(&state, "instance-swapped-write", 0.25);

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
            let control_holder = scope.spawn(|| {
                runtime.with_control(Duration::from_secs(5), |_| {
                    std::thread::sleep(Duration::from_millis(800));
                    Ok(())
                })
            });
            std::thread::sleep(Duration::from_millis(100));

            let writer = scope
                .spawn(|| write_plugin_state_chunk("instance-swapped-restore", &[9, 8, 7], &state));
            std::thread::sleep(Duration::from_millis(100));

            let deadline = Instant::now() + Duration::from_millis(300);
            loop {
                if state.engine_plugins.try_lock().is_ok() {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "write_plugin_state_chunk must not hold engine_plugins across the restore"
                );
                std::thread::sleep(Duration::from_millis(5));
            }

            reload_engine_owned_fixture(&state, "instance-swapped-restore", 0.25);

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
            let control_holder = scope.spawn(|| {
                runtime.with_control(Duration::from_secs(5), |_| {
                    std::thread::sleep(Duration::from_millis(500));
                    Ok(())
                })
            });
            std::thread::sleep(Duration::from_millis(100));

            let reader = scope.spawn(|| {
                crate::block_on_test(get_plugin_parameters(
                    PluginInstanceId("instance-swapped-poll".to_string()),
                    &state,
                ))
            });
            std::thread::sleep(Duration::from_millis(150));

            reload_engine_owned_fixture(&state, "instance-swapped-poll", 0.25);

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
            let control_holder = scope.spawn(|| {
                runtime.with_control(Duration::from_secs(5), |_| {
                    std::thread::sleep(Duration::from_millis(600));
                    Ok(())
                })
            });
            std::thread::sleep(Duration::from_millis(100));

            let reader = scope.spawn(|| {
                crate::block_on_test(get_plugin_parameters(
                    PluginInstanceId("instance-late-write".to_string()),
                    &state,
                ))
            });
            // The reader has cloned the runtime and is parked in the poll.
            std::thread::sleep(Duration::from_millis(200));

            // Occupy the map so the reader cannot store the instant its poll
            // returns, then land the write in that window exactly as
            // `set_plugin_parameter` does: enqueue, then record it in the cache.
            let mut engine_plugins = state.engine_plugins.lock().expect("engine_plugins lock");
            std::thread::sleep(Duration::from_millis(600));
            runtime
                .enqueue_parameter(7, 0.75)
                .expect("the queued write should be accepted");
            engine_plugins
                .get_mut("instance-late-write")
                .expect("fixture should exist")
                .parameters = vec![plugin_parameter(7, 0.75)];
            drop(engine_plugins);

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
            &[],
            &[],
            true,
            &[scanned("aaaa1111", "com.vendor.reverb", "clap")],
        );

        let error = crate::block_on_test(load_plugin(
            PluginId("aaaa1111".to_string()),
            PluginInstanceId("poisoned-registry-instance".to_string()),
            &state,
        ))
        .expect_err("a fake plugin path cannot load");

        assert!(
            error.starts_with("Failed to load CLAP plugin at /plugins/aaaa1111.clap:"),
            "the load must get past the registry read and fail at the library, got: {error}"
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
                    clap_id: String::new(),
                    format: "clap".to_string(),
                    name: "Nameless".to_string(),
                },
            );

        let result = crate::block_on_test(load_plugin(
            PluginId("clap-without-descriptor-id".to_string()),
            PluginInstanceId("clap-instance".to_string()),
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
        let state = AppState::default();
        let scan_root = unique_temp_scan_root("raw-plugin-scan-path");
        std::fs::create_dir_all(&scan_root).expect("temp scan root should be created");

        let result =
            crate::block_on_test(scan_plugins(vec![scan_root.display().to_string()], &state))
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

        let state = &state;
        let registry = state
            .plugin_registry
            .lock()
            .expect("plugin registry lock should be available");
        assert!(registry.is_empty());
    }

    #[test]
    fn get_default_plugin_paths_returns_authorized_native_scan_roots() {
        let paths = crate::block_on_test(get_default_plugin_paths())
            .expect("default plugin paths should resolve");
        let scan_policy = PluginScanPolicy::platform_defaults();

        assert!(!paths.is_empty());
        for path in paths {
            assert_eq!(scan_policy.authorize_scan_root(Path::new(&path)), Ok(()));
        }
    }

    #[test]
    fn load_plugin_rejects_vst3_without_loading_the_bundle() {
        let state = AppState::default();
        state
            .plugin_registry
            .lock()
            .expect("plugin registry lock should be available")
            .insert(
                "vst3-fixture".to_string(),
                PluginRegistryEntry {
                    path: "/plugins/should-not-be-loaded.vst3".to_string(),
                    clap_id: String::new(),
                    format: "vst3".to_string(),
                    name: "Unsupported VST3".to_string(),
                },
            );

        let result = crate::block_on_test(load_plugin(
            PluginId("vst3-fixture".to_string()),
            PluginInstanceId("vst3-instance".to_string()),
            &state,
        ));

        match result {
            Err(error) => assert_eq!(
                error,
                "VST3 plugin loading is not supported. CLAP plugins are supported."
            ),
            Ok(instance) => panic!("unsupported VST3 unexpectedly loaded: {instance:?}"),
        }
        insert_engine_owned_fixture(&state, "vst3-instance", vec![1, 2, 3]);
        let duplicate = crate::block_on_test(load_plugin(
            PluginId("vst3-fixture".to_string()),
            PluginInstanceId("vst3-instance".to_string()),
            &state,
        ));
        assert_eq!(
            duplicate.unwrap_err(),
            "Plugin instance already exists: vst3-instance"
        );
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
        let instance = PluginInstanceData {
            plugin: Box::new(wrapper),
        };
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
        assert_eq!(unload_all.0, ["command-instance"]);
        assert_eq!(unload_all.1, ["Native engine not running"]);
        let windows = state.plugin_windows.lock().expect("plugin_windows lock");
        assert!(windows.is_empty());
    }

    #[test]
    fn keyed_unload_is_idempotent_after_the_instance_is_already_absent() {
        let state = AppState::default();
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Command Fixture", vec![], true);
        state.plugins.lock().expect("plugins lock").insert(
            "command-instance".into(),
            PluginInstanceData {
                plugin: Box::new(wrapper),
            },
        );

        let first = crate::block_on_test(unload_plugin_runtime("command-instance", None, &state));
        let retry = crate::block_on_test(unload_plugin_runtime("command-instance", None, &state));

        assert_eq!(first, Ok(()));
        assert_eq!(retry, Ok(()));
        assert!(!state
            .plugins
            .lock()
            .expect("plugins lock")
            .contains_key("command-instance"));
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

    #[test]
    fn get_plugin_state_bytes_returns_the_chunk_as_a_raw_body_not_a_json_number_array() {
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

    fn scanned(id: &str, clap_id: &str, format: &str) -> ScannedPlugin {
        ScannedPlugin {
            id: id.to_string(),
            name: format!("Plugin {id}"),
            vendor: "Vendor".to_string(),
            format: format.to_string(),
            category: "effect".to_string(),
            path: format!("/plugins/{id}.clap"),
            version: "1.0.0".to_string(),
            clap_id: clap_id.to_string(),
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 0,
            has_custom_ui: true,
            parameters: Some(vec![]),
            parameter_metadata_reason: None,
        }
    }

    #[test]
    fn a_scanned_plugin_resolves_by_its_path_hash() {
        let registry = index_scanned_plugins(&[scanned("aaaa1111", "com.vendor.reverb", "clap")]);

        let entry = registry.get("aaaa1111").expect("path hash resolves");
        assert_eq!(entry.path, "/plugins/aaaa1111.clap");
        assert_eq!(entry.clap_id, "com.vendor.reverb");
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
}
