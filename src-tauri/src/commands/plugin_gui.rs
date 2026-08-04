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
        instance.runtime.ensure_public_control_allowed()?;
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
    let (plugin_name, engine_runtime) = {
        let plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;
        match plugins.get(&instance_id) {
            Some(instance) => {
                if !instance.has_gui() {
                    return Err("Plugin does not support GUI".to_string());
                }

                (instance.get_name().to_string(), None)
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

                    engine_instance.runtime.ensure_public_control_allowed()?;

                    (
                        engine_instance.name.clone(),
                        Some(std::sync::Arc::clone(&engine_instance.runtime)),
                    )
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
    let gui_size_result = if let Some(runtime) = engine_runtime.as_ref() {
        runtime.with_control(std::time::Duration::from_secs(2), |plugin| {
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

    // OS-level close (title-bar button): Tauri destroys the window by default.
    // Schedule the plugin GUI state reset when that happens so a later open
    // recreates the GUI instead of failing on stale state and leaking the
    // plugin's internal GUI (audit #508 row 10).
    {
        let close_app = app.clone();
        let close_instance_id = instance_id.clone();
        let close_window_label = window_label.clone();
        plugin_window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                schedule_plugin_gui_reset_after_os_close(
                    close_instance_id.clone(),
                    close_window_label.clone(),
                    close_app.clone(),
                );
            }
        });
    }

    let publish_window = || -> Result<(), String> {
        publish_plugin_gui_window_in_label_order(
            || {
                let mut windows = state
                    .plugin_windows
                    .lock()
                    .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;
                windows.insert(instance_id.clone(), window_label.clone());
                Ok(())
            },
            || {
                let _ = plugin_window.set_size(tauri::LogicalSize::new(width, height));
                let _ = plugin_window.show();
                let _ = plugin_window.set_focus();
            },
        )
    };

    if let Some(runtime) = engine_runtime.as_ref() {
        let publish_result = publish_engine_gui_window_with_lifecycle_checks(
            || runtime.ensure_public_control_allowed(),
            publish_window,
        );
        cleanup_opened_engine_gui_after_rejected_lifecycle(
            publish_result,
            || {
                let _ = runtime.with_unload_control(std::time::Duration::from_secs(2), |plugin| {
                    plugin.close_gui();
                    Ok(())
                });
            },
            || {
                if let Ok(mut windows) = state.plugin_windows.lock() {
                    let should_remove = windows
                        .get(&instance_id)
                        .map(|label| label == &window_label)
                        .unwrap_or(false);
                    if should_remove {
                        windows.remove(&instance_id);
                    }
                }
            },
            || {
                let _ = plugin_window.destroy();
            },
        )?;
    } else {
        publish_window()?;
    }

    Ok(PluginGuiInfo {
        has_gui: true,
        is_open: true,
        width,
        height,
    })
}

fn publish_engine_gui_window_with_lifecycle_checks(
    ensure_public_control_allowed: impl Fn() -> Result<(), String>,
    publish_window: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    ensure_public_control_allowed()?;
    publish_window()?;
    ensure_public_control_allowed()
}

/// Publish the plugin window: record the window label BEFORE showing. A close
/// racing the show path must always find the label recorded, otherwise the
/// close-requested reset would miss it and leave a stale entry behind.
fn publish_plugin_gui_window_in_label_order(
    insert_label: impl FnOnce() -> Result<(), String>,
    show_window: impl FnOnce(),
) -> Result<(), String> {
    insert_label()?;
    show_window();
    Ok(())
}

/// Hand the OS-close reset to the async runtime and return its join handle.
///
/// The CloseRequested handler runs on the Tauri event thread — the only
/// event-thread caller of the plugin mutexes (`plugins`, `engine_plugins`) and
/// of `SharedClapPlugin`'s control lock (a 2 s spin). Doing that work inline
/// risks a circular-wait deadlock with GUI-affine plugins and freezes the
/// whole app event loop otherwise, so the handler only spawns; Tauri destroys
/// the window regardless. The handle is returned so tests can await the
/// scheduled reset; the handler itself detaches.
fn schedule_plugin_gui_reset_after_os_close<R: tauri::Runtime>(
    instance_id: String,
    window_label: String,
    app: tauri::AppHandle<R>,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        reset_plugin_gui_state_after_os_close(
            &instance_id,
            &window_label,
            app.state::<AppState>().inner(),
        );
    })
}

/// Reset "GUI open" bookkeeping after the OS reports the plugin window is
/// closing (title-bar close request). Tauri's default handling destroys the
/// window itself; this closes the plugin's internal GUI (hide + destroy, via
/// the same owning paths as `close_plugin_gui`) and drops the `plugin_windows`
/// entry, so a later `open_plugin_gui` recreates the GUI instead of failing
/// with "GUI is already open" on stale state and leaking the plugin's
/// internal GUI resources. The label is compare-and-removed: a newer window
/// published for the same instance since the close must keep its entry.
/// It never drops the plugin, so no audio-thread/retire-list concern applies.
fn reset_plugin_gui_state_after_os_close(instance_id: &str, window_label: &str, state: &AppState) {
    let closed_command_owned = match state.plugins.lock() {
        Ok(mut plugins) => match plugins.get_mut(instance_id) {
            Some(instance) => {
                instance.close_gui();
                true
            }
            None => false,
        },
        Err(_) => false,
    };

    if !closed_command_owned {
        let is_engine_owned = state
            .engine_plugins
            .lock()
            .map(|engine_plugins| engine_plugins.contains_key(instance_id))
            .unwrap_or(false);

        if is_engine_owned {
            let _ = state.with_engine_plugin_control(instance_id, |plugin| {
                plugin.close_gui();
                Ok(())
            });
        }
    }

    if let Ok(mut windows) = state.plugin_windows.lock() {
        let is_this_window = windows
            .get(instance_id)
            .map(|label| label == window_label)
            .unwrap_or(false);
        if is_this_window {
            windows.remove(instance_id);
        }
    }
}

fn cleanup_opened_engine_gui_after_rejected_lifecycle(
    lifecycle_result: Result<(), String>,
    close_gui: impl FnOnce(),
    remove_window_label: impl FnOnce(),
    destroy_window: impl FnOnce(),
) -> Result<(), String> {
    if let Err(error) = lifecycle_result {
        close_gui();
        remove_window_label();
        destroy_window();
        return Err(error);
    }

    Ok(())
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
            state
                .inner()
                .with_engine_plugin_control(&instance_id, |plugin| {
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
        state
            .inner()
            .with_engine_plugin_control(&instance_id, |plugin| {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::native_bridge::SharedClapPlugin;
    use crate::state::{AppState, EnginePluginInstanceData};
    use daw_plugin_host::ClapWrapper;
    use std::cell::Cell;
    use std::sync::Arc;
    use tauri::Manager;

    fn command_test_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .manage(AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("test app should build")
    }

    fn insert_engine_owned_fixture(
        state: &tauri::State<'_, AppState>,
        instance_id: &str,
        has_gui: bool,
    ) {
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Engine Owned Fixture", vec![], has_gui);
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
                parameters: Vec::new(),
                has_gui,
            },
        );
    }

    #[test]
    fn is_plugin_gui_supported_queries_engine_owned_runtime_owner_through_command_state() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", true);

        let result = tauri::async_runtime::block_on(is_plugin_gui_supported(
            "engine-owned-fixture".to_string(),
            app.state::<AppState>(),
        ));

        assert_eq!(result, Ok(true));
    }

    #[test]
    fn publish_engine_gui_window_with_lifecycle_checks_rejects_before_publish() {
        let published = Cell::new(false);

        let result = publish_engine_gui_window_with_lifecycle_checks(
            || Err("Engine-owned plugin instance 'fixture' is unloading".to_string()),
            || {
                published.set(true);
                Ok(())
            },
        );

        assert_eq!(
            result,
            Err("Engine-owned plugin instance 'fixture' is unloading".to_string())
        );
        assert!(!published.get());
    }

    #[test]
    fn publish_engine_gui_window_with_lifecycle_checks_rejects_after_publish() {
        let lifecycle_checks = Cell::new(0);
        let published = Cell::new(false);

        let result = publish_engine_gui_window_with_lifecycle_checks(
            || {
                let checks = lifecycle_checks.get() + 1;
                lifecycle_checks.set(checks);
                if checks == 1 {
                    Ok(())
                } else {
                    Err("Engine-owned plugin instance 'fixture' is unloading".to_string())
                }
            },
            || {
                published.set(true);
                Ok(())
            },
        );

        assert_eq!(
            result,
            Err("Engine-owned plugin instance 'fixture' is unloading".to_string())
        );
        assert!(published.get());
        assert_eq!(lifecycle_checks.get(), 2);
    }

    #[test]
    fn cleanup_opened_engine_gui_after_rejected_lifecycle_closes_gui_and_window() {
        let closed_gui = Cell::new(false);
        let removed_window_label = Cell::new(false);
        let destroyed_window = Cell::new(false);

        let result = cleanup_opened_engine_gui_after_rejected_lifecycle(
            Err("Engine-owned plugin instance 'fixture' is unloading".to_string()),
            || {
                closed_gui.set(true);
            },
            || {
                removed_window_label.set(true);
            },
            || {
                destroyed_window.set(true);
            },
        );

        assert_eq!(
            result,
            Err("Engine-owned plugin instance 'fixture' is unloading".to_string())
        );
        assert!(closed_gui.get());
        assert!(removed_window_label.get());
        assert!(destroyed_window.get());
    }

    #[test]
    fn cleanup_opened_engine_gui_after_rejected_lifecycle_keeps_gui_on_success() {
        let closed_gui = Cell::new(false);
        let removed_window_label = Cell::new(false);
        let destroyed_window = Cell::new(false);

        let result = cleanup_opened_engine_gui_after_rejected_lifecycle(
            Ok(()),
            || {
                closed_gui.set(true);
            },
            || {
                removed_window_label.set(true);
            },
            || {
                destroyed_window.set(true);
            },
        );

        assert_eq!(result, Ok(()));
        assert!(!closed_gui.get());
        assert!(!removed_window_label.get());
        assert!(!destroyed_window.get());
    }

    fn engine_fixture_runtime(
        state: &tauri::State<'_, AppState>,
        instance_id: &str,
    ) -> Arc<SharedClapPlugin> {
        let engine_plugins = state.engine_plugins.lock().expect("engine_plugins lock");
        std::sync::Arc::clone(
            &engine_plugins
                .get(instance_id)
                .expect("engine fixture should exist")
                .runtime,
        )
    }

    #[test]
    fn os_close_resets_engine_owned_gui_state_and_reopen_recreates_gui() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", true);
        let runtime = engine_fixture_runtime(&state, "engine-owned-fixture");

        // Open (as open_plugin_gui does) and record the window label.
        let size = runtime.with_control(std::time::Duration::from_secs(2), |plugin| {
            plugin.open_gui(std::ptr::null_mut())
        });
        assert!(size.is_ok());
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert(
                "engine-owned-fixture".to_string(),
                "plugin-engine-owned-fixture".to_string(),
            );

        // OS-level close: the event-thread handler only schedules the reset on
        // the async runtime (non-blocking); await the scheduled work here.
        let reset = schedule_plugin_gui_reset_after_os_close(
            "engine-owned-fixture".to_string(),
            "plugin-engine-owned-fixture".to_string(),
            app.handle().clone(),
        );
        tauri::async_runtime::block_on(reset).expect("scheduled reset should complete");

        assert!(state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .get("engine-owned-fixture")
            .is_none());

        // The reopen path reaches open_gui with clean state and recreates the GUI.
        let reopened = runtime.with_control(std::time::Duration::from_secs(2), |plugin| {
            plugin.open_gui(std::ptr::null_mut())
        });
        assert!(
            reopened.is_ok(),
            "reopen after OS-level close must recreate the GUI, got: {:?}",
            reopened.err()
        );
    }

    #[test]
    fn os_close_reset_keeps_label_when_a_newer_window_was_published() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", true);
        let runtime = engine_fixture_runtime(&state, "engine-owned-fixture");

        let size = runtime.with_control(std::time::Duration::from_secs(2), |plugin| {
            plugin.open_gui(std::ptr::null_mut())
        });
        assert!(size.is_ok());

        // A newer window for the same instance was published after the close
        // event fired: the reset for the OLD window must not remove its label.
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert(
                "engine-owned-fixture".to_string(),
                "plugin-newer".to_string(),
            );

        reset_plugin_gui_state_after_os_close("engine-owned-fixture", "plugin-older", &state);

        assert_eq!(
            state
                .plugin_windows
                .lock()
                .expect("plugin_windows lock")
                .get("engine-owned-fixture")
                .cloned(),
            Some("plugin-newer".to_string())
        );
    }

    #[test]
    fn os_close_removes_window_label_for_unknown_instance_without_plugins() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert("ghost".to_string(), "plugin-ghost".to_string());

        reset_plugin_gui_state_after_os_close("ghost", "plugin-ghost", &state);

        assert!(state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .is_empty());
    }

    #[test]
    fn publish_plugin_gui_window_in_label_order_inserts_label_before_showing() {
        let order = std::cell::RefCell::new(Vec::new());

        let result = publish_plugin_gui_window_in_label_order(
            || {
                order.borrow_mut().push("insert");
                Ok(())
            },
            || {
                order.borrow_mut().push("show");
            },
        );

        assert_eq!(result, Ok(()));
        assert_eq!(order.borrow().as_slice(), ["insert", "show"]);
    }

    #[test]
    fn publish_plugin_gui_window_in_label_order_skips_show_when_insert_fails() {
        let shown = Cell::new(false);

        let result = publish_plugin_gui_window_in_label_order(
            || Err("Failed to lock plugin_windows: poisoned".to_string()),
            || {
                shown.set(true);
            },
        );

        assert_eq!(
            result,
            Err("Failed to lock plugin_windows: poisoned".to_string())
        );
        assert!(!shown.get());
    }
}
