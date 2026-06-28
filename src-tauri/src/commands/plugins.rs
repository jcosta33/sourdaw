//! Tauri commands for plugin scanning, loading, and parameter management.

use crate::host::native_bridge::{ClapPluginSlot, SharedClapPlugin};
use crate::state::{AppState, PluginInstanceData, PluginRegistryEntry};
use cpal::traits::{DeviceTrait, HostTrait};
use daw_engine::audio_bridge::create_audio_bridge;
use daw_engine::plugin_slot::{MidiNoteEvent, TransportState};
use daw_engine::EngineHandle;
use serde::{Deserialize, Serialize};
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
    pub latency_samples: u32,
    pub engine_plugin_id: Option<usize>,
}

// ── Scanning commands ───────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn scan_plugins(
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<ScanResult, String> {
    let start = std::time::Instant::now();
    let mut plugins = Vec::new();
    let mut errors = Vec::new();

    for scan_path in &paths {
        let path = PathBuf::from(scan_path);
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
    let mut paths = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            let home = home.display();
            paths.push(format!("{home}/Library/Audio/Plug-Ins/VST3"));
            paths.push("/Library/Audio/Plug-Ins/VST3".to_string());
            paths.push(format!("{home}/Library/Audio/Plug-Ins/CLAP"));
            paths.push("/Library/Audio/Plug-Ins/CLAP".to_string());
            paths.push(format!("{home}/Library/Audio/Plug-Ins/Components"));
            paths.push("/Library/Audio/Plug-Ins/Components".to_string());
        }
    }

    #[cfg(target_os = "windows")]
    {
        paths.push("C:\\Program Files\\Common Files\\VST3".to_string());
        paths.push("C:\\Program Files\\Common Files\\CLAP".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            let home = home.display();
            paths.push(format!("{home}/.vst3"));
            paths.push(format!("{home}/.clap"));
            paths.push("/usr/lib/vst3".to_string());
            paths.push("/usr/lib/clap".to_string());
        }
    }

    Ok(paths)
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
                .map(|c| c.sample_rate().0 as f64)
                .unwrap_or(48000.0);

            let wrapper = ClapWrapper::new(&entry.path, &clap_id, sample_rate)?;
            let name = wrapper.get_name().to_string();
            let params = wrapper.get_parameters();
            let has_gui = wrapper.has_gui();

            // Send the plugin to the native audio thread for real-time processing
            // and create an audio bridge for worklet ↔ Rust data transfer
            let engine_plugin_id = {
                let mut engine_guard = state
                    .engine
                    .lock()
                    .map_err(|e| format!("Failed to lock engine: {}", e))?;
                if let Some(ref mut engine) = *engine_guard {
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
                latency_samples: 0,
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

    let engine_plugin_id = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        engine_plugins
            .get(&instance_id.0)
            .map(|instance| instance.engine_plugin_id)
    };

    if let Some(engine_plugin_id) = engine_plugin_id {
        state
            .inner()
            .with_engine_plugin_control(&instance_id.0, |plugin| {
                plugin.close_gui();
                Ok(())
            })?;

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

        let mut engine_guard = state
            .engine
            .lock()
            .map_err(|e| format!("Failed to lock engine: {}", e))?;
        let engine = engine_guard.as_mut().ok_or("Native engine not running")?;
        engine.remove_plugin(engine_plugin_id)?;
        drop(engine_guard);

        let mut bridges = state
            .audio_bridges
            .lock()
            .map_err(|e| format!("Failed to lock audio_bridges: {}", e))?;
        bridges.remove(&engine_plugin_id);

        let mut engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        let removed_instance = engine_plugins.remove(&instance_id.0);
        drop(engine_plugins);

        if let Some(instance) = removed_instance {
            let mut retired_plugins = state
                .retired_engine_plugins
                .lock()
                .map_err(|e| format!("Failed to lock retired_engine_plugins: {}", e))?;
            retired_plugins.push(instance.runtime);
        }

        return Ok(());
    }

    Err(format!(
        "No plugin instance found with id: {}",
        instance_id.0
    ))
}

// ── Parameter commands ──────────────────────────────────────────────────

fn update_parameter_cache_after_apply(
    parameters: &mut [PluginParameter],
    param_id: u32,
    value: f64,
    apply_result: Result<(), String>,
) -> Result<(), String> {
    apply_result?;

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

    let runtime = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        engine_plugins
            .get(&instance_id.0)
            .map(|instance| Arc::clone(&instance.runtime))
    };

    if let Some(runtime) = runtime {
        let apply_result = runtime.with_control(std::time::Duration::from_secs(2), |plugin| {
            plugin.set_parameter(param_id, value);
            Ok(())
        });

        let mut engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        if let Some(instance) = engine_plugins.get_mut(&instance_id.0) {
            update_parameter_cache_after_apply(
                &mut instance.parameters,
                param_id,
                value,
                apply_result,
            )?;
        } else {
            apply_result?;
        }

        return Ok(());
    }

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
        return Ok(instance.parameters.clone());
    }

    Err(format!("No plugin instance: {}", instance_id.0))
}

#[tauri::command]
#[specta::specta]
pub async fn get_plugin_state(
    instance_id: PluginInstanceId,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    {
        let plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;

        if let Some(instance) = plugins.get(&instance_id.0) {
            return Ok(instance.plugin.get_state());
        }
    }

    let engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
    if engine_plugins.contains_key(&instance_id.0) {
        drop(engine_plugins);
        return state.inner().with_engine_plugin_control(&instance_id.0, |plugin| {
            Ok(plugin.get_state())
        });
    }

    Err(format!("No plugin instance: {}", instance_id.0))
}

#[tauri::command]
#[specta::specta]
pub async fn set_plugin_state(
    instance_id: PluginInstanceId,
    plugin_state: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;

        if let Some(instance) = plugins.get_mut(&instance_id.0) {
            instance.plugin.set_state(&plugin_state)?;
            return Ok(());
        }
    }

    let engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
    if engine_plugins.contains_key(&instance_id.0) {
        drop(engine_plugins);
        return state.inner().with_engine_plugin_control(&instance_id.0, |plugin| {
            plugin.set_state(&plugin_state)
        });
    }

    Err(format!("No plugin instance: {}", instance_id.0))
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
            probability: 1.0,
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
#[tauri::command]

pub async fn process_plugin_audio(
    engine_plugin_id: usize,
    audio_bytes: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<u8>, String> {
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
        // Re-interleave and encode as raw bytes
        let n = num_samples.min(128);
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

    #[test]
    fn update_parameter_cache_after_apply_updates_only_after_success() {
        let mut parameters = vec![plugin_parameter(7, 0.25)];

        let result = update_parameter_cache_after_apply(&mut parameters, 7, 0.75, Ok(()));

        assert!(result.is_ok());
        assert_eq!(parameters[0].value, 0.75);
    }

    #[test]
    fn update_parameter_cache_after_apply_preserves_cache_after_failure() {
        let mut parameters = vec![plugin_parameter(7, 0.25)];

        let result = update_parameter_cache_after_apply(
            &mut parameters,
            7,
            0.75,
            Err("control unavailable".to_string()),
        );

        assert_eq!(result, Err("control unavailable".to_string()));
        assert_eq!(parameters[0].value, 0.25);
    }
}
