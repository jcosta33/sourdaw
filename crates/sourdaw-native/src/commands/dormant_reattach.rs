//! The re-attach a transient attach refusal owes (#7368).
//!
//! A plugin loaded before the engine ran is parked dormant and attached by the
//! first graph batch. When a lifecycle lease, a dormant control call or the
//! plugin-runtime gate held it at that moment, the batch could only leave it
//! dormant, and nothing else used to try again: a musician who pressed Play
//! while an editor close held the instance, and edited nothing after, never
//! heard that plugin. The refusal now owes a re-attach
//! (`host::dormant_attach_wake`), and the release of the hold that refused it
//! wakes the worker here, which runs the batch's own attach pass under the
//! batch's own guarantees and tells the renderer what it took.
//!
//! The pass holds the graph registry guard for its whole body, as a batch does,
//! so it can never interleave with one; and it reserves ring room for every
//! instance it counts before the attach pushes onto the ring, as a batch's
//! headroom does. A pass still refused owes again and waits for the next
//! release; an instance unloaded meanwhile is simply not in the map.

use crate::commands::plugins::{attach_dormant_plugins, AttachedPlugin};
use crate::events::{EventSink, EventSinkExt};
use crate::host::dormant_attach_wake::wait_for_owed_reattach;
use crate::state::AppState;
use crate::NativeSingletons;
use serde::Serialize;
use std::ops::ControlFlow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Weak;

/// Wire event name. The TS listener mirrors this string verbatim — never rename.
pub const PLUGINS_ATTACHED_EVENT: &str = "plugins-attached";

/// Payload of `plugins-attached`: the instances a re-attach handed the engine.
/// snake_case on the wire, matching the other plugin events.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PluginsAttached {
    pub instance_ids: Vec<String>,
}

static WORKER_STARTED: AtomicBool = AtomicBool::new(false);

/// Start the re-attach worker. Idempotent: a second call is ignored.
///
/// The singletons are held weakly and upgraded for one pass at a time, so the
/// worker never keeps them alive, and it ends once they are gone.
pub fn start(singletons: Weak<NativeSingletons>) {
    if WORKER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("dormant-plugin-reattach".to_string())
        .spawn(move || {
            serve_owed_reattaches(|| {
                let Some(singletons) = singletons.upgrade() else {
                    return ControlFlow::Break(());
                };
                reattach_dormant_plugins(&singletons.app_state, &*singletons.events);
                ControlFlow::Continue(())
            });
        });
    if let Err(error) = spawned {
        eprintln!("[Plugin] failed to start the dormant plugin re-attach worker: {error}");
    }
}

/// The worker's whole loop: wait for an owed wake, then run one pass.
fn serve_owed_reattaches(mut pass: impl FnMut() -> ControlFlow<()>) {
    loop {
        wait_for_owed_reattach();
        if pass().is_break() {
            return;
        }
    }
}

/// Run the batch's attach pass outside a batch, and tell the renderer what it
/// took.
///
/// Emitted only once the registry guard is released and only when something
/// was taken: the renderer marks those instances attached and splices them into
/// the chains that name them, exactly as it does for a batch's report.
pub(crate) fn reattach_dormant_plugins(state: &AppState, events: &dyn EventSink) {
    let attached = match attach_under_batch_guarantees(state) {
        Ok(attached) => attached,
        Err(reason) => {
            eprintln!("[Plugin] dormant instances could not be re-attached: {reason}");
            return;
        }
    };
    if attached.is_empty() {
        return;
    }
    events.emit(
        PLUGINS_ATTACHED_EVENT,
        PluginsAttached {
            instance_ids: attached
                .into_iter()
                .map(|plugin| plugin.instance_id)
                .collect(),
        },
    );
}

/// The pass, holding what `apply_graph_commands` holds around its own.
///
/// No engine, or one that has stopped rendering, takes nothing: the next batch
/// starts or restarts it and attaches the dormant instances itself, as it
/// always has, and an attach onto a ring nobody drains would hand the engine a
/// plugin it never renders.
fn attach_under_batch_guarantees(state: &AppState) -> Result<Vec<AttachedPlugin>, String> {
    let _registry_guard = state
        .graph
        .lock()
        .map_err(|error| format!("the graph registry lock is poisoned: {error}"))?;
    let dormant_plugin_count = state
        .plugins
        .lock()
        .map_err(|error| format!("the plugins lock is poisoned: {error}"))?
        .len();
    if dormant_plugin_count == 0 {
        return Ok(Vec::new());
    }
    {
        let mut engine_guard = state
            .engine
            .lock()
            .map_err(|error| format!("the engine lock is poisoned: {error}"))?;
        let Some(engine) = engine_guard.as_mut() else {
            return Ok(Vec::new());
        };
        if !engine.is_rendering() {
            return Ok(Vec::new());
        }
        // The count and the limit are one number, as in the batch: an instance
        // parked after this read is left for a later pass rather than pushed
        // onto a ring with no room reserved for it.
        engine
            .ensure_command_headroom(dormant_plugin_count)
            .map_err(|error| error.to_string())?;
    }
    attach_dormant_plugins(state, dormant_plugin_count).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block_on_test;
    use crate::commands::crumbs::CrumbsState;
    use crate::commands::graph::apply_graph_commands;
    use crate::commands::plugins::{lock_plugin_lifecycle, serialize_against_exclusive_gate_holds};
    use crate::host::dormant_attach_wake::raise_reattach_wake;
    use crate::state::PluginInstanceData;
    use serde_json::{json, Value};
    use std::sync::atomic::AtomicBool;
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::{Arc, Mutex};
    use std::thread::JoinHandle;
    use std::time::Duration;

    /// Long enough for a loaded runner, and only ever spent on a failure: the
    /// wait ends the moment the event arrives.
    const EVENT_DEADLINE: Duration = Duration::from_secs(10);

    struct ChannelEventSink(Mutex<Sender<(String, Value)>>);

    impl EventSink for ChannelEventSink {
        fn emit_json(&self, event: &str, payload: Value) {
            let _ = self
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .send((event.to_string(), payload));
        }
    }

    /// The production loop, run against one test's state until stopped.
    struct WorkerUnderTest {
        stop: Arc<AtomicBool>,
        thread: JoinHandle<()>,
    }

    impl WorkerUnderTest {
        fn start(state: &Arc<AppState>) -> (Self, Receiver<(String, Value)>) {
            let (sender, receiver) = channel();
            let sink = ChannelEventSink(Mutex::new(sender));
            let stop = Arc::new(AtomicBool::new(false));
            let worker_state = Arc::clone(state);
            let worker_stop = Arc::clone(&stop);
            let thread = std::thread::spawn(move || {
                serve_owed_reattaches(|| {
                    if worker_stop.load(Ordering::SeqCst) {
                        return ControlFlow::Break(());
                    }
                    reattach_dormant_plugins(&worker_state, &sink);
                    ControlFlow::Continue(())
                });
            });
            (Self { stop, thread }, receiver)
        }

        fn stop(self) {
            self.stop.store(true, Ordering::SeqCst);
            raise_reattach_wake();
            self.thread.join().expect("the worker thread ends cleanly");
        }
    }

    /// Instance ids are process-global lifecycle-gate keys, so every test here
    /// names its own.
    fn park_dormant_plugin(state: &AppState, instance_id: &str) {
        let wrapper = daw_plugin_host::ClapWrapper::new_engine_owned_command_fixture(
            "Dormant Fixture",
            vec![],
            false,
        );
        state.plugins.lock().expect("plugins lock").insert(
            instance_id.to_string(),
            PluginInstanceData::dormant_fixture(wrapper.into()),
        );
    }

    /// The capture fixture's consumer ends, kept alive for the test's whole
    /// run beside the state whose engine pushes onto them.
    type CapturedRings = (
        rtrb::Consumer<daw_engine::scheduler::GraphCommand>,
        Receiver<rtrb::Consumer<daw_engine::scheduler::RetiredGraphObjects>>,
    );

    fn state_with_engine() -> (Arc<AppState>, CapturedRings) {
        let state = Arc::new(AppState::default());
        let (engine, command_rx, retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64).unwrap();
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        (state, (command_rx, retired_adoption_rx))
    }

    fn apply_a_batch(state: &AppState) -> Value {
        let result = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": [{
                "kind": "create-track-strip", "trackId": "t1", "name": "T",
                "state": { "gain": 1.0, "pan": 0, "muted": false, "soloGated": false,
                           "vcaMultiplier": 1 },
                "devices": [], "honorMuted": true, "contributesAudio": true
            }] }),
            state,
            &CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");
        assert_eq!(result["application"], "applied");
        result
    }

    fn assert_refused_by_the_batch(state: &AppState, result: &Value, instance_id: &str) {
        assert_eq!(
            result["attachedPlugins"],
            json!([]),
            "the hold refused the batch's own attach"
        );
        assert!(
            state
                .plugins
                .lock()
                .expect("plugins lock")
                .contains_key(instance_id),
            "a refused instance stays dormant"
        );
    }

    fn assert_reattached(state: &AppState, events: &Receiver<(String, Value)>, instance_id: &str) {
        let (event, payload) = events
            .recv_timeout(EVENT_DEADLINE)
            .expect("the hold's release re-attaches the instance and says so");
        assert_eq!(event, PLUGINS_ATTACHED_EVENT);
        assert_eq!(payload, json!({ "instance_ids": [instance_id] }));
        assert!(
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .contains_key(instance_id),
            "the engine holds the instance the event names"
        );
        assert!(
            state.plugins.lock().expect("plugins lock").is_empty(),
            "and it left the command-owned store"
        );
    }

    /// The defect itself: Play pressed while an editor close holds the
    /// instance's lease, and no edit after it. The release alone attaches it.
    #[test]
    fn a_dormant_instance_a_held_lease_refused_attaches_once_the_lease_is_released() {
        let _gate_serial = serialize_against_exclusive_gate_holds();
        let (state, _rings) = state_with_engine();
        let instance_id = "reattach-after-lease";
        park_dormant_plugin(&state, instance_id);
        let lease = block_on_test(lock_plugin_lifecycle(instance_id));

        let result = apply_a_batch(&state);
        assert_refused_by_the_batch(&state, &result, instance_id);

        let (worker, events) = WorkerUnderTest::start(&state);
        drop(lease);
        assert_reattached(&state, &events, instance_id);
        worker.stop();
    }

    /// The same for a dormant control call still inside the instance: here the
    /// editor drain's own snapshot, which holds a clone of every dormant
    /// runtime while it visits them.
    #[test]
    fn a_dormant_instance_a_call_in_flight_refused_attaches_once_the_call_lets_go() {
        let _gate_serial = serialize_against_exclusive_gate_holds();
        let (state, _rings) = state_with_engine();
        let instance_id = "reattach-after-dormant-call";
        park_dormant_plugin(&state, instance_id);
        let snapshot = crate::host::all_editor_runtimes(
            &state.engine_plugins,
            &state.plugins,
            "re-attach test",
            || {},
        );

        let result = apply_a_batch(&state);
        assert_refused_by_the_batch(&state, &result, instance_id);

        let (worker, events) = WorkerUnderTest::start(&state);
        drop(snapshot);
        assert_reattached(&state, &events, instance_id);
        worker.stop();
    }
}
