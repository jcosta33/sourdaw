//! Lock-free Messaging and Task Schedule for the native audio engine.
//!
//! Handles both built-in DSP effects (Knead) and external plugins (CLAP/VST3)
//! via the NativePlugin trait. All communication is lock-free via rtrb.

use crate::audio_bridge::{self, PluginAudioBridge, RENDER_QUANTUM_FRAMES};
use crate::audio_thread::MAX_CALLBACK_FRAMES;
#[cfg(test)]
use crate::midi::diagnostics::active_midi_rt_diagnostics_channel;
use crate::midi::diagnostics::{ActiveMidiRtDiagnostics, ActiveMidiRtDiagnosticsSnapshot};
use crate::midi_fx::{
    Arpeggiator, MidiEventBuffer, MidiFx, MidiFxChain, MidiFxParam, ProbabilityEvaluator,
    VelocityScaler,
};
use crate::plugin_slot::{CaptureInputBlock, MidiNoteEvent, NativePlugin, TransportState};
use crate::timeline::{
    timeline_rt_diagnostics_channel, AutomationTarget, AutomationWrite, ChainEntry, ClipPlacement,
    ClipPlayback, DeviceChain, DeviceParam, DeviceParamEvent, DeviceParamQueue, DeviceParamTarget,
    RetiredTimelineObject, RouteTarget, SendTap, TimelineBus, TimelineClip, TimelineGraph,
    TimelineRtDiagnosticsSnapshot, TimelineTrack, MAX_BUS_DEVICES, MAX_TIMELINE_BUSES,
    MAX_TIMELINE_TRACKS, MAX_TRACK_DEVICES,
};
use crate::transport_map::{LoopRegion, TransportMaps};
use daw_dsp::knead::engine::KneadEngine;
use rtrb::{Consumer, Producer, PushError};
use triple_buffer::{Input, Output};

/// The audio thread's progress echo, for the control-side queue ledger
/// (`GraphRegistry` in `sourdaw-native`): how far the engine has provably
/// consumed what control pushed.
///
/// The fields are written together at the end of one callback, after
/// `update_graph` and every `process_block` of that callback, so one snapshot
/// is coherent by construction and carries this happens-before guarantee:
/// **every write from a fenced batch numbered at or below `batches_applied`,
/// stamped strictly before `playhead_frame`, has left its fixed engine queue
/// by the time the snapshot is read.** An automation write leaves
/// `RampedParam`'s pending queue when the block walk reaches its start frame
/// (`RampedParam::value_at`), and a device-parameter write leaves
/// `DeviceParamQueue` when `apply_due_device_params` reaches its stamp — both
/// strictly before the published playhead, whether or not the transport is
/// rolling, because parameters advance on every rendered block. The echo may
/// lag (it is read between callbacks), so a consumer may under-release —
/// never over-release.
///
/// A loop region breaks the playhead's monotonicity, and with it that
/// guarantee's reach: the playhead is pinned below the region's end forever, so
/// a stamp the engine consumed on every pass would never be provably consumed
/// once. [`Self::loop_wraps`] and [`Self::last_wrap_frame`] carry the seam the
/// playhead alone cannot state, and they are on *this* snapshot rather than
/// read from the cursor's channel because the ledger's proof compares them
/// against `batches_applied`: two channels read at two moments would be two
/// engines as far as the proof is concerned.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct GraphProgressSnapshot {
    /// Fenced batches ([`GraphCommand::BeginBatch`]) applied whole, in order.
    /// Loose commands do not count: only a fence marks a control-side unit
    /// the ledger numbers.
    pub batches_applied: u64,
    /// The absolute frame the last rendered block ended on while playing, or
    /// stood on while stopped.
    pub playhead_frame: u64,
    /// Loop seams closed since the engine started, monotonic — the same count
    /// [`TransportPositionSnapshot::loop_wraps`] reports, echoed here beside
    /// the batch horizon it has to be compared against.
    pub loop_wraps: u64,
    /// The frame the block walk had reached when the seam numbered
    /// `loop_wraps` closed, so **every queued write stamped strictly below it
    /// was consumed by the pass that seam ended** — the wrap's mirror of
    /// `playhead_frame`. Zero until the first seam.
    pub last_wrap_frame: u64,
}

pub struct GraphProgressReader {
    output: Output<GraphProgressSnapshot>,
}

impl GraphProgressReader {
    pub fn snapshot(&mut self) -> GraphProgressSnapshot {
        *self.output.read()
    }
}

pub(crate) fn graph_progress_channel() -> (Input<GraphProgressSnapshot>, GraphProgressReader) {
    let (input, output) = triple_buffer::triple_buffer(&GraphProgressSnapshot::default());
    (input, GraphProgressReader { output })
}

/// Where the engine's transport stands, for the UI that draws a playhead.
///
/// Deliberately not [`GraphProgressSnapshot`]. That snapshot is the queue
/// ledger's release evidence and its `playhead_frame` carries a
/// happens-before guarantee the ledger reasons about; a second consumer
/// reading it for a different question would tie the ledger's contract to the
/// cursor's. This channel answers only "where is the transport", and it is
/// free to say so in whatever terms the cursor needs.
///
/// `loop_wraps` counts the seams the engine closed itself, so a cursor can tell
/// a position that went backwards on purpose from one that jumped: a wrap and
/// an ordinary locate look identical in the frame number alone. The ledger asks
/// the same question of its own snapshot ([`GraphProgressSnapshot::loop_wraps`])
/// rather than of this one, for the reason stated there.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TransportPositionSnapshot {
    pub playing: bool,
    /// The absolute frame the last rendered span ended on, after any loop
    /// wrap that span closed.
    pub playhead_frame: u64,
    /// Loop seams closed since the engine started, monotonic.
    pub loop_wraps: u64,
    /// Fenced batches applied whole, in order — the same count
    /// [`GraphProgressSnapshot::batches_applied`] reports, carried here so a
    /// reader can date **this** position against a command it sent.
    ///
    /// It rides on this channel rather than being read beside it because the
    /// two channels are published one after the other, at the end of every
    /// callback: a reader whose two reads straddle those writes pairs one
    /// callback's count with the previous callback's playhead, and a count that
    /// leads its position asserts a happens-before that has not happened. One
    /// publish is the only thing that makes the pairing true, whatever order a
    /// reader takes its reads in.
    pub batches_applied: u64,
    /// The tempo in force at the playhead — the tempo map's answer while a map
    /// is installed, the flat scalar otherwise.
    pub tempo: f64,
    pub time_sig_num: u16,
    pub time_sig_denom: u16,
}

pub struct TransportPositionReader {
    output: Output<TransportPositionSnapshot>,
}

impl TransportPositionReader {
    pub fn snapshot(&mut self) -> TransportPositionSnapshot {
        *self.output.read()
    }
}

pub(crate) fn transport_position_channel(
) -> (Input<TransportPositionSnapshot>, TransportPositionReader) {
    let (input, output) = triple_buffer::triple_buffer(&TransportPositionSnapshot::default());
    (input, TransportPositionReader { output })
}

/// What the engine's master output measured, for a meter drawn from it.
///
/// Its own channel rather than a field on [`TransportPositionSnapshot`]: that
/// one answers "where is the transport", and the batch count riding on it is
/// paired with the playhead beside it on purpose. A level is not part of that
/// pairing — nothing dates a meter reading against a command — so carrying it
/// there would widen a contract to hold a number that makes no claim under it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MasterMeterSnapshot {
    /// The loudest sample the device was handed, linear and non-negative,
    /// held for [`AudioScheduler::publish_master_meter`]'s hold window so a
    /// UI-rate poll landing between callbacks cannot under-read a transient.
    ///
    /// It measures what reached the device, not what the graph rendered: a
    /// shadowed monitor writes zeros, and a meter that reported the silenced
    /// render would show a level nobody can hear.
    pub peak: f32,
}

pub struct MasterMeterReader {
    output: Output<MasterMeterSnapshot>,
}

impl MasterMeterReader {
    pub fn snapshot(&mut self) -> MasterMeterSnapshot {
        *self.output.read()
    }
}

pub(crate) fn master_meter_channel() -> (Input<MasterMeterSnapshot>, MasterMeterReader) {
    let (input, output) = triple_buffer::triple_buffer(&MasterMeterSnapshot::default());
    (input, MasterMeterReader { output })
}

/// How many times a second the held peak may fall on its own — 50, so a
/// transient stands for ~20 ms. Fast enough that a meter still reads as a
/// meter, slow enough that a 60 Hz poll landing between callbacks sees the
/// peak that happened rather than the block that followed it.
pub(crate) const PEAK_HOLD_RELEASES_PER_SECOND: f32 = 50.0;

/// Timeline spans one callback can be split into.
///
/// A callback renders at most [`MAX_CALLBACK_FRAMES`] frames and the engine
/// honours no loop region shorter than
/// [`crate::transport_map::MIN_LOOP_FRAMES`], so a callback holds at most
/// `MAX_CALLBACK_FRAMES / MIN_LOOP_FRAMES` seams and one more span than that.
/// Deriving the bound rather than writing a number keeps it true when either
/// constant moves.
const MAX_TIMELINE_SPANS_PER_BLOCK: usize =
    1 + MAX_CALLBACK_FRAMES.div_ceil(crate::transport_map::MIN_LOOP_FRAMES as usize);

/// One contiguous stretch of a callback that occupies one stretch of the
/// timeline. Two of them differ when a loop seam falls inside the callback.
#[derive(Clone, Copy, Debug, Default)]
struct TimelineSpan {
    /// Absolute timeline frame this span's first sample sits on.
    block_start: u64,
    /// Where the span starts inside the callback's buffers.
    offset: usize,
    frames: usize,
}

pub enum MidiFxKind {
    Arpeggiator,
    VelocityScaler,
}

impl MidiFxKind {
    /// Build the MIDI FX instance this kind names, on the control thread —
    /// the constructor side of the [`GraphCommand::AddMidiFx`] contract: the
    /// audio thread installs the carried instance into a reserved slot or
    /// retires it, and never constructs or frees one (ADR 0020).
    pub fn build(self) -> Box<dyn MidiFx> {
        match self {
            Self::Arpeggiator => Box::new(Arpeggiator::default()),
            Self::VelocityScaler => Box::new(VelocityScaler::default()),
        }
    }
}

/// The pre-built built-in instance an `AddEffect`/`AddDetachedEffect` test
/// sender pushes: built on the test (control) side, as the real senders build
/// theirs, never by the drain that applies the command.
#[cfg(test)]
fn knead_instance() -> PluginCore {
    PluginCore::builtin(BuiltinEffectType::Knead, 48_000.0)
}

/// A built-in effect the graph can register, addressed without a name for the
/// reason given on [`crate::timeline::AutomationTarget`]: a command carrying a
/// `String` type name would have its allocation freed on the audio thread when
/// the command is consumed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BuiltinEffectType {
    Knead,
}

impl BuiltinEffectType {
    /// The wire name this type is addressed by. Its inverse is
    /// [`Self::from_name`], so the named and the addressed paths cannot drift
    /// into meaning different things.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Knead => "knead",
        }
    }

    /// Resolve a wire name onto its address. `None` refuses the name
    /// control-side: the scheduler has no built-in under that name, and an
    /// unknown name cannot cross the ring as a fixed-size address.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "knead" => Some(Self::Knead),
            _ => None,
        }
    }
}

/// Commands sent from the UI/main thread to the audio thread (lock-free via rtrb).
pub enum GraphCommand {
    // Built-in effects
    /// Register a built-in effect, already built control-side
    /// ([`PluginCore::builtin`]), on the master insert chain — the crate's
    /// original chain, and where the plugin-bridge path still runs a built-in
    /// it registers standalone.
    ///
    /// The command owns the instance from the push to the apply, on the same
    /// contract as [`GraphCommand::AddPlugin`]: the audio thread installs it
    /// or retires it, and never constructs or frees one (ADR 0020).
    AddEffect(usize, PluginCore),
    /// Register a built-in effect, already built control-side, detached from
    /// every chain.
    ///
    /// The graph transport's form: its effect exists only once the
    /// `InsertTrackDevice`/`InsertBusDevice` that follows it lands, and the
    /// commands cross the ring one at a time, so a callback can drain between
    /// the two. An effect registered onto the master chain in that window
    /// would render one block of the *entire mix* through a device the user
    /// put on one strip; a detached one renders nowhere until it is placed.
    AddDetachedEffect(usize, PluginCore),
    SetParam(usize, DeviceParam, f32),
    SetBypass(usize, bool),

    // External plugins (CLAP/VST3/AU)
    AddPlugin(usize, Box<dyn NativePlugin>),
    AddPluginWithBridge(usize, Box<dyn NativePlugin>, PluginAudioBridge),
    /// Remove a plugin without retiring its audio bridge.
    ///
    /// Production removes a plugin only through `RemovePluginWithBridge`, so
    /// this variant would strand the bridge if anything reached for it. The
    /// saturation test still needs the shape: it fills the command queue with
    /// removals to prove that every retirement, live or at shutdown, is handed
    /// off the callback thread rather than dropped on it.
    #[cfg(test)]
    RemovePlugin(usize),
    RemovePluginWithBridge(usize),

    // MIDI events (routed to a specific plugin by ID)
    SendMidiNote(usize, MidiNoteEvent),

    // MIDI FX
    /// Add a user MIDI FX, already built control-side
    /// ([`MidiFxKind::build`]), to an effect's fixed-capacity chain.
    ///
    /// The command owns the instance from the push to the apply, on the same
    /// contract as [`GraphCommand::AddPlugin`]: the audio thread installs it
    /// into a reserved slot or retires it — an unknown effect id and a full
    /// chain ([`crate::midi_fx::MIDI_FX_CHAIN_CAPACITY`]) both refuse the
    /// whole command — and never constructs or frees one (ADR 0020).
    AddMidiFx(usize, Box<dyn MidiFx>),
    /// Take the instance at one chain slot out of its effect, handing it to
    /// the retirement channel; the slot, not a chain position, is the address
    /// `SetMidiFxParam` and this command share.
    RemoveMidiFx(usize, usize), // effect_id, fx slot
    /// Set one parameter of one chained MIDI FX, addressed without a name:
    /// the name-to-address resolution happened control-side
    /// ([`MidiFxParam::from_name`]), where an unmapped name is refused rather
    /// than ignored on the audio thread after the fact.
    SetMidiFxParam(usize, usize, MidiFxParam, f32),

    // Transport state (global, affects all plugins)
    //
    /// The plugin-transport path's write, and the **owner of tempo and time
    /// signature**: it assigns the whole state, so it is the only command that
    /// may carry them. The graph transport writes playback state through
    /// [`GraphCommand::SetTransportPlayback`] instead, which leaves tempo and
    /// time signature untouched — the two paths drive one live engine and must
    /// not fight over fields only one of them knows.
    SetTransport(TransportState),
    /// The graph transport's write: playback state and song position only.
    ///
    /// Tempo, time signature and their derived beat position belong to the
    /// plugin-transport path ([`GraphCommand::SetTransport`]); this command
    /// merges into the live transport rather than assigning it, so a graph
    /// batch that starts playback can never reset a 174 BPM session to the
    /// 120 BPM engine default. The beat position is re-derived from the
    /// retained tempo so plugins keep a consistent (seconds, beats) pair.
    SetTransportPlayback {
        is_playing: bool,
        song_pos_seconds: f64,
    },
    /// Install the arrangement's tempo and time-signature maps — the third
    /// owner in the transport ownership law, and the authority for tempo,
    /// meter and beat position at the playhead while it is installed.
    ///
    /// The maps arrive as one already-built box on the same contract as
    /// [`GraphCommand::AddPlugin`]: the audio thread swaps the box in and
    /// hands the one it replaced to the retirement channel, and never builds
    /// or frees one (ADR 0020). Building them control-side is also what makes
    /// the per-block lookup a binary search rather than an integral — see
    /// [`crate::transport_map::TempoMap`].
    SetTransportMaps(Box<TransportMaps>),
    /// State the loop region and whether the transport honours it.
    ///
    /// Fixed-size and `Copy`, so it crosses the ring like any other scalar
    /// command. The engine closes the seam itself, inside the callback that
    /// reaches it, because only the thread that owns the playhead knows which
    /// frame the region ends on.
    SetLoopRegion(LoopRegion),

    /// Shadow the monitor: keep rendering, contribute nothing to the OS
    /// output.
    ///
    /// A *session mode*, deliberately not the master fader. `true` writes the
    /// device buffer as true zeros at the one place the engine's audio becomes
    /// the device's (`crate::audio_thread`); everything upstream is untouched,
    /// so the timeline still renders block-accurately, the playhead still
    /// advances, loop seams still close on their sample and the transport maps
    /// still govern. That is what lets a native session hold a live programme
    /// while another engine remains the path a musician hears.
    ///
    /// Two consequences of siting the gate at the device boundary, both
    /// intended. An offline render ([`crate::offline::OfflineRenderer`]) never
    /// sees it — a bounce is not a monitor, and a shadowed session must still
    /// export its mix. And lifting the gate steps rather than fades: the
    /// change lands at the block boundary that drains this command, so a
    /// cutover from a non-zero programme is a discontinuity. Ramping that edge
    /// belongs to the slice that makes the cutover a musician-facing gesture.
    SetMonitorShadow(bool),

    /// Fence announcing that the next `commands` elements on the ring are one
    /// atomically published batch.
    ///
    /// rtrb publishes per element, so without a fence a callback's drain can
    /// observe a prefix of a batch — one block rendering a new strip at its
    /// parameter defaults because its frame-0 state write had not crossed
    /// yet. The drain defers a fenced batch whole until every announced
    /// command is visible and the retirement ring can absorb the batch's
    /// worst case, then applies it between two rendered blocks
    /// ([`AudioScheduler::update_graph`]).
    BeginBatch {
        commands: usize,
    },
    /// Adopt a new command consumer and retirement producer — the engine side
    /// of a control-side ring reallocation ([`crate::EngineHandle`] provisions
    /// capacity from batch size, so ring capacity never bounds an admitted
    /// batch).
    ///
    /// This fence is by construction the last element the old ring ever
    /// carries, so popping it means the old ring is drained dry. The callback
    /// does pointer work only: both new ends were allocated control-side and
    /// cross the ring inside this element (rtrb's own release/acquire on the
    /// element is the happens-before), and the old consumer leaves over the
    /// retirement channel — dropping it here would free the old ring's heap
    /// on the audio thread.
    SwapCommandChannel {
        commands: Consumer<GraphCommand>,
        retired_tx: Producer<RetiredGraphObjects>,
    },

    // Timeline graph
    //
    // Every variant that brings heap memory into the graph carries it already
    // built (`Box<TimelineTrack>`, `Box<TimelineBus>`, `Box<TimelineClip>`),
    // because the audio thread applies these commands and may neither allocate
    // the buffers nor free them. Everything else is `Copy`, so consuming a
    // command never runs a destructor on the callback.
    /// Add a track built on the control thread. A colliding id or a full graph
    /// hands the track back to the retirement channel untouched.
    AddTrack(Box<TimelineTrack>),
    /// Remove a track and retire it with every clip it owns. Its device-chain
    /// effects survive as detached — they process nothing until they are
    /// placed again or removed, rather than falling back onto the master mix.
    RemoveTrack(usize),
    SetTrackOutput(usize, RouteTarget),
    /// Close or open the post-fader mute gate.
    SetTrackMute(usize, bool),
    /// Close or open the pre-fader solo gate — the gate that silences the
    /// tracks the engineer is *not* soloing. Separate from the mute because it
    /// acts at a different point of the strip and for a different reason; see
    /// [`crate::timeline::TimelineTrack`].
    SetTrackSoloGate(usize, bool),
    /// Splice an effect into a track's device chain at `index`, clamped to the
    /// chain's length. The effect itself is added by `AddEffect`/`AddPlugin`;
    /// this is the ordering and the splice point.
    InsertTrackDevice {
        track_id: usize,
        entry: ChainEntry,
        index: usize,
    },
    /// Take an effect out of a track's chain. The effect stays registered and
    /// returns to its home placement — the master insert chain for everything
    /// the engine owns end to end, and detached for a hosted plugin, whose
    /// lifetime belongs to the load that registered it and which must not land
    /// on the whole mix because the user took it off one track.
    RemoveTrackDevice {
        track_id: usize,
        effect_id: usize,
    },
    /// Take an effect out of a track's chain and retire it in the same drain
    /// step.
    ///
    /// The graph transport's remove: a `RemoveTrackDevice` followed by a
    /// separate retirement would return the effect to the master chain for
    /// any block a callback rendered between the two commands, running a
    /// deleted strip device over the whole mix. This variant removes and
    /// retires atomically, so a graph-owned effect is never observable on the
    /// master chain. The retirement crosses the retirement channel exactly as
    /// `RemovePluginWithBridge`'s does — the final drop stays off the
    /// callback thread.
    RemoveTrackDeviceRetired {
        track_id: usize,
        effect_id: usize,
    },
    /// Splice an effect into a *bus's* device chain, on the same contract as
    /// [`GraphCommand::InsertTrackDevice`]. A send bus that cannot host a
    /// reverb is not a send bus.
    InsertBusDevice {
        bus_id: usize,
        entry: ChainEntry,
        index: usize,
    },
    /// Take an effect out of a bus's chain, on the same contract as
    /// [`GraphCommand::RemoveTrackDevice`]: the effect stays registered and
    /// returns to its home placement.
    RemoveBusDevice {
        bus_id: usize,
        effect_id: usize,
    },
    /// Take an effect out of a bus's chain and retire it in the same drain
    /// step, on the same contract as
    /// [`GraphCommand::RemoveTrackDeviceRetired`].
    RemoveBusDeviceRetired {
        bus_id: usize,
        effect_id: usize,
    },
    /// Add a send from a track to a bus at the given tap. A pre-fader send
    /// taps ahead of the fader and the mute; a post-fader send taps after the
    /// panner.
    AddSend {
        track_id: usize,
        bus_id: usize,
        tap: SendTap,
        level: f32,
    },
    RemoveSend {
        track_id: usize,
        bus_id: usize,
    },
    AddBus(Box<TimelineBus>),
    RemoveBus(usize),
    SetBusOutput(usize, RouteTarget),
    /// Close or open the post-fader mute gate on a bus.
    SetBusMute(usize, bool),
    /// Close or open a bus's pre-fader solo gate — the same law as
    /// [`GraphCommand::SetTrackSoloGate`]. See
    /// [`crate::timeline::TimelineBus`].
    SetBusSoloGate(usize, bool),
    /// Add a clip, with its decoded material, to a track.
    AddClip(usize, Box<TimelineClip>),
    RemoveClip(usize, usize),
    /// Move or trim a clip. Non-destructive: only the window onto the source
    /// material moves, so restoring the placement restores the edit.
    SetClipPlacement(usize, usize, ClipPlacement),
    /// Re-state a clip's level, its fades and its rate. Non-destructive in the
    /// same way `SetClipPlacement` is.
    SetClipPlayback(usize, usize, ClipPlayback),

    // Timeline transport and automation
    /// Place the playhead at an absolute timeline frame. The playhead advances
    /// by the block size while the transport is playing and stands still while
    /// it is not, so clips and stamped parameter changes are addressed in
    /// frames rather than in callbacks.
    ///
    /// A locate also drops the automation the locate made stale; see
    /// [`crate::timeline::TimelineGraph::seek`] for what the control thread
    /// then owns.
    SeekFrames(u64),
    /// A change to a mixer parameter, and how it joins whatever that parameter
    /// already has queued. Every stamp is an absolute timeline frame, so a
    /// change lands on the frame it names whichever block carries the command.
    AutomateParam {
        target: AutomationTarget,
        write: AutomationWrite,
    },
    /// Aim the master fader at `value`, approaching it by `smoothing` of the
    /// distance left per sample.
    ///
    /// A fader gesture carries no timeline coordinate, which is why this is a
    /// command of its own rather than an [`GraphCommand::AutomateParam`] on
    /// [`AutomationTarget::MasterGain`]. That lane holds what the arrangement
    /// does to the master at a named frame, and every write in it answers to
    /// seek, hold and the loop wrap; the fader answers to none of them, because
    /// where the hand left it is true at every position. Sending it as a
    /// stamped ramp put it under those laws: a wrap re-renders frames below the
    /// ramp's start, and a ramp asked for a value there gives the level it
    /// started from, so the seam clicked and the next pass played at the
    /// pre-gesture level.
    ///
    /// A drag is a stream of these, and each one re-aims the same smoother from
    /// the level it has reached. Nothing queues, so no gesture rate can overrun
    /// the engine.
    SetMasterGain {
        value: f32,
        smoothing: f32,
    },
    /// A time-stamped change to a device parameter — a built-in's, addressed
    /// without a name, or a hosted plugin's, addressed by the plugin's own id
    /// ([`DeviceParamTarget`]) — so consuming the command frees nothing on the
    /// audio thread.
    ///
    /// Unlike [`GraphCommand::AutomateParam`] this applies at the block
    /// boundary rather than at a sample offset: a device owns its own
    /// parameter smoothing, and neither a built-in nor a hosted plugin's
    /// queue exposes a sample-addressed set.
    AutomateDeviceParam {
        effect_id: usize,
        param: DeviceParamTarget,
        value: f64,
        at_frame: u64,
    },

    /// Put a registered plugin on the engine's native input bus, so the
    /// render callback hands it every chunk the capture ring serves
    /// ([`AudioScheduler::deliver_capture`]).
    ///
    /// The id need not name a live effect yet: a batch may carry this and the
    /// registration that creates the plugin in either order, and delivery
    /// resolves the id every callback. A full bus or an id already on it is
    /// refused and counted, on the same last-line contract as every other
    /// callback-side capacity refusal.
    RegisterCaptureConsumer(usize),
    /// Take a plugin off the input bus. An id the bus does not hold is a
    /// no-op, so an unregister that races the plugin's own removal is not an
    /// error.
    UnregisterCaptureConsumer(usize),

    /// Register an audio bridge that no plugin answers for.
    ///
    /// Production registers and retires a bridge only alongside its plugin
    /// (`AddPluginWithBridge` / `RemovePluginWithBridge`), so this state is
    /// unreachable there. The real-time drain still has to survive it — a
    /// bridge nobody processes must return its blocks and keep its ring
    /// moving, or the app is left on permanent dry fallback — and this is how
    /// a test puts the scheduler in that state.
    #[cfg(test)]
    RegisterAudioBridge(PluginAudioBridge),
}

impl GraphCommand {
    /// How this command changes the population of the scheduler's one effect
    /// table, `AudioScheduler::effects`.
    ///
    /// That table is shared. Graph devices, engine-owned CLAP instances and
    /// the crumbs capture slot all take their slots from it — the id space is
    /// partitioned precisely because they do — so no single producer's own
    /// bookkeeping is a count of it, and a ceiling built on one of them bounds
    /// a strict subset of what the callback holds. This is the one
    /// classification the control side's ledger reads
    /// ([`crate::EngineHandle::registered_effect_count`]).
    ///
    /// The match carries no wildcard arm on purpose. A command that registers
    /// or retires an effect does not compile until its effect on the table is
    /// stated here, which is what keeps the ledger complete rather than a
    /// count of whichever producers someone remembered.
    ///
    /// Every retirement is classified `-1`, and every retirement is
    /// conditional on the callback finding its target:
    /// `RemovePluginWithBridge` frees nothing for an id the table does not
    /// hold, and the two `*Retired` variants free nothing when the strip they
    /// name does not hold the effect they name. The classification is exact
    /// under two control-side preconditions, one per direction of drift.
    ///
    /// A retirement is only ever sent for a target the sender has already
    /// resolved against the project it holds. A violated precondition drifts
    /// in the dangerous direction: the ledger drops to N-1 while the table
    /// stays at N, so it *grants* headroom that does not exist and the next
    /// registration is admitted control-side and then refused silently on the
    /// callback, which is the failure this ledger exists to remove.
    ///
    /// A registration, in the other direction, can be refused by the callback
    /// itself: an id colliding with a slot the table already holds never takes
    /// one, while the ledger counted it as it crossed the ring — N+1 against
    /// the table's N. That drift is the safe one, over-refusing rather than
    /// granting headroom, and practically unreachable while ids are allocated
    /// monotonically without reuse; it is also reconciled rather than
    /// permanent. [`crate::EngineHandle::midi_rt_diagnostics_snapshot`]
    /// returns the refused slots by diffing the callback's cumulative
    /// collision count, so the over-count exists only between the refusal and
    /// the next observation.
    ///
    /// Exhaustiveness forces an author to write an arm, not to write the right
    /// one, so it is not what keeps this classification honest. That is
    /// `crate::tests::the_ledger_matches_the_scheduler_effect_table_it_counts`,
    /// which drives a mixed stream through a real scheduler and asserts the
    /// table's length against the ledger.
    pub(crate) fn effect_table_delta(&self) -> isize {
        match self {
            Self::AddEffect(..)
            | Self::AddDetachedEffect(..)
            | Self::AddPlugin(..)
            | Self::AddPluginWithBridge(..) => 1,
            #[cfg(test)]
            Self::RemovePlugin(..) => -1,
            Self::RemovePluginWithBridge(..)
            | Self::RemoveTrackDeviceRetired { .. }
            | Self::RemoveBusDeviceRetired { .. } => -1,
            // `RemoveTrack`, `RemoveBus`, `RemoveTrackDevice` and
            // `RemoveBusDevice` leave the effect registered — detached, or
            // back on the master chain — so none of them frees a slot.
            Self::SetParam(..)
            | Self::SetBypass(..)
            | Self::SendMidiNote(..)
            | Self::AddMidiFx(..)
            | Self::RemoveMidiFx(..)
            | Self::SetMidiFxParam(..)
            | Self::SetTransport(..)
            | Self::SetTransportPlayback { .. }
            | Self::SetTransportMaps(..)
            | Self::SetLoopRegion(..)
            | Self::SetMonitorShadow(..)
            | Self::BeginBatch { .. }
            | Self::SwapCommandChannel { .. }
            | Self::AddTrack(..)
            | Self::RemoveTrack(..)
            | Self::SetTrackOutput(..)
            | Self::SetTrackMute(..)
            | Self::SetTrackSoloGate(..)
            | Self::InsertTrackDevice { .. }
            | Self::RemoveTrackDevice { .. }
            | Self::InsertBusDevice { .. }
            | Self::RemoveBusDevice { .. }
            | Self::AddSend { .. }
            | Self::RemoveSend { .. }
            | Self::AddBus(..)
            | Self::RemoveBus(..)
            | Self::SetBusOutput(..)
            | Self::SetBusMute(..)
            | Self::SetBusSoloGate(..)
            | Self::AddClip(..)
            | Self::RemoveClip(..)
            | Self::SetClipPlacement(..)
            | Self::SetClipPlayback(..)
            | Self::SeekFrames(..)
            | Self::AutomateParam { .. }
            | Self::SetMasterGain { .. }
            | Self::AutomateDeviceParam { .. }
            // The input bus addresses effects the table already holds; it
            // takes no slot of its own.
            | Self::RegisterCaptureConsumer(..)
            | Self::UnregisterCaptureConsumer(..) => 0,
            #[cfg(test)]
            Self::RegisterAudioBridge(..) => 0,
        }
    }
}

/// A processing instance the graph can run: a built-in engine or a hosted
/// native plugin.
///
/// Public only because [`GraphCommand::AddEffect`] and
/// [`GraphCommand::AddDetachedEffect`] carry it across the command ring, so
/// a control-side caller builds one before pushing. The instance is
/// constructed on the control thread against the stream's negotiated sample
/// rate — `KneadEngine::new` alone performs some twenty zero-filled heap
/// allocations — and the audio thread that receives it may neither construct
/// one nor free it (ADR 0020): it installs the instance into the effect
/// table, or hands it back over the retirement channel, and nothing else.
pub enum PluginCore {
    Knead(KneadEngine),
    Native(Box<dyn NativePlugin>),
}

impl PluginCore {
    /// Build the built-in instance `plugin_type` names, on the control
    /// thread. This is the constructor side of the
    /// [`BuiltinEffectType`] name mapping: every sender that resolves a wire
    /// name builds its instance here, against the sample rate the stream
    /// actually opened at, so no two producers can construct the same
    /// built-in against different clocks.
    pub fn builtin(plugin_type: BuiltinEffectType, sample_rate: f32) -> Self {
        match plugin_type {
            BuiltinEffectType::Knead => Self::Knead(KneadEngine::new(sample_rate)),
        }
    }
}

/// Map an addressed device parameter onto the matching `KneadEngine` setter.
///
/// The mapping is total: the parameter arrives as a [`DeviceParam`] address,
/// and the name-to-address resolution happened control-side
/// ([`DeviceParam::from_name`]), where an unmapped name is refused rather
/// than counted on the audio thread after the fact.
fn apply_knead_param(engine: &mut KneadEngine, param: DeviceParam, value: f32) {
    match param {
        DeviceParam::ShiftSemitones => engine.set_shift_semitones(value),
        DeviceParam::RetuneSpeedMs => engine.set_retune_speed_ms(value),
        DeviceParam::FormantPreserve => engine.set_formant_preserve(value != 0.0),
    }
}

/// Where in the graph an effect is processed.
///
/// An effect is registered by id and placed separately, so the two lifetimes
/// stay independent: a track can be torn down without unloading the plugins
/// that were on it, and a plugin can be moved between chains without being
/// reloaded.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EffectPlacement {
    /// No track claims it, so it runs on the master insert chain over the
    /// engine's stereo pair — the crate's behaviour before the timeline
    /// existed, and where an engine-owned effect returns when it leaves a
    /// strip. It is not where *every* effect returns: an effect returns to its
    /// own home, and a hosted plugin's home is `Detached`.
    MasterChain,
    /// A member of the named track's device chain, processed with that track's
    /// signal instead.
    Track(usize),
    /// A member of the named bus's device chain, processed with the bus's
    /// summed signal. A bus insert is placed exactly like a track insert: the
    /// two differ only in which strip's signal reaches it.
    Bus(usize),
    /// A member of a track or bus that has been removed. It processes nothing
    /// until it is placed again or removed: silently falling back onto the
    /// master chain would put a deleted strip's device on the whole mix.
    Detached,
}

struct ActiveEffect {
    id: usize,
    instance: PluginCore,
    bypassed: bool,
    /// Fixed pre-FX gate. Inline ownership avoids callback-time registration/allocation.
    probability_evaluator: ProbabilityEvaluator,
    /// The user's MIDI FX chain. An inline fixed-capacity slot table, so
    /// installing or taking an instance neither allocates nor frees on the
    /// audio thread; the instances themselves are built on the control thread
    /// and cross the ring already boxed (ADR 0020). See
    /// [`crate::midi_fx::MIDI_FX_CHAIN_CAPACITY`] for the capacity contract.
    midi_fx: MidiFxChain,
    /// Pending MIDI events for this block (drained each process_block call).
    pending_midi: MidiEventBuffer,
    placement: EffectPlacement,
    /// Where a strip returns this effect when it releases it.
    ///
    /// The master chain is home for everything the engine itself owns end to
    /// end, which is the crate's behaviour before the timeline existed. An
    /// engine-owned hosted plugin is not one of those: its lifetime belongs to
    /// the load that registered it, and the strip that borrowed it must be able
    /// to give it back without putting a plugin the user took off one track
    /// onto the whole mix.
    home: EffectPlacement,
    /// Time-stamped parameter changes waiting for the playhead. Fixed
    /// capacity and held inline, so queuing one neither allocates nor is
    /// freed on the audio thread.
    pending_params: DeviceParamQueue,
}

pub(crate) const RETIREMENT_QUEUE_CAPACITY: usize = 257;

/// The chain slots the timeline itself admits: every track's device chain
/// plus every bus's. The strip admission rules enforce this product-wide —
/// tracks and buses are counted, and each chain is capped at
/// [`MAX_TRACK_DEVICES`]/[`MAX_BUS_DEVICES`] — so this is the ceiling on the
/// table's timeline population, derived rather than chosen.
pub const TIMELINE_CHAIN_SLOT_BUDGET: usize =
    MAX_TIMELINE_TRACKS * MAX_TRACK_DEVICES + MAX_TIMELINE_BUSES * MAX_BUS_DEVICES;

/// The session's reserve for engine-owned hosted plugin instances: the
/// `AddPlugin`/`AddPluginWithBridge` registrations `load_plugin` makes, one
/// per external-plugin device in the project.
///
/// No ceiling on them is enumerable from this crate: the host holds them in an
/// unbounded map keyed by instance id, and an external-plugin device list has
/// no per-strip cap of its own. So the engine states the limit itself: 128
/// instances at once, the number the bridge table has enforced since bridges
/// existed, now named here and checked control-side by `load_plugin`
/// (`sourdaw-native`) where the refusal reaches the user instead of dying as
/// a counter on the callback. A session past 128 hosted plugins is past any
/// professional session's scale — each instance is a native plugin library
/// plus roughly 288 KiB of bridge rings — and the refusal names the limit.
pub const HOSTED_PLUGIN_RESERVE: usize = 128;

/// The session's reserve for Crumbs input-capture slots: the
/// `AddPluginWithBridge` registration `create_crumbs` makes for the panel's
/// record feed, one per live instance.
///
/// The app renders exactly one Crumbs panel, and re-pointing it at another
/// device tears the old instance down asynchronously while the new one is
/// already being created, so two slots can be live at once. The gate the
/// reserve enforces is the host's instance map: `create_crumbs`
/// (`sourdaw-native`) refuses while the map holds the reserve's count.
/// Because a destroy removes its map entry before the engine slot's
/// retirement has drained, re-points inside that teardown window can admit a
/// third engine slot past the gate — at that extreme the engine's own
/// callback-time capacity check is the last line, as it is for every
/// population.
pub const CRUMBS_CAPTURE_RESERVE: usize = 2;

/// The fixed capacity of the scheduler's effect table. Every registration the
/// product can hold at once shares this one table, and the capacity is the
/// sum of its three populations, each bounded by a named term:
///
/// - the timeline's chain devices, at [`TIMELINE_CHAIN_SLOT_BUDGET`] — the
///   product's own strip admission rules;
/// - engine-owned hosted plugin instances, at [`HOSTED_PLUGIN_RESERVE`];
/// - Crumbs input-capture slots, at [`CRUMBS_CAPTURE_RESERVE`].
///
/// Sizing against what the product permits is the contract: the table once
/// held a flat 128 while the timeline admitted 6144 chain slots, so a project
/// four-devices-deep on 32 tracks exhausted it, and with it full the Crumbs
/// panel could not even open. The reserve terms state their own bounds where
/// no code enumerates them, so the ceiling is discoverable before it is hit.
///
/// The table is built once with this capacity and never grown: a push past it
/// is refused and counted — growing the vector inside the audio deadline is
/// the allocation ADR 0020 forbids — and `ActiveEffect` is large enough (its
/// plugin core, MIDI buffer, and parameter queue all live inline) that the
/// reservation itself scales with the ceiling, which is why the ceiling stops
/// at what the product permits rather than somewhere beyond it. Every
/// per-id operation over a table this size is O(1) by construction: the
/// [`IdSlotIndex`] resolves ids to slots, and `remove_effect` swaps the
/// table's tail into the vacated slot instead of moving the inline entries
/// behind it, so no memmove of `ActiveEffect`s ever runs on the callback at
/// any population this ceiling admits.
///
/// The audio thread's refusal is the last line, not the reported one: it is a
/// counter, and a device refused there is a device the user never sees in the
/// chain. Control-side callers must hold the session below this ceiling
/// themselves, where a refusal can be returned — which is why the constant is
/// public.
pub const EFFECT_TABLE_CAPACITY: usize =
    TIMELINE_CHAIN_SLOT_BUDGET + HOSTED_PLUGIN_RESERVE + CRUMBS_CAPTURE_RESERVE;

/// The fixed capacity of the bridge table. Bridges exist only for the two
/// registrations that carry one — hosted plugin instances and Crumbs capture
/// slots — so the table is sized to exactly their reserves; timeline chain
/// devices never take a bridge.
///
/// The reserves are enforced by map-gated control-side checks, and the maps
/// count entries, not live bridges. Bridges sit outside those gates in the
/// teardown conditions the reserve docs disclose: a destroy removes its map
/// entry before the removal is pushed, and between that push and its
/// application on the callback the bridge is draining but uncounted — a
/// gate-admitted create's registration can already be in the ring beside its
/// removal; and a removal whose push failed leaks the engine slot and its
/// bridge-table entry past the gate permanently. In those states the table
/// holds checks-admitted bridges plus ones the gates can no longer see, and a
/// registration both gates admitted can still reach this capacity arm on the
/// callback, where its refusal is a counter nothing hands back — the exact
/// failure the effect-table ledger exists to remove, binding here at the
/// reserves' sum, 6144 slots sooner than the effect table's own last line.
/// That callback-time bridge-table refusal is the last line for this table,
/// named as such, exactly as the effect table's docs name theirs; the gates
/// above are what keep it out of ordinary sessions.
pub(crate) const AUDIO_BRIDGE_TABLE_CAPACITY: usize =
    HOSTED_PLUGIN_RESERVE + CRUMBS_CAPTURE_RESERVE;

/// One node of [`IdSlotIndex`]'s fixed-depth binary radix trie. Child and slot
/// handles are one-based, keeping zero available as the empty sentinel.
#[derive(Clone, Copy, Default)]
struct RadixNode {
    children: [u32; 2],
    slot_plus_one: u32,
    next_free: u32,
}

/// A fixed-preallocated id-to-slot trie for callback lookup and mutation.
///
/// Every operation follows at most `usize::BITS` id bits. Nodes are allocated
/// only from storage reserved before the callback starts; deletion prunes dead
/// suffixes into a free list, so churn reuses nodes rather than consuming the
/// reservation. This makes lookup, insert, and set-slot bounded by one radix
/// walk and delete by a lookup plus a reverse pruning walk.
struct IdSlotIndex {
    nodes: Vec<RadixNode>,
    free_head: u32,
    #[cfg(test)]
    last_delete_steps: usize,
}

impl IdSlotIndex {
    fn reserved(population: usize) -> Self {
        let node_capacity = 1 + population * usize::BITS as usize;
        let mut nodes = Vec::with_capacity(node_capacity);
        nodes.push(RadixNode::default());
        Self {
            nodes,
            free_head: 0,
            #[cfg(test)]
            last_delete_steps: 0,
        }
    }

    #[inline]
    fn bit_at(id: usize, depth: u32) -> usize {
        ((id >> (usize::BITS - 1 - depth)) & 1) as usize
    }

    #[inline]
    fn child_index(node: &RadixNode, bit: usize) -> Option<usize> {
        let child = node.children[bit];
        if child == 0 {
            None
        } else {
            Some(child as usize - 1)
        }
    }

    #[inline]
    fn lookup(&self, id: usize) -> Option<usize> {
        let mut node_index = 0;
        for depth in 0..usize::BITS {
            let bit = Self::bit_at(id, depth);
            node_index = Self::child_index(&self.nodes[node_index], bit)?;
        }
        let slot_plus_one = self.nodes[node_index].slot_plus_one;
        if slot_plus_one == 0 {
            None
        } else {
            Some(slot_plus_one as usize - 1)
        }
    }

    fn insert(&mut self, id: usize, slot: usize) -> bool {
        let mut node_index = 0;
        for depth in 0..usize::BITS {
            let bit = Self::bit_at(id, depth);
            let child = self.nodes[node_index].children[bit];
            node_index = if child == 0 {
                let child_index = self.take_node();
                self.nodes[node_index].children[bit] = child_index as u32 + 1;
                child_index
            } else {
                child as usize - 1
            };
        }
        let node = &mut self.nodes[node_index];
        if node.slot_plus_one != 0 {
            return false;
        }
        node.slot_plus_one = slot as u32 + 1;
        true
    }

    fn set_slot(&mut self, id: usize, slot: usize) {
        let mut node_index = 0;
        for depth in 0..usize::BITS {
            let bit = Self::bit_at(id, depth);
            let Some(child) = Self::child_index(&self.nodes[node_index], bit) else {
                debug_assert!(false, "repointing an id the index does not hold");
                return;
            };
            node_index = child;
        }
        let node = &mut self.nodes[node_index];
        debug_assert!(
            node.slot_plus_one != 0,
            "repointing an id the index does not hold"
        );
        if node.slot_plus_one != 0 {
            node.slot_plus_one = slot as u32 + 1;
        }
    }

    fn delete(&mut self, id: usize) -> Option<usize> {
        let mut path = [0usize; usize::BITS as usize];
        let mut node_index = 0;
        for depth in 0..usize::BITS {
            path[depth as usize] = node_index;
            let bit = Self::bit_at(id, depth);
            node_index = Self::child_index(&self.nodes[node_index], bit)?;
        }
        let slot_plus_one = self.nodes[node_index].slot_plus_one;
        if slot_plus_one == 0 {
            return None;
        }
        self.nodes[node_index].slot_plus_one = 0;

        let mut steps = usize::BITS as usize;
        for depth in (0..usize::BITS).rev() {
            let child = node_index;
            if self.nodes[child].slot_plus_one != 0 || self.nodes[child].children != [0, 0] {
                break;
            }
            let parent = path[depth as usize];
            let bit = Self::bit_at(id, depth);
            self.nodes[parent].children[bit] = 0;
            self.release_node(child);
            node_index = parent;
            steps += 1;
        }
        #[cfg(test)]
        {
            self.last_delete_steps = steps;
        }
        Some(slot_plus_one as usize - 1)
    }

    fn take_node(&mut self) -> usize {
        if self.free_head != 0 {
            let node_index = self.free_head as usize - 1;
            self.free_head = self.nodes[node_index].next_free;
            self.nodes[node_index] = RadixNode::default();
            return node_index;
        }
        debug_assert!(
            self.nodes.len() < self.nodes.capacity(),
            "radix reservation exhausted"
        );
        let node_index = self.nodes.len();
        self.nodes.push(RadixNode::default());
        node_index
    }

    fn release_node(&mut self, node_index: usize) {
        self.nodes[node_index] = RadixNode {
            next_free: self.free_head,
            ..RadixNode::default()
        };
        self.free_head = node_index as u32 + 1;
    }
}

/// A fixed-capacity unordered slot set with O(1) insertion, removal, and
/// swap-remove relocation. It is used only for work whose ordering is not
/// observable: parameter queues and pending-MIDI cleanup.
struct SlotWorkSet {
    slots: Vec<usize>,
    positions: Vec<u32>,
}

impl SlotWorkSet {
    fn reserved(capacity: usize) -> Self {
        Self {
            slots: Vec::with_capacity(capacity),
            positions: vec![0; capacity],
        }
    }

    fn insert(&mut self, slot: usize) {
        if self.positions[slot] != 0 {
            return;
        }
        debug_assert!(
            self.slots.len() < self.slots.capacity(),
            "work set exhausted"
        );
        self.slots.push(slot);
        self.positions[slot] = self.slots.len() as u32;
    }

    fn remove(&mut self, slot: usize) {
        let position = self.positions[slot];
        if position == 0 {
            return;
        }
        let index = position as usize - 1;
        let moved = self.slots.pop().expect("work-set position names a slot");
        if index < self.slots.len() {
            self.slots[index] = moved;
            self.positions[moved] = index as u32 + 1;
        }
        self.positions[slot] = 0;
    }

    fn move_slot(&mut self, from: usize, to: usize) {
        if from == to || self.positions[from] == 0 {
            return;
        }
        let position = self.positions[from];
        self.slots[position as usize - 1] = to;
        self.positions[to] = position;
        self.positions[from] = 0;
    }
}

#[derive(Clone, Copy, Default)]
struct MasterLink {
    previous: u32,
    next: u32,
    member: bool,
}

/// An intrusive, slot-addressed master insert chain. Its links live beside the
/// table rather than in effects, so an effect swap only repairs constant-size
/// link endpoints and never changes audible insertion order.
struct MasterWorkList {
    links: Vec<MasterLink>,
    head: u32,
    tail: u32,
}

impl MasterWorkList {
    fn reserved(capacity: usize) -> Self {
        Self {
            links: vec![MasterLink::default(); capacity],
            head: 0,
            tail: 0,
        }
    }

    fn append(&mut self, slot: usize) {
        if self.links[slot].member {
            return;
        }
        let handle = slot as u32 + 1;
        self.links[slot] = MasterLink {
            previous: self.tail,
            next: 0,
            member: true,
        };
        if self.tail == 0 {
            self.head = handle;
        } else {
            self.links[self.tail as usize - 1].next = handle;
        }
        self.tail = handle;
    }

    fn remove(&mut self, slot: usize) {
        let link = self.links[slot];
        if !link.member {
            return;
        }
        if link.previous == 0 {
            self.head = link.next;
        } else {
            self.links[link.previous as usize - 1].next = link.next;
        }
        if link.next == 0 {
            self.tail = link.previous;
        } else {
            self.links[link.next as usize - 1].previous = link.previous;
        }
        self.links[slot] = MasterLink::default();
    }

    fn move_slot(&mut self, from: usize, to: usize) {
        if from == to {
            return;
        }
        let link = self.links[from];
        self.links[from] = MasterLink::default();
        if !link.member {
            return;
        }
        let handle = to as u32 + 1;
        self.links[to] = link;
        if link.previous == 0 {
            self.head = handle;
        } else {
            self.links[link.previous as usize - 1].next = handle;
        }
        if link.next == 0 {
            self.tail = handle;
        } else {
            self.links[link.next as usize - 1].previous = handle;
        }
    }
}

/// Everything the audio thread gives up for reclamation off the callback.
///
/// Public only because [`GraphCommand::SwapCommandChannel`] carries a
/// `Producer` of these across the public command vocabulary; the fields and
/// constructors stay crate-private.
pub struct RetiredGraphObjects {
    effect: Option<ActiveEffect>,
    audio_bridge: Option<PluginAudioBridge>,
    midi_fx: Option<Box<dyn MidiFx>>,
    /// A track, bus, or clip the graph gave up. Each owns sample buffers, so
    /// dropping one on the callback is exactly the free ADR 0020 forbids.
    timeline_object: Option<RetiredTimelineObject>,
    /// The tempo and meter maps a newer pair replaced. They own segment
    /// vectors, so they leave on the same contract as everything else here.
    transport_maps: Option<Box<TransportMaps>>,
    remaining_effects: Vec<ActiveEffect>,
    remaining_audio_bridges: Vec<PluginAudioBridge>,
    remaining_timeline: Option<TimelineGraph>,
    queued_commands: Vec<GraphCommand>,
    command_rx: Option<Consumer<GraphCommand>>,
}

impl RetiredGraphObjects {
    fn removed(
        effect: Option<ActiveEffect>,
        audio_bridge: Option<PluginAudioBridge>,
        midi_fx: Option<Box<dyn MidiFx>>,
    ) -> Self {
        Self {
            effect,
            audio_bridge,
            midi_fx,
            timeline_object: None,
            transport_maps: None,
            remaining_effects: Vec::new(),
            remaining_audio_bridges: Vec::new(),
            remaining_timeline: None,
            queued_commands: Vec::new(),
            command_rx: None,
        }
    }

    fn timeline(object: RetiredTimelineObject) -> Self {
        let mut retired = Self::removed(None, None, None);
        retired.timeline_object = Some(object);
        retired
    }

    fn effect(effect: ActiveEffect) -> Self {
        Self::removed(Some(effect), None, None)
    }

    fn effect_with_bridge(
        effect: Option<ActiveEffect>,
        audio_bridge: Option<PluginAudioBridge>,
    ) -> Option<Self> {
        if effect.is_none() && audio_bridge.is_none() {
            return None;
        }

        Some(Self::removed(effect, audio_bridge, None))
    }

    fn midi_fx(midi_fx: Box<dyn MidiFx>) -> Self {
        Self::removed(None, None, Some(midi_fx))
    }

    fn transport_maps(maps: Box<TransportMaps>) -> Self {
        let mut retired = Self::removed(None, None, None);
        retired.transport_maps = Some(maps);
        retired
    }

    /// The old command consumer a channel swap replaced. Its producer was
    /// dropped control-side when the swap was published, so the reclaimer's
    /// drain-until-abandoned loop terminates promptly.
    fn swapped_consumer(command_rx: Consumer<GraphCommand>) -> Self {
        let mut retired = Self::removed(None, None, None);
        retired.command_rx = Some(command_rx);
        retired
    }

    fn shutdown(
        pending: Option<Self>,
        remaining_effects: Vec<ActiveEffect>,
        remaining_audio_bridges: Vec<PluginAudioBridge>,
        remaining_timeline: TimelineGraph,
        queued_commands: Vec<GraphCommand>,
        command_rx: Option<Consumer<GraphCommand>>,
    ) -> Self {
        let mut pending = pending.unwrap_or_else(|| Self::removed(None, None, None));

        Self {
            effect: pending.effect.take(),
            audio_bridge: pending.audio_bridge.take(),
            midi_fx: pending.midi_fx.take(),
            timeline_object: pending.timeline_object.take(),
            transport_maps: pending.transport_maps.take(),
            remaining_effects,
            remaining_audio_bridges,
            remaining_timeline: Some(remaining_timeline),
            queued_commands,
            command_rx,
        }
    }
}

impl Drop for RetiredGraphObjects {
    fn drop(&mut self) {
        if let Some(effect) = self.effect.take() {
            effect.reclaim();
        }
        if let Some(object) = self.timeline_object.take() {
            drop_safely(object);
        }
        for effect in self.remaining_effects.drain(..) {
            effect.reclaim();
        }
        self.remaining_audio_bridges.clear();
        if let Some(timeline) = self.remaining_timeline.take() {
            drop_safely(timeline);
        }
        for command in self.queued_commands.drain(..) {
            drop_safely(command);
        }
        if let Some(mut command_rx) = self.command_rx.take() {
            loop {
                while let Ok(command) = command_rx.pop() {
                    drop_safely(command);
                }
                if command_rx.is_abandoned() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
}

fn drop_safely<T>(value: T) {
    if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(value))).is_err() {
        eprintln!("[Engine] Plugin destructor panicked during retirement");
    }
}

impl ActiveEffect {
    fn reclaim(self) {
        let Self { instance, .. } = self;
        drop_safely(instance);
    }

    fn new(id: usize, instance: PluginCore) -> Self {
        Self::with_placement(id, instance, EffectPlacement::MasterChain)
    }

    /// An effect placed somewhere other than the master chain, but still homed
    /// there: a built-in the graph registers detached is the engine's own, and
    /// the master chain is where it belongs once no strip holds it.
    fn with_placement(id: usize, instance: PluginCore, placement: EffectPlacement) -> Self {
        Self::homed(id, instance, placement, EffectPlacement::MasterChain)
    }

    /// An effect that runs nowhere until a chain claims it, and runs nowhere
    /// again once one releases it — the registration a hosted plugin gets, for
    /// the reason on [`Self::home`].
    fn detached(id: usize, instance: PluginCore) -> Self {
        Self::homed(
            id,
            instance,
            EffectPlacement::Detached,
            EffectPlacement::Detached,
        )
    }

    fn homed(
        id: usize,
        instance: PluginCore,
        placement: EffectPlacement,
        home: EffectPlacement,
    ) -> Self {
        Self {
            id,
            instance,
            bypassed: false,
            probability_evaluator: ProbabilityEvaluator,
            midi_fx: MidiFxChain::new(),
            pending_midi: MidiEventBuffer::new(),
            placement,
            home,
            pending_params: DeviceParamQueue::new(),
        }
    }

    /// Whether no path in this callback runs this effect at all: it is
    /// detached, and no bridge feeds it.
    ///
    /// A detached effect is skipped by the master chain and reached by no strip
    /// chain, so the only path left that can run one is its audio bridge —
    /// which is why `bridged` is a parameter rather than a field: the bridge
    /// index lives on the scheduler.
    #[inline]
    fn runs_nowhere(&self, bridged: bool) -> bool {
        !bridged && self.placement == EffectPlacement::Detached
    }

    /// Whether nothing will hand this effect a block on this callback.
    ///
    /// Either it runs nowhere, or it is bypassed — every chain and the bridge
    /// drain skip a bypassed device rather than processing it. Work queued for
    /// a body no block reaches has no drain, so it is discarded rather than
    /// banked.
    #[inline]
    fn receives_no_block(&self, bridged: bool) -> bool {
        self.bypassed || self.runs_nowhere(bridged)
    }

    #[inline]
    fn enqueue_midi(&mut self, event: MidiNoteEvent, diagnostics: &mut ActiveMidiRtDiagnostics) {
        // Drop the newest event when the fixed block-local buffer is full.
        if !self.pending_midi.try_push(event) {
            diagnostics.record_scheduler_event_buffer_overflow(1);
        }
    }
}

pub struct AudioScheduler {
    effects: Vec<ActiveEffect>,
    /// Effect id → slot into `effects`, so per-id resolution is O(1) on the
    /// callback. Maintained only by the registration and removal arms; see
    /// [`IdSlotIndex`] for the capacity and allocation contract.
    effect_index: IdSlotIndex,
    /// Slots whose fixed parameter queues are non-empty.
    parameter_work: SlotWorkSet,
    /// Slots that may need detached-MIDI cleanup without walking the table.
    pending_midi_work: SlotWorkSet,
    /// The explicit, deterministic order of master insert processing.
    master_work: MasterWorkList,
    audio_bridges: Vec<PluginAudioBridge>,
    /// Plugin id → slot into `audio_bridges`, on the same contract as
    /// `effect_index`.
    bridge_index: IdSlotIndex,
    /// Effect ids the render callback hands captured device audio to.
    ///
    /// Reserved once at [`CRUMBS_CAPTURE_RESERVE`] and never grown: it is
    /// walked and mutated on the callback, so a push past the reserve is
    /// refused and counted rather than allowed to reallocate inside the
    /// deadline. It stays a flat vector rather than an [`IdSlotIndex`] because
    /// delivery walks the whole of it every chunk and the reserve is a
    /// handful of entries — a trie would cost a walk per id to save nothing.
    capture_consumers: Vec<usize>,
    timeline: TimelineGraph,
    /// Absolute frame of the next block's first sample. It advances only while
    /// the transport is playing, so a clip start and a parameter stamp mean
    /// the same position however many callbacks ran meanwhile.
    playhead_frames: u64,
    command_rx: Option<Consumer<GraphCommand>>,
    retired_tx: Producer<RetiredGraphObjects>,
    pending_retirement: Option<RetiredGraphObjects>,
    /// A consumed [`GraphCommand::BeginBatch`] whose body is not yet fully
    /// visible or whose retirements the ring cannot yet absorb. While this is
    /// set the drain applies nothing, so every block renders the pre-batch
    /// graph until the batch can land whole.
    pending_batch: Option<usize>,
    shutdown_commands: Vec<GraphCommand>,
    retain_command_consumer: bool,
    sample_rate: f32,
    transport: TransportState,
    /// The arrangement's tempo and meter, when a producer has installed them.
    /// `None` leaves the flat scalars on `transport` authoritative, which is
    /// exactly the behaviour every caller had before the maps existed — the
    /// offline renderer included.
    transport_maps: Option<Box<TransportMaps>>,
    loop_region: LoopRegion,
    /// Whether the monitor is shadowed ([`GraphCommand::SetMonitorShadow`]).
    ///
    /// A plain `bool`, not an atomic: it is written by the command drain and
    /// read by the device write, both inside the same callback on the same
    /// thread, so there is no cross-thread read to order. The device write is
    /// the only consumer — nothing in this file branches on it, which is what
    /// keeps a shadowed engine rendering exactly what an audible one renders.
    monitor_shadowed: bool,
    /// Loop seams this engine has closed, for
    /// [`TransportPositionSnapshot::loop_wraps`].
    loop_wraps: u64,
    /// The frame the walk had reached when the seam numbered `loop_wraps`
    /// closed, for [`GraphProgressSnapshot::last_wrap_frame`].
    last_wrap_frame: u64,
    midi_rt_diagnostics: ActiveMidiRtDiagnostics,
    midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
    timeline_rt_diagnostics_tx: Input<TimelineRtDiagnosticsSnapshot>,
    /// Fenced batches applied whole, for [`GraphProgressSnapshot`].
    batches_applied: u64,
    graph_progress_tx: Input<GraphProgressSnapshot>,
    transport_position_tx: Input<TransportPositionSnapshot>,
    /// The master peak currently being held, for [`MasterMeterSnapshot`].
    held_peak: f32,
    /// Frames rendered since `held_peak` was last taken, against
    /// `peak_hold_frames`.
    held_frames: u64,
    /// How long a peak stands before a quieter callback may replace it, in
    /// frames on this engine's own clock.
    peak_hold_frames: u64,
    master_meter_tx: Input<MasterMeterSnapshot>,
    #[cfg(test)]
    rt_work: RtWorkCounters,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct RtWorkCounters {
    parameter_table_visits: usize,
    master_table_visits: usize,
    pending_midi_work_visits: usize,
}

impl AudioScheduler {
    #[cfg(test)]
    pub(crate) fn new(
        command_rx: Consumer<GraphCommand>,
        retired_tx: Producer<RetiredGraphObjects>,
        sample_rate: f32,
    ) -> Self {
        let (diagnostics_tx, _diagnostics_reader) = active_midi_rt_diagnostics_channel();
        Self::with_midi_rt_diagnostics(command_rx, retired_tx, sample_rate, diagnostics_tx)
    }

    pub(crate) fn with_midi_rt_diagnostics(
        command_rx: Consumer<GraphCommand>,
        retired_tx: Producer<RetiredGraphObjects>,
        sample_rate: f32,
        midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
    ) -> Self {
        let (timeline_diagnostics_tx, _timeline_diagnostics_reader) =
            timeline_rt_diagnostics_channel();
        let (graph_progress_tx, _graph_progress_reader) = graph_progress_channel();
        let (transport_position_tx, _transport_position_reader) = transport_position_channel();
        let (master_meter_tx, _master_meter_reader) = master_meter_channel();
        Self::with_rt_diagnostics(
            command_rx,
            retired_tx,
            sample_rate,
            midi_rt_diagnostics_tx,
            timeline_diagnostics_tx,
            graph_progress_tx,
            transport_position_tx,
            master_meter_tx,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn with_rt_diagnostics(
        command_rx: Consumer<GraphCommand>,
        retired_tx: Producer<RetiredGraphObjects>,
        sample_rate: f32,
        midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
        timeline_rt_diagnostics_tx: Input<TimelineRtDiagnosticsSnapshot>,
        graph_progress_tx: Input<GraphProgressSnapshot>,
        transport_position_tx: Input<TransportPositionSnapshot>,
        master_meter_tx: Input<MasterMeterSnapshot>,
    ) -> Self {
        let command_queue_capacity = command_rx.buffer().capacity();
        Self {
            effects: Vec::with_capacity(EFFECT_TABLE_CAPACITY),
            effect_index: IdSlotIndex::reserved(EFFECT_TABLE_CAPACITY),
            parameter_work: SlotWorkSet::reserved(EFFECT_TABLE_CAPACITY),
            pending_midi_work: SlotWorkSet::reserved(EFFECT_TABLE_CAPACITY),
            master_work: MasterWorkList::reserved(EFFECT_TABLE_CAPACITY),
            audio_bridges: Vec::with_capacity(AUDIO_BRIDGE_TABLE_CAPACITY),
            bridge_index: IdSlotIndex::reserved(AUDIO_BRIDGE_TABLE_CAPACITY),
            capture_consumers: Vec::with_capacity(CRUMBS_CAPTURE_RESERVE),
            timeline: TimelineGraph::new(),
            playhead_frames: 0,
            command_rx: Some(command_rx),
            retired_tx,
            pending_retirement: None,
            pending_batch: None,
            // Sized for the boot ring; a swap can grow the live ring, so the
            // drop-time drain re-reserves from the live ring's capacity.
            shutdown_commands: Vec::with_capacity(command_queue_capacity),
            retain_command_consumer: !cfg!(test),
            sample_rate,
            transport: TransportState::default(),
            transport_maps: None,
            loop_region: LoopRegion::default(),
            // Audible until a session says otherwise. The gate is a mode a
            // caller opts into, so an engine nobody told behaves exactly as
            // every engine did before the gate existed; a live session that
            // wants silence sends the command inside the same fenced batch as
            // its topology, which is applied before any block that could hold
            // that session's programme.
            monitor_shadowed: false,
            loop_wraps: 0,
            last_wrap_frame: 0,
            midi_rt_diagnostics: ActiveMidiRtDiagnostics::new(),
            midi_rt_diagnostics_tx,
            timeline_rt_diagnostics_tx,
            batches_applied: 0,
            graph_progress_tx,
            transport_position_tx,
            held_peak: 0.0,
            held_frames: 0,
            // Derived from the rate the stream actually opened at, so the hold
            // lasts the same wall-clock span on a 44.1 kHz device as on a
            // 96 kHz one.
            peak_hold_frames: (sample_rate / PEAK_HOLD_RELEASES_PER_SECOND) as u64,
            master_meter_tx,
            #[cfg(test)]
            rt_work: RtWorkCounters::default(),
        }
    }

    #[inline]
    pub(crate) fn publish_midi_rt_diagnostics(&mut self) {
        self.midi_rt_diagnostics_tx
            .write(self.midi_rt_diagnostics.snapshot());
    }

    #[inline]
    pub(crate) fn publish_timeline_rt_diagnostics(&mut self) {
        self.timeline_rt_diagnostics_tx
            .write(self.timeline.diagnostics());
    }

    /// The progress echo, read directly by same-thread drivers (the offline
    /// renderer, tests). The live path publishes the same value through
    /// [`Self::publish_graph_progress`] at the end of each callback.
    pub const fn graph_progress(&self) -> GraphProgressSnapshot {
        GraphProgressSnapshot {
            batches_applied: self.batches_applied,
            playhead_frame: self.playhead_frames,
            loop_wraps: self.loop_wraps,
            last_wrap_frame: self.last_wrap_frame,
        }
    }

    /// Whether the device write must be silenced this callback
    /// ([`GraphCommand::SetMonitorShadow`]).
    #[inline]
    pub(crate) const fn monitor_shadowed(&self) -> bool {
        self.monitor_shadowed
    }

    #[inline]
    pub(crate) fn publish_graph_progress(&mut self) {
        let snapshot = self.graph_progress();
        self.graph_progress_tx.write(snapshot);
    }

    /// Where the transport stands, read directly by same-thread drivers (the
    /// offline renderer, tests). The live path publishes the same value
    /// through [`Self::publish_transport_position`] at the end of each
    /// callback.
    pub const fn transport_position(&self) -> TransportPositionSnapshot {
        TransportPositionSnapshot {
            playing: self.transport.is_playing,
            playhead_frame: self.playhead_frames,
            loop_wraps: self.loop_wraps,
            batches_applied: self.batches_applied,
            tempo: self.transport.tempo,
            time_sig_num: self.transport.time_sig_num,
            time_sig_denom: self.transport.time_sig_denom,
        }
    }

    #[inline]
    pub(crate) fn publish_transport_position(&mut self) {
        let snapshot = self.transport_position();
        self.transport_position_tx.write(snapshot);
    }

    /// Hold this callback's device peak and publish what is being held.
    ///
    /// A meter is polled at UI rate and fed at callback rate, so most peaks
    /// are never seen by the reader that samples between them. The hold is
    /// what makes the published number the loudest thing that actually
    /// happened rather than whichever block the poll happened to land on: a
    /// peak stands until something louder arrives or the window expires, and a
    /// quieter callback inside the window advances the window rather than the
    /// level. `>=` rather than `>` restarts the window on a repeated peak, so
    /// steady material holds at its own level instead of decaying under it.
    #[inline]
    pub(crate) fn publish_master_meter(&mut self, callback_peak: f32, frames: u64) {
        if callback_peak >= self.held_peak || self.held_frames >= self.peak_hold_frames {
            self.held_peak = callback_peak;
            self.held_frames = 0;
        } else {
            self.held_frames += frames;
        }
        self.master_meter_tx.write(MasterMeterSnapshot {
            peak: self.held_peak,
        });
    }

    /// The routed graph, for callers proving what a command did to it.
    pub fn timeline(&self) -> &TimelineGraph {
        &self.timeline
    }

    /// How many slots the shared effect table actually holds.
    ///
    /// The control side's ledger claims to be a count of exactly this
    /// ([`crate::EngineHandle::registered_effect_count`]), and a test that
    /// never compares the two watches the model agree with itself.
    #[cfg(test)]
    pub(crate) fn effect_table_len(&self) -> usize {
        self.effects.len()
    }

    /// The ids currently on the input bus.
    ///
    /// The control side keeps a ledger claiming to hold exactly these
    /// ([`crate::EngineHandle`]), and it is a ledger of ids rather than a
    /// count, so only a comparison of the two sets can catch a classification
    /// that moves one and not the other.
    #[cfg(test)]
    pub(crate) fn capture_consumers(&self) -> &[usize] {
        &self.capture_consumers
    }

    #[cfg(test)]
    fn reset_rt_work_counters(&mut self) {
        self.rt_work = RtWorkCounters::default();
    }

    #[cfg(test)]
    fn rt_work_counters(&self) -> RtWorkCounters {
        self.rt_work
    }

    /// Absolute frame of the next block's first sample.
    pub const fn playhead_frames(&self) -> u64 {
        self.playhead_frames
    }

    /// Process pending UI commands lock-free on the audio thread.
    ///
    /// Commands arrive two ways and the drain honours both:
    ///
    /// - Loose commands (the typed [`crate::EngineHandle`] methods) apply as
    ///   they become visible, one at a time.
    /// - A batch published behind a [`GraphCommand::BeginBatch`] fence applies
    ///   all-or-nothing: until every command the fence announces is visible
    ///   *and* the retirement ring can absorb one retirement per command, none
    ///   of it applies and the block renders the pre-batch graph. Retirement
    ///   backpressure therefore suspends a drain only at batch boundaries,
    ///   never inside one.
    #[inline]
    pub fn update_graph(&mut self) {
        if !self.flush_pending_retirement() {
            return;
        }

        loop {
            if let Some(commands) = self.pending_batch {
                if !self.batch_ready(commands) {
                    return;
                }
                self.pending_batch = None;
                for _ in 0..commands {
                    let cmd = self
                        .command_rx
                        .as_mut()
                        .expect("command consumer")
                        .pop()
                        .expect("batch_ready proved the whole batch visible");
                    // batch_ready reserved a retirement slot per command, so
                    // the drain cannot suspend inside the batch.
                    let retire_ok = self.apply_and_retire(cmd);
                    debug_assert!(retire_ok, "batch_ready reserved retirement slots");
                }
                // Counted only here, after the whole fenced body applied: the
                // progress echo's `batches_applied` must never number a batch
                // the graph has not fully absorbed.
                self.batches_applied = self.batches_applied.saturating_add(1);
                continue;
            }

            let Ok(cmd) = self.command_rx.as_mut().expect("command consumer").pop() else {
                return;
            };
            match cmd {
                GraphCommand::BeginBatch { commands } => {
                    self.pending_batch = Some(commands);
                }
                cmd => {
                    if !self.apply_and_retire(cmd) {
                        return;
                    }
                }
            }
        }
    }

    /// Whether a fenced batch can apply in full right now: every announced
    /// command is visible on the command ring, and the retirement ring can
    /// take one retirement per command while keeping the reserved shutdown
    /// slot. Both bounds are what the control side provisioned for
    /// ([`crate::EngineHandle::send_graph_batch`] co-sizes the rings at
    /// capacity and capacity + 1), so a deferral here is transient — the
    /// producer finishes its push, the reclaimer frees slots on its next poll
    /// — never a livelock.
    fn batch_ready(&self, commands: usize) -> bool {
        let command_rx = self.command_rx.as_ref().expect("command consumer");
        debug_assert!(
            command_rx.buffer().capacity() >= commands
                && self.retired_tx.buffer().capacity() > commands,
            "a fenced batch must fit the rings it was admitted against"
        );
        command_rx.slots() >= commands && self.retired_tx.slots() > commands
    }

    /// Apply one command and hand any retirement off the callback thread.
    /// Returns `false` when the retirement ring could not take it; the caller
    /// stops draining and the held retirement flushes first next callback.
    fn apply_and_retire(&mut self, cmd: GraphCommand) -> bool {
        match self.apply_command(cmd) {
            Some(retired) => self.retire(retired),
            None => true,
        }
    }

    /// Apply one drained command to the graph, returning anything the command
    /// gave up for reclamation off the callback thread.
    fn apply_command(&mut self, cmd: GraphCommand) -> Option<RetiredGraphObjects> {
        {
            let retired = match cmd {
                GraphCommand::AddEffect(id, instance) => {
                    self.add_builtin_effect(id, instance, EffectPlacement::MasterChain)
                }
                GraphCommand::AddDetachedEffect(id, instance) => {
                    self.add_builtin_effect(id, instance, EffectPlacement::Detached)
                }
                #[cfg(test)]
                GraphCommand::RemovePlugin(id) => {
                    self.remove_effect(id).map(RetiredGraphObjects::effect)
                }
                GraphCommand::RemovePluginWithBridge(id) => {
                    RetiredGraphObjects::effect_with_bridge(
                        self.remove_effect(id),
                        self.remove_audio_bridge(id),
                    )
                }
                GraphCommand::SetParam(id, param, value) => {
                    if let Some(slot) = self.effect_index.lookup(id) {
                        if let Some(effect) = self.effects.get_mut(slot) {
                            match &mut effect.instance {
                                PluginCore::Knead(engine) => {
                                    apply_knead_param(engine, param, value)
                                }
                                PluginCore::Native(_) => {
                                    // `SetParam` only has a mapped target for
                                    // the built-in Knead effect today; a
                                    // native plugin's parameters are not
                                    // routed here.
                                    self.midi_rt_diagnostics.record_unmapped_set_param_call(1);
                                }
                            }
                        }
                    }
                    None
                }
                GraphCommand::SetBypass(id, bypassed) => {
                    if let Some(effect) = self.effect_mut(id) {
                        effect.bypassed = bypassed;
                    }
                    None
                }
                GraphCommand::AddPlugin(id, plugin) => {
                    if self.effect_id_exists(id) {
                        self.midi_rt_diagnostics.record_effect_id_collision(1);
                        Some(RetiredGraphObjects::effect(ActiveEffect::new(
                            id,
                            PluginCore::Native(plugin),
                        )))
                    } else if self.effects.len() == EFFECT_TABLE_CAPACITY {
                        self.timeline.record_capacity_refusal();
                        Some(RetiredGraphObjects::effect(ActiveEffect::new(
                            id,
                            PluginCore::Native(plugin),
                        )))
                    } else {
                        self.push_effect(ActiveEffect::new(id, PluginCore::Native(plugin)));
                        None
                    }
                }
                // The registration is detached and homed detached. A hosted
                // plugin belongs to the load that created it, not to the master
                // insert chain: placed there it would render the whole mix
                // through an instance the app is also driving over its bridge,
                // and released there it would do the same the moment a user
                // took it off a strip.
                GraphCommand::AddPluginWithBridge(id, plugin, bridge) => {
                    if self.effect_id_exists(id) {
                        self.midi_rt_diagnostics.record_effect_id_collision(1);
                        RetiredGraphObjects::effect_with_bridge(
                            Some(ActiveEffect::detached(id, PluginCore::Native(plugin))),
                            Some(bridge),
                        )
                    } else if self.effects.len() == EFFECT_TABLE_CAPACITY
                        || self.audio_bridges.len() == AUDIO_BRIDGE_TABLE_CAPACITY
                    {
                        // Both tables must have room, or neither takes the
                        // registration: the plugin without its bridge is a
                        // dry-fallback instance, the bridge without its plugin
                        // returns blocks nothing processes.
                        self.timeline.record_capacity_refusal();
                        RetiredGraphObjects::effect_with_bridge(
                            Some(ActiveEffect::detached(id, PluginCore::Native(plugin))),
                            Some(bridge),
                        )
                    } else {
                        self.push_effect(ActiveEffect::detached(id, PluginCore::Native(plugin)));
                        self.push_bridge(bridge);
                        None
                    }
                }
                GraphCommand::AddMidiFx(id, fx) => {
                    // The instance was built on the control thread; this arm
                    // only moves it into a reserved slot or hands it back
                    // (ADR 0020). An unknown id retires it the same way a
                    // full chain does — dropping the box here would free it
                    // inside the deadline.
                    let Some(effect) = self.effect_mut(id) else {
                        return Some(RetiredGraphObjects::midi_fx(fx));
                    };
                    match effect.midi_fx.try_install(fx) {
                        Ok(_) => None,
                        Err(refused) => {
                            self.timeline.record_capacity_refusal();
                            Some(RetiredGraphObjects::midi_fx(refused))
                        }
                    }
                }
                GraphCommand::RemoveMidiFx(id, index) => {
                    // `take` hands the boxed instance to the retirement
                    // channel without dropping it; an empty slot or an
                    // unknown id frees nothing, like every removal arm.
                    self.effect_mut(id)
                        .and_then(|effect| effect.midi_fx.take(index))
                        .map(RetiredGraphObjects::midi_fx)
                }
                GraphCommand::SetMidiFxParam(id, index, param, value) => {
                    if let Some(fx) = self
                        .effect_mut(id)
                        .and_then(|effect| effect.midi_fx.get_mut(index))
                    {
                        fx.set_param(param, value);
                    }
                    None
                }
                GraphCommand::SendMidiNote(id, event) => {
                    if let Some(slot) = self.effect_index.lookup(id) {
                        if let Some(effect) = self.effects.get_mut(slot) {
                            effect.enqueue_midi(event, &mut self.midi_rt_diagnostics);
                            self.pending_midi_work.insert(slot);
                        }
                    }
                    None
                }
                GraphCommand::SetTransport(state) => {
                    // Stopping holds every mixer parameter where it stands and
                    // drops what it had queued. A ramp is stamped in timeline
                    // frames, and a stopped timeline never reaches the frame it
                    // was aimed at, so without this the mix keeps gliding after
                    // playback ends.
                    if self.transport.is_playing && !state.is_playing {
                        self.timeline.hold_automation(self.playhead_frames);
                    }
                    self.transport = state;
                    None
                }
                GraphCommand::SetTransportPlayback {
                    is_playing,
                    song_pos_seconds,
                } => {
                    // Same stop law as `SetTransport` above; the difference is
                    // ownership. This is the graph transport's write, and it
                    // merges: tempo and time signature belong to the
                    // plugin-transport path and survive untouched, so a graph
                    // batch that starts playback never resets a session to
                    // the 120 BPM engine default. Beats re-derive from the
                    // retained tempo so plugins keep a consistent
                    // (seconds, beats) pair.
                    if self.transport.is_playing && !is_playing {
                        self.timeline.hold_automation(self.playhead_frames);
                    }
                    self.transport.is_playing = is_playing;
                    self.transport.song_pos_seconds = song_pos_seconds;
                    self.transport.song_pos_beats = song_pos_seconds * self.transport.tempo / 60.0;
                    None
                }
                // A swap, never a build and never a free: the box that was
                // installed leaves through the retirement channel, and the one
                // arriving was built control-side (ADR 0020).
                //
                // A map built for another rate is refused rather than read at
                // this one. Its beat integral is a function of the rate it was
                // built against ([`TempoMap::new`]), so a 44.1 kHz map on a
                // 48 kHz device would report every beat position 8.8% off.
                // Refusing keeps whatever is installed — a map built for this
                // rate, or none at all — and the unapplied box leaves over the
                // same channel an accepted one displaces, never freed here.
                GraphCommand::SetTransportMaps(maps) => {
                    if maps.sample_rate == f64::from(self.sample_rate) {
                        self.transport_maps.replace(maps)
                    } else {
                        Some(maps)
                    }
                    .map(RetiredGraphObjects::transport_maps)
                }
                GraphCommand::SetLoopRegion(region) => {
                    self.loop_region = region;
                    None
                }
                GraphCommand::SetMonitorShadow(shadowed) => {
                    self.monitor_shadowed = shadowed;
                    None
                }
                GraphCommand::AddTrack(track) => self.timeline.add_track(track).map(|rejected| {
                    RetiredGraphObjects::timeline(RetiredTimelineObject::Track(rejected))
                }),
                GraphCommand::RemoveTrack(id) => {
                    let placed_on = EffectPlacement::Track(id);
                    self.timeline.remove_track(id).map(|track| {
                        // The track's devices outlive it, so anything that was
                        // on its chain has to stop processing rather than fall
                        // back onto the master mix. Only a placement that
                        // names this track is cleared: an effect's placement
                        // is single-valued, so detaching one that some other
                        // chain is running would silence a live device.
                        for entry in track.device_chain() {
                            if let Some(slot) = self.effect_index.lookup(entry.effect_id) {
                                if self.effects[slot].placement == placed_on {
                                    self.place_effect(entry.effect_id, EffectPlacement::Detached);
                                }
                            }
                        }
                        RetiredGraphObjects::timeline(RetiredTimelineObject::Track(track))
                    })
                }
                GraphCommand::SetTrackOutput(id, target) => {
                    self.timeline.set_track_output(id, target);
                    None
                }
                GraphCommand::SetTrackMute(id, muted) => {
                    self.timeline.set_track_mute(id, muted);
                    None
                }
                GraphCommand::SetTrackSoloGate(id, gated) => {
                    self.timeline.set_track_solo_gate(id, gated);
                    None
                }
                GraphCommand::InsertTrackDevice {
                    track_id,
                    entry,
                    index,
                } => {
                    // Only claim the effect when the chain actually took it: a
                    // refused splice must leave the effect where it was rather
                    // than silence it.
                    if !self.effect_id_exists(entry.effect_id) {
                        self.timeline.record_unknown_target();
                    } else if self.timeline.insert_track_device(track_id, entry, index) {
                        self.place_effect(entry.effect_id, EffectPlacement::Track(track_id));
                    }
                    None
                }
                GraphCommand::RemoveTrackDevice {
                    track_id,
                    effect_id,
                } => {
                    if self.timeline.remove_track_device(track_id, effect_id) {
                        // Return it to the master chain only when its
                        // placement is the one this track owns, for the reason
                        // given on `RemoveTrack`.
                        self.release_effect(effect_id, EffectPlacement::Track(track_id));
                    }
                    None
                }
                GraphCommand::RemoveTrackDeviceRetired {
                    track_id,
                    effect_id,
                } => {
                    // Retire only what this chain actually held: retiring on a
                    // refused removal could final-drop an effect another chain
                    // is running.
                    if self.timeline.remove_track_device(track_id, effect_id) {
                        RetiredGraphObjects::effect_with_bridge(
                            self.remove_effect(effect_id),
                            self.remove_audio_bridge(effect_id),
                        )
                    } else {
                        None
                    }
                }
                GraphCommand::InsertBusDevice {
                    bus_id,
                    entry,
                    index,
                } => {
                    if !self.effect_id_exists(entry.effect_id) {
                        self.timeline.record_unknown_target();
                    } else if self.timeline.insert_bus_device(bus_id, entry, index) {
                        self.place_effect(entry.effect_id, EffectPlacement::Bus(bus_id));
                    }
                    None
                }
                GraphCommand::RemoveBusDevice { bus_id, effect_id } => {
                    if self.timeline.remove_bus_device(bus_id, effect_id) {
                        self.release_effect(effect_id, EffectPlacement::Bus(bus_id));
                    }
                    None
                }
                GraphCommand::RemoveBusDeviceRetired { bus_id, effect_id } => {
                    if self.timeline.remove_bus_device(bus_id, effect_id) {
                        RetiredGraphObjects::effect_with_bridge(
                            self.remove_effect(effect_id),
                            self.remove_audio_bridge(effect_id),
                        )
                    } else {
                        None
                    }
                }
                GraphCommand::AddSend {
                    track_id,
                    bus_id,
                    tap,
                    level,
                } => {
                    self.timeline.add_send(track_id, bus_id, tap, level);
                    None
                }
                GraphCommand::RemoveSend { track_id, bus_id } => {
                    self.timeline.remove_send(track_id, bus_id);
                    None
                }
                GraphCommand::AddBus(bus) => self.timeline.add_bus(bus).map(|rejected| {
                    RetiredGraphObjects::timeline(RetiredTimelineObject::Bus(rejected))
                }),
                GraphCommand::RemoveBus(id) => {
                    let placed_on = EffectPlacement::Bus(id);
                    self.timeline.remove_bus(id).map(|bus| {
                        // A bus's inserts outlive it exactly as a track's do:
                        // they stop processing rather than falling back onto
                        // the master mix.
                        for entry in bus.device_chain() {
                            if let Some(slot) = self.effect_index.lookup(entry.effect_id) {
                                if self.effects[slot].placement == placed_on {
                                    self.place_effect(entry.effect_id, EffectPlacement::Detached);
                                }
                            }
                        }
                        RetiredGraphObjects::timeline(RetiredTimelineObject::Bus(bus))
                    })
                }
                GraphCommand::SetBusOutput(id, target) => {
                    self.timeline.set_bus_output(id, target);
                    None
                }
                GraphCommand::SetBusMute(id, muted) => {
                    self.timeline.set_bus_mute(id, muted);
                    None
                }
                GraphCommand::SetBusSoloGate(id, gated) => {
                    self.timeline.set_bus_solo_gate(id, gated);
                    None
                }
                GraphCommand::AddClip(track_id, clip) => {
                    self.timeline.add_clip(track_id, clip).map(|rejected| {
                        RetiredGraphObjects::timeline(RetiredTimelineObject::Clip(rejected))
                    })
                }
                GraphCommand::RemoveClip(track_id, clip_id) => self
                    .timeline
                    .remove_clip(track_id, clip_id)
                    .map(|clip| RetiredGraphObjects::timeline(RetiredTimelineObject::Clip(clip))),
                GraphCommand::SetClipPlacement(track_id, clip_id, placement) => {
                    self.timeline
                        .set_clip_placement(track_id, clip_id, placement);
                    None
                }
                GraphCommand::SetClipPlayback(track_id, clip_id, playback) => {
                    self.timeline.set_clip_playback(track_id, clip_id, playback);
                    None
                }
                GraphCommand::SeekFrames(frame) => {
                    self.timeline.seek(frame);
                    self.playhead_frames = frame;
                    None
                }
                GraphCommand::AutomateParam { target, write } => {
                    self.timeline.automate(target, write);
                    None
                }
                // No frame: the smoother continues from the level it holds
                // whatever the playhead does, so the seek, hold and wrap laws
                // that govern the automation lane have nothing to reach.
                GraphCommand::SetMasterGain { value, smoothing } => {
                    self.timeline.set_master_fader_target(value, smoothing);
                    None
                }
                GraphCommand::AutomateDeviceParam {
                    effect_id,
                    param,
                    value,
                    at_frame,
                } => {
                    match self.effect_index.lookup(effect_id) {
                        Some(slot) => {
                            if let Some(effect) = self.effects.get_mut(slot) {
                                if !effect.pending_params.schedule(DeviceParamEvent {
                                    param,
                                    value,
                                    at_frame,
                                }) {
                                    self.timeline.record_automation_queue_overflow();
                                } else {
                                    self.parameter_work.insert(slot);
                                }
                            }
                        }
                        None => self.timeline.record_unknown_target(),
                    }
                    None
                }
                GraphCommand::RegisterCaptureConsumer(id) => {
                    self.register_capture_consumer(id);
                    None
                }
                GraphCommand::UnregisterCaptureConsumer(id) => {
                    self.unregister_capture_consumer(id);
                    None
                }
                #[cfg(test)]
                GraphCommand::RegisterAudioBridge(bridge) => {
                    if self.audio_bridges.len() == AUDIO_BRIDGE_TABLE_CAPACITY {
                        self.timeline.record_capacity_refusal();
                        Some(RetiredGraphObjects::removed(None, Some(bridge), None))
                    } else {
                        self.push_bridge(bridge);
                        None
                    }
                }
                GraphCommand::BeginBatch { .. } => {
                    // A loose fence is consumed by `update_graph` before it
                    // reaches here; a fence inside a batch body is a producer
                    // bug (the single producer never nests them). Consuming it
                    // as a no-op keeps the announced count honest.
                    debug_assert!(false, "a batch fence must not nest inside a batch");
                    None
                }
                GraphCommand::SwapCommandChannel {
                    commands,
                    retired_tx,
                } => {
                    // Adopt the retirement producer first so the old
                    // consumer's retirement below crosses the *new* ring —
                    // the old one may be full, the new one is fresh and
                    // provisioned. Dropping the old producer here only
                    // decrements its Arc: the reclaimer still holds the old
                    // ring's consumer, so no heap is freed on this thread.
                    drop(std::mem::replace(&mut self.retired_tx, retired_tx));
                    let old_rx = self.command_rx.replace(commands).expect("command consumer");
                    // This fence was the old ring's last element (the control
                    // side stops pushing to a ring once it publishes the
                    // swap), so the old ring is drained dry; only the
                    // consumer's own heap remains, and it leaves over the
                    // retirement channel rather than being freed here.
                    Some(RetiredGraphObjects::swapped_consumer(old_rx))
                }
            };
            retired
        }
    }

    /// Whether an id already names a live effect, resolved through the id
    /// index: batch admission asks this once per registering command, and a
    /// table scan per command made a project-sized batch quadratic.
    fn effect_id_exists(&self, id: usize) -> bool {
        self.effect_index.lookup(id).is_some()
    }

    /// Resolve an effect id to a mutable borrow through the id index — the
    /// one per-id resolution every addressed command arm uses, O(1) where
    /// each used to scan the table.
    fn effect_mut(&mut self, id: usize) -> Option<&mut ActiveEffect> {
        let slot = self.effect_index.lookup(id)?;
        self.effects.get_mut(slot)
    }

    /// Append an effect and map its id at the slot it took. Callers have
    /// already refused a colliding id and a full table, so the mapping always
    /// lands. The insert runs unconditionally and only its *result* is
    /// asserted: burying it inside `debug_assert!` would skip the mapping in
    /// release builds, empty the index there, and silently no-op every
    /// per-id path.
    fn push_effect(&mut self, effect: ActiveEffect) {
        let slot = self.effects.len();
        let id = effect.id;
        let placement = effect.placement;
        self.effects.push(effect);
        let inserted = self.effect_index.insert(id, slot);
        debug_assert!(
            inserted,
            "push_effect is only reached after the collision check refused the id"
        );
        if placement == EffectPlacement::MasterChain {
            self.master_work.append(slot);
        }
    }

    /// Append a bridge and map its plugin id at the slot it took, on the same
    /// precondition and the same unconditional-insert law as
    /// [`Self::push_effect`].
    fn push_bridge(&mut self, bridge: PluginAudioBridge) {
        let slot = self.audio_bridges.len();
        let plugin_id = bridge.plugin_id;
        self.audio_bridges.push(bridge);
        let inserted = self.bridge_index.insert(plugin_id, slot);
        debug_assert!(
            inserted,
            "push_bridge is only reached after the collision check refused the id"
        );
    }

    /// Register a built-in effect — whose instance the command carried
    /// already built, constructed control-side — at the given placement,
    /// counting a refusal instead when the id already names a live effect or
    /// the effect table is full.
    ///
    /// Nothing on this path constructs or frees (ADR 0020): on success the
    /// carried instance moves into the effect table, and on either refusal it
    /// moves into the retirement channel exactly as `AddPlugin`'s carried
    /// plugin does — dropping it here would free its engine's buffers on the
    /// callback, the same heap traffic building it there used to cost. The
    /// refusal checks still decide first, so the retirement the caller
    /// observes is an instance the table never held.
    fn add_builtin_effect(
        &mut self,
        id: usize,
        instance: PluginCore,
        placement: EffectPlacement,
    ) -> Option<RetiredGraphObjects> {
        if self.effect_id_exists(id) {
            self.midi_rt_diagnostics.record_effect_id_collision(1);
            return Some(RetiredGraphObjects::effect(ActiveEffect::with_placement(
                id, instance, placement,
            )));
        }
        if self.effects.len() == EFFECT_TABLE_CAPACITY {
            self.timeline.record_capacity_refusal();
            return Some(RetiredGraphObjects::effect(ActiveEffect::with_placement(
                id, instance, placement,
            )));
        }
        self.push_effect(ActiveEffect::with_placement(id, instance, placement));
        None
    }

    /// Record where an effect now runs, after a chain has accepted it.
    fn place_effect(&mut self, effect_id: usize, placement: EffectPlacement) {
        if let Some(slot) = self.effect_index.lookup(effect_id) {
            let prior = self.effects[slot].placement;
            if prior == placement {
                return;
            }
            if prior == EffectPlacement::MasterChain {
                self.master_work.remove(slot);
            }
            self.effects[slot].placement = placement;
            if placement == EffectPlacement::MasterChain {
                self.master_work.append(slot);
            }
        }
    }

    /// Return an effect to its home ([`ActiveEffect::home`]), but only when it
    /// is the named chain that still holds it: an effect's placement is
    /// single-valued, so releasing one some other chain is running would move a
    /// live device.
    fn release_effect(&mut self, effect_id: usize, held_by: EffectPlacement) {
        let Some(slot) = self.effect_index.lookup(effect_id) else {
            return;
        };
        let effect = &self.effects[slot];
        if effect.placement == held_by {
            let home = effect.home;
            self.place_effect(effect_id, home);
        }
    }

    /// Remove an effect in O(1): the id index names its slot, the entry swaps
    /// with the table's tail instead of compacting the ~5.9 KiB entries
    /// behind it, and the moved entry's mapping is repointed at the slot it
    /// now occupies. A strip teardown batches up to
    /// `MAX_*_DEVICES` of these behind one fence, applied in one callback —
    /// at the derived capacity a compaction removal there was memmoving tens
    /// of megabytes inside the deadline; this moves one entry.
    ///
    /// Table order is not load-bearing: chains name effects by id in their
    /// own order, every addressed command resolves through the id index, and
    /// the one iteration that reads slot order — the master insert loop —
    /// states its order contract on itself.
    ///
    /// This is where the input bus is pruned, because it is the one place an
    /// effect is finally dropped — a plugin, a retired track device and a
    /// retired bus device all leave through here. The bus holds ids, not
    /// instances, so a consumer left on it after its effect went would resolve
    /// to whatever id reuse puts in that slot next — or to nothing, counting a
    /// dropped block every callback for the rest of the session. The prune
    /// runs ahead of the lookup, so a removal for an id the table no longer
    /// holds still clears the bus rather than stranding a registration that
    /// arrived for an effect the graph never took.
    fn remove_effect(&mut self, id: usize) -> Option<ActiveEffect> {
        self.unregister_capture_consumer(id);
        let slot = self.effect_index.delete(id)?;
        let old_tail = self.effects.len() - 1;
        self.parameter_work.remove(slot);
        self.pending_midi_work.remove(slot);
        self.master_work.remove(slot);
        let removed = self.effects.swap_remove(slot);
        // The swap moved the table's tail into `slot` unless the removed
        // entry was itself the tail; that entry's mapping still points at the
        // tail position, so repoint it before anyone resolves the id.
        if let Some(moved) = self.effects.get(slot) {
            self.effect_index.set_slot(moved.id, slot);
            self.parameter_work.move_slot(old_tail, slot);
            self.pending_midi_work.move_slot(old_tail, slot);
            self.master_work.move_slot(old_tail, slot);
        }
        Some(removed)
    }

    /// Remove a bridge on the same swap-remove law as [`Self::remove_effect`].
    fn remove_audio_bridge(&mut self, plugin_id: usize) -> Option<PluginAudioBridge> {
        let slot = self.bridge_index.delete(plugin_id)?;
        let removed = self.audio_bridges.swap_remove(slot);
        if let Some(moved) = self.audio_bridges.get(slot) {
            self.bridge_index.set_slot(moved.plugin_id, slot);
        }
        Some(removed)
    }

    /// Put an id on the input bus, or refuse and count it.
    ///
    /// Two refusals, both last-line: the bus is reserved once at
    /// [`CRUMBS_CAPTURE_RESERVE`] and may not grow on the callback, and a
    /// duplicate would hand one plugin the same block twice per chunk — which
    /// a recorder writes as doubled audio rather than as an error.
    ///
    /// The id is not resolved here. A fenced batch may carry this command and
    /// the `AddPlugin` that creates its target in either order, so requiring
    /// the effect to exist would refuse half the valid orderings; delivery
    /// resolves the id instead, every chunk, and skips one that names nothing.
    fn register_capture_consumer(&mut self, id: usize) {
        if self.capture_consumers.len() == CRUMBS_CAPTURE_RESERVE
            || self.capture_consumers.contains(&id)
        {
            self.midi_rt_diagnostics.record_capture_consumer_refusal(1);
            return;
        }

        self.capture_consumers.push(id);
    }

    /// Take an id off the input bus. An absent id frees nothing and refuses
    /// nothing: an unregister may follow the plugin's own removal, which has
    /// already pruned it.
    fn unregister_capture_consumer(&mut self, id: usize) {
        if let Some(slot) = self.capture_consumers.iter().position(|held| *held == id) {
            self.capture_consumers.swap_remove(slot);
        }
    }

    /// Hand one render chunk of captured device audio to every registered
    /// consumer.
    ///
    /// Called by the render callback before the block that chunk renders, and
    /// only while an input stream is actually feeding it: an engine with no
    /// input device delivers nothing rather than delivering silence, because
    /// a missing device is not a gap in a take.
    ///
    /// The block is shared read-only, so every consumer sees the same samples.
    /// An id resolving to no effect, or to one whose instance is a built-in
    /// with no input tap, takes nothing — and a block no consumer took is
    /// counted, because a bus that delivers to nobody is a recorder writing
    /// silence with nothing to say why.
    #[inline]
    pub fn deliver_capture(&mut self, block: CaptureInputBlock<'_>) {
        if self.capture_consumers.is_empty() {
            return;
        }

        if !block.served {
            self.midi_rt_diagnostics.record_capture_input_underrun(1);
        }

        let Self {
            capture_consumers,
            effect_index,
            effects,
            midi_rt_diagnostics,
            ..
        } = self;
        let mut taken = false;
        for id in capture_consumers.iter().copied() {
            let Some(effect) = effect_index
                .lookup(id)
                .and_then(|slot| effects.get_mut(slot))
            else {
                continue;
            };
            if let PluginCore::Native(plugin) = &mut effect.instance {
                plugin.process_capture_input(block);
                taken = true;
            }
        }

        if !taken {
            midi_rt_diagnostics.record_capture_blocks_dropped(1);
        }
    }

    fn flush_pending_retirement(&mut self) -> bool {
        let Some(retired) = self.pending_retirement.take() else {
            return true;
        };

        self.retire(retired)
    }

    fn retire(&mut self, retired: RetiredGraphObjects) -> bool {
        if self.retired_tx.slots() <= 1 {
            self.pending_retirement = Some(retired);
            return false;
        }

        match self.retired_tx.push(retired) {
            Ok(()) => true,
            Err(PushError::Full(retired)) => {
                self.pending_retirement = Some(retired);
                false
            }
        }
    }

    /// Process ring-buffer audio bridges — reads input blocks from main thread,
    /// processes through plugins, writes output back for main thread to return to worklet.
    ///
    /// `callback_frames` is what the device asked for this period. Each bridge
    /// may spend that plus one render quantum of catch-up, so a backlog left
    /// by a main-thread stall is worked off over successive callbacks rather
    /// than rendered in one spike on the thread with the deadline.
    #[inline]
    pub fn process_audio_bridges(&mut self, callback_frames: usize) {
        // A device period the bridge cannot carry would starve every plugin
        // permanently rather than intermittently, so it is counted rather than
        // left to look like ordinary jitter.
        if callback_frames > MAX_CALLBACK_FRAMES {
            self.midi_rt_diagnostics
                .record_callback_frames_over_bridge_reach(1);
        }
        let callback_frames = callback_frames.min(MAX_CALLBACK_FRAMES);
        let frame_budget = callback_frames.saturating_add(RENDER_QUANTUM_FRAMES);
        // One derivation, shared with the host side that has to compensate for
        // the depth it settles at — see `audio_bridge::target_depth_blocks`.
        let target_depth_blocks = audio_bridge::target_depth_blocks(callback_frames);

        // The bridge table holds at most `AUDIO_BRIDGE_TABLE_CAPACITY`
        // entries, so walking it in order is bounded and may stay linear;
        // what must not be linear is the per-bridge effect resolution, which
        // goes through the id index.
        for bridge in &mut self.audio_bridges {
            let plugin_id = bridge.plugin_id;

            let effect = self
                .effect_index
                .lookup(plugin_id)
                .and_then(|slot| self.effects.get_mut(slot));

            // A bridge with no plugin able to process its audio — no effect
            // under that id at all (registered on its own through
            // `RegisterAudioBridge`, or outliving its plugin), or an effect
            // with no bridged path, such as a built-in Knead — used to be left
            // untouched. Its input ring then filled and stayed full, so every
            // later push was refused and the app was left on permanent dry
            // fallback with nothing recorded. Return the blocks untouched
            // instead: the app keeps its audio, the ring keeps moving, and the
            // count says no plugin took them.
            let unprocessable = match effect {
                None => true,
                Some(ref effect) => !matches!(effect.instance, PluginCore::Native(_)),
            };

            if unprocessable {
                let drain =
                    bridge.drain_process(frame_budget, target_depth_blocks, |left, right, n| {
                        let _ = (left, right, n);
                    });
                self.midi_rt_diagnostics
                    .record_unmatched_bridge_blocks(drain.blocks_processed as u64);
                self.midi_rt_diagnostics
                    .record_bridge_output_blocks_dropped(drain.output_blocks_dropped as u64);
                self.midi_rt_diagnostics
                    .record_bridge_backlog_blocks_shed(drain.blocks_shed as u64);
                if let Some(effect) = effect {
                    effect.pending_midi.clear();
                }
                continue;
            }

            let Some(effect) = effect else {
                continue;
            };

            // While the monitor is audible, a plugin a track or bus chain holds
            // is processed inline by that chain over the strip's own signal
            // (`TrackDeviceChain::run_device`). Its bridge still has to move —
            // an input ring left to fill refuses every later push for good — so
            // the blocks are returned exactly as they arrived. `pending_midi` is
            // deliberately left alone: the chain is what consumes it this
            // callback, and clearing it here would take the events away from the
            // path that is going to deliver them.
            if !self.monitor_shadowed
                && matches!(
                    effect.placement,
                    EffectPlacement::Track(_) | EffectPlacement::Bus(_)
                )
            {
                let drain =
                    bridge.drain_process(frame_budget, target_depth_blocks, |left, right, n| {
                        let _ = (left, right, n);
                    });
                self.midi_rt_diagnostics
                    .record_bridge_blocks_passed_chain_bound(drain.blocks_processed as u64);
                self.midi_rt_diagnostics
                    .record_bridge_output_blocks_dropped(drain.output_blocks_dropped as u64);
                self.midi_rt_diagnostics
                    .record_bridge_backlog_blocks_shed(drain.blocks_shed as u64);
                continue;
            }

            if effect.bypassed {
                // Drain input without processing (passthrough)
                let drain =
                    bridge.drain_process(frame_budget, target_depth_blocks, |left, right, n| {
                        // output = input (already in the block)
                        let _ = (left, right, n);
                    });
                self.midi_rt_diagnostics
                    .record_bridge_output_blocks_dropped(drain.output_blocks_dropped as u64);
                self.midi_rt_diagnostics
                    .record_bridge_backlog_blocks_shed(drain.blocks_shed as u64);
                // A bypassed effect discards incoming MIDI rather than
                // banking it: without this, notes queued via SendMidiNote
                // while bypassed would accumulate toward the fixed
                // 128-slot ceiling and then flush as one stale burst —
                // old note-ons with no note-offs behind them — the
                // instant the effect is un-bypassed.
                effect.pending_midi.clear();
                continue;
            }

            let PluginCore::Native(ref mut plugin) = effect.instance else {
                continue;
            };

            let probability_evaluator = &mut effect.probability_evaluator;
            let midi_fx = &mut effect.midi_fx;
            let pending_midi = &mut effect.pending_midi;
            let transport = self.transport;
            let sample_rate = self.sample_rate;

            let diagnostics = &mut self.midi_rt_diagnostics;
            // The MIDI chain belongs to the callback, not to the block.
            // Several blocks are normally waiting, and running the chain
            // once per block would re-evaluate authored probability and
            // re-emit every queued note once per block — the same note-on
            // delivered to the plugin two, three, four times. It runs on
            // the first block of the pass, the earliest audio in the
            // callback.
            let mut events_delivered = false;

            let drain = bridge.drain_process(
                frame_budget,
                target_depth_blocks,
                |left, right, num_samples| {
                    if events_delivered {
                        plugin.process_bridged_audio(left, right, num_samples);
                        return;
                    }

                    probability_evaluator.process_midi_with_diagnostics(
                        pending_midi,
                        &transport,
                        sample_rate,
                        num_samples,
                        diagnostics,
                    );
                    for fx in midi_fx.iter_mut() {
                        fx.process_midi_with_diagnostics(
                            pending_midi,
                            &transport,
                            sample_rate,
                            num_samples,
                            diagnostics,
                        );
                    }
                    events_delivered = true;

                    if pending_midi.is_empty() {
                        plugin.process_bridged_audio(left, right, num_samples);
                    } else {
                        plugin.process_bridged_with_events(
                            left,
                            right,
                            num_samples,
                            pending_midi.as_slice(),
                            &transport,
                        );
                    }
                },
            );

            // Only clear pending MIDI when the closure actually ran and
            // consumed it. When the input ring was empty this cycle (the
            // render callback beating the worklet's push, guaranteed at
            // bridge startup and on any cadence jitter), the events must
            // survive to the next cycle rather than being dropped.
            if drain.blocks_processed > 0 {
                pending_midi.clear();
            }
            diagnostics.record_bridge_output_blocks_dropped(drain.output_blocks_dropped as u64);
            diagnostics.record_bridge_backlog_blocks_shed(drain.blocks_shed as u64);
        }
        self.remove_empty_pending_midi_work();
    }

    fn remove_empty_pending_midi_work(&mut self) {
        let mut index = 0;
        while index < self.pending_midi_work.slots.len() {
            let slot = self.pending_midi_work.slots[index];
            #[cfg(test)]
            {
                self.rt_work.pending_midi_work_visits += 1;
            }
            if self.effects[slot].pending_midi.is_empty() {
                self.pending_midi_work.remove(slot);
            } else {
                index += 1;
            }
        }
    }

    /// Land every time-stamped device-parameter change the block has reached.
    ///
    /// A device owns its own parameter smoothing, so these apply once at the
    /// block boundary rather than at a sample offset inside it.
    fn apply_due_device_params(&mut self, block_start: u64, frames: usize) {
        if frames == 0 {
            return;
        }

        let last_frame = block_start + (frames - 1) as u64;
        #[cfg(test)]
        let mut visits = 0;
        let mut work_index = 0;
        while work_index < self.parameter_work.slots.len() {
            let slot = self.parameter_work.slots[work_index];
            debug_assert!(
                slot < self.effects.len(),
                "parameter work points beyond the effect table"
            );
            #[cfg(test)]
            {
                visits += 1;
            }
            let effect = &mut self.effects[slot];
            let bridged = self.bridge_index.lookup(effect.id).is_some();
            let receives_no_block = effect.receives_no_block(bridged);
            while let Some(event) = effect.pending_params.pop_due(last_frame) {
                match (&mut effect.instance, event.param) {
                    (PluginCore::Knead(engine), DeviceParamTarget::Builtin(param)) => {
                        apply_knead_param(engine, param, event.value as f32);
                    }
                    // A hosted plugin only ever receives a write through a
                    // process call, so a stamp queued on one no block reaches
                    // is never drained: it holds the plugin's
                    // pending-parameter queue non-empty, and a non-empty queue
                    // refuses the plugin's state read (so a project save skips
                    // its chunk) and every parameter poll (so its cache
                    // freezes). Neither condition has to end on its own — a
                    // detached effect stays detached until some chain claims it
                    // again, which may be never — so the write can freeze the
                    // instance for the rest of its life. The stamp is therefore
                    // popped and dropped, on the same contract a bypassed or
                    // detached device's `pending_midi` follows in
                    // `process_audio_bridges`, in both chain arms and in the
                    // detached sweep: queued where nothing consumes it is
                    // discarded, never banked.
                    //
                    // A `Builtin` stamp is deliberately not dropped. The knead
                    // engine holds its parameters in its own struct, written
                    // here and needing no process call to receive them, so the
                    // value has to be current the moment the effect is
                    // un-bypassed or placed on a chain again. A hosted plugin
                    // cannot be written to at all until it is handed a block —
                    // that is the whole of the asymmetry.
                    (PluginCore::Native(_), DeviceParamTarget::Hosted { .. })
                        if receives_no_block => {}
                    (PluginCore::Native(plugin), DeviceParamTarget::Hosted { id }) => {
                        if !plugin.apply_parameter_on_audio_thread(id, event.value) {
                            self.midi_rt_diagnostics.record_unmapped_set_param_call(1);
                        }
                    }
                    // A stamp addressed at the other kind of body: the mapper
                    // resolves the address from the device it is written at, so
                    // this is a producer that lost track of what the effect id
                    // holds, not a value the engine may guess at.
                    _ => {
                        self.midi_rt_diagnostics.record_unmapped_set_param_call(1);
                    }
                }
            }
            if effect.pending_params.is_empty() {
                self.parameter_work.remove(slot);
            } else {
                work_index += 1;
            }
        }
        #[cfg(test)]
        {
            self.rt_work.parameter_table_visits += visits;
        }
    }

    /// Render the timeline into the engine's stereo pair.
    ///
    /// An empty graph is skipped entirely, so an engine with no tracks and no
    /// buses renders exactly what it did before the timeline existed.
    ///
    /// Clips sound only while the transport plays. The playhead stands still
    /// otherwise, so a clip under a parked playhead would re-render the same
    /// span every callback. The rest of the graph keeps running on a stopped
    /// transport — device chains, sends, buses and the master sum — exactly as
    /// the master insert chain below does, so what was already sounding drains
    /// its tail instead of being cut off.
    fn render_timeline(
        &mut self,
        block_start: u64,
        frames: usize,
        left: &mut [f32],
        right: &mut [f32],
    ) {
        if frames == 0 || self.timeline.is_empty() {
            return;
        }

        let Self {
            timeline,
            effects,
            effect_index,
            audio_bridges,
            bridge_index,
            midi_rt_diagnostics,
            transport,
            sample_rate,
            monitor_shadowed,
            ..
        } = self;
        let mut devices = TrackDeviceChain {
            effects,
            effect_index,
            audio_bridges,
            bridge_index,
            midi_rt_diagnostics,
            transport: *transport,
            sample_rate: *sample_rate,
            monitor_shadowed: *monitor_shadowed,
        };

        timeline.render(
            block_start,
            frames,
            transport.is_playing,
            &mut devices,
            &mut left[..frames],
            &mut right[..frames],
        );
    }

    /// Re-derive the plugin-visible transport for the frame a span starts on.
    ///
    /// Only a scheduler holding maps does this. Without them the flat scalars
    /// stand exactly where the last transport command left them, which is the
    /// behaviour every caller had before the maps existed — the offline
    /// renderer's determinism above all. With them, tempo, meter and beat
    /// position are functions of the playhead again, so a device whose clock
    /// is the transport (the arpeggiator's step timer, a hosted plugin's
    /// sync) hears the tempo the arrangement actually has at that frame.
    ///
    /// Two binary searches and a multiply. Nothing allocates.
    #[inline]
    fn refresh_transport_at(&mut self, frame: u64) {
        let Some(maps) = self.transport_maps.as_ref() else {
            return;
        };
        let sample_rate = f64::from(self.sample_rate);
        let (time_sig_num, time_sig_denom) = maps.time_signature.at(frame);
        self.transport.tempo = maps.tempo.tempo_at(frame);
        self.transport.time_sig_num = time_sig_num;
        self.transport.time_sig_denom = time_sig_denom;
        self.transport.song_pos_seconds = frame as f64 / sample_rate;
        self.transport.song_pos_beats = maps.tempo.beats_at(frame, sample_rate);
    }

    /// How many of `remaining` frames the playhead can render before it
    /// reaches the loop end.
    ///
    /// A stopped transport never wraps: the playhead stands still, so the
    /// whole callback is one span. Neither does a playhead already at or past
    /// the loop end — playing out of a region rather than being yanked back
    /// into it is what a locate past the loop end means in every DAW that
    /// allows one.
    fn frames_until_loop_end(&self, block_start: u64, remaining: usize) -> usize {
        if !self.transport.is_playing {
            return remaining;
        }
        let Some(end) = self.loop_region.active_end() else {
            return remaining;
        };
        if block_start >= end {
            return remaining;
        }
        ((end - block_start) as usize).min(remaining)
    }

    /// Move the playhead past a rendered span, closing the loop seam when the
    /// span ended on it.
    ///
    /// The wrap is not a locate. `TimelineGraph::seek` drops every queued
    /// automation write stamped at or after its target, which on a wrap would
    /// be the entire region — so the second pass round a loop would run with
    /// the automation the first pass consumed *and* the automation it had not
    /// reached yet both gone. Leaving the queue alone is strictly better: a
    /// write the first pass never reached is still stamped ahead of the
    /// playhead and lands again on the next pass. What the first pass did
    /// consume cannot be replayed from here — the graph holds a window, not a
    /// curve — so `loop_wraps` is published for the control thread that owns
    /// the curve to re-arm it.
    ///
    /// `next` is recorded with the seam because it is the one frame nothing can
    /// recover afterwards: the span just rendered walked every frame below it,
    /// while the published playhead is already back at the loop start by the
    /// time any snapshot is read.
    fn advance_playhead(&mut self, block_start: u64, span_frames: usize) {
        if !self.transport.is_playing {
            return;
        }
        let next = block_start.saturating_add(span_frames as u64);
        match self.loop_region.active_end() {
            Some(end) if block_start < end && next >= end => {
                self.playhead_frames = self.loop_region.start_frame;
                self.loop_wraps = self.loop_wraps.wrapping_add(1);
                self.last_wrap_frame = next;
            }
            _ => self.playhead_frames = next,
        }
    }

    /// Render the timeline stages of one callback, split at the loop seam.
    ///
    /// Returns the spans the callback was split into, so the stages that run
    /// *after* the master insert chain can be applied against the timeline
    /// frames each span actually occupies rather than against the callback's
    /// first frame.
    ///
    /// The final span is never split, whatever the loop region says. That is
    /// what makes this walk total — it always consumes the rest of the
    /// callback — without depending on [`crate::transport_map::MIN_LOOP_FRAMES`]
    /// being enforced anywhere else.
    fn render_timeline_spans(
        &mut self,
        frames: usize,
        left: &mut [f32],
        right: &mut [f32],
    ) -> ([TimelineSpan; MAX_TIMELINE_SPANS_PER_BLOCK], usize) {
        let mut spans = [TimelineSpan::default(); MAX_TIMELINE_SPANS_PER_BLOCK];
        let mut count = 0;
        let mut offset = 0;

        while offset < frames {
            let block_start = self.playhead_frames;
            let remaining = frames - offset;
            let span_frames = if count + 1 == MAX_TIMELINE_SPANS_PER_BLOCK {
                remaining
            } else {
                self.frames_until_loop_end(block_start, remaining)
            };

            self.refresh_transport_at(block_start);
            self.apply_due_device_params(block_start, span_frames);
            self.render_timeline(
                block_start,
                span_frames,
                &mut left[offset..offset + span_frames],
                &mut right[offset..offset + span_frames],
            );

            spans[count] = TimelineSpan {
                block_start,
                offset,
                frames: span_frames,
            };
            count += 1;
            offset += span_frames;
            self.advance_playhead(block_start, span_frames);
        }

        (spans, count)
    }

    /// Process a block of audio (called by the device's render callback,
    /// `RenderFn` in `crate::device`).
    ///
    /// The order is the strip's: the timeline renders tracks, sends, buses and
    /// the master sum; the master insert chain runs over that sum; the master
    /// fader is applied last. The playhead advances by exactly the frames
    /// rendered, and only while the transport is playing, which is what makes
    /// a clip start and a parameter stamp address a position rather than a
    /// callback.
    ///
    /// A loop seam inside the callback splits the timeline stages — the ones
    /// addressed in timeline frames — at the frame the region ends on, so the
    /// seam lands on its sample rather than on the next block boundary. The
    /// master insert chain is not split: it is a fixed device chain over the
    /// summed mix, addressed by nothing on the timeline, and it already runs
    /// unchanged across a stopped transport.
    #[inline]
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        let frames = num_samples
            .min(left.len())
            .min(right.len())
            .min(MAX_CALLBACK_FRAMES);

        let (spans, span_count) = self.render_timeline_spans(frames, left, right);

        // The master list carries insertion order explicitly. It is independent
        // of the effect table's swap-remove slots, so a teardown cannot change
        // the order in which surviving master inserts process.
        #[cfg(test)]
        let mut master_visits = 0;
        let mut master = self.master_work.head;
        while master != 0 {
            let slot = master as usize - 1;
            master = self.master_work.links[slot].next;
            #[cfg(test)]
            {
                master_visits += 1;
            }
            let effect = &mut self.effects[slot];
            // A bridged plugin is driven by `process_audio_bridges` above, from
            // real worklet audio. This standalone chain runs over zeroed
            // scratch, so processing a bridged plugin here would push phantom
            // silence through a stateful plugin (corrupting its tails, envelope
            // followers and delay lines) and emit its output on a second,
            // uncontrolled path straight into the device's output buffer.
            //
            // `pending_midi` is deliberately left untouched here: ownership of
            // clearing it belongs entirely to `process_audio_bridges`, which
            // already ran earlier in this same callback and already decided
            // whether to clear (a block was processed) or not (the input ring
            // was empty this cycle, or the effect is bypassed). Clearing again
            // here would wipe out exactly the events `process_audio_bridges`
            // just chose to keep for the next cycle, undoing that fix within
            // the same callback. Accumulation while bypassed or unfed is
            // bounded by the fixed 128-slot buffer itself — `try_push` refuses
            // once full and records `scheduler_event_buffer_overflows` — so
            // leaving it alone is a deliberate, observable tradeoff, not an
            // unbounded leak.
            if self.bridge_index.lookup(effect.id).is_some() {
                continue;
            }

            // Only an effect no track claims belongs on the master insert
            // chain. One on a track chain already ran over that track's signal
            // in `render_timeline`, which owns clearing its MIDI exactly as
            // this loop does.
            if effect.placement != EffectPlacement::MasterChain {
                continue;
            }

            if effect.bypassed {
                effect.pending_midi.clear();
                continue;
            }

            effect.probability_evaluator.process_midi_with_diagnostics(
                &mut effect.pending_midi,
                &self.transport,
                self.sample_rate,
                num_samples,
                &mut self.midi_rt_diagnostics,
            );

            // Apply the mutable user MIDI FX chain only after authored probability.
            for fx in effect.midi_fx.iter_mut() {
                fx.process_midi_with_diagnostics(
                    &mut effect.pending_midi,
                    &self.transport,
                    self.sample_rate,
                    num_samples,
                    &mut self.midi_rt_diagnostics,
                );
            }

            match &mut effect.instance {
                PluginCore::Knead(engine) => {
                    engine.process_block(left, right);
                }
                PluginCore::Native(plugin) => {
                    if effect.pending_midi.is_empty() {
                        plugin.process_audio(left, right, num_samples);
                    } else {
                        plugin.process_with_events(
                            left,
                            right,
                            num_samples,
                            effect.pending_midi.as_slice(),
                            &self.transport,
                        );
                        effect.pending_midi.clear();
                    }
                }
            }
        }

        // The master list intentionally contains only master members. Detached
        // effects still need their unbridged MIDI discarded, but following the
        // compact pending set keeps that cleanup proportional to queued events
        // rather than the table's capacity. Bridged effects stay untouched:
        // their bridge owns the unfed/bypassed retention decision.
        self.remove_empty_pending_midi_work();
        let mut pending_index = 0;
        while pending_index < self.pending_midi_work.slots.len() {
            let slot = self.pending_midi_work.slots[pending_index];
            #[cfg(test)]
            {
                self.rt_work.pending_midi_work_visits += 1;
            }
            let effect = &mut self.effects[slot];
            let bridged = self.bridge_index.lookup(effect.id).is_some();
            if effect.runs_nowhere(bridged) {
                effect.pending_midi.clear();
                self.pending_midi_work.remove(slot);
            } else {
                pending_index += 1;
            }
        }
        #[cfg(test)]
        {
            self.rt_work.master_table_visits += master_visits;
        }

        // The master fader is the last stage of the strip and is stamped in
        // timeline frames, so it follows the split the timeline stages made:
        // applied once over the whole callback, a ramp would glide through the
        // seam as if the loop had never closed.
        for span in &spans[..span_count] {
            self.timeline.apply_master_gain(
                span.block_start,
                span.frames,
                &mut left[span.offset..span.offset + span.frames],
                &mut right[span.offset..span.offset + span.frames],
            );
        }
    }
}

/// Runs one track's device chain over that track's signal.
///
/// The effects stay in the scheduler's id-indexed table alongside their
/// bridges and their MIDI state, so the graph borrows them for the length of
/// one render rather than owning them — and resolves each chain entry by id
/// in O(1), because this runs once per device per callback and a table scan
/// per entry was the cost the derived capacity made deadline-fatal.
struct TrackDeviceChain<'a> {
    effects: &'a mut Vec<ActiveEffect>,
    effect_index: &'a IdSlotIndex,
    audio_bridges: &'a [PluginAudioBridge],
    bridge_index: &'a IdSlotIndex,
    midi_rt_diagnostics: &'a mut ActiveMidiRtDiagnostics,
    transport: TransportState,
    sample_rate: f32,
    /// Whether the app is still monitoring its own Web Audio graph, read as a
    /// plain flag rather than looked up: it decides which of the two paths owns
    /// a bridged plugin this block, once per device per callback.
    monitor_shadowed: bool,
}

impl DeviceChain for TrackDeviceChain<'_> {
    fn run_device(&mut self, effect_id: usize, left: &mut [f32], right: &mut [f32], frames: usize) {
        // While the monitor is shadowed the app is what the user hears, and a
        // bridged plugin is driven from the app's own audio in
        // `process_audio_bridges`. Running it here as well would push the
        // strip's signal through the same stateful instance on a second path.
        // Once the monitor is audible this chain owns the instance instead, and
        // the bridge returns its blocks untouched.
        if self.monitor_shadowed && self.bridge_index.lookup(effect_id).is_some() {
            return;
        }

        let Some(slot) = self.effect_index.lookup(effect_id) else {
            return;
        };
        let Some(effect) = self.effects.get_mut(slot) else {
            return;
        };

        if effect.bypassed {
            // Same contract as the master chain: a bypassed device passes its
            // signal through untouched and discards MIDI queued while bypassed
            // rather than banking it into a burst of stale note-ons.
            effect.pending_midi.clear();
            return;
        }

        effect.probability_evaluator.process_midi_with_diagnostics(
            &mut effect.pending_midi,
            &self.transport,
            self.sample_rate,
            frames,
            self.midi_rt_diagnostics,
        );
        for fx in effect.midi_fx.iter_mut() {
            fx.process_midi_with_diagnostics(
                &mut effect.pending_midi,
                &self.transport,
                self.sample_rate,
                frames,
                self.midi_rt_diagnostics,
            );
        }

        match &mut effect.instance {
            PluginCore::Knead(engine) => {
                engine.process_block(left, right);
            }
            PluginCore::Native(plugin) => {
                if effect.pending_midi.is_empty() {
                    plugin.process_audio(left, right, frames);
                } else {
                    plugin.process_with_events(
                        left,
                        right,
                        frames,
                        effect.pending_midi.as_slice(),
                        &self.transport,
                    );
                    effect.pending_midi.clear();
                }
            }
        }
    }
}

impl Drop for AudioScheduler {
    fn drop(&mut self) {
        // Drop runs control-side (`StreamWithReclaimerShutdown`), never in
        // the audio callback, so this reserve may allocate: a ring swap can
        // have grown the live ring past the boot capacity `shutdown_commands`
        // was preallocated with, and the drain below must hold a full ring.
        let live_ring_capacity = self
            .command_rx
            .as_ref()
            .expect("command consumer")
            .buffer()
            .capacity();
        self.shutdown_commands.reserve(live_ring_capacity);
        while let Ok(command) = self.command_rx.as_mut().expect("command consumer").pop() {
            self.shutdown_commands.push(command);
        }
        let command_rx = self.command_rx.take().expect("command consumer");
        let command_rx = self.retain_command_consumer.then_some(command_rx);
        let retired = RetiredGraphObjects::shutdown(
            self.pending_retirement.take(),
            std::mem::take(&mut self.effects),
            std::mem::take(&mut self.audio_bridges),
            std::mem::replace(&mut self.timeline, TimelineGraph::vacated()),
            std::mem::take(&mut self.shutdown_commands),
            command_rx,
        );
        if let Err(PushError::Full(retired)) = self.retired_tx.push(retired) {
            debug_assert!(false, "reserved shutdown retirement slot was unavailable");
            std::mem::forget(retired);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::midi_fx::{MIDI_EVENT_BUFFER_CAPACITY, MIDI_FX_CHAIN_CAPACITY};
    use crate::timeline::DeviceKind;
    use rtrb::RingBuffer;
    use std::any::Any;
    use std::sync::{
        atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering},
        mpsc, Arc,
    };
    use std::thread;

    struct FakeNativePlugin {
        value: f32,
    }

    struct MidiRecordingPlugin {
        received_event_count: Arc<AtomicUsize>,
        received_channel_sum: Arc<AtomicUsize>,
    }

    struct DropTrackingPlugin {
        dropped_tx: mpsc::Sender<thread::ThreadId>,
        panic_on_drop: bool,
    }

    struct AffinePlugin {
        factor: f32,
        offset: f32,
    }

    fn drop_tracking_plugin(
        dropped_tx: &mpsc::Sender<thread::ThreadId>,
        panic_on_drop: bool,
    ) -> Box<dyn NativePlugin> {
        Box::new(DropTrackingPlugin {
            dropped_tx: dropped_tx.clone(),
            panic_on_drop,
        })
    }

    fn push_drop_tracking_plugin(
        command_tx: &mut rtrb::Producer<GraphCommand>,
        id: usize,
        dropped_tx: &mpsc::Sender<thread::ThreadId>,
        panic_on_drop: bool,
    ) {
        let plugin = drop_tracking_plugin(dropped_tx, panic_on_drop);
        assert!(command_tx.push(GraphCommand::AddPlugin(id, plugin)).is_ok());
    }

    impl Drop for DropTrackingPlugin {
        fn drop(&mut self) {
            self.dropped_tx
                .send(thread::current().id())
                .expect("drop observer should remain connected");
            if self.panic_on_drop {
                panic!("plugin destructor panic");
            }
        }
    }

    impl NativePlugin for DropTrackingPlugin {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

        fn name(&self) -> &str {
            "drop-tracking-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    impl NativePlugin for FakeNativePlugin {
        fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
            for index in 0..num_samples {
                left[index] = self.value;
                right[index] = self.value;
            }
        }

        fn name(&self) -> &str {
            "fake-native-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    impl NativePlugin for AffinePlugin {
        fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
            for sample in 0..num_samples {
                left[sample] = left[sample] * self.factor + self.offset;
                right[sample] = right[sample] * self.factor + self.offset;
            }
        }

        fn name(&self) -> &str {
            "affine-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    impl NativePlugin for MidiRecordingPlugin {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

        fn process_with_events(
            &mut self,
            _left: &mut [f32],
            _right: &mut [f32],
            _num_samples: usize,
            midi_events: &[MidiNoteEvent],
            _transport: &TransportState,
        ) {
            self.received_event_count
                .fetch_add(midi_events.len(), Ordering::Relaxed);
            let channel_sum = midi_events
                .iter()
                .map(|event| event.channel as usize)
                .sum::<usize>();
            self.received_channel_sum
                .fetch_add(channel_sum, Ordering::Relaxed);
        }

        fn name(&self) -> &str {
            "midi-recording-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// Records the velocities that reach a device, so a MIDI FX chain's
    /// rewriting is observable without touching the effect's own state.
    struct VelocityRecordingPlugin {
        received_velocity_sum: Arc<AtomicUsize>,
    }

    impl NativePlugin for VelocityRecordingPlugin {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

        fn process_with_events(
            &mut self,
            _left: &mut [f32],
            _right: &mut [f32],
            _num_samples: usize,
            midi_events: &[MidiNoteEvent],
            _transport: &TransportState,
        ) {
            let velocity_sum = midi_events
                .iter()
                .map(|event| event.velocity as usize)
                .sum::<usize>();
            self.received_velocity_sum
                .fetch_add(velocity_sum, Ordering::Relaxed);
        }

        fn name(&self) -> &str {
            "velocity-recording-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    fn create_scheduler() -> (
        rtrb::Producer<GraphCommand>,
        AudioScheduler,
        rtrb::Consumer<RetiredGraphObjects>,
    ) {
        let (command_tx, command_rx) = RingBuffer::new(16);
        let (retired_tx, retired_rx) = RingBuffer::new(16);
        let scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
        (command_tx, scheduler, retired_rx)
    }

    #[test]
    fn id_slot_index_deletion_prunes_shared_radix_paths_without_losing_survivors() {
        let mut index = IdSlotIndex::reserved(256);
        let shared_prefix = usize::MAX << 8;
        let ids: Vec<_> = (0..128).map(|suffix| shared_prefix | suffix).collect();
        for (slot, id) in ids.iter().copied().enumerate() {
            assert!(index.insert(id, slot + 1_000));
        }
        let allocated = index.nodes.len();

        for ordinal in (0..64).step_by(2) {
            assert_eq!(index.delete(ids[ordinal]), Some(ordinal + 1_000));
        }
        for ordinal in 64..128 {
            assert_eq!(index.delete(ids[ordinal]), Some(ordinal + 1_000));
        }
        assert!(
            index.last_delete_steps <= 2 * usize::BITS as usize,
            "deletion must stay within the fixed radix walk; observed {} steps",
            index.last_delete_steps
        );

        for (ordinal, id) in ids.iter().copied().enumerate() {
            let expected = if (ordinal < 64 && ordinal % 2 == 0) || ordinal >= 64 {
                None
            } else {
                Some(ordinal + 1_000)
            };
            assert_eq!(
                index.lookup(id),
                expected,
                "shared-prefix id {id:#x} must retain its own mapping across churn"
            );
        }

        // Refill a fully removed shared-prefix branch. This would grow the node
        // store if deletion left dead paths behind; it also makes every
        // surviving mapping contend with reused radix nodes.
        for ordinal in 64..128 {
            assert!(index.insert(ids[ordinal], ordinal + 1_000));
        }
        assert_eq!(
            index.nodes.len(),
            allocated,
            "pruned shared-prefix paths must be reused instead of growing under churn"
        );
        for (ordinal, id) in ids.into_iter().enumerate() {
            let expected = if ordinal < 64 && ordinal % 2 == 0 {
                None
            } else {
                Some(ordinal + 1_000)
            };
            assert_eq!(
                index.lookup(id),
                expected,
                "removed ids must stay absent and every survivor must retain its original slot"
            );
        }
    }

    #[test]
    fn sparse_process_block_visits_only_active_parameter_and_master_work() {
        let population = 1_024;
        let (mut command_tx, command_rx) = RingBuffer::new(population + 8);
        let (retired_tx, _retired_rx) = RingBuffer::new(population + 8);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
        for id in 0..population {
            command_tx
                .push(GraphCommand::AddPlugin(
                    id,
                    Box::new(FakeNativePlugin { value: 0.0 }),
                ))
                .unwrap();
        }
        scheduler.update_graph();
        for id in 0..population {
            scheduler.place_effect(id, EffectPlacement::Detached);
        }

        scheduler.reset_rt_work_counters();
        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);

        assert_eq!(
            scheduler.rt_work_counters(),
            RtWorkCounters::default(),
            "an idle table must not become callback work"
        );
    }

    #[test]
    fn sparse_device_parameter_work_visits_only_the_queued_effect_and_releases_its_slot() {
        let population = 1_024;
        let (mut command_tx, command_rx) = RingBuffer::new(population + 8);
        let (retired_tx, _retired_rx) = RingBuffer::new(population + 8);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
        command_tx
            .push(GraphCommand::AddEffect(0, knead_instance()))
            .unwrap();
        for id in 1..population {
            command_tx
                .push(GraphCommand::AddPlugin(
                    id,
                    Box::new(FakeNativePlugin { value: 0.0 }),
                ))
                .unwrap();
        }
        scheduler.update_graph();
        for id in 1..population {
            scheduler.place_effect(id, EffectPlacement::Detached);
        }
        command_tx
            .push(GraphCommand::AutomateDeviceParam {
                effect_id: 0,
                param: DeviceParamTarget::Builtin(DeviceParam::ShiftSemitones),
                value: 7.0,
                at_frame: 0,
            })
            .unwrap();
        scheduler.update_graph();

        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.reset_rt_work_counters();
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(
            scheduler.rt_work_counters(),
            RtWorkCounters {
                parameter_table_visits: 1,
                master_table_visits: 1,
                pending_midi_work_visits: 0,
            }
        );

        scheduler.reset_rt_work_counters();
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(
            scheduler.rt_work_counters(),
            RtWorkCounters {
                parameter_table_visits: 0,
                master_table_visits: 1,
                pending_midi_work_visits: 0,
            },
            "an empty parameter queue must leave the compact work set"
        );
    }

    #[test]
    fn sparse_pending_midi_cleanup_visits_only_its_work_set() {
        let population = 1_024;
        let (mut command_tx, command_rx) = RingBuffer::new(population + 8);
        let (retired_tx, _retired_rx) = RingBuffer::new(population + 8);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
        for id in 0..population {
            command_tx
                .push(GraphCommand::AddPlugin(
                    id,
                    Box::new(FakeNativePlugin { value: 0.0 }),
                ))
                .unwrap();
        }
        scheduler.update_graph();
        for id in 0..population {
            scheduler.place_effect(id, EffectPlacement::Detached);
        }
        command_tx
            .push(GraphCommand::SendMidiNote(
                population - 1,
                MidiNoteEvent {
                    note: 60,
                    velocity: 100,
                    channel: 0,
                    is_note_on: true,
                    probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                    project_probability_seed: 0,
                    clip_id_hash: 0,
                    event_id_hash: 0,
                    absolute_occurrence_index: 0,
                },
            ))
            .unwrap();
        scheduler.update_graph();

        scheduler.reset_rt_work_counters();
        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);

        assert_eq!(
            scheduler.rt_work_counters(),
            RtWorkCounters {
                pending_midi_work_visits: 2,
                ..RtWorkCounters::default()
            },
            "one pending detached event needs one empty check and one cleanup visit, never a table walk"
        );
        assert!(scheduler.effects[population - 1].pending_midi.is_empty());
        assert_eq!(scheduler.pending_midi_work.positions[population - 1], 0);
    }

    #[test]
    fn master_work_preserves_explicit_order_across_place_release_bridge_remove_and_slot_move() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(20);
        for (id, plugin) in [
            (
                10,
                Box::new(AffinePlugin {
                    factor: 2.0,
                    offset: 1.0,
                }) as Box<dyn NativePlugin>,
            ),
            (
                30,
                Box::new(AffinePlugin {
                    factor: 5.0,
                    offset: 3.0,
                }) as Box<dyn NativePlugin>,
            ),
        ] {
            command_tx
                .push(GraphCommand::AddPlugin(id, plugin))
                .unwrap();
        }
        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                20,
                Box::new(AffinePlugin {
                    factor: 11.0,
                    offset: 7.0,
                }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        let mut left = [1.0; 1];
        let mut right = [1.0; 1];
        scheduler.process_block(&mut left, &mut right, 1);
        assert_eq!(left, [18.0]);

        scheduler.place_effect(10, EffectPlacement::Track(1));
        scheduler.release_effect(10, EffectPlacement::Track(1));
        left[0] = 1.0;
        right[0] = 1.0;
        scheduler.process_block(&mut left, &mut right, 1);
        assert_eq!(
            left,
            [17.0],
            "release appends after existing master members"
        );

        command_tx
            .push(GraphCommand::RemovePluginWithBridge(30))
            .unwrap();
        scheduler.update_graph();
        left[0] = 1.0;
        right[0] = 1.0;
        scheduler.process_block(&mut left, &mut right, 1);
        assert_eq!(
            left,
            [3.0],
            "swap-moving id 10 must preserve its list position"
        );

        command_tx
            .push(GraphCommand::RemovePluginWithBridge(20))
            .unwrap();
        scheduler.update_graph();
        left[0] = 1.0;
        right[0] = 1.0;
        scheduler.process_block(&mut left, &mut right, 1);
        assert_eq!(
            left,
            [3.0],
            "removing a bridged member must not disturb id 10"
        );
        assert_eq!(
            scheduler.master_work.head, 1,
            "the remaining master member is id 10"
        );

        command_tx
            .push(GraphCommand::AddPlugin(
                40,
                Box::new(AffinePlugin {
                    factor: 7.0,
                    offset: 4.0,
                }),
            ))
            .unwrap();
        scheduler.update_graph();
        left[0] = 1.0;
        right[0] = 1.0;
        scheduler.process_block(&mut left, &mut right, 1);
        assert_eq!(left, [25.0], "id 40 is the tail after id 10");

        // Remove the tail itself, then render the complete surviving chain.
        // Adding another effect must reuse that vacated table and link slot
        // without leaving a stale tail endpoint behind.
        command_tx
            .push(GraphCommand::RemovePluginWithBridge(40))
            .unwrap();
        scheduler.update_graph();
        left[0] = 1.0;
        right[0] = 1.0;
        scheduler.process_block(&mut left, &mut right, 1);
        assert_eq!(left, [3.0], "only id 10 survives the tail removal");
        assert_eq!(scheduler.master_work.head, 1);
        assert_eq!(scheduler.master_work.tail, 1);
        assert_eq!(scheduler.master_work.links[0].next, 0);

        command_tx
            .push(GraphCommand::AddPlugin(
                50,
                Box::new(AffinePlugin {
                    factor: 4.0,
                    offset: 2.0,
                }),
            ))
            .unwrap();
        scheduler.update_graph();
        left[0] = 1.0;
        right[0] = 1.0;
        scheduler.process_block(&mut left, &mut right, 1);
        assert_eq!(left, [14.0], "the reused tail slot appends after id 10");
        assert_eq!(scheduler.master_work.head, 1);
        assert_eq!(scheduler.master_work.tail, 2);
        assert_eq!(scheduler.master_work.links[0].previous, 0);
        assert_eq!(scheduler.master_work.links[0].next, 2);
        assert!(scheduler.master_work.links[0].member);
        assert_eq!(scheduler.master_work.links[1].previous, 1);
        assert_eq!(scheduler.master_work.links[1].next, 0);
        assert!(scheduler.master_work.links[1].member);
    }

    fn reclaim_on_background_thread(retired: RetiredGraphObjects) -> thread::ThreadId {
        thread::spawn(move || {
            let thread_id = thread::current().id();
            drop(retired);
            thread_id
        })
        .join()
        .unwrap()
    }

    #[test]
    fn add_plugin_with_bridge_registers_plugin_and_bridge_atomically() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(42);

        assert!(command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .is_ok());
        scheduler.update_graph();

        assert_eq!(scheduler.effects.len(), 1);
        assert_eq!(scheduler.audio_bridges.len(), 1);
        assert_eq!(scheduler.effects[0].id, 42);
        assert_eq!(scheduler.audio_bridges[0].plugin_id, 42);

        // The standalone chain must leave a bridged plugin alone. It runs over
        // zeroed scratch, so processing the plugin here would both corrupt its
        // internal state with phantom silence and write its output into the
        // device's output buffer on a path nothing controls.
        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(left, [0.0; 4]);
        assert_eq!(right, [0.0; 4]);
    }

    #[test]
    fn a_bridged_plugin_processes_only_the_audio_that_arrived_over_its_bridge() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(42);

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        // Real worklet audio arrives over the bridge and is processed.
        assert!(handle.push_input(&[0.0; 4], &[0.0; 4]));
        scheduler.process_audio_bridges(512);
        let processed = handle.pop_output().expect("the bridged block");
        assert_eq!(processed.frames, 4);
        assert_eq!(&processed.left[..4], &[0.25; 4]);

        // A standalone callback in the same cycle must not run the plugin a
        // second time over its silent scratch.
        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(left, [0.0; 4]);

        // And an unbridged plugin still runs on the standalone chain, so the
        // guard is scoped to bridged instances rather than disabling the path.
        command_tx
            .push(GraphCommand::AddPlugin(
                7,
                Box::new(FakeNativePlugin { value: 0.5 }),
            ))
            .unwrap();
        scheduler.update_graph();
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(left, [0.5; 4]);
    }

    #[test]
    fn bridged_plugin_midi_survives_a_callback_that_finds_the_input_ring_empty() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(42);
        let received_event_count = Arc::new(AtomicUsize::new(0));
        let received_channel_sum = Arc::new(AtomicUsize::new(0));

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(MidiRecordingPlugin {
                    received_event_count: Arc::clone(&received_event_count),
                    received_channel_sum,
                }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        command_tx
            .push(GraphCommand::SendMidiNote(
                42,
                MidiNoteEvent {
                    note: 60,
                    velocity: 100,
                    channel: 0,
                    is_note_on: true,
                    probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                    project_probability_seed: 0,
                    clip_id_hash: 0,
                    event_id_hash: 0,
                    absolute_occurrence_index: 0,
                },
            ))
            .unwrap();
        scheduler.update_graph();

        let mut left = [0.0; 4];
        let mut right = [0.0; 4];

        // Drive both calls in sequence, the way audio_thread.rs's render
        // callback does every cycle: process_audio_bridges() first, then
        // process_block() over the standalone chain's zeroed scratch. The
        // render callback beats the worklet's input push here — the bridge's
        // input ring is empty, so drain_process's closure never runs this
        // cycle — and process_block must not wipe the note that
        // process_audio_bridges deliberately left queued for next cycle.
        scheduler.process_audio_bridges(512);
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(received_event_count.load(Ordering::Relaxed), 0);

        // A later callback: the worklet's audio has now arrived. The note
        // queued on the earlier, empty-ring cycle must still be delivered —
        // an unconditional clear in either process_audio_bridges or
        // process_block would have discarded it forever on the first cycle.
        assert!(handle.push_input(&[0.0; 4], &[0.0; 4]));
        scheduler.process_audio_bridges(512);
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(received_event_count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn a_bypassed_bridged_effect_discards_midi_queued_while_bypassed() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(42);
        let received_event_count = Arc::new(AtomicUsize::new(0));
        let received_channel_sum = Arc::new(AtomicUsize::new(0));

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(MidiRecordingPlugin {
                    received_event_count: Arc::clone(&received_event_count),
                    received_channel_sum,
                }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        command_tx.push(GraphCommand::SetBypass(42, true)).unwrap();
        scheduler.update_graph();

        let mut left = [0.0; 4];
        let mut right = [0.0; 4];

        // Queue MIDI across several callbacks while bypassed. A bypassed
        // effect should discard incoming MIDI, not accumulate it toward the
        // 128-slot ceiling and flush it all the instant it is un-bypassed.
        for note in 60..=65 {
            command_tx
                .push(GraphCommand::SendMidiNote(
                    42,
                    MidiNoteEvent {
                        note,
                        velocity: 100,
                        channel: 0,
                        is_note_on: true,
                        probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                        project_probability_seed: 0,
                        clip_id_hash: 0,
                        event_id_hash: 0,
                        absolute_occurrence_index: 0,
                    },
                ))
                .unwrap();
            scheduler.update_graph();
            assert!(handle.push_input(&[0.0; 4], &[0.0; 4]));
            scheduler.process_audio_bridges(512);
            scheduler.process_block(&mut left, &mut right, 4);
        }

        // Un-bypass and drive a fresh callback: no stale burst of the notes
        // queued during bypass should reach the plugin.
        command_tx.push(GraphCommand::SetBypass(42, false)).unwrap();
        scheduler.update_graph();
        assert!(handle.push_input(&[0.0; 4], &[0.0; 4]));
        scheduler.process_audio_bridges(512);
        scheduler.process_block(&mut left, &mut right, 4);

        assert_eq!(received_event_count.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn one_callback_processes_every_block_the_app_queued_since_the_last_one() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(42);

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        // The device buffer spans several render quanta — a 512-frame render
        // callback at 48 kHz covers four 128-frame worklet quanta — so four
        // blocks are already waiting when the callback runs. Taking one per
        // callback leaves the rest to fill the ring, after which the app's
        // pushes are refused for good and the plugin hears a fraction of its
        // input.
        for _ in 0..4 {
            assert!(handle.push_input(&[0.1; 128], &[0.1; 128]));
        }

        scheduler.process_audio_bridges(512);

        let mut returned = 0;
        while let Some(block) = handle.pop_output() {
            assert_eq!(block.frames, 128);
            assert_eq!(block.left[0], 0.25);
            returned += 1;
        }
        assert_eq!(returned, 4, "a block left in the ring is lost audio");
    }

    #[test]
    fn a_burst_of_blocks_delivers_each_queued_note_to_the_plugin_once() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(42);
        let received_event_count = Arc::new(AtomicUsize::new(0));
        let received_channel_sum = Arc::new(AtomicUsize::new(0));

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(MidiRecordingPlugin {
                    received_event_count: Arc::clone(&received_event_count),
                    received_channel_sum,
                }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        command_tx
            .push(GraphCommand::SendMidiNote(
                42,
                MidiNoteEvent {
                    note: 60,
                    velocity: 100,
                    channel: 0,
                    is_note_on: true,
                    probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                    project_probability_seed: 0,
                    clip_id_hash: 0,
                    event_id_hash: 0,
                    absolute_occurrence_index: 0,
                },
            ))
            .unwrap();
        scheduler.update_graph();

        for _ in 0..3 {
            assert!(handle.push_input(&[0.0; 128], &[0.0; 128]));
        }
        scheduler.process_audio_bridges(512);

        // The MIDI queue belongs to the callback, not to the block. Running
        // the chain once per drained block would hand the plugin the same
        // note-on three times — three stacked voices from one key press.
        assert_eq!(received_event_count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn blocks_on_a_bridge_with_no_plugin_are_returned_and_counted() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let (bridge, mut handle) = crate::audio_bridge::create_audio_bridge(77);

        command_tx
            .push(GraphCommand::RegisterAudioBridge(bridge))
            .unwrap();
        scheduler.update_graph();
        assert!(scheduler.effects.is_empty());

        // Fill the input ring the way a running worklet does.
        let mut pushed = 0;
        while handle.push_input(&[0.4; 64], &[0.4; 64]) {
            pushed += 1;
        }
        assert!(pushed > 0);

        // Successive callbacks, each spending its own budget.
        let mut returned = 0;
        for _ in 0..pushed {
            scheduler.process_audio_bridges(512);
            while let Some(block) = handle.pop_output() {
                assert_eq!(block.left[0], 0.4, "an unprocessed block must be intact");
                returned += 1;
            }
        }

        // A ring filled to capacity is deeper than the device period needs, so
        // the oldest blocks are shed to bring the round trip back to its
        // target. Every block is accounted for: returned or shed, none left
        // sitting in a ring that never drains again.
        let snapshot = scheduler.midi_rt_diagnostics.snapshot();
        assert_eq!(
            returned as u64 + snapshot.bridge_backlog_blocks_shed,
            pushed as u64
        );
        assert_eq!(snapshot.unmatched_bridge_blocks, pushed as u64);

        // The ring keeps moving. Skipping the bridge left it full forever, so
        // every later push was refused and the app never processed again.
        assert!(handle.push_input(&[0.4; 64], &[0.4; 64]));
    }

    #[test]
    fn remove_plugin_with_bridge_removes_plugin_and_bridge_atomically() {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(42);

        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                42,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        command_tx
            .push(GraphCommand::RemovePluginWithBridge(42))
            .unwrap();
        scheduler.update_graph();

        assert!(scheduler.effects.is_empty());
        assert!(scheduler.audio_bridges.is_empty());
        let retired = retired_rx.pop().expect("plugin and bridge retirement");
        assert!(retired.effect.is_some());
        assert!(retired.audio_bridge.is_some());
    }

    #[test]
    fn saturated_queue_reserves_shutdown_retirement_off_the_callback_thread() {
        let (mut command_tx, command_rx) = RingBuffer::new(16);
        let (retired_tx, mut retired_rx) = RingBuffer::new(2);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
        scheduler.retain_command_consumer = true;
        let (dropped_tx, dropped_rx) = mpsc::channel();
        for id in [41, 42, 43] {
            push_drop_tracking_plugin(&mut command_tx, id, &dropped_tx, id != 41);
        }
        scheduler.update_graph();
        command_tx
            .push(GraphCommand::AddMidiFx(
                43,
                MidiFxKind::VelocityScaler.build(),
            ))
            .unwrap();
        command_tx.push(GraphCommand::RemoveMidiFx(43, 0)).unwrap();
        for id in [41, 42] {
            command_tx.push(GraphCommand::RemovePlugin(id)).unwrap();
        }
        push_drop_tracking_plugin(&mut command_tx, 44, &dropped_tx, false);
        scheduler.update_graph();
        drop(scheduler);
        push_drop_tracking_plugin(&mut command_tx, 45, &dropped_tx, false);
        drop(command_tx);
        assert_eq!(dropped_rx.try_recv(), Err(mpsc::TryRecvError::Empty));
        let live_reclaimer =
            reclaim_on_background_thread(retired_rx.pop().expect("live retirement"));
        let shutdown_reclaimer =
            reclaim_on_background_thread(retired_rx.pop().expect("shutdown retirement"));
        for _ in 0..5 {
            let thread_id = dropped_rx.recv().unwrap();
            assert!(thread_id == live_reclaimer || thread_id == shutdown_reclaimer);
        }
    }

    #[test]
    fn add_plugin_with_a_colliding_id_is_rejected_and_does_not_duplicate_the_effect() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, knead_instance()))
            .unwrap();
        scheduler.update_graph();
        assert_eq!(scheduler.effects.len(), 1);

        let (dropped_tx, _dropped_rx) = mpsc::channel();
        push_drop_tracking_plugin(&mut command_tx, 7, &dropped_tx, false);
        scheduler.update_graph();

        // The colliding plugin must not create a second entry sharing id 7 —
        // that second entry is exactly what would let SetParam/SetBypass/
        // SendMidiNote misroute to whichever one `.find` reaches first.
        assert_eq!(scheduler.effects.len(), 1);
        match &scheduler.effects[0].instance {
            PluginCore::Knead(_) => {}
            PluginCore::Native(_) => panic!("existing effect must not be displaced"),
        }
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .effect_id_collisions,
            1
        );
    }

    #[test]
    fn add_plugin_with_bridge_with_a_colliding_id_retires_both_without_inserting() {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, knead_instance()))
            .unwrap();
        scheduler.update_graph();

        let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(7);
        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                7,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(scheduler.effects.len(), 1);
        assert!(scheduler.audio_bridges.is_empty());
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .effect_id_collisions,
            1
        );
        let retired = retired_rx.pop().expect("the rejected plugin and bridge");
        assert!(retired.effect.is_some());
        assert!(retired.audio_bridge.is_some());
    }

    #[test]
    fn set_param_maps_addresses_onto_the_knead_engine_and_counts_unrouted_native_targets() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, knead_instance()))
            .unwrap();
        scheduler.update_graph();

        command_tx
            .push(GraphCommand::SetParam(7, DeviceParam::ShiftSemitones, 3.0))
            .unwrap();
        scheduler.update_graph();

        match &scheduler.effects[0].instance {
            PluginCore::Knead(engine) => assert_eq!(engine.shift_semitones, 3.0),
            PluginCore::Native(_) => panic!("expected the knead effect"),
        }

        // A name with no address is refused control-side now, so the one
        // unmapped `SetParam` left on the audio thread is the one aimed at a
        // native plugin, whose parameters this command never routed.
        command_tx
            .push(GraphCommand::AddPlugin(
                8,
                Box::new(FakeNativePlugin { value: 0.25 }),
            ))
            .unwrap();
        scheduler.update_graph();
        command_tx
            .push(GraphCommand::SetParam(8, DeviceParam::ShiftSemitones, 1.0))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .unmapped_set_param_calls,
            1
        );
    }

    /// `SetMidiFxParam` must reach the instance the chain actually holds at
    /// the addressed slot and apply the value it carries: a velocity scaler
    /// at scale 0 zeroes every note-on, so a recorded sum of 0 discriminates
    /// the applied write from a dropped one (the untouched default keeps 100).
    #[test]
    fn set_midi_fx_param_applies_the_addressed_value_to_the_chained_instance() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let received_velocity_sum = Arc::new(AtomicUsize::new(0));
        command_tx
            .push(GraphCommand::AddPlugin(
                7,
                Box::new(VelocityRecordingPlugin {
                    received_velocity_sum: Arc::clone(&received_velocity_sum),
                }),
            ))
            .unwrap();
        command_tx
            .push(GraphCommand::AddMidiFx(
                7,
                MidiFxKind::VelocityScaler.build(),
            ))
            .unwrap();
        command_tx
            .push(GraphCommand::SetMidiFxParam(
                7,
                0,
                MidiFxParam::VelocityScale,
                0.0,
            ))
            .unwrap();
        command_tx
            .push(GraphCommand::SendMidiNote(
                7,
                MidiNoteEvent {
                    note: 60,
                    velocity: 100,
                    channel: 0,
                    is_note_on: true,
                    probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                    project_probability_seed: 0,
                    clip_id_hash: 0,
                    event_id_hash: 0,
                    absolute_occurrence_index: 0,
                },
            ))
            .unwrap();
        scheduler.update_graph();

        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);

        assert_eq!(received_velocity_sum.load(Ordering::Relaxed), 0);
    }

    /// `SetParam` and `SetMidiFxParam` carry no owning payload onto the audio
    /// thread: consuming them there would free it inside the deadline (ADR
    /// 0020). Reading the parameter *out of a shared reference to the
    /// command* is what pins that — moving out of a `&` compiles only while
    /// the payload is `Copy`, so reverting either parameter to a `String`
    /// fails this test at compile time rather than leaving a `Copy` bound on
    /// some other type still satisfied.
    ///
    /// `AddEffect`, `AddDetachedEffect`, `AddPlugin`, `AddPluginWithBridge`
    /// and `AddMidiFx` used to share this pin as `Copy` type addresses or
    /// kind tags; they now carry the built instance itself, pre-built
    /// control-side, and their contract — the drain installs it into a
    /// reserved slot or retires it, never constructs or frees it — is pinned
    /// at run time by the allocation guards in [`mod apply_alloc_guards`],
    /// which fire on a constructor call as reliably as on a `String` drop.
    ///
    /// This is a property of these commands, not of the whole vocabulary:
    /// every remaining owning payload in the vocabulary is a pre-built
    /// instance or graph object on that same install-or-retire contract,
    /// pinned by the same guards.
    #[test]
    fn the_set_param_payload_is_a_copy_address() {
        fn copied_param(command: &GraphCommand) -> Option<DeviceParam> {
            match command {
                GraphCommand::SetParam(_, param, _) => Some(*param),
                _ => None,
            }
        }

        fn copied_midi_fx_param(command: &GraphCommand) -> Option<MidiFxParam> {
            match command {
                GraphCommand::SetMidiFxParam(_, _, param, _) => Some(*param),
                _ => None,
            }
        }

        assert_eq!(
            copied_param(&GraphCommand::SetParam(1, DeviceParam::ShiftSemitones, 0.0)),
            Some(DeviceParam::ShiftSemitones)
        );
        assert_eq!(
            copied_midi_fx_param(&GraphCommand::SetMidiFxParam(
                1,
                0,
                MidiFxParam::RateBeats,
                0.0
            )),
            Some(MidiFxParam::RateBeats)
        );
    }

    /// `from_name` is the inverse of `name`, so the named boundary and the
    /// addressed command cannot drift into meaning different things. Every
    /// address is pinned, not a sample, so a new parameter that forgets the
    /// pair fails here rather than at the wire.
    #[test]
    fn midi_fx_param_from_name_is_the_inverse_of_name() {
        for param in [
            MidiFxParam::RateBeats,
            MidiFxParam::ArpMode,
            MidiFxParam::OctaveRange,
            MidiFxParam::MinVelocity,
            MidiFxParam::MaxVelocity,
            MidiFxParam::VelocityScale,
            MidiFxParam::VelocityOffset,
        ] {
            assert_eq!(MidiFxParam::from_name(param.name()), Some(param));
        }
        assert_eq!(MidiFxParam::from_name("not-a-midi-fx-param"), None);
    }

    /// `from_name` is the inverse of `name`, so the named boundary and the
    /// addressed command cannot drift into meaning different things.
    #[test]
    fn builtin_effect_type_from_name_is_the_inverse_of_name() {
        assert_eq!(
            BuiltinEffectType::from_name(BuiltinEffectType::Knead.name()),
            Some(BuiltinEffectType::Knead)
        );
        assert_eq!(BuiltinEffectType::from_name("not-a-real-effect"), None);
    }

    /// The capacity is a sum of the populations that fill the table, not a
    /// number: raise a timeline limit or a reserve and the table must follow,
    /// or a project the product admits silently overflows the ceiling again —
    /// the flat 128 this replaced was exactly that drift. The arithmetic is
    /// written raw here, not through the budget constant, so editing a
    /// timeline limit without resizing the table fails this test rather than
    /// the user's session.
    #[test]
    fn the_effect_table_capacity_is_the_sum_of_the_populations_it_holds() {
        assert_eq!(
            TIMELINE_CHAIN_SLOT_BUDGET,
            MAX_TIMELINE_TRACKS * MAX_TRACK_DEVICES + MAX_TIMELINE_BUSES * MAX_BUS_DEVICES
        );
        assert_eq!(
            EFFECT_TABLE_CAPACITY,
            MAX_TIMELINE_TRACKS * MAX_TRACK_DEVICES
                + MAX_TIMELINE_BUSES * MAX_BUS_DEVICES
                + HOSTED_PLUGIN_RESERVE
                + CRUMBS_CAPTURE_RESERVE
        );
        // Bridges exist only for the two non-timeline registrations, so the
        // bridge table covers exactly their reserves: no less, or the ledger
        // would admit registrations the bridge table silently refuses on the
        // callback; no more, or the bridge table would stop mirroring the
        // populations it actually holds.
        assert_eq!(
            AUDIO_BRIDGE_TABLE_CAPACITY,
            HOSTED_PLUGIN_RESERVE + CRUMBS_CAPTURE_RESERVE
        );
    }

    /// The id index and the table must agree through a swap-remove: the entry
    /// that moved from the tail into the vacated slot resolves at its new
    /// slot, and the removed id resolves nowhere — not through a stale bucket
    /// and not after a later registration reuses the id. This pins the
    /// structure an O(n) per-lookup regression would have to break: every
    /// assertion reads the index and the table together.
    #[test]
    fn an_id_index_lookup_resolves_the_swapped_entry_at_its_new_slot() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        for id in [10, 11, 12] {
            command_tx
                .push(GraphCommand::AddPlugin(
                    id,
                    Box::new(FakeNativePlugin { value: 0.0 }),
                ))
                .unwrap();
            scheduler.update_graph();
        }
        assert_eq!(scheduler.effect_index.lookup(10), Some(0));
        assert_eq!(scheduler.effect_index.lookup(11), Some(1));
        assert_eq!(scheduler.effect_index.lookup(12), Some(2));

        // Remove the middle entry: the tail swaps into slot 1.
        command_tx
            .push(GraphCommand::RemovePluginWithBridge(11))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(scheduler.effects.len(), 2);
        assert_eq!(scheduler.effects[1].id, 12, "the tail swaps into the hole");
        assert_eq!(
            scheduler.effect_index.lookup(12),
            Some(1),
            "the moved entry must resolve at its new slot"
        );
        assert_eq!(scheduler.effect_index.lookup(10), Some(0));
        assert_eq!(
            scheduler.effect_index.lookup(11),
            None,
            "a removed id must not resolve through the shifted cluster"
        );

        // A later registration under the removed id is a fresh mapping at the
        // table's tail, not a resurrection of the stale bucket.
        command_tx
            .push(GraphCommand::AddPlugin(
                11,
                Box::new(FakeNativePlugin { value: 0.0 }),
            ))
            .unwrap();
        scheduler.update_graph();
        assert_eq!(scheduler.effect_index.lookup(11), Some(2));
        assert_eq!(scheduler.effects[2].id, 11);
    }

    /// The bridge index follows the same swap-remove law for the bridge
    /// table, and a bridged registration removes both of its entries
    /// together: a removed plugin id resolves in neither table, and the
    /// bridge that swapped into the vacated slot resolves at that slot.
    #[test]
    fn the_bridge_index_resolves_the_swapped_bridge_at_its_new_slot() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        for id in [30, 31] {
            let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(id);
            command_tx
                .push(GraphCommand::AddPluginWithBridge(
                    id,
                    Box::new(FakeNativePlugin { value: 0.0 }),
                    bridge,
                ))
                .unwrap();
            scheduler.update_graph();
        }
        assert_eq!(scheduler.bridge_index.lookup(30), Some(0));
        assert_eq!(scheduler.bridge_index.lookup(31), Some(1));

        command_tx
            .push(GraphCommand::RemovePluginWithBridge(30))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(scheduler.audio_bridges.len(), 1);
        assert_eq!(scheduler.audio_bridges[0].plugin_id, 31);
        assert_eq!(scheduler.bridge_index.lookup(31), Some(0));
        assert_eq!(scheduler.bridge_index.lookup(30), None);
        assert_eq!(scheduler.effect_index.lookup(30), None);
        assert_eq!(scheduler.effect_index.lookup(31), Some(0));
    }

    #[test]
    fn radix_deletion_prunes_and_reuses_nodes_without_stale_aliases() {
        let mut index = IdSlotIndex::reserved(4);
        for (slot, id) in [0usize, usize::MAX, 1 << (usize::BITS - 1), 17]
            .into_iter()
            .enumerate()
        {
            assert!(index.insert(id, slot));
        }
        let allocated = index.nodes.len();
        assert_eq!(index.delete(usize::MAX), Some(1));
        assert_eq!(index.lookup(usize::MAX), None);
        assert_eq!(index.lookup(0), Some(0));
        assert_eq!(index.lookup(1 << (usize::BITS - 1)), Some(2));
        assert!(index.insert(usize::MAX - 1, 1));
        assert_eq!(index.lookup(usize::MAX - 1), Some(1));
        assert_eq!(index.nodes.len(), allocated, "pruned nodes must be reused");
        assert!(
            !index.insert(usize::MAX - 1, 3),
            "a duplicate cannot alias a slot"
        );
        assert_eq!(
            index.lookup(usize::MAX - 1),
            Some(1),
            "a rejected duplicate must leave the original slot mapping intact"
        );
    }

    #[test]
    fn the_id_index_survives_remove_and_re_register_churn() {
        fn add(
            command_tx: &mut rtrb::Producer<GraphCommand>,
            scheduler: &mut AudioScheduler,
            id: usize,
        ) {
            command_tx
                .push(GraphCommand::AddPlugin(
                    id,
                    Box::new(FakeNativePlugin { value: 0.0 }),
                ))
                .unwrap();
            scheduler.update_graph();
        }

        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        for id in 0..512 {
            add(&mut command_tx, &mut scheduler, id + 5_000);
        }
        // The retirement ring is small and each removal hands one object off,
        // so the reclaimer role is played inline: drain after every step, as
        // the real reclaimer does, or retirement backpressure suspends the
        // drain and the command ring fills.
        for id in (0..512).step_by(2) {
            command_tx
                .push(GraphCommand::RemovePluginWithBridge(id + 5_000))
                .unwrap();
            scheduler.update_graph();
            while retired_rx.pop().is_ok() {}
        }
        for id in 0..256 {
            add(&mut command_tx, &mut scheduler, id + 7_000);
        }

        assert_eq!(scheduler.effects.len(), 512);

        for id in 0..512 {
            let mapped = scheduler.effect_index.lookup(id + 5_000);
            if id % 2 == 0 {
                assert_eq!(
                    mapped,
                    None,
                    "removed id {} must stay unmapped after the churn",
                    id + 5_000
                );
            } else {
                let slot = mapped.expect("a live id must resolve after the churn");
                assert_eq!(
                    scheduler.effects[slot].id,
                    id + 5_000,
                    "a live id must resolve at the slot holding it"
                );
            }
        }
        for id in 0..256 {
            let slot = scheduler
                .effect_index
                .lookup(id + 7_000)
                .expect("a re-registered id must resolve");
            assert_eq!(scheduler.effects[slot].id, id + 7_000);
        }
        // Table and index agree slot for slot, and each live id names exactly
        // one slot.
        let mut seen = std::collections::HashSet::new();
        for (slot, effect) in scheduler.effects.iter().enumerate() {
            assert_eq!(scheduler.effect_index.lookup(effect.id), Some(slot));
            assert!(
                seen.insert(effect.id),
                "each live id must occupy exactly one slot"
            );
        }
    }

    /// A built-in add past the table's capacity is refused rather than grown,
    /// and the instance the command carried is handed off rather than freed
    /// on the callback: it exists from the control-side push, so a refusal
    /// must retire it exactly as `AddPlugin`'s refusal retires its carried
    /// plugin.
    #[test]
    fn an_effect_past_the_tables_capacity_is_refused_rather_than_grown() {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        // The fill is `AddPlugin` boxes — one small allocation each — so a
        // capacity-sized fill stays cheap; a `KneadEngine` per slot would be
        // half a megabyte of buffers times thousands of slots. The ceiling
        // counts registrations, not kinds.
        for id in 0..EFFECT_TABLE_CAPACITY {
            command_tx
                .push(GraphCommand::AddPlugin(
                    id,
                    Box::new(FakeNativePlugin { value: 0.0 }),
                ))
                .unwrap();
            scheduler.update_graph();
        }
        assert_eq!(scheduler.effects.len(), EFFECT_TABLE_CAPACITY);

        // Growing the vector would have called the allocator inside the audio
        // deadline. A counted refusal is the alternative, not an option.
        command_tx
            .push(GraphCommand::AddEffect(
                EFFECT_TABLE_CAPACITY,
                knead_instance(),
            ))
            .unwrap();
        scheduler.update_graph();
        assert_eq!(scheduler.effects.len(), EFFECT_TABLE_CAPACITY);
        assert_eq!(scheduler.effects.capacity(), EFFECT_TABLE_CAPACITY);
        assert_eq!(scheduler.timeline().diagnostics().capacity_refusals, 1);
        // The refused built-in arrived carrying its instance, so the refusal
        // hands that instance off — dropping it here would free the engine's
        // buffers on the callback (ADR 0020).
        assert!(retired_rx
            .pop()
            .expect("the refused built-in must hand its carried instance off")
            .effect
            .is_some());

        // The same full table refuses a native plugin on its own arm.
        command_tx
            .push(GraphCommand::AddPlugin(
                EFFECT_TABLE_CAPACITY + 1,
                Box::new(FakeNativePlugin { value: 0.25 }),
            ))
            .unwrap();
        scheduler.update_graph();
        assert_eq!(scheduler.effects.len(), EFFECT_TABLE_CAPACITY);
        assert_eq!(scheduler.timeline().diagnostics().capacity_refusals, 2);
        assert!(retired_rx
            .pop()
            .expect("the refused plugin must be handed off")
            .effect
            .is_some());
    }

    /// The id-collision refusal retires the carried instance on the same
    /// contract as the capacity refusal: a built-in crosses the ring already
    /// built, so refusing it leaves an instance in hand whose buffers must
    /// be freed off the callback, and whose engine must not displace the
    /// live effect holding the id.
    #[test]
    fn a_colliding_builtin_add_retires_its_carried_instance_without_inserting() {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, knead_instance()))
            .unwrap();
        scheduler.update_graph();
        assert_eq!(scheduler.effects.len(), 1);

        command_tx
            .push(GraphCommand::AddDetachedEffect(7, knead_instance()))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(scheduler.effects.len(), 1);
        assert_eq!(
            scheduler.effects[0].placement,
            EffectPlacement::MasterChain,
            "the living effect must not be displaced by the refused one"
        );
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .effect_id_collisions,
            1
        );
        assert!(retired_rx
            .pop()
            .expect("the refused built-in must hand its carried instance off")
            .effect
            .is_some());
    }

    /// A full effect table refuses `AddPluginWithBridge` on its own, with the
    /// bridge table empty — the ordinary state, since `AddEffect`/`AddPlugin`
    /// fill `effects` without touching `audio_bridges`. Without the effect
    /// disjunct of that guard the push reallocates the effect table on the
    /// callback, moving every live `ActiveEffect` with it.
    #[test]
    fn a_plugin_with_bridge_is_refused_when_only_the_effect_table_is_full() {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        // Cheap fill, as above: the arm under test sees only a full table.
        for id in 0..EFFECT_TABLE_CAPACITY {
            command_tx
                .push(GraphCommand::AddPlugin(
                    id,
                    Box::new(FakeNativePlugin { value: 0.0 }),
                ))
                .unwrap();
            scheduler.update_graph();
        }
        assert_eq!(scheduler.effects.len(), EFFECT_TABLE_CAPACITY);
        assert!(scheduler.audio_bridges.is_empty());

        let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(EFFECT_TABLE_CAPACITY);
        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                EFFECT_TABLE_CAPACITY,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(scheduler.effects.len(), EFFECT_TABLE_CAPACITY);
        assert_eq!(scheduler.effects.capacity(), EFFECT_TABLE_CAPACITY);
        assert!(scheduler.audio_bridges.is_empty());
        assert_eq!(scheduler.timeline().diagnostics().capacity_refusals, 1);
        let retired = retired_rx
            .pop()
            .expect("the refused plugin and its bridge must be handed off");
        assert!(retired.effect.is_some());
        assert!(retired.audio_bridge.is_some());
    }

    #[test]
    fn a_bridge_past_the_tables_capacity_refuses_the_whole_registration() {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        for id in 0..AUDIO_BRIDGE_TABLE_CAPACITY {
            let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(id);
            command_tx
                .push(GraphCommand::RegisterAudioBridge(bridge))
                .unwrap();
            scheduler.update_graph();
        }
        assert_eq!(scheduler.audio_bridges.len(), AUDIO_BRIDGE_TABLE_CAPACITY);

        // A full bridge table refuses the plugin with its bridge: installing
        // the plugin alone would leave a dry-fallback instance nothing drives,
        // and growing the vector would allocate inside the audio deadline.
        let (bridge, _handle) =
            crate::audio_bridge::create_audio_bridge(AUDIO_BRIDGE_TABLE_CAPACITY);
        command_tx
            .push(GraphCommand::AddPluginWithBridge(
                AUDIO_BRIDGE_TABLE_CAPACITY,
                Box::new(FakeNativePlugin { value: 0.25 }),
                bridge,
            ))
            .unwrap();
        scheduler.update_graph();
        assert!(scheduler.effects.is_empty());
        assert_eq!(scheduler.audio_bridges.len(), AUDIO_BRIDGE_TABLE_CAPACITY);
        assert_eq!(
            scheduler.audio_bridges.capacity(),
            AUDIO_BRIDGE_TABLE_CAPACITY
        );
        assert_eq!(scheduler.timeline().diagnostics().capacity_refusals, 1);
        let retired = retired_rx
            .pop()
            .expect("the refused plugin and bridge must be handed off");
        assert!(retired.effect.is_some());
        assert!(retired.audio_bridge.is_some());

        // A standalone bridge past the same ceiling is refused on its own arm.
        let (bridge, _handle) =
            crate::audio_bridge::create_audio_bridge(AUDIO_BRIDGE_TABLE_CAPACITY + 1);
        command_tx
            .push(GraphCommand::RegisterAudioBridge(bridge))
            .unwrap();
        scheduler.update_graph();
        assert_eq!(scheduler.audio_bridges.len(), AUDIO_BRIDGE_TABLE_CAPACITY);
        assert_eq!(scheduler.timeline().diagnostics().capacity_refusals, 2);
        assert!(retired_rx
            .pop()
            .expect("the refused bridge must be handed off")
            .audio_bridge
            .is_some());
    }

    #[test]
    fn probability_zero_is_gated_before_arpeggiation() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let received_event_count = Arc::new(AtomicUsize::new(0));
        let received_channel_sum = Arc::new(AtomicUsize::new(0));

        command_tx
            .push(GraphCommand::AddPlugin(
                7,
                Box::new(MidiRecordingPlugin {
                    received_event_count: Arc::clone(&received_event_count),
                    received_channel_sum,
                }),
            ))
            .unwrap();
        command_tx
            .push(GraphCommand::AddMidiFx(7, MidiFxKind::Arpeggiator.build()))
            .unwrap();
        // The arp is silent while the transport is stopped; without this the
        // zero-event assertion would hold even with the probability gate broken.
        command_tx
            .push(GraphCommand::SetTransport(TransportState {
                is_playing: true,
                ..TransportState::default()
            }))
            .unwrap();
        command_tx
            .push(GraphCommand::SendMidiNote(
                7,
                MidiNoteEvent {
                    note: 60,
                    velocity: 100,
                    channel: 0,
                    is_note_on: true,
                    probability_cutoff: 0,
                    project_probability_seed: 0,
                    clip_id_hash: 0,
                    event_id_hash: 0,
                    absolute_occurrence_index: 0,
                },
            ))
            .unwrap();

        scheduler.update_graph();

        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);

        assert_eq!(received_event_count.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn probability_evaluator_is_inline_and_uses_no_dynamic_chain_capacity() {
        let effect = ActiveEffect::new(
            7,
            PluginCore::Native(Box::new(FakeNativePlugin { value: 0.25 })),
        );

        assert_eq!(std::mem::size_of::<ProbabilityEvaluator>(), 0);
        // The chain is an inline slot table, not a heap-backed one: its whole
        // capacity stands in the effect entry itself, so an empty chain holds
        // no allocation for an install to grow into on the callback.
        assert_eq!(effect.midi_fx.len(), 0);
        assert_eq!(
            std::mem::size_of::<MidiFxChain>(),
            MIDI_FX_CHAIN_CAPACITY * std::mem::size_of::<Option<Box<dyn MidiFx>>>()
        );
    }

    #[test]
    fn send_midi_note_drops_newest_events_after_fixed_capacity() {
        let midi_capacity = MIDI_EVENT_BUFFER_CAPACITY;
        let (mut command_tx, command_rx) = RingBuffer::new(256);
        let (retired_tx, _retired_rx) = RingBuffer::new(256);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
        let received_event_count = Arc::new(AtomicUsize::new(0));
        let received_channel_sum = Arc::new(AtomicUsize::new(0));

        command_tx
            .push(GraphCommand::AddPlugin(
                7,
                Box::new(MidiRecordingPlugin {
                    received_event_count: Arc::clone(&received_event_count),
                    received_channel_sum: Arc::clone(&received_channel_sum),
                }),
            ))
            .unwrap();

        for channel in 0..=midi_capacity {
            command_tx
                .push(GraphCommand::SendMidiNote(
                    7,
                    MidiNoteEvent {
                        note: 60,
                        velocity: 100,
                        channel: channel as i16,
                        is_note_on: true,
                        probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                        project_probability_seed: 0,
                        clip_id_hash: 0,
                        event_id_hash: 0,
                        absolute_occurrence_index: 0,
                    },
                ))
                .unwrap();
        }

        scheduler.update_graph();

        assert_eq!(scheduler.effects[0].pending_midi.capacity(), midi_capacity);
        assert_eq!(scheduler.effects[0].pending_midi.len(), midi_capacity);

        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);

        assert_eq!(received_event_count.load(Ordering::Relaxed), midi_capacity);
        assert_eq!(
            received_channel_sum.load(Ordering::Relaxed),
            (midi_capacity - 1) * midi_capacity / 2
        );
        assert!(scheduler.effects[0].pending_midi.is_empty());
    }

    /// What reached a consumer's input tap, recorded without allocating so the
    /// same fake serves the delivery tests and the guard that runs
    /// `deliver_capture` under `assert_no_alloc`.
    #[derive(Default)]
    struct CaptureTap {
        blocks: AtomicUsize,
        served_blocks: AtomicUsize,
        frames: AtomicUsize,
        latency_frames: AtomicUsize,
        position_frames: AtomicU64,
        /// `f32::to_bits` of the first sample on each side: what tells audio
        /// that arrived from the silence an unserved block carries.
        first_left: AtomicU32,
        first_right: AtomicU32,
    }

    struct CaptureTapPlugin {
        tap: Arc<CaptureTap>,
    }

    impl NativePlugin for CaptureTapPlugin {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

        fn process_capture_input(&mut self, block: CaptureInputBlock<'_>) {
            self.tap.blocks.fetch_add(1, Ordering::Relaxed);
            if block.served {
                self.tap.served_blocks.fetch_add(1, Ordering::Relaxed);
            }
            self.tap.frames.store(block.frames, Ordering::Relaxed);
            self.tap
                .latency_frames
                .store(block.latency_frames, Ordering::Relaxed);
            self.tap
                .position_frames
                .store(block.position_frames, Ordering::Relaxed);
            self.tap
                .first_left
                .store(first_sample_bits(block.left), Ordering::Relaxed);
            self.tap
                .first_right
                .store(first_sample_bits(block.right), Ordering::Relaxed);
        }

        fn name(&self) -> &str {
            "capture-tap-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    const TAP_LATENCY_FRAMES: usize = 480;
    const TAP_POSITION_FRAMES: u64 = 9_600;
    const TAP_CONSUMER_ID: usize = 5;

    fn first_sample_bits(side: &[f32]) -> u32 {
        side.first().copied().unwrap_or(0.0).to_bits()
    }

    fn capture_tap_plugin(tap: &Arc<CaptureTap>) -> Box<dyn NativePlugin> {
        Box::new(CaptureTapPlugin {
            tap: Arc::clone(tap),
        })
    }

    fn capture_block<'a>(left: &'a [f32], right: &'a [f32], served: bool) -> CaptureInputBlock<'a> {
        CaptureInputBlock {
            left,
            right,
            frames: left.len(),
            served,
            latency_frames: TAP_LATENCY_FRAMES,
            position_frames: TAP_POSITION_FRAMES,
        }
    }

    #[test]
    fn the_capture_bus_refuses_a_full_table_and_an_id_it_already_holds() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();

        // The duplicate is refused with room to spare, so this observes the
        // duplicate rule rather than the ceiling standing in for it.
        command_tx
            .push(GraphCommand::RegisterCaptureConsumer(0))
            .unwrap();
        command_tx
            .push(GraphCommand::RegisterCaptureConsumer(0))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(scheduler.capture_consumers.len(), 1);
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .capture_consumer_refusals,
            1
        );

        // Fill the reserve, then ask for one past it.
        for id in 1..CRUMBS_CAPTURE_RESERVE {
            command_tx
                .push(GraphCommand::RegisterCaptureConsumer(id))
                .unwrap();
        }
        command_tx
            .push(GraphCommand::RegisterCaptureConsumer(
                CRUMBS_CAPTURE_RESERVE,
            ))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(scheduler.capture_consumers.len(), CRUMBS_CAPTURE_RESERVE);
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .capture_consumer_refusals,
            2
        );
        assert_eq!(
            scheduler.capture_consumers.capacity(),
            CRUMBS_CAPTURE_RESERVE,
            "the bus is reserved once and never grown on the callback"
        );

        // An id the bus never held frees nothing.
        command_tx
            .push(GraphCommand::UnregisterCaptureConsumer(9_999))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(scheduler.capture_consumers.len(), CRUMBS_CAPTURE_RESERVE);

        // The slot the refusal wanted comes back when its holder leaves.
        command_tx
            .push(GraphCommand::UnregisterCaptureConsumer(0))
            .unwrap();
        command_tx
            .push(GraphCommand::RegisterCaptureConsumer(
                CRUMBS_CAPTURE_RESERVE,
            ))
            .unwrap();
        scheduler.update_graph();

        assert!(!scheduler.capture_consumers.contains(&0));
        assert!(scheduler
            .capture_consumers
            .contains(&CRUMBS_CAPTURE_RESERVE));
        assert_eq!(scheduler.capture_consumers.len(), CRUMBS_CAPTURE_RESERVE);
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .capture_consumer_refusals,
            2
        );
    }

    #[test]
    fn a_registered_native_consumer_takes_the_capture_block_whole() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let tap = Arc::new(CaptureTap::default());
        // Registration ahead of the plugin: the bus admits an id the graph
        // does not hold yet, and the same drain answers it.
        command_tx
            .push(GraphCommand::RegisterCaptureConsumer(TAP_CONSUMER_ID))
            .unwrap();
        command_tx
            .push(GraphCommand::AddPlugin(
                TAP_CONSUMER_ID,
                capture_tap_plugin(&tap),
            ))
            .unwrap();
        scheduler.update_graph();

        let left = [0.25, 0.5, 0.75];
        let right = [-0.25, -0.5, -0.75];
        scheduler.deliver_capture(capture_block(&left, &right, true));

        assert_eq!(tap.blocks.load(Ordering::Relaxed), 1);
        assert_eq!(tap.served_blocks.load(Ordering::Relaxed), 1);
        assert_eq!(tap.frames.load(Ordering::Relaxed), left.len());
        assert_eq!(
            tap.latency_frames.load(Ordering::Relaxed),
            TAP_LATENCY_FRAMES
        );
        assert_eq!(
            tap.position_frames.load(Ordering::Relaxed),
            TAP_POSITION_FRAMES
        );
        assert_eq!(f32::from_bits(tap.first_left.load(Ordering::Relaxed)), 0.25);
        assert_eq!(
            f32::from_bits(tap.first_right.load(Ordering::Relaxed)),
            -0.25
        );

        let diagnostics = scheduler.midi_rt_diagnostics.snapshot();
        assert_eq!(diagnostics.capture_blocks_dropped, 0);
        assert_eq!(diagnostics.capture_input_underruns, 0);
    }

    #[test]
    fn an_unserved_capture_block_still_reaches_its_consumer_and_counts_one_underrun() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        let tap = Arc::new(CaptureTap::default());
        command_tx
            .push(GraphCommand::AddPlugin(
                TAP_CONSUMER_ID,
                capture_tap_plugin(&tap),
            ))
            .unwrap();
        command_tx
            .push(GraphCommand::RegisterCaptureConsumer(TAP_CONSUMER_ID))
            .unwrap();
        scheduler.update_graph();

        let silence = [0.0; 4];
        scheduler.deliver_capture(capture_block(&silence, &silence, false));

        // The consumer still hears the block: a recorder writes the gap it can
        // see rather than splicing the takes either side of it together.
        assert_eq!(tap.blocks.load(Ordering::Relaxed), 1);
        assert_eq!(tap.served_blocks.load(Ordering::Relaxed), 0);

        let diagnostics = scheduler.midi_rt_diagnostics.snapshot();
        assert_eq!(diagnostics.capture_input_underruns, 1);
        assert_eq!(diagnostics.capture_blocks_dropped, 0);
    }

    #[test]
    fn a_capture_consumer_that_resolves_to_no_native_instance_drops_the_block() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        // One id the graph does not hold, one held by a built-in device: a
        // built-in has no input tap, so neither takes the block.
        command_tx
            .push(GraphCommand::AddEffect(2, knead_instance()))
            .unwrap();
        command_tx
            .push(GraphCommand::RegisterCaptureConsumer(1))
            .unwrap();
        command_tx
            .push(GraphCommand::RegisterCaptureConsumer(2))
            .unwrap();
        scheduler.update_graph();

        let audio = [0.5; 4];
        scheduler.deliver_capture(capture_block(&audio, &audio, true));

        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .capture_blocks_dropped,
            1
        );
    }

    #[test]
    fn a_bus_with_no_consumer_counts_neither_a_drop_nor_an_underrun() {
        let (_command_tx, mut scheduler, _retired_rx) = create_scheduler();

        let silence = [0.0; 4];
        scheduler.deliver_capture(capture_block(&silence, &silence, false));

        // No consumer is not a fault: an engine with no recorder is the
        // ordinary case, and counting it would bury the faults that matter.
        let diagnostics = scheduler.midi_rt_diagnostics.snapshot();
        assert_eq!(diagnostics.capture_blocks_dropped, 0);
        assert_eq!(diagnostics.capture_input_underruns, 0);
    }

    /// Register a consumer, place it however `placement` says, and assert the
    /// bus is empty once `removal` has final-dropped it.
    fn assert_removal_prunes_the_capture_bus(placement: Vec<GraphCommand>, removal: GraphCommand) {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        let tap = Arc::new(CaptureTap::default());
        command_tx
            .push(GraphCommand::AddPlugin(
                TAP_CONSUMER_ID,
                capture_tap_plugin(&tap),
            ))
            .unwrap();
        command_tx
            .push(GraphCommand::RegisterCaptureConsumer(TAP_CONSUMER_ID))
            .unwrap();
        for command in placement {
            command_tx.push(command).unwrap();
        }
        scheduler.update_graph();

        let audio = [0.5; 4];
        scheduler.deliver_capture(capture_block(&audio, &audio, true));
        assert_eq!(tap.blocks.load(Ordering::Relaxed), 1);

        command_tx.push(removal).unwrap();
        scheduler.update_graph();
        while retired_rx.pop().is_ok() {}

        assert!(
            scheduler.capture_consumers.is_empty(),
            "a removed plugin's id left on the bus would drop every later block"
        );

        scheduler.deliver_capture(capture_block(&audio, &audio, true));

        assert_eq!(tap.blocks.load(Ordering::Relaxed), 1);
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .capture_blocks_dropped,
            0
        );
    }

    #[test]
    fn removing_a_plugin_takes_it_off_the_capture_bus() {
        assert_removal_prunes_the_capture_bus(
            Vec::new(),
            GraphCommand::RemovePlugin(TAP_CONSUMER_ID),
        );
    }

    #[test]
    fn removing_a_plugin_with_its_bridge_takes_it_off_the_capture_bus() {
        assert_removal_prunes_the_capture_bus(
            Vec::new(),
            GraphCommand::RemovePluginWithBridge(TAP_CONSUMER_ID),
        );
    }

    /// The bus admits an id before the graph holds it, so a registration whose
    /// `AddPlugin` never arrived is an ordinary state — and the removal that
    /// abandons it is the only thing that will ever clear it. Pruning behind
    /// the table lookup would strand that id, dropping a block per callback
    /// for the rest of the session.
    #[test]
    fn removing_an_id_the_effect_table_never_held_still_clears_the_capture_bus() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::RegisterCaptureConsumer(TAP_CONSUMER_ID))
            .unwrap();
        scheduler.update_graph();
        assert!(scheduler.capture_consumers.contains(&TAP_CONSUMER_ID));

        command_tx
            .push(GraphCommand::RemovePluginWithBridge(TAP_CONSUMER_ID))
            .unwrap();
        scheduler.update_graph();

        assert!(scheduler.capture_consumers.is_empty());
    }

    /// A consumer spliced onto a track chain leaves through the retired
    /// variant, not through a plugin removal — the same final drop, so the
    /// same prune has to cover it.
    #[test]
    fn retiring_a_track_device_takes_it_off_the_capture_bus() {
        assert_removal_prunes_the_capture_bus(
            vec![
                GraphCommand::AddTrack(TimelineTrack::new(1)),
                GraphCommand::InsertTrackDevice {
                    track_id: 1,
                    entry: ChainEntry {
                        effect_id: TAP_CONSUMER_ID,
                        kind: DeviceKind::Effect,
                    },
                    index: 0,
                },
            ],
            GraphCommand::RemoveTrackDeviceRetired {
                track_id: 1,
                effect_id: TAP_CONSUMER_ID,
            },
        );
    }

    #[test]
    fn retiring_a_bus_device_takes_it_off_the_capture_bus() {
        assert_removal_prunes_the_capture_bus(
            vec![
                GraphCommand::AddBus(TimelineBus::new(50)),
                GraphCommand::InsertBusDevice {
                    bus_id: 50,
                    entry: ChainEntry {
                        effect_id: TAP_CONSUMER_ID,
                        kind: DeviceKind::Effect,
                    },
                    index: 0,
                },
            ],
            GraphCommand::RemoveBusDeviceRetired {
                bus_id: 50,
                effect_id: TAP_CONSUMER_ID,
            },
        );
    }

    /// Allocation guards for the command drain the audio callback runs.
    ///
    /// `update_graph` is the callback's apply path, and ADR 0020 forbids it
    /// to allocate or free: the tables it pushes into are reserved at
    /// construction, every owning payload arrives already built, and every
    /// refusal hands its payload off over the retirement ring rather than
    /// dropping it. These guards install [`assert_no_alloc::AllocDisabler`]
    /// as the test binary's global allocator — it intercepts `alloc` and
    /// `dealloc` alike, so a constructor call and a destructor free on the
    /// drain both abort the process — and run the real drain inside
    /// `assert_no_alloc` while every legitimate allocation (building the
    /// instance, boxing the plugin, sizing the rings) stays outside it.
    ///
    /// The interceptor exists only in debug builds (`disable_release` is on
    /// by default, so in release `assert_no_alloc(f)` is literally `f()`),
    /// which is why the whole module is `#[cfg(debug_assertions)]`.
    ///
    /// The guards cover the built-in add arms (issue #2547: the apply used to
    /// construct `KneadEngine` — some twenty zero-filled heap allocations —
    /// on the callback), the already-repaired `AddPlugin`/`AddPluginWithBridge`
    /// arms, and the MIDI FX arms on the same law (issue #2548: `AddMidiFx`
    /// used to box the arpeggiator into a zero-capacity `Vec` on the callback
    /// and grow it there, and `SetMidiFxParam` used to drop a `String` name
    /// there).
    #[cfg(debug_assertions)]
    mod apply_alloc_guards {
        use assert_no_alloc::{assert_no_alloc, AllocDisabler};
        use rtrb::RingBuffer;

        use super::*;

        #[global_allocator]
        static ALLOCATOR: AllocDisabler = AllocDisabler;

        /// Every arm of the input bus, on the callback, under the guard:
        /// admission, refusal, delivery to a native consumer, the underrun
        /// count, the prune a removal performs, and the drop that follows when
        /// the ids left on the bus resolve to nothing.
        #[test]
        fn the_capture_bus_registers_delivers_and_prunes_without_allocating() {
            let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
            let tap = Arc::new(CaptureTap::default());
            command_tx
                .push(GraphCommand::AddPlugin(
                    TAP_CONSUMER_ID,
                    capture_tap_plugin(&tap),
                ))
                .unwrap();
            command_tx
                .push(GraphCommand::RegisterCaptureConsumer(TAP_CONSUMER_ID))
                .unwrap();
            // A second id the graph does not hold, so the drop arm runs once
            // the plugin leaves; a third the reserve refuses.
            command_tx
                .push(GraphCommand::RegisterCaptureConsumer(TAP_CONSUMER_ID + 1))
                .unwrap();
            command_tx
                .push(GraphCommand::RegisterCaptureConsumer(TAP_CONSUMER_ID + 2))
                .unwrap();
            let audio = [0.5; 8];
            let silence = [0.0; 8];

            assert_no_alloc(|| {
                scheduler.update_graph();
                scheduler.deliver_capture(capture_block(&audio, &audio, true));
                scheduler.deliver_capture(capture_block(&silence, &silence, false));
            });

            command_tx
                .push(GraphCommand::RemovePluginWithBridge(TAP_CONSUMER_ID))
                .unwrap();
            assert_no_alloc(|| {
                scheduler.update_graph();
                scheduler.deliver_capture(capture_block(&audio, &audio, true));
            });
            while retired_rx.pop().is_ok() {}

            let diagnostics = scheduler.midi_rt_diagnostics.snapshot();
            assert_eq!(tap.blocks.load(Ordering::Relaxed), 2);
            assert_eq!(diagnostics.capture_consumer_refusals, 1);
            assert_eq!(diagnostics.capture_input_underruns, 1);
            assert_eq!(diagnostics.capture_blocks_dropped, 1);
        }

        #[test]
        fn swap_removed_tail_relocates_both_work_sets_before_they_process_without_allocating() {
            let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
            let received_event_count = Arc::new(AtomicUsize::new(0));
            let received_channel_sum = Arc::new(AtomicUsize::new(0));
            command_tx
                .push(GraphCommand::AddEffect(1, knead_instance()))
                .unwrap();
            command_tx
                .push(GraphCommand::AddPlugin(
                    2,
                    Box::new(MidiRecordingPlugin {
                        received_event_count: Arc::clone(&received_event_count),
                        received_channel_sum: Arc::clone(&received_channel_sum),
                    }),
                ))
                .unwrap();
            scheduler.update_graph();
            command_tx
                .push(GraphCommand::AutomateDeviceParam {
                    effect_id: 2,
                    param: DeviceParamTarget::Builtin(DeviceParam::ShiftSemitones),
                    value: 3.0,
                    at_frame: 0,
                })
                .unwrap();
            command_tx
                .push(GraphCommand::SendMidiNote(
                    2,
                    MidiNoteEvent {
                        note: 60,
                        velocity: 100,
                        channel: 0,
                        is_note_on: true,
                        probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                        project_probability_seed: 0,
                        clip_id_hash: 0,
                        event_id_hash: 0,
                        absolute_occurrence_index: 0,
                    },
                ))
                .unwrap();
            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            // Remove the front while the tail is in both compact work sets.
            // Neither queue may be consumed before swap-remove relocates it.
            command_tx.push(GraphCommand::RemovePlugin(1)).unwrap();
            assert_no_alloc(|| {
                scheduler.update_graph();
            });
            assert_eq!(scheduler.effect_index.lookup(2), Some(0));
            assert_eq!(scheduler.effects[0].id, 2);
            assert_eq!(scheduler.parameter_work.positions[0], 1);
            assert_eq!(scheduler.pending_midi_work.positions[0], 1);
            assert_eq!(scheduler.parameter_work.positions[1], 0);
            assert_eq!(scheduler.pending_midi_work.positions[1], 0);

            let mut left = [0.0; 4];
            let mut right = [0.0; 4];
            assert_no_alloc(|| {
                scheduler.process_block(&mut left, &mut right, 4);
            });
            assert_eq!(received_event_count.load(Ordering::Relaxed), 1);
            assert_eq!(received_channel_sum.load(Ordering::Relaxed), 0);
            assert_eq!(
                scheduler
                    .midi_rt_diagnostics
                    .snapshot()
                    .unmapped_set_param_calls,
                1
            );
            assert_eq!(scheduler.parameter_work.positions[0], 0);
            assert_eq!(scheduler.pending_midi_work.positions[0], 0);
        }

        #[test]
        fn add_effect_and_add_detached_effect_install_the_carried_instance_without_allocating() {
            let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
            // Built and pushed control-side: these allocations are the ones
            // the issue moved off the callback.
            command_tx
                .push(GraphCommand::AddEffect(7, knead_instance()))
                .unwrap();
            command_tx
                .push(GraphCommand::AddDetachedEffect(8, knead_instance()))
                .unwrap();

            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            // The guarded drain did real work: both ids are live, each as the
            // Knead built-in at its own placement, and nothing was retired.
            assert_eq!(scheduler.effects.len(), 2);
            assert_eq!(scheduler.effects[0].id, 7);
            assert_eq!(scheduler.effects[0].placement, EffectPlacement::MasterChain);
            assert_eq!(scheduler.effects[1].id, 8);
            assert_eq!(scheduler.effects[1].placement, EffectPlacement::Detached);
            assert!(matches!(
                scheduler.effects[0].instance,
                PluginCore::Knead(_)
            ));
            assert!(matches!(
                scheduler.effects[1].instance,
                PluginCore::Knead(_)
            ));
        }

        #[test]
        fn a_refused_builtin_add_hands_its_carried_instance_off_without_allocating() {
            // Id collision: the instance exists from the control-side push,
            // so the refusal must retire it — dropping it on the apply would
            // free the engine's buffers inside the deadline.
            let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
            command_tx
                .push(GraphCommand::AddEffect(7, knead_instance()))
                .unwrap();
            scheduler.update_graph();
            command_tx
                .push(GraphCommand::AddEffect(7, knead_instance()))
                .unwrap();

            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            assert_eq!(
                scheduler.effects.len(),
                1,
                "the live effect must not be displaced by the refused one"
            );
            assert_eq!(
                scheduler
                    .midi_rt_diagnostics
                    .snapshot()
                    .effect_id_collisions,
                1
            );
            let retired = retired_rx
                .pop()
                .expect("the refused built-in must hand its carried instance off");
            assert!(retired.effect.is_some());
            drop(retired);

            // Capacity: a table filled outside the guard refuses one more
            // built-in inside it, retiring the carried instance. The filler
            // is `AddPlugin` so the fill itself stays cheap; what the table
            // holds is invisible to the ceiling being hit.
            let (mut command_tx, command_rx) = RingBuffer::new(EFFECT_TABLE_CAPACITY + 8);
            let (retired_tx, mut retired_rx) = RingBuffer::new(EFFECT_TABLE_CAPACITY + 8);
            let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
            for id in 0..EFFECT_TABLE_CAPACITY {
                command_tx
                    .push(GraphCommand::AddPlugin(
                        id,
                        Box::new(FakeNativePlugin { value: 0.0 }),
                    ))
                    .unwrap();
            }
            scheduler.update_graph();
            assert_eq!(scheduler.effects.len(), EFFECT_TABLE_CAPACITY);
            command_tx
                .push(GraphCommand::AddEffect(
                    EFFECT_TABLE_CAPACITY,
                    knead_instance(),
                ))
                .unwrap();

            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            assert_eq!(scheduler.effects.len(), EFFECT_TABLE_CAPACITY);
            assert_eq!(scheduler.timeline().diagnostics().capacity_refusals, 1);
            let retired = retired_rx
                .pop()
                .expect("the refused built-in must hand its carried instance off");
            assert!(retired.effect.is_some());
        }

        /// A strip teardown arrives as a fenced batch of removals applied in
        /// one callback, and removal is exactly where the table's size used
        /// to be the deadline: a compaction removal memmoved every inline
        /// `ActiveEffect` behind the vacated slot. The fill and the fence sit
        /// outside the guard (control-side pushes allocate their boxes); the
        /// guarded drain is the callback's work alone. Removal ids run
        /// front-to-back, the worst case for swap-remove churn — every
        /// removal moves the table's tail — and the guard proves that move is
        /// the only one: no allocation, and by construction no compaction.
        #[test]
        fn a_fenced_teardown_of_a_large_table_applies_without_allocating() {
            let (mut command_tx, command_rx) = RingBuffer::new(EFFECT_TABLE_CAPACITY + 8);
            let (retired_tx, mut retired_rx) = RingBuffer::new(EFFECT_TABLE_CAPACITY + 8);
            let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);

            let fill = 2_048;
            for id in 0..fill {
                command_tx
                    .push(GraphCommand::AddPlugin(
                        id,
                        Box::new(FakeNativePlugin { value: 0.0 }),
                    ))
                    .unwrap();
            }
            scheduler.update_graph();
            assert_eq!(scheduler.effects.len(), fill);

            let removals = 1_024;
            command_tx
                .push(GraphCommand::BeginBatch { commands: removals })
                .unwrap();
            for id in 0..removals {
                command_tx
                    .push(GraphCommand::RemovePluginWithBridge(id))
                    .unwrap();
            }

            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            // The teardown shrank the table by exactly the batch, and every
            // survivor still resolves through the index at the slot that
            // really holds it — the state a compaction would also have
            // produced, minus the memmove the guard just proved absent.
            assert_eq!(scheduler.effects.len(), fill - removals);
            for (slot, effect) in scheduler.effects.iter().enumerate() {
                assert_eq!(scheduler.effect_index.lookup(effect.id), Some(slot));
            }
            for id in 0..removals {
                assert_eq!(scheduler.effect_index.lookup(id), None);
            }

            // One retirement crossed the ring per removed effect.
            let mut retired_count = 0;
            while retired_rx.pop().is_ok() {
                retired_count += 1;
            }
            assert_eq!(retired_count, removals);
        }

        /// The transport maps and the loop seam are per-block work, so they
        /// are guarded on the render path rather than only on the apply path:
        /// installing a map must swap a box built control-side, and rendering
        /// across a seam must resolve the map and split the callback without
        /// touching the allocator. A map lookup that walked its segments, or a
        /// seam split that collected its spans, would fail here.
        #[test]
        fn transport_maps_and_the_loop_seam_render_without_allocating() {
            use crate::transport_map::{
                LoopRegion, TempoMap, TempoSegment, TimeSignatureMap, TransportMaps,
            };

            let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
            let maps = Box::new(TransportMaps {
                tempo: TempoMap::new(
                    &[
                        TempoSegment {
                            start_frame: 0,
                            beats_per_minute: 120.0,
                        },
                        TempoSegment {
                            start_frame: 600,
                            beats_per_minute: 240.0,
                        },
                    ],
                    48_000.0,
                )
                .expect("the guard's map is well formed"),
                time_signature: TimeSignatureMap::flat(4, 4).expect("4/4 is well formed"),
                sample_rate: 48_000.0,
            });
            command_tx
                .push(GraphCommand::SetTransportMaps(maps))
                .unwrap();
            command_tx
                .push(GraphCommand::SetLoopRegion(LoopRegion {
                    enabled: true,
                    start_frame: 0,
                    end_frame: 512,
                }))
                .unwrap();
            command_tx
                .push(GraphCommand::SetTransportPlayback {
                    is_playing: true,
                    song_pos_seconds: 0.0,
                })
                .unwrap();

            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            // Long enough to cross the seam twice and the tempo change once.
            let mut left = [0.0; 1_024];
            let mut right = [0.0; 1_024];
            assert_no_alloc(|| {
                scheduler.process_block(&mut left, &mut right, 1_024);
            });
            assert_eq!(scheduler.transport_position().loop_wraps, 2);

            // Replacing an installed pair frees nothing on the callback: the
            // box it displaces leaves over the retirement ring.
            let replacement = Box::new(TransportMaps {
                tempo: TempoMap::flat(90.0, 48_000.0).expect("a flat map is well formed"),
                time_signature: TimeSignatureMap::flat(3, 4).expect("3/4 is well formed"),
                sample_rate: 48_000.0,
            });
            command_tx
                .push(GraphCommand::SetTransportMaps(replacement))
                .unwrap();
            assert_no_alloc(|| {
                scheduler.update_graph();
            });
            assert!(retired_rx.pop().is_ok());
        }

        #[test]
        fn add_plugin_and_add_plugin_with_bridge_apply_without_allocating() {
            let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
            let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(42);
            command_tx
                .push(GraphCommand::AddPlugin(
                    41,
                    Box::new(FakeNativePlugin { value: 0.25 }),
                ))
                .unwrap();
            command_tx
                .push(GraphCommand::AddPluginWithBridge(
                    42,
                    Box::new(FakeNativePlugin { value: 0.25 }),
                    bridge,
                ))
                .unwrap();

            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            assert_eq!(scheduler.effects.len(), 2);
            assert_eq!(scheduler.audio_bridges.len(), 1);

            // The already-repaired arms stay guarded: a collision refusal
            // hands its carried plugin off allocation-free.
            command_tx
                .push(GraphCommand::AddPlugin(
                    41,
                    Box::new(FakeNativePlugin { value: 0.25 }),
                ))
                .unwrap();
            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            assert_eq!(
                scheduler.effects.len(),
                2,
                "the refused plugin must not insert a second entry"
            );
            assert_eq!(
                scheduler
                    .midi_rt_diagnostics
                    .snapshot()
                    .effect_id_collisions,
                1
            );
            let retired = retired_rx
                .pop()
                .expect("the refused plugin must be handed off");
            assert!(retired.effect.is_some());
        }

        /// The whole MIDI FX vocabulary applies without allocator contact:
        /// the add moves the control-side-built instance into a reserved
        /// slot, the param set carries a `Copy` address, and the removal
        /// hands its instance to the retirement ring instead of dropping it.
        #[test]
        fn midi_fx_adds_param_sets_and_removals_apply_without_allocating() {
            let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
            command_tx
                .push(GraphCommand::AddPlugin(
                    7,
                    Box::new(MidiRecordingPlugin {
                        received_event_count: Arc::new(AtomicUsize::new(0)),
                        received_channel_sum: Arc::new(AtomicUsize::new(0)),
                    }),
                ))
                .unwrap();
            // Built control-side: these boxes are the allocations the issue
            // moved off the callback, so they stay outside the guard.
            command_tx
                .push(GraphCommand::AddMidiFx(
                    7,
                    MidiFxKind::VelocityScaler.build(),
                ))
                .unwrap();
            command_tx
                .push(GraphCommand::AddMidiFx(7, MidiFxKind::Arpeggiator.build()))
                .unwrap();
            command_tx
                .push(GraphCommand::SetMidiFxParam(
                    7,
                    0,
                    MidiFxParam::VelocityScale,
                    0.5,
                ))
                .unwrap();
            command_tx.push(GraphCommand::RemoveMidiFx(7, 1)).unwrap();

            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            // The guarded drain did real work: one instance stayed installed
            // at its slot, the other left over the retirement ring.
            assert_eq!(scheduler.effects[0].midi_fx.len(), 1);
            let retired = retired_rx
                .pop()
                .expect("the removed instance must be handed off");
            assert!(retired.midi_fx.is_some());
        }

        /// Both ways an `AddMidiFx` can be refused arrive holding the carried
        /// instance, so each must hand it off rather than drop it — the box's
        /// free is exactly the deadline traffic the refusal exists to avoid.
        #[test]
        fn refused_midi_fx_adds_hand_the_carried_instance_off_without_allocating() {
            // Unknown effect id: the arm owns the box, and refusing by
            // dropping it would free it on the callback.
            let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
            command_tx
                .push(GraphCommand::AddMidiFx(
                    999,
                    MidiFxKind::Arpeggiator.build(),
                ))
                .unwrap();
            assert_no_alloc(|| {
                scheduler.update_graph();
            });
            assert!(scheduler.effects.is_empty());
            let retired = retired_rx
                .pop()
                .expect("the carried instance must be handed off");
            assert!(retired.midi_fx.is_some());

            // Full chain: every slot is filled outside the guard, so the one
            // inside it can only be refused — counted, and retired.
            command_tx
                .push(GraphCommand::AddPlugin(
                    7,
                    Box::new(FakeNativePlugin { value: 0.0 }),
                ))
                .unwrap();
            for _ in 0..MIDI_FX_CHAIN_CAPACITY {
                command_tx
                    .push(GraphCommand::AddMidiFx(
                        7,
                        MidiFxKind::VelocityScaler.build(),
                    ))
                    .unwrap();
            }
            scheduler.update_graph();
            command_tx
                .push(GraphCommand::AddMidiFx(7, MidiFxKind::Arpeggiator.build()))
                .unwrap();

            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            assert_eq!(scheduler.effects[0].midi_fx.len(), MIDI_FX_CHAIN_CAPACITY);
            assert_eq!(scheduler.timeline().diagnostics().capacity_refusals, 1);
            let retired = retired_rx
                .pop()
                .expect("the refused instance must be handed off");
            assert!(retired.midi_fx.is_some());
        }
    }
}

/// Timeline behaviour that only a rendered block can show: the command path,
/// the playhead, the scheduler's device table, the retirement channel and the
/// master chain. Timeline logic that stands on its own — ramp interpolation,
/// the parameter queues, clip trim math, the chain's own guards — is tested in
/// `timeline.rs` beside the code that defines it; the integration tests that
/// need the whole block pipeline live here deliberately.
#[cfg(test)]
mod timeline_tests {
    use super::*;
    use crate::timeline::{AutomationEvent, DeviceKind, RampShape, MAX_TIMELINE_TRACKS};
    use crate::transport_map::{TempoMap, TempoSegment, TimeSignatureMap, TimeSignatureSegment};
    use rtrb::RingBuffer;
    use std::any::Any;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    /// Stands in for a hosted plugin's parameter queue: it records every write
    /// the audio thread hands it, and answers the way the test needs — a plugin
    /// that took the write, or one that refused it.
    struct ParameterRecordingPlugin {
        queued: Arc<Mutex<Vec<(u32, f64)>>>,
        accepts: bool,
    }

    impl NativePlugin for ParameterRecordingPlugin {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

        fn apply_parameter_on_audio_thread(&mut self, id: u32, value: f64) -> bool {
            self.queued
                .lock()
                .expect("the parameter log")
                .push((id, value));
            self.accepts
        }

        fn name(&self) -> &str {
            "parameter-recording-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    fn parameter_recording_plugin(
        accepts: bool,
    ) -> (Box<dyn NativePlugin>, Arc<Mutex<Vec<(u32, f64)>>>) {
        let queued = Arc::new(Mutex::new(Vec::new()));
        (
            Box::new(ParameterRecordingPlugin {
                queued: Arc::clone(&queued),
                accepts,
            }),
            queued,
        )
    }

    /// Scales whatever it is handed, so a chain's position in the graph is
    /// visible in the mix rather than only in the graph's own bookkeeping.
    struct ScalingPlugin {
        factor: f32,
    }

    impl NativePlugin for ScalingPlugin {
        fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
            for index in 0..num_samples {
                left[index] *= self.factor;
                right[index] *= self.factor;
            }
        }

        fn name(&self) -> &str {
            "scaling-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// Emits with no input, standing in for a device with a tail: a reverb or
    /// a delay still sounding after the material that fed it has stopped.
    struct TailPlugin {
        value: f32,
    }

    impl NativePlugin for TailPlugin {
        fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
            for index in 0..num_samples {
                left[index] += self.value;
                right[index] += self.value;
            }
        }

        fn name(&self) -> &str {
            "tail-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// Counts the MIDI events actually handed to a device, so a burst that
    /// was banked while the device ran nowhere is visible.
    struct MidiCountingPlugin {
        received: Arc<AtomicUsize>,
    }

    impl NativePlugin for MidiCountingPlugin {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

        fn process_with_events(
            &mut self,
            _left: &mut [f32],
            _right: &mut [f32],
            _num_samples: usize,
            midi_events: &[MidiNoteEvent],
            _transport: &TransportState,
        ) {
            self.received
                .fetch_add(midi_events.len(), Ordering::Relaxed);
        }

        fn name(&self) -> &str {
            "midi-counting-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// Adds a constant to whatever it is handed and counts every process call
    /// and every MIDI event delivered, so which path drove the instance — and
    /// how many times per block — is readable in the mix and in the counts.
    struct CountingOffsetPlugin {
        offset: f32,
        calls: Arc<AtomicUsize>,
        midi_events: Arc<AtomicUsize>,
    }

    impl NativePlugin for CountingOffsetPlugin {
        fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
            self.calls.fetch_add(1, Ordering::Relaxed);
            for index in 0..num_samples {
                left[index] += self.offset;
                right[index] += self.offset;
            }
        }

        fn process_with_events(
            &mut self,
            left: &mut [f32],
            right: &mut [f32],
            num_samples: usize,
            midi_events: &[MidiNoteEvent],
            _transport: &TransportState,
        ) {
            self.midi_events
                .fetch_add(midi_events.len(), Ordering::Relaxed);
            self.process_audio(left, right, num_samples);
        }

        fn name(&self) -> &str {
            "counting-offset-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// One engine-owned hosted plugin, its bridge, and its call counters,
    /// spliced onto a track that plays a constant.
    struct ChainBoundPlugin {
        handle: crate::audio_bridge::PluginAudioBridgeHandle,
        calls: Arc<AtomicUsize>,
        midi_events: Arc<AtomicUsize>,
    }

    /// A track playing a constant `1.0`, carrying an engine-owned plugin
    /// registered exactly as `register_runtime_with_engine` registers one:
    /// `AddPluginWithBridge`, then a chain splice.
    fn track_carrying_a_bridged_plugin(
        harness: &mut Harness,
        track_id: usize,
        effect_id: usize,
        offset: f32,
    ) -> ChainBoundPlugin {
        let calls = Arc::new(AtomicUsize::new(0));
        let midi_events = Arc::new(AtomicUsize::new(0));
        let (bridge, handle) = crate::audio_bridge::create_audio_bridge(effect_id);

        track_with_constant_clip(harness, track_id, track_id + 100, 1.0, 4);
        harness.send(GraphCommand::AddPluginWithBridge(
            effect_id,
            Box::new(CountingOffsetPlugin {
                offset,
                calls: Arc::clone(&calls),
                midi_events: Arc::clone(&midi_events),
            }),
            bridge,
        ));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id,
            entry: effect(effect_id),
            index: 0,
        });

        ChainBoundPlugin {
            handle,
            calls,
            midi_events,
        }
    }

    fn bridge_blocks_passed_chain_bound(harness: &Harness) -> u64 {
        harness
            .scheduler
            .midi_rt_diagnostics
            .snapshot()
            .bridge_blocks_passed_chain_bound
    }

    /// Push one block of `value` over the bridge and let the callback's bridge
    /// pass run, the way a render callback does before it renders the graph.
    fn relay_one_block(plugin: &mut ChainBoundPlugin, harness: &mut Harness, value: f32) {
        assert!(
            plugin.handle.push_input(&[value; 4], &[value; 4]),
            "the bridge input ring should have room"
        );
        harness.scheduler.process_audio_bridges(512);
    }

    fn note_on(note: u8) -> MidiNoteEvent {
        MidiNoteEvent {
            note,
            velocity: 100,
            channel: 0,
            is_note_on: true,
            probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
            project_probability_seed: 0,
            clip_id_hash: 0,
            event_id_hash: 0,
            absolute_occurrence_index: 0,
        }
    }

    struct Harness {
        command_tx: rtrb::Producer<GraphCommand>,
        scheduler: AudioScheduler,
        retired_rx: rtrb::Consumer<RetiredGraphObjects>,
    }

    impl Harness {
        fn new(capacity: usize) -> Self {
            let (command_tx, command_rx) = RingBuffer::new(capacity);
            let (retired_tx, retired_rx) = RingBuffer::new(capacity);
            let scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
            Self {
                command_tx,
                scheduler,
                retired_rx,
            }
        }

        fn send(&mut self, command: GraphCommand) -> &mut Self {
            assert!(
                self.command_tx.push(command).is_ok(),
                "the command ring should have room"
            );
            self.scheduler.update_graph();
            self
        }

        fn playing(&mut self) -> &mut Self {
            self.send(GraphCommand::SetTransport(TransportState {
                is_playing: true,
                ..TransportState::default()
            }))
        }

        /// Render one block over a freshly zeroed pair, the way the render
        /// callback does.
        fn render(&mut self, frames: usize) -> (Vec<f32>, Vec<f32>) {
            let mut left = vec![0.0; frames];
            let mut right = vec![0.0; frames];
            self.scheduler.process_block(&mut left, &mut right, frames);
            (left, right)
        }

        fn diagnostics(&self) -> crate::timeline::TimelineRtDiagnosticsSnapshot {
            self.scheduler.timeline().diagnostics()
        }
    }

    fn placement(start_frame: u64, source_offset_frames: u64, length_frames: u64) -> ClipPlacement {
        ClipPlacement {
            start_frame,
            source_offset_frames,
            length_frames,
        }
    }

    fn effect(effect_id: usize) -> ChainEntry {
        ChainEntry {
            effect_id,
            kind: DeviceKind::Effect,
        }
    }

    fn chain_ids(chain: &[ChainEntry]) -> Vec<usize> {
        chain.iter().map(|entry| entry.effect_id).collect()
    }

    /// A track carrying one mono clip of a constant value, routed to the
    /// master.
    fn track_with_constant_clip(
        harness: &mut Harness,
        track_id: usize,
        clip_id: usize,
        value: f32,
        frames: usize,
    ) {
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(track_id)));
        harness.send(GraphCommand::AddClip(
            track_id,
            TimelineClip::new(
                clip_id,
                vec![value; frames].into(),
                [].into(),
                placement(0, 0, frames as u64),
                ClipPlayback::at_gain(1.0),
            ),
        ));
    }

    #[test]
    fn a_clip_sounds_on_the_frame_it_starts_and_stops_on_the_frame_it_ends() {
        let mut harness = Harness::new(16);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddClip(
            1,
            TimelineClip::new(
                9,
                vec![1.0; 8].into(),
                [].into(),
                placement(3, 0, 2),
                ClipPlayback::at_gain(1.0),
            ),
        ));

        // The clip names frames 3 and 4. A block-granular scheduler would put
        // it at the block boundary; the whole point of carrying the absolute
        // frame into the render is that it lands on the sample it names.
        let (left, right) = harness.render(8);
        assert_eq!(left, vec![0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0]);
        assert_eq!(right, left);
    }

    #[test]
    fn a_clip_starting_mid_block_carries_across_the_block_boundary() {
        let mut harness = Harness::new(16);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddClip(
            1,
            TimelineClip::new(
                9,
                vec![1.0; 8].into(),
                [].into(),
                placement(3, 0, 4),
                ClipPlayback::at_gain(1.0),
            ),
        ));

        let (first, _) = harness.render(4);
        assert_eq!(first, vec![0.0, 0.0, 0.0, 1.0]);
        assert_eq!(harness.scheduler.playhead_frames(), 4);

        // The second block continues the same clip: the playhead, not the
        // block index, decides which part of the material is due.
        let (second, _) = harness.render(4);
        assert_eq!(second, vec![1.0, 1.0, 1.0, 0.0]);
    }

    #[test]
    fn trimming_a_clip_moves_the_window_and_leaves_the_source_material_intact() {
        let mut harness = Harness::new(16);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddClip(
            1,
            TimelineClip::new(
                9,
                vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0].into(),
                [].into(),
                placement(0, 2, 3),
                ClipPlayback::at_gain(1.0),
            ),
        ));

        let (left, _) = harness.render(4);
        assert_eq!(left, vec![2.0, 3.0, 4.0, 0.0]);

        // Trim to a different window and play the same span again. A
        // destructive trim would have consumed or rewritten the material and
        // could not produce the later samples.
        harness.send(GraphCommand::SetClipPlacement(1, 9, placement(0, 5, 3)));
        harness.send(GraphCommand::SeekFrames(0));
        let (retrimmed, _) = harness.render(4);
        assert_eq!(retrimmed, vec![5.0, 6.0, 7.0, 0.0]);
        assert_eq!(
            harness.scheduler.timeline().clip_placement(1, 9),
            Some(placement(0, 5, 3))
        );
    }

    #[test]
    fn a_stereo_clip_keeps_its_channels_and_a_mono_clip_is_heard_on_both() {
        let mut harness = Harness::new(16);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddClip(
            1,
            TimelineClip::new(
                9,
                vec![1.0; 2].into(),
                vec![0.25; 2].into(),
                placement(0, 0, 2),
                ClipPlayback::at_gain(1.0),
            ),
        ));
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(2)));
        harness.send(GraphCommand::AddClip(
            2,
            TimelineClip::new(
                8,
                vec![0.5; 2].into(),
                [].into(),
                placement(0, 0, 2),
                ClipPlayback::at_gain(1.0),
            ),
        ));

        let (left, right) = harness.render(2);
        assert_eq!(left, vec![1.5, 1.5]);
        assert_eq!(right, vec![0.75, 0.75]);
    }

    #[test]
    fn a_linear_gain_ramp_is_interpolated_frame_by_frame_inside_the_block() {
        let mut harness = Harness::new(16);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 8);
        harness.send(GraphCommand::AutomateParam {
            target: AutomationTarget::TrackGain(1),
            write: AutomationWrite::Append(AutomationEvent {
                at_frame: 0,
                duration_frames: 4,
                value: 0.0,
                shape: RampShape::Linear,
            }),
        });

        // A ramp applied once per block would step: this is the stair-step the
        // intra-block interpolation exists to remove.
        let (left, _) = harness.render(8);
        assert_eq!(left, vec![1.0, 0.75, 0.5, 0.25, 0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn a_stamped_change_lands_on_the_frame_it_names_not_on_the_block_that_carries_it() {
        let mut harness = Harness::new(16);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 8);
        // Queued while the playhead is at 0, three blocks before it is due.
        harness.send(GraphCommand::AutomateParam {
            target: AutomationTarget::TrackGain(1),
            write: AutomationWrite::Append(AutomationEvent {
                at_frame: 6,
                duration_frames: 0,
                value: 0.5,
                shape: RampShape::Step,
            }),
        });

        let (first, _) = harness.render(4);
        assert_eq!(first, vec![1.0, 1.0, 1.0, 1.0]);

        let (second, _) = harness.render(4);
        assert_eq!(second, vec![1.0, 1.0, 0.5, 0.5]);
    }

    #[test]
    fn an_exponential_gain_ramp_reaches_the_mix_at_a_constant_ratio() {
        let mut harness = Harness::new(16);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AutomateParam {
            target: AutomationTarget::TrackGain(1),
            write: AutomationWrite::Append(AutomationEvent {
                at_frame: 0,
                duration_frames: 4,
                value: 0.25,
                shape: RampShape::Exponential,
            }),
        });

        // Two halvings across four frames, so the halfway frame carries the
        // geometric mean 0.5 rather than the 0.625 a linear ramp would land
        // on. The fallback to linear is the substitution this shape makes only
        // through zero, and it must not happen here.
        let (left, _) = harness.render(4);
        assert!((left[0] - 1.0).abs() < 1e-6, "{left:?}");
        assert!((left[2] - 0.5).abs() < 1e-6, "{left:?}");
        assert_eq!(harness.diagnostics().exponential_ramp_fallbacks, 0);
    }

    #[test]
    fn a_pre_fader_send_survives_the_mute_that_silences_the_tracks_own_output() {
        let mut harness = Harness::new(16);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::AddSend {
            track_id: 1,
            bus_id: 50,
            tap: SendTap::PreFader,
            level: 1.0,
        });
        harness.send(GraphCommand::SetTrackMute(1, true));

        // The mute sits after the fader and before the panner, so the muted
        // track contributes nothing directly while its pre-fader send keeps
        // feeding the bus — the whole reason a cue mix is taken pre-fader.
        let (left, _) = harness.render(4);
        assert_eq!(left, vec![1.0; 4]);
        assert_eq!(
            harness.scheduler.timeline().send_tap(1, 50),
            Some(SendTap::PreFader)
        );
    }

    #[test]
    fn a_post_fader_send_is_silenced_by_the_same_mute() {
        let mut harness = Harness::new(16);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::AddSend {
            track_id: 1,
            bus_id: 50,
            tap: SendTap::PostFader,
            level: 1.0,
        });
        harness.send(GraphCommand::SetTrackMute(1, true));

        let (left, _) = harness.render(4);
        assert_eq!(left, vec![0.0; 4]);
    }

    #[test]
    fn a_post_fader_send_follows_the_fader_and_a_pre_fader_send_does_not() {
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        track_with_constant_clip(&mut harness, 2, 8, 1.0, 4);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::AddSend {
            track_id: 1,
            bus_id: 50,
            tap: SendTap::PreFader,
            level: 1.0,
        });
        harness.send(GraphCommand::AddSend {
            track_id: 2,
            bus_id: 50,
            tap: SendTap::PostFader,
            level: 1.0,
        });
        for track_id in [1, 2] {
            harness.send(GraphCommand::AutomateParam {
                target: AutomationTarget::TrackGain(track_id),
                write: AutomationWrite::Append(AutomationEvent {
                    at_frame: 0,
                    duration_frames: 0,
                    value: 0.5,
                    shape: RampShape::Step,
                }),
            });
            harness.send(GraphCommand::SetTrackOutput(track_id, RouteTarget::Bus(50)));
        }

        // Track 1: pre-fader send at unity plus its own halved output.
        // Track 2: post-fader send halved plus its own halved output.
        let (left, _) = harness.render(4);
        assert_eq!(left, vec![1.0 + 0.5 + 0.5 + 0.5; 4]);
    }

    #[test]
    fn a_track_routed_to_a_bus_is_heard_through_that_buss_gain() {
        let mut harness = Harness::new(16);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Bus(50)));
        harness.send(GraphCommand::AutomateParam {
            target: AutomationTarget::BusGain(50),
            write: AutomationWrite::Append(AutomationEvent {
                at_frame: 0,
                duration_frames: 0,
                value: 0.25,
                shape: RampShape::Step,
            }),
        });

        let (left, _) = harness.render(4);
        assert_eq!(left, vec![0.25; 4]);
    }

    #[test]
    fn a_bus_routed_at_a_track_enters_that_track_device_chain() {
        let mut harness = Harness::new(32);
        harness.playing();
        // Track 1 stands in for the master strip: no clip of its own, a 0.5
        // insert, output to the engine sum. Track 2 is muted so only its
        // pre-fader send reaches the bus. The bus then feeds track 1. A bus
        // that still dumped onto the sum would bypass the insert and render 1.
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddPlugin(
            7,
            Box::new(ScalingPlugin { factor: 0.5 }),
        ));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 1,
            entry: effect(7),
            index: 0,
        });
        track_with_constant_clip(&mut harness, 2, 9, 1.0, 4);
        harness.send(GraphCommand::SetTrackMute(2, true));
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::AddSend {
            track_id: 2,
            bus_id: 50,
            tap: SendTap::PreFader,
            level: 1.0,
        });
        harness.send(GraphCommand::SetBusOutput(50, RouteTarget::Track(1)));

        assert_eq!(
            harness.scheduler.timeline().bus(50).map(|bus| bus.output()),
            Some(RouteTarget::Track(1))
        );
        let (left, _) = harness.render(4);
        assert_eq!(left, vec![0.5; 4]);
    }

    #[test]
    fn a_bus_and_track_that_feed_each_other_are_refused_as_a_cycle() {
        let mut harness = Harness::new(16);
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Bus(50)));
        harness.send(GraphCommand::SetBusOutput(50, RouteTarget::Track(1)));

        assert_eq!(harness.diagnostics().routing_cycles_refused, 1);
        assert_eq!(
            harness.scheduler.timeline().bus(50).map(|bus| bus.output()),
            Some(RouteTarget::Master)
        );
    }

    #[test]
    fn a_send_into_a_bus_that_feeds_the_same_track_is_refused_as_a_cycle() {
        let mut harness = Harness::new(16);
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::SetBusOutput(50, RouteTarget::Track(1)));
        harness.send(GraphCommand::AddSend {
            track_id: 1,
            bus_id: 50,
            tap: SendTap::PreFader,
            level: 1.0,
        });

        assert_eq!(harness.diagnostics().routing_cycles_refused, 1);
        assert_eq!(harness.scheduler.timeline().send_tap(1, 50), None);
    }

    #[test]
    fn a_track_feeding_another_track_is_rendered_ahead_of_it_and_enters_its_device_chain() {
        let mut harness = Harness::new(32);
        harness.playing();
        // Track 2 is added first, so insertion order alone would render it
        // before the track that feeds it and lose a block of audio.
        track_with_constant_clip(&mut harness, 2, 8, 1.0, 4);
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AddPlugin(
            7,
            Box::new(ScalingPlugin { factor: 0.5 }),
        ));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 2,
            entry: effect(7),
            index: 0,
        });
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Track(2)));

        // Both clips reach track 2's input, so the whole sum is halved by the
        // device on track 2. A track rendered out of order would leave track
        // 1's contribution behind.
        let (left, _) = harness.render(4);
        assert_eq!(left, vec![1.0; 4]);
    }

    #[test]
    fn a_routing_change_that_would_feed_a_track_back_into_itself_is_refused() {
        let mut harness = Harness::new(16);
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(2)));
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Track(2)));
        harness.send(GraphCommand::SetTrackOutput(2, RouteTarget::Track(1)));

        assert_eq!(harness.diagnostics().routing_cycles_refused, 1);
        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(2)
                .map(|track| track.output()),
            Some(RouteTarget::Master)
        );
    }

    #[test]
    fn a_device_on_a_track_chain_shapes_that_track_alone_and_not_the_master_sum() {
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        track_with_constant_clip(&mut harness, 2, 8, 1.0, 4);
        harness.send(GraphCommand::AddPlugin(
            7,
            Box::new(ScalingPlugin { factor: 0.5 }),
        ));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 1,
            entry: effect(7),
            index: 0,
        });

        // One track halved plus one untouched. The same device left on the
        // master insert chain would have halved the sum instead, giving 1.0.
        let (left, _) = harness.render(4);
        assert_eq!(left, vec![1.5; 4]);
        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(1)
                .map(|t| chain_ids(t.device_chain())),
            Some(vec![7])
        );

        // Taking it off the chain returns it to the master insert chain rather
        // than unloading it.
        harness.send(GraphCommand::RemoveTrackDevice {
            track_id: 1,
            effect_id: 7,
        });
        harness.send(GraphCommand::SeekFrames(0));
        let (after, _) = harness.render(4);
        assert_eq!(after, vec![1.0; 4]);
    }

    #[test]
    fn a_removed_tracks_device_stops_processing_instead_of_falling_onto_the_master_mix() {
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        track_with_constant_clip(&mut harness, 2, 8, 1.0, 4);
        harness.send(GraphCommand::AddPlugin(
            7,
            Box::new(ScalingPlugin { factor: 0.5 }),
        ));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 1,
            entry: effect(7),
            index: 0,
        });
        harness.send(GraphCommand::RemoveTrack(1));
        harness.send(GraphCommand::SeekFrames(0));

        // Track 2 alone, unshaped. A device that fell back onto the master
        // chain would have halved the surviving track's audio because the
        // track it belonged to was deleted.
        let (left, _) = harness.render(4);
        assert_eq!(left, vec![1.0; 4]);
        assert_eq!(
            harness.scheduler.effects[0].placement,
            EffectPlacement::Detached
        );
    }

    #[test]
    fn a_removed_track_leaves_the_audio_thread_over_the_retirement_channel_with_its_clips() {
        let mut harness = Harness::new(16);
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AddClip(
            1,
            TimelineClip::new(
                10,
                vec![1.0; 4].into(),
                [].into(),
                placement(0, 0, 4),
                ClipPlayback::at_gain(1.0),
            ),
        ));
        harness.send(GraphCommand::RemoveTrack(1));

        assert_eq!(harness.scheduler.timeline().track_count(), 0);
        let retired = harness
            .retired_rx
            .pop()
            .expect("the removed track should be handed off, never freed on the callback");
        // Every sample buffer the track and its clips own has to leave with
        // it: dropping them here is exactly the free ADR 0020 forbids.
        match &retired.timeline_object {
            Some(RetiredTimelineObject::Track(track)) => {
                assert_eq!(track.id(), 1);
                assert_eq!(track.clip_ids().collect::<Vec<_>>(), vec![9, 10]);
            }
            _ => panic!("expected the track and its clips on the retirement channel"),
        }
    }

    #[test]
    fn a_removed_clip_and_a_removed_bus_are_retired_rather_than_dropped_on_the_callback() {
        let mut harness = Harness::new(16);
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::RemoveClip(1, 9));
        harness.send(GraphCommand::RemoveBus(50));

        let clip = harness.retired_rx.pop().expect("the removed clip");
        assert!(matches!(
            clip.timeline_object,
            Some(RetiredTimelineObject::Clip(_))
        ));
        let bus = harness.retired_rx.pop().expect("the removed bus");
        assert!(matches!(
            bus.timeline_object,
            Some(RetiredTimelineObject::Bus(_))
        ));
    }

    #[test]
    fn a_colliding_track_is_handed_back_rather_than_displacing_the_live_one() {
        let mut harness = Harness::new(16);
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));

        assert_eq!(harness.scheduler.timeline().track_count(), 1);
        assert_eq!(harness.diagnostics().id_collisions, 1);
        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(1)
                .map(|track| track.clip_ids().count()),
            Some(1),
            "the live track must keep its clips"
        );
        assert!(matches!(
            harness
                .retired_rx
                .pop()
                .expect("the rejected track")
                .timeline_object,
            Some(RetiredTimelineObject::Track(_))
        ));
    }

    #[test]
    fn a_track_past_the_graphs_capacity_is_refused_and_retired_rather_than_grown() {
        let mut harness = Harness::new(MAX_TIMELINE_TRACKS + 8);
        for id in 0..MAX_TIMELINE_TRACKS {
            harness.send(GraphCommand::AddTrack(TimelineTrack::new(id)));
        }
        assert_eq!(
            harness.scheduler.timeline().track_count(),
            MAX_TIMELINE_TRACKS
        );

        // Growing the vector would have called the allocator inside the audio
        // deadline. A counted refusal is the alternative, not an option.
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(
            MAX_TIMELINE_TRACKS,
        )));
        assert_eq!(
            harness.scheduler.timeline().track_count(),
            MAX_TIMELINE_TRACKS
        );
        assert_eq!(harness.diagnostics().capacity_refusals, 1);
        assert!(matches!(
            harness
                .retired_rx
                .pop()
                .expect("the refused track")
                .timeline_object,
            Some(RetiredTimelineObject::Track(_))
        ));
    }

    #[test]
    fn a_centred_pan_is_an_exact_identity_and_a_hard_pan_folds_the_signal_across() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddClip(
            1,
            TimelineClip::new(
                9,
                vec![1.0; 4].into(),
                vec![0.0; 4].into(),
                placement(0, 0, 4),
                ClipPlayback::at_gain(1.0),
            ),
        ));

        let (centred_left, centred_right) = harness.render(4);
        assert_eq!(centred_left, vec![1.0; 4]);
        assert_eq!(centred_right, vec![0.0; 4]);

        // Rewound first and written afterwards, which is the order the control
        // thread issues these in: a locate drops the automation window it made
        // stale, and the window for the new position is pushed after it.
        harness.send(GraphCommand::SeekFrames(0));
        harness.send(GraphCommand::AutomateParam {
            target: AutomationTarget::TrackPan(1),
            write: AutomationWrite::Append(AutomationEvent {
                at_frame: 0,
                duration_frames: 0,
                value: 1.0,
                shape: RampShape::Step,
            }),
        });

        // Hard right folds the left channel's material into the right rather
        // than discarding it, which is the stereo panning rule the app's own
        // strip already pans by.
        let (panned_left, panned_right) = harness.render(4);
        assert!(panned_left.iter().all(|sample| sample.abs() < 1e-6));
        assert_eq!(panned_right, vec![1.0; 4]);
    }

    #[test]
    fn the_playhead_advances_only_while_the_transport_is_playing() {
        let mut harness = Harness::new(16);
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));

        harness.render(64);
        assert_eq!(harness.scheduler.playhead_frames(), 0);

        harness.playing();
        harness.render(64);
        harness.render(64);
        assert_eq!(harness.scheduler.playhead_frames(), 128);

        harness.send(GraphCommand::SeekFrames(1_000));
        assert_eq!(harness.scheduler.playhead_frames(), 1_000);
    }

    #[test]
    fn a_stamped_device_parameter_lands_on_the_block_that_reaches_it() {
        let mut harness = Harness::new(16);
        harness.playing();
        harness.send(GraphCommand::AddEffect(7, knead_instance()));
        harness.send(GraphCommand::AutomateDeviceParam {
            effect_id: 7,
            param: DeviceParamTarget::Builtin(DeviceParam::ShiftSemitones),
            value: 5.0,
            at_frame: 6,
        });

        harness.render(4);
        match &harness.scheduler.effects[0].instance {
            PluginCore::Knead(engine) => assert_eq!(
                engine.shift_semitones, 0.0,
                "a change stamped ahead of the playhead must not land early"
            ),
            PluginCore::Native(_) => panic!("expected the knead effect"),
        }

        harness.render(4);
        match &harness.scheduler.effects[0].instance {
            PluginCore::Knead(engine) => assert_eq!(engine.shift_semitones, 5.0),
            PluginCore::Native(_) => panic!("expected the knead effect"),
        }
    }

    /// A hosted plugin's parameters are the plugin's own, so a stamp aimed at
    /// one is queued on the plugin rather than resolved here. It must land on
    /// the block whose span reaches the stamp and on no other: applied early it
    /// moves the parameter before the music does, applied every block it would
    /// fight the plugin's own smoothing.
    ///
    /// One stamp sits mid-block and one on a block's own first frame. The
    /// boundary stamp is what pins the span's inclusive last frame: a span
    /// reaching `block_start + frames` instead of `block_start + frames - 1`
    /// carries a mid-block stamp identically but pulls the boundary one a whole
    /// block early.
    #[test]
    fn a_hosted_stamp_lands_on_the_block_that_reaches_it() {
        let mut harness = Harness::new(16);
        harness.playing();
        let (plugin, queued) = parameter_recording_plugin(true);
        harness.send(GraphCommand::AddPlugin(3, plugin));
        harness.send(GraphCommand::AutomateDeviceParam {
            effect_id: 3,
            param: DeviceParamTarget::Hosted { id: 4 },
            value: 0.5,
            at_frame: 4,
        });
        harness.send(GraphCommand::AutomateDeviceParam {
            effect_id: 3,
            param: DeviceParamTarget::Hosted { id: 7 },
            value: 0.25,
            at_frame: 6,
        });

        harness.render(4);
        assert!(
            queued.lock().expect("the parameter log").is_empty(),
            "the block spanning frames 0..=3 reaches neither stamp: a stamp on \
             the next block's first frame belongs to that block, not to this one"
        );

        harness.render(4);
        assert_eq!(
            *queued.lock().expect("the parameter log"),
            vec![(4, 0.5), (7, 0.25)],
            "the block starting on frame 4 lands the stamp on its own first \
             frame and the one inside its span, in stamp order"
        );

        harness.render(4);
        assert_eq!(
            *queued.lock().expect("the parameter log"),
            vec![(4, 0.5), (7, 0.25)],
            "a landed stamp leaves the queue rather than reapplying every block"
        );
        assert_eq!(
            harness
                .scheduler
                .midi_rt_diagnostics
                .snapshot()
                .unmapped_set_param_calls,
            0,
            "a write the plugin queued is not an unmapped call"
        );
    }

    /// Only the plugin knows whether it can take the write — its queue may be
    /// full, or the id may name nothing it exposes. A refusal is the one thing
    /// the engine can do about it: count it, so the shortfall is visible rather
    /// than silently absent from the mix.
    #[test]
    fn a_hosted_stamp_the_plugin_refuses_is_counted_unmapped() {
        let mut harness = Harness::new(16);
        harness.playing();
        let (plugin, queued) = parameter_recording_plugin(false);
        harness.send(GraphCommand::AddPlugin(3, plugin));
        harness.send(GraphCommand::AutomateDeviceParam {
            effect_id: 3,
            param: DeviceParamTarget::Hosted { id: 7 },
            value: 0.25,
            at_frame: 0,
        });

        harness.render(4);

        assert_eq!(
            *queued.lock().expect("the parameter log"),
            vec![(7, 0.25)],
            "the stamp reached the plugin, which refused it"
        );
        assert_eq!(
            harness
                .scheduler
                .midi_rt_diagnostics
                .snapshot()
                .unmapped_set_param_calls,
            1
        );
    }

    /// The address and the body must agree. A built-in address carries a name
    /// no hosted plugin answers to, and a hosted id is a number no built-in
    /// parameter has — so a stamp that reaches the wrong kind of body is a
    /// producer that lost track of what an effect id holds, and applying it
    /// either way would move some other parameter.
    #[test]
    fn a_stamp_addressed_at_the_wrong_body_is_counted_unmapped() {
        let mut harness = Harness::new(16);
        harness.playing();
        harness.send(GraphCommand::AddEffect(1, knead_instance()));
        let (plugin, queued) = parameter_recording_plugin(true);
        harness.send(GraphCommand::AddPlugin(2, plugin));
        harness.send(GraphCommand::AutomateDeviceParam {
            effect_id: 1,
            param: DeviceParamTarget::Hosted { id: 7 },
            value: 0.25,
            at_frame: 0,
        });
        harness.send(GraphCommand::AutomateDeviceParam {
            effect_id: 2,
            param: DeviceParamTarget::Builtin(DeviceParam::ShiftSemitones),
            value: 5.0,
            at_frame: 0,
        });

        harness.render(4);

        assert!(
            queued.lock().expect("the parameter log").is_empty(),
            "a built-in address must not reach a hosted plugin's queue"
        );
        match &harness.scheduler.effects[0].instance {
            PluginCore::Knead(engine) => assert_eq!(
                engine.shift_semitones, 0.0,
                "a hosted id must not move a built-in parameter"
            ),
            PluginCore::Native(_) => panic!("expected the knead effect"),
        }
        assert_eq!(
            harness
                .scheduler
                .midi_rt_diagnostics
                .snapshot()
                .unmapped_set_param_calls,
            2
        );
    }

    /// A bypassed hosted plugin never gets a block, so nothing would drain a
    /// write from its queue: the write would sit there until un-bypass, and
    /// while it sits the plugin refuses its own state read and every parameter
    /// poll. So the stamp is discarded outright, exactly as MIDI queued at a
    /// bypassed device is — and discarding is not a refusal, so it is not
    /// counted unmapped either.
    #[test]
    fn a_hosted_stamp_on_a_bypassed_effect_is_discarded() {
        let mut harness = Harness::new(16);
        harness.playing();
        let (plugin, queued) = parameter_recording_plugin(true);
        harness.send(GraphCommand::AddPlugin(3, plugin));
        harness.send(GraphCommand::SetBypass(3, true));
        harness.send(GraphCommand::AutomateDeviceParam {
            effect_id: 3,
            param: DeviceParamTarget::Hosted { id: 7 },
            value: 0.25,
            at_frame: 6,
        });

        harness.render(4);
        harness.render(4);

        assert!(
            queued.lock().expect("the parameter log").is_empty(),
            "a stamp due while the effect is bypassed must never reach the plugin"
        );
        assert!(
            harness.scheduler.effects[0].pending_params.is_empty(),
            "the discarded stamp leaves the queue rather than banking until un-bypass"
        );
        assert_eq!(
            harness
                .scheduler
                .midi_rt_diagnostics
                .snapshot()
                .unmapped_set_param_calls,
            0,
            "a stamp the engine discards is not a call the plugin refused"
        );
    }

    /// A detached effect is handed no block either: no chain claims it, and
    /// without a bridge no path reaches it at all. A stamp queued on the plugin
    /// there would never drain — and unlike bypass, nothing has to end that
    /// state, so the plugin's state read and its parameter polls would stay
    /// refused for the rest of the instance's life.
    #[test]
    fn a_hosted_stamp_on_a_detached_effect_is_discarded() {
        let mut harness = Harness::new(16);
        harness.playing();
        let (plugin, queued) = parameter_recording_plugin(true);
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddPlugin(3, plugin));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 1,
            entry: effect(3),
            index: 0,
        });
        harness.send(GraphCommand::AutomateDeviceParam {
            effect_id: 3,
            param: DeviceParamTarget::Hosted { id: 7 },
            value: 0.25,
            at_frame: 6,
        });
        harness.send(GraphCommand::RemoveTrack(1));
        assert_eq!(
            harness.scheduler.effects[0].placement,
            EffectPlacement::Detached
        );

        harness.render(4);
        harness.render(4);

        assert!(
            queued.lock().expect("the parameter log").is_empty(),
            "a stamp due while the effect runs nowhere must never reach the plugin"
        );
        assert!(
            harness.scheduler.effects[0].pending_params.is_empty(),
            "the discarded stamp leaves the queue rather than banking until the \
             effect is placed again"
        );
        assert_eq!(
            harness
                .scheduler
                .midi_rt_diagnostics
                .snapshot()
                .unmapped_set_param_calls,
            0,
            "a stamp the engine discards is not a call the plugin refused"
        );
    }

    /// The half of `runs_nowhere` the bridge owns. An off-chain plugin the app
    /// still feeds over its audio bridge is handed a block every callback that
    /// bridge carries one, so its pending-parameter queue has a drain behind it
    /// and the stamp must reach it. Drop the bridge test from the predicate and
    /// every plugin the app drives off a chain — a panel device, a monitored
    /// instrument between splices — silently loses its automation writes.
    #[test]
    fn a_hosted_stamp_on_a_bridged_detached_effect_still_reaches_the_plugin() {
        let mut harness = Harness::new(32);
        harness.playing();
        let (plugin, queued) = parameter_recording_plugin(true);
        let (bridge, _handle) = crate::audio_bridge::create_audio_bridge(7);
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 4);
        harness.send(GraphCommand::AddPluginWithBridge(7, plugin, bridge));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 1,
            entry: effect(7),
            index: 0,
        });
        harness.send(GraphCommand::RemoveTrackDevice {
            track_id: 1,
            effect_id: 7,
        });
        harness.send(GraphCommand::AutomateDeviceParam {
            effect_id: 7,
            param: DeviceParamTarget::Hosted { id: 4 },
            value: 0.25,
            at_frame: 6,
        });
        let slot = harness
            .scheduler
            .effect_index
            .lookup(7)
            .expect("the removal must not unload the plugin");
        assert_eq!(
            harness.scheduler.effects[slot].placement,
            EffectPlacement::Detached
        );
        assert!(
            harness.scheduler.bridge_index.lookup(7).is_some(),
            "the bridge outlives the chain that held the plugin, which is what \
             keeps this effect reachable"
        );

        harness.render(4);
        assert!(
            queued.lock().expect("the parameter log").is_empty(),
            "a stamp ahead of the playhead must not land early, detached or not"
        );

        harness.render(4);
        assert_eq!(
            queued.lock().expect("the parameter log").as_slice(),
            &[(4, 0.25)],
            "a detached effect its bridge still feeds takes the stamp exactly \
             once, because the bridge drains what the stamp queues"
        );
        assert!(
            harness.scheduler.effects[slot].pending_params.is_empty(),
            "the applied stamp leaves the queue"
        );
        assert_eq!(
            harness
                .scheduler
                .midi_rt_diagnostics
                .snapshot()
                .unmapped_set_param_calls,
            0,
            "a stamp the plugin accepted is not an unmapped call"
        );
    }

    /// The other side of the asymmetry, and the reason the discard is matched
    /// on the target rather than taken before the match: a knead engine holds
    /// its parameters in its own struct, written straight through here, so a
    /// bypassed one still takes the stamp and is already current when the user
    /// un-bypasses it. Gate this arm on the same condition the hosted arm uses
    /// and the parameter silently keeps its old value instead.
    #[test]
    fn a_builtin_stamp_still_applies_while_the_effect_is_bypassed() {
        let mut harness = Harness::new(16);
        harness.playing();
        harness.send(GraphCommand::AddEffect(7, knead_instance()));
        harness.send(GraphCommand::SetBypass(7, true));
        harness.send(GraphCommand::AutomateDeviceParam {
            effect_id: 7,
            param: DeviceParamTarget::Builtin(DeviceParam::ShiftSemitones),
            value: 5.0,
            at_frame: 6,
        });

        harness.render(4);
        match &harness.scheduler.effects[0].instance {
            PluginCore::Knead(engine) => assert_eq!(
                engine.shift_semitones, 0.0,
                "a change stamped ahead of the playhead must not land early, \
                 bypassed or not"
            ),
            PluginCore::Native(_) => panic!("expected the knead effect"),
        }

        harness.render(4);
        match &harness.scheduler.effects[0].instance {
            PluginCore::Knead(engine) => assert_eq!(
                engine.shift_semitones, 5.0,
                "a built-in takes its stamp while bypassed: the value must be \
                 current the moment the effect is un-bypassed"
            ),
            PluginCore::Native(_) => panic!("expected the knead effect"),
        }
        assert_eq!(
            harness
                .scheduler
                .midi_rt_diagnostics
                .snapshot()
                .unmapped_set_param_calls,
            0,
            "a stamp the built-in applied is not an unmapped call"
        );
    }

    #[test]
    fn the_master_fader_is_applied_after_the_master_insert_chain() {
        let mut harness = Harness::new(16);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AddPlugin(
            7,
            Box::new(ScalingPlugin { factor: 0.5 }),
        ));
        harness.send(GraphCommand::AutomateParam {
            target: AutomationTarget::MasterGain,
            write: AutomationWrite::Append(AutomationEvent {
                at_frame: 0,
                duration_frames: 0,
                value: 0.5,
                shape: RampShape::Step,
            }),
        });

        // The insert halves the timeline sum and the fader halves it again.
        // The fader running first would be inaudible here, but it is the stage
        // the engineer expects to be last on the strip.
        let (left, _) = harness.render(4);
        assert_eq!(left, vec![0.25; 4]);
    }

    /// The coefficient the master fader command carries at 48 kHz.
    ///
    /// `commands/graph.rs` maps a gesture to `1 - exp(-1 / (T * sample_rate))`
    /// with `T` the 10 ms time constant the Web Audio fader smooths on, so this
    /// is the same number the desktop app sends.
    fn master_smoothing() -> f32 {
        1.0 - (-1.0f32 / (0.010 * 48_000.0)).exp()
    }

    /// One time constant at 48 kHz, in frames: the point a one-pole approach
    /// has covered `1 - 1/e` of the distance by.
    const MASTER_TIME_CONSTANT_FRAMES: usize = 480;

    /// The fader glides on its own law, from the level it is holding.
    ///
    /// A step from unity to silence is the loudest click a mix can make, so the
    /// first sample after the gesture has to still carry the level the sample
    /// before it did, and the descent has to be the exponential approach the
    /// Web Audio fader beside it makes rather than a straight line.
    #[test]
    fn master_fader_approaches_its_target_by_the_one_pole_law_without_a_step() {
        let smoothing = master_smoothing();
        let mut harness = Harness::new(16);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 8_192);
        harness.send(GraphCommand::SetMasterGain {
            value: 0.0,
            smoothing,
        });

        let (first, _) = harness.render(4_096);
        let (second, _) = harness.render(4_096);

        assert_eq!(
            first[0], 1.0,
            "the first sample must carry the level the fader was holding"
        );
        let one_time_constant = first[MASTER_TIME_CONSTANT_FRAMES];
        assert!(
            (one_time_constant - 1.0 / std::f32::consts::E).abs() < 1e-3,
            "one time constant in, the fader stands at 1/e of the way it started from, got {one_time_constant}"
        );
        let mut previous = 1.0;
        for (index, sample) in first.iter().enumerate() {
            let step = previous - sample;
            assert!(
                (0.0..=smoothing).contains(&step),
                "the descent must be monotone and cover at most one coefficient's worth of what is left, stepped by {step} at {index}"
            );
            previous = *sample;
        }
        assert_eq!(
            *second.last().expect("the second block rendered"),
            0.0,
            "a fader pulled to silence has to reach true zero rather than approach it forever"
        );
    }

    /// A drag is a stream of gestures, and each one re-aims the same fader.
    ///
    /// The new approach starts from the level the fader has actually reached,
    /// so the mix never jumps to where a superseded gesture was heading, and it
    /// travels on the one-pole law from there rather than on a straight line to
    /// the new target.
    #[test]
    fn master_fader_re_anchors_from_the_level_it_has_reached() {
        let smoothing = master_smoothing();
        let mut harness = Harness::new(16);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4_096);
        harness.send(GraphCommand::SetMasterGain {
            value: 0.0,
            smoothing,
        });
        harness.render(MASTER_TIME_CONSTANT_FRAMES);

        harness.send(GraphCommand::SetMasterGain {
            value: 1.0,
            smoothing,
        });
        let (rising, _) = harness.render(MASTER_TIME_CONSTANT_FRAMES);

        let anchor = 1.0 / std::f32::consts::E;
        assert!(
            (rising[0] - anchor).abs() < 1e-3,
            "the second gesture must continue from where the first had reached, got {}",
            rising[0]
        );
        let last = *rising.last().expect("the rising block rendered");
        assert!(
            rising[0] > 0.0 && last > 0.0,
            "the span this samples must sound at both ends, got {} and {last}",
            rising[0]
        );
        // Sampled strictly inside that span, against the approach's own
        // formula: a straight line between the same endpoints stands well over
        // a tenth away from it here.
        let interior = MASTER_TIME_CONSTANT_FRAMES / 2;
        let expected = 1.0 - (1.0 - anchor) * (1.0 - smoothing).powi(interior as i32);
        assert!(
            (rising[interior] - expected).abs() < 1e-3,
            "the rise must follow the one-pole law from its anchor: sample {interior} is {}, the law says {expected}",
            rising[interior]
        );
    }

    /// The fader arrives at its target rather than parking beside it.
    ///
    /// A one-pole approach covers a fraction of what is left, so the step
    /// shrinks with the distance and underflows `f32` before the distance
    /// reaches zero: the fader stops moving a hair off its target, and a fader
    /// that never settles walks every block sample by sample and holds a level
    /// that is not the one the gesture asked for, for the rest of the session.
    /// The residue is inaudible; being permanently unsettled is not.
    #[test]
    fn master_fader_settles_exactly_on_a_target_it_cannot_reach_by_halving() {
        const BLOCK: usize = 4_096;
        const BLOCKS: usize = 4;

        let smoothing = master_smoothing();
        let mut harness = Harness::new(16);
        harness.playing();
        // The clip must be exactly unity: the master automation lane's unity
        // fast path leaves the signal untouched, so a rendered sample equal
        // to 0.8 proves the fader's own value is bit-equal to its target
        // rather than merely close to it.
        track_with_constant_clip(&mut harness, 1, 9, 1.0, BLOCK * BLOCKS);
        harness.send(GraphCommand::SetMasterGain {
            value: 0.8,
            smoothing,
        });

        // Well past six time constants, by which an approach has covered all
        // but a quarter percent of the distance and long since stopped moving.
        let mut last = Vec::new();
        for _ in 0..BLOCKS {
            let (block, _) = harness.render(BLOCK);
            last = block;
        }

        assert!(
            last.iter().all(|sample| *sample == 0.8),
            "the fader must land on the level the gesture named, not beside it: the last block ends at {}",
            last.last().expect("the last block rendered")
        );
    }

    /// A loop wrap is not a fader move.
    ///
    /// The wrap sends the playhead back below the frame the gesture arrived on,
    /// and anything stamped in timeline frames answers there with the value it
    /// started from — a step at the seam, and a whole pass at the pre-gesture
    /// level. The fader holds no frame, so the seam is not a coordinate it can
    /// be read at.
    #[test]
    fn master_fader_crosses_a_loop_seam_without_a_step() {
        const LOOP_END: u64 = 1_024;
        const BEFORE_SEAM: usize = 1_020;
        const ACROSS_SEAM: usize = 480;
        /// Where the first frame of the second pass lands in the block below.
        const SEAM_AT: usize = (LOOP_END - BEFORE_SEAM as u64) as usize;

        let smoothing = master_smoothing();
        let mut harness = Harness::new(32);
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4_096);
        harness.send(GraphCommand::SetLoopRegion(LoopRegion {
            enabled: true,
            start_frame: 0,
            end_frame: LOOP_END,
        }));
        harness.playing();

        let (approaching, _) = harness.render(BEFORE_SEAM);
        // Sent before the wrap, and the case has power only that way round: a
        // fader still travelling when the seam arrives is what distinguishes an
        // approach from a stamped ramp, which would resolve back to its start.
        harness.send(GraphCommand::SetMasterGain {
            value: 0.0,
            smoothing,
        });
        let (across, _) = harness.render(ACROSS_SEAM);

        assert_eq!(
            harness.scheduler.transport_position().loop_wraps,
            1,
            "this block has to hold the seam for the case to say anything"
        );
        for (index, sample) in across.iter().enumerate() {
            let expected = (1.0 - smoothing).powi(index as i32);
            assert!(
                (sample - expected).abs() < 1e-3,
                "the approach must not notice the wrap: sample {index} is {sample}, the law says {expected}"
            );
        }
        let mut previous = *approaching.last().expect("the first pass sounded");
        for (index, sample) in across.iter().enumerate() {
            let step = previous - sample;
            assert!(
                (0.0..=smoothing).contains(&step),
                "no sample may step by more than one coefficient's worth of what is left, stepped by {step} at {index}"
            );
            previous = *sample;
        }
        assert!(
            across[SEAM_AT] > 0.0 && *across.last().expect("the block rendered") > 0.0,
            "the span this samples must sound at both ends"
        );
        assert!(
            *across.last().expect("the block rendered") < across[SEAM_AT],
            "the fader must keep travelling after the wrap rather than parking where the seam found it"
        );
    }

    #[test]
    fn a_command_naming_a_track_that_does_not_exist_is_counted_rather_than_ignored() {
        let mut harness = Harness::new(16);
        harness.send(GraphCommand::SetTrackMute(404, true));
        harness.send(GraphCommand::RemoveTrack(404));
        harness.send(GraphCommand::SetClipPlacement(404, 9, placement(0, 0, 1)));

        assert_eq!(harness.diagnostics().unknown_targets, 3);
    }

    #[test]
    fn a_clip_under_a_parked_playhead_is_silent_while_its_devices_tail_still_drains() {
        let mut harness = Harness::new(32);
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AddPlugin(
            7,
            Box::new(TailPlugin { value: 0.25 }),
        ));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 1,
            entry: effect(7),
            index: 0,
        });

        // The playhead stands still while the transport is stopped, so a clip
        // rendered anyway would repeat the same span every callback — a
        // buffer-length loop, and one the sends would pump into the buses.
        // The chain still runs, so a device with a tail keeps draining it.
        let (first, right) = harness.render(4);
        assert_eq!(first, vec![0.25; 4]);
        assert_eq!(right, first);
        let (second, _) = harness.render(4);
        assert_eq!(second, vec![0.25; 4]);
        assert_eq!(harness.scheduler.playhead_frames(), 0);

        // The same clip under the same playhead sounds the moment the
        // transport rolls, so the silence above is the transport's doing and
        // not a clip that never played.
        harness.playing();
        let (playing, _) = harness.render(4);
        assert_eq!(playing, vec![1.25; 4]);
    }

    #[test]
    fn an_effect_one_track_holds_is_refused_by_a_second_track_rather_than_run_on_both() {
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        track_with_constant_clip(&mut harness, 2, 8, 1.0, 4);
        harness.send(GraphCommand::AddPlugin(
            7,
            Box::new(ScalingPlugin { factor: 0.5 }),
        ));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 1,
            entry: effect(7),
            index: 0,
        });
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 2,
            entry: effect(7),
            index: 0,
        });

        // One instance spliced into two chains would run its state over two
        // unrelated streams interleaved, and its single-valued placement could
        // name only one of the two tracks holding it.
        assert_eq!(harness.diagnostics().id_collisions, 1);
        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(2)
                .map(|track| chain_ids(track.device_chain())),
            Some(Vec::new())
        );
        assert_eq!(
            harness.scheduler.effects[0].placement,
            EffectPlacement::Track(1)
        );

        // Track 1 halved, track 2 untouched. The device running on both would
        // have halved the second track too, giving 1.0.
        let (left, _) = harness.render(4);
        assert_eq!(left, vec![1.5; 4]);
    }

    /// The graph transport pushes its batch one command at a time on the
    /// SPSC ring, so a callback can drain between an effect's registration
    /// and the splice that places it — and a removal drains apart from
    /// anything after it. Neither split may put a strip-owned effect on the
    /// master chain, even for one block.
    #[test]
    fn a_graph_owned_effect_never_transits_the_master_chain_at_any_drain_split() {
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 0.5, 64);

        // Split one: the registration drains alone. Registered onto the
        // master chain, the knead engine would run over the whole mix here
        // (its latency alone replaces the 0.5 constant); detached, it runs
        // nowhere.
        harness.send(GraphCommand::AddDetachedEffect(7, knead_instance()));
        assert_eq!(
            harness.scheduler.effects[0].placement,
            EffectPlacement::Detached
        );
        let (registered_only, _) = harness.render(4);
        assert_eq!(
            registered_only,
            vec![0.5; 4],
            "an effect whose splice has not landed must not touch the master output"
        );

        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 1,
            entry: effect(7),
            index: 0,
        });
        assert_eq!(
            harness.scheduler.effects[0].placement,
            EffectPlacement::Track(1)
        );
        harness.render(4);

        // Split two: the removal drains alone. The remove-then-retire pair
        // this variant replaces released the effect to the master chain in
        // exactly this window.
        harness.send(GraphCommand::RemoveTrackDeviceRetired {
            track_id: 1,
            effect_id: 7,
        });
        assert!(
            harness.scheduler.effects.is_empty(),
            "a retired graph device must leave the effect table in the same drain step"
        );
        let (after_remove, _) = harness.render(4);
        assert_eq!(after_remove, vec![0.5; 4]);

        // The final drop crossed the retirement channel rather than running
        // on this (stand-in audio) thread.
        let retired = harness
            .retired_rx
            .pop()
            .expect("the removed effect must be handed off for reclamation");
        assert!(retired.effect.is_some());
    }

    #[test]
    fn a_detached_effect_discards_midi_queued_while_it_is_detached() {
        let received = Arc::new(AtomicUsize::new(0));
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddPlugin(
            7,
            Box::new(MidiCountingPlugin {
                received: Arc::clone(&received),
            }),
        ));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 1,
            entry: effect(7),
            index: 0,
        });
        harness.send(GraphCommand::RemoveTrack(1));
        assert_eq!(
            harness.scheduler.effects[0].placement,
            EffectPlacement::Detached
        );

        harness.send(GraphCommand::SendMidiNote(7, note_on(60)));
        harness.render(4);
        assert_eq!(received.load(Ordering::Relaxed), 0);
        assert!(
            harness.scheduler.effects[0].pending_midi.is_empty(),
            "an effect no chain runs must not bank the MIDI addressed to it"
        );

        // Placing it back on a chain must not fire the note queued while it
        // ran nowhere: a banked note-on has no note-off behind it.
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(2)));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 2,
            entry: effect(7),
            index: 0,
        });
        harness.render(4);
        assert_eq!(received.load(Ordering::Relaxed), 0);

        // A note sent once it is placed still reaches it, so the silence above
        // is the drain and not a device that never receives anything.
        harness.send(GraphCommand::SendMidiNote(7, note_on(60)));
        harness.render(4);
        assert_eq!(received.load(Ordering::Relaxed), 1);
    }

    /// The shadowed default: the app is what the user hears, the relay drives
    /// the plugin from the app's own audio, and the strip chain must leave the
    /// instance alone. Anything else runs one stateful plugin twice a block and
    /// emits its output on a path the app is not monitoring.
    #[test]
    fn a_shadowed_monitor_leaves_a_chain_bound_plugin_to_its_bridge() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::SetMonitorShadow(true));
        let mut plugin = track_carrying_a_bridged_plugin(&mut harness, 1, 7, 0.5);

        relay_one_block(&mut plugin, &mut harness, 0.25);
        let bridged = plugin
            .handle
            .pop_output()
            .expect("the bridge returns a block");
        assert_eq!(
            &bridged.left[..4],
            &[0.75; 4],
            "the relay path must still process the app's audio while shadowed"
        );
        let after_the_bridge = plugin.calls.load(Ordering::Relaxed);
        assert_eq!(after_the_bridge, 1);

        let (left, right) = harness.render(4);
        assert_eq!(
            left,
            vec![1.0; 4],
            "a shadowed monitor must leave the track's own output untouched"
        );
        assert_eq!(right, left);
        assert_eq!(
            plugin.calls.load(Ordering::Relaxed),
            after_the_bridge,
            "the chain must make no inline call while the monitor is shadowed"
        );
        assert_eq!(bridge_blocks_passed_chain_bound(&harness), 0);
    }

    /// The audible side of the same session: the chain owns the instance, the
    /// bridge keeps moving but returns its blocks exactly as they arrived, and
    /// the plugin is driven once — not once per path.
    #[test]
    fn an_audible_monitor_runs_a_chain_bound_plugin_inline_and_passes_its_bridge_through() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::SetMonitorShadow(false));
        let mut plugin = track_carrying_a_bridged_plugin(&mut harness, 1, 7, 0.5);

        relay_one_block(&mut plugin, &mut harness, 0.25);
        assert_eq!(
            plugin.calls.load(Ordering::Relaxed),
            0,
            "the relay must not process a plugin the chain is going to run"
        );
        let passed = plugin
            .handle
            .pop_output()
            .expect("the bridge returns a block");
        assert_eq!(
            &passed.left[..4],
            &[0.25; 4],
            "a passed-through block is the app's own audio, unprocessed"
        );
        assert_eq!(bridge_blocks_passed_chain_bound(&harness), 1);

        let (left, right) = harness.render(4);
        assert_eq!(
            left,
            vec![1.5; 4],
            "an audible monitor renders the plugin over the track's own signal"
        );
        assert_eq!(right, left);
        assert_eq!(
            plugin.calls.load(Ordering::Relaxed),
            1,
            "exactly one process call for the block that was rendered"
        );
    }

    /// The switch itself. A plugin driven twice in the block the gate moves —
    /// or not at all — is a click on the cutover, so the count is checked per
    /// block on both sides of the toggle rather than only at the ends.
    #[test]
    fn toggling_the_monitor_shadow_hands_a_bridged_plugin_over_one_block_at_a_time() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::SetMonitorShadow(true));
        let mut plugin = track_carrying_a_bridged_plugin(&mut harness, 1, 7, 0.5);

        let mut expected_calls = 0;
        for block in 0..6 {
            if block == 3 {
                harness.send(GraphCommand::SetMonitorShadow(false));
            }
            let shadowed = block < 3;

            relay_one_block(&mut plugin, &mut harness, 0.25);
            harness.send(GraphCommand::SeekFrames(0));
            let (left, _) = harness.render(4);

            expected_calls += 1;
            assert_eq!(
                plugin.calls.load(Ordering::Relaxed),
                expected_calls,
                "block {block} must drive the plugin exactly once, on one path"
            );
            let expected_output = if shadowed { 1.0 } else { 1.5 };
            assert_eq!(
                left,
                vec![expected_output; 4],
                "block {block} must be rendered by the path the gate names"
            );
            let returned = plugin
                .handle
                .pop_output()
                .expect("the bridge returns a block");
            let expected_return = if shadowed { 0.75 } else { 0.25 };
            assert_eq!(
                &returned.left[..4],
                &[expected_return; 4],
                "block {block} must return the app's audio from the path the gate names"
            );
        }

        assert_eq!(bridge_blocks_passed_chain_bound(&harness), 3);
    }

    /// A hosted plugin taken off a strip goes back to running nowhere, not onto
    /// the master insert chain: its lifetime belongs to the load that created
    /// it, and the master chain is the whole mix.
    #[test]
    fn a_bridged_plugin_taken_off_a_chain_runs_nowhere_rather_than_on_the_master_mix() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::SetMonitorShadow(true));
        let mut plugin = track_carrying_a_bridged_plugin(&mut harness, 1, 7, 0.5);

        harness.send(GraphCommand::RemoveTrackDevice {
            track_id: 1,
            effect_id: 7,
        });
        let slot = harness
            .scheduler
            .effect_index
            .lookup(7)
            .expect("the removal must not unload the plugin");
        assert_eq!(
            harness.scheduler.effects[slot].placement,
            EffectPlacement::Detached
        );

        // The mix is guarded twice over, and the placement above is the guard
        // this test owns: the master walk also skips a bridged effect, so these
        // two renders hold the same law from the other side — the whole mix
        // stays the track's own signal on either side of the gate.
        harness.send(GraphCommand::SeekFrames(0));
        let (shadowed, _) = harness.render(4);
        assert_eq!(shadowed, vec![1.0; 4]);

        harness.send(GraphCommand::SetMonitorShadow(false));
        harness.send(GraphCommand::SeekFrames(0));
        let (audible, _) = harness.render(4);
        assert_eq!(
            audible,
            vec![1.0; 4],
            "a released hosted plugin must not process the master mix"
        );

        // Its bridge still drains, so the app keeps its audio and the ring
        // keeps moving for a plugin no chain holds.
        relay_one_block(&mut plugin, &mut harness, 0.25);
        assert!(plugin.handle.pop_output().is_some());
    }

    /// Bypass is the professional convention on the inline path too: the
    /// instance keeps its state, passes the strip's signal through untouched,
    /// and discards MIDI queued while it was bypassed rather than banking a
    /// burst of stale note-ons for the moment it is enabled.
    #[test]
    fn a_bypassed_chain_bound_plugin_passes_the_strip_through_and_discards_queued_midi() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::SetMonitorShadow(false));
        let plugin = track_carrying_a_bridged_plugin(&mut harness, 1, 7, 0.5);
        harness.send(GraphCommand::SetBypass(7, true));
        harness.send(GraphCommand::SendMidiNote(7, note_on(60)));

        let (left, _) = harness.render(4);
        assert_eq!(
            left,
            vec![1.0; 4],
            "a bypassed device passes the strip's signal through untouched"
        );
        assert_eq!(plugin.calls.load(Ordering::Relaxed), 0);
        assert_eq!(plugin.midi_events.load(Ordering::Relaxed), 0);

        // Un-bypassed, the note queued while bypassed must not arrive late.
        harness.send(GraphCommand::SetBypass(7, false));
        harness.send(GraphCommand::SeekFrames(0));
        let (enabled, _) = harness.render(4);
        assert_eq!(enabled, vec![1.5; 4]);
        assert_eq!(
            plugin.midi_events.load(Ordering::Relaxed),
            0,
            "MIDI queued while bypassed is discarded, never banked"
        );

        // A note sent while it is enabled still reaches it, so the silence
        // above is the discard and not a device nothing addresses.
        harness.send(GraphCommand::SendMidiNote(7, note_on(60)));
        harness.send(GraphCommand::SeekFrames(0));
        harness.render(4);
        assert_eq!(plugin.midi_events.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn a_removed_send_stops_feeding_its_bus() {
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::AddSend {
            track_id: 1,
            bus_id: 50,
            tap: SendTap::PreFader,
            level: 1.0,
        });
        // Muted, so the bus hears the send alone and nothing of the track's
        // own output.
        harness.send(GraphCommand::SetTrackMute(1, true));

        let (before, _) = harness.render(4);
        assert_eq!(before, vec![1.0; 4]);

        harness.send(GraphCommand::RemoveSend {
            track_id: 1,
            bus_id: 50,
        });
        harness.send(GraphCommand::SeekFrames(0));
        let (after, _) = harness.render(4);
        assert_eq!(after, vec![0.0; 4]);
        assert_eq!(harness.scheduler.timeline().send_tap(1, 50), None);
    }

    #[test]
    fn a_bus_insert_is_placed_on_that_bus_and_detaches_when_the_bus_goes() {
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::AddPlugin(
            7,
            Box::new(ScalingPlugin { factor: 0.5 }),
        ));
        harness.send(GraphCommand::AddSend {
            track_id: 1,
            bus_id: 50,
            tap: SendTap::PostFader,
            level: 1.0,
        });
        harness.send(GraphCommand::InsertBusDevice {
            bus_id: 50,
            entry: effect(7),
            index: 0,
        });

        // The effect runs on the bus, not on the master chain: the track's own
        // output reaches the sum untouched and only the send is halved. A bus
        // insert left on the master chain would have halved both, giving 0.75.
        assert_eq!(
            harness.scheduler.effects[0].placement,
            EffectPlacement::Bus(50)
        );
        let (left, _) = harness.render(4);
        assert_eq!(left, vec![1.5; 4]);

        // The bus's inserts outlive the bus and stop processing, exactly as a
        // track's do — falling back onto the master mix would put a deleted
        // bus's reverb across everything.
        harness.send(GraphCommand::RemoveBus(50));
        assert_eq!(
            harness.scheduler.effects[0].placement,
            EffectPlacement::Detached
        );
        harness.send(GraphCommand::SeekFrames(0));
        let (after, _) = harness.render(4);
        assert_eq!(after, vec![1.0; 4]);
    }

    #[test]
    fn stopping_the_transport_drops_the_automation_window_the_stop_made_stale() {
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 16);
        harness.send(GraphCommand::AutomateParam {
            target: AutomationTarget::TrackGain(1),
            write: AutomationWrite::Append(AutomationEvent {
                at_frame: 8,
                duration_frames: 0,
                value: 0.5,
                shape: RampShape::Step,
            }),
        });

        let (first, _) = harness.render(4);
        assert_eq!(first, vec![1.0; 4]);

        // Stopping at frame 4 holds every parameter and drops what each had
        // queued: the window was pushed ahead of a playhead that no longer
        // advances, and the control thread that owns the curve re-issues it.
        harness.send(GraphCommand::SetTransport(TransportState::default()));
        harness.playing();
        let (second, _) = harness.render(8);
        assert_eq!(
            second,
            vec![1.0; 8],
            "a change stamped past the stop must not fire on its own later"
        );
    }

    #[test]
    fn a_locate_drops_the_automation_beyond_it_and_keeps_what_it_passed_over() {
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 16);
        for (at_frame, value) in [(4u64, 0.5_f32), (12, 0.25)] {
            harness.send(GraphCommand::AutomateParam {
                target: AutomationTarget::TrackGain(1),
                write: AutomationWrite::Append(AutomationEvent {
                    at_frame,
                    duration_frames: 0,
                    value,
                    shape: RampShape::Step,
                }),
            });
        }

        harness.send(GraphCommand::SeekFrames(8));
        let (left, _) = harness.render(8);

        // The change the locate skipped lands and puts the fader on the curve
        // where the playhead now stands. The one beyond the locate is gone: it
        // belongs to the window the control thread pushed for the old position
        // and re-issues for the new one. Kept, frames 12 onward would drop to
        // 0.25 without anyone asking.
        assert_eq!(left, vec![0.5; 8]);
    }

    /// rtrb publishes per element, so a live block boundary can land while
    /// only a prefix of a batch is visible. The fence must make that window
    /// unobservable: until the whole batch is visible, the block renders the
    /// pre-batch graph — never a new strip at its parameter defaults because
    /// its frame-0 state write had not crossed yet.
    #[test]
    fn a_fenced_batch_with_a_split_visible_prefix_renders_the_pre_batch_graph() {
        let mut harness = Harness::new(32);
        harness.playing();

        // The batch: a track, its clip, and its frame-0 fader state (0.5).
        // Deliberately split: the fence, the track and the clip are visible,
        // the state write is not — the exact window where an unfenced drain
        // rendered the strip at the RampedParam default of 1.0.
        assert!(harness
            .command_tx
            .push(GraphCommand::BeginBatch { commands: 3 })
            .is_ok());
        assert!(harness
            .command_tx
            .push(GraphCommand::AddTrack(TimelineTrack::new(1)))
            .is_ok());
        assert!(harness
            .command_tx
            .push(GraphCommand::AddClip(
                1,
                TimelineClip::new(
                    9,
                    vec![0.5; 64].into(),
                    [].into(),
                    placement(0, 0, 64),
                    ClipPlayback::at_gain(1.0),
                ),
            ))
            .is_ok());

        harness.scheduler.update_graph();
        let (split, _) = harness.render(4);
        assert_eq!(
            split,
            vec![0.0; 4],
            "a partially visible batch must leave the pre-batch graph rendering"
        );
        assert_eq!(harness.scheduler.timeline().track_count(), 0);

        // The batch completes: everything applies together, and the strip is
        // first observable with its authored state, never with the default.
        assert!(harness
            .command_tx
            .push(GraphCommand::AutomateParam {
                target: AutomationTarget::TrackGain(1),
                write: AutomationWrite::Replace(AutomationEvent {
                    at_frame: 0,
                    duration_frames: 0,
                    value: 0.5,
                    shape: RampShape::Step,
                }),
            })
            .is_ok());
        harness.scheduler.update_graph();
        assert_eq!(harness.scheduler.timeline().track_count(), 1);

        // The frame-0 stamp is behind the playhead now; it resolves to its
        // end state, so the strip is first heard at its authored 0.5 fader.
        let (complete, _) = harness.render(4);
        assert_eq!(
            complete,
            vec![0.25; 4],
            "the post-batch graph renders the authored 0.5 material * 0.5 fader"
        );
    }

    /// Retirement backpressure used to suspend a drain mid-batch
    /// (`flush_pending_retirement` returning early). It must now defer only
    /// at batch boundaries: a batch whose worst-case retirements the ring
    /// cannot absorb is deferred whole, and applies whole once the reclaimer
    /// frees slots.
    #[test]
    fn retirement_backpressure_defers_a_fenced_batch_whole_at_its_boundary() {
        let (mut command_tx, command_rx) = RingBuffer::new(16);
        let (retired_tx, mut retired_rx) = RingBuffer::new(4);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);

        // Occupy the retirement ring with two unreclaimed objects.
        for id in [1, 2] {
            command_tx
                .push(GraphCommand::AddTrack(TimelineTrack::new(id)))
                .unwrap();
            command_tx.push(GraphCommand::RemoveTrack(id)).unwrap();
        }
        scheduler.update_graph();
        assert_eq!(scheduler.timeline().track_count(), 0);

        // A three-command batch needs three retirement slots plus the
        // reserved shutdown slot; only two are free, so the batch defers
        // whole — the graph shows none of it.
        command_tx
            .push(GraphCommand::BeginBatch { commands: 3 })
            .unwrap();
        command_tx
            .push(GraphCommand::AddTrack(TimelineTrack::new(7)))
            .unwrap();
        command_tx
            .push(GraphCommand::AddTrack(TimelineTrack::new(8)))
            .unwrap();
        command_tx.push(GraphCommand::RemoveTrack(8)).unwrap();
        scheduler.update_graph();
        assert_eq!(
            scheduler.timeline().track_count(),
            0,
            "a batch the retirement ring cannot absorb must not partially apply"
        );

        // The reclaimer catches up; the next drain applies the batch whole.
        while retired_rx.pop().is_ok() {}
        scheduler.update_graph();
        assert_eq!(scheduler.timeline().track_count(), 1);
        assert!(scheduler.timeline().track(7).is_some());
    }

    /// The tempo-ownership law: the graph transport owns playback state and
    /// song position; tempo and time signature belong to the plugin-transport
    /// path and survive a graph write untouched. Before this law a graph
    /// set-transport assigned the whole state and reset a live session to the
    /// 120 BPM 4/4 engine default.
    #[test]
    fn a_graph_transport_write_preserves_plugin_visible_tempo_and_time_signature() {
        let mut harness = Harness::new(16);
        harness.send(GraphCommand::SetTransport(TransportState {
            tempo: 174.0,
            time_sig_num: 7,
            time_sig_denom: 8,
            is_playing: true,
            song_pos_beats: 0.0,
            song_pos_seconds: 0.0,
        }));

        harness.send(GraphCommand::SetTransportPlayback {
            is_playing: true,
            song_pos_seconds: 10.0,
        });

        let transport = harness.scheduler.transport;
        assert_eq!(transport.tempo, 174.0);
        assert_eq!(transport.time_sig_num, 7);
        assert_eq!(transport.time_sig_denom, 8);
        assert!(transport.is_playing);
        assert_eq!(transport.song_pos_seconds, 10.0);
        // Beats re-derive from the tempo the write does not own: 10 s at
        // 174 BPM is exactly 29 quarter-note beats.
        assert_eq!(transport.song_pos_beats, 29.0);
    }

    /// A stop through the graph transport is still a stop: it holds every
    /// mixer parameter and drops the automation window the stop made stale,
    /// exactly as the plugin-transport stop does.
    #[test]
    fn a_graph_transport_stop_drops_the_automation_window_the_stop_made_stale() {
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 16);
        harness.send(GraphCommand::AutomateParam {
            target: AutomationTarget::TrackGain(1),
            write: AutomationWrite::Append(AutomationEvent {
                at_frame: 8,
                duration_frames: 0,
                value: 0.5,
                shape: RampShape::Step,
            }),
        });

        let (first, _) = harness.render(4);
        assert_eq!(first, vec![1.0; 4]);

        harness.send(GraphCommand::SetTransportPlayback {
            is_playing: false,
            song_pos_seconds: 0.0,
        });
        harness.playing();
        let (second, _) = harness.render(8);
        assert_eq!(
            second,
            vec![1.0; 8],
            "a change stamped past the stop must not fire on its own later"
        );
    }

    /// Counts the note-ons its chain hands it, so a MIDI FX whose clock is the
    /// transport can be observed by how often it fires rather than by reading
    /// its own state.
    struct NoteOnCountingPlugin {
        note_ons: Arc<AtomicUsize>,
    }

    impl NativePlugin for NoteOnCountingPlugin {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

        fn process_with_events(
            &mut self,
            _left: &mut [f32],
            _right: &mut [f32],
            _num_samples: usize,
            midi_events: &[MidiNoteEvent],
            _transport: &TransportState,
        ) {
            let note_ons = midi_events.iter().filter(|event| event.is_note_on).count();
            self.note_ons.fetch_add(note_ons, Ordering::Relaxed);
        }

        fn name(&self) -> &str {
            "note-on-counting-plugin"
        }

        fn accepts_midi(&self) -> bool {
            true
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// The device period the transport tests render on: small enough that a
    /// tempo-driven step lands close to the frame it names, and a divisor of
    /// one second at 48 kHz so a test can split its render on a second.
    const TRANSPORT_TEST_BLOCK: usize = 480;

    /// Render `frames` frames the way a device does — a sequence of callbacks,
    /// not one buffer. `process_block` clamps a single call to
    /// [`MAX_CALLBACK_FRAMES`], so a test that asked for a second in one call
    /// would silently render a fraction of it.
    fn render_frames(harness: &mut Harness, frames: usize) {
        let mut rendered = 0;
        while rendered < frames {
            let block = (frames - rendered).min(TRANSPORT_TEST_BLOCK);
            harness.render(block);
            rendered += block;
        }
    }

    fn tempo_maps(segments: &[TempoSegment]) -> Box<TransportMaps> {
        Box::new(TransportMaps {
            tempo: TempoMap::new(segments, 48_000.0).expect("the test map is well formed"),
            time_signature: TimeSignatureMap::flat(4, 4).expect("4/4 is well formed"),
            sample_rate: 48_000.0,
        })
    }

    /// The map is the transport's clock: tempo, meter and beat position at the
    /// playhead all come from it, and the beat position is the integral across
    /// every segment rather than the current tempo scaled by elapsed time.
    #[test]
    fn the_transport_reads_tempo_meter_and_beats_from_the_map_at_the_playhead() {
        let mut harness = Harness::new(16);
        harness.playing();
        harness.send(GraphCommand::SetTransportMaps(Box::new(TransportMaps {
            tempo: TempoMap::new(
                &[
                    TempoSegment {
                        start_frame: 0,
                        beats_per_minute: 120.0,
                    },
                    TempoSegment {
                        start_frame: 48_000,
                        beats_per_minute: 240.0,
                    },
                ],
                48_000.0,
            )
            .expect("the test map is well formed"),
            time_signature: TimeSignatureMap::new(&[
                TimeSignatureSegment {
                    start_frame: 0,
                    numerator: 4,
                    denominator: 4,
                },
                TimeSignatureSegment {
                    start_frame: 48_000,
                    numerator: 7,
                    denominator: 8,
                },
            ])
            .expect("the test meter map is well formed"),
            sample_rate: 48_000.0,
        })));

        render_frames(&mut harness, 48_000);
        let transport = harness.scheduler.transport;
        assert_eq!(transport.tempo, 120.0);
        assert_eq!((transport.time_sig_num, transport.time_sig_denom), (4, 4));
        // The final span of that render starts one block short of the change.
        assert!(transport.song_pos_beats < 2.0);

        render_frames(&mut harness, 48_000);
        let transport = harness.scheduler.transport;
        assert_eq!(transport.tempo, 240.0);
        assert_eq!((transport.time_sig_num, transport.time_sig_denom), (7, 8));
        // Two beats of 120 plus almost four of 240. The flat-scalar answer the
        // map replaces would scale the whole elapsed time by the *current*
        // tempo and land near eight.
        assert!(transport.song_pos_beats > 5.0 && transport.song_pos_beats < 6.0);
    }

    /// The tempo map moves the output, not just a readout: the arpeggiator's
    /// step clock is `song_pos_beats`, so a tempo change inside the render
    /// changes the frames its notes land on. Doubling the tempo doubles the
    /// steps the same span of frames holds.
    #[test]
    fn a_tempo_change_shifts_the_frames_the_arpeggiator_emits_on() {
        const SECOND: usize = 48_000;

        let steps_per_second = |segments: &[TempoSegment]| {
            let mut harness = Harness::new(32);
            let note_ons = Arc::new(AtomicUsize::new(0));
            harness.send(GraphCommand::AddPlugin(
                1,
                Box::new(NoteOnCountingPlugin {
                    note_ons: Arc::clone(&note_ons),
                }),
            ));
            harness.send(GraphCommand::AddMidiFx(1, MidiFxKind::Arpeggiator.build()));
            harness.send(GraphCommand::SetTransportMaps(tempo_maps(segments)));
            harness.playing();
            // One held note is the whole chord: the arp keeps its active-note
            // list across blocks and steps on the transport alone.
            harness.send(GraphCommand::SendMidiNote(1, note_on(60)));

            render_frames(&mut harness, SECOND);
            let first_second = note_ons.load(Ordering::Relaxed);
            render_frames(&mut harness, SECOND);
            (
                first_second,
                note_ons.load(Ordering::Relaxed) - first_second,
            )
        };

        // The arp's default rate is a sixteenth note, so 120 BPM is eight steps
        // a second and 240 BPM is sixteen.
        let (flat_first, flat_second) = steps_per_second(&[TempoSegment {
            start_frame: 0,
            beats_per_minute: 120.0,
        }]);
        assert_eq!((flat_first, flat_second), (8, 8));

        let (changed_first, changed_second) = steps_per_second(&[
            TempoSegment {
                start_frame: 0,
                beats_per_minute: 120.0,
            },
            TempoSegment {
                start_frame: SECOND as u64,
                beats_per_minute: 240.0,
            },
        ]);
        assert_eq!((changed_first, changed_second), (8, 16));
    }

    /// A track carrying a clip whose every sample names its own timeline
    /// frame, so a rendered buffer reads back as the sequence of frames the
    /// engine actually played.
    fn track_with_frame_stamped_clip(harness: &mut Harness, track_id: usize, frames: usize) {
        let material: Arc<[f32]> = (0..frames).map(|frame| (frame + 1) as f32).collect();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(track_id)));
        harness.send(GraphCommand::AddClip(
            track_id,
            TimelineClip::new(
                1,
                material,
                [].into(),
                placement(0, 0, frames as u64),
                ClipPlayback::at_gain(1.0),
            ),
        ));
    }

    /// The loop seam is closed on its own sample. Every frame of the region is
    /// played exactly once per pass: a seam that dropped a frame would skip a
    /// stamp, and one that doubled a frame would repeat the region's last.
    #[test]
    fn a_loop_wraps_on_the_region_boundary_without_dropping_or_doubling_a_frame() {
        const LOOP_START: u64 = 512;
        const LOOP_END: u64 = 1_536;
        const MATERIAL: usize = 4_096;

        let mut harness = Harness::new(32);
        track_with_frame_stamped_clip(&mut harness, 1, MATERIAL);
        harness.send(GraphCommand::SetLoopRegion(LoopRegion {
            enabled: true,
            start_frame: LOOP_START,
            end_frame: LOOP_END,
        }));
        harness.playing();
        harness.send(GraphCommand::SeekFrames(LOOP_START));

        // One callback long enough to hold the seam and keep going past it.
        let (left, _right) = harness.render(1_536);

        let stamp_at = |frame: u64| (frame + 1) as f32;
        let expected: Vec<f32> = (LOOP_START..LOOP_END)
            .chain(LOOP_START..LOOP_START + 512)
            .map(stamp_at)
            .collect();
        assert_eq!(left, expected);

        // And the playhead stands where the last rendered frame left it, one
        // wrap later.
        let position = harness.scheduler.transport_position();
        assert_eq!(position.playhead_frame, LOOP_START + 512);
        assert_eq!(position.loop_wraps, 1);
    }

    /// A loop region the engine refuses to honour changes nothing: playback
    /// runs straight through it. The floor exists to bound the seam split, so
    /// a region under it must be inert rather than half-applied.
    #[test]
    fn a_loop_region_shorter_than_the_floor_plays_straight_through() {
        const MATERIAL: usize = 2_048;

        let mut harness = Harness::new(32);
        track_with_frame_stamped_clip(&mut harness, 1, MATERIAL);
        harness.send(GraphCommand::SetLoopRegion(LoopRegion {
            enabled: true,
            start_frame: 0,
            end_frame: crate::transport_map::MIN_LOOP_FRAMES - 1,
        }));
        harness.playing();

        let (left, _right) = harness.render(1_024);

        let expected: Vec<f32> = (0..1_024u64).map(|frame| (frame + 1) as f32).collect();
        assert_eq!(left, expected);
        assert_eq!(harness.scheduler.transport_position().loop_wraps, 0);
    }

    /// A wrap keeps the automation the first pass never reached. The graph
    /// holds a window rather than a curve, so a wrap that treated itself as a
    /// locate would drop the whole region's queue and leave every later pass
    /// running on the level the first pass ended on.
    #[test]
    fn a_loop_wrap_keeps_the_automation_the_first_pass_had_not_reached() {
        const LOOP_END: u64 = 1_024;

        let mut harness = Harness::new(32);
        track_with_constant_clip(&mut harness, 1, 9, 1.0, 4_096);
        harness.send(GraphCommand::SetLoopRegion(LoopRegion {
            enabled: true,
            start_frame: 0,
            end_frame: LOOP_END,
        }));
        harness.playing();
        // Stamped inside the region and never reached on the first pass,
        // because that pass only renders as far as frame 512.
        harness.send(GraphCommand::AutomateParam {
            target: AutomationTarget::TrackGain(1),
            write: AutomationWrite::Append(AutomationEvent {
                at_frame: 768,
                duration_frames: 0,
                value: 0.25,
                shape: RampShape::Step,
            }),
        });

        let (first, _) = harness.render(512);
        assert_eq!(first, vec![1.0; 512]);

        // Second callback runs 512 → 1024, wraps, then 0 → 512 again. The
        // stamp at 768 falls inside it and must still be there.
        let (second, _) = harness.render(1_024);
        assert_eq!(second[0], 1.0, "before the stamp the gain is still unity");
        assert_eq!(second[256], 0.25, "the stamp at frame 768 landed");
        assert_eq!(
            second[512], 0.25,
            "and the level it set carries across the seam"
        );
        assert_eq!(harness.scheduler.transport_position().loop_wraps, 1);
    }

    /// The ledger's release evidence across a seam. The published playhead is
    /// back at the loop start the moment a pass ends, so it can never prove a
    /// stamp inside the region was consumed; `last_wrap_frame` states the frame
    /// the closing pass walked to, which is exactly that proof.
    #[test]
    fn the_progress_echo_reports_the_frame_each_loop_seam_walked_to() {
        const LOOP_END: u64 = 1_024;

        let mut harness = Harness::new(16);
        harness.send(GraphCommand::SetLoopRegion(LoopRegion {
            enabled: true,
            start_frame: 0,
            end_frame: LOOP_END,
        }));
        harness.playing();

        // Nothing has wrapped yet, so there is no seam to report.
        harness.render(512);
        let before = harness.scheduler.graph_progress();
        assert_eq!(before.loop_wraps, 0);
        assert_eq!(before.last_wrap_frame, 0);

        harness.render(512);
        let closed = harness.scheduler.graph_progress();
        assert_eq!(closed.loop_wraps, 1);
        assert_eq!(
            closed.last_wrap_frame, LOOP_END,
            "the pass walked to the region's end before the seam closed"
        );
        assert_eq!(
            closed.playhead_frame, 0,
            "and the playhead alone proves nothing about the region it just walked"
        );

        // The seam is not a one-off: every pass restates the frame it reached.
        harness.render(LOOP_END as usize);
        let again = harness.scheduler.graph_progress();
        assert_eq!(again.loop_wraps, 2);
        assert_eq!(again.last_wrap_frame, LOOP_END);
    }

    /// The position channel is the cursor's, and separate from the ledger's on
    /// purpose: reading it must not disturb what the ledger's own snapshot
    /// says.
    #[test]
    fn the_position_channel_reports_the_transport_without_touching_the_ledgers() {
        let mut harness = Harness::new(16);
        harness.playing();
        harness.render(256);

        let position = harness.scheduler.transport_position();
        assert!(position.playing);
        assert_eq!(position.playhead_frame, 256);
        assert_eq!(position.loop_wraps, 0);
        assert_eq!(position.tempo, 120.0);
        assert_eq!((position.time_sig_num, position.time_sig_denom), (4, 4));

        // The ledger's own snapshot still answers its own question.
        assert_eq!(harness.scheduler.graph_progress().playhead_frame, 256);
        assert_eq!(harness.scheduler.graph_progress().batches_applied, 0);
    }

    /// The cursor's channel carries the ledger's batch count, and carries the
    /// same number the ledger's own snapshot reports.
    ///
    /// A consumer holds this count against the fence a command was admitted at
    /// to decide whether this position postdates that command. Read from the
    /// progress channel instead, it would be a count from one callback beside a
    /// playhead from another, because the two channels are published in
    /// sequence and a reader between them sees only one of the two writes.
    #[test]
    fn the_position_channel_carries_the_batch_count_the_ledger_reports() {
        let mut harness = Harness::new(16);
        harness.playing();
        assert_eq!(harness.scheduler.transport_position().batches_applied, 0);

        // Two fenced batches, each pushed whole before the drain runs: the
        // fence defers the drain until every command of it is visible.
        for track_id in [1_usize, 2] {
            harness
                .command_tx
                .push(GraphCommand::BeginBatch { commands: 1 })
                .expect("the fence fits");
            harness
                .command_tx
                .push(GraphCommand::AddTrack(TimelineTrack::new(track_id)))
                .expect("the body fits");
            harness.scheduler.update_graph();
        }
        harness.render(256);

        let position = harness.scheduler.transport_position();
        assert_eq!(position.batches_applied, 2);
        assert_eq!(
            position.batches_applied,
            harness.scheduler.graph_progress().batches_applied,
            "one count, however many channels report it"
        );
        assert_eq!(position.playhead_frame, 256);
    }

    /// The maps arrive built and leave through the retirement channel, exactly
    /// as every other owning payload does: the callback never builds one and
    /// never frees one (ADR 0020).
    #[test]
    fn installing_new_maps_retires_the_pair_they_replaced() {
        let mut harness = Harness::new(16);
        harness.send(GraphCommand::SetTransportMaps(tempo_maps(&[
            TempoSegment {
                start_frame: 0,
                beats_per_minute: 100.0,
            },
        ])));
        assert!(
            harness.retired_rx.pop().is_err(),
            "the first install replaces nothing, so it retires nothing"
        );

        harness.send(GraphCommand::SetTransportMaps(tempo_maps(&[
            TempoSegment {
                start_frame: 0,
                beats_per_minute: 200.0,
            },
        ])));
        assert!(
            harness.retired_rx.pop().is_ok(),
            "the replaced pair leaves over the retirement ring"
        );

        harness.playing();
        harness.render(48_000);
        assert_eq!(harness.scheduler.transport.tempo, 200.0);
    }

    /// A tempo map's beat integral is a function of the rate it was built
    /// against, so a map for another rate is refused rather than read here —
    /// and refused the same way everything else is, by retiring the box the
    /// callback did not take.
    #[test]
    fn a_map_built_for_another_sample_rate_is_retired_unapplied() {
        let mut harness = Harness::new(16);
        harness.send(GraphCommand::SetTransportMaps(tempo_maps(&[
            TempoSegment {
                start_frame: 0,
                beats_per_minute: 100.0,
            },
        ])));
        assert!(harness.retired_rx.pop().is_err());

        // The harness opens at 48 kHz; this pair was integrated at 44.1 kHz.
        harness.send(GraphCommand::SetTransportMaps(Box::new(TransportMaps {
            tempo: TempoMap::flat(200.0, 44_100.0).expect("a flat map is well formed"),
            time_signature: TimeSignatureMap::flat(3, 4).expect("3/4 is well formed"),
            sample_rate: 44_100.0,
        })));
        assert!(
            harness.retired_rx.pop().is_ok(),
            "the refused pair leaves over the retirement ring rather than being freed here"
        );

        harness.playing();
        harness.render(48_000);
        // The 100 BPM map built for this rate is still the one in force. Had
        // the refused map been installed, the transport would read 200 BPM and
        // 3/4, and every beat position it reported would be 8.8% adrift.
        assert_eq!(harness.scheduler.transport.tempo, 100.0);
        assert_eq!(
            (
                harness.scheduler.transport.time_sig_num,
                harness.scheduler.transport.time_sig_denom
            ),
            (4, 4)
        );
    }
}
