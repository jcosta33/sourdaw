//! Tauri command exposing the native engine's real-time diagnostics.
//!
//! The engine records its real-time failures into fixed counters and a bounded
//! event ring because the audio thread cannot report them any other way. Until
//! something reads them they are invisible: a plugin parameter that never
//! mapped, an effect type the graph refused, or a device that disappeared all
//! look identical to silence. This command is that reader.

use crate::state::AppState;
use daw_engine::engine_events::{EngineEvent, StreamErrorKind};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;

/// Why the audio backend reported a stream error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamErrorKindPayload {
    DeviceNotAvailable,
    DeviceBusy,
    DeviceChanged,
    StreamInvalidated,
    Xrun,
    BackendSpecific,
}

impl From<StreamErrorKind> for StreamErrorKindPayload {
    fn from(kind: StreamErrorKind) -> Self {
        match kind {
            StreamErrorKind::DeviceNotAvailable => Self::DeviceNotAvailable,
            StreamErrorKind::DeviceBusy => Self::DeviceBusy,
            StreamErrorKind::DeviceChanged => Self::DeviceChanged,
            StreamErrorKind::StreamInvalidated => Self::StreamInvalidated,
            StreamErrorKind::Xrun => Self::Xrun,
            StreamErrorKind::BackendSpecific => Self::BackendSpecific,
        }
    }
}

/// One engine event, tagged so the frontend can discriminate on `type`.
///
/// `rename_all` on the enum renames the variants; a struct variant's own fields
/// need their own `rename_all`, so both are declared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EngineEventPayload {
    #[serde(rename_all = "camelCase")]
    StreamError { kind: StreamErrorKindPayload },
}

impl From<EngineEvent> for EngineEventPayload {
    fn from(event: EngineEvent) -> Self {
        match event {
            EngineEvent::StreamError { kind } => Self::StreamError { kind: kind.into() },
        }
    }
}

/// The engine's real-time diagnostics as one wire payload.
///
/// `running` distinguishes a quiet engine from an engine that was never
/// started: every counter reads zero in both cases, and only this flag says
/// which. The counters are cumulative since engine start; `events` is drained,
/// so an event is reported exactly once.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineRtDiagnostics {
    pub running: bool,
    pub scheduler_event_buffer_overflows: u64,
    pub arpeggiator_active_note_exhaustions: u64,
    pub effect_id_collisions: u64,
    pub unsupported_effect_additions: u64,
    pub unmapped_set_param_calls: u64,
    pub bridge_output_blocks_dropped: u64,
    pub unmatched_bridge_blocks: u64,
    pub bridge_backlog_blocks_shed: u64,
    pub callback_frames_over_bridge_reach: u64,
    /// Counted on the control side, not the audio thread: input blocks the app
    /// could not hand to a bridge because its input ring was full.
    pub bridge_input_blocks_refused: u64,
    pub events: Vec<EngineEventPayload>,
}

/// Read the native engine's real-time diagnostics.
///
/// Returns the not-running shape rather than an error when no engine has been
/// started: asking a stopped engine how it is doing is a legitimate poll, not a
/// failure.
///
/// Declared `async` so it runs off the main thread, as `start_native_engine`
/// does: a synchronous command takes the engine mutex on the thread Tauri also
/// drives the webview from, and this one is polled every second for the life of
/// the session. The guard is `std::sync::Mutex` and is held only for the
/// snapshot and the drain, so there is no await under it.
#[tauri::command]
pub async fn engine_rt_diagnostics(
    state: tauri::State<'_, AppState>,
) -> Result<EngineRtDiagnostics, String> {
    let bridge_input_blocks_refused = state.bridge_input_blocks_refused.load(Ordering::Relaxed);

    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|error| format!("Failed to lock engine: {error}"))?;

    let Some(engine) = engine_guard.as_mut() else {
        return Ok(EngineRtDiagnostics {
            bridge_input_blocks_refused,
            ..EngineRtDiagnostics::default()
        });
    };

    let snapshot = engine.midi_rt_diagnostics_snapshot();
    let events = engine
        .drain_engine_events()
        .into_iter()
        .map(EngineEventPayload::from)
        .collect();

    Ok(EngineRtDiagnostics {
        running: true,
        scheduler_event_buffer_overflows: snapshot.scheduler_event_buffer_overflows,
        arpeggiator_active_note_exhaustions: snapshot.arpeggiator_active_note_exhaustions,
        effect_id_collisions: snapshot.effect_id_collisions,
        unsupported_effect_additions: snapshot.unsupported_effect_additions,
        unmapped_set_param_calls: snapshot.unmapped_set_param_calls,
        bridge_output_blocks_dropped: snapshot.bridge_output_blocks_dropped,
        unmatched_bridge_blocks: snapshot.unmatched_bridge_blocks,
        bridge_backlog_blocks_shed: snapshot.bridge_backlog_blocks_shed,
        callback_frames_over_bridge_reach: snapshot.callback_frames_over_bridge_reach,
        bridge_input_blocks_refused,
        events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend mirror type is hand-maintained (src-tauri/AGENTS.md), so the
    /// wire shape is a contract: pin every key and every enum spelling.
    #[test]
    fn diagnostics_serialize_with_camel_case_keys_and_a_tagged_event_union() {
        let payload = EngineRtDiagnostics {
            running: true,
            scheduler_event_buffer_overflows: 1,
            arpeggiator_active_note_exhaustions: 2,
            effect_id_collisions: 3,
            unsupported_effect_additions: 4,
            unmapped_set_param_calls: 5,
            bridge_output_blocks_dropped: 6,
            unmatched_bridge_blocks: 7,
            bridge_backlog_blocks_shed: 8,
            callback_frames_over_bridge_reach: 9,
            bridge_input_blocks_refused: 10,
            events: vec![EngineEventPayload::StreamError {
                kind: StreamErrorKindPayload::DeviceNotAvailable,
            }],
        };

        let json = serde_json::to_string(&payload).expect("diagnostics should serialize");

        assert_eq!(
            json,
            concat!(
                r#"{"running":true,"schedulerEventBufferOverflows":1,"#,
                r#""arpeggiatorActiveNoteExhaustions":2,"effectIdCollisions":3,"#,
                r#""unsupportedEffectAdditions":4,"unmappedSetParamCalls":5,"#,
                r#""bridgeOutputBlocksDropped":6,"unmatchedBridgeBlocks":7,"#,
                r#""bridgeBacklogBlocksShed":8,"callbackFramesOverBridgeReach":9,"#,
                r#""bridgeInputBlocksRefused":10,"#,
                r#""events":[{"type":"streamError","kind":"deviceNotAvailable"}]}"#
            )
        );
    }

    #[test]
    fn a_stopped_engine_serializes_as_the_not_running_shape() {
        let json = serde_json::to_string(&EngineRtDiagnostics::default())
            .expect("default diagnostics should serialize");

        assert_eq!(
            json,
            concat!(
                r#"{"running":false,"schedulerEventBufferOverflows":0,"#,
                r#""arpeggiatorActiveNoteExhaustions":0,"effectIdCollisions":0,"#,
                r#""unsupportedEffectAdditions":0,"unmappedSetParamCalls":0,"#,
                r#""bridgeOutputBlocksDropped":0,"unmatchedBridgeBlocks":0,"#,
                r#""bridgeBacklogBlocksShed":0,"callbackFramesOverBridgeReach":0,"#,
                r#""bridgeInputBlocksRefused":0,"events":[]}"#
            )
        );
    }

    #[test]
    fn every_stream_error_kind_has_a_distinct_wire_spelling() {
        let spellings: Vec<String> = [
            StreamErrorKind::DeviceNotAvailable,
            StreamErrorKind::DeviceBusy,
            StreamErrorKind::DeviceChanged,
            StreamErrorKind::StreamInvalidated,
            StreamErrorKind::Xrun,
            StreamErrorKind::BackendSpecific,
        ]
        .into_iter()
        .map(|kind| {
            serde_json::to_string(&StreamErrorKindPayload::from(kind))
                .expect("kind should serialize")
        })
        .collect();

        assert_eq!(
            spellings,
            vec![
                r#""deviceNotAvailable""#,
                r#""deviceBusy""#,
                r#""deviceChanged""#,
                r#""streamInvalidated""#,
                r#""xrun""#,
                r#""backendSpecific""#,
            ]
        );
    }

    #[test]
    fn a_stopped_engine_still_reports_refused_input_blocks() {
        let app = tauri::test::mock_builder()
            .manage(AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("test app should build");
        let state = <tauri::AppHandle<tauri::test::MockRuntime> as tauri::Manager<_>>::state::<
            AppState,
        >(app.handle());
        state
            .bridge_input_blocks_refused
            .store(3, std::sync::atomic::Ordering::Relaxed);

        let diagnostics = tauri::async_runtime::block_on(engine_rt_diagnostics(state))
            .expect("diagnostics should be readable");

        assert!(!diagnostics.running);
        assert_eq!(diagnostics.bridge_input_blocks_refused, 3);
        assert!(diagnostics.events.is_empty());
    }
}
