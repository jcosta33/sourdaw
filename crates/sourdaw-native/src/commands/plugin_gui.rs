//! Plugin GUI window management.
//!
//! A plugin editor is drawn by the plugin into a bare native window the host
//! creates and owns. Creating that window is the shell's job
//! ([`PluginWindowHost`]); the lifecycle around it — open, publish, resize,
//! close, and the bookkeeping that decides whether an editor is open at all —
//! is this module's, and it reaches every format through `AudioPlugin`.

use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::commands::plugins::PluginUnloadResult;
use crate::events::{EventSink, EventSinkExt};
use crate::host::plugin_window::{
    next_editor_open_sequence, plugin_editor_window_label, PluginEditorWindow, PluginWindowHost,
};
use crate::state::AppState;
use daw_plugin_host::{AudioPlugin, EditorWindowResizer};

/// Wire event name. The TS listener mirrors this string verbatim — never rename.
pub const PLUGIN_GUI_CLOSED_EVENT: &str = "plugin-gui-closed";

/// Payload of `plugin-gui-closed`. snake_case on the wire, matching the other
/// plugin DTOs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PluginGuiClosed {
    pub instance_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginGuiInfo {
    pub has_gui: bool,
    pub is_open: bool,
    pub width: u32,
    pub height: u32,
}

/// Query whether a loaded plugin instance supports a custom GUI.
pub async fn is_plugin_gui_supported(
    instance_id: String,
    state: &AppState,
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

/// The host's answer to a plugin that resizes its own editor.
///
/// Format-neutral by construction: the plugin's backend calls this while it is
/// mid-handshake with its view, and all it may know about the host is that a
/// size can be delivered.
fn editor_window_resizer(window: &Arc<dyn PluginEditorWindow>) -> EditorWindowResizer {
    let window = Arc::clone(window);
    Arc::new(move |width, height| window.set_size(width, height))
}

/// Give the plugin everything about the host window, then open its editor.
///
/// The order is the point: a view laying itself out against its new parent may
/// resize itself, and may state its size in units it has to be told the scale
/// for, both from inside the attach. A plugin told either of those after the
/// open draws at a size the window never took.
fn open_editor_with_host_window_stated_first<Plugin: ?Sized, Opened>(
    plugin: &mut Plugin,
    state_host_window: impl FnOnce(&mut Plugin),
    open_editor: impl FnOnce(&mut Plugin) -> Opened,
) -> Opened {
    state_host_window(plugin);
    open_editor(plugin)
}

/// Open the editor, and give the host window back when the open fails.
///
/// The window was already stated to the plugin by the time `open_gui` can fail,
/// so a failure that just returned would leave the plugin holding a resizer for
/// the window this command then destroys — and answering the plugin's resize
/// requests `true` against it forever after. `close_gui` is the format-neutral
/// release, and a no-op on an editor that never opened.
fn open_editor_or_release_host_window<Plugin: AudioPlugin + ?Sized>(
    plugin: &mut Plugin,
    state_host_window: impl FnOnce(&mut Plugin),
    open_editor: impl FnOnce(&mut Plugin) -> Result<(u32, u32), String>,
) -> Result<(u32, u32), String> {
    let opened = open_editor_with_host_window_stated_first(plugin, state_host_window, open_editor);
    if opened.is_err() {
        plugin.close_gui();
    }
    opened
}

/// Open the plugin GUI in a floating native window.
///
/// MUST be async — creating windows from a synchronous command deadlocks on
/// Windows.
///
/// Flow:
/// 1. Create a bare native window (no WebView) through the shell's window host,
///    owned by the DAW window (Windows owner / macOS child window / X11
///    transient-for) so it floats above the DAW and nothing else
/// 2. Extract the native window handle (NSView/HWND/X11)
/// 3. Give the plugin the host's window resizer, then pass the handle to
///    `open_gui`, which runs that format's editor lifecycle
/// 4. Resize the window to match the plugin's preferred size
pub async fn open_plugin_gui(
    instance_id: String,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
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
    // Already open? The recorded label is the only way to ask: a label names one
    // opening, so there is nothing to derive and hand the shell. Recorded but
    // gone from the shell is a stale entry the publish below replaces.
    let open_window_label = {
        let windows = state
            .plugin_windows
            .lock()
            .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;
        windows.get(&instance_id).cloned()
    };
    if open_window_label.is_some_and(|label| windows_host.window_exists(&label)) {
        return Err("Plugin GUI is already open".to_string());
    }

    let window_label = plugin_editor_window_label(&instance_id, next_editor_open_sequence());

    // Shared rather than owned: the resizer installed below outlives this
    // command, because a plugin editor resizes itself while it is open.
    let plugin_window: Arc<dyn PluginEditorWindow> =
        Arc::from(windows_host.create_editor_window(&window_label, &plugin_name, &instance_id)?);

    // 3. Extract the native window handle
    let handle_ptr = match plugin_window.native_handle_ptr() {
        Ok(handle_ptr) => handle_ptr,
        Err(error) => {
            plugin_window.destroy();
            return Err(error);
        }
    };

    // 4. Give the plugin the host window — how to resize it, and what scale it
    //    runs at — then open its GUI.
    let resize_window = editor_window_resizer(&plugin_window);
    let scale_factor = plugin_window.scale_factor();
    let gui_size_result = if let Some(runtime) = engine_runtime.as_ref() {
        runtime.with_control(std::time::Duration::from_secs(2), |plugin| {
            open_editor_or_release_host_window(
                plugin,
                |plugin| {
                    plugin.set_editor_window_resizer(resize_window);
                    plugin.set_editor_content_scale(scale_factor);
                },
                |plugin| plugin.open_gui(handle_ptr),
            )
        })
    } else {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;
        let instance = plugins
            .get_mut(&instance_id)
            .ok_or_else(|| format!("No plugin instance: {}", instance_id))?;

        open_editor_or_release_host_window(
            instance.plugin.as_mut(),
            |plugin| {
                plugin.set_editor_window_resizer(resize_window);
                plugin.set_editor_content_scale(scale_factor);
            },
            |plugin| plugin.open_gui(handle_ptr),
        )
    };

    let (width, height) = match gui_size_result {
        Ok(size) => size,
        Err(error) => {
            plugin_window.destroy();
            return Err(error);
        }
    };

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
                plugin_window.set_size(width, height);
                plugin_window.show_and_focus();
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
                plugin_window.destroy();
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

/// Reset "GUI open" bookkeeping after the OS reports the plugin window is
/// closing (title-bar close request, or the owner-destroy cascade). The shell
/// destroys the window itself; this closes the plugin's internal GUI (hide +
/// destroy, via the same owning paths as `close_plugin_gui`) and drops the
/// `plugin_windows` entry, so a later `open_plugin_gui` recreates the GUI
/// instead of failing with "GUI is already open" on stale state and leaking the
/// plugin's internal GUI resources. It never drops the plugin, so no
/// audio-thread/retire-list concern applies.
///
/// The report names one *opening* — the shell echoes back the label it was
/// given, and a label carries the opening's sequence number — and the whole
/// reset is gated on that label still being the instance's recorded editor. A
/// report for an opening that has since been replaced therefore changes nothing
/// at all: not the record, not the plugin's GUI, not the frontend. Gating the
/// plugin teardown on the same test as the record is the point of it. An editor
/// closed and reopened is the ordinary case — the reset runs off the shell's
/// event thread, so a report can arrive after the replacement is already on
/// screen — and a reset that closed the plugin's GUI unconditionally would tear
/// down the editor the user just opened.
///
/// Idempotent by construction — a second report for one window finds the record
/// already removed — because a shell may report both a close request and a
/// destruction for the same window.
///
/// The shell must call this off its window-event thread. That thread is
/// otherwise the only event-thread caller of the plugin mutexes (`plugins`,
/// `engine_plugins`) and of `SharedHostedPlugin`'s control lock (a 2 s spin);
/// running this inline risks a circular-wait deadlock with GUI-affine plugins
/// and freezes the whole app event loop otherwise.
///
/// Emits `plugin-gui-closed` on the same condition that removes the label, and
/// only then. The frontend shows an open editor as open, and the OS is free to
/// close one behind its back — a title-bar click, the owner-destroy cascade —
/// so the transition it never asked for has to reach it, or its control keeps
/// offering to close a window that is already gone. Tying the event to the
/// removal is what keeps it truthful under the repeats this function is
/// idempotent against: a second report for the same window, or a report for a
/// window a newer editor has already replaced, changes no state and so says
/// nothing.
pub fn reset_plugin_gui_state_after_os_close(
    instance_id: &str,
    window_label: &str,
    state: &AppState,
    events: &dyn EventSink,
) {
    // Claim the window first, and do nothing at all unless the claim succeeds.
    // Taken before the plugin is touched so the record — the one piece of shared
    // state a concurrent open also writes — decides which report owns this
    // teardown.
    let removed_this_window = match state.plugin_windows.lock() {
        Ok(mut windows) => {
            let is_this_window = windows
                .get(instance_id)
                .map(|label| label == window_label)
                .unwrap_or(false);
            if is_this_window {
                windows.remove(instance_id);
            }
            is_this_window
        }
        Err(_) => false,
    };

    if !removed_this_window {
        return;
    }

    close_owning_plugin_gui(instance_id, state);

    events.emit(
        PLUGIN_GUI_CLOSED_EVENT,
        PluginGuiClosed {
            instance_id: instance_id.to_string(),
        },
    );
}

/// Close the plugin's own GUI through whichever map owns the instance.
///
/// Command-owned first, then engine-owned: an instance lives in exactly one of
/// them, and reaching the engine's runtime costs a control-lock wait that a
/// command-owned instance must not pay.
fn close_owning_plugin_gui(instance_id: &str, state: &AppState) {
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

    if closed_command_owned {
        return;
    }

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
pub async fn close_plugin_gui(
    instance_id: String,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
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
            state.with_engine_plugin_control(&instance_id, |plugin| {
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
        windows_host.destroy_window(&label);
    }

    Ok(())
}

/// Record one engine-owned instance's close attempt into the closed/failed
/// report.
///
/// A close of *all* editors is a convergence operation across independent
/// instances: one that is mid-unload, or that holds its control lock past the
/// 2 s timeout, says nothing about the others. Propagating its error abandoned
/// every remaining instance AND the window destruction that follows, so a
/// single slow plugin left native windows on screen with no owner and no way to
/// close them. Each outcome is recorded and the pass continues.
fn record_plugin_gui_close_outcome(
    report: &mut PluginUnloadResult,
    instance_id: &str,
    close_result: Result<(), String>,
) {
    match close_result {
        Ok(()) => report.0.push(instance_id.to_string()),
        Err(error) => report.1.push(format!("{}: {}", instance_id, error)),
    }
}

/// Close every open plugin editor window.
///
/// Registered as a command for the webview, and called on the app-exit path so
/// a session's editors get their CLAP `gui.destroy` before the process goes
/// away.
///
/// The report speaks only about editors: an instance with no recorded editor
/// window has nothing to close and appears in neither list. Returns the
/// instances whose editors closed and, per failing instance, the reason. Native
/// windows are destroyed either way.
pub async fn close_all_plugin_guis(
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<PluginUnloadResult, String> {
    close_every_plugin_gui(Some(windows_host), state)
}

/// The window host is optional because the exit path may run after the shell's
/// windows are already gone: the CLAP `gui.destroy` still has to happen, and a
/// missing window server is not a reason to skip it.
pub fn close_every_plugin_gui(
    windows_host: Option<&dyn PluginWindowHost>,
    state: &AppState,
) -> Result<PluginUnloadResult, String> {
    let mut report = PluginUnloadResult::default();

    // Membership in `plugin_windows` is what "has an editor" means. Reporting an
    // instance with no editor as closed, or as failing to close, describes work
    // that was never owed — and on the exit path that noise is the only signal a
    // real failure has.
    let instances_with_editors: std::collections::HashSet<String> = {
        let windows = state
            .plugin_windows
            .lock()
            .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;
        windows.keys().cloned().collect()
    };

    // Close all CLAP GUIs
    {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;
        for (instance_id, instance) in plugins.iter_mut() {
            if !instances_with_editors.contains(instance_id) {
                continue;
            }
            instance.close_gui();
            report.0.push(instance_id.clone());
        }
    }

    let engine_instance_ids: Vec<String> = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|e| format!("Failed to lock engine_plugins: {}", e))?;
        engine_plugins
            .keys()
            .filter(|instance_id| instances_with_editors.contains(*instance_id))
            .cloned()
            .collect()
    };

    for instance_id in engine_instance_ids {
        let close_result = state.with_engine_plugin_control(&instance_id, |plugin| {
            plugin.close_gui();
            Ok(())
        });
        record_plugin_gui_close_outcome(&mut report, &instance_id, close_result);
    }

    // Destroy all native windows. Unconditional: a window whose plugin refused
    // to close its editor is exactly the window that must not be left behind.
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
        if let Some(windows_host) = windows_host {
            windows_host.destroy_window(&label);
        }
    }

    Ok(report)
}

/// Hide all plugin GUI windows (called when DAW is minimized).
pub async fn hide_all_plugin_guis(
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<(), String> {
    let windows = state
        .plugin_windows
        .lock()
        .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;

    for label in windows.values() {
        windows_host.hide_window(label);
    }

    Ok(())
}

/// Show all plugin GUI windows (called when DAW is restored from minimized).
pub async fn show_all_plugin_guis(
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<(), String> {
    let windows = state
        .plugin_windows
        .lock()
        .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;

    for label in windows.values() {
        windows_host.show_window(label);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::NoopEventSink;
    use crate::host::native_bridge::SharedHostedPlugin;
    use crate::host::plugin_window::NoWindowHost;
    use crate::state::{AppState, EnginePluginInstanceData};
    use daw_plugin_host::ClapWrapper;
    use std::cell::Cell;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct RecordingEventSink {
        events: Mutex<Vec<(String, serde_json::Value)>>,
    }

    impl RecordingEventSink {
        fn events(&self) -> Vec<(String, serde_json::Value)> {
            self.events.lock().expect("event log").clone()
        }
    }

    impl EventSink for RecordingEventSink {
        fn emit_json(&self, event: &str, payload: serde_json::Value) {
            self.events
                .lock()
                .expect("event log")
                .push((event.to_string(), payload));
        }
    }

    fn insert_engine_owned_fixture(state: &AppState, instance_id: &str, has_gui: bool) {
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Engine Owned Fixture", vec![], has_gui);
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
                parameters: Vec::new(),
                has_gui,
                bridge: None,
                relay_scratch: crate::state::PluginRelayScratch::default(),
            },
        );
    }

    fn engine_fixture_runtime(state: &AppState, instance_id: &str) -> Arc<SharedHostedPlugin> {
        let engine_plugins = state.engine_plugins.lock().expect("engine_plugins lock");
        Arc::clone(
            &engine_plugins
                .get(instance_id)
                .expect("engine fixture should exist")
                .runtime,
        )
    }

    /// One instance failing to close its editor used to abandon every instance
    /// after it AND the window destruction, leaving native windows on screen
    /// with no owner and no way to close them.
    #[test]
    fn closing_every_gui_continues_past_an_instance_that_refuses() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "refusing-instance", true);
        insert_engine_owned_fixture(&state, "healthy-instance", true);
        // An instance mid-unload rejects public control — the exact case that
        // used to abort the pass.
        engine_fixture_runtime(&state, "refusing-instance").begin_unload();
        {
            let mut windows = state.plugin_windows.lock().expect("plugin_windows lock");
            windows.insert("refusing-instance".into(), "plugin-refusing".into());
            windows.insert("healthy-instance".into(), "plugin-healthy".into());
        }

        let report = close_every_plugin_gui(Some(&NoWindowHost), &state)
            .expect("a refusing instance must not fail the whole pass");

        assert_eq!(
            report.0,
            ["healthy-instance"],
            "the instances that did close must be reported"
        );
        assert_eq!(report.1.len(), 1);
        assert!(
            report.1[0].starts_with("refusing-instance: "),
            "the error report must name the instance that failed, got: {:?}",
            report.1
        );
        assert!(
            state
                .plugin_windows
                .lock()
                .expect("plugin_windows lock")
                .is_empty(),
            "every native window must be destroyed even when an instance refuses"
        );
    }

    /// The report is about editors. An instance with no editor window has
    /// nothing to close, so claiming it closed — or that it failed to — is a
    /// false statement about work that was never owed, and on the exit path
    /// that noise is the only signal a real failure has.
    #[test]
    fn an_instance_with_no_editor_window_appears_in_neither_close_list() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "engine-with-editor", true);
        insert_engine_owned_fixture(&state, "engine-without-editor", true);
        state.plugins.lock().expect("plugins lock").insert(
            "command-without-editor".into(),
            crate::state::PluginInstanceData {
                plugin: Box::new(ClapWrapper::new_engine_owned_command_fixture(
                    "Command Fixture",
                    vec![],
                    true,
                )),
            },
        );
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert(
                "engine-with-editor".into(),
                "plugin-engine-with-editor".into(),
            );

        let report = close_every_plugin_gui(Some(&NoWindowHost), &state)
            .expect("closing every editor should succeed");

        assert_eq!(
            report.0,
            ["engine-with-editor"],
            "only instances that actually had an editor may be reported as closed"
        );
        assert!(
            report.1.is_empty(),
            "an instance with no editor is not a failure, got: {:?}",
            report.1
        );
    }

    /// Our own close paths destroy the window, so a shell can report a
    /// destruction after a reset has already run for the same window. The reset
    /// must tolerate that: repeating it may not leave the instance unopenable.
    #[test]
    fn repeating_the_reset_for_the_same_window_is_idempotent() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", true);
        let runtime = engine_fixture_runtime(&state, "engine-owned-fixture");
        runtime
            .with_control(std::time::Duration::from_secs(2), |plugin| {
                plugin.open_gui(std::ptr::null_mut())
            })
            .expect("the fixture GUI should open");
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert(
                "engine-owned-fixture".to_string(),
                "plugin-engine-owned-fixture".to_string(),
            );

        let events = RecordingEventSink::default();
        reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            "plugin-engine-owned-fixture",
            &state,
            &events,
        );
        reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            "plugin-engine-owned-fixture",
            &state,
            &events,
        );

        assert!(state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .is_empty());
        assert_eq!(
            events.events().len(),
            1,
            "the second report changes no state, so it must not tell the frontend the editor \
             closed a second time"
        );
        assert!(
            runtime
                .with_control(std::time::Duration::from_secs(2), |plugin| {
                    plugin.open_gui(std::ptr::null_mut())
                })
                .is_ok(),
            "a repeated reset must still leave the editor openable"
        );
    }

    #[test]
    fn is_plugin_gui_supported_queries_the_engine_owned_runtime_owner() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", true);

        let result = crate::block_on_test(is_plugin_gui_supported(
            "engine-owned-fixture".to_string(),
            &state,
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

    #[test]
    fn os_close_resets_engine_owned_gui_state_and_reopen_recreates_gui() {
        let state = AppState::default();
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

        let events = RecordingEventSink::default();
        reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            "plugin-engine-owned-fixture",
            &state,
            &events,
        );

        assert!(state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .get("engine-owned-fixture")
            .is_none());
        assert_eq!(
            events.events(),
            [(
                PLUGIN_GUI_CLOSED_EVENT.to_string(),
                serde_json::json!({ "instance_id": "engine-owned-fixture" })
            )],
            "an editor the OS closed must reach the frontend, which still shows it as open"
        );

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

    /// The reachable staleness: the shell reports a close off the app's event
    /// thread, so the report can arrive after the user has already reopened that
    /// instance's editor. The report names the opening it belongs to, and the
    /// editor on screen belongs to a later one, so nothing about it may be
    /// touched — least of all the plugin's GUI, which is the live editor.
    #[test]
    fn a_close_report_for_a_replaced_editor_leaves_the_live_one_alone() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", true);
        let runtime = engine_fixture_runtime(&state, "engine-owned-fixture");

        let closed_label =
            plugin_editor_window_label("engine-owned-fixture", next_editor_open_sequence());
        let live_label =
            plugin_editor_window_label("engine-owned-fixture", next_editor_open_sequence());
        assert_ne!(
            closed_label, live_label,
            "two openings of one instance must not share a label, or no report can be placed"
        );

        // The editor the user is looking at now, published under its own label.
        let size = runtime.with_control(std::time::Duration::from_secs(2), |plugin| {
            plugin.open_gui(std::ptr::null_mut())
        });
        assert!(size.is_ok());
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert("engine-owned-fixture".to_string(), live_label.clone());

        let events = RecordingEventSink::default();
        reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            &closed_label,
            &state,
            &events,
        );

        assert_eq!(
            state
                .plugin_windows
                .lock()
                .expect("plugin_windows lock")
                .get("engine-owned-fixture")
                .cloned(),
            Some(live_label),
            "the live editor keeps its record"
        );
        assert!(
            events.events().is_empty(),
            "the instance still has an open editor, so reporting it closed would blank a \
             control that works"
        );

        let reopen = runtime.with_control(std::time::Duration::from_secs(2), |plugin| {
            plugin.open_gui(std::ptr::null_mut())
        });
        assert_eq!(
            reopen.err().as_deref(),
            Some("GUI is already open"),
            "the stale report must not have closed the plugin's GUI out from under the editor \
             the user just opened"
        );
    }

    #[test]
    fn os_close_removes_window_label_for_unknown_instance_without_plugins() {
        let state = AppState::default();
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert("ghost".to_string(), "plugin-ghost".to_string());

        reset_plugin_gui_state_after_os_close("ghost", "plugin-ghost", &state, &NoopEventSink);

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

    /// A view lays itself out against its new parent from inside the attach, and
    /// it may resize itself or state a size in scaled units while it does. Both
    /// answers have to be installed before the open, or the editor draws at a
    /// size the host window never took.
    #[test]
    fn open_editor_with_host_window_stated_first_states_the_window_before_the_open() {
        let mut order: Vec<&'static str> = Vec::new();

        let opened = open_editor_with_host_window_stated_first(
            &mut order,
            |order| order.push("window"),
            |order| {
                order.push("open");
                (640, 480)
            },
        );

        assert_eq!(opened, (640, 480));
        assert_eq!(order.as_slice(), ["window", "open"]);
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
