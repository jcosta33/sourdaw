pub mod audio_bridge;
pub mod audio_thread;
pub(crate) mod device;
pub mod engine_events;
pub mod midi;
pub mod midi_fx;
pub mod offline;
pub mod plugin_slot;
pub mod scheduler;
pub mod timeline;

use audio_thread::{spawn_audio_thread_with_diagnostics, AudioThreadHandle};
use engine_events::{engine_event_channel, EngineEvent};
use midi::diagnostics::{
    active_midi_rt_diagnostics_channel, ActiveMidiRtDiagnosticsReader,
    ActiveMidiRtDiagnosticsSnapshot,
};
use plugin_slot::NativePlugin;
use rtrb::{Consumer, Producer, PushError, RingBuffer};
use scheduler::{
    graph_progress_channel, BuiltinEffectType, GraphCommand, GraphProgressReader,
    GraphProgressSnapshot, RetiredGraphObjects, EFFECT_TABLE_CAPACITY,
};
use std::sync::mpsc::Sender;
use timeline::{
    timeline_rt_diagnostics_channel, AutomationTarget, AutomationWrite, ChainEntry, ClipPlacement,
    ClipPlayback, DeviceParam, RouteTarget, SendTap, TimelineBus, TimelineClip,
    TimelineRtDiagnosticsReader, TimelineRtDiagnosticsSnapshot, TimelineTrack,
};

/// Run a start attempt, and on failure run it once more with the negotiated
/// buffer period dropped, reporting both failures when neither attempt worked.
///
/// A negotiated `BufferSize::Fixed` request reaches backend code a
/// `BufferSize::Default` request never runs — CoreAudio configures the device
/// period only for a `Fixed` request, and ALSA validates it against a separate
/// `hw_params` clone — so a build can fail for the requested period alone.
/// Failing outright there would leave the user with no engine at all, strictly
/// worse than the unnegotiated period the engine ran on before, so the second
/// attempt drops the request.
///
/// Generic over the attempt rather than written inline in [`EngineHandle::new`]
/// so this control flow — one attempt on success, two on failure, both errors in
/// the merged message — is testable without an audio device.
fn spawn_with_fallback<T>(mut spawn: impl FnMut(bool) -> Result<T, String>) -> Result<T, String> {
    match spawn(false) {
        Ok(handle) => Ok(handle),
        Err(negotiated_error) => spawn(true).map_err(|default_error| {
            format!(
                "{negotiated_error} (retrying with the device default period also failed: {default_error})"
            )
        }),
    }
}

/// How [`EngineHandle::send_graph_batch`] failed.
///
/// The two variants carry the one fact a caller reporting a whole-or-nothing
/// contract needs: whether anything reached the engine.
#[derive(Debug)]
pub enum GraphBatchError {
    /// The batch was refused whole; nothing was pushed.
    Refused(String),
    /// `pushed` of `total` commands were queued before a push failed.
    ///
    /// Unreachable by construction — admission verifies the whole batch fits
    /// before the first push, and only this handle pushes — but a partial
    /// application must never report itself as either whole or refused.
    Partial {
        pushed: usize,
        total: usize,
        error: String,
    },
}

pub struct EngineHandle {
    command_tx: Producer<GraphCommand>,
    /// Hands freshly provisioned retirement consumers to the reclaimer thread
    /// when the command channel is reallocated for a large batch.
    retired_adoption_tx: Sender<Consumer<RetiredGraphObjects>>,
    _audio_thread: AudioThreadHandle,
    next_plugin_id: usize,
    /// How many effect-table slots this handle has sent registrations for and
    /// not yet sent retirements for.
    ///
    /// The scheduler holds one effect table and three producers fill it: graph
    /// devices, engine-owned plugin instances, and the crumbs capture slot.
    /// This is the count of that whole population, and it is authoritative for
    /// what has been *sent* — which is the number that decides a refusal,
    /// because the callback refuses exactly what exceeds capacity, counts it,
    /// and cannot report it to the caller who asked. Every registration and
    /// every retirement crosses the ring through [`EngineHandle::push`], so
    /// the ledger is maintained in one place and no producer can bypass it;
    /// what each command does to the table is
    /// [`GraphCommand::effect_table_delta`], which is exhaustive over the
    /// vocabulary so a new registering command cannot be added without saying
    /// so.
    effect_registrations: usize,
    midi_rt_diagnostics: ActiveMidiRtDiagnosticsReader,
    timeline_rt_diagnostics: TimelineRtDiagnosticsReader,
    graph_progress: GraphProgressReader,
    engine_events: Consumer<EngineEvent>,
    /// The rate the stream actually opened at. Every command that names a time
    /// in seconds is converted to frames against this and nothing else.
    sample_rate: f32,
}

impl EngineHandle {
    /// Boot the native audio engine (spawns the audio stream).
    ///
    /// Two attempts, the second without the negotiated buffer period — see
    /// [`spawn_with_fallback`] for why the retry exists and what it reports.
    pub fn new() -> Result<Self, String> {
        spawn_with_fallback(Self::spawn)
    }

    /// Start the audio thread against a freshly built set of channels.
    ///
    /// Every channel is rebuilt per attempt because a failed stream build
    /// consumes the ends it was given: the command consumer went into the
    /// scheduler, the scheduler and the event producer went into the render
    /// and error callbacks, and the device backend drops those callbacks
    /// along with the stream it could not build. Reusing the producers held
    /// here would leave them writing to ends that no longer exist.
    /// `EngineHandle` is the only place that owns both halves of all three
    /// channels, which is why the retry lives here rather than inside
    /// `spawn_audio_thread`.
    fn spawn(force_default_buffer: bool) -> Result<Self, String> {
        let (tx, rx) = RingBuffer::new(256);
        let (diagnostics_tx, diagnostics_reader) = active_midi_rt_diagnostics_channel();
        let (timeline_diagnostics_tx, timeline_diagnostics_reader) =
            timeline_rt_diagnostics_channel();
        let (graph_progress_tx, graph_progress_reader) = graph_progress_channel();
        let (engine_event_tx, engine_event_rx) = engine_event_channel();
        let (thread_handle, sample_rate, retired_adoption_tx) =
            spawn_audio_thread_with_diagnostics(
                rx,
                diagnostics_tx,
                timeline_diagnostics_tx,
                graph_progress_tx,
                engine_event_tx,
                force_default_buffer,
            )?;

        Ok(Self {
            command_tx: tx,
            retired_adoption_tx,
            _audio_thread: thread_handle,
            next_plugin_id: 1000, // Start high to avoid collision with effect IDs
            effect_registrations: 0,
            midi_rt_diagnostics: diagnostics_reader,
            timeline_rt_diagnostics: timeline_diagnostics_reader,
            graph_progress: graph_progress_reader,
            engine_events: engine_event_rx,
            sample_rate,
        })
    }

    /// The sample rate the running stream renders at.
    pub const fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    /// Publish one validated batch with all-or-nothing visibility.
    ///
    /// The typed methods below stay the ordinary path; this exists for callers
    /// that validate and build a whole *batch* of commands control-side (the
    /// `AudioGraphBackend` transport). The batch crosses the ring behind a
    /// [`scheduler::GraphCommand::BeginBatch`] fence the audio thread's drain
    /// respects: the callback applies either none of it or all of it between
    /// two rendered blocks, so a live block boundary can never observe half a
    /// topology — a strip without its frame-0 state write, a splice without
    /// its effect registration.
    ///
    /// Ring capacity never bounds an admitted batch: a batch larger than the
    /// ring — or one that finds it congested — reallocates the channel
    /// control-side and hands the engine the new ends through a lock-free
    /// swap fence (see [`EngineHandle::provision_command_channel`]).
    ///
    /// On [`GraphBatchError::Refused`] nothing of the batch was pushed. Only
    /// this handle pushes and only the audio thread pops, so once admission
    /// sees room for fence plus body the pushes cannot fail; the `Partial`
    /// variant exists so that even an impossible failure never reports a
    /// partial application as whole.
    pub fn send_graph_batch(&mut self, ops: Vec<GraphCommand>) -> Result<(), GraphBatchError> {
        // Effect-table admission comes before the ring is provisioned, so a
        // batch that cannot fit the shared table never reallocates a channel
        // to carry commands that will be refused one at a time on the way in.
        self.admit_effect_registrations(&ops)
            .map_err(GraphBatchError::Refused)?;

        // The fence occupies a slot of its own alongside the body.
        let needed = ops.len() + 1;
        if self.command_tx.slots() < needed {
            self.provision_command_channel(needed)
                .map_err(GraphBatchError::Refused)?;
        }

        let total = ops.len();
        if let Err(error) = self.push(GraphCommand::BeginBatch { commands: total }) {
            return Err(GraphBatchError::Refused(error));
        }
        for (pushed, op) in ops.into_iter().enumerate() {
            if let Err(error) = self.push(op) {
                return Err(GraphBatchError::Partial {
                    pushed,
                    total,
                    error,
                });
            }
        }
        Ok(())
    }

    /// Reallocate the command channel to hold `needed` commands and hand the
    /// audio thread the new ends through a swap fence on the old ring.
    ///
    /// Everything heavy happens on this thread: both new rings are allocated
    /// here, and the callback's part is pointer work — pop the fence (by
    /// construction the old ring's last element, so the old ring is already
    /// drained dry), adopt the new consumer and retirement producer, and hand
    /// the old consumer to the reclaimer. The happens-before is rtrb's own:
    /// the new ends cross inside a command element, so the push that
    /// publishes the fence is the release the adopting pop acquires.
    ///
    /// The retirement ring is co-sized at capacity + 1 — one retirement per
    /// command in the worst case, plus the scheduler's reserved shutdown slot
    /// — preserving the arithmetic behind the boot-time
    /// `RETIREMENT_QUEUE_CAPACITY` at every size, which is what lets the
    /// drain's batch fence never defer an admitted batch for good.
    fn provision_command_channel(&mut self, needed: usize) -> Result<(), String> {
        const SWAP_PUSH_ATTEMPTS: usize = 500;
        const SWAP_PUSH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(2);

        let capacity = needed.max(self.command_tx.buffer().capacity());
        let (command_tx, command_rx) = RingBuffer::new(capacity);
        let (retired_tx, retired_rx) = RingBuffer::new(capacity + 1);
        self.retired_adoption_tx
            .send(retired_rx)
            .map_err(|_| "engine-not-running: the retirement reclaimer is gone".to_string())?;

        // The swap fence needs one slot on the old ring. The callback drains
        // the ring every device period, so a full ring frees within
        // milliseconds; one still full after the whole wait means the engine
        // is not draining at all, and the batch refuses rather than blocking
        // the control thread forever.
        let mut swap = GraphCommand::SwapCommandChannel {
            commands: command_rx,
            retired_tx,
        };
        for _ in 0..SWAP_PUSH_ATTEMPTS {
            match self.command_tx.push(swap) {
                Ok(()) => {
                    // Dropping the old producer marks the old ring abandoned,
                    // which is what lets the reclaimer free it once the
                    // callback hands the old consumer over.
                    self.command_tx = command_tx;
                    return Ok(());
                }
                Err(PushError::Full(returned)) => {
                    swap = returned;
                    std::thread::sleep(SWAP_PUSH_INTERVAL);
                }
            }
        }
        Err(
            "command-queue-full: the engine did not drain its command ring while a channel swap \
             waited"
                .to_string(),
        )
    }

    /// Read the latest fixed numeric MIDI diagnostics outside the audio callback.
    pub fn midi_rt_diagnostics_snapshot(&mut self) -> ActiveMidiRtDiagnosticsSnapshot {
        self.midi_rt_diagnostics.snapshot()
    }

    /// Read the latest fixed numeric timeline diagnostics outside the audio
    /// callback. Every counter is a timeline command the graph refused, and a
    /// refusal is the alternative to allocating inside the audio deadline.
    pub fn timeline_rt_diagnostics_snapshot(&mut self) -> TimelineRtDiagnosticsSnapshot {
        self.timeline_rt_diagnostics.snapshot()
    }

    /// Read the audio thread's latest progress echo outside the callback.
    ///
    /// This is the control-side queue ledger's release evidence: see
    /// [`GraphProgressSnapshot`] for the happens-before it guarantees and the
    /// lag it may carry. A consumer subtracts only what the snapshot proves
    /// landed, so a lagging echo over-refuses and never under-refuses.
    pub fn graph_progress_snapshot(&mut self) -> GraphProgressSnapshot {
        self.graph_progress.snapshot()
    }

    /// Take every engine event published since the last drain.
    ///
    /// Consuming, not peeking: an event reported once is reported once. This
    /// runs on the control side, never in the audio callback, so allocating the
    /// `Vec` here is safe.
    pub fn drain_engine_events(&mut self) -> Vec<EngineEvent> {
        engine_events::drain_engine_events(&mut self.engine_events)
    }

    /// Add a built-in effect to the native rendering graph.
    ///
    /// The type name resolves to a fixed-size address here, on the control
    /// side: the command that crosses the ring may not carry a heap allocation
    /// onto the audio thread (ADR 0020), so an unknown name is refused where
    /// it can be reported rather than counted on the callback after the fact.
    pub fn add_effect(&mut self, id: usize, plugin_type: &str) -> Result<(), String> {
        let plugin_type = BuiltinEffectType::from_name(plugin_type)
            .ok_or_else(|| format!("unknown built-in effect type '{plugin_type}'"))?;
        self.push(GraphCommand::AddEffect(id, plugin_type))
    }

    /// Update an effect parameter natively. The name resolves to a fixed-size
    /// address on the control side, for the reason given on
    /// [`Self::add_effect`].
    pub fn set_effect_param(&mut self, id: usize, param: &str, value: f32) -> Result<(), String> {
        let param = DeviceParam::from_name(param)
            .ok_or_else(|| format!("unknown built-in parameter '{param}'"))?;
        self.push(GraphCommand::SetParam(id, param, value))
    }

    /// Bypass or un-bypass an effect or plugin on the native graph.
    ///
    /// A bypassed entry keeps its instance and its state — the professional
    /// convention, so re-enabling it does not reload the plugin — but stops
    /// processing: bridged audio is returned untouched, and MIDI queued while
    /// bypassed is discarded rather than banked into a burst of stale note-ons
    /// at the moment it is re-enabled.
    pub fn set_bypass(&mut self, id: usize, bypassed: bool) -> Result<(), String> {
        self.push(GraphCommand::SetBypass(id, bypassed))
    }

    /// Add a native plugin (CLAP/VST3) to the audio thread's processing chain.
    /// Returns the assigned plugin ID for future reference.
    pub fn add_plugin(&mut self, plugin: Box<dyn NativePlugin>) -> Result<usize, String> {
        let id = self.reserve_plugin_id();
        self.add_plugin_with_id(id, plugin)?;
        Ok(id)
    }

    /// Reserve a native plugin ID before all runtime-side state is registered.
    pub fn reserve_plugin_id(&mut self) -> usize {
        let id = self.next_plugin_id;
        self.next_plugin_id += 1;
        id
    }

    /// Add a native plugin with an already reserved plugin ID.
    pub fn add_plugin_with_id(
        &mut self,
        id: usize,
        plugin: Box<dyn NativePlugin>,
    ) -> Result<(), String> {
        self.push(GraphCommand::AddPlugin(id, plugin))
    }

    /// Add a native plugin and its audio bridge with one scheduler command.
    pub fn add_plugin_with_bridge(
        &mut self,
        id: usize,
        plugin: Box<dyn NativePlugin>,
        bridge: audio_bridge::PluginAudioBridge,
    ) -> Result<(), String> {
        self.push(GraphCommand::AddPluginWithBridge(id, plugin, bridge))
    }

    /// Remove a native plugin from the audio thread.
    pub fn remove_plugin(&mut self, id: usize) -> Result<(), String> {
        self.push(GraphCommand::RemovePluginWithBridge(id))
    }

    /// Send a MIDI note event to a specific plugin (lock-free).
    pub fn send_midi_note(
        &mut self,
        plugin_id: usize,
        event: plugin_slot::MidiNoteEvent,
    ) -> Result<(), String> {
        self.push(GraphCommand::SendMidiNote(plugin_id, event))
    }

    /// Add a timeline track.
    ///
    /// The track is built here, on the control thread, with every buffer it
    /// will ever need already sized, because the audio thread that installs it
    /// may not allocate.
    pub fn add_track(&mut self, id: usize) -> Result<(), String> {
        self.push(GraphCommand::AddTrack(TimelineTrack::new(id)))
    }

    /// Remove a track. It leaves the audio thread over the retirement channel
    /// with every clip it owns; its devices stay loaded but stop processing
    /// until they are placed on another track or removed.
    pub fn remove_track(&mut self, id: usize) -> Result<(), String> {
        self.push(GraphCommand::RemoveTrack(id))
    }

    /// Route a track's output at the master, a bus, or another track.
    pub fn set_track_output(&mut self, id: usize, target: RouteTarget) -> Result<(), String> {
        self.push(GraphCommand::SetTrackOutput(id, target))
    }

    /// Mute a track. The mute sits after the fader and before the panner, so a
    /// pre-fader send keeps feeding its bus — the behaviour a cue or monitor
    /// mix depends on.
    pub fn set_track_mute(&mut self, id: usize, muted: bool) -> Result<(), String> {
        self.push(GraphCommand::SetTrackMute(id, muted))
    }

    /// Close or open a track's pre-fader solo gate — the gate that silences
    /// the tracks the engineer is not soloing. It sits ahead of the send taps,
    /// so a gated track stops feeding its cue and return buses too, which is
    /// what mute deliberately does not do.
    pub fn set_track_solo_gate(&mut self, id: usize, gated: bool) -> Result<(), String> {
        self.push(GraphCommand::SetTrackSoloGate(id, gated))
    }

    /// Splice an already registered effect into a track's device chain.
    pub fn insert_track_device(
        &mut self,
        track_id: usize,
        entry: ChainEntry,
        index: usize,
    ) -> Result<(), String> {
        self.push(GraphCommand::InsertTrackDevice {
            track_id,
            entry,
            index,
        })
    }

    /// Take an effect out of a track's chain, returning it to the master
    /// insert chain without unloading it.
    pub fn remove_track_device(&mut self, track_id: usize, effect_id: usize) -> Result<(), String> {
        self.push(GraphCommand::RemoveTrackDevice {
            track_id,
            effect_id,
        })
    }

    /// Splice an already registered effect into a bus's device chain — the
    /// reverb or delay a send bus exists to host.
    pub fn insert_bus_device(
        &mut self,
        bus_id: usize,
        entry: ChainEntry,
        index: usize,
    ) -> Result<(), String> {
        self.push(GraphCommand::InsertBusDevice {
            bus_id,
            entry,
            index,
        })
    }

    pub fn remove_bus_device(&mut self, bus_id: usize, effect_id: usize) -> Result<(), String> {
        self.push(GraphCommand::RemoveBusDevice { bus_id, effect_id })
    }

    /// Add a send from a track to a bus at the given tap.
    pub fn add_send(
        &mut self,
        track_id: usize,
        bus_id: usize,
        tap: SendTap,
        level: f32,
    ) -> Result<(), String> {
        self.push(GraphCommand::AddSend {
            track_id,
            bus_id,
            tap,
            level,
        })
    }

    pub fn remove_send(&mut self, track_id: usize, bus_id: usize) -> Result<(), String> {
        self.push(GraphCommand::RemoveSend { track_id, bus_id })
    }

    /// Add a bus. A bus may feed the master or another bus; buses are summed
    /// after every track, so a bus cannot feed a track.
    pub fn add_bus(&mut self, id: usize) -> Result<(), String> {
        self.push(GraphCommand::AddBus(TimelineBus::new(id)))
    }

    pub fn remove_bus(&mut self, id: usize) -> Result<(), String> {
        self.push(GraphCommand::RemoveBus(id))
    }

    pub fn set_bus_output(&mut self, id: usize, target: RouteTarget) -> Result<(), String> {
        self.push(GraphCommand::SetBusOutput(id, target))
    }

    /// Place a clip on a track. `right` may be empty for mono material, which
    /// plays to both outputs. The vectors are the clip's source material and
    /// are never written to again: an edit moves the placement instead.
    pub fn add_clip(
        &mut self,
        track_id: usize,
        clip_id: usize,
        left: Vec<f32>,
        right: Vec<f32>,
        placement: ClipPlacement,
        playback: ClipPlayback,
    ) -> Result<(), String> {
        self.push(GraphCommand::AddClip(
            track_id,
            TimelineClip::new(clip_id, left, right, placement, playback),
        ))
    }

    pub fn remove_clip(&mut self, track_id: usize, clip_id: usize) -> Result<(), String> {
        self.push(GraphCommand::RemoveClip(track_id, clip_id))
    }

    /// Move or trim a clip without touching its source material.
    pub fn set_clip_placement(
        &mut self,
        track_id: usize,
        clip_id: usize,
        placement: ClipPlacement,
    ) -> Result<(), String> {
        self.push(GraphCommand::SetClipPlacement(track_id, clip_id, placement))
    }

    /// Re-state a clip's level, fades and rate without touching its source
    /// material.
    pub fn set_clip_playback(
        &mut self,
        track_id: usize,
        clip_id: usize,
        playback: ClipPlayback,
    ) -> Result<(), String> {
        self.push(GraphCommand::SetClipPlayback(track_id, clip_id, playback))
    }

    /// Place the playhead at an absolute timeline frame.
    pub fn seek_frames(&mut self, frame: u64) -> Result<(), String> {
        self.push(GraphCommand::SeekFrames(frame))
    }

    /// Write a mixer parameter at an absolute timeline frame. The stamp is
    /// authoritative, so the same command stream renders the same automation
    /// however the blocks fall; the write's own form decides whether it joins
    /// what is queued or replaces it.
    pub fn automate_param(
        &mut self,
        target: AutomationTarget,
        write: AutomationWrite,
    ) -> Result<(), String> {
        self.push(GraphCommand::AutomateParam { target, write })
    }

    /// Schedule a built-in device parameter change at an absolute timeline
    /// frame.
    pub fn automate_device_param(
        &mut self,
        effect_id: usize,
        param: DeviceParam,
        value: f32,
        at_frame: u64,
    ) -> Result<(), String> {
        self.push(GraphCommand::AutomateDeviceParam {
            effect_id,
            param,
            value,
            at_frame,
        })
    }

    /// How many of the scheduler's effect-table slots this handle has
    /// committed. See [`EngineHandle::effect_registrations`].
    pub const fn registered_effect_count(&self) -> usize {
        self.effect_registrations
    }

    /// Refuse now if the shared effect table has no room for `additional`
    /// more registrations.
    ///
    /// A producer that has other state to set up — a plugin instance to keep
    /// in a side map, an audio bridge to publish — calls this *before* it
    /// registers any of it, so a full table is reported as an `Err` the user
    /// sees rather than as a registration that appears to succeed and then
    /// dies on the callback. [`EngineHandle::push`] enforces the same ceiling
    /// unconditionally, so skipping this call cannot let a registration past;
    /// it only costs the caller the cleanup it now has to unwind.
    ///
    /// `additional` comes from the caller, so the sum is checked rather than
    /// added: a release build wraps a large request back under the ceiling and
    /// admits it. An overflowing request is a request the table can never hold,
    /// so it reads as the refusal it is.
    pub fn ensure_effect_table_headroom(&self, additional: usize) -> Result<(), String> {
        let requested = self
            .effect_registrations
            .checked_add(additional)
            .ok_or_else(effect_table_full_error)?;
        if requested > EFFECT_TABLE_CAPACITY {
            return Err(effect_table_full_error());
        }
        Ok(())
    }

    /// Walk `ops` in the order the callback will apply them and refuse the
    /// batch if it would ever push the shared effect table past capacity.
    ///
    /// Order matters and netting does not: a batch that retires a device and
    /// registers another fits at capacity, while one that registers first does
    /// not, and the callback applies the batch in exactly this order. Pure
    /// check — [`EngineHandle::push`] commits each delta as its command goes
    /// onto the ring, so counting here as well would double the ledger.
    fn admit_effect_registrations(&self, ops: &[GraphCommand]) -> Result<(), String> {
        let mut count = self.effect_registrations;
        for op in ops {
            match op.effect_table_delta() {
                delta if delta > 0 => {
                    if count + delta as usize > EFFECT_TABLE_CAPACITY {
                        return Err(effect_table_full_error());
                    }
                    count += delta as usize;
                }
                delta if delta < 0 => count = count.saturating_sub(delta.unsigned_abs()),
                _ => {}
            }
        }
        Ok(())
    }

    /// The one route onto the command ring, and with it the one place the
    /// effect-table ledger is kept.
    ///
    /// A registration past the ceiling is refused here rather than pushed: the
    /// audio thread's own refusal is a counter it cannot return to anyone, so
    /// past this point the instance is loaded, reports success, and passes dry
    /// audio forever with nothing saying it was refused.
    fn push(&mut self, command: GraphCommand) -> Result<(), String> {
        let delta = command.effect_table_delta();
        if delta > 0 && self.effect_registrations + delta as usize > EFFECT_TABLE_CAPACITY {
            return Err(effect_table_full_error());
        }
        self.command_tx
            .push(command)
            .map_err(|_| "Audio command queue full".to_string())?;
        if delta >= 0 {
            self.effect_registrations += delta as usize;
        } else {
            // Saturating for the floor alone, and the floor is not where the
            // risk is. Every retirement is conditional on the callback finding
            // its target (see [`GraphCommand::effect_table_delta`]), and one
            // that finds nothing leaves the ledger at N-1 while the table
            // stays at N: the drift *grants* headroom that does not exist, so
            // the next registration is admitted here and then refused silently
            // on the callback — the exact failure this ledger removes. What
            // keeps the two in step is the precondition on the sender, not
            // this subtraction: a retirement is only ever sent for a target
            // already resolved against the project the sender holds.
            self.effect_registrations = self
                .effect_registrations
                .saturating_sub(delta.unsigned_abs());
        }
        Ok(())
    }
}

/// The one wording for a refusal against the shared effect table, so the batch
/// path, the plugin path and the crumbs path all report the same ceiling.
fn effect_table_full_error() -> String {
    format!(
        "effect-table-full: the engine already holds its maximum of {EFFECT_TABLE_CAPACITY} \
         native devices and plugins"
    )
}

/// Build a handle whose commands land in the returned consumer.
///
/// The audio thread is the only thing an `EngineHandle` cannot have in a test —
/// it needs a real output device — and it is also the only part a command test
/// does not exercise: a command's whole journey is the ring between this handle
/// and [`scheduler::AudioScheduler`], which a test can drive directly.
#[cfg(test)]
fn engine_handle_for_command_capture(
    capacity: usize,
) -> (
    EngineHandle,
    Consumer<GraphCommand>,
    std::sync::mpsc::Receiver<Consumer<RetiredGraphObjects>>,
) {
    let (command_tx, command_rx) = RingBuffer::new(capacity);
    let (_diagnostics_tx, diagnostics_reader) = active_midi_rt_diagnostics_channel();
    let (_timeline_diagnostics_tx, timeline_diagnostics_reader) = timeline_rt_diagnostics_channel();
    let (_graph_progress_tx, graph_progress_reader) = graph_progress_channel();
    let (_engine_event_tx, engine_event_rx) = engine_event_channel();
    let (retired_adoption_tx, retired_adoption_rx) = std::sync::mpsc::channel();

    (
        EngineHandle {
            command_tx,
            retired_adoption_tx,
            _audio_thread: audio_thread::detached_audio_thread_handle(),
            next_plugin_id: 1000,
            effect_registrations: 0,
            midi_rt_diagnostics: diagnostics_reader,
            timeline_rt_diagnostics: timeline_diagnostics_reader,
            graph_progress: graph_progress_reader,
            engine_events: engine_event_rx,
            sample_rate: 48_000.0,
        },
        command_rx,
        retired_adoption_rx,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        engine_handle_for_command_capture, spawn_with_fallback, GraphBatchError,
        EFFECT_TABLE_CAPACITY,
    };
    use crate::audio_bridge::create_audio_bridge;
    use crate::plugin_slot::NativePlugin;
    use crate::scheduler::{AudioScheduler, BuiltinEffectType, GraphCommand};
    use crate::timeline::{ChainEntry, DeviceKind, DeviceParam, TimelineTrack};
    use rtrb::{Consumer, RingBuffer};
    use std::any::Any;
    use std::cell::RefCell;

    /// Overwrites whatever it is handed, so a block it never touched is
    /// distinguishable from one it processed.
    struct OverwritingPlugin;

    impl NativePlugin for OverwritingPlugin {
        fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
            for index in 0..num_samples {
                left[index] = 0.25;
                right[index] = 0.25;
            }
        }

        fn name(&self) -> &str {
            "overwriting-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// The bypass a user toggles on a natively hosted plugin has to reach the
    /// audio thread to mean anything: the whole point is that the plugin keeps
    /// its instance and its state while its audio passes it by.
    #[test]
    fn set_bypass_reaches_the_scheduler_and_returns_bridged_audio_untouched() {
        let (mut engine, command_rx, _retired_adoption_rx) = engine_handle_for_command_capture(16);
        let (retired_tx, _retired_rx) = RingBuffer::new(16);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);
        let (bridge, mut bridge_handle) = create_audio_bridge(42);

        engine
            .add_plugin_with_bridge(42, Box::new(OverwritingPlugin), bridge)
            .expect("the plugin should reach the graph");
        engine
            .set_bypass(42, true)
            .expect("the bypass should reach the graph");
        scheduler.update_graph();

        assert!(bridge_handle.push_input(&[0.5; 4], &[0.5; 4]));
        scheduler.process_audio_bridges(512);
        let bypassed = bridge_handle.pop_output().expect("the bypassed block");
        assert_eq!(
            &bypassed.left[..4],
            &[0.5; 4],
            "a bypassed plugin must not process the block"
        );

        // And the toggle is a toggle: releasing bypass puts the same instance
        // back on the signal path without reloading it.
        engine
            .set_bypass(42, false)
            .expect("the bypass release should reach the graph");
        scheduler.update_graph();

        assert!(bridge_handle.push_input(&[0.5; 4], &[0.5; 4]));
        scheduler.process_audio_bridges(512);
        let processed = bridge_handle.pop_output().expect("the processed block");
        assert_eq!(&processed.left[..4], &[0.25; 4]);
    }

    /// A full-project sync can exceed any fixed ring, and splitting it would
    /// surrender atomicity. Admission must provision instead of refusing: the
    /// channel is reallocated control-side, the scheduler adopts the new ends
    /// through the swap fence, and the whole batch — larger than the boot
    /// ring — applies against an idle engine in one drain.
    #[test]
    fn a_batch_larger_than_the_command_ring_applies_whole_against_an_idle_engine() {
        let (mut engine, command_rx, retired_adoption_rx) = engine_handle_for_command_capture(256);
        let (retired_tx, _old_retired_rx) = RingBuffer::new(257);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);

        // 150 add/remove pairs plus a survivor: 301 commands, over the 256
        // boot capacity, and every removal exercises the co-sized retirement
        // provisioning too.
        let mut ops = Vec::new();
        for id in 0..150usize {
            ops.push(GraphCommand::AddTrack(TimelineTrack::new(id)));
            ops.push(GraphCommand::RemoveTrack(id));
        }
        ops.push(GraphCommand::AddTrack(TimelineTrack::new(999)));
        assert!(ops.len() + 1 > 256);

        engine
            .send_graph_batch(ops)
            .expect("capacity must be provisioned, not refused");

        // The freshly provisioned retirement ring reached the reclaimer's
        // adoption channel before the swap was published.
        let mut new_retired_rx = retired_adoption_rx
            .try_recv()
            .expect("the swapped-in retirement ring");

        // One drain: swap fence, then the whole batch, atomically.
        scheduler.update_graph();

        assert_eq!(scheduler.timeline().track_count(), 1);
        assert!(scheduler.timeline().track(999).is_some());

        // Everything the batch gave up crossed the new retirement ring: the
        // 150 removed tracks plus the swapped-out old command consumer.
        let mut retirements = 0;
        while new_retired_rx.pop().is_ok() {
            retirements += 1;
        }
        assert_eq!(retirements, 151);
    }

    /// The typed handle resolves effect type and parameter names to
    /// fixed-size addresses before anything crosses the ring: a command
    /// carrying a `String` would have its allocation freed on the audio
    /// thread when consumed (ADR 0020). An unknown name refuses here, where
    /// it can be reported, instead of being counted on the callback after
    /// the fact — the replacement for the unsupported-type and unmapped-name
    /// counters that path used to feed.
    #[test]
    fn unknown_effect_types_and_parameter_names_refuse_control_side() {
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            engine_handle_for_command_capture(16);

        assert!(engine.add_effect(7, "not-a-real-effect").is_err());
        assert!(engine.set_effect_param(7, "not_a_real_param", 1.0).is_err());
        assert!(
            command_rx.pop().is_err(),
            "a refused name must not cross the ring"
        );

        // The known names still do — as the addresses the scheduler applies.
        engine
            .add_effect(7, "knead")
            .expect("knead is a built-in type");
        engine
            .set_effect_param(7, "shift_semitones", 3.0)
            .expect("shift_semitones is a knead parameter");
        assert!(matches!(
            command_rx.pop(),
            Ok(GraphCommand::AddEffect(id, BuiltinEffectType::Knead)) if id == 7
        ));
        assert!(matches!(
            command_rx.pop(),
            Ok(GraphCommand::SetParam(id, DeviceParam::ShiftSemitones, value))
                if id == 7 && value == 3.0
        ));
    }

    #[test]
    fn a_start_that_negotiates_its_period_is_the_only_attempt_made() {
        let requests = RefCell::new(Vec::new());

        let started = spawn_with_fallback(|force_default_buffer| {
            requests.borrow_mut().push(force_default_buffer);
            Ok::<&str, String>("engine on the negotiated period")
        });

        assert_eq!(started, Ok("engine on the negotiated period"));
        // One attempt, and it asked for the negotiated period: a retry here
        // would rebuild a stream that already runs.
        assert_eq!(*requests.borrow(), vec![false]);
    }

    #[test]
    fn a_refused_period_is_retried_once_with_the_device_default() {
        let requests = RefCell::new(Vec::new());

        let started = spawn_with_fallback(|force_default_buffer| {
            requests.borrow_mut().push(force_default_buffer);
            if force_default_buffer {
                Ok("engine on the device default period")
            } else {
                Err("requested period unsupported".to_string())
            }
        });

        assert_eq!(started, Ok("engine on the device default period"));
        assert_eq!(*requests.borrow(), vec![false, true]);
    }

    #[test]
    fn a_start_that_fails_both_ways_reports_both_failures() {
        let requests = RefCell::new(Vec::new());

        let started = spawn_with_fallback(|force_default_buffer| {
            requests.borrow_mut().push(force_default_buffer);
            Err::<(), String>(if force_default_buffer {
                "no output device available".to_string()
            } else {
                "requested period unsupported".to_string()
            })
        });

        // The first failure is the one that describes the request the user's
        // settings made; dropping it for the retry's message would leave the
        // rejected period invisible.
        assert_eq!(
            started,
            Err(concat!(
                "requested period unsupported (retrying with the device default ",
                "period also failed: no output device available)"
            )
            .to_string())
        );
        assert_eq!(*requests.borrow(), vec![false, true]);
    }

    /// Drain everything the handle has queued and report how much there was.
    fn drained(command_rx: &mut Consumer<GraphCommand>) -> usize {
        let mut count = 0;
        while command_rx.pop().is_ok() {
            count += 1;
        }
        count
    }

    /// The scheduler holds *one* effect table and three producers fill it: the
    /// project's graph devices, engine-owned plugin instances, and the crumbs
    /// capture slot. A ceiling that counts one of them bounds a strict subset
    /// of what the callback holds, so it lets the other two straight past —
    /// and the audio thread's own refusal is a counter it cannot hand back to
    /// the caller who asked, so a plugin refused there still loads, still
    /// opens its editor, still moves its knobs, and passes dry audio forever
    /// with nothing anywhere saying it was refused.
    ///
    /// Fill the table entirely with graph devices, then ask for a plugin: the
    /// registration has to fail control-side, where `load_plugin` propagates
    /// the error to the user, and has to put nothing on the ring for the
    /// callback to refuse.
    #[test]
    fn a_plugin_past_the_shared_effect_table_is_refused_before_it_is_registered() {
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            engine_handle_for_command_capture(EFFECT_TABLE_CAPACITY + 8);

        for id in 0..EFFECT_TABLE_CAPACITY {
            engine
                .add_effect(id, "knead")
                .expect("a device inside the table's capacity must register");
        }
        assert_eq!(engine.registered_effect_count(), EFFECT_TABLE_CAPACITY);

        // The pre-check a producer with state to unwind consults *before* it
        // reserves an id or publishes a bridge.
        let refused = engine
            .ensure_effect_table_headroom(1)
            .expect_err("a table filled by devices must refuse the next plugin");
        assert!(
            refused.contains(&EFFECT_TABLE_CAPACITY.to_string()),
            "the refusal must name the ceiling it hit, got: {refused}"
        );

        // And the ledger refuses the registration itself, so a producer that
        // never calls the pre-check still cannot get past the ceiling.
        let (bridge, _bridge_handle) = create_audio_bridge(9_000);
        let registration = engine
            .add_plugin_with_bridge(9_000, Box::new(OverwritingPlugin), bridge)
            .expect_err("the registration itself must be refused, not just the pre-check");
        assert_eq!(registration, refused);

        // Nothing of the refused plugin reached the ring: only the devices
        // are queued, so the callback has nothing to refuse silently.
        assert_eq!(
            drained(&mut command_rx),
            EFFECT_TABLE_CAPACITY,
            "a refused registration must not be pushed"
        );
        assert_eq!(engine.registered_effect_count(), EFFECT_TABLE_CAPACITY);
    }

    /// A ceiling that never gives slots back ratchets downward over a session:
    /// a user who has loaded and unloaded plugins all afternoon hits a limit
    /// that is not there.
    #[test]
    fn retiring_a_plugin_returns_its_slot_to_the_shared_effect_table() {
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            engine_handle_for_command_capture(EFFECT_TABLE_CAPACITY + 8);

        for id in 0..EFFECT_TABLE_CAPACITY - 1 {
            engine.add_effect(id, "knead").expect("device registers");
        }
        let (bridge, _bridge_handle) = create_audio_bridge(9_000);
        engine
            .add_plugin_with_bridge(9_000, Box::new(OverwritingPlugin), bridge)
            .expect("the last slot takes the plugin");
        assert_eq!(engine.registered_effect_count(), EFFECT_TABLE_CAPACITY);
        assert!(engine.ensure_effect_table_headroom(1).is_err());

        engine
            .remove_plugin(9_000)
            .expect("a retirement is never refused for capacity");
        assert_eq!(engine.registered_effect_count(), EFFECT_TABLE_CAPACITY - 1);

        let (replacement, _replacement_handle) = create_audio_bridge(9_001);
        engine
            .add_plugin_with_bridge(9_001, Box::new(OverwritingPlugin), replacement)
            .expect("the retired slot must be available again");
        assert_eq!(engine.registered_effect_count(), EFFECT_TABLE_CAPACITY);
        drained(&mut command_rx);
    }

    /// A graph batch is admitted against the whole table, not against the
    /// devices it happens to carry: plugins loaded through a different command
    /// occupy the same slots. The refusal is whole — the batch's atomicity
    /// means a partial admission is not an option — so not even the fence may
    /// be published.
    #[test]
    fn a_graph_batch_is_admitted_against_the_whole_effect_table() {
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            engine_handle_for_command_capture(EFFECT_TABLE_CAPACITY + 8);

        for id in 0..EFFECT_TABLE_CAPACITY {
            let (bridge, _bridge_handle) = create_audio_bridge(9_000 + id);
            engine
                .add_plugin_with_bridge(9_000 + id, Box::new(OverwritingPlugin), bridge)
                .expect("a plugin inside the table's capacity must register");
        }
        assert_eq!(drained(&mut command_rx), EFFECT_TABLE_CAPACITY);

        let refusal = engine
            .send_graph_batch(vec![GraphCommand::AddDetachedEffect(
                2_000_000,
                BuiltinEffectType::Knead,
            )])
            .expect_err("a batch that cannot fit the shared table must be refused");
        assert!(
            matches!(refusal, GraphBatchError::Refused(_)),
            "the refusal must be whole, got: {refusal:?}"
        );
        assert_eq!(
            drained(&mut command_rx),
            0,
            "a refused batch must publish neither its fence nor its body"
        );
    }

    /// Admission walks the batch in the order the callback will apply it, so a
    /// batch that retires a device before registering its replacement fits at
    /// capacity while the same two commands the other way round do not. Net
    /// counting would admit both and let the second one die on the callback.
    #[test]
    fn batch_admission_follows_the_order_the_callback_will_apply() {
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            engine_handle_for_command_capture(EFFECT_TABLE_CAPACITY + 8);

        for id in 0..EFFECT_TABLE_CAPACITY {
            engine.add_effect(id, "knead").expect("device registers");
        }
        // The retirement below has to be one the callback would really apply:
        // `RemoveTrackDeviceRetired` frees a slot only when the strip it names
        // holds the effect it names, so effect 0 is spliced onto a track
        // first. Naming a track that was never added would leave the ordering
        // assertion watching the ledger agree with itself.
        engine.add_track(1).expect("the track registers");
        engine
            .insert_track_device(
                1,
                ChainEntry {
                    effect_id: 0,
                    kind: DeviceKind::Effect,
                },
                0,
            )
            .expect("the splice registers");
        assert_eq!(drained(&mut command_rx), EFFECT_TABLE_CAPACITY + 2);

        engine
            .send_graph_batch(vec![
                GraphCommand::AddDetachedEffect(2_000_000, BuiltinEffectType::Knead),
                GraphCommand::RemoveTrackDeviceRetired {
                    track_id: 1,
                    effect_id: 0,
                },
            ])
            .expect_err("registering before the retirement lands does not fit");
        assert_eq!(drained(&mut command_rx), 0);

        engine
            .send_graph_batch(vec![
                GraphCommand::RemoveTrackDeviceRetired {
                    track_id: 1,
                    effect_id: 0,
                },
                GraphCommand::AddDetachedEffect(2_000_000, BuiltinEffectType::Knead),
            ])
            .expect("retiring first frees the slot the registration needs");
        assert_eq!(engine.registered_effect_count(), EFFECT_TABLE_CAPACITY);
        assert_eq!(drained(&mut command_rx), 3, "the fence and both commands");
    }

    /// `additional` is the caller's number and the ceiling check used to add
    /// it unchecked, so a release build wrapped a large request back under the
    /// ceiling and granted headroom for a table that could never hold it. A
    /// request that cannot even be counted is a request to refuse, in the same
    /// wording every other ceiling refusal uses so the caller has one message
    /// to report.
    #[test]
    fn a_headroom_request_too_large_to_count_is_refused() {
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            engine_handle_for_command_capture(16);

        // Any non-zero ledger makes `effect_registrations + usize::MAX`
        // overflow rather than merely exceed the ceiling.
        engine.add_effect(0, "knead").expect("device registers");
        assert_eq!(engine.registered_effect_count(), 1);

        let refused = engine
            .ensure_effect_table_headroom(usize::MAX)
            .expect_err("a request too large to count must be refused, not wrapped");
        assert!(
            refused.contains(&EFFECT_TABLE_CAPACITY.to_string()),
            "the refusal must name the ceiling it hit, got: {refused}"
        );
        drained(&mut command_rx);
    }

    /// The ledger's whole claim is that it counts the callback's effect table.
    /// Every other assertion in this module reads it against the capacity
    /// constant or against itself, and the scheduler's own tests build their
    /// rings by hand and never involve an `EngineHandle` — so a
    /// [`GraphCommand::effect_table_delta`] arm that names the wrong sign
    /// still compiles, still passes, and silently walks the ceiling away from
    /// the table it bounds. Exhaustiveness makes an author write an arm; only
    /// this comparison makes them write the right one.
    ///
    /// The stream carries one of everything the classification has to tell
    /// apart: registrations, a placement that moves an effect without
    /// registering one, chain removals that leave the effect registered, and
    /// retirements that really free a slot because the strips they name really
    /// hold the effects they name.
    #[test]
    fn the_ledger_matches_the_scheduler_effect_table_it_counts() {
        let (mut engine, command_rx, _retired_adoption_rx) = engine_handle_for_command_capture(64);
        let (retired_tx, _retired_rx) = RingBuffer::new(64);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);

        engine.add_track(1).expect("the track registers");
        engine.add_bus(50).expect("the bus registers");

        // Five registrations: four built-in devices and one bridged plugin,
        // which take their slots from the same table.
        for id in 7..=10 {
            engine.add_effect(id, "knead").expect("device registers");
        }
        let (bridge, _bridge_handle) = create_audio_bridge(9_000);
        engine
            .add_plugin_with_bridge(9_000, Box::new(OverwritingPlugin), bridge)
            .expect("the plugin registers");

        // Placements. A splice moves an effect between chains; it registers
        // nothing, so it must move neither count.
        for (index, effect_id) in (7..=9usize).enumerate() {
            engine
                .insert_track_device(
                    1,
                    ChainEntry {
                        effect_id,
                        kind: DeviceKind::Effect,
                    },
                    index,
                )
                .expect("the track splice registers");
        }
        engine
            .insert_bus_device(
                50,
                ChainEntry {
                    effect_id: 10,
                    kind: DeviceKind::Effect,
                },
                0,
            )
            .expect("the bus splice registers");

        // Two chain removals that keep the effect registered: it returns to
        // the master insert chain rather than leaving the table.
        engine
            .remove_track_device(1, 8)
            .expect("the chain removal registers");
        engine
            .remove_track_device(1, 9)
            .expect("the chain removal registers");

        // Two retirements that really free their slots.
        engine
            .send_graph_batch(vec![
                GraphCommand::RemoveTrackDeviceRetired {
                    track_id: 1,
                    effect_id: 7,
                },
                GraphCommand::RemoveBusDeviceRetired {
                    bus_id: 50,
                    effect_id: 10,
                },
            ])
            .expect("two retirements against a table with room must be admitted");

        scheduler.update_graph();

        // The two retirements landed on strips that held them, so the table
        // really did give two slots back — without which the equality below
        // could hold on a stream the callback ignored.
        assert_eq!(
            scheduler.effect_table_len(),
            3,
            "the retirements must free exactly the two slots they named"
        );
        assert!(
            scheduler
                .timeline()
                .track(1)
                .expect("the track applied")
                .device_chain()
                .is_empty(),
            "both chain removals and the track retirement must have applied"
        );
        assert!(scheduler
            .timeline()
            .bus(50)
            .expect("the bus applied")
            .device_chain()
            .is_empty());

        assert_eq!(
            engine.registered_effect_count(),
            scheduler.effect_table_len(),
            "the control-side ledger must equal the table it claims to count"
        );
    }
}
