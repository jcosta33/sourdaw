//! Tauri commands for plugin GUI window management.
//!
//! Creates bare native windows (no WebView) via `WindowBuilder` with the
//! `unstable` feature, extracts the native window handle, and passes it to
//! the CLAP plugin's GUI extension.

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginGuiInfo {
    pub has_gui: bool,
    pub is_open: bool,
    pub width: u32,
    pub height: u32,
}

/// Query whether a loaded plugin instance supports a custom GUI.
#[tauri::command]
pub async fn is_plugin_gui_supported(
    instance_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    {
        let plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;

        if let Some(instance) = plugins.get(&instance_id) {
            return Ok(instance.has_gui());
        }
    }

    let engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
    if let Some(instance) = engine_plugins.get(&instance_id) {
        return Ok(instance.has_gui);
    }

    Err(format!("No plugin instance: {}", instance_id))
}

/// Open the plugin GUI in a floating native window.
///
/// MUST be async — creating windows from sync Tauri commands deadlocks on Windows.
///
/// Flow:
/// 1. Create a bare native Window (no WebView) via WindowBuilder
/// 2. Set parent relationship to main window (plugin floats above DAW)
/// 3. Extract native window handle (NSView/HWND/X11)
/// 4. Pass handle to ClapWrapper::open_gui() which runs the CLAP GUI lifecycle
/// 5. Resize the window to match the plugin's preferred size
#[tauri::command]
pub async fn open_plugin_gui(
    instance_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<PluginGuiInfo, String> {
    // 1. Get plugin name and check GUI support
    let (plugin_name, is_engine_owned) = {
        let plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;
        match plugins.get(&instance_id) {
            Some(instance) => {
                if !instance.has_gui() {
                    return Err("Plugin does not support GUI".to_string());
                }

                (instance.get_name().to_string(), false)
            }
            None => {
                let engine_plugins = state
                    .engine_plugins
                    .lock()
                    .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
                if let Some(engine_instance) = engine_plugins.get(&instance_id) {
                    if !engine_instance.has_gui {
                        return Err("Plugin does not support GUI".to_string());
                    }

                    (engine_instance.name.clone(), true)
                } else {
                    return Err(format!("No plugin instance: {}", instance_id));
                }
            }
        }
    };

    // 2. Create a bare native window (no WebView) for the plugin editor
    let window_label = format!("plugin-{}", instance_id.replace('.', "-").replace(':', "-"));

    // Check if window already exists (GUI already open)
    if app.get_window(&window_label).is_some() {
        return Err("Plugin GUI is already open".to_string());
    }

    let plugin_window = tauri::window::WindowBuilder::new(&app, &window_label)
        .title(&plugin_name)
        .inner_size(800.0, 600.0)
        .decorations(true)
        .resizable(false)
        .visible(false)
        .always_on_top(true) // Keep plugin windows above the main DAW window
        .build()
        .map_err(|e| format!("Failed to create plugin window: {}", e))?;

    // 3. Extract the native window handle
    let handle_ptr_result = plugin_window
        .window_handle()
        .map_err(|e| format!("Failed to get window handle: {}", e))
        .and_then(|handle| match handle.as_raw() {
            RawWindowHandle::AppKit(h) => Ok(h.ns_view.as_ptr()),
            #[cfg(target_os = "windows")]
            RawWindowHandle::Win32(h) => Ok(h.hwnd.get() as *mut std::ffi::c_void),
            RawWindowHandle::Xlib(h) => Ok(h.window as *mut std::ffi::c_void),
            _ => Err("Unsupported platform for plugin GUI".to_string()),
        });

    let handle_ptr = match handle_ptr_result {
        Ok(handle_ptr) => handle_ptr,
        Err(error) => {
            let _ = plugin_window.destroy();
            return Err(error);
        }
    };

    // 4. Open the plugin GUI (CLAP lifecycle: create → scale → get_size → set_parent → show)
    let gui_size_result = if is_engine_owned {
        state.inner().with_engine_plugin_control(&instance_id, |plugin| {
            plugin.open_gui(handle_ptr)
        })
    } else {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;
        let instance = plugins
            .get_mut(&instance_id)
            .ok_or_else(|| format!("No plugin instance: {}", instance_id))?;

        instance.open_gui(handle_ptr)
    };

    let (width, height) = match gui_size_result {
        Ok(size) => size,
        Err(error) => {
            let _ = plugin_window.destroy();
            return Err(error);
        }
    };

    // 5. Resize the window to match the plugin's preferred size and show it
    let _ = plugin_window.set_size(tauri::LogicalSize::new(width, height));
    let _ = plugin_window.show();
    let _ = plugin_window.set_focus();

    // 6. Track the window
    {
        let mut windows = state
            .plugin_windows
            .lock()
            .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;
        windows.insert(instance_id.clone(), window_label);
    }

    Ok(PluginGuiInfo {
        has_gui: true,
        is_open: true,
        width,
        height,
    })
}

/// Close the plugin GUI and destroy the native window.
#[tauri::command]
pub async fn close_plugin_gui(
    instance_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let closed_command_owned = {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;
        if let Some(instance) = plugins.get_mut(&instance_id) {
            instance.close_gui();
            true
        } else {
            false
        }
    };

    if !closed_command_owned {
        let is_engine_owned = {
            let engine_plugins = state
                .engine_plugins
                .lock()
                .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
            engine_plugins.contains_key(&instance_id)
        };

        if is_engine_owned {
            state.inner().with_engine_plugin_control(&instance_id, |plugin| {
                plugin.close_gui();
                Ok(())
            })?;
        }
    }

    // Destroy the native window
    let window_label = {
        let mut windows = state
            .plugin_windows
            .lock()
            .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;
        windows.remove(&instance_id)
    };

    if let Some(label) = window_label {
        if let Some(win) = app.get_window(&label) {
            let _ = win.destroy();
        }
    }

    Ok(())
}

/// Close ALL plugin GUI windows (called on app exit or minimize).
#[tauri::command]
pub async fn close_all_plugin_guis(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // Close all CLAP GUIs
    {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;
        for instance in plugins.values_mut() {
            instance.close_gui();
        }
    }

    let engine_instance_ids: Vec<String> = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        engine_plugins.keys().cloned().collect()
    };

    for instance_id in engine_instance_ids {
        state.inner().with_engine_plugin_control(&instance_id, |plugin| {
            plugin.close_gui();
            Ok(())
        })?;
    }

    // Destroy all native windows
    let labels: Vec<String> = {
        let mut windows = state
            .plugin_windows
            .lock()
            .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;
        let labels: Vec<String> = windows.values().cloned().collect();
        windows.clear();
        labels
    };

    for label in labels {
        if let Some(win) = app.get_window(&label) {
            let _ = win.destroy();
        }
    }

    Ok(())
}

/// Hide all plugin GUI windows (called when DAW is minimized).
#[tauri::command]
pub async fn hide_all_plugin_guis(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let windows = state
        .plugin_windows
        .lock()
        .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;

    for label in windows.values() {
        if let Some(win) = app.get_window(label) {
            let _ = win.hide();
        }
    }

    Ok(())
}

/// Show all plugin GUI windows (called when DAW is restored from minimized).
#[tauri::command]
pub async fn show_all_plugin_guis(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let windows = state
        .plugin_windows
        .lock()
        .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;

    for label in windows.values() {
        if let Some(win) = app.get_window(label) {
            let _ = win.show();
        }
    }

    Ok(())
}
