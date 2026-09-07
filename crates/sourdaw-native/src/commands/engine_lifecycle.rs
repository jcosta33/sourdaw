//! Emptying the engine slot when the output stream behind it is gone.
//!
//! An `EngineHandle` outlives its output stream. A renegotiated Bluetooth
//! headset or a device change leaves the slot holding a handle whose render
//! callback has stopped, and `apply_graph_commands` then refuses every batch
//! with `engine-not-rendering:` — correctly, because nothing pushed onto that
//! engine's ring will ever be heard. Nothing used to empty the slot again:
//! `start_into_empty_slot` fills it once and no path took a handle back out,
//! so the session stayed deaf until the app was relaunched.
//!
//! ## Why the rebuild is not inside the engine
//!
//! The scheduler lives inside the render closure the stream owns, and the
//! whole graph — buffer sizes, delay lines, every plugin's activation — is
//! built for the rate the device opened at. A renegotiated headset commonly
//! comes back at another rate, so restarting the stream under a graph built
//! for the old one would desynchronise the tap, the render pass and every
//! take stamped against it. Retiring the handle and letting the next batch
//! boot a fresh engine on the current default device is the only route that
//! rebuilds all three together, and it is where every rate-dependent
//! decision is made from scratch anyway.
//!
//! ## What a retire costs
//!
//! Hosted plugin instances do not survive it. A record in `engine_plugins`
//! holds its runtime as an `Arc<SharedHostedPlugin>` shared with a scheduler
//! that is going away, activated at the dead device's rate, and the dormant
//! record `attach_dormant_plugins` re-attaches from
//! (`state::PluginInstanceData`) carries an owned `HostedRuntime` and nothing
//! naming the plugin binary. So there is no dormant record to write here: the
//! runtimes are retired for reclamation the way the exit cascade retires
//! them, and re-instantiating an instance is the load path's business, not
//! this command's. Crumbs instances do survive, because their engine side is
//! rebuilt from command-side state (`crumbs::detach_from_retired_engine`).
//! What the reply carries instead is which engine-owned records were
//! drained — `retiredInstanceIds`, the UI instance ids, ascending — so the
//! renderer knows exactly which plugins it must reload itself.

use std::time::Duration;

use daw_engine::EngineHandle;
use daw_plugin_host::AudioPlugin;
use serde::{Deserialize, Serialize};

use crate::host::native_bridge::SharedHostedPlugin;
use crate::host::plugin_window::PluginWindowHost;
use crate::host::ui_thread::lend_on_ui_thread;
use crate::state::{locked_or_poisoned, AppState, EnginePluginInstanceData};

use super::crumbs::{self, CrumbsState};
use super::plugins::{editor_thread, hold_plugin_runtime_gate, remove_plugin_window};

/// How long an editor close may hold the runtime's control seam, the same
/// budget the unload path gives its own close.
const EDITOR_CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

/// What the retire found, and did.
///
/// Kebab-case on the wire because these are read as tokens by
/// `src/modules/AudioEngine/repositories/engineLifecycle/retireNativeEngine.ts`,
/// which is hand-maintained against this enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RetireOutcome {
    /// The slot held an engine that was not rendering. It is empty now, and
    /// the next `apply_graph_commands` boots a fresh one.
    Retired,
    /// The slot was already empty. Nothing to do — the next batch was going
    /// to boot an engine anyway.
    NoEngine,
    /// The engine is still rendering, so the slot is untouched. A caller that
    /// misread a transient fault as a lost stream gets its session back
    /// rather than a needless restart.
    Rendering,
}

/// The reply `retire_native_engine` answers with. Never an error: every state
/// the slot can be in has an outcome, and a caller deciding whether to re-arm
/// must not have to tell a refusal apart from a transport failure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetireNativeEngineResult {
    pub outcome: RetireOutcome,
    /// UI instance ids of every engine-owned plugin record the retire
    /// drained, ascending for determinism. There is no dormant record left
    /// behind for these (see the module doc), so this is how the renderer
    /// knows which plugins it must reload itself. Empty for `no-engine` and
    /// `rendering`, since neither one drains anything.
    pub retired_instance_ids: Vec<String>,
}

impl RetireNativeEngineResult {
    fn of(outcome: RetireOutcome, retired_instance_ids: Vec<String>) -> Self {
        Self {
            outcome,
            retired_instance_ids,
        }
    }
}

/// Take a lost engine out of its slot, leaving the control side ready for the
/// one the next batch boots.
///
/// The order matters and is stated rather than implied:
///
/// 1. the plugin-runtime gate in read mode, then the graph registry, and under
///    those two guards only the takes: the `is_rendering` verdict and the
///    handle's removal from the slot, the engine-owned plugin records out of
///    `engine_plugins`, every attached crumbs instance back to dormant, and
///    the registry's own reset. [`drain_the_lost_engine`] is that whole
///    section, so returning from it is what releases both guards;
/// 2. the registry is what makes that section atomic against the batch path,
///    because `apply_graph_commands` holds it across `start_into_empty_slot`,
///    its crumbs attach and the batch itself. Without it a batch already past
///    its own admission would boot a replacement engine and register crumbs
///    slots on it while this retire was still draining, and the reset would
///    then throw away the *new* engine's ledger. The gate is what keeps a
///    concurrent load or unload out of a runtime this drain is about to take;
/// 3. outside both guards, on the records the drain took: each one's editor
///    close, `begin_unload`, `retire`, and its retention. Every one of those
///    reaches third-party code through `with_unload_control`, whose
///    per-instance non-RT control wait is unbounded — an `open_gui` in flight
///    holds that lock for however long the editor takes to build. Under the
///    registry that wait would park every `apply_graph_commands`,
///    `create_crumbs` and `set_transport_maps`, the batch booting the
///    replacement engine among them, and under the fair gate it would make a
///    queued writer wait behind it as well. Nothing races these records once
///    they are out: `engine_plugins` no longer names them, so no batch can map
///    a device onto one, and the registry is reset, so a batch that fills the
///    empty slot boots an engine this pass never touches;
/// 4. the handle's drop, after that loop and with both guards long gone,
///    because the drop waits on the audio-owner thread and a lock held across
///    it would park every other claim for the shutdown timeout;
/// 5. one sweep, after that drop, because the scheduler releasing its `Arc` is
///    what makes a retired runtime free-able.
///
/// The lock order is gate -> registry -> (engine | engine_plugins |
/// instances), every leg of which the crate already establishes: `graph` takes
/// registry then engine, `crumbs::create_crumbs` takes registry then instances
/// then engine, and `plugins::release_then_retire_engine_plugin` takes registry
/// then engine under the same gate a keyed unload holds. One site takes the two
/// the other way round: `apply_graph_commands` holds the registry and then
/// calls `plugins::attach_dormant_plugins`, which takes the gate. That
/// inversion closes no cycle only because the acquisition there is `try_read`
/// — it refuses, and leaves the instance dormant for the next batch, rather
/// than waiting on a gate whose holder may be waiting for the registry.
/// Nothing here runs on the audio thread.
pub async fn retire_native_engine(
    state: &AppState,
    crumbs: &CrumbsState,
    windows_host: &dyn PluginWindowHost,
) -> RetireNativeEngineResult {
    let (retired_engine, engine_owned_plugins) = match drain_the_lost_engine(state, crumbs).await {
        DrainedEngine::NothingToRetire(outcome) => {
            return RetireNativeEngineResult::of(outcome, Vec::new())
        }
        DrainedEngine::Drained {
            handle,
            engine_owned_plugins,
        } => (handle, engine_owned_plugins),
    };

    let retired_instance_ids =
        retire_engine_owned_plugins(state, engine_owned_plugins, Some(windows_host));

    drop(retired_engine);

    // The dead scheduler releases its own `Arc` when the owner thread drops
    // it behind the handle above, which may or may not have happened by now.
    // A runtime still held simply survives this sweep and is freed by the
    // next one, exactly as `sweep_retired_engine_plugins` intends.
    state.sweep_retired_engine_plugins();

    RetireNativeEngineResult::of(RetireOutcome::Retired, retired_instance_ids)
}

/// What the guarded section handed back: the drained handle and the records it
/// took out of `engine_plugins`, both for the caller to finish with every lock
/// released, or the outcome that made the retire a no-op.
enum DrainedEngine {
    Drained {
        handle: EngineHandle,
        engine_owned_plugins: Vec<(String, EnginePluginInstanceData)>,
    },
    NothingToRetire(RetireOutcome),
}

/// Everything the retire does while it holds the gate and the registry: the
/// verdict, and the takes that follow it.
///
/// A function of its own so that both guards are released by returning, which
/// is what keeps every plugin call, the handle's drop and the sweep out of them
/// — see [`retire_native_engine`]'s own doc for the order and the reasons.
async fn drain_the_lost_engine(state: &AppState, crumbs: &CrumbsState) -> DrainedEngine {
    let _runtime_guard = hold_plugin_runtime_gate().await;
    let mut registry = locked_or_poisoned(&state.graph);

    let handle = {
        let mut slot = locked_or_poisoned(&state.engine);
        let Some(engine) = slot.as_ref() else {
            return DrainedEngine::NothingToRetire(RetireOutcome::NoEngine);
        };
        // The watchdog's own verdict, the same one `apply_graph_commands`
        // admits a batch on: a `DeviceChanged` reroute the callback survived
        // leaves this true, and retiring on the *kind* of the last fault
        // would tear down a session that never stopped sounding.
        if engine.is_rendering() {
            return DrainedEngine::NothingToRetire(RetireOutcome::Rendering);
        }
        let Some(handle) = slot.take() else {
            return DrainedEngine::NothingToRetire(RetireOutcome::NoEngine);
        };
        handle
    };

    let engine_owned_plugins = take_engine_owned_plugins(state);
    crumbs::detach_from_retired_engine(crumbs);
    registry.reset_for_engine_restart();

    DrainedEngine::Drained {
        handle,
        engine_owned_plugins,
    }
}

/// Empty `engine_plugins`, handing its records to the caller.
///
/// The take is the whole of what the drain owes these records: once they are
/// out of the map no batch can map a device onto one, so their retirement runs
/// with every guard released.
fn take_engine_owned_plugins(state: &AppState) -> Vec<(String, EnginePluginInstanceData)> {
    let mut engine_plugins = locked_or_poisoned(&state.engine_plugins);
    std::mem::take(&mut *engine_plugins).into_iter().collect()
}

/// Close each drained instance's editor, then hand its runtime to the
/// retirement vec.
///
/// Runs on the records [`drain_the_lost_engine`] already took, with the gate,
/// the registry and every state lock released, because each call below reaches
/// third-party code behind a per-instance control wait of unbounded length.
///
/// The editor close comes first, for the reason `shutdown.rs` states as its
/// own step ordering: the final drop of a retired runtime runs the format's
/// teardown, and for an instance whose editor is still open that teardown
/// reaches CLAP `gui.destroy` and VST3 `removed` — thread-affine calls that
/// would then run on whichever worker happened to hold the last `Arc`, which
/// on this path is the napi worker rather than the shell's UI thread.
/// [`remove_plugin_window`] follows for the same reason it follows in
/// `unload_plugin_runtime`: a record left in `plugin_windows` names a window
/// for an instance the renderer has been told to reload.
///
/// Then `begin_unload`, `retire`, retain — the order `shutdown.rs` keeps
/// (`take_live_plugin_instances`, `retire_for_reclamation`): the withdrawal
/// of the intent to process comes first so the stop is never missed, and the
/// retention comes before this pass lets go of its own reference, so a
/// scheduler or watcher thread can never become the final owner and run CLAP
/// `destroy` on itself.
///
/// No `engine.remove_plugin`: the removal is a command onto a ring nothing
/// drains, so it would pop nothing. The scheduler's own `Arc` is released
/// when the owner thread drops the scheduler behind the handle instead.
///
/// Returns the drained records' UI instance ids, sorted ascending: the
/// renderer has no other way to learn which plugins it must reload.
fn retire_engine_owned_plugins(
    state: &AppState,
    instances: Vec<(String, EnginePluginInstanceData)>,
    windows_host: Option<&dyn PluginWindowHost>,
) -> Vec<String> {
    let mut retired_instance_ids = Vec::with_capacity(instances.len());
    for (instance_id, instance) in instances {
        close_editor_before_retiring(&instance_id, &instance.runtime, windows_host, state);
        instance.runtime.begin_unload();
        instance.runtime.retire();
        state.retain_retired_engine_plugin(instance.runtime);
        retired_instance_ids.push(instance_id);
    }
    retired_instance_ids.sort();
    retired_instance_ids
}

/// Give one retiring instance's editor its close on the shell's UI thread, and
/// forget the window that held it.
///
/// The same pair `unload_plugin_runtime` performs, reached through the same
/// helpers rather than re-derived: `with_unload_control` takes the runtime's
/// control seam without asking the lifecycle for permission — the instance is
/// on its way out — and [`lend_on_ui_thread`] is what carries the call to the
/// thread the format binds it to. A refusal is logged and the retire carries
/// on, because a third-party editor must not be able to keep a dead engine in
/// its slot.
fn close_editor_before_retiring(
    instance_id: &str,
    runtime: &SharedHostedPlugin,
    windows_host: Option<&dyn PluginWindowHost>,
    state: &AppState,
) {
    if let Err(error) = runtime.with_unload_control(EDITOR_CLOSE_TIMEOUT, |plugin| {
        lend_on_ui_thread(editor_thread(windows_host), plugin, |plugin| {
            plugin.close_gui()
        })
    }) {
        eprintln!("[Plugin] GUI cleanup failed during engine retire: {error}");
    }

    remove_plugin_window(instance_id, windows_host, state);
}

#[cfg(test)]
mod tests {
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread::ThreadId;

    use daw_engine::engine_events::StreamErrorKind;
    use daw_engine::scheduler::GraphCommand;
    use daw_plugin_host::ClapWrapper;
    use serde_json::{json, Value};

    use crate::block_on_test;
    use crate::commands::graph::apply_graph_commands;
    use crate::commands::plugins::hold_plugin_runtime_gate_exclusively;
    use crate::host::native_bridge::SharedHostedPlugin;
    use crate::host::plugin_window::{NoWindowHost, PluginEditorWindow};
    use crate::host::ui_thread::UiThread;
    use crate::state::{EnginePluginInstanceData, PluginInstanceData};

    use super::*;

    /// How long a contention test lets the retire thread try to take a guard
    /// this thread is holding.
    ///
    /// Only a *negative* claim rests on it — that the engine is still in its
    /// slot — so a machine too loaded to schedule the retire thread within the
    /// window weakens the test rather than failing it, and each test's join
    /// proves the thread ran at all.
    const CONTENTION_WINDOW: Duration = Duration::from_millis(50);

    /// A window host that records the labels it was asked to destroy.
    ///
    /// Runs editor calls inline — the default [`UiThread`], the same answer
    /// [`NoWindowHost`] gives — because a test thread is the only thread there
    /// is here. What it adds over `NoWindowHost` is the record.
    #[derive(Default)]
    struct DestroyRecordingWindowHost {
        destroyed: Mutex<Vec<String>>,
    }

    impl DestroyRecordingWindowHost {
        fn destroyed_labels(&self) -> Vec<String> {
            self.destroyed
                .lock()
                .expect("the destroy log is readable")
                .clone()
        }
    }

    impl UiThread for DestroyRecordingWindowHost {}

    impl PluginWindowHost for DestroyRecordingWindowHost {
        fn window_exists(&self, _label: &str) -> bool {
            false
        }

        fn create_editor_window(
            &self,
            _label: &str,
            _title: &str,
            _instance_id: &str,
        ) -> Result<Box<dyn PluginEditorWindow>, String> {
            Err("This host cannot create plugin editor windows".to_string())
        }

        fn destroy_window(&self, label: &str) {
            self.destroyed
                .lock()
                .expect("the destroy log is writable")
                .push(label.to_string());
        }

        fn hide_window(&self, _label: &str) {}

        fn show_window(&self, _label: &str) {}
    }

    /// A batch that carries no commands at all: enough to fence, attach every
    /// dormant instance and report a number, and nothing else. What these
    /// tests are about is the state a retire left behind, never the mapping.
    fn empty_batch() -> Value {
        json!({ "schemaVersion": 1, "commands": [] })
    }

    /// A batch that builds one strip, so the registry ends up holding
    /// topology for the retire to clear.
    fn one_strip_batch() -> Value {
        json!({
            "schemaVersion": 1,
            "commands": [{
                "kind": "create-track-strip",
                "trackId": "t1",
                "name": "T",
                "state": {
                    "gain": 1.0,
                    "pan": 0,
                    "muted": false,
                    "soloGated": false,
                    "vcaMultiplier": 1,
                },
                "devices": [],
                "honorMuted": true,
                "contributesAudio": true,
            }],
        })
    }

    /// Put a capture engine in the slot. Filling it first is what keeps the
    /// lazy bootstrap in `apply_graph_commands` from opening a real device.
    fn fill_slot_with_capture_engine(state: &AppState) -> rtrb::Consumer<GraphCommand> {
        let (engine, commands, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        commands
    }

    /// Tell the engine in the slot its render callback has stopped, the way a
    /// lost headset does.
    fn stall_the_engine_in_the_slot(state: &AppState) {
        state
            .engine
            .lock()
            .expect("the engine slot is readable")
            .as_ref()
            .expect("the slot holds an engine to stall")
            .mark_render_stalled(Some(StreamErrorKind::DeviceChanged));
    }

    fn slot_holds_an_engine(state: &AppState) -> bool {
        state
            .engine
            .lock()
            .expect("the engine slot is readable")
            .is_some()
    }

    fn engine_owned_runtime(name: &str) -> Arc<SharedHostedPlugin> {
        Arc::new(SharedHostedPlugin::new(
            ClapWrapper::new_engine_owned_command_fixture(name, Vec::new(), false).into(),
        ))
    }

    fn insert_engine_owned_plugin(
        state: &AppState,
        instance_id: &str,
        runtime: Arc<SharedHostedPlugin>,
    ) {
        state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .insert(
                instance_id.to_string(),
                EnginePluginInstanceData {
                    engine_plugin_id: 41,
                    runtime,
                    name: "Retire Fixture".to_string(),
                    parameters: Vec::new(),
                    has_gui: false,
                    chain_kind: daw_engine::timeline::DeviceKind::Effect,
                    parameter_events: None,
                },
            );
    }

    fn retired_runtime_count(state: &AppState) -> usize {
        state
            .retired_engine_plugins
            .lock()
            .expect("retirement lock")
            .len()
    }

    /// An engine-owned runtime whose editor is already open, plus the log
    /// every editor lifecycle call on it writes its thread to.
    ///
    /// The log is taken from the wrapper before the access seam closes over
    /// it, and emptied of the open's own entry, so anything in it afterwards
    /// is a call the retire made.
    fn engine_owned_runtime_with_an_open_editor(
        name: &str,
    ) -> (Arc<SharedHostedPlugin>, Arc<Mutex<Vec<ThreadId>>>) {
        let mut wrapper = ClapWrapper::new_engine_owned_command_fixture(name, Vec::new(), true);
        wrapper
            .open_gui(std::ptr::null_mut())
            .expect("the fixture's editor opens");
        let editor_calls = wrapper
            .engine_owned_command_fixture_gui_threads()
            .expect("the fixture logs its editor calls");
        editor_calls
            .lock()
            .expect("the editor call log is writable")
            .clear();
        (
            Arc::new(SharedHostedPlugin::new(wrapper.into())),
            editor_calls,
        )
    }

    fn retire(
        state: &AppState,
        crumbs: &CrumbsState,
        windows_host: &dyn PluginWindowHost,
    ) -> RetireNativeEngineResult {
        block_on_test(retire_native_engine(state, crumbs, windows_host))
    }

    #[test]
    fn an_empty_slot_reports_no_engine() {
        let state = AppState::default();

        let result = retire(&state, &CrumbsState::default(), &NoWindowHost);

        assert_eq!(
            serde_json::to_value(result).expect("the reply serializes"),
            json!({ "outcome": "no-engine", "retiredInstanceIds": [] }),
            "an empty slot is an outcome, never an error the caller has to read as one"
        );
        assert!(!slot_holds_an_engine(&state));
        assert!(state.plugins.lock().expect("plugins lock").is_empty());
        assert!(state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .is_empty());
    }

    #[test]
    fn a_rendering_engine_keeps_its_slot_and_its_plugins() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        insert_engine_owned_plugin(&state, "engine-instance", engine_owned_runtime("Live"));

        let result = retire(&state, &CrumbsState::default(), &NoWindowHost);

        assert_eq!(
            serde_json::to_value(result).expect("the reply serializes"),
            json!({ "outcome": "rendering", "retiredInstanceIds": [] }),
            "an engine whose callback still runs is not a lost one, and nothing was drained to report"
        );
        assert!(
            slot_holds_an_engine(&state),
            "a rendering engine must be left exactly where it was"
        );
        assert_eq!(
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .len(),
            1,
            "nothing may be retired out from under a session that is still sounding"
        );
        assert_eq!(retired_runtime_count(&state), 0);
    }

    #[test]
    fn a_stalled_engine_leaves_the_slot_empty() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        stall_the_engine_in_the_slot(&state);

        let result = retire(&state, &CrumbsState::default(), &NoWindowHost);

        assert_eq!(
            serde_json::to_value(result).expect("the reply serializes"),
            json!({ "outcome": "retired", "retiredInstanceIds": [] })
        );
        assert!(
            !slot_holds_an_engine(&state),
            "the empty slot is what lets the next batch boot on the current default device"
        );
    }

    #[test]
    fn the_retired_engines_topology_leaves_the_registry() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        let applied = block_on_test(apply_graph_commands(
            one_strip_batch(),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the setup batch resolves");
        assert_eq!(applied["application"], "applied");
        assert!(
            state
                .graph
                .lock()
                .expect("the registry is readable")
                .holds_strip("t1"),
            "the setup batch must actually leave a strip for the retire to clear"
        );

        stall_the_engine_in_the_slot(&state);
        retire(&state, &CrumbsState::default(), &NoWindowHost);

        let registry = state.graph.lock().expect("the registry is readable");
        assert!(
            !registry.holds_strip("t1"),
            "a strip left in the registry would refuse its own id on the next session's batch"
        );
    }

    #[test]
    fn a_retired_engine_plugin_is_freed_only_when_the_scheduler_releases_it() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        let runtime = engine_owned_runtime("Retire Fixture");
        // Standing in for the scheduler's own clone: the audio thread may
        // still be holding the slot that owns it when the retire runs.
        let scheduler_clone = Arc::clone(&runtime);
        insert_engine_owned_plugin(&state, "engine-instance", runtime);
        stall_the_engine_in_the_slot(&state);

        retire(&state, &CrumbsState::default(), &NoWindowHost);

        assert!(
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .is_empty(),
            "a record left behind would map a device onto an effect id the next engine never took"
        );
        assert_eq!(
            retired_runtime_count(&state),
            1,
            "a runtime the scheduler still holds must survive the retire's own sweep"
        );

        drop(scheduler_clone);
        state.sweep_retired_engine_plugins();

        assert_eq!(
            retired_runtime_count(&state),
            0,
            "the release is the acknowledgment the reclamation waits for"
        );
    }

    /// The other half of the sweep contract: with no scheduler clone left, the
    /// retire's own sweep is the reclamation point and there is no later one
    /// on this path.
    #[test]
    fn a_retire_frees_a_runtime_nothing_else_still_holds() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        insert_engine_owned_plugin(
            &state,
            "engine-instance",
            engine_owned_runtime("Retire Fixture"),
        );
        stall_the_engine_in_the_slot(&state);

        retire(&state, &CrumbsState::default(), &NoWindowHost);

        assert_eq!(
            retired_runtime_count(&state),
            0,
            "no other Arc holds this runtime, so the retire's own sweep is what has to free it"
        );
    }

    /// What a retired runtime must report about itself: the intent to process
    /// withdrawn, and the control path closed as *retired* rather than merely
    /// unloading.
    #[test]
    fn a_retired_runtime_stops_wanting_to_process_and_refuses_control_as_retired() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        let runtime = engine_owned_runtime("Retire Fixture");
        // Kept so the sweep cannot free the runtime before it is read.
        let observed = Arc::clone(&runtime);
        insert_engine_owned_plugin(&state, "engine-instance", runtime);
        stall_the_engine_in_the_slot(&state);
        assert!(
            observed.processing_gate().wants_processing(),
            "the fixture starts in the state a loaded plugin reaches: wanted, and processing"
        );

        retire(&state, &CrumbsState::default(), &NoWindowHost);

        assert!(
            !observed.processing_gate().wants_processing(),
            "without the withdrawal the audio thread is never told to leave the processing state"
        );
        assert_eq!(
            observed
                .ensure_public_control_allowed()
                .expect_err("a retired runtime admits no public control"),
            "Engine-owned plugin instance 'Retire Fixture' has been retired",
            "a runtime left merely unloading reads as an operation still in flight, not as one whose instance is gone"
        );
    }

    /// A runtime whose editor is still open must get its `close_gui` here,
    /// on the shell's UI thread. Left to the final drop, the format's teardown
    /// runs `gui.destroy` on whichever worker held the last `Arc`.
    ///
    /// The scheduler's clone is held for the whole test, which is both what a
    /// live audio thread does and what makes the claim discriminating: the
    /// wrapper's own `Drop` closes an editor it still finds open, so a runtime
    /// this test let the sweep free would record the very call whose absence is
    /// the defect.
    #[test]
    fn a_retire_closes_an_open_editor_and_forgets_its_window() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        let (runtime, editor_calls) = engine_owned_runtime_with_an_open_editor("Editor Fixture");
        let _scheduler_clone = Arc::clone(&runtime);
        insert_engine_owned_plugin(&state, "engine-instance", runtime);
        state
            .plugin_windows
            .lock()
            .expect("the window records are writable")
            .insert("engine-instance".to_string(), "plugin-window-1".to_string());
        stall_the_engine_in_the_slot(&state);

        let windows_host = DestroyRecordingWindowHost::default();
        retire(&state, &CrumbsState::default(), &windows_host);

        assert_eq!(
            editor_calls
                .lock()
                .expect("the editor call log is readable")
                .len(),
            1,
            "the editor's close must reach the plugin while the retire still owns the call"
        );
        assert!(
            state
                .plugin_windows
                .lock()
                .expect("the window records are readable")
                .get("engine-instance")
                .is_none(),
            "a record left behind names a window for an instance the renderer was told to reload"
        );
        assert_eq!(
            windows_host.destroyed_labels(),
            vec!["plugin-window-1".to_string()],
            "the shell's window has to go with the editor it held"
        );
    }

    #[test]
    fn a_retire_reports_the_engine_owned_instances_it_drained_in_ascending_order() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        insert_engine_owned_plugin(&state, "b", engine_owned_runtime("Retire Fixture"));
        insert_engine_owned_plugin(&state, "a", engine_owned_runtime("Retire Fixture"));
        stall_the_engine_in_the_slot(&state);

        let result = retire(&state, &CrumbsState::default(), &NoWindowHost);

        assert_eq!(
            result.retired_instance_ids,
            vec!["a".to_string(), "b".to_string()],
            "the renderer reloads exactly the engine-owned records the retire drained, sorted for determinism regardless of insertion order"
        );
    }

    #[test]
    fn retiring_leaves_a_dormant_plugin_for_the_next_engine_to_attach() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        state.plugins.lock().expect("plugins lock").insert(
            "dormant-instance".to_string(),
            PluginInstanceData::dormant_fixture(
                ClapWrapper::new_engine_owned_command_fixture("Dormant", Vec::new(), false).into(),
            ),
        );
        stall_the_engine_in_the_slot(&state);

        retire(&state, &CrumbsState::default(), &NoWindowHost);

        assert!(
            state
                .plugins
                .lock()
                .expect("plugins lock")
                .contains_key("dormant-instance"),
            "an instance still waiting for an engine is exactly what the next bootstrap attaches"
        );
    }

    #[test]
    fn a_crumbs_instance_reattaches_to_the_engine_that_replaces_the_retired_one() {
        let state = AppState::default();
        let crumbs_state = CrumbsState::default();
        let _lost_engine_commands = fill_slot_with_capture_engine(&state);
        block_on_test(crumbs::create_crumbs(
            "instance-1".to_string(),
            &crumbs_state,
            &state,
        ))
        .expect("the instance registers on the engine in the slot");
        assert!(
            crumbs::instance_is_attached(&crumbs_state, "instance-1"),
            "the setup must leave the instance attached, or the retire proves nothing"
        );
        stall_the_engine_in_the_slot(&state);

        retire(&state, &crumbs_state, &NoWindowHost);

        assert!(
            !crumbs::instance_is_attached(&crumbs_state, "instance-1"),
            "an instance left attached holds rings the retired engine's slot side is gone from"
        );

        let mut replacement_commands = fill_slot_with_capture_engine(&state);
        let applied = block_on_test(apply_graph_commands(empty_batch(), &state, &crumbs_state))
            .expect("the batch on the replacing engine resolves");

        assert_eq!(applied["application"], "applied");
        assert!(
            crumbs::instance_is_attached(&crumbs_state, "instance-1"),
            "the first batch on the new engine is what re-registers the instance"
        );
        let mut added_plugins = 0;
        let mut registered_capture_consumers = 0;
        while let Ok(command) = replacement_commands.pop() {
            match command {
                GraphCommand::AddPlugin(..) => added_plugins += 1,
                GraphCommand::RegisterCaptureConsumer(_) => registered_capture_consumers += 1,
                _ => {}
            }
        }
        assert_eq!(
            (added_plugins, registered_capture_consumers),
            (1, 1),
            "the re-registration is the slot plus its capture tap, on the replacing engine's ring"
        );
    }

    #[test]
    fn the_first_batch_on_the_replacing_engine_is_numbered_from_one() {
        let state = AppState::default();
        let _lost_engine_commands = fill_slot_with_capture_engine(&state);
        for _ in 0..5 {
            block_on_test(apply_graph_commands(
                empty_batch(),
                &state,
                &CrumbsState::default(),
            ))
            .expect("the setup batches resolve");
        }
        assert_eq!(
            state
                .graph
                .lock()
                .expect("the registry is readable")
                .fenced_batches(),
            5,
            "the lost engine's ring really did take five fences"
        );
        stall_the_engine_in_the_slot(&state);

        retire(&state, &CrumbsState::default(), &NoWindowHost);
        let _replacement_commands = fill_slot_with_capture_engine(&state);
        let applied = block_on_test(apply_graph_commands(
            empty_batch(),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the batch on the replacing engine resolves");

        assert_eq!(applied["application"], "applied");
        assert_eq!(
            applied["admittedBatch"].as_u64(),
            Some(1),
            "the fence count numbers this engine's ring, and this engine has drained none"
        );
    }

    /// The registry guard is what makes the retire atomic against the batch
    /// path. `apply_graph_commands` holds it across `start_into_empty_slot`,
    /// its crumbs attach and the batch, so while it is held nothing may be
    /// taken out from under it — not the engine handle, and not the
    /// engine-owned records a batch is about to map devices onto.
    ///
    /// Held here from the test thread, which is the batch path's stand-in: the
    /// retire runs on its own thread and must get no further than the registry
    /// until this thread lets go.
    #[test]
    fn a_retire_takes_nothing_while_a_batch_holds_the_registry() {
        let state = AppState::default();
        let crumbs_state = CrumbsState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        insert_engine_owned_plugin(
            &state,
            "engine-instance",
            engine_owned_runtime("Retire Fixture"),
        );
        stall_the_engine_in_the_slot(&state);

        let registry_guard = state.graph.lock().expect("the registry is free");
        let (retire_started, retire_starting) = mpsc::channel();

        let retiring_state = &state;
        let retiring_crumbs = &crumbs_state;
        let result = std::thread::scope(|scope| {
            let retiring = scope.spawn(move || {
                retire_started
                    .send(())
                    .expect("the test thread waits for this");
                retire(retiring_state, retiring_crumbs, &NoWindowHost)
            });

            retire_starting.recv().expect("the retire thread starts");
            std::thread::sleep(CONTENTION_WINDOW);

            assert!(
                slot_holds_an_engine(&state),
                "a retire that takes the handle without the registry lets a batch boot a replacement into the slot it is about to drain"
            );
            assert_eq!(
                state
                    .engine_plugins
                    .lock()
                    .expect("engine_plugins lock")
                    .len(),
                1,
                "the drain must wait too: a batch holding the registry is mapping devices onto these records"
            );

            drop(registry_guard);
            retiring.join().expect("the retire thread finishes")
        });

        assert_eq!(
            result.outcome,
            RetireOutcome::Retired,
            "releasing the registry is what lets the retire through, so it must have run"
        );
        assert!(!slot_holds_an_engine(&state));
        assert!(state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .is_empty());
    }

    /// The plugin-runtime gate is what keeps the retire out of a runtime a
    /// load or an unload is inside. The quit cascade takes it exclusively, and
    /// so does an unload of every instance; this thread stands in for one of
    /// them, holding the gate in that same mode while the retire runs on its
    /// own thread and must get no further than the gate until this thread lets
    /// go.
    #[test]
    fn a_retire_takes_nothing_while_a_load_or_unload_holds_the_gate() {
        let state = AppState::default();
        let crumbs_state = CrumbsState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        insert_engine_owned_plugin(
            &state,
            "engine-instance",
            engine_owned_runtime("Retire Fixture"),
        );
        stall_the_engine_in_the_slot(&state);

        let gate_guard = block_on_test(hold_plugin_runtime_gate_exclusively());
        let (retire_started, retire_starting) = mpsc::channel();

        let retiring_state = &state;
        let retiring_crumbs = &crumbs_state;
        let result = std::thread::scope(|scope| {
            let retiring = scope.spawn(move || {
                retire_started
                    .send(())
                    .expect("the test thread waits for this");
                retire(retiring_state, retiring_crumbs, &NoWindowHost)
            });

            retire_starting.recv().expect("the retire thread starts");
            std::thread::sleep(CONTENTION_WINDOW);

            assert!(
                slot_holds_an_engine(&state),
                "a retire that skips the gate empties the slot while a load or unload is still working on this engine's runtimes"
            );
            assert_eq!(
                state
                    .engine_plugins
                    .lock()
                    .expect("engine_plugins lock")
                    .len(),
                1,
                "the records must wait too: an unload holding the gate is inside one of these very runtimes"
            );

            drop(gate_guard);
            retiring.join().expect("the retire thread finishes")
        });

        assert_eq!(
            result.outcome,
            RetireOutcome::Retired,
            "releasing the gate is what lets the retire through, so it must have run"
        );
        assert!(!slot_holds_an_engine(&state));
        assert!(state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .is_empty());
    }
}
