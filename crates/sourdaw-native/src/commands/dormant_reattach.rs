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
//! command the attach of every instance it counts pushes, as a batch's
//! headroom does. A pass still refused owes again and waits for the next
//! release; an instance unloaded meanwhile is simply not in the map. The quit
//! cascade closes the re-attach before it closes the editors, so no pass moves
//! an instance after the cascade has taken the live ones.

use crate::commands::plugins::{attach_command_headroom, attach_dormant_plugins, AttachedPlugin};
use crate::events::{EventSink, EventSinkExt};
use crate::host::dormant_attach_wake::wait_for_owed_reattach;
use crate::host::plugin_host_requests::registered_ui_thread;
use crate::host::ui_thread::{release_on_ui_thread, UiThread};
use crate::state::{locked_or_poisoned, AppState};
use crate::NativeSingletons;
use serde::Serialize;
use std::ops::ControlFlow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};

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
                let_go_off_this_thread(singletons, registered_ui_thread().as_deref());
                ControlFlow::Continue(())
            });
        });
    if let Err(error) = spawned {
        eprintln!("[Plugin] failed to start the dormant plugin re-attach worker: {error}");
    }
}

/// Let go of the reference a pass upgraded, never as its last holder.
///
/// The owner may be finalized while a pass runs, and then this reference is the
/// singletons' last: dropping it here would run every hosted runtime's
/// teardown on this worker, which neither plugin format allows. That last
/// reference goes to the shell's UI thread instead. With no UI thread to take
/// it, it is leaked rather than dropped: the owner is gone, which is the
/// process ending, and a process ending does not run destructors either.
fn let_go_off_this_thread<Held: Send + Sync + 'static>(held: Arc<Held>, ui: Option<&dyn UiThread>) {
    let Some(last) = Arc::into_inner(held) else {
        return;
    };
    let unreleased = match ui {
        Some(ui) => match release_on_ui_thread(ui, last) {
            Ok(()) => return,
            Err((last, reason)) => {
                eprintln!("[Plugin] the re-attach worker could not hand back the host: {reason}");
                last
            }
        },
        None => last,
    };
    std::mem::forget(unreleased);
}

/// Refuse every later re-attach pass for `state`, and wait out one already
/// running.
///
/// The quit cascade calls this before it closes the editors, whose clones'
/// release is a wake: a pass that ran after the cascade took the live
/// instances would register into the engine store an instance it took out of
/// the dormant one, and nothing would ever terminate it. The flag is read
/// under the graph registry guard, which a pass holds for its whole body, so
/// taking that guard once after setting the flag is what waits a running pass
/// out. Holders of that guard wait on nothing the shell's UI thread must run
/// without a deadline of their own, so the wait is bounded by a pass's work.
pub(crate) fn close_dormant_reattach(state: &AppState) {
    state.dormant_reattach_closed.store(true, Ordering::SeqCst);
    drop(locked_or_poisoned(&state.graph));
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
///
/// Read under the registry guard, a closed re-attach takes nothing: see
/// [`close_dormant_reattach`].
fn attach_under_batch_guarantees(state: &AppState) -> Result<Vec<AttachedPlugin>, String> {
    let _registry_guard = state
        .graph
        .lock()
        .map_err(|error| format!("the graph registry lock is poisoned: {error}"))?;
    if state.dormant_reattach_closed.load(Ordering::SeqCst) {
        return Ok(Vec::new());
    }
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
        // The count is the limit and the reservation is the room its attaches
        // push, as in the batch: an instance parked after this read is left
        // for a later pass rather than pushed onto a ring with no room
        // reserved for it.
        engine
            .ensure_command_headroom(attach_command_headroom(dormant_plugin_count))
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
    use crate::host::dormant_attach_wake::{
        raise_reattach_wake, take_due_reattach_wake, RuntimeClone,
    };
    use crate::state::PluginInstanceData;
    use serde_json::{json, Value};
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::Mutex;
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

    /// Every attach pushes two commands, so a pass over a ring with one free
    /// slot per instance must still make room for all of them. Mutation:
    /// reserve the instance count instead of `attach_command_headroom` of it,
    /// and the second instance is refused as "queue full".
    #[test]
    fn a_pass_over_a_nearly_full_ring_attaches_every_dormant_instance() {
        let _gate_serial = serialize_against_exclusive_gate_holds();
        let state = Arc::new(AppState::default());
        let (mut engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8).unwrap();
        for id in 0..6 {
            engine.remove_plugin(id).expect("the ring has room for six");
        }
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        park_dormant_plugin(&state, "headroom-a");
        park_dormant_plugin(&state, "headroom-b");
        let (sender, events) = channel();

        reattach_dormant_plugins(&state, &ChannelEventSink(Mutex::new(sender)));

        let (event, payload) = events
            .try_recv()
            .expect("the pass reports what it attached");
        assert_eq!(event, PLUGINS_ATTACHED_EVENT);
        assert_eq!(
            payload,
            json!({ "instance_ids": ["headroom-a", "headroom-b"] })
        );
        assert!(
            state.plugins.lock().expect("plugins lock").is_empty(),
            "no instance was left dormant by a ring with no room for it"
        );
    }

    /// An editor drain's snapshot covers every dormant instance, so letting go
    /// of one says nothing about an instance another call is still inside. Only
    /// the refused instance's own release may wake the re-attach, or a pass
    /// that refuses it again re-raises the drain, whose snapshot wakes the
    /// next pass, for as long as the call lasts. Mutation: have the release
    /// wake on any watched runtime left with only the map's reference, and the
    /// snapshots below make a wake due.
    #[test]
    fn letting_go_of_another_dormant_instance_does_not_wake_the_refused_ones_reattach() {
        let _gate_serial = serialize_against_exclusive_gate_holds();
        let (state, _rings) = state_with_engine();
        let held_id = "reattach-held-by-a-call";
        let free_id = "reattach-free-beside-a-call";
        park_dormant_plugin(&state, held_id);
        let call =
            RuntimeClone::dormant(&state.plugins.lock().expect("plugins lock")[held_id].plugin);
        take_due_reattach_wake();

        let result = apply_a_batch(&state);
        assert_refused_by_the_batch(&state, &result, held_id);
        // Parked after the batch, so it is dormant and free when the drains
        // below snapshot it beside the held one.
        park_dormant_plugin(&state, free_id);
        for _ in 0..4 {
            drop(crate::host::all_editor_runtimes(
                &state.engine_plugins,
                &state.plugins,
                "re-attach test",
                || {},
            ));
        }
        assert!(
            !take_due_reattach_wake(),
            "a release of the free instance woke a pass the held one would refuse"
        );

        let (worker, events) = WorkerUnderTest::start(&state);
        drop(call);
        let (event, payload) = events
            .recv_timeout(EVENT_DEADLINE)
            .expect("the call's release re-attaches the instance it held");
        assert_eq!(event, PLUGINS_ATTACHED_EVENT);
        // The pass visits instances in id order.
        assert_eq!(payload, json!({ "instance_ids": [free_id, held_id] }));
        worker.stop();
    }

    /// A value whose drop records the thread that ran it, standing in for the
    /// singletons whose last drop tears every hosted runtime down.
    struct DropRecorder(Arc<Mutex<Vec<std::thread::ThreadId>>>);

    impl Drop for DropRecorder {
        fn drop(&mut self) {
            self.0
                .lock()
                .expect("drop log")
                .push(std::thread::current().id());
        }
    }

    /// Runs each task on a thread of its own, so a drop it carries is
    /// distinguishable from one on the caller's thread.
    struct SpawningUiThread;

    impl UiThread for SpawningUiThread {
        fn is_ui_thread(&self) -> bool {
            false
        }

        fn run_on_ui_thread(
            &self,
            task: &Arc<crate::host::ui_thread::UiThreadTask>,
        ) -> Result<(), crate::host::ui_thread::UiThreadError> {
            let task = Arc::clone(task);
            std::thread::spawn(move || task.run())
                .join()
                .expect("the UI thread's task ends cleanly");
            Ok(())
        }
    }

    /// The owner finalized during a pass leaves the worker holding the last
    /// reference, and its drop is every hosted runtime's teardown: it must
    /// never run on the worker. Mutation: drop `held` in place, and the drop
    /// log names this thread.
    #[test]
    fn the_worker_hands_a_last_reference_to_the_ui_thread_rather_than_dropping_it() {
        let dropped_on = Arc::new(Mutex::new(Vec::new()));

        let_go_off_this_thread(
            Arc::new(DropRecorder(Arc::clone(&dropped_on))),
            Some(&SpawningUiThread),
        );

        let dropped_on = dropped_on.lock().expect("drop log");
        assert_eq!(dropped_on.len(), 1, "the last reference was released");
        assert_ne!(
            dropped_on[0],
            std::thread::current().id(),
            "and not on the worker"
        );
    }

    /// A reference the owner still shares is simply let go: the owner's drop
    /// stays the last one, on its own thread. With no UI thread at all the
    /// last reference is never dropped here.
    #[test]
    fn the_worker_lets_go_of_a_shared_reference_and_never_drops_a_last_one_itself() {
        let dropped_on = Arc::new(Mutex::new(Vec::new()));
        let owner = Arc::new(DropRecorder(Arc::clone(&dropped_on)));

        let_go_off_this_thread(Arc::clone(&owner), Some(&SpawningUiThread));
        assert!(dropped_on.lock().expect("drop log").is_empty());
        assert_eq!(Arc::strong_count(&owner), 1, "only the owner's is left");

        let_go_off_this_thread(owner, None);
        assert!(
            dropped_on.lock().expect("drop log").is_empty(),
            "a last reference with no UI thread to take it is not dropped here"
        );
    }
}
