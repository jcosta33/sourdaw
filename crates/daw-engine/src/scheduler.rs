//! Lock-free Messaging and Task Schedule for the native audio engine.
//!
//! Handles both built-in DSP effects (Knead) and external plugins (CLAP/VST3)
//! via the NativePlugin trait. All communication is lock-free via rtrb.

use crate::audio_thread::MAX_CALLBACK_FRAMES;
#[cfg(test)]
use crate::midi::diagnostics::active_midi_rt_diagnostics_channel;
use crate::midi::diagnostics::{ActiveMidiRtDiagnostics, ActiveMidiRtDiagnosticsSnapshot};
use crate::midi::note_store::{MidiNoteStore, NoteAddressSet, TimedMidiNote};
use crate::midi_fx::{
    Arpeggiator, MidiEventBuffer, MidiFx, MidiFxChain, MidiFxParam, ProbabilityEvaluator,
    VelocityScaler,
};
use crate::pdc::{CompensationDelay, MAX_COMPENSATION_FRAMES};
use crate::plugin_slot::{CaptureInputBlock, MidiNoteEvent, NativePlugin, TransportState};
use crate::timeline::{
    timeline_rt_diagnostics_channel, AutomationTarget, AutomationWrite, ChainEntry, ClipPlacement,
    ClipPlayback, CompensationDevices, DeviceChain, DeviceParam, DeviceParamEvent,
    DeviceParamQueue, DeviceParamTarget, RetiredTimelineObject, RouteTarget, SendTap, TimelineBus,
    TimelineClip, TimelineGraph, TimelineRtDiagnosticsSnapshot, TimelineTrack, MAX_BUS_DEVICES,
    MAX_TIMELINE_BUSES, MAX_TIMELINE_TRACKS, MAX_TRACK_DEVICES,
};
use crate::transport_map::{LoopRegion, TransportMaps};
use daw_dsp::fermenter::FermenterInstance;
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
    Fermenter,
}

impl BuiltinEffectType {
    /// The wire name this type is addressed by. Its inverse is
    /// [`Self::from_name`], so the named and the addressed paths cannot drift
    /// into meaning different things.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Knead => "knead",
            Self::Fermenter => "fermenter",
        }
    }

    /// Resolve a wire name onto its address. `None` refuses the name
    /// control-side: the scheduler has no built-in under that name, and an
    /// unknown name cannot cross the ring as a fixed-size address.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "knead" => Some(Self::Knead),
            "fermenter" => Some(Self::Fermenter),
            _ => None,
        }
    }

    /// Whether this built-in turns notes into audio, and so is a body a note
    /// store belongs on.
    ///
    /// The enum is the registry for it, so every route that registers a
    /// built-in — the engine handle's own, and the graph mapper's — decides
    /// the store from the type alone and cannot disagree with the other about
    /// what an instrument is.
    pub const fn sounds_notes(self) -> bool {
        match self {
            Self::Knead => false,
            Self::Fermenter => true,
        }
    }
}

/// Commands sent from the UI/main thread to the audio thread (lock-free via rtrb).
pub enum GraphCommand {
    // Built-in effects
    /// Register a built-in effect, already built control-side
    /// ([`PluginCore::builtin`]), on the master insert chain — the crate's
    /// original chain.
    ///
    /// The command owns the instance from the push to the apply, on the same
    /// contract as [`GraphCommand::AddPlugin`]: the audio thread installs it
    /// or retires it, and never constructs or frees one (ADR 0020).
    ///
    /// The note store travels with it, `Some` exactly for a built-in that
    /// sounds notes ([`BuiltinEffectType::sounds_notes`]). A built-in
    /// instrument is scheduled against like any hosted one, and a store built
    /// anywhere but the control thread would be an allocation on the callback.
    AddEffect(usize, PluginCore, Option<Box<MidiNoteStore>>),
    /// Register a built-in effect, already built control-side, detached from
    /// every chain.
    ///
    /// The graph transport's form: its effect exists only once the
    /// `InsertTrackDevice`/`InsertBusDevice` that follows it lands, and the
    /// commands cross the ring one at a time, so a callback can drain between
    /// the two. An effect registered onto the master chain in that window
    /// would render one block of the *entire mix* through a device the user
    /// put on one strip; a detached one renders nowhere until it is placed.
    ///
    /// Its note store travels with it on the same terms as
    /// [`GraphCommand::AddEffect`]'s.
    AddDetachedEffect(usize, PluginCore, Option<Box<MidiNoteStore>>),
    SetParam(usize, DeviceParam, f32),
    SetBypass(usize, bool),
    /// State how many frames a device delays its own output by, so the graph
    /// can hold everything that arrives at a summing point beside it back to
    /// the same depth.
    ///
    /// `latency_frames` is the device's own claim, uncorrected: it is what the
    /// arrivals are computed from and what the diagnostics report, and the
    /// compensation ceiling is applied where a delay is aimed rather than here.
    /// `dry_delay` is the line that runs in the device's place while it is
    /// bypassed — `Some` exactly when the device declares latency — built on
    /// the control thread by [`crate::pdc::CompensationDelay::for_latency`],
    /// because the audio thread may neither build one nor free one (ADR 0020).
    /// The line this command replaces leaves over the retirement channel.
    SetEffectLatency {
        effect_id: usize,
        latency_frames: usize,
        dry_delay: Option<Box<CompensationDelay>>,
    },

    // External plugins (CLAP/VST3/AU)
    /// Register a plugin instance on the master insert chain, with the note
    /// store it plays from.
    ///
    /// The store is `Some` for an instrument and `None` for everything else.
    /// A device with no store refuses [`GraphCommand::ScheduleMidiNotes`] and
    /// counts the refusal, which is the honest answer for a body that has
    /// nothing to sound a note with; building one on the audio thread instead
    /// is the allocation ADR 0020 forbids.
    AddPlugin(usize, Box<dyn NativePlugin>, Option<Box<MidiNoteStore>>),
    /// Register a hosted plugin instance, homed detached rather than on the
    /// master insert chain.
    ///
    /// A hosted instance belongs to the load that created it. Homed on the
    /// master chain it would render the whole mix through that instance the
    /// moment a user took it off a strip; homed detached, releasing it from a
    /// chain returns it to a placement that runs nowhere.
    ///
    /// Its note store travels with it, unconditionally: a hosted instance is
    /// the route every external instrument arrives on, and one registered
    /// without a store could never be scheduled against.
    AddHostedPlugin(usize, Box<dyn NativePlugin>, Box<MidiNoteStore>),
    /// Retire a registered plugin, handing the instance off the callback
    /// thread.
    RemovePlugin(usize),

    // MIDI events (routed to a specific plugin by ID)
    /// Play one note at the head of the next block this plugin is handed.
    ///
    /// The live path: a note struck on a keyboard has no timeline position to
    /// stamp it against, so it is delivered as soon as the plugin renders and
    /// its `frame_offset` is zero. A note that does have a position is written
    /// with [`GraphCommand::ScheduleMidiNotes`] instead.
    ///
    /// The channel and note are not checked against the addresses the store
    /// refuses, because a live note is never tracked as sounding and so is
    /// never owed a release something would have to address.
    SendMidiNote(usize, MidiNoteEvent),
    /// Write a batch of timeline-addressed notes into a plugin's note store.
    ///
    /// The batch is built control-side and lands whole or not at all: a plugin
    /// with no store, or a batch past the store's free capacity, is refused
    /// and counted rather than stored in part. The box leaves over the
    /// retirement channel, because the audio thread may not free one.
    ScheduleMidiNotes {
        plugin_id: usize,
        notes: Box<[TimedMidiNote]>,
    },
    /// Drop every stored note in the half-open frame window
    /// `from_frame..to_frame`. `0..u64::MAX` clears the plugin's store.
    ClearMidiNotes {
        plugin_id: usize,
        from_frame: u64,
        to_frame: u64,
    },

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
    ///
    /// `hold` is the line that holds a generator back to the depth of the
    /// strip's input — `Some` exactly for a `Generator` entry, built on the
    /// control thread by [`ChainEntry::input_hold`] because the audio thread
    /// may neither build one nor free one (ADR 0020). The entry and its line
    /// travel together, so no caller can splice an instrument onto a group
    /// without the line that aligns it. A line this splice displaces, and one
    /// a refused splice never installs, leave over the retirement channel.
    InsertTrackDevice {
        track_id: usize,
        entry: ChainEntry,
        index: usize,
        hold: Option<Box<CompensationDelay>>,
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
    /// `RemovePlugin`'s does — the final drop stays off the callback thread.
    RemoveTrackDeviceRetired {
        track_id: usize,
        effect_id: usize,
    },
    /// Splice an effect into a *bus's* device chain, on the same contract as
    /// [`GraphCommand::InsertTrackDevice`], `hold` included: a bus hosts an
    /// instrument on the same terms a track does. A send bus that cannot host
    /// a reverb is not a send bus.
    InsertBusDevice {
        bus_id: usize,
        entry: ChainEntry,
        index: usize,
        hold: Option<Box<CompensationDelay>>,
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
    ///
    /// `delay` is the send's own plugin delay compensation, built on the
    /// control thread on the same contract as every other owning payload here.
    /// A refused send hands it straight back to the retirement channel.
    AddSend {
        track_id: usize,
        bus_id: usize,
        tap: SendTap,
        level: f32,
        delay: Box<CompensationDelay>,
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
    /// conditional on the callback finding its target: `RemovePlugin` frees
    /// nothing for an id the table does not
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
            | Self::AddHostedPlugin(..) => 1,
            Self::RemovePlugin(..)
            | Self::RemoveTrackDeviceRetired { .. }
            | Self::RemoveBusDeviceRetired { .. } => -1,
            // `RemoveTrack`, `RemoveBus`, `RemoveTrackDevice` and
            // `RemoveBusDevice` leave the effect registered — detached, or
            // back on the master chain — so none of them frees a slot.
            Self::SetParam(..)
            | Self::SetBypass(..)
            | Self::SetEffectLatency { .. }
            | Self::SendMidiNote(..)
            | Self::ScheduleMidiNotes { .. }
            | Self::ClearMidiNotes { .. }
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
        }
    }

    /// Whether applying this command changes what the graph's plugin delay
    /// compensation is computed from: a declared latency, a chain's contents,
    /// a strip's existence, or a route.
    ///
    /// The match carries no wildcard for the same reason
    /// [`Self::effect_table_delta`] carries none: a command that moves the
    /// graph's alignment and does not say so leaves every summing point aimed
    /// at the previous topology, and the mix is early or late until some
    /// unrelated command happens to dirty it.
    ///
    /// Bypass is deliberately absent. A bypassed device keeps its latency and
    /// runs its dry line in its place, so the alignment is unchanged — and
    /// re-aiming every delay on an A/B would put a discontinuity in the mix
    /// exactly where an engineer is listening for one.
    pub(crate) const fn dirties_compensation(&self) -> bool {
        match self {
            // The declared figure itself, and the chain memberships and routes
            // the arrivals are summed along.
            Self::SetEffectLatency { .. }
            | Self::AddTrack(..)
            | Self::RemoveTrack(..)
            | Self::SetTrackOutput(..)
            | Self::InsertTrackDevice { .. }
            | Self::RemoveTrackDevice { .. }
            | Self::RemoveTrackDeviceRetired { .. }
            | Self::InsertBusDevice { .. }
            | Self::RemoveBusDevice { .. }
            | Self::RemoveBusDeviceRetired { .. }
            | Self::AddSend { .. }
            | Self::RemoveSend { .. }
            | Self::AddBus(..)
            | Self::RemoveBus(..)
            | Self::SetBusOutput(..) => true,
            // An effect leaving the table stops contributing its latency to
            // whatever chain still lists it, so its departure moves arrivals
            // exactly as taking it out of the chain would.
            Self::RemovePlugin(..) => true,
            // A registration always arrives at zero declared latency — the
            // latency is stated afterwards, by `SetEffectLatency` — so no
            // arrival can move on the block that installs one.
            Self::AddEffect(..)
            | Self::AddDetachedEffect(..)
            | Self::AddPlugin(..)
            | Self::AddHostedPlugin(..)
            | Self::SetParam(..)
            | Self::SetBypass(..)
            | Self::SendMidiNote(..)
            | Self::ScheduleMidiNotes { .. }
            | Self::ClearMidiNotes { .. }
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
            | Self::SetTrackMute(..)
            | Self::SetTrackSoloGate(..)
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
            | Self::RegisterCaptureConsumer(..)
            | Self::UnregisterCaptureConsumer(..) => false,
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
    Fermenter(Box<FermenterBody>),
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
            BuiltinEffectType::Fermenter => {
                Self::Fermenter(Box::new(FermenterBody::new(sample_rate)))
            }
        }
    }
}

/// Frames a [`FermenterInstance`] renders per `process` call.
///
/// Its channel buffers are exactly this long and `process` clamps its argument
/// to them without saying so, so a longer ask renders this many frames and
/// leaves the rest of the block silent. The host is what splits a callback
/// into runs this size; the number is the instrument's, not a choice made
/// here.
const FERMENTER_BLOCK_FRAMES: usize = 128;

/// Note-voices one hosted Fermenter can sound at once.
///
/// The figure the web runtime builds its own instance with
/// (`fermenterProcessor.ts`), so a strip that moves between the two runtimes
/// steals voices at the same point rather than sounding different under load.
const FERMENTER_MAX_VOICES: u32 = 32;

/// MIDI channels a note can sound on — the sixteen addresses
/// [`NoteAddressSet`] holds a bit per.
const MIDI_CHANNELS: i16 = 16;

/// The Fermenter synthesizer, hosted as a built-in instrument body.
///
/// Boxed inside [`PluginCore`] because a `GraphCommand` is moved through a
/// fixed-size ring: inline, this body's voice pool would set the size of every
/// command the engine sends.
pub struct FermenterBody {
    instance: FermenterInstance,
}

impl FermenterBody {
    /// Build the instrument on the control thread — it allocates its voice
    /// pool and its channel buffers, neither of which the audio thread may do
    /// (ADR 0020).
    fn new(sample_rate: f32) -> Self {
        Self {
            instance: FermenterInstance::new(sample_rate, FERMENTER_MAX_VOICES),
        }
    }

    /// Render this instrument's material for the block and sum it into the
    /// pair, delivering each queued note on the sample it was stamped for.
    ///
    /// Summed rather than written because an instrument is a generator: what
    /// it produces joins whatever already stands at its place in the chain.
    ///
    /// The block is split into runs of at most [`FERMENTER_BLOCK_FRAMES`],
    /// each one a whole `process` call with its own events rebased onto the
    /// run's first frame. A single call for a longer block would render one
    /// run's worth and leave the remainder of the callback silent, and every
    /// event stamped past that run would sound at the wrong time or not at
    /// all.
    ///
    /// A run shorter than a full [`FERMENTER_BLOCK_FRAMES`] is still a whole
    /// block to the instrument, which advances its per-block smoothers —
    /// cutoff, resonance, LFO rate, the effect smoothers — one exponential
    /// step per call, at a coefficient that assumes a full run. So a callback
    /// the run size does not divide, and a loop seam splitting one callback at
    /// a frame that is not a multiple of the run, each cost one extra step: a
    /// smoothed parameter settles slightly faster across a seam, or on a
    /// device buffer that is not a multiple of 128, than it does under the
    /// worklet's fixed quantum. Note timing is unaffected — every scheduled
    /// note lands on the sample it was stamped for either way — and parity
    /// with the worklet is exact for a callback of whole runs with no seam in
    /// it.
    ///
    /// Holding a short run's frames back to fill the next call would buy that
    /// parity at a price a DAW does not pay: those frames would render ahead
    /// of the events belonging to them, which moves a note off the sample it
    /// was written for to save a parameter a few milliseconds of settling.
    ///
    /// Nothing here allocates: the runs write into buffers the instrument
    /// already owns, and the events are pushed into its fixed block list.
    fn process(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        frames: usize,
        events: &[MidiNoteEvent],
        diagnostics: &mut ActiveMidiRtDiagnostics,
    ) {
        let mut next_event = 0;
        let mut rendered = 0;
        while rendered < frames {
            let run = (frames - rendered).min(FERMENTER_BLOCK_FRAMES);
            let run_end = rendered + run;
            while let Some(event) = events.get(next_event) {
                // The last run takes everything still queued: an event stamped
                // past the block it was handed with would otherwise fall
                // through every run and never sound at all.
                let at = (event.frame_offset as usize).min(frames - 1);
                if at >= run_end {
                    break;
                }
                // Non-decreasing by the block's own contract; saturating so a
                // producer that broke it lands its event on the first frame of
                // the run that reaches it — late by up to one run — rather
                // than panicking on the callback.
                self.push_event(event, at.saturating_sub(rendered) as u32, diagnostics);
                next_event += 1;
            }
            self.render_run(&mut left[rendered..run_end], &mut right[rendered..run_end]);
            rendered = run_end;
        }
    }

    /// Render one run into the instrument's own buffers and sum them out.
    fn render_run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let frames = left.len();
        // The right pointer is taken before the render, not after: it comes
        // from a shared borrow of the instrument, and asking for it once the
        // left pointer is in hand would reborrow the instrument between
        // deriving that pointer and reading through it. Order alone keeps
        // every borrow ahead of every read.
        let rendered_right = self.instance.get_right_ptr();
        let rendered_left = self.instance.process(frames as u32);
        // SAFETY: both pointers name the instrument's own channel buffers,
        // which `FermenterInstance::new` sizes at FERMENTER_BLOCK_FRAMES and
        // no method resizes, so the render cannot move the buffer the right
        // pointer already names; `frames` is bounded by that size in `process`
        // above, so each slice is inside the allocation it names. The two
        // buffers are separate heap allocations, so the pair of slices aliases
        // nothing. Nothing mutates the instrument between the render and this
        // copy.
        let (rendered_left, rendered_right) = unsafe {
            (
                std::slice::from_raw_parts(rendered_left, frames),
                std::slice::from_raw_parts(rendered_right, frames),
            )
        };
        for (out, sample) in left.iter_mut().zip(rendered_left) {
            *out += *sample;
        }
        for (out, sample) in right.iter_mut().zip(rendered_right) {
            *out += *sample;
        }
    }

    /// Queue one note on the instrument at `offset` samples into the next run.
    ///
    /// A note-off narrows to the member channel its note-on sounded on, so
    /// releasing one key cannot silence a different note holding the same
    /// pitch on another channel. A channel MIDI has no address for narrows to
    /// nothing, and the note-off then releases every voice at that pitch: the
    /// live path deliberately does not check the channel it is handed
    /// ([`GraphCommand::SendMidiNote`]), and a key nothing can ever lift is
    /// the one outcome worse than releasing more than was asked.
    fn push_event(
        &mut self,
        event: &MidiNoteEvent,
        offset: u32,
        diagnostics: &mut ActiveMidiRtDiagnostics,
    ) {
        let channel = member_channel(event.channel);
        let queued = match (event.is_note_on, channel) {
            // An unaddressable channel still sounds: the key went down, and
            // the base member channel is where a note with no channel of its
            // own belongs.
            (true, channel) => {
                self.instance
                    .push_note_on(event.note, event.velocity, channel.unwrap_or(0), offset)
            }
            (false, Some(channel)) => self
                .instance
                .push_note_off_on_channel(event.note, channel, offset),
            (false, None) => self.instance.push_note_off(event.note, offset),
        };
        // Unreachable as the two capacities stand: a block carries at most
        // `MIDI_EVENT_BUFFER_CAPACITY` events and the instrument's own list
        // takes twice that per run, emptying on every `process`. The count is
        // kept as a guard against either capacity moving, not because a
        // refusal can happen today.
        if !queued {
            diagnostics.record_scheduler_event_buffer_overflow(1);
        }
    }

    /// Write one of the instrument's automation parameters.
    fn set_param(&mut self, ordinal: u32, value: f32) {
        self.instance.set_param_by_id(ordinal, value);
    }
}

/// The Fermenter member channel a note's `i16` channel names, or `None` for a
/// channel MIDI itself has no address for — the same addresses
/// [`NoteAddressSet`] refuses, and the same ones the note store will not take.
fn member_channel(channel: i16) -> Option<u8> {
    if !(0..MIDI_CHANNELS).contains(&channel) {
        return None;
    }
    Some(channel as u8)
}

/// Apply an addressed device parameter to the built-in body it names,
/// answering whether the address and the body agreed.
///
/// The name-to-address resolution happened control-side — [`DeviceParam`] for
/// knead's closed vocabulary, an ordinal bound for the Fermenter's own table —
/// so `false` here is not an unknown parameter but a producer that lost track
/// of what an effect id holds. The caller counts it rather than the engine
/// guessing which body the value was meant for.
fn apply_builtin_param(instance: &mut PluginCore, param: DeviceParam, value: f32) -> bool {
    match (instance, param) {
        (PluginCore::Knead(engine), DeviceParam::ShiftSemitones) => {
            engine.set_shift_semitones(value);
            true
        }
        (PluginCore::Knead(engine), DeviceParam::RetuneSpeedMs) => {
            engine.set_retune_speed_ms(value);
            true
        }
        (PluginCore::Knead(engine), DeviceParam::FormantPreserve) => {
            engine.set_formant_preserve(value != 0.0);
            true
        }
        (PluginCore::Fermenter(body), DeviceParam::FermenterOrdinal(ordinal)) => {
            body.set_param(ordinal, value);
            true
        }
        _ => false,
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
    /// The timeline-addressed notes this instrument plays from, or `None` for
    /// a device that is not one.
    ///
    /// Built control-side and carried in by the command that registered the
    /// device ([`GraphCommand::AddHostedPlugin`],
    /// [`GraphCommand::AddPlugin`]), because the audio thread may neither
    /// allocate one nor free one (ADR 0020). Unlike `pending_midi`, which is
    /// this block's delivery and is emptied by it, the store outlives every
    /// block: delivery reads from it and leaves it alone, so a loop pass
    /// sounds the same note again and a locate away from it sounds nothing.
    midi_notes: Option<Box<MidiNoteStore>>,
    /// Which of the store's notes this device is currently holding down.
    ///
    /// Written by delivery and emptied by [`Self::release_sounding_notes`].
    /// Empty for every device that carries no store, because only delivery
    /// from one ever sets a bit.
    sounding: NoteAddressSet,
    /// Sounding notes whose scheduled note-off a clear took out of the store
    /// during the drain now applying, awaiting settlement.
    ///
    /// A candidate, not a decision. A producer rewriting a bar clears it and
    /// schedules the replacement in one drain, so the clear alone cannot tell
    /// a release that was deleted from one that only moved — see
    /// [`Self::settle_stripped_note_offs`], which answers that against the
    /// store the whole drain left behind.
    stripped: NoteAddressSet,
    /// Frames of latency this device declares, as its host last read them.
    ///
    /// The figure the graph's compensation is computed from, kept exactly as
    /// declared: a device reporting more than the compensation ceiling is
    /// clamped where a delay is aimed, never where the claim is recorded, so
    /// the claim stays visible to whoever has to act on it.
    latency_frames: usize,
    /// This device's own dry delay, run in its place while it is bypassed.
    ///
    /// Bypass keeps latency (Cubase and Reaper both do this), so A/B-ing a
    /// bypass never shifts the strip's alignment against the rest of the mix.
    /// `None` for a device declaring no latency, which is every built-in the
    /// engine owns. Built on the control thread and carried in by
    /// [`GraphCommand::SetEffectLatency`].
    dry_delay: Option<Box<CompensationDelay>>,
    /// This device's hold on the depth of its strip's input, run over its
    /// output before that output joins the chain signal.
    ///
    /// `None` for an effect, which transforms a signal that reached it already
    /// aligned. A generator produces its material on the strip instead, at
    /// zero, so it meets what is routed in exactly the way the strip's own
    /// clips do — held back by that input's depth. Built on the control thread
    /// and carried in by the splice that placed the device
    /// ([`ChainEntry::input_hold`]).
    input_hold: Option<Box<CompensationDelay>>,
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
/// `AddHostedPlugin` registrations `load_plugin` makes, one per
/// external-plugin device in the project.
///
/// No ceiling on them is enumerable from this crate: the host holds them in an
/// unbounded map keyed by instance id, and an external-plugin device list has
/// no per-strip cap of its own. So the engine states the limit itself: 128
/// instances at once, named here and checked control-side by `load_plugin`
/// (`sourdaw-native`) where the refusal reaches the user instead of dying as
/// a counter on the callback. A session past 128 hosted plugins is past any
/// professional session's scale — each instance is a native plugin library —
/// and the refusal names the limit.
pub const HOSTED_PLUGIN_RESERVE: usize = 128;

/// The session's reserve for Crumbs input-capture slots: the registration
/// `create_crumbs` makes for the panel's record feed, one per live instance.
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
    midi_fx: Option<Box<dyn MidiFx>>,
    /// A track, bus, or clip the graph gave up. Each owns sample buffers, so
    /// dropping one on the callback is exactly the free ADR 0020 forbids.
    timeline_object: Option<RetiredTimelineObject>,
    /// The tempo and meter maps a newer pair replaced. They own segment
    /// vectors, so they leave on the same contract as everything else here.
    transport_maps: Option<Box<TransportMaps>>,
    /// A scheduled-note batch whose entries have been copied into their
    /// store. The box is heap the control thread built, so freeing it here
    /// would be a free on the callback.
    midi_notes: Option<Box<[TimedMidiNote]>>,
    remaining_effects: Vec<ActiveEffect>,
    remaining_timeline: Option<TimelineGraph>,
    queued_commands: Vec<GraphCommand>,
    command_rx: Option<Consumer<GraphCommand>>,
}

impl RetiredGraphObjects {
    fn removed(effect: Option<ActiveEffect>, midi_fx: Option<Box<dyn MidiFx>>) -> Self {
        Self {
            effect,
            midi_fx,
            timeline_object: None,
            transport_maps: None,
            midi_notes: None,
            remaining_effects: Vec::new(),
            remaining_timeline: None,
            queued_commands: Vec::new(),
            command_rx: None,
        }
    }

    fn timeline(object: RetiredTimelineObject) -> Self {
        let mut retired = Self::removed(None, None);
        retired.timeline_object = Some(object);
        retired
    }

    fn effect(effect: ActiveEffect) -> Self {
        Self::removed(Some(effect), None)
    }

    fn midi_fx(midi_fx: Box<dyn MidiFx>) -> Self {
        Self::removed(None, Some(midi_fx))
    }

    fn transport_maps(maps: Box<TransportMaps>) -> Self {
        let mut retired = Self::removed(None, None);
        retired.transport_maps = Some(maps);
        retired
    }

    fn midi_notes(notes: Box<[TimedMidiNote]>) -> Self {
        let mut retired = Self::removed(None, None);
        retired.midi_notes = Some(notes);
        retired
    }

    /// The old command consumer a channel swap replaced. Its producer was
    /// dropped control-side when the swap was published, so the reclaimer's
    /// drain-until-abandoned loop terminates promptly.
    fn swapped_consumer(command_rx: Consumer<GraphCommand>) -> Self {
        let mut retired = Self::removed(None, None);
        retired.command_rx = Some(command_rx);
        retired
    }

    fn shutdown(
        pending: Option<Self>,
        remaining_effects: Vec<ActiveEffect>,
        remaining_timeline: TimelineGraph,
        queued_commands: Vec<GraphCommand>,
        command_rx: Option<Consumer<GraphCommand>>,
    ) -> Self {
        let mut pending = pending.unwrap_or_else(|| Self::removed(None, None));

        Self {
            effect: pending.effect.take(),
            midi_fx: pending.midi_fx.take(),
            timeline_object: pending.timeline_object.take(),
            transport_maps: pending.transport_maps.take(),
            midi_notes: pending.midi_notes.take(),
            remaining_effects,
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
            latency_frames: 0,
            dry_delay: None,
            input_hold: None,
            probability_evaluator: ProbabilityEvaluator,
            midi_fx: MidiFxChain::new(),
            pending_midi: MidiEventBuffer::new(),
            midi_notes: None,
            sounding: NoteAddressSet::default(),
            stripped: NoteAddressSet::default(),
            placement,
            home,
            pending_params: DeviceParamQueue::new(),
        }
    }

    /// Install the note store the registering command shipped.
    ///
    /// Taken as a step of its own so every refusal path can build the effect
    /// holding the store and hand the whole of it to the retirement channel:
    /// a store dropped where the registration was refused would be a free on
    /// the callback.
    fn holding_midi_notes(mut self, store: Option<Box<MidiNoteStore>>) -> Self {
        self.midi_notes = store;
        self
    }

    /// Take a newly declared latency and the line the control thread built
    /// for it, and hand back the line left over for retirement.
    ///
    /// The line a device already runs is re-aimed rather than replaced. Every
    /// dry line is built at the ceiling, so the ring the device is running
    /// holds any figure this command can name, and it holds the audio the
    /// chain has been feeding it: re-aiming is a read-offset jump like the one
    /// every route line takes at a recompensation. Installing the fresh ring
    /// instead would hand the next bypassed pass a hold's worth of silence,
    /// every time a plugin moved its reported latency.
    ///
    /// A hold reaching back past the line's history is the exception, and the
    /// line itself owns it: a detachment restarts the ring, so the slots
    /// further back than that restart still hold the audio of the strip the
    /// device left, and deepening the hold onto them would replay exactly that
    /// difference on the first bypassed pass after some chain takes the device
    /// again. What decides it is the history fed since the last restart, not
    /// where the device sits when the figure arrives: a device re-placed and
    /// then deepened before its new chain has fed it that far owes the same
    /// silence a still-detached one does.
    ///
    /// The control thread cannot see which of the two cases it is in, so it
    /// ships a line whenever the figure is non-zero and the spare leaves over
    /// the retirement route. Nothing here allocates or frees (ADR 0020), and a
    /// restart costs the newly declared latency rather than the ring.
    fn aim_dry_line(
        &mut self,
        latency_frames: usize,
        shipped: Option<Box<CompensationDelay>>,
    ) -> Option<Box<CompensationDelay>> {
        self.latency_frames = latency_frames;
        match self.dry_delay.as_mut() {
            Some(line) if latency_frames > 0 => {
                line.set_delay(latency_frames);
                shipped
            }
            // A device that declares nothing runs no line at all, and one that
            // has none takes the line it was shipped. Either way what the slot
            // held leaves rather than being dropped here.
            _ => std::mem::replace(&mut self.dry_delay, shipped),
        }
    }

    /// Take the input hold the splice that placed this device shipped, and
    /// hand back the line left over for retirement.
    ///
    /// The shipped line is installed rather than re-aimed, which is the
    /// opposite of what [`Self::aim_dry_line`] does with a dry line, because
    /// the two lines are current at different moments. A dry line is fed on
    /// every block the chain visits its device, so the ring the device runs
    /// holds audio worth keeping. An input hold is written only while a chain
    /// holds the device: a splice is a device arriving on a strip, with
    /// nothing behind it but whatever some earlier strip put there, so the
    /// fresh silent ring is the one that owes no replay. An effect ships no
    /// line, so splicing a device back in as one retires the hold it ran as a
    /// generator instead of leaving a line nothing feeds.
    fn take_input_hold(
        &mut self,
        shipped: Option<Box<CompensationDelay>>,
    ) -> Option<Box<CompensationDelay>> {
        std::mem::replace(&mut self.input_hold, shipped)
    }

    /// Whether no path in this callback runs this effect at all.
    ///
    /// A detached effect is skipped by the master chain and reached by no
    /// strip chain, so no path hands it a block.
    #[inline]
    fn runs_nowhere(&self) -> bool {
        self.placement == EffectPlacement::Detached
    }

    /// Whether nothing will hand this effect a block on this callback.
    ///
    /// Either it runs nowhere, or it is bypassed — every chain skips a
    /// bypassed device rather than processing it. Work queued for a body no
    /// block reaches has no drain, so it is discarded rather than banked.
    #[inline]
    fn receives_no_block(&self) -> bool {
        self.bypassed || self.runs_nowhere()
    }

    #[inline]
    fn enqueue_midi(&mut self, event: MidiNoteEvent, diagnostics: &mut ActiveMidiRtDiagnostics) {
        // Drop the newest event when the fixed block-local buffer is full.
        if !self.pending_midi.try_push(event) {
            diagnostics.record_scheduler_event_buffer_overflow(1);
        }
    }

    /// Queue every stored note the span `block_start..block_start + frames`
    /// renders, each stamped at the sample that carries its timeline frame.
    ///
    /// `span_offset` is where the span begins inside the callback's buffers.
    /// A chain device is handed that span on its own, so its stamps are
    /// measured from the span's first frame; a master insert drains once per
    /// callback over the whole buffer, so its stamps are measured from the
    /// callback's. Stamping a master insert from the span would put every
    /// delivery after a loop seam a seam's worth early.
    ///
    /// Returns whether the span reached any of them, so the caller can mark
    /// the slot as holding block-local MIDI exactly as the immediate path
    /// does. The store itself is only read: what a pass delivers stays
    /// scheduled, which is what makes a note inside a loop region sound on
    /// every pass over it.
    #[inline]
    fn enqueue_due_midi_notes(
        &mut self,
        block_start: u64,
        frames: usize,
        span_offset: usize,
        diagnostics: &mut ActiveMidiRtDiagnostics,
    ) -> bool {
        let Self {
            midi_notes,
            pending_midi,
            sounding,
            placement,
            ..
        } = self;
        let Some(store) = midi_notes.as_ref() else {
            return false;
        };

        let stamp_base = match *placement {
            EffectPlacement::MasterChain => span_offset as u32,
            _ => 0,
        };
        let span_end = block_start.saturating_add(frames as u64);
        let entries = store.entries();
        // The store is frame-ordered, so the span's own run is a slice of it:
        // where the frames reach `block_start`, up to where they leave the
        // span. Delivering in that order is what keeps the pending buffer
        // non-decreasing in time, which is what a plugin is owed.
        let first_due = entries.partition_point(|entry| entry.at_frame < block_start);
        let mut delivered = false;
        for entry in &entries[first_due..] {
            if entry.at_frame >= span_end {
                break;
            }
            delivered = true;
            let mut event = entry.event;
            event.frame_offset = stamp_base + (entry.at_frame - block_start) as u32;
            // A stored release passes the probability gate whatever its
            // producer wrote on it, exactly as the release a stop, a locate or
            // a clear supplies does. The gate decides whether a note sounds,
            // and it decides that on the note-on: a note-on the gate rolls
            // away still marked the note sounding here, so the release it
            // earns is a note-off an instrument that never heard the note-on
            // ignores — while a release rolled away leaves a key that did go
            // down held for good.
            if !event.is_note_on {
                event.probability_cutoff = crate::midi_fx::PROBABILITY_CUTOFF_RANGE;
            }
            if !pending_midi.try_push(event) {
                diagnostics.record_scheduler_event_buffer_overflow(1);
                continue;
            }
            // Only what reached the buffer is tracked: a note-on the overflow
            // dropped never sounds, so a release owed for it would be a
            // note-off the instrument never asked for.
            if event.is_note_on {
                sounding.hold(event.channel, event.note);
            } else {
                sounding.release(event.channel, event.note);
            }
        }
        delivered
    }

    /// Queue a note-off for every note this device's store has sounded and not
    /// released, at `frame_offset` inside whatever renders next.
    ///
    /// Returns whether anything was queued, so the caller marks the slot as
    /// holding block-local MIDI exactly as every other enqueue does.
    ///
    /// The store's own note-offs stay where the producer wrote them. This is
    /// for the frames that are never going to be rendered — a stop, a locate,
    /// or a loop wrap past a scheduled note-off — after which the instrument
    /// would hold that key until something else happened to release it.
    ///
    /// A note-off the full buffer refuses leaves its note held, so the next
    /// trigger owes it again. Counting the overflow and forgetting the note
    /// would turn one dropped event into a key held for the rest of the
    /// session, which is the one outcome worse than releasing it late.
    #[inline]
    fn release_sounding_notes(
        &mut self,
        frame_offset: u32,
        diagnostics: &mut ActiveMidiRtDiagnostics,
    ) -> bool {
        let Self {
            sounding,
            pending_midi,
            ..
        } = self;
        let mut released = false;
        sounding.drain(|channel, note| {
            if !pending_midi.try_push(release_note(channel, note, frame_offset)) {
                diagnostics.record_scheduler_event_buffer_overflow(1);
                return false;
            }
            released = true;
            true
        });
        released
    }

    /// Clear a window of this device's store, recording every sounding note
    /// whose scheduled note-off the window takes away.
    ///
    /// Returns whether any candidate was recorded, so the caller can flag the
    /// slot for the drain's settlement.
    ///
    /// Nothing is released here. A producer rewrites a bar by clearing it and
    /// scheduling its replacement in the same drain, so a note-off the window
    /// takes out is as likely to be moving as to be going away, and releasing
    /// at the clear cuts short a note the rewrite only meant to lengthen. What
    /// the store holds once the whole drain has applied is what decides it —
    /// see [`Self::settle_stripped_note_offs`]. A note-on the window removes
    /// owes nothing either way; either it never sounded, or it did and its own
    /// note-off is still where the producer wrote it.
    #[inline]
    fn clear_midi_notes(&mut self, from_frame: u64, to_frame: u64) -> bool {
        let Self {
            midi_notes,
            sounding,
            stripped,
            ..
        } = self;
        let Some(store) = midi_notes.as_mut() else {
            return false;
        };

        let mut recorded = false;
        store.clear_window(from_frame, to_frame, |entry| {
            let event = &entry.event;
            if event.is_note_on || !sounding.is_held(event.channel, event.note) {
                return;
            }
            stripped.hold(event.channel, event.note);
            recorded = true;
        });
        recorded
    }

    /// Answer the candidates a clear recorded, against the store the whole
    /// drain left behind.
    ///
    /// A candidate the store still holds a note-off for ahead of the playhead,
    /// before any note-on of the same key, is released by that note-off on the
    /// frame the rewrite put it on, so nothing is owed here and the candidate
    /// is simply dropped. A note-off past a later note-on belongs to that
    /// later note and covers nothing. A candidate with no such note-off is
    /// owed a release: the frames that carried it are out of the arrangement,
    /// and the instrument would hold the key — the same position a stop, a
    /// locate and a loop wrap leave a sounding note in, and it gets the same
    /// answer, a note-off at the head of whatever renders next.
    ///
    /// A release the full buffer refuses leaves the note both sounding and a
    /// candidate, so it is owed again rather than lost.
    ///
    /// Returns whether anything was queued, so the caller marks the slot as
    /// holding block-local MIDI exactly as every other enqueue does.
    #[inline]
    fn settle_stripped_note_offs(
        &mut self,
        playhead_frames: u64,
        diagnostics: &mut ActiveMidiRtDiagnostics,
    ) -> bool {
        let Self {
            midi_notes,
            pending_midi,
            sounding,
            stripped,
            ..
        } = self;
        let Some(store) = midi_notes.as_ref() else {
            return false;
        };

        let rewritten = scheduled_note_offs_from(store, playhead_frames);
        let mut released = false;
        stripped.drain(|channel, note| {
            if rewritten.is_held(channel, note) || !sounding.is_held(channel, note) {
                return true;
            }
            if !pending_midi.try_push(release_note(channel, note, 0)) {
                diagnostics.record_scheduler_event_buffer_overflow(1);
                return false;
            }
            sounding.release(channel, note);
            released = true;
            true
        });
        released
    }
}

/// Every note a note-off the store still holds would release, were the
/// playhead to run on from `from_frame`.
///
/// The first entry a note has from that frame on is the one that decides it: a
/// note-off covers the note, and a note-on does not. A note-on standing
/// between the playhead and the next note-off of that key means the note-off
/// belongs to the later note the store presses there, not to the one sounding
/// now — so the sounding note is owed its release, and the later pair is left
/// whole to sound as its producer wrote it.
///
/// One pass over the entries from that frame on, into two sets the same shape
/// as the sounding bits: sixteen channels of a hundred and twenty-eight bits,
/// stack-local and fixed, so building them allocates nothing on the callback.
/// The store is frame-ordered, so the entries at or past a frame are its tail
/// in the order the playhead would meet them.
fn scheduled_note_offs_from(store: &MidiNoteStore, from_frame: u64) -> NoteAddressSet {
    let entries = store.entries();
    let first = entries.partition_point(|entry| entry.at_frame < from_frame);
    let mut decided = NoteAddressSet::default();
    let mut covered = NoteAddressSet::default();
    for entry in &entries[first..] {
        let event = &entry.event;
        if decided.is_held(event.channel, event.note) {
            continue;
        }
        decided.hold(event.channel, event.note);
        if !event.is_note_on {
            covered.hold(event.channel, event.note);
        }
    }
    covered
}

/// The note-off that ends a note a store sounded, supplied by the engine
/// rather than read from the store.
///
/// Velocity zero is the release a MIDI source sends for a key let go without
/// pressure. The probability cutoff passes: the gate decides whether a note
/// sounds, and a release owed for a note that already did must never be rolled
/// away, or the instrument holds that key for good. Delivery hands a stored
/// note-off over on those same terms, for that same reason.
fn release_note(channel: i16, note: u8, frame_offset: u32) -> MidiNoteEvent {
    MidiNoteEvent {
        note,
        velocity: 0,
        channel,
        is_note_on: false,
        frame_offset,
        probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
        project_probability_seed: 0,
        clip_id_hash: 0,
        event_id_hash: 0,
        absolute_occurrence_index: 0,
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
    /// Slots holding note-off candidates a clear recorded during the drain
    /// now applying, emptied by [`Self::settle_stripped_note_offs`] once that
    /// drain finishes.
    stripped_note_work: SlotWorkSet,
    /// The explicit, deterministic order of master insert processing.
    master_work: MasterWorkList,
    /// Effect ids the render callback hands captured device audio to.
    ///
    /// Reserved once at [`CRUMBS_CAPTURE_RESERVE`] and never grown: it is
    /// walked and mutated on the callback, so a push past the reserve is
    /// refused and counted rather than allowed to reallocate inside the
    /// deadline. It stays a flat vector rather than an [`IdSlotIndex`] because
    /// delivery walks the whole of it every chunk and the reserve is a
    /// handful of entries — a trie would cost a walk per id to save nothing.
    capture_consumers: Vec<usize>,
    /// Whether the drain changed something the graph's plugin delay
    /// compensation is computed from — a declared latency, a chain's contents,
    /// a strip's existence, or a route. Cleared by the recompute at the end of
    /// the drain, so a batch that touches a hundred strips re-aims the delays
    /// once rather than once per command.
    pdc_dirty: bool,
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
            stripped_note_work: SlotWorkSet::reserved(EFFECT_TABLE_CAPACITY),
            master_work: MasterWorkList::reserved(EFFECT_TABLE_CAPACITY),
            capture_consumers: Vec::with_capacity(CRUMBS_CAPTURE_RESERVE),
            pdc_dirty: false,
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
        self.drain_commands();
        // After the drain rather than inside it, and before anything renders:
        // a clear and the batch that rewrites what it took out arrive
        // together, so only the store the whole drain leaves behind can tell a
        // release that was deleted from one that merely moved.
        self.settle_stripped_note_offs();
        // After the drain rather than inside it: a batch that adds a bus, its
        // devices and every send into it passes through states no mix should
        // ever be aligned against, and re-aiming per command would also make a
        // project-sized batch quadratic.
        if self.pdc_dirty {
            self.pdc_dirty = false;
            self.recompute_compensation();
        }
    }

    /// Apply everything the command ring is holding, up to the first refusal
    /// the retirement ring forces.
    fn drain_commands(&mut self) {
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
        self.pdc_dirty |= cmd.dirties_compensation();
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
                GraphCommand::AddEffect(id, instance, notes) => {
                    self.add_builtin_effect(id, instance, notes, EffectPlacement::MasterChain)
                }
                GraphCommand::AddDetachedEffect(id, instance, notes) => {
                    self.add_builtin_effect(id, instance, notes, EffectPlacement::Detached)
                }
                GraphCommand::RemovePlugin(id) => {
                    self.remove_effect(id).map(RetiredGraphObjects::effect)
                }
                GraphCommand::SetParam(id, param, value) => {
                    if let Some(slot) = self.effect_index.lookup(id) {
                        if let Some(effect) = self.effects.get_mut(slot) {
                            // `SetParam` addresses a built-in body only. A
                            // native plugin's parameters are its own and
                            // travel on its control path, and a built-in
                            // address aimed at the other built-in is a
                            // producer that lost track of what this id holds.
                            if !apply_builtin_param(&mut effect.instance, param, value) {
                                self.midi_rt_diagnostics.record_unmapped_set_param_call(1);
                            }
                        }
                    }
                    None
                }
                // Bypass deliberately does not dirty the compensation: a
                // bypassed device keeps its latency and runs its dry delay in
                // place of itself, so nothing about the graph's alignment
                // changes and re-aiming every delay here would glitch the mix
                // on every A/B.
                GraphCommand::SetBypass(id, bypassed) => {
                    if let Some(effect) = self.effect_mut(id) {
                        effect.bypassed = bypassed;
                    }
                    None
                }
                GraphCommand::SetEffectLatency {
                    effect_id,
                    latency_frames,
                    dry_delay,
                } => match self.effect_mut(effect_id) {
                    Some(effect) => effect.aim_dry_line(latency_frames, dry_delay).map(|delay| {
                        RetiredGraphObjects::timeline(RetiredTimelineObject::Delay(delay))
                    }),
                    None => {
                        // Refused like every other command naming an effect the
                        // table does not hold; the line it carried leaves over
                        // the retirement channel rather than being freed here.
                        self.timeline.record_unknown_target();
                        dry_delay.map(|delay| {
                            RetiredGraphObjects::timeline(RetiredTimelineObject::Delay(delay))
                        })
                    }
                },
                GraphCommand::AddPlugin(id, plugin, store) => {
                    let effect =
                        ActiveEffect::new(id, PluginCore::Native(plugin)).holding_midi_notes(store);
                    if self.effect_id_exists(id) {
                        self.midi_rt_diagnostics.record_effect_id_collision(1);
                        Some(RetiredGraphObjects::effect(effect))
                    } else if self.effects.len() == EFFECT_TABLE_CAPACITY {
                        self.timeline.record_capacity_refusal();
                        Some(RetiredGraphObjects::effect(effect))
                    } else {
                        self.push_effect(effect);
                        None
                    }
                }
                // The registration is homed detached. A hosted plugin
                // belongs to the load that created it, not to the master
                // insert chain: homed there it would render the whole mix
                // through the instance the moment a user took it off a strip.
                GraphCommand::AddHostedPlugin(id, plugin, store) => {
                    let effect = ActiveEffect::detached(id, PluginCore::Native(plugin))
                        .holding_midi_notes(Some(store));
                    if self.effect_id_exists(id) {
                        self.midi_rt_diagnostics.record_effect_id_collision(1);
                        Some(RetiredGraphObjects::effect(effect))
                    } else if self.effects.len() == EFFECT_TABLE_CAPACITY {
                        self.timeline.record_capacity_refusal();
                        Some(RetiredGraphObjects::effect(effect))
                    } else {
                        self.push_effect(effect);
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
                GraphCommand::ScheduleMidiNotes { plugin_id, notes } => {
                    self.schedule_midi_notes(plugin_id, &notes);
                    // The batch was copied into the store; the box itself is a
                    // control-side allocation and leaves the way every other
                    // one does.
                    Some(RetiredGraphObjects::midi_notes(notes))
                }
                GraphCommand::ClearMidiNotes {
                    plugin_id,
                    from_frame,
                    to_frame,
                } => {
                    self.clear_midi_notes(plugin_id, from_frame, to_frame);
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
                        // A stopped playhead never reaches the frame a
                        // sounding note's note-off was written for, so the
                        // note is released here or it is held for good.
                        self.release_sounding_notes(0);
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
                        self.release_sounding_notes(0);
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
                    hold,
                } => {
                    // Only claim the effect when the chain actually took it: a
                    // refused splice must leave the effect where it was rather
                    // than silence it — and must hand its line back rather than
                    // free it here.
                    let spliced = if !self.effect_id_exists(entry.effect_id) {
                        self.timeline.record_unknown_target();
                        false
                    } else if self.timeline.insert_track_device(track_id, entry, index) {
                        self.place_effect(entry.effect_id, EffectPlacement::Track(track_id));
                        true
                    } else {
                        false
                    };
                    self.spare_input_hold(entry.effect_id, spliced, hold)
                        .map(|delay| {
                            RetiredGraphObjects::timeline(RetiredTimelineObject::Delay(delay))
                        })
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
                        self.remove_effect(effect_id)
                            .map(RetiredGraphObjects::effect)
                    } else {
                        None
                    }
                }
                GraphCommand::InsertBusDevice {
                    bus_id,
                    entry,
                    index,
                    hold,
                } => {
                    let spliced = if !self.effect_id_exists(entry.effect_id) {
                        self.timeline.record_unknown_target();
                        false
                    } else if self.timeline.insert_bus_device(bus_id, entry, index) {
                        self.place_effect(entry.effect_id, EffectPlacement::Bus(bus_id));
                        true
                    } else {
                        false
                    };
                    self.spare_input_hold(entry.effect_id, spliced, hold)
                        .map(|delay| {
                            RetiredGraphObjects::timeline(RetiredTimelineObject::Delay(delay))
                        })
                }
                GraphCommand::RemoveBusDevice { bus_id, effect_id } => {
                    if self.timeline.remove_bus_device(bus_id, effect_id) {
                        self.release_effect(effect_id, EffectPlacement::Bus(bus_id));
                    }
                    None
                }
                GraphCommand::RemoveBusDeviceRetired { bus_id, effect_id } => {
                    if self.timeline.remove_bus_device(bus_id, effect_id) {
                        self.remove_effect(effect_id)
                            .map(RetiredGraphObjects::effect)
                    } else {
                        None
                    }
                }
                GraphCommand::AddSend {
                    track_id,
                    bus_id,
                    tap,
                    level,
                    delay,
                } => self
                    .timeline
                    .add_send(track_id, bus_id, tap, level, delay)
                    .map(|refused| {
                        RetiredGraphObjects::timeline(RetiredTimelineObject::Delay(refused))
                    }),
                GraphCommand::RemoveSend { track_id, bus_id } => {
                    self.timeline.remove_send(track_id, bus_id).map(|removed| {
                        RetiredGraphObjects::timeline(RetiredTimelineObject::Delay(removed))
                    })
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
                    // The locate takes the playhead off the frames a sounding
                    // note's note-off was written for. Nothing will render
                    // them, so the note is released at the head of what plays
                    // from the new position. A stopped transport sounded
                    // nothing to release.
                    if self.transport.is_playing {
                        self.release_sounding_notes(0);
                    }
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

    /// Re-aim every route's compensation delay at the graph as it now stands.
    ///
    /// The topology walk belongs to the graph while the declared latencies and
    /// the generators' input holds belong to this table, so the graph is handed
    /// a borrow of the table rather than a copy of it. Bypassed devices count:
    /// bypass keeps latency, so an A/B never moves the mix.
    ///
    /// The declared figures are also what says whether the ceiling cut a dry
    /// line short, and the graph never sees them — it sees what a chain sums
    /// to. A strip carrying one device past the ceiling clamps no route line
    /// at all, so the count is started here, from the table that holds the
    /// declarations, and recounted on every pass so it falls again with them.
    /// Only a placed device runs a line the ceiling can cut short: a detached
    /// one is fed and read by no chain and adds nothing to any summing point's
    /// depth, so its declaration is a claim about a line nothing is running.
    fn recompute_compensation(&mut self) {
        let Self {
            effects,
            effect_index,
            timeline,
            ..
        } = self;

        let clamped_devices = effects
            .iter()
            .filter(|effect| effect.placement != EffectPlacement::Detached)
            .filter(|effect| effect.latency_frames > MAX_COMPENSATION_FRAMES)
            .count();

        timeline.compensate(
            clamped_devices,
            &mut CompensationTable {
                effects,
                effect_index,
            },
        );
    }

    /// Install the input hold a splice shipped on the device that splice
    /// placed, and answer with whichever line is now spare.
    ///
    /// A splice that was refused, or that named an effect the table does not
    /// hold, installs nothing: its line is spare on arrival. Either way the
    /// spare leaves over the retirement channel rather than being freed on the
    /// callback (ADR 0020).
    fn spare_input_hold(
        &mut self,
        effect_id: usize,
        spliced: bool,
        hold: Option<Box<CompensationDelay>>,
    ) -> Option<Box<CompensationDelay>> {
        if !spliced {
            return hold;
        }
        match self.effect_mut(effect_id) {
            Some(effect) => effect.take_input_hold(hold),
            None => hold,
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
        notes: Option<Box<MidiNoteStore>>,
        placement: EffectPlacement,
    ) -> Option<RetiredGraphObjects> {
        // Built holding the store on every path, refusals included, so a
        // refused registration retires the whole effect rather than freeing
        // the box the command carried.
        let effect =
            ActiveEffect::with_placement(id, instance, placement).holding_midi_notes(notes);
        if self.effect_id_exists(id) {
            self.midi_rt_diagnostics.record_effect_id_collision(1);
            return Some(RetiredGraphObjects::effect(effect));
        }
        if self.effects.len() == EFFECT_TABLE_CAPACITY {
            self.timeline.record_capacity_refusal();
            return Some(RetiredGraphObjects::effect(effect));
        }
        self.push_effect(effect);
        None
    }

    /// Record where an effect now runs, after a chain has accepted it — or
    /// that no chain holds it any more.
    ///
    /// A detached effect is in no strip chain and not on the master walk, so
    /// nothing feeds its dry line and nothing reads it for as long as it waits.
    /// That is the one break in the rule that every line is written on every
    /// block it renders, and so the one place a line still owes silence: left
    /// standing, it would hand the audio of the strip it left back over the
    /// first `latency` frames after some chain takes the device again. It stays
    /// silent until that placement starts feeding it.
    ///
    /// Every route into `Detached` restarts it, because every route leaves the
    /// device in the same state: a strip torn down under it, and a hosted
    /// plugin released by the strip that borrowed it, both come to rest here.
    ///
    /// The input hold a generator runs owes nothing here, because it never
    /// survives a detachment to owe anything: every splice ships a fresh silent
    /// line and [`ActiveEffect::take_input_hold`] installs it unconditionally,
    /// so the line a re-placed generator runs is the one that arrived with it.
    fn place_effect(&mut self, effect_id: usize, placement: EffectPlacement) {
        let Some(slot) = self.effect_index.lookup(effect_id) else {
            return;
        };
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
        if placement == EffectPlacement::Detached {
            if let Some(delay) = self.effects[slot].dry_delay.as_mut() {
                delay.restart_from_silence();
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
        self.stripped_note_work.remove(slot);
        self.master_work.remove(slot);
        let removed = self.effects.swap_remove(slot);
        // The swap moved the table's tail into `slot` unless the removed
        // entry was itself the tail; that entry's mapping still points at the
        // tail position, so repoint it before anyone resolves the id.
        if let Some(moved) = self.effects.get(slot) {
            self.effect_index.set_slot(moved.id, slot);
            self.parameter_work.move_slot(old_tail, slot);
            self.pending_midi_work.move_slot(old_tail, slot);
            self.stripped_note_work.move_slot(old_tail, slot);
            self.master_work.move_slot(old_tail, slot);
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

    /// Copy a scheduled batch into the store of the device it names.
    ///
    /// Whole or nothing: a device with no store, and a batch past the store's
    /// free capacity, are both refused and counted. A note behind the playhead
    /// is stored and counted late rather than fired — firing it here would put
    /// a note-on at a position nobody wrote it at, and the frame it names is
    /// still ahead of a later locate or loop pass.
    fn schedule_midi_notes(&mut self, plugin_id: usize, notes: &[TimedMidiNote]) {
        let stored = self
            .effect_index
            .lookup(plugin_id)
            .and_then(|slot| self.effects.get_mut(slot))
            .and_then(|effect| effect.midi_notes.as_mut())
            .is_some_and(|store| store.try_extend(notes));

        if !stored {
            self.midi_rt_diagnostics.record_midi_note_batch_refusal(1);
            return;
        }

        let playhead = self.playhead_frames;
        let late = notes.iter().filter(|note| note.at_frame < playhead).count();
        self.midi_rt_diagnostics.record_late_midi_notes(late as u64);
    }

    /// Take a window out of one device's store, recording every note it is
    /// sounding whose scheduled note-off stood inside that window.
    ///
    /// The release those notes may be owed is decided after the drain, by
    /// [`Self::settle_stripped_note_offs`], because the same drain may carry
    /// the batch that writes their note-offs back somewhere else. A device
    /// with no store has nothing to clear, which is every device but an
    /// instrument.
    fn clear_midi_notes(&mut self, plugin_id: usize, from_frame: u64, to_frame: u64) {
        let Some(slot) = self.effect_index.lookup(plugin_id) else {
            return;
        };
        if slot >= self.effects.len() {
            return;
        }
        if self.effects[slot].clear_midi_notes(from_frame, to_frame) {
            self.stripped_note_work.insert(slot);
        }
    }

    /// Answer every note-off candidate this drain's clears recorded.
    ///
    /// Runs once per flagged device, after the whole drain and before anything
    /// renders. A clear on its own cannot tell a deleted release from a moved
    /// one — a producer rewriting a bar clears it and schedules the
    /// replacement in a single drain — so the store as the drain left it is
    /// what decides, and the work set keeps the cost to the devices a clear
    /// actually touched.
    fn settle_stripped_note_offs(&mut self) {
        while let Some(slot) = self.stripped_note_work.slots.last().copied() {
            self.stripped_note_work.remove(slot);
            if self.effects[slot]
                .settle_stripped_note_offs(self.playhead_frames, &mut self.midi_rt_diagnostics)
            {
                self.pending_midi_work.insert(slot);
            }
        }
    }

    /// Deliver every scheduled note the span reaches, stamped at its sample.
    ///
    /// Sited beside [`Self::apply_due_device_params`] and for the same reason:
    /// both are addressed in timeline frames, so both have to run against the
    /// span that actually renders those frames rather than against the
    /// callback's first one. A device with no store is skipped, which is every
    /// device but an instrument.
    ///
    /// Nothing is delivered while the transport is stopped. The playhead
    /// stands still then, so every callback renders the same span and a note
    /// under it would retrigger at the block rate — the same reason clips are
    /// held back on a stopped transport, and a scheduled note is arrangement
    /// material exactly as a clip is. The live path
    /// ([`GraphCommand::SendMidiNote`]) still sounds a stopped transport,
    /// because a note played on a keyboard is not addressed to the timeline at
    /// all.
    fn apply_due_midi_notes(&mut self, block_start: u64, frames: usize, span_offset: usize) {
        if frames == 0 || !self.transport.is_playing {
            return;
        }

        for slot in 0..self.effects.len() {
            if self.effects[slot].enqueue_due_midi_notes(
                block_start,
                frames,
                span_offset,
                &mut self.midi_rt_diagnostics,
            ) {
                self.pending_midi_work.insert(slot);
            }
        }
    }

    /// Release every note the note stores have sounded, at the head of
    /// whatever renders next.
    ///
    /// A stop, a locate and a loop wrap all leave the frame a sounding note's
    /// note-off was written for behind: nothing is going to render it, so the
    /// instrument would hold that key. Every trigger runs on the audio thread
    /// and ahead of the next delivery, so the release reaches the instrument
    /// before anything the new position schedules.
    ///
    /// `seam_offset` is where that "next" begins inside the callback's
    /// buffers, which is what a master insert's stamps are measured from; a
    /// chain device is handed the span itself, so its release sits at the
    /// span's own head.
    fn release_sounding_notes(&mut self, seam_offset: usize) {
        for slot in 0..self.effects.len() {
            let frame_offset = match self.effects[slot].placement {
                EffectPlacement::MasterChain => seam_offset as u32,
                _ => 0,
            };
            if self.effects[slot]
                .release_sounding_notes(frame_offset, &mut self.midi_rt_diagnostics)
            {
                self.pending_midi_work.insert(slot);
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
            let receives_no_block = effect.receives_no_block();
            while let Some(event) = effect.pending_params.pop_due(last_frame) {
                match (&mut effect.instance, event.param) {
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
                    // detached device's `pending_midi` follows in the chain
                    // arms and in the detached sweep: queued where nothing
                    // consumes it is discarded, never banked.
                    //
                    // A `Builtin` stamp is deliberately not dropped. A built-in
                    // holds its parameters in its own body, written here and
                    // needing no process call to receive them, so the value has
                    // to be current the moment the effect is un-bypassed or
                    // placed on a chain again. A hosted plugin cannot be
                    // written to at all until it is handed a block — that is
                    // the whole of the asymmetry.
                    (PluginCore::Native(_), DeviceParamTarget::Hosted { .. })
                        if receives_no_block => {}
                    (PluginCore::Native(plugin), DeviceParamTarget::Hosted { id }) => {
                        if !plugin.apply_parameter_on_audio_thread(id, event.value) {
                            self.midi_rt_diagnostics.record_unmapped_set_param_call(1);
                        }
                    }
                    (instance, DeviceParamTarget::Builtin(param)) => {
                        if !apply_builtin_param(instance, param, event.value as f32) {
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
            midi_rt_diagnostics,
            transport,
            sample_rate,
            ..
        } = self;
        let mut devices = TrackDeviceChain {
            effects,
            effect_index,
            midi_rt_diagnostics,
            transport: *transport,
            sample_rate: *sample_rate,
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
    fn advance_playhead(&mut self, block_start: u64, span_frames: usize, seam_offset: usize) {
        if !self.transport.is_playing {
            return;
        }
        let next = block_start.saturating_add(span_frames as u64);
        match self.loop_region.active_end() {
            Some(end) if block_start < end && next >= end => {
                self.playhead_frames = self.loop_region.start_frame;
                self.loop_wraps = self.loop_wraps.wrapping_add(1);
                self.last_wrap_frame = next;
                // The wrap takes the playhead back over the loop, so a
                // sounding note whose note-off lies past the seam never gets
                // one. Releasing on the seam is where a musician hears the
                // loop close.
                self.release_sounding_notes(seam_offset);
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
            self.apply_due_midi_notes(block_start, span_frames, offset);
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
            // Where the next span begins inside this callback, which is where
            // a loop wrap's releases are stamped for a master insert. A wrap
            // on the callback's last span puts that one frame past the buffer,
            // so it lands on the buffer's final sample instead — the nearest
            // frame that exists, and the only one a plugin may be handed.
            let seam_offset = offset.min(frames - 1);
            self.advance_playhead(block_start, span_frames, seam_offset);
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
            // Only an effect no track claims belongs on the master insert
            // chain. One on a track chain already ran over that track's signal
            // in `render_timeline`, which owns feeding its dry line and
            // clearing its MIDI exactly as this loop does — so it is decided
            // ahead of the dry line, which would otherwise be fed twice on one
            // block and run at half speed.
            if effect.placement != EffectPlacement::MasterChain {
                continue;
            }

            if effect.bypassed {
                run_dry_delay(effect, left, right, num_samples);
                effect.pending_midi.clear();
                continue;
            }

            feed_dry_delay(effect, left, right, num_samples);

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
                PluginCore::Fermenter(body) => {
                    // `frames`, not `num_samples`: the body indexes the pair by
                    // the count it is handed, so the caller's raw ask — which
                    // this function has already clamped to the buffers — would
                    // slice past them.
                    body.process(
                        left,
                        right,
                        frames,
                        effect.pending_midi.as_slice(),
                        &mut self.midi_rt_diagnostics,
                    );
                    effect.pending_midi.clear();
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
        // effects still need their MIDI discarded, but following the compact
        // pending set keeps that cleanup proportional to queued events rather
        // than the table's capacity.
        self.remove_empty_pending_midi_work();
        let mut pending_index = 0;
        while pending_index < self.pending_midi_work.slots.len() {
            let slot = self.pending_midi_work.slots[pending_index];
            #[cfg(test)]
            {
                self.rt_work.pending_midi_work_visits += 1;
            }
            let effect = &mut self.effects[slot];
            if effect.runs_nowhere() {
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

/// Run a device's dry delay over the signal passing through its place.
///
/// `run_device` takes this pass only while its effect is bypassed, in place
/// of processing. `run_generator` takes it every block regardless of bypass,
/// over the chain signal the instrument never sees, because a latent
/// instrument delays what passes through it exactly as a latent effect does.
/// Either way a device keeps its latency, the convention Cubase and Reaper
/// both follow, so switching a latent plugin in and out never shifts the
/// strip against the rest of the mix or clicks at the switch. A device
/// declaring no latency owns no line and passes through untouched, as it
/// always did.
#[inline]
fn run_dry_delay(effect: &mut ActiveEffect, left: &mut [f32], right: &mut [f32], frames: usize) {
    if let Some(delay) = effect.dry_delay.as_mut() {
        delay.process(left, right, frames);
    }
}

/// Keep a running device's dry line holding the signal that device is handed.
///
/// The line is what the next bypass reads back, so it has to be current on
/// every block the chain visits the device. Left standing while the device
/// runs, it would hand back the audio that was passing through it when the
/// device was last bypassed — the whole of the first `latency` frames after
/// the switch — and a line cleared at the switch instead would hand back a
/// hole of silence. Fed, the switch moves nothing at all.
///
/// Exactly one of this and [`run_dry_delay`] runs per device per block: the
/// bypassed pass reads the line and writes it in the same walk, so a feed
/// beside it would advance the ring twice and halve the delay.
#[inline]
fn feed_dry_delay(effect: &mut ActiveEffect, left: &[f32], right: &[f32], frames: usize) {
    if let Some(delay) = effect.dry_delay.as_mut() {
        delay.feed(left, right, frames);
    }
}

/// Answers one compensation pass over the scheduler's device table.
///
/// The pass reads a declared latency and re-aims a generator's input hold, so
/// it borrows the table once rather than through two closures that would need
/// the shared and the exclusive borrow of it at the same time.
struct CompensationTable<'a> {
    effects: &'a mut Vec<ActiveEffect>,
    effect_index: &'a IdSlotIndex,
}

impl CompensationTable<'_> {
    fn effect_mut(&mut self, effect_id: usize) -> Option<&mut ActiveEffect> {
        let slot = self.effect_index.lookup(effect_id)?;
        self.effects.get_mut(slot)
    }
}

impl CompensationDevices for CompensationTable<'_> {
    fn device_latency(&self, effect_id: usize) -> usize {
        self.effect_index
            .lookup(effect_id)
            .and_then(|slot| self.effects.get(slot))
            .map_or(0, |effect| effect.latency_frames)
    }

    fn aim_generator(&mut self, effect_id: usize, depth: usize) -> bool {
        self.effect_mut(effect_id)
            .and_then(|effect| effect.input_hold.as_mut())
            .is_some_and(|hold| hold.set_delay(depth))
    }
}

/// Runs one track's device chain over that track's signal.
///
/// The effects stay in the scheduler's id-indexed table alongside their MIDI
/// state, so the graph borrows them for the length of one render rather than
/// owning them — and resolves each chain entry by id in O(1), because this
/// runs once per device per callback and a table scan per entry was the cost
/// the derived capacity made deadline-fatal.
struct TrackDeviceChain<'a> {
    effects: &'a mut Vec<ActiveEffect>,
    effect_index: &'a IdSlotIndex,
    midi_rt_diagnostics: &'a mut ActiveMidiRtDiagnostics,
    transport: TransportState,
    sample_rate: f32,
}

/// Run a device's own pass: the MIDI it is holding, then its audio.
///
/// The dry line is not touched here. What a device's line holds is decided by
/// the kind of device it is — an effect's line follows the signal it was
/// handed, a generator's holds the chain signal the generator never sees — so
/// each caller takes that line's one pass for the block itself.
#[inline]
fn process_device(
    effect: &mut ActiveEffect,
    transport: &TransportState,
    sample_rate: f32,
    midi_rt_diagnostics: &mut ActiveMidiRtDiagnostics,
    left: &mut [f32],
    right: &mut [f32],
    frames: usize,
) {
    effect.probability_evaluator.process_midi_with_diagnostics(
        &mut effect.pending_midi,
        transport,
        sample_rate,
        frames,
        midi_rt_diagnostics,
    );
    for fx in effect.midi_fx.iter_mut() {
        fx.process_midi_with_diagnostics(
            &mut effect.pending_midi,
            transport,
            sample_rate,
            frames,
            midi_rt_diagnostics,
        );
    }

    match &mut effect.instance {
        PluginCore::Knead(engine) => {
            engine.process_block(left, right);
        }
        // Always processed, and its MIDI always cleared: an instrument sounds
        // the tail of what it was already holding on a block that queues
        // nothing new, and events left queued would sound again next block.
        PluginCore::Fermenter(body) => {
            body.process(
                left,
                right,
                frames,
                effect.pending_midi.as_slice(),
                midi_rt_diagnostics,
            );
            effect.pending_midi.clear();
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
                    transport,
                );
                effect.pending_midi.clear();
            }
        }
    }
}

/// Resolve one chain entry to the device it names.
///
/// The lookup is taken ahead of every early-out, because a device a chain
/// skips still owns a dry line the next bypass will read. It borrows the table
/// rather than `self` so a caller can hold the diagnostics field at the same
/// time.
#[inline]
fn resolve_effect<'a>(
    effects: &'a mut [ActiveEffect],
    effect_index: &IdSlotIndex,
    effect_id: usize,
) -> Option<&'a mut ActiveEffect> {
    let slot = effect_index.lookup(effect_id)?;
    effects.get_mut(slot)
}

impl DeviceChain for TrackDeviceChain<'_> {
    fn run_device(&mut self, effect_id: usize, left: &mut [f32], right: &mut [f32], frames: usize) {
        let Some(effect) = resolve_effect(self.effects, self.effect_index, effect_id) else {
            return;
        };

        if effect.bypassed {
            // Same contract as the master chain: a bypassed device passes its
            // signal through its own latency and discards MIDI queued while
            // bypassed rather than banking it into a burst of stale note-ons.
            run_dry_delay(effect, left, right, frames);
            effect.pending_midi.clear();
            return;
        }

        // The running pass keeps the line current with the signal the effect
        // was handed, so the next bypass reads back audio rather than the
        // block the device was last bypassed on. One pass per block either
        // way: the bypassed branch above read and wrote the same ring.
        feed_dry_delay(effect, left, right, frames);
        process_device(
            effect,
            &self.transport,
            self.sample_rate,
            self.midi_rt_diagnostics,
            left,
            right,
            frames,
        );
    }

    fn run_generator(
        &mut self,
        effect_id: usize,
        scratch_left: &mut [f32],
        scratch_right: &mut [f32],
        left: &mut [f32],
        right: &mut [f32],
        frames: usize,
    ) {
        let Some(effect) = resolve_effect(self.effects, self.effect_index, effect_id) else {
            return;
        };

        // An instrument declaring latency emits its events that many frames
        // after it was asked for them, so everything else on the strip leaves
        // the device that late too — otherwise the strip's clips would sound
        // ahead of the arrival the chain declares, and ahead of every sibling
        // held to meet it. The dry line is aimed at the declared figure and
        // takes its one pass for the block here, over the chain signal and
        // never over the scratch: bypassed or not, because a bypassed device
        // keeps its latency.
        run_dry_delay(effect, left, right, frames);

        if effect.bypassed {
            // The scratch stays as the chain cleared it, so the instrument
            // contributes silence. MIDI queued while bypassed is discarded
            // rather than banked into a burst of stale note-ons.
            effect.pending_midi.clear();
        } else {
            process_device(
                effect,
                &self.transport,
                self.sample_rate,
                self.midi_rt_diagnostics,
                scratch_left,
                scratch_right,
                frames,
            );
        }

        // Last, over whatever the pass above left in the scratch: a
        // generator's material starts at zero on a strip whose input has
        // already waited, so it is held back to meet what landed there before
        // it joins the chain signal.
        //
        // Whichever pass ran, bypass included: the chain clears the pair it
        // hands an instrument, so a bypassed generator feeds its line silence
        // and the tail it was holding drains out on schedule. Skipped over the
        // bypassed blocks, the line would stand still and hand back the
        // material from before the switch when the device came back.
        if let Some(hold) = effect.input_hold.as_mut() {
            hold.run(scratch_left, scratch_right, frames);
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
        assert!(command_tx
            .push(GraphCommand::AddPlugin(id, plugin, None))
            .is_ok());
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
                    None,
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
            .push(GraphCommand::AddEffect(0, knead_instance(), None))
            .unwrap();
        for id in 1..population {
            command_tx
                .push(GraphCommand::AddPlugin(
                    id,
                    Box::new(FakeNativePlugin { value: 0.0 }),
                    None,
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
                    None,
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
                    frame_offset: 0,
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
    fn master_work_preserves_explicit_order_across_place_release_remove_and_slot_move() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
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
                .push(GraphCommand::AddPlugin(id, plugin, None))
                .unwrap();
        }
        command_tx
            .push(GraphCommand::AddHostedPlugin(
                20,
                Box::new(AffinePlugin {
                    factor: 11.0,
                    offset: 7.0,
                }),
                MidiNoteStore::new(),
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

        command_tx.push(GraphCommand::RemovePlugin(30)).unwrap();
        scheduler.update_graph();
        left[0] = 1.0;
        right[0] = 1.0;
        scheduler.process_block(&mut left, &mut right, 1);
        assert_eq!(
            left,
            [3.0],
            "swap-moving id 10 must preserve its list position"
        );

        command_tx.push(GraphCommand::RemovePlugin(20)).unwrap();
        scheduler.update_graph();
        left[0] = 1.0;
        right[0] = 1.0;
        scheduler.process_block(&mut left, &mut right, 1);
        assert_eq!(
            left,
            [3.0],
            "removing a hosted member must not disturb id 10"
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
                None,
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
        command_tx.push(GraphCommand::RemovePlugin(40)).unwrap();
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
                None,
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
    fn add_hosted_plugin_registers_the_instance_detached() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();

        assert!(command_tx
            .push(GraphCommand::AddHostedPlugin(
                42,
                Box::new(FakeNativePlugin { value: 0.25 }),
                MidiNoteStore::new(),
            ))
            .is_ok());
        scheduler.update_graph();

        assert_eq!(scheduler.effects.len(), 1);
        assert_eq!(scheduler.effects[0].id, 42);
        assert_eq!(scheduler.effects[0].placement, EffectPlacement::Detached);
        assert_eq!(scheduler.effects[0].home, EffectPlacement::Detached);

        // The master insert chain runs over zeroed scratch and is the whole
        // mix, so a hosted instance no strip claims must not be reached there.
        let mut left = [0.0; 4];
        let mut right = [0.0; 4];
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(left, [0.0; 4]);
        assert_eq!(right, [0.0; 4]);
    }

    #[test]
    fn remove_plugin_retires_the_instance_off_the_callback_thread() {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();

        command_tx
            .push(GraphCommand::AddHostedPlugin(
                42,
                Box::new(FakeNativePlugin { value: 0.25 }),
                MidiNoteStore::new(),
            ))
            .unwrap();
        scheduler.update_graph();

        command_tx.push(GraphCommand::RemovePlugin(42)).unwrap();
        scheduler.update_graph();

        assert!(scheduler.effects.is_empty());
        let retired = retired_rx.pop().expect("the plugin retirement");
        assert!(retired.effect.is_some());
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
            .push(GraphCommand::AddEffect(7, knead_instance(), None))
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
            _ => panic!("existing effect must not be displaced"),
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
    fn add_hosted_plugin_with_a_colliding_id_retires_the_instance_without_inserting() {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, knead_instance(), None))
            .unwrap();
        scheduler.update_graph();

        command_tx
            .push(GraphCommand::AddHostedPlugin(
                7,
                Box::new(FakeNativePlugin { value: 0.25 }),
                MidiNoteStore::new(),
            ))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(scheduler.effects.len(), 1);
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .effect_id_collisions,
            1
        );
        let retired = retired_rx.pop().expect("the rejected plugin");
        assert!(retired.effect.is_some());
    }

    #[test]
    fn set_param_maps_addresses_onto_the_knead_engine_and_counts_unrouted_native_targets() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, knead_instance(), None))
            .unwrap();
        scheduler.update_graph();

        command_tx
            .push(GraphCommand::SetParam(7, DeviceParam::ShiftSemitones, 3.0))
            .unwrap();
        scheduler.update_graph();

        match &scheduler.effects[0].instance {
            PluginCore::Knead(engine) => assert_eq!(engine.shift_semitones, 3.0),
            _ => panic!("expected the knead effect"),
        }

        // A name with no address is refused control-side now, so the one
        // unmapped `SetParam` left on the audio thread is the one aimed at a
        // native plugin, whose parameters this command never routed.
        command_tx
            .push(GraphCommand::AddPlugin(
                8,
                Box::new(FakeNativePlugin { value: 0.25 }),
                None,
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
                None,
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
                    frame_offset: 0,
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
    /// `AddEffect`, `AddDetachedEffect`, `AddPlugin`, `AddHostedPlugin`
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
                    None,
                ))
                .unwrap();
            scheduler.update_graph();
        }
        assert_eq!(scheduler.effect_index.lookup(10), Some(0));
        assert_eq!(scheduler.effect_index.lookup(11), Some(1));
        assert_eq!(scheduler.effect_index.lookup(12), Some(2));

        // Remove the middle entry: the tail swaps into slot 1.
        command_tx.push(GraphCommand::RemovePlugin(11)).unwrap();
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
                None,
            ))
            .unwrap();
        scheduler.update_graph();
        assert_eq!(scheduler.effect_index.lookup(11), Some(2));
        assert_eq!(scheduler.effects[2].id, 11);
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
                    None,
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
                .push(GraphCommand::RemovePlugin(id + 5_000))
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
                    None,
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
                None,
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
                None,
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
            .push(GraphCommand::AddEffect(7, knead_instance(), None))
            .unwrap();
        scheduler.update_graph();
        assert_eq!(scheduler.effects.len(), 1);

        command_tx
            .push(GraphCommand::AddDetachedEffect(7, knead_instance(), None))
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

    /// A full effect table refuses `AddHostedPlugin`. Without that guard the
    /// push reallocates the effect table on the callback, moving every live
    /// `ActiveEffect` with it.
    #[test]
    fn a_hosted_plugin_is_refused_when_the_effect_table_is_full() {
        let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
        // Cheap fill, as above: the arm under test sees only a full table.
        for id in 0..EFFECT_TABLE_CAPACITY {
            command_tx
                .push(GraphCommand::AddPlugin(
                    id,
                    Box::new(FakeNativePlugin { value: 0.0 }),
                    None,
                ))
                .unwrap();
            scheduler.update_graph();
        }
        assert_eq!(scheduler.effects.len(), EFFECT_TABLE_CAPACITY);

        command_tx
            .push(GraphCommand::AddHostedPlugin(
                EFFECT_TABLE_CAPACITY,
                Box::new(FakeNativePlugin { value: 0.25 }),
                MidiNoteStore::new(),
            ))
            .unwrap();
        scheduler.update_graph();

        assert_eq!(scheduler.effects.len(), EFFECT_TABLE_CAPACITY);
        assert_eq!(scheduler.effects.capacity(), EFFECT_TABLE_CAPACITY);
        assert_eq!(scheduler.timeline().diagnostics().capacity_refusals, 1);
        let retired = retired_rx
            .pop()
            .expect("the refused plugin must be handed off");
        assert!(retired.effect.is_some());
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
                None,
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
                    frame_offset: 0,
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
                None,
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
                        frame_offset: 0,
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
                None,
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
                None,
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
            .push(GraphCommand::AddEffect(2, knead_instance(), None))
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
                None,
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
            .push(GraphCommand::RemovePlugin(TAP_CONSUMER_ID))
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
                    hold: None,
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
                    hold: None,
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
    /// on the callback), the already-repaired `AddPlugin`/`AddHostedPlugin`
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
                    None,
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
                .push(GraphCommand::RemovePlugin(TAP_CONSUMER_ID))
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
                .push(GraphCommand::AddEffect(1, knead_instance(), None))
                .unwrap();
            command_tx
                .push(GraphCommand::AddPlugin(
                    2,
                    Box::new(MidiRecordingPlugin {
                        received_event_count: Arc::clone(&received_event_count),
                        received_channel_sum: Arc::clone(&received_channel_sum),
                    }),
                    None,
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
                        frame_offset: 0,
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
                .push(GraphCommand::AddEffect(7, knead_instance(), None))
                .unwrap();
            command_tx
                .push(GraphCommand::AddDetachedEffect(8, knead_instance(), None))
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
                .push(GraphCommand::AddEffect(7, knead_instance(), None))
                .unwrap();
            scheduler.update_graph();
            command_tx
                .push(GraphCommand::AddEffect(7, knead_instance(), None))
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
                        None,
                    ))
                    .unwrap();
            }
            scheduler.update_graph();
            assert_eq!(scheduler.effects.len(), EFFECT_TABLE_CAPACITY);
            command_tx
                .push(GraphCommand::AddEffect(
                    EFFECT_TABLE_CAPACITY,
                    knead_instance(),
                    None,
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
                        None,
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
                command_tx.push(GraphCommand::RemovePlugin(id)).unwrap();
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
        fn add_plugin_and_add_hosted_plugin_apply_without_allocating() {
            let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
            command_tx
                .push(GraphCommand::AddPlugin(
                    41,
                    Box::new(FakeNativePlugin { value: 0.25 }),
                    None,
                ))
                .unwrap();
            command_tx
                .push(GraphCommand::AddHostedPlugin(
                    42,
                    Box::new(FakeNativePlugin { value: 0.25 }),
                    MidiNoteStore::new(),
                ))
                .unwrap();

            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            assert_eq!(scheduler.effects.len(), 2);
            assert_eq!(scheduler.effects[1].placement, EffectPlacement::Detached);

            // The already-repaired arms stay guarded: a collision refusal
            // hands its carried plugin off allocation-free.
            command_tx
                .push(GraphCommand::AddPlugin(
                    41,
                    Box::new(FakeNativePlugin { value: 0.25 }),
                    None,
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
                    None,
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
                    None,
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

        /// A generator's splice carries the line that holds it to the depth of
        /// its strip's input, and a ceiling-sized ring is the whole of that
        /// line's heap. Building one on the callback is the allocation ADR
        /// 0020 forbids, and a refused splice freeing one is the matching
        /// free — so both arms run under the guard.
        #[test]
        fn a_generator_insert_applies_without_allocating() {
            let (mut command_tx, mut scheduler, mut retired_rx) = create_scheduler();
            let entry = ChainEntry {
                effect_id: 7,
                kind: DeviceKind::Generator,
            };
            // Built control-side: the strip, the instrument and the two lines
            // are the allocations this guard exists to keep off the callback.
            command_tx
                .push(GraphCommand::AddTrack(TimelineTrack::new(1)))
                .unwrap();
            command_tx
                .push(GraphCommand::AddHostedPlugin(
                    7,
                    Box::new(FakeNativePlugin { value: 0.25 }),
                    MidiNoteStore::new(),
                ))
                .unwrap();
            command_tx
                .push(GraphCommand::InsertTrackDevice {
                    track_id: 1,
                    entry,
                    index: 0,
                    hold: entry.input_hold(),
                })
                .unwrap();
            // A second splice naming a strip the graph does not hold: refused,
            // and its line has to leave rather than be dropped here.
            command_tx
                .push(GraphCommand::InsertTrackDevice {
                    track_id: 2,
                    entry,
                    index: 0,
                    hold: entry.input_hold(),
                })
                .unwrap();

            assert_no_alloc(|| {
                scheduler.update_graph();
            });

            // The guarded drain did real work: the accepted splice installed
            // its line on the placed device, and the refused one handed its
            // own back.
            assert_eq!(scheduler.effects[0].placement, EffectPlacement::Track(1));
            assert!(scheduler.effects[0].input_hold.is_some());
            let retired = retired_rx
                .pop()
                .expect("the refused splice must hand its line off");
            assert!(matches!(
                &retired.timeline_object,
                Some(RetiredTimelineObject::Delay(_))
            ));
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
    use crate::timeline::{
        AutomationEvent, DeviceKind, RampShape, FERMENTER_AUTOMATION_PARAM_COUNT,
        MAX_TIMELINE_TRACKS,
    };
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

    /// An instrument: it emits material of its own and overwrites whatever
    /// buffer it is handed, which is why a chain sums a generator's output in
    /// rather than running it in place.
    struct ConstantGenerator {
        value: f32,
    }

    impl NativePlugin for ConstantGenerator {
        fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
            for index in 0..num_samples {
                left[index] = self.value;
                right[index] = self.value;
            }
        }

        fn name(&self) -> &str {
            "constant-generator"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// How many notes one [`FrameRecordingInstrument`] can log.
    ///
    /// The log is reserved to it up front because this fixture also runs
    /// inside the render allocation guard, where a growing `Vec` would be the
    /// allocation the guard exists to catch.
    const RECORDED_NOTE_CAPACITY: usize = 64;

    /// One note as an instrument received it: the absolute frame it landed
    /// on, which note it named, and whether it pressed or released.
    type RecordedNote = (u64, u8, bool);

    /// An instrument that records every note it receives: the frames it has
    /// already been asked to render, plus the event's own offset inside the
    /// block it arrived in, with the note and its direction.
    ///
    /// A chain device is called once per rendered span, in the order the spans
    /// render; a master insert is called once per callback. Either way the
    /// frames this fixture has already processed are where the call it is in
    /// begins in the stream the harness drove, so a block-local stamp reads
    /// back as a position a test can name — which is the only vantage a plugin
    /// has on one.
    struct FrameRecordingInstrument {
        processed: u64,
        received: Arc<Mutex<Vec<RecordedNote>>>,
    }

    impl FrameRecordingInstrument {
        fn new() -> (Box<dyn NativePlugin>, Arc<Mutex<Vec<RecordedNote>>>) {
            let received = Arc::new(Mutex::new(Vec::with_capacity(RECORDED_NOTE_CAPACITY)));
            let instrument = Box::new(Self {
                processed: 0,
                received: Arc::clone(&received),
            });
            (instrument, received)
        }
    }

    impl NativePlugin for FrameRecordingInstrument {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], num_samples: usize) {
            self.processed += num_samples as u64;
        }

        fn process_with_events(
            &mut self,
            _left: &mut [f32],
            _right: &mut [f32],
            num_samples: usize,
            midi_events: &[MidiNoteEvent],
            _transport: &TransportState,
        ) {
            let mut received = self.received.lock().expect("the received note log");
            for event in midi_events {
                received.push((
                    self.processed + u64::from(event.frame_offset),
                    event.note,
                    event.is_note_on,
                ));
            }
            drop(received);
            self.processed += num_samples as u64;
        }

        fn name(&self) -> &str {
            "frame-recording-instrument"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// An instrument that declares latency: its material comes out `declared`
    /// frames after the frame it was asked for, counting from the first frame
    /// it processed.
    ///
    /// A real latent instrument is late in exactly this way, and it is the
    /// only fixture that can show whether the chain holds the strip's own
    /// material to meet it: a generator that emits on the frame it is called
    /// looks identical whether the pass-through was held or not.
    struct LatentGenerator {
        declared: usize,
        processed: usize,
    }

    impl LatentGenerator {
        const fn new(declared: usize) -> Self {
            Self {
                declared,
                processed: 0,
            }
        }
    }

    impl NativePlugin for LatentGenerator {
        fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
            for index in 0..num_samples {
                let value = if self.processed < self.declared {
                    0.0
                } else {
                    1.0
                };
                left[index] = value;
                right[index] = value;
                self.processed += 1;
            }
        }

        fn name(&self) -> &str {
            "latent-generator"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// An instrument whose sample names the frame it was produced on, counting
    /// from the first frame it processed.
    ///
    /// A constant emits the same number for ever, so it can show when a hold
    /// opened but not which frame came out of it. Two constants on one strip
    /// look identical to two lines sharing one; a ramp does not.
    #[derive(Default)]
    struct RampGenerator {
        next_frame: usize,
    }

    impl NativePlugin for RampGenerator {
        fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
            for index in 0..num_samples {
                let value = self.next_frame as f32;
                left[index] = value;
                right[index] = value;
                self.next_frame += 1;
            }
        }

        fn name(&self) -> &str {
            "ramp-generator"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// Really runs late: hands back what it was given `latency` frames ago,
    /// filling the opening gap with silence, the way a lookahead limiter or an
    /// FFT-window device does.
    ///
    /// Compensation is only observable against a device that genuinely delays.
    /// A stub that declared a latency it did not take would leave every
    /// alignment assertion below passing on silence it never had to earn.
    ///
    /// The declared figure is shared so a test can move it, which is what a
    /// plugin flagging a latency change mid-session does. A change jumps the
    /// read offset without clearing the ring, exactly as the graph's own line
    /// does, so the two stay comparable across the change.
    struct LatentPlugin {
        left_history: Vec<f32>,
        right_history: Vec<f32>,
        write: usize,
        latency: Arc<AtomicUsize>,
    }

    impl LatentPlugin {
        fn new(latency: Arc<AtomicUsize>, capacity: usize) -> Self {
            Self {
                left_history: vec![0.0; capacity + 1],
                right_history: vec![0.0; capacity + 1],
                write: 0,
                latency,
            }
        }
    }

    impl NativePlugin for LatentPlugin {
        fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
            let slots = self.left_history.len();
            let latency = self.latency.load(Ordering::Relaxed).min(slots - 1);
            let mut write = self.write;
            // At zero latency the read lands on the slot just written, so the
            // plugin is an identity rather than a special case.
            let mut read = (write + slots - latency) % slots;
            for index in 0..num_samples {
                self.left_history[write] = left[index];
                self.right_history[write] = right[index];
                left[index] = self.left_history[read];
                right[index] = self.right_history[read];
                write = (write + 1) % slots;
                read = (read + 1) % slots;
            }
            self.write = write;
        }

        fn name(&self) -> &str {
            "latent-plugin"
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

    /// One engine-owned hosted plugin and its call counters, spliced onto a
    /// track that plays a constant.
    struct ChainBoundPlugin {
        calls: Arc<AtomicUsize>,
        midi_events: Arc<AtomicUsize>,
    }

    /// A track playing a constant `1.0`, carrying an engine-owned plugin
    /// registered exactly as `register_runtime_with_engine` registers one:
    /// `AddHostedPlugin`, then a chain splice.
    fn track_carrying_a_hosted_plugin(
        harness: &mut Harness,
        track_id: usize,
        effect_id: usize,
        offset: f32,
    ) -> ChainBoundPlugin {
        let calls = Arc::new(AtomicUsize::new(0));
        let midi_events = Arc::new(AtomicUsize::new(0));

        track_with_constant_clip(harness, track_id, track_id + 100, 1.0, 4);
        harness.send(GraphCommand::AddHostedPlugin(
            effect_id,
            Box::new(CountingOffsetPlugin {
                offset,
                calls: Arc::clone(&calls),
                midi_events: Arc::clone(&midi_events),
            }),
            MidiNoteStore::new(),
        ));
        harness.send(insert_track_device(track_id, effect(effect_id), 0));

        ChainBoundPlugin { calls, midi_events }
    }

    /// The same fixture as [`track_carrying_a_hosted_plugin`], spliced as a
    /// generator instead of an effect: `AddHostedPlugin`, then the chain
    /// splice `insert_track_generator` ships, hold included.
    fn track_carrying_a_hosted_generator(
        harness: &mut Harness,
        track_id: usize,
        effect_id: usize,
        offset: f32,
    ) -> ChainBoundPlugin {
        let calls = Arc::new(AtomicUsize::new(0));
        let midi_events = Arc::new(AtomicUsize::new(0));

        track_with_constant_clip(harness, track_id, track_id + 100, 1.0, 4);
        insert_track_generator(
            harness,
            track_id,
            effect_id,
            Box::new(CountingOffsetPlugin {
                offset,
                calls: Arc::clone(&calls),
                midi_events: Arc::clone(&midi_events),
            }),
            0,
        );

        ChainBoundPlugin { calls, midi_events }
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
            frame_offset: 0,
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

        /// Push several commands and apply them in one drain, which is how a
        /// producer's rewrite of a bar reaches the callback: the clear and the
        /// batch replacing what it took out are one publication, never two the
        /// graph could act on separately. The fence marks what makes it one
        /// publication, matching `EngineHandle::send_graph_batch`.
        fn send_in_one_drain(
            &mut self,
            commands: impl IntoIterator<Item = GraphCommand>,
        ) -> &mut Self {
            let commands_vec: Vec<GraphCommand> = commands.into_iter().collect();
            let command_count = commands_vec.len();

            assert!(
                self.command_tx
                    .push(GraphCommand::BeginBatch {
                        commands: command_count
                    })
                    .is_ok(),
                "the command ring should have room"
            );

            for command in commands_vec {
                assert!(
                    self.command_tx.push(command).is_ok(),
                    "the command ring should have room"
                );
            }

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

    /// An instrument's entry: it produces material of its own, so it is summed
    /// into the chain rather than transforming what reached it.
    fn generator(effect_id: usize) -> ChainEntry {
        ChainEntry {
            effect_id,
            kind: DeviceKind::Generator,
        }
    }

    /// The splice the control thread builds for a track chain: the entry and
    /// the input hold a generator waits on travel together, so no test can
    /// place an instrument on a group without the line that aligns it.
    fn insert_track_device(track_id: usize, entry: ChainEntry, index: usize) -> GraphCommand {
        GraphCommand::InsertTrackDevice {
            track_id,
            entry,
            index,
            hold: entry.input_hold(),
        }
    }

    /// The same splice for a bus chain, on the same contract.
    fn insert_bus_device(bus_id: usize, entry: ChainEntry, index: usize) -> GraphCommand {
        GraphCommand::InsertBusDevice {
            bus_id,
            entry,
            index,
            hold: entry.input_hold(),
        }
    }

    fn chain_ids(chain: &[ChainEntry]) -> Vec<usize> {
        chain.iter().map(|entry| entry.effect_id).collect()
    }

    /// The line every send is built with control-side, before any pass has
    /// aimed it. At rest it holds nothing, so a send built with one taps its
    /// source on the frame it is taken.
    fn uncompensated() -> Box<CompensationDelay> {
        Box::new(CompensationDelay::new(MAX_COMPENSATION_FRAMES))
    }

    /// The command the control thread builds for a declared latency: the figure
    /// and the dry line that holds a bypassed pass at it travel together, so no
    /// caller can publish one without the other.
    fn set_latency(effect_id: usize, latency_frames: usize) -> GraphCommand {
        GraphCommand::SetEffectLatency {
            effect_id,
            latency_frames,
            dry_delay: CompensationDelay::for_latency(latency_frames),
        }
    }

    /// The capacity every [`LatentPlugin`] in these tests carries — larger than
    /// any latency they declare, so the plugin's own ring never clamps and an
    /// assertion that fails is about compensation rather than about the fixture.
    const LATENT_PLUGIN_CAPACITY: usize = 4096;

    /// Put a genuinely late device at the head of a track's chain and declare
    /// its latency, the way an activation does. Returns the declared figure so
    /// a test can move it mid-session.
    fn insert_latent_device(
        harness: &mut Harness,
        track_id: usize,
        effect_id: usize,
        latency: usize,
    ) -> Arc<AtomicUsize> {
        insert_latent_device_at(harness, track_id, effect_id, latency, 0)
    }

    /// The same device at a named splice point, for a chain whose order is
    /// what the assertion is about.
    fn insert_latent_device_at(
        harness: &mut Harness,
        track_id: usize,
        effect_id: usize,
        latency: usize,
        index: usize,
    ) -> Arc<AtomicUsize> {
        let declared = Arc::new(AtomicUsize::new(latency));
        harness.send(GraphCommand::AddPlugin(
            effect_id,
            Box::new(LatentPlugin::new(
                Arc::clone(&declared),
                LATENT_PLUGIN_CAPACITY,
            )),
            None,
        ));
        harness.send(insert_track_device(track_id, effect(effect_id), index));
        harness.send(set_latency(effect_id, latency));
        declared
    }

    /// Register an instrument and splice it onto a track, the way a hosted
    /// instrument arrives: homed detached, so releasing it from the chain
    /// returns it to a placement that runs nowhere rather than putting an
    /// instrument the user took off one strip onto the whole mix.
    fn insert_track_generator(
        harness: &mut Harness,
        track_id: usize,
        effect_id: usize,
        instrument: Box<dyn NativePlugin>,
        index: usize,
    ) {
        harness.send(GraphCommand::AddHostedPlugin(
            effect_id,
            instrument,
            MidiNoteStore::new(),
        ));
        harness.send(insert_track_device(track_id, generator(effect_id), index));
    }

    /// Splice an instrument that declares latency onto a track, the way an
    /// activation does: the figure and the dry line that holds a pass at it
    /// travel together, exactly as they do for a latent effect.
    fn insert_latent_track_generator(
        harness: &mut Harness,
        track_id: usize,
        effect_id: usize,
        latency: usize,
        index: usize,
    ) {
        insert_track_generator(
            harness,
            track_id,
            effect_id,
            Box::new(LatentGenerator::new(latency)),
            index,
        );
        harness.send(set_latency(effect_id, latency));
    }

    /// The same instrument on a bus, which hosts one on the same terms.
    fn insert_bus_generator(
        harness: &mut Harness,
        bus_id: usize,
        effect_id: usize,
        instrument: Box<dyn NativePlugin>,
        index: usize,
    ) {
        harness.send(GraphCommand::AddHostedPlugin(
            effect_id,
            instrument,
            MidiNoteStore::new(),
        ));
        harness.send(insert_bus_device(bus_id, generator(effect_id), index));
    }

    /// A track carrying one mono clip whose sample at frame `t` is `t + 1`.
    ///
    /// A constant clip cannot show a delay past its own onset — every frame of
    /// it looks like every other — so any assertion about an alignment that
    /// changes mid-render needs material that names its own frame.
    fn track_with_ramp_clip(harness: &mut Harness, track_id: usize, clip_id: usize, frames: usize) {
        let ramp: Vec<f32> = (0..frames).map(|frame| frame as f32 + 1.0).collect();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(track_id)));
        harness.send(GraphCommand::AddClip(
            track_id,
            TimelineClip::new(
                clip_id,
                ramp.into(),
                [].into(),
                placement(0, 0, frames as u64),
                ClipPlayback::at_gain(1.0),
            ),
        ));
    }

    /// What a ramp track delayed by `latency` frames reads over `frames` frames
    /// starting at `start`, silent until the delay has filled.
    fn delayed_ramp(start: usize, frames: usize, latency: usize) -> Vec<f32> {
        (start..start + frames)
            .map(|frame| match frame.checked_sub(latency) {
                Some(source) => source as f32 + 1.0,
                None => 0.0,
            })
            .collect()
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

    /// A track carrying one mono clip of `1.0` that starts at `onset`.
    ///
    /// The silence ahead of the onset and the material after it are different
    /// numbers, so a line replaying what it held during an earlier passage
    /// shows up in the mix instead of hiding inside a constant.
    fn track_with_onset_clip(
        harness: &mut Harness,
        track_id: usize,
        clip_id: usize,
        onset: u64,
        frames: u64,
    ) {
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(track_id)));
        harness.send(GraphCommand::AddClip(
            track_id,
            TimelineClip::new(
                clip_id,
                vec![1.0; frames as usize].into(),
                [].into(),
                placement(onset, 0, frames),
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
            delay: uncompensated(),
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
            delay: uncompensated(),
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
            delay: uncompensated(),
        });
        harness.send(GraphCommand::AddSend {
            track_id: 2,
            bus_id: 50,
            tap: SendTap::PostFader,
            level: 1.0,
            delay: uncompensated(),
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
            None,
        ));
        harness.send(insert_track_device(1, effect(7), 0));
        track_with_constant_clip(&mut harness, 2, 9, 1.0, 4);
        harness.send(GraphCommand::SetTrackMute(2, true));
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::AddSend {
            track_id: 2,
            bus_id: 50,
            tap: SendTap::PreFader,
            level: 1.0,
            delay: uncompensated(),
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
            delay: uncompensated(),
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
            None,
        ));
        harness.send(insert_track_device(2, effect(7), 0));
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
            None,
        ));
        harness.send(insert_track_device(1, effect(7), 0));

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
            None,
        ));
        harness.send(insert_track_device(1, effect(7), 0));
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
        harness.send(GraphCommand::AddEffect(7, knead_instance(), None));
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
            _ => panic!("expected the knead effect"),
        }

        harness.render(4);
        match &harness.scheduler.effects[0].instance {
            PluginCore::Knead(engine) => assert_eq!(engine.shift_semitones, 5.0),
            _ => panic!("expected the knead effect"),
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
        harness.send(GraphCommand::AddPlugin(3, plugin, None));
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
        harness.send(GraphCommand::AddPlugin(3, plugin, None));
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
        harness.send(GraphCommand::AddEffect(1, knead_instance(), None));
        let (plugin, queued) = parameter_recording_plugin(true);
        harness.send(GraphCommand::AddPlugin(2, plugin, None));
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
            _ => panic!("expected the knead effect"),
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
        harness.send(GraphCommand::AddPlugin(3, plugin, None));
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

    /// A detached effect is handed no block either: no chain claims it, so no
    /// path reaches it at all. A stamp queued on the plugin
    /// there would never drain — and unlike bypass, nothing has to end that
    /// state, so the plugin's state read and its parameter polls would stay
    /// refused for the rest of the instance's life.
    #[test]
    fn a_hosted_stamp_on_a_detached_effect_is_discarded() {
        let mut harness = Harness::new(16);
        harness.playing();
        let (plugin, queued) = parameter_recording_plugin(true);
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddPlugin(3, plugin, None));
        harness.send(insert_track_device(1, effect(3), 0));
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
        harness.send(GraphCommand::AddEffect(7, knead_instance(), None));
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
            _ => panic!("expected the knead effect"),
        }

        harness.render(4);
        match &harness.scheduler.effects[0].instance {
            PluginCore::Knead(engine) => assert_eq!(
                engine.shift_semitones, 5.0,
                "a built-in takes its stamp while bypassed: the value must be \
                 current the moment the effect is un-bypassed"
            ),
            _ => panic!("expected the knead effect"),
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
            None,
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
            None,
        ));
        harness.send(insert_track_device(1, effect(7), 0));

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
            None,
        ));
        harness.send(insert_track_device(1, effect(7), 0));
        harness.send(insert_track_device(2, effect(7), 0));

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
        harness.send(GraphCommand::AddDetachedEffect(7, knead_instance(), None));
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

        harness.send(insert_track_device(1, effect(7), 0));
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
            None,
        ));
        harness.send(insert_track_device(1, effect(7), 0));
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
        harness.send(insert_track_device(2, effect(7), 0));
        harness.render(4);
        assert_eq!(received.load(Ordering::Relaxed), 0);

        // A note sent once it is placed still reaches it, so the silence above
        // is the drain and not a device that never receives anything.
        harness.send(GraphCommand::SendMidiNote(7, note_on(60)));
        harness.render(4);
        assert_eq!(received.load(Ordering::Relaxed), 1);
    }

    /// A hosted plugin a strip holds is run by that strip's chain, and the
    /// monitor shadow says nothing about it: the shadow decides only what the
    /// device is handed, and a chain that skipped its device under it would
    /// drop the plugin out of the strip's own signal.
    #[test]
    fn a_chain_bound_hosted_plugin_runs_inline_whether_or_not_the_monitor_is_shadowed() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::SetMonitorShadow(true));
        let plugin = track_carrying_a_hosted_plugin(&mut harness, 1, 7, 0.5);

        let (shadowed, right) = harness.render(4);
        assert_eq!(
            shadowed,
            vec![1.5; 4],
            "a shadowed monitor must not take the plugin out of the strip's chain"
        );
        assert_eq!(right, shadowed);
        assert_eq!(plugin.calls.load(Ordering::Relaxed), 1);

        harness.send(GraphCommand::SetMonitorShadow(false));
        harness.send(GraphCommand::SeekFrames(0));
        let (audible, _) = harness.render(4);
        assert_eq!(
            audible,
            vec![1.5; 4],
            "the audible side renders the same chain, once"
        );
        assert_eq!(
            plugin.calls.load(Ordering::Relaxed),
            2,
            "exactly one process call per rendered block, on one path"
        );
    }

    /// A hosted plugin taken off a strip goes back to running nowhere, not onto
    /// the master insert chain: its lifetime belongs to the load that created
    /// it, and the master chain is the whole mix.
    #[test]
    fn a_hosted_plugin_taken_off_a_chain_runs_nowhere_rather_than_on_the_master_mix() {
        let mut harness = Harness::new(32);
        harness.playing();
        let plugin = track_carrying_a_hosted_plugin(&mut harness, 1, 7, 0.5);

        // The strip runs it while it is spliced, so the silence below is a
        // released instance rather than one that never processed at all.
        harness.send(GraphCommand::SeekFrames(0));
        let (spliced, _) = harness.render(4);
        assert_eq!(spliced, vec![1.5; 4]);
        let calls_on_the_chain = plugin.calls.load(Ordering::Relaxed);

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

        harness.send(GraphCommand::SeekFrames(0));
        let (released, right) = harness.render(4);
        assert_eq!(
            released,
            vec![1.0; 4],
            "a released hosted plugin must not process the master mix"
        );
        assert_eq!(right, released);
        assert_eq!(
            plugin.calls.load(Ordering::Relaxed),
            calls_on_the_chain,
            "no path may hand a released hosted plugin a block"
        );
    }

    /// Bypass is the professional convention on the inline path too: the
    /// instance keeps its state, passes the strip's signal through untouched,
    /// and discards MIDI queued while it was bypassed rather than banking a
    /// burst of stale note-ons for the moment it is enabled.
    #[test]
    fn a_bypassed_hosted_effect_discards_midi_queued_while_bypassed() {
        let mut harness = Harness::new(32);
        harness.playing();
        let plugin = track_carrying_a_hosted_plugin(&mut harness, 1, 7, 0.5);
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

    /// `run_generator`'s bypass branch clears `pending_midi` on the same
    /// contract as `run_device`'s: a bypassed instrument's own material is
    /// withheld, but the strip's pass-through keeps sounding, and MIDI queued
    /// while it was bypassed is discarded rather than banked for the note-on
    /// burst that arriving un-bypassed would otherwise deliver.
    #[test]
    fn a_bypassed_generator_discards_midi_queued_while_bypassed() {
        let mut harness = Harness::new(32);
        harness.playing();
        let plugin = track_carrying_a_hosted_generator(&mut harness, 1, 7, 0.5);
        harness.send(GraphCommand::SetBypass(7, true));
        harness.send(GraphCommand::SendMidiNote(7, note_on(60)));

        let (left, _) = harness.render(4);
        assert_eq!(
            left,
            vec![1.0; 4],
            "a bypassed generator contributes none of its own material; only the strip's clip sounds"
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
            delay: uncompensated(),
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
            None,
        ));
        harness.send(GraphCommand::AddSend {
            track_id: 1,
            bus_id: 50,
            tap: SendTap::PostFader,
            level: 1.0,
            delay: uncompensated(),
        });
        harness.send(insert_bus_device(50, effect(7), 0));

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
                None,
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

    /// A latent device on one track alone would pull that track late against
    /// every sibling — the classic "one plugin and the whole mix flams".
    #[test]
    fn a_latent_track_and_its_sibling_reach_the_master_on_the_same_frame() {
        const LATENCY: usize = 7;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);
        track_with_constant_clip(&mut harness, 2, 102, 1.0, 64);
        insert_latent_device(&mut harness, 1, 900, LATENCY);

        let (left, right) = harness.render(16);
        let mut expected = vec![2.0; 16];
        expected[..LATENCY].fill(0.0);
        assert_eq!(
            left, expected,
            "the compensated sibling stays silent for exactly as long as the \
             latent track takes to sound"
        );
        assert_eq!(right, left);

        let (later, _) = harness.render(16);
        assert_eq!(
            later,
            vec![2.0; 16],
            "past the onset every frame carries both tracks"
        );
    }

    /// A plugin may re-declare its latency mid-session — a mode switch, an
    /// oversampling change. Every route that meets it has to be re-aimed, or
    /// the mix stays flammed for the rest of the session.
    #[test]
    fn a_latency_change_realigns_the_mix_within_one_block() {
        const FIRST: usize = 7;
        const SECOND: usize = 11;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_ramp_clip(&mut harness, 1, 101, 128);
        track_with_ramp_clip(&mut harness, 2, 102, 128);
        let declared = insert_latent_device(&mut harness, 1, 900, FIRST);

        harness.render(16);

        // The plugin's own delay and the figure it declares move together, as
        // they do when a plugin flags a change and the host re-queries it.
        declared.store(SECOND, Ordering::Relaxed);
        harness.send(set_latency(900, SECOND));

        let (left, _) = harness.render(16);
        let aligned: Vec<f32> = delayed_ramp(16, 16, SECOND)
            .iter()
            .map(|sample| sample * 2.0)
            .collect();
        assert_eq!(
            left, aligned,
            "both tracks arrive at the new latency from the first block after the change"
        );
    }

    /// Bypass is not a latency change. Cubase and Reaper both keep a bypassed
    /// device's delay in the mix, because dropping it would jump every other
    /// route in the project each time a user auditions one plugin.
    #[test]
    fn a_bypassed_latent_device_keeps_holding_its_track_back() {
        const LATENCY: usize = 7;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_ramp_clip(&mut harness, 1, 101, 128);
        track_with_ramp_clip(&mut harness, 2, 102, 128);
        insert_latent_device(&mut harness, 1, 900, LATENCY);

        harness.render(16);
        harness.send(GraphCommand::SetBypass(900, true));

        // The device ran on the block before, and its dry line was fed the
        // signal it was handed, so the line already holds the last LATENCY
        // frames of the ramp. The switch reads straight on from where the
        // device left off: no hole and no jump on the block it happens.
        let (across_the_switch, _) = harness.render(16);
        let aligned_across: Vec<f32> = delayed_ramp(16, 16, LATENCY)
            .iter()
            .map(|sample| sample * 2.0)
            .collect();
        assert_eq!(
            across_the_switch, aligned_across,
            "the block the bypass lands on continues the ramp rather than costing a block of fill"
        );

        let (left, _) = harness.render(32);
        let aligned: Vec<f32> = delayed_ramp(32, 32, LATENCY)
            .iter()
            .map(|sample| sample * 2.0)
            .collect();
        assert_eq!(
            left, aligned,
            "a bypassed latent device runs its dry line, so the mix does not move"
        );
    }

    /// A dry line only reads while its device is bypassed, but it has to be
    /// written on every block the chain visits the device: left standing while
    /// the device runs, it replays the audio that was passing through it when
    /// the device was last bypassed. Auditioning a plugin over a passage and
    /// switching it back out would burst the start of that passage into the
    /// mix.
    #[test]
    fn a_device_bypassed_again_after_running_reads_current_audio_rather_than_the_last_bypass() {
        const LATENCY: usize = 7;
        const ONSET: u64 = 64;
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        // Silent until ONSET, so the audio standing in the line during the
        // first bypass and the audio passing through it later are different
        // numbers rather than the same constant.
        harness.send(GraphCommand::AddClip(
            1,
            TimelineClip::new(
                101,
                vec![1.0; 192].into(),
                [].into(),
                placement(ONSET, 0, 192),
                ClipPlayback::at_gain(1.0),
            ),
        ));
        insert_latent_device(&mut harness, 1, 900, LATENCY);

        // Bypassed over the silent passage: the line fills with silence.
        harness.send(GraphCommand::SetBypass(900, true));
        harness.render(16);
        harness.render(16);

        // Then the device runs, across the onset and for two blocks past it.
        harness.send(GraphCommand::SetBypass(900, false));
        for _ in 0..4 {
            harness.render(16);
        }

        harness.send(GraphCommand::SetBypass(900, true));
        let (left, right) = harness.render(16);

        assert_eq!(
            left,
            vec![1.0; 16],
            "the line hands back the material the device was being fed, not the silence \
             it last held while bypassed"
        );
        assert_eq!(right, left);
    }

    /// The master insert chain runs its own active feed, over the whole mix
    /// rather than one strip's signal. A line left standing there replays the
    /// last bypass exactly as one on a track chain does.
    #[test]
    fn a_master_insert_bypassed_again_after_running_reads_current_audio_rather_than_the_last_bypass(
    ) {
        const LATENCY: usize = 7;
        const ONSET: u64 = 64;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_onset_clip(&mut harness, 1, 101, ONSET, 192);

        let declared = Arc::new(AtomicUsize::new(LATENCY));
        harness.send(GraphCommand::AddEffect(
            900,
            PluginCore::Native(Box::new(LatentPlugin::new(
                declared,
                LATENT_PLUGIN_CAPACITY,
            ))),
            None,
        ));
        harness.send(set_latency(900, LATENCY));

        // Bypassed over the silent passage: the line fills with silence.
        harness.send(GraphCommand::SetBypass(900, true));
        harness.render(16);
        harness.render(16);

        // Then the device runs on the mix, across the onset and past it.
        harness.send(GraphCommand::SetBypass(900, false));
        for _ in 0..4 {
            harness.render(16);
        }

        harness.send(GraphCommand::SetBypass(900, true));
        let (left, right) = harness.render(16);

        assert_eq!(
            left,
            vec![1.0; 16],
            "the master chain's line hands back the mix it was being fed, not the silence \
             it last held while bypassed"
        );
        assert_eq!(right, left);
    }

    /// A route line holding nothing is written all the same. Skipped, it
    /// freezes with the audio it held when its hold was dropped, and the next
    /// hold the graph aims it at bursts that era into every sibling route.
    #[test]
    fn a_route_line_at_zero_hold_is_written_so_a_later_hold_never_replays_it() {
        const FIRST: usize = 8;
        const SECOND: usize = 4;
        const THIRD: usize = 8;
        let mut harness = Harness::new(64);
        harness.playing();
        track_with_ramp_clip(&mut harness, 1, 101, 256);
        // Carries latency and nothing else, so the master reads track 1's
        // contribution alone and every assertion is about its hold.
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(2)));
        insert_latent_device(&mut harness, 2, 900, FIRST);

        let (held, _) = harness.render(16);
        assert_eq!(
            held,
            delayed_ramp(0, 16, FIRST),
            "the sibling waits the latent track's depth"
        );

        // The latent track goes, taking its device out of every chain: the
        // hold drops to zero, and the graph runs on for two blocks with the
        // line writing but reading nothing back.
        harness.send(GraphCommand::RemoveTrack(2));
        let (unheld, _) = harness.render(32);
        assert_eq!(
            unheld,
            delayed_ramp(16, 32, 0),
            "with nothing left to wait for the sibling plays where it stands"
        );

        // A new latent track, at a shallower figure than the first: the line
        // reads the frames just behind its write head, which are the ones it
        // took while it was holding nothing.
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(2)));
        let declared = insert_latent_device(&mut harness, 2, 901, SECOND);
        let (re_aimed, _) = harness.render(16);
        assert_eq!(
            re_aimed,
            delayed_ramp(48, 16, SECOND),
            "the re-aimed line reads on from the passage it was just written with"
        );

        // Deeper, across a line that never stopped: still a read-offset jump.
        declared.store(THIRD, Ordering::Relaxed);
        harness.send(set_latency(901, THIRD));
        let (deeper, _) = harness.render(16);
        assert_eq!(
            deeper,
            delayed_ramp(64, 16, THIRD),
            "deepening the hold reads further back into current audio, never into the \
             era the line spent at zero"
        );
    }

    /// A device whose track was torn down under it is in no chain at all:
    /// nothing feeds its dry line and nothing reads it. Left standing, the
    /// line hands the removed track's audio back the moment a chain takes the
    /// device again.
    #[test]
    fn a_device_detached_by_a_removed_track_restarts_its_dry_line_from_silence() {
        const LATENCY: usize = 7;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 256);
        insert_latent_device(&mut harness, 1, 900, LATENCY);

        // Runs, so the line fills with the track's material.
        harness.render(16);

        harness.send(GraphCommand::SetBypass(900, true));
        harness.send(GraphCommand::RemoveTrack(1));
        harness.render(16);

        // The same device on a new track, still bypassed, so the line is what
        // hands the strip's signal on.
        track_with_constant_clip(&mut harness, 1, 102, 1.0, 256);
        harness.send(insert_track_device(1, effect(900), 0));

        let (left, right) = harness.render(16);
        let mut expected = vec![1.0; 16];
        expected[..LATENCY].fill(0.0);
        assert_eq!(
            left, expected,
            "the re-placed device's line owes silence for its own hold rather than \
             replaying the audio it held when its track was removed"
        );
        assert_eq!(right, left);
    }

    /// A hosted plugin is homed detached, so taking it off a strip returns it
    /// to the same nowhere a torn-down strip leaves it in: no chain feeds its
    /// dry line and no pass reads it. The release route owes the restart
    /// exactly as the teardown route does.
    #[test]
    fn a_hosted_device_taken_off_a_track_restarts_its_dry_line_from_silence() {
        const LATENCY: usize = 7;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 256);

        let declared = Arc::new(AtomicUsize::new(LATENCY));
        harness.send(GraphCommand::AddHostedPlugin(
            900,
            Box::new(LatentPlugin::new(declared, LATENT_PLUGIN_CAPACITY)),
            MidiNoteStore::new(),
        ));
        harness.send(insert_track_device(1, effect(900), 0));
        harness.send(set_latency(900, LATENCY));

        // Runs, so the line fills with the track's material.
        harness.render(16);

        harness.send(GraphCommand::SetBypass(900, true));
        harness.send(GraphCommand::RemoveTrackDevice {
            track_id: 1,
            effect_id: 900,
        });
        harness.render(16);

        // Back on the same strip, still bypassed, so the line is what hands
        // the strip's signal on.
        harness.send(insert_track_device(1, effect(900), 0));

        let (left, right) = harness.render(16);
        let mut expected = vec![1.0; 16];
        expected[..LATENCY].fill(0.0);
        assert_eq!(
            left, expected,
            "the re-placed plugin's line owes silence for its own hold rather than \
             replaying the audio it held when the strip let it go"
        );
        assert_eq!(right, left);
    }

    /// A device goes on declaring while it waits detached, and a host's
    /// latency watcher goes on addressing it: the strip lets a plugin go, and
    /// the plugin then reports a deeper figure. Nothing feeds the line over
    /// that span, so the slots between the old hold and the new one still
    /// carry the strip's audio, and the first bypassed pass after some chain
    /// takes the device again replays exactly that difference.
    ///
    /// The line is run right round to its last slots first, because a ring
    /// that has never been written that far holds its own zeroes there and
    /// would answer this either way.
    #[test]
    fn a_line_deepened_while_detached_owes_silence_for_its_whole_new_hold() {
        const DETACHED_AT: usize = 7;
        const DEEPENED_TO: usize = 11;
        const FILL_BLOCKS: usize = MAX_COMPENSATION_FRAMES / MAX_CALLBACK_FRAMES;

        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, MAX_COMPENSATION_FRAMES + 128);

        let declared = Arc::new(AtomicUsize::new(DETACHED_AT));
        harness.send(GraphCommand::AddHostedPlugin(
            900,
            Box::new(LatentPlugin::new(declared, LATENT_PLUGIN_CAPACITY)),
            MidiNoteStore::new(),
        ));
        harness.send(insert_track_device(1, effect(900), 0));
        harness.send(set_latency(900, DETACHED_AT));

        // Feed the whole ring, so the region a deeper hold reads back holds
        // the strip's material rather than the ring's own initial silence.
        for _ in 0..FILL_BLOCKS {
            harness.render(MAX_CALLBACK_FRAMES);
        }

        harness.send(GraphCommand::RemoveTrackDevice {
            track_id: 1,
            effect_id: 900,
        });
        harness.render(16);

        // The watcher still addresses the registered instance, and the figure
        // it publishes is deeper than the one the detachment cleared.
        harness.send(set_latency(900, DEEPENED_TO));
        harness.send(insert_track_device(1, effect(900), 0));
        harness.send(GraphCommand::SetBypass(900, true));

        let (left, right) = harness.render(16);
        let mut expected = vec![1.0; 16];
        expected[..DEEPENED_TO].fill(0.0);
        assert_eq!(
            left, expected,
            "the deepened line owes silence for the hold it is now aimed at, not \
             only for the one it was detached with"
        );
        assert_eq!(right, left);
    }

    /// The same exposure, reached with the device already back on a strip: the
    /// host's latency watcher reports the deeper figure a block after the
    /// re-placement rather than a block before it, so the line is placed when
    /// the figure lands but has been fed nothing since its detachment cleared
    /// it. What it owes is decided by the history behind its write head, not
    /// by where its device sits, so it owes the whole of the new hold here
    /// exactly as it does while detached.
    #[test]
    fn a_line_deepened_right_after_re_placement_owes_silence_for_its_whole_new_hold() {
        const DETACHED_AT: usize = 7;
        const DEEPENED_TO: usize = 11;
        const FILL_BLOCKS: usize = MAX_COMPENSATION_FRAMES / MAX_CALLBACK_FRAMES;

        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, MAX_COMPENSATION_FRAMES + 128);

        let declared = Arc::new(AtomicUsize::new(DETACHED_AT));
        harness.send(GraphCommand::AddHostedPlugin(
            900,
            Box::new(LatentPlugin::new(declared, LATENT_PLUGIN_CAPACITY)),
            MidiNoteStore::new(),
        ));
        harness.send(insert_track_device(1, effect(900), 0));
        harness.send(set_latency(900, DETACHED_AT));

        // Feed the whole ring, so the region a deeper hold reads back holds
        // the strip's material rather than the ring's own initial silence.
        for _ in 0..FILL_BLOCKS {
            harness.render(MAX_CALLBACK_FRAMES);
        }

        harness.send(GraphCommand::RemoveTrackDevice {
            track_id: 1,
            effect_id: 900,
        });
        harness.render(16);

        // Placed first, deepened second: nothing has fed the line in between.
        harness.send(insert_track_device(1, effect(900), 0));
        harness.send(set_latency(900, DEEPENED_TO));
        harness.send(GraphCommand::SetBypass(900, true));

        let (left, right) = harness.render(16);
        let mut expected = vec![1.0; 16];
        expected[..DEEPENED_TO].fill(0.0);
        assert_eq!(
            left, expected,
            "a line deepened before its new chain has fed it that far owes silence \
             for the whole hold, not only for the one it was detached with"
        );
        assert_eq!(right, left);
    }

    /// A bus is torn down under its inserts exactly as a track is, and the
    /// devices it held stop processing rather than falling back onto the
    /// master mix. Their lines owe the same silence.
    #[test]
    fn a_device_detached_by_a_removed_bus_restarts_its_dry_line_from_silence() {
        const LATENCY: usize = 7;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 256);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Bus(50)));

        let declared = Arc::new(AtomicUsize::new(LATENCY));
        harness.send(GraphCommand::AddPlugin(
            900,
            Box::new(LatentPlugin::new(declared, LATENT_PLUGIN_CAPACITY)),
            None,
        ));
        harness.send(insert_bus_device(50, effect(900), 0));
        harness.send(set_latency(900, LATENCY));

        // Runs, so the line fills with what the bus is carrying.
        harness.render(16);

        harness.send(GraphCommand::SetBypass(900, true));
        harness.send(GraphCommand::RemoveBus(50));
        harness.render(16);

        // A new bus under the same id, taking the same device back while it
        // is still bypassed.
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(insert_bus_device(50, effect(900), 0));

        let (left, right) = harness.render(16);
        let mut expected = vec![1.0; 16];
        expected[..LATENCY].fill(0.0);
        assert_eq!(
            left, expected,
            "the re-placed device's line owes silence for its own hold rather than \
             replaying the audio it held when its bus was removed"
        );
        assert_eq!(right, left);
    }

    /// A latency change re-aims the line a bypassed device is running instead
    /// of swapping a fresh one in. The ring has been written on every block
    /// the chain visited the device, so the deeper hold reads further back
    /// into audio that is already current — one bounded repeat of the
    /// difference — where a fresh ring would hand back the whole new hold as
    /// silence.
    #[test]
    fn a_latency_change_re_aims_the_dry_line_a_bypassed_device_is_running() {
        const FIRST: usize = 7;
        const SECOND: usize = 11;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_ramp_clip(&mut harness, 1, 101, 256);
        let declared = insert_latent_device(&mut harness, 1, 900, FIRST);

        assert_eq!(
            harness.render(16).0,
            delayed_ramp(0, 16, FIRST),
            "the running device answers a block late, and its line is fed what it was handed"
        );

        harness.send(GraphCommand::SetBypass(900, true));
        assert_eq!(
            harness.render(16).0,
            delayed_ramp(16, 16, FIRST),
            "the bypassed pass reads the material the running device was being fed"
        );

        declared.store(SECOND, Ordering::Relaxed);
        harness.send(set_latency(900, SECOND));
        let (deeper, _) = harness.render(16);
        assert_eq!(
            deeper,
            delayed_ramp(32, 16, SECOND),
            "the deeper hold reads four frames further back into the ring the device is \
             already running, never into a fresh one holding nothing"
        );
        assert!(
            !deeper.contains(&0.0),
            "no frame of silence appears at the change"
        );
    }

    /// The running pass feeds the dry line exactly once per block
    /// (`run_device`'s own `feed_dry_delay` call). A second feed from
    /// anywhere else would advance the ring's write head twice as fast as
    /// real time, so a later bypassed read — reaching back far enough to
    /// span a block boundary — would land somewhere other than the content
    /// that block actually carried.
    #[test]
    fn an_effects_dry_line_is_fed_exactly_once_per_running_block() {
        // Past one 32-frame block, so the bypassed read below reaches back
        // across the boundary between the two running blocks rather than
        // landing entirely inside the last one.
        const LATENCY: usize = 40;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_ramp_clip(&mut harness, 1, 101, 256);
        insert_latent_device(&mut harness, 1, 900, LATENCY);

        // Two full blocks of running, each carrying ramp content distinct
        // from the other, so a doubled feed's repeated writes cannot pass
        // for the genuine signal.
        harness.render(32);
        harness.render(32);

        harness.send(GraphCommand::SetBypass(900, true));
        let (left, _) = harness.render(32);
        assert_eq!(
            left,
            delayed_ramp(64, 32, LATENCY),
            "the bypassed pass reads exactly the dry signal each running block fed, not \
             audio a doubled feed raced the write head ahead of"
        );
    }

    /// A group's source line holds nothing while the track feeding it is gone,
    /// and is written all the same. Skipped, it would freeze with the group's
    /// own clip as it stood at the removal and burst that back the moment
    /// something is routed in again.
    #[test]
    fn a_source_line_at_zero_hold_is_written_so_a_later_hold_never_replays_it() {
        const FIRST: usize = 8;
        const SECOND: usize = 4;
        const THIRD: usize = 8;
        let mut harness = Harness::new(64);
        harness.playing();
        // The group carries the ramp; what is routed into it carries latency
        // and nothing else, so the master reads the group's own clip alone and
        // every assertion is about its source line.
        track_with_ramp_clip(&mut harness, 3, 103, 256);
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Track(3)));
        insert_latent_device(&mut harness, 1, 900, FIRST);

        let (held, _) = harness.render(16);
        assert_eq!(
            held,
            delayed_ramp(0, 16, FIRST),
            "the group's own clip waits for the latent track routed into it"
        );

        harness.send(GraphCommand::RemoveTrack(1));
        let (unheld, _) = harness.render(32);
        assert_eq!(
            unheld,
            delayed_ramp(16, 32, 0),
            "with nothing feeding the group its clip plays where it stands"
        );

        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Track(3)));
        let declared = insert_latent_device(&mut harness, 1, 901, SECOND);
        let (re_aimed, _) = harness.render(16);
        assert_eq!(
            re_aimed,
            delayed_ramp(48, 16, SECOND),
            "the re-aimed source line reads on from the passage it was just written with"
        );

        declared.store(THIRD, Ordering::Relaxed);
        harness.send(set_latency(901, THIRD));
        let (deeper, _) = harness.render(16);
        assert_eq!(
            deeper,
            delayed_ramp(64, 16, THIRD),
            "deepening the hold reads further back into current audio, never into the \
             era the line spent at zero"
        );
    }

    /// A bus's output line holds nothing while the latent strip beside it is
    /// gone. Skipped, the next hold the graph aims it at bursts the passage it
    /// froze in into the master.
    #[test]
    fn a_bus_output_line_at_zero_hold_is_written_so_a_later_hold_never_replays_it() {
        const FIRST: usize = 8;
        const SECOND: usize = 4;
        const THIRD: usize = 8;
        let mut harness = Harness::new(64);
        harness.playing();
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        track_with_ramp_clip(&mut harness, 1, 101, 256);
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Bus(50)));
        // The sibling at the master carries latency and nothing else, so the
        // bus's own output line is the only thing holding the ramp back.
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        insert_latent_device(&mut harness, 3, 900, FIRST);

        let (held, _) = harness.render(16);
        assert_eq!(
            held,
            delayed_ramp(0, 16, FIRST),
            "the bus waits for the latent track it sums beside"
        );

        harness.send(GraphCommand::RemoveTrack(3));
        let (unheld, _) = harness.render(32);
        assert_eq!(
            unheld,
            delayed_ramp(16, 32, 0),
            "with nothing left to wait for the bus plays where it stands"
        );

        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        let declared = insert_latent_device(&mut harness, 3, 901, SECOND);
        let (re_aimed, _) = harness.render(16);
        assert_eq!(
            re_aimed,
            delayed_ramp(48, 16, SECOND),
            "the re-aimed bus line reads on from the passage it was just written with"
        );

        declared.store(THIRD, Ordering::Relaxed);
        harness.send(set_latency(901, THIRD));
        let (deeper, _) = harness.render(16);
        assert_eq!(
            deeper,
            delayed_ramp(64, 16, THIRD),
            "deepening the hold reads further back into current audio, never into the \
             era the line spent at zero"
        );
    }

    /// A send's line holds nothing while the latent strip feeding the same bus
    /// is gone. Skipped, it freezes with the tap as it stood at the removal,
    /// and the next hold bursts that era into the bus.
    #[test]
    fn a_send_line_at_zero_hold_is_written_so_a_later_hold_never_replays_it() {
        const FIRST: usize = 8;
        const SECOND: usize = 4;
        const THIRD: usize = 8;
        let mut harness = Harness::new(64);
        harness.playing();
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        track_with_ramp_clip(&mut harness, 1, 101, 256);
        harness.send(GraphCommand::AddSend {
            track_id: 1,
            bus_id: 50,
            tap: SendTap::PreFader,
            level: 1.0,
            delay: uncompensated(),
        });
        // Muted, so the master reads the bus alone and every assertion is
        // about the send's own line rather than the strip's output.
        harness.send(GraphCommand::SetTrackMute(1, true));
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(2)));
        insert_latent_device(&mut harness, 2, 900, FIRST);
        harness.send(GraphCommand::AddSend {
            track_id: 2,
            bus_id: 50,
            tap: SendTap::PreFader,
            level: 1.0,
            delay: uncompensated(),
        });
        harness.send(GraphCommand::SetTrackMute(2, true));

        let (held, _) = harness.render(16);
        assert_eq!(
            held,
            delayed_ramp(0, 16, FIRST),
            "the send off the dry track waits for the send off the latent one"
        );

        harness.send(GraphCommand::RemoveTrack(2));
        let (unheld, _) = harness.render(32);
        assert_eq!(
            unheld,
            delayed_ramp(16, 32, 0),
            "with nothing left to wait for the send lands where it is taken"
        );

        harness.send(GraphCommand::AddTrack(TimelineTrack::new(2)));
        let declared = insert_latent_device(&mut harness, 2, 901, SECOND);
        harness.send(GraphCommand::AddSend {
            track_id: 2,
            bus_id: 50,
            tap: SendTap::PreFader,
            level: 1.0,
            delay: uncompensated(),
        });
        harness.send(GraphCommand::SetTrackMute(2, true));
        let (re_aimed, _) = harness.render(16);
        assert_eq!(
            re_aimed,
            delayed_ramp(48, 16, SECOND),
            "the re-aimed send line reads on from the passage it was just written with"
        );

        declared.store(THIRD, Ordering::Relaxed);
        harness.send(set_latency(901, THIRD));
        let (deeper, _) = harness.render(16);
        assert_eq!(
            deeper,
            delayed_ramp(64, 16, THIRD),
            "deepening the hold reads further back into current audio, never into the \
             era the line spent at zero"
        );
    }

    /// A send is a second route out of a track, and it sums somewhere else. It
    /// carries its own compensation because the bus it lands on has an arrival
    /// time of its own, unrelated to the master's.
    #[test]
    fn two_sends_meeting_on_one_bus_arrive_on_the_same_frame() {
        const LATENCY: usize = 7;
        let mut harness = Harness::new(64);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);
        track_with_constant_clip(&mut harness, 2, 102, 1.0, 64);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        insert_latent_device(&mut harness, 1, 900, LATENCY);
        for track_id in [1, 2] {
            harness.send(GraphCommand::AddSend {
                track_id,
                bus_id: 50,
                tap: SendTap::PreFader,
                level: 0.5,
                delay: uncompensated(),
            });
        }
        // Muted so the only thing reaching the master is the bus, and the
        // assertion is about the sends rather than the direct outputs.
        harness.send(GraphCommand::SetTrackMute(1, true));
        harness.send(GraphCommand::SetTrackMute(2, true));

        let (left, _) = harness.render(16);
        let mut expected = vec![1.0; 16];
        expected[..LATENCY].fill(0.0);
        assert_eq!(
            left, expected,
            "the send off the dry track waits for the send off the latent one"
        );
    }

    /// A bus's own devices delay everything routed through it, so a track that
    /// goes straight to the master would otherwise lead the whole bus by the
    /// bus's latency.
    #[test]
    fn a_track_direct_to_the_master_waits_for_a_latent_bus_beside_it() {
        const BUS_LATENCY: usize = 5;
        let mut harness = Harness::new(64);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);
        track_with_constant_clip(&mut harness, 2, 102, 1.0, 64);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Bus(50)));

        let declared = Arc::new(AtomicUsize::new(BUS_LATENCY));
        harness.send(GraphCommand::AddPlugin(
            900,
            Box::new(LatentPlugin::new(declared, LATENT_PLUGIN_CAPACITY)),
            None,
        ));
        harness.send(insert_bus_device(50, effect(900), 0));
        harness.send(set_latency(900, BUS_LATENCY));

        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(2)
                .expect("track 2 is in the graph")
                .output_delay_frames(),
            BUS_LATENCY,
            "the direct track holds for the bus it sums beside"
        );

        let (left, _) = harness.render(16);
        let mut expected = vec![2.0; 16];
        expected[..BUS_LATENCY].fill(0.0);
        assert_eq!(left, expected);
    }

    /// Latency has a ceiling — Cubase constrains past a threshold, Pro Tools
    /// fixes a maximum. Past it the graph aligns as far as it can and says so,
    /// rather than sizing a delay line off a figure a plugin invented.
    #[test]
    fn a_latency_past_the_ceiling_clamps_its_routes_and_counts_them() {
        let declared = MAX_COMPENSATION_FRAMES + 1;
        let mut harness = Harness::new(32);
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);
        track_with_constant_clip(&mut harness, 2, 102, 1.0, 64);
        harness.send(GraphCommand::AddPlugin(
            900,
            Box::new(ScalingPlugin { factor: 1.0 }),
            None,
        ));
        harness.send(insert_track_device(1, effect(900), 0));
        harness.send(set_latency(900, declared));

        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(2)
                .expect("track 2 is in the graph")
                .output_delay_frames(),
            MAX_COMPENSATION_FRAMES,
            "the sibling holds as far as the ceiling allows"
        );
        let diagnostics = harness.diagnostics();
        assert_eq!(
            diagnostics.pdc_clamped_routes, 2,
            "the route that could not be aligned and the dry line the ceiling cut \
             short are both counted"
        );
        assert_eq!(
            diagnostics.pdc_max_arrival_frames, declared as u64,
            "the reported arrival is the figure declared, not the one the graph could hold"
        );

        // Two more passes over the same clamped graph. Both commands re-aim
        // routes that are already where they point, so nothing about the
        // alignment moves; a running total would read six here and name four
        // misaligned lines that do not exist.
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Master));
        harness.send(GraphCommand::SetTrackOutput(2, RouteTarget::Master));
        assert_eq!(
            harness.diagnostics().pdc_clamped_routes,
            2,
            "the count states what the latest pass clamped, not what every pass ever clamped"
        );

        harness.send(set_latency(900, 0));
        assert_eq!(
            harness.diagnostics().pdc_clamped_routes,
            0,
            "a graph the ceiling no longer cuts short reports nothing"
        );
    }

    /// One strip, one plugin declaring past the ceiling, no sibling to hold
    /// back: every route line in the graph is aimed at zero and clamps
    /// nothing, so the route lines alone report a perfectly aligned project.
    /// The dry line is cut short all the same, and every bypass toggle on that
    /// device shifts the strip by the difference.
    #[test]
    fn a_single_strip_declaring_past_the_ceiling_counts_its_dry_line_as_clamped() {
        let declared = MAX_COMPENSATION_FRAMES + 1;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);
        harness.send(GraphCommand::AddPlugin(
            900,
            Box::new(LatentPlugin::new(
                Arc::new(AtomicUsize::new(declared)),
                LATENT_PLUGIN_CAPACITY,
            )),
            None,
        ));
        harness.send(insert_track_device(1, effect(900), 0));
        harness.send(set_latency(900, declared));
        harness.render(16);

        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(1)
                .expect("track 1 is in the graph")
                .output_delay_frames(),
            0,
            "the lone strip holds nothing: no sibling arrives ahead of it"
        );
        assert_eq!(
            harness.diagnostics().pdc_clamped_routes,
            1,
            "the dry line the ceiling cut short is counted where no route line is"
        );

        // Pulled back to the ceiling itself, nothing is cut short any more —
        // and a figure latched rather than recounted would still read one.
        harness.send(set_latency(900, MAX_COMPENSATION_FRAMES));
        harness.render(16);
        assert_eq!(
            harness.diagnostics().pdc_clamped_routes,
            0,
            "a declaration the ceiling holds exactly is not clamped"
        );
    }

    /// A registered but unplaced device declares like any other, and a host's
    /// latency watcher goes on addressing it. No chain feeds or reads its dry
    /// line and it adds nothing to any summing point's depth, so the ceiling
    /// cuts nothing short until a strip takes it — and counting it meanwhile
    /// would report a misaligned line the mix does not contain.
    #[test]
    fn a_detached_device_declaring_past_the_ceiling_is_not_counted_until_a_strip_takes_it() {
        let declared = MAX_COMPENSATION_FRAMES + 1;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);

        // A hosted registration is homed detached, so it is registered
        // without any chain holding it.
        harness.send(GraphCommand::AddHostedPlugin(
            900,
            Box::new(LatentPlugin::new(
                Arc::new(AtomicUsize::new(declared)),
                LATENT_PLUGIN_CAPACITY,
            )),
            MidiNoteStore::new(),
        ));
        harness.send(set_latency(900, declared));
        harness.render(16);

        assert_eq!(
            harness.diagnostics().pdc_clamped_routes,
            0,
            "a device no chain holds runs no line the ceiling can cut short"
        );

        harness.send(insert_track_device(1, effect(900), 0));
        harness.render(16);
        assert_eq!(
            harness.diagnostics().pdc_clamped_routes,
            1,
            "the strip taking it puts the clamped dry line into the mix, and the count says so"
        );

        harness.send(GraphCommand::RemoveTrackDevice {
            track_id: 1,
            effect_id: 900,
        });
        harness.render(16);
        assert_eq!(
            harness.diagnostics().pdc_clamped_routes,
            0,
            "and the strip letting it go takes it back out"
        );
    }

    /// A track routed into another track is a group, and the destination's
    /// input sums exactly as a bus's does. An arrival discarded at that hop
    /// leaves the whole group early against everything beside it.
    #[test]
    fn a_latent_track_inside_a_group_still_meets_its_sibling_at_the_master() {
        const LATENCY: usize = 7;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);
        track_with_constant_clip(&mut harness, 2, 102, 1.0, 64);
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Track(3)));
        insert_latent_device(&mut harness, 1, 900, LATENCY);

        assert_eq!(
            harness.diagnostics().pdc_max_arrival_frames,
            LATENCY as u64,
            "the depth reported carries the group hop, not only what sums at the master"
        );

        let (left, _) = harness.render(16);
        let mut expected = vec![2.0; 16];
        expected[..LATENCY].fill(0.0);
        assert_eq!(
            left, expected,
            "the sibling at the master waits for the latent track inside the group"
        );
        assert_eq!(
            harness.render(16).0,
            vec![2.0; 16],
            "past the onset every frame carries both routes"
        );
    }

    /// A group carrying its own material is two sources at one point: what is
    /// routed in, which has already waited, and its own clips, which have not.
    ///
    /// The group carries a latent device of its own, so the depth of its input
    /// and that depth plus its own chain are different numbers. Aiming the
    /// source line at the latter would delay the group's clips past the track
    /// feeding them and then delay both again through the chain.
    #[test]
    fn a_groups_own_clip_waits_for_the_latent_track_routed_into_it() {
        const LATENCY: usize = 7;
        const GROUP_LATENCY: usize = 2;
        const ARRIVAL: usize = LATENCY + GROUP_LATENCY;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);
        track_with_constant_clip(&mut harness, 3, 103, 1.0, 64);
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Track(3)));
        insert_latent_device(&mut harness, 1, 900, LATENCY);
        insert_latent_device(&mut harness, 3, 901, GROUP_LATENCY);

        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(3)
                .expect("track 3 is in the graph")
                .source_delay_frames(),
            LATENCY,
            "the group's own clips are aimed at the depth of its input, not at that depth plus its own chain"
        );

        let (left, _) = harness.render(16);
        let mut expected = vec![2.0; 16];
        expected[..ARRIVAL].fill(0.0);
        assert_eq!(
            left, expected,
            "the group's clip does not sound ahead of the track feeding it, and the pair leaves the group's own device together"
        );
        assert_eq!(
            harness.render(16).0,
            vec![2.0; 16],
            "past the onset the group carries both sources"
        );
    }

    /// The depth every generator fixture below waits on: the latency of the
    /// device on the track routed into the strip under test, and so the depth
    /// of that strip's input.
    const INPUT_DEPTH: usize = 64;

    /// A track carrying a constant behind a genuinely late device, routed into
    /// `into` — the material an instrument on that strip has to meet.
    fn latent_track_routed_into(harness: &mut Harness, into: RouteTarget) {
        track_with_constant_clip(harness, 1, 101, 1.0, 512);
        harness.send(GraphCommand::SetTrackOutput(1, into));
        insert_latent_device(harness, 1, 900, INPUT_DEPTH);
    }

    /// A group's own clips wait for what is routed into it, and an instrument
    /// on that group is the same kind of source: it produces at zero where the
    /// route has already waited. Unheld, a synth on a drum group would sound a
    /// device's latency ahead of the drums feeding it — the alignment the
    /// group exists to make.
    #[test]
    fn a_generator_on_a_group_waits_for_the_latent_track_routed_into_it() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        latent_track_routed_into(&mut harness, RouteTarget::Track(3));
        insert_track_generator(
            &mut harness,
            3,
            901,
            Box::new(ConstantGenerator { value: 1.0 }),
            0,
        );

        let (left, _) = harness.render(128);
        let mut expected = vec![2.0; 128];
        expected[..INPUT_DEPTH].fill(0.0);
        assert_eq!(
            left, expected,
            "the instrument on the group sounds on the frame the track routed into it does, not before"
        );
    }

    /// A bus hosts an instrument on the same terms a track does, and its input
    /// is a summing point of exactly the same kind. Aiming only the tracks
    /// would leave a synth on a bus early by the depth of everything routed
    /// into it.
    #[test]
    fn a_generator_on_a_bus_waits_for_the_latent_track_routed_into_it() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        latent_track_routed_into(&mut harness, RouteTarget::Bus(50));
        insert_bus_generator(
            &mut harness,
            50,
            901,
            Box::new(ConstantGenerator { value: 1.0 }),
            0,
        );

        let (left, _) = harness.render(128);
        let mut expected = vec![2.0; 128];
        expected[..INPUT_DEPTH].fill(0.0);
        assert_eq!(
            left, expected,
            "the instrument on the bus sounds on the frame the track routed into it does, not before"
        );
    }

    /// One strip can carry several instruments — the fan-in the app's chain
    /// builds — and each holds its own material. A line shared between two of
    /// them would take both signals in and hand back an interleaving of the
    /// two, which a ramp shows and a pair of constants would hide.
    #[test]
    fn two_generators_on_one_strip_each_wait_their_own_hold() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        latent_track_routed_into(&mut harness, RouteTarget::Track(3));
        insert_track_generator(&mut harness, 3, 901, Box::<RampGenerator>::default(), 0);
        insert_track_generator(
            &mut harness,
            3,
            902,
            Box::new(ConstantGenerator { value: 1.0 }),
            1,
        );

        let (left, _) = harness.render(128);
        let expected: Vec<f32> = (0..128usize)
            .map(|frame| match frame.checked_sub(INPUT_DEPTH) {
                // The routed-in constant, the second instrument's constant,
                // and the first instrument's own frame number.
                Some(produced) => produced as f32 + 2.0,
                None => 0.0,
            })
            .collect();
        assert_eq!(
            left, expected,
            "each instrument's own material comes back out of its own line, in order"
        );
    }

    /// The hold is the depth of what arrives at the strip's input, and nothing
    /// else. A strip's own chain latency is behind the instrument, not ahead of
    /// it: counting it would hold the instrument by that latency twice and put
    /// it late against the very route it is meeting.
    #[test]
    fn a_generator_hold_is_aimed_by_input_depth_not_the_strips_own_latency() {
        const OWN_LATENCY: usize = 32;
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        latent_track_routed_into(&mut harness, RouteTarget::Track(3));
        insert_track_generator(
            &mut harness,
            3,
            901,
            Box::new(ConstantGenerator { value: 1.0 }),
            0,
        );
        insert_latent_device_at(&mut harness, 3, 902, OWN_LATENCY, 1);

        let (left, _) = harness.render(192);
        let mut expected = vec![2.0; 192];
        expected[..INPUT_DEPTH + OWN_LATENCY].fill(0.0);
        assert_eq!(
            left, expected,
            "the instrument leaves the group's own device on the frame the routed-in material does"
        );
    }

    /// The chain sums an instrument's material at that instrument's own index,
    /// where the signal has already taken the latency of everything ahead of
    /// it. So the hold is the input's depth plus that declared prefix: aimed at
    /// the depth alone, a synth spliced behind the group's own lookahead
    /// limiter would lead the drums feeding the group by the limiter's latency
    /// — the group aligning every source except the one it hosts itself.
    #[test]
    fn a_generator_after_a_latent_device_waits_for_that_device_too() {
        const AHEAD: usize = 32;
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        latent_track_routed_into(&mut harness, RouteTarget::Track(3));
        insert_latent_device_at(&mut harness, 3, 902, AHEAD, 0);
        insert_track_generator(
            &mut harness,
            3,
            901,
            Box::new(ConstantGenerator { value: 1.0 }),
            1,
        );

        let (left, _) = harness.render(192);
        let mut expected = vec![2.0; 192];
        expected[..INPUT_DEPTH + AHEAD].fill(0.0);
        assert_eq!(
            left, expected,
            "the instrument joins the chain on the frame the routed-in material reaches that same point, not the frame it reached the strip's input"
        );
    }

    /// A bus sums its chain exactly as a track does, so an instrument behind a
    /// latent device on a bus owes the same prefix. Aiming the bus generators
    /// by the input's depth alone would leave a synth on a send bus early by
    /// the latency of the reverb the bus exists to host.
    #[test]
    fn a_generator_after_a_latent_device_on_a_bus_waits_for_that_device_too() {
        const AHEAD: usize = 32;
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        latent_track_routed_into(&mut harness, RouteTarget::Bus(50));

        harness.send(GraphCommand::AddPlugin(
            902,
            Box::new(LatentPlugin::new(
                Arc::new(AtomicUsize::new(AHEAD)),
                LATENT_PLUGIN_CAPACITY,
            )),
            None,
        ));
        harness.send(insert_bus_device(50, effect(902), 0));
        harness.send(set_latency(902, AHEAD));

        insert_bus_generator(
            &mut harness,
            50,
            901,
            Box::new(ConstantGenerator { value: 1.0 }),
            1,
        );

        let (left, _) = harness.render(192);
        let mut expected = vec![2.0; 192];
        expected[..INPUT_DEPTH + AHEAD].fill(0.0);
        assert_eq!(
            left, expected,
            "the instrument on the bus joins the chain on the frame the routed-in material reaches that same point"
        );
    }

    /// A device released from a chain runs nowhere, so nothing feeds or reads
    /// the hold it was running: kept across the release it would hand the
    /// material it produced on the old strip back over the first held frames
    /// after some chain takes it again. The splice that takes it ships a fresh
    /// silent line and the device installs that one instead.
    #[test]
    fn a_reinserted_generator_takes_a_fresh_silent_hold() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        latent_track_routed_into(&mut harness, RouteTarget::Track(3));
        insert_track_generator(
            &mut harness,
            3,
            901,
            Box::new(ConstantGenerator { value: 1.0 }),
            0,
        );

        // Long enough that the hold is full of the instrument's own material
        // rather than of the silence it was built with.
        harness.render(128);
        harness.send(GraphCommand::RemoveTrackDevice {
            track_id: 3,
            effect_id: 901,
        });
        harness.send(insert_track_device(3, generator(901), 0));

        let (left, _) = harness.render(128);
        let mut expected = vec![2.0; 128];
        expected[..INPUT_DEPTH].fill(1.0);
        assert_eq!(
            left, expected,
            "the re-spliced instrument owes silence for its hold, and only the routed-in track sounds meanwhile"
        );
    }

    /// A bypassed instrument is a device the chain still visits, so its hold
    /// takes its pass like every other line: over the silence the chain clears
    /// for the instrument, which drains the tail the hold was carrying and
    /// fills it with the silence the un-bypass then hands back. Skipped
    /// through the bypass, the line would stand still and replay the material
    /// from before the switch — the burst of stale audio the rule that every
    /// line is written on every block it renders exists to prevent.
    #[test]
    fn a_bypassed_generator_keeps_its_hold_flowing() {
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        latent_track_routed_into(&mut harness, RouteTarget::Track(3));
        insert_track_generator(
            &mut harness,
            3,
            901,
            Box::new(ConstantGenerator { value: 1.0 }),
            0,
        );

        // Past the onset both sources are up, so what the switch does is a
        // change in a steady mix rather than a difference from silence.
        let (settled, _) = harness.render(128);
        assert_eq!(
            settled[INPUT_DEPTH..],
            vec![2.0; 128 - INPUT_DEPTH][..],
            "the instrument and the track routed into it are both sounding before the switch"
        );

        harness.send(GraphCommand::SetBypass(901, true));
        let (bypassed, _) = harness.render(128);
        let mut expected = vec![1.0; 128];
        expected[..INPUT_DEPTH].fill(2.0);
        assert_eq!(
            bypassed, expected,
            "the material the instrument produced before the bypass drains out of its hold on schedule, and only the routed-in track sounds after it"
        );

        harness.send(GraphCommand::SetBypass(901, false));
        let (restored, _) = harness.render(128);
        let mut expected = vec![2.0; 128];
        expected[..INPUT_DEPTH].fill(1.0);
        assert_eq!(
            restored, expected,
            "the silence the hold was fed while the instrument was bypassed comes back out before the instrument does"
        );
    }

    /// The latency an instrument declares is the frames between asking it for
    /// material and getting that material back, so everything else on the
    /// strip has to leave the device that late as well. Unheld, a track's clip
    /// would sound the instrument's latency ahead of the arrival the chain
    /// declares for it — and ahead of every sibling the graph then holds to
    /// meet that arrival.
    #[test]
    fn a_latent_generator_holds_the_strip_material_it_joins() {
        const DECLARED: usize = 32;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 512);
        insert_latent_track_generator(&mut harness, 1, 901, DECLARED, 0);

        let (left, _) = harness.render(128);
        let mut expected = vec![2.0; 128];
        expected[..DECLARED].fill(0.0);
        assert_eq!(
            left, expected,
            "the clip leaves the instrument on the frame the instrument's own material does"
        );
    }

    /// The test above shows the hold's onset but not its content: a constant
    /// clip reads identically whether the pass-through was genuinely delayed
    /// or merely zeroed for the same number of frames. A ramp clip names its
    /// own frame, so a dry line fed a second time somewhere — racing its
    /// write head ahead and reading back the wrong slots — shows up as wrong
    /// numbers here rather than the same on/off transition landing right by
    /// coincidence.
    #[test]
    fn a_latent_generator_holds_the_ramp_content_the_strip_carries() {
        const DECLARED: usize = 32;
        const BLOCK: usize = 32;
        const CALLBACKS: usize = 4;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_ramp_clip(&mut harness, 1, 101, BLOCK * CALLBACKS);
        insert_latent_track_generator(&mut harness, 1, 901, DECLARED, 0);

        // Rendered as separate callbacks rather than one call for the whole
        // span: a dry line fed a second time somewhere writes an extra
        // block's worth into the ring between callbacks, so only a read that
        // actually crosses a callback boundary can catch it — a single call
        // covering the whole span never gives the ring a chance to be read
        // back before that second write lands.
        let mut left = Vec::with_capacity(BLOCK * CALLBACKS);
        for _ in 0..CALLBACKS {
            left.extend(harness.render(BLOCK).0);
        }

        // The clip's own content, held back to the instrument's declared
        // latency, plus the instrument's material once its own latency has
        // passed.
        let mut expected = delayed_ramp(0, BLOCK * CALLBACKS, DECLARED);
        for sample in &mut expected[DECLARED..] {
            *sample += 1.0;
        }
        assert_eq!(
            left, expected,
            "the clip's exact ramp content arrives held to the instrument's declared latency, \
             summed with the instrument's own material"
        );
    }

    /// A strip's arrival is the latency its whole chain declares, generators
    /// included, and the graph holds every sibling back to that figure. If the
    /// instrument's latency counted at the summing point but delayed nothing
    /// on the strip, the sibling would be held for a latency the strip never
    /// actually took and would sound late against it.
    #[test]
    fn a_sibling_waits_for_a_strip_carrying_a_latent_generator() {
        const DECLARED: usize = 32;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 512);
        insert_latent_track_generator(&mut harness, 1, 901, DECLARED, 0);
        track_with_constant_clip(&mut harness, 2, 102, 1.0, 512);

        let (left, _) = harness.render(128);
        let mut expected = vec![3.0; 128];
        expected[..DECLARED].fill(0.0);
        assert_eq!(
            left, expected,
            "the sibling track and the strip carrying the instrument reach the master together"
        );
    }

    /// Bypass keeps latency, so a bypassed instrument goes on holding what
    /// passes through it. Dropping the hold with the processing would shift
    /// the strip against the rest of the mix on the switch — the very thing
    /// keeping a bypassed device's latency exists to prevent.
    #[test]
    fn a_bypassed_latent_generator_still_holds_the_strip_material() {
        const DECLARED: usize = 32;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 512);
        insert_latent_track_generator(&mut harness, 1, 901, DECLARED, 0);
        harness.send(GraphCommand::SetBypass(901, true));

        let (left, _) = harness.render(128);
        let mut expected = vec![1.0; 128];
        expected[..DECLARED].fill(0.0);
        assert_eq!(
            left, expected,
            "only the clip sounds, and it still leaves the bypassed instrument at that instrument's declared latency"
        );
    }

    /// What is routed into a group passes through the group's chain like the
    /// group's own material, so a latent instrument on the group holds it too.
    /// Unheld, the routed-in track would leave the group ahead of the arrival
    /// the group declares and reach the master early.
    #[test]
    fn a_latent_generator_on_a_group_holds_the_routed_in_material_too() {
        const DECLARED: usize = 32;
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        latent_track_routed_into(&mut harness, RouteTarget::Track(3));
        insert_latent_track_generator(&mut harness, 3, 901, DECLARED, 0);

        let (left, _) = harness.render(192);
        let mut expected = vec![2.0; 192];
        expected[..INPUT_DEPTH + DECLARED].fill(0.0);
        assert_eq!(
            left, expected,
            "the routed-in track leaves the group's instrument on the frame that instrument's own material does"
        );
    }

    /// An instrument behind a latent instrument joins the chain where the
    /// signal has already taken that latency, so its hold owes the prefix a
    /// latent effect there would owe. Counting only effects in that prefix
    /// would leave the second instrument early by the first one's latency,
    /// against the very route the group exists to meet.
    #[test]
    fn a_generator_behind_a_latent_generator_waits_for_that_latency_too() {
        const AHEAD: usize = 32;
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        latent_track_routed_into(&mut harness, RouteTarget::Track(3));
        insert_latent_track_generator(&mut harness, 3, 901, AHEAD, 0);
        insert_track_generator(
            &mut harness,
            3,
            902,
            Box::new(ConstantGenerator { value: 1.0 }),
            1,
        );

        let (left, _) = harness.render(192);
        let mut expected = vec![3.0; 192];
        expected[..INPUT_DEPTH + AHEAD].fill(0.0);
        assert_eq!(
            left, expected,
            "the second instrument joins the chain on the frame the material already on it reaches that same point"
        );
    }

    /// A splice the graph refuses still arrived carrying a line, and the line
    /// is heap: freeing it on the callback is exactly the drop ADR 0020
    /// forbids, so it leaves over the retirement channel like every other
    /// buffer the graph gives up.
    #[test]
    fn a_refused_generator_insert_retires_the_shipped_hold() {
        let mut harness = Harness::new(32);
        harness.send(GraphCommand::AddHostedPlugin(
            901,
            Box::new(ConstantGenerator { value: 1.0 }),
            MidiNoteStore::new(),
        ));

        // No track 7 in the graph, so the splice is refused with its line
        // still on it.
        harness.send(insert_track_device(7, generator(901), 0));

        let retired = harness
            .retired_rx
            .pop()
            .expect("the refused splice must hand its line off, never free it on the callback");
        assert!(
            matches!(
                &retired.timeline_object,
                Some(RetiredTimelineObject::Delay(_))
            ),
            "the refused splice's own line is what leaves"
        );
    }

    /// An instrument on a group waits on the same input its clips do, so the
    /// ceiling cutting both short is one summing point the graph could not
    /// align — not two. Counting each line would report a project with more
    /// misaligned routes than it has.
    #[test]
    fn a_clamped_generator_hold_counts_once_with_its_strips_source_line() {
        let declared = MAX_COMPENSATION_FRAMES + 1;
        let mut harness = Harness::new(32);
        harness.playing();
        track_with_constant_clip(&mut harness, 3, 103, 1.0, 64);
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Track(3)));
        insert_latent_device(&mut harness, 1, 900, declared);

        assert_eq!(
            harness.diagnostics().pdc_clamped_routes,
            2,
            "the group's source line and the device's own dry line are what the ceiling cut short"
        );

        insert_track_generator(
            &mut harness,
            3,
            901,
            Box::new(ConstantGenerator { value: 1.0 }),
            0,
        );

        assert_eq!(
            harness.diagnostics().pdc_clamped_routes,
            2,
            "the instrument waits on the input its strip's clips wait on, so the strip still counts once"
        );
    }

    /// A bus's input is one summing point too, and it carries no clips — so the
    /// generators on it are the whole of what the ceiling can cut short there.
    /// The bus counts once whatever it hosts: counting each instrument would
    /// report a project with more misaligned routes than it has summing points.
    #[test]
    fn a_clamped_generator_hold_on_a_bus_counts_the_bus_once() {
        let declared = MAX_COMPENSATION_FRAMES + 1;
        let mut harness = Harness::new(32);
        harness.playing();
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Bus(50)));
        insert_latent_device(&mut harness, 1, 900, declared);

        let base = harness.diagnostics().pdc_clamped_routes;
        assert_eq!(
            base, 1,
            "with no instrument on it the bus contributes nothing to the count, and the device's own dry line is what the ceiling cut short"
        );

        insert_bus_generator(
            &mut harness,
            50,
            901,
            Box::new(ConstantGenerator { value: 1.0 }),
            0,
        );
        assert_eq!(
            harness.diagnostics().pdc_clamped_routes,
            base + 1,
            "the bus's input is a summing point the ceiling could not align, and the count says so"
        );

        insert_bus_generator(
            &mut harness,
            50,
            902,
            Box::new(ConstantGenerator { value: 1.0 }),
            1,
        );
        assert_eq!(
            harness.diagnostics().pdc_clamped_routes,
            base + 1,
            "a second instrument waits on the same input, so the bus still counts once"
        );
    }

    /// A group aligns the strips meeting on its input against each other, and
    /// what it then sums at is a further point again: a track going straight
    /// to the master waits for the whole hop.
    #[test]
    fn a_group_aligns_its_contributors_and_carries_their_depth_onward() {
        const DEEP: usize = 7;
        const SHALLOW: usize = 3;
        let mut harness = Harness::new(48);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);
        track_with_constant_clip(&mut harness, 2, 102, 1.0, 64);
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        track_with_constant_clip(&mut harness, 4, 104, 1.0, 64);
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Track(3)));
        harness.send(GraphCommand::SetTrackOutput(2, RouteTarget::Track(3)));
        insert_latent_device(&mut harness, 1, 900, DEEP);
        insert_latent_device(&mut harness, 2, 901, SHALLOW);

        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(2)
                .expect("track 2 is in the graph")
                .output_delay_frames(),
            DEEP - SHALLOW,
            "the shallower strip waits for the deeper one at the group's input"
        );
        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(4)
                .expect("track 4 is in the graph")
                .output_delay_frames(),
            DEEP,
            "the track straight to the master waits for the whole group hop"
        );

        let (left, _) = harness.render(16);
        let mut expected = vec![3.0; 16];
        expected[..DEEP].fill(0.0);
        assert_eq!(
            left, expected,
            "the group's two strips and the direct track land on one frame"
        );
    }

    /// Compensation is recursive: a bus that feeds another bus contributes its
    /// own arrival to the next summing point, so the delays along a chain of
    /// hops add up.
    #[test]
    fn delays_along_two_bus_hops_sum_at_the_master() {
        const FIRST_HOP: usize = 3;
        const SECOND_HOP: usize = 5;
        let mut harness = Harness::new(64);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 64);
        track_with_constant_clip(&mut harness, 2, 102, 1.0, 64);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::AddBus(TimelineBus::new(51)));
        harness.send(GraphCommand::SetTrackOutput(1, RouteTarget::Bus(50)));
        harness.send(GraphCommand::SetBusOutput(50, RouteTarget::Bus(51)));

        for (effect_id, bus_id, latency) in [(900, 50, FIRST_HOP), (901, 51, SECOND_HOP)] {
            let declared = Arc::new(AtomicUsize::new(latency));
            harness.send(GraphCommand::AddPlugin(
                effect_id,
                Box::new(LatentPlugin::new(declared, LATENT_PLUGIN_CAPACITY)),
                None,
            ));
            harness.send(insert_bus_device(bus_id, effect(effect_id), 0));
            harness.send(set_latency(effect_id, latency));
        }

        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(2)
                .expect("track 2 is in the graph")
                .output_delay_frames(),
            FIRST_HOP + SECOND_HOP,
            "the direct track holds for both hops, not just the last one"
        );

        let (left, _) = harness.render(16);
        let mut expected = vec![2.0; 16];
        expected[..FIRST_HOP + SECOND_HOP].fill(0.0);
        assert_eq!(left, expected);
    }

    /// A send lands on a bus's input, and that bus's own arrival carries on to
    /// whatever it feeds. A send aimed at a bus that is itself a contributor
    /// rather than the last stop is two hops from the master, and every hop
    /// has to be on the path the graph compensates.
    ///
    /// The second hop carries latency of its own, so the send's hold at the
    /// bus it lands on and the master's depth are different figures: a send
    /// aimed at anything but its own summing point arrives late here rather
    /// than passing by coincidence.
    #[test]
    fn a_send_into_a_bus_feeding_another_bus_lands_with_the_track_beside_it() {
        const LATENCY: usize = 7;
        const SECOND_HOP: usize = 5;
        const MASTER_ONSET: usize = LATENCY + SECOND_HOP;
        const SEND_LEVEL: f32 = 0.5;
        const ALIGNED: f32 = 2.0 + SEND_LEVEL;
        let mut harness = Harness::new(64);
        harness.playing();
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 128);
        track_with_constant_clip(&mut harness, 2, 102, 1.0, 128);
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::AddBus(TimelineBus::new(51)));
        harness.send(GraphCommand::SetBusOutput(50, RouteTarget::Bus(51)));
        insert_latent_device(&mut harness, 1, 900, LATENCY);
        let declared = Arc::new(AtomicUsize::new(SECOND_HOP));
        harness.send(GraphCommand::AddPlugin(
            901,
            Box::new(LatentPlugin::new(declared, LATENT_PLUGIN_CAPACITY)),
            None,
        ));
        harness.send(insert_bus_device(51, effect(901), 0));
        harness.send(set_latency(901, SECOND_HOP));
        harness.send(GraphCommand::AddSend {
            track_id: 1,
            bus_id: 50,
            tap: SendTap::PreFader,
            level: SEND_LEVEL,
            delay: uncompensated(),
        });

        let track_one = harness
            .scheduler
            .timeline()
            .track(1)
            .expect("track 1 is in the graph");
        assert_eq!(
            track_one.send_delay_frames(50),
            Some(0),
            "the send is aimed at the depth of the bus it lands on, which its own \
             arrival already matches"
        );
        assert_eq!(
            harness
                .scheduler
                .timeline()
                .track(2)
                .expect("track 2 is in the graph")
                .output_delay_frames(),
            MASTER_ONSET,
            "the direct track waits the whole path the send takes to the master"
        );

        let (left, _) = harness.render(16);
        let mut expected = vec![ALIGNED; 16];
        expected[..MASTER_ONSET].fill(0.0);
        assert_eq!(
            left, expected,
            "the send arrives at the master over both bus hops on the frame the direct \
             track and the latent track's own output arrive"
        );
        assert_eq!(
            harness.render(16).0,
            vec![ALIGNED; 16],
            "past the onset every frame carries all three routes"
        );
    }

    /// A note the control thread stamps for one timeline frame.
    fn timed_note(at_frame: u64, note: u8) -> TimedMidiNote {
        TimedMidiNote {
            at_frame,
            event: note_on(note),
        }
    }

    /// The command a control thread ships for a run of notes: one note-on per
    /// frame named, in the order they are named.
    fn schedule_notes(plugin_id: usize, frames: &[u64]) -> GraphCommand {
        let notes: Vec<TimedMidiNote> = frames.iter().map(|frame| timed_note(*frame, 60)).collect();
        GraphCommand::ScheduleMidiNotes {
            plugin_id,
            notes: notes.into(),
        }
    }

    /// The same command for a phrase that names its own notes and releases:
    /// `(frame, note, is_note_on)`, already in the frame order the store keeps.
    fn schedule_phrase(plugin_id: usize, events: &[(u64, u8, bool)]) -> GraphCommand {
        let notes: Vec<TimedMidiNote> = events
            .iter()
            .map(|(frame, note, is_note_on)| {
                let mut timed = timed_note(*frame, *note);
                timed.event.is_note_on = *is_note_on;
                timed
            })
            .collect();
        GraphCommand::ScheduleMidiNotes {
            plugin_id,
            notes: notes.into(),
        }
    }

    /// The batch as a producer authored it, put in order by the same
    /// control-side step [`crate::EngineHandle::schedule_midi_notes`] takes —
    /// which is what a scheduler test drives when the authoring order is the
    /// thing under test.
    fn schedule_authored(plugin_id: usize, events: &[(u64, u8)]) -> GraphCommand {
        let mut notes: Vec<TimedMidiNote> = events
            .iter()
            .map(|(frame, note)| timed_note(*frame, *note))
            .collect();
        notes.sort_by_key(|note| note.at_frame);
        GraphCommand::ScheduleMidiNotes {
            plugin_id,
            notes: notes.into(),
        }
    }

    fn received_notes(received: &Arc<Mutex<Vec<RecordedNote>>>) -> Vec<RecordedNote> {
        received.lock().expect("the received note log").clone()
    }

    fn received_frames(received: &Arc<Mutex<Vec<RecordedNote>>>) -> Vec<u64> {
        received_notes(received)
            .iter()
            .map(|(frame, _, _)| *frame)
            .collect()
    }

    fn midi_diagnostics(harness: &Harness) -> ActiveMidiRtDiagnosticsSnapshot {
        harness.scheduler.midi_rt_diagnostics.snapshot()
    }

    /// How many notes the graph is holding for one plugin, read from the
    /// effect table itself.
    ///
    /// A refusal that kept a prefix is invisible from outside the engine until
    /// some later block renders the frames it kept, which may be never.
    fn stored_note_count(harness: &Harness, plugin_id: usize) -> usize {
        harness
            .scheduler
            .effects
            .iter()
            .find(|effect| effect.id == plugin_id)
            .and_then(|effect| effect.midi_notes.as_ref())
            .map_or(0, |store| store.entries().len())
    }

    /// A playing track carrying a [`FrameRecordingInstrument`], spliced the
    /// way a hosted instrument arrives.
    fn track_with_recording_instrument(
        harness: &mut Harness,
        track_id: usize,
        effect_id: usize,
    ) -> Arc<Mutex<Vec<RecordedNote>>> {
        const CLIP_FRAMES: usize = 8_192;

        track_with_constant_clip(harness, track_id, track_id + 100, 1.0, CLIP_FRAMES);
        let (instrument, received) = FrameRecordingInstrument::new();
        insert_track_generator(harness, track_id, effect_id, instrument, 0);
        received
    }

    /// A scheduled note reaches the instrument on the sample that renders its
    /// timeline frame, in the block that renders it.
    ///
    /// The frames named straddle a block boundary, so a delivery that shipped
    /// no offset and one that measured the offset from the wrong block both
    /// land somewhere the assertion names.
    #[test]
    fn a_scheduled_note_reaches_the_instrument_on_its_timeline_frame_across_a_block_boundary() {
        const BLOCK: usize = 32;
        const SCHEDULED: [u64; 4] = [5, 31, 32, 63];

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_notes(7, &SCHEDULED));

        harness.render(BLOCK);
        harness.render(BLOCK);

        assert_eq!(received_frames(&received), SCHEDULED.to_vec());
    }

    /// A scheduled note belongs to its frame, not to a pass over it: every
    /// loop pass that renders that frame delivers the note again. The entry
    /// persists, so the second time round the region sounds like the first.
    #[test]
    fn a_scheduled_note_fires_on_every_loop_pass_that_renders_its_frame() {
        const LOOP_START: u64 = 512;
        const LOOP_END: u64 = 1_536;
        const NOTE_FRAME: u64 = 600;
        const PASS: u64 = LOOP_END - LOOP_START;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.send(GraphCommand::SetLoopRegion(LoopRegion {
            enabled: true,
            start_frame: LOOP_START,
            end_frame: LOOP_END,
        }));
        harness.playing();
        harness.send(GraphCommand::SeekFrames(LOOP_START));
        harness.send(schedule_notes(7, &[NOTE_FRAME]));

        // One callback long enough to hold both passes, so the seam splits it
        // and the assertion is about the spans the seam yields rather than
        // about two separate callbacks.
        harness.render(2 * PASS as usize);

        let into_region = NOTE_FRAME - LOOP_START;
        assert_eq!(
            received_notes(&received),
            vec![
                (into_region, 60, true),
                // The seam closes the note the first pass left sounding, on
                // the frame the region restarts at.
                (PASS, 60, false),
                (PASS + into_region, 60, true),
            ],
            "the second pass delivers the note again, one region later in the render stream"
        );
    }

    /// A locate past a scheduled note leaves it where it is. No block rendered
    /// its frame, so nothing fires — and nothing is counted late, because
    /// lateness is about where the playhead stood when the note was scheduled,
    /// not about where it has been since.
    #[test]
    fn a_locate_past_a_scheduled_note_does_not_fire_it() {
        const NOTE_FRAME: u64 = 100;
        const LOCATE_TO: u64 = 512;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_notes(7, &[NOTE_FRAME]));
        harness.send(GraphCommand::SeekFrames(LOCATE_TO));

        harness.render(64);

        assert!(
            received_frames(&received).is_empty(),
            "a note the playhead skipped over is not fired at the head of the block after it"
        );
        assert_eq!(midi_diagnostics(&harness).late_midi_notes, 0);
    }

    /// Clearing a window takes out exactly the notes inside it. The bounds are
    /// half-open, so a clear aimed between two notes leaves both of them.
    #[test]
    fn clearing_a_window_removes_only_the_notes_inside_it() {
        const SCHEDULED: [u64; 3] = [10, 40, 70];
        const WINDOW_FROM: u64 = 32;
        const WINDOW_TO: u64 = 64;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_notes(7, &SCHEDULED));
        harness.send(GraphCommand::ClearMidiNotes {
            plugin_id: 7,
            from_frame: WINDOW_FROM,
            to_frame: WINDOW_TO,
        });

        harness.render(96);

        assert_eq!(received_frames(&received), vec![10, 70]);
    }

    /// A batch past the store's free capacity is refused whole and counted.
    /// Keeping the prefix that fits would silence an arbitrary tail of a
    /// phrase and leave the caller nothing to notice it by.
    #[test]
    fn an_over_capacity_batch_is_refused_whole_and_counted() {
        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();

        let over_capacity: Vec<u64> =
            (0..crate::midi::note_store::MIDI_NOTE_STORE_CAPACITY as u64 + 1).collect();
        harness.send(schedule_notes(7, &over_capacity));

        assert_eq!(stored_note_count(&harness, 7), 0);
        assert_eq!(midi_diagnostics(&harness).midi_note_batches_refused, 1);

        harness.send(schedule_notes(7, &[5]));
        harness.render(32);

        assert_eq!(
            received_frames(&received),
            vec![5],
            "a refusal is about the batch, so the next batch that fits still applies"
        );
    }

    /// A note scheduled behind the playhead is stored and counted late, never
    /// fired. Firing it would put it out of order against everything already
    /// sounding, and dropping it would lose it for the next pass over its
    /// frame.
    #[test]
    fn a_note_behind_the_playhead_is_stored_and_counted_late() {
        const BLOCK: usize = 64;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.render(BLOCK);

        harness.send(schedule_notes(7, &[0]));

        assert_eq!(midi_diagnostics(&harness).late_midi_notes, 1);

        harness.render(BLOCK);

        assert!(
            received_frames(&received).is_empty(),
            "a late note is not fired at the head of the next block"
        );

        harness.send(GraphCommand::SeekFrames(0));
        harness.render(BLOCK);

        assert_eq!(
            received_frames(&received),
            vec![2 * BLOCK as u64],
            "the stored note sounds on frame 0 of the pass that renders it, two blocks into \
             the render stream"
        );
    }

    /// An effect ships no note store, so a batch aimed at one is refused whole
    /// and counted rather than reaching a device with nowhere to keep it.
    #[test]
    fn an_effect_without_a_store_refuses_scheduled_notes() {
        let mut harness = Harness::new(32);
        track_with_constant_clip(&mut harness, 1, 101, 1.0, 1_024);
        let (instrument, received) = FrameRecordingInstrument::new();
        harness.send(GraphCommand::AddPlugin(7, instrument, None));
        harness.send(insert_track_device(1, effect(7), 0));
        harness.playing();

        harness.send(schedule_notes(7, &[5]));
        harness.render(32);

        assert_eq!(midi_diagnostics(&harness).midi_note_batches_refused, 1);
        assert!(received_frames(&received).is_empty());
    }

    /// A stopped transport sounds no scheduled note. The playhead stands still,
    /// so every callback renders the same span: a note under it would retrigger
    /// at the block rate for as long as the transport stayed stopped. Notes
    /// written against the timeline are arrangement material exactly as a clip
    /// is, and a stopped transport plays neither.
    #[test]
    fn a_stopped_transport_does_not_re_fire_a_scheduled_note_every_callback() {
        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.send(schedule_notes(7, &[5]));

        for _ in 0..3 {
            harness.render(32);
        }

        assert!(received_frames(&received).is_empty());
    }

    /// Two batches written against overlapping frames reach the instrument in
    /// one non-decreasing run, whatever order their producers authored them
    /// in. A plugin is owed a block's events in time order — CLAP requires it
    /// — and two notes sharing a frame keep the order they were stored in,
    /// which is the only order a producer can express for them.
    #[test]
    fn notes_scheduled_in_two_interleaving_batches_reach_the_instrument_in_frame_order() {
        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();

        harness.send(schedule_authored(7, &[(40, 63), (10, 60)]));
        harness.send(schedule_authored(7, &[(25, 62), (10, 61)]));

        harness.render(64);

        assert_eq!(
            received_notes(&received),
            vec![
                (10, 60, true),
                (10, 61, true),
                (25, 62, true),
                (40, 63, true),
            ],
            "the two batches merge into one run in frame order, the pair on frame 10 in the \
             order the batches carrying them arrived"
        );
    }

    /// Stopping the transport releases every note the store has sounded. The
    /// playhead stands still, so the frame each note's note-off was written
    /// for is never rendered, and the instrument would hold those keys for as
    /// long as the transport stayed stopped.
    ///
    /// A note the store already released is not released twice: its note-off
    /// was delivered where the producer wrote it, and a second one is a
    /// message the instrument never asked for.
    #[test]
    fn stopping_the_transport_releases_every_note_the_store_has_sounded() {
        const BLOCK: usize = 64;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_phrase(
            7,
            &[(10, 60, true), (20, 61, true), (30, 61, false)],
        ));

        harness.render(BLOCK);
        harness.send(GraphCommand::SetTransport(TransportState::default()));
        harness.render(BLOCK);

        assert_eq!(
            received_notes(&received),
            vec![
                (10, 60, true),
                (20, 61, true),
                (30, 61, false),
                (BLOCK as u64, 60, false),
            ],
            "only the note still sounding is released, at the head of what renders next"
        );
    }

    /// A locate while playing releases every note the store has sounded. The
    /// playhead leaves the frames those notes' note-offs were written for
    /// behind, so nothing is going to render them.
    ///
    /// A note scheduled past the locate target sounds on its own frame in the
    /// same block. Without it the release alone would read the same whether
    /// the locate resumed playback or silenced the instrument for good.
    #[test]
    fn a_locate_while_playing_releases_every_note_the_store_has_sounded() {
        const BLOCK: usize = 64;
        const LOCATE_TO: u64 = 4_096;
        const AFTER_LOCATE: u64 = 10;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_phrase(
            7,
            &[
                (10, 60, true),
                (700, 60, false),
                (LOCATE_TO + AFTER_LOCATE, 62, true),
            ],
        ));

        harness.render(BLOCK);
        harness.send(GraphCommand::SeekFrames(LOCATE_TO));
        harness.render(BLOCK);

        assert_eq!(
            received_notes(&received),
            vec![
                (10, 60, true),
                (BLOCK as u64, 60, false),
                (BLOCK as u64 + AFTER_LOCATE, 62, true),
            ],
            "the note sounding when the playhead moved is released at the head of what plays \
             from the new position, and the new position goes on playing"
        );
    }

    /// A loop wrap releases a note whose note-off lies past the seam. The pass
    /// never reaches that frame, so without the release the note is held while
    /// the region starts again — and every further pass presses the same key
    /// once more.
    #[test]
    fn a_loop_wrap_releases_a_note_whose_note_off_lies_past_the_seam() {
        const LOOP_END: u64 = 512;
        const NOTE_ON: u64 = 10;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.send(GraphCommand::SetLoopRegion(LoopRegion {
            enabled: true,
            start_frame: 0,
            end_frame: LOOP_END,
        }));
        harness.playing();
        harness.send(schedule_phrase(7, &[(NOTE_ON, 60, true), (700, 60, false)]));

        // One callback holding both passes, so the seam falls inside it and
        // the release is measured against the same render stream as the notes.
        harness.render(2 * LOOP_END as usize);

        assert_eq!(
            received_notes(&received),
            vec![
                (NOTE_ON, 60, true),
                (LOOP_END, 60, false),
                (LOOP_END + NOTE_ON, 60, true),
            ],
            "the release lands on the seam, before the second pass presses the note again"
        );
    }

    /// A release the pending buffer has no room for leaves its note held, and
    /// the next trigger owes it again.
    ///
    /// The key is down either way. Counting the overflow and dropping the bit
    /// that records the note turns one refused event into a key nothing can
    /// ever lift, because every later trigger walks a set that no longer knows
    /// the note is sounding.
    #[test]
    fn a_release_the_pending_buffer_refuses_is_retried_on_the_next_trigger() {
        const LOOP_END: u64 = 512;
        const LEAD_IN: usize = 64;
        const CALLBACK: usize = 640;
        const NOTE_ON: u64 = 5;
        /// One scheduled note-on per frame below the seam, which is what fills
        /// the master insert's pending buffer to its capacity before the wrap
        /// asks for a release. They all press the note already sounding, so the
        /// sounding set still holds exactly one note when the wrap arrives.
        const FILL_FROM: u64 = LOOP_END - crate::midi_fx::MIDI_EVENT_BUFFER_CAPACITY as u64;

        let mut harness = Harness::new(32);
        let (instrument, received) = FrameRecordingInstrument::new();
        harness.send(GraphCommand::AddPlugin(
            7,
            instrument,
            Some(MidiNoteStore::new()),
        ));
        harness.send(GraphCommand::SetLoopRegion(LoopRegion {
            enabled: true,
            start_frame: 0,
            end_frame: LOOP_END,
        }));
        harness.playing();

        let phrase: Vec<(u64, u8, bool)> = std::iter::once((NOTE_ON, 60, true))
            .chain((FILL_FROM..LOOP_END).map(|frame| (frame, 60, true)))
            .collect();
        harness.send(schedule_phrase(7, &phrase));

        harness.render(LEAD_IN);
        assert_eq!(
            received_notes(&received),
            vec![(NOTE_ON, 60, true)],
            "the note is sounding when the callback under test begins"
        );
        let overflows_before = midi_diagnostics(&harness).scheduler_event_buffer_overflows;

        // One callback holding the rest of the pass, the seam, and the start of
        // the next pass — so the wrap's release is asked for against a buffer
        // the span before it has already filled.
        harness.render(CALLBACK);

        assert_eq!(
            midi_diagnostics(&harness).scheduler_event_buffer_overflows - overflows_before,
            2,
            "the full buffer refused two events: the wrap's release, and the note-on the pass \
             after the seam renders again"
        );
        assert!(
            received_notes(&received)
                .iter()
                .all(|(_, _, is_note_on)| *is_note_on),
            "no note-off reached the instrument in the callback that refused the release"
        );

        harness.send(GraphCommand::SetTransport(TransportState::default()));
        harness.render(LEAD_IN);

        assert_eq!(
            received_notes(&received).last().copied(),
            Some(((LEAD_IN + CALLBACK) as u64, 60, false)),
            "the stop still knows the note is sounding and releases it at the head of what \
             renders next"
        );
    }

    /// Clearing the note-off of a sounding note releases it at the head of
    /// whatever renders next. The clear takes that frame out of the
    /// arrangement, so nothing is ever going to render the note-off, and the
    /// instrument would hold the key until something unrelated lifted it.
    #[test]
    fn clearing_the_note_off_of_a_sounding_note_releases_it_at_the_next_block_head() {
        const BLOCK: usize = 128;
        const REST: usize = 384;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_phrase(7, &[(100, 60, true), (300, 60, false)]));

        harness.render(BLOCK);
        harness.send(GraphCommand::ClearMidiNotes {
            plugin_id: 7,
            from_frame: 200,
            to_frame: 400,
        });
        harness.render(REST);

        assert_eq!(
            received_notes(&received),
            vec![(100, 60, true), (BLOCK as u64, 60, false)],
            "the release lands at the head of the block after the clear, and the frame the \
             note-off was written for renders nothing"
        );
    }

    /// Deleting a sounding note releases it even when the same pitch is
    /// scheduled again later in the arrangement.
    ///
    /// The later pair leaves a note-off for that key ahead of the playhead,
    /// but a note-on stands in front of it, so it is the release of the later
    /// note and nothing is going to end the one sounding now. Reading the tail
    /// for any note-off of the key would find that one and hold the deleted
    /// note down until the later note-on pressed the key again.
    #[test]
    fn deleting_a_sounding_note_releases_it_even_when_the_pitch_repeats_later() {
        const BLOCK: usize = 128;
        /// Half the run to the later pair: one callback renders at most
        /// [`crate::audio_thread::MAX_CALLBACK_FRAMES`], so reaching frame
        /// 5,200 from the head of the second block takes two of them.
        const TAIL: usize = 2_700;
        const LATER_ON: u64 = 5_000;
        const LATER_OFF: u64 = 5_200;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_phrase(
            7,
            &[
                (100, 60, true),
                (300, 60, false),
                (LATER_ON, 60, true),
                (LATER_OFF, 60, false),
            ],
        ));

        harness.render(BLOCK);
        harness.send(GraphCommand::ClearMidiNotes {
            plugin_id: 7,
            from_frame: 200,
            to_frame: 400,
        });
        harness.render(TAIL);
        harness.render(TAIL);

        assert_eq!(
            received_notes(&received),
            vec![
                (100, 60, true),
                (BLOCK as u64, 60, false),
                (LATER_ON, 60, true),
                (LATER_OFF, 60, false),
            ],
            "the deleted note is released at the head of the block after the clear, and the \
             later note keeps both of its own events"
        );
    }

    /// A stored note-off reaches the instrument whatever probability its
    /// producer wrote on it.
    ///
    /// The gate decides whether a note sounds, and it decides that on the
    /// note-on. A note-on the gate rolls away has already marked the note
    /// sounding here, so the release it earns is a note-off an instrument that
    /// never heard the note-on ignores — harmless. A release the gate rolls
    /// away instead leaves a key that did go down held for good, which is why
    /// delivery hands a stored note-off over on the same terms
    /// `release_note` states for the ones a stop, a locate or a clear supplies.
    #[test]
    fn a_stored_note_off_reaches_the_instrument_whatever_its_probability_cutoff() {
        const NOTE_ON: u64 = 100;
        const NOTE_OFF: u64 = 1_000;
        const BLOCK: usize = 1_024;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();

        let mut phrase = [timed_note(NOTE_ON, 60), timed_note(NOTE_OFF, 60)];
        phrase[1].event.is_note_on = false;
        // The one cutoff the gate always rolls away.
        phrase[1].event.probability_cutoff = 0;
        harness.send(GraphCommand::ScheduleMidiNotes {
            plugin_id: 7,
            notes: phrase.into(),
        });

        harness.render(BLOCK);

        assert_eq!(
            received_notes(&received),
            vec![(NOTE_ON, 60, true), (NOTE_OFF, 60, false)],
            "the release reaches the instrument on the frame its producer wrote it for"
        );
    }

    /// A stored note-on keeps the probability its producer wrote on it, so a
    /// cutoff of zero rolls the note away.
    ///
    /// This is the other half of the rule above: delivery lifts the cutoff off
    /// a stored note-off and must leave it on a stored note-on, because the
    /// gate is what makes a probabilistic note probabilistic. Lifting it off
    /// both would make every stored note certain and delete the feature.
    #[test]
    fn a_stored_note_on_with_a_zero_cutoff_is_rolled_away() {
        const NOTE_ON: u64 = 100;
        const NOTE_OFF: u64 = 1_000;
        const BLOCK: usize = 1_024;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();

        let mut phrase = [timed_note(NOTE_ON, 60), timed_note(NOTE_OFF, 60)];
        // The one cutoff the gate always rolls away.
        phrase[0].event.probability_cutoff = 0;
        phrase[1].event.is_note_on = false;
        harness.send(GraphCommand::ScheduleMidiNotes {
            plugin_id: 7,
            notes: phrase.into(),
        });

        harness.render(BLOCK);

        assert_eq!(
            received_notes(&received),
            vec![(NOTE_OFF, 60, false)],
            "the note-on never reaches the instrument, and the note-off it would have earned \
             is the harmless release of a key that never went down"
        );
    }

    /// Lengthening a sounding note is a clear and a fresh batch in one drain,
    /// and it moves the note's release rather than deleting it.
    ///
    /// The clear takes the note-off out of the store while the note is down,
    /// which is exactly the shape of a deleted release; only the store the
    /// whole drain leaves behind tells the two apart. Releasing at the clear
    /// would cut the note short at the head of the next block — the one thing
    /// a producer asking for a longer note cannot be handed.
    #[test]
    fn lengthening_a_sounding_note_in_one_drain_moves_its_release() {
        const BLOCK: usize = 128;
        const REST: usize = 512;
        const NOTE_ON: u64 = 100;
        const NOTE_OFF: u64 = 300;
        const MOVED_OFF: u64 = 500;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_phrase(
            7,
            &[(NOTE_ON, 60, true), (NOTE_OFF, 60, false)],
        ));

        harness.render(BLOCK);
        harness.send_in_one_drain([
            GraphCommand::ClearMidiNotes {
                plugin_id: 7,
                from_frame: NOTE_OFF,
                to_frame: NOTE_OFF + 1,
            },
            schedule_phrase(7, &[(MOVED_OFF, 60, false)]),
        ]);
        harness.render(REST);

        assert_eq!(
            received_notes(&received),
            vec![(NOTE_ON, 60, true), (MOVED_OFF, 60, false)],
            "no release lands at the head of the block after the clear, and the note ends on \
             the frame the rewrite moved its note-off to"
        );
    }

    /// One drain makes a clear and its replacement visible to the callback
    /// together, but visible together is not the same as succeeding
    /// together: the clear cannot fail, and the schedule that follows it
    /// still can. The clear leaves the window empty regardless of what
    /// happens to the schedule that follows it, so the sounding note it
    /// stripped a note-off from is released at the head of whatever renders
    /// next, exactly as an unreplaced clear would release it.
    #[test]
    fn a_refused_replacement_in_one_batch_leaves_the_clear_applied() {
        const BLOCK: usize = 128;
        const NOTE_ON: u64 = 100;
        const NOTE_OFF: u64 = 300;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_phrase(
            7,
            &[(NOTE_ON, 60, true), (NOTE_OFF, 60, false)],
        ));

        harness.render(BLOCK);

        let over_capacity: Vec<u64> = (0..crate::midi::note_store::MIDI_NOTE_STORE_CAPACITY as u64
            + 1)
            .map(|offset| 1_000 + offset)
            .collect();
        harness.send_in_one_drain([
            GraphCommand::ClearMidiNotes {
                plugin_id: 7,
                from_frame: 0,
                to_frame: u64::MAX,
            },
            schedule_notes(7, &over_capacity),
        ]);

        assert_eq!(
            stored_note_count(&harness, 7),
            0,
            "the clear applied even though the replacement that followed it was refused"
        );
        assert_eq!(
            midi_diagnostics(&harness).midi_note_batches_refused,
            1,
            "the over-capacity replacement is counted a refusal, not silently dropped"
        );

        harness.render(BLOCK);

        assert_eq!(
            received_notes(&received),
            vec![(NOTE_ON, 60, true), (BLOCK as u64, 60, false)],
            "the clear's release lands once at the head of the next block, and none of the \
             refused batch's note-ons ever sounds"
        );
    }

    /// Shortening a sounding note behind the playhead releases it now.
    ///
    /// The rewrite puts the note-off on a frame the playhead has already
    /// passed, so it is stored and counted late like any other note behind the
    /// playhead and no frame ahead is going to render it. The note is down, so
    /// it is owed a release at the head of whatever renders next — the same
    /// answer a deleted note-off gets, reached by asking where the store's
    /// remaining note-off stands rather than whether one exists.
    #[test]
    fn shortening_a_sounding_note_behind_the_playhead_releases_it_now() {
        const BLOCK: usize = 128;
        const NOTE_ON: u64 = 10;
        const NOTE_OFF: u64 = 300;
        const MOVED_OFF: u64 = 50;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_phrase(
            7,
            &[(NOTE_ON, 60, true), (NOTE_OFF, 60, false)],
        ));

        harness.render(BLOCK);
        harness.send_in_one_drain([
            GraphCommand::ClearMidiNotes {
                plugin_id: 7,
                from_frame: NOTE_OFF,
                to_frame: NOTE_OFF + 1,
            },
            schedule_phrase(7, &[(MOVED_OFF, 60, false)]),
        ]);
        harness.render(BLOCK);

        assert_eq!(
            midi_diagnostics(&harness).late_midi_notes,
            1,
            "the moved note-off is behind the playhead, so it is stored and counted late"
        );
        assert_eq!(
            received_notes(&received),
            vec![(NOTE_ON, 60, true), (BLOCK as u64, 60, false)],
            "a release the rewrite left behind the playhead is owed at the head of what \
             renders next"
        );
    }

    /// A clear beside a sounding note leaves it sounding. The note-off the
    /// producer wrote is still in the store, so the note ends where it was
    /// written to end rather than at the clear.
    #[test]
    fn clearing_a_window_beside_a_sounding_note_leaves_it_sounding() {
        const BLOCK: usize = 128;
        const REST: usize = 384;
        const NOTE_OFF: u64 = 300;

        let mut harness = Harness::new(32);
        let received = track_with_recording_instrument(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_phrase(
            7,
            &[(100, 60, true), (NOTE_OFF, 60, false)],
        ));

        harness.render(BLOCK);
        harness.send(GraphCommand::ClearMidiNotes {
            plugin_id: 7,
            from_frame: 400,
            to_frame: 600,
        });
        harness.render(REST);

        assert_eq!(
            received_notes(&received),
            vec![(100, 60, true), (NOTE_OFF, 60, false)],
            "the stored note-off still fires on its own frame, and the clear released nothing"
        );
    }

    /// A master insert's stamps are measured from the callback's first frame,
    /// not from the span's.
    ///
    /// The master insert chain drains once per callback over the whole buffer,
    /// so a device there is handed one block covering every span. Stamping it
    /// from the span would put every delivery after a loop seam a seam's worth
    /// early — and out of order behind the deliveries before it, which is a
    /// block no plugin is allowed to be handed.
    ///
    /// [`GraphCommand::AddPlugin`] with a store is the registration Crumbs
    /// takes, and it places the device on the master chain.
    #[test]
    fn a_master_chain_instrument_is_stamped_from_the_callback_start_across_a_loop_seam() {
        const LOOP_END: u64 = 512;
        const CALLBACK: usize = 640;
        const NOTE_ON: u64 = 8;

        let mut harness = Harness::new(32);
        let (instrument, received) = FrameRecordingInstrument::new();
        harness.send(GraphCommand::AddPlugin(
            7,
            instrument,
            Some(MidiNoteStore::new()),
        ));
        harness.send(GraphCommand::SetLoopRegion(LoopRegion {
            enabled: true,
            start_frame: 0,
            end_frame: LOOP_END,
        }));
        harness.playing();
        harness.send(schedule_notes(7, &[NOTE_ON]));

        harness.render(CALLBACK);

        assert_eq!(
            received_notes(&received),
            vec![
                (NOTE_ON, 60, true),
                (LOOP_END, 60, false),
                (LOOP_END + NOTE_ON, 60, true),
            ],
            "the second pass is stamped from the callback's start, past the seam, and the \
             whole block reads in non-decreasing time"
        );
    }

    /// The rate every Fermenter spec here renders at, which is the rate
    /// [`Harness::new`] builds its scheduler at. A reference instance built at
    /// any other rate renders a different signal and the parity spec below
    /// would be comparing two different synthesisers.
    const FERMENTER_RATE: f32 = 48_000.0;

    /// A track carrying a Fermenter spliced as a generator, the way
    /// `commands/graph.rs` places a built-in instrument: registered detached
    /// with its own note store, then spliced at the head of the chain.
    ///
    /// The track holds no clip, so every non-zero sample the master carries
    /// came out of the instrument.
    fn track_with_fermenter(harness: &mut Harness, track_id: usize, effect_id: usize) {
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(track_id)));
        harness.send(GraphCommand::AddDetachedEffect(
            effect_id,
            PluginCore::builtin(BuiltinEffectType::Fermenter, FERMENTER_RATE),
            Some(MidiNoteStore::new()),
        ));
        harness.send(insert_track_device(track_id, generator(effect_id), 0));
    }

    /// Render `callbacks` blocks of `frames` and return the master pair
    /// concatenated, so a spec can read across a block boundary.
    fn render_master(
        harness: &mut Harness,
        frames: usize,
        callbacks: usize,
    ) -> (Vec<f32>, Vec<f32>) {
        let mut left = Vec::with_capacity(frames * callbacks);
        let mut right = Vec::with_capacity(frames * callbacks);
        for _ in 0..callbacks {
            let (block_left, block_right) = harness.render(frames);
            left.extend(block_left);
            right.extend(block_right);
        }
        (left, right)
    }

    fn rms(samples: &[f32]) -> f32 {
        let sum: f32 = samples.iter().map(|sample| sample * sample).sum();
        (sum / samples.len() as f32).sqrt()
    }

    /// A note scheduled for a Fermenter sounds from the frame it was written
    /// for, and the master is silent ahead of it.
    ///
    /// The onset sits mid-block, three block boundaries into the render, so a
    /// body that quantised the note to the head of the block it arrived in —
    /// or to the head of the callback — would put the first non-zero sample
    /// where the leading assertion reads silence.
    #[test]
    fn a_fermenter_note_on_sounds_from_the_frame_it_was_scheduled_for() {
        const BLOCK: usize = 128;
        const NOTE_ON: u64 = 300;
        const ONSET: usize = NOTE_ON as usize;

        let mut harness = Harness::new(32);
        track_with_fermenter(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_phrase(7, &[(NOTE_ON, 60, true)]));

        let (left, _right) = render_master(&mut harness, BLOCK, 4);

        assert!(
            left[..ONSET].iter().all(|sample| *sample == 0.0),
            "the master carried signal before the note was written for"
        );
        assert!(
            left[ONSET..ONSET + BLOCK]
                .iter()
                .any(|sample| *sample != 0.0),
            "the note never sounded in the block that renders its frame"
        );
    }

    /// A note-off reaches the Fermenter and its voice decays: the tail is
    /// quieter than the held note, and nothing in the render is NaN.
    ///
    /// A release that never reached the instrument leaves the key down, so the
    /// tail would read at the held note's level rather than under it.
    #[test]
    fn a_fermenter_note_off_lets_the_voice_decay_below_the_held_level() {
        const BLOCK: usize = 128;
        const NOTE_ON: u64 = 300;
        const NOTE_OFF: u64 = 700;
        const RENDERED: usize = 2_000;

        /// A one-millisecond amplitude attack and a five-millisecond release,
        /// so the note is at full level across the held window and its release
        /// has run out well inside the tail window. At the shipped envelope
        /// both windows sit on the attack ramp, where a release that arrived
        /// and one that never did read the same.
        const FAST_ENVELOPE: [(u32, f32); 2] = [(54, 0.001), (57, 0.005)];

        let mut harness = Harness::new(32);
        track_with_fermenter(&mut harness, 1, 7);
        harness.playing();
        for (ordinal, value) in FAST_ENVELOPE {
            harness.send(GraphCommand::SetParam(
                7,
                DeviceParam::FermenterOrdinal(ordinal),
                value,
            ));
        }
        harness.send(schedule_phrase(
            7,
            &[(NOTE_ON, 60, true), (NOTE_OFF, 60, false)],
        ));

        let (left, _right) = render_master(&mut harness, BLOCK, RENDERED.div_ceil(BLOCK));

        let held = rms(&left[NOTE_ON as usize..NOTE_OFF as usize]);
        let tail = rms(&left[1_500..RENDERED]);
        assert!(
            held > 0.0,
            "the held note never sounded, so the tail proves nothing"
        );
        assert!(
            tail < held,
            "the tail ({tail}) is not quieter than the held note ({held}): the release \
             never reached the instrument"
        );
        assert!(
            left.iter().all(|sample| sample.is_finite()),
            "the render carried a non-finite sample"
        );
    }

    /// A note-off releases the voice on its own MIDI channel and leaves a
    /// note holding the same pitch on another channel sounding.
    ///
    /// Two keys at one pitch on two channels is what an MPE part or two
    /// layered parts on one instrument produce, and the store addresses them
    /// separately — one bit per (channel, note). A release that dropped the
    /// channel would silence both, cutting a note the producer never asked to
    /// end. The two renders here differ only in whether the second channel's
    /// note is released too, so a body that ignores the channel makes them the
    /// same signal.
    #[test]
    fn a_fermenter_note_off_releases_only_the_channel_its_note_sounded_on() {
        const BLOCK: usize = 128;
        const CALLBACKS: usize = 16;
        const NOTE: u8 = 60;
        const RELEASE: u64 = 400;
        const TAIL: usize = 1_200;
        /// A one-millisecond attack and a five-millisecond release, so a voice
        /// that was released is gone well inside the tail window and one that
        /// was not is still at full level there.
        const FAST_ENVELOPE: [(u32, f32); 2] = [(54, 0.001), (57, 0.005)];

        fn render_releasing(channels: &[i16]) -> Vec<f32> {
            let mut harness = Harness::new(32);
            track_with_fermenter(&mut harness, 1, 7);
            harness.playing();
            for (ordinal, value) in FAST_ENVELOPE {
                harness.send(GraphCommand::SetParam(
                    7,
                    DeviceParam::FermenterOrdinal(ordinal),
                    value,
                ));
            }
            let mut notes = vec![
                channel_note(0, NOTE, 0, true),
                channel_note(0, NOTE, 1, true),
            ];
            notes.extend(
                channels
                    .iter()
                    .map(|channel| channel_note(RELEASE, NOTE, *channel, false)),
            );
            harness.send(GraphCommand::ScheduleMidiNotes {
                plugin_id: 7,
                notes: notes.into(),
            });
            render_master(&mut harness, BLOCK, CALLBACKS).0
        }

        let one_released = render_releasing(&[0]);
        let both_released = render_releasing(&[0, 1]);

        assert!(
            rms(&one_released[TAIL..]) > 0.0,
            "releasing one channel silenced the note held on the other"
        );
        assert!(
            rms(&both_released[TAIL..]) < rms(&one_released[TAIL..]),
            "releasing both channels left as much sound as releasing one, so neither \
             release narrowed to a channel"
        );
    }

    /// One note stamped for a frame, a pitch and a MIDI channel — the shape a
    /// producer writes for a part that is not on the base channel.
    fn channel_note(at_frame: u64, note: u8, channel: i16, is_note_on: bool) -> TimedMidiNote {
        let mut timed = timed_note(at_frame, note);
        timed.event.channel = channel;
        timed.event.is_note_on = is_note_on;
        timed
    }

    /// The hosted body renders exactly what the worklet's own driving of
    /// [`FermenterInstance`] renders for the same programme.
    ///
    /// The worklet hands the instance 128 frames at a time with each event's
    /// offset measured inside that 128, because the instance's buffers are 128
    /// frames long and `process` silently clamps anything larger. The scheduler
    /// hands the body a 256-frame callback, so a body that passed the callback
    /// straight through would render the first 128 frames of every pair and
    /// leave the rest as it found them.
    #[test]
    fn a_hosted_fermenter_renders_the_worklet_samples_for_the_same_programme() {
        const CALLBACK: usize = 256;
        const CALLBACKS: usize = 2;
        const RENDERED: usize = CALLBACK * CALLBACKS;
        /// `(frame, note, is_note_on)`, two of them off a block boundary.
        const PROGRAMME: [(u64, u8, bool); 4] = [
            (0, 48, true),
            (37, 60, true),
            (141, 67, true),
            (300, 60, false),
        ];

        let mut harness = Harness::new(32);
        track_with_fermenter(&mut harness, 1, 7);
        harness.playing();
        harness.send(schedule_phrase(7, &PROGRAMME));
        let (hosted_left, hosted_right) = render_master(&mut harness, CALLBACK, CALLBACKS);

        let mut instance = FermenterInstance::new(FERMENTER_RATE, FERMENTER_MAX_VOICES);
        let mut worklet_left = Vec::with_capacity(RENDERED);
        let mut worklet_right = Vec::with_capacity(RENDERED);
        for block in 0..RENDERED / FERMENTER_BLOCK_FRAMES {
            let start = (block * FERMENTER_BLOCK_FRAMES) as u64;
            let end = start + FERMENTER_BLOCK_FRAMES as u64;
            for (frame, note, is_note_on) in PROGRAMME {
                if !(start..end).contains(&frame) {
                    continue;
                }
                let offset = (frame - start) as u32;
                let queued = if is_note_on {
                    instance.push_note_on(note, 100, 0, offset)
                } else {
                    instance.push_note_off_on_channel(note, 0, offset)
                };
                assert!(queued, "the reference instance refused an event");
            }
            let rendered_left = instance.process(FERMENTER_BLOCK_FRAMES as u32);
            let rendered_right = instance.get_right_ptr();
            // SAFETY: `process` has just rendered `FERMENTER_BLOCK_FRAMES`
            // frames into the instance's own pair of buffers, which are exactly
            // that long and are never resized.
            unsafe {
                worklet_left.extend_from_slice(std::slice::from_raw_parts(
                    rendered_left,
                    FERMENTER_BLOCK_FRAMES,
                ));
                worklet_right.extend_from_slice(std::slice::from_raw_parts(
                    rendered_right,
                    FERMENTER_BLOCK_FRAMES,
                ));
            }
        }

        assert!(
            worklet_left.iter().any(|sample| *sample != 0.0),
            "the reference render is silent, so an equality against it proves nothing"
        );
        assert_eq!(
            hosted_left, worklet_left,
            "the hosted body's left channel is not the signal the worklet renders"
        );
        assert_eq!(
            hosted_right, worklet_right,
            "the hosted body's right channel is not the signal the worklet renders"
        );
    }

    /// A master-chain Fermenter renders no further than the pair it was
    /// handed, whatever frame count the caller asks for.
    ///
    /// `process_block` is public, and its frame count is the caller's ask
    /// while the buffers are the truth — which is why it clamps the two
    /// together at its head. The body indexes the pair by the count it is
    /// given, so an ask past the buffers slices past them and panics on the
    /// callback unless that clamped count is what reaches it.
    #[test]
    fn a_master_chain_fermenter_renders_no_further_than_the_pair_it_was_handed() {
        /// Shorter than the ask and not a whole number of runs, so the second
        /// run is the one that would reach past the buffer.
        const BUFFER: usize = 192;
        const OVER_ASK: usize = 512;

        let mut harness = Harness::new(32);
        harness.send(GraphCommand::AddEffect(
            7,
            PluginCore::builtin(BuiltinEffectType::Fermenter, FERMENTER_RATE),
            Some(MidiNoteStore::new()),
        ));
        harness.playing();
        harness.send(GraphCommand::SendMidiNote(7, note_on(60)));

        let mut left = vec![0.0_f32; BUFFER];
        let mut right = vec![0.0_f32; BUFFER];
        harness
            .scheduler
            .process_block(&mut left, &mut right, OVER_ASK);

        assert!(
            left.iter().any(|sample| *sample != 0.0),
            "the instrument never sounded, so the over-ask reached nothing to bound"
        );
        assert!(
            left[FERMENTER_BLOCK_FRAMES..]
                .iter()
                .any(|sample| *sample != 0.0),
            "the render stopped at the first run: the ask was clamped to one run rather \
             than to the buffer"
        );
    }

    /// A partial run costs the instrument one extra step of its per-block
    /// smoothers, and costs the note nothing.
    ///
    /// The body hands the instrument whole blocks of at most
    /// [`FERMENTER_BLOCK_FRAMES`], and the instrument advances cutoff,
    /// resonance, LFO rate and its effect smoothers one exponential step per
    /// call whatever the run length. A 512-frame callback cut at frame 300 —
    /// what a loop seam does to one — therefore runs 128, 128, 44, 128, 84
    /// where the worklet's fixed quantum runs four 128s, and that fifth step
    /// is what this reads.
    ///
    /// The split is driven straight at the body rather than through a loop
    /// region on the harness because a region also re-fires the programme at
    /// the seam: the divergence below would then be a re-triggered note rather
    /// than the smoother, and the spec would pass with the contract broken.
    ///
    /// Ordinal 1 is the filter cutoff, set far from its default so the
    /// smoother is still travelling across the whole render. Frames ahead of
    /// the seam sit under the same step in both renders; only frames past it
    /// may differ.
    #[test]
    fn a_partial_fermenter_run_advances_the_block_smoothers_one_extra_step() {
        const CALLBACK: usize = 512;
        const SEAM: usize = 300;
        const NOTE_ON: u32 = 40;
        const CUTOFF_ORDINAL: u32 = 1;
        const CUTOFF_HZ: f32 = 400.0;
        /// The measured ceiling on the per-frame difference ahead of the seam.
        /// Every frame before it renders under the same block-parameter step
        /// in both, and the per-sample state either side of a run boundary is
        /// the same state, so the widest difference measured there is 0.0
        /// exactly: the bound is an equality with a name, not a tolerance this
        /// render needs.
        const AHEAD_OF_SEAM: f32 = 0.0;

        let mut body = FermenterBody::new(FERMENTER_RATE);
        let mut diagnostics = ActiveMidiRtDiagnostics::new();
        body.set_param(CUTOFF_ORDINAL, CUTOFF_HZ);
        let mut event = note_on(60);
        event.frame_offset = NOTE_ON;

        let mut hosted_left = vec![0.0_f32; CALLBACK];
        let mut hosted_right = vec![0.0_f32; CALLBACK];
        let (head_left, tail_left) = hosted_left.split_at_mut(SEAM);
        let (head_right, tail_right) = hosted_right.split_at_mut(SEAM);
        body.process(head_left, head_right, SEAM, &[event], &mut diagnostics);
        body.process(
            tail_left,
            tail_right,
            CALLBACK - SEAM,
            &[],
            &mut diagnostics,
        );

        let mut instance = FermenterInstance::new(FERMENTER_RATE, FERMENTER_MAX_VOICES);
        instance.set_param_by_id(CUTOFF_ORDINAL, CUTOFF_HZ);
        let mut worklet_left = Vec::with_capacity(CALLBACK);
        for block in 0..CALLBACK / FERMENTER_BLOCK_FRAMES {
            if block == 0 {
                assert!(
                    instance.push_note_on(60, 100, 0, NOTE_ON),
                    "the reference instance refused the note"
                );
            }
            let rendered = instance.process(FERMENTER_BLOCK_FRAMES as u32);
            // SAFETY: `process` has just rendered `FERMENTER_BLOCK_FRAMES`
            // frames into the instance's own left buffer, which is exactly
            // that long and is never resized.
            unsafe {
                worklet_left.extend_from_slice(std::slice::from_raw_parts(
                    rendered,
                    FERMENTER_BLOCK_FRAMES,
                ));
            }
        }

        let first_sounding = |samples: &[f32]| samples.iter().position(|sample| *sample != 0.0);
        assert_eq!(
            first_sounding(&worklet_left),
            Some(NOTE_ON as usize),
            "the reference never sounded on the frame the note was stamped for, so the \
             comparison below proves nothing"
        );
        assert_eq!(
            first_sounding(&hosted_left),
            first_sounding(&worklet_left),
            "the split runs moved the note off the frame it was stamped for"
        );

        let widest_difference = |range: std::ops::Range<usize>| {
            range
                .map(|frame| (hosted_left[frame] - worklet_left[frame]).abs())
                .fold(0.0_f32, f32::max)
        };
        let ahead_of_seam = widest_difference(0..SEAM);
        let past_seam = widest_difference(SEAM..CALLBACK);

        assert!(
            ahead_of_seam <= AHEAD_OF_SEAM,
            "the runs ahead of the seam diverged by {ahead_of_seam}: every frame before it \
             renders under the same block-parameter step in both, so a note or a run \
             boundary moved"
        );
        assert!(
            worklet_left[SEAM..].iter().any(|sample| *sample != 0.0),
            "the reference is silent past the seam, so the divergence below would read \
             equality it never earned"
        );
        assert!(
            past_seam > 0.0,
            "the renders agree past the seam: the partial run cost no extra smoother \
             step, so this spec no longer observes the contract it names"
        );
    }

    /// A `SetParam` carrying a Fermenter ordinal reaches the instrument, and
    /// one carrying a Knead name aimed at a Fermenter is counted unrouted
    /// rather than guessed at.
    ///
    /// Ordinal 1 is the filter cutoff, so a write that reached nothing renders
    /// the same samples as the untouched instance.
    #[test]
    fn a_fermenter_ordinal_write_changes_the_render_and_a_knead_name_counts_unrouted() {
        const BLOCK: usize = 128;
        const NOTE_ON: u64 = 0;
        const CUTOFF: DeviceParam = DeviceParam::FermenterOrdinal(1);

        fn render_with(
            param: Option<(DeviceParam, f32)>,
        ) -> (Vec<f32>, ActiveMidiRtDiagnosticsSnapshot) {
            let mut harness = Harness::new(32);
            track_with_fermenter(&mut harness, 1, 7);
            harness.playing();
            if let Some((param, value)) = param {
                harness.send(GraphCommand::SetParam(7, param, value));
            }
            harness.send(schedule_phrase(7, &[(NOTE_ON, 60, true)]));
            let (left, _right) = render_master(&mut harness, BLOCK, 4);
            let diagnostics = midi_diagnostics(&harness);
            (left, diagnostics)
        }

        let (untouched, untouched_diagnostics) = render_with(None);
        let (with_cutoff, cutoff_diagnostics) = render_with(Some((CUTOFF, 0.2)));
        let (_, knead_name_diagnostics) = render_with(Some((DeviceParam::ShiftSemitones, 3.0)));

        assert!(
            untouched.iter().any(|sample| *sample != 0.0),
            "the untouched render is silent, so a difference against it proves nothing"
        );
        assert_ne!(
            with_cutoff, untouched,
            "the ordinal write never reached the instrument"
        );
        assert_eq!(
            (
                untouched_diagnostics.unmapped_set_param_calls,
                cutoff_diagnostics.unmapped_set_param_calls,
            ),
            (0, 0),
            "a routed write was counted unrouted"
        );
        assert_eq!(
            knead_name_diagnostics.unmapped_set_param_calls, 1,
            "a knead parameter name aimed at a Fermenter must be counted, not guessed at"
        );
    }

    /// The last automation ordinal the Fermenter publishes is routed, and the
    /// first one past the end is not.
    ///
    /// `FERMENTER_AUTOMATION_PARAM_COUNT` is the length of the instrument's own
    /// ordinal table, so the two writes here sit either side of its last entry.
    /// A count that drifted one either way is exactly what this reads: too
    /// small and the first write goes nowhere, too large and the second one
    /// lands on a parameter this test says the instrument does not have.
    #[test]
    fn the_last_fermenter_ordinal_is_routed_and_the_one_past_it_is_not() {
        const BLOCK: usize = 128;
        /// The granular engine, its density and its grain size — the state the
        /// last ordinal, a grain pan spread, has any effect in at all.
        const GRANULAR: [(u32, f32); 3] = [(16, 4.0), (12, 60.0), (13, 200.0)];
        const LAST: u32 = FERMENTER_AUTOMATION_PARAM_COUNT - 1;

        fn render_with_ordinal(ordinal: u32, value: f32) -> Vec<f32> {
            let mut harness = Harness::new(32);
            track_with_fermenter(&mut harness, 1, 7);
            harness.playing();
            for (granular_ordinal, granular_value) in GRANULAR {
                harness.send(GraphCommand::SetParam(
                    7,
                    DeviceParam::FermenterOrdinal(granular_ordinal),
                    granular_value,
                ));
            }
            harness.send(GraphCommand::SetParam(
                7,
                DeviceParam::FermenterOrdinal(ordinal),
                value,
            ));
            harness.send(schedule_phrase(7, &[(0, 60, true)]));
            render_master(&mut harness, BLOCK, 8).0
        }

        let last_low = render_with_ordinal(LAST, 0.0);
        let last_high = render_with_ordinal(LAST, 1.0);
        let past_low = render_with_ordinal(FERMENTER_AUTOMATION_PARAM_COUNT, 0.0);
        let past_high = render_with_ordinal(FERMENTER_AUTOMATION_PARAM_COUNT, 1.0);

        assert!(
            last_low.iter().any(|sample| *sample != 0.0),
            "the render is silent, so neither assertion below means anything"
        );
        assert_ne!(
            last_low, last_high,
            "ordinal {LAST} reached nothing: the published ordinal count is past the \
             instrument's last parameter"
        );
        assert_eq!(
            past_low, past_high,
            "ordinal {FERMENTER_AUTOMATION_PARAM_COUNT} reached a parameter: the published \
             ordinal count is short of the instrument's last parameter"
        );
    }
}
