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
//! `usize` node ids. Only a batch that maps completely is pushed, and it is
//! pushed only after checking the command ring has room for all of it, so the
//! engine never receives half a topology. Anything this backend cannot honour
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
//! `apply_graph_commands`**: the engine spawns its CPAL stream when the first
//! batch arrives, and a machine with no output device degrades observably —
//! the batch is rejected with an `engine-not-running:` reason and
//! `engine_rt_diagnostics` keeps reporting `running: false`. The old
//! `start_native_engine` command was deleted in favour of this path: it had no
//! caller in any shipped build, and a second, unconditioned start entry point
//! beside a lazy one is two bootstraps to keep honest instead of one.
//! `render_graph_offline` never starts the live engine at all.
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
//! - `set-transport` carries only `playing` + `positionSeconds`, and the
//!   `TransportState` it assigns is built from the engine default — so a graph
//!   set-transport currently *resets* tempo and time signature to 120 BPM 4/4
//!   and will fight `update_plugin_transport` the moment both paths drive one
//!   live engine. Resolution is deferred to the live-cutover slice.
//! - `correlation` is accepted and echoed but not validated against a live
//!   document revision — **decided semantics as of D3.b, not an open TODO**.
//!   The TS-side backend forwards a batch's correlation verbatim and echoes
//!   it in results, and the one production consumer (the offline bounce)
//!   deliberately sends none: a render of a snapshot cannot go stale, because
//!   no live document races it (`AudioGraphBackend.ts`, batch law). Echoing
//!   is therefore the whole truthful behaviour for every batch that exists
//!   today. Validation against a live revision becomes meaningful — and lands
//!   here — with the D3.c live cutover (jcosta33/sourdaw#2214), where
//!   `apply_graph_commands` batches race a live document.

use crate::state::{AppState, TimelineSample};
use daw_engine::offline::OfflineRenderer;
use daw_engine::plugin_slot::TransportState;
use daw_engine::scheduler::GraphCommand;
use daw_engine::timeline::{
    AutomationEvent, AutomationTarget, AutomationWrite, ChainEntry, ClipFade, ClipPlacement,
    ClipPlayback, DeviceKind, DeviceParam, RampShape, RouteTarget, TimelineBus, TimelineClip,
    TimelineRtDiagnosticsSnapshot, TimelineTrack, AUTOMATION_QUEUE_CAPACITY,
    DEVICE_PARAM_QUEUE_CAPACITY, MAX_BUS_DEVICES, MAX_TIMELINE_BUSES, MAX_TIMELINE_TRACKS,
    MAX_TRACK_CLIPS, MAX_TRACK_DEVICES, MAX_TRACK_SENDS,
};
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

/// The `SetParam` names the built-in Knead effect maps
/// (`daw_engine::scheduler::apply_knead_param`). A knead device carrying any
/// other parameter name refuses control-side rather than being counted as an
/// unmapped call after the fact.
const KNEAD_PARAM_NAMES: [&str; 3] = ["shift_semitones", "retune_speed_ms", "formant_preserve"];

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
    device_count: usize,
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
#[derive(Clone, Debug)]
pub struct GraphRegistry {
    strips: HashMap<String, StripEntry>,
    devices: HashMap<String, DeviceEntry>,
    track_count: usize,
    bus_count: usize,
    next_node_id: usize,
    next_effect_id: usize,
    runtime_revision: u64,
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

/// Control-side ledger of what one batch queues on the engine's fixed
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
/// change's start (`RampedParam::cancel_stale`) — and then occupies one.
///
/// [`DeviceParamQueue`]: daw_engine::timeline::DeviceParamQueue
#[derive(Default)]
struct QueueBudgets {
    /// Per target, the event time of every write this batch leaves queued.
    automation: HashMap<AutomationTarget, Vec<u64>>,
    device_params: HashMap<usize, usize>,
}

impl QueueBudgets {
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
            queued.retain(|&queued_lands_at| queued_lands_at < start);
        }
        if queued.len() == AUTOMATION_QUEUE_CAPACITY {
            return Err(format!(
                "automation-queue-capacity — this batch already queues \
                 {AUTOMATION_QUEUE_CAPACITY} unlanded writes on this parameter, all its \
                 native queue holds; the engine would drop the rest silently, so the \
                 batch refuses instead — split the writes across batches"
            ));
        }
        queued.push(lands_at);
        Ok(())
    }

    fn charge_device_param(&mut self, effect_id: usize) -> Result<(), String> {
        let depth = self.device_params.entry(effect_id).or_insert(0);
        if *depth == DEVICE_PARAM_QUEUE_CAPACITY {
            return Err(format!(
                "device-param-queue-capacity — this batch already queues \
                 {DEVICE_PARAM_QUEUE_CAPACITY} unlanded changes on this device, all its native \
                 queue holds; the engine would drop the rest silently, so the batch refuses \
                 instead — split the writes across batches"
            ));
        }
        *depth += 1;
        Ok(())
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

    for name in device.parameter_values.keys() {
        if !KNEAD_PARAM_NAMES.contains(&name.as_str()) {
            return Err(format!(
                "device '{}' carries parameter '{}', which knead does not map",
                device.id, name
            ));
        }
    }

    let effect_id = registry.allocate_effect_id();
    // Detached, never `AddEffect`: commands cross the ring one at a time, so
    // a callback can drain between this registration and the chain splice
    // that follows it. An effect registered onto the master chain in that
    // window would render one block of the entire mix through a device the
    // batch put on one strip.
    ops.push(GraphCommand::AddDetachedEffect(
        effect_id,
        "knead".to_string(),
    ));
    for (name, value) in &device.parameter_values {
        ops.push(GraphCommand::SetParam(
            effect_id,
            name.clone(),
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

/// Map a whole batch. `registry` is the caller's working clone; on `Err`
/// nothing built here may be applied and the clone is discarded.
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
    let mut reports = Vec::new();
    let mut refusals: Vec<String> = Vec::new();
    let mut budgets = QueueBudgets::default();

    for (index, command) in batch.commands.iter().enumerate() {
        if let Err(reason) = map_command(
            command,
            registry,
            samples,
            sample_rate,
            &mut budgets,
            &mut ops,
            &mut reports,
        ) {
            refusals.push(format!("commands[{index}]: {reason}"));
        }
    }

    if refusals.is_empty() {
        Ok(MappedBatch { ops, reports })
    } else {
        Err(refusals.join("; "))
    }
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
    reports: &mut Vec<StripReportPayload>,
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
                    device_count: chain_index,
                    clip_count: 0,
                    send_bus_ids: Vec::new(),
                    output: StripOutput::Master,
                },
            );
            registry.track_count += 1;
            reports.push(StripReportPayload {
                kind: "track",
                id: track_id.clone(),
                device_ids: built_device_ids,
            });
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
                    device_count: chain_index,
                    clip_count: 0,
                    send_bus_ids: Vec::new(),
                    output: StripOutput::Master,
                },
            );
            registry.bus_count += 1;
            reports.push(StripReportPayload {
                kind: "bus",
                id: bus_id.clone(),
                device_ids: built_device_ids,
            });
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
            if strip.device_count == strip_device_capacity(strip.kind) {
                return Err(format!(
                    "insert-device: the chain on '{track_id}' is at capacity"
                ));
            }
            let Some(effect_id) = map_device(device, registry, strip.contributes_audio, ops)?
            else {
                return Ok(());
            };
            ops.push(insert_device_op(
                strip.kind,
                strip.native_id,
                ChainEntry {
                    effect_id,
                    kind: DeviceKind::Effect,
                },
                (*index as usize).min(strip.device_count),
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
                .device_count += 1;
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
            registry
                .strips
                .get_mut(track_id)
                .expect("strip fetched above")
                .device_count -= 1;
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
            budgets
                .charge_device_param(device.native_effect_id)
                .map_err(|reason| format!("write-device-parameter: {reason}"))?;
            ops.push(GraphCommand::AutomateDeviceParam {
                effect_id: device.native_effect_id,
                param,
                value: finite(*value, "write-device-parameter value")? as f32,
                at_frame: seconds_to_frames(*time, sample_rate, "write-device-parameter time")?,
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
            // Transport state lands before the locate: a play→stop edge holds
            // every parameter where the last rendered frame left it, and the
            // seek that follows then drops whatever the move made stale — the
            // same order the engine's own laws compose in.
            ops.push(GraphCommand::SetTransport(TransportState {
                is_playing: *playing,
                song_pos_seconds: *position_seconds,
                ..TransportState::default()
            }));
            ops.push(GraphCommand::SeekFrames(frame));
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

    let samples = state
        .timeline_samples
        .lock()
        .map_err(|error| format!("Failed to lock timeline samples: {error}"))?;
    let mut registry_guard = state
        .graph
        .lock()
        .map_err(|error| format!("Failed to lock graph registry: {error}"))?;

    let correlation = batch.correlation.clone();
    let mut working = registry_guard.clone();
    let mapped = match map_batch(&batch, &mut working, &samples, engine.sample_rate()) {
        Ok(mapped) => mapped,
        Err(reason) => return result_json(&GraphApplyResultPayload::rejected(reason)),
    };

    // Whole-batch admission: only this thread pushes onto the ring (the engine
    // mutex is held), so a batch that fits now cannot stop fitting mid-push.
    let free = engine.graph_command_slots();
    if mapped.ops.len() > free {
        return result_json(&GraphApplyResultPayload::rejected(format!(
            "command-queue-full: the batch needs {} command slots and {} are free — split the \
             batch and reapply",
            mapped.ops.len(),
            free
        )));
    }

    let op_count = mapped.ops.len();
    for (pushed, op) in mapped.ops.into_iter().enumerate() {
        if let Err(error) = engine.send_graph_command(op) {
            // Unreachable after the slots check, but a partial application
            // must never report itself as whole.
            return result_json(&GraphApplyResultPayload::needs_reconcile(
                format!(
                    "the engine refused command {pushed} of {op_count} after {pushed} were \
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
    renderer.push(GraphCommand::SetTransport(TransportState {
        is_playing: true,
        ..TransportState::default()
    }))?;
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
        assert_eq!(
            mapped.reports,
            vec![
                StripReportPayload {
                    kind: "track",
                    id: "t1".to_string(),
                    device_ids: vec!["d-knead".to_string()],
                },
                StripReportPayload {
                    kind: "bus",
                    id: "b1".to_string(),
                    device_ids: Vec::new(),
                },
            ]
        );
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
