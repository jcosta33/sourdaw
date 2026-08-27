//! Push path for the asks a hosted plugin makes from inside its own callbacks.
//!
//! A plugin resizes its editor by calling `clap_host_gui.request_resize()`, and
//! reports that its own state changed by calling `clap_host_state.mark_dirty()`.
//! Both run on the plugin's thread, where the host may touch neither a window
//! server nor the project, so the backend records the ask and wakes this
//! watcher.
//!
//! The watcher is a dedicated non-RT thread that blocks in `recv()` until a
//! plugin actually asks, then carries the follow-up out through the
//! `SharedHostedPlugin` control seam: a recorded editor size is replayed at the
//! host window seam the editor was opened with, and a recorded state change
//! becomes a `plugin-state-dirty` event the project's dirty tracking listens
//! for. Same shape as the latency watcher, and for the same reason — nothing
//! polls, so an idle session does no work at all.

use crate::events::{EventSink, EventSinkExt};
use crate::host::native_bridge::SharedHostedPlugin;
use crate::host::runtime_for_instance;
use crate::state::EnginePluginInstanceData;
use daw_plugin_host::{AudioPlugin, PluginHostRequest};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Wire event name. The TS listener mirrors this string verbatim — never rename.
pub const PLUGIN_STATE_DIRTY_EVENT: &str = "plugin-state-dirty";

/// How long a follow-up may wait for the RT path to release the plugin. Matches
/// the timeout every other control-path command uses.
const CONTROL_TIMEOUT: Duration = Duration::from_secs(2);

/// Payload of `plugin-state-dirty`. snake_case on the wire, matching the other
/// plugin DTOs.
///
/// It names the instance and nothing else on purpose: the plugin reports *that*
/// its state changed, never what changed, and describing the change here would
/// be a claim the plugin never made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PluginStateDirty {
    pub instance_id: String,
}

/// Set once, when the watcher thread starts. `None` until then.
static REQUEST_SENDER: OnceLock<Sender<(String, PluginHostRequest)>> = OnceLock::new();

type EnginePlugins = Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>;

/// Wake the watcher for one ask by `instance_id`.
///
/// Called from the plugin's own callback thread. Never blocks (the channel is
/// unbounded) and is a no-op before the watcher starts, so a plugin loaded in a
/// headless or test build records its ask and nothing else happens.
pub fn notify_plugin_host_request(instance_id: &str, request: PluginHostRequest) {
    if let Some(sender) = REQUEST_SENDER.get() {
        let _ = sender.send((instance_id.to_string(), request));
    }
}

/// Decide what one state-change wake should emit.
///
/// Split out from the thread body so the emit rule is testable without a live
/// plugin or an event sink. Only a signal the backend actually gave up emits: a
/// wake whose flag another control-path visit already consumed has nothing to
/// report, and a follow-up that never reached the plugin must not claim an edit
/// it could not confirm — a fabricated dirty mark makes the project ask to be
/// saved over work the user never did.
pub fn state_dirty_payload(
    instance_id: &str,
    taken: Result<bool, String>,
) -> Option<PluginStateDirty> {
    match taken {
        Ok(true) => Some(PluginStateDirty {
            instance_id: instance_id.to_string(),
        }),
        Ok(false) => None,
        Err(error) => {
            eprintln!(
                "[Plugin] state-change follow-up failed for instance {}: {}",
                instance_id, error
            );
            None
        }
    }
}

/// Replay the size the plugin asked for at the window its editor is drawn into.
///
/// Nothing is emitted: the answer to a resize is the window changing size, and
/// the frontend neither asked for it nor owns that window.
fn apply_editor_resize(runtime: &SharedHostedPlugin, instance_id: &str) {
    let applied = runtime.with_control(CONTROL_TIMEOUT, |plugin| {
        Ok(plugin.apply_pending_editor_resize())
    });

    if let Err(error) = applied {
        eprintln!(
            "[Plugin] editor resize failed for instance {}: {}",
            instance_id, error
        );
    }
}

/// Start the watcher thread. Idempotent: a second call is ignored, so the sender
/// installed by the first `start` stays the one the host callbacks reach.
pub fn start(events: Arc<dyn EventSink>, engine_plugins: EnginePlugins) {
    let (sender, receiver) = channel::<(String, PluginHostRequest)>();
    if REQUEST_SENDER.set(sender).is_err() {
        return;
    }

    let spawned = std::thread::Builder::new()
        .name("plugin-host-requests".to_string())
        .spawn(move || {
            // Blocks until a plugin asks. The static sender is never dropped, so
            // this loop lives for the process.
            while let Ok((instance_id, request)) = receiver.recv() {
                let Some(runtime) =
                    runtime_for_instance(&engine_plugins, &instance_id, "plugin host request")
                else {
                    // Unloaded between the plugin's callback and this wake.
                    continue;
                };

                match request {
                    PluginHostRequest::EditorResize => {
                        apply_editor_resize(&runtime, &instance_id);
                    }
                    PluginHostRequest::StateDirty => {
                        let taken = runtime
                            .with_control(CONTROL_TIMEOUT, |plugin| Ok(plugin.take_state_dirty()));
                        if let Some(payload) = state_dirty_payload(&instance_id, taken) {
                            events.emit(PLUGIN_STATE_DIRTY_EVENT, payload);
                        }
                    }
                }
            }
        });

    if let Err(error) = spawned {
        eprintln!(
            "[Plugin] failed to start the plugin host request watcher: {}",
            error
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use daw_plugin_host::ClapWrapper;

    #[test]
    fn a_recorded_state_change_becomes_an_event_naming_the_instance() {
        assert_eq!(
            state_dirty_payload("inst-1", Ok(true)),
            Some(PluginStateDirty {
                instance_id: "inst-1".to_string(),
            })
        );
    }

    /// The wake and the flag are separate by construction, so a duplicate wake —
    /// or one whose flag another control-path visit already consumed — arrives
    /// with nothing behind it.
    #[test]
    fn a_wake_with_no_recorded_signal_emits_nothing() {
        assert_eq!(state_dirty_payload("inst-1", Ok(false)), None);
    }

    #[test]
    fn a_failed_follow_up_emits_nothing_rather_than_a_dirty_mark_it_cannot_confirm() {
        assert_eq!(
            state_dirty_payload("inst-1", Err("control path timed out".to_string())),
            None,
            "a failed follow-up must not ask the user to save work the plugin never reported"
        );
    }

    #[test]
    fn the_payload_serialises_with_the_snake_case_wire_name_the_frontend_reads() {
        let json = serde_json::to_string(&PluginStateDirty {
            instance_id: "inst-7".to_string(),
        })
        .expect("payload serialises");

        assert_eq!(json, r#"{"instance_id":"inst-7"}"#);
    }

    /// An instance mid-unload refuses public control, and the resize follow-up
    /// has to survive that: the plugin is going away, and the watcher thread
    /// serves every other instance.
    #[test]
    fn a_resize_for_an_unloading_instance_is_dropped_rather_than_fatal() {
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Request Fixture", vec![], true);
        let runtime = SharedHostedPlugin::new(wrapper.into());
        runtime.begin_unload();

        apply_editor_resize(&runtime, "inst-1");
    }

    #[test]
    fn notifying_before_the_watcher_starts_is_a_no_op() {
        // The sender is only installed by `start`, which no unit test runs; this
        // asserts a plugin loaded in a headless build cannot panic on its wake.
        notify_plugin_host_request("never-started", PluginHostRequest::StateDirty);
    }
}
