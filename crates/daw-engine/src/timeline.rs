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

use crate::audio_thread::MAX_CALLBACK_FRAMES;
use triple_buffer::{Input, Output};

/// Tracks the graph holds. A command naming a further track is refused and
/// counted, because growing the vector would allocate on the callback.
pub const MAX_TIMELINE_TRACKS: usize = 128;
/// Buses the graph holds, on the same fixed-capacity contract as tracks.
pub const MAX_TIMELINE_BUSES: usize = 64;
/// Devices one track's chain holds.
pub const MAX_TRACK_DEVICES: usize = 32;
/// Sends one track holds.
pub const MAX_TRACK_SENDS: usize = 16;
/// Clips one track holds.
pub const MAX_TRACK_CLIPS: usize = 1024;
/// Time-stamped parameter events one parameter holds before its earliest
/// unlanded event is refused.
pub const AUTOMATION_QUEUE_CAPACITY: usize = 8;

/// Hops the routing walk follows before it calls a chain cyclic. Every node
/// routes to a node closer to the master, so a chain longer than the node
/// count cannot be acyclic.
const MAX_ROUTE_HOPS: usize = MAX_TIMELINE_TRACKS + MAX_TIMELINE_BUSES;

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
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AutomationTarget {
    TrackGain(usize),
    TrackPan(usize),
    TrackSendLevel { track_id: usize, bus_id: usize },
    BusGain(usize),
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
    /// its collection past the fixed capacity it was built with.
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
    /// A bus asked to route into a track. Buses are summed after every track
    /// has been rendered, so that edge could never carry audio.
    pub invalid_bus_routings: u64,
    /// An exponential ramp requested through or across zero, run as a linear
    /// ramp instead.
    pub exponential_ramp_fallbacks: u64,
    /// A send that rendered with no live bus to land on, because the bus was
    /// removed or never added. Counted once each time a send goes dead rather
    /// than once per block, so the number is a count of events an engineer can
    /// act on and not of callbacks.
    pub unresolved_send_buses: u64,
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

    fn record_invalid_bus_routing(&mut self) {
        self.snapshot.invalid_bus_routings = self.snapshot.invalid_bus_routings.saturating_add(1);
    }

    fn record_exponential_ramp_fallback(&mut self) {
        self.snapshot.exponential_ramp_fallbacks =
            self.snapshot.exponential_ramp_fallbacks.saturating_add(1);
    }

    fn record_unresolved_send_bus(&mut self) {
        self.snapshot.unresolved_send_buses = self.snapshot.unresolved_send_buses.saturating_add(1);
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

impl AutomationEvent {
    const SETTLED: Self = Self {
        at_frame: 0,
        duration_frames: 0,
        value: 0.0,
        shape: RampShape::Step,
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
    pending: [AutomationEvent; AUTOMATION_QUEUE_CAPACITY],
    pending_len: usize,
}

impl RampedParam {
    pub const fn new(value: f32) -> Self {
        Self {
            value,
            active: None,
            pending: [AutomationEvent::SETTLED; AUTOMATION_QUEUE_CAPACITY],
            pending_len: 0,
        }
    }

    /// The value the parameter currently holds, without advancing it.
    pub const fn value(&self) -> f32 {
        self.value
    }

    /// Queue a change, keeping the queue ordered by stamp so an event that
    /// arrives out of order still lands in timeline order. Returns `false`
    /// when the queue is full; the caller counts the refusal.
    fn schedule(&mut self, event: AutomationEvent) -> bool {
        if self.pending_len == AUTOMATION_QUEUE_CAPACITY {
            return false;
        }

        let mut index = self.pending_len;
        while index > 0 && self.pending[index - 1].at_frame > event.at_frame {
            self.pending[index] = self.pending[index - 1];
            index -= 1;
        }
        self.pending[index] = event;
        self.pending_len += 1;
        true
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
            let event = self.pending[0];
            self.pending.copy_within(1..self.pending_len, 0);
            self.pending_len -= 1;
            self.begin(event, diagnostics);
        }

        if let Some(ramp) = self.active {
            if frame >= ramp.end_frame {
                self.value = ramp.to;
                self.active = None;
            } else if frame > ramp.start_frame {
                let span = (ramp.end_frame - ramp.start_frame) as f32;
                let progress = (frame - ramp.start_frame) as f32 / span;
                self.value = match ramp.shape {
                    RampShape::Exponential => ramp.from * (ramp.to / ramp.from).powf(progress),
                    RampShape::Linear | RampShape::Step => {
                        ramp.from + (ramp.to - ramp.from) * progress
                    }
                };
            } else {
                self.value = ramp.from;
            }
        }

        self.value
    }

    fn begin(&mut self, event: AutomationEvent, diagnostics: &mut TimelineRtDiagnostics) {
        if event.duration_frames == 0 || event.shape == RampShape::Step {
            self.value = event.value;
            self.active = None;
            return;
        }

        let from = self.value;
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
pub const DEVICE_PARAM_QUEUE_CAPACITY: usize = 8;

/// One time-stamped change to a built-in device parameter.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DeviceParamEvent {
    pub param: DeviceParam,
    pub value: f32,
    /// Absolute timeline frame at which the change takes effect. A device owns
    /// its own parameter smoothing, so the change lands on the first block
    /// whose span reaches the stamp rather than at a sample offset inside it.
    pub at_frame: u64,
}

impl DeviceParamEvent {
    const SETTLED: Self = Self {
        param: DeviceParam::ShiftSemitones,
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

/// One audio clip on a track, owning its source material.
///
/// Built on the control thread and moved into the graph, because the two
/// sample vectors are the only large allocation the timeline holds.
pub struct TimelineClip {
    clip_id: usize,
    left: Vec<f32>,
    /// Empty for a mono source, which is played to both outputs.
    right: Vec<f32>,
    placement: ClipPlacement,
    gain: f32,
}

impl TimelineClip {
    /// Build a clip on the control thread. `right` may be empty for mono
    /// material.
    pub fn new(
        clip_id: usize,
        left: Vec<f32>,
        right: Vec<f32>,
        placement: ClipPlacement,
        gain: f32,
    ) -> Box<Self> {
        Box::new(Self {
            clip_id,
            left,
            right,
            placement,
            gain,
        })
    }

    pub const fn clip_id(&self) -> usize {
        self.clip_id
    }

    pub const fn placement(&self) -> ClipPlacement {
        self.placement
    }

    /// Sum the part of this clip that falls inside `[block_start, block_start +
    /// frames)` into the track's signal, sample for sample.
    fn render_into(&self, block_start: u64, frames: usize, left: &mut [f32], right: &mut [f32]) {
        let start = self.placement.start_frame;
        let end = start.saturating_add(self.placement.length_frames);
        let block_end = block_start + frames as u64;
        if end <= block_start || start >= block_end {
            return;
        }

        let first = start.max(block_start);
        let last = end.min(block_end);
        let mono = self.right.is_empty();

        for frame in first..last {
            let source_index = self.placement.source_offset_frames + (frame - start);
            let Ok(source_index) = usize::try_from(source_index) else {
                return;
            };
            // Material shorter than the placement plays out and leaves the rest
            // of the span silent. The index only grows, so nothing after this
            // frame can be in range either.
            let Some(&sample_left) = self.left.get(source_index) else {
                return;
            };
            let sample_right = if mono {
                sample_left
            } else {
                self.right.get(source_index).copied().unwrap_or(sample_left)
            };

            let out = (frame - block_start) as usize;
            left[out] += sample_left * self.gain;
            right[out] += sample_right * self.gain;
        }
    }
}

/// One send from a track to a bus.
///
/// The bus id is accepted whether or not that bus is live yet, so the order of
/// `AddSend` and `AddBus` in a command batch cannot matter. Whether the send
/// actually found its bus is therefore a render-time fact, latched here so a
/// dead send is diagnosed once rather than once per callback.
#[derive(Clone, Copy, Debug)]
pub struct TrackSend {
    bus_id: usize,
    tap: SendTap,
    level: RampedParam,
    bus_missing: bool,
}

/// One track: an input sum, clips, a device chain, sends, a fader, a mute, a
/// panner, and an output.
///
/// The order of the strip is the professional one and the one the app's graph
/// already builds: input and clips, then the device chain, then the pre-fader
/// send tap, then the fader, then the mute, then the panner, then the
/// post-fader send tap and the output.
pub struct TimelineTrack {
    id: usize,
    input_left: Vec<f32>,
    input_right: Vec<f32>,
    clips: Vec<Box<TimelineClip>>,
    /// Ids of the effects that make up this track's device chain, in order.
    /// The effects themselves stay in the scheduler's id-addressed table; this
    /// is the ordering and the splice point.
    chain: Vec<usize>,
    sends: Vec<TrackSend>,
    gain: RampedParam,
    pan: RampedParam,
    muted: bool,
    output: RouteTarget,
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
            output: RouteTarget::Master,
        })
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

    pub fn device_chain(&self) -> &[usize] {
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

/// One bus: an input sum, a gain, and an output. Buses are summed after every
/// track, so a bus may feed the master or another bus but never a track.
pub struct TimelineBus {
    id: usize,
    input_left: Vec<f32>,
    input_right: Vec<f32>,
    gain: RampedParam,
    output: RouteTarget,
}

impl TimelineBus {
    /// Build a bus on the control thread, for the reason given on
    /// [`TimelineTrack::new`].
    pub fn new(id: usize) -> Box<Self> {
        Box::new(Self {
            id,
            input_left: vec![0.0; MAX_CALLBACK_FRAMES],
            input_right: vec![0.0; MAX_CALLBACK_FRAMES],
            gain: RampedParam::new(1.0),
            output: RouteTarget::Master,
        })
    }

    pub const fn id(&self) -> usize {
        self.id
    }

    pub const fn output(&self) -> RouteTarget {
        self.output
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

/// What one removal hands back to the retirement channel, so the audio thread
/// never runs a destructor.
pub(crate) enum RetiredTimelineObject {
    Track(Box<TimelineTrack>),
    Bus(Box<TimelineBus>),
    Clip(Box<TimelineClip>),
}

/// The routed graph.
pub struct TimelineGraph {
    tracks: Vec<Box<TimelineTrack>>,
    buses: Vec<Box<TimelineBus>>,
    /// Track indices, deepest first, so a track feeding another track is
    /// always rendered before the track it feeds.
    track_order: Vec<usize>,
    /// Bus indices, on the same contract.
    bus_order: Vec<usize>,
    /// Scratch for an order rebuild, sized once on the control thread. The
    /// route walk is resolved into it exactly once per node, because a
    /// comparison key that walked the route itself would repeat that walk for
    /// every comparison the sort makes, on the callback.
    route_depths: Vec<usize>,
    master_gain: RampedParam,
    scratch_left: Vec<f32>,
    scratch_right: Vec<f32>,
    diagnostics: TimelineRtDiagnostics,
}

impl TimelineGraph {
    pub fn new() -> Self {
        Self {
            tracks: Vec::with_capacity(MAX_TIMELINE_TRACKS),
            buses: Vec::with_capacity(MAX_TIMELINE_BUSES),
            track_order: Vec::with_capacity(MAX_TIMELINE_TRACKS),
            bus_order: Vec::with_capacity(MAX_TIMELINE_BUSES),
            route_depths: Vec::with_capacity(MAX_TIMELINE_TRACKS.max(MAX_TIMELINE_BUSES)),
            master_gain: RampedParam::new(1.0),
            scratch_left: vec![0.0; MAX_CALLBACK_FRAMES],
            scratch_right: vec![0.0; MAX_CALLBACK_FRAMES],
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
            track_order: Vec::new(),
            bus_order: Vec::new(),
            route_depths: Vec::new(),
            master_gain: RampedParam::new(1.0),
            scratch_left: Vec::new(),
            scratch_right: Vec::new(),
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
        self.rebuild_track_order();
        None
    }

    pub(crate) fn remove_track(&mut self, id: usize) -> Option<Box<TimelineTrack>> {
        let Some(index) = self.tracks.iter().position(|track| track.id == id) else {
            self.diagnostics.record_unknown_target();
            return None;
        };

        let track = self.tracks.remove(index);
        self.rebuild_track_order();
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
        self.rebuild_bus_order();
        None
    }

    pub(crate) fn remove_bus(&mut self, id: usize) -> Option<Box<TimelineBus>> {
        let Some(index) = self.buses.iter().position(|bus| bus.id == id) else {
            self.diagnostics.record_unknown_target();
            return None;
        };

        let bus = self.buses.remove(index);
        self.rebuild_bus_order();
        Some(bus)
    }

    pub(crate) fn set_track_output(&mut self, id: usize, target: RouteTarget) {
        let Some(index) = self.tracks.iter().position(|track| track.id == id) else {
            self.diagnostics.record_unknown_target();
            return;
        };

        let previous = self.tracks[index].output;
        self.tracks[index].output = target;
        if self.track_route_depth(index).is_none() {
            self.tracks[index].output = previous;
            self.diagnostics.record_routing_cycle_refused();
            return;
        }

        self.rebuild_track_order();
    }

    pub(crate) fn set_bus_output(&mut self, id: usize, target: RouteTarget) {
        if matches!(target, RouteTarget::Track(_)) {
            self.diagnostics.record_invalid_bus_routing();
            return;
        }
        let Some(index) = self.buses.iter().position(|bus| bus.id == id) else {
            self.diagnostics.record_unknown_target();
            return;
        };

        let previous = self.buses[index].output;
        self.buses[index].output = target;
        if self.bus_route_depth(index).is_none() {
            self.buses[index].output = previous;
            self.diagnostics.record_routing_cycle_refused();
            return;
        }

        self.rebuild_bus_order();
    }

    pub(crate) fn set_track_mute(&mut self, id: usize, muted: bool) {
        let Some(track) = self.track_mut(id) else {
            self.diagnostics.record_unknown_target();
            return;
        };
        track.muted = muted;
    }

    /// Returns whether the chain took the effect, so the caller only claims an
    /// effect the chain accepted.
    ///
    /// An effect belongs to exactly one chain. A second claim — by the same
    /// track or by another one — is refused and counted as an id collision:
    /// one instance spliced into two chains would run its state over two
    /// unrelated streams interleaved, and the effect's single-valued placement
    /// could only ever name one of the two claimants.
    pub(crate) fn insert_track_device(
        &mut self,
        track_id: usize,
        effect_id: usize,
        index: usize,
    ) -> bool {
        let Some(target) = self.tracks.iter().position(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return false;
        };
        if self
            .tracks
            .iter()
            .any(|track| track.chain.contains(&effect_id))
        {
            self.diagnostics.record_id_collision();
            return false;
        }

        let track = &mut self.tracks[target];
        if track.chain.len() == track.chain.capacity() {
            self.diagnostics.record_capacity_refusal();
            return false;
        }

        track.chain.insert(index.min(track.chain.len()), effect_id);
        true
    }

    pub(crate) fn remove_track_device(&mut self, track_id: usize, effect_id: usize) -> bool {
        let Some(track) = self.tracks.iter_mut().find(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return false;
        };
        let Some(index) = track.chain.iter().position(|id| *id == effect_id) else {
            self.diagnostics.record_unknown_target();
            return false;
        };

        track.chain.remove(index);
        true
    }

    pub(crate) fn add_send(&mut self, track_id: usize, bus_id: usize, tap: SendTap, level: f32) {
        let Some(track) = self.tracks.iter_mut().find(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return;
        };
        if track.sends.iter().any(|send| send.bus_id == bus_id) {
            self.diagnostics.record_id_collision();
            return;
        }
        if track.sends.len() == track.sends.capacity() {
            self.diagnostics.record_capacity_refusal();
            return;
        }

        track.sends.push(TrackSend {
            bus_id,
            tap,
            level: RampedParam::new(level),
            bus_missing: false,
        });
    }

    pub(crate) fn remove_send(&mut self, track_id: usize, bus_id: usize) {
        let Some(track) = self.tracks.iter_mut().find(|track| track.id == track_id) else {
            self.diagnostics.record_unknown_target();
            return;
        };
        let Some(index) = track.sends.iter().position(|send| send.bus_id == bus_id) else {
            self.diagnostics.record_unknown_target();
            return;
        };

        track.sends.remove(index);
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

    pub(crate) fn automate(&mut self, target: AutomationTarget, event: AutomationEvent) {
        let param = match target {
            AutomationTarget::MasterGain => Some(&mut self.master_gain),
            AutomationTarget::TrackGain(id) => self.track_mut(id).map(|track| &mut track.gain),
            AutomationTarget::TrackPan(id) => self.track_mut(id).map(|track| &mut track.pan),
            AutomationTarget::BusGain(id) => self
                .buses
                .iter_mut()
                .find(|bus| bus.id == id)
                .map(|bus| &mut bus.gain),
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

        if !param.schedule(event) {
            self.diagnostics.record_automation_queue_overflow();
        }
    }

    fn track_mut(&mut self, id: usize) -> Option<&mut TimelineTrack> {
        self.tracks
            .iter_mut()
            .find(|track| track.id == id)
            .map(|track| &mut **track)
    }

    /// Hops from this track to the master, or `None` when the chain loops.
    fn track_route_depth(&self, index: usize) -> Option<usize> {
        let mut current = index;
        for hops in 0..=MAX_ROUTE_HOPS {
            let RouteTarget::Track(next_id) = self.tracks[current].output else {
                return Some(hops);
            };
            let Some(next) = self.tracks.iter().position(|track| track.id == next_id) else {
                // A target that names no live track falls back to the master.
                return Some(hops);
            };
            if next == index {
                return None;
            }
            current = next;
        }
        None
    }

    fn bus_route_depth(&self, index: usize) -> Option<usize> {
        let mut current = index;
        for hops in 0..=MAX_ROUTE_HOPS {
            let RouteTarget::Bus(next_id) = self.buses[current].output else {
                return Some(hops);
            };
            let Some(next) = self.buses.iter().position(|bus| bus.id == next_id) else {
                return Some(hops);
            };
            if next == index {
                return None;
            }
            current = next;
        }
        None
    }

    /// Deepest first, ties broken by insertion order so the render sequence is
    /// a function of the command stream alone.
    ///
    /// Each node's depth is resolved once into the graph's scratch buffer and
    /// the sort then reads it, because the route walk is far more expensive
    /// than the comparison and a sort makes many comparisons per element.
    fn rebuild_track_order(&mut self) {
        let mut order = std::mem::take(&mut self.track_order);
        let mut depths = std::mem::take(&mut self.route_depths);
        order.clear();
        depths.clear();
        for index in 0..self.tracks.len() {
            depths.push(self.track_route_depth(index).unwrap_or(0));
            order.push(index);
        }
        order.sort_unstable_by_key(|&index| (std::cmp::Reverse(depths[index]), index));
        self.track_order = order;
        self.route_depths = depths;
    }

    fn rebuild_bus_order(&mut self) {
        let mut order = std::mem::take(&mut self.bus_order);
        let mut depths = std::mem::take(&mut self.route_depths);
        order.clear();
        depths.clear();
        for index in 0..self.buses.len() {
            depths.push(self.bus_route_depth(index).unwrap_or(0));
            order.push(index);
        }
        order.sort_unstable_by_key(|&index| (std::cmp::Reverse(depths[index]), index));
        self.bus_order = order;
        self.route_depths = depths;
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
            track_order,
            bus_order,
            scratch_left,
            scratch_right,
            diagnostics,
            ..
        } = self;

        for track in tracks.iter_mut() {
            track.clear_input(frames);
        }
        for bus in buses.iter_mut() {
            bus.clear_input(frames);
        }

        for order_index in 0..track_order.len() {
            let index = track_order[order_index];
            let left = &mut scratch_left[..frames];
            let right = &mut scratch_right[..frames];

            {
                let track = &mut tracks[index];
                left.copy_from_slice(&track.input_left[..frames]);
                right.copy_from_slice(&track.input_right[..frames]);
                if render_clips {
                    for clip in &track.clips {
                        clip.render_into(block_start, frames, left, right);
                    }
                }
            }

            for chain_index in 0..tracks[index].chain.len() {
                let effect_id = tracks[index].chain[chain_index];
                devices.run_device(effect_id, left, right, frames);
            }

            {
                let track = &mut tracks[index];
                run_sends(
                    track,
                    SendTap::PreFader,
                    buses,
                    block_start,
                    frames,
                    left,
                    right,
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
                    diagnostics,
                );
            }

            match tracks[index].output {
                RouteTarget::Track(target_id) => {
                    match tracks.iter_mut().find(|track| track.id == target_id) {
                        Some(target) => {
                            sum_into(&mut target.input_left[..frames], left);
                            sum_into(&mut target.input_right[..frames], right);
                        }
                        None => {
                            sum_into(&mut master_left[..frames], left);
                            sum_into(&mut master_right[..frames], right);
                        }
                    }
                }
                RouteTarget::Bus(target_id) => {
                    match buses.iter_mut().find(|bus| bus.id == target_id) {
                        Some(target) => {
                            sum_into(&mut target.input_left[..frames], left);
                            sum_into(&mut target.input_right[..frames], right);
                        }
                        None => {
                            sum_into(&mut master_left[..frames], left);
                            sum_into(&mut master_right[..frames], right);
                        }
                    }
                }
                RouteTarget::Master => {
                    sum_into(&mut master_left[..frames], left);
                    sum_into(&mut master_right[..frames], right);
                }
            }
        }

        for order_index in 0..bus_order.len() {
            let index = bus_order[order_index];
            let left = &mut scratch_left[..frames];
            let right = &mut scratch_right[..frames];

            {
                let bus = &mut buses[index];
                left.copy_from_slice(&bus.input_left[..frames]);
                right.copy_from_slice(&bus.input_right[..frames]);
                apply_gain(&mut bus.gain, block_start, frames, left, right, diagnostics);
            }

            match buses[index].output {
                RouteTarget::Bus(target_id) => {
                    match buses.iter_mut().find(|bus| bus.id == target_id) {
                        Some(target) => {
                            sum_into(&mut target.input_left[..frames], left);
                            sum_into(&mut target.input_right[..frames], right);
                        }
                        None => {
                            sum_into(&mut master_left[..frames], left);
                            sum_into(&mut master_right[..frames], right);
                        }
                    }
                }
                RouteTarget::Master | RouteTarget::Track(_) => {
                    sum_into(&mut master_left[..frames], left);
                    sum_into(&mut master_right[..frames], right);
                }
            }
        }
    }

    /// Apply the master fader, the last stage of the strip, after the master
    /// insert chain has run.
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
    }
}

#[inline]
fn sum_into(destination: &mut [f32], source: &[f32]) {
    for (out, sample) in destination.iter_mut().zip(source.iter()) {
        *out += *sample;
    }
}

#[allow(clippy::too_many_arguments)]
fn run_sends(
    track: &mut TimelineTrack,
    tap: SendTap,
    buses: &mut [Box<TimelineBus>],
    block_start: u64,
    frames: usize,
    left: &[f32],
    right: &[f32],
    diagnostics: &mut TimelineRtDiagnostics,
) {
    for send in track.sends.iter_mut() {
        if send.tap != tap {
            continue;
        }
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
                ramp(1_000 + index as u64, 0, 0.5, RampShape::Step),
            );
        }

        assert_eq!(graph.diagnostics().automation_queue_overflows, 1);
    }

    #[test]
    fn device_parameter_events_pop_in_stamp_order_once_the_block_reaches_them() {
        let mut queue = DeviceParamQueue::new();
        assert!(queue.is_empty());
        assert!(queue.schedule(DeviceParamEvent {
            param: DeviceParam::RetuneSpeedMs,
            value: 20.0,
            at_frame: 8,
        }));
        assert!(queue.schedule(DeviceParamEvent {
            param: DeviceParam::ShiftSemitones,
            value: 5.0,
            at_frame: 4,
        }));
        assert_eq!(queue.len(), 2);

        // Nothing is due before the earliest stamp, and the earliest comes out
        // first whichever order the two arrived in.
        assert_eq!(queue.pop_due(3), None);
        assert_eq!(
            queue.pop_due(4).map(|event| (event.param, event.value)),
            Some((DeviceParam::ShiftSemitones, 5.0))
        );
        assert_eq!(queue.pop_due(4), None);
        assert_eq!(
            queue.pop_due(9).map(|event| (event.param, event.value)),
            Some((DeviceParam::RetuneSpeedMs, 20.0))
        );
        assert!(queue.is_empty());
    }

    #[test]
    fn a_device_parameter_queue_past_its_capacity_refuses_rather_than_growing() {
        let mut queue = DeviceParamQueue::new();
        for index in 0..DEVICE_PARAM_QUEUE_CAPACITY {
            assert!(queue.schedule(DeviceParamEvent {
                param: DeviceParam::ShiftSemitones,
                value: 1.0,
                at_frame: index as u64,
            }));
        }

        assert!(!queue.schedule(DeviceParamEvent {
            param: DeviceParam::ShiftSemitones,
            value: 1.0,
            at_frame: 100,
        }));
        assert_eq!(queue.len(), DEVICE_PARAM_QUEUE_CAPACITY);
    }

    #[test]
    fn a_trimmed_clip_renders_the_window_its_placement_names_and_keeps_its_material() {
        let material = vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0];
        let mut clip = TimelineClip::new(9, material, Vec::new(), placement(0, 2, 3), 1.0);
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
        let clip = TimelineClip::new(9, vec![1.0, 1.0], Vec::new(), placement(0, 0, 6), 1.0);
        let mut left = vec![0.0; 6];
        let mut right = vec![0.0; 6];
        clip.render_into(0, 6, &mut left, &mut right);

        assert_eq!(left, vec![1.0, 1.0, 0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn a_clip_sums_into_the_span_it_names_and_leaves_the_rest_of_the_block_alone() {
        let clip = TimelineClip::new(9, vec![1.0; 8], Vec::new(), placement(3, 0, 2), 0.5);
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
    fn an_effect_one_track_already_claims_is_refused_by_every_other_chain() {
        let mut graph = TimelineGraph::new();
        assert!(graph.add_track(TimelineTrack::new(1)).is_none());
        assert!(graph.add_track(TimelineTrack::new(2)).is_none());
        assert!(graph.insert_track_device(1, 7, 0));

        // One instance on two chains would run its state over two unrelated
        // streams interleaved, and the effect's placement could only name one
        // of the two tracks that hold it.
        assert!(!graph.insert_track_device(2, 7, 0));
        assert!(!graph.insert_track_device(1, 7, 0));
        assert_eq!(graph.diagnostics().id_collisions, 2);
        assert_eq!(
            graph.track(1).map(|track| track.device_chain().to_vec()),
            Some(vec![7])
        );
        assert_eq!(
            graph.track(2).map(|track| track.device_chain().to_vec()),
            Some(Vec::new())
        );

        // Freed by the track that holds it, the effect is available again.
        assert!(graph.remove_track_device(1, 7));
        assert!(graph.insert_track_device(2, 7, 0));
    }

    #[test]
    fn a_send_whose_bus_is_gone_is_counted_once_and_leaves_the_track_alone() {
        let mut graph = TimelineGraph::new();
        assert!(graph.add_track(TimelineTrack::new(1)).is_none());
        assert!(graph.add_bus(TimelineBus::new(50)).is_none());
        assert!(graph
            .add_clip(
                1,
                TimelineClip::new(9, vec![1.0; 8], Vec::new(), placement(0, 0, 8), 1.0)
            )
            .is_none());
        graph.add_send(1, 50, SendTap::PostFader, 1.0);

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
}
