//! Arm and disarm the engine's retrospective audio ring.
//!
//! PunchRecording names one project strip; this command records that request
//! in [`AppState::retrospective_arm`] and, when a running engine already knows
//! the strip, resolves it to the engine-native track id the ring accepts and
//! arms at once. The record outlives any one engine: every graph batch applied
//! to the live engine re-applies it ([`apply_desired_retrospective_arm`]), so
//! punch enabled before the first play, or across an engine rebuilt after a
//! device loss, still arms the engine that eventually runs. Opening the input
//! is the engine's duty on a successful arm.
//!
//! Lock order, shared with `apply_graph_commands`: graph registry, then
//! engine, then the recorded arm.

use daw_engine::retrospective::RETROSPECTIVE_CHANNEL_RANGE;
use daw_engine::EngineHandle;

use crate::commands::graph::GraphRegistry;
use crate::state::AppState;

/// The retrospective arm the renderer last asked for.
///
/// `track_id` is the project's strip id, never an engine-native id: native ids
/// are reissued when an engine is rebuilt or a strip re-registered, so the
/// record keeps the identity that survives both and resolves it per engine.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesiredRetrospectiveArm {
    pub track_id: String,
    pub channels: usize,
}

/// Arm retrospective retention for one project track strip.
///
/// Refuses a `channels` outside [`RETROSPECTIVE_CHANNEL_RANGE`] before taking
/// any lock or recording anything. Otherwise records the arm and answers `Ok`
/// whether or not an engine is running or knows the strip yet; when both hold,
/// the engine is armed now, and otherwise the next applied graph batch arms it.
pub async fn arm_retrospective_capture(
    track_id: String,
    channels: u32,
    state: &AppState,
) -> Result<(), String> {
    let channels = supported_channels(channels)?;

    let registry_guard = state
        .graph
        .lock()
        .map_err(|error| format!("Failed to lock graph registry: {error}"))?;
    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|error| format!("Failed to lock engine: {error}"))?;
    let mut desired_guard = state
        .retrospective_arm
        .lock()
        .map_err(|error| format!("Failed to lock retrospective arm: {error}"))?;

    if let (Some(engine), Some(native_id)) = (
        engine_guard.as_mut(),
        registry_guard.track_native_id(&track_id),
    ) {
        engine.arm_retrospective_capture(native_id, channels);
    }
    *desired_guard = Some(DesiredRetrospectiveArm { track_id, channels });
    Ok(())
}

/// Stop retrospective retention. Capture-callback writes keep nothing until
/// the next arm.
///
/// Clears the recorded arm, so no later engine boot arms anything, and
/// disarms the running engine when there is one. Answers `Ok` either way.
pub async fn disarm_retrospective_capture(state: &AppState) -> Result<(), String> {
    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|error| format!("Failed to lock engine: {error}"))?;
    let mut desired_guard = state
        .retrospective_arm
        .lock()
        .map_err(|error| format!("Failed to lock retrospective arm: {error}"))?;

    *desired_guard = None;
    if let Some(engine) = engine_guard.as_mut() {
        engine.disarm_retrospective_capture();
    }
    Ok(())
}

/// Arm `engine` for the recorded arm when it is not already armed on it.
///
/// Called by `apply_graph_commands` once a batch is on the live engine's
/// ring, with the registry that batch produced and the engine guard it holds,
/// so this is the innermost lock of the three. Never called by the offline
/// mapping or render paths: those own no live engine.
pub(crate) fn apply_desired_retrospective_arm(
    state: &AppState,
    registry: &GraphRegistry,
    engine: &mut EngineHandle,
) {
    let desired_guard = match state.retrospective_arm.lock() {
        Ok(guard) => guard,
        Err(error) => {
            eprintln!("[Retrospective] the recorded arm could not be read: {error}");
            return;
        }
    };
    let desired = desired_guard.as_ref();
    let resolved_native_id = desired.and_then(|arm| registry.track_native_id(&arm.track_id));
    if let Some((native_id, channels)) = retrospective_arm_owed(
        desired,
        resolved_native_id,
        engine.retrospective_capture_target(),
    ) {
        engine.arm_retrospective_capture(native_id, channels);
    }
}

/// The arm a live engine owes the recorded one: `(native_id, channels)` when
/// the recorded strip resolves to a native id the engine is not armed on,
/// otherwise nothing.
///
/// An engine already armed on the resolved id is left alone, so an ordinary
/// batch does not reallocate sixty seconds of storage and discard what the
/// ring has retained. A strip that does not resolve arms nothing; the record
/// stays for the batch that registers it.
fn retrospective_arm_owed(
    desired: Option<&DesiredRetrospectiveArm>,
    resolved_native_id: Option<usize>,
    armed_target: Option<usize>,
) -> Option<(usize, usize)> {
    let desired = desired?;
    let native_id = resolved_native_id?;
    (armed_target != Some(native_id)).then_some((native_id, desired.channels))
}

fn supported_channels(channels: u32) -> Result<usize, String> {
    usize::try_from(channels)
        .ok()
        .filter(|channels| RETROSPECTIVE_CHANNEL_RANGE.contains(channels))
        .ok_or_else(|| {
            format!(
                "arm-retrospective-capture: {channels} channels is outside the supported range \
                 {}..={}",
                RETROSPECTIVE_CHANNEL_RANGE.start(),
                RETROSPECTIVE_CHANNEL_RANGE.end()
            )
        })
}

#[cfg(test)]
mod tests {
    use daw_engine::engine_events::StreamErrorKind;
    use serde_json::{json, Value};

    use crate::block_on_test;
    use crate::commands::crumbs::CrumbsState;
    use crate::commands::engine_lifecycle::retire_native_engine;
    use crate::commands::graph::apply_graph_commands;
    use crate::host::plugin_window::NoWindowHost;

    use super::*;

    const STRIP: &str = "punch-track";

    fn one_strip_batch() -> Value {
        json!({
            "schemaVersion": 1,
            "commands": [{
                "kind": "create-track-strip",
                "trackId": STRIP,
                "name": "Punch",
                "state": {
                    "gain": 1.0,
                    "pan": 0,
                    "muted": false,
                    "soloGated": false,
                    "vcaMultiplier": 1,
                },
                "devices": [],
                "honorMuted": true,
                "contributesAudio": true,
            }],
        })
    }

    /// Fill the slot with a capture engine, which keeps the lazy bootstrap in
    /// `apply_graph_commands` from opening a real device. The command ring's
    /// consumer is returned so the ring stays live for the test's length.
    fn boot_capture_engine(
        state: &AppState,
    ) -> rtrb::Consumer<daw_engine::scheduler::GraphCommand> {
        let (engine, commands, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        commands
    }

    fn apply(state: &AppState, batch: Value) {
        let result = block_on_test(apply_graph_commands(batch, state, &CrumbsState::default()))
            .expect("the batch resolves");
        assert_eq!(result["application"], "applied", "{result}");
    }

    fn armed_target(state: &AppState) -> Option<usize> {
        state
            .engine
            .lock()
            .expect("the engine slot is readable")
            .as_ref()
            .expect("an engine is running")
            .retrospective_capture_target()
    }

    fn resolved_native_id(state: &AppState) -> usize {
        state
            .graph
            .lock()
            .expect("the registry is readable")
            .track_native_id(STRIP)
            .expect("the batch registered the strip")
    }

    fn recorded(state: &AppState) -> Option<DesiredRetrospectiveArm> {
        state
            .retrospective_arm
            .lock()
            .expect("the recorded arm is readable")
            .clone()
    }

    fn retire_stalled_engine(state: &AppState) {
        state
            .engine
            .lock()
            .expect("the engine slot is readable")
            .as_ref()
            .expect("an engine is running")
            .mark_render_stalled(Some(StreamErrorKind::DeviceChanged));
        block_on_test(retire_native_engine(
            state,
            &CrumbsState::default(),
            &NoWindowHost,
        ));
        assert!(state.engine.lock().expect("engine lock").is_none());
    }

    #[test]
    fn an_arm_with_no_engine_running_answers_ok_and_is_recorded() {
        let state = AppState::default();

        block_on_test(arm_retrospective_capture(STRIP.to_string(), 2, &state))
            .expect("an arm before the first play is not an error");

        assert_eq!(
            recorded(&state),
            Some(DesiredRetrospectiveArm {
                track_id: STRIP.to_string(),
                channels: 2,
            })
        );
    }

    #[test]
    fn the_first_batch_on_an_engine_started_after_the_arm_arms_it() {
        let state = AppState::default();
        block_on_test(arm_retrospective_capture(STRIP.to_string(), 2, &state))
            .expect("the arm is recorded");
        let _commands = boot_capture_engine(&state);

        apply(&state, one_strip_batch());

        assert_eq!(armed_target(&state), Some(resolved_native_id(&state)));
    }

    #[test]
    fn a_rebuilt_engine_is_armed_again_by_its_first_batch() {
        let state = AppState::default();
        let _lost_commands = boot_capture_engine(&state);
        apply(&state, one_strip_batch());
        // Armed by the command itself, so the replacing engine below can only
        // be armed by the batch path.
        block_on_test(arm_retrospective_capture(STRIP.to_string(), 2, &state))
            .expect("the arm resolves");
        assert!(armed_target(&state).is_some());

        retire_stalled_engine(&state);
        let _replacement_commands = boot_capture_engine(&state);
        assert_eq!(
            armed_target(&state),
            None,
            "the replacing engine starts disarmed"
        );
        apply(&state, one_strip_batch());

        assert_eq!(armed_target(&state), Some(resolved_native_id(&state)));
        assert!(recorded(&state).is_some(), "the retire keeps the record");
    }

    #[test]
    fn an_arm_on_a_running_engine_that_knows_the_strip_arms_at_once() {
        let state = AppState::default();
        let _commands = boot_capture_engine(&state);
        apply(&state, one_strip_batch());

        block_on_test(arm_retrospective_capture(STRIP.to_string(), 2, &state))
            .expect("the arm resolves");

        assert_eq!(armed_target(&state), Some(resolved_native_id(&state)));
    }

    #[test]
    fn an_arm_whose_strip_is_unknown_arms_nothing_and_stays_recorded() {
        let state = AppState::default();
        let _commands = boot_capture_engine(&state);

        block_on_test(arm_retrospective_capture(STRIP.to_string(), 2, &state))
            .expect("an unregistered strip is not an error");
        assert_eq!(armed_target(&state), None);
        assert!(recorded(&state).is_some());

        apply(&state, one_strip_batch());
        assert_eq!(armed_target(&state), Some(resolved_native_id(&state)));
    }

    #[test]
    fn a_disarm_with_no_engine_answers_ok_and_a_later_boot_arms_nothing() {
        let state = AppState::default();
        block_on_test(arm_retrospective_capture(STRIP.to_string(), 2, &state))
            .expect("the arm is recorded");

        block_on_test(disarm_retrospective_capture(&state))
            .expect("a disarm with no engine is not an error");
        assert_eq!(recorded(&state), None);

        let _commands = boot_capture_engine(&state);
        apply(&state, one_strip_batch());
        assert_eq!(armed_target(&state), None);
    }

    #[test]
    fn a_disarm_disarms_the_running_engine() {
        let state = AppState::default();
        let _commands = boot_capture_engine(&state);
        apply(&state, one_strip_batch());
        block_on_test(arm_retrospective_capture(STRIP.to_string(), 2, &state))
            .expect("the arm resolves");

        block_on_test(disarm_retrospective_capture(&state)).expect("the disarm resolves");

        assert_eq!(armed_target(&state), None);
        assert_eq!(recorded(&state), None);
    }

    #[test]
    fn an_unsupported_channel_count_is_refused_before_anything_is_recorded() {
        for channels in [0, 3, u32::MAX] {
            let state = AppState::default();
            let _commands = boot_capture_engine(&state);
            apply(&state, one_strip_batch());

            let refused = block_on_test(arm_retrospective_capture(
                STRIP.to_string(),
                channels,
                &state,
            ));

            assert!(refused.is_err(), "{channels} channels must be refused");
            assert_eq!(recorded(&state), None);
            assert_eq!(armed_target(&state), None);
        }
    }

    fn arm(channels: usize) -> DesiredRetrospectiveArm {
        DesiredRetrospectiveArm {
            track_id: STRIP.to_string(),
            channels,
        }
    }

    #[test]
    fn the_owed_arm_follows_the_resolved_id_and_never_rearms_a_matching_engine() {
        let cases: [(
            Option<DesiredRetrospectiveArm>,
            Option<usize>,
            Option<usize>,
            Option<(usize, usize)>,
        ); 8] = [
            // Nothing recorded owes nothing, whatever the engine holds.
            (None, None, None, None),
            (None, Some(4), None, None),
            (None, Some(4), Some(4), None),
            // A recorded strip the registry does not know arms nothing.
            (Some(arm(2)), None, None, None),
            (Some(arm(2)), None, Some(4), None),
            // A fresh or rebuilt engine is armed on the resolved id.
            (Some(arm(2)), Some(4), None, Some((4, 2))),
            // A strip re-registered under a new native id moves the arm.
            (Some(arm(1)), Some(5), Some(4), Some((5, 1))),
            // An engine already armed on the resolved id is left alone.
            (Some(arm(2)), Some(4), Some(4), None),
        ];

        for (desired, resolved, armed, expected) in cases {
            assert_eq!(
                retrospective_arm_owed(desired.as_ref(), resolved, armed),
                expected,
                "desired {desired:?}, resolved {resolved:?}, armed {armed:?}"
            );
        }
    }
}
