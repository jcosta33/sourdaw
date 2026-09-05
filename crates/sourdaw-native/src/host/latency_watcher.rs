//! Push path for CLAP runtime latency changes (PH-4).
//!
//! A hosted plugin announces a latency change by calling
//! `clap_host_latency.changed()` or `clap_host.request_restart()`. Those
//! callbacks run on the plugin's own thread and must not deactivate the plugin
//! re-entrantly, so they cannot do the work themselves — they only wake this
//! watcher.
//!
//! The watcher is a dedicated non-RT thread that blocks in `recv()` until a
//! plugin actually flags, then performs the deactivate / reactivate / re-query
//! through the `SharedHostedPlugin` control seam, emits `plugin-latency-changed`
//! to the webview and aims the graph's compensation at the new figure. Nothing
//! polls: an idle session does no work at all, and a plugin that changes latency
//! mid-session reaches both the frontend and the mix without the UI having to
//! ask.

use crate::events::{EventSink, EventSinkExt};
use crate::host::native_bridge::LatencyChange;
use crate::host::runtime_for_instance;
use crate::state::EnginePluginInstanceData;
use daw_engine::EngineHandle;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Wire event name. The TS listener mirrors this string verbatim — never rename.
pub const PLUGIN_LATENCY_CHANGED_EVENT: &str = "plugin-latency-changed";

/// How long a latency re-query may wait for the RT path to release the plugin.
/// Matches the timeout every other control-path command uses.
const CONTROL_TIMEOUT: Duration = Duration::from_secs(2);

/// Payload of `plugin-latency-changed`. snake_case on the wire, matching the
/// other plugin DTOs (`PluginInstance`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PluginLatencyChanged {
    pub instance_id: String,
    /// Latency in milliseconds, converted host-side at the sample rate the plugin
    /// was activated with. The webview runs its `AudioContext` on a different
    /// clock and cannot convert a sample count correctly, so samples never cross
    /// this boundary.
    pub latency_ms: f64,
}

/// Set once, when the watcher thread starts. `None` until then.
static LATENCY_CHANGE_SENDER: OnceLock<Sender<String>> = OnceLock::new();

type EnginePlugins = Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>;
type Engine = Arc<Mutex<Option<EngineHandle>>>;

/// What one wake owes the graph: the effect whose delay compensation is now
/// wrong, and the latency to aim it at.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LatencyCompensation {
    pub effect_id: usize,
    pub latency_frames: usize,
}

/// Wake the watcher for `instance_id`.
///
/// Called from the CLAP host callback thread. Never blocks (the channel is
/// unbounded) and is a no-op before the watcher starts, so a plugin loaded in a
/// headless/test build simply flags its dirty bit and nothing else happens.
pub fn notify_latency_change(instance_id: &str) {
    if let Some(sender) = LATENCY_CHANGE_SENDER.get() {
        let _ = sender.send(instance_id.to_string());
    }
}

/// Decide what one wake should emit.
///
/// Split out from the thread body so the emit rule is testable without a live
/// plugin or an event sink: only a real change emits; an unchanged poll and a
/// failed re-query emit nothing (a failure must not publish a fabricated
/// latency, which would corrupt compensation on every track using the plugin).
pub fn latency_change_payload(
    instance_id: &str,
    refreshed: &Result<Option<LatencyChange>, String>,
) -> Option<PluginLatencyChanged> {
    match refreshed {
        Ok(Some(change)) => Some(PluginLatencyChanged {
            instance_id: instance_id.to_string(),
            latency_ms: change.latency_ms,
        }),
        Ok(None) => None,
        Err(error) => {
            eprintln!(
                "[Plugin] latency re-query failed for instance {}: {}",
                instance_id, error
            );
            None
        }
    }
}

/// Decide what one wake should compensate.
///
/// The same three-way rule the event follows, plus the engine's own condition:
/// an instance the graph does not hold has no effect to aim, so it compensates
/// nothing rather than addressing an id the effect table never took. Silent on
/// failure because [`latency_change_payload`] already reported that poll —
/// one failed re-query is one diagnostic.
pub fn latency_compensation(
    engine_plugin_id: Option<usize>,
    refreshed: &Result<Option<LatencyChange>, String>,
) -> Option<LatencyCompensation> {
    let Ok(Some(change)) = refreshed else {
        return None;
    };
    Some(LatencyCompensation {
        effect_id: engine_plugin_id?,
        latency_frames: change.latency_frames,
    })
}

/// The instance's effect id, re-read after the poll rather than carried across
/// it: the control visit waits up to [`CONTROL_TIMEOUT`], and an instance
/// unloaded inside that window must not have a retired effect compensated.
fn engine_plugin_id(engine_plugins: &EnginePlugins, instance_id: &str) -> Option<usize> {
    let guard = engine_plugins.lock().ok()?;
    guard
        .get(instance_id)
        .map(|instance| instance.engine_plugin_id)
}

/// Aim the graph's dry-delay line for one effect at its new latency.
///
/// Failures are reported and not retried: the instance stays registered and
/// sounding, mixed at its old compensation until its next latency change. A
/// worse mix rather than a broken one.
fn publish_compensation(engine: &Engine, instance_id: &str, compensation: LatencyCompensation) {
    let mut guard = match engine.lock() {
        Ok(guard) => guard,
        Err(error) => {
            eprintln!("[Plugin] latency watcher failed to lock the engine: {error}");
            return;
        }
    };
    // No engine yet means no graph holds this effect: the activation path
    // publishes the latency when one is built.
    let Some(engine) = guard.as_mut() else {
        return;
    };
    if let Err(error) =
        engine.set_effect_latency(compensation.effect_id, compensation.latency_frames)
    {
        eprintln!("[Plugin] failed to compensate instance {instance_id}: {error}");
    }
}

/// Start the watcher thread. Idempotent: a second call is ignored, so the sender
/// installed by the first `start` stays the one the host callbacks reach.
pub fn start(events: Arc<dyn EventSink>, engine_plugins: EnginePlugins, engine: Engine) {
    let (sender, receiver) = channel::<String>();
    if LATENCY_CHANGE_SENDER.set(sender).is_err() {
        return;
    }

    let spawned = std::thread::Builder::new()
        .name("clap-latency-watcher".to_string())
        .spawn(move || {
            // Blocks until a plugin flags. The static sender is never dropped, so
            // this loop lives for the process.
            while let Ok(instance_id) = receiver.recv() {
                let Some(runtime) = runtime_for_instance(&engine_plugins, &instance_id, "latency")
                else {
                    // Unloaded between the plugin's callback and this wake.
                    continue;
                };
                let refreshed = runtime.poll_latency_change(CONTROL_TIMEOUT);
                if let Some(payload) = latency_change_payload(&instance_id, &refreshed) {
                    events.emit(PLUGIN_LATENCY_CHANGED_EVENT, payload);
                }
                // After the event: the frontend's own latency read is what a
                // user waits on, and the graph command is a push onto a ring
                // the audio thread drains on its own schedule anyway.
                let compensation = latency_compensation(
                    engine_plugin_id(&engine_plugins, &instance_id),
                    &refreshed,
                );
                if let Some(compensation) = compensation {
                    publish_compensation(&engine, &instance_id, compensation);
                }
            }
        });

    if let Err(error) = spawned {
        eprintln!(
            "[Plugin] failed to start the CLAP latency watcher: {}",
            error
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn changed(latency_ms: f64, latency_frames: usize) -> Result<Option<LatencyChange>, String> {
        Ok(Some(LatencyChange {
            latency_ms,
            latency_frames,
        }))
    }

    #[test]
    fn a_changed_latency_becomes_an_event_payload_carrying_milliseconds() {
        let payload = latency_change_payload("inst-1", &changed(10.0, 441));

        assert_eq!(
            payload,
            Some(PluginLatencyChanged {
                instance_id: "inst-1".to_string(),
                latency_ms: 10.0,
            })
        );
    }

    #[test]
    fn an_unchanged_poll_emits_nothing() {
        assert_eq!(latency_change_payload("inst-1", &Ok(None)), None);
    }

    #[test]
    fn a_failed_requery_emits_nothing_rather_than_a_fabricated_latency() {
        assert_eq!(
            latency_change_payload("inst-1", &Err("control path timed out".to_string())),
            None,
            "a failed re-query must not publish a latency the plugin never reported"
        );
    }

    #[test]
    fn a_changed_latency_compensates_the_instances_effect_with_the_new_frame_count() {
        assert_eq!(
            latency_compensation(Some(7), &changed(10.0, 441)),
            Some(LatencyCompensation {
                effect_id: 7,
                latency_frames: 441,
            })
        );
    }

    #[test]
    fn an_unchanged_poll_compensates_nothing() {
        assert_eq!(latency_compensation(Some(7), &Ok(None)), None);
    }

    #[test]
    fn a_failed_requery_compensates_nothing_rather_than_a_fabricated_latency() {
        assert_eq!(
            latency_compensation(Some(7), &Err("control path timed out".to_string())),
            None,
            "a failed re-query must not aim a delay line at a latency the plugin never reported"
        );
    }

    #[test]
    fn one_polled_change_both_emits_the_event_and_compensates_the_effect() {
        let refreshed = changed(14.5, 640);

        assert_eq!(
            latency_change_payload("inst-9", &refreshed),
            Some(PluginLatencyChanged {
                instance_id: "inst-9".to_string(),
                latency_ms: 14.5,
            })
        );
        assert_eq!(
            latency_compensation(Some(3), &refreshed),
            Some(LatencyCompensation {
                effect_id: 3,
                latency_frames: 640,
            })
        );
    }

    #[test]
    fn a_change_on_an_instance_the_graph_does_not_hold_emits_the_event_and_compensates_nothing() {
        let refreshed = changed(14.5, 640);

        assert!(
            latency_change_payload("inst-9", &refreshed).is_some(),
            "the panel still shows the plugin's own reported latency"
        );
        assert_eq!(
            latency_compensation(None, &refreshed),
            None,
            "an instance the graph does not hold has no effect id to address"
        );
    }

    #[test]
    fn the_payload_serialises_with_the_snake_case_wire_names_the_frontend_reads() {
        let json = serde_json::to_string(&PluginLatencyChanged {
            instance_id: "inst-7".to_string(),
            latency_ms: 2.5,
        })
        .expect("payload serialises");

        assert_eq!(json, r#"{"instance_id":"inst-7","latency_ms":2.5}"#);
    }

    #[test]
    fn notifying_before_the_watcher_starts_is_a_no_op() {
        // The sender is only installed by `start`, which no unit test runs; this
        // asserts a plugin loaded in a headless build cannot panic on its wake.
        notify_latency_change("never-started");
    }
}
