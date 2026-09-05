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
//! 4. Retire every instance that is still *live* into that same vec and free it
//!    from there. Nothing else ever will: the host process does not run
//!    destructors at exit, so a plugin left in the stores is a CLAP or VST3
//!    binary killed mid-flight, without the `deactivate`/`destroy` or
//!    `setActive(0)`/`terminate` its format requires.
//!
//! Step 3 has to follow step 2 — closing an editor is what can retire a runtime
//! — and step 2 is best effort, so a failure there must not skip it. Step 4
//! follows both, because an instance whose editor is still open would be torn
//! down with its editor. Step 4 sweeps as it waits, which is what keeps the
//! retirement vec's reclamation terminal: a runtime the scheduler releases
//! during step 4's wait window would otherwise be past its only sweep. That is
//! why this lives in the crate rather than in each shell: a shell that
//! reimplements the cascade can silently drop a step, and the second shell has
//! no `RunEvent::Exit` to hang it off.

use std::sync::{Arc, Weak};
use std::thread;
use std::time::{Duration, Instant};

use crate::commands::collab::{shutdown_discovery, CollabState};
use crate::commands::plugin_gui::close_every_plugin_gui;
use crate::host::native_bridge::SharedHostedPlugin;
use crate::host::plugin_window::{NoWindowHost, PluginWindowHost};
use crate::state::{locked_or_poisoned, AppState, EnginePluginInstanceData};

/// How long the teardown pass may spend *waiting* for the scheduler to release
/// the runtimes whose removal it has just queued.
///
/// The audio thread applies a queued removal within a callback period and the
/// reclaimer thread drops the slot right after, so this is generous for the
/// ordinary case. Only sleeping is charged to it, and charged as *measured*
/// rather than as requested: a plugin whose `destroy` persists a large preset
/// takes as long as it takes, and charging that to a wall clock fixed at the
/// pass's start would leave every instance after the first with nothing left to
/// wait with — while charging a sleep what it asked for rather than what it took
/// bounds nothing at all on a loaded machine. It is one budget for the whole
/// pass rather than one per instance, so a stalled audio thread costs the exit
/// the same whether one plugin is loaded or thirty.
const SCHEDULER_RELEASE_BUDGET: Duration = Duration::from_millis(500);

/// Poll interval while waiting for that release.
const SCHEDULER_RELEASE_POLL: Duration = Duration::from_millis(2);

/// The deadline the shell gives this whole cascade before it stops waiting and
/// exits the process anyway (`SHUTDOWN_DEADLINE_MS` in `electron/shutdown.ts`).
///
/// Mirrored here as a bound, not as a schedule: nothing in the cascade may
/// approach it, because reaching it means the graceful path was abandoned and
/// every plugin still waiting is killed mid-flight — the outcome this module
/// exists to prevent.
pub(crate) const SHELL_FORCE_EXIT_DEADLINE: Duration = Duration::from_millis(5_000);

const _: () = assert!(
    SCHEDULER_RELEASE_BUDGET.as_millis() * 4 <= SHELL_FORCE_EXIT_DEADLINE.as_millis(),
    "the waiting budget must stay a small fraction of the shell's force-exit deadline"
);

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
    /// Live instances left standing, one entry each: a name when the runtime
    /// was still held elsewhere as the waiting budget ran out, a message when a
    /// whole store was busy and could not be read for the names in it. Their
    /// teardown did *not* run here.
    pub abandoned_instances: Vec<String>,
    /// Runtimes still sitting in the retirement vec when the pass gave up,
    /// including every abandoned instance above — they are retained there
    /// rather than left for a background thread to free. Non-zero means the
    /// terminal reclamation point was not reached for that many plugins.
    pub unreclaimed_retirements: usize,
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

    // A quit that has already lost its windows has also lost the shell thread
    // they lived on, and `NoWindowHost` says so: what is left of the cascade
    // runs here, on the only thread there is.
    let editor_thread = windows.unwrap_or(&NoWindowHost);

    let mut report = ShutdownReport::default();
    match close_every_plugin_gui(windows, app_state) {
        Ok(gui_report) => {
            report.closed_editors = gui_report.closed_instance_ids;
            report.editors_that_refused = gui_report.errors;
        }
        Err(error) => report.editor_close_error = Some(error),
    }

    // Deliberately after the close pass and outside the match: a close that
    // could not run is exactly the case where reclamation still matters.
    app_state.sweep_retired_engine_plugins();

    destroy_live_plugin_instances(app_state, editor_thread, &mut report);

    report
}

/// Run every live instance's own termination sequence, on this thread, before
/// the process goes away.
///
/// This pass — not a `Drop` on some later teardown that never comes — is what
/// gives a plugin binary the termination its format specifies. It takes no
/// plugin control lock of its own: a runtime is freed only once nothing else
/// holds it, so there is no lock here for the close pass that precedes it, or a
/// watcher thread, to be waiting on.
///
/// Known residual window, deliberately left open: this pass takes neither the
/// plugin runtime gate nor a per-instance lifecycle lock, so a `load_plugin`
/// already in flight when the shell begins quitting can insert its instance
/// after the drain and go untorn-down and unreported. Taking the runtime gate's
/// write side would close it, but that gate is `async` and this cascade runs
/// synchronously on the shell's JS thread — blocking there is what a load's own
/// completion needs, so the acquisition could wedge the graceful exit into the
/// shell's force-exit instead. The window is as wide as whatever remains of an
/// in-flight `load_plugin` — the tens to hundreds of milliseconds a plugin takes
/// to instantiate and activate — not an instant, and its cost is that one plugin
/// missing the teardown this pass exists to give it. The shell closes plugin
/// IPC admission before calling this cascade (#2977); anything already past
/// that gate when quit began is the only residual window.
///
/// It also takes no store the shell's UI thread would have to wait for. The
/// close pass ahead of it already refuses a busy store rather than parking, and
/// a pass that then parked on that same store would put the freeze back one
/// step later — with the editor hops behind it burning their own deadlines
/// against a pump only this thread can run.
fn destroy_live_plugin_instances(
    app_state: &AppState,
    editor_thread: &dyn PluginWindowHost,
    report: &mut ShutdownReport,
) {
    let instances = app_state.take_live_plugin_instances(editor_thread);
    report
        .abandoned_instances
        .extend(instances.left_in_a_busy_store);

    // Command-owned instances are owned outright, so this drop *is* their
    // teardown.
    report.destroyed_instances += instances.command_owned.len();
    drop(instances.command_owned);

    let runtimes = remove_runtimes_from_scheduler(app_state, instances.engine_owned);
    let retired = retire_for_reclamation(app_state, runtimes);
    reclaim_until_waiting_budget_is_spent(app_state);
    record_reclamation(app_state, retired, report);
}

/// One runtime handed to the retirement vec, and the name to report it under if
/// it never comes back out.
struct RetiredForTeardown {
    name: String,
    runtime: Weak<SharedHostedPlugin>,
}

/// Queue every engine-owned runtime's removal from the audio graph, and hand
/// the runtimes back.
///
/// Removal is what makes the scheduler release its own `Arc`, and that release
/// is the acknowledgment the reclamation below waits for.
fn remove_runtimes_from_scheduler(
    app_state: &AppState,
    instances: Vec<EnginePluginInstanceData>,
) -> Vec<Arc<SharedHostedPlugin>> {
    let mut engine = locked_or_poisoned(&app_state.engine);

    instances
        .into_iter()
        .map(|instance| {
            if let Some(engine) = engine.as_mut() {
                report_refused_scheduler_removal(
                    engine.remove_plugin(instance.engine_plugin_id),
                    &instance.name,
                );
            }
            instance.runtime
        })
        .collect()
}

/// A removal the engine would not take is diagnostic, not fatal: the runtime is
/// retired either way, so it stays this process's to free rather than the
/// scheduler's, and the report names it if the wait expires. Swallowing the
/// refusal silently would leave the one case that produces an abandoned
/// instance — the scheduler keeping its `Arc` forever — with no trace at all.
fn report_refused_scheduler_removal(removal: Result<(), String>, plugin_name: &str) {
    if let Err(error) = removal {
        eprintln!("[Shutdown] scheduler removal refused for '{plugin_name}': {error}");
    }
}

/// Hand every runtime to the retirement vec, and let go of the pass's own
/// reference only after that.
///
/// Retention is what keeps the final drop on a swept command path — this
/// cascade, or a later `load_plugin` / `unload_plugin` sweep, all of them
/// control paths that may call into a plugin. Dropping the pass's `Arc` while
/// the scheduler — or the host-request or latency watcher — still holds one
/// makes *that* thread the final owner instead, and it would then run
/// `gui.destroy`, `deactivate`, `destroy` and the entry's `deinit`, every one of
/// them main-thread work in CLAP, with the same affinity for VST3's `terminate`.
/// `unload_plugin` retains before it lets go for exactly this reason.
fn retire_for_reclamation(
    app_state: &AppState,
    runtimes: Vec<Arc<SharedHostedPlugin>>,
) -> Vec<RetiredForTeardown> {
    runtimes
        .into_iter()
        .map(|runtime| {
            runtime.retire();
            let retired = RetiredForTeardown {
                name: runtime.name().to_string(),
                runtime: Arc::downgrade(&runtime),
            };
            app_state.retain_retired_engine_plugin(runtime);
            retired
        })
        .collect()
}

/// Sweep the retirement vec until it is empty or the waiting budget is spent.
///
/// Sweeping rather than dropping directly is what runs each plugin's teardown
/// here, on this thread, with the retirement mutex free. The loop sweeps once
/// more after every wait, so a runtime the scheduler releases mid-pass — an
/// unload seconds before the quit, say — still reaches the reclamation point
/// instead of falling past it.
///
/// Waiting costs the budget plus at most one poll's overshoot, whatever the load
/// on the machine, because every sleep is charged what it measured. Teardown
/// inside a sweep is not waiting and is not charged, so it is bounded by the
/// plugins themselves and by the shell's force-exit behind them.
fn reclaim_until_waiting_budget_is_spent(app_state: &AppState) {
    let mut remaining_budget = SCHEDULER_RELEASE_BUDGET;

    loop {
        app_state.sweep_retired_engine_plugins();

        // The whole vec, not just this pass's own entries: waiting on those
        // alone would stop watching the retirement an unload left behind
        // moments before the quit, and giving that one its last sweep is half
        // the point of waiting at all. The trade is that a retirement the
        // scheduler will never release costs the full budget — including on a
        // second `shutdown()`, which finds nothing new to do and waits anyway.
        // That is an abnormal exit already, and the budget is a tenth of the
        // shell's force-exit deadline, so it buys the ordinary case its sweep.
        if retirement_count(app_state) == 0 || remaining_budget.is_zero() {
            return;
        }

        remaining_budget = remaining_budget.saturating_sub(sleep_one_poll(remaining_budget));
    }
}

/// Sleep one poll interval, and report how long that actually took.
///
/// The measurement is the point. `thread::sleep` guarantees a floor, never a
/// ceiling, and on a loaded machine a 2 ms request comes back several times
/// later; charging the budget the *requested* interval instead makes the loop
/// run its full iteration count whatever each one really cost, so the wall
/// clock the budget exists to bound grows without limit — seconds against a
/// half-second budget, with the shell's force-exit as the only thing left
/// stopping it.
fn sleep_one_poll(remaining_budget: Duration) -> Duration {
    let poll = SCHEDULER_RELEASE_POLL.min(remaining_budget);
    let started = Instant::now();
    thread::sleep(poll);
    started.elapsed()
}

fn record_reclamation(
    app_state: &AppState,
    retired: Vec<RetiredForTeardown>,
    report: &mut ShutdownReport,
) {
    for instance in retired {
        // A dead `Weak` is the teardown itself having run: the sweep is the only
        // thing that could have freed the runtime.
        if instance.runtime.strong_count() == 0 {
            report.destroyed_instances += 1;
            continue;
        }

        report.abandoned_instances.push(instance.name);
    }

    report.unreclaimed_retirements = retirement_count(app_state);
}

fn retirement_count(app_state: &AppState) -> usize {
    locked_or_poisoned(&app_state.retired_engine_plugins).len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::plugin_window::{NoWindowHost, PluginEditorWindow};
    use daw_engine::timeline::DeviceKind;
    use daw_plugin_host::ProcessingGate;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc, Mutex};

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

    /// The default: this fake has no thread of its own, so editor calls run on
    /// whichever thread the cascade is already on.
    impl crate::host::ui_thread::UiThread for OrderRecordingHost {}

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
                    chain_kind: DeviceKind::Effect,
                    parameter_events: None,
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
                crate::state::PluginInstanceData::dormant_fixture(
                    daw_plugin_host::ClapWrapper::new_engine_owned_command_fixture(
                        "Command Fixture",
                        Vec::new(),
                        false,
                    )
                    .into(),
                ),
            );
    }

    /// A second owner of a live instance's runtime, standing in for the
    /// scheduler slot or a watcher thread.
    fn engine_runtime(state: &AppState, instance_id: &str) -> Arc<SharedHostedPlugin> {
        state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available")
            .get(instance_id)
            .map(|instance| Arc::clone(&instance.runtime))
            .expect("the fixture instance should be in the store")
    }

    fn retirement_vec_holds(state: &AppState, runtime: &Arc<SharedHostedPlugin>) -> bool {
        state
            .retired_engine_plugins
            .lock()
            .expect("retirement lock should be available")
            .iter()
            .any(|retired| Arc::ptr_eq(retired, runtime))
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
    /// terminated here: freeing it would free nothing while a clone survives.
    /// The pass must say so instead of claiming a teardown that never ran, must
    /// leave the runtime retired rather than let the other owner become its
    /// last — the plugin's teardown would then run on that thread — and must
    /// not spend the shell's exit deadline waiting.
    #[test]
    fn a_runtime_something_else_still_holds_is_reported_rather_than_claimed() {
        let state = AppState::default();
        let processing = insert_live_engine_plugin(&state, "engine-instance");
        let scheduler_reference = engine_runtime(&state, "engine-instance");

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
            2,
            "the runtime must be left retained, so this process — not the other owner — frees it"
        );
        assert!(
            retirement_vec_holds(&state, &scheduler_reference),
            "an abandoned runtime belongs in the retirement vec, not in a background thread's hands"
        );
        assert_eq!(
            report.unreclaimed_retirements, 1,
            "the report must say the reclamation point was not reached"
        );
        // Bounded against the shell's own force-exit rather than against the
        // budget: `elapsed < BUDGET * 4` reduces to `BUDGET < 4 * BUDGET` and
        // holds for any budget at all, including one that blows the deadline.
        assert!(
            elapsed < SHELL_FORCE_EXIT_DEADLINE / 4,
            "an abandoned instance must cost a fraction of the shell's force-exit deadline, took {elapsed:?}"
        );
    }

    /// The cascade runs synchronously on the shell's UI thread, and a worker
    /// closing an editor holds the command-owned store across a call that needs
    /// that thread to run. Parking on the store there waits for this thread, and
    /// the only way out is the force-exit that kills every plugin mid-flight.
    ///
    /// The cascade runs on its own thread here so a pass that parks fails the
    /// wait instead of hanging the test run.
    #[test]
    fn the_teardown_pass_refuses_a_command_owned_store_the_ui_thread_cannot_take() {
        let state = Arc::new(AppState::default());
        insert_command_owned_plugin(&state, "command-instance");
        let held = state
            .plugins
            .lock()
            .expect("plugins lock should be available");

        let (reported, report) = mpsc::channel();
        let cascade_state = Arc::clone(&state);
        thread::spawn(move || {
            let _ = reported.send(shutdown(
                &CollabState::default(),
                &cascade_state,
                Some(&NoWindowHost),
            ));
        });

        let report = report
            .recv_timeout(SHELL_FORCE_EXIT_DEADLINE)
            .expect("the cascade must not park on a store the UI thread itself has to release");

        assert_eq!(
            report.destroyed_instances, 0,
            "an instance the pass never took must not be counted as torn down"
        );
        assert_eq!(
            report.abandoned_instances,
            ["Command-owned plugin instances were busy; they were not torn down".to_string()],
            "a store the pass could not take must be named in the report"
        );
        assert_eq!(
            held.len(),
            1,
            "the instances must be left in the store rather than half-taken"
        );
    }

    /// Time the pass spends blocked — on a contended store lock, or inside one
    /// plugin's own unbounded teardown — must not come out of the waiting
    /// budget. A clock started when the pass began would let the first slow
    /// thing spend the whole allowance and abandon every instance behind it.
    ///
    /// The contended engine lock stands in for that slow thing: the pass takes
    /// it after the drain and no earlier step touches it, so the delay lands
    /// inside the pass and outlasts its entire budget without the pass sleeping
    /// once.
    #[test]
    fn time_the_pass_spends_not_waiting_does_not_spend_the_waiting_budget() {
        let state = Arc::new(AppState::default());
        let processing = insert_live_engine_plugin(&state, "engine-instance");
        let scheduler_reference = engine_runtime(&state, "engine-instance");
        let blocked_for = SCHEDULER_RELEASE_BUDGET + Duration::from_millis(100);

        let blocking_state = Arc::clone(&state);
        let blocker = thread::spawn(move || {
            let engine = blocking_state
                .engine
                .lock()
                .expect("engine lock should be available");
            thread::sleep(blocked_for);
            drop(engine);
        });
        // Let the blocker take the lock before the cascade reaches for it.
        thread::sleep(Duration::from_millis(20));

        let release = thread::spawn(move || {
            thread::sleep(blocked_for + Duration::from_millis(50));
            drop(scheduler_reference);
        });

        let report = shutdown(&CollabState::default(), &state, Some(&NoWindowHost));
        blocker.join().expect("the blocking thread should finish");
        release.join().expect("the releasing thread should finish");

        assert_eq!(
            processing.off_audio_thread_stops(),
            1,
            "the instance must still have a full budget to wait with once the pass is unblocked"
        );
        assert_eq!(report.destroyed_instances, 1);
        assert!(report.abandoned_instances.is_empty());
    }

    /// The retirement vec's reclamation point has to stay terminal. A runtime
    /// the scheduler releases *during* the teardown pass — an unload moments
    /// before the quit — is past the cascade's own sweep, so the pass has to
    /// sweep as it waits or that plugin's `destroy` never runs.
    ///
    /// Sweeping *as* it waits, specifically: a pass that slept its whole budget
    /// and swept once at the end would reclaim this runtime too, and quit a
    /// half-second later than it had any reason to. The elapsed bound is what
    /// separates the two.
    #[test]
    fn a_runtime_released_during_the_pass_is_still_reclaimed() {
        let state = Arc::new(AppState::default());
        let processing = insert_live_engine_plugin(&state, "engine-instance");
        let scheduler_reference = engine_runtime(&state, "engine-instance");

        let releasing_state = Arc::clone(&state);
        let release = thread::spawn(move || {
            // Long enough that the first sweep cannot see the release, short
            // enough to land inside the waiting budget — the scheduler
            // acknowledging a queued removal a few callbacks late.
            thread::sleep(Duration::from_millis(50));
            drop(scheduler_reference);
            drop(releasing_state);
        });

        let started = Instant::now();
        let report = shutdown(&CollabState::default(), &state, Some(&NoWindowHost));
        let elapsed = started.elapsed();
        release.join().expect("the releasing thread should finish");

        assert_eq!(
            processing.off_audio_thread_stops(),
            1,
            "the release must be picked up by a later sweep and the teardown run here"
        );
        assert_eq!(report.destroyed_instances, 1);
        assert!(report.abandoned_instances.is_empty());
        assert_eq!(report.unreclaimed_retirements, 0);
        assert!(
            elapsed < SCHEDULER_RELEASE_BUDGET / 2,
            "the pass must return on the release at 50ms, not sleep out its budget first, took {elapsed:?}"
        );
    }
}
