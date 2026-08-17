//! The Tauri shell's implementation of the native crate's plugin-window seam.
//!
//! Creates bare native windows (no WebView) via `WindowBuilder` with the
//! `unstable` feature and hands their native handle to the CLAP GUI extension.
//! Every decision about *whether* to open, publish or reset an editor lives in
//! `sourdaw_native::commands::plugin_gui`; this file only knows how to make a
//! window on this platform.

use raw_window_handle::HasWindowHandle;
use sourdaw_native::commands::plugin_gui::reset_plugin_gui_state_after_os_close;
use sourdaw_native::host::plugin_window::{
    native_editor_handle_ptr, plugin_editor_needs_always_on_top, PluginEditorWindow,
    PluginWindowHost, MAIN_WINDOW_LABEL,
};
use sourdaw_native::state::AppState;
use tauri::Manager;

/// The DAW window a plugin editor is owned by: the configured main window, or
/// nothing.
///
/// Only `main`. Ownership is a destruction cascade as well as a z-order
/// relationship — destroying the owner destroys every window owned by it — so
/// picking an owner by guesswork is not a safe degradation. Any other window
/// this app grows (an about box, a dialog) would be the wrong thing to hang
/// every plugin editor off, and a label sorting below "main" would have been
/// chosen over it. No parent is a defined state:
/// `plugin_editor_needs_always_on_top` keeps an unparented editor reachable.
fn daw_parent_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<tauri::Window<R>> {
    app.get_window(MAIN_WINDOW_LABEL)
}

/// Whether a window event means this plugin editor is going away, and the
/// "GUI open" bookkeeping must be reset.
///
/// Two events, not one. `CloseRequested` is the title-bar button. `Destroyed`
/// is the owner-destroy cascade: the editor is *owned* by the DAW window, and
/// the platform destroys owned windows with their owner without asking them
/// first, so that path arrives only as `Destroyed`. Matching `CloseRequested`
/// alone left the plugin's internal GUI never destroyed and its
/// `plugin_windows` entry stale, which makes the editor permanently unopenable
/// ("GUI is already open") for any process that outlives the main window.
fn window_event_ends_the_plugin_editor(event: &tauri::WindowEvent) -> bool {
    matches!(
        event,
        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
    )
}

/// Hand the OS-close reset to the async runtime and return its join handle.
///
/// The window-event handler runs on the Tauri event thread — the only
/// event-thread caller of the plugin mutexes (`plugins`, `engine_plugins`) and
/// of `SharedClapPlugin`'s control lock (a 2 s spin). Doing that work inline
/// risks a circular-wait deadlock with GUI-affine plugins and freezes the whole
/// app event loop otherwise, so the handler only spawns; Tauri destroys the
/// window regardless. The handle is returned so tests can await the scheduled
/// reset; the handler itself detaches.
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

/// Creates and addresses plugin editor windows through the Tauri runtime.
pub struct TauriWindowHost {
    app: tauri::AppHandle,
}

impl TauriWindowHost {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl PluginWindowHost for TauriWindowHost {
    fn window_exists(&self, label: &str) -> bool {
        self.app.get_window(label).is_some()
    }

    fn create_editor_window(
        &self,
        label: &str,
        title: &str,
        instance_id: &str,
    ) -> Result<Box<dyn PluginEditorWindow>, String> {
        let editor_window_builder = || {
            tauri::window::WindowBuilder::new(&self.app, label)
                .title(title)
                .inner_size(800.0, 600.0)
                .decorations(true)
                .resizable(false)
                .visible(false)
        };

        let (editor_window_builder, parented) = match daw_parent_window(&self.app) {
            Some(parent) => match editor_window_builder().parent(&parent) {
                Ok(builder) => (builder, true),
                Err(error) => {
                    eprintln!("[Plugin] platform refused the editor window parent: {error}");
                    (editor_window_builder(), false)
                }
            },
            None => (editor_window_builder(), false),
        };

        let window = editor_window_builder
            .always_on_top(plugin_editor_needs_always_on_top(parented))
            .build()
            .map_err(|e| format!("Failed to create plugin window: {}", e))?;

        // OS-level close (title-bar button): Tauri destroys the window by
        // default. Schedule the plugin GUI state reset when that happens so a
        // later open recreates the GUI instead of failing on stale state and
        // leaking the plugin's internal GUI (audit #508 row 10).
        {
            let close_app = self.app.clone();
            let close_instance_id = instance_id.to_string();
            let close_window_label = label.to_string();
            window.on_window_event(move |event| {
                if window_event_ends_the_plugin_editor(event) {
                    schedule_plugin_gui_reset_after_os_close(
                        close_instance_id.clone(),
                        close_window_label.clone(),
                        close_app.clone(),
                    );
                }
            });
        }

        Ok(Box::new(TauriEditorWindow { window }))
    }

    fn destroy_window(&self, label: &str) {
        if let Some(window) = self.app.get_window(label) {
            let _ = window.destroy();
        }
    }

    fn hide_window(&self, label: &str) {
        if let Some(window) = self.app.get_window(label) {
            let _ = window.hide();
        }
    }

    fn show_window(&self, label: &str) {
        if let Some(window) = self.app.get_window(label) {
            let _ = window.show();
        }
    }
}

struct TauriEditorWindow {
    window: tauri::Window,
}

impl PluginEditorWindow for TauriEditorWindow {
    fn native_handle_ptr(&self) -> Result<*mut std::ffi::c_void, String> {
        self.window
            .window_handle()
            .map_err(|e| format!("Failed to get window handle: {}", e))
            .and_then(|handle| native_editor_handle_ptr(handle.as_raw()))
    }

    fn set_size(&self, width: u32, height: u32) {
        let _ = self.window.set_size(tauri::LogicalSize::new(width, height));
    }

    fn show_and_focus(&self) {
        let _ = self.window.show();
        let _ = self.window.set_focus();
    }

    fn destroy(&self) {
        let _ = self.window.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command_test_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .manage(AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("test app should build")
    }

    fn build_test_window(
        app: &tauri::AppHandle<tauri::test::MockRuntime>,
        label: &str,
    ) -> tauri::Window<tauri::test::MockRuntime> {
        tauri::window::WindowBuilder::new(app, label)
            .visible(false)
            .build()
            .expect("the mock runtime should build a window")
    }

    /// The configured main window is the DAW window, and owning editors by it is
    /// what gives them their z-order.
    #[test]
    fn the_configured_main_window_owns_plugin_editors() {
        let app = command_test_app();
        let main_window = build_test_window(app.handle(), MAIN_WINDOW_LABEL);

        let parent = daw_parent_window(app.handle()).expect("main must be the owner");

        assert_eq!(parent.label(), main_window.label());
    }

    /// Ownership is a destruction cascade, not just a z-order relationship:
    /// destroying the owner destroys every editor it owns. Guessing an owner by
    /// label order would hand that power to whatever window sorts lowest — an
    /// "about" box sorts below "main" — so no main window means no owner, and
    /// the editor falls back to unparented + always-on-top.
    #[test]
    fn no_main_window_means_no_owner_rather_than_the_lowest_labelled_one() {
        let app = command_test_app();
        let _about_window = build_test_window(app.handle(), "about");
        let _dialog_window = build_test_window(app.handle(), "dialog");
        assert!(app.get_window(MAIN_WINDOW_LABEL).is_none());

        assert!(
            daw_parent_window(app.handle()).is_none(),
            "an unrelated window must never become the owner of every plugin editor"
        );
    }

    /// An editor owned by the DAW window is destroyed *with* it, and that path
    /// never asks: it arrives as `Destroyed`, not `CloseRequested`.
    #[test]
    fn the_owner_destroy_cascade_resets_plugin_gui_state() {
        assert!(window_event_ends_the_plugin_editor(
            &tauri::WindowEvent::Destroyed
        ));
    }

    /// The reset is not for every event the window emits.
    #[test]
    fn an_ordinary_window_event_does_not_reset_plugin_gui_state() {
        assert!(!window_event_ends_the_plugin_editor(
            &tauri::WindowEvent::Focused(true)
        ));
    }

    /// The event-thread handler only schedules the reset; the scheduled work is
    /// what must actually clear the bookkeeping.
    #[test]
    fn the_scheduled_os_close_reset_clears_the_window_label() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .insert("ghost".to_string(), "plugin-ghost".to_string());

        let reset = schedule_plugin_gui_reset_after_os_close(
            "ghost".to_string(),
            "plugin-ghost".to_string(),
            app.handle().clone(),
        );
        tauri::async_runtime::block_on(reset).expect("scheduled reset should complete");

        assert!(state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock")
            .is_empty());
    }
}
