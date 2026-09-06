//! The native transport of the `AudioGraphBackend` seam.
//!
//! `src/modules/AudioEngine/models/AudioGraphBackend.ts` is the law this file
//! serves: one strip id space for tracks and buses, a command batch applied
//! whole or refused whole **before** any application, project-unit values with
//! the level law applied here, and a result that mirrors
//! `AudioGraphApplyResult` (`rejected` / `applied` / `needs-reconcile`) with
//! per-command refusal reasons. The wire payloads below are the hand-maintained
//! serde mirror of that contract's batch types (crates/sourdaw-native/AGENTS.md
//! — no binding generator runs).
//!
//! This file is where the native chain stopped rendering only silence plus
//! hosted plugins: a batch applied here builds timeline tracks, clips, buses,
//! sends and device chains that `daw-engine` renders. Web Audio remains the
//! live product path until the D3.c cutover; the commands stay denied in the
//! shipped shell, and the offline render below is the parity oracle for that
//! cutover.
//!
//! ## Mapping
//!
//! Every batch is validated and mapped control-side into a vector of
//! [`GraphCommand`]s against a working clone of the [`GraphRegistry`] — the
//! registry that resolves the app's string strip/device ids onto the engine's
//! `usize` node ids. Only a batch that maps completely is pushed, and it
//! crosses the ring behind a batch fence the audio callback refuses to drain
//! past until every command behind it is visible
//! (`EngineHandle::send_graph_batch`), so the engine never *observes* half a
//! topology — a block boundary between two of a batch's commands renders the
//! pre-batch graph, never a partial one. A batch larger than the ring
//! provisions a bigger ring first, control-side, handed over through a
//! lock-free swap; ring capacity never bounds an admitted batch. Anything
//! this backend cannot honour
//! — a route it cannot carry, a device it cannot build on a contributing
//! strip, a write shape it has no primitive for — refuses the batch with a
//! reason naming the command, never drops the command silently.
//!
//! ## Clip source binding
//!
//! `schedule-clip` resolves `source.sourceId` against the sample pool
//! `register_timeline_sample` fills: raw PCM as **interleaved f32
//! little-endian** (`L0,R0,L1,R1,…`; mono is just `L0,L1,…`) plus the
//! material's own sample rate, keyed by the app's stable source id. A clip
//! whose material was decoded at a different rate than the engine runs at is
//! rate-converted through `ClipPlayback::playback_rate`
//! (`material_rate / engine_rate` — a sample-rate conversion, which preserves
//! pitch-at-speed semantics). The contract's own `playbackRate` is varispeed —
//! rate and pitch move together, exactly what `ClipPlayback::playback_rate`
//! already documents and what an `AudioBufferSourceNode` does on the Web
//! Audio legs — so the user's rate is folded into the same conversion:
//! `effective_rate = playbackRate * (material_rate / engine_rate)`. Only a
//! non-positive or non-finite rate is refused; nothing here claims
//! pitch-preserving stretch, which does not exist on any clip-playback leg.
//!
//! ## Engine bootstrap (#1984)
//!
//! The recorded activation point is **lazy start on the first
//! `apply_graph_commands`**: the engine spawns its audio stream when the first
//! batch arrives, and a machine with no output device degrades observably —
//! the batch is rejected with an `engine-not-running:` reason and
//! `engine_rt_diagnostics` keeps reporting `running: false`. The old
//! `start_native_engine` command was deleted in favour of this path: it had no
//! caller in any shipped build, and a second, unconditioned start entry point
//! beside a lazy one is two bootstraps to keep honest instead of one.
//! `render_graph_offline` never starts the live engine at all.
//!
//! ## The loop seam
//!
//! A loop region breaks the playhead's monotonicity, and the progress echo
//! carries the seam beside it for that reason: `loop_wraps` counts the seams
//! the engine has closed, and `last_wrap_frame` is the frame the pass that
//! closed the newest one walked to.
//!
//! Two consumers read that pair, and only one of them is here. This module's
//! queue ledger uses it to prove a write left the engine's queue when the
//! pinned playhead never can ([`proven_popped`]). The other is the per-pass
//! automation re-arm: the engine's automation queue is a window rather than a
//! curve, so a pass consumes what it walks past and the seam does not put it
//! back, and something has to re-send it. That belongs to the automation owner
//! above this layer, which holds the three things re-arming needs and this
//! layer has none of — it owns the curve, it learns the loop region, and it
//! already polls the position feed on a cadence it can send from. This module
//! sees single commands from an arbitrary caller, is never told the region,
//! and has no clock of its own.
//!
//! ## Strip reports
//!
//! The result's `reports` are observations of the post-batch registry, never
//! echoes of the request: every strip a batch creates or whose chain it
//! touches (`insert-device`, `remove-device`) reports its realized
//! `deviceIds` after the whole batch — the touched-strip law
//! `AudioGraphBackend.ts` states for `AudioGraphStripReport`. A device that
//! degraded on a non-contributing strip is therefore visibly absent, and no
//! chain edit through this backend is silent — a degraded `insert-device`
//! still produces a report whose ids reflect reality. The offline render wire
//! (`render_graph_offline`) answers PCM bytes only; reports reach the TS
//! offline backend over their own wire, [`map_graph_batch`] — the same
//! mapping this file applies, run against the backend's already-committed
//! commands plus the incoming batch, with nothing rendered. The TS side never
//! restates reports from its own commands.
//!
//! ## Correlation
//!
//! A live batch that carries a `correlation` claims the runtime revision it
//! was built against (`RuntimeGraphCorrelation.appRevision`);
//! [`apply_graph_commands`] validates that claim against the registry's
//! `runtime_revision` **before** the lazy engine bootstrap, so a batch that
//! lost its race is `rejected` before the graph changes — and before a batch
//! that will not apply can start an engine. A batch without a correlation is
//! simply not correlated (the offline bounce renders a snapshot no live
//! document races) and skips validation. `projectRevision` is project-truth's
//! coordinate; the TS side owns comparing it (`acceptCorrelation` in the web
//! backend), so this side neither stores nor checks it. The offline paths
//! (`render_graph_offline`, `map_graph_batch`) echo a correlation verbatim
//! and never validate: a mapping has no live graph to race.
//!
//! ## The transport ownership law
//!
//! Two paths write transport state into one live engine. The split is by
//! field, not by path: the graph's `set-transport` owns `is_playing` and the
//! song position (`GraphCommand::SetTransportPlayback`), while tempo and time
//! signature are owned by `GraphCommand::SetTransport`, whose live producer
//! arrives with the live cutover. A graph
//! transport write leaves plugin-visible tempo and time signature untouched;
//! the engine re-derives the beat position from the tempo it already holds.
//!
//! A `set-transport` is also a **locate** unless it says otherwise, and a
//! locate is destructive by design: it seeks, and a seek cancels every queued
//! mixer write stamped at or past the frame it lands on
//! (`RampedParam::cancel_from`). Strip creation states a fader, a pan and each
//! send level as writes stamped at frame 0, so a transport write that locates
//! to the session head after those strips were built erases the mix they
//! declared. A producer that only needs to start or stop playback from where
//! the engine already stands therefore sends `locate: false`.
//!
//! ## Known deviations, recorded rather than silent
//!
//! - `smoothed` writes (Web Audio `setTargetAtTime`) have no native
//!   primitive; they refuse. `ramp-to` maps onto `AutomationWrite::Replace`
//!   (cancel-and-replace, re-anchored — the semantics the contract requires),
//!   `step` onto `Append`, `hold` onto `Hold`.
//! - Gate writes (`track-mute-gate` / `track-solo-gate`) accept only `step`,
//!   and the stamp is not honoured at all: the native gates are strip flags,
//!   not ramped parameters, so the write applies at the block boundary that
//!   drains the command — even when its stamp names a future time.
//! - A bus strip has no send taps in `daw-engine`; a send whose source is a
//!   bus refuses with a reason naming the gap (`bus-send-unsupported`).

use crate::commands::crumbs::{self, CrumbsState};
use crate::state::{AppState, TimelineSample, TimelineSamplePool};
use daw_engine::midi::note_store::{MidiNoteStore, TimedMidiNote, MIDI_NOTE_STORE_CAPACITY};
use daw_engine::midi_fx::{probability_percent_to_cutoff, PROBABILITY_CUTOFF_RANGE};
use daw_engine::offline::OfflineRenderer;
use daw_engine::plugin_slot::MidiNoteEvent;
use daw_engine::scheduler::{
    layer_routing_first, BuiltinEffectType, GraphCommand, GraphProgressSnapshot, PluginCore,
    TIMELINE_CHAIN_SLOT_BUDGET,
};
use daw_engine::timeline::{
    AutomationEvent, AutomationTarget, AutomationWrite, ChainEntry, ClipFade, ClipPlacement,
    ClipPlayback, DeviceKind, DeviceParam, DeviceParamTarget, FermenterParamName, RampShape,
    RouteTarget, TimelineBus, TimelineClip, TimelineRtDiagnosticsSnapshot, TimelineTrack,
    AUTOMATION_QUEUE_CAPACITY, DEVICE_PARAM_QUEUE_CAPACITY, FERMENTER_PARAM_NAME_CAPACITY,
    MAX_BUS_DEVICES, MAX_TIMELINE_BUSES, MAX_TIMELINE_TRACKS, MAX_TRACK_CLIPS, MAX_TRACK_DEVICES,
    MAX_TRACK_SENDS,
};
use daw_engine::GraphBatchError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

/// Headroom the fader allows above unity, in decibels — the mirror of
/// `FADER_HEADROOM_DB` in `src/utils/audioLevelLaw.ts`, the definition of
/// record. Ableton Live and Logic stop at +6 dB; change this only in
/// lockstep with that constant.
const FADER_HEADROOM_DB: f32 = 6.0;

/// The fader ceiling, as a linear amplitude — the same product invariant as
/// `FADER_MAX_GAIN` in `src/utils/audioLevelLaw.ts`: `10^(FADER_HEADROOM_DB /
/// 20)` ≈ 1.9953, `+6 dB` of headroom above unity, not unity itself — a
/// track fader can produce make-up gain, the same as the reference DAWs
/// above. A stored gain in that headroom band must render the same live and
/// offline, or an export drifts quieter than what the fader played back
/// (#789's class of bug, and the reason this native path exists at all).
/// `f32::powf` is not a `const fn` on stable Rust, so this is a function
/// rather than a `const`.
fn fader_max_gain() -> f32 {
    10f32.powf(FADER_HEADROOM_DB / 20.0)
}

/// The time constant the master fader approaches a new level on.
///
/// The law is the Web Audio fader's own: `setMasterGain` in
/// `src/modules/AudioEngine/repositories/createWebAudioEngine.ts` smooths with
/// `setTargetAtTime(value, now, 0.01)`, a one-pole approach that covers the
/// same fraction of the distance left every sample. Both carriers of one mix
/// answer one gesture by one law, so a strip the native engine carries arrives
/// at the new level together with the strips beside it. Ten milliseconds is
/// also slow enough to make the loudest move a fader can make — unity to
/// silence — click-free.
const MASTER_GAIN_TIME_CONSTANT_SECONDS: f64 = 0.010;

/// The per-sample coefficient of that approach: `1 - exp(-1 / (T * fs))`, the
/// fraction of the distance left one sample covers.
fn master_gain_smoothing(sample_rate: f32) -> f32 {
    (1.0 - (-1.0 / (MASTER_GAIN_TIME_CONSTANT_SECONDS * f64::from(sample_rate))).exp()) as f32
}

/// This app's pan scale is −50…+50; the engine's pan law takes −1…+1.
const PROJECT_PAN_SCALE: f32 = 50.0;

/// Graph-owned effect ids start far above the plugin range (`EngineHandle`
/// reserves plugin ids from 1000 upward) so the two allocators can never
/// collide in the scheduler's shared effect table.
const FIRST_GRAPH_EFFECT_ID: usize = 2_000_000;

/// The one refusal-free ceiling on an offline render: ten minutes at 48 kHz.
/// A null test renders windows, not albums, and an unbounded frame count is an
/// unbounded allocation. The sample pool applies the same ceiling per channel
/// on registration for the same reason: `register_timeline_sample` copies the
/// material it accepts, so an unbounded payload is an unbounded allocation
/// twice over.
const MAX_OFFLINE_RENDER_FRAMES: usize = 48_000 * 600;

/// Create-*-strip plus set-track-output, then the per-strip send, device, and
/// clip slots a maximal topology batch fills.
const MAX_STRIP_TOPOLOGY_COMMANDS: usize =
    2 + MAX_TRACK_SENDS + MAX_TRACK_DEVICES + MAX_TRACK_CLIPS;

/// One queue fill of `write-parameter` (fader, pan, mute, solo, and each send
/// level) plus one `write-device-parameter` fill per device slot.
const MAX_STRIP_AUTOMATION_COMMANDS: usize = (4 + MAX_TRACK_SENDS) * AUTOMATION_QUEUE_CAPACITY
    + MAX_TRACK_DEVICES * DEVICE_PARAM_QUEUE_CAPACITY;

/// The most commands one batch may carry.
///
/// The batch arrives from the renderer and sizes two rings that live as long
/// as the process: `EngineHandle::send_graph_batch` provisions the command
/// ring from the batch it is handed, and the retirement ring with it. Neither
/// shrinks again, so an unbounded array is an unbounded resident allocation
/// bought by one message. The ceiling is what a maximal project genuinely
/// needs — every strip created, routed, sent, filled with devices and clips,
/// plus a full `write-parameter` and `write-device-parameter` queue fill per
/// mixer and device target — so it can refuse a hostile batch without ever
/// meeting an honest one.
///
/// The op count that sizes the two rings is not one op per command. A
/// replacing batch tears every existing strip and device down before the
/// first command runs ([`GraphRegistry::take_topology_down`]), and a device
/// command ([`map_device`]) always expands into several ops of its own —
/// `AddDetachedEffect`, one `SetParam` per resolved parameter, an optional
/// `SetBypass`, and the caller's own insert op.
/// [`GraphCommandPayload::SetDeviceParameters`] is the one command whose own
/// expansion is data-driven rather than fixed, and `map_batch` bounds that
/// expansion across the whole batch by charging every record's key count
/// against [`MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH`] before any of that
/// record's keys are parsed. The op count is therefore a bounded multiple of
/// `MAX_BATCH_COMMANDS`, plus that ceiling — not an exact sum of the two.
const MAX_BATCH_COMMANDS: usize = (MAX_TIMELINE_TRACKS + MAX_TIMELINE_BUSES)
    * (MAX_STRIP_TOPOLOGY_COMMANDS + MAX_STRIP_AUTOMATION_COMMANDS);

/// The most parameters one `set-device-parameters` record may carry.
///
/// Sized from the wire producer, not any claimed instrument vocabulary:
/// `mapFermenterPatchToDspPatch` (`src/modules/Fermenter/useCases/
/// fermenterParamBridge/`) emits one key per patch field plus one per
/// `macros` slot, and 128 holds one full patch with headroom; the
/// TypeScript mirror of this ceiling is what pins that fit. Whether the
/// instrument honours a key is its own affair; a well-shaped name it does
/// not recognize is simply a silent no-op there. The ceiling is charged
/// against the record's length before any key is resolved, so a hostile
/// record is refused without ever parsing a single name.
const MAX_IMMEDIATE_DEVICE_PARAMETERS: usize = 128;

/// The most immediate device parameters one whole batch may carry, summed
/// across every [`GraphCommandPayload::SetDeviceParameters`] record in it.
///
/// This ceiling bounds the sum of every record's key count in one batch.
/// The honest maximum is one full patch written to every device slot of
/// one strip in one animation frame, since the producer batches one frame
/// of gestures at a time.
/// `map_batch` charges each record's key count against a running total
/// before that record's keys are parsed, refusing the batch whole — naming
/// the running count and this ceiling — the moment it would be crossed.
const MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH: usize =
    MAX_TRACK_DEVICES * MAX_IMMEDIATE_DEVICE_PARAMETERS;

/// MIDI channels a note can sound on.
///
/// Mirrors the engine's own address space, which is where the ceiling comes
/// from: it keeps one bit per note per channel for the notes a device has
/// sounded, so a note past either bound is one nothing could ever release.
const MIDI_CHANNELS: u8 = 16;

/// Notes one MIDI channel can carry, for the reason above.
const NOTES_PER_CHANNEL: u8 = 128;

/// The hardest a MIDI note can be struck.
const MAX_MIDI_VELOCITY: u8 = 127;

// ── Wire payloads (hand-maintained mirror of AudioGraphBackend.ts) ─────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphBatchPayload {
    pub schema_version: u32,
    #[serde(default)]
    pub correlation: Option<Value>,
    /// Whether this batch **replaces** the graph rather than adding to it.
    ///
    /// The live registry lives as long as the process and this surface has no
    /// remove-strip vocabulary, so a second batch naming the strip ids the
    /// first one built refuses on every one of them. A producer that rebuilds
    /// a session's topology per play — the live one does, because topology
    /// drifts between plays — marks the batch instead: the mapper tears the
    /// previous topology down inside the same fence, and the batch's own
    /// commands build against an empty graph.
    #[serde(default)]
    pub replace_topology: bool,
    pub commands: Vec<GraphCommandPayload>,
}

/// A `set-transport` that does not say otherwise is a locate — the meaning the
/// field's absence carried before it existed, so every producer written against
/// the older shape keeps behaving exactly as it did.
fn locate_unless_told_otherwise() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum GraphCommandPayload {
    #[serde(rename_all = "camelCase")]
    CreateTrackStrip {
        track_id: String,
        name: String,
        state: StripStatePayload,
        devices: Vec<DevicePayload>,
        honor_muted: bool,
        contributes_audio: bool,
    },
    #[serde(rename_all = "camelCase")]
    CreateBusStrip {
        bus_id: String,
        name: String,
        state: StripStatePayload,
        devices: Vec<DevicePayload>,
        honor_muted: bool,
        contributes_audio: bool,
    },
    #[serde(rename_all = "camelCase")]
    SetTrackOutput {
        track_id: String,
        target: RouteTargetPayload,
    },
    #[serde(rename_all = "camelCase")]
    AddSend {
        track_id: String,
        bus_id: String,
        tap: SendTapPayload,
        level: f64,
    },
    #[serde(rename_all = "camelCase")]
    RemoveSend { track_id: String, bus_id: String },
    #[serde(rename_all = "camelCase")]
    InsertDevice {
        track_id: String,
        device: DevicePayload,
        index: u32,
    },
    #[serde(rename_all = "camelCase")]
    RemoveDevice { track_id: String, device_id: String },
    #[serde(rename_all = "camelCase")]
    WriteParameter {
        target: StripParameterTargetPayload,
        write: ParameterWritePayload,
    },
    #[serde(rename_all = "camelCase")]
    WriteDeviceParameter {
        target: DeviceParameterTargetPayload,
        write: StepWritePayload,
    },
    /// Land every named value on a built-in body at the next audio callback,
    /// replacing the value the body currently holds and leaving whatever the
    /// device's stamp queue is holding untouched.
    ///
    /// The immediate counterpart of [`GraphCommandPayload::WriteDeviceParameter`],
    /// and a whole record rather than one write, because what reaches here is a
    /// patch: a fermenter's is about a hundred keys, and a morph or a macro drag
    /// reloads the whole record at animation-frame rate. Stamped writes cannot
    /// carry that — a device's queue holds `DEVICE_PARAM_QUEUE_CAPACITY` pending
    /// stamps in total, so one patch overruns it several times over — while
    /// [`GraphCommand::SetParam`] is applied on the next drain and parks nothing.
    ///
    /// A native built-in only. An externally hosted plugin's parameters are the
    /// plugin's own, addressed over the plugin host's control path, so one aimed
    /// at a borrowed instance is refused rather than mapped through a built-in
    /// vocabulary that cannot address it.
    ///
    /// `values` is charged against [`MAX_IMMEDIATE_DEVICE_PARAMETERS`], and
    /// this record's count together with every earlier
    /// `SetDeviceParameters` record in the same batch is charged against
    /// [`MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH`], before any key is
    /// resolved — because each entry becomes one `SetParam` op, and a batch
    /// of records at the per-record ceiling would otherwise carry no bound
    /// of its own.
    #[serde(rename_all = "camelCase")]
    SetDeviceParameters {
        track_id: String,
        device_id: String,
        /// Keyed by the built-in's own native parameter names — for a
        /// fermenter, the instrument's snake_case vocabulary rather than the
        /// camelCase descriptor ids a project panel authors. A key with no
        /// native address refuses the whole batch, naming the device and the
        /// key, exactly as a stamped write does.
        values: HashMap<String, f64>,
    },
    /// Write timeline-addressed notes into the note store a device holds.
    ///
    /// A batch variant rather than a command of its own, because a producer
    /// rewriting a bar sends the [`GraphCommandPayload::ClearMidi`] that empties
    /// it and the notes that replace it together. One batch is one visibility
    /// on the audio thread, so the clear settles against the store the whole
    /// drain left, and a note-off the clear stripped is read as *moved* rather
    /// than deleted ([`daw_engine::EngineHandle::schedule_midi_notes`]). As two
    /// commands they could land in different drains, and the clear would then
    /// release a note the rewrite only meant to lengthen.
    ///
    /// Visible together is not the same as succeeding together. This mapping
    /// refuses only what it can see control-side; the engine still refuses a
    /// batch past the store's free capacity, counting it in
    /// `midi_note_batches_refused`, and the clear stays applied regardless.
    #[serde(rename_all = "camelCase")]
    ScheduleMidi {
        track_id: String,
        device_id: String,
        /// The project's probability seed: the value every carrier rolls a
        /// chance note with, and the same one the Web Audio live and offline
        /// carriers read off the project (`midiStore`'s `probabilitySeed`).
        ///
        /// A project fact rather than a note's, so it travels once per command
        /// and is stamped onto every note the command maps. Required, because
        /// a default would itself be a seed:
        /// [`daw_engine::midi_fx::deterministic_probability_roll`] mixes it
        /// first, so a stand-in decides a chance note differently from every
        /// other carrier, and one arrangement would voice one way in the
        /// browser and another way through this wire.
        probability_seed: u32,
        notes: Vec<MidiNotePayload>,
    },
    /// Play one note now at a device that sinks notes.
    ///
    /// The note is handed to the device at the head of the first block the
    /// engine renders after this batch is applied, and it sounds whether or
    /// not the transport is playing: a key struck on a keyboard names no
    /// timeline position, so there is no position for a stopped playhead to
    /// withhold it from. A note that *does* have one travels as
    /// [`GraphCommandPayload::ScheduleMidi`] instead.
    ///
    /// The engine releases it exactly as it releases a stored note — a stop, a
    /// locate or a loop wrap lifts a key still held ([`GraphCommand::SendMidiNote`]) —
    /// so a note whose note-off never arrives cannot hold an instrument down
    /// for the rest of the session.
    #[serde(rename_all = "camelCase")]
    SendMidiNote {
        track_id: String,
        device_id: String,
        note: u8,
        velocity: u8,
        channel: i16,
        is_note_on: bool,
    },
    /// Drop a device's scheduled notes in the half-open seconds window
    /// `fromTime..toTime`; an absent or null `toTime` means the end of the
    /// store, so `0` with no end clears it.
    ///
    /// Half-open so a producer rewriting one bar clears exactly its span: the
    /// note starting the next bar borders the window without being inside it.
    ///
    /// A batch variant for the reason
    /// [`GraphCommandPayload::ScheduleMidi`] states — the pair is the rewrite,
    /// and only one batch makes both visible to the callback at once.
    ///
    /// A device holding no note store refuses this by name, on the same
    /// ownership fact `schedule-midi` reads. Left unrefused, the engine would
    /// simply find no store to clear and drop the request in silence; naming
    /// it here instead surfaces a producer's mistake rather than swallowing
    /// it.
    #[serde(rename_all = "camelCase")]
    ClearMidi {
        track_id: String,
        device_id: String,
        from_time: f64,
        #[serde(default)]
        to_time: Option<f64>,
    },
    #[serde(rename_all = "camelCase")]
    ScheduleClip { playback: ClipPlaybackPayload },
    #[serde(rename_all = "camelCase")]
    SetTransport {
        playing: bool,
        position_seconds: f64,
        /// Whether this write is also a *locate*. Absent means it is, which is
        /// what every producer that moves the playhead wants and what the
        /// field's absence has always meant.
        ///
        /// A producer sets it `false` to say "roll from where you already
        /// stand". That is not a convenience: a locate cancels every queued
        /// mixer write stamped at or past its frame (see the mapping arm), so a
        /// second transport write that merely starts playback would erase the
        /// fader, pan and send levels an earlier batch queued at frame 0. The
        /// position still travels, because `SetTransportPlayback` carries it
        /// and it must stay truthful; only the seek is withheld.
        #[serde(default = "locate_unless_told_otherwise")]
        locate: bool,
    },
    /// The session-level shadow monitor gate
    /// ([`GraphCommand::SetMonitorShadow`]): the engine keeps rendering and
    /// contributes nothing to the OS output. It travels with the topology
    /// rather than as a start parameter because the engine has no start call
    /// to carry one — `apply_graph_commands` boots it lazily on the first
    /// batch — and because the cutover has to be expressible on a session
    /// that is already rolling.
    #[serde(rename_all = "camelCase")]
    SetMonitorShadow { shadowed: bool },
    /// The master fader, as a linear amplitude on the same scale a strip's
    /// `gain` uses (`1.0` is unity, and the ceiling is the fader's headroom
    /// rather than unity). Session-level like the monitor gate: it addresses
    /// no strip, appears in no report, and is never a `write-parameter`
    /// target. Where the hand left the fader is true at every position, so the
    /// engine takes it as a target to approach rather than as a change stamped
    /// at a frame.
    #[serde(rename_all = "camelCase")]
    SetMasterGain { gain: f64 },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StripStatePayload {
    pub gain: f64,
    pub pan: f64,
    pub muted: bool,
    pub solo_gated: bool,
    pub vca_multiplier: f64,
}

/// Project truth's `Device`, mirrored. `deviceState` is opaque to this
/// backend and ignored. A device naming an `externalInstanceId` the engine
/// already owns is spliced onto the strip by that instance's own effect id
/// ([`map_device`]); one naming a plugin the engine does not hold has no
/// native body and follows the degradation law in [`no_native_body`].
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePayload {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub device_type: String,
    #[serde(default)]
    pub bypassed: bool,
    #[serde(default)]
    pub parameter_values: HashMap<String, f64>,
    #[serde(default)]
    pub external_plugin_id: Option<String>,
    #[serde(default)]
    pub external_instance_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RouteTargetPayload {
    Master,
    #[serde(rename_all = "camelCase")]
    Bus {
        bus_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Track {
        track_id: String,
    },
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum SendTapPayload {
    PreFader,
    PostFader,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum StripParameterTargetPayload {
    #[serde(rename_all = "camelCase")]
    TrackFader { track_id: String },
    #[serde(rename_all = "camelCase")]
    TrackPan { track_id: String },
    #[serde(rename_all = "camelCase")]
    TrackMuteGate { track_id: String },
    #[serde(rename_all = "camelCase")]
    TrackSoloGate { track_id: String },
    #[serde(rename_all = "camelCase")]
    TrackSendLevel { track_id: String, bus_id: String },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum DeviceParameterTargetPayload {
    #[serde(rename_all = "camelCase")]
    DeviceParameter {
        track_id: String,
        device_id: String,
        parameter_id: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "shape", rename_all = "kebab-case")]
pub enum ParameterWritePayload {
    #[serde(rename_all = "camelCase")]
    RampTo {
        value: f64,
        start_time: f64,
        land_time: f64,
    },
    #[serde(rename_all = "camelCase")]
    Smoothed {
        value: f64,
        time: f64,
        time_constant_seconds: f64,
    },
    #[serde(rename_all = "camelCase")]
    Step { value: f64, time: f64 },
    #[serde(rename_all = "camelCase")]
    Hold { time: f64 },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "shape", rename_all = "kebab-case")]
pub enum StepWritePayload {
    #[serde(rename_all = "camelCase")]
    Step { value: f64, time: f64 },
}

/// One scheduled note, as the producer writes it.
///
/// There is no frame offset here on purpose: delivery stamps the event from its
/// timeline frame and the first frame of the span that renders it, so a value a
/// producer put there would be overwritten rather than honoured.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiNotePayload {
    /// Absolute timeline position, in seconds.
    pub time: f64,
    pub note: u8,
    pub velocity: u8,
    pub channel: u8,
    pub is_note_on: bool,
    /// The chance this note sounds, `0..=1`. Absent means it always plays,
    /// which is the answer the live `send_plugin_midi` path gives too.
    #[serde(default)]
    pub probability: Option<f64>,
    #[serde(default)]
    pub clip_id_hash: Option<u32>,
    #[serde(default)]
    pub event_id_hash: Option<u32>,
    #[serde(default)]
    pub absolute_occurrence_index: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipPlaybackPayload {
    pub track_id: String,
    pub source: ClipSourcePayload,
    pub start_time: f64,
    pub source_offset_seconds: f64,
    pub duration_seconds: f64,
    pub playback_rate: f64,
    pub gain: f64,
    pub fade: ClipFadePayload,
}

/// The contract's `buffer` field is the *web* realisation of the source and
/// cannot cross this wire; only the identity does.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSourcePayload {
    pub source_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipFadePayload {
    #[serde(default)]
    pub fade_in: Option<FadeInPayload>,
    #[serde(default)]
    pub fade_out: Option<FadeOutPayload>,
    pub micro_fade_seconds: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FadeInPayload {
    #[serde(default)]
    pub reaches_full_at: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FadeOutPayload {
    #[serde(default)]
    pub begins_at: Option<f64>,
}

// ── Result payload (mirror of AudioGraphApplyResult) ───────────────────────

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StripReportPayload {
    pub kind: &'static str,
    pub id: String,
    pub device_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphApplyResultPayload {
    pub acceptance: &'static str,
    pub application: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compensation: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_revision: Option<u64>,
    /// The fence number the engine's `batches_applied` reaches once this batch
    /// has drained — present only when a batch actually reached the live
    /// engine's ring. A caller holds it against
    /// `EngineTransportPosition::batchesApplied` to tell a transport reading
    /// taken after this batch from one taken before it, which no position or
    /// wrap count can say: `apply` resolves when the batch is fenced, not when
    /// it is drained.
    ///
    /// Absent for a mapping (no runtime, so no fence), for a refusal (nothing
    /// was pushed) and for a partial push (the fence stalls the drain, so the
    /// count never reaches it) — a number in any of those cases would promise
    /// a drain that is not coming.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admitted_batch: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reports: Option<Vec<StripReportPayload>>,
    /// Instances that were loaded before any engine was running and that this
    /// batch took over — see
    /// [`crate::commands::plugins::attach_dormant_plugins`].
    ///
    /// Present on an applied batch and empty when it attached nothing. Absent
    /// everywhere else, and that absence is a rule about when the attach runs,
    /// not just about what is serialized: the attach happens only once the
    /// batch is fenced and `applied` is the answer, so no other outcome ever has
    /// an instance to report. A rejected batch leaves every dormant instance
    /// dormant, which is what lets the next batch report it.
    ///
    /// The caller needs it because nothing else tells it a plugin it loaded into
    /// silence is now processing audio — its own load reported no engine plugin
    /// id at all, and there is no later event.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attached_plugins: Option<Vec<AttachedPluginPayload>>,
}

/// One instance an engine start took over, as the caller reads it.
///
/// The instance id is the whole payload. The engine's own plugin id is
/// deliberately not here: it names a slot in the scheduler, and no caller
/// outside this crate addresses one. A hosted plugin runs inline on the engine
/// clock, so it adds no round trip of its own to the device's latency and the
/// caller has nothing to compensate beyond the plugin's own declaration.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedPluginPayload {
    pub instance_id: String,
}

impl GraphApplyResultPayload {
    fn rejected(reason: String) -> Self {
        Self {
            acceptance: "rejected",
            application: "not-applied",
            reason: Some(reason),
            compensation: None,
            correlation: None,
            runtime_revision: None,
            admitted_batch: None,
            reports: None,
            attached_plugins: None,
        }
    }

    fn applied(
        correlation: Option<Value>,
        runtime_revision: u64,
        admitted_batch: u64,
        reports: Vec<StripReportPayload>,
        attached_plugins: Vec<AttachedPluginPayload>,
    ) -> Self {
        Self {
            acceptance: "accepted",
            application: "applied",
            reason: None,
            compensation: None,
            correlation,
            runtime_revision: Some(runtime_revision),
            admitted_batch: Some(admitted_batch),
            reports: Some(reports),
            attached_plugins: Some(attached_plugins),
        }
    }

    /// The result of a mapping that applied to no live engine
    /// ([`map_graph_batch`]): accepted and applied — to the carried
    /// registry — with the touched-strip reports, but with no
    /// `runtimeRevision`, because there is no runtime; the TS offline
    /// backend owns its own revision counter and must not adopt one from a
    /// mapping.
    fn mapped(correlation: Option<Value>, reports: Vec<StripReportPayload>) -> Self {
        Self {
            acceptance: "accepted",
            application: "applied",
            reason: None,
            compensation: None,
            correlation,
            runtime_revision: None,
            admitted_batch: None,
            reports: Some(reports),
            attached_plugins: None,
        }
    }

    fn needs_reconcile(
        reason: String,
        correlation: Option<Value>,
        runtime_revision: u64,
        reports: Vec<StripReportPayload>,
    ) -> Self {
        Self {
            acceptance: "accepted",
            application: "needs-reconcile",
            reason: Some(reason),
            compensation: Some("not-attempted"),
            correlation,
            runtime_revision: Some(runtime_revision),
            admitted_batch: None,
            reports: Some(reports),
            attached_plugins: None,
        }
    }
}

// ── The id registry ─────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StripKind {
    Track,
    Bus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum StripOutput {
    Master,
    /// The *native* id of the destination, with the kind it had when routed.
    Track(usize),
    Bus(usize),
}

#[derive(Clone, Debug)]
struct StripEntry {
    native_id: usize,
    kind: StripKind,
    vca_multiplier: f32,
    contributes_audio: bool,
    /// The realized insert chain, in chain order — what the strip report
    /// observes. A degraded device never enters it.
    device_ids: Vec<String>,
    clip_count: usize,
    send_bus_ids: Vec<String>,
    output: StripOutput,
}

#[derive(Clone, Debug)]
struct DeviceEntry {
    native_effect_id: usize,
    strip_id: String,
    /// The built-in body this device is, or `None` when its effect is a hosted
    /// plugin instance the engine already owned rather than one this registry
    /// allocated.
    ///
    /// Written at registration from what [`map_device`] actually built, and it
    /// is the only such fact the entry keeps: ownership, note-store presence
    /// and parameter vocabulary all follow from it, so none of the three can
    /// drift out of step with the others or with the body the engine holds.
    builtin: Option<BuiltinEffectType>,
}

impl DeviceEntry {
    /// Whether the effect id is a hosted plugin instance the engine already
    /// owns.
    ///
    /// It decides how the device leaves a chain: an effect this registry built
    /// is retired with its removal, while an engine-owned one is only released,
    /// because its lifetime belongs to the load that registered it and
    /// `unload_plugin` is what frees it. Retiring one here would take a live
    /// plugin's effect out from under the panel still driving it.
    fn engine_owned(&self) -> bool {
        self.builtin.is_none()
    }

    /// Whether this device holds a note store, and so can be scheduled at.
    ///
    /// Store presence is decided at registration, by the command that built
    /// the device, so this reads what was registered rather than guessing from
    /// what the device might do with what lands in it. Every engine-owned
    /// device is registered through `EngineHandle::add_hosted_plugin`, which
    /// attaches a store unconditionally; a built-in is registered with one
    /// exactly when its type sounds notes.
    fn note_sink(&self) -> bool {
        match self.builtin {
            None => true,
            Some(builtin) => builtin.sounds_notes(),
        }
    }
}

/// Resolves the app's string ids onto engine node ids and holds the strip
/// facts batch validation reads. One registry per live engine (on
/// [`AppState`]); an offline render builds a fresh one per call, because its
/// batch must be self-contained.
///
/// The registry also carries the cross-batch queue ledger (see
/// [`QueueBudgets`]): what earlier accepted batches left queued on the
/// engine's fixed per-parameter queues, so a later batch cannot overflow a
/// queue an earlier one filled. Stamps leave the ledger by exactly three
/// laws, each a mirror of an engine law, never a guess: a replace/hold's
/// stale-cancellation and a backward locate mirror the queues' own
/// cancellation ([`QueueBudgets`]); and [`Self::release_landed`] subtracts
/// what the engine's progress echo **proves** has left its queue
/// ([`proven_popped`]). The echo lags
/// the engine, so the ledger may over-refuse for a batch or two; it never
/// under-refuses, because nothing is released ahead of proof. An offline
/// render's fresh registry keeps the ledger exact for its one
/// self-contained batch.
#[derive(Clone, Debug)]
pub struct GraphRegistry {
    strips: HashMap<String, StripEntry>,
    devices: HashMap<String, DeviceEntry>,
    track_count: usize,
    bus_count: usize,
    next_node_id: usize,
    next_effect_id: usize,
    runtime_revision: u64,
    /// Fenced batches this registry has committed onto the live engine's
    /// ring — the control-side twin of the drain's `batches_applied` count.
    /// Every send is one fence ([`daw_engine::EngineHandle::send_graph_batch`])
    /// and this module is that fence's only producer, so batch `n` here is
    /// batch `n` in the engine's echo. That identity is an assumption, not a
    /// guarantee: this counter and the ledger stamps numbered from it are only
    /// comparable to `batches_applied` while both count the same stream, so any
    /// future engine-restart path must reset the registry's ledger and this
    /// counter together with the engine's — a counter left ahead of a restarted
    /// echo only over-refuses, but the invariant belongs where the counter
    /// lives.
    batches_sent: u64,
    automation_pending: HashMap<AutomationTarget, Vec<PendingStamp>>,
    device_param_pending: HashMap<usize, Vec<DeviceParamStamp>>,
}

impl Default for GraphRegistry {
    fn default() -> Self {
        Self {
            strips: HashMap::new(),
            devices: HashMap::new(),
            track_count: 0,
            bus_count: 0,
            next_node_id: 1,
            next_effect_id: FIRST_GRAPH_EFFECT_ID,
            runtime_revision: 0,
            batches_sent: 0,
            automation_pending: HashMap::new(),
            device_param_pending: HashMap::new(),
        }
    }
}

/// [`GraphRegistry::release_engine_plugin`]'s answer: the ops the release
/// produced, and which strips they touched.
pub(crate) struct EngineReleaseResult {
    pub(crate) ops: Vec<GraphCommand>,
    pub(crate) touched_strip_ids: Vec<String>,
}

impl GraphRegistry {
    /// Number a fence this process published outside [`map_batch`] — the
    /// transport maps install, which sends its own batch
    /// (`commands::engine_transport`).
    ///
    /// The engine numbers every fence it drains without caring which command
    /// sent it, so [`Self::batches_sent`] is only comparable to
    /// `batches_applied` while it counts them all. A fence left unnumbered
    /// here would leave every later batch's [`PendingStamp::admitted_batch`]
    /// below the count it is held against, and the ledger would release a
    /// stamp on a batch horizon it had not actually cleared.
    ///
    /// Called after the push succeeds, for the same reason `map_batch`'s own
    /// increment lives on a clone the caller only commits on success: a batch
    /// the ring refused is not a fence.
    pub(crate) fn record_fenced_batch(&mut self) -> u64 {
        self.batches_sent += 1;
        self.batches_sent
    }

    /// How many fences this registry has committed onto the engine's ring.
    ///
    /// Only a send the ring took advances it, so it is what separates a batch
    /// the engine was handed from one it refused.
    #[cfg(test)]
    pub(crate) fn fenced_batches(&self) -> u64 {
        self.batches_sent
    }

    fn allocate_node_id(&mut self) -> usize {
        let id = self.next_node_id;
        self.next_node_id += 1;
        id
    }

    fn allocate_effect_id(&mut self) -> usize {
        let id = self.next_effect_id;
        self.next_effect_id += 1;
        id
    }

    /// Whether routing `from` at `target` closes a cycle, walking the outputs
    /// and the sends this registry has recorded. The engine refuses cycles too,
    /// but its refusal is a counted drop on the audio thread; the contract
    /// demands the *batch* refuse instead, so the walk happens here first.
    fn would_cycle(&self, from: &StripEntry, target: StripOutput) -> bool {
        let mut stack = vec![target];
        let mut seen = HashSet::new();
        let limit = MAX_TIMELINE_TRACKS + MAX_TIMELINE_BUSES;
        while let Some(current) = stack.pop() {
            let next_native = match current {
                StripOutput::Master => continue,
                StripOutput::Track(native_id) | StripOutput::Bus(native_id) => native_id,
            };
            if next_native == from.native_id {
                return true;
            }
            if !seen.insert(next_native) {
                continue;
            }
            if seen.len() > limit {
                return true;
            }
            let Some(next) = self
                .strips
                .values()
                .find(|entry| entry.native_id == next_native)
            else {
                continue;
            };
            stack.push(next.output);
            if next.kind == StripKind::Track {
                for bus_id in &next.send_bus_ids {
                    let Some(bus) = self.strips.get(bus_id) else {
                        continue;
                    };
                    stack.push(StripOutput::Bus(bus.native_id));
                }
            }
        }
        false
    }

    /// Retire everything this registry built, returning the engine ops that do
    /// it and leaving the registry holding no strip and no device.
    ///
    /// A strip's chain devices are retired before the strip itself:
    /// [`GraphCommand::RemoveTrack`] leaves a track's effects registered but
    /// detached, so a topology replaced without this would strand one entry of
    /// the scheduler's shared effect table per device per play until the table
    /// is full.
    ///
    /// Three things deliberately survive the teardown. The node and effect id
    /// allocators keep counting, so a rebuilt strip never reuses an id the
    /// engine has not finished with — `AddTrack` answers a colliding id by
    /// silently retiring the track it was handed, which would lose a strip with
    /// no refusal anywhere. `runtime_revision` keeps counting because the
    /// correlation law is about this registry's history, not its contents. And
    /// `batches_sent` keeps counting because it numbers fences against the
    /// engine's own applied count: that stream is not restarting here, only the
    /// graph it carries.
    ///
    /// The queue ledgers do go, with the strips they describe: every stamp
    /// addresses a node or an effect this teardown removes, and a removed
    /// node's queue is removed with it.
    fn take_topology_down(&mut self) -> Vec<GraphCommand> {
        let mut strips: Vec<&StripEntry> = self.strips.values().collect();
        // Registry order is a `HashMap`'s, which is not an order at all. Native
        // id is creation order, so the teardown reads the way the build did.
        strips.sort_by_key(|entry| entry.native_id);

        let mut ops = Vec::new();
        for strip in strips {
            for device_id in &strip.device_ids {
                let Some(device) = self.devices.get(device_id) else {
                    continue;
                };
                ops.push(remove_device_op(strip.kind, strip.native_id, device));
            }
            ops.push(match strip.kind {
                StripKind::Track => GraphCommand::RemoveTrack(strip.native_id),
                StripKind::Bus => GraphCommand::RemoveBus(strip.native_id),
            });
        }

        self.strips.clear();
        self.devices.clear();
        self.track_count = 0;
        self.bus_count = 0;
        self.automation_pending.clear();
        self.device_param_pending.clear();
        ops
    }

    /// Take every chain entry naming `engine_plugin_id` out of the graph,
    /// returning the engine ops that do it.
    ///
    /// The step an unload owes before it retires an instance. A chain entry
    /// left naming a retired effect is not counted anywhere — the scheduler's
    /// `run_device` returns on a failed effect-table lookup — so it is a
    /// silent passthrough for as long as the entry stands, and only a topology
    /// replacement would clear it. A rolling engine gets no topology
    /// replacement, so the release has to be its own batch.
    ///
    /// Released, never retired, exactly as [`remove_device_op`] decides for any
    /// engine-owned device: the instance's lifetime belongs to the load that
    /// registered it, and the retirement this release precedes is
    /// `RemovePlugin`'s.
    ///
    /// The mutation is unconditional and knows nothing about whether the ops
    /// it returns ever reach the ring, so a caller whose send may be refused
    /// runs this on a working clone and commits the clone only once the engine
    /// has taken the batch — the law `map_batch` already follows.
    ///
    /// Usually one entry, possibly none when no strip holds the instance. The
    /// loop over several is defensive — `map_device` refuses a device id that
    /// is already in a chain, so one instance cannot be bound twice — and the
    /// ids are ordered so the ops a `HashMap` produced do not depend on its
    /// iteration order.
    ///
    /// `touched_strip_ids` names every strip a released device left, in
    /// first-touch order, for a caller building the strip reports an unload
    /// owes the same way `map_batch` builds its own — from the registry as it
    /// stands once the release actually commits.
    pub(crate) fn release_engine_plugin(&mut self, engine_plugin_id: usize) -> EngineReleaseResult {
        let mut released: Vec<String> = self
            .devices
            .iter()
            .filter(|(_, device)| {
                device.engine_owned() && device.native_effect_id == engine_plugin_id
            })
            .map(|(device_id, _)| device_id.clone())
            .collect();
        released.sort();

        let mut ops = Vec::new();
        let mut touched_strip_ids: Vec<String> = Vec::new();
        for device_id in released {
            let Some(device) = self.devices.remove(&device_id) else {
                continue;
            };
            let Some(strip) = self.strips.get_mut(&device.strip_id) else {
                continue;
            };
            ops.push(remove_device_op(strip.kind, strip.native_id, &device));
            strip.device_ids.retain(|id| id != &device_id);
            touch(&mut touched_strip_ids, &device.strip_id);
        }
        EngineReleaseResult {
            ops,
            touched_strip_ids,
        }
    }

    /// Whether this registry still maps `device_id` onto an engine effect.
    #[cfg(test)]
    pub(crate) fn holds_device(&self, device_id: &str) -> bool {
        self.devices.contains_key(device_id)
    }

    /// A strip's realized insert chain, in chain order. Empty for a strip this
    /// registry does not hold.
    #[cfg(test)]
    pub(crate) fn strip_chain(&self, strip_id: &str) -> &[String] {
        self.strips
            .get(strip_id)
            .map(|strip| strip.device_ids.as_slice())
            .unwrap_or_default()
    }

    /// Subtract from the ledger exactly what the engine's progress echo
    /// proves has left its fixed queue — never a count, always a per-stamp
    /// proof, because a stamp the ledger's own mirrored cancellations already
    /// removed must not release a second slot.
    ///
    /// The proof is [`proven_popped`], and a stamp it does not prove stays
    /// charged: a stale echo, an engine restart, or a stamp the engine dropped
    /// by a law with no mirror here (a foreign seek, a stop-edge hold) all
    /// degrade the same direction — the ledger over-refuses until a later echo,
    /// never under-refuses.
    fn release_landed(&mut self, progress: GraphProgressSnapshot) {
        self.automation_pending.retain(|_, queued| {
            queued.retain_mut(|stamp| {
                !proven_popped(
                    progress,
                    stamp.admitted_batch,
                    stamp.at_frame,
                    &mut stamp.landed_wraps,
                )
            });
            !queued.is_empty()
        });
        self.device_param_pending.retain(|_, queued| {
            queued.retain_mut(|stamp| {
                !proven_popped(
                    progress,
                    stamp.admitted_batch,
                    stamp.at_frame,
                    &mut stamp.landed_wraps,
                )
            });
            !queued.is_empty()
        });
    }
}

/// How many seams must close after a stamp is known queued before a *whole*
/// pass is proven to have run with it there.
///
/// One is not enough: the seam that closes first ends the pass the stamp was
/// admitted into, and the playhead may already have been past the stamp when
/// the batch drained, so that pass proves nothing about it. The pass between
/// the first and second seam is the earliest one that ran from the region's
/// start with the stamp already queued.
const SEAMS_PROVING_A_WHOLE_PASS: u64 = 2;

/// Whether the engine's progress echo proves one queued write has left its
/// fixed engine queue.
///
/// Nothing is released on a count, always on a per-stamp proof, because a stamp
/// the ledger's own mirrored cancellations already removed must not release a
/// second slot. Two proofs exist, and both first require the write's admitting
/// fenced batch to be at or behind the echoed batch horizon — until then the
/// engine has not even been handed it.
///
/// **The playhead.** A stamp strictly before the echoed playhead is popped
/// ([`GraphProgressSnapshot`]'s happens-before). Strictly — a stamp at the
/// playhead itself is due in the block that has not run. Both queue kinds pop
/// by that law every rendered block, playing or stopped: `RampedParam` frees a
/// slot when the walk reaches a write's start frame, `DeviceParamQueue` pops
/// everything due within the block.
///
/// **The seam.** A loop pins the playhead below the region's end forever, so
/// the first proof alone would leave every stamp in the region charged for the
/// life of the session and a looping musician's parameter edits would exhaust
/// the admission budget. The seam proof replaces the playhead's monotonicity
/// with the wrap counter's: `last_wrap_frame` is the frame the pass ending at
/// seam `loop_wraps` walked to, so every write queued *before that pass began*
/// and stamped below it was consumed by it. `landed_wraps` anchors "before":
/// it is the wrap count on the first echo that proved the batch drained, which
/// is an echo at which the write was certainly on the queue, and
/// [`SEAMS_PROVING_A_WHOLE_PASS`] seams after it is the earliest point a whole
/// pass has run since.
///
/// Neither proof can release a stamp the audio thread might still consume, and
/// neither depends on how often the echo is sampled: sampling less often only
/// delays a release.
fn proven_popped(
    progress: GraphProgressSnapshot,
    admitted_batch: u64,
    at_frame: u64,
    landed_wraps: &mut Option<u64>,
) -> bool {
    if admitted_batch > progress.batches_applied {
        return false;
    }
    if at_frame < progress.playhead_frame {
        return true;
    }
    let anchor = *landed_wraps.get_or_insert(progress.loop_wraps);
    progress.loop_wraps.saturating_sub(anchor) >= SEAMS_PROVING_A_WHOLE_PASS
        && at_frame < progress.last_wrap_frame
}

// ── Validation and mapping ─────────────────────────────────────────────────

struct MappedBatch {
    ops: Vec<GraphCommand>,
    reports: Vec<StripReportPayload>,
}

// `GraphCommand` carries whole clips and has no `Debug`; tests only need
// enough shape to satisfy `expect_err`.
impl std::fmt::Debug for MappedBatch {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MappedBatch")
            .field("ops", &self.ops.len())
            .field("reports", &self.reports)
            .finish()
    }
}

/// One write the ledger believes a queue still holds: the stamp it starts at
/// (what a locate's `cancel_from` filters on and what the progress echo's
/// landed proof compares against), the frame it lands at (what a replace's
/// `cancel_stale` filters on), and the fenced batch that admitted it (what
/// the echo's batch horizon compares against). A step lands at its own stamp.
#[derive(Clone, Copy, Debug)]
struct PendingStamp {
    at_frame: u64,
    lands_at: u64,
    admitted_batch: u64,
    /// The wrap count on the first echo that proved this stamp's batch drained
    /// — the anchor the loop half of the release proof counts passes from. See
    /// [`proven_popped`].
    landed_wraps: Option<u64>,
}

/// One device-parameter change the ledger believes a device's pending window
/// still holds. Device queues have no cancellation laws to mirror — no
/// replace, no locate ([`daw_engine::timeline::DeviceParamQueue`]) — so the
/// only way a stamp leaves is the progress echo proving it popped.
#[derive(Clone, Copy, Debug)]
struct DeviceParamStamp {
    at_frame: u64,
    admitted_batch: u64,
    /// As [`PendingStamp::landed_wraps`].
    landed_wraps: Option<u64>,
}

/// Control-side ledger of what accepted batches queue on the engine's fixed
/// per-parameter queues.
///
/// `RampedParam` holds [`AUTOMATION_QUEUE_CAPACITY`] pending writes and a
/// [`DeviceParamQueue`] holds [`DEVICE_PARAM_QUEUE_CAPACITY`]; a write past
/// either is dropped render-side with only a diagnostics counter, because the
/// audio thread cannot grow a queue. This module's law is refuse-don't-drop,
/// so the batch that would overflow a queue refuses here, whole, before
/// anything is pushed. The ledger follows the queue's own semantics: an
/// `Append` occupies a slot; a `Replace` or `Hold` first drops what the
/// queue's stamp law calls stale — every queued change whose event time (a
/// ramp's landing frame, a step's own frame) sits at or after the new
/// change's start (`RampedParam::cancel_stale`) — and then occupies one; a
/// locate drops every queued change stamped at or past the target
/// (`RampedParam::cancel_from`, mirrored by [`Self::apply_seek`]).
///
/// The ledger is seeded from the registry's carried state and written back
/// on success, so it models the queues *across* batches, not one batch
/// against an empty engine. Landed writes leave it through
/// [`GraphRegistry::release_landed`] — the engine's progress echo, applied
/// at admission before the seed — so between echoes it is deliberately
/// conservative: over-refusal is possible, silent render-side drops are not.
///
/// [`DeviceParamQueue`]: daw_engine::timeline::DeviceParamQueue
#[derive(Default)]
struct QueueBudgets {
    /// Per target, the stamps of every write the ledger believes is queued.
    automation: HashMap<AutomationTarget, Vec<PendingStamp>>,
    /// Per native effect id, the stamps of every pending device change.
    device_params: HashMap<usize, Vec<DeviceParamStamp>>,
    /// The fence number the batch being charged will carry when the engine
    /// drains it — what [`GraphRegistry::release_landed`] later holds each
    /// stamp's proof against.
    charging_batch: u64,
    /// Immediate device-parameter keys charged so far by every
    /// `SetDeviceParameters` record this batch has mapped. Unlike the two
    /// queue ledgers above, this counts only within one batch — it starts at
    /// zero on every [`Self::seeded_from`] rather than carrying state across
    /// batches, because the cost it bounds (ring size for the batch being
    /// built) resets with the batch, not with the engine's queues.
    immediate_device_parameters: usize,
}

impl QueueBudgets {
    fn seeded_from(registry: &GraphRegistry) -> Self {
        Self {
            automation: registry.automation_pending.clone(),
            device_params: registry.device_param_pending.clone(),
            charging_batch: registry.batches_sent + 1,
            immediate_device_parameters: 0,
        }
    }

    /// Charges one `SetDeviceParameters` record's key count against both the
    /// per-record ceiling and the running total for the whole batch, before
    /// any of the record's keys are resolved. A refusal here leaves this
    /// record's ops unpushed — the caller (`map_command`) returns before
    /// building any — and `map_batch` refuses the whole batch on any
    /// record's refusal, so nothing built for an earlier record in the same
    /// batch is ever applied either.
    fn charge_immediate_device_parameters(&mut self, record_len: usize) -> Result<(), String> {
        if record_len > MAX_IMMEDIATE_DEVICE_PARAMETERS {
            return Err(format!(
                "record carries {record_len} parameters, past the ceiling of \
                 {MAX_IMMEDIATE_DEVICE_PARAMETERS}"
            ));
        }
        let running_total = self.immediate_device_parameters + record_len;
        if running_total > MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH {
            return Err(format!(
                "batch carries {running_total} immediate parameters, past the ceiling of \
                 {MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH}"
            ));
        }
        self.immediate_device_parameters = running_total;
        Ok(())
    }

    fn charge_automation(
        &mut self,
        target: AutomationTarget,
        write: &AutomationWrite,
    ) -> Result<(), String> {
        let queued = self.automation.entry(target).or_default();
        let (start, lands_at) = write_frames(write);
        if !matches!(write, AutomationWrite::Append(_)) {
            queued.retain(|pending| pending.lands_at < start);
        }
        if queued.len() == AUTOMATION_QUEUE_CAPACITY {
            return Err(format!(
                "automation-queue-capacity — this parameter's native queue is full: \
                 {AUTOMATION_QUEUE_CAPACITY} unlanded writes are pending, counting this \
                 batch and every earlier accepted one; the engine would drop further \
                 writes silently, so the batch refuses whole. These slots release when \
                 the engine's progress echo proves earlier writes landed (playback \
                 passing their stamps frees them for the next batch), when a replace or \
                 hold cancels the stale writes, or when a locate behind their stamps \
                 drops them"
            ));
        }
        queued.push(PendingStamp {
            at_frame: start,
            lands_at,
            admitted_batch: self.charging_batch,
            landed_wraps: None,
        });
        Ok(())
    }

    fn charge_device_param(&mut self, effect_id: usize, at_frame: u64) -> Result<(), String> {
        let queued = self.device_params.entry(effect_id).or_default();
        if queued.len() == DEVICE_PARAM_QUEUE_CAPACITY {
            return Err(format!(
                "device-param-queue-capacity — this device's pending window is full: \
                 {DEVICE_PARAM_QUEUE_CAPACITY} changes are charged, counting this batch \
                 and every earlier accepted one; the engine would drop the writes \
                 silently, so the batch refuses whole instead. The window frees as the \
                 engine's progress echo proves earlier changes landed — playback passing \
                 their stamps releases them for the next batch"
            ));
        }
        queued.push(DeviceParamStamp {
            at_frame,
            admitted_batch: self.charging_batch,
            landed_wraps: None,
        });
        Ok(())
    }

    /// Mirror of the engine's locate law: a seek drops every queued write
    /// stamped at or past the target frame, so the ledger releases the same
    /// slots. Device-param queues have no cancellation law to mirror, so
    /// their depths deliberately stay.
    fn apply_seek(&mut self, frame: u64) {
        for queued in self.automation.values_mut() {
            queued.retain(|pending| pending.at_frame < frame);
        }
    }
}

/// The frame a write starts at and the frame it lands on — a ramp's start and
/// its landing, a step's or a hold's own stamp for both, because both land
/// instantly.
fn write_frames(write: &AutomationWrite) -> (u64, u64) {
    match write {
        AutomationWrite::Append(event) | AutomationWrite::Replace(event) => (
            event.at_frame,
            event
                .at_frame
                .saturating_add(u64::from(event.duration_frames)),
        ),
        AutomationWrite::Hold { at_frame } => (*at_frame, *at_frame),
    }
}

pub(crate) fn finite(value: f64, what: &str) -> Result<f64, String> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(format!("{what} is not a finite number"))
    }
}

pub(crate) fn seconds_to_frames(seconds: f64, sample_rate: f32, what: &str) -> Result<u64, String> {
    let seconds = finite(seconds, what)?;
    if seconds < 0.0 {
        return Err(format!("{what} is negative"));
    }
    Ok((seconds * f64::from(sample_rate)).round() as u64)
}

/// Read a hosted plugin's own parameter id off the wire.
///
/// The producer carries the plugin's `u32` id as a string, because a lane id is
/// a string everywhere above this boundary. Nothing here can check that the
/// plugin actually exposes that id — only the plugin resolves its own
/// parameters — so this refuses exactly what is not an id at all: a built-in's
/// name, or a number past `u32`. A stamp built from either would reach the
/// audio thread only to be counted as an unmapped call, and refusing whole is
/// this module's law.
fn hosted_parameter_id(parameter_id: &str) -> Result<u32, String> {
    parameter_id.parse().map_err(|_| {
        format!(
            "write-device-parameter: parameter '{parameter_id}' is not a hosted plugin \
             parameter id"
        )
    })
}

/// Resolve the engine plugin id a device's MIDI addresses, or refuse by name.
///
/// The same lookup and the same two refusals `write-device-parameter` makes,
/// under whichever command name is asking: a device the registry does not hold,
/// and one held on a different strip than the command claims. Then a third that
/// command has no need of: a device holding no note store.
///
/// That third one reads [`DeviceEntry::note_sink`], because *store presence is
/// decided at registration* rather than by what the device does with what
/// lands in it. Every engine-owned device is registered through
/// `EngineHandle::add_hosted_plugin`, which attaches a note store
/// unconditionally — a hosted reverb or a CLAP note effect gets one
/// exactly as an instrument does. The drain reaches every hosted slot, and
/// the wrapper decides from there: CLAP hands every plugin the events, so a
/// reverb ignores them and a note effect reads them while its note output
/// has no route in this host; VST3 withholds them from a plugin with no
/// event input bus (`stage_midi`). Neither is a refusal the mapping makes.
/// A built-in is an `AddDetachedEffect`, which carries a store exactly when
/// the type sounds notes, and the crumbs capture slot is not in
/// `registry.devices` at all.
///
/// So ownership no longer stands in for store presence: a built-in instrument
/// holds one while a built-in effect does not, and the registered type is what
/// parts them. Scheduling at a device with no store spends a whole batch the
/// store side can answer only as a count on the audio thread, which is why the
/// refusal is taken here.
fn midi_device_plugin_id(
    registry: &GraphRegistry,
    track_id: &str,
    device_id: &str,
    command: &str,
) -> Result<usize, String> {
    let device = registry
        .devices
        .get(device_id)
        .ok_or_else(|| format!("{command}: unknown device '{device_id}'"))?;
    if device.strip_id != track_id {
        return Err(format!(
            "{command}: device '{device_id}' is not on strip '{track_id}'"
        ));
    }
    if !device.note_sink() {
        return Err(format!(
            "{command}: device '{device_id}' holds no note store"
        ));
    }
    Ok(device.native_effect_id)
}

/// The fixed acceptance cutoff a scheduled note carries.
///
/// Absent probability is the always-plays cutoff, which is exactly what the
/// live `send_plugin_midi` path writes; a stated one goes through the shared
/// converter, so this wire and a MIDI FX chain agree on what a chance means.
fn scheduled_probability_cutoff(probability: Option<f64>) -> Result<u64, String> {
    let Some(probability) = probability else {
        return Ok(PROBABILITY_CUTOFF_RANGE);
    };
    let probability = finite(probability, "schedule-midi probability")?;
    if !(0.0..=1.0).contains(&probability) {
        return Err(format!(
            "schedule-midi: probability {probability} is outside 0..=1"
        ));
    }
    Ok(probability_percent_to_cutoff(probability * 100.0))
}

/// Refuse a note address the engine's sounding set cannot hold, naming the
/// field, the value and the command that carried it.
///
/// Checked here rather than left to the engine, which answers on the audio
/// thread and can only report a refusal as a count. A note the set cannot
/// address is never tracked as sounding, so nothing would ever release it —
/// which is the same reason a stored note and a live one both come through
/// here.
fn check_note_address(note: u8, channel: i16, command: &str) -> Result<(), String> {
    if !(0..i16::from(MIDI_CHANNELS)).contains(&channel) {
        return Err(format!(
            "{command}: channel {channel} has no address in the note store"
        ));
    }
    if note >= NOTES_PER_CHANNEL {
        return Err(format!(
            "{command}: note {note} has no address in the note store"
        ));
    }
    Ok(())
}

/// Map one wire note onto the event the store holds.
fn map_midi_note(
    note: &MidiNotePayload,
    probability_seed: u32,
    sample_rate: f32,
) -> Result<TimedMidiNote, String> {
    check_note_address(note.note, i16::from(note.channel), "schedule-midi")?;
    Ok(TimedMidiNote {
        at_frame: seconds_to_frames(note.time, sample_rate, "schedule-midi time")?,
        event: MidiNoteEvent {
            note: note.note,
            velocity: note.velocity,
            channel: i16::from(note.channel),
            is_note_on: note.is_note_on,
            // Written by delivery, from the note's frame and the first frame of
            // the span that renders it.
            frame_offset: 0,
            probability_cutoff: scheduled_probability_cutoff(note.probability)?,
            project_probability_seed: probability_seed,
            clip_id_hash: note.clip_id_hash.unwrap_or(0),
            event_id_hash: note.event_id_hash.unwrap_or(0),
            absolute_occurrence_index: note.absolute_occurrence_index.unwrap_or(0),
        },
    })
}

fn frames_u32(frames: u64, what: &str) -> Result<u32, String> {
    u32::try_from(frames).map_err(|_| format!("{what} does not fit a ramp span"))
}

/// The fader law: VCA folds in *before* the clamp (the composition order the
/// live strip uses), the ceiling is `fader_max_gain()` (+6 dB headroom, not
/// unity), the floor a hard zero.
fn fader_gain(stored_gain: f64, vca_multiplier: f32) -> Result<f32, String> {
    let stored = finite(stored_gain, "gain")?;
    if stored < 0.0 {
        return Err("gain is negative".to_string());
    }
    let folded = stored as f32 * vca_multiplier;
    if !(folded > 0.0) {
        return Ok(0.0);
    }
    Ok(folded.min(fader_max_gain()))
}

/// −50…+50 project pan onto the engine's −1…+1.
fn pan_position(project_pan: f64) -> Result<f32, String> {
    let pan = finite(project_pan, "pan")?;
    Ok((pan as f32 / PROJECT_PAN_SCALE).clamp(-1.0, 1.0))
}

fn send_level(level: f64) -> Result<f32, String> {
    let level = finite(level, "send level")?;
    Ok((level as f32).clamp(0.0, 1.0))
}

/// An immediate, replace-everything write — how a strip's creation state
/// reaches a parameter. Stamped at frame 0, which the playhead has always
/// reached, so it lands on the next block wherever the transport stands.
fn immediate_write(value: f32) -> AutomationWrite {
    AutomationWrite::Replace(AutomationEvent {
        at_frame: 0,
        duration_frames: 0,
        value,
        shape: RampShape::Step,
    })
}

/// The one gate every mixer-parameter write passes: the batch's queue ledger
/// is charged first, so a write the engine's fixed queue could not take
/// refuses the batch here instead of being dropped render-side.
fn push_automation(
    target: AutomationTarget,
    write: AutomationWrite,
    budgets: &mut QueueBudgets,
    ops: &mut Vec<GraphCommand>,
) -> Result<(), String> {
    budgets.charge_automation(target, &write)?;
    ops.push(GraphCommand::AutomateParam { target, write });
    Ok(())
}

/// Why this device has no body the scheduler can build, or `None` when it has
/// one.
///
/// Both answers are the same fact — nothing native to install — and they are
/// stated together so they reach the one degradation law that governs it. An
/// externally hosted plugin with no engine-owned instance belongs here rather
/// than in a refusal of its own: it sounds where it already sounds, on the web
/// path, and a strip mirroring the session's routing has no more to add for it
/// than it does for a WASM device. Refusing it instead would refuse the whole
/// batch, which in practice means every project that holds a plugin — most of
/// them.
///
/// A device whose `externalInstanceId` the engine *does* own never reaches here:
/// [`map_device`] splices it by that instance's effect id, and a lookup miss
/// there carries its own reason naming the instance.
fn no_native_body(device: &DevicePayload) -> Option<String> {
    if device.external_instance_id.is_some() || device.external_plugin_id.is_some() {
        return Some(format!(
            "device '{}' is an externally hosted plugin with no engine-owned instance to bind",
            device.id
        ));
    }
    if builtin_device_type(&device.device_type).is_none() {
        return Some(format!(
            "device '{}' of type '{}' has no native realisation",
            device.id, device.device_type
        ));
    }
    None
}

/// The built-in body a project device type names, or `None` when the scheduler
/// has none under that name.
///
/// Resolved through [`BuiltinEffectType::from_name`] rather than a list here,
/// so the vocabulary the engine can build and the vocabulary the mapper admits
/// are one fact. Case-folded because a project's device type is authored on
/// the web side, where the same body is spelled as a display name as often as
/// a key.
fn builtin_device_type(device_type: &str) -> Option<BuiltinEffectType> {
    BuiltinEffectType::from_name(&device_type.to_ascii_lowercase())
}

/// Resolve a fermenter parameter key onto the name the instrument answers to.
///
/// The key *is* the name: a fermenter's patch is a flat record of the
/// instrument's own snake_case names, and the engine keeps no copy of that
/// vocabulary to check one against. So the refusal here is by shape alone — a
/// key shaped unlike one of those names was never one of them, while a
/// well-shaped name the instrument happens not to have is answered by the
/// instrument doing nothing, exactly as it is under the web worklet.
fn fermenter_parameter(key: &str, device_id: &str) -> Result<FermenterParamName, String> {
    FermenterParamName::parse(key).ok_or_else(|| {
        format!(
            "device '{device_id}' carries parameter '{key}', which is not a fermenter parameter \
             name: a name is 1 to {FERMENTER_PARAM_NAME_CAPACITY} bytes of lowercase ASCII \
             letters, digits and underscores"
        )
    })
}

/// One device's whole `parameterValues` record, each key resolved through
/// `resolve` and each value narrowed to the `f32` the engine applies.
///
/// A body's patch is either written into the instance control-side or sent as
/// addressed commands, so what a key resolves to differs; the record is read
/// and the values are checked the same way either side, and one collector is
/// what keeps that one fact.
fn resolved_param_writes<T>(
    device: &DevicePayload,
    resolve: impl Fn(&str) -> Result<T, String>,
) -> Result<Vec<(T, f32)>, String> {
    device
        .parameter_values
        .iter()
        .map(|(key, value)| {
            let param = resolve(key)?;
            Ok((param, finite(*value, "device parameter value")? as f32))
        })
        .collect()
}

/// Resolve one built-in device's parameter key onto the address the engine
/// routes it by, or refuse by name.
///
/// Which vocabulary applies is decided by the body, not by the name the key
/// was written under: knead answers a closed set of names the engine owns, and
/// the fermenter answers its own.
fn builtin_parameter(
    builtin: BuiltinEffectType,
    key: &str,
    device_id: &str,
) -> Result<DeviceParam, String> {
    match builtin {
        BuiltinEffectType::Knead => DeviceParam::from_name(key).ok_or_else(|| {
            format!("device '{device_id}' carries parameter '{key}', which knead does not map")
        }),
        BuiltinEffectType::Fermenter => {
            fermenter_parameter(key, device_id).map(DeviceParam::FermenterNamed)
        }
    }
}

/// The instrument-vocabulary spelling of a resolved address, for the one
/// comparison the layer-routing law makes.
///
/// An address the engine names itself belongs to no instrument's vocabulary,
/// and [`FermenterParamName::parse`] admits no empty name, so the empty string
/// can never be read as a routing key.
fn addressed_parameter_name(param: &DeviceParam) -> &str {
    match param {
        DeviceParam::FermenterNamed(name) => name.as_str(),
        _ => "",
    }
}

/// One device's immediate parameter record, resolved onto engine addresses and
/// ordered as the body has to apply them.
///
/// The record arrives unordered — a `HashMap` off the wire — and two things
/// have to hold of what leaves here. A fermenter's layer-routing entry selects
/// the layer every write behind it lands on, so it is emitted first; that law
/// belongs to `FermenterBody::load_patch`, and this reuses the engine's own
/// [`layer_routing_first`] rather than restating it. Everything else follows in
/// name order, so one record maps onto one command sequence whichever order the
/// map happens to draw.
fn immediate_device_parameters(
    builtin: BuiltinEffectType,
    values: &HashMap<String, f64>,
    device_id: &str,
) -> Result<Vec<(DeviceParam, f32)>, String> {
    let mut keys: Vec<&str> = values.keys().map(String::as_str).collect();
    keys.sort_unstable();

    let resolved = keys
        .into_iter()
        .map(|key| {
            let param = builtin_parameter(builtin, key, device_id)
                .map_err(|reason| format!("set-device-parameters: {reason}"))?;
            let value = finite(values[key], &format!("set-device-parameters value '{key}'"))?;
            Ok((param, value as f32))
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(layer_routing_first(&resolved, addressed_parameter_name).collect())
}

/// One instance the engine already owns, as a device may bind to it: the
/// effect-table id the load reserved, and how it splices into a strip chain.
///
/// `Copy` because the map holding these is read once per batch and every
/// lookup only ever needs a snapshot of the two numbers, never the instance
/// itself.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct EngineOwnedDevice {
    engine_plugin_id: usize,
    chain_kind: DeviceKind,
}

/// What one device maps onto natively, and who owns the effect it names.
///
/// Two populations reach a strip chain. A built-in device is *built* here, on
/// the mapping (control) thread, against the stream's `sample_rate`: the audio
/// thread that applies the command installs or retires it and never constructs
/// one (ADR 0020). A hosted plugin the engine already owns is *borrowed*:
/// `load_plugin` registered it and reserved its effect-table slot at that
/// moment, so this maps the device onto that instance's existing engine plugin
/// id and allocates nothing. Everything else in the project's native-DSP
/// vocabulary is a WASM device the web runtime realises, with no `daw-engine`
/// body yet.
///
/// `builtin` names which of the two this is, and is the one fact every later
/// question about the device reads: `None` is the borrowed instance, so it
/// answers ownership; and which of them holds a note store, and which
/// parameter vocabulary a stamp at the device resolves through, follow from
/// the built-in type rather than from a second flag that could disagree with
/// it.
///
/// An engine-owned device carries no `SetParam`: an external plugin's
/// parameters are its own, addressed over the plugin's control path rather than
/// through the engine's fixed built-in vocabulary, so its `parameterValues` are
/// carried by the panel and never validated against a built-in vocabulary here.
///
/// `chain_kind` is what the three `ChainEntry` insert sites splice with: an
/// engine-owned device carries the instance's own scanned category
/// (`PluginRegistryEntry::chain_kind`), and a built-in carries the kind its
/// body is — an instrument is a `Generator`, whose output the chain sums in,
/// and everything else an `Effect` that processes the signal in place.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct MappedDevice {
    effect_id: usize,
    builtin: Option<BuiltinEffectType>,
    chain_kind: DeviceKind,
}

fn map_device(
    device: &DevicePayload,
    registry: &mut GraphRegistry,
    contributes_audio: bool,
    sample_rate: f32,
    engine_owned_devices: &HashMap<String, EngineOwnedDevice>,
    ops: &mut Vec<GraphCommand>,
) -> Result<Option<MappedDevice>, String> {
    if registry.devices.contains_key(&device.id) {
        return Err(format!("device id '{}' is already in a chain", device.id));
    }

    if let Some(instance_id) = device.external_instance_id.as_deref() {
        let Some(&EngineOwnedDevice {
            engine_plugin_id: effect_id,
            chain_kind,
        }) = engine_owned_devices.get(instance_id)
        else {
            let reason = format!(
                "device '{}' names hosted plugin instance '{instance_id}', which is not attached \
                 to the engine",
                device.id
            );
            if contributes_audio {
                return Err(reason);
            }
            // Same degradation law as any device with no body: a strip built
            // only to keep the routing graph faithful contributes silence, so
            // the device is omitted and its absence is what the strip report
            // says.
            return Ok(None);
        };
        charge_chain_slot(registry, &device.id)?;
        if device.bypassed {
            ops.push(GraphCommand::SetBypass(effect_id, true));
        }
        return Ok(Some(MappedDevice {
            effect_id,
            builtin: None,
            chain_kind,
        }));
    }

    if let Some(reason) = no_native_body(device) {
        if contributes_audio {
            return Err(reason);
        }
        // A strip built only to keep the routing graph faithful contributes
        // silence by construction, so a device it cannot build degrades:
        // omitted from the chain, and therefore absent from the strip report —
        // the observation the contract says a caller must read.
        return Ok(None);
    }

    let builtin = builtin_device_type(&device.device_type)
        .expect("no_native_body refused every type with no built-in body");

    // The built-in's parameters resolve control-side, through the same single
    // mapping the engine's addressed `SetParam` applies, and before the batch
    // charges a chain slot for the device. A key the body's own vocabulary
    // does not map is answered here rather than counted as an unmapped call on
    // the audio thread after the fact — under the same law as a device with no
    // body at all, because to a strip a device that cannot be built and one
    // that cannot be written are the same missing device.
    //
    // Which side of the ring a patch is applied on is a property of the body.
    // A fermenter's patch is dozens of the instrument's own parameters per
    // strip and the command ring is finite, so it is written into the instance
    // on this thread; knead's handful travel as commands behind the
    // registration.
    let resolved = match builtin {
        BuiltinEffectType::Fermenter => {
            resolved_param_writes(device, |key| fermenter_parameter(key, &device.id)).map(|patch| {
                (
                    PluginCore::fermenter_with_patch(sample_rate, &patch),
                    Vec::new(),
                )
            })
        }
        BuiltinEffectType::Knead => {
            resolved_param_writes(device, |key| builtin_parameter(builtin, key, &device.id))
                .map(|writes| (PluginCore::builtin(builtin, sample_rate), writes))
        }
    };
    let Some((core, param_writes)) = refuse_or_degrade(resolved, contributes_audio)? else {
        return Ok(None);
    };

    charge_chain_slot(registry, &device.id)?;
    let effect_id = registry.allocate_effect_id();
    // Detached, never `AddEffect`: commands cross the ring one at a time, so
    // a callback can drain between this registration and the chain splice
    // that follows it. An effect registered onto the master chain in that
    // window would render one block of the entire mix through a device the
    // batch put on one strip.
    //
    // A built-in that sounds notes is registered holding its note store, built
    // here because the audio thread may not build one — without it the device
    // exists but nothing could ever be scheduled at it.
    ops.push(GraphCommand::AddDetachedEffect(
        effect_id,
        core,
        builtin.sounds_notes().then(MidiNoteStore::new),
    ));
    for (param, value) in param_writes {
        ops.push(GraphCommand::SetParam(effect_id, param, value));
    }
    if device.bypassed {
        ops.push(GraphCommand::SetBypass(effect_id, true));
    }
    Ok(Some(MappedDevice {
        effect_id,
        builtin: Some(builtin),
        chain_kind: builtin_chain_kind(builtin),
    }))
}

/// A device the mapper could not resolve, answered under the one law
/// [`no_native_body`] already sets: refused by name where the strip
/// contributes audio, and omitted where it contributes silence by
/// construction.
///
/// A strip that contributes audio is one the mix is short of if a device goes
/// missing from it, so the batch refuses whole. A strip built only to keep the
/// routing graph faithful contributes nothing to hear, so the device is left
/// out and its absence is what the strip report says.
fn refuse_or_degrade<T>(
    resolved: Result<T, String>,
    contributes_audio: bool,
) -> Result<Option<T>, String> {
    match resolved {
        Ok(resolved) => Ok(Some(resolved)),
        Err(reason) if contributes_audio => Err(reason),
        Err(_) => Ok(None),
    }
}

/// How a built-in body splices into a strip chain.
///
/// An instrument produces material of its own, which the chain sums in at the
/// device's place ([`DeviceKind::Generator`]); everything else processes the
/// signal it is handed in place.
fn builtin_chain_kind(builtin: BuiltinEffectType) -> DeviceKind {
    if builtin.sounds_notes() {
        DeviceKind::Generator
    } else {
        DeviceKind::Effect
    }
}

/// Take one of the project's chain slots for `device_id`, or refuse by name.
///
/// The scheduler's effect table is shared by every population that registers
/// into it — the project's chain devices, engine-owned plugins, the crumbs
/// capture slot — and its timeline term is the chain-slot budget the strip
/// admission rules themselves enforce: tracks and buses are counted, and each
/// chain is capped per strip. This bound is the project-wide belt over those
/// per-strip caps: while they hold it is unreachable, and a device that slips
/// past them must still refuse here — refusing at map time is what turns a
/// device that would silently vanish into one that reports it could not be
/// added: the batch fails, its working registry clone is discarded, and no
/// chain entry is written.
///
/// An engine-owned plugin is charged here too, because it occupies a chain slot
/// exactly like any other device. Its *effect-table* headroom is not taken
/// here: `register_runtime_with_engine` took that at load
/// (`EngineHandle::ensure_effect_table_headroom`), which is why the splice
/// allocates nothing.
///
/// This bound covers the project's *devices* only, and it names the device that
/// hit it. The table is shared with the crumbs capture slot too, so the complete
/// ceiling is the engine's own ledger — `EngineHandle::send_graph_batch` admits
/// the whole batch against the whole population before it publishes anything,
/// and refuses it whole otherwise. Whichever bound is tighter fires first;
/// neither is the only one, and neither may be widened into a second partial
/// count.
fn charge_chain_slot(registry: &GraphRegistry, device_id: &str) -> Result<(), String> {
    if registry.devices.len() >= TIMELINE_CHAIN_SLOT_BUDGET {
        return Err(format!(
            "device '{device_id}': the project holds its maximum of \
             {TIMELINE_CHAIN_SLOT_BUDGET} native devices"
        ));
    }
    Ok(())
}

/// How one device leaves its chain.
///
/// A device this registry built is removed and retired in one engine command:
/// a separate removal followed by a retirement would return the effect to the
/// master insert chain for any block a callback rendered between the two,
/// running a deleted device over the whole mix.
///
/// An engine-owned plugin is removed without being retired, because retiring it
/// would free an instance the plugin panel, its editor and its parameter path
/// are all still holding — `unload_plugin` owns that, through
/// `RemovePlugin`. The window the retiring form exists to close is
/// already shut for it from the other end: the engine homes a hosted plugin
/// detached, so releasing one puts it nowhere rather than on the master mix.
fn remove_device_op(kind: StripKind, native_id: usize, device: &DeviceEntry) -> GraphCommand {
    match (kind, device.engine_owned()) {
        (StripKind::Track, false) => GraphCommand::RemoveTrackDeviceRetired {
            track_id: native_id,
            effect_id: device.native_effect_id,
        },
        (StripKind::Track, true) => GraphCommand::RemoveTrackDevice {
            track_id: native_id,
            effect_id: device.native_effect_id,
        },
        (StripKind::Bus, false) => GraphCommand::RemoveBusDeviceRetired {
            bus_id: native_id,
            effect_id: device.native_effect_id,
        },
        (StripKind::Bus, true) => GraphCommand::RemoveBusDevice {
            bus_id: native_id,
            effect_id: device.native_effect_id,
        },
    }
}

fn strip_device_capacity(kind: StripKind) -> usize {
    match kind {
        StripKind::Track => MAX_TRACK_DEVICES,
        StripKind::Bus => MAX_BUS_DEVICES,
    }
}

fn insert_device_op(
    kind: StripKind,
    native_id: usize,
    entry: ChainEntry,
    index: usize,
) -> GraphCommand {
    // The generator's input hold is built here, mapping-side, for the reason
    // every other line the graph runs is: the audio thread may not allocate.
    let hold = entry.input_hold();
    match kind {
        StripKind::Track => GraphCommand::InsertTrackDevice {
            track_id: native_id,
            entry,
            index,
            hold,
        },
        StripKind::Bus => GraphCommand::InsertBusDevice {
            bus_id: native_id,
            entry,
            index,
            hold,
        },
    }
}

/// Record a strip whose report the batch owes, once, in first-touch order.
fn touch(touched: &mut Vec<String>, strip_id: &str) {
    if !touched.iter().any(|id| id == strip_id) {
        touched.push(strip_id.to_string());
    }
}

/// A final pass over `registry`, reporting what each named strip's chain
/// really holds — never an echo of any one command's request. Shared by
/// `map_batch`, for the strips a batch touched, and by an unload's own
/// release, for the strips it touched outside any batch.
pub(crate) fn strip_reports(
    registry: &GraphRegistry,
    strip_ids: &[String],
) -> Vec<StripReportPayload> {
    strip_ids
        .iter()
        .map(|strip_id| {
            let entry = registry
                .strips
                .get(strip_id)
                .expect("a touched strip exists in the registry");
            StripReportPayload {
                kind: match entry.kind {
                    StripKind::Track => "track",
                    StripKind::Bus => "bus",
                },
                id: strip_id.clone(),
                device_ids: entry.device_ids.clone(),
            }
        })
        .collect()
}

/// Map a whole batch. `registry` is the caller's working clone; on `Err`
/// nothing built here may be applied and the clone is discarded — including
/// the queue ledger, which is written back onto the clone only on success.
///
/// `engine_owned_devices` is instance id → engine plugin id and chain splice
/// kind for every hosted plugin the engine owns, read once on the control
/// thread before the batch is mapped. It is empty for every offline path:
/// those render with no live engine, so no instance exists for a device to
/// bind to and an external device on a sounding strip refuses there exactly
/// as it did before binding existed.
fn map_batch(
    batch: &GraphBatchPayload,
    registry: &mut GraphRegistry,
    samples: &TimelineSamplePool,
    sample_rate: f32,
    engine_owned_devices: &HashMap<String, EngineOwnedDevice>,
) -> Result<MappedBatch, String> {
    if batch.schema_version != 1 {
        return Err(format!(
            "unsupported schemaVersion {} (this backend speaks 1)",
            batch.schema_version
        ));
    }
    if batch.commands.len() > MAX_BATCH_COMMANDS {
        return Err(format!(
            "batch carries {} commands, past the ceiling of {MAX_BATCH_COMMANDS}",
            batch.commands.len()
        ));
    }

    let mut ops = Vec::new();
    // A replacing batch tears the previous topology down inside its own fence,
    // so the swap is one step for the audio thread: no block renders the old
    // graph beside the new one, and none renders neither. The ledger is seeded
    // after the teardown because the teardown clears it.
    if batch.replace_topology {
        ops.extend(registry.take_topology_down());
    }
    let mut touched: Vec<String> = Vec::new();
    let mut refusals: Vec<String> = Vec::new();
    let mut budgets = QueueBudgets::seeded_from(registry);

    for (index, command) in batch.commands.iter().enumerate() {
        if let Err(reason) = map_command(
            command,
            registry,
            samples,
            sample_rate,
            engine_owned_devices,
            &mut budgets,
            &mut ops,
            &mut touched,
        ) {
            refusals.push(format!("commands[{index}]: {reason}"));
        }
    }

    if !refusals.is_empty() {
        return Err(refusals.join("; "));
    }

    registry.automation_pending = budgets.automation;
    registry.device_param_pending = budgets.device_params;
    // The fence horizon advances with the ledger it numbers. `registry` is
    // the caller's working clone: a batch that maps but is never sent (a
    // refused push, an offline mapping) discards the clone and the count
    // with it, so a committed registry's count is exactly the fences the
    // engine has been handed.
    registry.batches_sent += 1;

    // The reports are a final pass over the post-batch registry: what each
    // touched strip's chain really holds after everything applied, never an
    // echo of any one command's request.
    let reports = strip_reports(registry, &touched);
    Ok(MappedBatch { ops, reports })
}

fn resolve_route_target(
    registry: &GraphRegistry,
    target: &RouteTargetPayload,
) -> Result<StripOutput, String> {
    let strip_id = match target {
        RouteTargetPayload::Master => return Ok(StripOutput::Master),
        RouteTargetPayload::Bus { bus_id } => bus_id,
        RouteTargetPayload::Track { track_id } => track_id,
    };
    // One strip id space: what matters is which registry entry holds the id,
    // not which kind the caller believed it was.
    let entry = registry
        .strips
        .get(strip_id)
        .ok_or_else(|| format!("route target '{strip_id}' is not a strip this graph holds"))?;
    Ok(match entry.kind {
        StripKind::Track => StripOutput::Track(entry.native_id),
        StripKind::Bus => StripOutput::Bus(entry.native_id),
    })
}

const fn route_target_for(output: StripOutput) -> RouteTarget {
    match output {
        StripOutput::Master => RouteTarget::Master,
        StripOutput::Track(native_id) => RouteTarget::Track(native_id),
        StripOutput::Bus(native_id) => RouteTarget::Bus(native_id),
    }
}

#[allow(clippy::too_many_lines)]
fn map_command(
    command: &GraphCommandPayload,
    registry: &mut GraphRegistry,
    samples: &TimelineSamplePool,
    sample_rate: f32,
    engine_owned_devices: &HashMap<String, EngineOwnedDevice>,
    budgets: &mut QueueBudgets,
    ops: &mut Vec<GraphCommand>,
    touched: &mut Vec<String>,
) -> Result<(), String> {
    match command {
        GraphCommandPayload::CreateTrackStrip {
            track_id,
            name: _,
            state,
            devices,
            honor_muted,
            contributes_audio,
        } => {
            if registry.strips.contains_key(track_id) {
                return Err(format!(
                    "create-track-strip: strip id '{track_id}' already exists"
                ));
            }
            if registry.track_count == MAX_TIMELINE_TRACKS {
                return Err(format!(
                    "create-track-strip: the graph holds its maximum of {MAX_TIMELINE_TRACKS} tracks"
                ));
            }
            let vca = finite(state.vca_multiplier, "vcaMultiplier")? as f32;
            if vca < 0.0 {
                return Err("create-track-strip: vcaMultiplier is negative".to_string());
            }
            let gain = fader_gain(state.gain, vca)?;
            let pan = pan_position(state.pan)?;
            let native_id = registry.allocate_node_id();

            ops.push(GraphCommand::AddTrack(TimelineTrack::new(native_id)));
            push_automation(
                AutomationTarget::TrackGain(native_id),
                immediate_write(gain),
                budgets,
                ops,
            )?;
            if pan != 0.0 {
                push_automation(
                    AutomationTarget::TrackPan(native_id),
                    immediate_write(pan),
                    budgets,
                    ops,
                )?;
            }
            if *honor_muted && state.muted {
                ops.push(GraphCommand::SetTrackMute(native_id, true));
            }
            if state.solo_gated {
                ops.push(GraphCommand::SetTrackSoloGate(native_id, true));
            }

            let mut built_device_ids = Vec::new();
            let mut chain_index = 0usize;
            for device in devices {
                let Some(mapped) = map_device(
                    device,
                    registry,
                    *contributes_audio,
                    sample_rate,
                    engine_owned_devices,
                    ops,
                )?
                else {
                    continue;
                };
                ops.push(insert_device_op(
                    StripKind::Track,
                    native_id,
                    ChainEntry {
                        effect_id: mapped.effect_id,
                        kind: mapped.chain_kind,
                    },
                    chain_index,
                ));
                registry.devices.insert(
                    device.id.clone(),
                    DeviceEntry {
                        native_effect_id: mapped.effect_id,
                        strip_id: track_id.clone(),
                        builtin: mapped.builtin,
                    },
                );
                built_device_ids.push(device.id.clone());
                chain_index += 1;
            }
            if chain_index > MAX_TRACK_DEVICES {
                return Err(format!(
                    "create-track-strip: chain exceeds {MAX_TRACK_DEVICES} devices"
                ));
            }

            registry.strips.insert(
                track_id.clone(),
                StripEntry {
                    native_id,
                    kind: StripKind::Track,
                    vca_multiplier: vca,
                    contributes_audio: *contributes_audio,
                    device_ids: built_device_ids,
                    clip_count: 0,
                    send_bus_ids: Vec::new(),
                    output: StripOutput::Master,
                },
            );
            registry.track_count += 1;
            touch(touched, track_id);
            Ok(())
        }

        GraphCommandPayload::CreateBusStrip {
            bus_id,
            name: _,
            state,
            devices,
            honor_muted,
            contributes_audio,
        } => {
            if registry.strips.contains_key(bus_id) {
                return Err(format!(
                    "create-bus-strip: strip id '{bus_id}' already exists"
                ));
            }
            if registry.bus_count == MAX_TIMELINE_BUSES {
                return Err(format!(
                    "create-bus-strip: the graph holds its maximum of {MAX_TIMELINE_BUSES} buses"
                ));
            }
            let vca = finite(state.vca_multiplier, "vcaMultiplier")? as f32;
            if vca < 0.0 {
                return Err("create-bus-strip: vcaMultiplier is negative".to_string());
            }
            let gain = fader_gain(state.gain, vca)?;
            let pan = pan_position(state.pan)?;
            let native_id = registry.allocate_node_id();

            ops.push(GraphCommand::AddBus(TimelineBus::new(native_id)));
            push_automation(
                AutomationTarget::BusGain(native_id),
                immediate_write(gain),
                budgets,
                ops,
            )?;
            if pan != 0.0 {
                push_automation(
                    AutomationTarget::BusPan(native_id),
                    immediate_write(pan),
                    budgets,
                    ops,
                )?;
            }
            if *honor_muted && state.muted {
                ops.push(GraphCommand::SetBusMute(native_id, true));
            }
            if state.solo_gated {
                ops.push(GraphCommand::SetBusSoloGate(native_id, true));
            }

            let mut built_device_ids = Vec::new();
            let mut chain_index = 0usize;
            for device in devices {
                let Some(mapped) = map_device(
                    device,
                    registry,
                    *contributes_audio,
                    sample_rate,
                    engine_owned_devices,
                    ops,
                )?
                else {
                    continue;
                };
                ops.push(insert_device_op(
                    StripKind::Bus,
                    native_id,
                    ChainEntry {
                        effect_id: mapped.effect_id,
                        kind: mapped.chain_kind,
                    },
                    chain_index,
                ));
                registry.devices.insert(
                    device.id.clone(),
                    DeviceEntry {
                        native_effect_id: mapped.effect_id,
                        strip_id: bus_id.clone(),
                        builtin: mapped.builtin,
                    },
                );
                built_device_ids.push(device.id.clone());
                chain_index += 1;
            }
            if chain_index > MAX_BUS_DEVICES {
                return Err(format!(
                    "create-bus-strip: chain exceeds {MAX_BUS_DEVICES} devices"
                ));
            }

            registry.strips.insert(
                bus_id.clone(),
                StripEntry {
                    native_id,
                    kind: StripKind::Bus,
                    vca_multiplier: vca,
                    contributes_audio: *contributes_audio,
                    device_ids: built_device_ids,
                    clip_count: 0,
                    send_bus_ids: Vec::new(),
                    output: StripOutput::Master,
                },
            );
            registry.bus_count += 1;
            touch(touched, bus_id);
            Ok(())
        }

        GraphCommandPayload::SetTrackOutput { track_id, target } => {
            let output = resolve_route_target(registry, target)?;
            let strip = registry
                .strips
                .get(track_id)
                .ok_or_else(|| format!("set-track-output: unknown strip '{track_id}'"))?
                .clone();
            if registry.would_cycle(&strip, output) {
                return Err(format!(
                    "set-track-output: routing '{track_id}' there closes a cycle"
                ));
            }
            let route = route_target_for(output);
            ops.push(match strip.kind {
                StripKind::Track => GraphCommand::SetTrackOutput(strip.native_id, route),
                StripKind::Bus => GraphCommand::SetBusOutput(strip.native_id, route),
            });
            registry
                .strips
                .get_mut(track_id)
                .expect("strip fetched above")
                .output = output;
            Ok(())
        }

        GraphCommandPayload::AddSend {
            track_id,
            bus_id,
            tap,
            level,
        } => {
            let source = registry
                .strips
                .get(track_id)
                .ok_or_else(|| format!("add-send: unknown strip '{track_id}'"))?;
            if source.kind == StripKind::Bus {
                return Err(format!(
                    "add-send: bus-send-unsupported — strip '{track_id}' is a bus and the native \
                     bus strip has no send taps"
                ));
            }
            if source.send_bus_ids.iter().any(|id| id == bus_id) {
                return Err(format!(
                    "add-send: '{track_id}' already sends to '{bus_id}'"
                ));
            }
            if source.send_bus_ids.len() == MAX_TRACK_SENDS {
                return Err(format!(
                    "add-send: '{track_id}' holds its maximum of {MAX_TRACK_SENDS} sends"
                ));
            }
            let destination = registry
                .strips
                .get(bus_id)
                .ok_or_else(|| format!("add-send: unknown bus '{bus_id}'"))?;
            if destination.kind != StripKind::Bus {
                return Err(format!(
                    "add-send: send target '{bus_id}' is a track, and a native send lands only on \
                     a bus"
                ));
            }
            if registry.would_cycle(source, StripOutput::Bus(destination.native_id)) {
                return Err(format!(
                    "add-send: routing '{track_id}' there closes a cycle"
                ));
            }
            let source_native = source.native_id;
            let destination_native = destination.native_id;
            ops.push(GraphCommand::AddSend {
                track_id: source_native,
                bus_id: destination_native,
                tap: match tap {
                    SendTapPayload::PreFader => daw_engine::timeline::SendTap::PreFader,
                    SendTapPayload::PostFader => daw_engine::timeline::SendTap::PostFader,
                },
                level: send_level(*level)?,
                // Built here, on the control thread: the send's compensation
                // ring is heap, and the audio thread may not allocate it.
                delay: Box::new(daw_engine::pdc::CompensationDelay::new(
                    daw_engine::pdc::MAX_COMPENSATION_FRAMES,
                )),
            });
            registry
                .strips
                .get_mut(track_id)
                .expect("strip fetched above")
                .send_bus_ids
                .push(bus_id.clone());
            Ok(())
        }

        GraphCommandPayload::RemoveSend { track_id, bus_id } => {
            let source = registry
                .strips
                .get(track_id)
                .ok_or_else(|| format!("remove-send: unknown strip '{track_id}'"))?;
            if !source.send_bus_ids.iter().any(|id| id == bus_id) {
                return Err(format!(
                    "remove-send: '{track_id}' has no send to '{bus_id}'"
                ));
            }
            let destination = registry
                .strips
                .get(bus_id)
                .ok_or_else(|| format!("remove-send: unknown bus '{bus_id}'"))?;
            ops.push(GraphCommand::RemoveSend {
                track_id: source.native_id,
                bus_id: destination.native_id,
            });
            let source = registry
                .strips
                .get_mut(track_id)
                .expect("strip fetched above");
            source.send_bus_ids.retain(|id| id != bus_id);
            Ok(())
        }

        GraphCommandPayload::InsertDevice {
            track_id,
            device,
            index,
        } => {
            let strip = registry
                .strips
                .get(track_id)
                .ok_or_else(|| format!("insert-device: unknown strip '{track_id}'"))?
                .clone();
            if strip.device_ids.len() == strip_device_capacity(strip.kind) {
                return Err(format!(
                    "insert-device: the chain on '{track_id}' is at capacity"
                ));
            }
            // Touched before the degradation branch: a device that cannot
            // build on a non-contributing strip is omitted from the chain,
            // and the strip's report is exactly how that omission is
            // observable — the command never succeeds silently.
            touch(touched, track_id);
            let Some(mapped) = map_device(
                device,
                registry,
                strip.contributes_audio,
                sample_rate,
                engine_owned_devices,
                ops,
            )?
            else {
                return Ok(());
            };
            let insert_at = (*index as usize).min(strip.device_ids.len());
            ops.push(insert_device_op(
                strip.kind,
                strip.native_id,
                ChainEntry {
                    effect_id: mapped.effect_id,
                    kind: mapped.chain_kind,
                },
                insert_at,
            ));
            registry.devices.insert(
                device.id.clone(),
                DeviceEntry {
                    native_effect_id: mapped.effect_id,
                    strip_id: track_id.clone(),
                    builtin: mapped.builtin,
                },
            );
            registry
                .strips
                .get_mut(track_id)
                .expect("strip fetched above")
                .device_ids
                .insert(insert_at, device.id.clone());
            Ok(())
        }

        GraphCommandPayload::RemoveDevice {
            track_id,
            device_id,
        } => {
            let strip = registry
                .strips
                .get(track_id)
                .ok_or_else(|| format!("remove-device: unknown strip '{track_id}'"))?
                .clone();
            // Touched before the device is even looked up, because the strip
            // report is what the caller resyncs its chain from and it is owed
            // whether or not an entry leaves here.
            touch(touched, track_id);
            let Some(device) = registry.devices.get(device_id).cloned() else {
                // Already absent, which is this command's desired state rather
                // than a fault. Two producers race for the same entry — the
                // live mirror's `remove-device` and the release
                // `unload_plugin` performs before it retires an instance — and
                // whichever arrives second must find the entry gone and still
                // succeed, or an ordinary plugin delete refuses a whole batch.
                return Ok(());
            };
            if device.strip_id != *track_id {
                // A wrong-strip command, not an already-satisfied one: the
                // device exists and this batch is addressing it on a chain it
                // is not on.
                return Err(format!(
                    "remove-device: device '{device_id}' is not on strip '{track_id}'"
                ));
            }
            ops.push(remove_device_op(strip.kind, strip.native_id, &device));
            registry.devices.remove(device_id);
            // A retirement takes the device's `DeviceParamQueue` with it,
            // pending changes and all, and graph effect ids are never reused
            // (the allocator is monotonic) — so the ledger's window for this
            // effect is exactly gone, not guessed gone. That holds whichever
            // kind of body the device was: a hosted plugin's stamps are charged
            // against the same per-effect window and leave with the same
            // retirement.
            budgets.device_params.remove(&device.native_effect_id);
            registry
                .strips
                .get_mut(track_id)
                .expect("strip fetched above")
                .device_ids
                .retain(|id| id != device_id);
            Ok(())
        }

        GraphCommandPayload::WriteParameter { target, write } => {
            map_parameter_write(target, write, registry, sample_rate, budgets, ops)
        }

        GraphCommandPayload::WriteDeviceParameter { target, write } => {
            let DeviceParameterTargetPayload::DeviceParameter {
                track_id,
                device_id,
                parameter_id,
            } = target;
            let device = registry
                .devices
                .get(device_id)
                .ok_or_else(|| format!("write-device-parameter: unknown device '{device_id}'"))?;
            if device.strip_id != *track_id {
                return Err(format!(
                    "write-device-parameter: device '{device_id}' is not on strip '{track_id}'"
                ));
            }
            // The address a stamp carries is decided by what the device is, not
            // by the name it was written under: a built-in's parameters are the
            // vocabulary its own body answers to, and a hosted plugin's are the
            // plugin's own numeric ids, which only the plugin can resolve.
            let param = match device.builtin {
                None => DeviceParamTarget::Hosted {
                    id: hosted_parameter_id(parameter_id)?,
                },
                Some(builtin) => DeviceParamTarget::Builtin(
                    builtin_parameter(builtin, parameter_id, device_id).map_err(|_| {
                        format!(
                            "write-device-parameter: parameter '{parameter_id}' has no native \
                             address"
                        )
                    })?,
                ),
            };
            let StepWritePayload::Step { value, time } = write;
            let at_frame = seconds_to_frames(*time, sample_rate, "write-device-parameter time")?;
            let value = finite(*value, "write-device-parameter value")?;
            let effect_id = device.native_effect_id;
            budgets
                .charge_device_param(effect_id, at_frame)
                .map_err(|reason| format!("write-device-parameter: {reason}"))?;
            ops.push(GraphCommand::AutomateDeviceParam {
                effect_id,
                param,
                value,
                at_frame,
            });
            Ok(())
        }

        GraphCommandPayload::SetDeviceParameters {
            track_id,
            device_id,
            values,
        } => {
            let device = registry
                .devices
                .get(device_id)
                .ok_or_else(|| format!("set-device-parameters: unknown device '{device_id}'"))?;
            if device.strip_id != *track_id {
                return Err(format!(
                    "set-device-parameters: device '{device_id}' is not on strip '{track_id}'"
                ));
            }
            let Some(builtin) = device.builtin else {
                return Err(format!(
                    "set-device-parameters: device '{device_id}' is an externally hosted plugin, \
                     whose parameters take the plugin host's own control path"
                ));
            };
            // Charged against both the per-record ceiling and the running
            // batch total before any key is resolved: a batch admits many
            // such records, and the per-record ceiling alone does not bound
            // how many of them one batch may carry (see
            // `MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH`).
            budgets
                .charge_immediate_device_parameters(values.len())
                .map_err(|reason| format!("set-device-parameters: {reason}"))?;
            let effect_id = device.native_effect_id;
            // No queue charge, unlike the stamped write above: these land on
            // the next drain rather than waiting in the device's
            // `DeviceParamQueue`, so there is no pending window for the ledger
            // to hold open and nothing for the progress echo to release. The
            // command ring is the only capacity they spend, and
            // `EngineHandle::send_graph_batch_with_headroom` sizes it to the
            // batch it is handed, one `SetParam` op per entry up to the
            // ceilings charged above.
            for (param, value) in immediate_device_parameters(builtin, values, device_id)? {
                ops.push(GraphCommand::SetParam(effect_id, param, value));
            }
            Ok(())
        }

        GraphCommandPayload::ScheduleMidi {
            track_id,
            device_id,
            probability_seed,
            notes,
        } => {
            let plugin_id = midi_device_plugin_id(registry, track_id, device_id, "schedule-midi")?;
            // The store's ceiling, checked here because the store can only
            // answer a batch past it with a refusal counted on the audio
            // thread. Exactly the capacity fits; one more does not.
            if notes.len() > MIDI_NOTE_STORE_CAPACITY {
                return Err(format!(
                    "schedule-midi: batch carries {} notes, past the store's ceiling of \
                     {MIDI_NOTE_STORE_CAPACITY}",
                    notes.len()
                ));
            }
            let mut mapped = notes
                .iter()
                .map(|note| map_midi_note(note, *probability_seed, sample_rate))
                .collect::<Result<Vec<_>, _>>()?;
            // The store refuses an unordered batch: sorting runs on the audio
            // thread only by allocating, so it belongs on this side of the ring
            // exactly as it does in `EngineHandle::schedule_midi_notes`. Stable,
            // so two notes written for one sample keep the order the producer
            // wrote them in — the only order it can express for that pair.
            mapped.sort_by_key(|note| note.at_frame);
            // No budget charge: budgets bound the parameter stamps a queue
            // holds, and scheduled MIDI is bounded by the store's own capacity
            // instead.
            ops.push(GraphCommand::ScheduleMidiNotes {
                plugin_id,
                notes: mapped.into_boxed_slice(),
            });
            Ok(())
        }

        GraphCommandPayload::SendMidiNote {
            track_id,
            device_id,
            note,
            velocity,
            channel,
            is_note_on,
        } => {
            let plugin_id = midi_device_plugin_id(registry, track_id, device_id, "send-midi-note")?;
            if *velocity > MAX_MIDI_VELOCITY {
                return Err(format!(
                    "send-midi-note: velocity {velocity} is outside 0..={MAX_MIDI_VELOCITY}"
                ));
            }
            check_note_address(*note, *channel, "send-midi-note")?;
            // No budget charge: budgets bound the parameter stamps a queue
            // holds, and a live note waits in no queue. Its only capacity is
            // the block-local MIDI buffer the engine drains every callback,
            // whose overflow the engine counts itself.
            ops.push(GraphCommand::SendMidiNote(
                plugin_id,
                MidiNoteEvent {
                    note: *note,
                    velocity: *velocity,
                    channel: *channel,
                    is_note_on: *is_note_on,
                    // The head of the next block: a live note names no frame to
                    // be stamped against.
                    frame_offset: 0,
                    // A live note always plays. Chance is arrangement material,
                    // and belongs to the notes a producer wrote.
                    probability_cutoff: PROBABILITY_CUTOFF_RANGE,
                    project_probability_seed: 0,
                    clip_id_hash: 0,
                    event_id_hash: 0,
                    absolute_occurrence_index: 0,
                },
            ));
            Ok(())
        }

        GraphCommandPayload::ClearMidi {
            track_id,
            device_id,
            from_time,
            to_time,
        } => {
            let plugin_id = midi_device_plugin_id(registry, track_id, device_id, "clear-midi")?;
            let from_frame = seconds_to_frames(*from_time, sample_rate, "clear-midi from time")?;
            let to_frame = match to_time {
                Some(to_time) => seconds_to_frames(*to_time, sample_rate, "clear-midi to time")?,
                // An absent end is the end of the store, so `0` with no end
                // clears it whole.
                None => u64::MAX,
            };
            if from_frame > to_frame {
                return Err(format!(
                    "clear-midi: window {from_frame}..{to_frame} ends before it starts"
                ));
            }
            ops.push(GraphCommand::ClearMidiNotes {
                plugin_id,
                from_frame,
                to_frame,
            });
            Ok(())
        }

        GraphCommandPayload::ScheduleClip { playback } => {
            map_schedule_clip(playback, registry, samples, sample_rate, ops)
        }

        GraphCommandPayload::SetTransport {
            playing,
            position_seconds,
            locate,
        } => {
            // Validated whether or not it is used: a position this side cannot
            // put on the frame grid is malformed however the producer means it
            // to be read, and refusing only when the seek is wanted would let
            // one shape of the command carry a number the other refuses.
            let frame =
                seconds_to_frames(*position_seconds, sample_rate, "set-transport position")?;
            // Playback state lands before the locate: a play→stop edge holds
            // every parameter where the last rendered frame left it, and the
            // seek that follows then drops whatever the move made stale — the
            // same order the engine's own laws compose in. The write carries
            // only what the graph owns (the transport ownership law in the
            // module header): `is_playing` and the song position. Tempo and
            // time signature stay with `GraphCommand::SetTransport`, untouched.
            ops.push(GraphCommand::SetTransportPlayback {
                is_playing: *playing,
                song_pos_seconds: *position_seconds,
            });
            if *locate {
                ops.push(GraphCommand::SeekFrames(frame));
                // The ledger mirrors the locate it just queued: the engine's
                // seek drops every queued write stamped at or past the target.
                budgets.apply_seek(frame);
            }
            Ok(())
        }

        GraphCommandPayload::SetMonitorShadow { shadowed } => {
            // Nothing to validate and nothing to charge: the gate addresses no
            // strip, holds no stamp and queues no write. It is a mode the
            // callback reads at the device boundary.
            ops.push(GraphCommand::SetMonitorShadow(*shadowed));
            Ok(())
        }

        GraphCommandPayload::SetMasterGain { gain } => {
            // The fader law, minus the VCA the master has none of: the ceiling
            // is `fader_max_gain()` rather than unity, because the master
            // fader carries the same +6 dB of make-up gain a strip's does.
            let stored = finite(*gain, "set-master-gain gain")?;
            if stored < 0.0 {
                return Err("set-master-gain: gain is negative".to_string());
            }
            let value = (stored as f32).min(fader_max_gain());
            // No `touch`: the command names no strip, so there is no realized
            // chain for a report to observe. No `push_automation` either, and
            // not because the budget is being dodged — this is not an
            // automation write at all. It carries no frame and takes no slot in
            // any parameter's queue: the engine re-aims one smoother, which
            // holds a target rather than a schedule. Charging the automation
            // ledger for it would refuse batches the engine has room for.
            ops.push(GraphCommand::SetMasterGain {
                value,
                smoothing: master_gain_smoothing(sample_rate),
            });
            Ok(())
        }
    }
}

fn map_parameter_write(
    target: &StripParameterTargetPayload,
    write: &ParameterWritePayload,
    registry: &GraphRegistry,
    sample_rate: f32,
    budgets: &mut QueueBudgets,
    ops: &mut Vec<GraphCommand>,
) -> Result<(), String> {
    let strip_for = |strip_id: &String| {
        registry
            .strips
            .get(strip_id)
            .ok_or_else(|| format!("write-parameter: unknown strip '{strip_id}'"))
    };

    // The two gates are strip flags natively, not ramped parameters: only a
    // step is representable, and it lands at the block boundary the command
    // reaches. Anything else must refuse rather than glide a gate.
    let gate_step = |what: &str| -> Result<bool, String> {
        match write {
            ParameterWritePayload::Step { value, .. } => Ok(finite(*value, what)? < 0.5),
            _ => Err(format!(
                "write-parameter: gate-write-shape-unsupported — {what} accepts only a step \
                 natively"
            )),
        }
    };

    match target {
        StripParameterTargetPayload::TrackMuteGate { track_id } => {
            let strip = strip_for(track_id)?;
            let closed = gate_step("track-mute-gate")?;
            match strip.kind {
                StripKind::Track => ops.push(GraphCommand::SetTrackMute(strip.native_id, closed)),
                StripKind::Bus => ops.push(GraphCommand::SetBusMute(strip.native_id, closed)),
            }
            return Ok(());
        }
        StripParameterTargetPayload::TrackSoloGate { track_id } => {
            let strip = strip_for(track_id)?;
            let closed = gate_step("track-solo-gate")?;
            match strip.kind {
                StripKind::Track => {
                    ops.push(GraphCommand::SetTrackSoloGate(strip.native_id, closed))
                }
                StripKind::Bus => ops.push(GraphCommand::SetBusSoloGate(strip.native_id, closed)),
            }
            return Ok(());
        }
        _ => {}
    }

    let (strip, automation_target, value_law): (
        &StripEntry,
        AutomationTarget,
        fn(f64, &StripEntry) -> Result<f32, String>,
    ) = match target {
        StripParameterTargetPayload::TrackFader { track_id } => {
            let strip = strip_for(track_id)?;
            let target = match strip.kind {
                StripKind::Track => AutomationTarget::TrackGain(strip.native_id),
                StripKind::Bus => AutomationTarget::BusGain(strip.native_id),
            };
            (strip, target, |value, strip| {
                fader_gain(value, strip.vca_multiplier)
            })
        }
        StripParameterTargetPayload::TrackPan { track_id } => {
            let strip = strip_for(track_id)?;
            let target = match strip.kind {
                StripKind::Track => AutomationTarget::TrackPan(strip.native_id),
                StripKind::Bus => AutomationTarget::BusPan(strip.native_id),
            };
            (strip, target, |value, _| pan_position(value))
        }
        StripParameterTargetPayload::TrackSendLevel { track_id, bus_id } => {
            let strip = strip_for(track_id)?;
            if !strip.send_bus_ids.iter().any(|id| id == bus_id) {
                return Err(format!(
                    "write-parameter: '{track_id}' has no send to '{bus_id}'"
                ));
            }
            let destination = registry
                .strips
                .get(bus_id)
                .ok_or_else(|| format!("write-parameter: unknown bus '{bus_id}'"))?;
            (
                strip,
                AutomationTarget::TrackSendLevel {
                    track_id: strip.native_id,
                    bus_id: destination.native_id,
                },
                |value, _| send_level(value),
            )
        }
        StripParameterTargetPayload::TrackMuteGate { .. }
        | StripParameterTargetPayload::TrackSoloGate { .. } => unreachable!("handled above"),
    };

    let automation_write = match write {
        ParameterWritePayload::RampTo {
            value,
            start_time,
            land_time,
        } => {
            let start = seconds_to_frames(*start_time, sample_rate, "ramp-to startTime")?;
            let land = seconds_to_frames(*land_time, sample_rate, "ramp-to landTime")?;
            if land < start {
                return Err("write-parameter: ramp-to lands before it starts".to_string());
            }
            AutomationWrite::Replace(AutomationEvent {
                at_frame: start,
                duration_frames: frames_u32(land - start, "ramp-to span")?,
                value: value_law(*value, strip)?,
                shape: RampShape::Linear,
            })
        }
        ParameterWritePayload::Smoothed { .. } => {
            return Err(
                "write-parameter: smoothed-write-unsupported — the native automation queue has \
                 no exponential-approach primitive (Web Audio setTargetAtTime); refused rather \
                 than landed as a different shape"
                    .to_string(),
            )
        }
        ParameterWritePayload::Step { value, time } => AutomationWrite::Append(AutomationEvent {
            at_frame: seconds_to_frames(*time, sample_rate, "step time")?,
            duration_frames: 0,
            value: value_law(*value, strip)?,
            shape: RampShape::Step,
        }),
        ParameterWritePayload::Hold { time } => AutomationWrite::Hold {
            at_frame: seconds_to_frames(*time, sample_rate, "hold time")?,
        },
    };

    push_automation(automation_target, automation_write, budgets, ops)
        .map_err(|reason| format!("write-parameter: {reason}"))
}

fn map_schedule_clip(
    playback: &ClipPlaybackPayload,
    registry: &mut GraphRegistry,
    samples: &TimelineSamplePool,
    sample_rate: f32,
    ops: &mut Vec<GraphCommand>,
) -> Result<(), String> {
    let strip = registry
        .strips
        .get(&playback.track_id)
        .ok_or_else(|| format!("schedule-clip: unknown strip '{}'", playback.track_id))?;
    if strip.kind == StripKind::Bus {
        return Err(format!(
            "schedule-clip: strip '{}' is a bus; only a track plays clips",
            playback.track_id
        ));
    }
    if strip.clip_count == MAX_TRACK_CLIPS {
        return Err(format!(
            "schedule-clip: track '{}' holds its maximum of {MAX_TRACK_CLIPS} clips",
            playback.track_id
        ));
    }
    let native_track_id = strip.native_id;
    let sample = samples.get(&playback.source.source_id).ok_or_else(|| {
        format!(
            "schedule-clip: unknown sample '{}' — register it with register_timeline_sample first",
            playback.source.source_id
        )
    })?;

    let rate = finite(playback.playback_rate, "playbackRate")?;
    if rate <= 0.0 {
        return Err(format!(
            "schedule-clip: playbackRate {rate} refused — a clip rate must be positive"
        ));
    }
    // `ClipPlayback::playback_rate` is varispeed, not pitch-preserving stretch
    // (crates/daw-engine/src/timeline.rs, `ClipPlayback` doc): rate and pitch
    // move together, exactly what an `AudioBufferSourceNode` does on the Web
    // Audio legs (`scheduleAudioClips.ts`, `scheduleOfflineClipSource.ts`).
    // The user's rate and the material's own sample-rate conversion both read
    // as "source frames per rendered frame", so they compose by
    // multiplication into one field the engine already knows how to play.
    let effective_rate = rate * f64::from(sample.sample_rate / sample_rate);
    if !effective_rate.is_finite() || effective_rate <= 0.0 {
        return Err("schedule-clip: the clip's effective rate is not renderable".to_string());
    }

    let gain = finite(playback.gain, "clip gain")?;
    if gain < 0.0 {
        return Err("schedule-clip: clip gain is negative".to_string());
    }

    let start_frame = seconds_to_frames(playback.start_time, sample_rate, "clip startTime")?;
    let length_frames = seconds_to_frames(
        playback.duration_seconds,
        sample_rate,
        "clip durationSeconds",
    )?;
    let source_offset_frames = seconds_to_frames(
        playback.source_offset_seconds,
        sample.sample_rate,
        "clip sourceOffsetSeconds",
    )?;

    let micro_fade_frames = frames_u32(
        seconds_to_frames(
            playback.fade.micro_fade_seconds,
            sample_rate,
            "microFadeSeconds",
        )?,
        "microFadeSeconds",
    )?;
    let fade_in_frames = match &playback.fade.fade_in {
        None => None,
        Some(FadeInPayload {
            reaches_full_at: None,
        }) => Some(0),
        Some(FadeInPayload {
            reaches_full_at: Some(at),
        }) => {
            let at = seconds_to_frames(*at, sample_rate, "fadeIn reachesFullAt")?;
            if at < start_frame {
                return Err("schedule-clip: fadeIn reaches full before the clip starts".to_string());
            }
            Some(frames_u32(at - start_frame, "fadeIn span")?)
        }
    };
    let clip_end_frame = start_frame.saturating_add(length_frames);
    let fade_out_frames = match &playback.fade.fade_out {
        None => None,
        Some(FadeOutPayload { begins_at: None }) => Some(0),
        Some(FadeOutPayload {
            begins_at: Some(at),
        }) => {
            let at = seconds_to_frames(*at, sample_rate, "fadeOut beginsAt")?;
            // A producer states the clip's end as one quantity of seconds; this
            // arm reconstructs it as two roundings, `round(start) +
            // round(length)`. The two disagree by exactly one frame whenever
            // both fractional parts sit below a half and still sum past it, so
            // a fade-out pinned to the end of its own clip lands one frame past
            // that reconstruction through arithmetic alone. One frame is the
            // widest that split can be, so absorb it and keep refusing anything
            // farther out, which is a fade genuinely outside its sound.
            if at > clip_end_frame.saturating_add(1) {
                return Err("schedule-clip: fadeOut begins after the clip ends".to_string());
            }
            Some(frames_u32(
                clip_end_frame.saturating_sub(at),
                "fadeOut span",
            )?)
        }
    };

    let clip_id = registry.allocate_node_id();
    ops.push(GraphCommand::AddClip(
        native_track_id,
        TimelineClip::new(
            clip_id,
            // Shared, never copied: a take comped into forty regions, or looped
            // across an arrangement, is forty clips over one allocation.
            Arc::clone(&sample.left),
            Arc::clone(&sample.right),
            ClipPlacement {
                start_frame,
                source_offset_frames,
                length_frames,
            },
            ClipPlayback {
                gain: gain as f32,
                fade: ClipFade {
                    fade_in_frames,
                    fade_out_frames,
                    micro_fade_frames,
                },
                playback_rate: effective_rate as f32,
            },
        ),
    ));
    registry
        .strips
        .get_mut(&playback.track_id)
        .expect("strip fetched above")
        .clip_count += 1;
    Ok(())
}

// ── Command bodies ──────────────────────────────────────────────────────────

/// Frames per channel in a raw PCM payload, refusing shapes no schedule could
/// honour.
///
/// Ragged bytes are not frames. Zero frames refuse because the contract
/// (`AudioGraphClipSource`) forbids playing silence for a real source — a
/// 0-frame sample registered here would render a later `schedule-clip` as
/// exactly that. And a payload above the offline render ceiling refuses
/// because registration copies the material, so the ceiling on allocation is
/// the same one the renderer holds, applied per channel.
fn pcm_frame_count(pcm_len: usize, channels: usize) -> Result<usize, String> {
    let bytes_per_frame = 4 * channels;
    if pcm_len % bytes_per_frame != 0 {
        return Err(format!(
            "PCM byte length {pcm_len} is not a whole number of {channels}-channel f32 frames"
        ));
    }
    let frames = pcm_len / bytes_per_frame;
    if frames == 0 {
        return Err(
            "PCM payload holds zero frames — a clip scheduled from it could only render \
             silence, which the contract forbids for a real source"
                .to_string(),
        );
    }
    if frames > MAX_OFFLINE_RENDER_FRAMES {
        return Err(format!(
            "PCM payload holds {frames} frames per channel, above the \
             {MAX_OFFLINE_RENDER_FRAMES}-frame ceiling"
        ));
    }
    Ok(frames)
}

fn parse_batch(batch: Value) -> Result<GraphBatchPayload, String> {
    serde_json::from_value(batch).map_err(|error| format!("Invalid graph command batch: {error}"))
}

/// What a live batch's correlation claims — the runtime revision it was
/// built against. `projectRevision` rides the same object but belongs to
/// project truth; the TS side owns comparing it, so it is not read here.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorrelationClaims {
    app_revision: u64,
}

/// The batch law's race check (`AudioGraphBackend.ts`): a correlated batch
/// claims the live-engine revision it was built against, and a claim the
/// engine has moved past means the batch already lost — it refuses here,
/// before the graph changes. No correlation means "not correlated": the one
/// uncorrelated producer renders a snapshot no live document races, so there
/// is nothing to validate. A correlation that cannot be read is a refusal
/// too, never a silent skip — a claim this side cannot check must not pass
/// as checked.
fn validate_correlation(correlation: Option<&Value>, runtime_revision: u64) -> Result<(), String> {
    let Some(correlation) = correlation else {
        return Ok(());
    };
    let claims: CorrelationClaims = serde_json::from_value(correlation.clone())
        .map_err(|error| format!("correlation-malformed: {error}"))?;
    if claims.app_revision != runtime_revision {
        return Err(format!(
            "correlation-stale — the batch was built against live-engine revision {}, but \
             the engine is at revision {runtime_revision}; the batch lost its race and \
             refuses before the graph changes",
            claims.app_revision
        ));
    }
    Ok(())
}

fn result_json(payload: &GraphApplyResultPayload) -> Result<Value, String> {
    serde_json::to_value(payload).map_err(|error| format!("Result did not serialize: {error}"))
}

/// Register decoded timeline material under the app's stable source id.
///
/// `pcm` is interleaved f32 little-endian; `channels` is 1 or 2. Registering
/// an id again replaces the material — the id names the decoded identity, and
/// project truth owns when that identity changes. Returns `{ "frames": n }`.
pub async fn register_timeline_sample(
    sample_id: String,
    sample_rate: f64,
    channels: u32,
    pcm: Vec<u8>,
    state: &AppState,
) -> Result<Value, String> {
    if sample_id.is_empty() {
        return Err("Sample id must not be empty".to_string());
    }
    if !(sample_rate.is_finite() && sample_rate > 0.0) {
        return Err("Sample rate must be a positive, finite number".to_string());
    }
    let channels = match channels {
        1 | 2 => channels as usize,
        other => {
            return Err(format!(
                "Unsupported channel count {other} (mono or stereo)"
            ))
        }
    };
    let frames = pcm_frame_count(pcm.len(), channels)?;
    let bytes_per_frame = 4 * channels;
    // Collected straight into the shared channels every clip over this material
    // will hold, so registration allocates each one exactly once.
    let left: Arc<[f32]> = pcm
        .chunks_exact(bytes_per_frame)
        .map(|frame| f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]))
        .collect();
    let right: Arc<[f32]> = if channels == 2 {
        pcm.chunks_exact(bytes_per_frame)
            .map(|frame| f32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]))
            .collect()
    } else {
        Arc::from([])
    };

    let mut samples = state
        .timeline_samples
        .lock()
        .map_err(|error| format!("Failed to lock timeline samples: {error}"))?;
    samples.insert(
        sample_id,
        TimelineSample {
            left,
            right,
            sample_rate: sample_rate as f32,
        },
    );
    Ok(serde_json::json!({ "frames": frames }))
}

/// Why a slot could not be filled: the mutex guarding it failed (a transport
/// fault the caller reports as an error), or the constructor refused (a result
/// the caller reports in its own vocabulary).
enum SlotStartFailure<E> {
    Lock(String),
    Start(E),
}

/// Fill `slot` if it is empty, running `start` with **no lock held**.
///
/// `start` here is `EngineHandle::new`, which spawns a device output stream
/// and waits on it — up to two five-second startup timeouts on a wedged
/// device. A mutex held across that wait parks every other claim on the engine
/// behind it, and the quit cascade claims the engine on the JS thread
/// (`shutdown.rs`), where parking also stops the shell's force-exit timer from
/// ever firing: a quit landing inside a slow bootstrap would hang the app for
/// as long as the bootstrap takes. So the lock is taken twice and briefly —
/// once to see whether anything is needed, once to install — and never across
/// the construction.
///
/// The window between the two is why the install re-checks rather than
/// assigning: single-boot is the property that matters, and it must not depend
/// on a caller's own serialization. A value that lost the race is dropped only
/// after the guard is released, because releasing a stream blocks exactly like
/// starting one.
fn start_into_empty_slot<T, E>(
    slot: &Mutex<Option<T>>,
    start: impl FnOnce() -> Result<T, E>,
) -> Result<(), SlotStartFailure<E>> {
    let lock_failure = |error: std::sync::PoisonError<_>| {
        SlotStartFailure::Lock(format!("Failed to lock: {error}"))
    };

    if slot.lock().map_err(lock_failure)?.is_some() {
        return Ok(());
    }
    let started = start().map_err(SlotStartFailure::Start)?;

    let mut guard = slot.lock().map_err(lock_failure)?;
    if guard.is_some() {
        drop(guard);
        return Ok(());
    }
    *guard = Some(started);
    Ok(())
}

/// Apply one `AudioGraphCommandBatch` to the live native engine.
///
/// Lazy bootstrap (#1984): the engine starts here, on the first batch, and a
/// machine where it cannot start gets a `rejected` result whose reason says
/// so — never a crash and never a silent no-op. The batch is validated whole
/// against the registry before anything is pushed.
///
/// The registry it is validated against outlives every batch, so a caller that
/// rebuilds a whole topology — every play does — sends a batch marked
/// `replaceTopology` and the previous one is torn down inside the same fence
/// ([`GraphRegistry::take_topology_down`]).
pub async fn apply_graph_commands(
    batch: Value,
    state: &AppState,
    crumbs: &CrumbsState,
) -> Result<Value, String> {
    // A batch that does not even deserialize is a refusal, not a transport
    // error: the contract's one failure vocabulary is the `rejected` result,
    // and a thrown error beside it would be a second vocabulary for the same
    // fact. The serde message is the reason.
    let batch = match parse_batch(batch) {
        Ok(batch) => batch,
        Err(reason) => return result_json(&GraphApplyResultPayload::rejected(reason)),
    };

    let mut registry_guard = state
        .graph
        .lock()
        .map_err(|error| format!("Failed to lock graph registry: {error}"))?;

    // The race check runs before the lazy bootstrap: a batch that already
    // lost refuses before the graph changes, and a batch that cannot apply
    // must not be the one that starts an engine.
    if let Err(reason) =
        validate_correlation(batch.correlation.as_ref(), registry_guard.runtime_revision)
    {
        return result_json(&GraphApplyResultPayload::rejected(reason));
    }

    if let Err(failure) = start_into_empty_slot(&state.engine, daw_engine::EngineHandle::new) {
        return match failure {
            SlotStartFailure::Lock(error) => Err(format!("Failed to lock engine: {error}")),
            SlotStartFailure::Start(error) => result_json(&GraphApplyResultPayload::rejected(
                format!("engine-not-running: {error}"),
            )),
        };
    }

    // An engine exists from here on, so this is where a crumbs instance
    // created before it ran takes its slot (#2265). Instances then engine —
    // the order every path holding both takes them in — and both released
    // before this batch claims the engine below. A crumbs refusal is that
    // instance's to carry, never this batch's: it stays dormant for the next
    // one. The registry guard already held above is passed straight through
    // (#3807): the attach's own fence must be numbered on this same registry,
    // ahead of `working`'s clone below, so the batch fence that follows
    // inherits the count in the order the two fences take on the ring — the
    // registration first, then the batch it precedes.
    match crumbs::attach_dormant_crumbs(crumbs, &mut registry_guard, &state.engine) {
        Ok(refusals) => {
            for (instance_id, reason) in refusals {
                eprintln!(
                    "[Crumbs] instance '{instance_id}' could not attach to the engine: {reason}"
                );
            }
        }
        Err(error) => eprintln!("[Crumbs] dormant instances could not be attached: {error}"),
    }

    // Read outside the engine lock, in the load path's order, and spent as both
    // the batch's reservation and the attach's limit.
    let dormant_plugin_count = state
        .plugins
        .lock()
        .map_err(|error| format!("Failed to lock plugins: {error}"))?
        .len();

    // The instances a device may bind to, read here because this is the last
    // point before the batch is mapped. `attach_dormant_plugins` runs after the
    // fence, for the reason stated there — only an `applied` payload can report
    // an attach — so an instance this batch's own admission takes is not in this
    // lookup and binds on the *next* batch instead. That one-batch lag is the
    // cost of never reporting an engine-owned plugin on a rejected result, and
    // the producer resends its topology on every play.
    let engine_owned_devices: HashMap<String, EngineOwnedDevice> = state
        .engine_plugins
        .lock()
        .map_err(|error| format!("Failed to lock engine plugins: {error}"))?
        .iter()
        .map(|(instance_id, instance)| {
            (
                instance_id.clone(),
                EngineOwnedDevice {
                    engine_plugin_id: instance.engine_plugin_id,
                    chain_kind: instance.chain_kind,
                },
            )
        })
        .collect();

    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|error| format!("Failed to lock engine: {error}"))?;
    // The engine is installed above and only the quit cascade releases one, so
    // an empty slot here means the process is shutting down under this batch.
    let Some(engine) = engine_guard.as_mut() else {
        return result_json(&GraphApplyResultPayload::rejected(
            "engine-not-running: the engine was released while this batch was admitted".to_string(),
        ));
    };

    // Admission opens by subtracting what the engine has proven landed since
    // the last batch: the queue ledger releases exactly the stamps the
    // progress echo covers, so a slow writer never fills a queue forever.
    let progress = engine.graph_progress_snapshot();
    registry_guard.release_landed(progress);

    let samples = state
        .timeline_samples
        .lock()
        .map_err(|error| format!("Failed to lock timeline samples: {error}"))?;

    let correlation = batch.correlation.clone();
    let mut working = registry_guard.clone();
    let mapped = match map_batch(
        &batch,
        &mut working,
        &samples,
        engine.sample_rate(),
        &engine_owned_devices,
    ) {
        Ok(mapped) => mapped,
        Err(reason) => return result_json(&GraphApplyResultPayload::rejected(reason)),
    };

    // Whole-batch admission and visibility: `send_graph_batch` provisions a
    // command ring large enough for the batch when the current one is too
    // small, then publishes the batch behind a fence the audio callback
    // refuses to drain past until every command is visible — the engine
    // applies the batch whole or does not observe it at all. Only this
    // thread pushes onto the ring (the engine mutex is held).
    // The attach below pushes one `AddHostedPlugin` per instance it takes,
    // onto a ring this batch sizes to exactly itself and then fills, so the
    // batch leaves exactly that many slots free. The count and the limit are the
    // same number: an instance parked after the count is read is left dormant
    // for the next batch rather than pushed onto a ring with no room, which is
    // what keeps the reservation exact and a batch with nothing parked as small
    // as it was before any of this existed.
    match engine.send_graph_batch_with_headroom(mapped.ops, dormant_plugin_count) {
        Ok(()) => {}
        Err(GraphBatchError::Refused(reason)) => {
            // Nothing was pushed: a refusal here is a clean rejection.
            return result_json(&GraphApplyResultPayload::rejected(reason));
        }
        Err(GraphBatchError::Partial {
            pushed,
            total,
            error,
        }) => {
            // Defensive-only: `send_graph_batch` checks slots for the whole
            // batch before publishing the fence, and this thread is the only
            // producer (the engine mutex is held), so no other push can steal
            // a slot mid-batch. If this branch were ever reached, the
            // consequence under the fence is not a partial application but a
            // stall: the published `BeginBatch` tells the drain to wait for
            // commands that will never all arrive, so the engine drains
            // nothing further from this ring. A state that broken must never
            // report itself as whole.
            return result_json(&GraphApplyResultPayload::needs_reconcile(
                format!(
                    "the engine refused command {pushed} of {total} after {pushed} were \
                     already queued: {error}"
                ),
                correlation,
                registry_guard.runtime_revision,
                mapped.reports,
            ));
        }
    }

    // The batch is fenced, so this call is `applied` and nothing below can turn
    // it into anything else. That is the whole reason a hosted plugin loaded
    // before the engine ran attaches *here* rather than beside the crumbs slot
    // above: only the applied payload carries `attachedPlugins`, so an attach
    // that ran before `map_batch` or `send_graph_batch` had decided could hand
    // the engine an instance and then report a `rejected` result that says
    // nothing about it — engine-owned and rendering on this side, still pending
    // and degraded on the caller's, and gone from `state.plugins` so no later
    // batch would ever mention it again.
    //
    // Same shape of answer as the crumbs slot: a refusal is that instance's to
    // carry and leaves it dormant for the next batch, never this batch's to
    // fail on. Unlike crumbs, the caller is told which instances were taken —
    // the load told it the plugin had no engine, and this result is the only
    // correction it will get.
    //
    // The engine lock goes first: `attach_dormant_plugins` takes it itself, and
    // this one is not reentrant.
    drop(engine_guard);
    let attached_plugins =
        match crate::commands::plugins::attach_dormant_plugins(state, dormant_plugin_count) {
            Ok(attached) => attached,
            Err(error) => {
                eprintln!("[Plugin] dormant instances could not be attached: {error}");
                Vec::new()
            }
        };
    let attached_plugins: Vec<AttachedPluginPayload> = attached_plugins
        .into_iter()
        .map(|attached| AttachedPluginPayload {
            instance_id: attached.instance_id,
        })
        .collect();

    working.runtime_revision = registry_guard.runtime_revision + 1;
    let revision = working.runtime_revision;
    // `map_batch` advanced this count for the fence just published, so it is
    // the number the engine's `batches_applied` reaches when this batch drains
    // — the same number the ledger stamped every write in it with.
    let admitted_batch = working.batches_sent;
    *registry_guard = working;
    result_json(&GraphApplyResultPayload::applied(
        correlation,
        revision,
        admitted_batch,
        mapped.reports,
        attached_plugins,
    ))
}

/// The wire's fault marker for a `prior` that no longer replays: the stable
/// prefix of [`map_graph_batch`]'s transport error, and the only thing that
/// distinguishes a broken seam invariant from an ordinary batch refusal once
/// both have crossed as an error. `createNativeOfflineGraphBackend.ts` matches
/// this exact text to rethrow rather than answer `rejected`, so it is part of
/// the seam contract — never reword one side alone.
const PRIOR_FAULT_PREFIX: &str = "previously applied commands no longer map";

/// The wire's fault marker for a mapping session this process no longer holds:
/// the stable prefix of the transport error [`map_graph_batch`] raises when a
/// caller asks to resume a session that is absent or held at a different
/// revision. `createNativeOfflineGraphBackend.ts` matches this exact text to
/// retry once with its full committed history (which re-establishes the
/// session), so it is a seam contract like [`PRIOR_FAULT_PREFIX`] — never
/// reword one side alone.
const SESSION_FAULT_PREFIX: &str = "mapping session unknown";

/// How many offline mapping sessions this process keeps alive at once.
///
/// A session is one backend's probe registry kept across applies so `prior`
/// does not have to re-cross the wire every batch (the O(N²) accumulation the
/// stateless path pays). Renders are serialized behind the app's render lock,
/// so one is the working set; the headroom covers a disposed backend whose
/// session has not been evicted yet. Eviction is least-recently-used and is
/// never a fault by itself: an evicted caller gets [`SESSION_FAULT_PREFIX`]
/// and re-establishes with its full prior, landing exactly where the
/// stateless path always was.
const MAX_MAPPING_SESSIONS: usize = 4;

/// One kept probe registry: the graph a session's accepted commands built,
/// and the count of those commands (`revision`) that names which history it
/// represents.
struct GraphMappingSession {
    registry: GraphRegistry,
    revision: u64,
    touched: u64,
}

/// The process-wide store of offline mapping sessions (`AppState`'s
/// `graph_mapping_sessions`). Control-side only: nothing here is reachable
/// from the audio thread, and a session holds registries — ids and strip
/// facts — never PCM.
#[derive(Default)]
pub struct GraphMappingSessions {
    sessions: HashMap<String, GraphMappingSession>,
    touch_counter: u64,
}

impl GraphMappingSessions {
    /// The kept registry for `session_id` at exactly `revision`, cloned so the
    /// caller can map onto it without committing, or `None` when this process
    /// does not hold that history.
    fn resume(&mut self, session_id: &str, revision: u64) -> Option<GraphRegistry> {
        self.touch_counter += 1;
        let touch = self.touch_counter;
        let session = self.sessions.get_mut(session_id)?;
        if session.revision != revision {
            return None;
        }
        session.touched = touch;
        Some(session.registry.clone())
    }

    /// Keep `registry` as `session_id`'s state at `revision`, evicting the
    /// least-recently-touched session past [`MAX_MAPPING_SESSIONS`].
    fn store(&mut self, session_id: &str, registry: GraphRegistry, revision: u64) {
        self.touch_counter += 1;
        let touched = self.touch_counter;
        self.sessions.insert(
            session_id.to_string(),
            GraphMappingSession {
                registry,
                revision,
                touched,
            },
        );
        while self.sessions.len() > MAX_MAPPING_SESSIONS {
            let Some(oldest) = self
                .sessions
                .iter()
                .min_by_key(|(_, session)| session.touched)
                .map(|(id, _)| id.clone())
            else {
                break;
            };
            self.sessions.remove(&oldest);
        }
    }
}

/// The wire shape of [`map_graph_batch`]'s optional `session` argument —
/// hand-mirrored in `nativeGraphTransport.ts` like every other payload here.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MappingSessionKeyPayload {
    session_id: String,
    /// How many commands the caller has had accepted so far — the history the
    /// kept registry must represent for a resume to be sound.
    revision: u64,
}

/// Replay already-accepted history onto a fresh registry, one ceiling-sized
/// chunk at a time. Concatenated session history can exceed what a single
/// honest batch may carry; packing it into one `GraphBatchPayload` would
/// refuse commands this process already took. Each chunk is at most
/// [`MAX_BATCH_COMMANDS`] so the incoming batch still meets the same ceiling.
fn replay_prior_commands(
    mut commands: Vec<GraphCommandPayload>,
    registry: &mut GraphRegistry,
    samples: &TimelineSamplePool,
    sample_rate: f32,
) -> Result<(), String> {
    while !commands.is_empty() {
        let rest = if commands.len() > MAX_BATCH_COMMANDS {
            commands.split_off(MAX_BATCH_COMMANDS)
        } else {
            Vec::new()
        };
        let replay = GraphBatchPayload {
            schema_version: 1,
            correlation: None,
            replace_topology: false,
            commands,
        };
        map_batch(&replay, registry, samples, sample_rate, &HashMap::new())
            .map_err(|reason| format!("{PRIOR_FAULT_PREFIX}: {reason}"))?;
        commands = rest;
    }
    Ok(())
}

/// Map one batch against the graph a prior command sequence built — the
/// report wire of the offline seam, with nothing rendered.
///
/// This is how `createNativeOfflineGraphBackend.ts` gets strip reports and
/// refusals from the mapping that owns them instead of restating them
/// TS-side: `prior` is the backend's already-committed wire commands
/// (replayed in ceiling-sized chunks onto a fresh registry, exactly the graph
/// its next render would rebuild), `batch` is the incoming batch mapped
/// against that carried registry. The split is what scopes the result: the
/// reports cover only the strips the *incoming* batch touched, and a refusal
/// names its commands by the incoming batch's indices.
///
/// The result is the same `rejected`/`applied` vocabulary
/// `apply_graph_commands` speaks, minus a `runtimeRevision` — there is no
/// runtime here, and the TS backend owns its own revision counter
/// ([`GraphApplyResultPayload::mapped`]). A correlation is echoed, never
/// validated: a mapping has no live graph to race. A `prior` that fails to
/// replay is a transport error, not a refusal — those commands were already
/// accepted once, so a registry that no longer takes them is a broken seam
/// invariant, and reporting it as a refusal of the *incoming* batch would
/// blame the wrong commands. The wire has one error channel for both, so
/// [`PRIOR_FAULT_PREFIX`] is what tells them apart on the far side: it is a
/// seam contract, not a message, and the TS consumer
/// (`createNativeOfflineGraphBackend.ts`) matches on it to rethrow instead of
/// shaping a batch refusal. Change it on both sides or not at all.
/// With a `session`, the prior replay becomes resumable (#2225): the caller
/// names `{ sessionId, revision }` where `revision` is how many commands it
/// has had accepted, and this process keeps the post-batch registry under
/// that name so the next apply resumes it with an **empty** `prior` — one
/// batch crosses the wire per apply instead of the whole history. The kept
/// registry advances only on an accepted batch (a rejected batch commits
/// nothing, the same whole-or-nothing law as everywhere else). When the
/// session is not held at the stated revision, the call either
/// *re-establishes* it — `revision == prior.len()`, so the prior *is* the
/// history and replays exactly as the stateless path — or faults with
/// [`SESSION_FAULT_PREFIX`], which tells the caller to resend its full prior.
/// No `session` is the stateless behaviour, unchanged.
pub async fn map_graph_batch(
    prior: Value,
    batch: Value,
    sample_rate: f64,
    session: Option<Value>,
    state: &AppState,
) -> Result<Value, String> {
    if !(sample_rate.is_finite() && sample_rate > 0.0) {
        return Err("Sample rate must be a positive, finite number".to_string());
    }
    let session_key = match session {
        None => None,
        Some(value) if value.is_null() => None,
        Some(value) => Some(
            serde_json::from_value::<MappingSessionKeyPayload>(value)
                .map_err(|error| format!("Invalid mapping session key: {error}"))?,
        ),
    };
    let prior_commands: Vec<GraphCommandPayload> = serde_json::from_value(prior)
        .map_err(|error| format!("Invalid prior command sequence: {error}"))?;
    let batch = match parse_batch(batch) {
        Ok(batch) => batch,
        Err(reason) => return result_json(&GraphApplyResultPayload::rejected(reason)),
    };
    let prior_len = prior_commands.len() as u64;

    // Resume before replay: a held session at the stated revision *is* the
    // prior graph, so the replay below runs only to establish one.
    let resumed: Option<GraphRegistry> = match &session_key {
        Some(key) => {
            let mut sessions = state
                .graph_mapping_sessions
                .lock()
                .map_err(|error| format!("Failed to lock mapping sessions: {error}"))?;
            let resumed = sessions.resume(&key.session_id, key.revision);
            if resumed.is_none() && key.revision != prior_len {
                // Not held, and the prior cannot re-establish it: replaying
                // `prior` would build a different history than the one
                // `revision` names. The caller resends its full prior.
                return Err(format!(
                    "{SESSION_FAULT_PREFIX}: '{}' is not held at revision {} — resend the full \
                     prior to re-establish it",
                    key.session_id, key.revision
                ));
            }
            resumed
        }
        None => None,
    };

    let samples = state
        .timeline_samples
        .lock()
        .map_err(|error| format!("Failed to lock timeline samples: {error}"))?;

    let mut registry = match resumed {
        Some(registry) => registry,
        None => {
            let mut registry = GraphRegistry::default();
            if !prior_commands.is_empty() {
                replay_prior_commands(prior_commands, &mut registry, &samples, sample_rate as f32)?;
            }
            registry
        }
    };

    // `map_batch` mutates the registry it maps onto, so the pre-batch state is
    // kept aside: a rejected batch must leave the session exactly where the
    // accepted history put it.
    let pre_batch = session_key.as_ref().map(|_| registry.clone());
    let base_revision = session_key.as_ref().map(|key| key.revision).unwrap_or(0);
    let batch_len = batch.commands.len() as u64;

    let correlation = batch.correlation.clone();
    // No live engine on this seam, so no instance can be bound: the same
    // empty lookup `render_graph_offline` maps against.
    let mapped = map_batch(
        &batch,
        &mut registry,
        &samples,
        sample_rate as f32,
        &HashMap::new(),
    );
    drop(samples);

    if let Some(key) = &session_key {
        let mut sessions = state
            .graph_mapping_sessions
            .lock()
            .map_err(|error| format!("Failed to lock mapping sessions: {error}"))?;
        match (&mapped, pre_batch) {
            (Ok(_), _) => sessions.store(&key.session_id, registry, base_revision + batch_len),
            (Err(_), Some(pre_batch)) => sessions.store(&key.session_id, pre_batch, base_revision),
            (Err(_), None) => {}
        }
        return match mapped {
            Ok(mapped) => result_json(&GraphApplyResultPayload::mapped(
                correlation,
                mapped.reports,
            )),
            Err(reason) => result_json(&GraphApplyResultPayload::rejected(reason)),
        };
    }

    match mapped {
        Ok(mapped) => result_json(&GraphApplyResultPayload::mapped(
            correlation,
            mapped.reports,
        )),
        Err(reason) => result_json(&GraphApplyResultPayload::rejected(reason)),
    }
}

/// Map one self-contained batch for an offline render: fresh registry, no
/// live engine.
///
/// The caller holds the sample-pool lock only across this call — mapping
/// clones the material each clip plays into its command, so the render itself
/// runs without the lock.
fn map_offline_batch(
    batch: &GraphBatchPayload,
    samples: &TimelineSamplePool,
    sample_rate: f32,
) -> Result<Vec<GraphCommand>, String> {
    let mut registry = GraphRegistry::default();
    // An offline render has no engine and therefore no hosted plugin instances:
    // an external device on a sounding strip refuses here, as it always has.
    Ok(map_batch(batch, &mut registry, samples, sample_rate, &HashMap::new())?.ops)
}

/// Drive one mapped batch through the offline scheduler, refusing a render
/// the engine did not take whole.
fn render_offline_ops(
    ops: Vec<GraphCommand>,
    frames: usize,
    sample_rate: f32,
) -> Result<(Vec<f32>, Vec<f32>), String> {
    // A render is playback by construction: the transport rolls from frame 0
    // unless the batch itself says otherwise (its own set-transport commands
    // are mapped after this preamble and override it).
    let mut renderer = OfflineRenderer::new(sample_rate, ops.len() + 1);
    renderer.push(GraphCommand::SetTransportPlayback {
        is_playing: true,
        song_pos_seconds: 0.0,
    })?;
    for op in ops {
        renderer.push(op)?;
    }

    let rendered = renderer.render(frames);

    // Belt and braces under refuse-don't-drop: `map_batch` refuses anything
    // the graph's fixed capacities could not take, so these counters stay
    // zero — but a nonzero counter means the engine dropped part of the
    // admitted batch, and success here would launder that drop into a clean
    // render.
    let diagnostics = renderer.timeline_diagnostics();
    if diagnostics != TimelineRtDiagnosticsSnapshot::default() {
        return Err(format!(
            "offline-render-dropped-commands: the engine refused part of the batch after \
             admission ({diagnostics:?}); the output is not the batch and is discarded"
        ));
    }
    Ok(rendered)
}

/// One offline render: map, apply, render — with no live engine involved.
///
/// Split from the napi wrapper so refusal-before-application and determinism
/// are testable without a device. Returns interleaved stereo f32.
#[cfg(test)]
fn render_offline_batch(
    batch: &GraphBatchPayload,
    samples: &TimelineSamplePool,
    frames: usize,
    sample_rate: f32,
) -> Result<Vec<f32>, String> {
    let ops = map_offline_batch(batch, samples, sample_rate)?;
    let (left, right) = render_offline_ops(ops, frames, sample_rate)?;
    let mut interleaved = Vec::with_capacity(frames * 2);
    for index in 0..frames {
        interleaved.push(left[index]);
        interleaved.push(right[index]);
    }
    Ok(interleaved)
}

/// Render a command batch deterministically, without any audio device.
///
/// The D3.b null-test oracle: the same scheduler the live engine runs, driven
/// block by block on the calling thread. Returns interleaved stereo f32
/// little-endian bytes; a refused batch is an error carrying the same
/// per-command reasons `apply_graph_commands` reports, and nothing is
/// rendered from it.
pub async fn render_graph_offline(
    batch: Value,
    frames: u32,
    sample_rate: f64,
    state: &AppState,
) -> Result<Vec<u8>, String> {
    let batch = parse_batch(batch)?;
    if !(sample_rate.is_finite() && sample_rate > 0.0) {
        return Err("Sample rate must be a positive, finite number".to_string());
    }
    let frames = frames as usize;
    if frames == 0 {
        return Err("Frame count must be at least 1".to_string());
    }
    if frames > MAX_OFFLINE_RENDER_FRAMES {
        return Err(format!(
            "Frame count {frames} exceeds the offline render ceiling of {MAX_OFFLINE_RENDER_FRAMES}"
        ));
    }

    // The pool lock spans only the mapping: every source the batch plays is
    // cloned into its clip command there, so the render — the long part —
    // runs with the pool free for concurrent registrations.
    let ops = {
        let samples = state
            .timeline_samples
            .lock()
            .map_err(|error| format!("Failed to lock timeline samples: {error}"))?;
        map_offline_batch(&batch, &samples, sample_rate as f32)?
    };
    let (left, right) = render_offline_ops(ops, frames, sample_rate as f32)?;

    // Interleave straight into the byte payload; the render's planar pair is
    // the only f32 copy of the output this function holds.
    let mut bytes = Vec::with_capacity(frames * 2 * 4);
    for index in 0..frames {
        bytes.extend_from_slice(&left[index].to_le_bytes());
        bytes.extend_from_slice(&right[index].to_le_bytes());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block_on_test;
    use serde_json::json;

    /// Map a batch against an engine holding no hosted plugin instances — the
    /// state every case below is about unless it says otherwise. A case about
    /// binding calls [`map_batch`] itself with the lookup it wants.
    fn map_unbound_batch(
        batch: &GraphBatchPayload,
        registry: &mut GraphRegistry,
        samples: &TimelineSamplePool,
        sample_rate: f32,
    ) -> Result<MappedBatch, String> {
        map_batch(batch, registry, samples, sample_rate, &HashMap::new())
    }

    fn sample_pool() -> TimelineSamplePool {
        let mut samples = TimelineSamplePool::default();
        samples.insert(
            "source-a".to_string(),
            TimelineSample {
                left: vec![0.5; 48_000].into(),
                right: vec![0.5; 48_000].into(),
                sample_rate: 48_000.0,
            },
        );
        samples
    }

    fn strip_state(gain: f64) -> Value {
        json!({ "gain": gain, "pan": 0, "muted": false, "soloGated": false, "vcaMultiplier": 1 })
    }

    fn batch(commands: Value) -> GraphBatchPayload {
        serde_json::from_value(json!({ "schemaVersion": 1, "commands": commands }))
            .expect("the test batch should deserialize")
    }

    /// How many locates a mapping queued. `GraphCommand` carries no `Debug`, so
    /// the shape is counted rather than printed.
    fn seek_count(ops: &[GraphCommand]) -> usize {
        ops.iter()
            .filter(|op| matches!(op, GraphCommand::SeekFrames(_)))
            .count()
    }

    /// The shape every producer written before the field existed still sends.
    #[test]
    fn a_transport_write_locates_unless_it_says_otherwise() {
        let mut registry = GraphRegistry::default();
        let mapped = map_unbound_batch(
            &batch(json!([
                { "kind": "set-transport", "playing": true, "positionSeconds": 2.0 }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("an ordinary transport write should map");

        assert!(
            matches!(
                mapped.ops.as_slice(),
                [
                    GraphCommand::SetTransportPlayback {
                        is_playing: true,
                        ..
                    },
                    GraphCommand::SeekFrames(96_000)
                ]
            ),
            "an unqualified set-transport is a locate at its own position"
        );
    }

    /// The live session's roll (`rollNativeTransport`), which follows a topology
    /// batch that already parked the engine where playback is to start. The
    /// locate it does not need is one that would cancel every fader, pan and
    /// send level that topology queued at frame 0.
    #[test]
    fn a_transport_write_that_does_not_locate_queues_no_seek() {
        let mut registry = GraphRegistry::default();
        let mapped = map_unbound_batch(
            &batch(json!([
                { "kind": "set-transport", "playing": true, "positionSeconds": 2.0, "locate": false }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("a non-locating transport write should map");

        assert_eq!(seek_count(&mapped.ops), 0, "no locate was asked for");
        assert!(
            matches!(
                mapped.ops.as_slice(),
                [GraphCommand::SetTransportPlayback {
                    is_playing: true,
                    song_pos_seconds
                }] if (*song_pos_seconds - 2.0).abs() < f64::EPSILON
            ),
            "the playback state and its position still travel; only the seek is withheld"
        );
    }

    /// Withholding the seek must not withhold the validation: a position that
    /// cannot be put on the frame grid is malformed either way.
    #[test]
    fn a_non_locating_transport_write_still_refuses_an_unmappable_position() {
        let mut registry = GraphRegistry::default();
        let refused = map_unbound_batch(
            &batch(json!([
                { "kind": "set-transport", "playing": true, "positionSeconds": -1.0, "locate": false }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        );

        assert!(
            refused.is_err(),
            "a position the grid cannot hold is refused whether or not it is used"
        );
    }

    fn clip_and_gain_batch() -> GraphBatchPayload {
        batch(json!([
            {
                "kind": "create-track-strip",
                "trackId": "track-1",
                "name": "Vox",
                "state": strip_state(0.5),
                "devices": [],
                "honorMuted": true,
                "contributesAudio": true
            },
            {
                "kind": "schedule-clip",
                "playback": {
                    "trackId": "track-1",
                    "source": { "sourceId": "source-a" },
                    "startTime": 0,
                    "sourceOffsetSeconds": 0,
                    "durationSeconds": 0.1,
                    "playbackRate": 1,
                    "gain": 1,
                    "fade": { "microFadeSeconds": 0 }
                }
            }
        ]))
    }

    /// The fader ceiling is +6 dB of headroom above unity, not unity itself:
    /// a stored gain between 1.0 and the ceiling is real make-up gain and
    /// must reach the engine unchanged, exactly like the live/web-offline
    /// clamp in `clampFaderGain` (`src/utils/audioLevelLaw.ts`). Only a
    /// value past the ceiling clamps.
    #[test]
    fn fader_gain_passes_make_up_gain_through_and_clamps_only_past_the_ceiling() {
        let ceiling = fader_max_gain();
        assert!(
            (ceiling - 1.995_262_3).abs() < 0.000_01,
            "the ceiling should be +6 dB (10^0.3 ≈ 1.9953), got {ceiling}"
        );

        let below_ceiling = fader_gain(1.5, 1.0).expect("1.5 is finite and non-negative");
        assert_eq!(
            below_ceiling, 1.5,
            "a gain above unity but below the ceiling must pass through unchanged"
        );

        let above_ceiling = fader_gain(2.5, 1.0).expect("2.5 is finite and non-negative");
        assert_eq!(
            above_ceiling, ceiling,
            "a gain past the ceiling must clamp to it, not to unity"
        );
    }

    /// The wire vocabulary is 1:1 with the contract: every command kind the
    /// TS `AudioGraphCommand` union names deserializes and maps.
    #[test]
    fn the_full_contract_vocabulary_maps_onto_engine_commands() {
        let batch = batch(json!([
            {
                "kind": "create-track-strip",
                "trackId": "t1",
                "name": "Track",
                "state": { "gain": 0.8, "pan": -25, "muted": true, "soloGated": true, "vcaMultiplier": 0.5 },
                "devices": [
                    { "id": "d-knead", "name": "Knead", "type": "knead", "bypassed": false,
                      "parameterValues": { "shift_semitones": 3.0 } },
                    { "id": "d-ferm", "name": "Fermenter", "type": "fermenter", "bypassed": false,
                      "parameterValues": {} }
                ],
                "honorMuted": true,
                "contributesAudio": true
            },
            {
                "kind": "create-bus-strip",
                "busId": "b1",
                "name": "Reverb bus",
                "state": strip_state(1.0),
                "devices": [],
                "honorMuted": true,
                "contributesAudio": true
            },
            { "kind": "set-track-output", "trackId": "t1", "target": { "kind": "bus", "busId": "b1" } },
            { "kind": "add-send", "trackId": "t1", "busId": "b1", "tap": "pre-fader", "level": 0.7 },
            { "kind": "write-parameter",
              "target": { "kind": "track-fader", "trackId": "t1" },
              "write": { "shape": "ramp-to", "value": 0.25, "startTime": 0.5, "landTime": 1.0 } },
            { "kind": "write-parameter",
              "target": { "kind": "track-send-level", "trackId": "t1", "busId": "b1" },
              "write": { "shape": "step", "value": 0.4, "time": 2.0 } },
            { "kind": "write-parameter",
              "target": { "kind": "track-pan", "trackId": "t1" },
              "write": { "shape": "hold", "time": 3.0 } },
            { "kind": "write-parameter",
              "target": { "kind": "track-mute-gate", "trackId": "t1" },
              "write": { "shape": "step", "value": 1, "time": 0 } },
            { "kind": "write-parameter",
              "target": { "kind": "track-solo-gate", "trackId": "t1" },
              "write": { "shape": "step", "value": 0, "time": 0 } },
            { "kind": "write-device-parameter",
              "target": { "kind": "device-parameter", "trackId": "t1", "deviceId": "d-knead",
                          "parameterId": "retune_speed_ms" },
              "write": { "shape": "step", "value": 20, "time": 1.5 } },
            { "kind": "set-device-parameters", "trackId": "t1", "deviceId": "d-knead",
              "values": { "formant_preserve": 1 } },
            { "kind": "schedule-clip",
              "playback": {
                  "trackId": "t1",
                  "source": { "sourceId": "source-a" },
                  "startTime": 1.0,
                  "sourceOffsetSeconds": 0.25,
                  "durationSeconds": 0.5,
                  "playbackRate": 1,
                  "gain": 0.9,
                  "fade": {
                      "fadeIn": { "reachesFullAt": 1.1 },
                      "fadeOut": { "beginsAt": 1.4 },
                      "microFadeSeconds": 0.005
                  }
              } },
            { "kind": "send-midi-note", "trackId": "t1", "deviceId": "d-ferm",
              "note": 60, "velocity": 100, "channel": 0, "isNoteOn": true },
            { "kind": "remove-device", "trackId": "t1", "deviceId": "d-knead" },
            { "kind": "remove-device", "trackId": "t1", "deviceId": "d-ferm" },
            { "kind": "remove-send", "trackId": "t1", "busId": "b1" },
            { "kind": "set-transport", "playing": true, "positionSeconds": 4.0 }
        ]));

        let mut registry = GraphRegistry::default();
        let mapped = map_unbound_batch(&batch, &mut registry, &sample_pool(), 48_000.0)
            .expect("the full vocabulary should map");

        assert!(!mapped.ops.is_empty());
        // Reports observe the post-batch registry: `d-knead` arrives with
        // `t1`'s creation and the same batch then removes it, so `t1`'s
        // realized chain is empty.
        assert_eq!(
            mapped.reports,
            vec![
                StripReportPayload {
                    kind: "track",
                    id: "t1".to_string(),
                    device_ids: Vec::new(),
                },
                StripReportPayload {
                    kind: "bus",
                    id: "b1".to_string(),
                    device_ids: Vec::new(),
                },
            ]
        );
        // The transport write is playback-only: the graph does not own tempo
        // or time signature, so no whole-state assignment may cross the ring.
        assert!(mapped.ops.iter().any(|op| matches!(
            op,
            GraphCommand::SetTransportPlayback {
                is_playing: true,
                song_pos_seconds,
            } if *song_pos_seconds == 4.0
        )));
        assert!(!mapped
            .ops
            .iter()
            .any(|op| matches!(op, GraphCommand::SetTransport(_))));
        // The strip state reached the ops with the level law applied: the
        // VCA folds in before the clamp, so 0.8 * 0.5 = 0.4.
        assert!(mapped.ops.iter().any(|op| matches!(
            op,
            GraphCommand::AutomateParam {
                target: AutomationTarget::TrackGain(_),
                write: AutomationWrite::Replace(event),
            } if event.value == 0.4
        )));
        // Knead's handful of parameters travel as addressed commands behind
        // the registration: the body is built without them, so the command is
        // the only thing that carries `d-knead`'s patch to the engine.
        assert!(
            mapped.ops.iter().any(|op| matches!(
                op,
                GraphCommand::SetParam(_, DeviceParam::ShiftSemitones, value) if *value == 3.0
            )),
            "the knead device's parameter never crossed the ring as a command"
        );
        // The immediate write is the same primitive under a different command:
        // no stamp, no frame, applied on the next drain.
        assert!(
            mapped.ops.iter().any(|op| matches!(
                op,
                GraphCommand::SetParam(_, DeviceParam::FormantPreserve, value) if *value == 1.0
            )),
            "the immediate parameter batch never crossed the ring as a command"
        );
        // A live note is its own op, addressed at the device that sinks notes.
        assert!(
            mapped.ops.iter().any(|op| matches!(
                op,
                GraphCommand::SendMidiNote(_, event)
                    if event.note == 60 && event.is_note_on && event.frame_offset == 0
            )),
            "the live note never crossed the ring as a command"
        );
    }

    /// The shadow monitor gate crosses the wire as itself: a session mode the
    /// engine reads at the device boundary, carrying no strip and no stamp. It
    /// must not be mapped onto the master fader — that is project truth a
    /// bounce and a save both read, and a monitor mode is neither.
    #[test]
    fn the_monitor_shadow_gate_maps_onto_the_engine_command_and_nothing_else() {
        for shadowed in [true, false] {
            let batch = batch(json!([
                { "kind": "set-monitor-shadow", "shadowed": shadowed }
            ]));

            let mut registry = GraphRegistry::default();
            let mapped = map_unbound_batch(&batch, &mut registry, &sample_pool(), 48_000.0)
                .expect("the monitor gate should map without a strip");

            assert!(mapped.ops.iter().any(
                |op| matches!(op, GraphCommand::SetMonitorShadow(value) if *value == shadowed)
            ));
            assert!(!mapped.ops.iter().any(|op| matches!(
                op,
                GraphCommand::AutomateParam {
                    target: AutomationTarget::MasterGain,
                    ..
                }
            )));
        }
    }

    /// The master fader crosses as a target and the coefficient to approach it
    /// by, with no frame anywhere in it. It names no strip, so it observes
    /// none, and it charges no automation slot, because it queues no write.
    #[test]
    fn set_master_gain_maps_onto_a_smoother_target_that_charges_no_queue() {
        let batch = batch(json!([
            { "kind": "set-master-gain", "gain": 0.5 }
        ]));

        let mut registry = GraphRegistry::default();
        let mapped = map_unbound_batch(&batch, &mut registry, &sample_pool(), 48_000.0)
            .expect("the master fader should map without a strip");

        // What the coefficient means: over one time constant — 480 frames at
        // 48 kHz — the approach leaves `1/e` of the distance, which is the
        // definition `setTargetAtTime(value, now, 0.01)` answers to.
        let master_writes = mapped
            .ops
            .iter()
            .filter(|op| {
                matches!(
                    op,
                    GraphCommand::SetMasterGain { value, smoothing }
                        if *value == 0.5
                            && ((1.0 - smoothing).powi(480) - 1.0 / std::f32::consts::E).abs()
                                < 1e-4
                )
            })
            .count();
        assert_eq!(
            master_writes, 1,
            "one aim at the requested level, on the Web Audio fader's own law"
        );
        assert_eq!(mapped.ops.len(), 1, "the command carries nothing else");
        assert!(mapped.reports.is_empty(), "no strip was addressed");
        assert!(
            registry.automation_pending.is_empty(),
            "a target the engine approaches occupies no parameter queue to charge"
        );
    }

    /// The approach is stated per sample, so its coefficient has to be derived
    /// from the rate the session actually runs at: one rate's coefficient at
    /// another rate is a different time constant, and the two carriers would
    /// stop agreeing.
    #[test]
    fn set_master_gain_scales_its_smoothing_with_the_sample_rate() {
        let batch = batch(json!([
            { "kind": "set-master-gain", "gain": 0.5 }
        ]));

        let mut registry = GraphRegistry::default();
        let mapped = map_unbound_batch(&batch, &mut registry, &sample_pool(), 96_000.0)
            .expect("the master fader should map at any rate");

        // The same 10 ms, which is 960 frames at this rate rather than 480.
        assert!(mapped.ops.iter().any(|op| matches!(
            op,
            GraphCommand::SetMasterGain { smoothing, .. }
                if ((1.0 - smoothing).powi(960) - 1.0 / std::f32::consts::E).abs() < 1e-4
        )));
    }

    /// The master fader has the same +6 dB of headroom a strip fader has, and
    /// the same hard floor. A stored value past the ceiling clamps to it
    /// rather than reaching the engine as raw make-up gain.
    #[test]
    fn set_master_gain_clamps_at_the_fader_ceiling() {
        let batch = batch(json!([
            { "kind": "set-master-gain", "gain": 3.0 }
        ]));

        let mut registry = GraphRegistry::default();
        let mapped = map_unbound_batch(&batch, &mut registry, &sample_pool(), 48_000.0)
            .expect("a gain past the ceiling clamps rather than refusing");

        let ceiling = fader_max_gain();
        assert!(mapped.ops.iter().any(
            |op| matches!(op, GraphCommand::SetMasterGain { value, .. } if *value == ceiling)
        ));
    }

    /// A negative amplitude is a phase inversion, never a level, so it refuses
    /// the batch by name instead of reaching the engine as a fader position.
    /// Zero is a level — the fader pulled all the way down — and must apply.
    #[test]
    fn set_master_gain_refuses_a_negative_gain_and_applies_a_zero_one() {
        let negative = batch(json!([
            { "kind": "set-master-gain", "gain": -0.1 }
        ]));
        let mut registry = GraphRegistry::default();
        let refused = map_unbound_batch(&negative, &mut registry, &sample_pool(), 48_000.0)
            .expect_err("a negative gain must refuse");
        assert!(
            refused.contains("set-master-gain"),
            "the refusal should name the command, got {refused}"
        );

        let silent = batch(json!([
            { "kind": "set-master-gain", "gain": 0.0 }
        ]));
        let mut registry = GraphRegistry::default();
        let mapped = map_unbound_batch(&silent, &mut registry, &sample_pool(), 48_000.0)
            .expect("a fader pulled to silence is a level, not a refusal");
        assert!(mapped
            .ops
            .iter()
            .any(|op| matches!(op, GraphCommand::SetMasterGain { value, .. } if *value == 0.0)));
    }

    #[test]
    fn a_bus_routed_at_a_track_maps_onto_a_bus_to_track_edge() {
        let batch = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "create-bus-strip", "busId": "b1", "name": "B", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "set-track-output", "trackId": "b1", "target": { "kind": "track", "trackId": "t1" } }
        ]));

        let mut registry = GraphRegistry::default();
        let mapped = map_unbound_batch(&batch, &mut registry, &sample_pool(), 48_000.0)
            .expect("bus->track must map");

        // Node ids are allocated in creation order: the track is 1, the bus is 2.
        assert!(mapped
            .ops
            .iter()
            .any(|op| matches!(op, GraphCommand::SetBusOutput(2, RouteTarget::Track(1)))));
    }

    #[test]
    fn a_bus_strip_maps_mute_pan_and_solo_gate() {
        let batch = batch(json!([{
            "kind": "create-bus-strip",
            "busId": "b1",
            "name": "Reverb",
            "state": { "gain": 0.9, "pan": -25, "muted": true, "soloGated": true, "vcaMultiplier": 1 },
            "devices": [],
            "honorMuted": true,
            "contributesAudio": true
        }]));

        let mapped = map_unbound_batch(
            &batch,
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect("a bus strip holds mute, pan, and solo");
        assert!(mapped
            .ops
            .iter()
            .any(|op| matches!(op, GraphCommand::SetBusMute(1, true))));
        assert!(mapped
            .ops
            .iter()
            .any(|op| matches!(op, GraphCommand::SetBusSoloGate(1, true))));
        assert!(mapped.ops.iter().any(|op| matches!(
            op,
            GraphCommand::AutomateParam {
                target: AutomationTarget::BusPan(1),
                write: AutomationWrite::Replace(event),
            } if event.value == -0.5
        )));
    }

    #[test]
    fn a_bus_parameter_write_maps_mute_pan_and_solo_gate() {
        let batch = batch(json!([
            {
                "kind": "create-bus-strip", "busId": "b1", "name": "Reverb",
                "state": strip_state(0.9), "devices": [], "honorMuted": true,
                "contributesAudio": true
            },
            { "kind": "write-parameter",
              "target": { "kind": "track-mute-gate", "trackId": "b1" },
              "write": { "shape": "step", "value": 0, "time": 0 } },
            { "kind": "write-parameter",
              "target": { "kind": "track-solo-gate", "trackId": "b1" },
              "write": { "shape": "step", "value": 0, "time": 0 } },
            { "kind": "write-parameter",
              "target": { "kind": "track-pan", "trackId": "b1" },
              "write": { "shape": "step", "value": 25, "time": 0 } }
        ]));

        let mapped = map_unbound_batch(
            &batch,
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect("a bus accepts mute, pan, and solo writes");
        assert!(mapped
            .ops
            .iter()
            .any(|op| matches!(op, GraphCommand::SetBusMute(1, true))));
        assert!(mapped
            .ops
            .iter()
            .any(|op| matches!(op, GraphCommand::SetBusSoloGate(1, true))));
        assert!(mapped.ops.iter().any(|op| matches!(
            op,
            GraphCommand::AutomateParam {
                target: AutomationTarget::BusPan(1),
                ..
            }
        )));
    }

    #[test]
    fn one_bad_command_refuses_the_whole_batch_and_leaves_the_registry_untouched() {
        let batch = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "set-track-output", "trackId": "missing", "target": { "kind": "master" } }
        ]));

        let registry = GraphRegistry::default();
        let mut working = registry.clone();
        let refusal = map_unbound_batch(&batch, &mut working, &sample_pool(), 48_000.0)
            .expect_err("an unknown strip must refuse the batch");

        assert!(refusal.contains("commands[1]"));
        assert!(refusal.contains("unknown strip 'missing'"));
        // The working clone is discarded on refusal; the committed registry
        // never saw the valid half of the batch.
        assert!(registry.strips.is_empty());
    }

    #[test]
    fn a_stretched_clip_maps_to_its_playback_rate() {
        // 48 kHz material on a 48 kHz engine: the rate conversion factor is 1,
        // so the mapped `playback_rate` is exactly the user's varispeed rate —
        // the same thing an `AudioBufferSourceNode` does on the Web Audio legs.
        let stretched = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "schedule-clip", "playback": {
                "trackId": "t1", "source": { "sourceId": "source-a" },
                "startTime": 0, "sourceOffsetSeconds": 0, "durationSeconds": 1,
                "playbackRate": 1.5, "gain": 1, "fade": { "microFadeSeconds": 0 } } }
        ]));
        let mapped = map_unbound_batch(
            &stretched,
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect("a varispeed clip must map, not refuse");
        assert!(mapped.ops.iter().any(|op| matches!(
            op,
            GraphCommand::AddClip(_, clip) if clip.playback().playback_rate == 1.5
        )));
    }

    #[test]
    fn an_unregistered_sample_refuses_by_name() {
        let unknown = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "schedule-clip", "playback": {
                "trackId": "t1", "source": { "sourceId": "nowhere" },
                "startTime": 0, "sourceOffsetSeconds": 0, "durationSeconds": 1,
                "playbackRate": 1, "gain": 1, "fade": { "microFadeSeconds": 0 } } }
        ]));
        let refusal = map_unbound_batch(
            &unknown,
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect_err("an unregistered sample must refuse");
        assert!(refusal.contains("unknown sample 'nowhere'"));
    }

    #[test]
    fn a_non_positive_playback_rate_refuses_by_name() {
        for rate in [0.0, -1.0] {
            let batch = batch(json!([
                { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
                  "devices": [], "honorMuted": true, "contributesAudio": true },
                { "kind": "schedule-clip", "playback": {
                    "trackId": "t1", "source": { "sourceId": "source-a" },
                    "startTime": 0, "sourceOffsetSeconds": 0, "durationSeconds": 1,
                    "playbackRate": rate, "gain": 1, "fade": { "microFadeSeconds": 0 } } }
            ]));
            let refusal = map_unbound_batch(
                &batch,
                &mut GraphRegistry::default(),
                &sample_pool(),
                48_000.0,
            )
            .expect_err(&format!("playbackRate {rate} must refuse"));
            assert!(refusal.contains("playbackRate"));
            assert!(refusal.contains(&rate.to_string()));
        }
    }

    #[test]
    fn a_stretched_clips_length_frames_stays_timeline_measured() {
        // The placement's `length_frames` is how long the clip sounds on the
        // timeline, not how much material it reads — `ClipPlayback::playback_rate`
        // decides that separately. A 2x clip that lasts one timeline second
        // still occupies exactly one second of frames at the engine's rate.
        let stretched = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "schedule-clip", "playback": {
                "trackId": "t1", "source": { "sourceId": "source-a" },
                "startTime": 0, "sourceOffsetSeconds": 0, "durationSeconds": 1,
                "playbackRate": 2.0, "gain": 1, "fade": { "microFadeSeconds": 0 } } }
        ]));
        let mapped = map_unbound_batch(
            &stretched,
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect("a varispeed clip must map");
        assert!(mapped.ops.iter().any(|op| matches!(
            op,
            GraphCommand::AddClip(_, clip) if clip.placement().length_frames == 48_000
        )));
    }

    /// A clip whose start and length each round *down* by 0.4 of a frame, so
    /// the end stated as one quantity of seconds rounds one frame past the end
    /// this mapper reconstructs from the two: 0.0113 s and 0.9113 s land on
    /// frames 542 and 43_742 at 48 kHz, while their sum lands on 44_285 rather
    /// than 44_284.
    fn clip_with_fade_out_at(begins_at: f64) -> GraphBatchPayload {
        batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "schedule-clip", "playback": {
                "trackId": "t1", "source": { "sourceId": "source-a" },
                "startTime": 0.0113, "sourceOffsetSeconds": 0, "durationSeconds": 0.9113,
                "playbackRate": 1, "gain": 1,
                "fade": { "fadeOut": { "beginsAt": begins_at }, "microFadeSeconds": 0 } } }
        ]))
    }

    #[test]
    fn a_fade_out_on_the_clips_own_end_survives_the_rounding_split() {
        let mapped = map_unbound_batch(
            &clip_with_fade_out_at(0.9226),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect("a fade-out pinned to the clip's own end must map");

        assert!(mapped.ops.iter().any(|op| matches!(
            op,
            GraphCommand::AddClip(_, clip) if clip.playback().fade.fade_out_frames == Some(0)
        )));
    }

    #[test]
    fn a_fade_out_two_frames_past_the_clip_end_still_refuses() {
        // 44_286 frames — one frame farther than any rounding split can reach.
        let refusal = map_unbound_batch(
            &clip_with_fade_out_at(44_286.0 / 48_000.0),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect_err("a fade-out genuinely past the clip must refuse");

        assert!(refusal.contains("fadeOut begins after the clip ends"));
    }

    #[test]
    fn scheduling_one_sample_many_times_shares_its_material_instead_of_copying_it() {
        // A take becomes many clips through ordinary editing — comp regions,
        // gap fills, loop passes — and a mapper that handed each one its own
        // copy would multiply the take's PCM by the number of edits made to it.
        let clips: Vec<Value> = (0..8)
            .map(|index| {
                json!({ "kind": "schedule-clip", "playback": {
                    "trackId": "t1", "source": { "sourceId": "source-a" },
                    "startTime": index, "sourceOffsetSeconds": 0, "durationSeconds": 0.5,
                    "playbackRate": 1, "gain": 1, "fade": { "microFadeSeconds": 0 } } })
            })
            .collect();
        let batch = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            clips[0], clips[1], clips[2], clips[3], clips[4], clips[5], clips[6], clips[7]
        ]));
        let samples = sample_pool();

        let mapped = map_unbound_batch(&batch, &mut GraphRegistry::default(), &samples, 48_000.0)
            .expect("eight clips over one sample should map");

        let scheduled = mapped
            .ops
            .iter()
            .filter(|op| matches!(op, GraphCommand::AddClip(..)))
            .count();
        assert_eq!(scheduled, 8);
        // The pool's own handle plus one per scheduled clip. A copy would leave
        // the pool holding its material alone.
        let material = &samples["source-a"];
        assert_eq!(Arc::strong_count(&material.left), 9);
        assert_eq!(Arc::strong_count(&material.right), 9);
    }

    #[test]
    fn material_at_another_rate_is_rate_converted_not_stretched() {
        let mut samples = TimelineSamplePool::default();
        samples.insert(
            "half-rate".to_string(),
            TimelineSample {
                left: vec![0.5; 24_000].into(),
                right: [].into(),
                sample_rate: 24_000.0,
            },
        );
        let batch = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "schedule-clip", "playback": {
                "trackId": "t1", "source": { "sourceId": "half-rate" },
                "startTime": 0, "sourceOffsetSeconds": 0, "durationSeconds": 0.5,
                "playbackRate": 1, "gain": 1, "fade": { "microFadeSeconds": 0 } } }
        ]));

        let mapped = map_unbound_batch(&batch, &mut GraphRegistry::default(), &samples, 48_000.0)
            .expect("a rate-converted clip should map");

        // Half-rate material on a 48k engine reads 0.5 source frames per
        // rendered frame at the user's unity rate — pure conversion.
        assert!(mapped.ops.iter().any(|op| matches!(
            op,
            GraphCommand::AddClip(_, clip) if clip.playback().playback_rate == 0.5
        )));
    }

    #[test]
    fn a_user_rate_composes_with_the_materials_own_rate_conversion() {
        // 24 kHz material on a 48 kHz engine converts by 0.5; a user rate of
        // 2.0 on top of that composes by multiplication back to unity — the
        // arithmetic itself is observed here, not just that the field is set.
        let mut samples = TimelineSamplePool::default();
        samples.insert(
            "half-rate".to_string(),
            TimelineSample {
                left: vec![0.5; 24_000].into(),
                right: [].into(),
                sample_rate: 24_000.0,
            },
        );
        let batch = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "schedule-clip", "playback": {
                "trackId": "t1", "source": { "sourceId": "half-rate" },
                "startTime": 0, "sourceOffsetSeconds": 0, "durationSeconds": 0.5,
                "playbackRate": 2.0, "gain": 1, "fade": { "microFadeSeconds": 0 } } }
        ]));

        let mapped = map_unbound_batch(&batch, &mut GraphRegistry::default(), &samples, 48_000.0)
            .expect("a composed rate should map");

        assert!(mapped.ops.iter().any(|op| matches!(
            op,
            GraphCommand::AddClip(_, clip) if clip.playback().playback_rate == 1.0
        )));
    }

    #[test]
    fn a_smoothed_write_and_an_unmappable_device_refuse_rather_than_degrade() {
        let smoothed = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "write-parameter",
              "target": { "kind": "track-fader", "trackId": "t1" },
              "write": { "shape": "smoothed", "value": 0.5, "time": 0, "timeConstantSeconds": 0.01 } }
        ]));
        let refusal = map_unbound_batch(
            &smoothed,
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect_err("a smoothed write must refuse");
        assert!(refusal.contains("smoothed-write-unsupported"));

        let alien_device = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [ { "id": "d1", "type": "dutch-oven", "bypassed": false, "parameterValues": {} } ],
              "honorMuted": true, "contributesAudio": true }
        ]));
        let refusal = map_unbound_batch(
            &alien_device,
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect_err("a contributing strip with an unbuildable device must refuse");
        assert!(refusal.contains("no native realisation"));
    }

    #[test]
    fn a_non_contributing_strip_degrades_an_unbuildable_device_and_reports_the_gap() {
        let batch = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [
                  { "id": "d1", "type": "dutch-oven", "bypassed": false, "parameterValues": {} },
                  { "id": "d2", "type": "knead", "bypassed": false, "parameterValues": {} }
              ],
              "honorMuted": true, "contributesAudio": false }
        ]));

        let mapped = map_unbound_batch(
            &batch,
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect("a non-contributing strip should build");

        // The report is an observation, not an echo of the request: the
        // degraded device is absent, the built one present.
        assert_eq!(mapped.reports[0].device_ids, vec!["d2".to_string()]);
    }

    /// A chain edit is never silent: `insert-device` and `remove-device`
    /// report the affected strip's realized chain after the whole batch. A
    /// degraded insert (unbuildable device, non-contributing strip) still
    /// produces the observation — the strip reports and the device is
    /// visibly absent — and a removal reports the chain without it.
    #[test]
    fn insert_and_remove_device_report_the_affected_strips_realized_chain() {
        let mut registry = GraphRegistry::default();
        map_unbound_batch(
            &batch(json!([
                { "kind": "create-track-strip", "trackId": "t1", "name": "T",
                  "state": strip_state(1.0),
                  "devices": [ { "id": "d-knead", "type": "knead", "bypassed": false,
                                 "parameterValues": {} } ],
                  "honorMuted": true, "contributesAudio": false }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("the creation batch maps");

        let degraded = map_unbound_batch(
            &batch(json!([
                { "kind": "insert-device", "trackId": "t1", "index": 0,
                  "device": { "id": "d-alien", "type": "dutch-oven", "bypassed": false,
                              "parameterValues": {} } }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("a degraded insert maps");
        assert_eq!(
            degraded.reports,
            vec![StripReportPayload {
                kind: "track",
                id: "t1".to_string(),
                device_ids: vec!["d-knead".to_string()],
            }],
            "the degraded insert must still produce the strip's observation"
        );

        // A built insert lands at its clamped index in the realized order.
        let inserted = map_unbound_batch(
            &batch(json!([
                { "kind": "insert-device", "trackId": "t1", "index": 0,
                  "device": { "id": "d-front", "type": "knead", "bypassed": false,
                              "parameterValues": {} } }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("a buildable insert maps");
        assert_eq!(
            inserted.reports[0].device_ids,
            vec!["d-front".to_string(), "d-knead".to_string()]
        );

        let removed = map_unbound_batch(
            &batch(json!([
                { "kind": "remove-device", "trackId": "t1", "deviceId": "d-knead" }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("the removal maps");
        assert_eq!(
            removed.reports,
            vec![StripReportPayload {
                kind: "track",
                id: "t1".to_string(),
                device_ids: vec!["d-front".to_string()],
            }]
        );
    }

    /// `remove-device` naming a device the registry no longer holds is this
    /// command's desired state, not a fault. Two producers race for the same
    /// chain entry — the live mirror's `remove-device` and the release
    /// `unload_plugin` performs before it retires an instance — so whichever
    /// arrives second finds it gone and must still apply, or an ordinary
    /// plugin delete refuses a whole batch. The strip is still reported,
    /// because the report is what the caller resyncs its chain from. An
    /// unknown strip and a device on a different strip stay refusals: neither
    /// is an already-satisfied removal.
    #[test]
    fn remove_device_is_satisfied_by_a_device_the_registry_no_longer_holds() {
        let mut registry = GraphRegistry::default();
        map_unbound_batch(
            &batch(json!([
                { "kind": "create-track-strip", "trackId": "t1", "name": "T",
                  "state": strip_state(1.0),
                  "devices": [ { "id": "d-front", "type": "knead", "bypassed": false,
                                 "parameterValues": {} } ],
                  "honorMuted": true, "contributesAudio": true },
                { "kind": "create-track-strip", "trackId": "t2", "name": "U",
                  "state": strip_state(1.0),
                  "devices": [ { "id": "d-other", "type": "knead", "bypassed": false,
                                 "parameterValues": {} } ],
                  "honorMuted": true, "contributesAudio": true }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("the creation batch maps");

        let absent = map_unbound_batch(
            &batch(json!([
                { "kind": "remove-device", "trackId": "t1", "deviceId": "d-already-gone" }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("a device the registry no longer holds is already removed");
        assert!(
            absent.ops.is_empty(),
            "there is no entry left to unlink, so the batch carries no op"
        );
        assert_eq!(
            absent.reports,
            vec![StripReportPayload {
                kind: "track",
                id: "t1".to_string(),
                device_ids: vec!["d-front".to_string()],
            }],
            "the strip still reports the chain the caller resyncs from"
        );

        let unknown_strip = map_unbound_batch(
            &batch(json!([
                { "kind": "remove-device", "trackId": "no-such-strip", "deviceId": "d-front" }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect_err("a strip this registry never built is still a refusal");
        assert!(
            unknown_strip.contains("unknown strip 'no-such-strip'"),
            "the refusal names the strip, got: {unknown_strip}"
        );

        let wrong_strip = map_unbound_batch(
            &batch(json!([
                { "kind": "remove-device", "trackId": "t1", "deviceId": "d-other" }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect_err("a device that exists on another strip is still a refusal");
        assert!(
            wrong_strip.contains("is not on strip 't1'"),
            "the refusal names the strip it was addressed to, got: {wrong_strip}"
        );
    }

    /// The release an unload owes before it retires an instance: every chain
    /// entry naming that engine plugin leaves the graph, on a track and on a
    /// bus alike, and the op is the released form rather than the retiring one
    /// — the retirement this precedes is `RemovePlugin`'s.
    #[test]
    fn releasing_an_engine_plugin_unlinks_its_chain_entry_from_its_strip() {
        let mut registry = GraphRegistry::default();
        map_batch(
            &batch(json!([
                { "kind": "create-track-strip", "trackId": "lead", "name": "Lead",
                  "state": strip_state(0.8),
                  "devices": [
                      { "id": "d-plugin", "name": "Pro-Q", "type": "plugin", "bypassed": false,
                        "parameterValues": {}, "externalPluginId": "com.fabfilter.proq",
                        "externalInstanceId": "inst-track" }
                  ],
                  "honorMuted": true, "contributesAudio": true },
                { "kind": "create-bus-strip", "busId": "verb", "name": "Verb",
                  "state": strip_state(1.0),
                  "devices": [
                      { "id": "d-bus-plugin", "name": "Room", "type": "plugin", "bypassed": false,
                        "parameterValues": {}, "externalPluginId": "com.valhalla.room",
                        "externalInstanceId": "inst-bus" }
                  ],
                  "honorMuted": true, "contributesAudio": true }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
            &HashMap::from([
                (
                    "inst-track".to_string(),
                    EngineOwnedDevice {
                        engine_plugin_id: 1_007,
                        chain_kind: DeviceKind::Effect,
                    },
                ),
                (
                    "inst-bus".to_string(),
                    EngineOwnedDevice {
                        engine_plugin_id: 1_009,
                        chain_kind: DeviceKind::Effect,
                    },
                ),
            ]),
        )
        .expect("both strips bind their attached instance");
        let bus_native_id = registry.strips["verb"].native_id;

        let track_release = registry.release_engine_plugin(1_007);
        assert!(
            matches!(
                track_release.ops.as_slice(),
                [GraphCommand::RemoveTrackDevice {
                    effect_id: 1_007,
                    ..
                }]
            ),
            "a track chain entry is released, never retired"
        );
        assert_eq!(
            track_release.touched_strip_ids,
            vec!["lead".to_string()],
            "the release must name the strip its chain entry left"
        );
        assert!(
            !registry.devices.contains_key("d-plugin"),
            "the registry no longer holds a device for the released instance"
        );
        assert_eq!(
            registry.strips["lead"].device_ids,
            Vec::<String>::new(),
            "the strip's chain no longer lists the released device"
        );

        let bus_release = registry.release_engine_plugin(1_009);
        assert!(
            matches!(
                bus_release.ops.as_slice(),
                [GraphCommand::RemoveBusDevice { bus_id, effect_id: 1_009 }] if *bus_id == bus_native_id
            ),
            "a bus chain entry is released through the bus op, on its own strip"
        );
        assert_eq!(
            registry.strips["verb"].device_ids,
            Vec::<String>::new(),
            "the bus chain no longer lists the released device"
        );

        assert!(
            registry.release_engine_plugin(1_007).ops.is_empty(),
            "a second release for the same instance has nothing left to unlink"
        );
    }

    /// The whole device budget the timeline admits is reachable through real
    /// batches: 128 track chains of 32 plus 64 bus chains of 32. The budget
    /// was once a flat 128 that four-devices-on-32-tracks exhausted, so the
    /// fill proves the product's own strip rules and the table's timeline term
    /// agree. One batch per strip, its mapped ops dropped: a knead device's
    /// instance is built per batch and freed with it, so the fill's peak is
    /// one strip's worth of engines, not the budget's.
    #[test]
    fn a_project_the_timeline_admits_fills_the_whole_device_budget() {
        let mut registry = GraphRegistry::default();
        let strip_batch = |track: bool, index: usize| {
            let strip = format!("{}{index}", if track { "t" } else { "b" });
            // Each arm states its own chain arithmetic: the budget is exact
            // only while the bus arm fills with MAX_BUS_DEVICES, not with the
            // track constant that happens to equal it today.
            let chain_length = if track {
                MAX_TRACK_DEVICES
            } else {
                MAX_BUS_DEVICES
            };
            let devices: Vec<Value> = (0..chain_length)
                .map(|device| {
                    json!({ "id": format!("d-{strip}-{device}"),
                            "type": "knead", "bypassed": false, "parameterValues": {} })
                })
                .collect();
            if track {
                batch(json!([{
                    "kind": "create-track-strip", "trackId": strip, "name": "T",
                    "state": strip_state(1.0), "devices": devices,
                    "honorMuted": true, "contributesAudio": true
                }]))
            } else {
                batch(json!([{
                    "kind": "create-bus-strip", "busId": strip, "name": "T",
                    "state": strip_state(1.0), "devices": devices,
                    "honorMuted": true, "contributesAudio": true
                }]))
            }
        };

        for track in 0..MAX_TIMELINE_TRACKS {
            map_unbound_batch(
                &strip_batch(true, track),
                &mut registry,
                &sample_pool(),
                48_000.0,
            )
            .expect("a track strip inside the timeline's limits must map");
        }
        for bus in 0..MAX_TIMELINE_BUSES {
            map_unbound_batch(
                &strip_batch(false, bus),
                &mut registry,
                &sample_pool(),
                48_000.0,
            )
            .expect("a bus strip inside the timeline's limits must map");
        }
        assert_eq!(registry.devices.len(), TIMELINE_CHAIN_SLOT_BUDGET);

        // Every strip is full and both strip counts are at their limits, so a
        // further strip is refused by the strip admission rules — the ceiling
        // a user actually reaches, named in its own terms.
        let mut working = registry.clone();
        let refusal = map_unbound_batch(
            &batch(json!([{
                "kind": "create-track-strip", "trackId": "t-overflow", "name": "T",
                "state": strip_state(1.0),
                "devices": [ { "id": "d-overflow", "type": "knead", "bypassed": false,
                               "parameterValues": {} } ],
                "honorMuted": true, "contributesAudio": true
            }])),
            &mut working,
            &sample_pool(),
            48_000.0,
        )
        .expect_err("a strip past the timeline's strip limits must refuse the batch");
        assert!(
            refusal.contains(&MAX_TIMELINE_TRACKS.to_string()) && refusal.contains("tracks"),
            "the refusal must name the strip ceiling it hit, got: {refusal}"
        );
        assert_eq!(registry.devices.len(), TIMELINE_CHAIN_SLOT_BUDGET);
    }

    /// Every native device the project holds — on any track or bus — occupies
    /// one slot of the scheduler's fixed effect table, whose timeline term is
    /// the strip rules' own chain-slot budget. The project-wide bound in
    /// `map_device` is a belt over those per-strip caps: while they hold it is
    /// unreachable, so the registry here is filled to the budget the way a
    /// strip-cap regression would, against a strip that still has chain room —
    /// only the project-wide bound is left to catch this. The engine's own
    /// refusal cannot stand in for it: it is a counter on the audio callback,
    /// so the chain splice that follows would land with no instance behind it
    /// and the batch would report a device the user cannot hear.
    #[test]
    fn a_device_past_the_project_wide_device_ceiling_refuses_the_batch() {
        let mut registry = GraphRegistry::default();
        map_unbound_batch(
            &batch(json!([{
                "kind": "create-track-strip", "trackId": "t1", "name": "T",
                "state": strip_state(1.0),
                "devices": [ { "id": "d-live", "type": "knead", "bypassed": false,
                               "parameterValues": {} } ],
                "honorMuted": true, "contributesAudio": true
            }])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("a strip with chain room must map");
        // Synthetic fill to the budget, as if the per-strip caps had admitted
        // more than the budget holds.
        while registry.devices.len() < TIMELINE_CHAIN_SLOT_BUDGET {
            let index = registry.devices.len();
            registry.devices.insert(
                format!("d-fill-{index}"),
                DeviceEntry {
                    native_effect_id: FIRST_GRAPH_EFFECT_ID + index,
                    strip_id: "t1".to_string(),
                    builtin: Some(BuiltinEffectType::Knead),
                },
            );
        }

        let overflow = batch(json!([
            { "kind": "insert-device", "trackId": "t1", "index": 1,
              "device": { "id": "d-overflow", "type": "knead", "bypassed": false,
                          "parameterValues": {} } }
        ]));
        let mut working = registry.clone();
        let refusal = map_unbound_batch(&overflow, &mut working, &sample_pool(), 48_000.0)
            .expect_err("a device past the project-wide ceiling must refuse the batch");

        assert!(
            refusal.contains(&TIMELINE_CHAIN_SLOT_BUDGET.to_string())
                && refusal.contains("native devices"),
            "the refusal must name the ceiling it hit, got: {refusal}"
        );
    }

    #[test]
    fn an_offline_render_is_deterministic_and_a_clip_through_a_fader_is_audible() {
        let samples = sample_pool();

        let first = render_offline_batch(&clip_and_gain_batch(), &samples, 4_800, 48_000.0)
            .expect("the render should succeed");
        let second = render_offline_batch(&clip_and_gain_batch(), &samples, 4_800, 48_000.0)
            .expect("the render should succeed");

        assert_eq!(first, second, "same batch, same frames, same bits");
        assert!(first.iter().any(|sample| *sample != 0.0));
        // 0.5 material through the 0.5 fader the strip state asked for.
        assert_eq!(first[0], 0.25);
        assert_eq!(first[1], 0.25);
    }

    #[test]
    fn a_refused_offline_batch_renders_nothing() {
        let samples = sample_pool();
        let refused = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(0.5),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "schedule-clip", "playback": {
                "trackId": "t1", "source": { "sourceId": "source-a" },
                "startTime": 0, "sourceOffsetSeconds": 0, "durationSeconds": 0.1,
                "playbackRate": 1, "gain": 1, "fade": { "microFadeSeconds": 0 } } },
            { "kind": "set-track-output", "trackId": "missing", "target": { "kind": "master" } }
        ]));

        let refusal = render_offline_batch(&refused, &samples, 4_800, 48_000.0)
            .expect_err("the whole batch must refuse before any application");
        assert!(refusal.contains("commands[2]"));

        // And the refusal really did precede application: a fresh render of
        // an empty batch over the same pool is silence, bit for bit.
        let silence = render_offline_batch(&batch(json!([])), &samples, 4_800, 48_000.0)
            .expect("an empty batch renders");
        assert!(silence.iter().all(|sample| *sample == 0.0));
    }

    fn pan_step(track: &str, value: f64, time: f64) -> Value {
        json!({ "kind": "write-parameter",
                "target": { "kind": "track-pan", "trackId": track },
                "write": { "shape": "step", "value": value, "time": time } })
    }

    fn track_strip(track: &str) -> Value {
        json!({ "kind": "create-track-strip", "trackId": track, "name": "T",
                "state": strip_state(1.0), "devices": [],
                "honorMuted": true, "contributesAudio": true })
    }

    /// The RT-side automation queue holds eight pending writes per parameter
    /// and drops the ninth with only a counter. The batch must refuse whole
    /// instead: a ninth step on one parameter names the batch unrenderable.
    #[test]
    fn a_batch_with_nine_step_writes_on_one_parameter_refuses_whole() {
        let mut commands = vec![track_strip("t1")];
        for index in 0..=AUTOMATION_QUEUE_CAPACITY {
            commands.push(pan_step("t1", 0.1, 1.0 + index as f64));
        }
        let refusal = map_unbound_batch(
            &batch(Value::Array(commands)),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect_err("the ninth pending write on one parameter must refuse the batch");

        assert!(
            refusal.contains("automation-queue-capacity"),
            "the refusal must name the queue, got: {refusal}"
        );
        // The command past the capacity is the one named — creation is
        // commands[0], the writes follow.
        assert!(refusal.contains(&format!("commands[{}]", AUTOMATION_QUEUE_CAPACITY + 1)));
    }

    #[test]
    fn a_batch_filling_one_parameters_queue_exactly_maps() {
        let mut commands = vec![track_strip("t1")];
        for index in 0..AUTOMATION_QUEUE_CAPACITY {
            commands.push(pan_step("t1", 0.1, 1.0 + index as f64));
        }

        map_unbound_batch(
            &batch(Value::Array(commands)),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect("exactly the queue's capacity must map");
    }

    /// The ledger is per parameter, not per batch: full queues on two strips,
    /// on two parameters of one strip, and on a device queue beside them must
    /// not pool into one count — and the write past the device window must
    /// refuse on its own queue's law.
    #[test]
    fn queue_budgets_do_not_conflate_distinct_parameters_strips_or_devices() {
        let mut commands = vec![
            track_strip("t1"),
            track_strip("t2"),
            json!({ "kind": "insert-device", "trackId": "t1", "index": 0,
                    "device": { "id": "d1", "type": "knead", "bypassed": false,
                                "parameterValues": {} } }),
        ];
        for index in 0..AUTOMATION_QUEUE_CAPACITY {
            let time = 1.0 + index as f64;
            commands.push(pan_step("t1", 0.1, time));
            commands.push(pan_step("t2", 0.1, time));
            // The fader carries the creation write (a replace holding one
            // slot), so capacity minus one steps still fit.
            if index + 1 < AUTOMATION_QUEUE_CAPACITY {
                commands.push(json!({ "kind": "write-parameter",
                    "target": { "kind": "track-fader", "trackId": "t1" },
                    "write": { "shape": "step", "value": 0.5, "time": time } }));
            }
        }
        for index in 0..DEVICE_PARAM_QUEUE_CAPACITY {
            commands.push(json!({ "kind": "write-device-parameter",
                "target": { "kind": "device-parameter", "trackId": "t1", "deviceId": "d1",
                            "parameterId": "shift_semitones" },
                "write": { "shape": "step", "value": 1.0, "time": 1.0 + index as f64 } }));
        }

        map_unbound_batch(
            &batch(Value::Array(commands.clone())),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect("full-but-not-overflowing queues on distinct targets must map");

        commands.push(json!({ "kind": "write-device-parameter",
            "target": { "kind": "device-parameter", "trackId": "t1", "deviceId": "d1",
                        "parameterId": "shift_semitones" },
            "write": { "shape": "step", "value": 1.0, "time": 99.0 } }));
        let refusal = map_unbound_batch(
            &batch(Value::Array(commands)),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect_err("the pending device write past the window must refuse the batch");
        assert!(refusal.contains("device-param-queue-capacity"));
    }

    /// The queue ledger survives the batch: what one accepted batch leaves
    /// queued on a parameter counts against the next batch's budget — the
    /// engine's queue is one queue, however many batches filled it — and a
    /// locate releases exactly what the engine's own seek law drops.
    #[test]
    fn the_queue_ledger_carries_across_batches_and_a_locate_releases_it() {
        let mut registry = GraphRegistry::default();
        let mut fill = vec![track_strip("t1")];
        for index in 0..AUTOMATION_QUEUE_CAPACITY {
            fill.push(pan_step("t1", 0.1, 1.0 + index as f64));
        }
        map_unbound_batch(
            &batch(Value::Array(fill)),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("filling the queue in one batch maps");

        // The next batch sees the queue the last one filled — modelled
        // against an empty engine it would map, and the engine would drop it
        // render-side with only a counter.
        let mut working = registry.clone();
        let refusal = map_unbound_batch(
            &batch(json!([pan_step("t1", 0.2, 99.0)])),
            &mut working,
            &sample_pool(),
            48_000.0,
        )
        .expect_err("the ninth cross-batch write on one parameter must refuse");
        assert!(
            refusal.contains("automation-queue-capacity"),
            "the refusal must name the queue, got: {refusal}"
        );

        // A locate drops every queued write stamped at or past its target
        // (`RampedParam::cancel_from`); the ledger mirrors it, so the write
        // behind the locate fits again.
        map_unbound_batch(
            &batch(json!([
                { "kind": "set-transport", "playing": true, "positionSeconds": 0.0 },
                pan_step("t1", 0.2, 1.0)
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("the locate releases the ledger for the write behind it");
    }

    fn knead_insert(track: &str, device: &str) -> Value {
        json!({ "kind": "insert-device", "trackId": track, "index": 0,
                "device": { "id": device, "type": "knead", "bypassed": false,
                            "parameterValues": {} } })
    }

    fn device_step(track: &str, device: &str, value: f64, time: f64) -> Value {
        json!({ "kind": "write-device-parameter",
                "target": { "kind": "device-parameter", "trackId": track, "deviceId": device,
                            "parameterId": "shift_semitones" },
                "write": { "shape": "step", "value": value, "time": time } })
    }

    /// Push one mapped batch behind a fence, exactly as
    /// `EngineHandle::send_graph_batch` publishes the live ones — the fence
    /// is what the drain counts, so the ledger's batch numbers only line up
    /// when the test fences too.
    fn send_mapped(renderer: &mut OfflineRenderer, ops: Vec<GraphCommand>) {
        renderer
            .push(GraphCommand::BeginBatch {
                commands: ops.len(),
            })
            .expect("the fence fits");
        for op in ops {
            renderer.push(op).expect("the batch fits");
        }
    }

    /// The full admission cycle of one live batch, driven synchronously:
    /// release what the echo proves landed, map against a working clone,
    /// send behind a fence, commit the clone.
    fn admit_and_send(
        registry: &mut GraphRegistry,
        renderer: &mut OfflineRenderer,
        commands: Value,
        samples: &TimelineSamplePool,
    ) -> Result<(), String> {
        registry.release_landed(renderer.graph_progress());
        let mut working = registry.clone();
        let mapped = map_unbound_batch(&batch(commands), &mut working, samples, 48_000.0)?;
        send_mapped(renderer, mapped.ops);
        *registry = working;
        Ok(())
    }

    /// Debt 1+2's discriminating case: more sequential single-write batches
    /// than either fixed queue holds, against one device parameter and one
    /// automation parameter, with the engine draining between batches. Every
    /// batch admits, because the progress echo releases what landed — under
    /// the old monotonic ledger the first device write past the window refused
    /// for the life of the session.
    #[test]
    fn landed_writes_release_the_ledger_for_later_batches() {
        let samples = sample_pool();
        let mut registry = GraphRegistry::default();
        let mut renderer = OfflineRenderer::new(48_000.0, 64);

        admit_and_send(
            &mut registry,
            &mut renderer,
            json!([
                track_strip("t1"),
                knead_insert("t1", "d1"),
                { "kind": "set-transport", "playing": true, "positionSeconds": 0.0 },
            ]),
            &samples,
        )
        .expect("the setup batch maps");
        renderer.render(512);

        for round in 0..=(DEVICE_PARAM_QUEUE_CAPACITY + AUTOMATION_QUEUE_CAPACITY) {
            admit_and_send(
                &mut registry,
                &mut renderer,
                json!([
                    device_step("t1", "d1", round as f64, 0.0),
                    pan_step("t1", 0.1, 0.0),
                ]),
                &samples,
            )
            .unwrap_or_else(|reason| {
                panic!("write round {round} must admit once earlier writes landed: {reason}")
            });
            renderer.render(512);
        }

        // Everything sent has landed and the last echo covers it: the ledger
        // drains to empty, not merely below capacity.
        registry.release_landed(renderer.graph_progress());
        assert!(registry.device_param_pending.is_empty());
        assert!(registry.automation_pending.is_empty());
    }

    /// The release law's other half: the ledger subtracts nothing the echo
    /// has not proven. A stale echo (taken before the writes rendered)
    /// releases nothing and the next write refuses; the fresh echo then
    /// frees the window. A landed batch whose stamp is still ahead of the
    /// playhead stays charged too — both halves of the proof are required.
    #[test]
    fn the_ledger_never_releases_ahead_of_the_echo() {
        let samples = sample_pool();
        let mut registry = GraphRegistry::default();
        // The largest batch this test sends is a full device-parameter window
        // behind its batch fence, and `OfflineRenderer::render` drains the ring
        // before that batch is pushed — so the strip setup ahead of it has
        // already left. A literal would silently cap the batch the moment the
        // window grows, and the test would then fail on the ring rather than on
        // the ledger it is about.
        let mut renderer = OfflineRenderer::new(48_000.0, DEVICE_PARAM_QUEUE_CAPACITY + 1);

        admit_and_send(
            &mut registry,
            &mut renderer,
            json!([
                track_strip("t1"),
                knead_insert("t1", "d1"),
                { "kind": "set-transport", "playing": true, "positionSeconds": 0.0 },
            ]),
            &samples,
        )
        .expect("the setup batch maps");
        renderer.render(512);
        // The echo the fill batch will lag behind: batch 1 applied, one
        // block rendered.
        let stale = renderer.graph_progress();

        let fill: Vec<Value> = (0..DEVICE_PARAM_QUEUE_CAPACITY)
            .map(|index| device_step("t1", "d1", index as f64, 0.0))
            .collect();
        admit_and_send(&mut registry, &mut renderer, Value::Array(fill), &samples)
            .expect("filling the window exactly maps");

        // The fill batch is sent but its echo has not arrived: releasing
        // against the stale snapshot must free nothing — its stamps sit at
        // frame 0, behind the stale playhead, so only the batch horizon
        // stands between this ledger and an under-refusal.
        registry.release_landed(stale);
        let mut working = registry.clone();
        let refusal = map_unbound_batch(
            &batch(json!([device_step("t1", "d1", 9.0, 0.0)])),
            &mut working,
            &samples,
            48_000.0,
        )
        .expect_err("a write past the unproven window must refuse");
        assert!(refusal.contains("device-param-queue-capacity"));

        // The engine drains the fill; the fresh echo proves it landed.
        renderer.render(512);
        admit_and_send(
            &mut registry,
            &mut renderer,
            json!([device_step("t1", "d1", 9.0, 0.0)]),
            &samples,
        )
        .expect("the write admits once the echo proves the window landed");
        renderer.render(512);

        // A write stamped ahead of the playhead is applied but not landed:
        // its batch is behind the echoed horizon, its stamp is not, so it
        // stays charged.
        admit_and_send(
            &mut registry,
            &mut renderer,
            json!([device_step("t1", "d1", 10.0, 100.0)]),
            &samples,
        )
        .expect("a future-stamped write admits into a freed window");
        renderer.render(512);
        registry.release_landed(renderer.graph_progress());
        let pending: usize = registry.device_param_pending.values().map(Vec::len).sum();
        assert_eq!(
            pending, 1,
            "the unreached future stamp must stay charged after every landed one released"
        );
    }

    /// The release proof's boundary, pinned on the frame it turns on. Both
    /// other ledger tests stamp far from the playhead, so the `<` in
    /// [`GraphRegistry::release_landed`] could be `<=` and go unnoticed — and
    /// `<=` under-releases by exactly one block: a write stamped at the echoed
    /// playhead is due in the block that has not run yet, so it still occupies
    /// its engine slot, and freeing its ledger slot would let a later batch
    /// overflow the queue the engine drops render-side with only a counter.
    #[test]
    fn a_stamp_at_the_echoed_playhead_stays_charged_until_the_next_block() {
        const BLOCK: u64 = 512;
        let samples = sample_pool();
        let mut registry = GraphRegistry::default();
        let mut renderer = OfflineRenderer::new(48_000.0, 64);

        admit_and_send(
            &mut registry,
            &mut renderer,
            json!([
                track_strip("t1"),
                knead_insert("t1", "d1"),
                { "kind": "set-transport", "playing": true, "positionSeconds": 0.0 },
            ]),
            &samples,
        )
        .expect("the setup batch maps");
        renderer.render(BLOCK as usize);

        // Stamped at the frame the *next* render will leave the playhead on,
        // so the echo that proves this batch applied echoes a playhead equal
        // to the stamp — the one frame the two predicates disagree about.
        let boundary = BLOCK * 2;
        admit_and_send(
            &mut registry,
            &mut renderer,
            json!([device_step("t1", "d1", 1.0, boundary as f64 / 48_000.0)]),
            &samples,
        )
        .expect("the boundary write admits");
        renderer.render(BLOCK as usize);

        let progress = renderer.graph_progress();
        assert_eq!(
            progress.playhead_frame, boundary,
            "the echo must land exactly on the stamp for this test to discriminate"
        );
        registry.release_landed(progress);
        let charged: usize = registry.device_param_pending.values().map(Vec::len).sum();
        assert_eq!(
            charged, 1,
            "a stamp at the echoed playhead is due in the block that has not run: it stays charged"
        );

        // One more block carries the playhead past the stamp — the engine pops
        // it, and only now may the ledger.
        renderer.render(BLOCK as usize);
        registry.release_landed(renderer.graph_progress());
        assert!(
            registry.device_param_pending.is_empty(),
            "the stamp releases once the echoed playhead is strictly past it"
        );
    }

    /// A loop region two render blocks long, so a pass is exactly two blocks
    /// and its seam falls on a block boundary.
    const LOOP_END_FRAME: u64 = 1_024;

    /// Install the region as a loose command, the way `engine_transport_set_maps`
    /// does: the loop is not part of a graph batch, so it must not advance the
    /// fence horizon the ledger numbers against.
    fn install_loop(renderer: &mut OfflineRenderer) {
        renderer
            .push(GraphCommand::SetLoopRegion(
                daw_engine::transport_map::LoopRegion {
                    enabled: true,
                    start_frame: 0,
                    end_frame: LOOP_END_FRAME,
                },
            ))
            .expect("the loose loop command fits");
    }

    /// The release proof's loop half. A stamp inside the loop region is
    /// consumed on every pass, but the echoed playhead is pinned below the
    /// region's end forever, so the playhead proof alone charges that stamp for
    /// the life of the session — the starvation that makes a looping session's
    /// parameter edits refuse. The seam proves what the playhead cannot, and
    /// only a *whole* pass does: one seam after the stamp is known queued ends
    /// the pass it arrived in, which says nothing about a stamp the playhead
    /// was already past.
    ///
    /// Both of the proof's bounds are strict, and the region's own end is where
    /// that matters: the closing pass walks *to* `last_wrap_frame` without
    /// rendering it, so a stamp sitting exactly there is one the engine has
    /// never popped and never will while the region holds. It stays charged
    /// forever, and that is the correct answer — the ledger over-refuses rather
    /// than freeing a slot the engine still owes.
    #[test]
    fn a_stamp_a_whole_loop_pass_walked_past_releases_on_the_seam() {
        const STAMP: u64 = 768;
        let samples = sample_pool();
        let mut registry = GraphRegistry::default();
        let mut renderer = OfflineRenderer::new(48_000.0, 64);
        install_loop(&mut renderer);

        admit_and_send(
            &mut registry,
            &mut renderer,
            json!([
                track_strip("t1"),
                { "kind": "set-transport", "playing": true, "positionSeconds": 0.0 },
            ]),
            &samples,
        )
        .expect("the setup batch maps");
        renderer.render(512);

        admit_and_send(
            &mut registry,
            &mut renderer,
            json!([
                pan_step("t1", 0.1, STAMP as f64 / 48_000.0),
                pan_step("t1", 0.2, LOOP_END_FRAME as f64 / 48_000.0),
            ]),
            &samples,
        )
        .expect("the writes admit");

        // The block that drains it is the one that closes the seam, so the
        // engine walks past the stamp and reports a playhead below it.
        renderer.render(512);
        let closed = renderer.graph_progress();
        assert_eq!(closed.loop_wraps, 1);
        assert!(
            closed.playhead_frame < STAMP,
            "the pinned playhead is what makes this stamp unprovable without the seam"
        );

        let charged = |registry: &GraphRegistry| -> usize {
            registry.automation_pending.values().map(Vec::len).sum()
        };

        registry.release_landed(closed);
        assert_eq!(
            charged(&registry),
            2,
            "the first echo proving the batch drained only anchors the seam count"
        );

        renderer.render(LOOP_END_FRAME as usize);
        assert_eq!(renderer.graph_progress().loop_wraps, 2);
        registry.release_landed(renderer.graph_progress());
        assert_eq!(
            charged(&registry),
            2,
            "one seam after the anchor only ends the pass the stamp arrived in"
        );

        renderer.render(LOOP_END_FRAME as usize);
        let walked = renderer.graph_progress();
        assert_eq!(walked.loop_wraps, 3);
        assert_eq!(
            walked.last_wrap_frame, LOOP_END_FRAME,
            "the pass walked to the region's end, so a stamp there is the boundary case"
        );
        registry.release_landed(walked);
        let left: Vec<u64> = registry
            .automation_pending
            .values()
            .flatten()
            .map(|stamp| stamp.at_frame)
            .collect();
        assert_eq!(
            left,
            vec![LOOP_END_FRAME],
            "a whole pass ran with both stamps queued, but it only popped the one below its walk"
        );
    }

    /// The number a batch reports is the number its own writes were charged
    /// against, and it counts *every* fence this process publishes — including
    /// the transport maps install, which sends its own batch from
    /// `commands::engine_transport` rather than through `map_batch`. A caller
    /// compares it against the engine's `batches_applied`, which numbers
    /// fences without caring who sent them, so a fence this counter skipped
    /// would leave every later batch numbered below the count it is held
    /// against.
    #[test]
    fn a_batchs_reported_number_is_the_one_its_writes_were_charged_against() {
        let samples = sample_pool();
        let mut registry = GraphRegistry::default();
        let mut renderer = OfflineRenderer::new(48_000.0, 64);

        admit_and_send(
            &mut registry,
            &mut renderer,
            json!([
                track_strip("t1"),
                { "kind": "set-transport", "playing": true, "positionSeconds": 0.0 },
            ]),
            &samples,
        )
        .expect("the setup batch maps");
        assert_eq!(registry.batches_sent, 1);

        // The maps install's fence, published outside `map_batch`.
        let maps_batch = registry.record_fenced_batch();
        assert_eq!(maps_batch, 2);

        admit_and_send(
            &mut registry,
            &mut renderer,
            json!([pan_step("t1", 0.1, 1.0)]),
            &samples,
        )
        .expect("the write admits");

        assert_eq!(
            registry.batches_sent, 3,
            "the write's batch is numbered after the maps fence, not over it"
        );
        let charged: Vec<u64> = registry
            .automation_pending
            .values()
            .flatten()
            .map(|stamp| stamp.admitted_batch)
            .collect();
        assert_eq!(
            charged,
            vec![registry.batches_sent],
            "the reported number and the ledger's stamps are one number"
        );
    }

    /// How many fences a drain would meet on this ring, leaving it empty for
    /// the next batch. `GraphCommand` carries no `Debug`, so the ring is
    /// counted rather than printed.
    fn drain_counting_fences(commands: &mut rtrb::Consumer<GraphCommand>) -> usize {
        let mut fences = 0;
        while let Ok(command) = commands.pop() {
            if matches!(command, GraphCommand::BeginBatch { .. }) {
                fences += 1;
            }
        }
        fences
    }

    /// The number an applied batch reports is the fence it actually published
    /// on the engine's ring, taken from the ledger that stamped its writes.
    /// The three have to be one number: the caller holds the report against the
    /// engine's `batches_applied`, which counts drained fences, and releases
    /// the ledger's stamps by the same count. A report drawn from anywhere else
    /// — the revision, the previous count — would let a poll taken before this
    /// batch drained pass for one taken after it, which is exactly the reading
    /// the live automation writer refuses to act on.
    #[test]
    fn an_applied_batch_reports_the_fence_it_published() {
        let state = AppState::default();
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        // Filling the slot first is what makes this a capture engine: the
        // lazy bootstrap in `apply_graph_commands` starts one only into an
        // empty slot, so it reuses this handle rather than opening a device.
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let first = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": [track_strip("t1"), pan_step("t1", 0.1, 1.0)] }),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");
        assert_eq!(first["application"], "applied");
        let reported = first["admittedBatch"]
            .as_u64()
            .expect("an applied batch names the fence it published");
        assert_eq!(
            drain_counting_fences(&mut command_rx),
            1,
            "one fence reached the engine, and the report is about that fence"
        );

        {
            let registry = state.graph.lock().expect("the registry is readable");
            assert_eq!(
                reported, registry.batches_sent,
                "the reported number is the ledger's own count of fences sent"
            );
            let charged: Vec<u64> = registry
                .automation_pending
                .values()
                .flatten()
                .map(|stamp| stamp.admitted_batch)
                .collect();
            assert!(
                !charged.is_empty(),
                "the batch carried writes, so the ledger holds stamps for them"
            );
            assert_eq!(
                charged,
                vec![reported; charged.len()],
                "every write is released against the number the caller was told"
            );
        }

        let second = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": [pan_step("t1", 0.2, 2.0)] }),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the second batch resolves to a result");
        assert_eq!(second["application"], "applied");
        assert_eq!(
            second["admittedBatch"].as_u64(),
            Some(reported + 1),
            "each applied batch reports the next fence, never the one before it"
        );
        assert_eq!(drain_counting_fences(&mut command_rx), 1);
    }

    /// Issue #2265: the engine starts here, on the first batch, so this is the
    /// only moment an instance created before it ran can take its slot. The
    /// batch that starts the engine attaches it — the panel's sampler becomes
    /// audible and recordable on the first play rather than staying dead for
    /// the session — and the batch's own application is unaffected.
    #[test]
    fn the_first_batch_attaches_dormant_crumbs() {
        use crate::host::native_bridge::CrumbsPluginSlot;

        let state = AppState::default();
        let crumbs = CrumbsState::default();
        block_on_test(crumbs::create_crumbs(
            "before-first-play".to_string(),
            &crumbs,
            &state,
        ))
        .expect("a create before the engine runs holds a dormant instance");

        // Filling the slot first is what makes this a capture engine, exactly
        // as the lazy bootstrap's own tests do: the batch reuses this handle
        // rather than opening a device.
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let result = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": [track_strip("t1")] }),
            &state,
            &crumbs,
        ))
        .expect("the batch resolves to a result");
        assert_eq!(
            result["application"], "applied",
            "attaching the sampler is not the batch's business to fail over"
        );

        let mut crumbs_slots = 0;
        while let Ok(command) = command_rx.pop() {
            if let GraphCommand::AddPlugin(_, plugin, Some(_)) = command {
                if plugin.as_any().downcast_ref::<CrumbsPluginSlot>().is_some() {
                    crumbs_slots += 1;
                }
            }
        }
        assert_eq!(
            crumbs_slots, 1,
            "the batch that started the engine published the dormant instance's slot onto it"
        );
    }

    /// Issue #3807 (regression): the attach that installs a dormant crumbs
    /// slot publishes its own fence, ahead of the batch that triggered it in
    /// the same call — the two fences land on the ring attach-first, batch
    /// second. The batch's own fence must therefore be numbered one past the
    /// attach's, not on top of it. Before the fix, the attach never called
    /// `record_fenced_batch`, so this batch's fence collided with the
    /// attach's un-numbered one and reported 1 instead of 2.
    #[test]
    fn a_crumbs_attach_fence_counts_toward_the_batch_it_precedes() {
        let state = AppState::default();
        let crumbs = CrumbsState::default();
        block_on_test(crumbs::create_crumbs(
            "before-first-play-fence-count".to_string(),
            &crumbs,
            &state,
        ))
        .expect("a create before the engine runs holds a dormant instance");

        // Filling the slot first is what makes this a capture engine, exactly
        // as the lazy bootstrap's own tests do: the batch reuses this handle
        // rather than opening a device.
        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let result = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": [track_strip("t1")] }),
            &state,
            &crumbs,
        ))
        .expect("the batch resolves to a result");

        assert_eq!(
            result["admittedBatch"].as_u64(),
            Some(2),
            "the dormant crumbs attach fences the ring once before this batch's own fence"
        );
        assert_eq!(
            state
                .graph
                .lock()
                .expect("the registry is readable")
                .fenced_batches(),
            2,
            "the registry's own counter must agree with the reported fence"
        );
    }

    /// A dormant hosted-plugin record, parked exactly as a load with no engine
    /// parks one.
    ///
    /// The instance id has to be unique across the tests that call this: the
    /// per-instance lifecycle gates are process-global, keyed by id, and two
    /// tests sharing one id contend for the same gate however separate their
    /// `AppState`s are.
    fn park_dormant_plugin(state: &AppState, instance_id: &str) {
        state.plugins.lock().expect("plugins lock").insert(
            instance_id.to_string(),
            crate::state::PluginInstanceData::dormant_fixture(
                daw_plugin_host::ClapWrapper::new_engine_owned_command_fixture(
                    "Dormant Fixture",
                    vec![],
                    false,
                )
                .into(),
            ),
        );
    }

    /// A dormant record whose runtime never activated — a plugin whose
    /// `activate` failed at load, parked all the same.
    ///
    /// Its refusal lands *inside* the registration, past the ergonomic ceiling
    /// check and past the removal from the command-owned store, which is the
    /// only route to the re-parking branch.
    fn park_unactivated_dormant_plugin(state: &AppState, instance_id: &str) {
        let mut wrapper = daw_plugin_host::ClapWrapper::new_engine_owned_command_fixture(
            "Unactivated Fixture",
            vec![],
            false,
        );
        wrapper.deactivate_engine_owned_command_fixture();
        state.plugins.lock().expect("plugins lock").insert(
            instance_id.to_string(),
            crate::state::PluginInstanceData::dormant_fixture(wrapper.into()),
        );
    }

    /// Leave the session with no room for another engine-owned instance, so the
    /// next attach is refused by the session ceiling rather than by anything
    /// about the instance itself.
    fn fill_hosted_plugin_reserve(state: &AppState) {
        let mut engine_plugins = state.engine_plugins.lock().expect("engine_plugins lock");
        for slot in 0..daw_engine::scheduler::HOSTED_PLUGIN_RESERVE {
            let runtime: daw_plugin_host::HostedRuntime =
                daw_plugin_host::ClapWrapper::new_engine_owned_command_fixture(
                    "Filler",
                    vec![],
                    false,
                )
                .into();
            let parameter_events = daw_plugin_host::AudioPlugin::parameter_event_queue(&runtime);
            engine_plugins.insert(
                format!("filler-{slot}"),
                crate::state::EnginePluginInstanceData {
                    engine_plugin_id: slot,
                    runtime: std::sync::Arc::new(
                        crate::host::native_bridge::SharedHostedPlugin::new(runtime),
                    ),
                    name: "Filler".to_string(),
                    parameters: Vec::new(),
                    has_gui: false,
                    chain_kind: DeviceKind::Effect,
                    parameter_events,
                },
            );
        }
    }

    /// The same moment as the crumbs slot above, for a hosted plugin. A plugin
    /// loaded before the first Play is parked command-side with no engine
    /// plugin id, and nothing used to move it out again: the relay answered
    /// "No engine plugin for instance" for the rest of the session and the
    /// device passed silence. The caller is told, because its own load reported
    /// no engine and no later event corrects that.
    #[test]
    fn the_first_batch_attaches_dormant_plugins_and_reports_them() {
        let state = AppState::default();
        park_dormant_plugin(&state, "attached-on-first-play");

        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let result = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": [track_strip("t1")] }),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");

        assert_eq!(
            result["application"], "applied",
            "attaching the plugin is not the batch's business to fail over"
        );
        assert!(
            state.plugins.lock().expect("plugins lock").is_empty(),
            "an attached instance leaves the command-owned store"
        );
        assert!(
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .contains_key("attached-on-first-play"),
            "the batch that started the engine handed it the dormant instance"
        );
        let attached = result["attachedPlugins"]
            .as_array()
            .expect("an applied batch always carries the list");
        assert_eq!(attached.len(), 1, "got: {attached:?}");
        assert_eq!(attached[0]["instanceId"], "attached-on-first-play");
        assert_eq!(
            attached[0].as_object().expect("an object").len(),
            1,
            "the instance id is the whole payload: {:?}",
            attached[0]
        );
    }

    /// The lag the binding lookup is read with, made visible.
    ///
    /// A plugin loaded before the first Play is attached by that batch, but the
    /// attach runs *after* the fence — only an applied payload can report one —
    /// so the lookup this batch mapped against did not hold the instance yet and
    /// its device degrades. The next batch binds it. This is the whole of the
    /// cost, and the producer resends its topology on every play, so a device
    /// that missed here is spliced one play later rather than never.
    #[test]
    fn a_plugin_attached_by_a_batch_binds_on_the_next_one() {
        let state = AppState::default();
        park_dormant_plugin(&state, "bound-on-the-second-batch");

        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        // A silent strip, so the unbound first batch degrades the device rather
        // than refusing the batch that is about to attach the instance.
        let topology = || {
            json!({ "schemaVersion": 1, "replaceTopology": true, "commands": [{
                "kind": "create-track-strip",
                "trackId": "lead",
                "name": "Lead",
                "state": strip_state(1.0),
                "devices": [
                    { "id": "d-plugin", "name": "Pro-Q", "type": "plugin", "bypassed": false,
                      "parameterValues": {},
                      "externalPluginId": "com.fabfilter.proq",
                      "externalInstanceId": "bound-on-the-second-batch" }
                ],
                "honorMuted": true,
                "contributesAudio": false
            }] })
        };

        let first = block_on_test(apply_graph_commands(
            topology(),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");
        assert_eq!(first["application"], "applied");
        assert_eq!(
            first["reports"][0]["deviceIds"],
            json!([]),
            "the instance was not engine-owned yet when this batch was mapped"
        );
        assert_eq!(
            first["attachedPlugins"][0]["instanceId"], "bound-on-the-second-batch",
            "and this is the batch that attached it"
        );

        let second = block_on_test(apply_graph_commands(
            topology(),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the second batch resolves to a result");
        assert_eq!(second["application"], "applied");
        assert_eq!(
            second["reports"][0]["deviceIds"],
            json!(["d-plugin"]),
            "the next batch reads the instance and splices it into the chain"
        );
    }

    /// A refusal is the instance's to carry, never the batch's. The instance
    /// stays dormant with its runtime intact — the next batch tries again — and
    /// the caller is told that nothing was attached rather than told a plugin
    /// is processing audio when it is not.
    #[test]
    fn a_refused_attach_leaves_the_instance_dormant_and_the_batch_applied() {
        let state = AppState::default();
        fill_hosted_plugin_reserve(&state);
        park_dormant_plugin(&state, "refused-on-first-play");

        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let result = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": [track_strip("t1")] }),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");

        assert_eq!(
            result["application"], "applied",
            "a refused attach must not fail the batch"
        );
        assert_eq!(
            result["attachedPlugins"],
            json!([]),
            "nothing was attached, and the caller must not be told otherwise"
        );
        assert!(
            state
                .plugins
                .lock()
                .expect("plugins lock")
                .contains_key("refused-on-first-play"),
            "a refused instance stays dormant, runtime and all, for the next batch"
        );
    }

    /// A batch the engine never took must not take a plugin either. The attach
    /// hands the instance to the engine and removes it from the command-owned
    /// store, and only an applied result carries `attachedPlugins` — so an
    /// attach that ran before the batch was decided would leave a rejected
    /// caller with a plugin that is engine-owned and rendering here, still
    /// pending and degraded there, and absent from every later batch's answer.
    #[test]
    fn a_rejected_batch_leaves_a_dormant_plugin_for_the_next_one() {
        let state = AppState::default();
        park_dormant_plugin(&state, "attached-after-a-refused-batch");

        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        // Refused by the mapping, with the engine already running: the batch
        // names a track no strip ever created.
        let rejected = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": [
                { "kind": "set-track-output", "trackId": "missing",
                  "target": { "kind": "master" } }
            ] }),
            &state,
            &CrumbsState::default(),
        ))
        .expect("a refusal resolves to a result");

        assert_eq!(rejected["acceptance"], "rejected");
        assert!(
            rejected.get("attachedPlugins").is_none(),
            "only an applied batch answers about attachments: {rejected:?}"
        );
        assert!(
            state
                .plugins
                .lock()
                .expect("plugins lock")
                .contains_key("attached-after-a-refused-batch"),
            "a batch that applied nothing must leave the instance dormant"
        );
        assert!(
            !state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .contains_key("attached-after-a-refused-batch"),
            "and must not have handed it to the engine on the way"
        );

        let applied = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": [track_strip("t1")] }),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");

        assert_eq!(applied["application"], "applied");
        let attached = applied["attachedPlugins"]
            .as_array()
            .expect("an applied batch always carries the list");
        assert_eq!(attached.len(), 1, "got: {attached:?}");
        assert_eq!(attached[0]["instanceId"], "attached-after-a-refused-batch");
        assert!(
            state.plugins.lock().expect("plugins lock").is_empty(),
            "the batch that applied is the one that took the instance"
        );
    }

    /// A batch big enough to resize the command ring must still leave room for
    /// the attach it is about to make.
    ///
    /// `send_graph_batch` provisions exactly fence plus body and then fills every
    /// slot, so on a ring it sized the following single push is refused as
    /// "queue full" whatever it is. In production that is the 256-slot boot ring
    /// and a project of some sixty tracks on its first Play; here the ring is
    /// small and the batch modest, because the arithmetic that breaks is
    /// `capacity == needed`, not the size either of them happens to be. The
    /// plugin this whole path exists to unmute would go silent on exactly the
    /// sessions large enough to notice.
    #[test]
    fn a_batch_that_fills_the_command_ring_still_attaches_its_dormant_plugin() {
        let state = AppState::default();
        park_dormant_plugin(&state, "attached-behind-a-full-batch");

        // Smaller than the batch below, so that batch is the one that sizes the
        // ring it then fills.
        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let commands: Vec<Value> = (0..64)
            .map(|index| track_strip(&format!("t{index}")))
            .collect();
        let result = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": commands }),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");

        assert_eq!(result["application"], "applied", "got: {result:?}");
        let attached = result["attachedPlugins"]
            .as_array()
            .expect("an applied batch always carries the list");
        assert_eq!(
            attached.len(),
            1,
            "the ring the batch sized must have held a slot for the attach: {attached:?}"
        );
        assert_eq!(attached[0]["instanceId"], "attached-behind-a-full-batch");
        assert!(
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .contains_key("attached-behind-a-full-batch"),
            "and the engine must actually hold it"
        );
    }

    /// A batch with nothing parked reserves nothing, and so publishes onto the
    /// ring it was handed rather than onto a replacement.
    ///
    /// The reservation is the attach's, and a session with no dormant instance
    /// has no attach to make. Reserving a fixed population instead would make
    /// every start sequence provision a new channel — `startNativeLiveGraphSession`
    /// sends its topology and its roll back to back, so that is two allocations,
    /// two fence swaps and two audio-thread adoptions per Play, under the engine
    /// and graph locks, for plugins that are not there. The consumer this test
    /// holds is the one the engine was built with: a provisioned batch lands on
    /// its replacement and this one drains nothing.
    #[test]
    fn a_batch_with_nothing_parked_publishes_onto_the_ring_it_was_given() {
        let state = AppState::default();
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let commands: Vec<Value> = (0..8)
            .map(|index| track_strip(&format!("t{index}")))
            .collect();
        let sent = commands.len();
        let result = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": commands }),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");

        assert_eq!(result["application"], "applied", "got: {result:?}");
        assert!(
            state.plugins.lock().expect("plugins lock").is_empty(),
            "the reservation under test is the one a session with no dormant \
             instance makes"
        );

        let mut drained = 0;
        let mut fences = 0;
        while let Ok(command) = command_rx.pop() {
            drained += 1;
            if matches!(command, GraphCommand::BeginBatch { .. }) {
                fences += 1;
            }
        }
        assert_eq!(
            fences, 1,
            "the fence must reach the ring the engine was built with"
        );
        assert!(
            drained > sent,
            "and the batch's own commands with it: {drained} drained behind one \
             fence, for {sent} commands sent"
        );
    }

    /// The refusal that arrives after the instance has left the command-owned
    /// store. The runtime comes back out of the registration and the instance is
    /// parked again, so the next batch tries it once more — the alternative is
    /// an instance that exists in neither map, with a device in the rack and
    /// nothing behind it.
    ///
    /// Distinct from the ceiling refusal above, which is decided before the
    /// removal and never reaches this branch at all.
    #[test]
    fn an_instance_refused_after_it_leaves_the_store_is_parked_again() {
        let state = AppState::default();
        park_unactivated_dormant_plugin(&state, "reparked-on-first-play");

        let (engine, _command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);

        let result = block_on_test(apply_graph_commands(
            json!({ "schemaVersion": 1, "commands": [track_strip("t1")] }),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the batch resolves to a result");

        assert_eq!(
            result["application"], "applied",
            "a refused attach must not fail the batch"
        );
        assert_eq!(
            result["attachedPlugins"],
            json!([]),
            "nothing was attached, and the caller must not be told otherwise"
        );
        assert!(
            state
                .plugins
                .lock()
                .expect("plugins lock")
                .contains_key("reparked-on-first-play"),
            "the instance is parked again, runtime and all, for the next batch"
        );
        assert!(
            !state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .contains_key("reparked-on-first-play"),
            "and the engine holds no record of the registration it refused"
        );
    }

    /// Debt 3, refusal ordering: a batch that lost its revision race rejects
    /// with the contract's semantics — refused before the graph changed —
    /// and before the lazy bootstrap, so a lost batch never starts an
    /// engine. A correlation this side cannot read refuses the same way.
    #[test]
    fn a_stale_or_unreadable_correlation_rejects_before_the_engine_bootstraps() {
        let state = AppState::default();
        let stale = json!({ "schemaVersion": 1,
            "correlation": { "appRevision": 5, "projectRevision": "p1" },
            "commands": [] });

        let result = block_on_test(apply_graph_commands(stale, &state, &CrumbsState::default()))
            .expect("a stale correlation resolves to a result, not a throw");
        assert_eq!(result["acceptance"], "rejected");
        assert_eq!(result["application"], "not-applied");
        let reason = result["reason"]
            .as_str()
            .expect("the reason names the race");
        assert!(reason.contains("correlation-stale"), "got: {reason}");
        assert!(reason.contains("revision 5"), "got: {reason}");

        let malformed = json!({ "schemaVersion": 1,
            "correlation": { "appRevision": "not-a-revision" },
            "commands": [] });
        let result = block_on_test(apply_graph_commands(
            malformed,
            &state,
            &CrumbsState::default(),
        ))
        .expect("an unreadable correlation resolves to a result");
        assert_eq!(result["acceptance"], "rejected");
        assert!(result["reason"]
            .as_str()
            .expect("the reason names the parse")
            .contains("correlation-malformed"));

        // Both refusals preceded the lazy bootstrap: no engine was started
        // for a batch that could not apply.
        assert!(state.engine.lock().expect("engine lock").is_none());
    }

    /// The correlation contract's other two legs: a claim matching the live
    /// revision passes, and an absent correlation means "not correlated" —
    /// no validation, exactly what the uncorrelated offline bounce sends.
    #[test]
    fn a_current_correlation_passes_and_an_absent_one_skips_validation() {
        assert_eq!(validate_correlation(None, 7), Ok(()));
        let current = json!({ "appRevision": 7, "projectRevision": "p1" });
        assert_eq!(validate_correlation(Some(&current), 7), Ok(()));
        let stale = json!({ "appRevision": 7, "projectRevision": "p1" });
        let reason = validate_correlation(Some(&stale), 8).expect_err("a passed-by claim refuses");
        assert!(reason.contains("correlation-stale"), "got: {reason}");
    }

    /// Debt 4's report wire: `map_graph_batch` answers the incoming batch's
    /// touched-strip reports against the graph the prior commands built —
    /// with nothing rendered and no `runtimeRevision`, which the TS backend
    /// owns.
    #[test]
    fn map_graph_batch_reports_the_incoming_batches_touched_strips() {
        let state = AppState::default();
        let prior = json!([track_strip("t1"), knead_insert("t1", "d1")]);
        let incoming = json!({ "schemaVersion": 1,
            "correlation": { "appRevision": 3, "projectRevision": "p1" },
            "commands": [
                { "kind": "insert-device", "trackId": "t1", "index": 1,
                  "device": { "id": "d2", "type": "knead", "bypassed": false,
                              "parameterValues": {} } },
                track_strip("t2"),
            ] });

        let result = block_on_test(map_graph_batch(prior, incoming, 48_000.0, None, &state))
            .expect("a mappable batch resolves");

        assert_eq!(result["acceptance"], "accepted");
        assert_eq!(result["application"], "applied");
        // No runtime ran, so no runtime revision may be claimed.
        assert!(result.get("runtimeRevision").is_none());
        // And no fence was published, so there is no batch number for a
        // transport reading to be held against either.
        assert!(result.get("admittedBatch").is_none());
        // The correlation is echoed, not validated: a mapping races nothing.
        assert_eq!(result["correlation"]["appRevision"], 3);
        // Reports cover exactly the strips the *incoming* batch touched —
        // and t1's chain is the realized one the prior built plus this
        // batch's insert, which only the carried registry can know.
        assert_eq!(
            result["reports"],
            json!([
                { "kind": "track", "id": "t1", "deviceIds": ["d1", "d2"] },
                { "kind": "track", "id": "t2", "deviceIds": [] },
            ])
        );
    }

    /// The two failure vocabularies of the mapping wire: an incoming batch
    /// that cannot map is the contract's `rejected` result naming its own
    /// command indices; a prior sequence that no longer replays is a
    /// transport error — those commands were accepted once, so blaming the
    /// incoming batch would name the wrong commands.
    #[test]
    fn map_graph_batch_rejects_the_incoming_batch_and_faults_a_broken_prior() {
        let state = AppState::default();

        let result = block_on_test(map_graph_batch(
            json!([track_strip("t1")]),
            json!({ "schemaVersion": 1, "commands": [
                { "kind": "set-track-output", "trackId": "missing",
                  "target": { "kind": "master" } }
            ] }),
            48_000.0,
            None,
            &state,
        ))
        .expect("a refusal resolves to a result");
        assert_eq!(result["acceptance"], "rejected");
        assert!(result["reason"]
            .as_str()
            .expect("the reason names the command")
            .contains("commands[0]"));

        let fault = block_on_test(map_graph_batch(
            json!([track_strip("t1"), track_strip("t1")]),
            json!({ "schemaVersion": 1, "commands": [] }),
            48_000.0,
            None,
            &state,
        ))
        .expect_err("a prior that no longer maps is a transport fault");
        // Leading, not merely present: the TS consumer keys its rethrow off
        // the prefix, so the marker has to open the message.
        assert!(fault.starts_with(PRIOR_FAULT_PREFIX), "got: {fault}");
    }

    fn session_key(session_id: &str, revision: u64) -> Option<Value> {
        Some(json!({ "sessionId": session_id, "revision": revision }))
    }

    fn fader_step(track_id: &str) -> Value {
        json!({ "kind": "write-parameter",
                "target": { "kind": "track-fader", "trackId": track_id },
                "write": { "shape": "step", "value": 0.5, "time": 0.25 } })
    }

    fn batch_of(commands: Value) -> Value {
        json!({ "schemaVersion": 1, "commands": commands })
    }

    /// The mapping session's reason to exist (#2225): the second apply names
    /// the session with an **empty** prior, and still maps against the strip
    /// the first apply built — only the kept registry can know it. Without
    /// the session (revert the resume path) this refuses "unknown strip".
    #[test]
    fn a_mapping_session_resumes_the_prior_graph_without_resending_it() {
        let state = AppState::default();

        let first = block_on_test(map_graph_batch(
            json!([]),
            batch_of(json!([track_strip("t1")])),
            48_000.0,
            session_key("s1", 0),
            &state,
        ))
        .expect("establishing apply resolves");
        assert_eq!(first["acceptance"], "accepted");

        let second = block_on_test(map_graph_batch(
            json!([]),
            batch_of(json!([fader_step("t1")])),
            48_000.0,
            session_key("s1", 1),
            &state,
        ))
        .expect("resumed apply resolves");
        // The acceptance is the discriminating fact: a fader write on "t1"
        // maps only against a registry that still holds the first apply's
        // strip, so without the resume this is `rejected: unknown strip`.
        assert_eq!(second["acceptance"], "accepted", "got: {second}");
        assert_eq!(second["application"], "applied");
    }

    /// Whole-or-nothing across the session: a rejected batch advances
    /// nothing, so the next apply resumes at the same revision — and an apply
    /// claiming the rejected batch's revision faults instead of resuming a
    /// history that was never committed.
    #[test]
    fn a_rejected_batch_does_not_advance_the_mapping_session() {
        let state = AppState::default();

        block_on_test(map_graph_batch(
            json!([]),
            batch_of(json!([track_strip("t1")])),
            48_000.0,
            session_key("s1", 0),
            &state,
        ))
        .expect("establishing apply resolves");

        let refused = block_on_test(map_graph_batch(
            json!([]),
            batch_of(json!([fader_step("missing")])),
            48_000.0,
            session_key("s1", 1),
            &state,
        ))
        .expect("a refusal resolves to a result");
        assert_eq!(refused["acceptance"], "rejected");

        let fault = block_on_test(map_graph_batch(
            json!([]),
            batch_of(json!([fader_step("t1")])),
            48_000.0,
            session_key("s1", 2),
            &state,
        ))
        .expect_err("a revision the session never reached is not resumable");
        assert!(fault.starts_with(SESSION_FAULT_PREFIX), "got: {fault}");

        let resumed = block_on_test(map_graph_batch(
            json!([]),
            batch_of(json!([fader_step("t1")])),
            48_000.0,
            session_key("s1", 1),
            &state,
        ))
        .expect("the committed revision still resumes");
        assert_eq!(resumed["acceptance"], "accepted");
    }

    /// The recovery leg the TS backend drives on a session fault: an unknown
    /// session with a nonzero revision faults with the seam's prefix, and the
    /// retry carrying the full prior at that revision re-establishes it —
    /// after which the empty-prior resume works again.
    #[test]
    fn an_evicted_session_faults_and_a_full_prior_reestablishes_it() {
        let state = AppState::default();

        let fault = block_on_test(map_graph_batch(
            json!([]),
            batch_of(json!([fader_step("t1")])),
            48_000.0,
            session_key("s1", 1),
            &state,
        ))
        .expect_err("an unheld session at a nonzero revision faults");
        assert!(fault.starts_with(SESSION_FAULT_PREFIX), "got: {fault}");

        let reestablished = block_on_test(map_graph_batch(
            json!([track_strip("t1")]),
            batch_of(json!([fader_step("t1")])),
            48_000.0,
            session_key("s1", 1),
            &state,
        ))
        .expect("a full prior at the stated revision re-establishes");
        assert_eq!(reestablished["acceptance"], "accepted");

        let resumed = block_on_test(map_graph_batch(
            json!([]),
            batch_of(json!([fader_step("t1")])),
            48_000.0,
            session_key("s1", 2),
            &state,
        ))
        .expect("the re-established session resumes without a prior");
        assert_eq!(resumed["acceptance"], "accepted");
    }

    /// The cap is the boundedness claim: sessions past
    /// [`MAX_MAPPING_SESSIONS`] evict least-recently-used, and the evicted
    /// caller lands on the recoverable fault, never on silent growth.
    #[test]
    fn mapping_sessions_evict_least_recently_used_past_the_cap() {
        let state = AppState::default();

        for index in 0..=MAX_MAPPING_SESSIONS {
            block_on_test(map_graph_batch(
                json!([]),
                batch_of(json!([track_strip("t1")])),
                48_000.0,
                session_key(&format!("s{index}"), 0),
                &state,
            ))
            .expect("establishing apply resolves");
        }

        let fault = block_on_test(map_graph_batch(
            json!([]),
            batch_of(json!([fader_step("t1")])),
            48_000.0,
            session_key("s0", 1),
            &state,
        ))
        .expect_err("the least-recently-used session was evicted");
        assert!(fault.starts_with(SESSION_FAULT_PREFIX), "got: {fault}");

        let survivor = block_on_test(map_graph_batch(
            json!([]),
            batch_of(json!([fader_step("t1")])),
            48_000.0,
            session_key(&format!("s{MAX_MAPPING_SESSIONS}"), 1),
            &state,
        ))
        .expect("the most recent session survives the cap");
        assert_eq!(survivor["acceptance"], "accepted");
    }

    /// Stateless callers are untouched: no `session` (or an explicit null) is
    /// exactly the pre-session behaviour, and a session key that does not
    /// deserialize is a named transport error rather than a silent stateless
    /// fallback.
    #[test]
    fn an_absent_or_null_session_stays_stateless_and_a_malformed_one_errors() {
        let state = AppState::default();

        let with_null = block_on_test(map_graph_batch(
            json!([track_strip("t1")]),
            batch_of(json!([fader_step("t1")])),
            48_000.0,
            Some(Value::Null),
            &state,
        ))
        .expect("a null session maps statelessly");
        assert_eq!(with_null["acceptance"], "accepted");

        let malformed = block_on_test(map_graph_batch(
            json!([]),
            batch_of(json!([])),
            48_000.0,
            Some(json!({ "sessionId": 7 })),
            &state,
        ))
        .expect_err("a malformed session key errors by name");
        assert!(
            malformed.contains("Invalid mapping session key"),
            "got: {malformed}"
        );
    }

    /// A payload that does not deserialize resolves to the contract's
    /// `rejected` result — one failure vocabulary, not a thrown transport
    /// error beside it. `index: -1` is the likeliest live trigger: the
    /// contract's `number` admits what `u32` refuses.
    #[test]
    fn a_batch_that_fails_to_parse_resolves_rejected_rather_than_throwing() {
        let state = AppState::default();
        let malformed = json!({ "schemaVersion": 1, "commands": [
            { "kind": "insert-device", "trackId": "t1", "index": -1,
              "device": { "id": "d1", "type": "knead", "bypassed": false,
                          "parameterValues": {} } }
        ]});

        let result = block_on_test(apply_graph_commands(
            malformed,
            &state,
            &CrumbsState::default(),
        ))
        .expect("a parse failure must resolve to a result, not throw");

        assert_eq!(result["acceptance"], "rejected");
        assert_eq!(result["application"], "not-applied");
        assert!(result["reason"]
            .as_str()
            .expect("the reason is the serde message")
            .contains("Invalid graph command batch"));
        // Refused before the lazy bootstrap: a batch that cannot be read must
        // not start an engine.
        assert!(state.engine.lock().expect("engine lock").is_none());
    }

    #[test]
    fn register_timeline_sample_decodes_interleaved_stereo_and_refuses_ragged_bytes() {
        let state = AppState::default();
        let mut pcm = Vec::new();
        for frame in [[0.1f32, -0.1f32], [0.2, -0.2]] {
            pcm.extend_from_slice(&frame[0].to_le_bytes());
            pcm.extend_from_slice(&frame[1].to_le_bytes());
        }

        let ack = block_on_test(register_timeline_sample(
            "s1".to_string(),
            48_000.0,
            2,
            pcm,
            &state,
        ))
        .expect("a well-formed sample registers");
        assert_eq!(ack, serde_json::json!({ "frames": 2 }));

        let samples = state.timeline_samples.lock().expect("sample lock");
        let sample = samples.get("s1").expect("the sample is registered");
        assert_eq!(*sample.left, [0.1, 0.2]);
        assert_eq!(*sample.right, [-0.1, -0.2]);
        drop(samples);

        let refused = block_on_test(register_timeline_sample(
            "s2".to_string(),
            48_000.0,
            2,
            vec![0u8; 6],
            &state,
        ));
        assert!(refused.is_err(), "ragged bytes must refuse");
    }

    /// The pool refuses what a schedule could never honour: zero frames (the
    /// contract forbids rendering a real source as silence) and material past
    /// the per-channel registration ceiling. The ceiling is arithmetic on the
    /// payload length, so proving it needs no quarter-gigabyte buffer.
    #[test]
    fn a_zero_frame_sample_and_one_past_the_ceiling_refuse_registration() {
        let state = AppState::default();
        let refused = block_on_test(register_timeline_sample(
            "s0".to_string(),
            48_000.0,
            2,
            Vec::new(),
            &state,
        ))
        .expect_err("zero frames must refuse");
        assert!(refused.contains("zero frames"), "got: {refused}");
        assert!(state
            .timeline_samples
            .lock()
            .expect("sample lock")
            .is_empty());

        assert!(pcm_frame_count(MAX_OFFLINE_RENDER_FRAMES * 4, 1).is_ok());
        assert!(pcm_frame_count(MAX_OFFLINE_RENDER_FRAMES * 8, 2).is_ok());
        let over = pcm_frame_count((MAX_OFFLINE_RENDER_FRAMES + 1) * 4, 1)
            .expect_err("a frame past the ceiling must refuse");
        assert!(over.contains("ceiling"), "got: {over}");
        assert!(pcm_frame_count((MAX_OFFLINE_RENDER_FRAMES + 1) * 8, 2).is_err());
    }

    #[test]
    fn timeline_sample_pool_evicts_least_recently_registered_when_over_budget() {
        let mut pool = TimelineSamplePool::new(128);
        let make_sample = || TimelineSample {
            left: vec![0.0; 8].into(),
            right: vec![0.0; 8].into(),
            sample_rate: 48_000.0,
        }; // 16 * 4 = 64 bytes

        assert_eq!(make_sample().byte_len(), 64);

        pool.insert("s1".to_string(), make_sample());
        assert_eq!(pool.len(), 1);
        assert_eq!(pool.total_bytes(), 64);
        assert!(pool.contains_key("s1"));

        pool.insert("s2".to_string(), make_sample());
        assert_eq!(pool.len(), 2);
        assert_eq!(pool.total_bytes(), 128);
        assert!(pool.contains_key("s1"));
        assert!(pool.contains_key("s2"));

        pool.insert("s3".to_string(), make_sample());
        assert_eq!(pool.len(), 2);
        assert_eq!(pool.total_bytes(), 128);
        assert!(!pool.contains_key("s1"));
        assert!(pool.contains_key("s2"));
        assert!(pool.contains_key("s3"));

        // Re-register s2 to refresh touched counter
        pool.insert("s2".to_string(), make_sample());
        assert_eq!(pool.len(), 2);
        assert_eq!(pool.total_bytes(), 128);

        pool.insert("s4".to_string(), make_sample());
        assert_eq!(pool.len(), 2);
        assert_eq!(pool.total_bytes(), 128);
        assert!(!pool.contains_key("s3"));
        assert!(pool.contains_key("s2"));
        assert!(pool.contains_key("s4"));

        assert!(pool.total_bytes() <= pool.max_bytes());
    }

    #[test]
    fn register_timeline_sample_respects_pool_budget_and_evicts_oldest_pcm() {
        let state = AppState::default();
        state.timeline_samples.lock().unwrap().set_max_bytes(32);

        // 2 frames stereo = 2 * 2 * 4 = 16 bytes per sample
        let pcm_16_bytes = vec![0u8; 16];

        block_on_test(register_timeline_sample(
            "s1".to_string(),
            48_000.0,
            2,
            pcm_16_bytes.clone(),
            &state,
        ))
        .expect("s1 registers");

        block_on_test(register_timeline_sample(
            "s2".to_string(),
            48_000.0,
            2,
            pcm_16_bytes.clone(),
            &state,
        ))
        .expect("s2 registers");

        {
            let samples = state.timeline_samples.lock().unwrap();
            assert_eq!(samples.len(), 2);
            assert_eq!(samples.total_bytes(), 32);
            assert!(samples.contains_key("s1"));
            assert!(samples.contains_key("s2"));
        }

        block_on_test(register_timeline_sample(
            "s3".to_string(),
            48_000.0,
            2,
            pcm_16_bytes,
            &state,
        ))
        .expect("s3 registers");

        {
            let samples = state.timeline_samples.lock().unwrap();
            assert_eq!(samples.len(), 2);
            assert_eq!(samples.total_bytes(), 32);
            assert!(!samples.contains_key("s1"), "s1 was evicted as oldest");
            assert!(samples.contains_key("s2"));
            assert!(samples.contains_key("s3"));
            assert!(samples.total_bytes() <= samples.max_bytes());
        }
    }

    #[test]
    fn timeline_sample_pool_re_registration_replaces_and_updates_accounting() {
        let mut pool = TimelineSamplePool::new(256);
        let sample_16 = TimelineSample {
            left: vec![0.0; 2].into(),
            right: vec![0.0; 2].into(),
            sample_rate: 48_000.0,
        }; // 4 * 4 = 16 bytes
        let sample_64 = TimelineSample {
            left: vec![0.0; 8].into(),
            right: vec![0.0; 8].into(),
            sample_rate: 48_000.0,
        }; // 16 * 4 = 64 bytes

        assert_eq!(sample_16.byte_len(), 16);
        assert_eq!(sample_64.byte_len(), 64);

        pool.insert("s1".to_string(), sample_16.clone());
        assert_eq!(pool.len(), 1);
        assert_eq!(pool.total_bytes(), 16);

        // Re-register s1 with 64 bytes
        pool.insert("s1".to_string(), sample_64.clone());
        assert_eq!(pool.len(), 1);
        assert_eq!(pool.total_bytes(), 64);

        // Re-register s1 with 16 bytes
        pool.insert("s1".to_string(), sample_16);
        assert_eq!(pool.len(), 1);
        assert_eq!(pool.total_bytes(), 16);

        // Remove s1
        let removed = pool.remove("s1");
        assert!(removed.is_some());
        assert_eq!(pool.len(), 0);
        assert_eq!(pool.total_bytes(), 0);
    }

    #[test]
    fn timeline_sample_pool_oversized_sample_retains_newest() {
        let mut pool = TimelineSamplePool::new(64);
        let sample_16 = TimelineSample {
            left: vec![0.0; 2].into(),
            right: vec![0.0; 2].into(),
            sample_rate: 48_000.0,
        }; // 16 bytes
        let sample_128 = TimelineSample {
            left: vec![0.0; 16].into(),
            right: vec![0.0; 16].into(),
            sample_rate: 48_000.0,
        }; // 128 bytes (larger than max_bytes = 64)

        // Empty pool: oversized sample is retained
        pool.insert("oversized_empty".to_string(), sample_128.clone());
        assert_eq!(pool.len(), 1);
        assert_eq!(pool.total_bytes(), 128);
        assert!(pool.contains_key("oversized_empty"));

        pool.clear();
        assert_eq!(pool.len(), 0);
        assert_eq!(pool.total_bytes(), 0);

        // Multi-entry pool: oversized sample evicts prior entries and is retained
        pool.insert("s1".to_string(), sample_16.clone());
        pool.insert("s2".to_string(), sample_16.clone());
        assert_eq!(pool.len(), 2);
        assert_eq!(pool.total_bytes(), 32);

        pool.insert("oversized_multi".to_string(), sample_128);
        assert_eq!(pool.len(), 1);
        assert_eq!(pool.total_bytes(), 128);
        assert!(!pool.contains_key("s1"));
        assert!(!pool.contains_key("s2"));
        assert!(pool.contains_key("oversized_multi"));
    }

    #[test]
    fn timeline_sample_pool_lowering_max_bytes_evicts_oldest_samples() {
        let mut pool = TimelineSamplePool::new(256);
        let make_sample = || TimelineSample {
            left: vec![0.0; 8].into(),
            right: vec![0.0; 8].into(),
            sample_rate: 48_000.0,
        }; // 16 * 4 = 64 bytes

        assert_eq!(make_sample().byte_len(), 64);

        pool.insert("s1".to_string(), make_sample());
        pool.insert("s2".to_string(), make_sample());
        pool.insert("s3".to_string(), make_sample());

        assert!(pool.contains_key("s1"));
        assert!(pool.contains_key("s2"));
        assert!(pool.contains_key("s3"));
        assert_eq!(pool.len(), 3);
        assert_eq!(pool.total_bytes(), 192);

        pool.set_max_bytes(128);
        assert_eq!(pool.max_bytes(), 128);
        assert_eq!(pool.len(), 2);
        assert_eq!(pool.total_bytes(), 128);
        assert!(!pool.contains_key("s1"));
        assert!(pool.contains_key("s2"));
        assert!(pool.contains_key("s3"));

        pool.set_max_bytes(64);
        assert_eq!(pool.max_bytes(), 64);
        assert_eq!(pool.len(), 1);
        assert_eq!(pool.total_bytes(), 64);
        assert!(!pool.contains_key("s1"));
        assert!(!pool.contains_key("s2"));
        assert!(pool.contains_key("s3"));

        pool.set_max_bytes(0);
        assert_eq!(pool.max_bytes(), 0);
        assert!(pool.is_empty());
        assert_eq!(pool.len(), 0);
        assert_eq!(pool.total_bytes(), 0);
        assert!(!pool.contains_key("s3"));
    }

    /// The wire result is a hand-maintained mirror of `AudioGraphApplyResult`;
    /// pin its spellings the way `engine_diagnostics` pins its own payload.
    #[test]
    fn the_result_payload_serializes_with_the_contract_spellings() {
        let rejected = serde_json::to_string(&GraphApplyResultPayload::rejected(
            "engine-not-running: no device".to_string(),
        ))
        .expect("rejected serializes");
        assert_eq!(
            rejected,
            r#"{"acceptance":"rejected","application":"not-applied","reason":"engine-not-running: no device"}"#
        );

        let applied = serde_json::to_string(&GraphApplyResultPayload::applied(
            None,
            3,
            5,
            vec![StripReportPayload {
                kind: "track",
                id: "t1".to_string(),
                device_ids: vec!["d1".to_string()],
            }],
            vec![AttachedPluginPayload {
                instance_id: "i1".to_string(),
            }],
        ))
        .expect("applied serializes");
        assert_eq!(
            applied,
            concat!(
                r#"{"acceptance":"accepted","application":"applied","runtimeRevision":3,"#,
                r#""admittedBatch":5,"reports":[{"kind":"track","id":"t1","deviceIds":["d1"]}],"#,
                r#""attachedPlugins":[{"instanceId":"i1"}]}"#
            )
        );

        // A mapped result is `applied` with no `runtimeRevision` at all —
        // the TS backend must never read a revision out of a mapping.
        let mapped = serde_json::to_string(&GraphApplyResultPayload::mapped(
            Some(json!({ "appRevision": 1, "projectRevision": "p1" })),
            vec![StripReportPayload {
                kind: "track",
                id: "t1".to_string(),
                device_ids: vec!["d1".to_string()],
            }],
        ))
        .expect("mapped serializes");
        assert_eq!(
            mapped,
            concat!(
                r#"{"acceptance":"accepted","application":"applied","#,
                r#""correlation":{"appRevision":1,"projectRevision":"p1"},"#,
                r#""reports":[{"kind":"track","id":"t1","deviceIds":["d1"]}]}"#
            )
        );

        let needs_reconcile = serde_json::to_string(&GraphApplyResultPayload::needs_reconcile(
            "the engine refused command 2 of 3".to_string(),
            Some(json!({ "documentRevision": 9 })),
            7,
            vec![StripReportPayload {
                kind: "track",
                id: "t1".to_string(),
                device_ids: Vec::new(),
            }],
        ))
        .expect("needs-reconcile serializes");
        assert_eq!(
            needs_reconcile,
            concat!(
                r#"{"acceptance":"accepted","application":"needs-reconcile","#,
                r#""reason":"the engine refused command 2 of 3","#,
                r#""compensation":"not-attempted","correlation":{"documentRevision":9},"#,
                r#""runtimeRevision":7,"reports":[{"kind":"track","id":"t1","deviceIds":[]}]}"#
            )
        );
    }

    #[test]
    fn write_device_parameter_resolves_every_known_device_param_and_refuses_unknown() {
        let mut registry = GraphRegistry::default();
        let track_id = "t1".to_string();
        let device_id = "d1".to_string();
        registry.strips.insert(
            track_id.clone(),
            StripEntry {
                native_id: 1,
                kind: StripKind::Track,
                vca_multiplier: 1.0,
                contributes_audio: true,
                device_ids: vec![device_id.clone()],
                clip_count: 0,
                send_bus_ids: Vec::new(),
                output: StripOutput::Master,
            },
        );
        registry.devices.insert(
            device_id.clone(),
            DeviceEntry {
                native_effect_id: 1,
                strip_id: track_id.clone(),
                builtin: Some(BuiltinEffectType::Knead),
            },
        );

        let samples = TimelineSamplePool::default();

        // 1. Every known name from DeviceParam must resolve
        for param_name in ["shift_semitones", "retune_speed_ms", "formant_preserve"] {
            let batch = GraphBatchPayload {
                schema_version: 1,
                correlation: None,
                replace_topology: false,
                commands: vec![GraphCommandPayload::WriteDeviceParameter {
                    target: DeviceParameterTargetPayload::DeviceParameter {
                        track_id: track_id.clone(),
                        device_id: device_id.clone(),
                        parameter_id: param_name.to_string(),
                    },
                    write: StepWritePayload::Step {
                        value: 1.0,
                        time: 0.0,
                    },
                }],
            };
            let mut reg_clone = registry.clone();
            let res = map_unbound_batch(&batch, &mut reg_clone, &samples, 48000.0);
            assert!(
                res.is_ok(),
                "WriteDeviceParameter must accept known param '{param_name}': {:?}",
                res.err()
            );
            let mapped = res.unwrap();
            assert_eq!(mapped.ops.len(), 1);
        }

        // 2. Unknown param must be refused
        let unknown_batch = GraphBatchPayload {
            schema_version: 1,
            correlation: None,
            replace_topology: false,
            commands: vec![GraphCommandPayload::WriteDeviceParameter {
                target: DeviceParameterTargetPayload::DeviceParameter {
                    track_id: track_id.clone(),
                    device_id: device_id.clone(),
                    parameter_id: "unknown_param".to_string(),
                },
                write: StepWritePayload::Step {
                    value: 1.0,
                    time: 0.0,
                },
            }],
        };
        let mut reg_clone = registry.clone();
        let res = map_unbound_batch(&unknown_batch, &mut reg_clone, &samples, 48000.0);
        assert!(
            res.is_err(),
            "WriteDeviceParameter must refuse unknown parameter"
        );
        assert!(
            res.unwrap_err().contains("has no native address"),
            "refusal must mention missing native address"
        );
    }

    /// A `write-device-parameter` aimed at a fermenter carries the
    /// instrument's own parameter name, and a key shaped unlike one refuses
    /// under the same reason every unaddressable parameter refuses under.
    ///
    /// The stamp's address is decided by what the device is: the same key at a
    /// knead would be refused as a name knead does not map, and here it is the
    /// instrument's whole vocabulary that the shape check stands in for.
    #[test]
    fn write_device_parameter_at_a_fermenter_carries_the_instruments_own_name() {
        let track_id = "t1".to_string();
        let device_id = "d-ferm".to_string();
        let mut registry = GraphRegistry::default();
        registry.strips.insert(
            track_id.clone(),
            StripEntry {
                native_id: 1,
                kind: StripKind::Track,
                vca_multiplier: 1.0,
                contributes_audio: true,
                device_ids: vec![device_id.clone()],
                clip_count: 0,
                send_bus_ids: Vec::new(),
                output: StripOutput::Master,
            },
        );
        registry.devices.insert(
            device_id.clone(),
            DeviceEntry {
                native_effect_id: 1,
                strip_id: track_id.clone(),
                builtin: Some(BuiltinEffectType::Fermenter),
            },
        );
        let samples = TimelineSamplePool::default();

        let write_batch = |parameter_id: &str| GraphBatchPayload {
            schema_version: 1,
            correlation: None,
            replace_topology: false,
            commands: vec![GraphCommandPayload::WriteDeviceParameter {
                target: DeviceParameterTargetPayload::DeviceParameter {
                    track_id: track_id.clone(),
                    device_id: device_id.clone(),
                    parameter_id: parameter_id.to_string(),
                },
                write: StepWritePayload::Step {
                    value: 0.2,
                    time: 0.0,
                },
            }],
        };

        let mapped = map_unbound_batch(
            &write_batch("cutoff"),
            &mut registry.clone(),
            &samples,
            48_000.0,
        )
        .expect("one of the instrument's own names is a fermenter parameter address");

        let cutoff = FermenterParamName::parse("cutoff").expect("'cutoff' is a well-shaped name");
        let addressed: Vec<DeviceParamTarget> = mapped
            .ops
            .iter()
            .filter_map(|op| match op {
                GraphCommand::AutomateDeviceParam { param, .. } => Some(*param),
                _ => None,
            })
            .collect();
        assert_eq!(
            addressed,
            vec![DeviceParamTarget::Builtin(DeviceParam::FermenterNamed(
                cutoff
            ))],
            "the stamp must carry the instrument's own name"
        );

        let refusal = map_unbound_batch(
            &write_batch("Cutoff"),
            &mut registry.clone(),
            &samples,
            48_000.0,
        )
        .expect_err("a key shaped unlike one of the instrument's names must refuse");
        assert!(
            refusal.contains("has no native address"),
            "refusal must mention missing native address, got: {refusal}"
        );
    }

    // ── Immediate device parameters ────────────────────────────

    /// The effect id every built-in device below is registered under.
    const IMMEDIATE_PARAM_EFFECT_ID: usize = 7;

    /// A registry holding one contributing track strip carrying one built-in.
    fn registry_with_builtin_device(
        track_id: &str,
        device_id: &str,
        builtin: BuiltinEffectType,
    ) -> GraphRegistry {
        let mut registry = GraphRegistry::default();
        registry.strips.insert(
            track_id.to_string(),
            StripEntry {
                native_id: 1,
                kind: StripKind::Track,
                vca_multiplier: 1.0,
                contributes_audio: true,
                device_ids: vec![device_id.to_string()],
                clip_count: 0,
                send_bus_ids: Vec::new(),
                output: StripOutput::Master,
            },
        );
        registry.devices.insert(
            device_id.to_string(),
            DeviceEntry {
                native_effect_id: IMMEDIATE_PARAM_EFFECT_ID,
                strip_id: track_id.to_string(),
                builtin: Some(builtin),
            },
        );
        registry
    }

    /// One `set-device-parameters` batch, deserialized from the wire spelling
    /// so each call draws a fresh `HashMap` for `values`.
    fn set_device_parameters_batch(
        track_id: &str,
        device_id: &str,
        values: Value,
    ) -> GraphBatchPayload {
        batch(json!([
            { "kind": "set-device-parameters", "trackId": track_id, "deviceId": device_id,
              "values": values }
        ]))
    }

    /// One batch carrying several `set-device-parameters` records, each
    /// aimed at `device_id` on `track_id` — the shape a batch-wide ceiling
    /// has to see across records rather than within one.
    fn set_device_parameters_records_batch(
        track_id: &str,
        device_id: &str,
        records: Vec<Value>,
    ) -> GraphBatchPayload {
        let commands: Vec<Value> = records
            .into_iter()
            .map(|values| {
                json!({ "kind": "set-device-parameters", "trackId": track_id,
                        "deviceId": device_id, "values": values })
            })
            .collect();
        batch(Value::Array(commands))
    }

    /// A record of `count` distinct well-shaped fermenter keys, each named so
    /// records from different calls never collide.
    fn fermenter_keys_record(prefix: &str, count: usize) -> Value {
        let values: serde_json::Map<String, Value> = (0..count)
            .map(|index| (format!("{prefix}_{index:03}"), json!(index as f64 / 1000.0)))
            .collect();
        Value::Object(values)
    }

    /// Every immediate device-parameter write a mapping emitted, in order.
    fn immediate_writes(ops: &[GraphCommand]) -> Vec<(usize, DeviceParam, f32)> {
        ops.iter()
            .filter_map(|op| match op {
                GraphCommand::SetParam(effect_id, param, value) => {
                    Some((*effect_id, *param, *value))
                }
                _ => None,
            })
            .collect()
    }

    fn fermenter_write(key: &str, value: f32) -> (usize, DeviceParam, f32) {
        let name = FermenterParamName::parse(key).expect("the fixture keys are well-shaped names");
        (
            IMMEDIATE_PARAM_EFFECT_ID,
            DeviceParam::FermenterNamed(name),
            value,
        )
    }

    fn map_immediate(
        batch: &GraphBatchPayload,
        registry: &mut GraphRegistry,
    ) -> Result<MappedBatch, String> {
        map_unbound_batch(batch, registry, &sample_pool(), 48_000.0)
    }

    /// A patch load crosses as immediate writes: one `SetParam` per entry,
    /// applied on the next callback drain, and nothing parked in the device's
    /// stamp queue.
    ///
    /// The queue is why this command exists at all. It holds
    /// `DEVICE_PARAM_QUEUE_CAPACITY` pending stamps for the whole device, and a
    /// fermenter patch is an order of magnitude more keys than that, reloaded
    /// on every frame of a morph — so a patch expressed as stamped writes
    /// refuses itself.
    #[test]
    fn set_device_parameters_at_a_fermenter_emits_one_immediate_set_param_per_entry() {
        let mut registry =
            registry_with_builtin_device("t1", "d-ferm", BuiltinEffectType::Fermenter);

        let mapped = map_immediate(
            &set_device_parameters_batch(
                "t1",
                "d-ferm",
                json!({ "cutoff": 0.3, "resonance": 0.6 }),
            ),
            &mut registry,
        )
        .expect("a fermenter answers to its own names");

        assert_eq!(
            immediate_writes(&mapped.ops),
            vec![
                fermenter_write("cutoff", 0.3),
                fermenter_write("resonance", 0.6),
            ],
            "every entry must reach the engine as an immediate write at this device"
        );
        assert!(
            !mapped
                .ops
                .iter()
                .any(|op| matches!(op, GraphCommand::AutomateDeviceParam { .. })),
            "an immediate write must not be stamped into the device's parameter queue"
        );
    }

    /// `active_layer` selects the layer every write behind it lands on, so a
    /// batch carrying it emits it first whatever order the wire record draws,
    /// and the rest follow in one fixed order.
    ///
    /// The second record is what separates the two laws. Every name the
    /// instrument actually has sorts after `active_layer`, so on the first
    /// record name order alone would put the selection in front by accident; a
    /// well-shaped name that sorts before it — which the wire admits, and which
    /// the instrument answers by doing nothing — is only led by the selection if
    /// the routing law is applied.
    #[test]
    fn set_device_parameters_routes_a_fermenter_batch_through_active_layer_first() {
        /// Fresh draws of the same record. A `HashMap` seeds its iteration
        /// order per instance, so a mapper emitting in arrival order would pass
        /// a share of its runs.
        const DRAWS: usize = 16;

        let records = [
            (
                json!({ "cutoff": 0.3, "active_layer": 1, "num_layers": 2 }),
                vec![
                    fermenter_write("active_layer", 1.0),
                    fermenter_write("cutoff", 0.3),
                    fermenter_write("num_layers", 2.0),
                ],
            ),
            (
                json!({ "absent_from_the_vocabulary": 0.1, "active_layer": 1, "cutoff": 0.3 }),
                vec![
                    fermenter_write("active_layer", 1.0),
                    fermenter_write("absent_from_the_vocabulary", 0.1),
                    fermenter_write("cutoff", 0.3),
                ],
            ),
        ];

        for (record, expected) in records {
            for draw in 0..DRAWS {
                let mut registry =
                    registry_with_builtin_device("t1", "d-ferm", BuiltinEffectType::Fermenter);
                let mapped = map_immediate(
                    &set_device_parameters_batch("t1", "d-ferm", record.clone()),
                    &mut registry,
                )
                .expect("a fermenter answers to its own names");

                assert_eq!(
                    immediate_writes(&mapped.ops),
                    expected,
                    "draw {draw}: the layer selection must lead, and the rest must follow in one \
                     fixed order"
                );
            }
        }
    }

    /// An externally hosted plugin's parameters are the plugin's own, resolved
    /// by the plugin over the plugin host's control path. Mapping one through a
    /// built-in vocabulary would address a parameter that vocabulary cannot
    /// name, so the batch is refused by device.
    #[test]
    fn set_device_parameters_at_a_hosted_plugin_is_refused() {
        let mut registry = registry_with_hosted_device("t1", "d-plugin");

        let refusal = map_immediate(
            &set_device_parameters_batch("t1", "d-plugin", json!({ "cutoff": 0.3 })),
            &mut registry,
        )
        .expect_err("a hosted plugin takes its parameters on the plugin host's path");

        assert!(
            refusal.contains("d-plugin") && refusal.contains("plugin host"),
            "the refusal must name the device and the path its parameters take, got: {refusal}"
        );
    }

    /// A key with no native address refuses the whole batch, naming the device
    /// and the key: a project panel authors a fermenter's camelCase descriptor
    /// ids, and a mapper that skipped what it could not resolve would report a
    /// patch applied while the values the producer sent went nowhere.
    #[test]
    fn set_device_parameters_naming_no_parameter_of_the_device_refuses_naming_device_and_key() {
        let unmappable = [
            (BuiltinEffectType::Fermenter, "filterCutoff"),
            (BuiltinEffectType::Knead, "shiftSemitones"),
        ];

        for (builtin, key) in unmappable {
            let mut registry = registry_with_builtin_device("t1", "d-1", builtin);
            let refusal = map_immediate(
                &set_device_parameters_batch("t1", "d-1", json!({ key: 0.5 })),
                &mut registry,
            )
            .expect_err("a key with no native address must refuse the batch");

            assert!(
                refusal.contains("d-1") && refusal.contains(key),
                "the refusal must name the device and the key, got: {refusal}"
            );
        }
    }

    /// The same two address refusals every device-addressed command makes: a
    /// device the registry does not hold, and one held on a different strip
    /// than the batch claims.
    #[test]
    fn set_device_parameters_at_a_device_on_another_strip_is_refused() {
        let mut registry =
            registry_with_builtin_device("t1", "d-ferm", BuiltinEffectType::Fermenter);

        let unknown = map_immediate(
            &set_device_parameters_batch("t1", "d-missing", json!({ "cutoff": 0.3 })),
            &mut registry.clone(),
        )
        .expect_err("a device the registry does not hold must refuse the batch");
        assert!(
            unknown.contains("unknown device 'd-missing'"),
            "the refusal must name the device it could not resolve, got: {unknown}"
        );

        let wrong_strip = map_immediate(
            &set_device_parameters_batch("t2", "d-ferm", json!({ "cutoff": 0.3 })),
            &mut registry,
        )
        .expect_err("a device held on another strip must refuse the batch");
        assert!(
            wrong_strip.contains("is not on strip 't2'"),
            "the refusal must name the strip the batch claimed, got: {wrong_strip}"
        );
    }

    /// A record of exactly `MAX_IMMEDIATE_DEVICE_PARAMETERS` distinct
    /// well-shaped keys is the largest honest patch, and it must map to
    /// exactly that many immediate writes rather than being refused early.
    #[test]
    fn set_device_parameters_at_the_ceiling_is_accepted() {
        let mut registry =
            registry_with_builtin_device("t1", "d-ferm", BuiltinEffectType::Fermenter);

        let values = fermenter_keys_record("param", MAX_IMMEDIATE_DEVICE_PARAMETERS);

        let mapped = map_immediate(
            &set_device_parameters_batch("t1", "d-ferm", values),
            &mut registry,
        )
        .expect("a record at the ceiling must be accepted");

        assert_eq!(
            immediate_writes(&mapped.ops).len(),
            MAX_IMMEDIATE_DEVICE_PARAMETERS,
            "a record at the ceiling must map to exactly that many immediate writes"
        );
    }

    /// One key past the ceiling refuses the whole record before any key is
    /// resolved. One of the keys is shaped unlike a fermenter parameter name
    /// and would sort before the well-shaped keys, so it would be the first
    /// key `immediate_device_parameters` resolved and would fail with the
    /// name refusal instead — proving the ceiling is charged first, the
    /// refusal here must be the ceiling's own message naming the count and
    /// the ceiling, not that name refusal.
    #[test]
    fn set_device_parameters_past_the_ceiling_is_refused_naming_count_and_ceiling() {
        let mut registry =
            registry_with_builtin_device("t1", "d-ferm", BuiltinEffectType::Fermenter);

        let Value::Object(mut values) =
            fermenter_keys_record("param", MAX_IMMEDIATE_DEVICE_PARAMETERS)
        else {
            panic!("fermenter_keys_record must build a JSON object");
        };
        values.insert("filterCutoff".to_string(), json!(0.5));
        assert_eq!(values.len(), MAX_IMMEDIATE_DEVICE_PARAMETERS + 1);

        let refusal = map_immediate(
            &set_device_parameters_batch("t1", "d-ferm", Value::Object(values)),
            &mut registry,
        )
        .expect_err("a record past the ceiling must be refused");

        assert!(
            refusal.contains(&format!(
                "record carries {} parameters, past the ceiling of \
                 {MAX_IMMEDIATE_DEVICE_PARAMETERS}",
                MAX_IMMEDIATE_DEVICE_PARAMETERS + 1
            )),
            "refusal must name the count and the ceiling, got: {refusal}"
        );
        assert!(
            !refusal.contains("filterCutoff") && !refusal.contains("is not a fermenter parameter"),
            "the ceiling must be charged before any key is resolved, got: {refusal}"
        );
    }

    /// A per-record ceiling alone does not bound a batch of many records: a
    /// batch of `MAX_TRACK_DEVICES` records, each at the per-record ceiling,
    /// is the largest honest batch — one full patch write to every device
    /// slot of one strip in one animation frame — and must map to exactly
    /// `MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH` immediate writes rather
    /// than being refused early.
    #[test]
    fn set_device_parameters_records_at_the_batch_ceiling_are_accepted() {
        let mut registry =
            registry_with_builtin_device("t1", "d-ferm", BuiltinEffectType::Fermenter);

        let records: Vec<Value> = (0..MAX_TRACK_DEVICES)
            .map(|record_index| {
                fermenter_keys_record(&format!("r{record_index}"), MAX_IMMEDIATE_DEVICE_PARAMETERS)
            })
            .collect();

        let mapped = map_immediate(
            &set_device_parameters_records_batch("t1", "d-ferm", records),
            &mut registry,
        )
        .expect("a batch at the batch ceiling must be accepted");

        assert_eq!(
            immediate_writes(&mapped.ops).len(),
            MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH,
            "a batch at the batch ceiling must map to exactly that many immediate writes"
        );
    }

    /// One key past the batch ceiling refuses the whole batch before any of
    /// the offending record's keys are resolved. The extra record's one key
    /// is shaped unlike a fermenter parameter name, so if the batch charge
    /// ran after key resolution the refusal would instead name that key —
    /// proving the batch charge precedes parsing, the refusal here must be
    /// the batch ceiling's own message naming the running count and the
    /// batch ceiling, not the name refusal.
    #[test]
    fn set_device_parameters_records_past_the_batch_ceiling_are_refused_naming_count_and_ceiling() {
        let mut registry =
            registry_with_builtin_device("t1", "d-ferm", BuiltinEffectType::Fermenter);

        let mut records: Vec<Value> = (0..MAX_TRACK_DEVICES)
            .map(|record_index| {
                fermenter_keys_record(&format!("r{record_index}"), MAX_IMMEDIATE_DEVICE_PARAMETERS)
            })
            .collect();
        records.push(json!({ "filterCutoff": 0.5 }));

        let refusal = map_immediate(
            &set_device_parameters_records_batch("t1", "d-ferm", records),
            &mut registry,
        )
        .expect_err("a batch past the batch ceiling must be refused");

        assert!(
            refusal.contains(&format!(
                "batch carries {} immediate parameters, past the ceiling of \
                 {MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH}",
                MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH + 1
            )),
            "refusal must name the running count and the batch ceiling, got: {refusal}"
        );
        assert!(
            !refusal.contains("filterCutoff") && !refusal.contains("is not a fermenter parameter"),
            "the batch charge must precede parsing, got: {refusal}"
        );
    }

    // ── Scheduled MIDI ─────────────────────────────────────────────────────

    /// The engine plugin id the hosted device below is registered under.
    const MIDI_DEVICE_EFFECT_ID: usize = 42;

    /// A registry holding one track strip carrying one hosted device.
    fn registry_with_hosted_device(track_id: &str, device_id: &str) -> GraphRegistry {
        let mut registry = GraphRegistry::default();
        registry.strips.insert(
            track_id.to_string(),
            StripEntry {
                native_id: 1,
                kind: StripKind::Track,
                vca_multiplier: 1.0,
                contributes_audio: true,
                device_ids: vec![device_id.to_string()],
                clip_count: 0,
                send_bus_ids: Vec::new(),
                output: StripOutput::Master,
            },
        );
        registry.devices.insert(
            device_id.to_string(),
            DeviceEntry {
                native_effect_id: MIDI_DEVICE_EFFECT_ID,
                strip_id: track_id.to_string(),
                builtin: None,
            },
        );
        registry
    }

    fn midi_batch(commands: Value) -> GraphBatchPayload {
        serde_json::from_value(json!({ "schemaVersion": 1, "commands": commands }))
            .expect("the MIDI batch should deserialize")
    }

    /// The project seed the fixtures below schedule with. It is the seed of
    /// the `0xdecafbad` rows in the cross-runtime corpus
    /// ([`a_scheduled_chance_note_is_decided_as_the_web_carrier_decides_it`]),
    /// so a fixture note and a pinned decision speak of the same project.
    const MIDI_PROBABILITY_SEED: u32 = 0xdeca_fbad;

    fn schedule_midi_batch(track_id: &str, device_id: &str, notes: Value) -> GraphBatchPayload {
        midi_batch(json!([{
            "kind": "schedule-midi",
            "trackId": track_id,
            "deviceId": device_id,
            "probabilitySeed": MIDI_PROBABILITY_SEED,
            "notes": notes,
        }]))
    }

    /// One note, spelled the way a producer spells the mandatory half of one.
    fn note_at(time: f64, note: u8, channel: u8) -> Value {
        json!({
            "time": time,
            "note": note,
            "velocity": 100,
            "channel": channel,
            "isNoteOn": true,
        })
    }

    #[test]
    fn schedule_midi_maps_seconds_to_frames_on_the_devices_engine_plugin() {
        let mut registry = registry_with_hosted_device("t1", "d1");
        let samples = TimelineSamplePool::default();
        // Written out of frame order: the producer's order is not the store's,
        // and the store refuses a batch that arrives unordered.
        let batch = schedule_midi_batch(
            "t1",
            "d1",
            json!([
                { "time": 0.5, "note": 64, "velocity": 100, "channel": 3, "isNoteOn": false },
                note_at(0.25, 60, 1),
            ]),
        );

        let mapped = map_unbound_batch(&batch, &mut registry, &samples, 48_000.0)
            .expect("a schedule-midi on a registered hosted device maps");

        assert_eq!(mapped.ops.len(), 1);
        let GraphCommand::ScheduleMidiNotes { plugin_id, notes } = &mapped.ops[0] else {
            panic!("schedule-midi must map onto ScheduleMidiNotes");
        };
        assert_eq!(*plugin_id, MIDI_DEVICE_EFFECT_ID);
        let frames: Vec<u64> = notes.iter().map(|note| note.at_frame).collect();
        assert_eq!(frames, vec![12_000, 24_000]);

        assert_eq!(notes[0].event.note, 60);
        assert_eq!(notes[0].event.channel, 1);
        assert!(notes[0].event.is_note_on);
        assert_eq!(notes[1].event.note, 64);
        assert_eq!(notes[1].event.channel, 3);
        assert!(!notes[1].event.is_note_on);

        for note in notes.iter() {
            assert_eq!(
                note.event.frame_offset, 0,
                "delivery stamps the offset; the store carries zero"
            );
            assert_eq!(
                note.event.probability_cutoff, PROBABILITY_CUTOFF_RANGE,
                "an unstated probability always plays"
            );
            assert_eq!(
                note.event.project_probability_seed, MIDI_PROBABILITY_SEED,
                "the command's project seed is stamped on every note it maps"
            );
        }
    }

    /// The web carrier's twin is `matches the fixed cross-runtime tuple corpus`
    /// in `src/modules/MIDI/useCases/__tests__/shouldPlayMidiEvent.spec.ts`, and
    /// `daw_engine::midi_fx`'s `matches_the_cross_runtime_tuple_corpus` holds
    /// the same rows as bare rolls. The pair below is that corpus's
    /// `0xdecafbad` pair, which differs in the event identity alone.
    ///
    /// Here the tuple travels the wire instead of being called directly: the
    /// seed, the two hashes and the occurrence reach the store through
    /// `schedule-midi`, and the stated chance becomes the cutoff — so a note
    /// this command schedules sounds exactly when `shouldPlayMidiEvent` says
    /// the same note sounds in the browser.
    #[test]
    fn a_scheduled_chance_note_is_decided_as_the_web_carrier_decides_it() {
        use daw_engine::midi_fx::{deterministic_probability_roll, hash_probability_id};

        let samples = TimelineSamplePool::default();

        for (event_id, corpus_roll, web_carrier_plays_it) in [
            ("event-alpha", 283_418_835_u32, true),
            ("event-beta", 3_377_534_636_u32, false),
        ] {
            let mut registry = registry_with_hosted_device("t1", "d1");
            let batch = schedule_midi_batch(
                "t1",
                "d1",
                json!([{
                    "time": 0.0,
                    "note": 60,
                    "velocity": 100,
                    "channel": 0,
                    "isNoteOn": true,
                    "probability": 0.5,
                    "clipIdHash": hash_probability_id("clip-1"),
                    "eventIdHash": hash_probability_id(event_id),
                    "absoluteOccurrenceIndex": 0,
                }]),
            );

            let mapped = map_unbound_batch(&batch, &mut registry, &samples, 48_000.0)
                .expect("a chance note on a registered hosted device maps");
            let GraphCommand::ScheduleMidiNotes { notes, .. } = &mapped.ops[0] else {
                panic!("schedule-midi must map onto ScheduleMidiNotes");
            };
            let event = &notes[0].event;

            let roll = deterministic_probability_roll(
                event.project_probability_seed,
                event.clip_id_hash,
                event.event_id_hash,
                event.absolute_occurrence_index,
            );
            assert_eq!(
                roll, corpus_roll,
                "the mapped note must roll the corpus stream for {event_id}"
            );
            assert_eq!(
                u64::from(roll) < event.probability_cutoff,
                web_carrier_plays_it,
                "the wire must decide {event_id} as the web carrier decides it"
            );
        }
    }

    /// A stated chance is a `0..=1` fraction on the wire and a percentage to
    /// the shared converter, which is the only spelling a MIDI FX chain knows.
    #[test]
    fn schedule_midi_maps_a_stated_probability_onto_the_shared_cutoff() {
        let samples = TimelineSamplePool::default();
        let chance_note = |probability: Value| -> Value {
            json!([{
                "time": 0.0, "note": 60, "velocity": 100, "channel": 0,
                "isNoteOn": true, "probability": probability,
            }])
        };

        let mut registry = registry_with_hosted_device("t1", "d1");
        let batch = schedule_midi_batch("t1", "d1", chance_note(json!(0.5)));
        let mapped = map_unbound_batch(&batch, &mut registry, &samples, 48_000.0)
            .expect("a stated chance maps");
        let GraphCommand::ScheduleMidiNotes { notes, .. } = &mapped.ops[0] else {
            panic!("schedule-midi must map onto ScheduleMidiNotes");
        };
        assert_eq!(
            notes[0].event.probability_cutoff,
            probability_percent_to_cutoff(50.0),
            "half a chance is fifty percent to the shared converter"
        );

        for outside in [1.5_f64, -0.1_f64] {
            let mut registry = registry_with_hosted_device("t1", "d1");
            let batch = schedule_midi_batch("t1", "d1", chance_note(json!(outside)));

            let refusal = map_unbound_batch(&batch, &mut registry, &samples, 48_000.0)
                .expect_err("a chance outside the fraction is refused");

            assert!(
                refusal.contains(&format!(
                    "schedule-midi: probability {outside} is outside 0..=1"
                )),
                "refusal must name the chance it read: {refusal}"
            );
        }
    }

    /// A built-in device is registered the way the topology fixtures register a
    /// Knead — through the `create-track-strip` that carries it — which is what
    /// puts it in the registry as a device the engine does not own, and so
    /// holding no note store.
    #[test]
    fn schedule_midi_refuses_a_device_holding_no_note_store() {
        let samples = sample_pool();
        let mut registry = GraphRegistry::default();
        map_unbound_batch(
            &batch(json!([{
                "kind": "create-track-strip",
                "trackId": "t1",
                "name": "Lead",
                "state": strip_state(1.0),
                "devices": [ { "id": "d-knead", "type": "knead", "bypassed": false,
                               "parameterValues": {} } ],
                "honorMuted": true,
                "contributesAudio": true
            }])),
            &mut registry,
            &samples,
            48_000.0,
        )
        .expect("a strip carrying a built-in maps");

        // Both commands refuse whole, which is this module's law: an `Err` is
        // the absence of a `MappedBatch`, so no op reached the engine and the
        // working registry clone the mapper was handed is discarded with it.
        let mut working = registry.clone();
        let refusal = map_unbound_batch(
            &schedule_midi_batch("t1", "d-knead", json!([note_at(0.0, 60, 0)])),
            &mut working,
            &samples,
            48_000.0,
        )
        .expect_err("a built-in has no note store to schedule into");
        assert!(
            refusal.contains("schedule-midi: device 'd-knead' holds no note store"),
            "refusal must name the device holding no note store: {refusal}"
        );

        let mut working = registry.clone();
        let refusal = map_unbound_batch(
            &midi_batch(json!([{
                "kind": "clear-midi",
                "trackId": "t1",
                "deviceId": "d-knead",
                "fromTime": 0.0,
                "toTime": Value::Null,
            }])),
            &mut working,
            &samples,
            48_000.0,
        )
        .expect_err("a built-in has no note store to clear");
        assert!(
            refusal.contains("clear-midi: device 'd-knead' holds no note store"),
            "refusal must name the device holding no note store: {refusal}"
        );
    }

    #[test]
    fn schedule_midi_refuses_a_note_the_store_cannot_address() {
        let samples = TimelineSamplePool::default();

        for (notes, expected) in [
            (
                json!([note_at(0.0, 60, 16)]),
                "channel 16 has no address in the note store",
            ),
            (
                json!([note_at(0.0, 128, 0)]),
                "note 128 has no address in the note store",
            ),
        ] {
            let mut registry = registry_with_hosted_device("t1", "d1");
            let batch = schedule_midi_batch("t1", "d1", notes);

            let refusal = map_unbound_batch(&batch, &mut registry, &samples, 48_000.0)
                .expect_err("a note the store cannot address is refused");

            assert!(
                refusal.contains(expected),
                "refusal must name the address: {refusal}"
            );
        }
    }

    #[test]
    fn schedule_midi_refuses_more_notes_than_the_store_holds() {
        let samples = TimelineSamplePool::default();
        let notes = |count: usize| -> Value {
            Value::Array(
                (0..count)
                    .map(|index| note_at(index as f64 / 48_000.0, 60, 0))
                    .collect(),
            )
        };

        let mut registry = registry_with_hosted_device("t1", "d1");
        let full = schedule_midi_batch("t1", "d1", notes(MIDI_NOTE_STORE_CAPACITY));
        let mapped = map_unbound_batch(&full, &mut registry, &samples, 48_000.0)
            .expect("a batch of exactly the store's capacity fits");
        assert_eq!(mapped.ops.len(), 1);

        let mut registry = registry_with_hosted_device("t1", "d1");
        let over = schedule_midi_batch("t1", "d1", notes(MIDI_NOTE_STORE_CAPACITY + 1));
        let refusal = map_unbound_batch(&over, &mut registry, &samples, 48_000.0)
            .expect_err("one note past the store's capacity is refused");
        assert!(
            refusal.contains(&format!(
                "past the store's ceiling of {MIDI_NOTE_STORE_CAPACITY}"
            )),
            "refusal must name the ceiling: {refusal}"
        );
    }

    #[test]
    fn schedule_midi_refuses_a_device_on_another_strip() {
        let mut registry = registry_with_hosted_device("t1", "d1");
        registry.strips.insert(
            "t2".to_string(),
            StripEntry {
                native_id: 2,
                kind: StripKind::Track,
                vca_multiplier: 1.0,
                contributes_audio: true,
                device_ids: Vec::new(),
                clip_count: 0,
                send_bus_ids: Vec::new(),
                output: StripOutput::Master,
            },
        );
        let samples = TimelineSamplePool::default();
        let batch = schedule_midi_batch("t2", "d1", json!([note_at(0.0, 60, 0)]));

        let refusal = map_unbound_batch(&batch, &mut registry, &samples, 48_000.0)
            .expect_err("a device held on another strip is refused");

        assert!(
            refusal.contains("schedule-midi: device 'd1' is not on strip 't2'"),
            "refusal must name the strip the device is not on: {refusal}"
        );
    }

    // ── Live MIDI ──────────────────────────────────────────────────────────

    /// One `send-midi-note` batch, spelled the way a producer spells one.
    fn send_midi_note_batch(
        track_id: &str,
        device_id: &str,
        note: u8,
        velocity: u8,
        channel: i16,
        is_note_on: bool,
    ) -> GraphBatchPayload {
        midi_batch(json!([{
            "kind": "send-midi-note",
            "trackId": track_id,
            "deviceId": device_id,
            "note": note,
            "velocity": velocity,
            "channel": channel,
            "isNoteOn": is_note_on,
        }]))
    }

    /// The one op a `send-midi-note` batch maps to, or a panic naming what it
    /// mapped to instead.
    fn only_note_op(ops: &[GraphCommand]) -> (usize, MidiNoteEvent) {
        assert_eq!(ops.len(), 1, "a live note is one op and nothing else");
        match &ops[0] {
            GraphCommand::SendMidiNote(plugin_id, event) => (*plugin_id, *event),
            _ => panic!("a live note must map onto SendMidiNote"),
        }
    }

    /// A live note reaches the engine as an immediate note op at the device's
    /// own plugin id, carrying the values the live path has always written:
    /// the always-plays cutoff, no arrangement identity, and no frame offset,
    /// because a key struck on a keyboard names no timeline position.
    #[test]
    fn send_midi_note_at_a_hosted_instrument_emits_one_immediate_note_op() {
        let mut registry = registry_with_hosted_device("t1", "d1");
        let batch = send_midi_note_batch("t1", "d1", 60, 100, 5, true);

        let mapped = map_unbound_batch(
            &batch,
            &mut registry,
            &TimelineSamplePool::default(),
            48_000.0,
        )
        .expect("a live note at a registered hosted device maps");

        let (plugin_id, event) = only_note_op(&mapped.ops);
        assert_eq!(plugin_id, MIDI_DEVICE_EFFECT_ID);
        assert_eq!(event.note, 60);
        assert_eq!(event.velocity, 100);
        assert_eq!(event.channel, 5);
        assert!(event.is_note_on);
        assert_eq!(event.frame_offset, 0);
        assert_eq!(event.probability_cutoff, PROBABILITY_CUTOFF_RANGE);
        assert_eq!(event.project_probability_seed, 0);
        assert_eq!(event.clip_id_hash, 0);
        assert_eq!(event.event_id_hash, 0);
        assert_eq!(event.absolute_occurrence_index, 0);
    }

    /// A built-in that sounds notes takes a live note on the same terms: the
    /// fermenter is registered holding a note store, which is what the mapping
    /// reads, and it is the one built-in a musician can play from a keyboard.
    #[test]
    fn send_midi_note_at_a_fermenter_emits_one_immediate_note_op() {
        let mut registry =
            registry_with_builtin_device("t1", "d-ferm", BuiltinEffectType::Fermenter);
        let batch = send_midi_note_batch("t1", "d-ferm", 48, 0, 0, false);

        let mapped = map_unbound_batch(
            &batch,
            &mut registry,
            &TimelineSamplePool::default(),
            48_000.0,
        )
        .expect("a live note at a built-in instrument maps");

        let (plugin_id, event) = only_note_op(&mapped.ops);
        assert_eq!(plugin_id, IMMEDIATE_PARAM_EFFECT_ID);
        assert_eq!(event.note, 48);
        assert_eq!(event.velocity, 0);
        assert_eq!(event.channel, 0);
        assert!(!event.is_note_on, "the release travels as itself");
        assert_eq!(event.frame_offset, 0);
        assert_eq!(event.probability_cutoff, PROBABILITY_CUTOFF_RANGE);
    }

    /// A built-in effect sounds no notes and is registered with no store, so a
    /// live note aimed at one names a device that could never voice it.
    #[test]
    fn send_midi_note_at_a_knead_is_refused_holding_no_note_store() {
        let mut registry = registry_with_builtin_device("t1", "d-knead", BuiltinEffectType::Knead);
        let batch = send_midi_note_batch("t1", "d-knead", 60, 100, 0, true);

        let refusal = map_unbound_batch(
            &batch,
            &mut registry,
            &TimelineSamplePool::default(),
            48_000.0,
        )
        .expect_err("a built-in effect has no note store to sound a note through");

        assert!(
            refusal.contains("send-midi-note: device 'd-knead' holds no note store"),
            "refusal must name the device holding no note store: {refusal}"
        );
    }

    /// A live note names the strip its device is on, and a producer that lost
    /// track of which strip that is is told rather than played on the wrong one.
    #[test]
    fn send_midi_note_at_a_device_on_another_strip_is_refused() {
        let mut registry = registry_with_hosted_device("t1", "d1");
        registry.strips.insert(
            "t2".to_string(),
            StripEntry {
                native_id: 2,
                kind: StripKind::Track,
                vca_multiplier: 1.0,
                contributes_audio: true,
                device_ids: Vec::new(),
                clip_count: 0,
                send_bus_ids: Vec::new(),
                output: StripOutput::Master,
            },
        );
        let batch = send_midi_note_batch("t2", "d1", 60, 100, 0, true);

        let refusal = map_unbound_batch(
            &batch,
            &mut registry,
            &TimelineSamplePool::default(),
            48_000.0,
        )
        .expect_err("a device held on another strip is refused");

        assert!(
            refusal.contains("send-midi-note: device 'd1' is not on strip 't2'"),
            "refusal must name the strip the device is not on: {refusal}"
        );
    }

    /// A live note past MIDI's own range is refused control-side, naming the
    /// field and the value. The engine could only answer such a note as a count
    /// on the audio thread, and an unaddressable one is never tracked as
    /// sounding — so nothing would ever release the key it pressed.
    #[test]
    fn send_midi_note_past_the_midi_range_is_refused_naming_field_and_value() {
        for (note, velocity, expected) in [
            (
                128,
                100,
                "send-midi-note: note 128 has no address in the note store",
            ),
            (60, 128, "send-midi-note: velocity 128 is outside 0..=127"),
        ] {
            let mut registry = registry_with_hosted_device("t1", "d1");
            let batch = send_midi_note_batch("t1", "d1", note, velocity, 0, true);

            let refusal = map_unbound_batch(
                &batch,
                &mut registry,
                &TimelineSamplePool::default(),
                48_000.0,
            )
            .expect_err("a note past MIDI's range is refused");

            assert!(
                refusal.contains(expected),
                "refusal must name the field and the value: {refusal}"
            );
        }
    }

    #[test]
    fn clear_midi_maps_a_half_open_window_and_an_open_end() {
        let samples = TimelineSamplePool::default();
        let clear = |from: Value, to: Value| -> GraphBatchPayload {
            midi_batch(json!([{
                "kind": "clear-midi",
                "trackId": "t1",
                "deviceId": "d1",
                "fromTime": from,
                "toTime": to,
            }]))
        };

        let mut registry = registry_with_hosted_device("t1", "d1");
        let mapped = map_unbound_batch(
            &clear(json!(1.0), json!(2.0)),
            &mut registry,
            &samples,
            48_000.0,
        )
        .expect("a bounded window maps");
        let GraphCommand::ClearMidiNotes {
            plugin_id,
            from_frame,
            to_frame,
        } = &mapped.ops[0]
        else {
            panic!("clear-midi must map onto ClearMidiNotes");
        };
        assert_eq!(*plugin_id, MIDI_DEVICE_EFFECT_ID);
        assert_eq!((*from_frame, *to_frame), (48_000, 96_000));

        let mut registry = registry_with_hosted_device("t1", "d1");
        let mapped = map_unbound_batch(
            &clear(json!(1.0), Value::Null),
            &mut registry,
            &samples,
            48_000.0,
        )
        .expect("an absent end maps");
        let GraphCommand::ClearMidiNotes { to_frame, .. } = &mapped.ops[0] else {
            panic!("clear-midi must map onto ClearMidiNotes");
        };
        assert_eq!(*to_frame, u64::MAX, "an absent end is the end of the store");

        // A stated `null` and an omitted key are one meaning: serde reads a
        // missing `Option` field as `None` on its own, so both spellings reach
        // the same arm. What this case pins is the wire's acceptance of the
        // shorter one — a producer that never writes the field at all is the
        // ordinary way to say "to the end of the store", and a later
        // tightening that made the field required would break it here rather
        // than against a producer.
        let mut registry = registry_with_hosted_device("t1", "d1");
        let mapped = map_unbound_batch(
            &midi_batch(json!([{
                "kind": "clear-midi",
                "trackId": "t1",
                "deviceId": "d1",
                "fromTime": 1.0,
            }])),
            &mut registry,
            &samples,
            48_000.0,
        )
        .expect("a command that omits the end maps");
        let GraphCommand::ClearMidiNotes { to_frame, .. } = &mapped.ops[0] else {
            panic!("clear-midi must map onto ClearMidiNotes");
        };
        assert_eq!(
            *to_frame,
            u64::MAX,
            "an omitted end is the end of the store, exactly as a null one is"
        );

        let mut registry = registry_with_hosted_device("t1", "d1");
        let refusal = map_unbound_batch(
            &clear(json!(2.0), json!(1.0)),
            &mut registry,
            &samples,
            48_000.0,
        )
        .expect_err("a window that ends before it starts is refused");
        assert!(
            refusal.contains("clear-midi: window 96000..48000 ends before it starts"),
            "refusal must name the window: {refusal}"
        );
    }

    // ── The live producer's batch, against the real mapper ─────────────────

    fn replacing_batch(commands: Value) -> GraphBatchPayload {
        serde_json::from_value(
            json!({ "schemaVersion": 1, "replaceTopology": true, "commands": commands }),
        )
        .expect("the test batch should deserialize")
    }

    /// What `projectLiveGraphTopology` builds for a session holding one soloed
    /// track — carrying a hosted plugin and a built-in — one send bus, and one
    /// track the solo is gating.
    ///
    /// The routes are the ones a default session really produces, not the
    /// simplest ones that map: every added track's stored output is the master
    /// track, so an ordinary track — and a bus — routes at that *track* strip
    /// and runs through its device chain.
    fn live_topology_commands() -> Value {
        json!([
            {
                "kind": "create-track-strip",
                "trackId": "master",
                "name": "Master",
                "state": { "gain": 0.8, "pan": 0, "muted": false, "soloGated": false, "vcaMultiplier": 1 },
                "devices": [],
                "honorMuted": true,
                "contributesAudio": false
            },
            {
                "kind": "create-track-strip",
                "trackId": "lead",
                "name": "Lead",
                "state": { "gain": 0.8, "pan": 0, "muted": false, "soloGated": false, "vcaMultiplier": 1 },
                "devices": [
                    { "id": "d-plugin", "name": "Pro-Q", "type": "plugin", "bypassed": false,
                      "parameterValues": {},
                      "externalPluginId": "com.fabfilter.proq", "externalInstanceId": "inst-1" },
                    { "id": "d-knead", "name": "Knead", "type": "knead", "bypassed": false,
                      "parameterValues": {} }
                ],
                "honorMuted": true,
                "contributesAudio": false
            },
            {
                "kind": "create-track-strip",
                "trackId": "gated",
                "name": "Pads",
                "state": { "gain": 0.7, "pan": 10, "muted": false, "soloGated": true, "vcaMultiplier": 1 },
                "devices": [],
                "honorMuted": true,
                "contributesAudio": false
            },
            {
                "kind": "create-bus-strip",
                "busId": "verb",
                "name": "Reverb",
                "state": { "gain": 0.9, "pan": -10, "muted": false, "soloGated": true, "vcaMultiplier": 1 },
                "devices": [
                    { "id": "d-bus-plugin", "name": "Valhalla", "type": "plugin", "bypassed": false,
                      "parameterValues": {},
                      "externalPluginId": "com.valhalla.room", "externalInstanceId": "inst-2" },
                    { "id": "d-bus-knead", "name": "Knead", "type": "knead", "bypassed": false,
                      "parameterValues": {} }
                ],
                "honorMuted": true,
                "contributesAudio": false
            },
            { "kind": "set-track-output", "trackId": "master", "target": { "kind": "master" } },
            { "kind": "set-track-output", "trackId": "lead", "target": { "kind": "track", "trackId": "master" } },
            { "kind": "set-track-output", "trackId": "gated", "target": { "kind": "track", "trackId": "master" } },
            { "kind": "set-track-output", "trackId": "verb", "target": { "kind": "track", "trackId": "master" } },
            { "kind": "add-send", "trackId": "lead", "busId": "verb", "tap": "post-fader", "level": 0.4 },
            { "kind": "set-transport", "playing": true, "positionSeconds": 0 }
        ])
    }

    /// The acceptance the live producer needs and could not get from its own
    /// output shape: the batch a play gesture sends must map, and the batch the
    /// *next* play sends must map against the registry the first one left.
    ///
    /// Two shapes are guarded structurally here, and each was reachable from an
    /// ordinary session: a hosted plugin anywhere in a chain, and simply
    /// pressing play twice. A bus that is itself solo-gated is ordinary too —
    /// the producer now sends that gate, and the mapper must take it. The
    /// fixture below reflects what the producer emits.
    #[test]
    fn a_live_topology_batch_maps_and_maps_again_over_itself() {
        let samples = sample_pool();
        let mut registry = GraphRegistry::default();

        let first = map_unbound_batch(
            &replacing_batch(live_topology_commands()),
            &mut registry,
            &samples,
            48_000.0,
        )
        .expect("the first play's topology should map");
        assert_eq!(
            first
                .reports
                .iter()
                .map(|report| report.id.as_str())
                .collect::<Vec<_>>(),
            vec!["master", "lead", "gated", "verb"],
            "every strip the batch created owes a report"
        );
        // The hosted plugins degraded; the built-ins are the realized devices.
        assert_eq!(first.reports[1].device_ids, vec!["d-knead".to_string()]);
        assert_eq!(first.reports[3].device_ids, vec!["d-bus-knead".to_string()]);

        let second = map_unbound_batch(
            &replacing_batch(live_topology_commands()),
            &mut registry,
            &samples,
            48_000.0,
        )
        .expect("a second play must not collide with the first play's strips");
        assert!(
            second
                .ops
                .iter()
                .any(|op| matches!(op, GraphCommand::RemoveTrack(_))),
            "a replacing batch tears the previous topology down"
        );
        assert_eq!(registry.track_count, 3);
        assert_eq!(registry.bus_count, 1);
    }

    /// The same producer batch once the engine holds both plugins: it must map,
    /// map again over itself, and this time realise the plugins in their chains
    /// beside the built-ins — on a track and on a bus, because the two splice
    /// through different engine commands.
    #[test]
    fn a_live_topology_batch_with_attached_plugins_binds_them_and_maps_again_over_itself() {
        let samples = sample_pool();
        let lookup = HashMap::from([
            (
                "inst-1".to_string(),
                EngineOwnedDevice {
                    engine_plugin_id: 1_007,
                    chain_kind: DeviceKind::Effect,
                },
            ),
            (
                "inst-2".to_string(),
                EngineOwnedDevice {
                    engine_plugin_id: 1_008,
                    chain_kind: DeviceKind::Effect,
                },
            ),
        ]);
        let mut registry = GraphRegistry::default();

        let first = map_batch(
            &replacing_batch(live_topology_commands()),
            &mut registry,
            &samples,
            48_000.0,
            &lookup,
        )
        .expect("the first play's topology should map");
        assert_eq!(
            first.reports[1].device_ids,
            vec!["d-plugin".to_string(), "d-knead".to_string()]
        );
        assert_eq!(
            first.reports[3].device_ids,
            vec!["d-bus-plugin".to_string(), "d-bus-knead".to_string()]
        );
        assert!(first.ops.iter().any(
            |op| matches!(op, GraphCommand::InsertTrackDevice { entry, .. }
                if entry.effect_id == 1_007)
        ));
        assert!(first.ops.iter().any(
            |op| matches!(op, GraphCommand::InsertBusDevice { entry, .. }
                if entry.effect_id == 1_008)
        ));

        let second = map_batch(
            &replacing_batch(live_topology_commands()),
            &mut registry,
            &samples,
            48_000.0,
            &lookup,
        )
        .expect("a second play must not collide with the first play's strips");
        // The teardown released both instances rather than retiring them, so
        // the second play binds the very same ids again.
        assert!(second.ops.iter().any(|op| matches!(
            op,
            GraphCommand::RemoveTrackDevice {
                effect_id: 1_007,
                ..
            }
        )));
        assert_eq!(
            second.reports[1].device_ids,
            vec!["d-plugin".to_string(), "d-knead".to_string()]
        );
        assert_eq!(registry.track_count, 3);
        assert_eq!(registry.bus_count, 1);
    }

    /// Assert one teardown arm: the strip holding a retired device is removed
    /// only after that retirement.
    ///
    /// Per strip, not across the whole teardown: a strip carrying no device is
    /// removed before another strip's devices are retired, and reading the first
    /// index of each kind would call that an ordering violation.
    fn assert_device_retired_before_its_strip(
        teardown: &[GraphCommand],
        retired_device_strip: impl Fn(&GraphCommand) -> Option<usize>,
        removes_strip: impl Fn(&GraphCommand, usize) -> bool,
        arm: &str,
    ) {
        let (retire_index, holder) = teardown
            .iter()
            .enumerate()
            .find_map(|(index, op)| retired_device_strip(op).map(|strip| (index, strip)))
            .unwrap_or_else(|| panic!("the {arm}'s built device must be retired"));
        let remove_index = teardown
            .iter()
            .position(|op| removes_strip(op, holder))
            .unwrap_or_else(|| panic!("the {arm} strip that held it must be removed"));
        assert!(
            retire_index < remove_index,
            "a {arm} device is retired while its strip still holds it, not after"
        );
    }

    /// A replaced topology must not strand what it built: an effect whose strip
    /// is removed without it stays registered in the scheduler's shared table,
    /// detached, for the rest of the process.
    #[test]
    fn replacing_a_topology_retires_each_chain_device_before_its_strip() {
        let samples = sample_pool();
        let mut registry = GraphRegistry::default();
        map_unbound_batch(
            &replacing_batch(live_topology_commands()),
            &mut registry,
            &samples,
            48_000.0,
        )
        .expect("the first play's topology should map");

        let teardown = registry.take_topology_down();

        // Both arms, because they are separate code: a bus device mistyped onto
        // the track command would leak an effect-table slot per bus device per
        // play with the track assertion still green.
        assert_device_retired_before_its_strip(
            &teardown,
            |op| match op {
                GraphCommand::RemoveTrackDeviceRetired { track_id, .. } => Some(*track_id),
                _ => None,
            },
            |op, strip| matches!(op, GraphCommand::RemoveTrack(id) if *id == strip),
            "track",
        );
        assert_device_retired_before_its_strip(
            &teardown,
            |op| match op {
                GraphCommand::RemoveBusDeviceRetired { bus_id, .. } => Some(*bus_id),
                _ => None,
            },
            |op, strip| matches!(op, GraphCommand::RemoveBus(id) if *id == strip),
            "bus",
        );
        assert_eq!(registry.track_count, 0);
        assert_eq!(registry.bus_count, 0);
        assert!(registry.devices.is_empty());
    }

    /// The refusal the producer's send filter exists for. Bus into bus is
    /// ordinary practice and the project admits it, so the producer must drop
    /// such a send rather than let the mapper decline the batch that carries it.
    #[test]
    fn a_send_whose_source_is_a_bus_refuses_the_batch_with_the_distinct_reason() {
        let samples = sample_pool();
        let refusal = map_unbound_batch(
            &batch(json!([
                {
                    "kind": "create-bus-strip", "busId": "verb", "name": "Reverb",
                    "state": strip_state(0.9), "devices": [], "honorMuted": false,
                    "contributesAudio": false
                },
                {
                    "kind": "create-bus-strip", "busId": "squash", "name": "Parallel",
                    "state": strip_state(0.9), "devices": [], "honorMuted": false,
                    "contributesAudio": false
                },
                { "kind": "add-send", "trackId": "verb", "busId": "squash",
                  "tap": "post-fader", "level": 0.5 }
            ])),
            &mut GraphRegistry::default(),
            &samples,
            48_000.0,
        )
        .expect_err("a bus has no send tap natively");
        assert!(
            refusal.contains("bus-send-unsupported"),
            "the refusal names the unsupported shape, got: {refusal}"
        );
    }

    /// One strip carrying one hosted plugin device, parameterised on the two
    /// things the binding law turns on.
    fn hosted_plugin_strip(contributes_audio: bool, bypassed: bool) -> Value {
        json!([{
            "kind": "create-track-strip",
            "trackId": "lead",
            "name": "Lead",
            "state": strip_state(0.8),
            "devices": [
                { "id": "d-plugin", "name": "Pro-Q", "type": "plugin", "bypassed": bypassed,
                  "parameterValues": {},
                  "externalPluginId": "com.fabfilter.proq", "externalInstanceId": "inst-1" }
            ],
            "honorMuted": true,
            "contributesAudio": contributes_audio
        }])
    }

    /// The bus-strip counterpart of `hosted_plugin_strip`: one bus carrying
    /// one hosted plugin device, so the create-bus-strip `ChainEntry` site
    /// gets the same coverage the create-track-strip site already has.
    fn hosted_plugin_bus_strip(contributes_audio: bool) -> Value {
        json!([{
            "kind": "create-bus-strip",
            "busId": "verb",
            "name": "Reverb",
            "state": strip_state(0.9),
            "devices": [
                { "id": "d-bus-plugin", "name": "Valhalla", "type": "plugin", "bypassed": false,
                  "parameterValues": {},
                  "externalPluginId": "com.valhalla.room", "externalInstanceId": "inst-2" }
            ],
            "honorMuted": true,
            "contributesAudio": contributes_audio
        }])
    }

    /// One attached hosted plugin instance, at the engine plugin id the load
    /// reserved for it, splicing as a plain effect — the category every
    /// existing binding test is about.
    fn attached(instance_id: &str, engine_plugin_id: usize) -> HashMap<String, EngineOwnedDevice> {
        attached_as(instance_id, engine_plugin_id, DeviceKind::Effect)
    }

    /// The same attachment, at a chosen chain-splice kind — for the tests that
    /// are specifically about an instrument binding as a generator.
    fn attached_as(
        instance_id: &str,
        engine_plugin_id: usize,
        chain_kind: DeviceKind,
    ) -> HashMap<String, EngineOwnedDevice> {
        HashMap::from([(
            instance_id.to_string(),
            EngineOwnedDevice {
                engine_plugin_id,
                chain_kind,
            },
        )])
    }

    fn inserted_effect_ids(ops: &[GraphCommand]) -> Vec<usize> {
        ops.iter()
            .filter_map(|op| match op {
                GraphCommand::InsertTrackDevice { entry, .. }
                | GraphCommand::InsertBusDevice { entry, .. } => Some(entry.effect_id),
                _ => None,
            })
            .collect()
    }

    fn inserted_chain_kinds(ops: &[GraphCommand]) -> Vec<DeviceKind> {
        ops.iter()
            .filter_map(|op| match op {
                GraphCommand::InsertTrackDevice { entry, .. }
                | GraphCommand::InsertBusDevice { entry, .. } => Some(entry.kind),
                _ => None,
            })
            .collect()
    }

    /// An attached instance whose registry entry carries `Generator` — an
    /// instrument, scanned as such — splices in as one: the pushed
    /// `InsertTrackDevice`'s `ChainEntry.kind` must be `Generator`, or the
    /// clip it shares a strip with is what the splice replaces.
    #[test]
    fn an_engine_owned_instrument_inserts_as_a_generator() {
        let mapped = map_batch(
            &batch(hosted_plugin_strip(true, false)),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
            &attached_as("inst-1", 1_007, DeviceKind::Generator),
        )
        .expect("an attached instrument binds on a sounding strip");

        assert_eq!(
            inserted_chain_kinds(&mapped.ops),
            vec![DeviceKind::Generator]
        );
    }

    /// The same binding with a registry entry carrying `Effect` must splice as
    /// `Effect`, the way it always has — the two categories share `map_device`
    /// and must not become indistinguishable from each other by way of a
    /// dropped kind.
    #[test]
    fn an_engine_owned_effect_inserts_as_an_effect() {
        let mapped = map_batch(
            &batch(hosted_plugin_strip(true, false)),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
            &attached_as("inst-1", 1_007, DeviceKind::Effect),
        )
        .expect("an attached effect binds on a sounding strip");

        assert_eq!(inserted_chain_kinds(&mapped.ops), vec![DeviceKind::Effect]);
    }

    /// The create-bus-strip `ChainEntry` site (`map_command`'s `CreateBusStrip`
    /// arm) is a second, distinct call to `insert_device_op` from the
    /// create-track-strip one above — an attached instrument bound there must
    /// splice as `Generator` too, or a bus-hosted synth silently loses its
    /// category the moment it lands on a bus instead of a track.
    #[test]
    fn an_engine_owned_instrument_on_a_bus_inserts_as_a_generator() {
        let mapped = map_batch(
            &batch(hosted_plugin_bus_strip(true)),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
            &attached_as("inst-2", 1_007, DeviceKind::Generator),
        )
        .expect("an attached instrument binds on a sounding bus");

        assert_eq!(
            inserted_chain_kinds(&mapped.ops),
            vec![DeviceKind::Generator]
        );
    }

    /// The insert-device `ChainEntry` site (`map_command`'s `InsertDevice`
    /// arm) is the third, and the only one that splices onto a strip already
    /// built rather than one under construction — an attached instrument
    /// bound there must splice as `Generator` too.
    #[test]
    fn an_engine_owned_instrument_inserted_onto_a_built_strip_splices_as_a_generator() {
        let mut registry = GraphRegistry::default();
        map_unbound_batch(
            &batch(json!([track_strip("t1")])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("an empty strip should map");

        let mapped = map_batch(
            &batch(json!([
                { "kind": "insert-device", "trackId": "t1", "index": 0,
                  "device": { "id": "d-plugin", "name": "Pro-Q", "type": "plugin",
                              "bypassed": false, "parameterValues": {},
                              "externalPluginId": "com.fabfilter.proq",
                              "externalInstanceId": "inst-1" } }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
            &attached_as("inst-1", 1_007, DeviceKind::Generator),
        )
        .expect("an attached instrument binds via insert-device onto a built strip");

        assert_eq!(
            inserted_chain_kinds(&mapped.ops),
            vec![DeviceKind::Generator]
        );
    }

    /// An instance the engine does not hold cannot be spliced, so the device
    /// falls back on the degradation law: silent strips omit it, sounding ones
    /// refuse — there the missing device is a missing sound. The refusal names
    /// the instance, because "which plugin" is the only actionable part of it.
    #[test]
    fn a_hosted_plugin_the_engine_does_not_hold_degrades_silently_and_refuses_audibly() {
        let samples = sample_pool();

        let degraded = map_unbound_batch(
            &batch(hosted_plugin_strip(false, false)),
            &mut GraphRegistry::default(),
            &samples,
            48_000.0,
        )
        .expect("a strip that contributes no audio degrades what it cannot bind");
        assert_eq!(degraded.reports[0].device_ids, Vec::<String>::new());

        let refusal = map_unbound_batch(
            &batch(hosted_plugin_strip(true, false)),
            &mut GraphRegistry::default(),
            &samples,
            48_000.0,
        )
        .expect_err("a strip that contributes audio must refuse a device it cannot bind");
        assert!(
            refusal.contains("d-plugin")
                && refusal.contains("inst-1")
                && refusal.contains("not attached to the engine"),
            "the refusal names the device, the instance, and why, got: {refusal}"
        );
    }

    /// The binding itself. The device takes the instance's own engine plugin id
    /// — nothing is allocated and nothing is registered — and the strip splice
    /// names that id.
    #[test]
    fn a_hosted_plugin_the_engine_holds_is_spliced_onto_a_sounding_strip_by_its_own_id() {
        let mut registry = GraphRegistry::default();
        let mapped = map_batch(
            &batch(hosted_plugin_strip(true, false)),
            &mut registry,
            &sample_pool(),
            48_000.0,
            &attached("inst-1", 1_007),
        )
        .expect("an attached instance binds on a sounding strip");

        assert_eq!(mapped.reports[0].device_ids, vec!["d-plugin".to_string()]);
        assert_eq!(inserted_effect_ids(&mapped.ops), vec![1_007]);
        assert!(
            !mapped
                .ops
                .iter()
                .any(|op| matches!(op, GraphCommand::AddDetachedEffect(..))),
            "an engine-owned plugin is borrowed, never registered a second time"
        );
        assert!(
            !mapped
                .ops
                .iter()
                .any(|op| matches!(op, GraphCommand::SetParam(..))),
            "an external plugin's parameters travel on its own control path"
        );
        // The registry never allocated for it, so the next built device takes
        // the first graph effect id.
        assert_eq!(registry.next_effect_id, FIRST_GRAPH_EFFECT_ID);
    }

    /// An external plugin's parameter names are its own vocabulary, so the
    /// mapper must not hold them against `DeviceParam::from_name` the way it
    /// holds a built-in's — which would refuse the whole batch for a plugin
    /// whose knobs simply are not knead's.
    #[test]
    fn an_engine_owned_devices_parameter_names_are_not_held_against_the_builtin_vocabulary() {
        let strip = json!([{
            "kind": "create-track-strip",
            "trackId": "lead",
            "name": "Lead",
            "state": strip_state(0.8),
            "devices": [
                { "id": "d-plugin", "name": "Pro-Q", "type": "plugin", "bypassed": false,
                  "parameterValues": { "Band 1 Freq": 440.0, "Output Level": -3.0 },
                  "externalPluginId": "com.fabfilter.proq", "externalInstanceId": "inst-1" }
            ],
            "honorMuted": true,
            "contributesAudio": true
        }]);

        let mapped = map_batch(
            &batch(strip),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
            &attached("inst-1", 1_007),
        )
        .expect("a plugin's own parameter names must not refuse the batch");
        assert!(!mapped
            .ops
            .iter()
            .any(|op| matches!(op, GraphCommand::SetParam(..))));
    }

    /// Bypass is graph state and does reach the engine: it is the one thing on
    /// an engine-owned device the chain owns, because the chain is what skips
    /// the instance.
    #[test]
    fn a_bypassed_engine_owned_device_carries_its_bypass_to_the_engine() {
        let mapped = map_batch(
            &batch(hosted_plugin_strip(true, true)),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
            &attached("inst-1", 1_007),
        )
        .expect("a bypassed hosted plugin binds like any other");
        assert!(
            mapped
                .ops
                .iter()
                .any(|op| matches!(op, GraphCommand::SetBypass(1_007, true))),
            "the bypass must reach the effect the chain runs"
        );
    }

    /// A hosted plugin leaves a chain by being released, never retired: the
    /// instance belongs to the load that created it, and `unload_plugin` is
    /// what frees it. Retiring it here would take the effect out from under a
    /// panel, an editor and a parameter path all still holding the instance.
    #[test]
    fn removing_an_engine_owned_device_releases_the_effect_instead_of_retiring_it() {
        let mut registry = GraphRegistry::default();
        map_batch(
            &batch(hosted_plugin_strip(true, false)),
            &mut registry,
            &sample_pool(),
            48_000.0,
            &attached("inst-1", 1_007),
        )
        .expect("the strip binds");

        let removed = map_batch(
            &batch(json!([
                { "kind": "remove-device", "trackId": "lead", "deviceId": "d-plugin" }
            ])),
            &mut registry,
            &sample_pool(),
            48_000.0,
            &attached("inst-1", 1_007),
        )
        .expect("the removal maps");

        assert_eq!(
            removed
                .ops
                .iter()
                .filter(|op| matches!(
                    op,
                    GraphCommand::RemoveTrackDevice {
                        effect_id: 1_007,
                        ..
                    }
                ))
                .count(),
            1
        );
        assert!(
            !removed
                .ops
                .iter()
                .any(|op| matches!(op, GraphCommand::RemoveTrackDeviceRetired { .. })),
            "retiring an engine-owned effect would free a live plugin instance"
        );
        assert_eq!(removed.reports[0].device_ids, Vec::<String>::new());
    }

    /// The same law on the teardown path: a replacing batch tears every strip
    /// down, and an engine-owned device on one of them is released rather than
    /// retired — every play sends a replacing batch, so this is the ordinary
    /// route, not an edge.
    #[test]
    fn a_replacing_batch_releases_engine_owned_devices_and_retires_the_rest() {
        let lookup = attached("inst-1", 1_007);
        let mut registry = GraphRegistry::default();
        map_batch(
            &batch(json!([{
                "kind": "create-track-strip",
                "trackId": "lead",
                "name": "Lead",
                "state": strip_state(0.8),
                "devices": [
                    { "id": "d-plugin", "name": "Pro-Q", "type": "plugin", "bypassed": false,
                      "parameterValues": {},
                      "externalPluginId": "com.fabfilter.proq", "externalInstanceId": "inst-1" },
                    { "id": "d-knead", "name": "Knead", "type": "knead", "bypassed": false,
                      "parameterValues": {} }
                ],
                "honorMuted": true,
                "contributesAudio": true
            }])),
            &mut registry,
            &sample_pool(),
            48_000.0,
            &lookup,
        )
        .expect("the strip binds");

        let replaced = map_batch(
            &replacing_batch(json!([])),
            &mut registry,
            &sample_pool(),
            48_000.0,
            &lookup,
        )
        .expect("a replacing batch maps");

        assert!(replaced.ops.iter().any(|op| matches!(
            op,
            GraphCommand::RemoveTrackDevice {
                effect_id: 1_007,
                ..
            }
        )));
        assert!(
            replaced
                .ops
                .iter()
                .any(|op| matches!(op, GraphCommand::RemoveTrackDeviceRetired { .. })),
            "a device this registry built is still retired with its removal"
        );
    }

    /// An offline render has no engine, so it has no instances: the binding
    /// path cannot open there, and an external device on a sounding strip
    /// refuses exactly as it did before binding existed.
    #[test]
    fn an_offline_render_still_refuses_a_hosted_plugin_on_a_sounding_strip() {
        let Err(refusal) = map_offline_batch(
            &batch(hosted_plugin_strip(true, false)),
            &sample_pool(),
            48_000.0,
        ) else {
            panic!("an offline render holds no plugin instance to bind");
        };
        assert!(
            refusal.contains("not attached to the engine"),
            "the offline refusal is the unbound one, got: {refusal}"
        );
    }

    /// A strip carrying one bound hosted plugin, ready to be written at.
    fn registry_holding_a_bound_hosted_plugin() -> GraphRegistry {
        let mut registry = GraphRegistry::default();
        map_batch(
            &batch(hosted_plugin_strip(true, false)),
            &mut registry,
            &sample_pool(),
            48_000.0,
            &attached("inst-1", 1_007),
        )
        .expect("the strip binds");
        registry
    }

    fn hosted_parameter_write(parameter_id: &str) -> GraphBatchPayload {
        batch(json!([{
            "kind": "write-device-parameter",
            "target": { "kind": "device-parameter", "trackId": "lead",
                        "deviceId": "d-plugin", "parameterId": parameter_id },
            "write": { "shape": "step", "value": 0.5, "time": 1.0 }
        }]))
    }

    fn device_param_stamps(ops: &[GraphCommand]) -> Vec<(usize, DeviceParamTarget, f64, u64)> {
        ops.iter()
            .filter_map(|op| match op {
                GraphCommand::AutomateDeviceParam {
                    effect_id,
                    param,
                    value,
                    at_frame,
                } => Some((*effect_id, *param, *value, *at_frame)),
                _ => None,
            })
            .collect()
    }

    /// A hosted plugin's parameters are the plugin's own numeric ids, opaque to
    /// this module — so the mapper carries the id through rather than resolving
    /// it, and charges the same per-device window a built-in's stamp takes. An
    /// uncharged stamp would overrun the engine's fixed queue and be dropped
    /// render-side with nothing but a counter.
    #[test]
    fn a_hosted_parameter_write_maps_to_a_hosted_stamp() {
        let mut registry = registry_holding_a_bound_hosted_plugin();

        let mapped = map_batch(
            &hosted_parameter_write("42"),
            &mut registry,
            &sample_pool(),
            48_000.0,
            &attached("inst-1", 1_007),
        )
        .expect("a hosted plugin parameter is the graph's to stamp");

        assert_eq!(
            device_param_stamps(&mapped.ops),
            vec![(1_007, DeviceParamTarget::Hosted { id: 42 }, 0.5, 48_000)]
        );
        assert_eq!(
            registry.device_param_pending.get(&1_007).map(Vec::len),
            Some(1),
            "the stamp is charged against the device's pending window"
        );
    }

    /// Nothing here can check that the plugin exposes a given id, but it can
    /// check that the string is an id at all. A built-in's name, or a number
    /// past `u32`, would otherwise reach the audio thread as a stamp no plugin
    /// can resolve — a write the producer believes landed and the mix never
    /// heard.
    #[test]
    fn a_hosted_parameter_write_refuses_a_non_numeric_id() {
        for parameter_id in ["shift_semitones", "4294967296"] {
            let mut registry = registry_holding_a_bound_hosted_plugin();

            let refusal = map_batch(
                &hosted_parameter_write(parameter_id),
                &mut registry,
                &sample_pool(),
                48_000.0,
                &attached("inst-1", 1_007),
            )
            .expect_err("a string that is not a parameter id must refuse");

            assert!(
                refusal.contains(parameter_id) && refusal.contains("hosted plugin parameter id"),
                "the refusal names the parameter and what it is not, got: {refusal}"
            );
        }
    }

    /// The built-in keeps its closed vocabulary. A device-parameter write at a
    /// knead device still resolves through `DeviceParam::from_name`, so the
    /// named and addressed paths cannot drift, and it must not fall into the
    /// hosted branch — where `shift_semitones` is only a string that fails to
    /// parse.
    #[test]
    fn a_knead_parameter_write_still_maps_to_the_builtin() {
        let mut registry = GraphRegistry::default();
        map_unbound_batch(
            &batch(json!([{
                "kind": "create-track-strip",
                "trackId": "t1",
                "name": "Lead",
                "state": strip_state(1.0),
                "devices": [
                    { "id": "d-knead", "name": "Knead", "type": "knead", "bypassed": false,
                      "parameterValues": {} }
                ],
                "honorMuted": true,
                "contributesAudio": true
            }])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("a knead device has a native body");

        let mapped = map_unbound_batch(
            &batch(json!([{
                "kind": "write-device-parameter",
                "target": { "kind": "device-parameter", "trackId": "t1",
                            "deviceId": "d-knead", "parameterId": "shift_semitones" },
                "write": { "shape": "step", "value": 0.5, "time": 1.0 }
            }])),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("a knead parameter is written through the graph");

        let stamps = device_param_stamps(&mapped.ops);
        assert_eq!(stamps.len(), 1);
        assert_eq!(
            (stamps[0].1, stamps[0].2, stamps[0].3),
            (
                DeviceParamTarget::Builtin(DeviceParam::ShiftSemitones),
                0.5,
                48_000
            )
        );
    }

    /// The batch sizes rings that live as long as the process, so its length is
    /// bounded by what a project can hold rather than by what a caller sends.
    #[test]
    fn a_batch_past_the_command_ceiling_refuses_whole() {
        let samples = sample_pool();
        let commands: Vec<Value> = (0..=MAX_BATCH_COMMANDS)
            .map(|_| json!({ "kind": "set-transport", "playing": false, "positionSeconds": 0 }))
            .collect();

        let refusal = map_unbound_batch(
            &batch(json!(commands)),
            &mut GraphRegistry::default(),
            &samples,
            48_000.0,
        )
        .expect_err("a batch past the ceiling must refuse");
        assert!(
            refusal.contains("past the ceiling"),
            "the refusal names the ceiling, got: {refusal}"
        );
    }

    /// The ceiling is a ceiling, not a limit one command below it. The refusal
    /// above holds identically whether the guard reads `>` or `>=`, so without
    /// this the bound could silently tighten and reject the largest batch a
    /// full project is entitled to send.
    #[test]
    fn a_batch_exactly_at_the_command_ceiling_maps() {
        let samples = sample_pool();
        let commands: Vec<Value> = (0..MAX_BATCH_COMMANDS)
            .map(|_| json!({ "kind": "set-transport", "playing": false, "positionSeconds": 0 }))
            .collect();

        let mapped = map_unbound_batch(
            &batch(json!(commands)),
            &mut GraphRegistry::default(),
            &samples,
            48_000.0,
        )
        .expect("a batch exactly at the ceiling must map");
        assert!(
            mapped.ops.len() >= MAX_BATCH_COMMANDS,
            "every admitted command owes at least its own op, got {}",
            mapped.ops.len()
        );
    }

    /// A maximal honest batch also carries mixer and device automation — one
    /// queue fill of `write-parameter` / `write-device-parameter` per strip
    /// target — so the ceiling is that product, not topology commands alone.
    #[test]
    fn max_batch_commands_includes_one_automation_fill_per_strip() {
        let topology = 2 + MAX_TRACK_SENDS + MAX_TRACK_DEVICES + MAX_TRACK_CLIPS;
        let automation = (4 + MAX_TRACK_SENDS) * AUTOMATION_QUEUE_CAPACITY
            + MAX_TRACK_DEVICES * DEVICE_PARAM_QUEUE_CAPACITY;
        assert_eq!(
            MAX_BATCH_COMMANDS,
            (MAX_TIMELINE_TRACKS + MAX_TIMELINE_BUSES) * (topology + automation)
        );
    }

    /// Session-replay concatenation packs already-accepted history into one
    /// `GraphBatchPayload`. Each original batch can sit under the ceiling
    /// while the concatenated prior does not — that is a transport fault for
    /// commands the process already took. Chunking the replay under the
    /// per-batch ceiling maps them; raising the ceiling to cover all history
    /// would unbounded-size the process-lifetime rings.
    #[test]
    fn map_graph_batch_replays_a_prior_past_the_command_ceiling() {
        let state = AppState::default();
        let transport = json!({ "kind": "set-transport", "playing": false, "positionSeconds": 0 });
        let strip_id = "t-remainder";
        let mut prior: Vec<Value> = (0..MAX_BATCH_COMMANDS).map(|_| transport.clone()).collect();
        prior.push(track_strip(strip_id));

        let result = block_on_test(map_graph_batch(
            json!(prior),
            json!({ "schemaVersion": 1, "commands": [fader_step(strip_id)] }),
            48_000.0,
            None,
            &state,
        ))
        .expect("a prior one command past the ceiling must still replay");

        assert_eq!(result["acceptance"], "accepted", "got: {result}");
        assert_eq!(result["application"], "applied", "got: {result}");
    }

    /// The engine bootstrap must not run under the engine mutex: it waits on a
    /// device stream, and the quit cascade claims that same mutex on the JS
    /// thread, where waiting stops the force-exit timer from ever firing.
    #[test]
    fn a_slot_is_filled_without_holding_its_lock_across_the_construction() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let slot: Mutex<Option<&'static str>> = Mutex::new(None);
        let free_during_construction = AtomicBool::new(false);

        let filled = start_into_empty_slot(&slot, || -> Result<&'static str, String> {
            // From another thread, because a same-thread `try_lock` against a
            // lock this thread holds has no defined answer. A held lock fails
            // this claim, which is the whole assertion.
            std::thread::scope(|scope| {
                scope.spawn(|| {
                    free_during_construction.store(slot.try_lock().is_ok(), Ordering::SeqCst);
                });
            });
            Ok("engine")
        });

        assert!(filled.is_ok(), "an empty slot should fill");
        assert!(
            free_during_construction.load(Ordering::SeqCst),
            "the slot's lock must be free while its value is being constructed"
        );
        assert_eq!(
            *slot.lock().expect("the slot is not poisoned"),
            Some("engine")
        );
    }

    /// Single boot is a property of the install, not of a caller's own
    /// serialization: a full slot never constructs a second value.
    #[test]
    fn a_full_slot_is_never_constructed_into() {
        let slot: Mutex<Option<&'static str>> = Mutex::new(Some("already running"));

        let filled = start_into_empty_slot(&slot, || -> Result<&'static str, String> {
            panic!("a full slot must not construct a second value")
        });

        assert!(filled.is_ok());
        assert_eq!(
            *slot.lock().expect("the slot is not poisoned"),
            Some("already running")
        );
    }

    /// A contributing strip carrying one device of the named type, spelled the
    /// way a project spells a built-in.
    fn strip_with_device(device_id: &str, device_type: &str, parameter_values: Value) -> Value {
        json!([{
            "kind": "create-track-strip",
            "trackId": "t1",
            "name": "Lead",
            "state": strip_state(1.0),
            "devices": [ { "id": device_id, "type": device_type, "bypassed": false,
                           "parameterValues": parameter_values } ],
            "honorMuted": true,
            "contributesAudio": true
        }])
    }

    /// The effect ids a mapping registered a body under, in the order it
    /// registered them. `GraphCommand` carries no `Debug`, so the ids are what
    /// a spec compares two mappings by.
    fn registered_effect_ids(ops: &[GraphCommand]) -> Vec<usize> {
        ops.iter()
            .filter_map(|op| match op {
                GraphCommand::AddDetachedEffect(effect_id, _, _) => Some(*effect_id),
                _ => None,
            })
            .collect()
    }

    fn builtin_param_writes(ops: &[GraphCommand]) -> Vec<(DeviceParam, f32)> {
        ops.iter()
            .filter_map(|op| match op {
                GraphCommand::SetParam(_, param, value) => Some((*param, *value)),
                _ => None,
            })
            .collect()
    }

    /// A fermenter device is registered as a built-in instrument: it carries a
    /// note store of its own, and it splices onto the chain as a `Generator`.
    ///
    /// Both halves are what make it an instrument rather than an insert. A
    /// registration with no store leaves a device nothing can ever be
    /// scheduled at, and an `Effect` splice runs the instrument over the
    /// strip's signal in place instead of summing its output into the chain.
    #[test]
    fn a_fermenter_device_registers_holding_a_note_store_and_splices_as_a_generator() {
        let mapped = map_unbound_batch(
            &batch(strip_with_device("d-ferm", "fermenter", json!({}))),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect("a fermenter device has a native body");

        assert!(
            mapped.ops.iter().any(|op| matches!(
                op,
                GraphCommand::AddDetachedEffect(_, PluginCore::Fermenter(_), Some(_))
            )),
            "the fermenter is not registered as a built-in body holding a note store"
        );
        assert_eq!(
            inserted_chain_kinds(&mapped.ops),
            vec![DeviceKind::Generator],
            "an instrument spliced as an effect processes the strip instead of feeding it"
        );
    }

    /// A device type the engine can build nothing for refuses a contributing
    /// strip, and the refusal names both the device and the type it read.
    ///
    /// A strip that contributes audio is one the mix is short of if a device
    /// goes missing from it, so the batch refuses whole rather than degrading.
    /// The reason has to name the device and its type or the caller cannot
    /// tell which of a chain's devices the engine could not build.
    #[test]
    fn an_unbuildable_device_type_refuses_a_contributing_strip_naming_the_device_and_type() {
        let refusal = map_unbound_batch(
            &batch(strip_with_device("d-toaster", "toaster", json!({}))),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect_err("a type with no native body must refuse a contributing strip");

        assert!(
            refusal.contains("d-toaster") && refusal.contains("toaster"),
            "the refusal must name the device and the type it read, got: {refusal}"
        );
    }

    /// A fermenter on a contributing strip, handed one note at the top of the
    /// render, built with `parameter_values` as its patch.
    ///
    /// The mapper's own oracle for a patch: what the patch did to the instance
    /// is audible here, or the patch never reached it.
    fn render_patched_fermenter(parameter_values: Value) -> Vec<f32> {
        const SAMPLE_RATE: f32 = 48_000.0;
        const FRAMES: usize = 1_440;

        render_offline_batch(
            &midi_batch(json!([
                {
                    "kind": "create-track-strip",
                    "trackId": "t1",
                    "name": "Lead",
                    "state": strip_state(1.0),
                    "devices": [ { "id": "d-ferm", "type": "fermenter", "bypassed": false,
                                   "parameterValues": parameter_values } ],
                    "honorMuted": true,
                    "contributesAudio": true
                },
                {
                    "kind": "schedule-midi",
                    "trackId": "t1",
                    "deviceId": "d-ferm",
                    "probabilitySeed": MIDI_PROBABILITY_SEED,
                    "notes": [ note_at(0.0, 60, 0) ],
                }
            ])),
            &sample_pool(),
            FRAMES,
            SAMPLE_RATE,
        )
        .expect("a fermenter renders offline")
    }

    /// A fermenter's patch is written into the instance on the mapping thread
    /// and no `SetParam` command carries any of it.
    ///
    /// A patch is dozens of the instrument's own parameters per strip and the
    /// command ring is finite, so a patch sent as commands would spend the
    /// ring on one device. The render is what says the patch was applied
    /// rather than merely not sent: `cutoff` is the filter cutoff, so a patch
    /// that reached nothing renders the samples an unpatched instrument does.
    #[test]
    fn a_fermenter_patch_is_applied_control_side_and_carries_no_set_param_op() {
        let mapped = map_unbound_batch(
            &batch(strip_with_device(
                "d-ferm",
                "fermenter",
                json!({ "cutoff": 0.2 }),
            )),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect("one of the instrument's own names is a fermenter parameter address");

        assert!(
            builtin_param_writes(&mapped.ops).is_empty(),
            "the fermenter's patch was sent over the command ring: {:?}",
            builtin_param_writes(&mapped.ops)
        );
        assert_ne!(
            render_patched_fermenter(json!({ "cutoff": 0.2 })),
            render_patched_fermenter(json!({})),
            "the patch never reached the instance the mapper built"
        );
    }

    /// A patch's per-layer writes reach the layer the patch selects, however
    /// the layer-management keys arrive in the record.
    ///
    /// `parameterValues` is a `HashMap`, so its order is arbitrary and the
    /// mapper cannot choose it. The patch widens the instrument to two layers
    /// and then selects the third, which is outside the rendered set: every
    /// layer is built identically, so a cutoff written to one rendered layer
    /// or another sums to the same signal and no ordering could be observed —
    /// selected outside it, the cutoff is inaudible when it is routed and
    /// audible when it lands on layer 0 instead.
    #[test]
    fn a_fermenter_patch_routes_its_writes_to_the_layer_it_selects() {
        /// Draws of the three-key patch. A `HashMap` seeds its iteration order
        /// per instance, so a single draw would read the layer-management keys
        /// before `cutoff` only some of the time — and a mapper that applied
        /// the patch in arrival order would pass a share of its runs.
        const DRAWS: usize = 16;

        let selection_only = render_patched_fermenter(json!({
            "num_layers": 2, "active_layer": 2
        }));
        let cutoff_on_a_rendered_layer =
            render_patched_fermenter(json!({ "num_layers": 2, "cutoff": 0.2 }));

        assert_ne!(
            cutoff_on_a_rendered_layer, selection_only,
            "the cutoff is inaudible even on a layer that renders, so the agreement below \
             proves nothing"
        );
        for draw in 0..DRAWS {
            assert_eq!(
                render_patched_fermenter(json!({
                    "num_layers": 2, "active_layer": 2, "cutoff": 0.2
                })),
                selection_only,
                "draw {draw}: the patch wrote the cutoff to a different layer from the one it \
                 selects"
            );
        }
    }

    /// A parameter key the body cannot map degrades a non-contributing strip
    /// exactly as a device with no native body does: the device is omitted,
    /// and the rest of the strip maps as though it had never been sent.
    ///
    /// The two vocabularies refuse on different grounds — the fermenter's by
    /// shape, knead's against the closed set the engine names — and both are
    /// reachable from what a project really ships: a fermenter carries its
    /// camelCase descriptor ids from the moment it is created. A refusal here
    /// would take down a whole live session over a strip that contributes no
    /// audio at all.
    #[test]
    fn an_unmappable_parameter_on_a_non_contributing_strip_omits_the_device_like_a_missing_body() {
        let silent_strip = |devices: Value| {
            batch(json!([
                { "kind": "create-track-strip", "trackId": "t1", "name": "T",
                  "state": strip_state(1.0), "devices": devices,
                  "honorMuted": true, "contributesAudio": false }
            ]))
        };
        let map = |devices: Value| {
            map_unbound_batch(
                &silent_strip(devices),
                &mut GraphRegistry::default(),
                &sample_pool(),
                48_000.0,
            )
            .expect("a non-contributing strip maps")
        };
        let kept = json!({ "id": "d-keep", "type": "knead", "bypassed": false,
                           "parameterValues": {} });

        let without_the_device = map(json!([kept]));

        for unmappable in [
            json!({ "id": "d-ferm", "type": "fermenter", "bypassed": false,
                    "parameterValues": { "filterCutoff": 0.5 } }),
            json!({ "id": "d-knead", "type": "knead", "bypassed": false,
                    "parameterValues": { "shiftSemitones": 3.0 } }),
        ] {
            let degraded = map(json!([unmappable, kept]));

            assert_eq!(
                degraded.reports[0].device_ids, without_the_device.reports[0].device_ids,
                "the strip reports a device the mapper could not write to"
            );
            assert_eq!(
                registered_effect_ids(&degraded.ops),
                registered_effect_ids(&without_the_device.ops),
                "the omitted device still registered a body, or took an effect id from the \
                 device that follows it"
            );
            assert!(
                builtin_param_writes(&degraded.ops).is_empty(),
                "the omitted device still carried a parameter write"
            );
        }
    }

    /// A key shaped unlike one of the instrument's own parameter names refuses
    /// a contributing strip — the fixture's `contributesAudio` is `true` —
    /// naming the device and the key.
    ///
    /// The instrument answers a name it does not know by doing nothing at all,
    /// so a key that was never one of its names would otherwise be a write the
    /// producer believes landed and the mix never heard. Shape is the whole of
    /// the refusal the engine can make without keeping a copy of a table
    /// `daw-dsp` is free to extend: `Cutoff` is the display spelling of a
    /// parameter the instrument spells in lowercase, and a key past the wire's
    /// buffer would be truncated into a different word.
    #[test]
    fn a_fermenter_parameter_key_shaped_unlike_a_name_refuses_naming_the_device_and_key() {
        let too_long = "a".repeat(FERMENTER_PARAM_NAME_CAPACITY + 1);

        for key in ["Cutoff", too_long.as_str()] {
            let refusal = map_unbound_batch(
                &batch(strip_with_device(
                    "d-ferm",
                    "fermenter",
                    json!({ key.to_string(): 0.5 }),
                )),
                &mut GraphRegistry::default(),
                &sample_pool(),
                48_000.0,
            )
            .expect_err("a key shaped unlike one of the instrument's names must refuse");

            assert!(
                refusal.contains(key) && refusal.contains("d-ferm"),
                "the refusal must name the key and the device, got: {refusal}"
            );
        }
    }

    /// `schedule-midi` reaches a fermenter, which holds a note store, and still
    /// refuses a knead, which holds none.
    ///
    /// The note sink is the built-in's own property — whether it sounds notes —
    /// not whether the engine owns the device. Reading it off ownership alone
    /// would refuse every built-in instrument the mapper builds.
    #[test]
    fn schedule_midi_maps_at_a_fermenter_and_still_refuses_a_knead() {
        let samples = sample_pool();
        let mut registry = GraphRegistry::default();
        map_unbound_batch(
            &batch(json!([{
                "kind": "create-track-strip",
                "trackId": "t1",
                "name": "Lead",
                "state": strip_state(1.0),
                "devices": [
                    { "id": "d-ferm", "type": "fermenter", "bypassed": false,
                      "parameterValues": {} },
                    { "id": "d-knead", "type": "knead", "bypassed": false,
                      "parameterValues": {} }
                ],
                "honorMuted": true,
                "contributesAudio": true
            }])),
            &mut registry,
            &samples,
            48_000.0,
        )
        .expect("a strip carrying both built-ins maps");

        let mut working = registry.clone();
        let mapped = map_unbound_batch(
            &schedule_midi_batch("t1", "d-ferm", json!([note_at(0.0, 60, 0)])),
            &mut working,
            &samples,
            48_000.0,
        )
        .expect("a fermenter holds a note store to schedule into");
        assert!(
            mapped
                .ops
                .iter()
                .any(|op| matches!(op, GraphCommand::ScheduleMidiNotes { .. })),
            "the schedule never reached the engine as a note command"
        );

        let mut working = registry.clone();
        let refusal = map_unbound_batch(
            &schedule_midi_batch("t1", "d-knead", json!([note_at(0.0, 60, 0)])),
            &mut working,
            &samples,
            48_000.0,
        )
        .expect_err("a knead has no note store to schedule into");
        assert!(
            refusal.contains("schedule-midi: device 'd-knead' holds no note store"),
            "refusal must name the device holding no note store: {refusal}"
        );
    }

    /// An offline render of a fermenter sounds the note it was handed, on the
    /// frame that note was scheduled for.
    ///
    /// This is the whole slice end to end on the mapper's own oracle: the
    /// device is built, spliced as a generator, handed a store, given a note in
    /// seconds, and the returned PCM is silent until the frame that note
    /// converts to and carries signal after it.
    #[test]
    fn an_offline_fermenter_render_sounds_from_the_frame_its_note_was_scheduled_for() {
        const SAMPLE_RATE: f32 = 48_000.0;
        const ONSET_SECONDS: f64 = 0.01;
        const ONSET_FRAME: usize = 480;
        const FRAMES: usize = 1_440;

        let rendered = render_offline_batch(
            &midi_batch(json!([
                {
                    "kind": "create-track-strip",
                    "trackId": "t1",
                    "name": "Lead",
                    "state": strip_state(1.0),
                    "devices": [ { "id": "d-ferm", "type": "fermenter", "bypassed": false,
                                   "parameterValues": {} } ],
                    "honorMuted": true,
                    "contributesAudio": true
                },
                {
                    "kind": "schedule-midi",
                    "trackId": "t1",
                    "deviceId": "d-ferm",
                    "probabilitySeed": MIDI_PROBABILITY_SEED,
                    "notes": [ note_at(ONSET_SECONDS, 60, 0) ],
                }
            ])),
            &sample_pool(),
            FRAMES,
            SAMPLE_RATE,
        )
        .expect("a fermenter renders offline");

        // Interleaved stereo, so a frame is a pair.
        assert!(
            rendered[..ONSET_FRAME * 2]
                .iter()
                .all(|sample| *sample == 0.0),
            "the render carried signal before the note was scheduled for"
        );
        assert!(
            rendered[ONSET_FRAME * 2..]
                .iter()
                .any(|sample| *sample != 0.0),
            "the note never sounded in the offline render"
        );
    }
}
