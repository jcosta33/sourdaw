//! Push path for the parameter edits a plugin makes on its own.
//!
//! A user riding a knob inside a plugin's editor changes the plugin and tells
//! this host nothing unless the host reads the events the plugin emits. Both
//! formats emit them from the audio path — CLAP inside `process()`, VST3 from a
//! component-handler callback that may land there — so the backend writes them
//! into a preallocated wait-free queue and this thread drains it.
//!
//! ## Why this one polls when every other watcher blocks
//!
//! The latency and host-request watchers block in `recv()` because the callback
//! that wakes them runs on the plugin's main thread, where allocating a `String`
//! and sending on a channel is allowed. This one has no such callback: the
//! events arrive on the audio thread, which may not allocate, lock, or make a
//! syscall — so it cannot send, and nothing else knows an event happened.
//!
//! What it can do is set one process-global flag, and that is exactly what the
//! capture site does. This thread wakes on a short timer, reads that flag, and
//! goes straight back to sleep when it is clear: an idle session costs one
//! relaxed atomic load per tick and touches no lock at all. Only a tick that
//! finds the flag raised takes the instance map.
//!
//! ## What it does not take
//!
//! The drain never takes the `SharedHostedPlugin` control seam. That seam can
//! wait on the audio thread, and the audio thread bypasses a plugin whose lock
//! is held — so a drain that took it would trade a knob's UI latency for a
//! dropout. The queue is reached through an `Arc` cloned off the runtime once at
//! load, and draining it is wait-free on both sides.
//!
//! ## Why the flush answer lives here too
//!
//! `clap_host_params.request_flush` is annotated `[thread-safe]`, so a plugin
//! may raise it from inside `process()`. That rules out the host-request
//! watcher, whose wake copies an instance id and sends on a channel — an
//! allocation the render thread may not make. So the backend records the ask as
//! a flag and raises a second process-wide hint, and this thread answers it.
//!
//! Answering *does* take the control seam, because `params.flush()` is a call
//! into the plugin. That is the one thing this thread does under a lock, it runs
//! only on a tick that found the flush hint raised, and it is bounded by a
//! timeout far shorter than a command's, so a busy instance cannot hold the knob
//! drain behind it.

use crate::events::{EventSink, EventSinkExt};
use crate::host::native_bridge::SharedHostedPlugin;
use crate::state::EnginePluginInstanceData;
use daw_plugin_host::{
    is_empty_batch, pair_gestures, signal_pending_parameter_flush,
    take_pending_parameter_events_signal, take_pending_parameter_flush_signal, AudioPlugin,
    PairedParameterEvents, PluginParameterEvent, PluginParameterEventKind,
    PluginParameterEventQueue,
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Wire event name. The TS listener mirrors this string verbatim — never rename.
pub const PLUGIN_PARAMETER_EVENTS_EVENT: &str = "plugin-parameter-events";

/// How long the drain sleeps between ticks.
///
/// One frame. A plugin edit drives a control the user is watching and, once
/// automation recording consumes it, the resolution of the lane it writes — so
/// coarser than a frame is visibly laggy, and finer buys nothing a 60 Hz
/// renderer can show.
const DRAIN_INTERVAL: Duration = Duration::from_millis(16);

/// How long answering one flush may wait for the audio thread to release an
/// instance.
///
/// A fraction of the two seconds a plugin command allows, because this thread
/// also carries the knob drain: a flush that parked here for seconds would
/// freeze every other plugin's editor feedback behind one busy instance. A visit
/// that could not get in raises the hint again rather than waiting, so the next
/// tick tries and the ask is not lost.
const FLUSH_CONTROL_TIMEOUT: Duration = Duration::from_millis(50);

/// One plugin-originated parameter event, as the renderer reads it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginParameterEventKindDto {
    /// The user took hold of this parameter inside the plugin's editor.
    GestureBegin,
    /// The plugin set this parameter to `value`.
    Value,
    /// The user let go.
    GestureEnd,
}

/// Payload element of `plugin-parameter-events`. snake_case on the wire, like
/// every other plugin DTO.
///
/// `value` is present only on a `value` event: a gesture boundary reports that
/// the user took hold or let go and carries no setting, and inventing one here
/// would be a reading the plugin never made.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PluginParameterEventDto {
    pub param_id: u32,
    pub kind: PluginParameterEventKindDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
}

/// Payload of `plugin-parameter-events`: one instance's edits, in the order the
/// plugin produced them.
///
/// Batched rather than one event per edit because a continuous ride emits a
/// value per block, and a per-edit IPC message would put thousands of round
/// trips a second on the renderer for one knob.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PluginParameterEvents {
    pub instance_id: String,
    pub events: Vec<PluginParameterEventDto>,
}

type EnginePlugins = Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>;

/// Set once, when the drain thread starts, so a second `start` is ignored.
static DRAIN_STARTED: AtomicBool = AtomicBool::new(false);

/// The gestures each instance currently has open, carried between ticks.
///
/// A gesture opens in one block and closes in another, so the pairing rule needs
/// memory across drains: without it every tick would see an unbalanced fragment
/// and either drop the close or invent an open.
type OpenGestures = HashMap<String, HashSet<u32>>;

fn to_dto(event: PluginParameterEvent) -> PluginParameterEventDto {
    match event.kind {
        PluginParameterEventKind::GestureBegin => PluginParameterEventDto {
            param_id: event.param_id,
            kind: PluginParameterEventKindDto::GestureBegin,
            value: None,
        },
        PluginParameterEventKind::Value => PluginParameterEventDto {
            param_id: event.param_id,
            kind: PluginParameterEventKindDto::Value,
            value: Some(event.value),
        },
        PluginParameterEventKind::GestureEnd => PluginParameterEventDto {
            param_id: event.param_id,
            kind: PluginParameterEventKindDto::GestureEnd,
            value: None,
        },
    }
}

/// Decide what one instance's drained batch should emit.
///
/// Split out from the thread body so the emit rule is testable without a live
/// plugin or an event sink. A batch with nothing in it emits nothing: a tick
/// that found the signal raised for one instance still visits the others, and an
/// empty event would have the renderer re-render for no change.
pub fn parameter_events_payload(
    instance_id: &str,
    batch: PairedParameterEvents,
) -> Option<PluginParameterEvents> {
    if is_empty_batch(&batch) {
        return None;
    }

    Some(PluginParameterEvents {
        instance_id: instance_id.to_string(),
        events: batch.events.into_iter().map(to_dto).collect(),
    })
}

/// Drain one instance's queue and pair the gestures it holds open.
///
/// Reports the drop count separately from the events so the caller can say so
/// once, rather than the renderer inferring loss from a gesture that closed
/// without the user letting go.
fn drain_instance(
    queue: &PluginParameterEventQueue,
    open: &mut HashSet<u32>,
) -> PairedParameterEvents {
    let mut drained = Vec::new();
    queue.drain(&mut drained);
    pair_gestures(open, drained, queue.take_dropped())
}

/// Every engine-owned instance that has a parameter queue, and its queue.
///
/// Cloned out under the map lock and answered as owned handles, so the drain
/// itself — and the emit after it — runs with no lock held. A drain that kept
/// the map locked would block every plugin command for as long as it ran.
fn queues_to_drain(
    engine_plugins: &EnginePlugins,
) -> Vec<(String, Arc<PluginParameterEventQueue>)> {
    let Ok(guard) = engine_plugins.lock() else {
        eprintln!("[Plugin] parameter-event drain failed to lock engine_plugins");
        return Vec::new();
    };

    guard
        .iter()
        .filter_map(|(instance_id, instance)| {
            instance
                .parameter_events
                .as_ref()
                .map(|queue| (instance_id.clone(), Arc::clone(queue)))
        })
        .collect()
}

/// One drain pass over every instance. Returns nothing; emits what it found.
fn drain_once(
    engine_plugins: &EnginePlugins,
    open_gestures: &mut OpenGestures,
    events: &dyn EventSink,
) {
    let queues = queues_to_drain(engine_plugins);
    open_gestures.retain(|instance_id, _| queues.iter().any(|(id, _)| id == instance_id));

    for (instance_id, queue) in queues {
        let open = open_gestures.entry(instance_id.clone()).or_default();
        let batch = drain_instance(&queue, open);

        if batch.dropped > 0 {
            eprintln!(
                "[Plugin] dropped {} parameter events from instance {}: the drain fell behind the plugin",
                batch.dropped, instance_id
            );
        }

        if let Some(payload) = parameter_events_payload(&instance_id, batch) {
            events.emit(PLUGIN_PARAMETER_EVENTS_EVENT, payload);
        }
    }
}

/// Every engine-owned instance's id and runtime.
///
/// Cloned out under the map lock for the same reason the queues are: taking a
/// plugin's control seam while still holding the instance map would block every
/// plugin command in the process behind one busy instance.
fn runtimes_to_flush(engine_plugins: &EnginePlugins) -> Vec<(String, Arc<SharedHostedPlugin>)> {
    let Ok(guard) = engine_plugins.lock() else {
        eprintln!("[Plugin] parameter flush failed to lock engine_plugins");
        return Vec::new();
    };

    guard
        .iter()
        .map(|(instance_id, instance)| (instance_id.clone(), Arc::clone(&instance.runtime)))
        .collect()
}

/// Answer the flush requests plugins raised, off the audio thread.
///
/// The hint names no instance — it cannot, because it is raised from the audio
/// thread where copying an id would allocate — so this visits every engine-owned
/// instance and lets each backend answer for itself: it takes that instance's
/// own recorded flag and does nothing when there is none.
///
/// Reports whether the ask was answered anywhere. Answered, not necessarily
/// carried out: a visit that finds the plugin mid-block consumes the flag and
/// leaves the output to `process()`, which is CLAP's own rule for `flush` while
/// processing.
fn flush_pending_parameters(engine_plugins: &EnginePlugins) -> bool {
    let mut answered = false;

    for (instance_id, runtime) in runtimes_to_flush(engine_plugins) {
        let reached = runtime.with_control(FLUSH_CONTROL_TIMEOUT, |plugin| {
            Ok(plugin.flush_parameters_off_audio_thread())
        });

        match reached {
            Ok(_) => answered = true,
            Err(error) => retry_unanswered_flush(&runtime, &instance_id, &error),
        }
    }

    answered
}

/// Raise the hint again for an instance the flush could not reach.
///
/// Only for one still accepting public control. That is the difference between a
/// control path busy right now — the audio thread is inside a block, and the next
/// tick finds it free — and an instance unloading or retired, which would refuse
/// every retry and turn the hint into a tick-forever spin.
fn retry_unanswered_flush(runtime: &SharedHostedPlugin, instance_id: &str, error: &str) {
    if runtime.ensure_public_control_allowed().is_err() {
        return;
    }

    eprintln!(
        "[Plugin] parameter flush could not reach instance {}, retrying: {}",
        instance_id, error
    );
    signal_pending_parameter_flush();
}

/// One pass of the drain thread, once its sleep is over.
///
/// The two hints are read independently: a plugin that emitted events took no
/// lock to say so, while a plugin asking for a flush needs one, and neither ask
/// implies the other.
fn run_tick(
    engine_plugins: &EnginePlugins,
    open_gestures: &mut OpenGestures,
    events: &dyn EventSink,
) {
    if take_pending_parameter_events_signal() {
        drain_once(engine_plugins, open_gestures, events);
    }

    if take_pending_parameter_flush_signal() && flush_pending_parameters(engine_plugins) {
        // A flush exists to make the plugin hand its parameter changes over, and
        // they land in the same queues this thread drains. Publishing them on
        // this pass rather than the next halves the delay on the one path that
        // asked the host for help.
        take_pending_parameter_events_signal();
        drain_once(engine_plugins, open_gestures, events);
    }
}

/// Start the drain thread. Idempotent: a second call is ignored.
pub fn start(events: Arc<dyn EventSink>, engine_plugins: EnginePlugins) {
    if DRAIN_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let spawned = std::thread::Builder::new()
        .name("plugin-parameter-events".to_string())
        .spawn(move || {
            let mut open_gestures = OpenGestures::new();
            loop {
                std::thread::sleep(DRAIN_INTERVAL);
                run_tick(&engine_plugins, &mut open_gestures, &*events);
            }
        });

    if let Err(error) = spawned {
        eprintln!(
            "[Plugin] failed to start the plugin parameter event drain: {}",
            error
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use daw_plugin_host::ClapWrapper;

    /// Both hints are process-wide, so any test that pushes an event or arms a
    /// flush raises one for every test running beside it. Every test below that
    /// pushes, arms, or drives a tick takes this first.
    static HINT_TEST_LOCK: Mutex<()> = Mutex::new(());

    /// Serialise against the other hint users and start from a clean slate, so a
    /// hint left raised by whichever test ran before cannot stand in for the one
    /// this test is about.
    fn hint_guard() -> std::sync::MutexGuard<'static, ()> {
        let guard = HINT_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        take_pending_parameter_events_signal();
        take_pending_parameter_flush_signal();
        guard
    }

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

    fn fixture_wrapper() -> ClapWrapper {
        ClapWrapper::new_engine_owned_command_fixture("Drain Fixture", Vec::new(), false)
    }

    /// Raise `clap_host_params.request_flush` on a fixture exactly as a plugin
    /// does from inside its own callback — flag recorded, process-wide hint set,
    /// no channel touched.
    fn asking_for_a_flush(wrapper: ClapWrapper) -> ClapWrapper {
        wrapper
            .engine_owned_command_fixture_host_state()
            .request_parameters_flush();
        wrapper
    }

    /// One engine-owned instance in a real map, with its own parameter queue
    /// reachable the way the drain reaches it. Returns the map, the queue, and
    /// the runtime, so a test can push edits or take the instance out of service.
    fn instance_map(
        wrapper: ClapWrapper,
    ) -> (
        EnginePlugins,
        Arc<PluginParameterEventQueue>,
        Arc<SharedHostedPlugin>,
    ) {
        let queue = wrapper.parameter_event_queue();
        let runtime = Arc::new(SharedHostedPlugin::new(wrapper.into()));
        let mut map = HashMap::new();
        map.insert(
            "inst-1".to_string(),
            EnginePluginInstanceData {
                engine_plugin_id: 11,
                runtime: Arc::clone(&runtime),
                name: "Drain Fixture".to_string(),
                parameters: Vec::new(),
                has_gui: false,
                bridge: None,
                relay_scratch: crate::state::PluginRelayScratch::default(),
                parameter_events: Some(Arc::clone(&queue)),
            },
        );

        (Arc::new(Mutex::new(map)), queue, runtime)
    }

    fn tick(engine_plugins: &EnginePlugins, sink: &RecordingEventSink) {
        run_tick(engine_plugins, &mut OpenGestures::new(), sink);
    }

    /// The whole point of the thread: an edit the plugin made on its own reaches
    /// the renderer without anyone asking for it.
    #[test]
    fn a_tick_publishes_the_edit_the_plugin_pushed() {
        let _guard = hint_guard();
        let (engine_plugins, queue, _runtime) = instance_map(fixture_wrapper());
        let sink = RecordingEventSink::default();

        assert!(queue.push(PluginParameterEvent::value(3, 0.25)));
        tick(&engine_plugins, &sink);

        assert_eq!(
            sink.events(),
            vec![(
                PLUGIN_PARAMETER_EVENTS_EVENT.to_string(),
                serde_json::json!({
                    "instance_id": "inst-1",
                    "events": [{ "param_id": 3, "kind": "value", "value": 0.25 }],
                }),
            )]
        );
    }

    /// The hint is what keeps an idle session free: without the gate every tick
    /// would take the instance map sixty times a second for nothing.
    #[test]
    fn a_tick_with_no_hint_raised_takes_nothing_and_publishes_nothing() {
        let _guard = hint_guard();
        let (engine_plugins, queue, _runtime) = instance_map(fixture_wrapper());
        let sink = RecordingEventSink::default();

        assert!(queue.push(PluginParameterEvent::value(3, 0.25)));
        take_pending_parameter_events_signal();
        tick(&engine_plugins, &sink);

        assert_eq!(
            sink.events(),
            Vec::new(),
            "a tick that found no hint must not have drained the queue behind it"
        );
    }

    /// `request_flush` is the ask a plugin may raise from the audio thread, and
    /// nothing else answers it: the request watcher never hears about it, so a
    /// tick that skipped the flush leg would leave the plugin's changes inside it
    /// for good.
    #[test]
    fn a_tick_answers_the_flush_a_plugin_asked_for_and_publishes_what_it_handed_over() {
        let _guard = hint_guard();
        let (engine_plugins, queue, _runtime) = instance_map(asking_for_a_flush(fixture_wrapper()));
        let sink = RecordingEventSink::default();

        // What the plugin handed over. Staged directly because the fixture has no
        // `params` extension of its own to emit through.
        assert!(queue.push(PluginParameterEvent::value(5, 0.75)));
        take_pending_parameter_events_signal();

        tick(&engine_plugins, &sink);

        assert_eq!(
            sink.events(),
            vec![(
                PLUGIN_PARAMETER_EVENTS_EVENT.to_string(),
                serde_json::json!({
                    "instance_id": "inst-1",
                    "events": [{ "param_id": 5, "kind": "value", "value": 0.75 }],
                }),
            )]
        );
    }

    /// An instance mid-unload refuses public control, and the flush leg has to
    /// survive that: the plugin is going away, and the tick serves every other
    /// instance and the knob drain behind it.
    #[test]
    fn a_flush_for_an_unloading_instance_is_dropped_rather_than_fatal() {
        let _guard = hint_guard();
        let (engine_plugins, queue, runtime) = instance_map(asking_for_a_flush(fixture_wrapper()));
        let sink = RecordingEventSink::default();

        assert!(queue.push(PluginParameterEvent::value(5, 0.75)));
        take_pending_parameter_events_signal();
        runtime.begin_unload();

        tick(&engine_plugins, &sink);

        assert_eq!(
            sink.events(),
            Vec::new(),
            "an instance that refuses public control cannot have been flushed"
        );
        assert!(
            !take_pending_parameter_flush_signal(),
            "an instance that is never coming back must not have the hint raised for it again"
        );
    }

    fn paired(events: Vec<PluginParameterEvent>, dropped: u32) -> PairedParameterEvents {
        PairedParameterEvents { events, dropped }
    }

    #[test]
    fn a_value_edit_becomes_a_payload_carrying_the_parameter_and_its_setting() {
        assert_eq!(
            parameter_events_payload(
                "inst-1",
                paired(vec![PluginParameterEvent::value(3, 0.25)], 0)
            ),
            Some(PluginParameterEvents {
                instance_id: "inst-1".to_string(),
                events: vec![PluginParameterEventDto {
                    param_id: 3,
                    kind: PluginParameterEventKindDto::Value,
                    value: Some(0.25),
                }],
            })
        );
    }

    /// Every tick that finds the signal raised visits every instance, and all
    /// but one of them have nothing. An empty event would be a re-render the
    /// renderer was given no reason for.
    #[test]
    fn an_instance_with_nothing_drained_emits_nothing() {
        assert_eq!(
            parameter_events_payload("inst-1", paired(Vec::new(), 0)),
            None
        );
    }

    /// The boundaries have to reach the renderer with the values between them,
    /// or a recorder cannot tell one held ride from a run of separate nudges.
    #[test]
    fn a_bracketed_ride_reaches_the_renderer_whole_and_in_order() {
        let payload = parameter_events_payload(
            "inst-1",
            paired(
                vec![
                    PluginParameterEvent::gesture_begin(4),
                    PluginParameterEvent::value(4, 0.6),
                    PluginParameterEvent::gesture_end(4),
                ],
                0,
            ),
        )
        .expect("a bracketed ride is worth publishing");

        assert_eq!(
            payload.events,
            vec![
                PluginParameterEventDto {
                    param_id: 4,
                    kind: PluginParameterEventKindDto::GestureBegin,
                    value: None,
                },
                PluginParameterEventDto {
                    param_id: 4,
                    kind: PluginParameterEventKindDto::Value,
                    value: Some(0.6),
                },
                PluginParameterEventDto {
                    param_id: 4,
                    kind: PluginParameterEventKindDto::GestureEnd,
                    value: None,
                },
            ]
        );
    }

    /// A gesture boundary is not a setting. Publishing `0.0` on one would have a
    /// recorder write a point at zero the moment the user took hold.
    #[test]
    fn a_gesture_boundary_carries_no_value_on_the_wire() {
        let json = serde_json::to_string(&PluginParameterEvents {
            instance_id: "inst-7".to_string(),
            events: vec![PluginParameterEventDto {
                param_id: 2,
                kind: PluginParameterEventKindDto::GestureBegin,
                value: None,
            }],
        })
        .expect("payload serialises");

        assert_eq!(
            json,
            r#"{"instance_id":"inst-7","events":[{"param_id":2,"kind":"gesture_begin"}]}"#
        );
    }

    #[test]
    fn the_payload_serialises_with_the_snake_case_wire_names_the_frontend_reads() {
        let json = serde_json::to_string(&PluginParameterEvents {
            instance_id: "inst-7".to_string(),
            events: vec![PluginParameterEventDto {
                param_id: 2,
                kind: PluginParameterEventKindDto::Value,
                value: Some(0.5),
            }],
        })
        .expect("payload serialises");

        assert_eq!(
            json,
            r#"{"instance_id":"inst-7","events":[{"param_id":2,"kind":"value","value":0.5}]}"#
        );
    }

    /// A drop still publishes what survived. The alternative — withholding the
    /// batch — turns a gap in a ride into a control frozen at its old value.
    #[test]
    fn a_lossy_batch_still_publishes_the_events_it_kept() {
        let payload = parameter_events_payload(
            "inst-1",
            paired(vec![PluginParameterEvent::value(1, 0.5)], 4),
        );

        assert!(payload.is_some());
    }

    /// A gesture opens in one block and closes in a later one. Without the
    /// carried-over set the second drain would see a close with no open and drop
    /// it, leaving the renderer's lane held in write mode for good.
    #[test]
    fn a_gesture_that_spans_two_drains_closes_on_the_second() {
        let _guard = hint_guard();
        let queue = PluginParameterEventQueue::default();
        let mut open = HashSet::new();

        queue.push(PluginParameterEvent::gesture_begin(9));
        let first = drain_instance(&queue, &mut open);
        queue.push(PluginParameterEvent::gesture_end(9));
        let second = drain_instance(&queue, &mut open);

        assert_eq!(first.events, vec![PluginParameterEvent::gesture_begin(9)]);
        assert_eq!(
            second.events,
            vec![PluginParameterEvent::gesture_end(9)],
            "the close must survive the drain boundary its open fell on the other side of"
        );
        assert!(open.is_empty());
    }

    /// Loss is exactly the case where the host can no longer vouch for a
    /// gesture, and an unreleased touch holds an automation lane in write mode
    /// forever. The drain closes what it cannot account for.
    #[test]
    fn a_lossy_drain_closes_the_gesture_it_can_no_longer_vouch_for() {
        let _guard = hint_guard();
        let queue = PluginParameterEventQueue::with_capacity(1);
        let mut open = HashSet::new();

        assert!(queue.push(PluginParameterEvent::gesture_begin(9)));
        assert!(!queue.push(PluginParameterEvent::value(9, 0.5)));

        let batch = drain_instance(&queue, &mut open);

        assert_eq!(batch.dropped, 1);
        assert_eq!(
            batch.events,
            vec![
                PluginParameterEvent::gesture_begin(9),
                PluginParameterEvent::gesture_end(9),
            ]
        );
        assert!(open.is_empty());
    }
}
