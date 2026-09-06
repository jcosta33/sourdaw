pub mod audio_thread;
pub mod capture;
pub(crate) mod device;
/// Why an engine has no capture side. The device seam itself stays internal;
/// its refusal is the one part of it a host has to be able to name.
pub use device::InputOpenRefusal;
pub mod engine_events;
pub mod midi;
pub mod midi_fx;
pub mod offline;
pub mod pdc;
pub mod plugin_slot;
pub mod scheduler;
pub mod timeline;
pub mod transport_map;

use audio_thread::{spawn_audio_thread_with_diagnostics, AudioThreadHandle};
use engine_events::{engine_event_channel, EngineEvent, StreamErrorKind, StreamSide};
use midi::diagnostics::{
    active_midi_rt_diagnostics_channel, ActiveMidiRtDiagnosticsReader,
    ActiveMidiRtDiagnosticsSnapshot,
};
use midi::note_store::{MidiNoteStore, TimedMidiNote};
use pdc::{CompensationDelay, MAX_COMPENSATION_FRAMES};
use plugin_slot::NativePlugin;
use rtrb::{Consumer, Producer, PushError, RingBuffer};
use scheduler::{
    graph_progress_channel, master_meter_channel, transport_position_channel, BuiltinEffectType,
    GraphCommand, GraphProgressReader, GraphProgressSnapshot, MasterMeterReader,
    MasterMeterSnapshot, PluginCore, RetiredGraphObjects, TransportPositionReader,
    TransportPositionSnapshot, CRUMBS_CAPTURE_RESERVE, EFFECT_TABLE_CAPACITY,
};
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use timeline::{
    timeline_rt_diagnostics_channel, AutomationTarget, AutomationWrite, ChainEntry, ClipPlacement,
    ClipPlayback, DeviceParam, DeviceParamTarget, RouteTarget, SendTap, TimelineBus, TimelineClip,
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
    ///
    /// A prediction, reconciled against the callback's own refusal record:
    /// the callback refuses a colliding id before the table takes the
    /// instance, so that registration's slot comes back here when
    /// [`Self::midi_rt_diagnostics_snapshot`] observes the collision the
    /// callback counted. Until that observation the ledger over-counts and
    /// admission refuses early — the safe side of a prediction, never
    /// headroom the table does not have.
    effect_registrations: usize,
    /// The cumulative `effect_id_collisions` count whose slots the ledger has
    /// already returned. The callback's counter is cumulative and never
    /// resets, so slots are returned by diffing against this baseline rather
    /// than by consuming the raw snapshot.
    reconciled_effect_id_collisions: u64,
    /// Plugin ids this handle has put on the scheduler's input tap and not
    /// taken off again.
    ///
    /// The same shape of ledger as [`Self::effect_registrations`] and for the
    /// same reason: the callback's own refusal is a counter it cannot return
    /// to the caller who asked, so the ceiling is enforced where an `Err`
    /// reaches that caller and the callback's refusal stays the last line.
    ///
    /// Maintained in [`Self::push`] alone, for every command that reaches the
    /// ring by any route, because the typed methods are not the only door: a
    /// public [`GraphCommand`] batch registers consumers too. An id joins on a
    /// registration, and leaves on an unregistration or on any command that
    /// finally drops its effect — exactly the set [`final_dropped_effect_id`]
    /// names, which is `RemovePlugin` together with the retired
    /// track- and bus-device variants, not plugin removals alone. That mirrors
    /// the callback, which prunes the bus inside its own final drop.
    ///
    /// The same sender precondition the effect ledger rests on holds here: a
    /// retirement is only ever sent for a target already resolved against the
    /// project the sender holds. A mis-targeted one drifts this ledger exactly
    /// as it drifts [`Self::effect_registrations`] — freeing a slot the
    /// callback still holds, so the next registration is admitted here and
    /// then refused where nobody can hear it.
    capture_consumers: Vec<usize>,
    midi_rt_diagnostics: ActiveMidiRtDiagnosticsReader,
    timeline_rt_diagnostics: TimelineRtDiagnosticsReader,
    graph_progress: GraphProgressReader,
    transport_position: TransportPositionReader,
    master_meter: MasterMeterReader,
    /// Stream errors the engine's output device reported.
    engine_events: Consumer<EngineEvent>,
    /// Stream errors the engine's input device reported.
    ///
    /// Its own ring rather than a shared one: the two backends run their
    /// error callbacks on different threads, and `EngineEvent`'s ring is
    /// SPSC, so one `Producer` cannot serve both sides (see
    /// `audio_thread::capture_beside`). [`Self::drain_engine_events`] merges
    /// the two into one ordered `Vec`, output first.
    capture_events: Consumer<EngineEvent>,
    /// The rate the stream actually opened at. Every command that names a time
    /// in seconds is converted to frames against this and nothing else.
    sample_rate: f32,
    /// What the capture ring published as its settled latency, in frames, or
    /// zero while it is not serving. Written by the audio thread, read here.
    input_latency_frames: Arc<AtomicUsize>,
    /// The kind of the capture-side refusal `capture_side` last stored, or
    /// zero for none, encoded as `kind as u8 + 1`.
    ///
    /// A refusal cannot cross the capture ring the way a mid-stream error
    /// does: whichever route produced it — a refused open, or a refused
    /// start, which by then has already handed the ring's producer to a
    /// backend that dropped it — the producer may already be gone by the
    /// time the refusal is known. This slot needs no producer, so it is
    /// always available to store into (see `audio_thread::capture_side`).
    /// [`Self::drain_engine_events`] swaps it back to zero on every drain and
    /// turns a non-zero read into one `EngineEvent::StreamError`.
    capture_refusal: Arc<AtomicU8>,
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
        let (transport_position_tx, transport_position_reader) = transport_position_channel();
        let (master_meter_tx, master_meter_reader) = master_meter_channel();
        let (engine_event_tx, engine_event_rx) = engine_event_channel();
        let (capture_event_tx, capture_event_rx) = engine_event_channel();
        let spawned = spawn_audio_thread_with_diagnostics(
            rx,
            diagnostics_tx,
            timeline_diagnostics_tx,
            graph_progress_tx,
            transport_position_tx,
            master_meter_tx,
            engine_event_tx,
            // The engine opens the default input device when it starts, the
            // way Logic, Live and Cubase do — not later, when a recorder is
            // created. The packaged app carries `NSMicrophoneUsageDescription`,
            // so this is the one moment the OS asks the musician for
            // microphone access. Handing an event ring over here is the whole
            // of asking for capture.
            //
            // A refused or absent input never fails engine start — capture is
            // additive (see `audio_thread::capture_beside`) — so a refusal is
            // a logged line plus an `Input`-side `EngineEvent`, and the
            // engine runs without capture. The event does not cross the ring
            // a mid-stream error would: a refusal can still be discovered
            // after `open.start` has already handed this producer to a
            // backend that goes on to drop it, so `capture_side` instead
            // stores the refused kind into a slot this handle also carries
            // (`capture_refusal`), and `Self::drain_engine_events` is what
            // turns that stored kind into the one reported `EngineEvent`. The
            // open shares the output's startup timeout and its one fallback
            // attempt (`spawn_with_fallback`, above): an input device whose
            // open hangs fails the whole engine start exactly as a hung
            // output would, and there is no in-session engine restart that
            // could reopen it later. A hung input open strands the owner
            // thread that already started this output stream — `open.start`
            // returned before this input open began, so the stream is live,
            // but the factory building it is now blocked past the point the
            // startup timeout gives up on it — and the fallback attempt then
            // opens a second output stream on the same device, on a fresh
            // owner thread, while the first stays stranded. Both render an
            // empty graph, so nothing is audible either way, but two output
            // streams exist on the device for as long as the hang lasts: the
            // stranded thread's factory call only returns once the input
            // open resolves, at which point it drops its own stream unheard,
            // because nothing is still waiting on its readiness. On macOS a
            // denied microphone permission does not surface as a refusal at
            // all — CoreAudio opens the stream and delivers silence in place
            // of real input rather than an error, so a denial reads as
            // capture that opened but never carries audio.
            Some(capture_event_tx),
            force_default_buffer,
        )?;

        Ok(Self {
            command_tx: tx,
            retired_adoption_tx: spawned.retired_adoption_tx,
            _audio_thread: spawned.handle,
            next_plugin_id: 1000, // Start high to avoid collision with effect IDs
            effect_registrations: 0,
            // The zero baseline is exact: the diagnostics pair this handle
            // reads is built in this same `spawn` call, and both its ends
            // start from a zeroed snapshot.
            reconciled_effect_id_collisions: 0,
            capture_consumers: Vec::with_capacity(CRUMBS_CAPTURE_RESERVE),
            midi_rt_diagnostics: diagnostics_reader,
            timeline_rt_diagnostics: timeline_diagnostics_reader,
            graph_progress: graph_progress_reader,
            transport_position: transport_position_reader,
            master_meter: master_meter_reader,
            engine_events: engine_event_rx,
            capture_events: capture_event_rx,
            sample_rate: spawned.sample_rate,
            input_latency_frames: spawned.input_latency_frames,
            capture_refusal: spawned.capture_refusal,
        })
    }

    /// The sample rate the running stream renders at.
    pub const fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    /// Frames of latency the capture path is currently adding — the block the
    /// input device delivers plus the depth its ring settled at — or zero
    /// while capture is not serving.
    ///
    /// Zero means there is no figure, never that there is no delay. It reads
    /// zero when this engine opened no input stream, and it also reads zero
    /// after an open until the ring has filled to its settled depth, after a
    /// stall until it resettles, and while it refills after a block or a
    /// render callback larger than any since the last stall. The figure cannot
    /// be published at open, because it follows the block size the device
    /// turns out to deliver and the slice the render callback turns out to ask
    /// for; the reader writes it each time it settles on a cadence, against a
    /// depth it has just observed, and retracts it whenever it stops serving.
    ///
    /// A recording host offsets a take by this plus the output latency, the
    /// way Logic, Live and Reaper do: what the player hears and where the
    /// take is written are two quantities, and only the second one is this. A
    /// host must therefore wait for a non-zero reading before it trusts one,
    /// rather than compensating a take by zero.
    pub fn input_latency_frames(&self) -> usize {
        self.input_latency_frames.load(Ordering::Relaxed)
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
        self.send_graph_batch_with_headroom(ops, 0)
    }

    /// [`Self::send_graph_batch`], leaving `headroom` slots free behind the
    /// batch for pushes the caller makes immediately afterwards.
    ///
    /// A batch sizes the ring to exactly itself — fence plus body — and then
    /// fills every slot of it, so the next single push onto a ring this batch
    /// provisioned is refused as "queue full" whatever it is. That is a real
    /// outcome, not a theoretical one: the boot ring holds 256, so any batch
    /// from about sixty tracks upwards lands exactly full, and the graph
    /// apply's own follow-up push — the dormant plugin an engine start takes
    /// over — is refused on precisely the projects large enough for a musician
    /// to notice the plugin going silent.
    ///
    /// Reserving is the caller's to ask for, because only the caller knows how
    /// many pushes it is about to make. The reservation changes the provision
    /// arithmetic and nothing else: the batch still pushes fence plus body, so
    /// a caller that asks for headroom it does not use has only made the ring
    /// slightly larger.
    pub fn send_graph_batch_with_headroom(
        &mut self,
        ops: Vec<GraphCommand>,
        headroom: usize,
    ) -> Result<(), GraphBatchError> {
        // Effect-table admission comes before the ring is provisioned, so a
        // batch that cannot fit the shared table never reallocates a channel
        // to carry commands that will be refused one at a time on the way in.
        self.admit_effect_registrations(&ops)
            .map_err(GraphBatchError::Refused)?;
        self.admit_capture_registrations(&ops)
            .map_err(GraphBatchError::Refused)?;

        // The fence occupies a slot of its own alongside the body, and the
        // caller's reservation sits behind both.
        let needed = ops.len() + 1 + headroom;
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

    /// Read the latest fixed numeric MIDI diagnostics outside the audio
    /// callback.
    ///
    /// Reading is also the effect-table ledger's reconciliation point: each
    /// observation returns to [`Self::effect_registrations`] the slots whose
    /// registrations the callback refused since the last one. See
    /// [`Self::return_refused_effect_slots`] for why the diagnostics read is
    /// the seam.
    pub fn midi_rt_diagnostics_snapshot(&mut self) -> ActiveMidiRtDiagnosticsSnapshot {
        let snapshot = self.midi_rt_diagnostics.snapshot();
        self.return_refused_effect_slots(snapshot.effect_id_collisions);
        snapshot
    }

    /// Return to the ledger the slots whose registrations the callback
    /// refused on id collision, by diffing the cumulative
    /// `effect_id_collisions` counter against the part of it whose slots have
    /// already been returned.
    ///
    /// Why the diagnostics read is the seam and not a message from the
    /// callback: the command ring runs control → audio, so it cannot carry a
    /// correction for control-side state, while the diagnostics triple buffer
    /// already runs audio → control and the render callback publishes it
    /// every block.
    ///
    /// Every collision the callback counts was a registration that crossed
    /// [`Self::push`] and incremented the ledger first — only this handle
    /// pushes — so the diff is exact and the ledger returns to the table
    /// population the callback actually holds. The subtraction saturates
    /// anyway: a count the ledger cannot answer can only come from a counter
    /// that drifted, and clamping at zero merely over-grants headroom the
    /// control side re-refuses on the next observation, where a wrap would
    /// grant it out of nothing.
    ///
    /// The baseline of zero at construction misses no refusal: the channel
    /// pair is built in the same spawn as the scheduler that publishes into
    /// it, both ends start zeroed, and one handle owns one pair — a second
    /// handle is a second engine with its own scheduler and its own
    /// collisions.
    fn return_refused_effect_slots(&mut self, effect_id_collisions: u64) {
        let refused = effect_id_collisions.saturating_sub(self.reconciled_effect_id_collisions);
        if refused == 0 {
            return;
        }
        self.reconciled_effect_id_collisions =
            self.reconciled_effect_id_collisions.saturating_add(refused);
        self.effect_registrations = self
            .effect_registrations
            .saturating_sub(usize::try_from(refused).unwrap_or(usize::MAX));
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

    /// Read where the transport stands, outside the callback.
    ///
    /// Deliberately its own channel rather than a second reading of
    /// [`Self::graph_progress_snapshot`]: that one is the queue ledger's
    /// release evidence and its meaning is a happens-before, not a position a
    /// cursor may draw. Reading it at UI rate would tie the ledger's contract
    /// to the cursor's refresh rate.
    ///
    /// The snapshot may lag by up to one callback, which is what a cursor
    /// wants: it is the last position the engine actually rendered, never a
    /// position it predicts.
    pub fn transport_position_snapshot(&mut self) -> TransportPositionSnapshot {
        self.transport_position.snapshot()
    }

    /// Read what the engine's master output measured, outside the callback.
    ///
    /// Its own channel rather than a field on the transport snapshot, for the
    /// reason [`MasterMeterSnapshot`] gives: a level makes none of the
    /// happens-before claims the position's fields make, and pairing it with
    /// them would say it did.
    ///
    /// The peak is already held at the engine, so a poll at UI rate reads the
    /// loudest thing the device was handed inside the hold window rather than
    /// whichever callback the poll happened to land after.
    pub fn master_meter_snapshot(&mut self) -> MasterMeterSnapshot {
        self.master_meter.snapshot()
    }

    /// Take every engine event published since the last drain, output-side
    /// ring events, then input-side ring events, then a capture refusal if
    /// one is waiting.
    ///
    /// Consuming, not peeking: an event reported once is reported once. This
    /// runs on the control side, never in the audio callback, so allocating the
    /// `Vec` here — and draining two rings into it — is safe. Two rings
    /// because the output and input backends run their error callbacks on
    /// different threads and `EngineEvent`'s ring is SPSC (see
    /// `audio_thread::capture_beside`).
    ///
    /// A capture refusal is not on either ring: it is read from
    /// `capture_refusal`, the slot `audio_thread::capture_side` stores into
    /// because a refusal can be discovered after the ring's own producer is
    /// already gone. The swap both clears the slot and reads it atomically,
    /// so a refusal is turned into exactly one trailing `StreamError` on the
    /// first drain after it is stored, and every later drain sees zero.
    pub fn drain_engine_events(&mut self) -> Vec<EngineEvent> {
        let mut events = engine_events::drain_engine_events(&mut self.engine_events);
        events.extend(engine_events::drain_engine_events(&mut self.capture_events));

        let refusal = self.capture_refusal.swap(0, Ordering::Relaxed);
        if let Some(kind) = StreamErrorKind::from_slot(refusal) {
            events.push(EngineEvent::StreamError {
                side: StreamSide::Input,
                kind,
            });
        }

        events
    }

    /// Add a built-in effect to the native rendering graph.
    ///
    /// The type name resolves to a fixed-size address here, on the control
    /// side: the command that crosses the ring may not carry a heap allocation
    /// onto the audio thread (ADR 0020), so an unknown name is refused where
    /// it can be reported rather than counted on the callback after the fact.
    ///
    /// The instance itself is also built here, on the same contract as the
    /// `Box<dyn NativePlugin>` that [`Self::add_plugin`] carries: the audio
    /// thread that applies the command installs or retires it and never
    /// constructs one (`KneadEngine::new` performs its heap allocations on
    /// this thread instead). It is built against `self.sample_rate` — the
    /// rate the stream that this handle commands actually opened at — and
    /// that rate cannot be stale or missing: an `EngineHandle` exists only
    /// after the stream build reported it, so there is no handle to call this
    /// on before the negotiation, exactly as there is no handle to push an
    /// `AddPlugin` onto before one exists.
    pub fn add_effect(&mut self, id: usize, plugin_type: &str) -> Result<(), String> {
        let plugin_type = BuiltinEffectType::from_name(plugin_type)
            .ok_or_else(|| format!("unknown built-in effect type '{plugin_type}'"))?;
        self.push(GraphCommand::AddEffect(
            id,
            PluginCore::builtin(plugin_type, self.sample_rate),
        ))
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
    /// processing: the signal passes through the device's own latency, and
    /// MIDI queued while bypassed is discarded rather than banked into a burst
    /// of stale note-ons at the moment it is re-enabled.
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
    ///
    /// No note store: this route registers a device that transforms a signal
    /// rather than one that plays notes. An instrument arrives through
    /// [`Self::add_hosted_plugin`], or over a batch that ships its own store.
    pub fn add_plugin_with_id(
        &mut self,
        id: usize,
        plugin: Box<dyn NativePlugin>,
    ) -> Result<(), String> {
        self.push(GraphCommand::AddPlugin(id, plugin, None))
    }

    /// Register a hosted plugin instance, homed detached.
    ///
    /// A hosted instance belongs to the load that created it, not to the
    /// master insert chain: homed there it would render the whole mix through
    /// the instance the moment a user took it off a strip. Homing it detached
    /// means releasing it from a chain returns it to a placement that runs
    /// nowhere.
    ///
    /// The note store travels with the registration, built here because the
    /// audio thread may not allocate one: a hosted instrument that arrived
    /// without one could never be scheduled against.
    pub fn add_hosted_plugin(
        &mut self,
        id: usize,
        plugin: Box<dyn NativePlugin>,
    ) -> Result<(), String> {
        self.push(GraphCommand::AddHostedPlugin(
            id,
            plugin,
            MidiNoteStore::new(),
        ))
    }

    /// Remove a native plugin from the audio thread.
    pub fn remove_plugin(&mut self, id: usize) -> Result<(), String> {
        self.push(GraphCommand::RemovePlugin(id))
    }

    /// State how many frames a registered device delays its own output by, so
    /// the graph compensates every route that device sits on.
    ///
    /// The dry line the device runs while bypassed is built here, against the
    /// declared figure, because the audio thread may not allocate one.
    pub fn set_effect_latency(
        &mut self,
        effect_id: usize,
        latency_frames: usize,
    ) -> Result<(), String> {
        self.push(GraphCommand::SetEffectLatency {
            effect_id,
            latency_frames,
            dry_delay: CompensationDelay::for_latency(latency_frames),
        })
    }

    /// Feed a native plugin the audio the input device captures, block by
    /// block, alongside the graph audio it already renders.
    ///
    /// Refused before the command crosses the ring — by [`Self::push`], which
    /// holds the ceiling for every route onto it — when the bus is full or
    /// already carries this id. The callback refuses on the same two
    /// conditions but can only count its refusal, and a consumer that was
    /// never registered is indistinguishable from one whose input is silent.
    ///
    /// The plugin need not be on the graph yet. One batch may carry the
    /// registration ahead of the `AddPlugin` that answers it, and until the id
    /// resolves the callback skips it.
    pub fn register_capture_consumer(&mut self, plugin_id: usize) -> Result<(), String> {
        self.push(GraphCommand::RegisterCaptureConsumer(plugin_id))
    }

    /// Stop feeding a native plugin the captured input.
    ///
    /// The ledger slot comes back only if the command reaches the ring: a
    /// failed push leaves the callback still feeding that consumer, and a
    /// ledger that freed the slot anyway would admit a registration the
    /// callback then refuses where nobody can hear it.
    pub fn unregister_capture_consumer(&mut self, plugin_id: usize) -> Result<(), String> {
        self.push(GraphCommand::UnregisterCaptureConsumer(plugin_id))
    }

    /// Take an id off the capture ledger, wherever it leaves the bus from.
    fn prune_capture_consumer(&mut self, plugin_id: usize) {
        if let Some(slot) = self
            .capture_consumers
            .iter()
            .position(|held| *held == plugin_id)
        {
            self.capture_consumers.swap_remove(slot);
        }
    }

    /// Send a MIDI note event to a specific plugin (lock-free).
    ///
    /// The live path: the note reaches the plugin at the head of the next
    /// block it is handed. A note that has a timeline position of its own goes
    /// through [`Self::schedule_midi_notes`], which delivers it on the sample
    /// that renders that position.
    pub fn send_midi_note(
        &mut self,
        plugin_id: usize,
        event: plugin_slot::MidiNoteEvent,
    ) -> Result<(), String> {
        self.push(GraphCommand::SendMidiNote(plugin_id, event))
    }

    /// Write timeline-addressed notes into an instrument's note store.
    ///
    /// The batch is boxed here, on the control thread, because the audio
    /// thread that copies it into the store may neither allocate nor free
    /// (ADR 0020). It lands whole or not at all: a plugin registered without a
    /// store, or a batch past that store's free capacity, is refused on the
    /// callback and counted in
    /// [`ActiveMidiRtDiagnosticsSnapshot::midi_note_batches_refused`], because
    /// only the callback knows what the store is already holding.
    pub fn schedule_midi_notes(
        &mut self,
        plugin_id: usize,
        notes: Box<[TimedMidiNote]>,
    ) -> Result<(), String> {
        self.push(GraphCommand::ScheduleMidiNotes { plugin_id, notes })
    }

    /// Drop an instrument's scheduled notes in the half-open frame window
    /// `from_frame..to_frame`; `0..u64::MAX` clears the store.
    pub fn clear_midi_notes(
        &mut self,
        plugin_id: usize,
        from_frame: u64,
        to_frame: u64,
    ) -> Result<(), String> {
        self.push(GraphCommand::ClearMidiNotes {
            plugin_id,
            from_frame,
            to_frame,
        })
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
    ///
    /// The line that holds a generator to the depth of the strip's input is
    /// built here, on the control thread, because the audio thread may not
    /// allocate one.
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
            hold: entry.input_hold(),
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
    /// reverb or delay a send bus exists to host, or the instrument a bus
    /// holds on the same terms a track does, input hold included.
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
            hold: entry.input_hold(),
        })
    }

    pub fn remove_bus_device(&mut self, bus_id: usize, effect_id: usize) -> Result<(), String> {
        self.push(GraphCommand::RemoveBusDevice { bus_id, effect_id })
    }

    /// Add a send from a track to a bus at the given tap.
    ///
    /// The send's compensation delay is built here, on the control thread,
    /// because the audio thread may not allocate one.
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
            delay: Box::new(CompensationDelay::new(MAX_COMPENSATION_FRAMES)),
        })
    }

    pub fn remove_send(&mut self, track_id: usize, bus_id: usize) -> Result<(), String> {
        self.push(GraphCommand::RemoveSend { track_id, bus_id })
    }

    /// Add a bus. A bus may feed the master, another bus, or a track.
    pub fn add_bus(&mut self, id: usize) -> Result<(), String> {
        self.push(GraphCommand::AddBus(TimelineBus::new(id)))
    }

    pub fn remove_bus(&mut self, id: usize) -> Result<(), String> {
        self.push(GraphCommand::RemoveBus(id))
    }

    pub fn set_bus_output(&mut self, id: usize, target: RouteTarget) -> Result<(), String> {
        self.push(GraphCommand::SetBusOutput(id, target))
    }

    /// Mute a bus. The mute sits after the fader and before the panner, the
    /// same place it sits on a track.
    pub fn set_bus_mute(&mut self, id: usize, muted: bool) -> Result<(), String> {
        self.push(GraphCommand::SetBusMute(id, muted))
    }

    /// Close or open a bus's pre-fader solo gate — the same law as
    /// [`EngineHandle::set_track_solo_gate`].
    pub fn set_bus_solo_gate(&mut self, id: usize, gated: bool) -> Result<(), String> {
        self.push(GraphCommand::SetBusSoloGate(id, gated))
    }

    /// Place a clip on a track. `right` may be empty for mono material, which
    /// plays to both outputs. The channels are shared source material and are
    /// never written to again: an edit moves the placement instead, and every
    /// other clip cut from the same take holds this same allocation.
    pub fn add_clip(
        &mut self,
        track_id: usize,
        clip_id: usize,
        left: Arc<[f32]>,
        right: Arc<[f32]>,
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
            param: DeviceParamTarget::Builtin(param),
            value: f64::from(value),
            at_frame,
        })
    }

    /// How many of the scheduler's effect-table slots this handle's ledger
    /// counts — a prediction reconciled against the callback's refusals. See
    /// [`EngineHandle::effect_registrations`].
    pub const fn registered_effect_count(&self) -> usize {
        self.effect_registrations
    }

    /// Refuse now if the shared effect table has no room for `additional`
    /// more registrations.
    ///
    /// A producer that has other state to set up — a plugin instance to keep
    /// in a side map — calls this *before* it
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

    /// Walk `ops` the same way and refuse the batch if it would put the input
    /// bus past its reserve, or register an id the bus already carries.
    ///
    /// `GraphCommand` and [`EngineHandle::send_graph_batch`] are both public,
    /// so a batch is a second door onto the bus beside
    /// [`EngineHandle::register_capture_consumer`]. This walk exists for the
    /// same reason [`EngineHandle::admit_effect_registrations`] does: whole-batch
    /// admission, so a batch that would overflow the bus partway through is
    /// refused whole by [`EngineHandle::send_graph_batch`] rather than
    /// reported as [`GraphBatchError::Partial`] once some of it already
    /// reached the ring.
    ///
    /// Order matters and netting does not, for the reason given on
    /// [`EngineHandle::admit_effect_registrations`]; the walk carries the
    /// batch's own unregistrations and removals so a batch that frees a slot
    /// before reusing it is admitted, exactly as the callback will apply it.
    fn admit_capture_registrations(&self, ops: &[GraphCommand]) -> Result<(), String> {
        let mut held = self.capture_consumers.clone();
        for op in ops {
            match capture_ledger_effect(op) {
                Some(CaptureLedgerEffect::Register(id)) => {
                    if held.contains(&id) {
                        return Err(capture_consumer_registered_error(id));
                    }
                    if held.len() >= CRUMBS_CAPTURE_RESERVE {
                        return Err(capture_bus_full_error());
                    }
                    held.push(id);
                }
                Some(CaptureLedgerEffect::Release(id)) => {
                    if let Some(slot) = held.iter().position(|current| *current == id) {
                        held.swap_remove(slot);
                    }
                }
                None => {}
            }
        }
        Ok(())
    }

    /// The one route onto the command ring, and with it the one place the
    /// effect-table ledger and the capture ledger are kept.
    ///
    /// Both ceilings are enforced here rather than pushed past — the effect
    /// table's and the input bus's. The audio thread's own refusal is a counter
    /// it cannot return to anyone, so past this point the instance is loaded,
    /// reports success, and passes dry audio forever with nothing saying it was
    /// refused.
    ///
    /// [`Self::send_graph_batch`] admits both ledgers whole before it pushes
    /// anything, so a batch that would overflow either one is refused whole
    /// rather than reported as [`GraphBatchError::Partial`] after part of it
    /// already crossed the ring. The effect-table pre-check belongs to the
    /// caller that builds other state before it pushes — a plugin instance —
    /// not to the typed method: [`Self::ensure_effect_table_headroom`] has to
    /// run before that id and that instance exist, so `commands/plugins.rs` is
    /// the route that calls it today, ahead of [`Self::reserve_plugin_id`].
    /// [`Self::add_plugin_with_id`] and
    /// [`Self::add_hosted_plugin`] push straight through with no check
    /// of their own, exactly as [`Self::register_capture_consumer`] does;
    /// all three rely on this push as the ceiling, regardless of whether a
    /// caller checked first.
    fn push(&mut self, command: GraphCommand) -> Result<(), String> {
        let delta = command.effect_table_delta();
        if delta > 0 && self.effect_registrations + delta as usize > EFFECT_TABLE_CAPACITY {
            return Err(effect_table_full_error());
        }
        // Read before the command is moved onto the ring, applied only once it
        // is: both ledgers follow what actually crossed. Every route onto the
        // ring passes here, including `send_graph_batch`, so a batch cannot
        // move the callback's bus without the ledger seeing it.
        let capture_effect = capture_ledger_effect(&command);
        if let Some(CaptureLedgerEffect::Register(id)) = capture_effect {
            if self.capture_consumers.contains(&id) {
                return Err(capture_consumer_registered_error(id));
            }
            if self.capture_consumers.len() >= CRUMBS_CAPTURE_RESERVE {
                return Err(capture_bus_full_error());
            }
        }
        self.command_tx
            .push(command)
            .map_err(|_| "Audio command queue full".to_string())?;
        match capture_effect {
            // The refusals above proved the id absent and the reserve unspent,
            // so this never duplicates an entry nor grows past the capacity
            // the vector was built with.
            Some(CaptureLedgerEffect::Register(id)) => self.capture_consumers.push(id),
            Some(CaptureLedgerEffect::Release(id)) => self.prune_capture_consumer(id),
            None => {}
        }
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

/// The effect a command finally drops, if it drops one.
///
/// These are exactly the commands [`GraphCommand::effect_table_delta`] scores
/// `-1`: the ones whose target the scheduler removes from the effect table
/// rather than merely detaching, and so the ones whose target it also prunes
/// off the input bus. The control-side capture ledger tracks that set, because
/// an id left on it after its plugin went would refuse a later registration
/// the callback would have taken.
fn final_dropped_effect_id(command: &GraphCommand) -> Option<usize> {
    match command {
        GraphCommand::RemovePlugin(id) => Some(*id),
        GraphCommand::RemoveTrackDeviceRetired { effect_id, .. }
        | GraphCommand::RemoveBusDeviceRetired { effect_id, .. } => Some(*effect_id),
        _ => None,
    }
}

/// What a command does to the capture ledger once it reaches the ring.
enum CaptureLedgerEffect {
    Register(usize),
    Release(usize),
}

/// Classify a command for the capture ledger.
///
/// One classifier, read twice: [`EngineHandle::push`] applies it to what
/// crossed, and [`EngineHandle::admit_capture_registrations`] replays it over a
/// batch before any of it does. A command that moves the callback's bus and is
/// missing here moves it behind the ledger's back, which is the whole failure
/// this classification exists to prevent.
fn capture_ledger_effect(command: &GraphCommand) -> Option<CaptureLedgerEffect> {
    match command {
        GraphCommand::RegisterCaptureConsumer(id) => Some(CaptureLedgerEffect::Register(*id)),
        GraphCommand::UnregisterCaptureConsumer(id) => Some(CaptureLedgerEffect::Release(*id)),
        other => final_dropped_effect_id(other).map(CaptureLedgerEffect::Release),
    }
}

/// The one wording for a refusal against the engine's input tap, so the control
/// ledger and any later producer report the same ceiling.
fn capture_bus_full_error() -> String {
    format!(
        "capture-bus-full: the engine's captured input already feeds its maximum of \
         {CRUMBS_CAPTURE_RESERVE} consumers"
    )
}

/// The one wording for an id the input tap already carries, so the typed path
/// and the batch path report a duplicate the same way.
fn capture_consumer_registered_error(plugin_id: usize) -> String {
    format!(
        "capture-consumer-registered: plugin {plugin_id} already receives the engine's captured \
         input"
    )
}

/// Assemble a fixture `EngineHandle` around channel ends a caller already
/// built.
///
/// The test constructors below — this module's and `mod tests`'s — differ
/// only in which ends of which channels they keep live and which they let
/// drop; the struct literal itself never varies, so it is written once here
/// rather than once per caller. Every reader and consumer is required rather
/// than defaulted, so a caller wanting one dropped still has to build the
/// pair and drop its other half explicitly — the same
/// `let (_tx, rx) = channel();` pattern every call site already used before
/// this was extracted. `capture_refusal` is likewise taken as a parameter
/// rather than built internally: a caller driving `drain_engine_events`
/// against a preset refusal needs to hold the same slot this handle reads.
#[cfg(any(test, feature = "command-capture-fixture"))]
#[allow(clippy::too_many_arguments)]
fn engine_handle_fixture(
    command_tx: Producer<GraphCommand>,
    retired_adoption_tx: Sender<Consumer<RetiredGraphObjects>>,
    midi_rt_diagnostics: ActiveMidiRtDiagnosticsReader,
    timeline_rt_diagnostics: TimelineRtDiagnosticsReader,
    graph_progress: GraphProgressReader,
    transport_position: TransportPositionReader,
    master_meter: MasterMeterReader,
    engine_events: Consumer<EngineEvent>,
    capture_events: Consumer<EngineEvent>,
    capture_refusal: Arc<AtomicU8>,
) -> EngineHandle {
    EngineHandle {
        command_tx,
        retired_adoption_tx,
        _audio_thread: audio_thread::detached_audio_thread_handle(),
        next_plugin_id: 1000,
        effect_registrations: 0,
        reconciled_effect_id_collisions: 0,
        capture_consumers: Vec::with_capacity(CRUMBS_CAPTURE_RESERVE),
        midi_rt_diagnostics,
        timeline_rt_diagnostics,
        graph_progress,
        transport_position,
        master_meter,
        engine_events,
        capture_events,
        sample_rate: 48_000.0,
        input_latency_frames: audio_thread::new_input_latency_slot(),
        capture_refusal,
    }
}

/// Build a handle whose commands land in the returned consumer.
///
/// The audio thread is the only thing an `EngineHandle` cannot have in a test —
/// it needs a real output device — and it is also the only part a command test
/// does not exercise: a command's whole journey is the ring between this handle
/// and [`scheduler::AudioScheduler`], which a test can drive directly.
#[cfg(any(test, feature = "command-capture-fixture"))]
pub fn engine_handle_for_command_capture(
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
    let (_transport_position_tx, transport_position_reader) = transport_position_channel();
    let (_master_meter_tx, master_meter_reader) = master_meter_channel();
    let (_engine_event_tx, engine_event_rx) = engine_event_channel();
    let (_capture_event_tx, capture_event_rx) = engine_event_channel();
    let (retired_adoption_tx, retired_adoption_rx) = std::sync::mpsc::channel();

    (
        engine_handle_fixture(
            command_tx,
            retired_adoption_tx,
            diagnostics_reader,
            timeline_diagnostics_reader,
            graph_progress_reader,
            transport_position_reader,
            master_meter_reader,
            engine_event_rx,
            capture_event_rx,
            audio_thread::new_capture_refusal_slot(),
        ),
        command_rx,
        retired_adoption_rx,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        engine_handle_fixture, engine_handle_for_command_capture, spawn_with_fallback,
        GraphBatchError, CRUMBS_CAPTURE_RESERVE, EFFECT_TABLE_CAPACITY,
    };
    use crate::engine_events::{engine_event_channel, EngineEvent, StreamErrorKind, StreamSide};
    use crate::midi::diagnostics::{
        active_midi_rt_diagnostics_channel, ActiveMidiRtDiagnosticsSnapshot,
    };
    use crate::plugin_slot::NativePlugin;
    use crate::scheduler::{
        graph_progress_channel, master_meter_channel, transport_position_channel, AudioScheduler,
        BuiltinEffectType, GraphCommand, PluginCore,
    };
    use crate::timeline::timeline_rt_diagnostics_channel;
    use crate::timeline::{ChainEntry, DeviceKind, DeviceParam, TimelineTrack};
    use crate::EngineHandle;
    use rtrb::{Consumer, Producer, RingBuffer};
    use std::any::Any;
    use std::cell::RefCell;
    use triple_buffer::Input;

    /// The pre-built instance a detached-effect batch carries, built here on
    /// the control side exactly as [`crate::EngineHandle::add_effect`] builds
    /// its own — the rate below is the one the capture handle reports.
    fn knead_instance() -> PluginCore {
        PluginCore::builtin(BuiltinEffectType::Knead, 48_000.0)
    }

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
    fn set_bypass_reaches_the_scheduler_and_leaves_the_block_untouched() {
        let (mut engine, command_rx, _retired_adoption_rx) = engine_handle_for_command_capture(16);
        let (retired_tx, _retired_rx) = RingBuffer::new(16);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);

        engine
            .add_plugin_with_id(42, Box::new(OverwritingPlugin))
            .expect("the plugin should reach the graph");
        engine
            .set_bypass(42, true)
            .expect("the bypass should reach the graph");
        scheduler.update_graph();

        let mut left = [0.5f32; 4];
        let mut right = [0.5f32; 4];
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(
            &left, &[0.5; 4],
            "a bypassed plugin must not process the block"
        );

        // And the toggle is a toggle: releasing bypass puts the same instance
        // back on the signal path without reloading it.
        engine
            .set_bypass(42, false)
            .expect("the bypass release should reach the graph");
        scheduler.update_graph();

        let mut left = [0.5f32; 4];
        let mut right = [0.5f32; 4];
        scheduler.process_block(&mut left, &mut right, 4);
        assert_eq!(&left, &[0.25; 4]);
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

    /// A batch sizes the ring to exactly itself and then fills it, so the next
    /// single push onto that ring is refused however small it is. A caller with
    /// a push of its own to make immediately afterwards — the graph apply, which
    /// hands the engine every plugin loaded before it started — asks for the
    /// slot up front, and the reservation is provisioned rather than pushed.
    #[test]
    fn a_batch_leaves_the_headroom_its_caller_reserved() {
        let boot_capacity = 256;
        let (mut engine, _command_rx, _retired_adoption_rx) =
            engine_handle_for_command_capture(boot_capacity);

        // Fence plus body is exactly the boot ring: without a reservation this
        // batch fits without provisioning and leaves nothing behind it.
        let ops: Vec<GraphCommand> = (0..255usize)
            .map(|id| GraphCommand::AddTrack(TimelineTrack::new(id)))
            .collect();
        assert_eq!(ops.len() + 1, boot_capacity);

        engine
            .send_graph_batch_with_headroom(ops, 1)
            .expect("capacity must be provisioned, not refused");

        assert!(
            engine.command_tx.slots() >= 1,
            "the caller's reserved slot must survive the batch, got {}",
            engine.command_tx.slots()
        );
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

        // The known names still do — carrying the instance the control side
        // built, for the scheduler to install rather than construct.
        engine
            .add_effect(7, "knead")
            .expect("knead is a built-in type");
        engine
            .set_effect_param(7, "shift_semitones", 3.0)
            .expect("shift_semitones is a knead parameter");
        assert!(matches!(
            command_rx.pop(),
            Ok(GraphCommand::AddEffect(id, PluginCore::Knead(_))) if id == 7
        ));
        assert!(matches!(
            command_rx.pop(),
            Ok(GraphCommand::SetParam(id, DeviceParam::ShiftSemitones, value))
                if id == 7 && value == 3.0
        ));
    }

    /// The input tap's ceiling is enforced where the caller hears it. The
    /// callback refuses on the same two conditions, but all it can do is count
    /// the refusal: past that point a consumer that was never registered is
    /// indistinguishable from one whose input happens to be silent.
    #[test]
    fn a_capture_consumer_past_the_reserve_or_already_on_the_bus_refuses_before_the_ring() {
        let (mut engine, command_rx, _retired_adoption_rx) = engine_handle_for_command_capture(16);

        for id in 0..CRUMBS_CAPTURE_RESERVE {
            engine
                .register_capture_consumer(id)
                .expect("the reserve admits this one");
        }
        let admitted = command_rx.slots();

        let full = engine
            .register_capture_consumer(CRUMBS_CAPTURE_RESERVE)
            .expect_err("the bus is full");
        let duplicate = engine
            .register_capture_consumer(0)
            .expect_err("the bus already holds this id");

        assert!(full.starts_with("capture-bus-full:"), "{full}");
        assert!(
            duplicate.starts_with("capture-consumer-registered:"),
            "{duplicate}"
        );
        assert_eq!(
            command_rx.slots(),
            admitted,
            "a refused registration must not cross the ring"
        );
    }

    #[test]
    fn unregistering_a_capture_consumer_frees_the_ledger_slot_it_held() {
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            engine_handle_for_command_capture(16);

        for id in 0..CRUMBS_CAPTURE_RESERVE {
            engine
                .register_capture_consumer(id)
                .expect("the reserve admits this one");
        }
        engine
            .unregister_capture_consumer(0)
            .expect("an id on the bus comes off it");
        engine
            .register_capture_consumer(CRUMBS_CAPTURE_RESERVE)
            .expect("the freed slot takes the next consumer");

        let mut sent = Vec::new();
        while let Ok(command) = command_rx.pop() {
            match command {
                GraphCommand::RegisterCaptureConsumer(id) => sent.push((true, id)),
                GraphCommand::UnregisterCaptureConsumer(id) => sent.push((false, id)),
                _ => panic!("the bus methods push nothing else onto the ring"),
            }
        }

        // In order and complete: the callback keeps its own bus by replaying
        // exactly this sequence, so a ledger that agreed only on counts would
        // still leave the two holding different ids.
        let mut expected: Vec<(bool, usize)> =
            (0..CRUMBS_CAPTURE_RESERVE).map(|id| (true, id)).collect();
        expected.push((false, 0));
        expected.push((true, CRUMBS_CAPTURE_RESERVE));
        assert_eq!(sent, expected);
    }

    /// Removing a plugin takes it off the bus on the callback, so the ledger
    /// that guards the bus has to let it go too. A ledger that did not would
    /// refuse the id for the life of the session, on behalf of a consumer the
    /// callback stopped feeding the moment the removal drained.
    #[test]
    fn removing_a_plugin_frees_the_capture_ledger_slot_its_consumer_held() {
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            engine_handle_for_command_capture(16);

        engine
            .register_capture_consumer(7)
            .expect("an empty bus takes the first consumer");
        engine.remove_plugin(7).expect("the plugin comes off");
        engine
            .register_capture_consumer(7)
            .expect("the removal freed the id, so it registers again");

        assert!(matches!(
            command_rx.pop(),
            Ok(GraphCommand::RegisterCaptureConsumer(7))
        ));
        assert!(matches!(
            command_rx.pop(),
            Ok(GraphCommand::RemovePlugin(7))
        ));
        assert!(matches!(
            command_rx.pop(),
            Ok(GraphCommand::RegisterCaptureConsumer(7))
        ));
    }

    /// The reserve is a running capacity, not a lifetime budget: a session
    /// that opens and closes recorders one at a time must keep working.
    #[test]
    fn the_capture_reserve_survives_a_full_cycle_of_removals() {
        let (mut engine, _command_rx, _retired_adoption_rx) = engine_handle_for_command_capture(64);

        for id in 0..=CRUMBS_CAPTURE_RESERVE {
            engine
                .register_capture_consumer(id)
                .unwrap_or_else(|error| panic!("consumer {id} should register: {error}"));
            engine
                .remove_plugin(id)
                .unwrap_or_else(|error| panic!("plugin {id} should be removable: {error}"));
        }
    }

    /// A batch is the second door onto the bus. Consumers that entered through
    /// it must occupy ledger slots, or the typed path hands out a third
    /// registration the callback silently refuses.
    #[test]
    fn consumers_registered_by_a_batch_fill_the_capture_ledger_the_typed_path_reads() {
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            engine_handle_for_command_capture(64);

        engine
            .send_graph_batch(
                (0..CRUMBS_CAPTURE_RESERVE)
                    .map(GraphCommand::RegisterCaptureConsumer)
                    .collect(),
            )
            .expect("a batch that exactly fills the reserve is admitted");
        while command_rx.pop().is_ok() {}

        let refusal = engine
            .register_capture_consumer(CRUMBS_CAPTURE_RESERVE)
            .expect_err("the batch took every slot, so the typed path has none");

        assert!(refusal.starts_with("capture-bus-full:"), "{refusal}");
        assert_eq!(
            command_rx.slots(),
            0,
            "a refused registration must not cross the ring"
        );
    }

    /// The batch is refused whole, before the ring is provisioned: a batch
    /// applied halfway would leave the callback holding consumers the ledger
    /// never counted.
    #[test]
    fn a_batch_that_overruns_the_capture_reserve_is_refused_before_the_ring() {
        let (mut engine, command_rx, _retired_adoption_rx) = engine_handle_for_command_capture(64);
        let untouched = command_rx.slots();

        let overrun = engine
            .send_graph_batch(
                (0..=CRUMBS_CAPTURE_RESERVE)
                    .map(GraphCommand::RegisterCaptureConsumer)
                    .collect(),
            )
            .expect_err("one registration past the reserve refuses the batch");
        assert!(
            matches!(&overrun, GraphBatchError::Refused(error) if error.starts_with("capture-bus-full:")),
            "{overrun:?}"
        );

        let duplicate = engine
            .send_graph_batch(vec![
                GraphCommand::RegisterCaptureConsumer(4),
                GraphCommand::RegisterCaptureConsumer(4),
            ])
            .expect_err("a batch may not register one id twice");
        assert!(
            matches!(&duplicate, GraphBatchError::Refused(error) if error.starts_with("capture-consumer-registered:")),
            "{duplicate:?}"
        );

        assert_eq!(
            command_rx.slots(),
            untouched,
            "a refused batch puts nothing on the ring, not even its fence"
        );
    }

    #[test]
    fn a_batch_unregistration_frees_the_capture_ledger_slot_it_held() {
        let (mut engine, _command_rx, _retired_adoption_rx) = engine_handle_for_command_capture(64);

        engine
            .send_graph_batch(
                (0..CRUMBS_CAPTURE_RESERVE)
                    .map(GraphCommand::RegisterCaptureConsumer)
                    .collect(),
            )
            .expect("a batch that exactly fills the reserve is admitted");
        engine
            .send_graph_batch(vec![GraphCommand::UnregisterCaptureConsumer(0)])
            .expect("an unregistration is always admitted");

        engine
            .register_capture_consumer(CRUMBS_CAPTURE_RESERVE)
            .expect("the freed slot takes the next consumer");
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

    /// Fill the ledger with `count` registrations the cheap way: hosted
    /// plugin boxes, one small allocation each. A fill through `add_effect`
    /// builds a real `KneadEngine` per slot — half a megabyte of buffers — so
    /// a capacity-sized fill of those is gigabytes, and the ledger counts a
    /// registration identically whichever population made it. None of the
    /// tests that fill this way read the instances back.
    fn fill_with_cheap_registrations(engine: &mut EngineHandle, count: usize) {
        for id in 0..count {
            engine
                .add_plugin_with_id(900_000 + id, Box::new(OverwritingPlugin))
                .expect("a registration inside the table's capacity must land");
        }
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
    /// Fill the table entirely, then ask for one more: the registration has
    /// to fail control-side, where `load_plugin` propagates the error to the
    /// user, and has to put nothing on the ring for the callback to refuse.
    /// The fill's population is immaterial to the ledger, so it uses the
    /// cheap plugin fill.
    #[test]
    fn a_plugin_past_the_shared_effect_table_is_refused_before_it_is_registered() {
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            engine_handle_for_command_capture(EFFECT_TABLE_CAPACITY + 8);

        fill_with_cheap_registrations(&mut engine, EFFECT_TABLE_CAPACITY);
        assert_eq!(engine.registered_effect_count(), EFFECT_TABLE_CAPACITY);

        // The pre-check a producer with state to unwind consults *before* it
        // reserves an id.
        let refused = engine
            .ensure_effect_table_headroom(1)
            .expect_err("a table filled by devices must refuse the next plugin");
        assert!(
            refused.contains(&EFFECT_TABLE_CAPACITY.to_string()),
            "the refusal must name the ceiling it hit, got: {refused}"
        );

        // And the ledger refuses the registration itself, so a producer that
        // never calls the pre-check still cannot get past the ceiling.
        let registration = engine
            .add_hosted_plugin(9_000, Box::new(OverwritingPlugin))
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

        fill_with_cheap_registrations(&mut engine, EFFECT_TABLE_CAPACITY - 1);
        engine
            .add_hosted_plugin(9_000, Box::new(OverwritingPlugin))
            .expect("the last slot takes the plugin");
        assert_eq!(engine.registered_effect_count(), EFFECT_TABLE_CAPACITY);
        assert!(engine.ensure_effect_table_headroom(1).is_err());

        engine
            .remove_plugin(9_000)
            .expect("a retirement is never refused for capacity");
        assert_eq!(engine.registered_effect_count(), EFFECT_TABLE_CAPACITY - 1);

        engine
            .add_hosted_plugin(9_001, Box::new(OverwritingPlugin))
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

        // What matters is that the table is full, not which population
        // filled it.
        fill_with_cheap_registrations(&mut engine, EFFECT_TABLE_CAPACITY);
        assert_eq!(drained(&mut command_rx), EFFECT_TABLE_CAPACITY);

        let refusal = engine
            .send_graph_batch(vec![GraphCommand::AddDetachedEffect(
                2_000_000,
                knead_instance(),
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

        fill_with_cheap_registrations(&mut engine, EFFECT_TABLE_CAPACITY - 1);
        // The retirement below has to be one the callback would really apply,
        // on both ends: `RemoveTrackDeviceRetired` frees a slot only when the
        // strip it names holds the effect it names, and the effect has to be
        // one the table really holds — the cheap fill's hosted ids never join
        // a chain, so a retirement naming one of them would free nothing on
        // the callback while the ledger still decremented, and the ordering
        // assertion would bless a stream the callback refuses. Effect 0 is
        // registered for real, then spliced onto a track, so the retirement
        // is genuine on both ends.
        engine
            .add_plugin_with_id(0, Box::new(OverwritingPlugin))
            .expect("the last slot takes the spliced effect");
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
                GraphCommand::AddDetachedEffect(2_000_000, knead_instance()),
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
                GraphCommand::AddDetachedEffect(2_000_000, knead_instance()),
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
    /// apart: registrations, placements that move an effect without
    /// registering one, the whole detach-and-release vocabulary — a chain
    /// removal and a strip removal on both the track and the bus side, each
    /// leaving the effect registered — and retirements that really free a slot
    /// because the strips they name really hold the effects they name.
    #[test]
    fn the_ledger_matches_the_scheduler_effect_table_it_counts() {
        let (mut engine, command_rx, _retired_adoption_rx) = engine_handle_for_command_capture(64);
        let (retired_tx, _retired_rx) = RingBuffer::new(64);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);

        engine.add_track(1).expect("the track registers");
        engine.add_bus(50).expect("the bus registers");
        // Two strips that exist to be removed with a device still on them.
        engine.add_track(2).expect("the track registers");
        engine.add_bus(51).expect("the bus registers");

        // Seven registrations: six built-in devices and one hosted plugin,
        // which take their slots from the same table.
        for id in 7..=12 {
            engine.add_effect(id, "knead").expect("device registers");
        }
        engine
            .add_hosted_plugin(9_000, Box::new(OverwritingPlugin))
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
        engine
            .insert_track_device(
                2,
                ChainEntry {
                    effect_id: 11,
                    kind: DeviceKind::Effect,
                },
                0,
            )
            .expect("the track splice registers");
        engine
            .insert_bus_device(
                51,
                ChainEntry {
                    effect_id: 12,
                    kind: DeviceKind::Effect,
                },
                0,
            )
            .expect("the bus splice registers");

        // The detach-and-release vocabulary, constructed directly: the graph
        // layer never sends these plain forms — its remove-device retires in
        // one command, because a removal followed by a retirement would run
        // the device over the master mix for the blocks in between. Each
        // leaves its effect registered — returned to the master chain, or
        // detached off a strip that no longer exists — so each must move
        // neither count.
        engine
            .remove_bus_device(50, 10)
            .expect("the bus chain removal registers");
        engine.remove_track(2).expect("the track removal registers");
        engine.remove_bus(51).expect("the bus removal registers");

        scheduler.update_graph();

        assert!(
            scheduler.timeline().track(2).is_none() && scheduler.timeline().bus(51).is_none(),
            "the strip removals must have applied, or the counts below observe nothing"
        );
        assert!(
            scheduler
                .timeline()
                .bus(50)
                .expect("the bus applied")
                .device_chain()
                .is_empty(),
            "the bus chain removal must have applied"
        );
        assert_eq!(
            scheduler.effect_table_len(),
            7,
            "a bus chain removal and two strip removals must free no slot"
        );
        assert_eq!(
            engine.registered_effect_count(),
            7,
            "the ledger must read all three removals as neutral"
        );

        // Effect 10 goes back onto the bus it was taken from, so the
        // retirement below lands on a strip that really holds it.
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
            5,
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

    /// The capture ledger's whole claim is that it holds the ids the
    /// callback's bus holds. Every other capture assertion in this module
    /// reads the ledger against the reserve or against itself, and the
    /// scheduler's own bus tests build their rings by hand and never involve
    /// an `EngineHandle` — so a [`capture_ledger_effect`] arm that classifies
    /// a command as neutral when the callback treats it as a release still
    /// compiles, still passes, and silently walks the two apart. Only this
    /// comparison makes an author write the right arm.
    ///
    /// The stream carries one of everything the classification has to tell
    /// apart: registrations by both doors, a removal that names the plugin
    /// directly, and the two retirements that free an effect through a strip
    /// rather than by name — each landing on a chain that really holds the
    /// effect it names, so the callback really does drop it.
    #[test]
    fn the_capture_ledger_matches_the_bus_it_claims_to_hold() {
        let (mut engine, command_rx, _retired_adoption_rx) = engine_handle_for_command_capture(64);
        let (retired_tx, _retired_rx) = RingBuffer::new(64);
        let mut scheduler = AudioScheduler::new(command_rx, retired_tx, 48_000.0);

        // Sorted, because the two sides swap-remove independently: the sets
        // are what must agree, never the order either one happens to hold.
        fn assert_agree(engine: &EngineHandle, scheduler: &AudioScheduler, step: &str) {
            let mut ledger = engine.capture_consumers.clone();
            let mut bus = scheduler.capture_consumers().to_vec();
            ledger.sort_unstable();
            bus.sort_unstable();
            assert_eq!(
                ledger, bus,
                "the ledger must hold exactly the bus it counts, after {step}"
            );
        }

        engine.add_track(1).expect("the track registers");
        engine.add_bus(50).expect("the bus registers");

        // Two plugins that will leave through a strip retirement, and one that
        // leaves by name. The reserve is smaller than that, so they cycle.
        for id in 7..=9usize {
            engine
                .add_hosted_plugin(id, Box::new(OverwritingPlugin))
                .expect("the plugin registers");
        }
        engine
            .insert_track_device(
                1,
                ChainEntry {
                    effect_id: 7,
                    kind: DeviceKind::Effect,
                },
                0,
            )
            .expect("the track splice registers");
        engine
            .insert_bus_device(
                50,
                ChainEntry {
                    effect_id: 8,
                    kind: DeviceKind::Effect,
                },
                0,
            )
            .expect("the bus splice registers");
        scheduler.update_graph();
        assert_agree(
            &engine,
            &scheduler,
            "the graph is built and nothing is on the bus",
        );

        // Door one: the typed method.
        engine
            .register_capture_consumer(7)
            .expect("an empty bus takes the first consumer");
        scheduler.update_graph();
        assert_agree(&engine, &scheduler, "a typed registration");

        // A retirement through the track chain. The handle never names the
        // plugin, so only the classification connects this to the bus.
        engine
            .send_graph_batch(vec![GraphCommand::RemoveTrackDeviceRetired {
                track_id: 1,
                effect_id: 7,
            }])
            .expect("a retirement against a chain that holds it is admitted");
        scheduler.update_graph();
        assert_eq!(
            scheduler.effect_table_len(),
            2,
            "the retirement must really free its slot, or the bus below is compared against nothing"
        );
        assert_agree(&engine, &scheduler, "a track-device retirement");

        // Door two: a batch, filling the reserve.
        engine
            .send_graph_batch(vec![
                GraphCommand::RegisterCaptureConsumer(8),
                GraphCommand::RegisterCaptureConsumer(9),
            ])
            .expect("a batch that exactly fills the reserve is admitted");
        scheduler.update_graph();
        assert_agree(&engine, &scheduler, "a batch registration");

        // A retirement through the bus chain, same argument as the track one.
        engine
            .send_graph_batch(vec![GraphCommand::RemoveBusDeviceRetired {
                bus_id: 50,
                effect_id: 8,
            }])
            .expect("a retirement against a chain that holds it is admitted");
        scheduler.update_graph();
        assert_eq!(
            scheduler.effect_table_len(),
            1,
            "the retirement must really free its slot"
        );
        assert_agree(&engine, &scheduler, "a bus-device retirement");

        // A removal that names the plugin, and an unregistration by batch.
        engine.remove_plugin(9).expect("the plugin comes off");
        scheduler.update_graph();
        assert_agree(&engine, &scheduler, "a plugin removal");

        engine
            .register_capture_consumer(7)
            .expect("the freed slots take a consumer again");
        engine
            .send_graph_batch(vec![GraphCommand::UnregisterCaptureConsumer(7)])
            .expect("an unregistration is always admitted");
        scheduler.update_graph();
        assert_agree(&engine, &scheduler, "a batch unregistration");

        assert!(
            engine.capture_consumers.is_empty(),
            "the stream ended with every consumer gone, so an equality that \
             held on two empty sets throughout would prove nothing"
        );
    }

    /// A capture handle whose diagnostics input stays live beside it.
    ///
    /// [`engine_handle_for_command_capture`] drops the publishing end of the
    /// handle's diagnostics channel, so nothing a test does can ever make
    /// that handle observe anything. Here the input is handed back instead —
    /// to give the scheduler through [`AudioScheduler::with_midi_rt_diagnostics`]
    /// or to write directly — pairing the handle's reader with a publishing
    /// side exactly as a live callback is paired.
    fn handle_with_live_diagnostics_input(
        capacity: usize,
    ) -> (
        EngineHandle,
        Consumer<GraphCommand>,
        Input<ActiveMidiRtDiagnosticsSnapshot>,
    ) {
        let (command_tx, command_rx) = RingBuffer::new(capacity);
        let (diagnostics_tx, diagnostics_reader) = active_midi_rt_diagnostics_channel();
        let (_timeline_diagnostics_tx, timeline_diagnostics_reader) =
            timeline_rt_diagnostics_channel();
        let (_graph_progress_tx, graph_progress_reader) = graph_progress_channel();
        let (_transport_position_tx, transport_position_reader) = transport_position_channel();
        let (_master_meter_tx, master_meter_reader) = master_meter_channel();
        let (_engine_event_tx, engine_event_rx) = engine_event_channel();
        let (_capture_event_tx, capture_event_rx) = engine_event_channel();
        let (retired_adoption_tx, _retired_adoption_rx) = std::sync::mpsc::channel();

        (
            engine_handle_fixture(
                command_tx,
                retired_adoption_tx,
                diagnostics_reader,
                timeline_diagnostics_reader,
                graph_progress_reader,
                transport_position_reader,
                master_meter_reader,
                engine_event_rx,
                capture_event_rx,
                crate::audio_thread::new_capture_refusal_slot(),
            ),
            command_rx,
            diagnostics_tx,
        )
    }

    /// A collision the ledger counted must give its slot back. The callback
    /// refuses a colliding id before the table takes the instance and returns
    /// the carried instance through the retirement channel, so no retirement
    /// the handle sends will ever name it: without a route back from the
    /// callback the counted slot was permanent, the ledger over-counted
    /// forever, and the shared-table ceiling ratcheted down one registration
    /// per collision.
    #[test]
    fn a_refused_collision_returns_its_ledger_slot_on_the_next_observation() {
        let (mut engine, command_rx, diagnostics_tx) = handle_with_live_diagnostics_input(16);
        let (retired_tx, _retired_rx) = RingBuffer::new(16);
        let mut scheduler = AudioScheduler::with_midi_rt_diagnostics(
            command_rx,
            retired_tx,
            48_000.0,
            diagnostics_tx,
        );

        engine.add_effect(7, "knead").expect("the device registers");
        scheduler.update_graph();
        assert_eq!(engine.registered_effect_count(), 1);

        // A second producer names the same id. The ledger counts the
        // registration — it is a prediction, and the callback has not yet
        // answered — and the callback refuses it before the table moves.
        engine
            .add_plugin_with_id(7, Box::new(OverwritingPlugin))
            .expect("the colliding registration crosses the ring");
        assert_eq!(
            engine.registered_effect_count(),
            2,
            "before the callback answers, the prediction stands"
        );
        scheduler.update_graph();
        assert_eq!(
            scheduler.effect_table_len(),
            1,
            "the colliding id took no table slot"
        );

        // The refusal record crosses as diagnostics — published the way the
        // render callback publishes it after its drain — and the handle's
        // regular diagnostics read is the observation that returns the slot.
        scheduler.publish_midi_rt_diagnostics();
        let snapshot = engine.midi_rt_diagnostics_snapshot();
        assert_eq!(snapshot.effect_id_collisions, 1);
        assert_eq!(
            engine.registered_effect_count(),
            scheduler.effect_table_len(),
            "the refused registration's slot returns on observation"
        );

        // The returned slot is real headroom again, not just a lower number.
        engine
            .add_plugin_with_id(8, Box::new(OverwritingPlugin))
            .expect("the freed slot admits a fresh registration");
        scheduler.update_graph();
        assert_eq!(scheduler.effect_table_len(), 2);
    }

    /// Repeated collisions, observed round by round, leave the ledger exactly
    /// on the table population the callback holds — never below it — so a
    /// session of collisions cannot ratchet the shared ceiling down. That
    /// ratchet is the failure mode this ledger exists to prevent, running in
    /// the other direction.
    #[test]
    fn repeated_collisions_leave_the_ledger_on_the_table_population_it_counts() {
        let (mut engine, command_rx, diagnostics_tx) = handle_with_live_diagnostics_input(32);
        let (retired_tx, _retired_rx) = RingBuffer::new(32);
        let mut scheduler = AudioScheduler::with_midi_rt_diagnostics(
            command_rx,
            retired_tx,
            48_000.0,
            diagnostics_tx,
        );

        for id in 7..=8 {
            engine
                .add_effect(id, "knead")
                .expect("the device registers");
        }
        scheduler.update_graph();
        assert_eq!(engine.registered_effect_count(), 2);

        for _ in 0..3 {
            for id in 7..=8 {
                engine
                    .add_plugin_with_id(id, Box::new(OverwritingPlugin))
                    .expect("each colliding registration crosses the ring");
            }
            scheduler.update_graph();
            scheduler.publish_midi_rt_diagnostics();
            engine.midi_rt_diagnostics_snapshot();
            assert_eq!(
                engine.registered_effect_count(),
                scheduler.effect_table_len(),
                "after each round, the ledger still equals the table it counts"
            );
        }

        // The ceiling itself has not moved: the table holds two, and the
        // headroom arithmetic reads exactly those two.
        assert!(engine
            .ensure_effect_table_headroom(EFFECT_TABLE_CAPACITY - 2)
            .is_ok());
        assert!(engine
            .ensure_effect_table_headroom(EFFECT_TABLE_CAPACITY - 1)
            .is_err());
    }

    /// The return saturates. Every collision the callback counts was a
    /// registration the ledger counted first, so a count larger than the
    /// ledger cannot come from a real callback — but a wrap on a drifted
    /// counter would manufacture headroom out of nothing, the one failure
    /// this ledger exists to prevent. The clamp holds the ledger at zero
    /// instead, and a later observation of the same cumulative count returns
    /// nothing further.
    #[test]
    fn a_collision_count_beyond_the_ledger_clamps_at_zero() {
        let (mut engine, _command_rx, mut diagnostics_tx) = handle_with_live_diagnostics_input(16);

        engine.add_effect(7, "knead").expect("the device registers");
        assert_eq!(engine.registered_effect_count(), 1);

        let mut published = ActiveMidiRtDiagnosticsSnapshot::default();
        published.effect_id_collisions = u64::MAX;
        diagnostics_tx.write(published);

        engine.midi_rt_diagnostics_snapshot();
        assert_eq!(
            engine.registered_effect_count(),
            0,
            "a count the ledger cannot answer clamps at zero rather than wrapping"
        );

        // The emptied ledger is still a ledger: headroom reads zero held, not
        // a wrapped holding, and re-observing the same cumulative count
        // returns nothing further.
        assert!(engine
            .ensure_effect_table_headroom(EFFECT_TABLE_CAPACITY)
            .is_ok());
        engine.midi_rt_diagnostics_snapshot();
        assert_eq!(engine.registered_effect_count(), 0);
    }

    /// A handle whose two event producers stay live, for a test that pushes
    /// onto them directly rather than through a running audio thread.
    ///
    /// Neither [`engine_handle_for_command_capture`] nor
    /// `handle_with_live_diagnostics_input` hands its event producers back —
    /// both drop them, because nothing else in this module writes to either
    /// ring by hand. This exists for the one test that does.
    fn engine_handle_with_live_event_producers(
        capacity: usize,
    ) -> (EngineHandle, Producer<EngineEvent>, Producer<EngineEvent>) {
        let (command_tx, _command_rx) = RingBuffer::new(capacity);
        let (_diagnostics_tx, diagnostics_reader) = active_midi_rt_diagnostics_channel();
        let (_timeline_diagnostics_tx, timeline_diagnostics_reader) =
            timeline_rt_diagnostics_channel();
        let (_graph_progress_tx, graph_progress_reader) = graph_progress_channel();
        let (_transport_position_tx, transport_position_reader) = transport_position_channel();
        let (_master_meter_tx, master_meter_reader) = master_meter_channel();
        let (engine_event_tx, engine_event_rx) = engine_event_channel();
        let (capture_event_tx, capture_event_rx) = engine_event_channel();
        let (retired_adoption_tx, _retired_adoption_rx) = std::sync::mpsc::channel();

        (
            engine_handle_fixture(
                command_tx,
                retired_adoption_tx,
                diagnostics_reader,
                timeline_diagnostics_reader,
                graph_progress_reader,
                transport_position_reader,
                master_meter_reader,
                engine_event_rx,
                capture_event_rx,
                crate::audio_thread::new_capture_refusal_slot(),
            ),
            engine_event_tx,
            capture_event_tx,
        )
    }

    /// [`EngineHandle::drain_engine_events`] merges two rings — output and
    /// input each run their error callback on a different backend thread, so
    /// one `Producer<EngineEvent>` cannot serve both (see
    /// `audio_thread::capture_beside`). An output-side event pushed first
    /// must still come back before an input-side one pushed after it: the
    /// merge is output-then-input, not push order across the two rings.
    #[test]
    fn drain_engine_events_reports_output_before_input() {
        let (mut engine, mut engine_event_tx, mut capture_event_tx) =
            engine_handle_with_live_event_producers(16);

        engine_event_tx
            .push(EngineEvent::StreamError {
                side: StreamSide::Output,
                kind: StreamErrorKind::Xrun,
            })
            .expect("an empty ring should accept the output-side event");
        capture_event_tx
            .push(EngineEvent::StreamError {
                side: StreamSide::Input,
                kind: StreamErrorKind::DeviceNotAvailable,
            })
            .expect("an empty ring should accept the input-side event");

        assert_eq!(
            engine.drain_engine_events(),
            vec![
                EngineEvent::StreamError {
                    side: StreamSide::Output,
                    kind: StreamErrorKind::Xrun,
                },
                EngineEvent::StreamError {
                    side: StreamSide::Input,
                    kind: StreamErrorKind::DeviceNotAvailable,
                },
            ],
            "the output-side event must be reported before the input-side one"
        );
    }

    /// A capture refusal is not on either ring — `capture_side` cannot always
    /// reach a producer to push into (see its doc) — so it crosses through
    /// `capture_refusal` instead: [`EngineHandle::drain_engine_events`] swaps
    /// the slot back to zero on read and turns a non-zero value into one
    /// trailing `Input`-side `StreamError`, after whatever the two rings
    /// held. A drain that finds the slot already zero reports nothing for
    /// it, so a stored refusal surfaces exactly once. Mutation: replace the
    /// `self.capture_refusal.swap(0, Ordering::Relaxed)` call in
    /// `drain_engine_events` with a `load` — the first drain still reports
    /// the refusal, but the second drain this test also checks then repeats
    /// it instead of coming back empty, and this goes red.
    #[test]
    fn drain_engine_events_reports_a_capture_refusal_once() {
        let (command_tx, _command_rx) = RingBuffer::new(1);
        let (_diagnostics_tx, diagnostics_reader) = active_midi_rt_diagnostics_channel();
        let (_timeline_diagnostics_tx, timeline_diagnostics_reader) =
            timeline_rt_diagnostics_channel();
        let (_graph_progress_tx, graph_progress_reader) = graph_progress_channel();
        let (_transport_position_tx, transport_position_reader) = transport_position_channel();
        let (_master_meter_tx, master_meter_reader) = master_meter_channel();
        let (_engine_event_tx, engine_event_rx) = engine_event_channel();
        let (_capture_event_tx, capture_event_rx) = engine_event_channel();
        let (retired_adoption_tx, _retired_adoption_rx) = std::sync::mpsc::channel();
        let capture_refusal = crate::audio_thread::new_capture_refusal_slot();
        capture_refusal.store(
            StreamErrorKind::DeviceNotAvailable as u8 + 1,
            std::sync::atomic::Ordering::Relaxed,
        );

        let mut engine = engine_handle_fixture(
            command_tx,
            retired_adoption_tx,
            diagnostics_reader,
            timeline_diagnostics_reader,
            graph_progress_reader,
            transport_position_reader,
            master_meter_reader,
            engine_event_rx,
            capture_event_rx,
            capture_refusal,
        );

        assert_eq!(
            engine.drain_engine_events(),
            vec![EngineEvent::StreamError {
                side: StreamSide::Input,
                kind: StreamErrorKind::DeviceNotAvailable,
            }],
            "a stored refusal is the whole of the first drain when both rings are empty"
        );
        assert!(
            engine.drain_engine_events().is_empty(),
            "the slot swaps back to zero, so a second drain reports nothing further"
        );
    }
}
