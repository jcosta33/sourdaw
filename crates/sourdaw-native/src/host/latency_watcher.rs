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
//! through the `SharedClapPlugin` control seam and emits `plugin-latency-changed`
//! to the webview. Nothing polls: an idle session does no work at all, and a
//! plugin that changes latency mid-session reaches the frontend without the UI
//! having to ask.

use crate::events::{EventSink, EventSinkExt};
use crate::host::native_bridge::SharedClapPlugin;
use crate::state::EnginePluginInstanceData;
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

fn runtime_for(engine_plugins: &EnginePlugins, instance_id: &str) -> Option<Arc<SharedClapPlugin>> {
    let guard = match engine_plugins.lock() {
        Ok(guard) => guard,
        Err(error) => {
            // Terminal for the push path, and invisible without this line: the
            // thread keeps recv-looping so the watcher still looks alive, while
            // every lookup misses forever and no latency change reaches the
            // frontend again. Matches how the command layer reports this lock.
            eprintln!(
                "[Plugin] latency watcher failed to lock engine_plugins for instance {}: {}",
                instance_id, error
            );
            return None;
        }
    };
    guard
        .get(instance_id)
        .map(|instance| Arc::clone(&instance.runtime))
}

/// Decide what one wake should emit.
///
/// Split out from the thread body so the emit rule is testable without a live
/// plugin or an event sink: only a real change emits; an unchanged poll and a
/// failed re-query emit nothing (a failure must not publish a fabricated
/// latency, which would corrupt compensation on every track using the plugin).
pub fn latency_change_payload(
    instance_id: &str,
    refreshed: Result<Option<f64>, String>,
) -> Option<PluginLatencyChanged> {
    match refreshed {
        Ok(Some(latency_ms)) => Some(PluginLatencyChanged {
            instance_id: instance_id.to_string(),
            latency_ms,
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

/// Start the watcher thread. Idempotent: a second call is ignored, so the sender
/// installed by the first `start` stays the one the host callbacks reach.
pub fn start(events: Arc<dyn EventSink>, engine_plugins: EnginePlugins) {
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
                let Some(runtime) = runtime_for(&engine_plugins, &instance_id) else {
                    // Unloaded between the plugin's callback and this wake.
                    continue;
                };
                let refreshed = runtime.poll_latency_change_ms(CONTROL_TIMEOUT);
                if let Some(payload) = latency_change_payload(&instance_id, refreshed) {
                    events.emit(PLUGIN_LATENCY_CHANGED_EVENT, payload);
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

    #[test]
    fn a_changed_latency_becomes_an_event_payload_carrying_milliseconds() {
        let payload = latency_change_payload("inst-1", Ok(Some(10.0)));

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
        assert_eq!(latency_change_payload("inst-1", Ok(None)), None);
    }

    #[test]
    fn a_failed_requery_emits_nothing_rather_than_a_fabricated_latency() {
        assert_eq!(
            latency_change_payload("inst-1", Err("control path timed out".to_string())),
            None,
            "a failed re-query must not publish a latency the plugin never reported"
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
