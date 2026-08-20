//! Lock-free Messaging and Task Schedule for Native CPAL engine.
//!
//! Handles both built-in DSP effects (Knead) and external plugins (CLAP/VST3)
//! via the NativePlugin trait. All communication is lock-free via rtrb.

use crate::audio_bridge::{PluginAudioBridge, RENDER_QUANTUM_FRAMES, RING_CAPACITY};
use crate::audio_thread::MAX_CALLBACK_FRAMES;
#[cfg(test)]
use crate::midi::diagnostics::active_midi_rt_diagnostics_channel;
use crate::midi::diagnostics::{ActiveMidiRtDiagnostics, ActiveMidiRtDiagnosticsSnapshot};
use crate::midi_fx::{Arpeggiator, MidiEventBuffer, MidiFx, ProbabilityEvaluator, VelocityScaler};
use crate::plugin_slot::{MidiNoteEvent, NativePlugin, TransportState};
use crate::timeline::{
    timeline_rt_diagnostics_channel, AutomationTarget, AutomationWrite, ChainEntry, ClipPlacement,
    ClipPlayback, DeviceChain, DeviceParam, DeviceParamEvent, DeviceParamQueue,
    RetiredTimelineObject, RouteTarget, SendTap, TimelineBus, TimelineClip, TimelineGraph,
    TimelineRtDiagnosticsSnapshot, TimelineTrack,
};
use daw_dsp::knead::engine::KneadEngine;
use rtrb::{Consumer, Producer, PushError};
use triple_buffer::Input;

pub enum MidiFxKind {
    Arpeggiator,
    VelocityScaler,
}

/// Commands sent from the UI/main thread to the audio thread (lock-free via rtrb).
pub enum GraphCommand {
    // Built-in effects
    /// Register a built-in effect on the master insert chain — the crate's
    /// original chain, and where the plugin-bridge path still runs a built-in
    /// it registers standalone.
    AddEffect(usize, String),
    /// Register a built-in effect detached from every chain.
    ///
    /// The graph transport's form: its effect exists only once the
    /// `InsertTrackDevice`/`InsertBusDevice` that follows it lands, and the
    /// commands cross the ring one at a time, so a callback can drain between
    /// the two. An effect registered onto the master chain in that window
    /// would render one block of the *entire mix* through a device the user
    /// put on one strip; a detached one renders nowhere until it is placed.
    AddDetachedEffect(usize, String),
    SetParam(usize, String, f32),
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
    AddMidiFx(usize, MidiFxKind),
    RemoveMidiFx(usize, usize), // effect_id, fx_index
    SetMidiFxParam(usize, usize, String, f32),

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
    /// returns to the master insert chain.
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
    /// A time-stamped change to a built-in device parameter, addressed without
    /// a name so consuming the command frees nothing on the audio thread.
    ///
    /// Unlike [`GraphCommand::AutomateParam`] this applies at the block
    /// boundary rather than at a sample offset: a device owns its own
    /// parameter smoothing, and no built-in exposes a sample-addressed set.
    AutomateDeviceParam {
        effect_id: usize,
        param: DeviceParam,
        value: f32,
        at_frame: u64,
    },

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

enum PluginCore {
    Knead(KneadEngine),
    Native(Box<dyn NativePlugin>),
}

/// Map a `SetParam` name/value pair onto the matching `KneadEngine` setter.
///
/// Returns `false` for an unrecognized name so the caller can diagnose it
/// instead of reporting success while doing nothing.
fn apply_knead_param(engine: &mut KneadEngine, name: &str, value: f32) -> bool {
    match name {
        "shift_semitones" => {
            engine.set_shift_semitones(value);
            true
        }
        "retune_speed_ms" => {
            engine.set_retune_speed_ms(value);
            true
        }
        "formant_preserve" => {
            engine.set_formant_preserve(value != 0.0);
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
    /// existed, and where an effect returns when it leaves a track.
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
    midi_fx: Vec<Box<dyn MidiFx>>,
    /// Pending MIDI events for this block (drained each process_block call).
    pending_midi: MidiEventBuffer,
    placement: EffectPlacement,
    /// Time-stamped parameter changes waiting for the playhead. Fixed
    /// capacity and held inline, so queuing one neither allocates nor is
    /// freed on the audio thread.
    pending_params: DeviceParamQueue,
}

pub(crate) const RETIREMENT_QUEUE_CAPACITY: usize = 257;

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

    fn with_placement(id: usize, instance: PluginCore, placement: EffectPlacement) -> Self {
        Self {
            id,
            instance,
            bypassed: false,
            probability_evaluator: ProbabilityEvaluator,
            midi_fx: Vec::new(),
            pending_midi: MidiEventBuffer::new(),
            placement,
            pending_params: DeviceParamQueue::new(),
        }
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
    audio_bridges: Vec<PluginAudioBridge>,
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
    midi_rt_diagnostics: ActiveMidiRtDiagnostics,
    midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
    timeline_rt_diagnostics_tx: Input<TimelineRtDiagnosticsSnapshot>,
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
        Self::with_rt_diagnostics(
            command_rx,
            retired_tx,
            sample_rate,
            midi_rt_diagnostics_tx,
            timeline_diagnostics_tx,
        )
    }

    pub(crate) fn with_rt_diagnostics(
        command_rx: Consumer<GraphCommand>,
        retired_tx: Producer<RetiredGraphObjects>,
        sample_rate: f32,
        midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
        timeline_rt_diagnostics_tx: Input<TimelineRtDiagnosticsSnapshot>,
    ) -> Self {
        let command_queue_capacity = command_rx.buffer().capacity();
        Self {
            effects: Vec::with_capacity(128),
            audio_bridges: Vec::with_capacity(128),
            timeline: TimelineGraph::new(),
            playhead_frames: 0,
            command_rx: Some(command_rx),
            retired_tx,
            pending_retirement: None,
            pending_batch: None,
            shutdown_commands: Vec::with_capacity(command_queue_capacity),
            retain_command_consumer: !cfg!(test),
            sample_rate,
            transport: TransportState::default(),
            midi_rt_diagnostics: ActiveMidiRtDiagnostics::new(),
            midi_rt_diagnostics_tx,
            timeline_rt_diagnostics_tx,
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

    /// The routed graph, for callers proving what a command did to it.
    pub fn timeline(&self) -> &TimelineGraph {
        &self.timeline
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
                GraphCommand::AddEffect(id, plugin_type) => {
                    self.add_builtin_effect(id, &plugin_type, EffectPlacement::MasterChain)
                }
                GraphCommand::AddDetachedEffect(id, plugin_type) => {
                    self.add_builtin_effect(id, &plugin_type, EffectPlacement::Detached)
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
                GraphCommand::SetParam(id, name, value) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        match &mut effect.instance {
                            PluginCore::Knead(engine) => {
                                if !apply_knead_param(engine, &name, value) {
                                    self.midi_rt_diagnostics.record_unmapped_set_param_call(1);
                                }
                            }
                            PluginCore::Native(_) => {
                                // `SetParam` only has a mapped target for the
                                // built-in Knead effect today; a native
                                // plugin's parameters are not routed here.
                                self.midi_rt_diagnostics.record_unmapped_set_param_call(1);
                            }
                        }
                    }
                    None
                }
                GraphCommand::SetBypass(id, bypassed) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
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
                    } else {
                        self.effects
                            .push(ActiveEffect::new(id, PluginCore::Native(plugin)));
                        None
                    }
                }
                GraphCommand::AddPluginWithBridge(id, plugin, bridge) => {
                    if self.effect_id_exists(id) {
                        self.midi_rt_diagnostics.record_effect_id_collision(1);
                        RetiredGraphObjects::effect_with_bridge(
                            Some(ActiveEffect::new(id, PluginCore::Native(plugin))),
                            Some(bridge),
                        )
                    } else {
                        self.effects
                            .push(ActiveEffect::new(id, PluginCore::Native(plugin)));
                        self.audio_bridges.push(bridge);
                        None
                    }
                }
                GraphCommand::AddMidiFx(id, fx_kind) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        let fx: Box<dyn MidiFx> = match fx_kind {
                            MidiFxKind::Arpeggiator => Box::new(Arpeggiator::default()),
                            MidiFxKind::VelocityScaler => Box::new(VelocityScaler::default()),
                        };
                        effect.midi_fx.push(fx);
                    }
                    None
                }
                GraphCommand::RemoveMidiFx(id, index) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        if index < effect.midi_fx.len() {
                            Some(RetiredGraphObjects::midi_fx(effect.midi_fx.remove(index)))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
                GraphCommand::SetMidiFxParam(id, index, name, value) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        if let Some(fx) = effect.midi_fx.get_mut(index) {
                            fx.set_param(&name, value);
                        }
                    }
                    None
                }
                GraphCommand::SendMidiNote(id, event) => {
                    if let Some(effect) = self.effects.iter_mut().find(|e| e.id == id) {
                        effect.enqueue_midi(event, &mut self.midi_rt_diagnostics);
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
                            if let Some(effect) = self
                                .effects
                                .iter_mut()
                                .find(|e| e.id == entry.effect_id && e.placement == placed_on)
                            {
                                effect.placement = EffectPlacement::Detached;
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
                            if let Some(effect) = self
                                .effects
                                .iter_mut()
                                .find(|e| e.id == entry.effect_id && e.placement == placed_on)
                            {
                                effect.placement = EffectPlacement::Detached;
                            }
                        }
                        RetiredGraphObjects::timeline(RetiredTimelineObject::Bus(bus))
                    })
                }
                GraphCommand::SetBusOutput(id, target) => {
                    self.timeline.set_bus_output(id, target);
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
                GraphCommand::AutomateDeviceParam {
                    effect_id,
                    param,
                    value,
                    at_frame,
                } => {
                    match self
                        .effects
                        .iter_mut()
                        .find(|effect| effect.id == effect_id)
                    {
                        Some(effect) => {
                            if !effect.pending_params.schedule(DeviceParamEvent {
                                param,
                                value,
                                at_frame,
                            }) {
                                self.timeline.record_automation_queue_overflow();
                            }
                        }
                        None => self.timeline.record_unknown_target(),
                    }
                    None
                }
                #[cfg(test)]
                GraphCommand::RegisterAudioBridge(bridge) => {
                    self.audio_bridges.push(bridge);
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

    fn effect_id_exists(&self, id: usize) -> bool {
        self.effects.iter().any(|effect| effect.id == id)
    }

    /// Register a built-in effect at the given placement, retiring the fresh
    /// instance instead when the id already names a live effect.
    fn add_builtin_effect(
        &mut self,
        id: usize,
        plugin_type: &str,
        placement: EffectPlacement,
    ) -> Option<RetiredGraphObjects> {
        let instance = match plugin_type {
            "knead" => PluginCore::Knead(KneadEngine::new(self.sample_rate)),
            _ => {
                self.midi_rt_diagnostics
                    .record_unsupported_effect_addition(1);
                return None;
            }
        };
        if self.effect_id_exists(id) {
            self.midi_rt_diagnostics.record_effect_id_collision(1);
            return Some(RetiredGraphObjects::effect(ActiveEffect::with_placement(
                id, instance, placement,
            )));
        }
        self.effects
            .push(ActiveEffect::with_placement(id, instance, placement));
        None
    }

    /// Record where an effect now runs, after a chain has accepted it.
    fn place_effect(&mut self, effect_id: usize, placement: EffectPlacement) {
        if let Some(effect) = self
            .effects
            .iter_mut()
            .find(|effect| effect.id == effect_id)
        {
            effect.placement = placement;
        }
    }

    /// Return an effect to the master insert chain, but only when it is the
    /// named chain that still holds it: an effect's placement is single-valued,
    /// so releasing one some other chain is running would move a live device.
    fn release_effect(&mut self, effect_id: usize, held_by: EffectPlacement) {
        if let Some(effect) = self
            .effects
            .iter_mut()
            .find(|effect| effect.id == effect_id && effect.placement == held_by)
        {
            effect.placement = EffectPlacement::MasterChain;
        }
    }

    fn remove_effect(&mut self, id: usize) -> Option<ActiveEffect> {
        let index = self.effects.iter().position(|effect| effect.id == id)?;
        Some(self.effects.remove(index))
    }

    fn remove_audio_bridge(&mut self, plugin_id: usize) -> Option<PluginAudioBridge> {
        let index = self
            .audio_bridges
            .iter()
            .position(|bridge| bridge.plugin_id == plugin_id)?;
        Some(self.audio_bridges.remove(index))
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
        // Deep enough to cover the device period twice over, plus a quantum of
        // slack either side. Nothing locks the app's IPC cadence to this
        // callback, so the phase between them wanders across a full period;
        // a target of one period would shed on every crossing, and each shed
        // costs the app a quantum of return audio. Two periods absorbs the
        // whole slip. Beyond that is plugin latency the user hears against the
        // rest of the graph, so the target stays proportional to the period
        // rather than growing to the ring's capacity.
        // The clamp keeps the target meaningful: a period that already needs
        // most of the ring cannot also carry twice itself, and a target above
        // what the ring holds would never be crossed, which is the ratchet
        // this shedding exists to stop.
        let blocks_per_period = callback_frames.div_ceil(RENDER_QUANTUM_FRAMES);
        let target_depth_blocks = (blocks_per_period * 2 + 2).min(RING_CAPACITY);

        for bridge in &mut self.audio_bridges {
            let plugin_id = bridge.plugin_id;

            let effect = self
                .effects
                .iter_mut()
                .find(|effect| effect.id == plugin_id);

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
            // CPAL callback beating the worklet's push, guaranteed at
            // bridge startup and on any cadence jitter), the events must
            // survive to the next cycle rather than being dropped.
            if drain.blocks_processed > 0 {
                pending_midi.clear();
            }
            diagnostics.record_bridge_output_blocks_dropped(drain.output_blocks_dropped as u64);
            diagnostics.record_bridge_backlog_blocks_shed(drain.blocks_shed as u64);
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
        for effect in &mut self.effects {
            while let Some(event) = effect.pending_params.pop_due(last_frame) {
                let applied = match &mut effect.instance {
                    PluginCore::Knead(engine) => {
                        apply_knead_param(engine, event.param.name(), event.value)
                    }
                    // Addressed device parameters have a mapped target only on
                    // the built-in effect, exactly as `SetParam` does.
                    PluginCore::Native(_) => false,
                };
                if !applied {
                    self.midi_rt_diagnostics.record_unmapped_set_param_call(1);
                }
            }
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
            audio_bridges,
            midi_rt_diagnostics,
            transport,
            sample_rate,
            ..
        } = self;
        let mut devices = TrackDeviceChain {
            effects,
            audio_bridges,
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

    /// Process a block of audio (called by CPAL render callback).
    ///
    /// The order is the strip's: the timeline renders tracks, sends, buses and
    /// the master sum; the master insert chain runs over that sum; the master
    /// fader is applied last. The playhead then advances by exactly the frames
    /// rendered, and only while the transport is playing, which is what makes
    /// a clip start and a parameter stamp address a position rather than a
    /// callback.
    #[inline]
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        let frames = num_samples
            .min(left.len())
            .min(right.len())
            .min(MAX_CALLBACK_FRAMES);
        let block_start = self.playhead_frames;

        self.apply_due_device_params(block_start, frames);
        self.render_timeline(block_start, frames, left, right);

        for effect in &mut self.effects {
            // A bridged plugin is driven by `process_audio_bridges` above, from
            // real worklet audio. This standalone chain runs over zeroed
            // scratch, so processing a bridged plugin here would push phantom
            // silence through a stateful plugin (corrupting its tails, envelope
            // followers and delay lines) and emit its output on a second,
            // uncontrolled path straight into the CPAL device buffer.
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
            if self
                .audio_bridges
                .iter()
                .any(|bridge| bridge.plugin_id == effect.id)
            {
                continue;
            }

            // A detached effect runs nowhere: no chain will consume the MIDI
            // addressed to it, so it is discarded each block on the same
            // contract as the bypass arm below. Banking it instead would empty
            // as a burst of stale note-ons — note-ons with no note-offs behind
            // them — the moment the effect is placed on a chain again.
            if effect.placement == EffectPlacement::Detached {
                effect.pending_midi.clear();
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
            for fx in &mut effect.midi_fx {
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

        self.timeline
            .apply_master_gain(block_start, frames, left, right);

        if self.transport.is_playing {
            self.playhead_frames = block_start.saturating_add(frames as u64);
        }
    }
}

/// Runs one track's device chain over that track's signal.
///
/// The effects stay in the scheduler's id-addressed table alongside their
/// bridges and their MIDI state, so the graph borrows them for the length of
/// one render rather than owning them.
struct TrackDeviceChain<'a> {
    effects: &'a mut Vec<ActiveEffect>,
    audio_bridges: &'a [PluginAudioBridge],
    midi_rt_diagnostics: &'a mut ActiveMidiRtDiagnostics,
    transport: TransportState,
    sample_rate: f32,
}

impl DeviceChain for TrackDeviceChain<'_> {
    fn run_device(&mut self, effect_id: usize, left: &mut [f32], right: &mut [f32], frames: usize) {
        // A bridged plugin is driven from the app's own audio in
        // `process_audio_bridges`. Running it here as well would push the
        // track's signal through the same stateful instance on a second path.
        if self
            .audio_bridges
            .iter()
            .any(|bridge| bridge.plugin_id == effect_id)
        {
            return;
        }

        let Some(effect) = self
            .effects
            .iter_mut()
            .find(|effect| effect.id == effect_id)
        else {
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
        for fx in &mut effect.midi_fx {
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
    use crate::midi_fx::MIDI_EVENT_BUFFER_CAPACITY;
    use rtrb::RingBuffer;
    use std::any::Any;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
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
        // CPAL device buffer on a path nothing controls.
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

        // Drive both calls in sequence, the way audio_thread.rs's CPAL
        // callback does every cycle: process_audio_bridges() first, then
        // process_block() over the standalone chain's zeroed scratch. The
        // CPAL callback beats the worklet's input push here — the bridge's
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

        // The device buffer spans several render quanta — a 512-frame CPAL
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
            .push(GraphCommand::AddMidiFx(43, MidiFxKind::VelocityScaler))
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
            .push(GraphCommand::AddEffect(7, "knead".to_string()))
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
            .push(GraphCommand::AddEffect(7, "knead".to_string()))
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
    fn set_param_maps_known_names_onto_the_knead_engine_and_diagnoses_unknown_ones() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, "knead".to_string()))
            .unwrap();
        scheduler.update_graph();

        command_tx
            .push(GraphCommand::SetParam(
                7,
                "shift_semitones".to_string(),
                3.0,
            ))
            .unwrap();
        scheduler.update_graph();

        match &scheduler.effects[0].instance {
            PluginCore::Knead(engine) => assert_eq!(engine.shift_semitones, 3.0),
            PluginCore::Native(_) => panic!("expected the knead effect"),
        }

        command_tx
            .push(GraphCommand::SetParam(
                7,
                "not_a_real_param".to_string(),
                1.0,
            ))
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

    #[test]
    fn add_effect_with_an_unsupported_plugin_type_is_diagnosed_not_silently_dropped() {
        let (mut command_tx, mut scheduler, _retired_rx) = create_scheduler();
        command_tx
            .push(GraphCommand::AddEffect(7, "not-a-real-effect".to_string()))
            .unwrap();
        scheduler.update_graph();

        assert!(scheduler.effects.is_empty());
        assert_eq!(
            scheduler
                .midi_rt_diagnostics
                .snapshot()
                .unsupported_effect_additions,
            1
        );
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
            .push(GraphCommand::AddMidiFx(7, MidiFxKind::Arpeggiator))
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
        assert_eq!(effect.midi_fx.len(), 0);
        assert_eq!(effect.midi_fx.capacity(), 0);
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
    use rtrb::RingBuffer;
    use std::any::Any;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

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

        /// Render one block over a freshly zeroed pair, the way the CPAL
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
                vec![value; frames],
                Vec::new(),
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
                vec![1.0; 8],
                Vec::new(),
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
                vec![1.0; 8],
                Vec::new(),
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
                vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0],
                Vec::new(),
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
                vec![1.0; 2],
                vec![0.25; 2],
                placement(0, 0, 2),
                ClipPlayback::at_gain(1.0),
            ),
        ));
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(2)));
        harness.send(GraphCommand::AddClip(
            2,
            TimelineClip::new(
                8,
                vec![0.5; 2],
                Vec::new(),
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
    fn a_bus_asked_to_feed_a_track_is_refused_because_buses_are_summed_last() {
        let mut harness = Harness::new(16);
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::SetBusOutput(50, RouteTarget::Track(1)));

        assert_eq!(harness.diagnostics().invalid_bus_routings, 1);
        assert_eq!(
            harness.scheduler.timeline().bus(50).map(|bus| bus.output()),
            Some(RouteTarget::Master)
        );
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
                vec![1.0; 4],
                Vec::new(),
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
                vec![1.0; 4],
                vec![0.0; 4],
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
        harness.send(GraphCommand::AddEffect(7, "knead".to_string()));
        harness.send(GraphCommand::AutomateDeviceParam {
            effect_id: 7,
            param: DeviceParam::ShiftSemitones,
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
        harness.send(GraphCommand::AddDetachedEffect(7, "knead".to_string()));
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
                    vec![0.5; 64],
                    Vec::new(),
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
}
