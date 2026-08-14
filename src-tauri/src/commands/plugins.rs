//! Tauri commands for plugin scanning, loading, and parameter management.

use crate::commands::binary_ipc::{raw_body_bytes, read_percent_encoded_header};
use crate::host::native_bridge::{ClapPluginSlot, SharedClapPlugin};
use crate::host::plugin_scan_policy::PluginScanPolicy;
use crate::host::plugin_scan_worker;
use crate::state::{AppState, PluginInstanceData, PluginRegistryEntry};
use cpal::traits::{DeviceTrait, HostTrait};
use daw_engine::audio_bridge::create_audio_bridge;
use daw_engine::plugin_slot::{MidiNoteEvent, TransportState};
use daw_engine::EngineHandle;
use daw_plugin_host::scanner::{self, ScanResult, ScannedPlugin};
use daw_plugin_host::{AudioPlugin, ClapWrapper};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;

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

#[tauri::command]
#[specta::specta]
pub async fn scan_plugins(
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<ScanResult, String> {
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
                    Ok(metadata) => plugins.push(scanner::scanned_plugin(&candidate, metadata)),
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
    if let Ok(mut registry) = state.plugin_registry.lock() {
        registry.retain(|_, entry| {
            let path = Path::new(&entry.path);
            if scan_complete {
                return !authorized_paths.iter().any(|root| path.starts_with(root));
            }
            !scanned_paths.iter().any(|scanned| scanned == path)
        });
        registry.extend(index_scanned_plugins(&plugins));
    }

    if !scan_complete {
        return Err("Plugin scan did not complete within safety limits".to_string());
    }

    Ok(ScanResult {
        plugins,
        errors,
        scan_duration_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_default_plugin_paths() -> Result<Vec<String>, String> {
    Ok(PluginScanPolicy::platform_defaults().allowed_roots_as_strings())
}

// ── Instance lifecycle commands ─────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn load_plugin(
    plugin_id: PluginId,
    instance_id: PluginInstanceId,
    state: tauri::State<'_, AppState>,
) -> Result<PluginInstance, String> {
    let _runtime_guard = PLUGIN_RUNTIME_GATE.read().await;
    let _lifecycle_guard = lock_plugin_lifecycle(&instance_id.0).await;
    ensure_plugin_instance_id_available(&state, &instance_id.0)?;
    let entry = {
        let registry = state
            .plugin_registry
            .lock()
            .map_err(|e| format!("Failed to lock registry: {}", e))?;
        registry.get(&plugin_id.0).cloned().ok_or_else(|| {
            format!(
                "Plugin {} not found in registry. Run a scan first.",
                plugin_id.0
            )
        })?
    };

    match entry.format.as_str() {
        "clap" => {
            let clap_id = if entry.clap_id.is_empty() {
                entry.name.clone()
            } else {
                entry.clap_id.clone()
            };

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

                    let mut bridges = state
                        .audio_bridges
                        .lock()
                        .map_err(|e| format!("Failed to lock audio_bridges: {}", e))?;
                    let mut engine_plugins = state
                        .engine_plugins
                        .lock()
                        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
                    bridges.insert(id, bridge_handle);
                    engine_plugins.insert(
                        instance_id.0.clone(),
                        crate::state::EnginePluginInstanceData {
                            engine_plugin_id: id,
                            runtime: Arc::clone(&shared_plugin),
                            name: name.clone(),
                            parameters: params.clone(),
                            has_gui,
                        },
                    );

                    if let Err(error) = engine.add_plugin_with_bridge(
                        id,
                        Box::new(ClapPluginSlot::new(shared_plugin)),
                        bridge,
                    ) {
                        bridges.remove(&id);
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

fn remove_plugin_window(instance_id: &str, app: Option<&tauri::AppHandle>, state: &AppState) {
    let window_label = match state.plugin_windows.lock() {
        Ok(mut windows) => windows.remove(instance_id),
        Err(poisoned) => poisoned.into_inner().remove(instance_id),
    };
    if let (Some(app), Some(label)) = (app, window_label) {
        if let Some(window) = app.get_window(&label) {
            let _ = window.destroy();
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn unload_plugin(
    instance_id: Option<PluginInstanceId>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<PluginUnloadResult, String> {
    match instance_id {
        Some(instance_id) => {
            let _runtime_guard = PLUGIN_RUNTIME_GATE.read().await;
            let mut response = PluginUnloadResult::default();
            match unload_plugin_runtime(&instance_id.0, Some(&app), state.inner()).await {
                Ok(()) => response.0.push(instance_id.0),
                Err(error) => response.1.push(error),
            }
            Ok(response)
        }
        None => unload_all_plugin_runtimes(Some(&app), state.inner()).await,
    }
}

async fn unload_all_plugin_runtimes(
    app: Option<&tauri::AppHandle>,
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
        match unload_plugin_runtime(&instance_id, app, state).await {
            Ok(()) => result.0.push(instance_id),
            Err(error) => result.1.push(error),
        }
    }
    Ok(result)
}

async fn unload_plugin_runtime(
    instance_id: &str,
    app: Option<&tauri::AppHandle>,
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
        remove_plugin_window(instance_id, app, state);
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

        remove_plugin_window(instance_id, app, state);

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

        match state.audio_bridges.lock() {
            Ok(mut bridges) => {
                bridges.remove(&engine_plugin_id);
            }
            Err(poisoned) => {
                poisoned.into_inner().remove(&engine_plugin_id);
            }
        }
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

#[tauri::command]
#[specta::specta]
pub async fn set_plugin_parameter(
    instance_id: PluginInstanceId,
    param_id: u32,
    value: f64,
    state: tauri::State<'_, AppState>,
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

    let mut engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
    if let Some(instance) = engine_plugins.get_mut(&instance_id.0) {
        let enqueue_result = instance.runtime.enqueue_parameter(param_id, value);
        update_parameter_cache_after_enqueue(
            &mut instance.parameters,
            param_id,
            value,
            enqueue_result,
        )?;
        return Ok(());
    }
    drop(engine_plugins);

    Err(format!("No plugin instance: {}", instance_id.0))
}

#[tauri::command]
#[specta::specta]
pub async fn get_plugin_parameters(
    instance_id: PluginInstanceId,
    state: tauri::State<'_, AppState>,
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

    let engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
    if let Some(instance) = engine_plugins.get(&instance_id.0) {
        instance.runtime.ensure_public_control_allowed()?;
        return Ok(instance.parameters.clone());
    }

    Err(format!("No plugin instance: {}", instance_id.0))
}

/// Header carrying the percent-encoded plugin instance id for
/// `set_plugin_state_bytes`.
///
/// The raw-body IPC path makes the state chunk the *whole* invoke message, so
/// the instance id cannot ride along as a sibling field — exactly the constraint
/// that put the destination path in a header for `write_file_bytes`.
const PLUGIN_INSTANCE_HEADER: &str = "x-sourdaw-plugin-instance";

/// Read a loaded plugin instance's opaque state chunk.
///
/// Shared by the command layer so the transport can change without the lookup
/// order (command-owned instances first, then engine-owned runtimes) changing
/// with it. The instance lookup is the authorization gate: plugin state is keyed
/// by instance id, not addressed by path, so no filesystem allowlist applies.
fn read_plugin_state_chunk(
    instance_id: &str,
    state: &tauri::State<'_, AppState>,
) -> Result<Vec<u8>, String> {
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
    state: &tauri::State<'_, AppState>,
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

    let mut engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
    if let Some(instance) = engine_plugins.get_mut(instance_id) {
        let refreshed_parameters = instance.runtime.set_state_invalidating_pending_parameters(
            std::time::Duration::from_secs(2),
            plugin_state,
        )?;
        instance.parameters = refreshed_parameters;
        return Ok(());
    }
    drop(engine_plugins);

    Err(format!("No plugin instance: {}", instance_id))
}

/// Read a plugin instance's opaque state chunk over Tauri's binary IPC path.
///
/// `tauri::ipc::Response` carries the bytes verbatim to the webview as an
/// `ArrayBuffer`. The predecessor returned `Vec<u8>`, which Tauri serialized as
/// a JSON array of decimal numbers — ~3.57x the raw length for the high-entropy
/// bytes real plugin state is made of (OE-5 / WB-5 / M-109).
///
/// Only the *response* needs to be binary here: the request carries nothing but
/// the instance id, so it stays an ordinary JSON argument exactly as
/// `read_file_bytes` keeps its path.
#[tauri::command]
pub async fn get_plugin_state_bytes(
    instance_id: PluginInstanceId,
    state: tauri::State<'_, AppState>,
) -> Result<tauri::ipc::Response, String> {
    let chunk = read_plugin_state_chunk(&instance_id.0, &state)?;
    Ok(tauri::ipc::Response::new(chunk))
}

/// Restore a plugin instance's opaque state chunk over Tauri's binary IPC path.
///
/// The whole invoke message is the chunk (`InvokeBody::Raw`), so nothing is
/// JSON-serialized and the payload crosses at exactly its byte length. The
/// instance id travels in the `x-sourdaw-plugin-instance` header because the
/// body is fully occupied — through the same present / ASCII / percent-decode
/// validation chain `write_file_bytes` uses for its path.
#[tauri::command]
pub async fn set_plugin_state_bytes(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let instance_id = read_percent_encoded_header(&request, PLUGIN_INSTANCE_HEADER)?;
    let plugin_state = raw_body_bytes(&request, "set_plugin_state_bytes")?;

    write_plugin_state_chunk(&instance_id, plugin_state, &state)
}

// ── Native audio engine ────────────────────────────────────────────────

#[tauri::command]

pub async fn start_native_engine(state: tauri::State<'_, AppState>) -> Result<String, String> {
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
#[tauri::command]

pub async fn send_plugin_midi(
    engine_plugin_id: usize,
    note: u8,
    velocity: u8,
    channel: i16,
    is_note_on: bool,
    state: tauri::State<'_, AppState>,
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

/// Update the global transport state for all native plugins (lock-free).
#[tauri::command]

pub async fn update_plugin_transport(
    tempo: f64,
    time_sig_num: u16,
    time_sig_denom: u16,
    is_playing: bool,
    song_pos_beats: f64,
    song_pos_seconds: f64,
    state: tauri::State<'_, AppState>,
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
#[tauri::command]

pub async fn process_plugin_audio(
    instance_id: String,
    audio_bytes: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let engine_plugin_id = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        engine_plugins
            .get(&instance_id)
            .map(|data| data.engine_plugin_id)
            .ok_or_else(|| format!("No engine plugin for instance {}", instance_id))?
    };

    let mut bridges = state
        .audio_bridges
        .lock()
        .map_err(|e| format!("Failed to lock audio_bridges: {}", e))?;

    let bridge = bridges
        .get_mut(&engine_plugin_id)
        .ok_or_else(|| format!("No audio bridge for plugin {}", engine_plugin_id))?;

    // Interpret raw bytes as interleaved f32 samples
    let num_floats = audio_bytes.len() / 4;
    let num_samples = num_floats / 2;

    let audio_data: Vec<f32> = audio_bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect();

    // De-interleave input
    let mut left = vec![0.0f32; num_samples];
    let mut right = vec![0.0f32; num_samples];
    for i in 0..num_samples {
        left[i] = audio_data[i * 2];
        right[i] = audio_data[i * 2 + 1];
    }

    // Push input to the audio thread
    bridge.push_input(&left, &right);

    // Try to pop processed output
    // This may be from the previous block with one block of latency.
    if let Some(output) = bridge.pop_output() {
        // Re-interleave and encode as raw bytes. The block reports its own
        // frame count, so a quantum other than 128 round-trips whole instead of
        // being silently clipped to the first 128 frames.
        let n = output.frames;
        let mut result = Vec::with_capacity(n * 2 * 4);
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
    use tauri::Manager;

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

    fn command_test_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .manage(AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("test app should build")
    }

    fn insert_engine_owned_fixture(
        state: &tauri::State<'_, AppState>,
        instance_id: &str,
        state_bytes: Vec<u8>,
    ) {
        let wrapper = ClapWrapper::new_engine_owned_command_fixture(
            "Engine Owned Fixture",
            state_bytes,
            true,
        );
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
            },
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

    #[test]
    fn scan_plugins_rejects_arbitrary_renderer_raw_path_without_grant() {
        let app = command_test_app();
        let scan_root = unique_temp_scan_root("raw-plugin-scan-path");
        std::fs::create_dir_all(&scan_root).expect("temp scan root should be created");

        let result = tauri::async_runtime::block_on(scan_plugins(
            vec![scan_root.display().to_string()],
            app.state::<AppState>(),
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

        let state = app.state::<AppState>();
        let registry = state
            .plugin_registry
            .lock()
            .expect("plugin registry lock should be available");
        assert!(registry.is_empty());
    }

    #[test]
    fn get_default_plugin_paths_returns_authorized_native_scan_roots() {
        let paths = tauri::async_runtime::block_on(get_default_plugin_paths())
            .expect("default plugin paths should resolve");
        let scan_policy = PluginScanPolicy::platform_defaults();

        assert!(!paths.is_empty());
        for path in paths {
            assert_eq!(scan_policy.authorize_scan_root(Path::new(&path)), Ok(()));
        }
    }

    #[test]
    fn load_plugin_rejects_vst3_without_loading_the_bundle() {
        let app = command_test_app();
        let state = app.state::<AppState>();
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

        let result = tauri::async_runtime::block_on(load_plugin(
            PluginId("vst3-fixture".to_string()),
            PluginInstanceId("vst3-instance".to_string()),
            state.clone(),
        ));

        match result {
            Err(error) => assert_eq!(
                error,
                "VST3 plugin loading is not supported. CLAP plugins are supported."
            ),
            Ok(instance) => panic!("unsupported VST3 unexpectedly loaded: {instance:?}"),
        }
        insert_engine_owned_fixture(&state, "vst3-instance", vec![1, 2, 3]);
        let duplicate = tauri::async_runtime::block_on(load_plugin(
            PluginId("vst3-fixture".to_string()),
            PluginInstanceId("vst3-instance".to_string()),
            state,
        ));
        assert_eq!(
            duplicate.unwrap_err(),
            "Plugin instance already exists: vst3-instance"
        );
    }

    #[test]
    fn bulk_unload_waits_for_inflight_load_or_unload_access() {
        tauri::async_runtime::block_on(async {
            let app = command_test_app();
            let _runtime_operation = PLUGIN_RUNTIME_GATE.read().await;
            let blocked = tokio::time::timeout(
                Duration::from_millis(10),
                unload_all_plugin_runtimes(None, app.state::<AppState>().inner()),
            )
            .await;
            assert!(blocked.is_err());
        });
    }

    #[test]
    fn unload_preserves_failed_engine_owner_and_cleans_command_owner() {
        let app = command_test_app();
        let state = app.state::<AppState>();
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
        let unload_all =
            tauri::async_runtime::block_on(unload_all_plugin_runtimes(None, state.inner()));
        let unload_all = unload_all.expect("bulk inventory should complete");
        assert_eq!(unload_all.0, ["command-instance"]);
        assert_eq!(unload_all.1, ["Native engine not running"]);
        let windows = state.plugin_windows.lock().expect("plugin_windows lock");
        assert!(windows.is_empty());
    }

    #[test]
    fn keyed_unload_is_idempotent_after_the_instance_is_already_absent() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Command Fixture", vec![], true);
        state.plugins.lock().expect("plugins lock").insert(
            "command-instance".into(),
            PluginInstanceData {
                plugin: Box::new(wrapper),
            },
        );

        let first = tauri::async_runtime::block_on(unload_plugin_runtime(
            "command-instance",
            None,
            state.inner(),
        ));
        let retry = tauri::async_runtime::block_on(unload_plugin_runtime(
            "command-instance",
            None,
            state.inner(),
        ));

        assert_eq!(first, Ok(()));
        assert_eq!(retry, Ok(()));
        assert!(!state
            .plugins
            .lock()
            .expect("plugins lock")
            .contains_key("command-instance"));
    }

    /// Unwrap a command's `tauri::ipc::Response` into the bytes it will actually
    /// put on the wire, failing the test if it degraded to a JSON body.
    fn raw_response_bytes(response: tauri::ipc::Response) -> Vec<u8> {
        let body = tauri::ipc::IpcResponse::body(response).expect("response body should resolve");
        match body {
            tauri::ipc::InvokeResponseBody::Raw(bytes) => bytes,
            tauri::ipc::InvokeResponseBody::Json(json) => {
                panic!("plugin state must cross as raw bytes, got a JSON body: {json}")
            }
        }
    }

    #[test]
    fn get_plugin_state_reads_engine_owned_runtime_owner_through_command_state() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", vec![1, 2, 3]);

        let result = read_plugin_state_chunk("engine-owned-fixture", &app.state::<AppState>());

        assert_eq!(result, Ok(vec![1, 2, 3]));
    }

    #[test]
    fn set_plugin_state_writes_engine_owned_runtime_owner_through_command_state() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", vec![1, 2, 3]);

        let set_result =
            write_plugin_state_chunk("engine-owned-fixture", &[9, 8, 7], &app.state::<AppState>());
        let get_result = read_plugin_state_chunk("engine-owned-fixture", &app.state::<AppState>());

        assert_eq!(set_result, Ok(()));
        assert_eq!(get_result, Ok(vec![9, 8, 7]));
    }

    #[test]
    fn get_plugin_state_bytes_returns_the_chunk_as_a_raw_body_not_a_json_number_array() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", vec![1, 2, 3]);

        let response = tauri::async_runtime::block_on(get_plugin_state_bytes(
            PluginInstanceId("engine-owned-fixture".to_string()),
            app.state::<AppState>(),
        ))
        .expect("state read should succeed");

        assert_eq!(raw_response_bytes(response), vec![1, 2, 3]);
    }

    #[test]
    fn get_plugin_state_bytes_preserves_zero_and_high_bytes_verbatim() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        let chunk = vec![0u8, 1, 127, 128, 200, 254, 255, 0];
        insert_engine_owned_fixture(&state, "engine-owned-fixture", chunk.clone());

        let response = tauri::async_runtime::block_on(get_plugin_state_bytes(
            PluginInstanceId("engine-owned-fixture".to_string()),
            app.state::<AppState>(),
        ))
        .expect("state read should succeed");

        assert_eq!(raw_response_bytes(response), chunk);
    }

    #[test]
    fn plugin_state_round_trips_every_byte_value_through_the_shared_chunk_accessors() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", Vec::new());
        let chunk: Vec<u8> = (0..=255u8).collect();

        write_plugin_state_chunk("engine-owned-fixture", &chunk, &app.state::<AppState>())
            .expect("state write should succeed");
        let restored = read_plugin_state_chunk("engine-owned-fixture", &app.state::<AppState>())
            .expect("state read should succeed");

        assert_eq!(restored, chunk);
    }

    #[test]
    fn plugin_state_accessors_reject_an_unknown_instance() {
        let app = command_test_app();

        let read = read_plugin_state_chunk("no-such-instance", &app.state::<AppState>());
        let write = write_plugin_state_chunk("no-such-instance", &[1], &app.state::<AppState>());

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
