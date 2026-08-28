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
//! It never takes the `SharedHostedPlugin` control seam. That seam can wait on
//! the audio thread, and the audio thread bypasses a plugin whose lock is held —
//! so a drain that took it would trade a knob's UI latency for a dropout. The
//! queue is reached through an `Arc` cloned off the runtime once at load, and
//! draining it is wait-free on both sides.

use crate::events::{EventSink, EventSinkExt};
use crate::state::EnginePluginInstanceData;
use daw_plugin_host::{
    is_empty_batch, pair_gestures, take_pending_parameter_events_signal, PairedParameterEvents,
    PluginParameterEvent, PluginParameterEventKind, PluginParameterEventQueue,
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
                if !take_pending_parameter_events_signal() {
                    continue;
                }
                drain_once(&engine_plugins, &mut open_gestures, &*events);
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
