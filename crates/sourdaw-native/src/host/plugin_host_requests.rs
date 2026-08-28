//! Push path for the asks a hosted plugin makes from inside its own callbacks.
//!
//! A plugin resizes its editor by calling `clap_host_gui.request_resize()`,
//! reports that its own state changed by calling `clap_host_state.mark_dirty()`,
//! and announces that its parameter contract moved by calling
//! `clap_host_params.rescan()`. Inside any of those the host may touch neither a
//! window server nor the project and may not re-enter the plugin, so the backend
//! records the ask and wakes this watcher.
//!
//! The watcher is a dedicated non-RT thread that blocks in `recv()` until a
//! plugin actually asks, then carries the follow-up out through the
//! `SharedHostedPlugin` control seam: a recorded editor size is replayed at the
//! host window seam the editor was opened with, a recorded state change becomes
//! a `plugin-state-dirty` event the project's dirty tracking listens for, and a
//! rescan re-enumerates the parameter contract and becomes
//! `plugin-parameters-rescanned`. Same shape as the latency watcher, and for the
//! same reason — nothing polls, so an idle session does no work at all.
//!
//! ## What may be routed through this wake
//!
//! The wake allocates: it copies the instance id and takes a channel node. So an
//! ask belongs here only if the thread a plugin may raise it on is one that may
//! allocate — and CLAP does not supply that wholesale, it is a check each ask
//! must be made against by its own annotation. `mark_dirty` and `params.rescan`
//! are `[main-thread]` and pass it. `params.request_flush` is `[thread-safe]`,
//! so a plugin may raise it from inside `process()`; it fails the check and does
//! not come here at all, being recorded as a flag and answered by the
//! parameter-event drain — see [`crate::host::plugin_parameter_events`].
//!
//! `gui.request_resize` is also `[thread-safe]`, and it does reach this wake
//! through `request_editor_resize`. That predates the check and is not addressed
//! here.
//!
//! It serves engine-owned instances only, which is where the wake is installed.
//! An instance the native engine never took records a state change nothing
//! reads, and its `request_resize` is refused outright rather than accepted and
//! dropped. That mode processes no audio at all — it is what a session runs in
//! when the engine failed to start — so an edit made in it has no take to be
//! saved with.

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

/// Wire event name. The TS listener mirrors this string verbatim — never rename.
pub const PLUGIN_PARAMETERS_RESCANNED_EVENT: &str = "plugin-parameters-rescanned";

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

/// Payload of `plugin-parameters-rescanned`. snake_case on the wire, matching
/// the other plugin DTOs.
///
/// It names the instance and nothing else, for the same reason the re-read
/// happens through the existing command: the parameter list has exactly one wire
/// shape, and a second copy carried on this event could disagree with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PluginParametersRescanned {
    pub instance_id: String,
}

/// How many times one ask may be carried out. Small on purpose: the retries
/// exist for a control path momentarily held by the audio thread, and each one
/// already waits [`CONTROL_TIMEOUT`] before it gives up.
const MAX_FOLLOW_UP_ATTEMPTS: u8 = 3;

/// One queued ask: which instance made it, what it was, and how many times it
/// has already been carried to the plugin.
type QueuedRequest = (String, PluginHostRequest, u8);

/// Set once, when the watcher thread starts. `None` until then.
static REQUEST_SENDER: OnceLock<Sender<QueuedRequest>> = OnceLock::new();

type EnginePlugins = Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>;

/// Wake the watcher for one ask by `instance_id`.
///
/// Called from the plugin's own callback thread. Never blocks (the channel is
/// unbounded) and is a no-op before the watcher starts, so a plugin loaded in a
/// headless or test build records its ask and nothing else happens.
///
/// It does allocate — the id is copied and the send takes a node. Every ask
/// routed here must therefore be one whose own CLAP annotation says the raising
/// thread may allocate; the module header states that check and which asks pass
/// it. The flag is stored before the wake, so a wake that could not be sent
/// costs a follow-up, never the record behind it.
pub fn notify_plugin_host_request(instance_id: &str, request: PluginHostRequest) {
    queue_request((instance_id.to_string(), request, 0));
}

fn queue_request(queued: QueuedRequest) {
    if let Some(sender) = REQUEST_SENDER.get() {
        let _ = sender.send(queued);
    }
}

/// Decide whether a follow-up that could not reach the plugin should be queued
/// again.
///
/// A wake is spent whether or not the follow-up reached the plugin, and only a
/// wake drains a recorded flag — so a failure that simply returned would lose
/// the ask for good: an edit the project is never told about, or a resize the
/// plugin was already answered `true` for. Both flags are idempotent and
/// read-and-clear, so replaying one costs nothing and can only find what is
/// still there.
///
/// Retried only while the instance still accepts public control. That is the
/// difference between a control path busy right now — the audio thread is inside
/// a block, and the next attempt finds it free — and an instance that is
/// unloading or retired, which will refuse every attempt until the budget runs
/// out and is never coming back.
fn should_retry_follow_up(attempt: u8, control_still_allowed: bool) -> bool {
    control_still_allowed && attempt + 1 < MAX_FOLLOW_UP_ATTEMPTS
}

/// Carry one queued ask out, and say what belongs back on the queue.
///
/// The whole body of the watcher loop, with the two things it needs from a live
/// instance passed in: `carry` runs the follow-up, `control_still_allowed` reads
/// the lifecycle. Split that way so the retry can be driven to its end — a
/// failure replayed and then succeeding, and a run of failures giving up — which
/// a test cannot do against a real control lock it has no way to hold.
fn serve_queued_request(
    queued: QueuedRequest,
    carry: impl FnOnce(&str, PluginHostRequest) -> Result<(), String>,
    control_still_allowed: impl FnOnce() -> bool,
) -> Option<QueuedRequest> {
    let (instance_id, request, attempt) = queued;

    if carry(&instance_id, request).is_ok() {
        return None;
    }

    should_retry_follow_up(attempt, control_still_allowed()).then_some((
        instance_id,
        request,
        attempt + 1,
    ))
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
/// the frontend neither asked for it nor owns that window. Reports whether the
/// follow-up reached the plugin, which is what decides a retry.
fn apply_editor_resize(runtime: &SharedHostedPlugin, instance_id: &str) -> Result<(), String> {
    let applied = runtime.with_control(CONTROL_TIMEOUT, |plugin| {
        Ok(plugin.apply_pending_editor_resize())
    });

    if let Err(error) = &applied {
        eprintln!(
            "[Plugin] editor resize failed for instance {}: {}",
            instance_id, error
        );
    }

    applied.map(|_| ())
}

/// Re-enumerate the plugin's parameters and tell the frontend its metadata moved.
///
/// The plugin calls `clap_host_params.rescan()` after it renames, rescales or
/// re-declares a control — a preset load is the usual cause — and the host's
/// cached list is what the automation menu and lane range resolution read. The
/// re-enumeration happens here, on the control path, because reading a
/// parameter contract is `[main-thread]` in CLAP and this is the only thread
/// that may.
///
/// The event names the instance and nothing else: the frontend re-reads the
/// list through the command it already has, so one parameter DTO stays on the
/// wire rather than two that can disagree.
fn rescan_parameters(
    runtime: &SharedHostedPlugin,
    instance_id: &str,
    engine_plugins: &EnginePlugins,
    events: &dyn EventSink,
) -> Result<(), String> {
    let rescanned = runtime.with_control(CONTROL_TIMEOUT, |plugin| {
        if !plugin.take_parameters_rescan() {
            return Ok(None);
        }
        Ok(Some(plugin.get_parameters()))
    });
    let reached_plugin = rescanned.as_ref().map(|_| ()).map_err(String::clone);

    if let Some(parameters) = rescanned_parameters(instance_id, rescanned) {
        cache_parameters(engine_plugins, instance_id, parameters);
        events.emit(
            PLUGIN_PARAMETERS_RESCANNED_EVENT,
            PluginParametersRescanned {
                instance_id: instance_id.to_string(),
            },
        );
    }

    reached_plugin
}

/// Decide what one rescan wake should publish and cache.
///
/// Split out from the follow-up so the rule is testable without a live plugin
/// or an event sink. Only a re-enumeration that actually happened publishes: a
/// wake whose flag another visit already consumed has nothing to report, and a
/// follow-up that never reached the plugin must not replace the cached contract
/// with one it could not read — the automation menu would then offer names and
/// ranges out of nowhere.
pub fn rescanned_parameters(
    instance_id: &str,
    rescanned: Result<Option<Vec<daw_plugin_host::PluginParameter>>, String>,
) -> Option<Vec<daw_plugin_host::PluginParameter>> {
    match rescanned {
        Ok(parameters) => parameters,
        Err(error) => {
            eprintln!(
                "[Plugin] parameter rescan failed for instance {}: {}",
                instance_id, error
            );
            None
        }
    }
}

/// Replace the parameter list held on an instance record.
///
/// A miss is ordinary — the instance unloaded between the re-enumeration and
/// this write — and a poisoned lock is reported once rather than panicking a
/// watcher every other instance still depends on.
fn cache_parameters(
    engine_plugins: &EnginePlugins,
    instance_id: &str,
    parameters: Vec<daw_plugin_host::PluginParameter>,
) {
    let Ok(mut guard) = engine_plugins.lock() else {
        eprintln!(
            "[Plugin] parameter rescan failed to lock engine_plugins for instance {instance_id}"
        );
        return;
    };
    if let Some(instance) = guard.get_mut(instance_id) {
        instance.parameters = parameters;
    }
}

/// Take the plugin's state-change flag and emit it, reporting whether the
/// follow-up reached the plugin at all — which is what decides a retry, and is a
/// different question from whether there was a flag to take.
fn report_state_change(
    runtime: &SharedHostedPlugin,
    instance_id: &str,
    events: &dyn EventSink,
) -> Result<(), String> {
    let taken = runtime.with_control(CONTROL_TIMEOUT, |plugin| Ok(plugin.take_state_dirty()));
    let reached_plugin = taken.as_ref().map(|_| ()).map_err(String::clone);

    if let Some(payload) = state_dirty_payload(instance_id, taken) {
        events.emit(PLUGIN_STATE_DIRTY_EVENT, payload);
    }

    reached_plugin
}

/// Start the watcher thread. Idempotent: a second call is ignored, so the sender
/// installed by the first `start` stays the one the host callbacks reach.
pub fn start(events: Arc<dyn EventSink>, engine_plugins: EnginePlugins) {
    let (sender, receiver) = channel::<QueuedRequest>();
    if REQUEST_SENDER.set(sender).is_err() {
        return;
    }

    let spawned = std::thread::Builder::new()
        .name("plugin-host-requests".to_string())
        .spawn(move || {
            // Blocks until a plugin asks. The static sender is never dropped, so
            // this loop lives for the process.
            while let Ok(queued) = receiver.recv() {
                let Some(runtime) =
                    runtime_for_instance(&engine_plugins, &queued.0, "plugin host request")
                else {
                    // Unloaded between the plugin's callback and this wake.
                    continue;
                };

                let again = serve_queued_request(
                    queued,
                    |instance_id, request| match request {
                        PluginHostRequest::EditorResize => {
                            apply_editor_resize(&runtime, instance_id)
                        }
                        PluginHostRequest::StateDirty => {
                            report_state_change(&runtime, instance_id, &*events)
                        }
                        PluginHostRequest::ParametersRescan => {
                            rescan_parameters(&runtime, instance_id, &engine_plugins, &*events)
                        }
                    },
                    || runtime.ensure_public_control_allowed().is_ok(),
                );

                if let Some(queued) = again {
                    queue_request(queued);
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

        assert!(
            apply_editor_resize(&runtime, "inst-1").is_err(),
            "an instance that refuses public control cannot have been resized"
        );
    }

    /// The wake is spent by the attempt that failed, and only a wake drains the
    /// flag — so without the replay the signal behind it is gone for good.
    #[test]
    fn a_follow_up_that_could_not_reach_a_live_plugin_is_carried_back_to_the_queue() {
        assert!(should_retry_follow_up(0, true));
    }

    /// The retries are for a control path held right now. A refusal is a
    /// lifecycle state, identical on every attempt, so replaying against it only
    /// spends the budget.
    #[test]
    fn a_follow_up_for_an_instance_that_refuses_control_is_not_retried() {
        let wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Request Fixture", vec![], true);
        let runtime: SharedHostedPlugin = SharedHostedPlugin::new(wrapper.into());
        runtime.begin_unload();

        assert!(!should_retry_follow_up(
            0,
            runtime.ensure_public_control_allowed().is_ok()
        ));
    }

    /// Drive the watcher's own loop over a local queue, with a follow-up that
    /// fails `failures` times before it succeeds. Returns how many times the
    /// follow-up actually ran — one per pass, so it counts the replays too.
    fn drive_queue_until_settled(failures: usize) -> usize {
        let mut queue = vec![("inst-1".to_string(), PluginHostRequest::StateDirty, 0u8)];
        let mut carried = 0usize;

        while let Some(queued) = queue.pop() {
            let again = serve_queued_request(
                queued,
                |_, _| {
                    carried += 1;
                    if carried <= failures {
                        return Err("Timed out waiting for plugin control access".to_string());
                    }
                    Ok(())
                },
                || true,
            );

            if let Some(queued) = again {
                queue.push(queued);
            }
        }

        carried
    }

    /// The signal behind a failed follow-up is still recorded, so the ask has to
    /// run again — and actually reach the plugin when it does.
    #[test]
    fn a_replayed_ask_runs_again_and_settles_once_it_reaches_the_plugin() {
        assert_eq!(
            drive_queue_until_settled(1),
            2,
            "one failure must be followed by exactly one more run, which succeeds"
        );
    }

    /// The replays are bounded, or an instance whose control path never frees up
    /// would spin the watcher for the life of the process and starve every other
    /// instance's asks behind it.
    #[test]
    fn a_follow_up_that_keeps_failing_stops_at_the_attempt_budget() {
        assert_eq!(
            drive_queue_until_settled(usize::MAX),
            usize::from(MAX_FOLLOW_UP_ATTEMPTS),
            "a never-succeeding ask runs exactly the budget and then stops"
        );
    }

    /// A follow-up that reached the plugin is finished, whatever it found there:
    /// re-queueing a success would replay it forever.
    #[test]
    fn a_follow_up_that_reached_the_plugin_is_not_queued_again() {
        assert_eq!(drive_queue_until_settled(0), 1);
    }

    #[test]
    fn replaying_one_ask_stops_at_the_attempt_budget() {
        assert!(
            should_retry_follow_up(MAX_FOLLOW_UP_ATTEMPTS - 2, true),
            "the budget must allow more than the first attempt"
        );
        assert!(!should_retry_follow_up(MAX_FOLLOW_UP_ATTEMPTS - 1, true));
    }

    fn fixture_parameter(id: u32) -> daw_plugin_host::PluginParameter {
        daw_plugin_host::PluginParameter {
            id,
            name: "Cutoff".to_string(),
            value: 0.5,
            default_value: 0.5,
            min_value: 0.0,
            max_value: 1.0,
            unit: None,
            is_automatable: true,
        }
    }

    /// `PluginParameter` carries no `PartialEq`, so the identity the caller
    /// actually caches — the parameter ids, in order — is what these compare.
    fn published_ids(published: Option<Vec<daw_plugin_host::PluginParameter>>) -> Option<Vec<u32>> {
        published.map(|parameters| {
            parameters
                .into_iter()
                .map(|parameter| parameter.id)
                .collect()
        })
    }

    #[test]
    fn a_rescan_that_read_the_plugin_publishes_the_list_it_read() {
        assert_eq!(
            published_ids(rescanned_parameters(
                "inst-1",
                Ok(Some(vec![fixture_parameter(3)]))
            )),
            Some(vec![3])
        );
    }

    /// The wake and the flag are separate by construction, so a duplicate wake —
    /// or one whose flag another control-path visit already consumed — arrives
    /// with nothing behind it.
    #[test]
    fn a_rescan_wake_with_no_recorded_flag_publishes_nothing() {
        assert_eq!(
            published_ids(rescanned_parameters("inst-1", Ok(None))),
            None
        );
    }

    /// Caching a list the host could not read would have the automation menu
    /// offer names and ranges no plugin ever reported.
    #[test]
    fn a_failed_rescan_leaves_the_cached_contract_standing() {
        assert_eq!(
            published_ids(rescanned_parameters(
                "inst-1",
                Err("control path timed out".to_string())
            )),
            None,
            "a failed re-enumeration must not replace a contract it could not read"
        );
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

    /// One engine-owned instance in a real map, holding a fixture that reports
    /// `parameters` and has already raised `clap_host_params.rescan()` if
    /// `asked_for_a_rescan`.
    fn rescan_fixture(
        parameters: Vec<daw_plugin_host::PluginParameter>,
        asked_for_a_rescan: bool,
    ) -> (EnginePlugins, Arc<SharedHostedPlugin>) {
        let mut wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Rescan Fixture", vec![], false);
        wrapper.set_engine_owned_command_fixture_parameters(parameters);
        if asked_for_a_rescan {
            wrapper
                .engine_owned_command_fixture_host_state()
                .mark_parameters_rescan();
        }

        let runtime = Arc::new(SharedHostedPlugin::new(wrapper.into()));
        let mut map = HashMap::new();
        map.insert(
            "inst-1".to_string(),
            EnginePluginInstanceData {
                engine_plugin_id: 11,
                runtime: Arc::clone(&runtime),
                name: "Rescan Fixture".to_string(),
                parameters: vec![fixture_parameter(1)],
                has_gui: false,
                bridge: None,
                relay_scratch: crate::state::PluginRelayScratch::default(),
                parameter_events: None,
            },
        );

        (Arc::new(Mutex::new(map)), runtime)
    }

    fn cached_ids(engine_plugins: &EnginePlugins, instance_id: &str) -> Vec<u32> {
        engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .get(instance_id)
            .expect("the instance is in the map")
            .parameters
            .iter()
            .map(|parameter| parameter.id)
            .collect()
    }

    /// The cached list is what the automation menu and lane range resolution
    /// read, so a rescan that published its event without replacing the cache
    /// would leave every caller on the contract the plugin just abandoned.
    #[test]
    fn a_rescan_replaces_the_cached_contract_and_tells_the_frontend_to_re_read_it() {
        let (engine_plugins, runtime) = rescan_fixture(vec![fixture_parameter(3)], true);
        let sink = RecordingEventSink::default();

        assert!(rescan_parameters(&runtime, "inst-1", &engine_plugins, &sink).is_ok());

        assert_eq!(cached_ids(&engine_plugins, "inst-1"), vec![3]);
        assert_eq!(
            sink.events(),
            vec![(
                PLUGIN_PARAMETERS_RESCANNED_EVENT.to_string(),
                serde_json::json!({ "instance_id": "inst-1" }),
            )]
        );
    }

    /// A wake whose flag another visit already consumed must leave both alone: a
    /// re-read nobody asked for would replace the cache on every duplicate wake
    /// and have the frontend re-fetch for no change.
    #[test]
    fn a_rescan_wake_with_no_flag_behind_it_leaves_the_cache_and_the_frontend_alone() {
        let (engine_plugins, runtime) = rescan_fixture(vec![fixture_parameter(3)], false);
        let sink = RecordingEventSink::default();

        assert!(rescan_parameters(&runtime, "inst-1", &engine_plugins, &sink).is_ok());

        assert_eq!(cached_ids(&engine_plugins, "inst-1"), vec![1]);
        assert_eq!(sink.events(), Vec::new());
    }

    #[test]
    fn the_rescan_payload_serialises_with_the_snake_case_wire_name_the_frontend_reads() {
        let json = serde_json::to_string(&PluginParametersRescanned {
            instance_id: "inst-7".to_string(),
        })
        .expect("payload serialises");

        assert_eq!(json, r#"{"instance_id":"inst-7"}"#);
    }

    #[test]
    fn notifying_before_the_watcher_starts_is_a_no_op() {
        // The sender is only installed by `start`, which no unit test runs; this
        // asserts a plugin loaded in a headless build cannot panic on its wake.
        notify_plugin_host_request("never-started", PluginHostRequest::StateDirty);
    }
}
