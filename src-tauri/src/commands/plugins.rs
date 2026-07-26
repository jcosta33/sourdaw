//! Tauri commands for plugin scanning, loading, and parameter management.

use crate::commands::binary_ipc::{raw_body_bytes, read_percent_encoded_header};
use crate::host::native_bridge::{ClapPluginSlot, SharedClapPlugin};
use crate::host::plugin_scan_policy::PluginScanPolicy;
use crate::state::{AppState, PluginInstanceData, PluginRegistryEntry};
use cpal::traits::{DeviceTrait, HostTrait};
use daw_engine::audio_bridge::create_audio_bridge;
use daw_engine::plugin_slot::{MidiNoteEvent, TransportState};
use daw_engine::EngineHandle;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Manager;
use daw_plugin_host::scanner::{self, ScanResult};
use daw_plugin_host::{AudioPlugin, ClapWrapper, Vst3Wrapper};

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

fn remove_engine_plugin_record_after_scheduler_removal<EnginePluginRecord>(
    engine_plugins: &mut HashMap<String, EnginePluginRecord>,
    instance_id: &str,
    scheduler_removal_result: Result<(), String>,
) -> Result<Option<EnginePluginRecord>, String> {
    scheduler_removal_result?;
    Ok(engine_plugins.remove(instance_id))
}

// ── Scanning commands ───────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn scan_plugins(
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<ScanResult, String> {
    let start = std::time::Instant::now();
    let scan_policy = PluginScanPolicy::platform_defaults();
    let mut plugins = Vec::new();
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
        scanner::scan_directory(&path, &mut plugins, &mut errors);
    }

    // Populate the plugin registry so load_plugin can find them
    if let Ok(mut registry) = state.plugin_registry.lock() {
        for p in &plugins {
            let clap_id = if p.format == "clap" {
                let (_, id) = scanner::extract_clap_metadata(Path::new(&p.path));
                id
            } else {
                String::new()
            };

            registry.insert(
                p.id.clone(),
                PluginRegistryEntry {
                    path: p.path.clone(),
                    clap_id,
                    format: p.format.clone(),
                    name: p.name.clone(),
                },
            );
        }
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
            let wrapper = Vst3Wrapper::new(&entry.path)?;
            let name = wrapper.get_name().to_string();
            let params = wrapper.get_parameters();

            // Store in plugins map (VST3 runs through the same AudioPlugin trait)
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

            Ok(PluginInstance {
                instance_id: instance_id.clone(),
                plugin_id: plugin_id.clone(),
                name,
                parameters: params,
                is_active: true,
                latency_samples: 0,
                latency_ms: 0.0,
                engine_plugin_id: None,
            })
        }
        "au" => Err(
            "Audio Unit plugin loading is not yet implemented. CLAP plugins are supported."
                .to_string(),
        ),
        _ => Err(format!("Unknown plugin format: {}", entry.format)),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn unload_plugin(
    instance_id: PluginInstanceId,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;

        if plugins.remove(&instance_id.0).is_some() {
            return Ok(());
        }
    }

    let engine_plugin = {
        let mut engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        let engine_plugin = engine_plugins.get(&instance_id.0);
        if let Some(instance) = engine_plugin {
            instance.runtime.begin_unload();
        }
        engine_plugin.map(|instance| (instance.engine_plugin_id, Arc::clone(&instance.runtime)))
    };

    if let Some((engine_plugin_id, runtime)) = engine_plugin {
        state
            .inner()
            .retain_retired_engine_plugin(Arc::clone(&runtime));

        let close_result =
            runtime.with_unload_control(std::time::Duration::from_secs(2), |plugin| {
                plugin.close_gui();
                Ok(())
            });

        let window_label = {
            let mut windows = state
                .plugin_windows
                .lock()
                .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;
            windows.remove(&instance_id.0)
        };

        if let Some(label) = window_label {
            if let Some(window) = app.get_window(&label) {
                let _ = window.destroy();
            }
        }

        let scheduler_removal_result = {
            let mut engine_guard = state
                .engine
                .lock()
                .map_err(|e| format!("Failed to lock engine: {}", e))?;
            let engine = engine_guard.as_mut().ok_or("Native engine not running")?;
            engine.remove_plugin(engine_plugin_id)
        };

        {
            let mut engine_plugins = state
                .engine_plugins
                .lock()
                .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
            let _removed_engine_plugin = remove_engine_plugin_record_after_scheduler_removal(
                &mut engine_plugins,
                &instance_id.0,
                scheduler_removal_result,
            )?;
        }

        runtime.retire();

        let mut bridges = state
            .audio_bridges
            .lock()
            .map_err(|e| format!("Failed to lock audio_bridges: {}", e))?;
        bridges.remove(&engine_plugin_id);

        close_result?;
        return Ok(());
    }

    Err(format!(
        "No plugin instance found with id: {}",
        instance_id.0
    ))
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

    let mut handle =
        EngineHandle::new().map_err(|e| format!("Failed to start native audio engine: {}", e))?;

    // Create the default tuning source inside daw-engine, which owns the triple-buffer dependency.
    handle.register_default_mts_esp_master();

    eprintln!("[Engine] Native audio engine started with MTS-ESP support");
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

    // Update MTS-ESP tuning master (background task)
    if let Ok(mut engine_guard) = state.engine.lock() {
        if let Some(ref mut engine) = *engine_guard {
            engine.update_mts_esp();
        }
    }

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

        assert_eq!(read, Err("No plugin instance: no-such-instance".to_string()));
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
        let mut engine_plugins = std::collections::HashMap::from([(
            "engine-owned-1".to_string(),
            42_u32,
        )]);

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
        let mut engine_plugins = std::collections::HashMap::from([(
            "engine-owned-1".to_string(),
            42_u32,
        )]);

        let result = remove_engine_plugin_record_after_scheduler_removal(
            &mut engine_plugins,
            "engine-owned-1",
            Ok(()),
        );

        assert_eq!(result, Ok(Some(42_u32)));
        assert!(!engine_plugins.contains_key("engine-owned-1"));
    }
}
