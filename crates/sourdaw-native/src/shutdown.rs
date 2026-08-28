//! The process-exit cascade, in the one order that is correct.
//!
//! Quit is the only chance to run all four of these, and they are ordered by
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
//! 4. Tear down every instance that is still *live*. Nothing else ever will:
//!    the host process does not run destructors at exit, so a plugin left in
//!    the stores is a CLAP or VST3 binary killed mid-flight, without the
//!    `deactivate`/`destroy` or `setActive(0)`/`terminate` its format requires.
//!
//! Step 3 has to follow step 2 — closing an editor is what can retire a runtime
//! — and step 2 is best effort, so a failure there must not skip it. Step 4
//! follows both, because an instance whose editor is still open would be torn
//! down with its editor. That is why this lives in the crate rather than in
//! each shell: a shell that reimplements the cascade can silently drop a step,
//! and the second shell has no `RunEvent::Exit` to hang it off.

use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use crate::commands::collab::{shutdown_discovery, CollabState};
use crate::commands::plugin_gui::close_every_plugin_gui;
use crate::host::native_bridge::SharedHostedPlugin;
use crate::host::plugin_window::PluginWindowHost;
use crate::state::{AppState, EnginePluginInstanceData};

/// How long the teardown pass waits, in total, for the scheduler to release the
/// runtimes whose removal it has just queued.
///
/// The audio thread applies a queued removal within a callback period and the
/// reclaimer thread drops the slot right after, so this is generous for the
/// ordinary case. It is one budget for the whole pass rather than one per
/// instance, so a stalled audio thread costs the exit the same whether one
/// plugin is loaded or thirty — and the shell's own exit deadline survives it.
const SCHEDULER_RELEASE_BUDGET: Duration = Duration::from_millis(500);

/// Poll interval while waiting for that release.
const SCHEDULER_RELEASE_POLL: Duration = Duration::from_millis(2);

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
    /// Live instances whose own teardown ran before the process exited.
    pub destroyed_instances: usize,
    /// Live instances left standing because something else still held the
    /// runtime when the pass's deadline passed, one name each. Their teardown
    /// did *not* run here.
    pub abandoned_instances: Vec<String>,
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

    destroy_live_plugin_instances(app_state, &mut report);

    report
}

/// Run every live instance's own termination sequence, on this thread, before
/// the process goes away.
///
/// This pass — not a `Drop` on some later teardown that never comes — is what
/// gives a plugin binary the termination its format specifies. It takes no
/// plugin control lock of its own: an instance is torn down only once nothing
/// else holds its runtime, so there is no lock here for the close pass that
/// precedes it, or a watcher thread, to be waiting on.
fn destroy_live_plugin_instances(app_state: &AppState, report: &mut ShutdownReport) {
    let instances = app_state.take_live_plugin_instances();

    // Command-owned instances are owned outright, so this drop *is* their
    // teardown.
    report.destroyed_instances += instances.command_owned.len();
    drop(instances.command_owned);

    let runtimes = remove_runtimes_from_scheduler(app_state, instances.engine_owned);
    destroy_released_runtimes(runtimes, report);
}

/// Queue every engine-owned runtime's removal from the audio graph, and hand
/// the runtimes back.
///
/// Removal is what makes the scheduler release its own `Arc`, and that release
/// is the acknowledgment the teardown below waits for. A removal that cannot be
/// queued — no engine running, or an engine that will not take the command — is
/// not fatal: the runtime is still handed back, and an instance nothing else
/// holds is torn down anyway.
fn remove_runtimes_from_scheduler(
    app_state: &AppState,
    instances: Vec<EnginePluginInstanceData>,
) -> Vec<Arc<SharedHostedPlugin>> {
    let mut engine = match app_state.engine.lock() {
        Ok(engine) => engine,
        Err(poisoned) => poisoned.into_inner(),
    };

    instances
        .into_iter()
        .map(|instance| {
            if let Some(engine) = engine.as_mut() {
                let _ = engine.remove_plugin(instance.engine_plugin_id);
            }
            instance.runtime
        })
        .collect()
}

/// Drop each runtime once this pass is its only owner, which is when the
/// plugin's teardown runs.
///
/// A runtime the scheduler or a watcher thread still holds cannot be torn down
/// here at all — the drop would free nothing while a clone survives — so it is
/// reported rather than waited on past the deadline. Waiting longer would spend
/// the shell's exit deadline to reach the same outcome.
fn destroy_released_runtimes(runtimes: Vec<Arc<SharedHostedPlugin>>, report: &mut ShutdownReport) {
    let deadline = Instant::now() + SCHEDULER_RELEASE_BUDGET;

    for runtime in runtimes {
        runtime.retire();

        if !wait_until_sole_owner(&runtime, deadline) {
            report.abandoned_instances.push(runtime.name().to_string());
            continue;
        }

        // Sole owner, so no other thread can be inside the wrapper: this is the
        // point at which running third-party teardown is safe.
        drop(runtime);
        report.destroyed_instances += 1;
    }
}

fn wait_until_sole_owner(runtime: &Arc<SharedHostedPlugin>, deadline: Instant) -> bool {
    loop {
        if Arc::strong_count(runtime) == 1 {
            return true;
        }

        if Instant::now() >= deadline {
            return false;
        }

        thread::sleep(SCHEDULER_RELEASE_POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::plugin_window::{NoWindowHost, PluginEditorWindow};
    use daw_plugin_host::ProcessingGate;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    /// Records what the stores held at `destroy_window` time.
    ///
    /// Both readings are order guards: the sweep empties the retirement vec and
    /// the teardown pass empties the live store, so a cascade that ran either
    /// before closing editors would record 0 for it here.
    struct OrderRecordingHost {
        state: Arc<AppState>,
        retired_at_destroy: AtomicUsize,
        live_engine_plugins_at_destroy: AtomicUsize,
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
            let live_engine_plugins = self
                .state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock should be available")
                .len();
            self.live_engine_plugins_at_destroy
                .store(live_engine_plugins, Ordering::SeqCst);
            self.destroyed
                .lock()
                .expect("destroyed lock should be available")
                .push(label.to_string());
        }

        fn hide_window(&self, _label: &str) {}

        fn show_window(&self, _label: &str) {}
    }

    fn order_recording_host(state: &Arc<AppState>) -> OrderRecordingHost {
        OrderRecordingHost {
            state: Arc::clone(state),
            retired_at_destroy: AtomicUsize::new(usize::MAX),
            live_engine_plugins_at_destroy: AtomicUsize::new(usize::MAX),
            destroyed: Mutex::new(Vec::new()),
        }
    }

    fn live_runtime(name: &str) -> Arc<SharedHostedPlugin> {
        Arc::new(SharedHostedPlugin::new(
            daw_plugin_host::ClapWrapper::new_engine_owned_command_fixture(name, Vec::new(), true)
                .into(),
        ))
    }

    /// Put a live engine-owned instance in the store and hand back its
    /// processing gate.
    ///
    /// The gate is the teardown witness: the fixture starts in the processing
    /// state, and nothing but the wrapper's own termination sequence — reached
    /// only by dropping the runtime — takes it out of one while no audio thread
    /// is running.
    fn insert_live_engine_plugin(state: &AppState, instance_id: &str) -> Arc<ProcessingGate> {
        let runtime = live_runtime("Live Fixture");
        let processing = runtime.processing_gate();
        state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available")
            .insert(
                instance_id.to_string(),
                EnginePluginInstanceData {
                    engine_plugin_id: 41,
                    runtime,
                    name: "Live Fixture".to_string(),
                    parameters: Vec::new(),
                    has_gui: true,
                    bridge: None,
                    relay_scratch: crate::state::PluginRelayScratch::default(),
                },
            );
        processing
    }

    fn insert_command_owned_plugin(state: &AppState, instance_id: &str) {
        state
            .plugins
            .lock()
            .expect("plugins lock should be available")
            .insert(
                instance_id.to_string(),
                crate::state::PluginInstanceData {
                    plugin: Box::new(
                        daw_plugin_host::ClapWrapper::new_engine_owned_command_fixture(
                            "Command Fixture",
                            Vec::new(),
                            false,
                        ),
                    ),
                },
            );
    }

    fn engine_plugin_count(state: &AppState) -> usize {
        state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available")
            .len()
    }

    fn retire_a_runtime(state: &AppState) {
        state
            .retired_engine_plugins
            .lock()
            .expect("retirement lock should be available")
            .push(Arc::new(
                crate::host::native_bridge::SharedHostedPlugin::new(
                    daw_plugin_host::ClapWrapper::new_engine_owned_command_fixture(
                        "Retired Fixture",
                        Vec::new(),
                        false,
                    )
                    .into(),
                ),
            ));
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

        let host = order_recording_host(&state);

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

    /// Exit is the last chance a loaded plugin has to be terminated the way its
    /// format requires: the host process does not run destructors on the way
    /// out, so an instance the cascade leaves in the stores is a CLAP or VST3
    /// binary killed mid-flight.
    #[test]
    fn shutdown_terminates_every_live_plugin_instance() {
        let state = AppState::default();
        let processing = insert_live_engine_plugin(&state, "engine-instance");
        insert_command_owned_plugin(&state, "command-instance");

        let report = shutdown(&CollabState::default(), &state, Some(&NoWindowHost));

        assert_eq!(
            processing.off_audio_thread_stops(),
            1,
            "the engine-owned instance's own termination sequence must have run"
        );
        assert_eq!(
            report.destroyed_instances, 2,
            "the report must count both torn-down instances"
        );
        assert!(
            report.abandoned_instances.is_empty(),
            "nothing else held either runtime, so nothing may be reported as left standing"
        );
        assert_eq!(engine_plugin_count(&state), 0);
        assert!(
            state
                .plugins
                .lock()
                .expect("plugins lock should be available")
                .is_empty(),
            "a store still holding an instance is one nothing will ever tear down"
        );
    }

    /// The teardown drops the plugin, and an instance whose editor is still
    /// open would be torn down with its editor open — so the close pass has to
    /// come first, and this pins that it does.
    #[test]
    fn shutdown_closes_editors_before_it_terminates_their_instances() {
        let state = Arc::new(AppState::default());
        insert_live_engine_plugin(&state, "instance-a");
        state
            .plugin_windows
            .lock()
            .expect("plugin_windows lock should be available")
            .insert("instance-a".to_string(), "plugin-instance-a".to_string());

        let host = order_recording_host(&state);

        let report = shutdown(&CollabState::default(), &state, Some(&host));

        assert_eq!(
            host.live_engine_plugins_at_destroy.load(Ordering::SeqCst),
            1,
            "the instance must still be live while its editor is being closed"
        );
        assert_eq!(report.closed_editors, ["instance-a"]);
        assert_eq!(report.destroyed_instances, 1);
        assert_eq!(engine_plugin_count(&state), 0);
    }

    /// A runtime the scheduler — or a watcher thread — still holds cannot be
    /// terminated here: the drop would free nothing while a clone survives. The
    /// pass must say so instead of claiming a teardown that never ran, and must
    /// not spend the shell's exit deadline waiting for one.
    #[test]
    fn a_runtime_something_else_still_holds_is_reported_rather_than_claimed() {
        let state = AppState::default();
        let processing = insert_live_engine_plugin(&state, "engine-instance");
        let scheduler_reference = state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available")
            .get("engine-instance")
            .map(|instance| Arc::clone(&instance.runtime))
            .expect("the fixture instance should be in the store");

        let started = Instant::now();
        let report = shutdown(&CollabState::default(), &state, Some(&NoWindowHost));
        let elapsed = started.elapsed();

        assert_eq!(report.destroyed_instances, 0);
        assert_eq!(
            report.abandoned_instances,
            ["Live Fixture"],
            "an instance left standing must be named, not counted as destroyed"
        );
        assert_eq!(
            processing.off_audio_thread_stops(),
            0,
            "no termination sequence may run while another owner holds the runtime"
        );
        assert_eq!(
            Arc::strong_count(&scheduler_reference),
            1,
            "the pass must release its own reference and leave the other owner's alone"
        );
        assert!(
            elapsed < Duration::from_secs(2),
            "the wait must be bounded well inside the shell's exit deadline, took {elapsed:?}"
        );
    }
}
