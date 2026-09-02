//! The native transport's maps, its loop region, and where its playhead is.
//!
//! ## Why this is not part of the graph batch
//!
//! `graph.rs` records the transport ownership law: the graph's `set-transport`
//! owns `is_playing` and the song position, and nothing else. Tempo, meter and
//! the loop region are a different producer's truth — the arrangement's tempo
//! map, its time-signature map and the transport store's loop — and they change
//! on their own schedule, not once per play. Smuggling them into the live
//! topology batch would tie a tempo edit to a topology replacement and give one
//! command two owners. So they arrive here, on their own command, and the
//! engine holds them until the next one replaces them.
//!
//! ## Frames are derived here, never sent
//!
//! Every position on the wire is seconds, exactly as `set-transport`'s
//! `positionSeconds` is. The renderer does not know the device sample rate the
//! engine actually opened, so a frame count it computed would be right only by
//! coincidence. The conversion uses the live engine's own rate
//! ([`seconds_to_frames`]), which is the one number that cannot be wrong.
//!
//! ## Reading the playhead back
//!
//! [`engine_transport_position`] is a poll, not a push. The engine publishes
//! its position into a triple buffer once per audio callback; this reads the
//! latest value without waking the renderer, so the renderer decides its own
//! rate — one read per animation frame, never one per audio block. The reading
//! is deliberately taken from the transport channel rather than from
//! `GraphProgressSnapshot`, whose `playhead_frame` is the command-admission
//! ledger's release evidence and means a happens-before, not a cursor position.
//! That channel is the *whole* of the reading, batch count included: the two
//! channels are published one after another at the end of every callback, so a
//! reader taking one field from each can pair a count with a playhead the
//! engine never held at the same moment.

use crate::commands::graph::{finite, seconds_to_frames};
use crate::state::AppState;
use daw_engine::scheduler::{GraphCommand, TransportPositionSnapshot};
use daw_engine::transport_map::{
    LoopRegion, TempoMap, TempoSegment, TimeSignatureMap, TimeSignatureSegment, TransportMaps,
};
use serde::{Deserialize, Serialize};

/// One tempo segment of the arrangement's map, in seconds on the engine clock.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempoSegmentPayload {
    pub start_seconds: f64,
    pub beats_per_minute: f64,
}

/// One time-signature segment of the arrangement's map.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeSignatureSegmentPayload {
    pub start_seconds: f64,
    pub numerator: u16,
    pub denominator: u16,
}

/// The transport's loop region. Absent means "no loop", which is not the same
/// as a disabled one: both stop the engine wrapping, but only the second
/// remembers where the musician left the locators.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopRegionPayload {
    pub enabled: bool,
    pub start_seconds: f64,
    pub end_seconds: f64,
}

/// Everything the engine's transport follows, as one replacing write.
///
/// The two maps travel together because the engine holds them as one object:
/// a block that read a new tempo map against the old meter map would report a
/// bar position that never existed.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportMapsPayload {
    pub tempo: Vec<TempoSegmentPayload>,
    pub time_signature: Vec<TimeSignatureSegmentPayload>,
    #[serde(default)]
    pub loop_region: Option<LoopRegionPayload>,
}

/// What the engine did with the maps.
///
/// `sampleRate` is echoed because it is the rate the frames were derived
/// against; a caller that wants to reason about the engine's grid needs the
/// number this command actually used, not the one it assumed.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportMapsApplied {
    pub sample_rate: f64,
    pub tempo_segments: u32,
    pub time_signature_segments: u32,
    pub loop_enabled: bool,
    /// The fence number [`EngineTransportPosition::batches_applied`] reaches
    /// once this install has drained, so a caller can tell a later reading
    /// from one taken before the maps reached the audio thread. Numbered from
    /// the same counter `apply_graph_commands` numbers its own batches from:
    /// the engine counts one stream of fences, so two producers numbering it
    /// separately would be two numbers for one count.
    pub admitted_batch: u64,
}

/// Where the engine's transport stands, as one wire payload.
///
/// `running` distinguishes a stopped engine from an engine parked at frame
/// zero: every number reads zero in both cases and only this flag says which.
/// `loopWraps` counts how many times the playhead crossed the loop end since
/// the engine started; a consumer that sees it change knows the position went
/// backwards on purpose rather than jumping.
///
/// `batchesApplied` is the only field that says *when* this reading was taken
/// with respect to a command. A position cannot: a locate that resolved on
/// this side was fenced onto the command ring, not drained, so the next
/// reading may still report where the transport was before it. The count is
/// the witness — a reading carrying a count at or above the fence number a
/// command was admitted at was taken after that command reached the audio
/// thread. It travels on the transport snapshot itself
/// ([`TransportPositionSnapshot::batches_applied`]), which is what makes it a
/// statement about *this* playhead rather than about some other callback's.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineTransportPosition {
    pub running: bool,
    pub playing: bool,
    pub position_seconds: f64,
    pub playhead_frame: f64,
    pub loop_wraps: f64,
    pub batches_applied: f64,
    pub tempo: f64,
    pub time_sig_num: u16,
    pub time_sig_denom: u16,
}

/// The engine's own snapshot, in the wire's units.
fn transport_position_payload(
    snapshot: TransportPositionSnapshot,
    sample_rate: f64,
) -> EngineTransportPosition {
    EngineTransportPosition {
        running: true,
        playing: snapshot.playing,
        position_seconds: snapshot.playhead_frame as f64 / sample_rate,
        playhead_frame: snapshot.playhead_frame as f64,
        loop_wraps: snapshot.loop_wraps as f64,
        batches_applied: snapshot.batches_applied as f64,
        tempo: snapshot.tempo,
        time_sig_num: snapshot.time_sig_num,
        time_sig_denom: snapshot.time_sig_denom,
    }
}

fn tempo_segments(
    payload: &[TempoSegmentPayload],
    sample_rate: f32,
) -> Result<Vec<TempoSegment>, String> {
    payload
        .iter()
        .map(|segment| {
            Ok(TempoSegment {
                start_frame: seconds_to_frames(
                    segment.start_seconds,
                    sample_rate,
                    "tempo segment start",
                )?,
                beats_per_minute: finite(segment.beats_per_minute, "tempo segment bpm")?,
            })
        })
        .collect()
}

fn time_signature_segments(
    payload: &[TimeSignatureSegmentPayload],
    sample_rate: f32,
) -> Result<Vec<TimeSignatureSegment>, String> {
    payload
        .iter()
        .map(|segment| {
            Ok(TimeSignatureSegment {
                start_frame: seconds_to_frames(
                    segment.start_seconds,
                    sample_rate,
                    "time signature segment start",
                )?,
                numerator: segment.numerator,
                denominator: segment.denominator,
            })
        })
        .collect()
}

fn loop_region(payload: Option<LoopRegionPayload>, sample_rate: f32) -> Result<LoopRegion, String> {
    let Some(region) = payload else {
        return Ok(LoopRegion::default());
    };
    Ok(LoopRegion {
        enabled: region.enabled,
        start_frame: seconds_to_frames(region.start_seconds, sample_rate, "loop start")?,
        end_frame: seconds_to_frames(region.end_seconds, sample_rate, "loop end")?,
    })
}

/// Build the engine-side objects a maps write installs.
///
/// Split out of the command so the mapping — the part that can silently swap a
/// numerator for a denominator, or derive a frame against the wrong rate — is
/// testable without a live device.
fn transport_maps_commands(
    payload: &TransportMapsPayload,
    sample_rate: f32,
) -> Result<(Vec<GraphCommand>, TransportMapsApplied), String> {
    let rate = f64::from(sample_rate);
    let tempo = TempoMap::new(&tempo_segments(&payload.tempo, sample_rate)?, rate)
        .map_err(|error| format!("tempo map is unusable: {error}"))?;
    let time_signature = TimeSignatureMap::new(&time_signature_segments(
        &payload.time_signature,
        sample_rate,
    )?)
    .map_err(|error| format!("time signature map is unusable: {error}"))?;
    let region = loop_region(payload.loop_region, sample_rate)?;

    let applied = TransportMapsApplied {
        sample_rate: rate,
        tempo_segments: tempo.segment_count() as u32,
        time_signature_segments: time_signature.segment_count() as u32,
        loop_enabled: region.active_end().is_some(),
        // Stamped by whoever publishes the fence: a mapping that is never sent
        // has no fence number, and inventing one here would name a batch the
        // engine will never drain.
        admitted_batch: 0,
    };

    Ok((
        vec![
            GraphCommand::SetTransportMaps(Box::new(TransportMaps {
                tempo,
                time_signature,
                sample_rate: rate,
            })),
            GraphCommand::SetLoopRegion(region),
        ],
        applied,
    ))
}

/// Install the arrangement's tempo map, meter map and loop region.
///
/// Refuses when no engine is running rather than answering a cheerful nothing:
/// this command has no lazy bootstrap of its own (the graph batch owns that),
/// so a caller that reached it with no engine has an ordering fault, and a
/// silent success would hide it until the first wrong bar line.
///
/// Declared `async` for the same reason `engine_rt_diagnostics` is: it takes
/// the engine mutex, and doing that on the shell's event-loop thread would
/// block it behind a live audio session. The guard is a `std::sync::Mutex` and
/// nothing awaits under it.
pub async fn set_transport_maps(
    payload: TransportMapsPayload,
    state: &AppState,
) -> Result<TransportMapsApplied, String> {
    // Registry before engine, the order `apply_graph_commands` takes them in:
    // both locks are held here because the fence this publishes has to be
    // numbered by the same counter that numbers a graph batch's.
    let mut registry_guard = state
        .graph
        .lock()
        .map_err(|error| format!("Failed to lock graph registry: {error}"))?;

    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|error| format!("Failed to lock engine: {error}"))?;

    let Some(engine) = engine_guard.as_mut() else {
        return Err("no native engine is running".to_string());
    };

    let (ops, mut applied) = transport_maps_commands(&payload, engine.sample_rate())?;
    engine
        .send_graph_batch(ops)
        .map_err(|error| format!("transport maps were not applied: {error:?}"))?;

    // Numbered only once the fence is published, and from the graph registry's
    // own counter: the engine numbers every fence it drains, whichever command
    // sent it, so a counter that skipped this one would leave every later graph
    // batch numbered below the count it is compared against.
    applied.admitted_batch = registry_guard.record_fenced_batch();
    Ok(applied)
}

/// Read where the engine's transport stands.
///
/// Returns the not-running shape rather than an error when no engine exists,
/// for the same reason the diagnostics poll does: asking a stopped engine where
/// it is is a legitimate question with a true answer.
pub async fn engine_transport_position(
    state: &AppState,
) -> Result<EngineTransportPosition, String> {
    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|error| format!("Failed to lock engine: {error}"))?;

    let Some(engine) = engine_guard.as_mut() else {
        return Ok(EngineTransportPosition::default());
    };

    let sample_rate = f64::from(engine.sample_rate());
    // One read, deliberately. The batch count that dates this reading rides on
    // the transport snapshot itself, so the pairing is the engine's own single
    // publish rather than an ordering this side could only hope for.
    let snapshot = engine.transport_position_snapshot();

    Ok(transport_position_payload(snapshot, sample_rate))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn maps_payload() -> TransportMapsPayload {
        TransportMapsPayload {
            tempo: vec![
                TempoSegmentPayload {
                    start_seconds: 0.0,
                    beats_per_minute: 120.0,
                },
                TempoSegmentPayload {
                    start_seconds: 2.0,
                    beats_per_minute: 90.0,
                },
            ],
            time_signature: vec![TimeSignatureSegmentPayload {
                start_seconds: 0.0,
                numerator: 7,
                denominator: 8,
            }],
            loop_region: Some(LoopRegionPayload {
                enabled: true,
                start_seconds: 1.0,
                end_seconds: 3.0,
            }),
        }
    }

    /// The renderer sends seconds; the engine grid is frames. A conversion done
    /// against anything but the engine's own rate lands the map on the wrong
    /// samples, and every number on this payload is a `f64` so the mistake would
    /// serialize and render without complaint.
    #[test]
    fn seconds_become_frames_against_the_engines_own_sample_rate() {
        let (ops, applied) =
            transport_maps_commands(&maps_payload(), 44_100.0).expect("maps should build");

        assert_eq!(applied.sample_rate, 44_100.0);
        assert_eq!(applied.tempo_segments, 2);
        assert_eq!(applied.time_signature_segments, 1);
        assert!(applied.loop_enabled);

        let Some(GraphCommand::SetLoopRegion(region)) = ops.get(1) else {
            panic!("the second command should be the loop region");
        };
        assert_eq!(region.start_frame, 44_100);
        assert_eq!(region.end_frame, 132_300);

        let Some(GraphCommand::SetTransportMaps(maps)) = ops.first() else {
            panic!("the first command should be the maps");
        };
        // The second tempo segment starts at 2s, so the frame just before it
        // still reads the first tempo and the frame at it reads the second.
        assert_eq!(maps.tempo.tempo_at(88_199), 120.0);
        assert_eq!(maps.tempo.tempo_at(88_200), 90.0);
        assert_eq!(maps.time_signature.at(0), (7, 8));
    }

    /// A loop shorter than the engine's floor is held but not honoured, so the
    /// applied report must say so rather than echoing the caller's `enabled`.
    #[test]
    fn a_loop_too_short_to_honour_is_reported_as_not_looping() {
        let payload = TransportMapsPayload {
            loop_region: Some(LoopRegionPayload {
                enabled: true,
                start_seconds: 1.0,
                end_seconds: 1.000_01,
            }),
            ..maps_payload()
        };

        let (_, applied) = transport_maps_commands(&payload, 48_000.0).expect("maps should build");

        assert!(!applied.loop_enabled);
    }

    #[test]
    fn a_map_the_engine_refuses_names_which_map_it_was() {
        let payload = TransportMapsPayload {
            tempo: vec![TempoSegmentPayload {
                start_seconds: 1.0,
                beats_per_minute: 120.0,
            }],
            ..maps_payload()
        };

        let Err(error) = transport_maps_commands(&payload, 48_000.0) else {
            panic!("a map that does not start at zero is unusable");
        };

        assert!(
            error.starts_with("tempo map is unusable:"),
            "unexpected error: {error}"
        );
    }

    /// The frontend mirror type is hand-maintained (crates/sourdaw-native/AGENTS.md),
    /// so the wire shape is a contract: pin every key.
    #[test]
    fn the_position_payload_serializes_with_camel_case_keys() {
        let json = serde_json::to_string(&EngineTransportPosition {
            running: true,
            playing: true,
            position_seconds: 1.5,
            playhead_frame: 72_000.0,
            loop_wraps: 2.0,
            batches_applied: 11.0,
            tempo: 128.0,
            time_sig_num: 5,
            time_sig_denom: 4,
        })
        .expect("position should serialize");

        assert_eq!(
            json,
            concat!(
                r#"{"running":true,"playing":true,"positionSeconds":1.5,"#,
                r#""playheadFrame":72000.0,"loopWraps":2.0,"batchesApplied":11.0,"#,
                r#""tempo":128.0,"timeSigNum":5,"timeSigDenom":4}"#
            )
        );
    }

    /// Every field of a reading comes from the one snapshot the engine
    /// published, `batchesApplied` included. That field is what a caller uses
    /// to date the reading against a command it sent, so a count drawn from a
    /// second channel would be a count for a different callback than the
    /// playhead beside it.
    #[test]
    fn a_position_is_the_transport_snapshot_the_engine_published() {
        let snapshot = TransportPositionSnapshot {
            playing: true,
            playhead_frame: 72_000,
            loop_wraps: 2,
            batches_applied: 11,
            tempo: 128.0,
            time_sig_num: 5,
            time_sig_denom: 4,
        };

        let position = transport_position_payload(snapshot, 48_000.0);

        assert_eq!(position.batches_applied, 11.0);
        assert_eq!(position.playhead_frame, 72_000.0);
        assert_eq!(position.position_seconds, 1.5);
        assert_eq!(position.loop_wraps, 2.0);
    }

    #[test]
    fn a_stopped_engine_reports_the_not_running_shape() {
        let state = AppState::default();

        let position = crate::block_on_test(engine_transport_position(&state))
            .expect("position should be readable");

        assert_eq!(position, EngineTransportPosition::default());
        assert!(!position.running);
    }

    /// Without an engine there is nowhere to put the maps. Answering `Ok` would
    /// leave the caller believing a tempo map is installed that no audio block
    /// will ever read.
    #[test]
    fn installing_maps_without_an_engine_refuses() {
        let state = AppState::default();

        let error = crate::block_on_test(set_transport_maps(maps_payload(), &state))
            .expect_err("there is no engine to hold the maps");

        assert_eq!(error, "no native engine is running");
    }

    /// A batch the ring refused is not a fence, so the install must number one
    /// only once the push has been taken. Numbering above the send would run
    /// `batches_sent` ahead of the engine's `batches_applied` for the rest of
    /// the session: every later batch would report a number one past the count
    /// it is held against, `admittedBatch` would promise a drain that never
    /// comes, and the live automation writer would discard every snapshot it
    /// polls.
    #[test]
    fn a_refused_maps_push_numbers_no_fence() {
        use crate::commands::graph::apply_graph_commands;

        let state = AppState::default();
        // A ring of one holds a single fence and nothing more, so the maps
        // batch has to grow it; with the retirement adoption channel gone that
        // growth fails, which is the engine's refusal — nothing pushed.
        let (engine, _command_rx, retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(1);
        drop(retired_adoption_rx);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let refusal = crate::block_on_test(set_transport_maps(maps_payload(), &state))
            .expect_err("a batch the ring will not take is not installed");
        assert!(
            refusal.contains("transport maps were not applied"),
            "got: {refusal}"
        );

        // One fence still fits the untouched ring, and it is the first fence of
        // the session: the refused install left the counter where it found it.
        let batch = crate::block_on_test(apply_graph_commands(
            serde_json::json!({ "schemaVersion": 1, "commands": [] }),
            &state,
        ))
        .expect("the batch resolves to a result");
        assert_eq!(batch["application"], "applied");
        assert_eq!(
            batch["admittedBatch"].as_u64(),
            Some(1),
            "the first fence the engine will drain is this batch's, not the refused install's"
        );
    }

    /// The maps install publishes a fence of its own, outside the graph batch
    /// path, and both fences are numbered by the one counter the engine counts
    /// with. An install that sent its fence without numbering it would leave
    /// every later graph batch reporting a number the engine had already passed
    /// — the ledger would release writes the audio thread never popped, and a
    /// transport reading taken before a locate would pass for one taken after.
    #[test]
    fn installing_maps_numbers_its_fence_in_the_same_count_a_graph_batch_uses() {
        use crate::commands::graph::apply_graph_commands;

        let state = AppState::default();
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let applied = crate::block_on_test(set_transport_maps(maps_payload(), &state))
            .expect("the maps install onto a running engine");
        assert_eq!(
            applied.admitted_batch, 1,
            "the install numbered its own fence against a fresh ledger"
        );

        let mut fences = 0;
        while let Ok(command) = command_rx.pop() {
            if matches!(command, GraphCommand::BeginBatch { .. }) {
                fences += 1;
            }
        }
        assert_eq!(fences, 1, "one fence, the one the number is about");

        let batch = crate::block_on_test(apply_graph_commands(
            serde_json::json!({ "schemaVersion": 1, "commands": [] }),
            &state,
        ))
        .expect("the batch resolves to a result");
        assert_eq!(batch["application"], "applied");
        assert_eq!(
            batch["admittedBatch"].as_u64(),
            Some(applied.admitted_batch + 1),
            "a graph batch is numbered after the install's fence, not over it"
        );
    }
}
