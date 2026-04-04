//! Tauri commands for plugin scanning, loading, and parameter management.

use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use daw_plugin_host::{ClapWrapper, Vst3Wrapper, AudioPlugin};
use daw_plugin_host::scanner::{self, ScannedPlugin, ScanResult};
use crate::host::native_bridge::ClapPluginSlot;
use crate::state::{AppState, PluginInstanceData, PluginRegistryEntry};
use daw_engine::EngineHandle;
use daw_engine::plugin_slot::{MidiNoteEvent, TransportState};

// Re-export PluginParameter from daw-plugin-host for TypeScript binding generation
pub use daw_plugin_host::PluginParameter;

// Re-export for use by other modules
pub use daw_plugin_host::ScannedPlugin as ScannedPluginInfo;

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

            registry.insert(p.id.clone(), PluginRegistryEntry {
                path: p.path.clone(),
                clap_id,
                format: p.format.clone(),
                name: p.name.clone(),
            });
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
        let registry = state.plugin_registry.lock()
            .map_err(|e| format!("Failed to lock registry: {}", e))?;
        registry.get(&plugin_id.0).cloned()
            .ok_or_else(|| format!("Plugin {} not found in registry. Run a scan first.", plugin_id.0))?
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

            // Send the plugin to the native audio thread for real-time processing
            // and create an audio bridge for worklet ↔ Rust data transfer
            let engine_plugin_id = {
                let mut engine_guard = state.engine.lock()
                    .map_err(|e| format!("Failed to lock engine: {}", e))?;
                if let Some(ref mut engine) = *engine_guard {
                    let slot = ClapPluginSlot::new(wrapper);
                    let id = engine.add_plugin(Box::new(slot))?;

                    // Create ring-buffer audio bridge
                    let bridge_handle = engine.create_audio_bridge(id)?;
                    let mut bridges = state.audio_bridges.lock()
                        .map_err(|e| format!("Failed to lock audio_bridges: {}", e))?;
                    bridges.insert(id, bridge_handle);

                    id
                } else {
                    eprintln!("[Plugin] Warning: native engine not running, plugin won't process audio");
                    let mut plugins = state.plugins.lock()
                        .map_err(|e| format!("Failed to lock plugins: {}", e))?;
                    plugins.insert(instance_id.0.clone(), PluginInstanceData {
                        plugin: Box::new(wrapper),
                    });
                    0
                }
            };

            let instance = PluginInstance {
                instance_id: instance_id.clone(),
                plugin_id: plugin_id.clone(),
                name,
                parameters: params,
                is_active: true,
                latency_samples: 0,
            };

            Ok(instance)
        }
        "vst3" => {
            let wrapper = Vst3Wrapper::new(&entry.path)?;
            let name = wrapper.get_name().to_string();
            let params = wrapper.get_parameters();

            // Store in plugins map (VST3 runs through the same AudioPlugin trait)
            let mut plugins = state.plugins.lock()
                .map_err(|e| format!("Failed to lock plugins: {}", e))?;
            plugins.insert(instance_id.0.clone(), PluginInstanceData {
                plugin: Box::new(wrapper),
            });

            Ok(PluginInstance {
                instance_id: instance_id.clone(),
                plugin_id: plugin_id.clone(),
                name,
                parameters: params,
                is_active: true,
                latency_samples: 0,
            })
        }
        "au" => Err("Audio Unit plugin loading is not yet implemented. CLAP plugins are supported.".to_string()),
        _ => Err(format!("Unknown plugin format: {}", entry.format)),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn unload_plugin(
    instance_id: PluginInstanceId,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut plugins = state.plugins.lock()
        .map_err(|e| format!("Failed to lock plugins: {}", e))?;

    if plugins.remove(&instance_id.0).is_none() {
        return Err(format!("No plugin instance found with id: {}", instance_id.0));
    }

    Ok(())
}

// ── Parameter commands ──────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn set_plugin_parameter(
    instance_id: PluginInstanceId,
    param_id: u32,
    value: f64,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut plugins = state.plugins.lock()
        .map_err(|e| format!("Failed to lock plugins: {}", e))?;

    let instance = plugins.get_mut(&instance_id.0)
        .ok_or_else(|| format!("No plugin instance: {}", instance_id.0))?;

    instance.plugin.set_parameter(param_id, value);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_plugin_parameters(
    instance_id: PluginInstanceId,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PluginParameter>, String> {
    let plugins = state.plugins.lock()
        .map_err(|e| format!("Failed to lock plugins: {}", e))?;

    let instance = plugins.get(&instance_id.0)
        .ok_or_else(|| format!("No plugin instance: {}", instance_id.0))?;

    Ok(instance.plugin.get_parameters())
}

#[tauri::command]
#[specta::specta]
pub async fn get_plugin_state(
    instance_id: PluginInstanceId,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let plugins = state.plugins.lock()
        .map_err(|e| format!("Failed to lock plugins: {}", e))?;

    let instance = plugins.get(&instance_id.0)
        .ok_or_else(|| format!("No plugin instance: {}", instance_id.0))?;

    Ok(instance.plugin.get_state())
}

#[tauri::command]
#[specta::specta]
pub async fn set_plugin_state(
    instance_id: PluginInstanceId,
    plugin_state: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut plugins = state.plugins.lock()
        .map_err(|e| format!("Failed to lock plugins: {}", e))?;

    let instance = plugins.get_mut(&instance_id.0)
        .ok_or_else(|| format!("No plugin instance: {}", instance_id.0))?;

    instance.plugin.set_state(&plugin_state);
    Ok(())
}

// ── Native audio engine ────────────────────────────────────────────────

#[tauri::command]

pub async fn start_native_engine(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let mut engine_guard = state.engine.lock()
        .map_err(|e| format!("Failed to lock engine: {}", e))?;

    if engine_guard.is_some() {
        return Ok("Native engine already running".to_string());
    }

    let handle = EngineHandle::new()
        .map_err(|e| format!("Failed to start native audio engine: {}", e))?;

    eprintln!("[Engine] Native audio engine started");
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
    let mut engine_guard = state.engine.lock()
        .map_err(|e| format!("Failed to lock engine: {}", e))?;
    let engine = engine_guard.as_mut()
        .ok_or("Native engine not running")?;

    engine.send_midi_note(engine_plugin_id, MidiNoteEvent {
        note, velocity, channel, is_note_on,
    })
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
    let mut engine_guard = state.engine.lock()
        .map_err(|e| format!("Failed to lock engine: {}", e))?;
    let engine = engine_guard.as_mut()
        .ok_or("Native engine not running")?;

    engine.set_transport(TransportState {
        tempo, time_sig_num, time_sig_denom, is_playing,
        song_pos_beats, song_pos_seconds,
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
    let mut bridges = state.audio_bridges.lock()
        .map_err(|e| format!("Failed to lock audio_bridges: {}", e))?;

    let bridge = bridges.get_mut(&engine_plugin_id)
        .ok_or_else(|| format!("No audio bridge for plugin {}", engine_plugin_id))?;

    // Interpret raw bytes as interleaved f32 samples
    let num_floats = audio_bytes.len() / 4;
    let num_samples = num_floats / 2;

    let audio_data: Vec<f32> = audio_bytes.chunks_exact(4)
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

    // Try to pop processed output (may be from previous block — 1 block latency)
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
