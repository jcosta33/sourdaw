//! Push path for a hosted instance the host takes out of service, or puts back.
//!
//! The host takes an instance out of service in two ways: a plugin that refuses
//! to start processing, and a VST3 plugin whose bus layout, after a restart, is
//! one the host cannot route. Either way the wrapper passes an effect's input
//! through dry (or silences an instrument) and latches the state, so without
//! this path the device slot looks healthy while it plays dry.
//!
//! ## Why this one is not a watcher thread of its own
//!
//! The refused start is latched on the audio thread, which can neither allocate
//! nor name an instance. The wrapper records the state and raises one
//! process-wide hint, and the parameter-event drain — already awake on a timer
//! for that kind of hint — hands the ask here, the same shape as
//! [`crate::host::tail_watcher`].
//!
//! The hint names no instance, so a raised hint visits every engine-owned
//! instance and each backend answers for itself: one whose service state moved
//! since it last answered reports the change, every other one reports nothing.
//! Dormant (command-owned) instances do not process and are not visited.

use crate::events::{EventSink, EventSinkExt};
use crate::host::native_bridge::{PluginControlError, PluginControlRefusal};
use crate::host::{all_engine_runtimes, retry_unreached_instance};
use crate::state::EnginePluginInstanceData;
use daw_plugin_host::{signal_pending_service_change, HostedPluginRuntime, ServiceChange};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Wire event name. Its payload type is mirrored by hand in the frontend as
/// `PluginServiceChange`.
pub const PLUGIN_SERVICE_CHANGED_EVENT: &str = "plugin-service-changed";

/// How long asking one plugin for its service change may wait for the audio
/// thread to release it.
///
/// The same reasoning, and the same figure, as the tail leg this one shares a
/// tick with. An instance that could not be reached raises the hint again
/// rather than blocking the visit to the others.
const CONTROL_TIMEOUT: Duration = Duration::from_millis(50);

/// Payload of `plugin-service-changed`. snake_case on the wire, matching the
/// other plugin DTOs.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PluginServiceChanged {
    pub instance_id: String,
    /// Why the host stopped serving the instance. `None` serialises as null and
    /// means the instance is back in service.
    pub out_of_service_reason: Option<String>,
}

type EnginePlugins = Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>;

/// Decide what one instance's answer should emit.
///
/// Split out from the visit so the emit rule is testable without a live plugin
/// or an event sink: only a change emits, and an instance the visit could not
/// reach emits nothing rather than a fabricated state.
pub fn service_change_payload(
    instance_id: &str,
    answered: Result<Option<ServiceChange>, PluginControlRefusal>,
) -> Option<PluginServiceChanged> {
    match answered {
        Ok(Some(change)) => Some(PluginServiceChanged {
            instance_id: instance_id.to_string(),
            out_of_service_reason: match change {
                ServiceChange::OutOfService { reason } => Some(reason),
                ServiceChange::BackInService => None,
            },
        }),
        Ok(None) => None,
        Err(error) => {
            eprintln!(
                "[Plugin] service change read failed for instance {}: {}",
                instance_id, error
            );
            None
        }
    }
}

/// Publish the service change every instance that moved reports now.
///
/// Called from the parameter-event drain's tick, once it has taken the hint.
pub fn publish_pending_service_changes(engine_plugins: &EnginePlugins, events: &dyn EventSink) {
    for (instance_id, runtime) in all_engine_runtimes(engine_plugins, "service change") {
        let answered = runtime
            .try_with_control(CONTROL_TIMEOUT, |plugin| {
                Ok::<_, std::convert::Infallible>(plugin.take_service_change())
            })
            .map_err(PluginControlError::into_refusal);

        if let Err(error) = &answered {
            retry_unreached_instance(
                &runtime,
                &instance_id,
                "service change",
                error,
                signal_pending_service_change,
            );
        }

        if let Some(payload) = service_change_payload(&instance_id, answered) {
            events.emit(PLUGIN_SERVICE_CHANGED_EVENT, payload);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::native_bridge::SharedHostedPlugin;
    use daw_engine::timeline::DeviceKind;
    use daw_plugin_host::{take_pending_service_change_signal, ClapWrapper};

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

    /// One engine-owned instance whose start of processing the host refused,
    /// exactly as the audio thread latches it.
    fn refused_instance() -> (EnginePlugins, Arc<SharedHostedPlugin>) {
        let mut wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Service Fixture", Vec::new(), false);
        wrapper.latch_engine_owned_command_fixture_processing_start_refusal();
        let runtime = Arc::new(SharedHostedPlugin::new(wrapper.into()));
        let mut map = HashMap::new();
        map.insert(
            "inst-1".to_string(),
            EnginePluginInstanceData {
                engine_plugin_id: 11,
                runtime: Arc::clone(&runtime),
                name: "Service Fixture".to_string(),
                parameters: Vec::new(),
                has_gui: false,
                chain_kind: DeviceKind::Effect,
                parameter_events: None,
                load_resolution: crate::commands::plugins::VettedRegistryEntry::fixture(),
            },
        );
        (Arc::new(Mutex::new(map)), runtime)
    }

    #[test]
    fn a_change_becomes_an_event_payload_carrying_its_reason() {
        assert_eq!(
            service_change_payload(
                "inst-1",
                Ok(Some(ServiceChange::OutOfService {
                    reason: "it broke".to_string()
                }))
            ),
            Some(PluginServiceChanged {
                instance_id: "inst-1".to_string(),
                out_of_service_reason: Some("it broke".to_string()),
            })
        );
        assert_eq!(
            service_change_payload("inst-1", Ok(Some(ServiceChange::BackInService))),
            Some(PluginServiceChanged {
                instance_id: "inst-1".to_string(),
                out_of_service_reason: None,
            })
        );
    }

    #[test]
    fn an_unchanged_instance_emits_nothing() {
        assert_eq!(service_change_payload("inst-1", Ok(None)), None);
    }

    #[test]
    fn a_refused_control_emits_nothing_rather_than_a_fabricated_state() {
        assert_eq!(
            service_change_payload(
                "inst-1",
                Err(PluginControlRefusal::GateBusy {
                    plugin: "fixture".to_string()
                })
            ),
            None
        );
    }

    #[test]
    fn the_payload_serialises_with_the_snake_case_wire_names_and_null_for_back_in_service() {
        let out = serde_json::to_string(&PluginServiceChanged {
            instance_id: "inst-7".to_string(),
            out_of_service_reason: Some("refused".to_string()),
        })
        .expect("payload serialises");
        assert_eq!(
            out,
            r#"{"instance_id":"inst-7","out_of_service_reason":"refused"}"#
        );

        let back = serde_json::to_string(&PluginServiceChanged {
            instance_id: "inst-7".to_string(),
            out_of_service_reason: None,
        })
        .expect("payload serialises");
        assert_eq!(
            back,
            r#"{"instance_id":"inst-7","out_of_service_reason":null}"#
        );
    }

    #[test]
    fn a_sweep_publishes_a_refused_start_once_and_then_nothing() {
        let _guard = crate::host::hint_test_support::guard();
        let (engine_plugins, _runtime) = refused_instance();
        let sink = RecordingEventSink::default();

        publish_pending_service_changes(&engine_plugins, &sink);

        assert_eq!(
            sink.events(),
            vec![(
                PLUGIN_SERVICE_CHANGED_EVENT.to_string(),
                serde_json::json!({
                    "instance_id": "inst-1",
                    "out_of_service_reason":
                        "it refused to start processing; its blocks pass through unprocessed",
                }),
            )]
        );

        publish_pending_service_changes(&engine_plugins, &sink);
        assert_eq!(sink.events().len(), 1, "a second sweep adds no event");
    }

    #[test]
    fn an_instance_the_sweep_could_not_reach_raises_the_hint_again() {
        let _guard = crate::host::hint_test_support::guard();
        let (engine_plugins, runtime) = refused_instance();
        let sink = RecordingEventSink::default();

        let (holding, gate_taken) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        let holder = std::thread::spawn(move || {
            runtime
                .with_control(Duration::from_secs(5), |_plugin| {
                    holding.send(()).expect("the test is still listening");
                    released.recv().expect("the test releases the gate");
                    Ok::<_, String>(())
                })
                .expect("a live fixture accepts control");
        });
        gate_taken
            .recv_timeout(Duration::from_secs(2))
            .expect("the holder takes the gate");
        // The fixture's own refusal raised the hint; clear it so what is
        // asserted below is the retry's re-raise and nothing earlier.
        take_pending_service_change_signal();

        publish_pending_service_changes(&engine_plugins, &sink);

        assert_eq!(
            sink.events(),
            Vec::new(),
            "an unreached instance emits nothing"
        );
        assert!(
            take_pending_service_change_signal(),
            "an unreached live instance must be asked again on the next tick"
        );

        release.send(()).expect("the holder is still waiting");
        holder.join().expect("the holder thread finishes");
    }
}
