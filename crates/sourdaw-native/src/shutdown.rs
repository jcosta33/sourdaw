//! The process-exit cascade, in the one order that is correct.
//!
//! Quit is the only chance to run all three of these, and they are ordered by
//! what stops being possible if they are late:
//!
//! 1. Retire the mDNS advertisement and the discovery threads. Skipping it
//!    leaves peers a joinable ghost session until the record's TTL expires.
//! 2. Give every open plugin editor its CLAP `gui.destroy` while there is still
//!    a process to run it in. A plugin that refuses is reported, never fatal:
//!    exit must not be blocked by a third-party editor.
//! 3. Sweep the retirement vec. Load and unload are the only other sweep sites,
//!    so without this terminal one the last retirement of a session is never
//!    freed and a plugin that persists settings in `destroy` never gets to.
//!
//! Step 3 has to follow step 2 — closing an editor is what can retire a runtime
//! — and step 2 is best effort, so a failure there must not skip it. That is
//! why this lives in the crate rather than in each shell: a shell that
//! reimplements the cascade can silently drop a step, and the second shell has
//! no `RunEvent::Exit` to hang it off.

use crate::commands::collab::{shutdown_discovery, CollabState};
use crate::commands::plugin_gui::close_every_plugin_gui;
use crate::host::plugin_window::PluginWindowHost;
use crate::state::AppState;

/// What the exit cascade managed to do. Every field is diagnostic: nothing here
/// can fail the exit.
#[derive(Debug, Default, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ShutdownReport {
    /// Instances whose editor was closed.
    pub closed_editors: Vec<String>,
    /// Instances whose editor refused to close, one message each.
    pub editors_that_refused: Vec<String>,
    /// Set when the close pass could not run at all — a poisoned lock, not an
    /// individual editor's refusal.
    pub editor_close_error: Option<String>,
}

/// Run the exit cascade. Idempotent: a second call finds nothing left to do.
///
/// `windows` is optional because a shell may reach exit with no window host —
/// the editors' CLAP `gui.destroy` still runs, only the native window teardown
/// is skipped.
pub fn shutdown(
    collab: &CollabState,
    app_state: &AppState,
    windows: Option<&dyn PluginWindowHost>,
) -> ShutdownReport {
    shutdown_discovery(collab);

    let mut report = ShutdownReport::default();
    match close_every_plugin_gui(windows, app_state) {
        Ok((closed, refused)) => {
            report.closed_editors = closed;
            report.editors_that_refused = refused;
        }
        Err(error) => report.editor_close_error = Some(error),
    }

    // Deliberately after the close pass and outside the match: a close that
    // could not run is exactly the case where reclamation still matters.
    app_state.sweep_retired_engine_plugins();

    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::plugin_window::{NoWindowHost, PluginEditorWindow};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    /// Records the retirement-vec length observed at `destroy_window` time.
    ///
    /// That reading is the order guard: the sweep empties the vec, so a
    /// cascade that swept before closing editors would record 0 here.
    struct OrderRecordingHost {
        state: Arc<AppState>,
        retired_at_destroy: AtomicUsize,
        destroyed: Mutex<Vec<String>>,
    }

    impl PluginWindowHost for OrderRecordingHost {
        fn window_exists(&self, _label: &str) -> bool {
            true
        }

        fn create_editor_window(
            &self,
            _label: &str,
            _title: &str,
            _instance_id: &str,
        ) -> Result<Box<dyn PluginEditorWindow>, String> {
            Err("test host creates no windows".to_string())
        }

        fn destroy_window(&self, label: &str) {
            let retired = self
                .state
                .retired_engine_plugins
                .lock()
                .expect("retirement lock should be available")
                .len();
            self.retired_at_destroy.store(retired, Ordering::SeqCst);
            self.destroyed
                .lock()
                .expect("destroyed lock should be available")
                .push(label.to_string());
        }

        fn hide_window(&self, _label: &str) {}

        fn show_window(&self, _label: &str) {}
    }

    fn retire_a_runtime(state: &AppState) {
        state
            .retired_engine_plugins
            .lock()
            .expect("retirement lock should be available")
            .push(Arc::new(crate::host::native_bridge::SharedClapPlugin::new(
                daw_plugin_host::ClapWrapper::new_engine_owned_command_fixture(
                    "Retired Fixture",
                    Vec::new(),
                    false,
                ),
            )));
    }

    #[test]
    fn shutdown_closes_editors_before_it_sweeps_the_retirement_vec() {
        let state = Arc::new(AppState::default());
        retire_a_runtime(&state);
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock should be available")
            .insert("instance-a".to_string(), "plugin-instance-a".to_string());

        let host = OrderRecordingHost {
            state: Arc::clone(&state),
            retired_at_destroy: AtomicUsize::new(usize::MAX),
            destroyed: Mutex::new(Vec::new()),
        };

        shutdown(&CollabState::default(), &state, Some(&host));

        assert_eq!(
            host.destroyed
                .lock()
                .expect("destroyed lock should be available")
                .as_slice(),
            ["plugin-instance-a"],
            "the editor's native window must be destroyed on exit"
        );
        assert_eq!(
            host.retired_at_destroy.load(Ordering::SeqCst),
            1,
            "the sweep must run after the editors close, not before"
        );
    }

    #[test]
    fn shutdown_is_idempotent() {
        let state = AppState::default();
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock should be available")
            .insert("instance-a".to_string(), "plugin-instance-a".to_string());

        let first = shutdown(&CollabState::default(), &state, Some(&NoWindowHost));
        let second = shutdown(&CollabState::default(), &state, Some(&NoWindowHost));

        assert_eq!(first, ShutdownReport::default());
        assert_eq!(second, first);
        assert!(
            state
                .plugin_windows
                .lock()
                .expect("plugin_windows lock should be available")
                .is_empty(),
            "the first pass must leave no editor for the second to find"
        );
    }

    #[test]
    fn shutdown_sweeps_even_without_a_window_host() {
        let state = AppState::default();
        retire_a_runtime(&state);

        shutdown(&CollabState::default(), &state, None);

        assert!(
            state
                .retired_engine_plugins
                .lock()
                .expect("retirement lock should be available")
                .is_empty(),
            "the terminal reclamation point must not depend on a window host"
        );
    }
}
