//! Push path for the processing tail a plugin revises mid-session.
//!
//! A tail is how long a plugin keeps sounding after its input stops — a reverb's
//! decay, a delay's repeats. Both formats report one, and both let it move: a
//! CLAP plugin calls `clap_host_tail.changed()` when a preset lengthens its
//! decay, and the value read at load is stale from that moment on.
//!
//! ## Why this one is not a watcher thread of its own
//!
//! The latency watcher blocks in `recv()` because the callback that wakes it
//! runs on the plugin's main thread, where allocating an instance id and sending
//! it is allowed. CLAP annotates `clap_host_tail.changed` `[audio-thread]`, so
//! this one has no such callback: the backend records a flag and raises one
//! process-wide hint, and the parameter-event drain — already awake on a timer
//! for exactly that kind of hint — hands the ask here.
//!
//! The hint names no instance, because a wake from the audio thread cannot carry
//! one. So a raised hint visits every engine-owned instance and lets each
//! backend answer for itself: a plugin that flagged reports the tail it holds
//! now, and every other one reports nothing.

use crate::events::{EventSink, EventSinkExt};
use crate::host::native_bridge::{PluginControlError, PluginControlRefusal};
use crate::host::{all_engine_runtimes, retry_unreached_instance};
use crate::state::EnginePluginInstanceData;
use daw_plugin_host::{signal_pending_tail_change, HostedPluginRuntime};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Wire event name. Its payload type is mirrored by hand in the frontend as
/// `PluginTailChange`; the listener that subscribes to this name arrives with
/// the packet that consumes the tail.
pub const PLUGIN_TAIL_CHANGED_EVENT: &str = "plugin-tail-changed";

static TAIL_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// The next place in the one order every tail figure this process hands the
/// frontend takes, starting at 1.
///
/// Both ways a tail leaves the host, the `plugin-tail-changed` event and the
/// `read_plugin_tails` answer, take their number inside the plugin's control
/// closure. That closure runs under the instance's control gate, which
/// serializes the two per instance, so a larger number is the value read later
/// and the frontend can rank an event against an answer however late either one
/// is delivered. A u64 stays a JSON number the frontend reads exactly while it
/// is below 2^53, which a counter bumped once per tail read never reaches.
///
/// The increment is acquire-release so that a figure numbered above a
/// successor's load number can see the predecessor's retirement. `retire` is a
/// release store sequenced before the unload returns, and the successor takes
/// its load number after that; a predecessor's number that lands above it read
/// from that release sequence, so a lifecycle read made after taking the number
/// observes the retirement. The check therefore goes after the number, never
/// before it.
pub(crate) fn next_tail_sequence() -> u64 {
    TAIL_SEQUENCE.fetch_add(1, Ordering::AcqRel) + 1
}

/// How long re-reading one plugin's tail may wait for the audio thread to
/// release it.
///
/// Sized for the audio thread holding the seam for the length of a block, not
/// for a plugin command of unbounded duration — the same reasoning, and the same
/// figure, as the parameter flush this leg shares a tick with. An instance that
/// could not be reached raises the hint again rather than blocking the visit to
/// the others.
const CONTROL_TIMEOUT: Duration = Duration::from_millis(50);

/// Payload of `plugin-tail-changed`. snake_case on the wire, matching the other
/// plugin DTOs (`PluginInstance`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PluginTailChanged {
    pub instance_id: String,
    /// Tail in frames of the rate the plugin was activated with, which is the
    /// engine rate the caller supplied at load. Frames rather than the
    /// milliseconds latency is reported in: both formats define a sentinel at
    /// the top of the range for a tail that never ends, and dividing that
    /// sentinel by a sample rate turns "infinite" into an ordinary duration.
    pub tail_samples: u32,
    /// Where this figure falls in the order of every tail the host reported; see
    /// [`next_tail_sequence`].
    pub sequence: u64,
}

type EnginePlugins = Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>;

/// Decide what one instance's answer should emit.
///
/// Split out from the visit so the emit rule is testable without a live plugin
/// or an event sink: only a plugin that actually flagged emits, and a re-read
/// that could not reach the plugin emits nothing rather than a fabricated tail,
/// which downstream would read as the plugin having shortened its decay.
pub fn tail_change_payload(
    instance_id: &str,
    refreshed: Result<Option<(u32, u64)>, PluginControlRefusal>,
) -> Option<PluginTailChanged> {
    match refreshed {
        Ok(Some((tail_samples, sequence))) => Some(PluginTailChanged {
            instance_id: instance_id.to_string(),
            tail_samples,
            sequence,
        }),
        Ok(None) => None,
        Err(error) => {
            eprintln!(
                "[Plugin] tail re-read failed for instance {}: {}",
                instance_id, error
            );
            None
        }
    }
}

/// Publish the tail every instance that flagged one reports now.
///
/// Called from the parameter-event drain's tick, once it has taken the hint.
pub fn publish_pending_tail_changes(engine_plugins: &EnginePlugins, events: &dyn EventSink) {
    publish_pending_tail_changes_within(CONTROL_TIMEOUT, engine_plugins, events);
}

/// `publish_pending_tail_changes` with the per-instance wait as a parameter, so
/// a test that holds the audio seam can give the visit a deadline only its own
/// release beats.
pub(crate) fn publish_pending_tail_changes_within(
    timeout: Duration,
    engine_plugins: &EnginePlugins,
    events: &dyn EventSink,
) {
    for (instance_id, runtime) in all_engine_runtimes(engine_plugins, "tail re-read") {
        let refreshed = runtime
            .try_with_control(timeout, |plugin| {
                Ok::<_, std::convert::Infallible>(
                    plugin
                        .take_tail_change()
                        .map(|tail_samples| (tail_samples, next_tail_sequence())),
                )
            })
            .map_err(PluginControlError::into_refusal);

        // The number above may exceed one a same-id successor's load seeded the
        // frontend with, which would apply this figure to the successor. Retired
        // is checked, not unloading: a cancelled unload leaves the instance
        // live and its figure stands. The flag is consumed, and the hint is not
        // raised again, because nothing is left to re-read.
        if matches!(refreshed, Ok(Some(_))) && runtime.is_retired() {
            eprintln!(
                "[Plugin] tail figure dropped for retired instance {}",
                instance_id
            );
            continue;
        }

        if let Err(error) = &refreshed {
            retry_unreached_instance(
                &runtime,
                &instance_id,
                "tail re-read",
                error,
                signal_pending_tail_change,
            );
        }

        if let Some(payload) = tail_change_payload(&instance_id, refreshed) {
            events.emit(PLUGIN_TAIL_CHANGED_EVENT, payload);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::native_bridge::SharedHostedPlugin;
    use daw_engine::timeline::DeviceKind;
    use daw_plugin_host::ClapWrapper;

    #[test]
    fn a_flagged_tail_becomes_an_event_payload_carrying_frames() {
        assert_eq!(
            tail_change_payload("inst-1", Ok(Some((48_000, 9)))),
            Some(PluginTailChanged {
                instance_id: "inst-1".to_string(),
                tail_samples: 48_000,
                sequence: 9,
            })
        );
    }

    #[test]
    fn an_instance_that_flagged_nothing_emits_nothing() {
        assert_eq!(tail_change_payload("inst-1", Ok(None)), None);
    }

    #[test]
    fn a_failed_reread_emits_nothing_rather_than_a_fabricated_tail() {
        assert_eq!(
            tail_change_payload(
                "inst-1",
                Err(PluginControlRefusal::GateBusy {
                    plugin: "fixture".to_string()
                })
            ),
            None,
            "a failed re-read must not publish a tail the plugin never reported"
        );
    }

    #[test]
    fn the_payload_serialises_with_the_snake_case_wire_names_the_frontend_reads() {
        let json = serde_json::to_string(&PluginTailChanged {
            instance_id: "inst-7".to_string(),
            tail_samples: 1024,
            sequence: 12,
        })
        .expect("payload serialises");

        assert_eq!(
            json,
            r#"{"instance_id":"inst-7","tail_samples":1024,"sequence":12}"#
        );
    }

    #[test]
    fn every_sequence_taken_is_larger_than_the_one_before_it() {
        let first = next_tail_sequence();
        let second = next_tail_sequence();

        assert!(
            first >= 1,
            "sequences start at 1 so 0 can mean none applied"
        );
        assert!(second > first);
    }

    #[derive(Default)]
    struct RecordingEventSink {
        events: Mutex<Vec<(String, serde_json::Value)>>,
    }

    impl RecordingEventSink {
        fn tail_events(&self) -> Vec<serde_json::Value> {
            self.events
                .lock()
                .expect("event log")
                .iter()
                .filter(|(name, _)| name == PLUGIN_TAIL_CHANGED_EVENT)
                .map(|(_, payload)| payload.clone())
                .collect()
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

    /// Hold the instance's audio seam, start a visit that waits on it, run
    /// `meanwhile` (standing in for what the unload and the successor's load do
    /// during that wait), release the seam, and return the tail events the visit
    /// emitted.
    fn tail_events_of_a_visit_that_waits_on_the_seam(
        meanwhile: impl FnOnce(&SharedHostedPlugin),
    ) -> Vec<serde_json::Value> {
        let _guard = crate::host::hint_test_support::guard();
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Tail Fixture", Vec::new(), false);
        wrapper
            .engine_owned_command_fixture_host_state()
            .mark_tail_dirty();
        let runtime = Arc::new(SharedHostedPlugin::new(wrapper.into()));
        let mut map = HashMap::new();
        map.insert(
            "inst-1".to_string(),
            EnginePluginInstanceData {
                engine_plugin_id: 11,
                runtime: Arc::clone(&runtime),
                name: "Tail Fixture".to_string(),
                parameters: Vec::new(),
                has_gui: false,
                chain_kind: DeviceKind::Effect,
                parameter_events: None,
                load_resolution: crate::commands::plugins::VettedRegistryEntry::fixture(),
            },
        );
        let engine_plugins: EnginePlugins = Arc::new(Mutex::new(map));
        let sink = Arc::new(RecordingEventSink::default());
        let seam = runtime
            .try_claim_control()
            .expect("an idle fixture's access seam is free");

        let ticking_sink = Arc::clone(&sink);
        let (started, ticking_started) = std::sync::mpsc::channel();
        let ticker = std::thread::spawn(move || {
            started.send(()).expect("the test is listening");
            // A deadline only the release below can beat.
            publish_pending_tail_changes_within(
                Duration::from_secs(10),
                &engine_plugins,
                ticking_sink.as_ref(),
            );
        });
        ticking_started
            .recv_timeout(Duration::from_secs(2))
            .expect("the ticker starts");
        // Let the ticker reach the seam wait; a stall that delays it past the
        // lifecycle change can only make a test pass vacuously, never fail.
        std::thread::sleep(Duration::from_millis(50));
        meanwhile(&runtime);
        drop(seam);
        ticker.join().expect("the visit finishes");

        sink.tail_events()
    }

    /// An unload retires the runtime and a same-id successor then seeds the
    /// frontend with its own load number. A predecessor still waiting on the
    /// seam numbers its figure above that seed, and the frontend would apply it
    /// to the successor, so a retired runtime's figure is not published.
    #[test]
    fn a_retired_instances_tail_figure_is_not_published() {
        let events = tail_events_of_a_visit_that_waits_on_the_seam(|runtime| {
            runtime.begin_unload();
            runtime.retire();
            // The successor's load number.
            next_tail_sequence();
        });

        assert_eq!(
            events,
            Vec::<serde_json::Value>::new(),
            "a figure numbered after the instance was retired must not reach the frontend"
        );
    }

    /// A cancelled unload leaves the instance live; its figure still publishes,
    /// so the refusal above is about retirement and not about any lifecycle move.
    #[test]
    fn a_cancelled_unloads_tail_figure_is_still_published() {
        let events = tail_events_of_a_visit_that_waits_on_the_seam(|runtime| {
            runtime.begin_unload();
            runtime.cancel_unload();
            next_tail_sequence();
        });

        assert_eq!(events.len(), 1, "the live instance's figure is published");
    }
}
