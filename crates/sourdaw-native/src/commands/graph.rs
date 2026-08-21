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
//! This file is where the native chain stopped rendering only silence-plus-
//! bridged-plugins: a batch applied here builds timeline tracks, clips, buses,
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
//! pitch-at-speed semantics). The contract's own `playbackRate` must be `1`
//! in this slice: `TimelineClip` has nowhere to carry a stretch, so a
//! stretched clip is refused rather than played at unity behind the user's
//! back. Native varispeed is tracked in jcosta33/sourdaw#2219.
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
//! - A bus strip has no pan, no mute gate, no solo gate and no sends in
//!   `daw-engine`; batches that need them refuse with a reason naming the gap.
//! - `bus -> track` routing refuses with its own reason — the D3 obligation
//!   named at `AudioGraphBackend.ts` (routing constraint): buses are summed
//!   after every track, so the edge cannot carry audio today.

use crate::state::{AppState, TimelineSample};
use daw_engine::offline::OfflineRenderer;
use daw_engine::scheduler::{
    BuiltinEffectType, GraphCommand, GraphProgressSnapshot, EFFECT_TABLE_CAPACITY,
};
use daw_engine::timeline::{
    AutomationEvent, AutomationTarget, AutomationWrite, ChainEntry, ClipFade, ClipPlacement,
    ClipPlayback, DeviceKind, DeviceParam, RampShape, RouteTarget, TimelineBus, TimelineClip,
    TimelineRtDiagnosticsSnapshot, TimelineTrack, AUTOMATION_QUEUE_CAPACITY,
    DEVICE_PARAM_QUEUE_CAPACITY, MAX_BUS_DEVICES, MAX_TIMELINE_BUSES, MAX_TIMELINE_TRACKS,
    MAX_TRACK_CLIPS, MAX_TRACK_DEVICES, MAX_TRACK_SENDS,
};
use daw_engine::GraphBatchError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// The fader ceiling, as a linear amplitude — the same product invariant as
/// `FADER_MAX_GAIN` in `src/utils/audioLevelLaw.ts`: the track fader tops out
/// at unity and there is no make-up gain above it, so a stored gain above
/// unity must not render louder than it plays back.
const FADER_MAX_GAIN: f32 = 1.0;

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

// ── Wire payloads (hand-maintained mirror of AudioGraphBackend.ts) ─────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphBatchPayload {
    pub schema_version: u32,
    #[serde(default)]
    pub correlation: Option<Value>,
    pub commands: Vec<GraphCommandPayload>,
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
    #[serde(rename_all = "camelCase")]
    ScheduleClip { playback: ClipPlaybackPayload },
    #[serde(rename_all = "camelCase")]
    SetTransport {
        playing: bool,
        position_seconds: f64,
    },
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
/// backend and ignored; a device bound to an externally hosted plugin refuses
/// in this slice — plugin chain binding is a later D3 slice.
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reports: Option<Vec<StripReportPayload>>,
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
            reports: None,
        }
    }

    fn applied(
        correlation: Option<Value>,
        runtime_revision: u64,
        reports: Vec<StripReportPayload>,
    ) -> Self {
        Self {
            acceptance: "accepted",
            application: "applied",
            reason: None,
            compensation: None,
            correlation,
            runtime_revision: Some(runtime_revision),
            reports: Some(reports),
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
            reports: Some(reports),
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
            reports: Some(reports),
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
/// what the engine's progress echo **proves** has left its queue —
/// admitted-batch and stamp both behind the echoed horizon. The echo lags
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

impl GraphRegistry {
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
    /// this registry has recorded. The engine refuses cycles too, but its
    /// refusal is a counted drop on the audio thread; the contract demands the
    /// *batch* refuse instead, so the walk happens here first.
    fn would_cycle(&self, from: &StripEntry, target: StripOutput) -> bool {
        let mut current = target;
        let mut hops = 0usize;
        let limit = MAX_TIMELINE_TRACKS + MAX_TIMELINE_BUSES;
        while hops <= limit {
            let next_native = match current {
                StripOutput::Master => return false,
                StripOutput::Track(native_id) | StripOutput::Bus(native_id) => native_id,
            };
            if next_native == from.native_id {
                return true;
            }
            let Some(next) = self
                .strips
                .values()
                .find(|entry| entry.native_id == next_native)
            else {
                return false;
            };
            current = next.output;
            hops += 1;
        }
        true
    }

    /// Subtract from the ledger exactly what the engine's progress echo
    /// proves has left its fixed queue — never a count, always a per-stamp
    /// proof, because a stamp the ledger's own mirrored cancellations already
    /// removed must not release a second slot.
    ///
    /// The proof is the echo's happens-before guarantee
    /// ([`GraphProgressSnapshot`]): a write is gone from its engine queue
    /// once its admitting fenced batch is at or behind the echoed batch
    /// horizon **and** its stamp sits strictly before the echoed playhead.
    /// Strictly — a stamp at the playhead itself is not yet proven popped.
    /// Both queue kinds pop by that law every rendered block, playing or
    /// stopped: `RampedParam` frees a slot when the playhead reaches a
    /// write's start frame, `DeviceParamQueue` pops everything due within
    /// the block. A stale echo, an engine restart, or a stamp the engine
    /// dropped by a law with no mirror here (a foreign seek, a stop-edge
    /// hold) all degrade the same direction: the stamp stays charged and the
    /// ledger over-refuses until a later echo — never under-refuses.
    fn release_landed(&mut self, progress: GraphProgressSnapshot) {
        let proven_landed = |admitted_batch: u64, at_frame: u64| {
            admitted_batch <= progress.batches_applied && at_frame < progress.playhead_frame
        };
        self.automation_pending.retain(|_, queued| {
            queued.retain(|stamp| !proven_landed(stamp.admitted_batch, stamp.at_frame));
            !queued.is_empty()
        });
        self.device_param_pending.retain(|_, queued| {
            queued.retain(|stamp| !proven_landed(stamp.admitted_batch, stamp.at_frame));
            !queued.is_empty()
        });
    }
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
}

/// One device-parameter change the ledger believes a device's pending window
/// still holds. Device queues have no cancellation laws to mirror — no
/// replace, no locate ([`daw_engine::timeline::DeviceParamQueue`]) — so the
/// only way a stamp leaves is the progress echo proving it popped.
#[derive(Clone, Copy, Debug)]
struct DeviceParamStamp {
    at_frame: u64,
    admitted_batch: u64,
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
}

impl QueueBudgets {
    fn seeded_from(registry: &GraphRegistry) -> Self {
        Self {
            automation: registry.automation_pending.clone(),
            device_params: registry.device_param_pending.clone(),
            charging_batch: registry.batches_sent + 1,
        }
    }

    fn charge_automation(
        &mut self,
        target: AutomationTarget,
        write: &AutomationWrite,
    ) -> Result<(), String> {
        let queued = self.automation.entry(target).or_default();
        let (start, lands_at) = match write {
            AutomationWrite::Append(event) | AutomationWrite::Replace(event) => (
                event.at_frame,
                event
                    .at_frame
                    .saturating_add(u64::from(event.duration_frames)),
            ),
            AutomationWrite::Hold { at_frame } => (*at_frame, *at_frame),
        };
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

fn finite(value: f64, what: &str) -> Result<f64, String> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(format!("{what} is not a finite number"))
    }
}

fn seconds_to_frames(seconds: f64, sample_rate: f32, what: &str) -> Result<u64, String> {
    let seconds = finite(seconds, what)?;
    if seconds < 0.0 {
        return Err(format!("{what} is negative"));
    }
    Ok((seconds * f64::from(sample_rate)).round() as u64)
}

fn frames_u32(frames: u64, what: &str) -> Result<u32, String> {
    u32::try_from(frames).map_err(|_| format!("{what} does not fit a ramp span"))
}

/// The fader law: VCA folds in *before* the clamp (the composition order the
/// live strip uses), the ceiling is unity, the floor a hard zero.
fn fader_gain(stored_gain: f64, vca_multiplier: f32) -> Result<f32, String> {
    let stored = finite(stored_gain, "gain")?;
    if stored < 0.0 {
        return Err("gain is negative".to_string());
    }
    let folded = stored as f32 * vca_multiplier;
    if !(folded > 0.0) {
        return Ok(0.0);
    }
    Ok(folded.min(FADER_MAX_GAIN))
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

/// What one device maps onto natively. The scheduler's only built-in is the
/// Knead engine; everything else in the project's native-DSP vocabulary is a
/// WASM device the web runtime realises, with no `daw-engine` body yet.
fn map_device(
    device: &DevicePayload,
    registry: &mut GraphRegistry,
    contributes_audio: bool,
    ops: &mut Vec<GraphCommand>,
) -> Result<Option<usize>, String> {
    if device.external_instance_id.is_some() || device.external_plugin_id.is_some() {
        return Err(format!(
            "device '{}' is an externally hosted plugin; plugin chain binding is not part of this \
             slice",
            device.id
        ));
    }
    if registry.devices.contains_key(&device.id) {
        return Err(format!("device id '{}' is already in a chain", device.id));
    }
    if !device.device_type.eq_ignore_ascii_case("knead") {
        if contributes_audio {
            return Err(format!(
                "device '{}' of type '{}' has no native realisation",
                device.id, device.device_type
            ));
        }
        // A strip built only to keep the routing graph faithful contributes
        // silence by construction, so a device it cannot build degrades:
        // omitted from the chain, and therefore absent from the strip report —
        // the observation the contract says a caller must read.
        return Ok(None);
    }

    // The built-in's parameters resolve through `DeviceParam::from_name`, the
    // same single mapping the engine's addressed `SetParam` applies. A knead
    // device carrying any other parameter name refuses control-side rather
    // than being counted as an unmapped call after the fact.
    for name in device.parameter_values.keys() {
        if DeviceParam::from_name(name).is_none() {
            return Err(format!(
                "device '{}' carries parameter '{}', which knead does not map",
                device.id, name
            ));
        }
    }

    // The scheduler's effect table is fixed at `EFFECT_TABLE_CAPACITY` and
    // every native device in the project — track chain or bus chain — holds
    // one of its slots, while the timeline admits far more chain slots than
    // that. Refusing at map time is what turns a device that would silently
    // vanish into one that reports it could not be added: the batch fails,
    // its working registry clone is discarded, and no chain entry is written.
    //
    // This bound covers the project's *devices* only, and it names the device
    // that hit it. The table is shared with engine-owned plugins and the
    // crumbs capture slot, so the complete ceiling is the engine's own ledger
    // — `EngineHandle::send_graph_batch` admits the whole batch against the
    // whole population before it publishes anything, and refuses it whole
    // otherwise. Whichever bound is tighter fires first; neither is the only
    // one, and neither may be widened into a second partial count.
    if registry.devices.len() == EFFECT_TABLE_CAPACITY {
        return Err(format!(
            "device '{}': the project holds its maximum of {EFFECT_TABLE_CAPACITY} native devices",
            device.id
        ));
    }
    let effect_id = registry.allocate_effect_id();
    // Detached, never `AddEffect`: commands cross the ring one at a time, so
    // a callback can drain between this registration and the chain splice
    // that follows it. An effect registered onto the master chain in that
    // window would render one block of the entire mix through a device the
    // batch put on one strip.
    ops.push(GraphCommand::AddDetachedEffect(
        effect_id,
        BuiltinEffectType::Knead,
    ));
    for (name, value) in &device.parameter_values {
        let param = DeviceParam::from_name(name)
            .expect("the validation above refused every name knead does not map");
        ops.push(GraphCommand::SetParam(
            effect_id,
            param,
            finite(*value, "device parameter value")? as f32,
        ));
    }
    if device.bypassed {
        ops.push(GraphCommand::SetBypass(effect_id, true));
    }
    Ok(Some(effect_id))
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
    match kind {
        StripKind::Track => GraphCommand::InsertTrackDevice {
            track_id: native_id,
            entry,
            index,
        },
        StripKind::Bus => GraphCommand::InsertBusDevice {
            bus_id: native_id,
            entry,
            index,
        },
    }
}

/// Record a strip whose report the batch owes, once, in first-touch order.
fn touch(touched: &mut Vec<String>, strip_id: &str) {
    if !touched.iter().any(|id| id == strip_id) {
        touched.push(strip_id.to_string());
    }
}

/// Map a whole batch. `registry` is the caller's working clone; on `Err`
/// nothing built here may be applied and the clone is discarded — including
/// the queue ledger, which is written back onto the clone only on success.
fn map_batch(
    batch: &GraphBatchPayload,
    registry: &mut GraphRegistry,
    samples: &HashMap<String, TimelineSample>,
    sample_rate: f32,
) -> Result<MappedBatch, String> {
    if batch.schema_version != 1 {
        return Err(format!(
            "unsupported schemaVersion {} (this backend speaks 1)",
            batch.schema_version
        ));
    }

    let mut ops = Vec::new();
    let mut touched: Vec<String> = Vec::new();
    let mut refusals: Vec<String> = Vec::new();
    let mut budgets = QueueBudgets::seeded_from(registry);

    for (index, command) in batch.commands.iter().enumerate() {
        if let Err(reason) = map_command(
            command,
            registry,
            samples,
            sample_rate,
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
    let reports = touched
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
        .collect();
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
    samples: &HashMap<String, TimelineSample>,
    sample_rate: f32,
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
                let Some(effect_id) = map_device(device, registry, *contributes_audio, ops)? else {
                    continue;
                };
                ops.push(insert_device_op(
                    StripKind::Track,
                    native_id,
                    ChainEntry {
                        effect_id,
                        kind: DeviceKind::Effect,
                    },
                    chain_index,
                ));
                registry.devices.insert(
                    device.id.clone(),
                    DeviceEntry {
                        native_effect_id: effect_id,
                        strip_id: track_id.clone(),
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
            if pan_position(state.pan)? != 0.0 {
                return Err(
                    "create-bus-strip: bus-pan-unsupported — the native bus strip has no panner"
                        .to_string(),
                );
            }
            if *honor_muted && state.muted {
                return Err(
                    "create-bus-strip: bus-mute-unsupported — the native bus strip has no mute gate"
                        .to_string(),
                );
            }
            if state.solo_gated {
                return Err(
                    "create-bus-strip: bus-solo-gate-unsupported — the native bus strip has no \
                     solo gate"
                        .to_string(),
                );
            }
            let gain = fader_gain(state.gain, vca)?;
            let native_id = registry.allocate_node_id();

            ops.push(GraphCommand::AddBus(TimelineBus::new(native_id)));
            push_automation(
                AutomationTarget::BusGain(native_id),
                immediate_write(gain),
                budgets,
                ops,
            )?;

            let mut built_device_ids = Vec::new();
            let mut chain_index = 0usize;
            for device in devices {
                let Some(effect_id) = map_device(device, registry, *contributes_audio, ops)? else {
                    continue;
                };
                ops.push(insert_device_op(
                    StripKind::Bus,
                    native_id,
                    ChainEntry {
                        effect_id,
                        kind: DeviceKind::Effect,
                    },
                    chain_index,
                ));
                registry.devices.insert(
                    device.id.clone(),
                    DeviceEntry {
                        native_effect_id: effect_id,
                        strip_id: bus_id.clone(),
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
            if strip.kind == StripKind::Bus {
                if matches!(output, StripOutput::Track(_)) {
                    // The refusal asymmetry named at AudioGraphBackend.ts's
                    // routing constraint: buses are summed after every track,
                    // so this edge cannot carry audio. Refusing the batch —
                    // with this reason, distinct from an unknown target — is
                    // the D3 obligation this slice takes; rendering bus->track
                    // is not.
                    return Err(format!(
                        "set-track-output: bus-to-track-routing-unsupported — strip '{track_id}' \
                         is a bus and daw-engine sums buses after tracks"
                    ));
                }
            }
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
            let Some(effect_id) = map_device(device, registry, strip.contributes_audio, ops)?
            else {
                return Ok(());
            };
            let insert_at = (*index as usize).min(strip.device_ids.len());
            ops.push(insert_device_op(
                strip.kind,
                strip.native_id,
                ChainEntry {
                    effect_id,
                    kind: DeviceKind::Effect,
                },
                insert_at,
            ));
            registry.devices.insert(
                device.id.clone(),
                DeviceEntry {
                    native_effect_id: effect_id,
                    strip_id: track_id.clone(),
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
            let device = registry
                .devices
                .get(device_id)
                .ok_or_else(|| format!("remove-device: unknown device '{device_id}'"))?
                .clone();
            if device.strip_id != *track_id {
                return Err(format!(
                    "remove-device: device '{device_id}' is not on strip '{track_id}'"
                ));
            }
            // Remove and retire in one engine command. A separate removal
            // followed by a retirement would return the effect to the master
            // insert chain for any block a callback rendered between the two,
            // running a deleted device over the whole mix.
            ops.push(match strip.kind {
                StripKind::Track => GraphCommand::RemoveTrackDeviceRetired {
                    track_id: strip.native_id,
                    effect_id: device.native_effect_id,
                },
                StripKind::Bus => GraphCommand::RemoveBusDeviceRetired {
                    bus_id: strip.native_id,
                    effect_id: device.native_effect_id,
                },
            });
            registry.devices.remove(device_id);
            // The retirement takes the device's `DeviceParamQueue` with it,
            // pending changes and all, and graph effect ids are never reused
            // (the allocator is monotonic) — so the ledger's window for this
            // effect is exactly gone, not guessed gone.
            budgets.device_params.remove(&device.native_effect_id);
            registry
                .strips
                .get_mut(track_id)
                .expect("strip fetched above")
                .device_ids
                .retain(|id| id != device_id);
            touch(touched, track_id);
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
            let param = match parameter_id.as_str() {
                "shift_semitones" => DeviceParam::ShiftSemitones,
                "retune_speed_ms" => DeviceParam::RetuneSpeedMs,
                "formant_preserve" => DeviceParam::FormantPreserve,
                other => {
                    return Err(format!(
                        "write-device-parameter: parameter '{other}' has no native address"
                    ))
                }
            };
            let StepWritePayload::Step { value, time } = write;
            let at_frame = seconds_to_frames(*time, sample_rate, "write-device-parameter time")?;
            budgets
                .charge_device_param(device.native_effect_id, at_frame)
                .map_err(|reason| format!("write-device-parameter: {reason}"))?;
            ops.push(GraphCommand::AutomateDeviceParam {
                effect_id: device.native_effect_id,
                param,
                value: finite(*value, "write-device-parameter value")? as f32,
                at_frame,
            });
            Ok(())
        }

        GraphCommandPayload::ScheduleClip { playback } => {
            map_schedule_clip(playback, registry, samples, sample_rate, ops)
        }

        GraphCommandPayload::SetTransport {
            playing,
            position_seconds,
        } => {
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
            ops.push(GraphCommand::SeekFrames(frame));
            // The ledger mirrors the locate it just queued: the engine's seek
            // drops every queued write stamped at or past the target.
            budgets.apply_seek(frame);
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
            if strip.kind == StripKind::Bus {
                return Err(format!(
                    "write-parameter: bus-mute-unsupported — strip '{track_id}' is a bus"
                ));
            }
            let closed = gate_step("track-mute-gate")?;
            ops.push(GraphCommand::SetTrackMute(strip.native_id, closed));
            return Ok(());
        }
        StripParameterTargetPayload::TrackSoloGate { track_id } => {
            let strip = strip_for(track_id)?;
            if strip.kind == StripKind::Bus {
                return Err(format!(
                    "write-parameter: bus-solo-gate-unsupported — strip '{track_id}' is a bus"
                ));
            }
            let closed = gate_step("track-solo-gate")?;
            ops.push(GraphCommand::SetTrackSoloGate(strip.native_id, closed));
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
            if strip.kind == StripKind::Bus {
                return Err(format!(
                    "write-parameter: bus-pan-unsupported — strip '{track_id}' is a bus and \
                         the native bus strip has no panner"
                ));
            }
            (
                strip,
                AutomationTarget::TrackPan(strip.native_id),
                |value, _| pan_position(value),
            )
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
    samples: &HashMap<String, TimelineSample>,
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
    if rate != 1.0 {
        // This backend does not implement stretch: `TimelineClip` has nowhere
        // to carry a rate, and a clip played at unity instead would bounce at
        // the wrong pitch and the wrong length without saying so. Refuse until
        // the engine can play one.
        return Err(format!(
            "schedule-clip: stretched-clip-unsupported — playbackRate {rate} refused because this \
             backend cannot stretch a clip yet"
        ));
    }
    // Rate *conversion* is not a stretch: material decoded at another rate is
    // read at material_rate / engine_rate source frames per rendered frame,
    // which preserves its pitch and its duration on this engine's clock.
    let effective_rate = sample.sample_rate / sample_rate;
    if !effective_rate.is_finite() || effective_rate <= 0.0 {
        return Err("schedule-clip: the sample's rate conversion is not renderable".to_string());
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
            if at > clip_end_frame {
                return Err("schedule-clip: fadeOut begins after the clip ends".to_string());
            }
            Some(frames_u32(clip_end_frame - at, "fadeOut span")?)
        }
    };

    let clip_id = registry.allocate_node_id();
    ops.push(GraphCommand::AddClip(
        native_track_id,
        TimelineClip::new(
            clip_id,
            sample.left.clone(),
            sample.right.clone(),
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
                playback_rate: effective_rate,
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
    let mut left = Vec::with_capacity(frames);
    let mut right = if channels == 2 {
        Vec::with_capacity(frames)
    } else {
        Vec::new()
    };
    for frame in pcm.chunks_exact(bytes_per_frame) {
        left.push(f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]));
        if channels == 2 {
            right.push(f32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]));
        }
    }

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

/// Apply one `AudioGraphCommandBatch` to the live native engine.
///
/// Lazy bootstrap (#1984): the engine starts here, on the first batch, and a
/// machine where it cannot start gets a `rejected` result whose reason says
/// so — never a crash and never a silent no-op. The batch is validated whole
/// against the registry before anything is pushed.
pub async fn apply_graph_commands(batch: Value, state: &AppState) -> Result<Value, String> {
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

    let mut engine_guard = state
        .engine
        .lock()
        .map_err(|error| format!("Failed to lock engine: {error}"))?;
    if engine_guard.is_none() {
        match daw_engine::EngineHandle::new() {
            Ok(handle) => *engine_guard = Some(handle),
            Err(error) => {
                return result_json(&GraphApplyResultPayload::rejected(format!(
                    "engine-not-running: {error}"
                )))
            }
        }
    }
    let engine = engine_guard.as_mut().expect("engine started above");

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
    let mapped = match map_batch(&batch, &mut working, &samples, engine.sample_rate()) {
        Ok(mapped) => mapped,
        Err(reason) => return result_json(&GraphApplyResultPayload::rejected(reason)),
    };

    // Whole-batch admission and visibility: `send_graph_batch` provisions a
    // command ring large enough for the batch when the current one is too
    // small, then publishes the batch behind a fence the audio callback
    // refuses to drain past until every command is visible — the engine
    // applies the batch whole or does not observe it at all. Only this
    // thread pushes onto the ring (the engine mutex is held).
    match engine.send_graph_batch(mapped.ops) {
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

    working.runtime_revision = registry_guard.runtime_revision + 1;
    let revision = working.runtime_revision;
    *registry_guard = working;
    result_json(&GraphApplyResultPayload::applied(
        correlation,
        revision,
        mapped.reports,
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

/// Map one batch against the graph a prior command sequence built — the
/// report wire of the offline seam, with nothing rendered.
///
/// This is how `createNativeOfflineGraphBackend.ts` gets strip reports and
/// refusals from the mapping that owns them instead of restating them
/// TS-side: `prior` is the backend's already-committed wire commands
/// (replayed as one synthetic batch onto a fresh registry, exactly the graph
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
                let replay = GraphBatchPayload {
                    schema_version: 1,
                    correlation: None,
                    commands: prior_commands,
                };
                map_batch(&replay, &mut registry, &samples, sample_rate as f32)
                    .map_err(|reason| format!("{PRIOR_FAULT_PREFIX}: {reason}"))?;
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
    let mapped = map_batch(&batch, &mut registry, &samples, sample_rate as f32);
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
    samples: &HashMap<String, TimelineSample>,
    sample_rate: f32,
) -> Result<Vec<GraphCommand>, String> {
    let mut registry = GraphRegistry::default();
    Ok(map_batch(batch, &mut registry, samples, sample_rate)?.ops)
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
    samples: &HashMap<String, TimelineSample>,
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

    fn sample_pool() -> HashMap<String, TimelineSample> {
        let mut samples = HashMap::new();
        samples.insert(
            "source-a".to_string(),
            TimelineSample {
                left: vec![0.5; 48_000],
                right: vec![0.5; 48_000],
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
                      "parameterValues": { "shift_semitones": 3.0 } }
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
            { "kind": "remove-device", "trackId": "t1", "deviceId": "d-knead" },
            { "kind": "remove-send", "trackId": "t1", "busId": "b1" },
            { "kind": "set-transport", "playing": true, "positionSeconds": 4.0 }
        ]));

        let mut registry = GraphRegistry::default();
        let mapped = map_batch(&batch, &mut registry, &sample_pool(), 48_000.0)
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
    }

    #[test]
    fn a_bus_routed_at_a_track_refuses_the_batch_with_the_distinct_reason() {
        let batch = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "create-bus-strip", "busId": "b1", "name": "B", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "set-track-output", "trackId": "b1", "target": { "kind": "track", "trackId": "t1" } }
        ]));

        let mut registry = GraphRegistry::default();
        let refusal = map_batch(&batch, &mut registry, &sample_pool(), 48_000.0)
            .expect_err("bus->track must refuse");

        assert!(
            refusal.contains("bus-to-track-routing-unsupported"),
            "the refusal must carry its own reason, got: {refusal}"
        );
        assert!(refusal.contains("commands[2]"));
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
        let refusal = map_batch(&batch, &mut working, &sample_pool(), 48_000.0)
            .expect_err("an unknown strip must refuse the batch");

        assert!(refusal.contains("commands[1]"));
        assert!(refusal.contains("unknown strip 'missing'"));
        // The working clone is discarded on refusal; the committed registry
        // never saw the valid half of the batch.
        assert!(registry.strips.is_empty());
    }

    #[test]
    fn a_stretched_clip_refuses_as_unsupported_and_a_missing_sample_refuses_by_name() {
        let stretched = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "schedule-clip", "playback": {
                "trackId": "t1", "source": { "sourceId": "source-a" },
                "startTime": 0, "sourceOffsetSeconds": 0, "durationSeconds": 1,
                "playbackRate": 1.5, "gain": 1, "fade": { "microFadeSeconds": 0 } } }
        ]));
        let refusal = map_batch(
            &stretched,
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect_err("a stretched clip must refuse");
        assert!(refusal.contains("stretched-clip-unsupported"));
        assert!(refusal.contains("1.5"));

        let unknown = batch(json!([
            { "kind": "create-track-strip", "trackId": "t1", "name": "T", "state": strip_state(1.0),
              "devices": [], "honorMuted": true, "contributesAudio": true },
            { "kind": "schedule-clip", "playback": {
                "trackId": "t1", "source": { "sourceId": "nowhere" },
                "startTime": 0, "sourceOffsetSeconds": 0, "durationSeconds": 1,
                "playbackRate": 1, "gain": 1, "fade": { "microFadeSeconds": 0 } } }
        ]));
        let refusal = map_batch(
            &unknown,
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect_err("an unregistered sample must refuse");
        assert!(refusal.contains("unknown sample 'nowhere'"));
    }

    #[test]
    fn material_at_another_rate_is_rate_converted_not_stretched() {
        let mut samples = HashMap::new();
        samples.insert(
            "half-rate".to_string(),
            TimelineSample {
                left: vec![0.5; 24_000],
                right: Vec::new(),
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

        let mapped = map_batch(&batch, &mut GraphRegistry::default(), &samples, 48_000.0)
            .expect("a rate-converted clip should map");

        // Half-rate material on a 48k engine reads 0.5 source frames per
        // rendered frame — conversion, with a contract stretch still refused.
        assert!(mapped.ops.iter().any(|op| matches!(
            op,
            GraphCommand::AddClip(_, clip) if clip.playback().playback_rate == 0.5
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
        let refusal = map_batch(
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
        let refusal = map_batch(
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

        let mapped = map_batch(
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
        map_batch(
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

        let degraded = map_batch(
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
        let inserted = map_batch(
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

        let removed = map_batch(
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

    /// Every native device the project holds — on any track or bus — occupies
    /// one slot of the scheduler's fixed effect table, and the timeline admits
    /// many more chain slots than that table has. The batch refuses past the
    /// ceiling and names it. The engine's own refusal cannot stand in for this
    /// one: it is a counter on the audio callback, so the chain splice that
    /// follows would land with no instance behind it and the batch would
    /// report a device the user cannot hear.
    #[test]
    fn a_device_past_the_project_wide_device_ceiling_refuses_the_batch() {
        let mut commands: Vec<Value> = Vec::new();
        let mut built = 0usize;
        let mut track = 0usize;
        while built < EFFECT_TABLE_CAPACITY {
            let count = MAX_TRACK_DEVICES.min(EFFECT_TABLE_CAPACITY - built);
            let devices: Vec<Value> = (0..count)
                .map(|index| {
                    json!({ "id": format!("d-{track}-{index}"), "type": "knead",
                            "bypassed": false, "parameterValues": {} })
                })
                .collect();
            commands.push(json!({
                "kind": "create-track-strip", "trackId": format!("t{track}"), "name": "T",
                "state": strip_state(1.0), "devices": devices,
                "honorMuted": true, "contributesAudio": true
            }));
            built += count;
            track += 1;
        }

        let mut registry = GraphRegistry::default();
        map_batch(
            &batch(json!(commands)),
            &mut registry,
            &sample_pool(),
            48_000.0,
        )
        .expect("a project that fills the table exactly must map");
        assert_eq!(registry.devices.len(), EFFECT_TABLE_CAPACITY);

        // A fresh strip, so the per-strip chain ceiling cannot be what
        // refuses: only the project-wide one is left to catch this.
        let overflow = batch(json!([
            { "kind": "create-track-strip", "trackId": format!("t{track}"), "name": "T",
              "state": strip_state(1.0),
              "devices": [ { "id": "d-overflow", "type": "knead", "bypassed": false,
                             "parameterValues": {} } ],
              "honorMuted": true, "contributesAudio": true }
        ]));
        let mut working = registry.clone();
        let refusal = map_batch(&overflow, &mut working, &sample_pool(), 48_000.0)
            .expect_err("a device past the project-wide ceiling must refuse the batch");

        assert!(
            refusal.contains(&EFFECT_TABLE_CAPACITY.to_string())
                && refusal.contains("native devices"),
            "the refusal must name the ceiling it hit, got: {refusal}"
        );
        // The committed registry never saw the refused batch, so the chain the
        // engine renders and the chain the registry believes in still agree.
        assert_eq!(registry.devices.len(), EFFECT_TABLE_CAPACITY);
        assert!(!registry.strips.contains_key(&format!("t{track}")));
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
        let refusal = map_batch(
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

        map_batch(
            &batch(Value::Array(commands)),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect("exactly the queue's capacity must map");
    }

    /// The ledger is per parameter, not per batch: full queues on two strips,
    /// on two parameters of one strip, and on a device queue beside them must
    /// not pool into one count — and the ninth device write must refuse on
    /// its own queue's law.
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

        map_batch(
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
        let refusal = map_batch(
            &batch(Value::Array(commands)),
            &mut GraphRegistry::default(),
            &sample_pool(),
            48_000.0,
        )
        .expect_err("the ninth pending device write must refuse the batch");
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
        map_batch(
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
        let refusal = map_batch(
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
        map_batch(
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
        samples: &HashMap<String, TimelineSample>,
    ) -> Result<(), String> {
        registry.release_landed(renderer.graph_progress());
        let mut working = registry.clone();
        let mapped = map_batch(&batch(commands), &mut working, samples, 48_000.0)?;
        send_mapped(renderer, mapped.ops);
        *registry = working;
        Ok(())
    }

    /// Debt 1+2's discriminating case: more sequential single-write batches
    /// than either fixed queue holds, against one device parameter and one
    /// automation parameter, with the engine draining between batches. Every
    /// batch admits, because the progress echo releases what landed — under
    /// the old monotonic ledger the ninth device write refused for the life
    /// of the session.
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
        let refusal = map_batch(
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

        let result = block_on_test(apply_graph_commands(stale, &state))
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
        let result = block_on_test(apply_graph_commands(malformed, &state))
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

        let result = block_on_test(apply_graph_commands(malformed, &state))
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
        assert_eq!(sample.left, vec![0.1, 0.2]);
        assert_eq!(sample.right, vec![-0.1, -0.2]);
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
            vec![StripReportPayload {
                kind: "track",
                id: "t1".to_string(),
                device_ids: vec!["d1".to_string()],
            }],
        ))
        .expect("applied serializes");
        assert_eq!(
            applied,
            concat!(
                r#"{"acceptance":"accepted","application":"applied","runtimeRevision":3,"#,
                r#""reports":[{"kind":"track","id":"t1","deviceIds":["d1"]}]}"#
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

        // `needs-reconcile` is the one variant carrying `compensation` and the
        // one nothing produces at runtime today, so only this pin proves its
        // spellings against the contract (`AudioGraphApplyResult`).
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
}
