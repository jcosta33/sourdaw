//! Plugin GUI window management.
//!
//! A plugin editor is drawn by the plugin into a bare native window the host
//! creates and owns. Creating that window is the shell's job
//! ([`PluginWindowHost`]); the lifecycle around it — open, publish, resize,
//! close, and the bookkeeping that decides whether an editor is open at all —
//! is this module's, and it reaches every format through `AudioPlugin`.
//!
//! Both formats make that lifecycle thread-affine, so every call into a plugin's
//! editor leaves here through [`call_on_ui_thread`]. The order is the same
//! everywhere and it is what keeps the shell answering: the runtime owner's
//! control claim is taken on this worker, and only the plugin call itself
//! crosses to the shell's thread. A claim taken on that thread instead would
//! park it behind whatever holds the gate, and whatever holds the gate is
//! waiting for that same thread.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

use crate::commands::plugins::PluginUnloadResult;
use crate::events::{EventSink, EventSinkExt};
use crate::host::plugin_window::{
    next_editor_open_sequence, plugin_editor_window_label, NoWindowHost, PluginEditorWindow,
    PluginWindowHost,
};
use crate::host::ui_thread::{call_on_ui_thread, LentMut};
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

/// Make one editor lifecycle call on the shell's UI thread, and wait for it.
///
/// The caller keeps its control claim on its own thread; only the call crosses.
/// The borrow crosses with it as a lend rather than as a reference, because a
/// plugin runtime is reachable across threads only through the access seam that
/// produced this `&mut` — and what makes the lend sound is that this does not
/// return until the call has run.
fn on_editor_thread<Target: ?Sized + 'static, Produced: Send + 'static>(
    windows_host: &dyn PluginWindowHost,
    target: &mut Target,
    call: impl FnOnce(&mut Target) -> Produced + Send + 'static,
) -> Result<Produced, String> {
    let lent = LentMut::new(target);
    call_on_ui_thread(windows_host, move || {
        // SAFETY: the borrow is lent for exactly this call, and `call_on_ui_thread`
        // parks the lender for every instant it is readable here.
        unsafe { lent.with(call) }
    })
}

/// Open the plugin GUI in a floating native window.
///
/// MUST be async — creating windows from a synchronous command deadlocks on
/// Windows.
///
/// Flow:
/// 1. Find the instance and which map owns it, and refuse one with no editor
/// 2. Refuse an instance whose editor is already open — a recorded window label
///    the shell still has is what that means
/// 3. Create a bare native window (no WebView) through the shell's window host,
///    owned by the DAW window (Windows owner / macOS child window / X11
///    transient-for) so it floats above the DAW and nothing else
/// 4. Extract the native window handle (NSView/HWND/X11)
/// 5. Give the plugin the host's window resizer, then pass the handle to
///    `open_gui`, which runs that format's editor lifecycle
/// 6. Publish the window and resize it to the plugin's preferred size
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

    // 2. Already open? The recorded label is the only way to ask: a label names one
    // opening, so there is nothing to derive and hand the shell. Recorded but
    // gone from the shell is a stale entry the publish below replaces.
    let open_window_label = {
        let windows = state
            .plugin_windows
            .lock()
            .map_err(|e| format!("Failed to lock plugin_windows: {}", e))?;
        windows.get(&instance_id).cloned()
    };
    if open_window_label
        .as_deref()
        .is_some_and(|label| windows_host.window_exists(label))
    {
        return Err("Plugin GUI is already open".to_string());
    }

    // 3. Create a bare native window (no WebView) for the plugin editor
    let window_label = plugin_editor_window_label(&instance_id, next_editor_open_sequence());

    // Shared rather than owned: the resizer installed below outlives this
    // command, because a plugin editor resizes itself while it is open.
    let plugin_window: Arc<dyn PluginEditorWindow> =
        Arc::from(windows_host.create_editor_window(&window_label, &plugin_name, &instance_id)?);

    // 4. Extract the native window handle
    let handle_ptr = match plugin_window.native_handle_ptr() {
        Ok(handle_ptr) => handle_ptr,
        Err(error) => {
            plugin_window.destroy();
            return Err(error);
        }
    };

    // 5. Give the plugin the host window — how to resize it, and what scale it
    //    runs at — then open its GUI.
    let resize_window = editor_window_resizer(&plugin_window);
    let scale_factor = plugin_window.scale_factor();
    // Carried as an integer because a raw pointer cannot cross a thread, and
    // cast back on the far side — the same representation `JsEditorWindow` holds
    // it in for the same reason.
    let handle = handle_ptr as usize;
    let open_editor = move |plugin: &mut dyn AudioPlugin| {
        open_editor_or_release_host_window(
            plugin,
            |plugin| {
                plugin.set_editor_window_resizer(resize_window);
                plugin.set_editor_content_scale(scale_factor);
            },
            |plugin| plugin.open_gui(handle as *mut std::ffi::c_void),
        )
    };
    let gui_size_result = if let Some(runtime) = engine_runtime.as_ref() {
        runtime
            .with_control(std::time::Duration::from_secs(2), |plugin| {
                on_editor_thread(windows_host, plugin, move |plugin| open_editor(plugin))
            })
            .and_then(|opened| opened)
    } else {
        let mut plugins = state
            .plugins
            .lock()
            .map_err(|e| format!("Failed to lock plugins: {}", e))?;
        let instance = plugins
            .get_mut(&instance_id)
            .ok_or_else(|| format!("No plugin instance: {}", instance_id))?;

        on_editor_thread(windows_host, instance.plugin.as_mut(), move |plugin| {
            open_editor(plugin)
        })
        .and_then(|opened| opened)
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
                claim_editor_record_for_opened_window(
                    &mut windows,
                    &instance_id,
                    open_window_label.as_deref(),
                    &window_label,
                )
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
                    on_editor_thread(windows_host, plugin, |plugin| plugin.close_gui())
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
    } else if let Err(error) = publish_window() {
        // Same unwind the engine branch gets, for the same reason: the editor is
        // open inside the plugin and its window exists, and returning with both
        // standing leaks a window the user cannot reach and an editor the next
        // open is refused for.
        if let Ok(mut plugins) = state.plugins.lock() {
            if let Some(instance) = plugins.get_mut(&instance_id) {
                let _ = on_editor_thread(windows_host, instance, |instance| instance.close_gui());
            }
        }
        plugin_window.destroy();
        return Err(error);
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

/// Record the window that just opened, but only if nothing claimed this
/// instance's editor while it was opening.
///
/// A compare-and-swap against what this open's own already-open check saw. The
/// OS-close reset claims by removing the record, and it can do that in the gap
/// between that check and here — for the opening it was reported against, which
/// was legitimately still recorded. Its teardown then closes the plugin's GUI,
/// and this window would be shown over an editor that is already dead.
///
/// So a claim raised after this opening began loses the window: the open is
/// refused, its caller tears down what it built, and the user gets a refusal
/// they can act on rather than an empty frame.
fn claim_editor_record_for_opened_window(
    windows: &mut HashMap<String, String>,
    instance_id: &str,
    observed: Option<&str>,
    window_label: &str,
) -> Result<(), String> {
    if windows.get(instance_id).map(String::as_str) != observed {
        return Err("Plugin editor state changed while its window was opening".to_string());
    }

    windows.insert(instance_id.to_string(), window_label.to_string());
    Ok(())
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
    windows_host: &dyn PluginWindowHost,
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

    close_owning_plugin_gui(instance_id, windows_host, state);

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
fn close_owning_plugin_gui(
    instance_id: &str,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) {
    let closed_command_owned = match state.plugins.lock() {
        Ok(mut plugins) => match plugins.get_mut(instance_id) {
            Some(instance) => {
                let _ = on_editor_thread(windows_host, instance, |instance| instance.close_gui());
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
            on_editor_thread(windows_host, plugin, |plugin| plugin.close_gui())
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
            on_editor_thread(windows_host, instance, |instance| instance.close_gui())?;
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
                on_editor_thread(windows_host, plugin, |plugin| plugin.close_gui())
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
    // An exit that has already lost its windows has also lost the shell thread
    // they lived on, and `NoWindowHost` says so: the editor calls run here,
    // which is the only thread left to run them on.
    let editor_thread = windows_host.unwrap_or(&NoWindowHost);

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
            let _ = on_editor_thread(editor_thread, instance, |instance| instance.close_gui());
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
            on_editor_thread(editor_thread, plugin, |plugin| plugin.close_gui())
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

    /// Every thread the fixture's editor lifecycle ran on, newest last.
    type GuiLifecycleThreads = Arc<Mutex<Vec<std::thread::ThreadId>>>;

    fn insert_engine_owned_fixture(state: &AppState, instance_id: &str, has_gui: bool) {
        insert_engine_owned_fixture_watching_gui_threads(state, instance_id, has_gui);
    }

    fn insert_engine_owned_fixture_watching_gui_threads(
        state: &AppState,
        instance_id: &str,
        has_gui: bool,
    ) -> GuiLifecycleThreads {
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Engine Owned Fixture", vec![], has_gui);
        let gui_threads = wrapper
            .engine_owned_command_fixture_gui_threads()
            .expect("the command fixture records its editor lifecycle threads");
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
                parameter_events: None,
            },
        );
        gui_threads
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

    /// A window host with a thread of its own, the way a shell's main loop has
    /// one, and a bare window to hand back.
    ///
    /// Its thread does nothing but drain the editor work posted to it, which is
    /// what makes "which thread reached the plugin" answerable: the id it
    /// records can only appear in the fixture's log if the call was carried
    /// here.
    struct DedicatedUiWindowHost {
        work: std::sync::mpsc::Sender<Arc<crate::host::ui_thread::UiThreadTask>>,
        thread_id: std::thread::ThreadId,
        thread: Mutex<Option<std::thread::JoinHandle<()>>>,
    }

    impl DedicatedUiWindowHost {
        fn start() -> Self {
            let (work, queued) =
                std::sync::mpsc::channel::<Arc<crate::host::ui_thread::UiThreadTask>>();
            let (announce, announced) = std::sync::mpsc::channel();
            let thread = std::thread::spawn(move || {
                announce
                    .send(std::thread::current().id())
                    .expect("the fake UI thread must announce itself");
                while let Ok(task) = queued.recv() {
                    task.run();
                }
            });
            let thread_id = announced.recv().expect("the fake UI thread must start");
            Self {
                work,
                thread_id,
                thread: Mutex::new(Some(thread)),
            }
        }
    }

    impl Drop for DedicatedUiWindowHost {
        fn drop(&mut self) {
            let (closed, _) = std::sync::mpsc::channel();
            drop(std::mem::replace(&mut self.work, closed));
            if let Some(thread) = self.thread.lock().expect("ui thread handle").take() {
                let _ = thread.join();
            }
        }
    }

    impl crate::host::ui_thread::UiThread for DedicatedUiWindowHost {
        fn is_ui_thread(&self) -> bool {
            std::thread::current().id() == self.thread_id
        }

        fn run_on_ui_thread(
            &self,
            task: &Arc<crate::host::ui_thread::UiThreadTask>,
        ) -> Result<(), String> {
            let (done, waited) = std::sync::mpsc::sync_channel(1);
            let queued = Arc::clone(task);
            self.work
                .send(crate::host::ui_thread::UiThreadTask::new(move || {
                    queued.run();
                    let _ = done.send(());
                }))
                .map_err(|_| "the fake UI thread is gone".to_string())?;
            waited
                .recv()
                .map_err(|_| "the fake UI thread never answered".to_string())
        }
    }

    struct BareEditorWindow;

    impl PluginEditorWindow for BareEditorWindow {
        fn native_handle_ptr(&self) -> Result<*mut std::ffi::c_void, String> {
            Ok(std::ptr::null_mut())
        }

        fn set_size(&self, _width: u32, _height: u32) {}

        fn show_and_focus(&self) {}

        fn destroy(&self) {}
    }

    impl PluginWindowHost for DedicatedUiWindowHost {
        fn window_exists(&self, _label: &str) -> bool {
            false
        }

        fn create_editor_window(
            &self,
            _label: &str,
            _title: &str,
            _instance_id: &str,
        ) -> Result<Box<dyn PluginEditorWindow>, String> {
            Ok(Box::new(BareEditorWindow))
        }

        fn destroy_window(&self, _label: &str) {}

        fn hide_window(&self, _label: &str) {}

        fn show_window(&self, _label: &str) {}
    }

    fn recorded_threads(threads: &GuiLifecycleThreads) -> Vec<std::thread::ThreadId> {
        threads.lock().expect("gui thread log").clone()
    }

    /// The whole point of the change. CLAP marks the `gui` extension
    /// `[main-thread]` and VST3 binds `IPlugView` to the thread that owns the
    /// parent window, and the command runs on a worker — so the open has to
    /// land on the shell's thread, not on the one that took the control claim.
    #[test]
    fn opening_an_editor_runs_the_plugins_gui_lifecycle_on_the_shell_thread() {
        let state = AppState::default();
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "engine-owned-fixture", true);
        let windows = DedicatedUiWindowHost::start();

        crate::block_on_test(open_plugin_gui(
            "engine-owned-fixture".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");

        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id],
            "the editor lifecycle must run on the shell's thread and nowhere else"
        );
        assert_ne!(
            windows.thread_id,
            std::thread::current().id(),
            "the fake shell thread must not be this one, or this test proves nothing"
        );
    }

    /// The close half. `close_gui` is what reaches VST3 `removed` and CLAP
    /// `gui.destroy`, both as thread-affine as the open, and it runs from a
    /// different command with a different control claim.
    #[test]
    fn closing_an_editor_runs_the_plugins_gui_lifecycle_on_the_shell_thread() {
        let state = AppState::default();
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "engine-owned-fixture", true);
        let windows = DedicatedUiWindowHost::start();
        crate::block_on_test(open_plugin_gui(
            "engine-owned-fixture".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");

        crate::block_on_test(close_plugin_gui(
            "engine-owned-fixture".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should close");

        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "the close must reach the plugin on the shell's thread, like the open"
        );
    }

    /// The OS-close path reaches the same lifecycle from the shell's own report
    /// rather than from a command, and it is the path a title-bar click takes.
    #[test]
    fn an_os_close_runs_the_plugins_gui_lifecycle_on_the_shell_thread() {
        let state = AppState::default();
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "engine-owned-fixture", true);
        let windows = DedicatedUiWindowHost::start();
        let opened = crate::block_on_test(open_plugin_gui(
            "engine-owned-fixture".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");
        assert!(opened.is_open);
        let label = state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .get("engine-owned-fixture")
            .cloned()
            .expect("the open must have recorded a window");

        reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            &label,
            &windows,
            &state,
            &NoopEventSink,
        );

        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "an OS close must reach the plugin on the shell's thread too"
        );
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
            &NoWindowHost,
            &state,
            &events,
        );
        reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            "plugin-engine-owned-fixture",
            &NoWindowHost,
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
            &NoWindowHost,
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
            &NoWindowHost,
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

        reset_plugin_gui_state_after_os_close(
            "ghost",
            "plugin-ghost",
            &NoWindowHost,
            &state,
            &NoopEventSink,
        );

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

    /// The ordinary open: nothing touched the record while the window was being
    /// built, so this opening takes it.
    #[test]
    fn an_opening_nothing_disturbed_claims_the_editor_record() {
        let mut windows = HashMap::from([("inst-1".to_string(), "plugin-inst-1:1".to_string())]);

        let claimed = claim_editor_record_for_opened_window(
            &mut windows,
            "inst-1",
            Some("plugin-inst-1:1"),
            "plugin-inst-1:2",
        );

        assert_eq!(claimed, Ok(()));
        assert_eq!(
            windows.get("inst-1").map(String::as_str),
            Some("plugin-inst-1:2")
        );
    }

    /// The hole this closes: an OS-close reset claims by *removing* the record,
    /// and it can do that between this open's already-open read and here. Its
    /// teardown closes the plugin's GUI, so publishing anyway would show a
    /// window over a dead editor.
    #[test]
    fn an_opening_whose_record_was_claimed_meanwhile_is_refused_rather_than_shown() {
        let mut windows: HashMap<String, String> = HashMap::new();

        let claimed = claim_editor_record_for_opened_window(
            &mut windows,
            "inst-1",
            Some("plugin-inst-1:1"),
            "plugin-inst-1:2",
        );

        assert!(claimed.is_err());
        assert!(
            windows.is_empty(),
            "a refused claim must leave the record exactly as it found it"
        );
    }

    /// The other side of the same race: another open won, and its window is the
    /// one on screen.
    #[test]
    fn an_opening_a_newer_one_overtook_does_not_replace_its_record() {
        let mut windows = HashMap::from([("inst-1".to_string(), "plugin-inst-1:3".to_string())]);

        let claimed = claim_editor_record_for_opened_window(
            &mut windows,
            "inst-1",
            Some("plugin-inst-1:1"),
            "plugin-inst-1:2",
        );

        assert!(claimed.is_err());
        assert_eq!(
            windows.get("inst-1").map(String::as_str),
            Some("plugin-inst-1:3")
        );
    }

    /// The first editor of an instance's life: no record, and none expected.
    #[test]
    fn a_first_opening_claims_a_record_that_was_never_there() {
        let mut windows: HashMap<String, String> = HashMap::new();

        let claimed =
            claim_editor_record_for_opened_window(&mut windows, "inst-1", None, "plugin-inst-1:1");

        assert_eq!(claimed, Ok(()));
        assert_eq!(
            windows.get("inst-1").map(String::as_str),
            Some("plugin-inst-1:1")
        );
    }

    /// A plugin that records what the editor lifecycle did to it. The real
    /// backends answer through the plugin's own SDK; what matters here is the
    /// order and the release, which the trait alone decides.
    struct RecordingPlugin {
        opens: Result<(u32, u32), String>,
        calls: Vec<&'static str>,
    }

    impl AudioPlugin for RecordingPlugin {
        fn process(&mut self, _: &[&[f32]], _: &mut [&mut [f32]], _: usize) {}
        fn set_parameter(&mut self, _: u32, _: f64) {}
        fn get_parameters(&self) -> Vec<daw_plugin_host::PluginParameter> {
            Vec::new()
        }
        fn get_state(&self) -> Result<Vec<u8>, String> {
            Ok(Vec::new())
        }
        fn set_state(&mut self, _: &[u8]) -> Result<(), String> {
            Ok(())
        }

        fn set_editor_window_resizer(&mut self, _: daw_plugin_host::EditorWindowResizer) {
            self.calls.push("window");
        }

        fn open_gui(&mut self, _: *mut std::ffi::c_void) -> Result<(u32, u32), String> {
            self.calls.push("open");
            self.opens.clone()
        }

        fn close_gui(&mut self) {
            self.calls.push("close");
        }
    }

    /// `open_gui` failing leaves the plugin holding a resizer for a window the
    /// caller is about to destroy — and, for CLAP, still answering resize
    /// requests `true` against it. The close is that release.
    #[test]
    fn an_editor_that_failed_to_open_gives_the_host_window_back() {
        let mut plugin = RecordingPlugin {
            opens: Err("gui.create() failed".to_string()),
            calls: Vec::new(),
        };

        let opened = open_editor_or_release_host_window(
            &mut plugin,
            |plugin| plugin.set_editor_window_resizer(Arc::new(|_, _| {})),
            |plugin| plugin.open_gui(std::ptr::null_mut()),
        );

        assert!(opened.is_err());
        assert_eq!(plugin.calls.as_slice(), ["window", "open", "close"]);
    }

    /// The release is for the failure only: closing after a successful open
    /// would tear down the editor the caller is about to show.
    #[test]
    fn an_editor_that_opened_keeps_the_host_window() {
        let mut plugin = RecordingPlugin {
            opens: Ok((640, 480)),
            calls: Vec::new(),
        };

        let opened = open_editor_or_release_host_window(
            &mut plugin,
            |plugin| plugin.set_editor_window_resizer(Arc::new(|_, _| {})),
            |plugin| plugin.open_gui(std::ptr::null_mut()),
        );

        assert_eq!(opened, Ok((640, 480)));
        assert_eq!(plugin.calls.as_slice(), ["window", "open"]);
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
