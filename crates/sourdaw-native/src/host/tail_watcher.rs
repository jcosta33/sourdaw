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
use crate::host::{all_engine_runtimes, native_bridge::SharedHostedPlugin};
use crate::state::EnginePluginInstanceData;
use daw_plugin_host::{signal_pending_tail_change, HostedPluginRuntime};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Wire event name. The TS listener mirrors this string verbatim — never rename.
pub const PLUGIN_TAIL_CHANGED_EVENT: &str = "plugin-tail-changed";

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
    refreshed: Result<Option<u32>, String>,
) -> Option<PluginTailChanged> {
    match refreshed {
        Ok(Some(tail_samples)) => Some(PluginTailChanged {
            instance_id: instance_id.to_string(),
            tail_samples,
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

/// Raise the hint again for an instance the visit could not reach.
///
/// Only for one still accepting public control — the same rule the parameter
/// flush follows, and for the same reason: an instance unloading or retired
/// refuses every retry, and re-raising for it would turn one missed visit into a
/// tick that never sleeps.
fn retry_unreached_instance(runtime: &SharedHostedPlugin, instance_id: &str, error: &str) {
    if runtime.ensure_public_control_allowed().is_err() {
        return;
    }

    eprintln!(
        "[Plugin] tail re-read could not reach instance {}, retrying: {}",
        instance_id, error
    );
    signal_pending_tail_change();
}

/// Publish the tail every instance that flagged one reports now.
///
/// Called from the parameter-event drain's tick, once it has taken the hint.
pub fn publish_pending_tail_changes(engine_plugins: &EnginePlugins, events: &dyn EventSink) {
    for (instance_id, runtime) in all_engine_runtimes(engine_plugins, "tail re-read") {
        let refreshed =
            runtime.try_with_control(CONTROL_TIMEOUT, |plugin| Ok(plugin.take_tail_change()));

        if let Err(error) = &refreshed {
            retry_unreached_instance(&runtime, &instance_id, error);
        }

        if let Some(payload) = tail_change_payload(&instance_id, refreshed) {
            events.emit(PLUGIN_TAIL_CHANGED_EVENT, payload);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flagged_tail_becomes_an_event_payload_carrying_frames() {
        assert_eq!(
            tail_change_payload("inst-1", Ok(Some(48_000))),
            Some(PluginTailChanged {
                instance_id: "inst-1".to_string(),
                tail_samples: 48_000,
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
            tail_change_payload("inst-1", Err("control path is busy".to_string())),
            None,
            "a failed re-read must not publish a tail the plugin never reported"
        );
    }

    #[test]
    fn the_payload_serialises_with_the_snake_case_wire_names_the_frontend_reads() {
        let json = serde_json::to_string(&PluginTailChanged {
            instance_id: "inst-7".to_string(),
            tail_samples: 1024,
        })
        .expect("payload serialises");

        assert_eq!(json, r#"{"instance_id":"inst-7","tail_samples":1024}"#);
    }
}
