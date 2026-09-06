//! The native engine's real-time diagnostics, as one readable payload.
//!
//! The engine records its real-time failures into fixed counters and a bounded
//! event ring because the audio thread cannot report them any other way. Until
//! something reads them they are invisible: a plugin parameter that never
//! mapped, an effect type the graph refused, or a device that disappeared all
//! look identical to silence. This command is that reader.

use crate::state::AppState;
use daw_engine::engine_events::{EngineEvent, StreamErrorKind, StreamSide};
use daw_engine::midi::diagnostics::ActiveMidiRtDiagnosticsSnapshot;
use serde::{Deserialize, Serialize};

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

/// Which of the engine's device streams a report came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamSidePayload {
    Output,
    Input,
}

impl From<StreamSide> for StreamSidePayload {
    fn from(side: StreamSide) -> Self {
        match side {
            StreamSide::Output => Self::Output,
            StreamSide::Input => Self::Input,
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
    StreamError {
        side: StreamSidePayload,
        kind: StreamErrorKindPayload,
    },
}

impl From<EngineEvent> for EngineEventPayload {
    fn from(event: EngineEvent) -> Self {
        match event {
            EngineEvent::StreamError { side, kind } => Self::StreamError {
                side: side.into(),
                kind: kind.into(),
            },
        }
    }
}

/// The engine's real-time diagnostics as one wire payload.
///
/// `running` distinguishes a quiet engine from an engine that was never
/// started: every counter reads zero in both cases, and only this flag says
/// which. The counters are cumulative since engine start; `events` is drained,
/// so an event is reported exactly once.
///
/// The frontend mirror of this type is hand-maintained (`crates/sourdaw-native/AGENTS.md`):
/// a field added or renamed here needs the same edit in
/// `src/modules/AudioEngine/models/EngineRtDiagnostics.ts`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineRtDiagnostics {
    pub running: bool,
    pub scheduler_event_buffer_overflows: u64,
    pub arpeggiator_active_note_exhaustions: u64,
    pub effect_id_collisions: u64,
    pub unsupported_effect_additions: u64,
    pub unmapped_set_param_calls: u64,
    /// A `RegisterCaptureConsumer` the input bus would not take, from
    /// `ActiveMidiRtDiagnosticsSnapshot::capture_consumer_refusals`.
    pub capture_consumer_refusals: u64,
    /// Capture blocks no consumer took, from
    /// `ActiveMidiRtDiagnosticsSnapshot::capture_blocks_dropped`.
    pub capture_blocks_dropped: u64,
    /// Capture blocks delivered as silence because the ring was filling or
    /// had stalled, from `ActiveMidiRtDiagnosticsSnapshot::capture_input_underruns`.
    pub capture_input_underruns: u64,
    /// Frames of latency the capture path is currently adding, or zero while
    /// capture is not serving — see `daw_engine::EngineHandle::input_latency_frames`
    /// for what zero does and does not mean.
    pub input_latency_frames: u64,
    pub events: Vec<EngineEventPayload>,
}

/// Assemble the wire payload for a running engine.
///
/// Split out of the command because the mapping is the part that can be wrong:
/// every counter here is a `u64` under a different name, so two of them swapped
/// would serialize, deserialize, and render without complaint. Taking the
/// readings as arguments makes that mapping testable without a live device.
fn running_engine_diagnostics(
    snapshot: ActiveMidiRtDiagnosticsSnapshot,
    events: Vec<EngineEvent>,
    input_latency_frames: usize,
) -> EngineRtDiagnostics {
    EngineRtDiagnostics {
        running: true,
        scheduler_event_buffer_overflows: snapshot.scheduler_event_buffer_overflows,
        arpeggiator_active_note_exhaustions: snapshot.arpeggiator_active_note_exhaustions,
        effect_id_collisions: snapshot.effect_id_collisions,
        unsupported_effect_additions: snapshot.unsupported_effect_additions,
        unmapped_set_param_calls: snapshot.unmapped_set_param_calls,
        capture_consumer_refusals: snapshot.capture_consumer_refusals,
        capture_blocks_dropped: snapshot.capture_blocks_dropped,
        capture_input_underruns: snapshot.capture_input_underruns,
        input_latency_frames: input_latency_frames as u64,
        events: events.into_iter().map(EngineEventPayload::from).collect(),
    }
}

/// Read the native engine's real-time diagnostics.
///
/// Returns the not-running shape rather than an error when no engine has been
/// started: asking a stopped engine how it is doing is a legitimate poll, not a
/// failure.
///
/// Declared `async` so it runs off the main thread, as `apply_graph_commands`
/// (the lazy engine bootstrap) does: a synchronous command would take the
/// engine mutex on the shell's event-loop thread, and this one is polled
/// every second for the life of the session. The guard is `std::sync::Mutex`
/// and is held only for the snapshot and the drain, so there is no await
/// under it.
pub async fn engine_rt_diagnostics(state: &AppState) -> Result<EngineRtDiagnostics, String> {
    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|error| format!("Failed to lock engine: {error}"))?;

    let Some(engine) = engine_guard.as_mut() else {
        return Ok(EngineRtDiagnostics::default());
    };

    let snapshot = engine.midi_rt_diagnostics_snapshot();
    let events = engine.drain_engine_events();
    let input_latency_frames = engine.input_latency_frames();

    Ok(running_engine_diagnostics(
        snapshot,
        events,
        input_latency_frames,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend mirror type is hand-maintained (crates/sourdaw-native/AGENTS.md), so the
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
            capture_consumer_refusals: 11,
            capture_blocks_dropped: 12,
            capture_input_underruns: 13,
            input_latency_frames: 14,
            events: vec![EngineEventPayload::StreamError {
                side: StreamSidePayload::Input,
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
                r#""captureConsumerRefusals":11,"#,
                r#""captureBlocksDropped":12,"captureInputUnderruns":13,"#,
                r#""inputLatencyFrames":14,"#,
                r#""events":[{"type":"streamError","side":"input","#,
                r#""kind":"deviceNotAvailable"}]}"#
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
                r#""captureConsumerRefusals":0,"#,
                r#""captureBlocksDropped":0,"captureInputUnderruns":0,"#,
                r#""inputLatencyFrames":0,"events":[]}"#
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

    /// Every counter on the payload is a `u64`, so a mapping that reads the
    /// wrong snapshot field still serializes and still renders — distinct values
    /// per field are what makes a swap fail here.
    #[test]
    fn a_running_engine_maps_each_reading_onto_its_own_field() {
        let snapshot = ActiveMidiRtDiagnosticsSnapshot {
            scheduler_event_buffer_overflows: 1,
            arpeggiator_active_note_exhaustions: 2,
            effect_id_collisions: 3,
            unsupported_effect_additions: 4,
            unmapped_set_param_calls: 5,
            capture_consumer_refusals: 10,
            capture_blocks_dropped: 12,
            capture_input_underruns: 13,
            // Not on this payload, so there is no mapping here to get wrong.
            midi_note_batches_refused: 0,
            late_midi_notes: 0,
        };

        let diagnostics = running_engine_diagnostics(
            snapshot,
            vec![EngineEvent::StreamError {
                side: StreamSide::Output,
                kind: StreamErrorKind::DeviceBusy,
            }],
            14,
        );

        assert!(diagnostics.running);
        assert_eq!(diagnostics.scheduler_event_buffer_overflows, 1);
        assert_eq!(diagnostics.arpeggiator_active_note_exhaustions, 2);
        assert_eq!(diagnostics.effect_id_collisions, 3);
        assert_eq!(diagnostics.unsupported_effect_additions, 4);
        assert_eq!(diagnostics.unmapped_set_param_calls, 5);
        assert_eq!(diagnostics.capture_consumer_refusals, 10);
        assert_eq!(diagnostics.capture_blocks_dropped, 12);
        assert_eq!(diagnostics.capture_input_underruns, 13);
        assert_eq!(diagnostics.input_latency_frames, 14);
        assert_eq!(
            diagnostics.events,
            vec![EngineEventPayload::StreamError {
                side: StreamSidePayload::Output,
                kind: StreamErrorKindPayload::DeviceBusy,
            }]
        );
    }

    /// A capture failure and a playback failure reach the frontend as the
    /// same event type, so the side is the only thing telling them apart. A
    /// mapping that dropped it would report a microphone that vanished as the
    /// speakers going away.
    #[test]
    fn each_stream_side_has_its_own_wire_spelling_and_survives_the_mapping() {
        let mapped: Vec<EngineEventPayload> = [StreamSide::Input, StreamSide::Output]
            .into_iter()
            .map(|side| {
                EngineEventPayload::from(EngineEvent::StreamError {
                    side,
                    kind: StreamErrorKind::Xrun,
                })
            })
            .collect();

        assert_eq!(
            mapped,
            vec![
                EngineEventPayload::StreamError {
                    side: StreamSidePayload::Input,
                    kind: StreamErrorKindPayload::Xrun,
                },
                EngineEventPayload::StreamError {
                    side: StreamSidePayload::Output,
                    kind: StreamErrorKindPayload::Xrun,
                },
            ]
        );
        assert_eq!(
            serde_json::to_string(&StreamSidePayload::Input).expect("side should serialize"),
            r#""input""#
        );
        assert_eq!(
            serde_json::to_string(&StreamSidePayload::Output).expect("side should serialize"),
            r#""output""#
        );
    }

    /// A poll before the first Play is a legitimate poll, not a failure: it
    /// answers the not-running shape rather than an error.
    #[test]
    fn a_stopped_engine_answers_the_not_running_shape() {
        let state = AppState::default();

        let diagnostics = crate::block_on_test(engine_rt_diagnostics(&state))
            .expect("diagnostics should be readable");

        assert!(!diagnostics.running);
        assert!(diagnostics.events.is_empty());
    }
}
