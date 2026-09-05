//! Routed timeline graph for the native engine: tracks with device chains,
//! pre- and post-fader sends, buses, a master sum, sample-accurate clip
//! playback, and time-stamped parameter ramps.
//!
//! Everything here runs on the audio callback, so every structure that owns
//! heap memory is built on the control thread and moved in through a
//! [`crate::scheduler::GraphCommand`]. The graph itself never allocates: each
//! collection is created with a fixed capacity, and a command that would push
//! past that capacity is refused and counted rather than reallocating inside
//! the callback. Removal hands ownership back over the scheduler's retirement
//! channel (ADR 0020), so nothing is freed here either.

use std::sync::Arc;

use crate::audio_thread::MAX_CALLBACK_FRAMES;
use crate::pdc::{CompensationDelay, MAX_COMPENSATION_FRAMES};
use triple_buffer::{Input, Output};

/// Tracks the graph holds. A command naming a further track is refused and
/// counted, because growing the vector would allocate on the callback.
pub const MAX_TIMELINE_TRACKS: usize = 128;
/// Buses the graph holds, on the same fixed-capacity contract as tracks.
pub const MAX_TIMELINE_BUSES: usize = 64;
/// Devices one track's chain holds.
pub const MAX_TRACK_DEVICES: usize = 32;
/// Devices one bus's chain holds. A bus is a strip like any other — a send bus
/// that cannot host a reverb defeats the purpose of a send bus — so its chain
/// is built to the same fixed-capacity contract as a track's.
pub const MAX_BUS_DEVICES: usize = 32;
/// Sends one track holds.
pub const MAX_TRACK_SENDS: usize = 16;
/// Clips one track holds.
pub const MAX_TRACK_CLIPS: usize = 1024;
/// Time-stamped parameter events one parameter holds before its earliest
/// unlanded event is refused.
pub const AUTOMATION_QUEUE_CAPACITY: usize = 8;

/// Nodes a mix-order rebuild visits: every track and every bus.
const MIX_NODE_CAPACITY: usize = MAX_TIMELINE_TRACKS + MAX_TIMELINE_BUSES;

/// Where a track or bus sends its output.
///
/// A target that names no live node falls back to the master sum, the same
/// fallback the app's graph makes, so a track whose bus was deleted keeps
/// being heard instead of disappearing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RouteTarget {
    Master,
    Bus(usize),
    Track(usize),
}

/// Where on the channel strip a send takes its signal.
///
/// The distinction is the whole point of a send: a pre-fader send taps ahead
/// of the fader and the mute, which is what makes a cue or monitor mix keep
/// working while the engineer pulls the fader down.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SendTap {
    PreFader,
    PostFader,
}

/// What one entry of a device chain does to the signal reaching it.
///
/// A strictly serial chain cannot express an instrument: a generator has no
/// audio input, so running it in place over the running signal would discard
/// everything upstream of it. The app's own `rebuildChain` accumulates a
/// generator's output into the chain instead of displacing it — every previous
/// output stays connected and the generator joins them — and that fan-in is
/// what this distinction reproduces.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeviceKind {
    /// Consumes the signal reaching it and replaces it with what it produced.
    Effect,
    /// Produces signal of its own, which is summed into the chain rather than
    /// replacing it. Whatever follows in the chain therefore processes the sum,
    /// exactly as it does in the app's graph.
    Generator,
}

/// One entry of a device chain: which effect, and how it joins the signal.
///
/// The effects themselves stay in the scheduler's id-addressed table; a chain
/// is the ordering and the splice points.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ChainEntry {
    pub effect_id: usize,
    pub kind: DeviceKind,
}

impl ChainEntry {
    /// The input hold a splice of this entry ships with, built control-side
    /// because the audio thread may neither allocate a line nor free one
    /// (ADR 0020).
    ///
    /// A generator starts at zero on a strip whose input has already waited,
    /// so it is held back to meet what lands there exactly as the strip's own
    /// clips are. An effect transforms a signal that arrived aligned already
    /// and needs no line of its own. The line is sized at the ceiling like
    /// every other, so a recompensation only ever re-aims it.
    pub fn input_hold(&self) -> Option<Box<CompensationDelay>> {
        match self.kind {
            DeviceKind::Effect => None,
            DeviceKind::Generator => {
                Some(Box::new(CompensationDelay::new(MAX_COMPENSATION_FRAMES)))
            }
        }
    }
}

/// How a time-stamped parameter change travels from its current value to its
/// target.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RampShape {
    /// Take the target at the stamped frame.
    Step,
    /// Move linearly across the ramp's span.
    Linear,
    /// Move at a constant ratio across the ramp's span — the shape a fader or
    /// a filter cutoff wants. Undefined through or across zero, so a ramp with
    /// a non-positive endpoint falls back to [`RampShape::Linear`], the same
    /// constraint Web Audio's `exponentialRampToValueAtTime` states.
    Exponential,
}

/// A parameter a time-stamped change can address.
///
/// Deliberately an enum of fixed-size addresses rather than a name: a command
/// carrying a `String` would have its allocation freed on the audio thread
/// when the command is consumed.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum AutomationTarget {
    TrackGain(usize),
    TrackPan(usize),
    TrackSendLevel { track_id: usize, bus_id: usize },
    BusGain(usize),
    BusPan(usize),
    MasterGain,
}

/// A parameter of a built-in device, addressed without a name for the reason
/// given on [`AutomationTarget`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeviceParam {
    ShiftSemitones,
    RetuneSpeedMs,
    FormantPreserve,
}

impl DeviceParam {
    /// The `SetParam` name this parameter corresponds to, so the named and the
    /// addressed paths cannot drift into meaning different things.
    pub const fn name(self) -> &'static str {
        match self {
            Self::ShiftSemitones => "shift_semitones",
            Self::RetuneSpeedMs => "retune_speed_ms",
            Self::FormantPreserve => "formant_preserve",
        }
    }

    /// Resolve a `SetParam` name onto its address — the inverse of
    /// [`Self::name`]. `None` refuses the name control-side: the scheduler's
    /// named command no longer exists, so a name with no address cannot cross
    /// the ring to be counted as unmapped after the fact.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "shift_semitones" => Some(Self::ShiftSemitones),
            "retune_speed_ms" => Some(Self::RetuneSpeedMs),
            "formant_preserve" => Some(Self::FormantPreserve),
            _ => None,
        }
    }
}

/// The body a time-stamped device-parameter change is addressed at.
///
/// A built-in's parameters are a closed set the engine itself names, so they
/// travel as a [`DeviceParam`] address and the named and the addressed paths
/// cannot drift into meaning different things. A hosted plugin's parameters
/// are the plugin's own `u32` ids: opaque to the engine, resolved by the
/// plugin when it processes the block, and impossible to enumerate here. The
/// two are separate variants rather than one id space so a stamp aimed at the
/// wrong kind of body is a mismatch the audio thread counts rather than a
/// number it silently misreads.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DeviceParamTarget {
    Builtin(DeviceParam),
    Hosted { id: u32 },
}

/// Counters for every timeline command the graph refused, published off the
/// audio thread through a [`triple_buffer`] exactly as the MIDI counters are.
///
/// A refusal is never silent: the graph cannot grow a collection on the
/// callback, so the alternative to a counted refusal is an allocation inside
/// the audio deadline.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct TimelineRtDiagnosticsSnapshot {
    /// A track, bus, clip, send, or device-chain entry that would have pushed
    /// its collection past the fixed capacity it was built with, or an
    /// effect, audio bridge, or MIDI FX chain slot the scheduler's own fixed
    /// tables refused for the same reason.
    pub capacity_refusals: u64,
    /// An add command naming an id another live node already holds.
    pub id_collisions: u64,
    /// A command naming a track, bus, clip, or send that does not exist.
    pub unknown_targets: u64,
    /// A time-stamped change refused because the parameter's event queue was
    /// full. The parameter keeps the trajectory it already had.
    pub automation_queue_overflows: u64,
    /// A routing change refused because it would have fed a node's output back
    /// into itself. The node keeps its previous output.
    pub routing_cycles_refused: u64,
    /// Retained at zero. Bus → track is a live edge; the former refusal
    /// counter stays on the snapshot so a reader that matches the whole
    /// struct does not see a shape change.
    pub invalid_bus_routings: u64,
    /// An exponential ramp requested through or across zero, run as a linear
    /// ramp instead.
    pub exponential_ramp_fallbacks: u64,
    /// A send that rendered with no live bus to land on, because the bus was
    /// removed or never added. Counted once each time a send goes dead rather
    /// than once per block, so the number is a count of events an engineer can
    /// act on and not of callbacks.
    pub unresolved_send_buses: u64,
    /// A clip playback refused because its rate was not a positive, finite
    /// number of source frames per rendered frame. The clip keeps the playback
    /// it already had, and a new clip carrying one is never installed: a rate
    /// the renderer cannot read has no correct substitute, and guessing unity
    /// would play the wrong material at the wrong pitch without saying so.
    pub invalid_clip_playbacks: u64,
    /// How many delay lines the latest compensation pass could not aim where
    /// it wanted to, because more hold was asked for than
    /// [`crate::pdc::MAX_COMPENSATION_FRAMES`] holds. Route lines and dry
    /// lines both count: a route the ceiling cut short still sounds, but it
    /// sounds early, and a device declaring past the ceiling runs a dry line
    /// cut short even on a strip whose every route aligns exactly — its
    /// bypass then moves the strip. Only this number says either happened.
    ///
    /// A state rather than an event, like [`Self::pdc_max_arrival_frames`]:
    /// restated by every pass, so it falls back to zero once the device that
    /// asked for too much is gone. A lifetime sum would keep reporting a
    /// misalignment the graph no longer has, and would climb on every
    /// unrelated recompute while it lasted.
    pub pdc_clamped_routes: u64,
    /// The largest latency any contributor currently declares on its way to a
    /// summing point — the figure every other contributor is delayed up to.
    ///
    /// A state rather than an event: restated by each compensation pass, so it
    /// falls again when the device that raised it is removed, and it reports
    /// what the graph declared rather than what the ceiling allowed.
    pub pdc_max_arrival_frames: u64,
}

pub(crate) struct TimelineRtDiagnosticsReader {
    output: Output<TimelineRtDiagnosticsSnapshot>,
}

pub(crate) fn timeline_rt_diagnostics_channel() -> (
    Input<TimelineRtDiagnosticsSnapshot>,
    TimelineRtDiagnosticsReader,
) {
    let (input, output) = triple_buffer::triple_buffer(&TimelineRtDiagnosticsSnapshot::default());
    (input, TimelineRtDiagnosticsReader { output })
}

impl TimelineRtDiagnosticsReader {
    pub(crate) fn snapshot(&mut self) -> TimelineRtDiagnosticsSnapshot {
        *self.output.read()
    }
}

#[derive(Default)]
pub struct TimelineRtDiagnostics {
    snapshot: TimelineRtDiagnosticsSnapshot,
}

impl TimelineRtDiagnostics {
    pub const fn new() -> Self {
        Self {
            snapshot: TimelineRtDiagnosticsSnapshot {
                capacity_refusals: 0,
                id_collisions: 0,
                unknown_targets: 0,
                automation_queue_overflows: 0,
                routing_cycles_refused: 0,
                invalid_bus_routings: 0,
                exponential_ramp_fallbacks: 0,
                unresolved_send_buses: 0,
                invalid_clip_playbacks: 0,
                pdc_clamped_routes: 0,
                pdc_max_arrival_frames: 0,
            },
        }
    }

    pub const fn snapshot(&self) -> TimelineRtDiagnosticsSnapshot {
        self.snapshot
    }

    fn record_capacity_refusal(&mut self) {
        self.snapshot.capacity_refusals = self.snapshot.capacity_refusals.saturating_add(1);
    }

    fn record_id_collision(&mut self) {
        self.snapshot.id_collisions = self.snapshot.id_collisions.saturating_add(1);
    }

    fn record_unknown_target(&mut self) {
        self.snapshot.unknown_targets = self.snapshot.unknown_targets.saturating_add(1);
    }

    fn record_automation_queue_overflow(&mut self) {
        self.snapshot.automation_queue_overflows =
            self.snapshot.automation_queue_overflows.saturating_add(1);
    }

    fn record_routing_cycle_refused(&mut self) {
        self.snapshot.routing_cycles_refused =
            self.snapshot.routing_cycles_refused.saturating_add(1);
    }

    fn record_exponential_ramp_fallback(&mut self) {
        self.snapshot.exponential_ramp_fallbacks =
            self.snapshot.exponential_ramp_fallbacks.saturating_add(1);
    }

    fn record_unresolved_send_bus(&mut self) {
        self.snapshot.unresolved_send_buses = self.snapshot.unresolved_send_buses.saturating_add(1);
    }

    fn record_invalid_clip_playback(&mut self) {
        self.snapshot.invalid_clip_playbacks =
            self.snapshot.invalid_clip_playbacks.saturating_add(1);
    }

    /// State the route lines and dry lines this pass found the ceiling had cut
    /// short. Stated rather than accumulated, so the figure falls again once
    /// the declaration that raised it is gone.
    fn state_pdc_clamped_routes(&mut self, lines: usize) {
        self.snapshot.pdc_clamped_routes = lines as u64;
    }

    fn state_pdc_max_arrival(&mut self, frames: usize) {
        self.snapshot.pdc_max_arrival_frames = frames as u64;
    }
}

/// One time-stamped parameter change, waiting for the playhead to reach it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AutomationEvent {
    /// Absolute timeline frame at which the change begins.
    pub at_frame: u64,
    /// Frames the ramp spans. Zero lands the target at `at_frame`.
    pub duration_frames: u32,
    pub value: f32,
    pub shape: RampShape,
}

/// How a change joins whatever the parameter already has scheduled.
///
/// The two halves of the app's write path need different laws, and a queue that
/// only appends can serve one of them. An automation lane replaying a recorded
/// curve pushes a window of stamped changes that must all be heard, in order.
/// An interactive move — a dragged fader, a lane being written — re-issues a
/// fresh ramp on every scheduler tick and means each one to *supersede* the
/// last: appended, those pile up until the fixed queue refuses, and the
/// parameter is then stranded on a target the user has long since dragged past.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AutomationWrite {
    /// Land this change in timeline order alongside everything else queued.
    /// The form an automation lane replaying its curve uses.
    Append(AutomationEvent),
    /// Drop every queued change that is stale at this change's start, then
    /// land this change — the cancel-and-replace primitive, and the native
    /// form of the app's `cancelScheduledValues` + `setValueAtTime` +
    /// `linearRampToValueAtTime` tick.
    ///
    /// The cancel is `cancelScheduledValues(startTime)` by Web Audio's own
    /// stamp law — see `RampedParam::cancel_stale` — and deliberately not
    /// "drop everything". Live the two are the same set: every queued change
    /// sits ahead of the playhead a replacing tick writes at, so a replacing
    /// stream still always finds a free slot and an interactive drag can
    /// write on every tick forever without the audio thread growing anything.
    /// Offline they are not the same set: a whole batch queues before frame
    /// zero and a strip's creation state is itself a queued write, so a law
    /// that dropped the whole queue would erase the state a later ramp was
    /// supposed to glide *from*.
    ///
    /// The ramp re-anchors at the value the parameter holds at its own start
    /// frame, so each tick continues the trajectory instead of compounding onto
    /// the target the previous tick aimed at.
    Replace(AutomationEvent),
    /// Hold the parameter wherever it is at `at_frame` and drop what was
    /// queued to land at or after it, by the same stamp law as `Replace`.
    /// Carries no value by construction: a hold that named one would be
    /// a write, and would jump.
    ///
    /// This is the per-parameter form. The engine applies the same law to every
    /// mixer parameter at once when the transport stops — see
    /// [`TimelineGraph::hold_automation`] — so a ramp aimed at a frame the
    /// playhead will now never reach does not keep gliding.
    Hold { at_frame: u64 },
}

/// One entry of a parameter's pending queue.
///
/// A hold has no value, so it cannot be an [`AutomationEvent`]; keeping it in
/// the same stamp-ordered queue is what lets a hold be scheduled ahead of the
/// playhead and still land on the frame it names.
#[derive(Clone, Copy, Debug, PartialEq)]
struct PendingWrite {
    at_frame: u64,
    /// `None` is a hold.
    change: Option<AutomationEvent>,
}

impl PendingWrite {
    const IDLE: Self = Self {
        at_frame: 0,
        change: None,
    };
}

#[derive(Clone, Copy, Debug)]
struct ActiveRamp {
    start_frame: u64,
    end_frame: u64,
    from: f32,
    to: f32,
    shape: RampShape,
}

impl ActiveRamp {
    /// The value this ramp holds at `frame`, without consuming it. A frame
    /// outside the span resolves to the endpoint on that side, which is what
    /// Web Audio's ramp methods do with a time outside theirs.
    fn value_at(self, frame: u64) -> f32 {
        if frame >= self.end_frame {
            return self.to;
        }
        if frame <= self.start_frame {
            return self.from;
        }

        let span = (self.end_frame - self.start_frame) as f32;
        let progress = (frame - self.start_frame) as f32 / span;
        match self.shape {
            RampShape::Exponential => self.from * (self.to / self.from).powf(progress),
            RampShape::Linear | RampShape::Step => self.from + (self.to - self.from) * progress,
        }
    }
}

/// A parameter whose value is a function of the timeline frame.
///
/// The stamp on an event is authoritative, not the block it arrived in: a
/// change stamped at frame `F` takes effect at frame `F` whichever block
/// carries it, so the same command stream over the same transport renders the
/// same audio every time. A stamp the playhead has already passed resolves to
/// the ramp's end state, which is what Web Audio's ramp methods do with an end
/// time in the past.
#[derive(Clone, Copy, Debug)]
pub struct RampedParam {
    value: f32,
    active: Option<ActiveRamp>,
    pending: [PendingWrite; AUTOMATION_QUEUE_CAPACITY],
    pending_len: usize,
}

impl RampedParam {
    pub const fn new(value: f32) -> Self {
        Self {
            value,
            active: None,
            pending: [PendingWrite::IDLE; AUTOMATION_QUEUE_CAPACITY],
            pending_len: 0,
        }
    }

    /// The value the parameter currently holds, without advancing it.
    pub const fn value(&self) -> f32 {
        self.value
    }

    /// Apply one write. Returns `false` when the queue had no room for it; the
    /// caller counts the refusal.
    fn write(&mut self, write: AutomationWrite) -> bool {
        match write {
            AutomationWrite::Append(event) => self.schedule(event),
            AutomationWrite::Replace(event) => {
                self.cancel_stale(event.at_frame);
                self.schedule(event)
            }
            AutomationWrite::Hold { at_frame } => {
                self.cancel_stale(at_frame);
                self.enqueue(PendingWrite {
                    at_frame,
                    change: None,
                })
            }
        }
    }

    /// Queue a change, keeping the queue ordered by stamp so an event that
    /// arrives out of order still lands in timeline order. Returns `false`
    /// when the queue is full; the caller counts the refusal.
    fn schedule(&mut self, event: AutomationEvent) -> bool {
        self.enqueue(PendingWrite {
            at_frame: event.at_frame,
            change: Some(event),
        })
    }

    fn enqueue(&mut self, write: PendingWrite) -> bool {
        if self.pending_len == AUTOMATION_QUEUE_CAPACITY {
            return false;
        }

        let mut index = self.pending_len;
        while index > 0 && self.pending[index - 1].at_frame > write.at_frame {
            self.pending[index] = self.pending[index - 1];
            index -= 1;
        }
        self.pending[index] = write;
        self.pending_len += 1;
        true
    }

    /// Drop every queued change whose **event time** — the frame a ramp lands
    /// on, the frame a step or hold names — sits at or after `frame`. This is
    /// Web Audio's `cancelScheduledValues(t)` stamp law, the one the app's
    /// cancel-and-replace write is defined against: a ramp still gliding at
    /// `frame` is stale even though it started earlier, while a change that
    /// has fully landed by then is history and stays. Keeping the landed
    /// history is load-bearing when a whole window is queued at once — an
    /// offline render maps its entire batch before frame zero, and a strip's
    /// creation state is itself a queued write a replacing ramp must glide
    /// *from*, not erase.
    ///
    /// The active ramp is deliberately untouched: a replacing ramp anchors on
    /// it (`begin`) and a hold freezes through it, which is how both continue
    /// the trajectory instead of jumping.
    fn cancel_stale(&mut self, frame: u64) {
        let mut kept = 0;
        for index in 0..self.pending_len {
            let write = self.pending[index];
            let lands_at = match write.change {
                // A Step lands instantly at its stamp in `begin`, whatever
                // duration it carries, so it is stamped here the same way.
                Some(event) if event.shape == RampShape::Step => event.at_frame,
                Some(event) => event
                    .at_frame
                    .saturating_add(u64::from(event.duration_frames)),
                None => write.at_frame,
            };
            if lands_at < frame {
                self.pending[kept] = write;
                kept += 1;
            }
        }
        self.pending_len = kept;
    }

    /// Drop every queued change stamped at or after `frame` and stop a ramp
    /// that would still be moving there, keeping the value the parameter
    /// currently holds. Nothing jumps.
    ///
    /// This is the engine-driven half of the cancel story — transport stop and
    /// locate — and it is deliberately immediate rather than queued, because a
    /// stop must not depend on a free queue slot to take effect.
    ///
    /// Seek and replay. The graph holds no automation curve: it holds a window
    /// of stamped changes the control thread pushed ahead of the playhead, and
    /// the queue is consumed as the playhead passes each one. A locate
    /// invalidates that window in both directions — forward, because the window
    /// describes frames now behind; backward, because the frames ahead were
    /// already consumed and cannot be replayed from here. So the engine drops
    /// what the locate made stale and holds its level, and the control thread,
    /// which owns the curve, re-issues the window for the new position. A
    /// forward locate keeps the changes stamped *before* the target on purpose:
    /// they land on the next block and put the parameter on the curve where the
    /// playhead now stands, rather than leaving it where the user left it.
    fn cancel_from(&mut self, frame: u64) {
        while self.pending_len > 0 && self.pending[self.pending_len - 1].at_frame >= frame {
            self.pending_len -= 1;
        }
        if let Some(ramp) = self.active {
            if ramp.end_frame > frame {
                self.active = None;
            }
        }
    }

    /// The single value this parameter holds for a whole block, or `None` when
    /// the block has to be walked frame by frame. A settled parameter is the
    /// common case, and resolving it once keeps a static pan from running a
    /// sine and a cosine per sample.
    fn block_constant(&self, block_start: u64, frames: usize) -> Option<f32> {
        if self.active.is_some() {
            return None;
        }
        if self.pending_len > 0 && self.pending[0].at_frame < block_start + frames as u64 {
            return None;
        }
        Some(self.value)
    }

    /// Advance the parameter to `frame` and return its value there.
    fn value_at(&mut self, frame: u64, diagnostics: &mut TimelineRtDiagnostics) -> f32 {
        while self.pending_len > 0 && self.pending[0].at_frame <= frame {
            let write = self.pending[0];
            self.pending.copy_within(1..self.pending_len, 0);
            self.pending_len -= 1;
            match write.change {
                Some(event) => self.begin(event, diagnostics),
                None => {
                    // A hold freezes the trajectory at the frame it names, not
                    // at the frame the block happened to reach it on.
                    self.value = self.value_at_frame(write.at_frame);
                    self.active = None;
                }
            }
        }

        if let Some(ramp) = self.active {
            self.value = ramp.value_at(frame);
            if frame >= ramp.end_frame {
                self.active = None;
            }
        }

        self.value
    }

    /// The value the parameter holds at `frame` without consuming anything,
    /// for the two places that have to re-anchor on a trajectory rather than
    /// advance it.
    fn value_at_frame(&self, frame: u64) -> f32 {
        match self.active {
            Some(ramp) => ramp.value_at(frame),
            None => self.value,
        }
    }

    fn begin(&mut self, event: AutomationEvent, diagnostics: &mut TimelineRtDiagnostics) {
        if event.duration_frames == 0 || event.shape == RampShape::Step {
            self.value = event.value;
            self.active = None;
            return;
        }

        // Anchored at the value the parameter holds on the ramp's own start
        // frame, so a ramp that replaces one already in flight continues from
        // where the signal actually is instead of from the block boundary the
        // command happened to arrive on.
        let from = self.value_at_frame(event.at_frame);
        let mut shape = event.shape;
        if shape == RampShape::Exponential && (from <= 0.0 || event.value <= 0.0) {
            diagnostics.record_exponential_ramp_fallback();
            shape = RampShape::Linear;
        }

        self.active = Some(ActiveRamp {
            start_frame: event.at_frame,
            end_frame: event.at_frame + u64::from(event.duration_frames),
            from,
            to: event.value,
            shape,
        });
    }
}

/// Time-stamped device-parameter changes one effect holds before its earliest
/// unlanded change is refused.
///
/// The window is per *effect*, not per parameter, and a hosted plugin exposes
/// as many parameters as it likes — so one plugin with a batch writing several
/// automation lanes at once spends the window several times over, and the batch
/// refuses whole. It is sized at what one process call of a hosted body can
/// take: such a body accepts a bounded number of parameter writes per call, and
/// a window wider than that would only move the refusal off the batch — which
/// refuses whole and can be resent — onto the body, which drops the excess with
/// nothing left to retry.
pub const DEVICE_PARAM_QUEUE_CAPACITY: usize = 64;

/// One time-stamped change to a device parameter.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DeviceParamEvent {
    pub param: DeviceParamTarget,
    /// The value the parameter takes. `f64` because a hosted plugin parameter
    /// is `f64` on the CLAP and VST3 wire, so an `f32` round trip here would
    /// move the value the plugin displays. A built-in narrows it at apply.
    pub value: f64,
    /// Absolute timeline frame at which the change takes effect. A device owns
    /// its own parameter smoothing, so the change lands on the first block
    /// whose span reaches the stamp rather than at a sample offset inside it.
    pub at_frame: u64,
}

impl DeviceParamEvent {
    const SETTLED: Self = Self {
        param: DeviceParamTarget::Builtin(DeviceParam::ShiftSemitones),
        value: 0.0,
        at_frame: 0,
    };
}

/// A fixed-capacity, stamp-ordered queue of device-parameter changes, held
/// inline on the effect so queuing one allocates nothing.
#[derive(Clone, Copy, Debug)]
pub struct DeviceParamQueue {
    events: [DeviceParamEvent; DEVICE_PARAM_QUEUE_CAPACITY],
    len: usize,
}

impl Default for DeviceParamQueue {
    fn default() -> Self {
        Self::new()
    }
}

impl DeviceParamQueue {
    pub const fn new() -> Self {
        Self {
            events: [DeviceParamEvent::SETTLED; DEVICE_PARAM_QUEUE_CAPACITY],
            len: 0,
        }
    }

    pub const fn len(&self) -> usize {
        self.len
    }

    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Queue a change in stamp order. Returns `false` when the queue is full;
    /// the caller counts the refusal.
    pub fn schedule(&mut self, event: DeviceParamEvent) -> bool {
        if self.len == DEVICE_PARAM_QUEUE_CAPACITY {
            return false;
        }

        let mut index = self.len;
        while index > 0 && self.events[index - 1].at_frame > event.at_frame {
            self.events[index] = self.events[index - 1];
            index -= 1;
        }
        self.events[index] = event;
        self.len += 1;
        true
    }

    /// Take the earliest change whose stamp the block has reached.
    pub fn pop_due(&mut self, frame: u64) -> Option<DeviceParamEvent> {
        if self.len == 0 || self.events[0].at_frame > frame {
            return None;
        }

        let event = self.events[0];
        self.events.copy_within(1..self.len, 0);
        self.len -= 1;
        Some(event)
    }
}

/// Where a clip's rendered span sits on the timeline and which part of its
/// source material that span plays.
///
/// Trimming moves the offsets; it never touches the source material, so a trim
/// is undone by restoring the placement.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ClipPlacement {
    /// Timeline frame at which the clip's first rendered sample sounds.
    pub start_frame: u64,
    /// Frames skipped at the head of the source material.
    pub source_offset_frames: u64,
    /// Frames rendered from the source. A span reaching past the end of the
    /// material renders silence there rather than wrapping or stopping short.
    pub length_frames: u64,
}

/// How a clip's level enters and leaves.
///
/// A clip **always** fades, even when the user asked for no fade: a span that
/// begins or ends on a non-zero sample steps the output, and a step is a click.
/// `micro_fade_frames` is that anti-click floor, and it is also the shortest a
/// user's own fade is allowed to be — the same law the app's clip scheduler
/// applies, so a clip does not click on one backend and not on the other.
///
/// Either side may be suppressed. A span that continues an unbroken sound — the
/// second and later iterations of a loop, a region entered part-way — must not
/// re-fade at the seam, because that is an audible dip rather than an
/// anti-click, and `None` is how a caller says so.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ClipFade {
    /// Frames the user's own fade in spans, or `None` to suppress the head
    /// fade entirely. `Some(0)` is "no fade of the user's own", which still
    /// gets the anti-click floor.
    pub fade_in_frames: Option<u32>,
    /// The same, for the tail.
    pub fade_out_frames: Option<u32>,
    /// The anti-click floor, applied whether or not the user asked for a fade.
    pub micro_fade_frames: u32,
}

impl ClipFade {
    /// No fade at either edge and no floor — the shape a caller uses for a span
    /// that continues a sound on both sides.
    pub const NONE: Self = Self {
        fade_in_frames: None,
        fade_out_frames: None,
        micro_fade_frames: 0,
    };

    /// Both edges faded at the anti-click floor and nothing more, which is what
    /// an ordinary clip with no authored fade sounds like.
    pub const fn anti_click(micro_fade_frames: u32) -> Self {
        Self {
            fade_in_frames: Some(0),
            fade_out_frames: Some(0),
            micro_fade_frames,
        }
    }

    /// Frames the head fade actually spans over a clip `length_frames` long.
    ///
    /// A user fade is never shorter than the anti-click floor and never eats
    /// more than half the audible span, so a fade authored longer than the clip
    /// cannot swallow it or collide with the tail fade.
    fn head_frames(self, length_frames: u64) -> u64 {
        Self::resolve(self.fade_in_frames, self.micro_fade_frames, length_frames)
    }

    fn tail_frames(self, length_frames: u64) -> u64 {
        Self::resolve(self.fade_out_frames, self.micro_fade_frames, length_frames)
    }

    fn resolve(authored: Option<u32>, micro_fade_frames: u32, length_frames: u64) -> u64 {
        let Some(authored) = authored else {
            return 0;
        };
        u64::from(authored.max(micro_fade_frames)).min(length_frames / 2)
    }
}

/// How one clip sounds: its level, its edges, and how fast it reads its source.
///
/// Bundled rather than passed as loose arguments because the three travel
/// together through every command that installs or re-states a clip's playback,
/// and because the app's own clip command carries exactly these alongside the
/// placement.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClipPlayback {
    /// The clip's own level, as a linear amplitude.
    pub gain: f32,
    pub fade: ClipFade,
    /// Source frames consumed per rendered frame. `1.0` reads the material
    /// untouched; anything else is varispeed — the rate and the pitch move
    /// together, which is what the app's `playbackRate` means and what an
    /// `AudioBufferSourceNode` does.
    ///
    /// The placement's `length_frames` is always measured on the timeline, not
    /// on the material: a clip that sounds for two seconds sounds for two
    /// seconds whatever its rate, and the rate decides how much material those
    /// two seconds consume.
    ///
    /// Pitch-preserving time stretch is **not** this field and is not
    /// implemented here. It is a different transform — it needs a phase vocoder
    /// or a granular stage with state of its own, which is a device, not a clip
    /// attribute — and pretending this field delivered it would silently
    /// transpose every stretched clip. A rate that is not positive and finite
    /// is refused rather than rounded to unity.
    pub playback_rate: f32,
}

impl ClipPlayback {
    /// A clip that plays its material untouched at `gain`, fading only enough
    /// not to click.
    pub const fn anti_click(gain: f32, micro_fade_frames: u32) -> Self {
        Self {
            gain,
            fade: ClipFade::anti_click(micro_fade_frames),
            playback_rate: 1.0,
        }
    }

    /// A clip that neither fades nor resamples — the shape for a caller that is
    /// asserting on the material itself.
    pub const fn at_gain(gain: f32) -> Self {
        Self {
            gain,
            fade: ClipFade::NONE,
            playback_rate: 1.0,
        }
    }

    /// Whether the renderer can read this playback at all. A rate of zero or
    /// less has no meaning as "source frames per rendered frame", and a
    /// non-finite one indexes nothing.
    fn is_renderable(self) -> bool {
        self.playback_rate.is_finite() && self.playback_rate > 0.0
    }
}

/// One audio clip on a track, *referencing* its source material.
///
/// The channels are shared rather than owned, because one take becomes many
/// clips: every loop pass, comp region and gap fill over a source is its own
/// clip, and a clip that owned a copy would multiply the take's PCM by the
/// number of edits made to it. Sharing makes that cost a pointer.
///
/// Nothing on the audio thread ever drops one. A removed clip — and a track
/// removed with its clips inside it — leaves through the retirement ring as a
/// [`RetiredTimelineObject`], and the reclaimer thread runs the destructor, so
/// the reference count is released off the callback like every other
/// deallocation the graph does.
pub struct TimelineClip {
    clip_id: usize,
    left: Arc<[f32]>,
    /// Empty for a mono source, which is played to both outputs.
    right: Arc<[f32]>,
    placement: ClipPlacement,
    playback: ClipPlayback,
}

impl TimelineClip {
    /// Build a clip on the control thread over material the caller already
    /// holds. `right` may be empty for mono material.
    pub fn new(
        clip_id: usize,
        left: Arc<[f32]>,
        right: Arc<[f32]>,
        placement: ClipPlacement,
        playback: ClipPlayback,
    ) -> Box<Self> {
        Box::new(Self {
            clip_id,
            left,
            right,
            placement,
            playback,
        })
    }

    pub const fn clip_id(&self) -> usize {
        self.clip_id
    }

    pub const fn placement(&self) -> ClipPlacement {
        self.placement
    }

    pub const fn playback(&self) -> ClipPlayback {
        self.playback
    }

    /// Sum the part of this clip that falls inside `[block_start, block_start +
    /// frames)` into the track's signal, sample for sample.
    fn render_into(&self, block_start: u64, frames: usize, left: &mut [f32], right: &mut [f32]) {
        let start = self.placement.start_frame;
        let length = self.placement.length_frames;
        let end = start.saturating_add(length);
        let block_end = block_start + frames as u64;
        if end <= block_start || start >= block_end {
            return;
        }

        let first = start.max(block_start);
        let last = end.min(block_end);
        let mono = self.right.is_empty();
        let head = self.playback.fade.head_frames(length);
        let tail = self.playback.fade.tail_frames(length);
        let unity_rate = self.playback.playback_rate == 1.0;

        for frame in first..last {
            let offset = frame - start;
            // Unity keeps whole-sample indexing rather than interpolating a
            // fraction that is exactly zero: an unresampled clip must reach the
            // mix bit for bit, and interpolation through `f64` would not
            // promise that.
            let Some((sample_left, sample_right)) = (if unity_rate {
                self.sample_at(self.placement.source_offset_frames + offset, mono)
            } else {
                self.resampled_at(offset, mono)
            }) else {
                // Material shorter than the placement plays out and leaves the
                // rest of the span silent. The read position only grows, so
                // nothing after this frame can be in range either.
                return;
            };

            let level = self.playback.gain * clip_fade_envelope(offset, length, head, tail);
            let out = (frame - block_start) as usize;
            left[out] += sample_left * level;
            right[out] += sample_right * level;
        }
    }

    /// The frame of material at a whole source index, or `None` past its end.
    fn sample_at(&self, source_index: u64, mono: bool) -> Option<(f32, f32)> {
        let source_index = usize::try_from(source_index).ok()?;
        let &sample_left = self.left.get(source_index)?;
        let sample_right = if mono {
            sample_left
        } else {
            self.right.get(source_index).copied().unwrap_or(sample_left)
        };
        Some((sample_left, sample_right))
    }

    /// The frame of material `offset` rendered frames into the clip at a rate
    /// other than unity, linearly interpolated between the two source frames it
    /// falls between.
    ///
    /// Linear interpolation is the deliberate floor, not the intent: it is
    /// exact at unity (which never reaches here), monotonic, allocation-free
    /// and stateless, and its error is a gentle high-frequency roll-off rather
    /// than the aliasing a nearest-neighbour read produces. A resampler with a
    /// longer kernel belongs behind the same call and changes nothing about
    /// this contract.
    fn resampled_at(&self, offset: u64, mono: bool) -> Option<(f32, f32)> {
        let position = self.placement.source_offset_frames as f64
            + offset as f64 * f64::from(self.playback.playback_rate);
        let base = position.floor();
        let index = if base >= 0.0 {
            base as u64
        } else {
            return None;
        };
        let fraction = (position - base) as f32;

        let (left_base, right_base) = self.sample_at(index, mono)?;
        // The last frame of the material has no successor to interpolate
        // toward; holding it is the only reading that does not invent one.
        let (left_next, right_next) = self
            .sample_at(index + 1, mono)
            .unwrap_or((left_base, right_base));

        Some((
            left_base + (left_next - left_base) * fraction,
            right_base + (right_next - right_base) * fraction,
        ))
    }
}

/// The clip's own fade envelope at `offset` rendered frames into a clip
/// `length` frames long, with `head` and `tail` already resolved against that
/// length.
///
/// Linear on both edges, reaching full level exactly `head` frames in and zero
/// exactly at the end, so the first rendered frame of a faded head and the
/// frame after a faded tail are both silent — which is the whole point.
#[inline]
fn clip_fade_envelope(offset: u64, length: u64, head: u64, tail: u64) -> f32 {
    let mut envelope = 1.0;
    if head > 0 && offset < head {
        envelope *= offset as f32 / head as f32;
    }
    if tail > 0 && offset >= length - tail {
        envelope *= (length - offset) as f32 / tail as f32;
    }
    envelope
}

/// One send from a track to a bus.
///
/// The bus id is accepted whether or not that bus is live yet, so the order of
/// `AddSend` and `AddBus` in a command batch cannot matter. Whether the send
/// actually found its bus is therefore a render-time fact, latched here so a
/// dead send is diagnosed once rather than once per callback.
#[derive(Debug)]
pub struct TrackSend {
    bus_id: usize,
    tap: SendTap,
    level: RampedParam,
    bus_missing: bool,
    /// This send's own plugin delay compensation: the bus it lands on is a
    /// summing point of its own, and a send taps a strip at a different depth
    /// than that strip's output does. Built on the control thread and carried
    /// in by [`crate::scheduler::GraphCommand::AddSend`], because the callback
    /// may neither allocate it nor free it.
    delay: Box<CompensationDelay>,
}

/// One track: an input sum, clips, a device chain, a solo gate, sends, a fader,
/// a mute, a panner, and an output.
///
/// The order of the strip is the professional one and the one the app's graph
/// already builds: input and clips, then the device chain, then the solo gate,
/// then the pre-fader send tap, then the fader, then the mute, then the panner,
/// then the post-fader send tap and the output.
///
/// The two silencing gates sit at different points on purpose, and folding them
/// into one flag is the defect this separation exists to prevent. `muted` is
/// post-fader, downstream of the pre-fader send tap, because a pre-fader send
/// is *defined* by tapping ahead of the fader: keeping it alive under mute is
/// exactly what makes a cue or monitor mix usable while the engineer pulls a
/// fader down. Solo-in-place silences every track the engineer is not listening
/// to, and a gate placed where mute sits would leave all of them feeding their
/// pre-fader sends into the return buses — soloing a vocal would still play
/// every other track's reverb tail. So the solo gate closes ahead of both send
/// taps. Held separately from `muted` so the two reasons never overwrite each
/// other: releasing solo restores the tap without clearing a mute the user
/// actually pressed.
pub struct TimelineTrack {
    id: usize,
    input_left: Vec<f32>,
    input_right: Vec<f32>,
    clips: Vec<Box<TimelineClip>>,
    /// The effects that make up this track's device chain, in order.
    chain: Vec<ChainEntry>,
    sends: Vec<TrackSend>,
    gain: RampedParam,
    pan: RampedParam,
    muted: bool,
    solo_gated: bool,
    output: RouteTarget,
    /// Plugin delay compensation for this track's own clips. Whatever is
    /// routed into this track's input arrives at that input's compensated
    /// depth, while a clip on this track starts at zero, so the clips are the
    /// side that waits.
    ///
    /// Live input already summed into `input_left` is deliberately not held
    /// here. That is the monitoring path, and delaying what a player hears
    /// themselves through is the one alignment a DAW must not make.
    source_delay: CompensationDelay,
    /// Plugin delay compensation for this track's own output, applied where
    /// the strip ends and the summing point begins. See
    /// [`TimelineGraph::compensate`].
    output_delay: CompensationDelay,
}

impl TimelineTrack {
    /// Build a track on the control thread with every buffer and every
    /// collection already sized, so no command that touches it can allocate on
    /// the audio callback.
    pub fn new(id: usize) -> Box<Self> {
        Box::new(Self {
            id,
            input_left: vec![0.0; MAX_CALLBACK_FRAMES],
            input_right: vec![0.0; MAX_CALLBACK_FRAMES],
            clips: Vec::with_capacity(MAX_TRACK_CLIPS),
            chain: Vec::with_capacity(MAX_TRACK_DEVICES),
            sends: Vec::with_capacity(MAX_TRACK_SENDS),
            gain: RampedParam::new(1.0),
            pan: RampedParam::new(0.0),
            muted: false,
            solo_gated: false,
            output: RouteTarget::Master,
            source_delay: CompensationDelay::new(MAX_COMPENSATION_FRAMES),
            output_delay: CompensationDelay::new(MAX_COMPENSATION_FRAMES),
        })
    }

    /// Frames this track's own clips are currently held back by, so that they
    /// meet what other strips route into this track's input.
    pub fn source_delay_frames(&self) -> usize {
        self.source_delay.delay()
    }

    /// Frames this track's output is currently held back by, for callers
    /// proving the alignment rather than inferring it from a mix.
    pub fn output_delay_frames(&self) -> usize {
        self.output_delay.delay()
    }

    /// Frames one of this track's sends is currently held back by, or `None`
    /// when no send lands on `bus_id`.
    pub fn send_delay_frames(&self, bus_id: usize) -> Option<usize> {
        self.sends
            .iter()
            .find(|send| send.bus_id == bus_id)
            .map(|send| send.delay.delay())
    }

    pub const fn id(&self) -> usize {
        self.id
    }

    pub const fn output(&self) -> RouteTarget {
        self.output
    }

    pub const fn is_muted(&self) -> bool {
        self.muted
    }

    /// Whether the pre-fader solo gate is closed — that is, whether this track
    /// is one of the tracks being silenced because another one is soloed.
    pub const fn is_solo_gated(&self) -> bool {
        self.solo_gated
    }

    pub fn device_chain(&self) -> &[ChainEntry] {
        &self.chain
    }

    pub fn clip_ids(&self) -> impl Iterator<Item = usize> + '_ {
        self.clips.iter().map(|clip| clip.clip_id)
    }

    pub const fn gain(&self) -> &RampedParam {
        &self.gain
    }

    pub const fn pan(&self) -> &RampedParam {
        &self.pan
    }

    fn clear_input(&mut self, frames: usize) {
        self.input_left[..frames].fill(0.0);
        self.input_right[..frames].fill(0.0);
    }
}

/// One bus: an input sum, a device chain, a mute, a panner, a solo gate, a
/// gain, and an output. A bus may feed the master, another bus, or a track —
/// the last of those is how a return reaches the master strip's insert chain,
/// which is the professional convention (Pro Tools aux into the master,
/// Ableton return into Master, Logic aux into Stereo Out).
///
/// The chain is the point of a send bus. A bus without one is a gain and a
/// routing hop, which cannot host the reverb or the delay every send in a mix
/// is sent *to* — so the whole reason to route a send there disappears. It runs
/// on exactly the same splice contract as a track's chain, ahead of the bus
/// fader, and an effect belongs to one chain in the graph whether that chain is
/// on a track or on a bus.
///
/// The strip order matches a track's, minus send taps the bus does not have:
/// summed input, then the device chain, then the solo gate, then the fader,
/// then the mute, then the panner, then the output. The two gates stay
/// separate for the reason given on [`TimelineTrack`]: they are different
/// reasons to silence, and folding them would make releasing solo clear a mute
/// the user pressed.
pub struct TimelineBus {
    id: usize,
    input_left: Vec<f32>,
    input_right: Vec<f32>,
    chain: Vec<ChainEntry>,
    gain: RampedParam,
    pan: RampedParam,
    muted: bool,
    solo_gated: bool,
    output: RouteTarget,
    /// Plugin delay compensation for this bus's own output, on the same law as
    /// a track's: a bus is a contributor to whatever it feeds.
    output_delay: CompensationDelay,
}

impl TimelineBus {
    /// Build a bus on the control thread, for the reason given on
    /// [`TimelineTrack::new`].
    pub fn new(id: usize) -> Box<Self> {
        Box::new(Self {
            id,
            input_left: vec![0.0; MAX_CALLBACK_FRAMES],
            input_right: vec![0.0; MAX_CALLBACK_FRAMES],
            chain: Vec::with_capacity(MAX_BUS_DEVICES),
            gain: RampedParam::new(1.0),
            pan: RampedParam::new(0.0),
            muted: false,
            solo_gated: false,
            output: RouteTarget::Master,
            output_delay: CompensationDelay::new(MAX_COMPENSATION_FRAMES),
        })
    }

    /// Frames this bus's output is currently held back by. See
    /// [`TimelineTrack::output_delay_frames`].
    pub fn output_delay_frames(&self) -> usize {
        self.output_delay.delay()
    }

    pub const fn id(&self) -> usize {
        self.id
    }

    pub const fn output(&self) -> RouteTarget {
        self.output
    }

    pub fn device_chain(&self) -> &[ChainEntry] {
        &self.chain
    }

    pub const fn gain(&self) -> &RampedParam {
        &self.gain
    }

    pub const fn pan(&self) -> &RampedParam {
        &self.pan
    }

    pub const fn is_muted(&self) -> bool {
        self.muted
    }

    pub const fn is_solo_gated(&self) -> bool {
        self.solo_gated
    }

    fn clear_input(&mut self, frames: usize) {
        self.input_left[..frames].fill(0.0);
        self.input_right[..frames].fill(0.0);
    }
}

/// What a track's device chain is run through.
///
/// The effects live in the scheduler's id-addressed table alongside their
/// bridges and their MIDI state, so the graph asks for one to be run rather
/// than owning it.
pub(crate) trait DeviceChain {
    fn run_device(&mut self, effect_id: usize, left: &mut [f32], right: &mut [f32], frames: usize);
}

/// What one compensation pass asks of the same device table.
///
/// The topology walk belongs to the graph and the devices belong to the
/// scheduler, so the pass borrows the table for the length of one walk exactly
/// as [`DeviceChain`] borrows it for the length of one render. It is one
/// borrow rather than two callbacks because a pass both reads a declared
/// latency and re-aims a generator's line: two closures over one table cannot
/// hold the shared and the exclusive borrow at once.
pub(crate) trait CompensationDevices {
    /// What one strip's chain declares, bypassed devices included: bypass
    /// keeps latency, so an A/B never moves the mix.
    fn chain_latency(&self, chain: &[ChainEntry]) -> usize;

    /// Aim one generator's input hold at the depth of its strip's input, and
    /// answer whether the ceiling cut that hold short.
    fn aim_generator(&mut self, effect_id: usize, depth: usize) -> bool;
}

/// What one removal hands back to the retirement channel, so the audio thread
/// never runs a destructor.
pub(crate) enum RetiredTimelineObject {
    Track(Box<TimelineTrack>),
    Bus(Box<TimelineBus>),
    Clip(Box<TimelineClip>),
    /// A compensation delay a refused send, a removed send, or a replaced
    /// device latency gave up. Its ring is heap like any other buffer here.
    Delay(Box<CompensationDelay>),
}

/// One strip in the render sequence. Tracks and buses share an order so a
/// bus that feeds a track is rendered before that track, and a track that
/// sends into a bus is rendered before that bus.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MixNode {
    Track(usize),
    Bus(usize),
}

/// Where a pull to silence stops. A one-pole approach only ever covers a
/// fraction of what is left, so a fader pulled to silence would never reach it
/// and would keep multiplying the mix by numbers small enough to cost a
/// denormal on every frame of the rest of the session.
///
/// The epsilon ends approaches to targets near silence, below roughly -25 dB
/// at 48 kHz (the crossover moves with the coefficient): there an `f32` step
/// stays representable past this distance, so the descent runs out of
/// distance before it runs out of step. Everywhere louder the step underflows
/// first, and [`MasterFader::next`] ends the approach on that stall instead.
const MASTER_FADER_SETTLED_EPSILON: f32 = 1e-6;

/// The master fader: a level the mix approaches sample by sample, holding no
/// timeline coordinate of its own.
///
/// A fader gesture names no frame. It says where the hand left the fader, not
/// what the arrangement does to the master at frame `F`, so it is not
/// automation and is not carried as a stamped ramp on
/// [`AutomationTarget::MasterGain`]: a stamped ramp answers to the seek, hold
/// and loop-wrap laws that govern the lane, and a wrap re-renders frames below
/// the ramp's start, where a ramp resolves to the value it started from. The
/// mix would step at the seam and play the whole next pass at the level the
/// gesture moved away from. An approach has no start frame to be below.
///
/// The law is the one `setTargetAtTime` applies on the Web Audio fader the same
/// gesture moves, so the two carriers of one mix arrive at one level together.
#[derive(Clone, Copy, Debug)]
pub(crate) struct MasterFader {
    value: f32,
    target: f32,
    /// The fraction of the distance left that one sample covers.
    smoothing: f32,
}

impl MasterFader {
    const fn new(value: f32) -> Self {
        Self {
            value,
            target: value,
            smoothing: 1.0,
        }
    }

    /// Aim at `target`, from wherever the fader currently stands.
    fn set_target(&mut self, target: f32, smoothing: f32) {
        self.target = target;
        self.smoothing = smoothing;
    }

    /// Whether the fader holds one level for as long as nothing re-aims it.
    const fn settled(&self) -> bool {
        self.value == self.target
    }

    /// The level for one sample, advancing the approach by that sample. A
    /// sample is multiplied by the level the fader stood at when it arrived, so
    /// the first sample after a gesture still carries the level the sample
    /// before it did and nothing steps.
    ///
    /// The approach ends for either of two reasons, and both are needed to
    /// reach [`Self::settled`] from anywhere in the audible range. Close to
    /// silence the distance left falls under
    /// [`MASTER_FADER_SETTLED_EPSILON`] first, which is what keeps a pull to
    /// silence out of the denormals. Everywhere else the increment underflows
    /// before that: one step covers a coefficient's worth of what is left, and
    /// that lands below half an ULP of `value` while roughly `1e-4` dB of
    /// distance remains — inaudible, but enough that a fader which never
    /// settled would leave the block-constant path in
    /// `apply_master_fader` unreachable for the rest of the session.
    /// A step that cannot move the value is that end, so it settles there.
    fn next(&mut self) -> f32 {
        let level = self.value;
        let advanced = self.value + (self.target - self.value) * self.smoothing;
        let stalled = advanced == self.value;
        let within_epsilon = (self.target - advanced).abs() < MASTER_FADER_SETTLED_EPSILON;
        self.value = if stalled || within_epsilon {
            self.target
        } else {
            advanced
        };
        level
    }
}

/// The routed graph.
pub struct TimelineGraph {
    tracks: Vec<Box<TimelineTrack>>,
    buses: Vec<Box<TimelineBus>>,
    /// Strip indices in render order, sources before destinations. Rebuilt on
    /// the slow path (add/remove/rewire) into a buffer sized on the control
    /// thread, so the callback never allocates to walk the graph.
    mix_order: Vec<MixNode>,
    /// Kahn in-degree scratch for a mix-order rebuild. Same capacity contract
    /// as [`Self::mix_order`].
    mix_in_degree: Vec<usize>,
    /// Kahn ready-queue scratch for a mix-order rebuild.
    mix_ready: Vec<usize>,
    master_gain: RampedParam,
    master_fader: MasterFader,
    scratch_left: Vec<f32>,
    scratch_right: Vec<f32>,
    /// Where a generator writes before it is summed into the chain it sits on.
    /// A generator produces rather than transforms, so it cannot be run in
    /// place over the running signal without discarding it.
    generator_left: Vec<f32>,
    generator_right: Vec<f32>,
    /// Where a send's tapped copy is delayed before it sums into its bus. A
    /// send taps the strip's running signal, which the strip still needs, so
    /// the compensation cannot run in place over it.
    send_left: Vec<f32>,
    send_right: Vec<f32>,
    /// Where a track's own clips are rendered before they are held back to
    /// meet the routes summing into that track's input. What those routes
    /// delivered is already in the input and must not be delayed a second
    /// time, so the clips cannot be laid straight over it.
    source_left: Vec<f32>,
    source_right: Vec<f32>,
    /// The latency each contributor arrives at its summing point with, indexed
    /// as [`Self::mix_order`] indexes strips. Scratch for
    /// [`Self::compensate`], sized on the control thread for the same reason
    /// the mix-order buffers are.
    track_arrival: Vec<usize>,
    bus_arrival: Vec<usize>,
    /// The deepest arrival each bus has to wait for.
    bus_summing_depth: Vec<usize>,
    /// The deepest arrival each track's *input* has to wait for. A track input
    /// is a summing point exactly as a bus is: [`route_sum`] adds a
    /// contributor into it, and the track lays its own clips over that sum
    /// before its chain runs.
    track_summing_depth: Vec<usize>,
    diagnostics: TimelineRtDiagnostics,
}

impl TimelineGraph {
    pub fn new() -> Self {
        Self {
            tracks: Vec::with_capacity(MAX_TIMELINE_TRACKS),
            buses: Vec::with_capacity(MAX_TIMELINE_BUSES),
            mix_order: Vec::with_capacity(MIX_NODE_CAPACITY),
            mix_in_degree: Vec::with_capacity(MIX_NODE_CAPACITY),
            mix_ready: Vec::with_capacity(MIX_NODE_CAPACITY),
            master_gain: RampedParam::new(1.0),
            master_fader: MasterFader::new(1.0),
            scratch_left: vec![0.0; MAX_CALLBACK_FRAMES],
            scratch_right: vec![0.0; MAX_CALLBACK_FRAMES],
            generator_left: vec![0.0; MAX_CALLBACK_FRAMES],
            generator_right: vec![0.0; MAX_CALLBACK_FRAMES],
            send_left: vec![0.0; MAX_CALLBACK_FRAMES],
            send_right: vec![0.0; MAX_CALLBACK_FRAMES],
            source_left: vec![0.0; MAX_CALLBACK_FRAMES],
            source_right: vec![0.0; MAX_CALLBACK_FRAMES],
            track_arrival: vec![0; MAX_TIMELINE_TRACKS],
            bus_arrival: vec![0; MAX_TIMELINE_BUSES],
            bus_summing_depth: vec![0; MAX_TIMELINE_BUSES],
            track_summing_depth: vec![0; MAX_TIMELINE_TRACKS],
            diagnostics: TimelineRtDiagnostics::new(),
        }
    }

    /// A graph that owns nothing, so a live graph can be moved out to the
    /// retirement channel without building a replacement that would have to be
    /// allocated and then freed. Every collection is at capacity already, so a
    /// command reaching a vacated graph is refused and counted rather than
    /// growing one.
    pub(crate) const fn vacated() -> Self {
        Self {
            tracks: Vec::new(),
            buses: Vec::new(),
            mix_order: Vec::new(),
            mix_in_degree: Vec::new(),
            mix_ready: Vec::new(),
            master_gain: RampedParam::new(1.0),
            master_fader: MasterFader::new(1.0),
            scratch_left: Vec::new(),
            scratch_right: Vec::new(),
            generator_left: Vec::new(),
            generator_right: Vec::new(),
            send_left: Vec::new(),
            send_right: Vec::new(),
            source_left: Vec::new(),
            source_right: Vec::new(),
            track_arrival: Vec::new(),
            bus_arrival: Vec::new(),
            bus_summing_depth: Vec::new(),
            track_summing_depth: Vec::new(),
            diagnostics: TimelineRtDiagnostics::new(),
        }
    }

    pub const fn diagnostics(&self) -> TimelineRtDiagnosticsSnapshot {
        self.diagnostics.snapshot()
    }

    /// Count a refused change to a device parameter, whose queue lives on the
    /// effect rather than in the graph.
    pub(crate) fn record_automation_queue_overflow(&mut self) {
        self.diagnostics.record_automation_queue_overflow();
    }

    /// Count a command naming a node that does not exist, for the paths the
    /// scheduler resolves itself.
    pub(crate) fn record_unknown_target(&mut self) {
        self.diagnostics.record_unknown_target();
    }

    /// Count a registration the scheduler's own fixed tables refused, for the
    /// tables that live on the scheduler rather than in the graph.
    pub(crate) fn record_capacity_refusal(&mut self) {
        self.diagnostics.record_capacity_refusal();
    }

    /// Whether the graph holds anything at all. An empty graph is skipped
    /// entirely, so an engine with no timeline renders exactly what it did
    /// before the timeline existed.
    pub fn is_empty(&self) -> bool {
        self.tracks.is_empty() && self.buses.is_empty()
    }

    pub fn track_count(&self) -> usize {
        self.tracks.len()
    }

    pub fn bus_count(&self) -> usize {
        self.buses.len()
    }

    pub fn track(&self, id: usize) -> Option<&TimelineTrack> {
        self.tracks
            .iter()
            .find(|track| track.id == id)
            .map(|track| &**track)
    }

    pub fn bus(&self, id: usize) -> Option<&TimelineBus> {
        self.buses.iter().find(|bus| bus.id == id).map(|bus| &**bus)
    }

    pub const fn master_gain(&self) -> &RampedParam {
        &self.master_gain
    }

    /// The placement a clip currently holds, for callers proving a trim moved
    /// the window rather than the material.
    pub fn clip_placement(&self, track_id: usize, clip_id: usize) -> Option<ClipPlacement> {
        self.track(track_id)?
            .clips
            .iter()
            .find(|clip| clip.clip_id == clip_id)
            .map(|clip| clip.placement)
    }

    /// Take ownership of a track, or hand it straight back when the id is
    /// taken or the graph is full — the caller retires what comes back rather
    /// than dropping it on the callback.
    pub(crate) fn add_track(&mut self, track: Box<TimelineTrack>) -> Option<Box<TimelineTrack>> {
        if self.tracks.iter().any(|existing| existing.id == track.id) {
            self.diagnostics.record_id_collision();
            return Some(track);
        }
        if self.tracks.len() == self.tracks.capacity() {
            self.diagnostics.record_capacity_refusal();
            return Some(track);
        }

        self.tracks.push(track);
        let _ = self.rebuild_mix_order();
        None
    }

    pub(crate) fn remove_track(&mut self, id: usize) -> Option<Box<TimelineTrack>> {
        let Some(index) = self.tracks.iter().position(|track| track.id == id) else {
            self.diagnostics.record_unknown_target();
            return None;
        };

        let track = self.tracks.remove(index);
        let _ = self.rebuild_mix_order();
        Some(track)
    }

    pub(crate) fn add_bus(&mut self, bus: Box<TimelineBus>) -> Option<Box<TimelineBus>> {
        if self.buses.iter().any(|existing| existing.id == bus.id) {
            self.diagnostics.record_id_collision();
            return Some(bus);
        }
        if self.buses.len() == self.buses.capacity() {
            self.diagnostics.record_capacity_refusal();
            return Some(bus);
        }

        self.buses.push(bus);
        let _ = self.rebuild_mix_order();
        None
    }

    pub(crate) fn remove_bus(&mut self, id: usize) -> Option<Box<TimelineBus>> {
        let Some(index) = self.buses.iter().position(|bus| bus.id == id) else {
            self.diagnostics.record_unknown_target();
            return None;
        };

        let bus = self.buses.remove(index);
        let _ = self.rebuild_mix_order();
        Some(bus)
    }

    pub(crate) fn set_track_output(&mut self, id: usize, target: RouteTarget) {
        let Some(index) = self.tracks.iter().position(|track| track.id == id) else {
            self.diagnostics.record_unknown_target();
            return;
        };

        let previous = self.tracks[index].output;
        self.tracks[index].output = target;
        if !self.rebuild_mix_order() {
            self.tracks[index].output = previous;
            self.diagnostics.record_routing_cycle_refused();
            let _ = self.rebuild_mix_order();
        }
    }

    pub(crate) fn set_bus_output(&mut self, id: usize, target: RouteTarget) {
        let Some(index) = self.buses.iter().position(|bus| bus.id == id) else {
            self.diagnostics.record_unknown_target();
            return;
        };

        let previous = self.buses[index].output;
        self.buses[index].output = target;
        if !self.rebuild_mix_order() {
            self.buses[index].output = previous;
            self.diagnostics.record_routing_cycle_refused();
            let _ = self.rebuild_mix_order();
        }
    }

    pub(crate) fn set_track_mute(&mut self, id: usize, muted: bool) {
        let Some(track) = self.track_mut(id) else {
            self.diagnostics.record_unknown_target();
            return;
        };
        track.muted = muted;
    }

    /// Open or close a track's pre-fader solo gate. Independent of the mute for
    /// the reason given on [`TimelineTrack`].
    pub(crate) fn set_track_solo_gate(&mut self, id: usize, gated: bool) {
        let Some(track) = self.track_mut(id) else {
            self.diagnostics.record_unknown_target();
            return;
        };
        track.solo_gated = gated;
    }

    pub(crate) fn set_bus_mute(&mut self, id: usize, muted: bool) {
        let Some(bus) = self.bus_mut(id) else {
            self.diagnostics.record_unknown_target();
            return;
        };
        bus.muted = muted;
    }

    /// Open or close a bus's pre-fader solo gate, on the same contract as
    /// [`TimelineGraph::set_track_solo_gate`].
    pub(crate) fn set_bus_solo_gate(&mut self, id: usize, gated: bool) {
        let Some(bus) = self.bus_mut(id) else {
            self.diagnostics.record_unknown_target();
            return;
        };
        bus.solo_gated = gated;
    }

    /// Whether any chain in the graph — on a track or on a bus — already holds
    /// this effect.
    ///
    /// An effect belongs to exactly one chain. One instance spliced into two
    /// would run its state over two unrelated streams interleaved, and the
    /// effect's single-valued placement could only ever name one of the two
    /// claimants, so the second claim is refused wherever it comes from.
    fn effect_is_claimed(&self, effect_id: usize) -> bool {
        let claims = |chain: &[ChainEntry]| chain.iter().any(|entry| entry.effect_id == effect_id);
        self.tracks.iter().any(|track| claims(&track.chain))
            || self.buses.iter().any(|bus| claims(&bus.chain))
    }

    /// Returns whether the chain took the effect, so the caller only claims an
    /// effect the chain accepted.
    pub(crate) fn insert_track_device(
        &mut self,
        track_id: usize,
        entry: ChainEntry,
        index: usize,
    ) -> bool {
        let Some(target) = self.tracks.iter().position(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return false;
        };
        if self.effect_is_claimed(entry.effect_id) {
            self.diagnostics.record_id_collision();
            return false;
        }

        let track = &mut self.tracks[target];
        if track.chain.len() == track.chain.capacity() {
            self.diagnostics.record_capacity_refusal();
            return false;
        }

        track.chain.insert(index.min(track.chain.len()), entry);
        true
    }

    pub(crate) fn remove_track_device(&mut self, track_id: usize, effect_id: usize) -> bool {
        let Some(track) = self.tracks.iter_mut().find(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return false;
        };
        let Some(index) = track
            .chain
            .iter()
            .position(|entry| entry.effect_id == effect_id)
        else {
            self.diagnostics.record_unknown_target();
            return false;
        };

        track.chain.remove(index);
        true
    }

    /// Splice an effect into a bus's chain, on the same contract as
    /// [`TimelineGraph::insert_track_device`] — including the single-claim
    /// rule, which spans tracks and buses alike.
    pub(crate) fn insert_bus_device(
        &mut self,
        bus_id: usize,
        entry: ChainEntry,
        index: usize,
    ) -> bool {
        let Some(target) = self.buses.iter().position(|bus| bus.id == bus_id) else {
            self.diagnostics.record_unknown_target();
            return false;
        };
        if self.effect_is_claimed(entry.effect_id) {
            self.diagnostics.record_id_collision();
            return false;
        }

        let bus = &mut self.buses[target];
        if bus.chain.len() == bus.chain.capacity() {
            self.diagnostics.record_capacity_refusal();
            return false;
        }

        bus.chain.insert(index.min(bus.chain.len()), entry);
        true
    }

    pub(crate) fn remove_bus_device(&mut self, bus_id: usize, effect_id: usize) -> bool {
        let Some(bus) = self.buses.iter_mut().find(|bus| bus.id == bus_id) else {
            self.diagnostics.record_unknown_target();
            return false;
        };
        let Some(index) = bus
            .chain
            .iter()
            .position(|entry| entry.effect_id == effect_id)
        else {
            self.diagnostics.record_unknown_target();
            return false;
        };

        bus.chain.remove(index);
        true
    }

    /// Take ownership of a send's compensation delay, or hand it straight back
    /// when the send is refused — the caller retires what comes back rather
    /// than dropping it on the callback.
    pub(crate) fn add_send(
        &mut self,
        track_id: usize,
        bus_id: usize,
        tap: SendTap,
        level: f32,
        delay: Box<CompensationDelay>,
    ) -> Option<Box<CompensationDelay>> {
        let Some(track) = self.tracks.iter_mut().find(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return Some(delay);
        };
        if track.sends.iter().any(|send| send.bus_id == bus_id) {
            self.diagnostics.record_id_collision();
            return Some(delay);
        }
        if track.sends.len() == track.sends.capacity() {
            self.diagnostics.record_capacity_refusal();
            return Some(delay);
        }

        track.sends.push(TrackSend {
            bus_id,
            tap,
            level: RampedParam::new(level),
            bus_missing: false,
            delay,
        });
        if self.rebuild_mix_order() {
            return None;
        }

        let refused = self
            .track_mut(track_id)
            .and_then(|track| track.sends.pop())
            .map(|send| send.delay);
        self.diagnostics.record_routing_cycle_refused();
        let _ = self.rebuild_mix_order();
        refused
    }

    /// Take a send out of a track and hand its compensation delay back for
    /// retirement.
    pub(crate) fn remove_send(
        &mut self,
        track_id: usize,
        bus_id: usize,
    ) -> Option<Box<CompensationDelay>> {
        let Some(track) = self.tracks.iter_mut().find(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return None;
        };
        let Some(index) = track.sends.iter().position(|send| send.bus_id == bus_id) else {
            self.diagnostics.record_unknown_target();
            return None;
        };

        let removed = track.sends.remove(index);
        let _ = self.rebuild_mix_order();
        Some(removed.delay)
    }

    /// The tap a send takes its signal from, for callers proving the strip
    /// order rather than inferring it from a mix.
    pub fn send_tap(&self, track_id: usize, bus_id: usize) -> Option<SendTap> {
        self.track(track_id)?
            .sends
            .iter()
            .find(|send| send.bus_id == bus_id)
            .map(|send| send.tap)
    }

    pub(crate) fn add_clip(
        &mut self,
        track_id: usize,
        clip: Box<TimelineClip>,
    ) -> Option<Box<TimelineClip>> {
        if !clip.playback.is_renderable() {
            self.diagnostics.record_invalid_clip_playback();
            return Some(clip);
        }
        let Some(track) = self.tracks.iter_mut().find(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return Some(clip);
        };
        if track
            .clips
            .iter()
            .any(|existing| existing.clip_id == clip.clip_id)
        {
            self.diagnostics.record_id_collision();
            return Some(clip);
        }
        if track.clips.len() == track.clips.capacity() {
            self.diagnostics.record_capacity_refusal();
            return Some(clip);
        }

        track.clips.push(clip);
        None
    }

    pub(crate) fn remove_clip(
        &mut self,
        track_id: usize,
        clip_id: usize,
    ) -> Option<Box<TimelineClip>> {
        let Some(track) = self.tracks.iter_mut().find(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return None;
        };
        let Some(index) = track.clips.iter().position(|clip| clip.clip_id == clip_id) else {
            self.diagnostics.record_unknown_target();
            return None;
        };

        Some(track.clips.remove(index))
    }

    /// Move or trim a clip. The source material is untouched: only the window
    /// onto it changes, so the edit is undone by restoring the placement.
    pub(crate) fn set_clip_placement(
        &mut self,
        track_id: usize,
        clip_id: usize,
        placement: ClipPlacement,
    ) {
        let Some(track) = self.tracks.iter_mut().find(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return;
        };
        let Some(clip) = track.clips.iter_mut().find(|clip| clip.clip_id == clip_id) else {
            self.diagnostics.record_unknown_target();
            return;
        };

        clip.placement = placement;
    }

    /// Re-state a clip's level, its fades and its rate. Non-destructive in the
    /// same way a trim is: the source material is untouched, so restoring the
    /// playback restores the edit.
    pub(crate) fn set_clip_playback(
        &mut self,
        track_id: usize,
        clip_id: usize,
        playback: ClipPlayback,
    ) {
        if !playback.is_renderable() {
            self.diagnostics.record_invalid_clip_playback();
            return;
        }
        let Some(track) = self.tracks.iter_mut().find(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return;
        };
        let Some(clip) = track.clips.iter_mut().find(|clip| clip.clip_id == clip_id) else {
            self.diagnostics.record_unknown_target();
            return;
        };

        clip.playback = playback;
    }

    /// The playback a clip currently holds, for callers proving an edit
    /// re-stated the envelope rather than the material.
    pub fn clip_playback(&self, track_id: usize, clip_id: usize) -> Option<ClipPlayback> {
        self.track(track_id)?
            .clips
            .iter()
            .find(|clip| clip.clip_id == clip_id)
            .map(|clip| clip.playback)
    }

    pub(crate) fn automate(&mut self, target: AutomationTarget, write: AutomationWrite) {
        let param = match target {
            AutomationTarget::MasterGain => Some(&mut self.master_gain),
            AutomationTarget::TrackGain(id) => self.track_mut(id).map(|track| &mut track.gain),
            AutomationTarget::TrackPan(id) => self.track_mut(id).map(|track| &mut track.pan),
            AutomationTarget::BusGain(id) => self.bus_mut(id).map(|bus| &mut bus.gain),
            AutomationTarget::BusPan(id) => self.bus_mut(id).map(|bus| &mut bus.pan),
            AutomationTarget::TrackSendLevel { track_id, bus_id } => self
                .tracks
                .iter_mut()
                .find(|track| track.id == track_id)
                .and_then(|track| track.sends.iter_mut().find(|send| send.bus_id == bus_id))
                .map(|send| &mut send.level),
        };

        let Some(param) = param else {
            self.diagnostics.record_unknown_target();
            return;
        };

        if !param.write(write) {
            self.diagnostics.record_automation_queue_overflow();
        }
    }

    /// Hold every mixer parameter wherever it is and drop what each of them has
    /// queued — the transport-stop law.
    ///
    /// A ramp aimed at a frame the playhead is about to stop short of would
    /// otherwise keep gliding after playback ended, because the stamp on it is
    /// a timeline frame and the timeline no longer advances. Holding is the
    /// only answer that does not jump: the parameters keep the values the last
    /// rendered frame left them on.
    pub(crate) fn hold_automation(&mut self, at_frame: u64) {
        self.for_each_param(|param| param.cancel_from(at_frame));
    }

    /// Drop what a locate made stale on every mixer parameter. See
    /// [`RampedParam::cancel_from`] for the seek-and-replay law this half
    /// implements and for what the control thread owns.
    pub(crate) fn seek(&mut self, frame: u64) {
        self.for_each_param(|param| param.cancel_from(frame));
    }

    /// Visit every parameter the graph itself owns, in a fixed order, without
    /// allocating: the two graph-wide automation laws apply to all of them and
    /// neither may miss one.
    fn for_each_param(&mut self, mut visit: impl FnMut(&mut RampedParam)) {
        visit(&mut self.master_gain);
        for track in self.tracks.iter_mut() {
            visit(&mut track.gain);
            visit(&mut track.pan);
            for send in track.sends.iter_mut() {
                visit(&mut send.level);
            }
        }
        for bus in self.buses.iter_mut() {
            visit(&mut bus.gain);
            visit(&mut bus.pan);
        }
    }

    fn track_mut(&mut self, id: usize) -> Option<&mut TimelineTrack> {
        self.tracks
            .iter_mut()
            .find(|track| track.id == id)
            .map(|track| &mut **track)
    }

    fn bus_mut(&mut self, id: usize) -> Option<&mut TimelineBus> {
        self.buses
            .iter_mut()
            .find(|bus| bus.id == id)
            .map(|bus| &mut **bus)
    }

    /// Rebuild the shared render order. Returns `false` when the routing graph
    /// contains a cycle — output edges and send edges both count, because a
    /// send into a bus that feeds this track is the same loop as routing the
    /// output there. The ready queue is FIFO and sources are enqueued in
    /// insertion order (tracks, then buses), so an acyclic graph without a
    /// bus → track edge keeps the previous two-phase sequence. A bus → track
    /// edge breaks that guarantee: the destination strip must still accept
    /// input when the bus renders, which an insertion-ordered tracks-then-buses
    /// walk cannot provide because every track has already run its chain.
    fn rebuild_mix_order(&mut self) -> bool {
        let mut order = std::mem::take(&mut self.mix_order);
        let mut in_degree = std::mem::take(&mut self.mix_in_degree);
        let mut ready = std::mem::take(&mut self.mix_ready);
        order.clear();
        in_degree.clear();
        ready.clear();

        let track_count = self.tracks.len();
        let count = track_count + self.buses.len();
        in_degree.resize(count, 0);

        for node in 0..count {
            self.for_each_successor(node, track_count, |dest| {
                in_degree[dest] += 1;
            });
        }
        for node in 0..count {
            if in_degree[node] == 0 {
                ready.push(node);
            }
        }

        let mut head = 0usize;
        while head < ready.len() {
            let node = ready[head];
            head += 1;
            order.push(if node < track_count {
                MixNode::Track(node)
            } else {
                MixNode::Bus(node - track_count)
            });
            self.for_each_successor(node, track_count, |dest| {
                in_degree[dest] -= 1;
                if in_degree[dest] == 0 {
                    ready.push(dest);
                }
            });
        }

        let acyclic = order.len() == count;
        self.mix_order = order;
        self.mix_in_degree = in_degree;
        self.mix_ready = ready;
        acyclic
    }

    fn for_each_successor(&self, node: usize, track_count: usize, mut visit: impl FnMut(usize)) {
        if node < track_count {
            visit_route_target(
                self.tracks[node].output,
                &self.tracks,
                &self.buses,
                track_count,
                &mut visit,
            );
            for send in &self.tracks[node].sends {
                visit_route_target(
                    RouteTarget::Bus(send.bus_id),
                    &self.tracks,
                    &self.buses,
                    track_count,
                    &mut visit,
                );
            }
            return;
        }
        visit_route_target(
            self.buses[node - track_count].output,
            &self.tracks,
            &self.buses,
            track_count,
            &mut visit,
        );
    }

    /// Re-aim every route's compensation delay so that each summing point
    /// receives every contributor at the same latency.
    ///
    /// `devices` answers what one strip's device chain declares and aims the
    /// generators on it; the effects themselves live on the scheduler, so the
    /// graph asks rather than owning either. Bypassed devices count towards a
    /// chain's latency, because a bypassed device keeps its latency — see
    /// [`TimelineTrack`]'s strip order for why a change that shifted alignment
    /// would click.
    ///
    /// `clamped_devices` is the other half of the clamp count this pass
    /// reports: how many devices declare more latency than the ceiling holds,
    /// and so run a dry line cut short. The graph cannot see a declared figure
    /// — only what a chain sums to — and a lone latent strip clamps no route
    /// at all, so a count taken from the route lines alone would report a
    /// perfectly aligned graph while every bypass toggle shifted that strip.
    /// It is a figure handed in rather than one this pass accumulates, so the
    /// total is restated by each pass instead of latched.
    ///
    /// A strip counts once in that total however many of its input's lines the
    /// ceiling cut short: what the count names is a summing point the graph
    /// could not align, and one strip's input is one such point whether its
    /// clips, its generators, or both were held short of it.
    ///
    /// The walk is [`Self::mix_order`], which puts every contributor ahead of
    /// what it feeds, so one pass settles every summing point's depth — a
    /// bus's input, a track's input, the master sum — and a second aims the
    /// delays at it. O(strips + sends + devices), and nothing here allocates:
    /// every buffer it touches was sized on the control thread.
    pub(crate) fn compensate(
        &mut self,
        clamped_devices: usize,
        devices: &mut impl CompensationDevices,
    ) {
        let Self {
            tracks,
            buses,
            mix_order,
            track_arrival,
            bus_arrival,
            bus_summing_depth,
            track_summing_depth,
            diagnostics,
            ..
        } = self;

        let track_count = tracks.len();
        let bus_count = buses.len();
        track_arrival[..track_count].fill(0);
        bus_arrival[..bus_count].fill(0);
        bus_summing_depth[..bus_count].fill(0);
        track_summing_depth[..track_count].fill(0);

        let mut master_depth = 0;
        for order_index in 0..mix_order.len() {
            let (arrival, output) = match mix_order[order_index] {
                MixNode::Track(index) => {
                    // Everything routed into this track's input has already
                    // been visited, so its own chain starts from the deepest of
                    // them — the law a bus follows, because a track fed by
                    // other strips is the same kind of summing point.
                    let arrival =
                        track_summing_depth[index] + devices.chain_latency(&tracks[index].chain);
                    track_arrival[index] = arrival;
                    for send in &tracks[index].sends {
                        if let Some(bus) = buses.iter().position(|bus| bus.id == send.bus_id) {
                            bus_summing_depth[bus] = bus_summing_depth[bus].max(arrival);
                        }
                    }
                    (arrival, tracks[index].output)
                }
                MixNode::Bus(index) => {
                    let arrival =
                        bus_summing_depth[index] + devices.chain_latency(&buses[index].chain);
                    bus_arrival[index] = arrival;
                    (arrival, buses[index].output)
                }
            };
            match summing_point(output, tracks, buses) {
                SummingPoint::Master => master_depth = master_depth.max(arrival),
                SummingPoint::Bus(index) => {
                    bus_summing_depth[index] = bus_summing_depth[index].max(arrival);
                }
                SummingPoint::TrackInput(index) => {
                    track_summing_depth[index] = track_summing_depth[index].max(arrival);
                }
            }
        }

        let mut clamped = clamped_devices;
        for index in 0..track_count {
            let arrival = track_arrival[index];
            for send in tracks[index].sends.iter_mut() {
                let hold = buses
                    .iter()
                    .position(|bus| bus.id == send.bus_id)
                    .map_or(0, |bus| bus_summing_depth[bus].saturating_sub(arrival));
                clamped += usize::from(send.delay.set_delay(hold));
            }

            // This track's own clips start at zero, so they wait the whole
            // depth of what arrives at its input — and so does an instrument
            // on its chain, which produces its material here rather than
            // taking it from a route that already waited. One summing point,
            // so one clamp however many of its lines the ceiling cut short.
            let depth = track_summing_depth[index];
            let mut input_clamped = tracks[index].source_delay.set_delay(depth);
            for entry in &tracks[index].chain {
                if entry.kind == DeviceKind::Generator {
                    input_clamped |= devices.aim_generator(entry.effect_id, depth);
                }
            }
            clamped += usize::from(input_clamped);

            let output = tracks[index].output;
            let hold = hold_for(
                output,
                arrival,
                tracks,
                buses,
                bus_summing_depth,
                track_summing_depth,
                master_depth,
            );
            clamped += usize::from(tracks[index].output_delay.set_delay(hold));
        }
        for index in 0..bus_count {
            let arrival = bus_arrival[index];

            // A bus has no clips, so its input hold is the generators on its
            // chain and nothing else — an instrument on a bus is the same
            // contributor a track's is, at the depth its own input carries.
            let depth = bus_summing_depth[index];
            let mut input_clamped = false;
            for entry in &buses[index].chain {
                if entry.kind == DeviceKind::Generator {
                    input_clamped |= devices.aim_generator(entry.effect_id, depth);
                }
            }
            clamped += usize::from(input_clamped);

            let output = buses[index].output;
            let hold = hold_for(
                output,
                arrival,
                tracks,
                buses,
                bus_summing_depth,
                track_summing_depth,
                master_depth,
            );
            clamped += usize::from(buses[index].output_delay.set_delay(hold));
        }

        diagnostics.state_pdc_clamped_routes(clamped);
        diagnostics.state_pdc_max_arrival(
            bus_summing_depth[..bus_count]
                .iter()
                .chain(track_summing_depth[..track_count].iter())
                .copied()
                .fold(master_depth, usize::max),
        );
    }

    /// Render one block of the timeline, summing the master output into
    /// `master_left` / `master_right`.
    ///
    /// `block_start` is the absolute timeline frame of the block's first
    /// sample, which is what makes clip starts and parameter stamps land on
    /// the sample they name rather than at a block boundary.
    ///
    /// `render_clips` is false while the transport is not playing. The
    /// playhead stands still then, so a clip under it would re-render the same
    /// span every callback — a buffer-length loop, and one its pre-fader sends
    /// would keep pumping into the buses. Every other stage still runs on a
    /// stopped transport: the device chains, the sends, the buses and the
    /// master sum drain the tails of what was already sounding, which is what
    /// a stopped transport does in any DAW.
    pub(crate) fn render(
        &mut self,
        block_start: u64,
        frames: usize,
        render_clips: bool,
        devices: &mut impl DeviceChain,
        master_left: &mut [f32],
        master_right: &mut [f32],
    ) {
        let Self {
            tracks,
            buses,
            mix_order,
            scratch_left,
            scratch_right,
            generator_left,
            generator_right,
            send_left,
            send_right,
            source_left,
            source_right,
            diagnostics,
            ..
        } = self;

        for track in tracks.iter_mut() {
            track.clear_input(frames);
        }
        for bus in buses.iter_mut() {
            bus.clear_input(frames);
        }

        for order_index in 0..mix_order.len() {
            match mix_order[order_index] {
                MixNode::Track(index) => {
                    let left = &mut scratch_left[..frames];
                    let right = &mut scratch_right[..frames];

                    {
                        let track = &mut tracks[index];
                        left.copy_from_slice(&track.input_left[..frames]);
                        right.copy_from_slice(&track.input_right[..frames]);
                        render_track_source(
                            track,
                            block_start,
                            frames,
                            render_clips,
                            left,
                            right,
                            &mut source_left[..frames],
                            &mut source_right[..frames],
                        );
                    }

                    run_device_chain(
                        &tracks[index].chain,
                        devices,
                        frames,
                        left,
                        right,
                        &mut generator_left[..frames],
                        &mut generator_right[..frames],
                    );

                    {
                        let track = &mut tracks[index];
                        // Solo-in-place, ahead of both send taps. Placed with the mute
                        // instead, every track the engineer is not listening to would
                        // go on feeding its pre-fader send into the return buses. See
                        // `TimelineTrack`.
                        if track.solo_gated {
                            left.fill(0.0);
                            right.fill(0.0);
                        }
                        run_sends(
                            track,
                            SendTap::PreFader,
                            buses,
                            block_start,
                            frames,
                            left,
                            right,
                            &mut send_left[..frames],
                            &mut send_right[..frames],
                            diagnostics,
                        );
                        apply_gain(
                            &mut track.gain,
                            block_start,
                            frames,
                            left,
                            right,
                            diagnostics,
                        );
                        if track.muted {
                            left.fill(0.0);
                            right.fill(0.0);
                        }
                        apply_pan(
                            &mut track.pan,
                            block_start,
                            frames,
                            left,
                            right,
                            diagnostics,
                        );
                        run_sends(
                            track,
                            SendTap::PostFader,
                            buses,
                            block_start,
                            frames,
                            left,
                            right,
                            &mut send_left[..frames],
                            &mut send_right[..frames],
                            diagnostics,
                        );
                        // Last on the strip, after the post-fader tap: the
                        // sends carry their own compensation, and only what
                        // leaves for the summing point is held back here.
                        //
                        // Run on every block this strip renders, whether or
                        // not it holds: nothing above skips the line — mute
                        // and solo zero the block rather than leaving it — so
                        // the ring keeps pace with the strip.
                        track.output_delay.run(left, right, frames);
                    }

                    route_sum(
                        tracks[index].output,
                        tracks,
                        buses,
                        frames,
                        left,
                        right,
                        master_left,
                        master_right,
                    );
                }
                MixNode::Bus(index) => {
                    let left = &mut scratch_left[..frames];
                    let right = &mut scratch_right[..frames];

                    {
                        let bus = &mut buses[index];
                        left.copy_from_slice(&bus.input_left[..frames]);
                        right.copy_from_slice(&bus.input_right[..frames]);
                    }

                    // The bus's inserts run over its summed input and ahead of its
                    // fader, which is where a track's chain sits on its own strip.
                    run_device_chain(
                        &buses[index].chain,
                        devices,
                        frames,
                        left,
                        right,
                        &mut generator_left[..frames],
                        &mut generator_right[..frames],
                    );

                    {
                        let bus = &mut buses[index];
                        // Solo-in-place, ahead of the fader, matching the
                        // track law. A bus has no send taps today, so the
                        // placement is still the one a later tap would have
                        // to sit behind.
                        if bus.solo_gated {
                            left.fill(0.0);
                            right.fill(0.0);
                        }
                        apply_gain(&mut bus.gain, block_start, frames, left, right, diagnostics);
                        if bus.muted {
                            left.fill(0.0);
                            right.fill(0.0);
                        }
                        apply_pan(&mut bus.pan, block_start, frames, left, right, diagnostics);
                        // Run on every block this bus renders, for the reason
                        // a track's output line is: mute and solo zero the
                        // block rather than leaving it, so nothing above skips
                        // the line.
                        bus.output_delay.run(left, right, frames);
                    }

                    route_sum(
                        buses[index].output,
                        tracks,
                        buses,
                        frames,
                        left,
                        right,
                        master_left,
                        master_right,
                    );
                }
            }
        }
    }

    /// Aim the master fader at a new level, which it approaches from wherever
    /// it stands. Nothing here is stamped, so nothing the transport does to the
    /// playhead reaches it.
    pub(crate) fn set_master_fader_target(&mut self, target: f32, smoothing: f32) {
        self.master_fader.set_target(target, smoothing);
    }

    /// Apply the master stage, the last stage of the strip, after the master
    /// insert chain has run: the automation lane's gain, then the fader over
    /// it. The two are separate levels on one signal — the arrangement's master
    /// curve, and where the hand left the fader — so they multiply.
    pub(crate) fn apply_master_gain(
        &mut self,
        block_start: u64,
        frames: usize,
        left: &mut [f32],
        right: &mut [f32],
    ) {
        apply_gain(
            &mut self.master_gain,
            block_start,
            frames,
            &mut left[..frames],
            &mut right[..frames],
            &mut self.diagnostics,
        );
        apply_master_fader(
            &mut self.master_fader,
            frames,
            &mut left[..frames],
            &mut right[..frames],
        );
    }
}

/// Multiply the master fader into one span.
///
/// A settled fader is one number for the whole span, which is the common case:
/// the fader only moves while a hand is on it. A moving one is walked sample by
/// sample and takes no frame, because where it stands is a function of how many
/// samples it has passed rather than of the position those samples play at.
fn apply_master_fader(fader: &mut MasterFader, frames: usize, left: &mut [f32], right: &mut [f32]) {
    if fader.settled() {
        let level = fader.value;
        if level == 1.0 {
            return;
        }
        for index in 0..frames {
            left[index] *= level;
            right[index] *= level;
        }
        return;
    }

    for index in 0..frames {
        let level = fader.next();
        left[index] *= level;
        right[index] *= level;
    }
}

/// Lay a track's own clips over what other strips have already summed into its
/// input.
///
/// A route landing on this track's input arrives at that input's compensated
/// depth, while a clip on this track starts at zero, so the clips are held back
/// to meet it. They are staged apart from the input for exactly that reason:
/// what the input carries is aligned already, and running the hold over the
/// pair would delay every contributor a second time — and with them the live
/// input monitored through this track, which is the one signal that must not
/// wait.
///
/// The staging happens on every block, at zero hold and with no clip to render
/// alike, because the line is written on every block this strip renders: a
/// source line skipped while it holds nothing would freeze, and the next hold
/// it is aimed at would replay the passage it froze in.
#[allow(clippy::too_many_arguments)]
fn render_track_source(
    track: &mut TimelineTrack,
    block_start: u64,
    frames: usize,
    render_clips: bool,
    left: &mut [f32],
    right: &mut [f32],
    source_left: &mut [f32],
    source_right: &mut [f32],
) {
    // Staged over silence, and staged even on a stopped transport: the line
    // has to keep running for the material still inside it to come out, which
    // is what the rest of the strip does with its tails.
    source_left.fill(0.0);
    source_right.fill(0.0);
    if render_clips {
        for clip in &track.clips {
            clip.render_into(block_start, frames, source_left, source_right);
        }
    }
    track.source_delay.run(source_left, source_right, frames);
    sum_into(left, source_left);
    sum_into(right, source_right);
}

/// Run one strip's device chain over the signal in `left` / `right`.
///
/// An effect transforms the signal in place. A generator has no audio input, so
/// it is run over a cleared scratch pair and summed in: the signal reaching the
/// chain at that point survives, and everything after the generator processes
/// the sum. That is the fan-in the app's `rebuildChain` builds — every previous
/// output stays connected and the generator's output joins them — and it is the
/// only way a chain can hold an instrument without the instrument erasing
/// whatever the strip already carried.
fn run_device_chain(
    chain: &[ChainEntry],
    devices: &mut impl DeviceChain,
    frames: usize,
    left: &mut [f32],
    right: &mut [f32],
    generator_left: &mut [f32],
    generator_right: &mut [f32],
) {
    for entry in chain {
        match entry.kind {
            DeviceKind::Effect => devices.run_device(entry.effect_id, left, right, frames),
            DeviceKind::Generator => {
                generator_left.fill(0.0);
                generator_right.fill(0.0);
                devices.run_device(entry.effect_id, generator_left, generator_right, frames);
                sum_into(left, generator_left);
                sum_into(right, generator_right);
            }
        }
    }
}

/// Where one route's audio is summed with everything else arriving there.
enum SummingPoint {
    Master,
    /// The named bus's input, by index.
    Bus(usize),
    /// The named track's input, by index. A track fed by other strips is a
    /// group, and its input sums exactly as a bus's does; the track's own clips
    /// are held back to meet what lands there.
    TrackInput(usize),
}

/// Resolve a route target the way [`route_sum`] resolves it, so compensation
/// is computed for the point the audio actually lands on: a target naming no
/// live node falls back to the master sum there, and must fall back here too.
fn summing_point(
    target: RouteTarget,
    tracks: &[Box<TimelineTrack>],
    buses: &[Box<TimelineBus>],
) -> SummingPoint {
    match target {
        RouteTarget::Master => SummingPoint::Master,
        RouteTarget::Track(id) => tracks
            .iter()
            .position(|track| track.id == id)
            .map_or(SummingPoint::Master, SummingPoint::TrackInput),
        RouteTarget::Bus(id) => buses
            .iter()
            .position(|bus| bus.id == id)
            .map_or(SummingPoint::Master, SummingPoint::Bus),
    }
}

/// Frames a contributor arriving at `arrival` must be held back so it meets
/// the rest of `target`'s sources.
#[allow(clippy::too_many_arguments)]
fn hold_for(
    target: RouteTarget,
    arrival: usize,
    tracks: &[Box<TimelineTrack>],
    buses: &[Box<TimelineBus>],
    bus_summing_depth: &[usize],
    track_summing_depth: &[usize],
    master_depth: usize,
) -> usize {
    match summing_point(target, tracks, buses) {
        SummingPoint::Master => master_depth.saturating_sub(arrival),
        SummingPoint::Bus(index) => bus_summing_depth[index].saturating_sub(arrival),
        SummingPoint::TrackInput(index) => track_summing_depth[index].saturating_sub(arrival),
    }
}

#[inline]
fn visit_route_target(
    target: RouteTarget,
    tracks: &[Box<TimelineTrack>],
    buses: &[Box<TimelineBus>],
    track_count: usize,
    visit: &mut impl FnMut(usize),
) {
    match target {
        RouteTarget::Master => {}
        RouteTarget::Track(id) => {
            if let Some(index) = tracks.iter().position(|track| track.id == id) {
                visit(index);
            }
        }
        RouteTarget::Bus(id) => {
            if let Some(index) = buses.iter().position(|bus| bus.id == id) {
                visit(track_count + index);
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn route_sum(
    target: RouteTarget,
    tracks: &mut [Box<TimelineTrack>],
    buses: &mut [Box<TimelineBus>],
    frames: usize,
    left: &[f32],
    right: &[f32],
    master_left: &mut [f32],
    master_right: &mut [f32],
) {
    match target {
        RouteTarget::Track(target_id) => {
            match tracks.iter_mut().find(|track| track.id == target_id) {
                Some(destination) => {
                    sum_into(&mut destination.input_left[..frames], left);
                    sum_into(&mut destination.input_right[..frames], right);
                }
                None => {
                    sum_into(&mut master_left[..frames], left);
                    sum_into(&mut master_right[..frames], right);
                }
            }
        }
        RouteTarget::Bus(target_id) => match buses.iter_mut().find(|bus| bus.id == target_id) {
            Some(destination) => {
                sum_into(&mut destination.input_left[..frames], left);
                sum_into(&mut destination.input_right[..frames], right);
            }
            None => {
                sum_into(&mut master_left[..frames], left);
                sum_into(&mut master_right[..frames], right);
            }
        },
        RouteTarget::Master => {
            sum_into(&mut master_left[..frames], left);
            sum_into(&mut master_right[..frames], right);
        }
    }
}

fn sum_into(destination: &mut [f32], source: &[f32]) {
    for (out, sample) in destination.iter_mut().zip(source.iter()) {
        *out += *sample;
    }
}

/// Sum this track's sends at `tap` into the buses they land on.
///
/// `send_left` / `send_right` are the graph's scratch pair: a send that carries
/// compensation delays its own copy of the tapped signal, which the strip still
/// needs unchanged for everything downstream of the tap.
#[allow(clippy::too_many_arguments)]
fn run_sends(
    track: &mut TimelineTrack,
    tap: SendTap,
    buses: &mut [Box<TimelineBus>],
    block_start: u64,
    frames: usize,
    left: &[f32],
    right: &[f32],
    send_left: &mut [f32],
    send_right: &mut [f32],
    diagnostics: &mut TimelineRtDiagnostics,
) {
    for send in track.sends.iter_mut() {
        if send.tap != tap {
            continue;
        }

        // Ahead of every reason this send might contribute nothing this block:
        // a bus that was removed or never added, and a level that leaves zero,
        // both `continue` below. The line has to see every frame of the tap or
        // its content stops matching the time it is asked for, and the send
        // would then read audio from whenever it last ran.
        //
        // The copy into the scratch pair is unconditional, because the line
        // runs in place and the strip still needs the tapped block unchanged
        // for everything downstream of the tap. Copying only while the send
        // holds would put a second branch on the hold here, beside the one
        // `run` already owns; one block copy per send is what keeps that
        // decision in a single place.
        send_left.copy_from_slice(&left[..frames]);
        send_right.copy_from_slice(&right[..frames]);
        send.delay.run(send_left, send_right, frames);
        let (left, right) = (&send_left[..frames], &send_right[..frames]);

        let Some(bus) = buses.iter_mut().find(|bus| bus.id == send.bus_id) else {
            // A send is the one command whose target is resolved at render
            // time, so a bus that was removed or never added can only be
            // reported from here. Latching it counts the send going dead once
            // instead of once every callback for as long as it stays dead.
            if !send.bus_missing {
                send.bus_missing = true;
                diagnostics.record_unresolved_send_bus();
            }
            continue;
        };
        send.bus_missing = false;

        if let Some(level) = send.level.block_constant(block_start, frames) {
            if level == 0.0 {
                continue;
            }
            for index in 0..frames {
                bus.input_left[index] += left[index] * level;
                bus.input_right[index] += right[index] * level;
            }
            continue;
        }

        for index in 0..frames {
            let level = send.level.value_at(block_start + index as u64, diagnostics);
            bus.input_left[index] += left[index] * level;
            bus.input_right[index] += right[index] * level;
        }
    }
}

fn apply_gain(
    gain: &mut RampedParam,
    block_start: u64,
    frames: usize,
    left: &mut [f32],
    right: &mut [f32],
    diagnostics: &mut TimelineRtDiagnostics,
) {
    if let Some(value) = gain.block_constant(block_start, frames) {
        if value == 1.0 {
            return;
        }
        for index in 0..frames {
            left[index] *= value;
            right[index] *= value;
        }
        return;
    }

    for index in 0..frames {
        let value = gain.value_at(block_start + index as u64, diagnostics);
        left[index] *= value;
        right[index] *= value;
    }
}

fn apply_pan(
    pan: &mut RampedParam,
    block_start: u64,
    frames: usize,
    left: &mut [f32],
    right: &mut [f32],
    diagnostics: &mut TimelineRtDiagnostics,
) {
    if let Some(value) = pan.block_constant(block_start, frames) {
        if value == 0.0 {
            return;
        }
        let gains = stereo_pan_gains(value);
        for index in 0..frames {
            let (out_left, out_right) = pan_frame(gains, left[index], right[index]);
            left[index] = out_left;
            right[index] = out_right;
        }
        return;
    }

    for index in 0..frames {
        let value = pan.value_at(block_start + index as u64, diagnostics);
        let gains = stereo_pan_gains(value);
        let (out_left, out_right) = pan_frame(gains, left[index], right[index]);
        left[index] = out_left;
        right[index] = out_right;
    }
}

/// The stereo panning rule of Web Audio's `StereoPannerNode` for a stereo
/// input, which is the law the app's own strip already pans by: one side is
/// folded into the other along a quarter-sine curve, so a hard pan keeps the
/// far channel's material rather than discarding it.
///
/// A centred pan is an exact identity. The general formula would multiply the
/// opposite channel by `cos(pi/2)`, which is not exactly zero in `f32`, and a
/// default pan must not colour a mix at all.
#[inline]
fn stereo_pan_gains(pan: f32) -> (f32, f32, f32, f32) {
    let pan = pan.clamp(-1.0, 1.0);
    if pan == 0.0 {
        return (1.0, 0.0, 0.0, 1.0);
    }

    if pan < 0.0 {
        let angle = (pan + 1.0) * std::f32::consts::FRAC_PI_2;
        (1.0, angle.cos(), 0.0, angle.sin())
    } else {
        let angle = pan * std::f32::consts::FRAC_PI_2;
        (angle.cos(), 0.0, angle.sin(), 1.0)
    }
}

#[inline]
fn pan_frame(gains: (f32, f32, f32, f32), left: f32, right: f32) -> (f32, f32) {
    let (left_from_left, left_from_right, right_from_left, right_from_right) = gains;
    (
        left * left_from_left + right * left_from_right,
        left * right_from_left + right * right_from_right,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A graph with no devices to run, for the render paths that are about
    /// routing rather than about what a chain does to the signal.
    struct NoDevices;

    impl DeviceChain for NoDevices {
        fn run_device(
            &mut self,
            _effect_id: usize,
            _left: &mut [f32],
            _right: &mut [f32],
            _frames: usize,
        ) {
        }
    }

    /// Runs one scaling effect and one generator that emits a constant,
    /// addressed by id, so a chain's arithmetic is readable from the mix.
    struct TestDevices {
        scaler_id: usize,
        factor: f32,
        generator_id: usize,
        emits: f32,
    }

    impl DeviceChain for TestDevices {
        fn run_device(
            &mut self,
            effect_id: usize,
            left: &mut [f32],
            right: &mut [f32],
            frames: usize,
        ) {
            if effect_id == self.scaler_id {
                for index in 0..frames {
                    left[index] *= self.factor;
                    right[index] *= self.factor;
                }
            } else if effect_id == self.generator_id {
                // A generator ignores whatever reached it and emits its own
                // material, which is exactly why running one in place would
                // erase the strip's signal.
                for index in 0..frames {
                    left[index] = self.emits;
                    right[index] = self.emits;
                }
            }
        }
    }

    fn placement(start_frame: u64, source_offset_frames: u64, length_frames: u64) -> ClipPlacement {
        ClipPlacement {
            start_frame,
            source_offset_frames,
            length_frames,
        }
    }

    fn ramp(at_frame: u64, duration_frames: u32, value: f32, shape: RampShape) -> AutomationEvent {
        AutomationEvent {
            at_frame,
            duration_frames,
            value,
            shape,
        }
    }

    fn effect(effect_id: usize) -> ChainEntry {
        ChainEntry {
            effect_id,
            kind: DeviceKind::Effect,
        }
    }

    fn generator(effect_id: usize) -> ChainEntry {
        ChainEntry {
            effect_id,
            kind: DeviceKind::Generator,
        }
    }

    fn chain_ids(chain: &[ChainEntry]) -> Vec<usize> {
        chain.iter().map(|entry| entry.effect_id).collect()
    }

    /// Walk a parameter frame by frame the way `apply_gain` does, so the
    /// values asserted are the ones a block would multiply by.
    fn walk(
        param: &mut RampedParam,
        frames: u64,
        diagnostics: &mut TimelineRtDiagnostics,
    ) -> Vec<f32> {
        (0..frames)
            .map(|frame| param.value_at(frame, diagnostics))
            .collect()
    }

    #[test]
    fn a_linear_ramp_interpolates_frame_by_frame_between_its_endpoints() {
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut param = RampedParam::new(1.0);
        param.schedule(ramp(0, 4, 0.0, RampShape::Linear));

        assert_eq!(
            walk(&mut param, 6, &mut diagnostics),
            vec![1.0, 0.75, 0.5, 0.25, 0.0, 0.0]
        );
    }

    #[test]
    fn an_exponential_ramp_moves_at_a_constant_ratio_between_its_endpoints() {
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut param = RampedParam::new(1.0);
        param.schedule(ramp(0, 4, 0.25, RampShape::Exponential));

        // 1.0 -> 0.25 is two halvings, so the ramp's midpoint is the geometric
        // mean 0.5 rather than the arithmetic 0.625 a linear ramp would land
        // on. That difference is the whole reason a fader wants this shape.
        let values = walk(&mut param, 5, &mut diagnostics);
        let expected = [1.0, 0.25_f32.powf(0.25), 0.5, 0.25_f32.powf(0.75), 0.25];
        for (index, (value, want)) in values.iter().zip(expected.iter()).enumerate() {
            assert!(
                (value - want).abs() < 1e-6,
                "frame {index}: {value} should be {want}"
            );
        }
        assert!((values[2] - 0.5).abs() < 1e-6);
        assert_eq!(diagnostics.snapshot().exponential_ramp_fallbacks, 0);
    }

    #[test]
    fn an_exponential_ramp_onto_zero_falls_back_to_linear_and_says_so() {
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut param = RampedParam::new(1.0);
        param.schedule(ramp(0, 4, 0.0, RampShape::Exponential));

        // A constant-ratio ramp cannot reach zero. Running it anyway produces
        // NaN, so the parameter runs the linear ramp and records the
        // substitution rather than emitting a silent fault into the mix.
        assert_eq!(
            walk(&mut param, 4, &mut diagnostics),
            vec![1.0, 0.75, 0.5, 0.25]
        );
        assert_eq!(diagnostics.snapshot().exponential_ramp_fallbacks, 1);
    }

    #[test]
    fn a_stamp_the_playhead_has_already_passed_resolves_to_the_ramps_end_state() {
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut param = RampedParam::new(1.0);
        param.schedule(ramp(10, 4, 0.5, RampShape::Linear));

        assert_eq!(param.value_at(100, &mut diagnostics), 0.5);
    }

    #[test]
    fn events_land_in_timeline_order_however_they_arrive() {
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut param = RampedParam::new(0.0);
        // Queued newest-stamp-first: the stamp is authoritative, not the
        // arrival order, or the same command stream would render differently
        // depending on how the control thread batched it.
        param.schedule(ramp(4, 0, 0.75, RampShape::Step));
        param.schedule(ramp(2, 0, 0.5, RampShape::Step));

        assert_eq!(
            walk(&mut param, 6, &mut diagnostics),
            vec![0.0, 0.0, 0.5, 0.5, 0.75, 0.75]
        );
    }

    #[test]
    fn a_pending_step_is_history_at_its_stamp_whatever_duration_it_carries() {
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut param = RampedParam::new(0.0);
        // No producer stamps a duration onto a Step today, but `begin` lands
        // one instantly at its stamp regardless — so the cancel law must read
        // its landing the same way, or a replacing write would erase landed
        // history it should glide from.
        param.write(AutomationWrite::Append(ramp(2, 8, 0.5, RampShape::Step)));
        param.write(AutomationWrite::Replace(ramp(6, 0, 1.0, RampShape::Step)));

        assert_eq!(
            walk(&mut param, 8, &mut diagnostics),
            vec![0.0, 0.0, 0.5, 0.5, 0.5, 0.5, 1.0, 1.0]
        );
    }

    #[test]
    fn a_settled_parameter_resolves_once_for_the_whole_block_and_a_ramped_one_does_not() {
        let mut param = RampedParam::new(0.5);
        assert_eq!(param.block_constant(0, 8), Some(0.5));

        param.schedule(ramp(4, 0, 1.0, RampShape::Step));
        assert_eq!(param.block_constant(0, 8), None);
        // The stamp falls beyond this block, so the block is still constant.
        assert_eq!(param.block_constant(0, 4), Some(0.5));
    }

    #[test]
    fn a_parameter_queue_past_its_capacity_refuses_the_newest_event() {
        let mut param = RampedParam::new(1.0);
        for index in 0..AUTOMATION_QUEUE_CAPACITY {
            assert!(param.schedule(ramp(index as u64, 0, 0.5, RampShape::Step)));
        }

        // Growing the queue would have called the allocator inside the audio
        // deadline. A refusal the caller counts is the alternative.
        assert!(!param.schedule(ramp(100, 0, 0.5, RampShape::Step)));
    }

    #[test]
    fn a_refused_automation_event_is_counted_rather_than_grown() {
        let mut graph = TimelineGraph::new();
        assert!(graph.add_track(TimelineTrack::new(1)).is_none());
        for index in 0..=AUTOMATION_QUEUE_CAPACITY {
            graph.automate(
                AutomationTarget::TrackGain(1),
                AutomationWrite::Append(ramp(1_000 + index as u64, 0, 0.5, RampShape::Step)),
            );
        }

        assert_eq!(graph.diagnostics().automation_queue_overflows, 1);
    }

    /// `from_name` is the inverse of `name`, so the named boundary the control
    /// side resolves through and the addressed command the audio thread
    /// applies cannot drift into meaning different things.
    #[test]
    fn device_param_from_name_is_the_inverse_of_name() {
        for param in [
            DeviceParam::ShiftSemitones,
            DeviceParam::RetuneSpeedMs,
            DeviceParam::FormantPreserve,
        ] {
            assert_eq!(DeviceParam::from_name(param.name()), Some(param));
        }
        assert_eq!(DeviceParam::from_name("not_a_real_param"), None);
    }

    #[test]
    fn device_parameter_events_pop_in_stamp_order_once_the_block_reaches_them() {
        let mut queue = DeviceParamQueue::new();
        assert!(queue.is_empty());
        assert!(queue.schedule(DeviceParamEvent {
            param: DeviceParamTarget::Builtin(DeviceParam::RetuneSpeedMs),
            value: 20.0,
            at_frame: 8,
        }));
        assert!(queue.schedule(DeviceParamEvent {
            param: DeviceParamTarget::Builtin(DeviceParam::ShiftSemitones),
            value: 5.0,
            at_frame: 4,
        }));
        assert_eq!(queue.len(), 2);

        // Nothing is due before the earliest stamp, and the earliest comes out
        // first whichever order the two arrived in.
        assert_eq!(queue.pop_due(3), None);
        assert_eq!(
            queue.pop_due(4).map(|event| (event.param, event.value)),
            Some((DeviceParamTarget::Builtin(DeviceParam::ShiftSemitones), 5.0))
        );
        assert_eq!(queue.pop_due(4), None);
        assert_eq!(
            queue.pop_due(9).map(|event| (event.param, event.value)),
            Some((DeviceParamTarget::Builtin(DeviceParam::RetuneSpeedMs), 20.0))
        );
        assert!(queue.is_empty());
    }

    #[test]
    fn a_device_parameter_queue_past_its_capacity_refuses_rather_than_growing() {
        let mut queue = DeviceParamQueue::new();
        for index in 0..DEVICE_PARAM_QUEUE_CAPACITY {
            assert!(queue.schedule(DeviceParamEvent {
                param: DeviceParamTarget::Builtin(DeviceParam::ShiftSemitones),
                value: 1.0,
                at_frame: index as u64,
            }));
        }

        assert!(!queue.schedule(DeviceParamEvent {
            param: DeviceParamTarget::Builtin(DeviceParam::ShiftSemitones),
            value: 1.0,
            at_frame: 100,
        }));
        assert_eq!(queue.len(), DEVICE_PARAM_QUEUE_CAPACITY);
    }

    #[test]
    fn a_trimmed_clip_renders_the_window_its_placement_names_and_keeps_its_material() {
        let material: Arc<[f32]> = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0].into();
        let mut clip = TimelineClip::new(
            9,
            material,
            [].into(),
            placement(0, 2, 3),
            ClipPlayback::at_gain(1.0),
        );
        let mut left = vec![0.0; 4];
        let mut right = vec![0.0; 4];
        clip.render_into(0, 4, &mut left, &mut right);
        assert_eq!(left, vec![2.0, 3.0, 4.0, 0.0]);

        // Retrimming moves the window only. A destructive trim would have
        // consumed or rewritten the material and could not produce the later
        // samples afterwards.
        clip.placement = placement(0, 5, 3);
        left.fill(0.0);
        right.fill(0.0);
        clip.render_into(0, 4, &mut left, &mut right);
        assert_eq!(left, vec![5.0, 6.0, 7.0, 0.0]);
        assert_eq!(right, left);
    }

    #[test]
    fn a_placement_reaching_past_its_material_renders_silence_rather_than_stale_samples() {
        let clip = TimelineClip::new(
            9,
            vec![1.0, 1.0].into(),
            [].into(),
            placement(0, 0, 6),
            ClipPlayback::at_gain(1.0),
        );
        let mut left = vec![0.0; 6];
        let mut right = vec![0.0; 6];
        clip.render_into(0, 6, &mut left, &mut right);

        assert_eq!(left, vec![1.0, 1.0, 0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn a_clip_sums_into_the_span_it_names_and_leaves_the_rest_of_the_block_alone() {
        let clip = TimelineClip::new(
            9,
            vec![1.0; 8].into(),
            [].into(),
            placement(3, 0, 2),
            ClipPlayback::at_gain(0.5),
        );
        let mut left = vec![0.0; 8];
        let mut right = vec![0.0; 8];
        clip.render_into(0, 8, &mut left, &mut right);
        assert_eq!(left, vec![0.0, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0]);

        // A block the clip's span does not reach is untouched.
        let mut later_left = vec![0.0; 8];
        let mut later_right = vec![0.0; 8];
        clip.render_into(8, 8, &mut later_left, &mut later_right);
        assert_eq!(later_left, vec![0.0; 8]);
        assert_eq!(later_right, vec![0.0; 8]);
    }

    #[test]
    fn an_effect_one_chain_already_claims_is_refused_by_every_other_chain() {
        let mut graph = TimelineGraph::new();
        assert!(graph.add_track(TimelineTrack::new(1)).is_none());
        assert!(graph.add_track(TimelineTrack::new(2)).is_none());
        assert!(graph.add_bus(TimelineBus::new(50)).is_none());
        assert!(graph.insert_track_device(1, effect(7), 0));

        // One instance on two chains would run its state over two unrelated
        // streams interleaved, and the effect's placement could only name one
        // of the strips that hold it. A bus chain is a chain like any other, so
        // it is bound by the same rule and not by a second one.
        assert!(!graph.insert_track_device(2, effect(7), 0));
        assert!(!graph.insert_track_device(1, effect(7), 0));
        assert!(!graph.insert_bus_device(50, effect(7), 0));
        assert_eq!(graph.diagnostics().id_collisions, 3);
        assert_eq!(
            graph.track(1).map(|track| chain_ids(track.device_chain())),
            Some(vec![7])
        );
        assert_eq!(
            graph.track(2).map(|track| chain_ids(track.device_chain())),
            Some(Vec::new())
        );
        assert_eq!(
            graph.bus(50).map(|bus| chain_ids(bus.device_chain())),
            Some(Vec::new())
        );

        // Freed by the strip that holds it, the effect is available again —
        // including to a bus.
        assert!(graph.remove_track_device(1, 7));
        assert!(graph.insert_bus_device(50, effect(7), 0));
        assert!(!graph.insert_track_device(2, effect(7), 0));
    }

    #[test]
    fn a_send_whose_bus_is_gone_is_counted_once_and_leaves_the_track_alone() {
        let mut graph = TimelineGraph::new();
        assert!(graph.add_track(TimelineTrack::new(1)).is_none());
        assert!(graph.add_bus(TimelineBus::new(50)).is_none());
        assert!(graph
            .add_clip(
                1,
                TimelineClip::new(
                    9,
                    vec![1.0; 8].into(),
                    [].into(),
                    placement(0, 0, 8),
                    ClipPlayback::at_gain(1.0)
                )
            )
            .is_none());
        assert!(graph
            .add_send(1, 50, SendTap::PostFader, 1.0, uncompensated())
            .is_none());

        let mut left = vec![0.0; 4];
        let mut right = vec![0.0; 4];
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![2.0; 4], "the track's output plus its send");
        assert_eq!(graph.diagnostics().unresolved_send_buses, 0);

        // The send now names a bus that is gone. Every other command in this
        // file diagnoses a target it cannot resolve; a send resolves its
        // target at render time, so this is the only place it can be seen.
        drop(graph.remove_bus(50));
        left.fill(0.0);
        right.fill(0.0);
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![1.0; 4], "the track itself is unaffected");
        assert_eq!(graph.diagnostics().unresolved_send_buses, 1);

        // A send that stays dead is one event, not one per callback.
        left.fill(0.0);
        right.fill(0.0);
        graph.render(4, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![1.0; 4]);
        assert_eq!(graph.diagnostics().unresolved_send_buses, 1);

        // Restoring the bus makes the send live again, and losing it a second
        // time is a second event.
        assert!(graph.add_bus(TimelineBus::new(50)).is_none());
        left.fill(0.0);
        right.fill(0.0);
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![2.0; 4]);
        assert_eq!(graph.diagnostics().unresolved_send_buses, 1);

        drop(graph.remove_bus(50));
        left.fill(0.0);
        right.fill(0.0);
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(graph.diagnostics().unresolved_send_buses, 2);
    }

    /// The delay line every send is built with control-side, at rest. A graph
    /// that never runs `compensate` leaves it at zero delay, so a send built
    /// with one taps its source exactly as it did before compensation existed.
    fn uncompensated() -> Box<CompensationDelay> {
        Box::new(CompensationDelay::new(MAX_COMPENSATION_FRAMES))
    }

    /// A track carrying one mono clip of a constant value, with no fade of any
    /// kind so the arithmetic under test is the only thing shaping the mix.
    fn graph_with_constant_clip(track_id: usize, value: f32, frames: u64) -> TimelineGraph {
        let mut graph = TimelineGraph::new();
        assert!(graph.add_track(TimelineTrack::new(track_id)).is_none());
        assert!(graph
            .add_clip(
                track_id,
                TimelineClip::new(
                    9,
                    vec![value; frames as usize].into(),
                    [].into(),
                    placement(0, 0, frames),
                    ClipPlayback::at_gain(1.0),
                )
            )
            .is_none());
        graph
    }

    #[test]
    fn the_solo_gate_closes_ahead_of_the_send_taps_and_the_mute_deliberately_does_not() {
        let mut graph = graph_with_constant_clip(1, 1.0, 4);
        assert!(graph.add_bus(TimelineBus::new(50)).is_none());
        assert!(graph
            .add_send(1, 50, SendTap::PreFader, 1.0, uncompensated())
            .is_none());

        let mut left = vec![0.0; 4];
        let mut right = vec![0.0; 4];
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![2.0; 4], "the track's output plus its cue send");

        // Mute is post-fader by design: the cue send keeps feeding its bus
        // while the engineer pulls the fader down, which is the whole reason a
        // pre-fader send exists.
        graph.set_track_mute(1, true);
        left.fill(0.0);
        right.fill(0.0);
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![1.0; 4], "the muted track still feeds its bus");

        // Solo-in-place has to silence the track *and* its sends, so soloing
        // one track does not go on playing every other track's reverb tail.
        // A gate folded into the mute would leave this at 1.0.
        graph.set_track_mute(1, false);
        graph.set_track_solo_gate(1, true);
        assert!(graph.track(1).expect("the track").is_solo_gated());
        left.fill(0.0);
        right.fill(0.0);
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![0.0; 4], "a solo-gated track feeds nothing");

        // The two reasons are independent: releasing solo restores the tap
        // without clearing a mute the user pressed.
        graph.set_track_mute(1, true);
        graph.set_track_solo_gate(1, false);
        left.fill(0.0);
        right.fill(0.0);
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![1.0; 4]);
        assert!(graph.track(1).expect("the track").is_muted());
    }

    #[test]
    fn bus_strip_mute_silences_the_sends_that_feed_it() {
        let mut graph = graph_with_constant_clip(1, 1.0, 4);
        assert!(graph.add_bus(TimelineBus::new(50)).is_none());
        assert!(graph
            .add_send(1, 50, SendTap::PostFader, 1.0, uncompensated())
            .is_none());

        let mut left = vec![0.0; 4];
        let mut right = vec![0.0; 4];
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![2.0; 4], "the track's output plus its send");

        graph.set_bus_mute(50, true);
        assert!(graph.bus(50).expect("the bus").is_muted());
        left.fill(0.0);
        right.fill(0.0);
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![1.0; 4], "the muted bus contributes silence");
    }

    #[test]
    fn bus_strip_pan_folds_stereo_like_a_track() {
        let mut graph = TimelineGraph::new();
        assert!(graph.add_track(TimelineTrack::new(1)).is_none());
        assert!(graph
            .add_clip(
                1,
                TimelineClip::new(
                    9,
                    vec![1.0; 4].into(),
                    vec![0.0; 4].into(),
                    placement(0, 0, 4),
                    ClipPlayback::at_gain(1.0),
                )
            )
            .is_none());
        assert!(graph.add_bus(TimelineBus::new(50)).is_none());
        graph.set_track_output(1, RouteTarget::Bus(50));

        let mut left = vec![0.0; 4];
        let mut right = vec![0.0; 4];
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![1.0; 4], "a centred bus is an identity");
        assert_eq!(right, vec![0.0; 4]);

        graph.automate(
            AutomationTarget::BusPan(50),
            AutomationWrite::Append(AutomationEvent {
                at_frame: 0,
                duration_frames: 0,
                value: 1.0,
                shape: RampShape::Step,
            }),
        );
        left.fill(0.0);
        right.fill(0.0);
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert!(left.iter().all(|sample| sample.abs() < 1e-6), "{left:?}");
        assert_eq!(
            right,
            vec![1.0; 4],
            "hard right folds the left into the right"
        );
    }

    #[test]
    fn bus_strip_solo_gate_silences_like_a_track() {
        let mut graph = graph_with_constant_clip(1, 1.0, 4);
        assert!(graph.add_bus(TimelineBus::new(50)).is_none());
        assert!(graph
            .add_send(1, 50, SendTap::PostFader, 1.0, uncompensated())
            .is_none());

        graph.set_bus_solo_gate(50, true);
        assert!(graph.bus(50).expect("the bus").is_solo_gated());
        let mut left = vec![0.0; 4];
        let mut right = vec![0.0; 4];
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(left, vec![1.0; 4], "a solo-gated bus contributes silence");

        graph.set_bus_mute(50, true);
        graph.set_bus_solo_gate(50, false);
        left.fill(0.0);
        right.fill(0.0);
        graph.render(0, 4, true, &mut NoDevices, &mut left, &mut right);
        assert_eq!(
            left,
            vec![1.0; 4],
            "releasing solo leaves a mute the user pressed"
        );
        assert!(graph.bus(50).expect("the bus").is_muted());
    }

    #[test]
    fn a_send_bus_runs_its_own_insert_chain_over_what_reaches_it() {
        let mut graph = graph_with_constant_clip(1, 1.0, 4);
        assert!(graph.add_bus(TimelineBus::new(50)).is_none());
        assert!(graph
            .add_send(1, 50, SendTap::PostFader, 1.0, uncompensated())
            .is_none());
        let mut devices = TestDevices {
            scaler_id: 7,
            factor: 0.5,
            generator_id: usize::MAX,
            emits: 0.0,
        };

        // A bus with no insert is a gain and a routing hop: the send arrives at
        // the master untouched, and there is nowhere to put the reverb the send
        // was routed there for.
        let mut left = vec![0.0; 4];
        let mut right = vec![0.0; 4];
        graph.render(0, 4, true, &mut devices, &mut left, &mut right);
        assert_eq!(left, vec![2.0; 4]);

        assert!(graph.insert_bus_device(50, effect(7), 0));
        assert_eq!(
            graph.bus(50).map(|bus| chain_ids(bus.device_chain())),
            Some(vec![7])
        );
        left.fill(0.0);
        right.fill(0.0);
        graph.render(0, 4, true, &mut devices, &mut left, &mut right);
        assert_eq!(
            left,
            vec![1.5; 4],
            "the track's own output plus a send the bus's insert halved"
        );

        // And the splice is reversible without unloading the effect.
        assert!(graph.remove_bus_device(50, 7));
        left.fill(0.0);
        right.fill(0.0);
        graph.render(0, 4, true, &mut devices, &mut left, &mut right);
        assert_eq!(left, vec![2.0; 4]);
    }

    #[test]
    fn a_generator_joins_the_chain_and_what_follows_it_processes_the_sum() {
        let mut graph = graph_with_constant_clip(1, 1.0, 4);
        assert!(graph.insert_track_device(1, generator(11), 0));
        assert!(graph.insert_track_device(1, effect(7), 1));
        let mut devices = TestDevices {
            scaler_id: 7,
            factor: 0.5,
            generator_id: 11,
            emits: 0.5,
        };

        // The generator accumulates into the chain rather than displacing it,
        // and the effect behind it sees the sum: (1.0 + 0.5) * 0.5. Run in
        // place, as a strictly serial chain must, the generator would have
        // erased the clip and left 0.5 * 0.5.
        let mut left = vec![0.0; 4];
        let mut right = vec![0.0; 4];
        graph.render(0, 4, true, &mut devices, &mut left, &mut right);
        assert_eq!(left, vec![0.75; 4]);
        assert_eq!(right, vec![0.75; 4]);
    }

    #[test]
    fn a_clip_fades_both_edges_at_the_anti_click_floor_it_was_given() {
        let mut clip = TimelineClip::new(
            9,
            vec![1.0; 8].into(),
            [].into(),
            placement(0, 0, 8),
            ClipPlayback::anti_click(1.0, 2),
        );
        let mut left = vec![0.0; 8];
        let mut right = vec![0.0; 8];
        clip.render_into(0, 8, &mut left, &mut right);

        // Starting and stopping on a full-scale sample steps the output, and a
        // step is a click. Without the floor every one of these would be 1.0.
        assert_eq!(left, vec![0.0, 0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5]);
        assert_eq!(right, left);

        // A user's own fade replaces the floor when it is longer, and is held
        // to the floor when it is shorter.
        clip.playback.fade = ClipFade {
            fade_in_frames: Some(4),
            fade_out_frames: Some(1),
            micro_fade_frames: 2,
        };
        left.fill(0.0);
        right.fill(0.0);
        clip.render_into(0, 8, &mut left, &mut right);
        assert_eq!(left, vec![0.0, 0.25, 0.5, 0.75, 1.0, 1.0, 1.0, 0.5]);

        // And a fade authored longer than the clip cannot swallow it: neither
        // edge takes more than half the audible span.
        clip.playback.fade = ClipFade {
            fade_in_frames: Some(100),
            fade_out_frames: Some(100),
            micro_fade_frames: 2,
        };
        left.fill(0.0);
        right.fill(0.0);
        clip.render_into(0, 8, &mut left, &mut right);
        assert_eq!(left, vec![0.0, 0.25, 0.5, 0.75, 1.0, 0.75, 0.5, 0.25]);
    }

    #[test]
    fn a_suppressed_edge_does_not_re_fade_a_sound_that_is_already_running() {
        // The second iteration of a loop continues the first without a break.
        // Fading in there is an audible dip, not an anti-click, so the caller
        // suppresses that edge and the renderer must honour it.
        let clip = TimelineClip::new(
            9,
            vec![1.0; 8].into(),
            [].into(),
            placement(0, 0, 8),
            ClipPlayback {
                gain: 1.0,
                fade: ClipFade {
                    fade_in_frames: None,
                    fade_out_frames: Some(0),
                    micro_fade_frames: 2,
                },
                playback_rate: 1.0,
            },
        );
        let mut left = vec![0.0; 8];
        let mut right = vec![0.0; 8];
        clip.render_into(0, 8, &mut left, &mut right);

        assert_eq!(left, vec![1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5]);
    }

    #[test]
    fn a_clip_rate_reads_its_material_faster_or_slower_across_the_span_it_names() {
        let material: Arc<[f32]> = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0].into();
        let mut clip = TimelineClip::new(
            9,
            material,
            [].into(),
            placement(0, 0, 4),
            ClipPlayback {
                gain: 1.0,
                fade: ClipFade::NONE,
                playback_rate: 2.0,
            },
        );
        let mut left = vec![0.0; 4];
        let mut right = vec![0.0; 4];
        clip.render_into(0, 4, &mut left, &mut right);

        // The placement's length is timeline frames, not source frames: four
        // frames sound, and the rate decides how much material they consume.
        assert_eq!(left, vec![0.0, 2.0, 4.0, 6.0]);

        // Below unity the read lands between frames and is interpolated.
        clip.playback.playback_rate = 0.5;
        left.fill(0.0);
        right.fill(0.0);
        clip.render_into(0, 4, &mut left, &mut right);
        assert_eq!(left, vec![0.0, 0.5, 1.0, 1.5]);

        // Unity is the untouched read, bit for bit.
        clip.playback.playback_rate = 1.0;
        left.fill(0.0);
        right.fill(0.0);
        clip.render_into(0, 4, &mut left, &mut right);
        assert_eq!(left, vec![0.0, 1.0, 2.0, 3.0]);
    }

    #[test]
    fn a_clip_playback_the_renderer_cannot_read_is_refused_rather_than_guessed() {
        let mut graph = TimelineGraph::new();
        assert!(graph.add_track(TimelineTrack::new(1)).is_none());

        // Zero source frames per rendered frame has no reading, and rounding it
        // to unity would play the material at a rate nobody asked for.
        let stalled = ClipPlayback {
            gain: 1.0,
            fade: ClipFade::NONE,
            playback_rate: 0.0,
        };
        assert!(graph
            .add_clip(
                1,
                TimelineClip::new(
                    9,
                    vec![1.0; 4].into(),
                    [].into(),
                    placement(0, 0, 4),
                    stalled
                )
            )
            .is_some());
        assert_eq!(graph.diagnostics().invalid_clip_playbacks, 1);
        assert_eq!(graph.track(1).map(|track| track.clips.len()), Some(0));

        assert!(graph
            .add_clip(
                1,
                TimelineClip::new(
                    9,
                    vec![1.0; 4].into(),
                    [].into(),
                    placement(0, 0, 4),
                    ClipPlayback::at_gain(1.0)
                )
            )
            .is_none());
        graph.set_clip_playback(
            1,
            9,
            ClipPlayback {
                gain: 1.0,
                fade: ClipFade::NONE,
                playback_rate: f32::NAN,
            },
        );
        assert_eq!(graph.diagnostics().invalid_clip_playbacks, 2);
        assert_eq!(
            graph
                .clip_playback(1, 9)
                .map(|playback| playback.playback_rate),
            Some(1.0),
            "the clip keeps the playback it already had"
        );
    }

    #[test]
    fn a_replacing_write_supersedes_the_queue_and_an_appending_one_fills_it() {
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut replaced = RampedParam::new(0.0);
        let mut appended = RampedParam::new(0.0);

        // Twenty ticks of a dragged fader, each meaning to supersede the last.
        for tick in 0..20u64 {
            let event = ramp(tick, 4, tick as f32, RampShape::Linear);
            assert!(
                replaced.write(AutomationWrite::Replace(event)),
                "tick {tick} of a replacing stream must always find a slot"
            );
            // The same stream appended runs out of queue in eight ticks, which
            // is the failure this primitive exists to remove.
            assert_eq!(
                appended.write(AutomationWrite::Append(event)),
                tick < AUTOMATION_QUEUE_CAPACITY as u64
            );
        }

        // The replacing stream lands on the target the user actually dragged
        // to. The appending one is stranded on the eighth tick's target,
        // however long the drag went on.
        assert_eq!(replaced.value_at(100, &mut diagnostics), 19.0);
        assert_eq!(appended.value_at(100, &mut diagnostics), 7.0);
    }

    #[test]
    fn a_replacing_ramp_continues_the_trajectory_instead_of_compounding_onto_it() {
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut param = RampedParam::new(1.0);
        param.write(AutomationWrite::Replace(ramp(0, 8, 0.0, RampShape::Linear)));
        assert_eq!(param.value_at(2, &mut diagnostics), 0.75);

        // A second tick, aimed at 1.0 four frames out. It has to start from
        // where the parameter actually is at frame 4 — mid-glide at 0.5 — not
        // from the 0.0 the first ramp was still aiming at.
        param.write(AutomationWrite::Replace(ramp(4, 4, 1.0, RampShape::Linear)));
        assert_eq!(param.value_at(4, &mut diagnostics), 0.5);
        assert_eq!(param.value_at(6, &mut diagnostics), 0.75);
        assert_eq!(param.value_at(8, &mut diagnostics), 1.0);
    }

    #[test]
    fn a_replacing_ramp_keeps_a_change_that_lands_before_it_starts() {
        // The offline shape: the whole window queues before the playhead
        // moves, and the strip's creation state is itself a queued step at
        // frame 0. A ramp replacing at frame 8 must glide *from* that state,
        // not erase it — Web Audio's `cancelScheduledValues(startTime)` drops
        // events by the frame they land on, and frame 0 is history at 8.
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut param = RampedParam::new(1.0);
        param.write(AutomationWrite::Append(ramp(0, 0, 0.5, RampShape::Step)));
        param.write(AutomationWrite::Replace(ramp(8, 8, 1.0, RampShape::Linear)));

        // Erasing the step would leave both of these flat at the 1.0 the
        // parameter was constructed with.
        assert_eq!(param.value_at(0, &mut diagnostics), 0.5);
        assert_eq!(param.value_at(12, &mut diagnostics), 0.75);
        assert_eq!(param.value_at(16, &mut diagnostics), 1.0);
    }

    #[test]
    fn a_replacing_ramp_drops_a_pending_ramp_still_gliding_across_its_start() {
        // The earlier ramp starts before the replacement but lands after it:
        // stale by the stamp law even though its start frame is earlier, and
        // gone whole rather than truncated — nothing glides toward 0.0 first.
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut param = RampedParam::new(0.75);
        param.write(AutomationWrite::Append(ramp(4, 8, 0.0, RampShape::Linear)));
        param.write(AutomationWrite::Replace(ramp(
            8,
            4,
            0.25,
            RampShape::Linear,
        )));

        assert_eq!(param.value_at(6, &mut diagnostics), 0.75);
        assert_eq!(param.value_at(10, &mut diagnostics), 0.5);
        assert_eq!(param.value_at(12, &mut diagnostics), 0.25);
    }

    #[test]
    fn a_hold_keeps_a_change_that_landed_before_the_frame_it_names() {
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut param = RampedParam::new(1.0);
        param.write(AutomationWrite::Append(ramp(0, 0, 0.5, RampShape::Step)));
        param.write(AutomationWrite::Append(ramp(8, 0, 0.9, RampShape::Step)));
        param.write(AutomationWrite::Hold { at_frame: 4 });

        // The step at 0 is history and lands; the step at 8 was aimed past
        // the hold and dies with it.
        assert_eq!(param.value_at(100, &mut diagnostics), 0.5);
    }

    #[test]
    fn a_hold_freezes_the_parameter_on_the_frame_it_names_and_drops_what_was_queued() {
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut param = RampedParam::new(1.0);
        param.write(AutomationWrite::Append(ramp(0, 8, 0.0, RampShape::Linear)));
        param.write(AutomationWrite::Append(ramp(8, 0, 0.9, RampShape::Step)));
        assert_eq!(param.value_at(2, &mut diagnostics), 0.75);

        param.write(AutomationWrite::Hold { at_frame: 4 });

        // Frozen on frame 4, not on the frame the block happened to reach the
        // hold on, and holding rather than jumping.
        assert_eq!(param.value_at(3, &mut diagnostics), 0.625);
        assert_eq!(param.value_at(4, &mut diagnostics), 0.5);
        assert_eq!(param.value_at(5, &mut diagnostics), 0.5);
        // The change stamped behind the hold went with it: it was aimed at a
        // trajectory the hold ended.
        assert_eq!(param.value_at(100, &mut diagnostics), 0.5);
    }

    #[test]
    fn a_locate_drops_the_window_beyond_it_and_keeps_what_the_playhead_passed() {
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut graph = TimelineGraph::new();
        assert!(graph.add_track(TimelineTrack::new(1)).is_none());
        graph.automate(
            AutomationTarget::TrackGain(1),
            AutomationWrite::Append(ramp(4, 0, 0.5, RampShape::Step)),
        );
        graph.automate(
            AutomationTarget::TrackGain(1),
            AutomationWrite::Append(ramp(12, 0, 0.25, RampShape::Step)),
        );

        graph.seek(8);

        // The change the locate skipped over still lands, which is what puts
        // the fader on the curve where the playhead now stands. The change
        // beyond the locate is gone: it belongs to a window the control thread
        // pushed for the old position and will re-issue for the new one.
        let gain = &mut graph.track_mut(1).expect("the track").gain;
        assert_eq!(gain.value_at(8, &mut diagnostics), 0.5);
        assert_eq!(gain.value_at(100, &mut diagnostics), 0.5);
    }

    #[test]
    fn a_locate_drops_a_change_stamped_exactly_on_its_frame() {
        // The boundary is the law the control thread orders itself around: a
        // write stamped on the locate frame belongs to the stale window and
        // dies with it, so the window pushed *after* the locate is the only
        // thing that can land there. Pinned separately because the straddling
        // test above cannot tell `>=` from `>`.
        let mut diagnostics = TimelineRtDiagnostics::new();
        let mut graph = TimelineGraph::new();
        assert!(graph.add_track(TimelineTrack::new(1)).is_none());
        graph.automate(
            AutomationTarget::TrackGain(1),
            AutomationWrite::Append(ramp(8, 0, 0.25, RampShape::Step)),
        );

        graph.seek(8);

        let gain = &mut graph.track_mut(1).expect("the track").gain;
        assert_eq!(gain.value_at(8, &mut diagnostics), 1.0);
        assert_eq!(gain.value_at(100, &mut diagnostics), 1.0);
    }
}
