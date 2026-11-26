//! Plugin GUI window management.
//!
//! A plugin editor is drawn by the plugin into a bare native window the host
//! creates and owns. Creating that window is the shell's job
//! ([`PluginWindowHost`]); the lifecycle around it — open, publish, resize,
//! close, and the bookkeeping that decides whether an editor is open at all —
//! is this module's, and it reaches every format through `AudioPlugin`.
//!
//! Both formats make that lifecycle thread-affine, so every call into a plugin's
//! editor crosses to the shell's thread through
//! [`ControlVisit::on_ui_thread`](crate::host::native_bridge::ControlVisit::on_ui_thread).
//! The order is the same everywhere and it is what keeps the shell answering:
//! the runtime owner's control gate is taken on this worker, and only the plugin
//! call itself crosses. A gate taken on that thread instead would park it
//! behind whatever holds the gate, and whatever holds the gate is waiting for
//! that same thread.
//!
//! No editor call holds the audio access seam across that crossing. The seam is
//! claimed once the call has landed on the shell's thread and let go when the
//! plugin call returns, so a shell busy with something else delays the editor,
//! never the plugin's audio. Landed, the call makes one non-blocking try: the
//! shell's thread never waits for the seam, whatever the audio thread is doing.
//! A busy seam sends the call back to this worker, which holds the gate, backs
//! off and hops again until the editor control timeout, then refuses.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, MutexGuard, PoisonError, TryLockError};

use super::plugins::lock_plugin_lifecycle;
use crate::events::{EventSink, EventSinkExt};
use crate::host::native_bridge::{PluginControlError, PluginControlRefusal, SharedHostedPlugin};
use crate::host::plugin_editor_asks::editor_window_host;
use crate::host::plugin_window::{
    next_editor_open_sequence, plugin_editor_window_label, NoWindowHost, PluginEditorWindow,
    PluginWindowError, PluginWindowHost,
};
use crate::host::ui_thread::{UiThreadError, EDITOR_UI_THREAD_DEADLINE};
use crate::state::{
    AppState, EditorTeardownSignal, EnginePluginControlError, PluginInstanceData,
    PluginWindowRecords,
};
use daw_plugin_host::{
    AudioPlugin, EditorWindowResizer, HostedRuntime, PluginError, SharedEditorWindow,
};

/// Wire event name. The TS listener mirrors this string verbatim — never rename.
pub const PLUGIN_GUI_CLOSED_EVENT: &str = "plugin-gui-closed";

/// How long a report that lost its record claim to a reopen's retirement waits
/// for that retirement's teardown before answering anyway.
///
/// Sized against the shell's own detach deadline (`DETACH_DEADLINE_MS`,
/// electron/pluginGui.ts, 5 s): the shell starts that deadline before it even
/// calls, so a claiming teardown that outlives both bounds is cut short by the
/// shell's destroy, not by this wait — the bound exists only so a losing report
/// can never park forever behind a teardown that will not answer.
const LOSING_REPORT_TEARDOWN_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

/// Payload of `plugin-gui-closed`. snake_case on the wire, matching the other
/// plugin DTOs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PluginGuiClosed {
    pub instance_id: String,
}

/// Which editors a close-all pass closed, and why any others did not.
///
/// Distinct from `plugins::PluginUnloadReply`: closing an editor releases no
/// chain entry, so this carries no strip reports, and it is never sent
/// across the desktop IPC boundary — `close_all_plugin_guis` is a denied
/// exit-cascade command, run only from `shutdown` and this module's own
/// tests.
#[derive(Debug, Default, Serialize)]
pub struct PluginGuiCloseReport {
    pub closed_instance_ids: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginGuiInfo {
    pub has_gui: bool,
    pub is_open: bool,
    pub width: u32,
    pub height: u32,
}

/// The size a plugin granted its editor, which is the size its host window must
/// hold. snake_case on the wire, like the other plugin DTOs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginEditorSize {
    pub width: u32,
    pub height: u32,
}

/// Everything about the host window a plugin is told before its editor opens.
struct HostWindow {
    resize: EditorWindowResizer,
    /// Where the plugin's later asks of its window — show, hide, closed, new
    /// resize hints — are answered.
    window: SharedEditorWindow,
    scale_factor: f64,
}

/// Why a plugin editor command refused.
///
/// `Display` is the text the renderer receives through the napi edge,
/// byte-identical to the text it replaced (ADR 0059). `openPluginGui.ts`
/// matches [`Self::AlreadyOpen`]'s text.
#[derive(Debug)]
pub(crate) enum PluginGuiError {
    /// A state store's mutex was poisoned.
    Lock {
        store: &'static str,
        cause: String,
    },
    NoInstance {
        instance_id: String,
    },
    GuiUnsupported,
    AlreadyOpen,
    EditorStateChanged,
    /// The plugin's editor refused.
    Editor(PluginError),
    /// The control path refused to run an operation on the instance.
    Control(PluginControlRefusal),
    /// The control path refused an editor call, or the UI-thread hop did.
    ControlledUiCall(PluginControlError<UiThreadError>),
    /// The engine-owned instance could not be reached, or its editor call
    /// was refused.
    EngineUiCall(EnginePluginControlError<UiThreadError>),
    /// The shell's UI thread did not take the editor call.
    UiThread(UiThreadError),
    /// The window host could not create or expose the editor's window.
    Window(PluginWindowError),
}

impl From<PluginControlRefusal> for PluginGuiError {
    fn from(refusal: PluginControlRefusal) -> Self {
        Self::Control(refusal)
    }
}

impl From<PluginControlError<UiThreadError>> for PluginGuiError {
    fn from(error: PluginControlError<UiThreadError>) -> Self {
        Self::ControlledUiCall(error)
    }
}

impl From<EnginePluginControlError<UiThreadError>> for PluginGuiError {
    fn from(error: EnginePluginControlError<UiThreadError>) -> Self {
        Self::EngineUiCall(error)
    }
}

impl From<UiThreadError> for PluginGuiError {
    fn from(error: UiThreadError) -> Self {
        Self::UiThread(error)
    }
}

impl From<PluginWindowError> for PluginGuiError {
    fn from(error: PluginWindowError) -> Self {
        Self::Window(error)
    }
}

impl PluginGuiError {
    fn lock<Guard>(store: &'static str) -> impl FnOnce(PoisonError<Guard>) -> Self {
        move |error| Self::Lock {
            store,
            cause: error.to_string(),
        }
    }

    fn no_instance(instance_id: &str) -> Self {
        Self::NoInstance {
            instance_id: instance_id.to_string(),
        }
    }
}

impl fmt::Display for PluginGuiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Lock { store, cause } => write!(f, "Failed to lock {store}: {cause}"),
            Self::NoInstance { instance_id } => write!(f, "No plugin instance: {instance_id}"),
            Self::GuiUnsupported => f.write_str("Plugin does not support GUI"),
            Self::AlreadyOpen => f.write_str("Plugin GUI is already open"),
            Self::EditorStateChanged => {
                f.write_str("Plugin editor state changed while its window was opening")
            }
            Self::Editor(error) => write!(f, "{error}"),
            Self::Control(refusal) => write!(f, "{refusal}"),
            Self::ControlledUiCall(error) => write!(f, "{error}"),
            Self::EngineUiCall(error) => write!(f, "{error}"),
            Self::UiThread(error) => write!(f, "{error}"),
            Self::Window(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for PluginGuiError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Editor(error) => Some(error),
            Self::Control(refusal) => Some(refusal),
            Self::ControlledUiCall(error) => Some(error),
            Self::EngineUiCall(error) => Some(error),
            Self::UiThread(error) => Some(error),
            Self::Window(error) => Some(error),
            _ => None,
        }
    }
}

/// What an editor that just opened tells the shell about the window it is in.
struct OpenedEditor {
    size: (u32, u32),
    /// Whether the user may drag this window's edges. Unknowable before the
    /// open: both formats answer it through a view that does not exist yet.
    can_resize: bool,
}

/// How long an editor call waits on the RT seam once it holds the control gate,
/// the budget every engine-owned editor call already has.
const EDITOR_CONTROL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// The dormant instance's runtime, cloned out of the command-owned map so the
/// editor call that follows runs with the map released and under the
/// instance's own bounded control gate.
fn command_owned_runtime(
    state: &AppState,
    instance_id: &str,
) -> Result<Option<Arc<SharedHostedPlugin>>, PluginGuiError> {
    let plugins = state
        .plugins
        .lock()
        .map_err(PluginGuiError::lock("plugins"))?;
    Ok(plugins
        .get(instance_id)
        .map(|instance| Arc::clone(&instance.plugin)))
}

/// Make one call into an instance's plugin, through whichever map owns it and
/// on the shell's UI thread.
///
/// Both stores are reached the same way: the runtime owner is cloned out of
/// its map, the map is released, and the call claims the owner's control gate.
/// The thread rule is the module's: the gate is taken here, and only the call
/// crosses.
fn call_plugin_on_ui_thread<Answer: Send + 'static>(
    instance_id: &str,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
    call: impl FnOnce(&mut (dyn AudioPlugin + 'static)) -> Answer + Send + 'static,
) -> Result<Answer, PluginGuiError> {
    if let Some(runtime) = command_owned_runtime(state, instance_id)? {
        return runtime
            .with_control_on_ui_thread(EDITOR_CONTROL_TIMEOUT, windows_host, |plugin| call(plugin))
            .map_err(PluginGuiError::from);
    }

    let is_engine_owned = state
        .engine_plugins
        .lock()
        .map(|engine_plugins| engine_plugins.contains_key(instance_id))
        .map_err(PluginGuiError::lock("engine_plugins"))?;
    if !is_engine_owned {
        return Err(PluginGuiError::no_instance(instance_id));
    }

    state
        .with_engine_plugin_on_ui_thread(instance_id, windows_host, |plugin| call(plugin))
        .map_err(PluginGuiError::from)
}

/// Resize an open editor because the host's own window was resized.
///
/// MUST be async, like every other command that reaches a window: it waits on
/// the shell's UI thread, and a synchronous command that did so from the thread
/// it is waiting for would deadlock.
///
/// Reports the size the plugin granted, which is not always the one asked for —
/// both formats let a plugin quantise a host-chosen size, and the window has to
/// end up at what it answered rather than at what the user dragged to.
pub async fn resize_plugin_gui(
    instance_id: String,
    width: u32,
    height: u32,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<PluginEditorSize, String> {
    let (width, height) =
        call_plugin_on_ui_thread(&instance_id, windows_host, state, move |plugin| {
            plugin.request_editor_size(width, height)
        })
        .and_then(|granted| granted.map_err(PluginGuiError::Editor))
        .map_err(|error| error.to_string())?;

    Ok(PluginEditorSize { width, height })
}

/// State the display scale of an editor that is already open, because its
/// window moved to a display of a different density.
///
/// The size comes back for the same reason it does from a resize: the plugin
/// lays itself out again at the new scale, and what that came to is the plugin's
/// answer rather than the host's arithmetic.
pub async fn apply_plugin_gui_scale(
    instance_id: String,
    scale_factor: f64,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<PluginEditorSize, String> {
    let (width, height) =
        call_plugin_on_ui_thread(&instance_id, windows_host, state, move |plugin| {
            plugin.apply_editor_content_scale(scale_factor)
        })
        .and_then(|granted| granted.map_err(PluginGuiError::Editor))
        .map_err(|error| error.to_string())?;

    Ok(PluginEditorSize { width, height })
}

/// Query whether a loaded plugin instance supports a custom GUI.
pub async fn is_plugin_gui_supported(
    instance_id: String,
    state: &AppState,
) -> Result<bool, String> {
    plugin_gui_support(&instance_id, state).map_err(|error| error.to_string())
}

fn plugin_gui_support(instance_id: &str, state: &AppState) -> Result<bool, PluginGuiError> {
    {
        let plugins = state
            .plugins
            .lock()
            .map_err(PluginGuiError::lock("plugins"))?;

        if let Some(instance) = plugins.get(instance_id) {
            return Ok(instance.has_gui);
        }
    }

    let engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(PluginGuiError::lock("engine_plugins"))?;
    if let Some(instance) = engine_plugins.get(instance_id) {
        instance
            .runtime
            .ensure_public_control_allowed()
            .map_err(PluginGuiError::from)?;
        return Ok(instance.has_gui);
    }

    Err(PluginGuiError::no_instance(instance_id))
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
fn open_editor_or_release_host_window<Plugin: AudioPlugin + ?Sized, Refusal>(
    plugin: &mut Plugin,
    state_host_window: impl FnOnce(&mut Plugin),
    open_editor: impl FnOnce(&mut Plugin) -> Result<(u32, u32), Refusal>,
) -> Result<(u32, u32), Refusal> {
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
/// 1. Find the instance and which map owns it, and refuse one with no editor
/// 2. Refuse an instance whose editor is already open — a recorded window label
///    the shell still has is what that means
/// 3. Create a bare native window (no WebView) through the shell's window host,
///    owned by the DAW window (Windows owner / macOS child window / X11
///    transient-for) so it floats above the DAW and nothing else
/// 4. Retire a stale record — a recorded window the shell no longer has — and
///    with it the editor behind it, so the new editor opens onto a clean plugin
/// 5. Extract the native window handle (NSView/HWND/X11)
/// 6. Give the plugin the host's window resizer, then pass the handle to
///    `open_gui`, which runs that format's editor lifecycle
/// 7. Publish the window and resize it to the plugin's preferred size
pub async fn open_plugin_gui(
    instance_id: String,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<PluginGuiInfo, String> {
    open_editor_in_new_window(instance_id, windows_host, state)
        .await
        .map_err(|error| error.to_string())
}

async fn open_editor_in_new_window(
    instance_id: String,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<PluginGuiInfo, PluginGuiError> {
    // 1. Get plugin name and check GUI support
    let (plugin_name, runtime) = {
        let plugins = state
            .plugins
            .lock()
            .map_err(PluginGuiError::lock("plugins"))?;
        match plugins.get(&instance_id) {
            Some(instance) => {
                if !instance.has_gui {
                    return Err(PluginGuiError::GuiUnsupported);
                }

                instance
                    .plugin
                    .ensure_public_control_allowed()
                    .map_err(PluginGuiError::from)?;

                (instance.name.clone(), Arc::clone(&instance.plugin))
            }
            None => {
                let engine_plugins = state
                    .engine_plugins
                    .lock()
                    .map_err(PluginGuiError::lock("engine_plugins"))?;
                if let Some(engine_instance) = engine_plugins.get(&instance_id) {
                    if !engine_instance.has_gui {
                        return Err(PluginGuiError::GuiUnsupported);
                    }

                    engine_instance
                        .runtime
                        .ensure_public_control_allowed()
                        .map_err(PluginGuiError::from)?;

                    (
                        engine_instance.name.clone(),
                        Arc::clone(&engine_instance.runtime),
                    )
                } else {
                    return Err(PluginGuiError::no_instance(&instance_id));
                }
            }
        }
    };

    // 2. Already open? The recorded label is the only way to ask: a label names one
    // opening, so there is nothing to derive and hand the shell. Recorded but
    // gone from the shell is a stale entry — an editor the OS has already ended
    // whose reset has not run — that step 4 below claims and replaces.
    let mut open_window_label = {
        let windows = state
            .plugin_windows
            .lock()
            .map_err(PluginGuiError::lock("plugin_windows"))?;
        windows.get(&instance_id).cloned()
    };
    if open_window_label
        .as_deref()
        .is_some_and(|label| windows_host.window_exists(label))
    {
        return Err(PluginGuiError::AlreadyOpen);
    }

    // 3. Create a bare native window (no WebView) for the plugin editor
    let window_label = plugin_editor_window_label(&instance_id, next_editor_open_sequence());

    // Shared rather than owned: the resizer installed below outlives this
    // command, because a plugin editor resizes itself while it is open.
    let plugin_window: Arc<dyn PluginEditorWindow> = Arc::from(
        windows_host
            .create_editor_window(&window_label, &plugin_name, &instance_id)
            .map_err(PluginGuiError::from)?,
    );

    // 4. Retire the stale record this open's check identified, and with it the
    // editor behind it. See `retire_stale_editor_for_reopen`; here, because a
    // create that succeeded is the shell answering, so the "no window" that
    // named this record stale was an answer rather than an unreachable host —
    // and an unreachable host must not have a live editor closed on its say-so.
    if let Some(stale_label) = open_window_label.take() {
        if let Err(error) =
            retire_stale_editor_for_reopen(&instance_id, &stale_label, windows_host, state).await
        {
            plugin_window.destroy();
            return Err(error);
        }
    }

    // 5. Extract the native window handle
    let handle_ptr = match plugin_window.native_handle_ptr() {
        Ok(handle_ptr) => handle_ptr,
        Err(error) => {
            plugin_window.destroy();
            return Err(PluginGuiError::from(error));
        }
    };

    // 6. Give the plugin the host window — how to resize it, and what scale it
    //    runs at — then open its GUI.
    let resize_window = editor_window_resizer(&plugin_window);
    let editor_window = editor_window_host(&plugin_window);
    let scale_factor = plugin_window.scale_factor();
    // Carried as an integer because a raw pointer cannot cross a thread, and
    // cast back on the far side — the same representation `JsEditorWindow` holds
    // it in for the same reason.
    let handle = handle_ptr as usize;
    let open_editor = move |plugin: &mut dyn AudioPlugin| -> Result<OpenedEditor, PluginGuiError> {
        open_editor_reporting_resizability(
            plugin,
            HostWindow {
                resize: resize_window,
                window: editor_window,
                scale_factor,
            },
            handle,
        )
    };
    let gui_size_result = runtime
        .with_control_on_ui_thread(EDITOR_CONTROL_TIMEOUT, windows_host, move |plugin| {
            open_editor(plugin)
        })
        .map_err(PluginGuiError::from)
        .and_then(|opened| opened);

    let OpenedEditor {
        size: (width, height),
        can_resize,
    } = match gui_size_result {
        Ok(opened) => opened,
        Err(error) => {
            plugin_window.destroy();
            return Err(error);
        }
    };

    let publish_window = || -> Result<(), PluginGuiError> {
        publish_plugin_gui_window_in_label_order(
            || {
                let mut windows = state
                    .plugin_windows
                    .lock()
                    .map_err(PluginGuiError::lock("plugin_windows"))?;
                claim_editor_record_for_opened_window(
                    &mut windows,
                    &instance_id,
                    open_window_label.as_deref(),
                    &window_label,
                )
            },
            || {
                // Before the window is shown, so a fixed-size editor never
                // appears with edges the user can drag and the plugin refuses.
                plugin_window.set_resizable(can_resize);
                plugin_window.set_size(width, height);
                plugin_window.show_and_focus();
            },
        )
    };

    // A publish refused for any reason unwinds the same way: the editor is open
    // inside the plugin and its window exists, and returning with both standing
    // leaks a window the user cannot reach and an editor the next open is
    // refused for.
    let publish_result = publish_engine_gui_window_with_lifecycle_checks(
        || {
            runtime
                .ensure_public_control_allowed()
                .map_err(PluginGuiError::from)
        },
        publish_window,
    );
    cleanup_opened_engine_gui_after_rejected_lifecycle(
        publish_result,
        || {
            let _ = runtime.with_unload_control_on_ui_thread(
                EDITOR_CONTROL_TIMEOUT,
                windows_host,
                |plugin| plugin.close_gui(),
            );
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

    Ok(PluginGuiInfo {
        has_gui: true,
        is_open: true,
        width,
        height,
    })
}

/// Open one plugin's editor onto the host window, and report — from inside the
/// same visit — whether that editor accepts a size the host chooses.
///
/// Standing alone rather than inlined in [`open_plugin_gui`] because the second
/// answer is the whole reason the question is asked here: `editor_can_resize`
/// is defined only while a view is open, on the thread it opened on, so the one
/// visit that opens the editor is the only place it can be read. A host that
/// decided for itself gives every fixed-layout editor a draggable frame, or
/// freezes every resizable one — and that is a per-plugin answer no store here
/// holds.
fn open_editor_reporting_resizability(
    plugin: &mut dyn AudioPlugin,
    host_window: HostWindow,
    handle: usize,
) -> Result<OpenedEditor, PluginGuiError> {
    let size = open_editor_or_release_host_window(
        plugin,
        |plugin| {
            plugin.set_editor_window_resizer(host_window.resize);
            plugin.set_editor_window(host_window.window);
            plugin.set_editor_content_scale(host_window.scale_factor);
        },
        |plugin| plugin.open_gui(handle as *mut std::ffi::c_void),
    )
    .map_err(PluginGuiError::Editor)?;

    Ok(OpenedEditor {
        size,
        can_resize: plugin.editor_can_resize(),
    })
}

fn publish_engine_gui_window_with_lifecycle_checks<Refusal>(
    ensure_public_control_allowed: impl Fn() -> Result<(), Refusal>,
    publish_window: impl FnOnce() -> Result<(), Refusal>,
) -> Result<(), Refusal> {
    ensure_public_control_allowed()?;
    publish_window()?;
    ensure_public_control_allowed()
}

/// Record the window that just opened, but only if nothing claimed this
/// instance's editor while it was opening.
///
/// A compare-and-swap against what this open last left recorded: what its own
/// already-open check saw, or the empty record its stale-window retirement
/// left. The OS-close reset claims by removing the record, and it can do that
/// in the gap between those points — for the opening it was reported against,
/// which was legitimately still recorded. Its teardown then closes the plugin's
/// GUI, and this window would be shown over an editor that is already dead.
///
/// So a claim raised after this opening began loses the window: the open is
/// refused, its caller tears down what it built, and the user gets a refusal
/// they can act on rather than an empty frame.
fn claim_editor_record_for_opened_window(
    windows: &mut PluginWindowRecords,
    instance_id: &str,
    observed: Option<&str>,
    window_label: &str,
) -> Result<(), PluginGuiError> {
    if windows.get(instance_id).map(String::as_str) != observed {
        return Err(PluginGuiError::EditorStateChanged);
    }

    windows.insert(instance_id.to_string(), window_label.to_string());
    Ok(())
}

/// Publish the plugin window: record the window label BEFORE showing. A close
/// racing the show path must always find the label recorded, otherwise the
/// close-requested reset would miss it and leave a stale entry behind.
fn publish_plugin_gui_window_in_label_order<Refusal>(
    insert_label: impl FnOnce() -> Result<(), Refusal>,
    show_window: impl FnOnce(),
) -> Result<(), Refusal> {
    insert_label()?;
    show_window();
    Ok(())
}

/// Claim one recorded editor window by removing its record, and say whether
/// this claimant was the one that removed it.
///
/// A label names one opening, so a compare-and-remove against the recorded
/// label decides which claimant owns an editor's teardown when two race for
/// one — the OS-close reset's report, or a reopen replacing a window the shell
/// has already ended. The loser finds the record changed and touches nothing:
/// not the record, not the plugin's GUI. What a loser does instead — wait out
/// the winner's teardown, or answer straight away — is decided by the callers,
/// against the handshake a winning reopen registered with its claim.
fn remove_recorded_editor_window(
    windows: &mut PluginWindowRecords,
    instance_id: &str,
    window_label: &str,
) -> bool {
    let is_this_window = windows
        .get(instance_id)
        .map(|label| label == window_label)
        .unwrap_or(false);
    if is_this_window {
        windows.remove(instance_id);
    }
    is_this_window
}

/// Reset "GUI open" bookkeeping after the OS reports the plugin window is
/// closing (title-bar close request, or the owner-destroy cascade). The shell
/// destroys the window itself, and destroys it only after this returns: both
/// formats un-parent the plugin's child window from the host's, so the teardown
/// below needs the window it was attached to still standing. This closes the
/// plugin's internal GUI (hide + destroy, via the same owning paths as
/// `close_plugin_gui`) and drops the `plugin_windows` entry, so a later
/// `open_plugin_gui` recreates the GUI instead of failing with "GUI is already
/// open" on stale state and leaking the plugin's internal GUI resources. It
/// never drops the plugin, so no audio-thread/retire-list concern applies.
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
/// A report whose claim loses to a *reopen's* retirement does not answer the
/// shell until that retirement's teardown has left the window, bounded by
/// [`LOSING_REPORT_TEARDOWN_WAIT`]. The shell destroys the window the moment
/// this report returns (`detachThenDestroy`, electron/pluginGui.ts), and both
/// formats un-parent an editor from a live parent or from nothing at all, so
/// answering at the loss would have the plugin's `close_gui` run against a
/// parent the shell has already destroyed. The loser parks on the claiming
/// teardown's signal, holding no lock, until the plugin is out. The symmetric
/// loser needs no such wait: a reopen whose retirement lost to this report is
/// refused before it ever touches the plugin, and this report's own teardown
/// completes before it returns.
///
/// The shell must call this off its window-event thread. That thread is
/// otherwise the only event-thread caller of the plugin mutexes (`plugins`,
/// `engine_plugins`) and of `SharedHostedPlugin`'s control lock (a 2 s spin);
/// running this inline risks a circular-wait deadlock with GUI-affine plugins
/// and freezes the whole app event loop otherwise.
///
/// Holds no lifecycle lease: a load or unload can keep that lease past the
/// shell's detach deadline, and a close queued behind it would run against a
/// window the shell has already destroyed, or against an editor reopened in the
/// meantime. An attach moving the instance between the stores is waited out at
/// the plugin lookup instead, for a bounded time ([`ATTACH_TRANSIT_WAIT`]).
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
pub async fn reset_plugin_gui_state_after_os_close(
    instance_id: &str,
    window_label: &str,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
    events: &dyn EventSink,
) {
    // Claim the window, and do nothing at all unless the claim succeeds.
    // Taken before the plugin is touched so the record — the one piece of shared
    // state a concurrent open also writes — decides which report owns this
    // teardown. A claim lost to a reopen's retirement is captured in the same
    // critical section as the loss: the handshake that claim registered with
    // its record's removal is what the loser below owes its wait to, and taking
    // both under one lock closes the gap between losing and finding it.
    let (removed_this_window, claiming_teardown) = match state.plugin_windows.lock() {
        Ok(mut windows) => {
            let removed_this_window =
                remove_recorded_editor_window(&mut windows, instance_id, window_label);
            let claiming_teardown = if removed_this_window {
                None
            } else {
                windows.teardown_in_flight(instance_id)
            };
            (removed_this_window, claiming_teardown)
        }
        Err(_) => (false, None),
    };

    if !removed_this_window {
        // Lost the claim. Lost to a newer opening's published record, there is
        // nothing to wait for: that opening retired the old editor before it
        // published, so the plugin has already left this window. Lost to a
        // reopen's retirement, the teardown of this window's editor is still
        // running — and the shell destroys the window the moment this report
        // answers, so the loser holds still here, on this thread and holding no
        // lock, until the claiming teardown has actually left the window.
        if let Some(teardown) = claiming_teardown {
            teardown.wait_until_completed(LOSING_REPORT_TEARDOWN_WAIT);
        }
        return;
    }

    close_owning_plugin_gui(instance_id, windows_host, state).await;

    events.emit(
        PLUGIN_GUI_CLOSED_EVENT,
        PluginGuiClosed {
            instance_id: instance_id.to_string(),
        },
    );
}

/// Close the plugin's own GUI through whichever map owns the instance.
///
/// Either way the close runs under the instance's own control gate with the map
/// released, and an instance found in neither store gets one bounded wait for
/// an attach's move; see [`owning_runtime_after_attach_transit`].
///
/// Both callers have just claimed the editor's record by removing it, so a
/// record standing again when the gate is held belongs to a newer editor: a
/// reopen published it while this close waited — for the move, or for the
/// gate. Closing then would close that editor, the one now on screen, so the
/// close is skipped. The plugin's editor this close was for is already gone,
/// because the reopen could only open once it was.
async fn close_owning_plugin_gui(
    instance_id: &str,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) {
    let Ok(Some(runtime)) = owning_runtime_after_attach_transit(instance_id, state).await else {
        return;
    };
    let Ok(visit) = runtime.control_visit() else {
        return;
    };
    if has_editor_record(instance_id, state) {
        return;
    }
    let _ = visit.on_ui_thread(windows_host, EDITOR_CONTROL_TIMEOUT, |plugin| {
        plugin.close_gui()
    });
}

fn has_editor_record(instance_id: &str, state: &AppState) -> bool {
    state
        .plugin_windows
        .lock()
        .map(|windows| windows.get(instance_id).is_some())
        .unwrap_or(false)
}

/// How long a close looks for an instance that is in neither store.
const ATTACH_TRANSIT_WAIT: std::time::Duration = std::time::Duration::from_secs(1);

/// The shell's bound on one editor's detach, `DETACH_DEADLINE_MS` in
/// electron/pluginGui.ts, mirrored here because the shell destroys the window
/// when it runs out: a close still waiting by then un-parents the plugin's
/// editor from a window that no longer exists.
const SHELL_EDITOR_DETACH_DEADLINE: std::time::Duration = std::time::Duration::from_millis(5_000);

const fn max_millis(first: std::time::Duration, second: std::time::Duration) -> u128 {
    let (first, second) = (first.as_millis(), second.as_millis());
    if first > second {
        first
    } else {
        second
    }
}

const _: () = assert!(
    ATTACH_TRANSIT_WAIT.as_millis() + max_millis(EDITOR_UI_THREAD_DEADLINE, EDITOR_CONTROL_TIMEOUT)
        < SHELL_EDITOR_DETACH_DEADLINE.as_millis(),
    "a close's wait for an attach and its visit — the hop to the shell's thread, or the wait \
     for a busy audio seam across re-hops, whichever is longer — must fit inside the shell's \
     detach deadline"
);

/// The runtime behind an instance, from whichever store holds it: command-owned
/// first, then engine-owned. An instance lives in exactly one of them.
fn owning_runtime(
    state: &AppState,
    instance_id: &str,
) -> Result<Option<Arc<SharedHostedPlugin>>, PluginGuiError> {
    if let Some(runtime) = command_owned_runtime(state, instance_id)? {
        return Ok(Some(runtime));
    }
    let engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(PluginGuiError::lock("engine_plugins"))?;
    Ok(engine_plugins
        .get(instance_id)
        .map(|instance| Arc::clone(&instance.runtime)))
}

/// The instance's runtime, waiting out an attach that is moving it between the
/// stores.
///
/// An attach holds the instance's lifecycle lease for the whole move, and in the
/// middle the instance is in neither store, so a close that looked then would
/// skip the plugin's `close_gui` and let the shell destroy the window over an
/// editor the plugin still holds. The wait is taken at the lookup's miss itself,
/// and the lookup repeated once after it: a presence check made before the
/// lookup leaves a gap in which an attach can begin and the lookup still miss.
/// Acquiring the lease means the move is done. A lease still held at the bound
/// is a load or unload, not an attach, which only try-locks and moves quickly;
/// the close then proceeds as an unloaded instance's does. The lease is never
/// held across the close itself.
async fn owning_runtime_after_attach_transit(
    instance_id: &str,
    state: &AppState,
) -> Result<Option<Arc<SharedHostedPlugin>>, PluginGuiError> {
    #[cfg(test)]
    tests::reach_owner_lookup(instance_id);
    if let Some(runtime) = owning_runtime(state, instance_id)? {
        return Ok(Some(runtime));
    }
    let transit = tokio::time::timeout(ATTACH_TRANSIT_WAIT, lock_plugin_lifecycle(instance_id));
    drop(transit.await);
    owning_runtime(state, instance_id)
}

/// Claim a recorded editor whose window the shell no longer has, and close the
/// editor behind it, so the reopen racing the OS-close reset opens rather than
/// collides.
///
/// The OS close is stopped and the window hidden on the shell's own thread, but
/// the reset its report schedules runs here only after the report crosses the
/// shell — and a reopen clicked into that gap finds the record still present
/// under a window that is already gone. Opening over the editor behind that
/// record fails inside the plugin, so the reopen claims the record instead —
/// the same compare-and-remove the reset claims with, which is what makes the
/// two safe against each other: whichever claims first owns the teardown, and
/// the late report then finds a newer label recorded and changes nothing,
/// exactly as a report for an editor a reopen already replaced does.
///
/// Winning the claim registers a teardown handshake with it, in the same
/// critical section, and completes that handshake once the teardown below
/// returns — because the report this claim beats does not refuse and go away:
/// the shell is awaiting it, and destroys the old window the moment it answers.
/// Without the handshake the losing report would answer while this teardown is
/// still reaching for the plugin mutexes, and the plugin would un-parent from a
/// window the shell has already destroyed. See
/// [`reset_plugin_gui_state_after_os_close`] for the losing side.
///
/// A claim that loses refuses, like the publish-time claim below: a record that
/// changed under this opening means someone else's teardown or opening owns the
/// editor now, and showing this window over either would put it on screen over
/// an editor this open does not control.
async fn retire_stale_editor_for_reopen(
    instance_id: &str,
    stale_label: &str,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<(), PluginGuiError> {
    let teardown = {
        let mut windows = state
            .plugin_windows
            .lock()
            .map_err(PluginGuiError::lock("plugin_windows"))?;
        if !remove_recorded_editor_window(&mut windows, instance_id, stale_label) {
            return Err(PluginGuiError::EditorStateChanged);
        }
        // Registered under the same lock as the claim, so the report this claim
        // beats finds the teardown it is held behind — never a window the shell
        // is free to destroy while this editor is still in it.
        let teardown = Arc::new(EditorTeardownSignal::default());
        windows.register_teardown(instance_id, Arc::clone(&teardown));
        teardown
    };

    close_owning_plugin_gui(instance_id, windows_host, state).await;

    // Completed before the records are touched again: a waiting report answers
    // the moment the plugin has left the window, not after this function's own
    // bookkeeping. Forgotten by identity, because a later claim for this
    // instance may already have replaced this signal.
    teardown.complete();
    if let Ok(mut windows) = state.plugin_windows.lock() {
        windows.forget_teardown(instance_id, &teardown);
    }
    Ok(())
}

fn cleanup_opened_engine_gui_after_rejected_lifecycle<Refusal>(
    lifecycle_result: Result<(), Refusal>,
    close_gui: impl FnOnce(),
    remove_window_label: impl FnOnce(),
    destroy_window: impl FnOnce(),
) -> Result<(), Refusal> {
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
    close_editor_and_window(&instance_id, windows_host, state)
        .await
        .map_err(|error| error.to_string())
}

async fn close_editor_and_window(
    instance_id: &str,
    windows_host: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<(), PluginGuiError> {
    if let Some(runtime) = owning_runtime_after_attach_transit(instance_id, state).await? {
        runtime
            .with_control_on_ui_thread(EDITOR_CONTROL_TIMEOUT, windows_host, |plugin| {
                plugin.close_gui()
            })
            .map_err(PluginGuiError::from)?;
    }

    // Destroy the native window
    let window_label = {
        let mut windows = state
            .plugin_windows
            .lock()
            .map_err(PluginGuiError::lock("plugin_windows"))?;
        windows.remove(instance_id)
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
    report: &mut PluginGuiCloseReport,
    instance_id: &str,
    close_result: Result<(), PluginGuiError>,
) {
    match close_result {
        Ok(()) => report.closed_instance_ids.push(instance_id.to_string()),
        Err(error) => report.errors.push(format!("{}: {}", instance_id, error)),
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
) -> Result<PluginGuiCloseReport, String> {
    close_every_plugin_gui(Some(windows_host), state).map_err(|error| error.to_string())
}

/// Take the command-owned instances, without parking the shell's UI thread on a
/// worker that may be waiting for that very thread.
///
/// `None` means the store was busy and this pass must skip it. Only the UI
/// thread refuses: every other caller is a worker, and a worker waiting here
/// closes no cycle — it is the side the UI thread is never waiting on.
///
/// A poisoned store is still an error rather than a refusal: nothing is holding
/// it, so nothing is going to release it, and a caller that treated it as
/// contention would report a permanent condition as a transient one.
fn claim_command_owned_instances<'stores>(
    state: &'stores AppState,
    editor_thread: &dyn PluginWindowHost,
) -> Result<Option<MutexGuard<'stores, HashMap<String, PluginInstanceData>>>, PluginGuiError> {
    if !editor_thread.is_ui_thread() {
        return state
            .plugins
            .lock()
            .map(Some)
            .map_err(PluginGuiError::lock("plugins"));
    }

    match state.plugins.try_lock() {
        Ok(plugins) => Ok(Some(plugins)),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Poisoned(error)) => Err(PluginGuiError::lock("plugins")(error)),
    }
}

/// Close one command-owned editor, without parking the shell's UI thread on the
/// instance's control gate, for the reason [`close_engine_owned_editor`] gives.
fn close_command_owned_editor(
    runtime: &SharedHostedPlugin,
    editor_thread: &dyn PluginWindowHost,
) -> Result<(), PluginGuiError> {
    let close = |plugin: &mut HostedRuntime| plugin.close_gui();

    if editor_thread.is_ui_thread() {
        return runtime
            .try_with_control_on_ui_thread(EDITOR_CONTROL_TIMEOUT, editor_thread, close)
            .map_err(PluginGuiError::from);
    }
    runtime
        .with_control_on_ui_thread(EDITOR_CONTROL_TIMEOUT, editor_thread, close)
        .map_err(PluginGuiError::from)
}

/// Close one engine-owned editor, without parking the shell's UI thread on the
/// instance's control gate.
///
/// The gate's wait is far longer than the editor hop's, which is the whole
/// ordering that keeps a quit survivable: a worker holding this gate may be
/// waiting for the UI thread, so the UI thread claiming it would close the
/// cycle. It refuses instead, and the refusal is reported rather than swallowed
/// — an editor that did not get its `gui.destroy` is exactly what the exit
/// report exists to name.
fn close_engine_owned_editor(
    instance_id: &str,
    editor_thread: &dyn PluginWindowHost,
    state: &AppState,
) -> Result<(), PluginGuiError> {
    let close = |plugin: &mut HostedRuntime| plugin.close_gui();

    if editor_thread.is_ui_thread() {
        return state
            .try_with_engine_plugin_on_ui_thread(instance_id, editor_thread, close)
            .map_err(PluginGuiError::from);
    }
    state
        .with_engine_plugin_on_ui_thread(instance_id, editor_thread, close)
        .map_err(PluginGuiError::from)
}

/// The window host is optional because the exit path may run after the shell's
/// windows are already gone: the CLAP `gui.destroy` still has to happen, and a
/// missing window server is not a reason to skip it.
///
/// Runs on the shell's UI thread at exit and on a worker when the webview asks,
/// and the difference matters: on the UI thread nothing here may wait for a lock
/// a worker holds, because that worker may be waiting for this thread to run its
/// editor call.
pub(crate) fn close_every_plugin_gui(
    windows_host: Option<&dyn PluginWindowHost>,
    state: &AppState,
) -> Result<PluginGuiCloseReport, PluginGuiError> {
    let mut report = PluginGuiCloseReport::default();
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
            .map_err(PluginGuiError::lock("plugin_windows"))?;
        windows.instance_ids().map(str::to_string).collect()
    };

    // Close all CLAP GUIs. The command-owned runtimes are cloned out and the
    // store released before any editor call, so a dormant instance that never
    // returns holds only its own gate.
    match claim_command_owned_instances(state, editor_thread)? {
        Some(plugins) => {
            let command_owned: Vec<(String, Arc<SharedHostedPlugin>)> = plugins
                .iter()
                .filter(|(instance_id, _)| instances_with_editors.contains(*instance_id))
                .map(|(instance_id, instance)| (instance_id.clone(), Arc::clone(&instance.plugin)))
                .collect();
            drop(plugins);
            for (instance_id, runtime) in command_owned {
                let close_result = close_command_owned_editor(&runtime, editor_thread);
                record_plugin_gui_close_outcome(&mut report, &instance_id, close_result);
            }
        }
        None => report.errors.push(
            "Command-owned plugin instances were busy; their editors were not closed".to_string(),
        ),
    }

    let engine_instance_ids: Vec<String> = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(PluginGuiError::lock("engine_plugins"))?;
        engine_plugins
            .keys()
            .filter(|instance_id| instances_with_editors.contains(*instance_id))
            .cloned()
            .collect()
    };

    for instance_id in engine_instance_ids {
        let close_result = close_engine_owned_editor(&instance_id, editor_thread, state);
        record_plugin_gui_close_outcome(&mut report, &instance_id, close_result);
    }

    // Destroy all native windows. Unconditional: a window whose plugin refused
    // to close its editor is exactly the window that must not be left behind.
    let labels: Vec<String> = {
        let mut windows = state
            .plugin_windows
            .lock()
            .map_err(PluginGuiError::lock("plugin_windows"))?;
        windows.take_labels()
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
        .map_err(|error| PluginGuiError::lock("plugin_windows")(error).to_string())?;

    for label in windows.labels() {
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
        .map_err(|error| PluginGuiError::lock("plugin_windows")(error).to_string())?;

    for label in windows.labels() {
        windows_host.show_window(label);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::NoopEventSink;
    use crate::host::native_bridge::SharedHostedPlugin;
    use crate::host::plugin_window::testing::DedicatedUiWindowHost;
    use crate::host::ui_thread::{UiThread, UiThreadTask};
    use crate::state::{AppState, EnginePluginInstanceData};
    use daw_engine::timeline::DeviceKind;
    use daw_plugin_host::clap_wrapper::ClapError;
    use daw_plugin_host::{ClapWrapper, PluginError};
    use std::cell::Cell;
    use std::future::Future;
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

    /// What a test runs as a close reaches its lookup of one instance's owner.
    type OwnerLookupInterleaving = (String, Box<dyn FnOnce() + Send>);

    static BEFORE_OWNER_LOOKUP: Mutex<Option<OwnerLookupInterleaving>> = Mutex::new(None);

    /// Run `other_side` once, the first time a close looks `instance_id` up.
    fn interleave_with_owner_lookup(instance_id: &str, other_side: impl FnOnce() + Send + 'static) {
        *BEFORE_OWNER_LOOKUP
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some((instance_id.to_string(), Box::new(other_side)));
    }

    pub(super) fn reach_owner_lookup(instance_id: &str) {
        let other_side = {
            let mut slot = BEFORE_OWNER_LOOKUP
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match slot.take() {
                Some((at, other_side)) if at == instance_id => Some(other_side),
                unmatched => {
                    *slot = unmatched;
                    None
                }
            }
        };
        if let Some(other_side) = other_side {
            other_side();
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
                chain_kind: DeviceKind::Effect,
                parameter_events: None,
                load_resolution: crate::commands::plugins::VettedRegistryEntry::fixture(),
            },
        );
        gui_threads
    }

    /// An engine-owned fixture with an editor and a stated answer about whether
    /// it accepts a host-chosen size.
    ///
    /// The two are independent: a real fixed-layout editor has a GUI and still
    /// refuses host sizing, and the open path has to carry whichever answer the
    /// plugin gives.
    fn insert_engine_owned_fixture_with_resize_answer(
        state: &AppState,
        instance_id: &str,
        editor_resizable: bool,
    ) {
        let mut wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Engine Owned Fixture", vec![], true);
        wrapper.set_engine_owned_command_fixture_editor_resizable(editor_resizable);
        let mut engine_plugins = state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available");
        engine_plugins.insert(
            instance_id.to_string(),
            EnginePluginInstanceData {
                engine_plugin_id: 17,
                runtime: Arc::new(SharedHostedPlugin::new(wrapper.into())),
                name: "Engine Owned Fixture".to_string(),
                parameters: Vec::new(),
                has_gui: true,
                chain_kind: DeviceKind::Effect,
                parameter_events: None,
                load_resolution: crate::commands::plugins::VettedRegistryEntry::fixture(),
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

    /// A host-driven resize is as thread-affine as the open: it calls
    /// `checkSizeConstraint` and `onSize` on VST3, and `adjust_size` and
    /// `set_size` on CLAP, all of them bound to the thread that owns the window.
    /// The command runs on a worker, so the call has to be carried across.
    #[test]
    fn resizing_an_editor_runs_the_plugins_gui_lifecycle_on_the_shell_thread() {
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

        let granted = crate::block_on_test(resize_plugin_gui(
            "engine-owned-fixture".to_string(),
            1024,
            768,
            &windows,
            &state,
        ))
        .expect("an open editor should accept a host resize");

        assert_eq!(
            granted,
            PluginEditorSize {
                width: 1024,
                height: 768
            },
            "the size the plugin granted is what the shell must snap its window to"
        );
        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "the resize must reach the plugin on the shell's thread, like the open"
        );
    }

    /// The scale half of the same crossing: a window moved to another display
    /// tells its editor, and both formats bind that call to the editor's thread.
    #[test]
    fn re_scaling_an_editor_runs_the_plugins_gui_lifecycle_on_the_shell_thread() {
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

        crate::block_on_test(apply_plugin_gui_scale(
            "engine-owned-fixture".to_string(),
            2.0,
            &windows,
            &state,
        ))
        .expect("an open editor should accept the scale of the display it moved to");

        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "the re-scale must reach the plugin on the shell's thread too"
        );
    }

    /// A command that names nothing must say so rather than reaching into the
    /// engine's store for an instance that is not there.
    #[test]
    fn resizing_an_instance_that_does_not_exist_is_refused_by_name() {
        let state = AppState::default();
        let windows = DedicatedUiWindowHost::start();

        let refused = crate::block_on_test(resize_plugin_gui(
            "ghost".to_string(),
            800,
            600,
            &windows,
            &state,
        ));

        assert_eq!(refused, Err("No plugin instance: ghost".to_string()));
    }

    /// The window is created before the plugin can be asked whether its editor
    /// resizes, so the answer has to reach the shell on the open. A host that
    /// decided for itself gives every fixed-layout editor a draggable frame, or
    /// freezes every resizable one.
    #[test]
    fn the_window_is_told_whether_the_plugins_own_editor_accepts_a_host_size() {
        for editor_resizable in [true, false] {
            let state = AppState::default();
            insert_engine_owned_fixture_with_resize_answer(
                &state,
                "engine-owned-fixture",
                editor_resizable,
            );
            let windows = DedicatedUiWindowHost::start();

            crate::block_on_test(open_plugin_gui(
                "engine-owned-fixture".to_string(),
                &windows,
                &state,
            ))
            .expect("the fixture editor should open");

            assert_eq!(
                windows.editor_resizable(),
                Some(editor_resizable),
                "the window must be told the plugin's own answer"
            );
        }
    }

    /// A host window nothing is ever asked of.
    struct UnaddressedWindow;

    impl daw_plugin_host::EditorWindowHost for UnaddressedWindow {
        fn show(&self) {}
        fn hide(&self) {}
        fn set_resizable(&self, _resizable: bool) {}
        fn destroy(&self) {}
        fn run_on_window_thread(&self, work: Box<dyn FnOnce() + Send>) -> Result<(), String> {
            work();
            Ok(())
        }
    }

    /// Where that answer comes from. The plugin is asked while its view is open
    /// — the only state in which either format defines the answer — so a host
    /// that read it before the open, or after the close, would report a default
    /// for every plugin.
    #[test]
    fn an_opened_editor_reports_the_plugins_own_resize_answer() {
        for can_resize in [true, false] {
            let mut plugin = RecordingPlugin {
                opens: Some((640, 480)),
                calls: Vec::new(),
                can_resize,
                editor_window: None,
            };

            let opened = open_editor_reporting_resizability(
                &mut plugin,
                HostWindow {
                    resize: Arc::new(|_, _| {}),
                    window: Arc::new(UnaddressedWindow),
                    scale_factor: 1.0,
                },
                std::ptr::null_mut::<std::ffi::c_void>() as usize,
            )
            .expect("the recording plugin's editor should open");

            assert_eq!(
                opened.can_resize, can_resize,
                "the opened editor must report the plugin's own answer"
            );
        }
    }

    /// A host window that counts the destroys asked of it.
    #[derive(Default)]
    struct DestroyCountingWindow {
        destroys: std::sync::atomic::AtomicUsize,
    }

    impl daw_plugin_host::EditorWindowHost for DestroyCountingWindow {
        fn show(&self) {}
        fn hide(&self) {}
        fn set_resizable(&self, _resizable: bool) {}
        fn destroy(&self) {
            self.destroys
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        fn run_on_window_thread(&self, work: Box<dyn FnOnce() + Send>) -> Result<(), String> {
            work();
            Ok(())
        }
    }

    /// The open is the only place a plugin learns where its show, hide, closed
    /// and new-hints asks are answered. A plugin opened without that window
    /// keeps asking into nothing, and every one of those callbacks goes dead.
    #[test]
    fn an_opened_editor_is_handed_the_window_its_asks_are_answered_in() {
        let window = Arc::new(DestroyCountingWindow::default());
        let mut plugin = RecordingPlugin {
            opens: Some((640, 480)),
            calls: Vec::new(),
            can_resize: false,
            editor_window: None,
        };

        open_editor_reporting_resizability(
            &mut plugin,
            HostWindow {
                resize: Arc::new(|_, _| {}),
                window: Arc::clone(&window) as SharedEditorWindow,
                scale_factor: 1.0,
            },
            std::ptr::null_mut::<std::ffi::c_void>() as usize,
        )
        .expect("the recording plugin's editor should open");

        plugin
            .editor_window
            .as_ref()
            .expect("the open must hand the plugin its host window")
            .destroy();
        assert_eq!(
            window.destroys.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "the window handed over must be the editor's own host window"
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

    /// Whether the audio thread could claim this instance right now: the access
    /// seam `with_process` compare-exchanges against is free.
    fn audio_seam_is_free(runtime: &SharedHostedPlugin) -> bool {
        runtime.try_claim_control().is_some()
    }

    /// Runs `editor_call` with the shell's thread parked on the first task it
    /// is handed, and reports whether the audio access seam was free while it
    /// was parked there. The task is then released and the call's own answer
    /// returned with that report.
    fn seam_free_while_the_hop_is_parked<Answer: Send>(
        windows: &DedicatedUiWindowHost,
        runtime: &SharedHostedPlugin,
        editor_call: impl FnOnce() -> Answer + Send,
    ) -> (bool, Answer) {
        let held = windows.hold_next_task();
        std::thread::scope(|scope| {
            let calling = scope.spawn(editor_call);
            held.until_held();
            let free = audio_seam_is_free(runtime);
            held.release();
            (
                free,
                calling.join().expect("the editor call should not panic"),
            )
        })
    }

    /// The defect of #7196 on the open path: the shell's thread has taken the
    /// open but not run it, and the plugin's blocks must still be served — a
    /// shell busy elsewhere delays the editor, never the audio.
    #[test]
    fn an_open_waiting_for_the_shell_thread_leaves_the_audio_seam_free() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "parked-open", true);
        let runtime = engine_fixture_runtime(&state, "parked-open");
        let windows = DedicatedUiWindowHost::start();

        let (free, opened) = seam_free_while_the_hop_is_parked(&windows, &runtime, || {
            crate::block_on_test(open_plugin_gui("parked-open".to_string(), &windows, &state))
        });

        assert!(
            free,
            "the audio thread must be able to claim the plugin while the open waits for the shell"
        );
        assert!(
            opened
                .expect("the open should succeed once the shell runs it")
                .is_open
        );
    }

    /// The close half of the same defect.
    #[test]
    fn a_close_waiting_for_the_shell_thread_leaves_the_audio_seam_free() {
        let state = AppState::default();
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "parked-close", true);
        let runtime = engine_fixture_runtime(&state, "parked-close");
        let windows = DedicatedUiWindowHost::start();
        crate::block_on_test(open_plugin_gui(
            "parked-close".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");

        let (free, closed) = seam_free_while_the_hop_is_parked(&windows, &runtime, || {
            crate::block_on_test(close_plugin_gui(
                "parked-close".to_string(),
                &windows,
                &state,
            ))
        });

        assert!(
            free,
            "the audio thread must be able to claim the plugin while the close waits for the shell"
        );
        closed.expect("the close should succeed once the shell runs it");
        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "the close still reaches the plugin on the shell's thread"
        );
    }

    /// Race (a) of #7196. A presence check made before the lookup leaves a gap:
    /// an attach that starts moving the instance in it makes the lookup miss,
    /// and a close that took the check's "present" for an answer skipped the
    /// plugin's `close_gui`. The wait belongs at the lookup's miss itself.
    #[test]
    fn an_attach_that_starts_as_the_close_looks_the_instance_up_is_waited_out() {
        let state = AppState::default();
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "attach-at-lookup", true);
        let windows = DedicatedUiWindowHost::start();
        crate::block_on_test(open_plugin_gui(
            "attach-at-lookup".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");

        let (at_lookup, reached_lookup) = std::sync::mpsc::channel::<()>();
        let (moved, attach_moved) = std::sync::mpsc::channel::<()>();
        interleave_with_owner_lookup("attach-at-lookup", move || {
            at_lookup.send(()).expect("the test is listening");
            attach_moved.recv().expect("the test starts the attach");
        });
        let gate = super::super::plugins::plugin_lifecycle_gate("attach-at-lookup");

        let closed = std::thread::scope(|scope| {
            let closing = scope.spawn(|| {
                crate::block_on_test(close_plugin_gui(
                    "attach-at-lookup".to_string(),
                    &windows,
                    &state,
                ))
            });
            reached_lookup
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("the close must reach its lookup");

            // The attach begins: the lease is taken and the instance leaves
            // the store, after anything the close checked before its lookup.
            let attach_lease = super::super::plugins::try_lock_plugin_lifecycle("attach-at-lookup")
                .expect("nothing else holds the instance");
            let in_transit = state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .remove("attach-at-lookup")
                .expect("the fixture is engine-owned");
            // The map, the attach's lease and its guard, and `gate` above.
            let idle_holders = Arc::strong_count(&gate);
            moved.send(()).expect("the close is parked at its lookup");

            // A close parked on the lease holds two more clones of its gate; one
            // that never waits finishes instead, and the assertion below says so.
            while Arc::strong_count(&gate) < idle_holders + 2 && !closing.is_finished() {
                std::thread::yield_now();
            }
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .insert("attach-at-lookup".to_string(), in_transit);
            drop(attach_lease);
            closing.join().expect("the close thread should not panic")
        });

        closed.expect("the close should succeed once the move is done");
        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "the plugin's editor must be closed, not skipped because the lookup missed"
        );
    }

    /// Race (b) of #7196. An OS-close report claims the record and waits out an
    /// attach; in the gap a reopen publishes a newer editor — possible because
    /// the plugin had already ended the editor the report was for. The report's
    /// late `close_gui` would close the editor now on screen.
    #[test]
    fn an_os_close_that_waited_out_an_attach_spares_the_editor_a_reopen_opened_meanwhile() {
        let state = AppState::default();
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "reopen-in-gap", true);
        let runtime = engine_fixture_runtime(&state, "reopen-in-gap");
        let windows = DedicatedUiWindowHost::start();
        crate::block_on_test(open_plugin_gui(
            "reopen-in-gap".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");
        let closed_label = state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .get("reopen-in-gap")
            .cloned()
            .expect("the open must have recorded a window");
        // The plugin ends its own editor; the report for its window follows.
        runtime
            .with_control_on_ui_thread(EDITOR_CONTROL_TIMEOUT, &windows, |plugin| {
                plugin.close_gui()
            })
            .expect("the fixture ends its editor");
        windows.os_closed(&closed_label);

        let attach_lease = super::super::plugins::try_lock_plugin_lifecycle("reopen-in-gap")
            .expect("nothing else holds the instance");
        let in_transit = state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .remove("reopen-in-gap")
            .expect("the fixture is engine-owned");
        let gate = super::super::plugins::plugin_lifecycle_gate("reopen-in-gap");
        let idle_holders = Arc::strong_count(&gate);
        let events = RecordingEventSink::default();

        std::thread::scope(|scope| {
            let reporting = scope.spawn(|| {
                crate::block_on_test(reset_plugin_gui_state_after_os_close(
                    "reopen-in-gap",
                    &closed_label,
                    &windows,
                    &state,
                    &events,
                ))
            });
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while Arc::strong_count(&gate) < idle_holders + 2 {
                assert!(
                    std::time::Instant::now() < deadline,
                    "the report never reached the lifecycle lease"
                );
                std::thread::yield_now();
            }

            // The attach finishes its move, and a reopen runs before the
            // report's wait wakes.
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .insert("reopen-in-gap".to_string(), in_transit);
            crate::block_on_test(open_plugin_gui(
                "reopen-in-gap".to_string(),
                &windows,
                &state,
            ))
            .expect("the reopen opens the plugin's editor again");
            drop(attach_lease);
            reporting.join().expect("the report should not panic");
        });

        assert_eq!(
            recorded_threads(&gui_threads).len(),
            3,
            "open, the plugin's own end, and the reopen — and no close of the reopened editor"
        );
        assert_ne!(
            state
                .plugin_windows
                .lock()
                .expect("plugin_windows lock")
                .get("reopen-in-gap")
                .map(String::as_str),
            None,
            "the reopened editor keeps its record"
        );
    }

    /// Runs `close` while an attach is mid-move, as the attach does it: the test
    /// holds the instance's lifecycle lease with the instance out of both
    /// stores. Returns once `close` has parked on the lease; the instance is then
    /// put into the engine's store and the lease released, and `close`'s result
    /// is returned.
    fn closing_during_an_attach_move<Closed: Send>(
        state: &AppState,
        instance_id: &str,
        close: impl FnOnce() -> Closed + Send,
    ) -> Closed {
        let attach_lease = super::super::plugins::try_lock_plugin_lifecycle(instance_id)
            .expect("nothing else holds the instance");
        let in_transit = state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .remove(instance_id)
            .expect("the fixture is engine-owned");
        let gate = super::super::plugins::plugin_lifecycle_gate(instance_id);
        // The map, the attach's lease and its guard, and `gate` above.
        let idle_holders = Arc::strong_count(&gate);

        std::thread::scope(|scope| {
            let closing = scope.spawn(close);
            // A close parked on the lease holds two more clones of its gate.
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while Arc::strong_count(&gate) < idle_holders + 2 {
                assert!(
                    !closing.is_finished(),
                    "the close ran inside the attach's move instead of waiting for it"
                );
                assert!(
                    std::time::Instant::now() < deadline,
                    "the close never reached the lifecycle lease"
                );
                std::thread::yield_now();
            }

            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .insert(instance_id.to_string(), in_transit);
            drop(attach_lease);

            closing.join().expect("the close thread should not panic")
        })
    }

    /// An attach moves an instance between the two stores under its lifecycle
    /// lease, and in between it is in neither. A close that ran there found no
    /// plugin, destroyed the window and left the plugin's editor open, so it
    /// could never be reopened. The close waits for the move and then reaches
    /// the plugin.
    #[test]
    fn a_close_made_while_an_attach_moves_the_instance_still_closes_the_plugins_editor() {
        let state = AppState::default();
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "in-transit-command", true);
        let windows = DedicatedUiWindowHost::start();
        crate::block_on_test(open_plugin_gui(
            "in-transit-command".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");

        closing_during_an_attach_move(&state, "in-transit-command", || {
            crate::block_on_test(close_plugin_gui(
                "in-transit-command".to_string(),
                &windows,
                &state,
            ))
        })
        .expect("the close should succeed once the move is done");

        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "the plugin's editor must be closed, not only its window destroyed"
        );
    }

    /// The title-bar close takes the same path as a command through an attach:
    /// the report claims the window record, finds the instance in neither store
    /// and, without the wait, skips the plugin's `close_gui` while still
    /// telling the frontend the editor closed.
    #[test]
    fn an_os_close_made_while_an_attach_moves_the_instance_still_closes_the_plugins_editor() {
        let state = AppState::default();
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "in-transit-os-close", true);
        let windows = DedicatedUiWindowHost::start();
        crate::block_on_test(open_plugin_gui(
            "in-transit-os-close".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");
        let label = state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .get("in-transit-os-close")
            .cloned()
            .expect("the open must have recorded a window");
        let events = RecordingEventSink::default();

        closing_during_an_attach_move(&state, "in-transit-os-close", || {
            crate::block_on_test(reset_plugin_gui_state_after_os_close(
                "in-transit-os-close",
                &label,
                &windows,
                &state,
                &events,
            ))
        });

        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "the plugin's editor must be closed on the shell's thread, not only its window gone"
        );
        let emitted: Vec<String> = events
            .events()
            .into_iter()
            .map(|(event, _)| event)
            .collect();
        assert_eq!(
            emitted,
            [PLUGIN_GUI_CLOSED_EVENT.to_string()],
            "the frontend is told the editor closed exactly once"
        );
    }

    /// A reopen retires the stale editor behind a window the shell no longer
    /// has, and that retirement can meet an attach's move like any other close.
    #[test]
    fn a_reopen_retiring_an_editor_while_an_attach_moves_the_instance_closes_it() {
        let state = AppState::default();
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "in-transit-reopen", true);
        let windows = DedicatedUiWindowHost::start();
        crate::block_on_test(open_plugin_gui(
            "in-transit-reopen".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");
        let stale_label = state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .get("in-transit-reopen")
            .cloned()
            .expect("the open must have recorded a window");
        windows.os_closed(&stale_label);

        closing_during_an_attach_move(&state, "in-transit-reopen", || {
            crate::block_on_test(retire_stale_editor_for_reopen(
                "in-transit-reopen",
                &stale_label,
                &windows,
                &state,
            ))
        })
        .expect("the retirement should succeed once the move is done");

        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "the stale editor must be closed inside the plugin before the reopen opens"
        );
    }

    /// A lease another holder keeps while the instance is in a store says
    /// nothing about a move: the close finds the plugin at once and never waits
    /// for it, so a slow load or unload cannot stall an editor's close past the
    /// shell's detach deadline.
    #[test]
    fn a_close_of_a_present_instance_does_not_wait_for_a_lease_another_holder_keeps() {
        let state = AppState::default();
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "lease-held-present", true);
        let windows = DedicatedUiWindowHost::start();
        crate::block_on_test(open_plugin_gui(
            "lease-held-present".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");
        let other_holder = super::super::plugins::try_lock_plugin_lifecycle("lease-held-present")
            .expect("nothing else holds the instance");

        crate::block_on_test(close_plugin_gui(
            "lease-held-present".to_string(),
            &windows,
            &state,
        ))
        .expect("the close should succeed");

        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "the close must reach the plugin"
        );
        assert!(
            super::super::plugins::try_lock_plugin_lifecycle("lease-held-present").is_none(),
            "the other holder must have kept the lease throughout"
        );
        drop(other_holder);
    }

    /// The wait itself, polled once so that no clock decides the outcome: an
    /// instance in a store is not waited for even though another holder keeps
    /// its lease.
    #[test]
    fn the_transit_wait_is_ready_at_once_for_an_instance_in_a_store() {
        let state = AppState::default();
        let _gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "poll-present", true);
        let _other_holder = super::super::plugins::try_lock_plugin_lifecycle("poll-present")
            .expect("nothing else holds the instance");

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime should build");
        let _entered = runtime.enter();
        let mut wait = std::pin::pin!(owning_runtime_after_attach_transit("poll-present", &state));
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());

        assert!(
            wait.as_mut().poll(&mut context).is_ready(),
            "an instance in a store must not be waited for"
        );
    }

    /// The command-owned branch of the same poll: a dormant instance in its own
    /// store is found at once, whoever holds its lease, and is the runtime the
    /// close goes on to reach.
    #[test]
    fn the_transit_wait_is_ready_at_once_for_a_command_owned_instance_in_its_store() {
        let state = AppState::default();
        let dormant = PluginInstanceData::dormant_fixture(
            ClapWrapper::new_engine_owned_command_fixture("Dormant Fixture", vec![], true).into(),
        );
        let expected = Arc::clone(&dormant.plugin);
        state
            .plugins
            .lock()
            .expect("plugins lock")
            .insert("poll-command-owned".to_string(), dormant);
        let _other_holder = super::super::plugins::try_lock_plugin_lifecycle("poll-command-owned")
            .expect("nothing else holds the instance");

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime should build");
        let _entered = runtime.enter();
        let mut wait = std::pin::pin!(owning_runtime_after_attach_transit(
            "poll-command-owned",
            &state
        ));
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());

        let std::task::Poll::Ready(found) = wait.as_mut().poll(&mut context) else {
            panic!("a command-owned instance in its store must not be waited for");
        };
        let found = found
            .expect("the stores are readable")
            .expect("the instance is found");
        assert!(
            Arc::ptr_eq(&found, &expected),
            "the lookup must answer the command-owned store's runtime"
        );
    }

    /// The other half of the same poll: an instance in neither store, with its
    /// lease held, is waited for.
    #[test]
    fn the_transit_wait_is_pending_for_an_instance_in_neither_store_while_its_lease_is_held() {
        let state = AppState::default();
        let _gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "poll-absent", true);
        let _other_holder = super::super::plugins::try_lock_plugin_lifecycle("poll-absent")
            .expect("nothing else holds the instance");
        let _unloading = state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .remove("poll-absent")
            .expect("the fixture is engine-owned");

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime should build");
        let _entered = runtime.enter();
        let mut wait = std::pin::pin!(owning_runtime_after_attach_transit("poll-absent", &state));
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());

        assert!(
            wait.as_mut().poll(&mut context).is_pending(),
            "an instance in neither store must be waited for while its lease is held"
        );
    }

    /// An instance in neither store while another holder keeps its lease past
    /// the bound is being loaded or unloaded, not attached. The close gives up
    /// the wait and answers, so the shell's detach does not run out its deadline,
    /// and it has no plugin to close.
    #[test]
    fn a_close_of_an_absent_instance_stops_waiting_for_a_lease_held_past_the_bound() {
        let state = AppState::default();
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "lease-held-absent", true);
        let windows = DedicatedUiWindowHost::start();
        crate::block_on_test(open_plugin_gui(
            "lease-held-absent".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");
        let other_holder = super::super::plugins::try_lock_plugin_lifecycle("lease-held-absent")
            .expect("nothing else holds the instance");
        let unloading = state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .remove("lease-held-absent")
            .expect("the fixture is engine-owned");

        let waited = std::thread::scope(|scope| {
            let started = std::time::Instant::now();
            let close = scope.spawn(|| {
                crate::block_on_test(close_plugin_gui(
                    "lease-held-absent".to_string(),
                    &windows,
                    &state,
                ))
            });
            // No upper time limit: a close that never gives up the lease hangs
            // here rather than passing or failing on a clock.
            while !close.is_finished() {
                std::thread::yield_now();
            }
            let waited = started.elapsed();
            // Released only after the close answered, so it answered with the
            // lease still held.
            drop(other_holder);
            close
                .join()
                .expect("the close thread should not panic")
                .expect("the close should succeed");
            waited
        });

        assert!(
            waited >= ATTACH_TRANSIT_WAIT,
            "the close must wait out the bound for a move before giving up: {waited:?}"
        );
        // Read before the instance is dropped, which closes its editor too.
        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id],
            "an instance in neither store has no plugin to close"
        );
        drop(unloading);
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

        crate::block_on_test(reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            &label,
            &windows,
            &state,
            &NoopEventSink,
        ));

        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "an OS close must reach the plugin on the shell's thread too"
        );
    }

    /// The race of #2917. The shell hides a window the OS is closing the moment
    /// it stops the close, but the reset its report schedules runs here only
    /// after the report crosses the shell — and a reopen clicked into that gap
    /// found the recorded window still present and was refused for an editor
    /// the user had already watched disappear. The reopen must open instead:
    /// it claims the stale record, closes the editor behind it, and opens its
    /// own — and the report landing late names an opening that was replaced,
    /// so it may not touch the editor now on screen.
    #[test]
    fn a_reopen_racing_the_os_close_reset_opens_rather_than_refusing() {
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
        let closed_label = state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .get("engine-owned-fixture")
            .cloned()
            .expect("the open must have recorded a window");

        // The OS ends the window while the report that schedules the reset is
        // still crossing to this side: the shell answers the existence probe
        // "gone" from the moment it stops the close, but nothing here has
        // reset yet.
        windows.os_closed(&closed_label);

        let reopened = crate::block_on_test(open_plugin_gui(
            "engine-owned-fixture".to_string(),
            &windows,
            &state,
        ))
        .expect("a reopen inside the OS-close gap must open the editor, not refuse it");

        assert!(reopened.is_open);
        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id, windows.thread_id],
            "the reopen must close the stale editor and open its own on the shell's thread, \
             like every other editor call"
        );

        let events = RecordingEventSink::default();
        crate::block_on_test(reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            &closed_label,
            &windows,
            &state,
            &events,
        ));

        assert_ne!(
            state
                .plugin_windows
                .lock()
                .expect("plugin_windows lock")
                .get("engine-owned-fixture")
                .map(String::as_str),
            Some(closed_label.as_str()),
            "the reopened editor keeps its record"
        );
        assert!(
            events.events().is_empty(),
            "a report for an opening the reopen replaced must not tell the frontend the live \
             editor closed"
        );
    }

    /// The interleaving the claim race alone does not close. The reopen wins
    /// the record claim, and the OS-close report for the window it claimed
    /// loses — but the shell destroys that window the moment the report
    /// answers, and the reopen's teardown has not left it yet. Answering at
    /// the loss would have the plugin un-parent from a parent that no longer
    /// exists; the report must hold until the claiming teardown completes.
    #[test]
    fn a_report_that_lost_the_claim_waits_until_the_claiming_teardown_leaves_the_window() {
        // Shared rather than stack-owned: the reopen and the report each run on
        // a thread of their own, because the interleaving only exists between
        // them.
        let state = Arc::new(AppState::default());
        let gui_threads =
            insert_engine_owned_fixture_watching_gui_threads(&state, "engine-owned-fixture", true);
        let windows = Arc::new(DedicatedUiWindowHost::start());
        crate::block_on_test(open_plugin_gui(
            "engine-owned-fixture".to_string(),
            windows.as_ref(),
            &state,
        ))
        .expect("the fixture editor should open");
        let closed_label = state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .get("engine-owned-fixture")
            .cloned()
            .expect("the open must have recorded a window");

        // The OS ends the window while the report that schedules the reset is
        // still crossing to this side.
        windows.os_closed(&closed_label);

        // Park the reopen's teardown exactly where the hazard lives: its
        // close_gui hop is taken by the shell thread but not run, so the claim
        // is already won and the plugin has not left the window.
        let held_close = windows.hold_next_task();

        let (reopen_answered, reopen_arrived) = std::sync::mpsc::channel();
        let reopening = {
            let windows = Arc::clone(&windows);
            let state = Arc::clone(&state);
            std::thread::spawn(move || {
                let _ = reopen_answered.send(crate::block_on_test(open_plugin_gui(
                    "engine-owned-fixture".to_string(),
                    windows.as_ref(),
                    &state,
                )));
            })
        };
        held_close.until_held();

        let events = Arc::new(RecordingEventSink::default());
        let (report_answered, report_arrived) = std::sync::mpsc::channel();
        let reporting = {
            let windows = Arc::clone(&windows);
            let state = Arc::clone(&state);
            let events = Arc::clone(&events);
            let closed_label = closed_label.clone();
            std::thread::spawn(move || {
                crate::block_on_test(reset_plugin_gui_state_after_os_close(
                    "engine-owned-fixture",
                    &closed_label,
                    windows.as_ref(),
                    &state,
                    events.as_ref(),
                ));
                let _ = report_answered.send(());
            })
        };

        // The claim is lost, and irrecoverably — yet the report may not answer:
        // the claiming teardown is parked mid-flight, and the plugin is still
        // in the window the shell would destroy on this report's return.
        assert!(
            report_arrived
                .recv_timeout(std::time::Duration::from_millis(200))
                .is_err(),
            "a report that lost its claim must not answer while the claiming teardown is still \
             leaving the window"
        );
        assert_eq!(
            recorded_threads(&gui_threads).len(),
            1,
            "the claiming teardown must be parked: close_gui has not reached the plugin"
        );

        held_close.release();

        report_arrived
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the report must answer once the claiming teardown has completed");
        reporting.join().expect("the report thread must finish");
        reopening.join().expect("the reopen thread must finish");
        let reopened = reopen_arrived
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the reopen must answer once its teardown completes")
            .expect("the reopen must still open its own editor once its teardown completes");
        assert!(reopened.is_open);
        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id, windows.thread_id],
            "the claiming close ran, on the shell's thread, before the report answered — and \
             then the reopen opened its own editor"
        );
        assert!(
            events.events().is_empty(),
            "the losing report changed no state, so it must not tell the frontend anything"
        );
        assert_ne!(
            state
                .plugin_windows
                .lock()
                .expect("plugin_windows lock")
                .get("engine-owned-fixture")
                .map(String::as_str),
            Some(closed_label.as_str()),
            "the reopened editor is recorded under its own label"
        );
    }

    /// A window [inner] returns, plus the one observation this test exists to
    /// make: that a refused opening destroyed the window it had created.
    struct DestroyRecordingWindow {
        inner: Box<dyn PluginEditorWindow>,
        label: String,
        destroyed: Arc<Mutex<Vec<String>>>,
    }

    impl PluginEditorWindow for DestroyRecordingWindow {
        fn native_handle_ptr(
            &self,
        ) -> Result<*mut std::ffi::c_void, crate::host::plugin_window::PluginWindowError> {
            self.inner.native_handle_ptr()
        }

        fn set_size(&self, width: u32, height: u32) {
            self.inner.set_size(width, height);
        }

        fn set_resizable(&self, resizable: bool) {
            self.inner.set_resizable(resizable);
        }

        fn show_and_focus(&self) {
            self.inner.show_and_focus();
        }

        fn destroy(&self) {
            self.destroyed
                .lock()
                .expect("destroyed windows")
                .push(self.label.clone());
            self.inner.destroy();
        }

        fn show(&self) {
            self.inner.show();
        }

        fn hide(&self) {
            self.inner.hide();
        }

        fn run_on_ui_thread(&self, work: Box<dyn FnOnce() + Send>) -> Result<(), String> {
            self.inner.run_on_ui_thread(work)
        }
    }

    /// A shell whose create hop delivers the OS-close report for the stale
    /// label — the report landing between a reopen's already-open check and
    /// its stale-record retirement, which is the one window of opportunity an
    /// opening has for a report to get between the two.
    struct ReportDuringCreateHost<'a> {
        inner: &'a DedicatedUiWindowHost,
        state: &'a AppState,
        events: &'a dyn EventSink,
        /// The label one create is to report closed while it runs. Taken once:
        /// one report models one window's close.
        report_once: Mutex<Option<String>>,
        created: Mutex<Vec<String>>,
        destroyed: Arc<Mutex<Vec<String>>>,
    }

    impl<'a> ReportDuringCreateHost<'a> {
        fn new(
            inner: &'a DedicatedUiWindowHost,
            state: &'a AppState,
            events: &'a dyn EventSink,
            report: String,
        ) -> Self {
            Self {
                inner,
                state,
                events,
                report_once: Mutex::new(Some(report)),
                created: Mutex::new(Vec::new()),
                destroyed: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn created_labels(&self) -> Vec<String> {
            self.created.lock().expect("created windows").clone()
        }

        fn destroyed_labels(&self) -> Vec<String> {
            self.destroyed.lock().expect("destroyed windows").clone()
        }
    }

    impl UiThread for ReportDuringCreateHost<'_> {
        fn is_ui_thread(&self) -> bool {
            self.inner.is_ui_thread()
        }

        fn run_on_ui_thread(
            &self,
            task: &Arc<UiThreadTask>,
        ) -> Result<(), crate::host::ui_thread::UiThreadError> {
            self.inner.run_on_ui_thread(task)
        }
    }

    impl PluginWindowHost for ReportDuringCreateHost<'_> {
        fn window_exists(&self, label: &str) -> bool {
            self.inner.window_exists(label)
        }

        fn create_editor_window(
            &self,
            label: &str,
            title: &str,
            instance_id: &str,
        ) -> Result<Box<dyn PluginEditorWindow>, crate::host::plugin_window::PluginWindowError>
        {
            let window = self.inner.create_editor_window(label, title, instance_id)?;
            // The report lands here, mid-create: the record still names the
            // stale label, so this report wins the claim and tears the editor
            // down itself — and the reopen's own retirement below then finds
            // the record gone.
            if let Some(stale_label) = self.report_once.lock().expect("report once").take() {
                // This hop runs inside the open's own runtime, so the report
                // drives its future from a thread of its own.
                std::thread::scope(|scope| {
                    scope
                        .spawn(|| {
                            crate::block_on_test(reset_plugin_gui_state_after_os_close(
                                instance_id,
                                &stale_label,
                                self.inner,
                                self.state,
                                self.events,
                            ));
                        })
                        .join()
                        .expect("the report thread should not panic");
                });
            }
            self.created
                .lock()
                .expect("created windows")
                .push(label.to_string());
            Ok(Box::new(DestroyRecordingWindow {
                inner: window,
                label: label.to_string(),
                destroyed: Arc::clone(&self.destroyed),
            }))
        }

        fn destroy_window(&self, label: &str) {
            self.inner.destroy_window(label);
        }

        fn hide_window(&self, label: &str) {
            self.inner.hide_window(label);
        }

        fn show_window(&self, label: &str) {
            self.inner.show_window(label);
        }
    }

    /// The losing side of the claim race on the reopen's side, which no host
    /// had ever been able to place: the report lands between the already-open
    /// check and the stale-record retirement — on the create hop — and wins
    /// the claim itself. The reopen must refuse, destroy the window it
    /// created, and above all never reach its own teardown: the report's
    /// teardown owns the editor now.
    #[test]
    fn a_report_landing_during_the_create_hop_refuses_the_reopen_without_its_own_teardown() {
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
        let closed_label = state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .get("engine-owned-fixture")
            .cloned()
            .expect("the open must have recorded a window");
        windows.os_closed(&closed_label);

        let events = RecordingEventSink::default();
        let host = ReportDuringCreateHost::new(&windows, &state, &events, closed_label.clone());

        let refused = crate::block_on_test(open_plugin_gui(
            "engine-owned-fixture".to_string(),
            &host,
            &state,
        ));

        assert_eq!(
            refused.err().as_deref(),
            Some("Plugin editor state changed while its window was opening"),
            "a reopen whose record a report claimed mid-opening must refuse rather than publish"
        );
        assert_eq!(
            host.destroyed_labels(),
            host.created_labels(),
            "the refused opening must destroy the window it created"
        );
        assert_eq!(
            recorded_threads(&gui_threads),
            [windows.thread_id, windows.thread_id],
            "exactly one teardown — the report's own, on the shell's thread; a reopen that \
             reached its own teardown would leave a third lifecycle call here"
        );
        assert_eq!(
            events.events(),
            [(
                PLUGIN_GUI_CLOSED_EVENT.to_string(),
                serde_json::json!({ "instance_id": "engine-owned-fixture" })
            )],
            "the report won the claim, so it — and only it — told the frontend"
        );
    }

    /// The refusal the already-open check exists for — a recorded window the
    /// shell still holds — must survive the stale-record retirement, which may
    /// only ever take down an editor whose window is already gone.
    #[test]
    fn an_editor_whose_window_is_still_live_refuses_a_second_open() {
        let state = AppState::default();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", true);
        let windows = DedicatedUiWindowHost::start();
        crate::block_on_test(open_plugin_gui(
            "engine-owned-fixture".to_string(),
            &windows,
            &state,
        ))
        .expect("the fixture editor should open");

        let refused = crate::block_on_test(open_plugin_gui(
            "engine-owned-fixture".to_string(),
            &windows,
            &state,
        ));

        assert_eq!(refused.err().as_deref(), Some("Plugin GUI is already open"));
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
            report.closed_instance_ids,
            ["healthy-instance"],
            "the instances that did close must be reported"
        );
        assert_eq!(report.errors.len(), 1);
        assert!(
            report.errors[0].starts_with("refusing-instance: "),
            "the error report must name the instance that failed, got: {:?}",
            report.errors
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
            crate::state::PluginInstanceData::dormant_fixture(
                ClapWrapper::new_engine_owned_command_fixture("Command Fixture", vec![], true)
                    .into(),
            ),
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
            report.closed_instance_ids,
            ["engine-with-editor"],
            "only instances that actually had an editor may be reported as closed"
        );
        assert!(
            report.errors.is_empty(),
            "an instance with no editor is not a failure, got: {:?}",
            report.errors
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
                plugin
                    .open_gui(std::ptr::null_mut())
                    .map_err(|error| error.to_string())
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
        crate::block_on_test(reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            "plugin-engine-owned-fixture",
            &NoWindowHost,
            &state,
            &events,
        ));
        crate::block_on_test(reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            "plugin-engine-owned-fixture",
            &NoWindowHost,
            &state,
            &events,
        ));

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
                    plugin
                        .open_gui(std::ptr::null_mut())
                        .map_err(|error| error.to_string())
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
            Ok::<(), String>(()),
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
            plugin
                .open_gui(std::ptr::null_mut())
                .map_err(|error| error.to_string())
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
        crate::block_on_test(reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            "plugin-engine-owned-fixture",
            &NoWindowHost,
            &state,
            &events,
        ));

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
            plugin
                .open_gui(std::ptr::null_mut())
                .map_err(|error| error.to_string())
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
            plugin
                .open_gui(std::ptr::null_mut())
                .map_err(|error| error.to_string())
        });
        assert!(size.is_ok());
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert("engine-owned-fixture".to_string(), live_label.clone());

        let events = RecordingEventSink::default();
        crate::block_on_test(reset_plugin_gui_state_after_os_close(
            "engine-owned-fixture",
            &closed_label,
            &NoWindowHost,
            &state,
            &events,
        ));

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
            plugin
                .open_gui(std::ptr::null_mut())
                .map_err(|error| error.to_string())
        });
        assert_eq!(
            reopen.err().map(|error| error.to_string()).as_deref(),
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

        crate::block_on_test(reset_plugin_gui_state_after_os_close(
            "ghost",
            "plugin-ghost",
            &NoWindowHost,
            &state,
            &NoopEventSink,
        ));

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
                Ok::<(), String>(())
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

    /// The records a claim-helper test stands up: labels only, since the
    /// publish-time claim those helpers model never touches the teardown
    /// handshake.
    fn labels_only(pairs: &[(&str, &str)]) -> PluginWindowRecords {
        let mut windows = PluginWindowRecords::default();
        for (instance_id, label) in pairs {
            windows.insert(instance_id.to_string(), label.to_string());
        }
        windows
    }

    /// The ordinary open: nothing touched the record while the window was being
    /// built, so this opening takes it.
    #[test]
    fn an_opening_nothing_disturbed_claims_the_editor_record() {
        let mut windows = labels_only(&[("inst-1", "plugin-inst-1:1")]);

        let claimed = claim_editor_record_for_opened_window(
            &mut windows,
            "inst-1",
            Some("plugin-inst-1:1"),
            "plugin-inst-1:2",
        );

        assert_eq!(claimed.map_err(|error| error.to_string()), Ok(()));
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
        let mut windows = labels_only(&[]);

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
        let mut windows = labels_only(&[("inst-1", "plugin-inst-1:3")]);

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
        let mut windows = labels_only(&[]);

        let claimed =
            claim_editor_record_for_opened_window(&mut windows, "inst-1", None, "plugin-inst-1:1");

        assert_eq!(claimed.map_err(|error| error.to_string()), Ok(()));
        assert_eq!(
            windows.get("inst-1").map(String::as_str),
            Some("plugin-inst-1:1")
        );
    }

    /// A plugin that records what the editor lifecycle did to it. The real
    /// backends answer through the plugin's own SDK; what matters here is the
    /// order and the release, which the trait alone decides.
    struct RecordingPlugin {
        /// The size the open answers, or `None` for an open that fails.
        opens: Option<(u32, u32)>,
        calls: Vec<&'static str>,
        /// What this plugin answers when asked whether its editor accepts a
        /// host-chosen size.
        can_resize: bool,
        /// The window the open handed it, where its later asks are answered.
        editor_window: Option<SharedEditorWindow>,
    }

    impl AudioPlugin for RecordingPlugin {
        fn has_gui(&self) -> bool {
            true
        }

        fn editor_can_resize(&self) -> bool {
            self.can_resize
        }

        fn process(&mut self, _: &[&[f32]], _: &mut [&mut [f32]], _: usize) {}
        fn set_parameter(&mut self, _: u32, _: f64) {}
        fn get_parameters(&self) -> Vec<daw_plugin_host::PluginParameter> {
            Vec::new()
        }
        fn get_state(&self) -> Result<Vec<u8>, PluginError> {
            Ok(Vec::new())
        }
        fn set_state(&mut self, _: &[u8]) -> Result<(), PluginError> {
            Ok(())
        }

        fn set_editor_window_resizer(&mut self, _: daw_plugin_host::EditorWindowResizer) {
            self.calls.push("window");
        }

        fn set_editor_window(&mut self, window: SharedEditorWindow) {
            self.editor_window = Some(window);
        }

        fn open_gui(&mut self, _: *mut std::ffi::c_void) -> Result<(u32, u32), PluginError> {
            self.calls.push("open");
            self.opens.ok_or_else(|| {
                ClapError::GuiCreateFailed {
                    name: "Recording".to_string(),
                }
                .into()
            })
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
            opens: None,
            calls: Vec::new(),
            can_resize: false,
            editor_window: None,
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
            opens: Some((640, 480)),
            calls: Vec::new(),
            can_resize: false,
            editor_window: None,
        };

        let opened = open_editor_or_release_host_window(
            &mut plugin,
            |plugin| plugin.set_editor_window_resizer(Arc::new(|_, _| {})),
            |plugin| plugin.open_gui(std::ptr::null_mut()),
        );

        assert_eq!(opened.expect("the editor opens"), (640, 480));
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

    /// Run the exit pass somewhere it can be watched, and answer within `wait`.
    ///
    /// A pass that parks does not fail, it hangs — and a hang says nothing about
    /// what broke. Waiting on it from outside turns the freeze this covers into
    /// a missing answer, which is a failure with a name on it.
    fn exit_pass_within(
        state: &Arc<AppState>,
        wait: std::time::Duration,
    ) -> Result<PluginGuiCloseReport, String> {
        let closing = Arc::clone(state);
        let (answer, answered) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = answer
                .send(close_every_plugin_gui(None, &closing).map_err(|error| error.to_string()));
        });
        answered
            .recv_timeout(wait)
            .expect("the exit pass must not park on a lock the shell's thread cannot release")
    }

    /// The quit freeze. `shutdown` runs this pass on the shell's main thread,
    /// and a worker holding an instance's control gate may be waiting for that
    /// same thread to run an editor call. The gate's wait outlasts the shell's
    /// force-exit deadline, so a pass that took it would close the cycle and
    /// burn the shell's whole force-exit budget with every plugin still alive
    /// at the end of it.
    #[test]
    fn the_exit_pass_refuses_an_instance_whose_control_gate_is_held() {
        let state = Arc::new(AppState::default());
        insert_engine_owned_fixture(&state, "engine-owned-fixture", true);
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert("engine-owned-fixture".into(), "plugin-window".into());
        let runtime = engine_fixture_runtime(&state, "engine-owned-fixture");

        let (release, released) = std::sync::mpsc::channel::<()>();
        let (claimed, was_claimed) = std::sync::mpsc::channel::<()>();
        let holder = std::thread::spawn(move || {
            let _ = runtime.with_control(std::time::Duration::from_secs(2), |_| {
                let _ = claimed.send(());
                let _ = released.recv();
                Ok::<_, String>(())
            });
        });
        was_claimed
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the gate must be held before the pass runs");

        let report = exit_pass_within(&state, std::time::Duration::from_secs(5))
            .expect("the exit pass must complete");

        assert!(
            report.closed_instance_ids.is_empty(),
            "an editor that was refused is not an editor that closed: {:?}",
            report.closed_instance_ids
        );
        assert_eq!(
            report.errors.len(),
            1,
            "the refusal must be reported rather than swallowed: {:?}",
            report.errors
        );
        assert!(
            report.errors[0].contains("engine-owned-fixture"),
            "the report must name the instance whose editor was left open: {}",
            report.errors[0]
        );

        let _ = release.send(());
        holder.join().expect("the gate holder should finish");
    }

    /// The same refusal through the other store: whatever holds `plugins`, the
    /// exit pass runs on the shell's thread and must not park on it.
    #[test]
    fn the_exit_pass_refuses_command_owned_instances_whose_store_is_held() {
        let state = Arc::new(AppState::default());
        state.plugins.lock().expect("plugins lock").insert(
            "command-instance".into(),
            PluginInstanceData::dormant_fixture(
                ClapWrapper::new_engine_owned_command_fixture("Command Fixture", vec![], true)
                    .into(),
            ),
        );
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert("command-instance".into(), "plugin-window".into());

        let held = state.plugins.lock().expect("plugins lock");
        let report = exit_pass_within(&state, std::time::Duration::from_secs(5))
            .expect("the exit pass must complete");
        drop(held);

        assert!(
            report.closed_instance_ids.is_empty(),
            "no editor was reached, so none closed: {:?}",
            report.closed_instance_ids
        );
        assert_eq!(
            report.errors,
            ["Command-owned plugin instances were busy; their editors were not closed"],
            "the skipped store must be reported"
        );
    }

    /// A dormant instance whose call never comes back out of the plugin costs
    /// the exit pass that one editor, not the store: the pass reaches every
    /// other command-owned editor and names the stuck one.
    #[test]
    fn the_exit_pass_closes_other_dormant_editors_while_one_dormant_call_is_hung() {
        let state = Arc::new(AppState::default());
        let (held, calls) = PluginInstanceData::dormant_fixture_holding_vendor_calls(
            "Held Dormant",
            std::time::Duration::from_millis(50),
        );
        {
            let mut plugins = state.plugins.lock().expect("plugins lock");
            plugins.insert("held".into(), held);
            plugins.insert(
                "other".into(),
                PluginInstanceData::dormant_fixture(
                    ClapWrapper::new_engine_owned_command_fixture("Other Dormant", vec![], true)
                        .into(),
                ),
            );
        }
        {
            let mut windows = state.plugin_windows.lock().expect("plugin_windows lock");
            windows.insert("held".into(), "held-window".into());
            windows.insert("other".into(), "other-window".into());
        }
        let writer_state = Arc::clone(&state);
        let held_call = std::thread::spawn(move || {
            crate::block_on_test(crate::commands::plugins::set_plugin_parameter(
                daw_core::PluginInstanceId("held".to_string()),
                3,
                0.5,
                &writer_state,
            ))
        });
        calls
            .entered
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the held call must reach the plugin");

        let report = exit_pass_within(&state, std::time::Duration::from_secs(5))
            .expect("the exit pass must complete");

        assert_eq!(report.closed_instance_ids, ["other"]);
        assert_eq!(report.errors.len(), 1, "{:?}", report.errors);
        assert!(
            report.errors[0].starts_with("held: "),
            "the report must name the instance whose editor was left open: {}",
            report.errors[0]
        );

        drop(calls.release);
        assert_eq!(held_call.join().expect("the held call must return"), Ok(()));
    }

    /// A dormant instance with an editor whose every vendor call waits inside
    /// the plugin, an ordinary dormant instance beside it, and the held
    /// instance's editor window recorded.
    fn state_with_a_held_dormant_editor() -> (Arc<AppState>, crate::state::HeldVendorCalls) {
        let state = Arc::new(AppState::default());
        let (held, calls) = PluginInstanceData::dormant_fixture_holding_vendor_calls(
            "Held Dormant",
            std::time::Duration::from_millis(50),
        );
        {
            let mut plugins = state.plugins.lock().expect("plugins lock");
            plugins.insert("held".into(), held);
            plugins.insert(
                "other".into(),
                PluginInstanceData::dormant_fixture(
                    ClapWrapper::new_engine_owned_command_fixture("Other Dormant", vec![7], false)
                        .into(),
                ),
            );
        }
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert("held".into(), "held-window".into());
        (state, calls)
    }

    /// What the other dormant instance answered a parameter write and a state
    /// read with, or `None` if it did not answer in time.
    type OtherInstanceAnswer = Option<(Result<(), String>, Result<Vec<u8>, String>)>;

    /// While `editor_call` is held inside the dormant plugin, whether the map
    /// was free and whether a command on the other dormant instance answered.
    /// The held call is released before anything is asserted, so a failure
    /// reports instead of leaving the call parked.
    fn editor_call_held_inside_the_plugin<Answer: Send + 'static>(
        state: &Arc<AppState>,
        calls: crate::state::HeldVendorCalls,
        editor_call: impl FnOnce(&AppState) -> Answer + Send + 'static,
    ) -> (bool, OtherInstanceAnswer, Answer) {
        let bound = std::time::Duration::from_secs(5);
        let caller_state = Arc::clone(state);
        let held_call = std::thread::spawn(move || editor_call(&caller_state));
        calls
            .entered
            .recv_timeout(bound)
            .expect("the held editor call must reach the plugin");

        let map_was_free = state.plugins.try_lock().is_ok();
        let other_state = Arc::clone(state);
        let (answered, answer) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = answered.send((
                crate::block_on_test(crate::commands::plugins::set_plugin_parameter(
                    daw_core::PluginInstanceId("other".to_string()),
                    1,
                    0.25,
                    &other_state,
                )),
                crate::commands::plugins::read_plugin_state_chunk("other", &other_state)
                    .map_err(|error| error.to_string()),
            ));
        });
        let other_answer = answer.recv_timeout(bound).ok();

        drop(calls.release);
        let held_answer = held_call.join().expect("the held editor call must return");
        (map_was_free, other_answer, held_answer)
    }

    fn assert_only_the_held_instance_was_held(
        map_was_free: bool,
        other_answer: OtherInstanceAnswer,
    ) {
        assert!(
            map_was_free,
            "an editor call on a dormant instance must not run under the plugin map lock"
        );
        assert_eq!(
            other_answer,
            Some((Ok(()), Ok(vec![7]))),
            "a command on another dormant instance must not wait for the held editor call"
        );
    }

    /// The exit pass's own close of a dormant editor runs off the map: while
    /// that close is inside the plugin, every other command still answers.
    #[test]
    fn the_exit_pass_closes_a_dormant_editor_with_the_plugin_map_released() {
        let (state, calls) = state_with_a_held_dormant_editor();
        let (map_was_free, other_answer, report) =
            editor_call_held_inside_the_plugin(&state, calls, |state| {
                close_every_plugin_gui(None, state).map_err(|error| error.to_string())
            });

        assert_only_the_held_instance_was_held(map_was_free, other_answer);
        let report = report.expect("the exit pass must complete");
        assert_eq!(report.closed_instance_ids, ["held"]);
        assert!(report.errors.is_empty(), "{:?}", report.errors);
    }

    #[test]
    fn closing_a_dormant_editor_runs_with_the_plugin_map_released() {
        let (state, calls) = state_with_a_held_dormant_editor();
        let (map_was_free, other_answer, closed) =
            editor_call_held_inside_the_plugin(&state, calls, |state| {
                crate::block_on_test(close_editor_and_window("held", &NoWindowHost, state))
                    .map_err(|error| error.to_string())
            });

        assert_only_the_held_instance_was_held(map_was_free, other_answer);
        assert_eq!(closed, Ok(()));
    }

    #[test]
    fn opening_a_dormant_editor_runs_with_the_plugin_map_released() {
        let (state, calls) = state_with_a_held_dormant_editor();
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .remove("held");
        let windows = Arc::new(DedicatedUiWindowHost::start());
        let opening_windows = Arc::clone(&windows);
        let (map_was_free, other_answer, opened) =
            editor_call_held_inside_the_plugin(&state, calls, move |state| {
                crate::block_on_test(open_editor_in_new_window(
                    "held".to_string(),
                    opening_windows.as_ref(),
                    state,
                ))
                .map(|info| info.is_open)
                .map_err(|error| error.to_string())
            });

        assert_only_the_held_instance_was_held(map_was_free, other_answer);
        assert_eq!(opened, Ok(true));
    }
}
