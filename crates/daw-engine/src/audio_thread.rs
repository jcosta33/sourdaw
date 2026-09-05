//! Native OS Audio Thread
//!
//! Owns the thread the stream lives on and the render callback the device
//! seam carries. Which platform API the stream runs through is the device
//! seam's decision (`crate::device`): cpal on macOS and Linux, the
//! IAudioClient3/WASAPI backend on Windows (ADR 0027).

use crate::capture::{capture_ring, CaptureRingReader, CaptureShape};
use crate::device::{
    CaptureFn, DeviceOpenRequest, InputBackend, InputOpenRefusal, InputOpenRequest, OpenInput,
    OpenOutput, OutputBackend, PlatformInputBackend, PlatformInputStream, PlatformOutputBackend,
    PlatformStream, RenderFn, StreamErrorFn,
};
use crate::engine_events::{engine_event_channel, EngineEvent, StreamErrorKind, StreamSide};
use crate::midi::diagnostics::{
    active_midi_rt_diagnostics_channel, ActiveMidiRtDiagnosticsSnapshot,
};
use crate::plugin_slot::CaptureInputBlock;
use crate::scheduler::{
    graph_progress_channel, master_meter_channel, transport_position_channel, AudioScheduler,
    GraphCommand, GraphProgressSnapshot, MasterMeterSnapshot, RetiredGraphObjects,
    TransportPositionSnapshot, RETIREMENT_QUEUE_CAPACITY,
};
use crate::timeline::{timeline_rt_diagnostics_channel, TimelineRtDiagnosticsSnapshot};
use rtrb::{Consumer, Producer, RingBuffer};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;
use triple_buffer::Input;

pub(crate) const MAX_CALLBACK_FRAMES: usize = 4096;
/// The period the engine asks a device for when the device lets it choose.
/// 512 frames is the common professional default (Live, Logic, Reaper all ship
/// a buffer of this order): low enough for playable monitoring latency, high
/// enough that the graph is not woken more often than it can serve.
/// One constant for every backend: the cpal buffer-size negotiation and the
/// Windows shared-period negotiation must not drift apart on this number.
pub(crate) const PREFERRED_BUFFER_FRAMES: u32 = 512;
const AUDIO_STREAM_STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
const AUDIO_STREAM_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(100);
const RETIREMENT_RECLAIMER_POLL_INTERVAL: Duration = Duration::from_millis(10);

pub struct AudioThreadHandle {
    shutdown_tx: Sender<()>,
    shutdown_complete_rx: Receiver<()>,
}

/// A handle that owns no audio stream, for tests that drive an [`crate::EngineHandle`]
/// command ring without a device.
///
/// Both ends of the shutdown exchange are dropped here, so `Drop` finds the
/// channel disconnected on its first send and returns without waiting.
#[cfg(any(test, feature = "command-capture-fixture"))]
pub(crate) fn detached_audio_thread_handle() -> AudioThreadHandle {
    let (shutdown_tx, _) = mpsc::channel();
    let (_, shutdown_complete_rx) = mpsc::channel();
    AudioThreadHandle {
        shutdown_tx,
        shutdown_complete_rx,
    }
}

struct StreamWithReclaimerShutdown<Stream>(Option<Stream>, Sender<()>);

impl<Stream> Drop for StreamWithReclaimerShutdown<Stream> {
    fn drop(&mut self) {
        drop(self.0.take());
        let _ = self.1.send(());
    }
}

impl Drop for AudioThreadHandle {
    fn drop(&mut self) {
        if self.shutdown_tx.send(()).is_err() {
            return;
        }

        match self
            .shutdown_complete_rx
            .recv_timeout(AUDIO_STREAM_SHUTDOWN_TIMEOUT)
        {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => {}
            Err(RecvTimeoutError::Timeout) => {
                eprintln!("[Engine] Timed out waiting for audio stream shutdown");
            }
        }
    }
}

fn spawn_owned_audio_stream<Stream, Factory>(factory: Factory) -> Result<AudioThreadHandle, String>
where
    Stream: 'static,
    Factory: FnOnce() -> Result<Stream, String> + Send + 'static,
{
    spawn_owned_audio_stream_with_timeout(factory, AUDIO_STREAM_STARTUP_TIMEOUT)
}

fn spawn_owned_audio_stream_with_timeout<Stream, Factory>(
    factory: Factory,
    startup_timeout: Duration,
) -> Result<AudioThreadHandle, String>
where
    Stream: 'static,
    Factory: FnOnce() -> Result<Stream, String> + Send + 'static,
{
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    let (shutdown_complete_tx, shutdown_complete_rx) = mpsc::channel();
    let _owner_thread = thread::Builder::new()
        .name("sourdaw-audio-owner".to_string())
        .spawn(move || match factory() {
            Ok(stream) => {
                if ready_tx.send(Ok(())).is_ok() {
                    let _ = shutdown_rx.recv();
                }
                drop(stream);
                let _ = shutdown_complete_tx.send(());
            }
            Err(error) => {
                let _ = ready_tx.send(Err(error));
            }
        })
        .map_err(|error| format!("Failed to spawn audio owner thread: {error}"))?;

    match ready_rx.recv_timeout(startup_timeout) {
        Ok(Ok(())) => Ok(AudioThreadHandle {
            shutdown_tx,
            shutdown_complete_rx,
        }),
        Ok(Err(error)) => Err(error),
        Err(RecvTimeoutError::Timeout) => {
            Err("Timed out waiting for audio stream startup".to_string())
        }
        Err(RecvTimeoutError::Disconnected) => {
            Err("Audio owner thread exited during startup".to_string())
        }
    }
}

/// Spawn the thread that frees everything the audio thread hands back.
///
/// Returns the shutdown sender and an adoption sender: a control-side ring
/// reallocation ([`crate::EngineHandle`] growing the command channel) creates
/// a fresh retirement ring, and its consumer must reach this thread or the
/// swapped-in ring would never drain. A ring whose producer is gone and whose
/// leftovers are drained is dropped here, which keeps the old ring's free off
/// the audio thread.
fn spawn_retirement_reclaimer<T: Send + 'static>(
    retired_rx: Consumer<T>,
) -> Result<(Sender<()>, Sender<Consumer<T>>), String> {
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    let (adopt_tx, adopt_rx) = mpsc::channel::<Consumer<T>>();
    thread::Builder::new()
        .name("sourdaw-plugin-reclaimer".to_string())
        .spawn(move || {
            let mut rings = vec![retired_rx];
            loop {
                while let Ok(adopted) = adopt_rx.try_recv() {
                    rings.push(adopted);
                }
                for ring in &mut rings {
                    while let Ok(retired) = ring.pop() {
                        reclaim_retired(retired);
                    }
                }
                // Abandonment is checked before emptiness: once the producer
                // is gone nothing can push again, so an abandoned-and-empty
                // ring is done for good.
                rings.retain(|ring| !ring.is_abandoned() || ring.slots() > 0);

                match shutdown_rx.recv_timeout(RETIREMENT_RECLAIMER_POLL_INTERVAL) {
                    Ok(()) | Err(RecvTimeoutError::Disconnected) => {
                        while let Ok(adopted) = adopt_rx.try_recv() {
                            rings.push(adopted);
                        }
                        for ring in &mut rings {
                            while let Ok(retired) = ring.pop() {
                                reclaim_retired(retired);
                            }
                        }
                        break;
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                }
            }
        })
        .map_err(|error| format!("Failed to spawn plugin reclaimer thread: {error}"))?;

    Ok((shutdown_tx, adopt_tx))
}

fn reclaim_retired<T>(retired: T) {
    if catch_unwind(AssertUnwindSafe(|| drop(retired))).is_err() {
        eprintln!("[Engine] Plugin destructor panicked during retirement");
    }
}

/// Spawn the audio thread against a command ring the caller already owns.
///
/// A single attempt, unlike `EngineHandle::new`, and deliberately so: a failed
/// stream build consumes the command consumer along with the callbacks it was
/// moved into, so a second attempt needs a *fresh* consumer, and only a caller
/// holding both ends of the ring can make one. Retrying here against a ring the
/// caller does not hold would hand back a running engine that ignores every
/// command pushed into the caller's producer — a worse outcome than the honest
/// failure. Callers that want the fallback build should use `EngineHandle::new`,
/// which owns both ends and retries with the device default period.
pub fn spawn_audio_thread(command_rx: Consumer<GraphCommand>) -> Result<AudioThreadHandle, String> {
    let (diagnostics_tx, _diagnostics_reader) = active_midi_rt_diagnostics_channel();
    let (timeline_diagnostics_tx, _timeline_diagnostics_reader) = timeline_rt_diagnostics_channel();
    let (graph_progress_tx, _graph_progress_reader) = graph_progress_channel();
    let (transport_position_tx, _transport_position_reader) = transport_position_channel();
    let (master_meter_tx, _master_meter_reader) = master_meter_channel();
    let (engine_event_tx, _engine_event_rx) = engine_event_channel();
    spawn_audio_thread_with_diagnostics(
        command_rx,
        diagnostics_tx,
        timeline_diagnostics_tx,
        graph_progress_tx,
        transport_position_tx,
        master_meter_tx,
        engine_event_tx,
        None,
        false,
    )
    .map(|spawned| spawned.handle)
}

/// What a successful spawn hands back to the control side.
pub(crate) struct SpawnedAudioThread {
    pub handle: AudioThreadHandle,
    /// The rate the stream actually opened at.
    pub sample_rate: f32,
    /// What the capture side published as its settled latency, or zero when
    /// no input stream was opened.
    pub input_latency_frames: Arc<AtomicUsize>,
    /// The slot a refused capture open or start stores its kind into. See
    /// [`new_capture_refusal_slot`].
    pub capture_refusal: Arc<AtomicU8>,
    pub retired_adoption_tx: Sender<Consumer<RetiredGraphObjects>>,
}

/// Spawn the audio thread and report the sample rate the stream actually
/// opened at.
///
/// The rate is decided inside the stream build — it is the device's own
/// default configuration, queried on the owner thread — so it travels back
/// through a cell the factory fills before the ready handshake. The caller
/// needs it because every graph command that names a time in seconds has to be
/// converted to frames on *this* clock, and any other rate is a guess.
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_audio_thread_with_diagnostics(
    command_rx: Consumer<GraphCommand>,
    midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
    timeline_rt_diagnostics_tx: Input<TimelineRtDiagnosticsSnapshot>,
    graph_progress_tx: Input<GraphProgressSnapshot>,
    transport_position_tx: Input<TransportPositionSnapshot>,
    master_meter_tx: Input<MasterMeterSnapshot>,
    engine_event_tx: Producer<EngineEvent>,
    capture_event_tx: Option<Producer<EngineEvent>>,
    force_default_buffer: bool,
) -> Result<SpawnedAudioThread, String> {
    let (retired_tx, retired_rx) = RingBuffer::new(RETIREMENT_QUEUE_CAPACITY);
    let (reclaimer_shutdown_tx, retired_adoption_tx) = spawn_retirement_reclaimer(retired_rx)?;
    let sample_rate_cell = Arc::new(OnceLock::new());
    let sample_rate_slot = Arc::clone(&sample_rate_cell);
    let input_latency_frames = new_input_latency_slot();
    let input_latency_slot = Arc::clone(&input_latency_frames);
    let capture_refusal = new_capture_refusal_slot();
    let capture_refusal_slot = Arc::clone(&capture_refusal);

    let handle = spawn_owned_audio_stream(move || {
        match build_audio_stream(
            command_rx,
            retired_tx,
            midi_rt_diagnostics_tx,
            timeline_rt_diagnostics_tx,
            graph_progress_tx,
            transport_position_tx,
            master_meter_tx,
            engine_event_tx,
            capture_event_tx,
            force_default_buffer,
            &sample_rate_slot,
            &input_latency_slot,
            &capture_refusal_slot,
        ) {
            Ok(streams) => Ok(StreamWithReclaimerShutdown(
                Some(streams),
                reclaimer_shutdown_tx,
            )),
            Err(error) => {
                let _ = reclaimer_shutdown_tx.send(());
                Err(error)
            }
        }
    })?;

    // The factory fills the cell before the stream is built, and the ready
    // handshake the spawn waited on happens after the factory returned, so a
    // successful spawn implies a filled cell.
    let sample_rate = *sample_rate_cell
        .get()
        .ok_or_else(|| "Audio stream started without reporting its sample rate".to_string())?;
    Ok(SpawnedAudioThread {
        handle,
        sample_rate,
        input_latency_frames,
        capture_refusal,
        retired_adoption_tx,
    })
}

/// Write the engine's internal stereo pair (`left`/`right`, always rendered
/// by `AudioScheduler::process_block`) into a device-interleaved output
/// chunk, adapting to whatever channel count the device actually exposes.
///
/// No shipping DAW refuses to open on a non-stereo device: Reaper lets the
/// output channel range be set to whatever the device exposes, and Logic
/// Pro takes the Core Audio default and routes to any available channel,
/// including a mono target. A mono device downmixes as the average of both
/// channels (the conventional stereo-to-mono fold); a device reporting more
/// than two channels gets the stereo pair on channels 0/1 with the rest
/// left silent, rather than the caller being refused a stream outright.
#[inline]
fn write_interleaved(
    chunk: &mut [f32],
    left: &[f32],
    right: &[f32],
    channels: usize,
    frames: usize,
) {
    if channels == 1 {
        for (i, sample) in chunk.iter_mut().enumerate() {
            if i < frames {
                *sample = (left[i] + right[i]) * 0.5;
            }
        }
        return;
    }

    for (i, frame) in chunk.chunks_exact_mut(channels).enumerate() {
        if i < frames {
            frame[0] = left[i];
            frame[1] = right[i];
            for sample in frame.iter_mut().skip(2) {
                *sample = 0.0;
            }
        }
    }
}

/// Pick the period the engine asks the device for, intervening as rarely as it
/// can get away with.
///
/// Asking for a period is not free and not local. On CoreAudio a `Fixed`
/// request writes `kAudioDevicePropertyBufferFrameSize`, which is device-global:
/// it changes the period for every client of that device, it is the same value
/// the user set in Audio MIDI Setup or another DAW, and nothing here restores it
/// afterwards. A DAW that silently rewrites a user-facing device preference has
/// to be paying for it.
///
/// What it buys is bounded. A period above `MAX_CALLBACK_FRAMES` does not
/// overrun anything: the callback chunks its fixed scratch and renders the
/// period in as many chunks as it takes.
///
/// So the engine intervenes on exactly one shape of device: one whose advertised
/// range reaches above the callback's limit *and* can be asked for something at
/// or below it. A device that cannot exceed the limit keeps its preference
/// untouched; a device whose whole range sits above the limit cannot be helped
/// and keeps it too.
#[cfg(any(not(windows), test))]
pub(crate) fn negotiated_buffer_size(supported: &cpal::SupportedBufferSize) -> cpal::BufferSize {
    let cpal::SupportedBufferSize::Range { min, max } = *supported else {
        return cpal::BufferSize::Default;
    };

    let limit = MAX_CALLBACK_FRAMES as cpal::FrameCount;
    if max <= limit || min > limit {
        return cpal::BufferSize::Default;
    }

    cpal::BufferSize::Fixed(PREFERRED_BUFFER_FRAMES.clamp(min.max(1), limit))
}

/// The period actually requested for a given stream build.
///
/// `force_default` is the retry path's lever: a `Fixed` request reaches backend
/// code a `Default` request never runs, so a build can fail for the negotiated
/// period alone. `EngineHandle::new` then rebuilds with this set, trading the
/// negotiation for an engine that starts.
#[cfg(any(not(windows), test))]
pub(crate) fn effective_buffer_size(
    supported: &cpal::SupportedBufferSize,
    force_default: bool,
) -> cpal::BufferSize {
    if force_default {
        return cpal::BufferSize::Default;
    }

    negotiated_buffer_size(supported)
}

/// The slot the capture ring publishes its settled latency into.
///
/// Zero means the ring is not serving: no input stream was opened, or one was
/// and has not filled to its settled depth yet, or a stall dropped it back to
/// filling. The figure cannot be known at open — it depends on the block the
/// device turns out to deliver and the slice the render callback turns out to
/// ask for — so the reader writes it from the audio thread the moment it
/// settles, and retracts it when it stops serving.
pub(crate) fn new_input_latency_slot() -> Arc<AtomicUsize> {
    Arc::new(AtomicUsize::new(0))
}

/// The slot a refused capture publishes into, in place of the ring a refusal
/// cannot cross.
///
/// Both of `capture_side`'s failure branches run synchronously on the owner
/// thread, after whatever became of the `on_error` callback the open or start
/// attempt was handed — recovered, consumed by a stream that is about to be
/// dropped, or never handed anywhere at all. This slot does not depend on any
/// of that: it is a plain reference threaded in beside `input_latency_slot`,
/// written the same way at the same points.
///
/// Zero means "no refusal" and is never a valid encoding of a kind: a
/// refusal stores `kind as u8 + 1`, so the reader — `drain_engine_events`,
/// via [`crate::engine_events::StreamErrorKind::from_slot`] — can tell an
/// unwritten slot from a stored `DeviceNotAvailable` (which is `0 + 1`).
/// `drain_engine_events` swaps this back to zero on every read, so a refusal
/// is reported exactly once, on the first drain after it is stored.
pub(crate) fn new_capture_refusal_slot() -> Arc<AtomicU8> {
    Arc::new(AtomicU8::new(0))
}

/// The capture ring's reader plus every buffer the render callback needs to
/// turn a device's interleaved block into the engine's stereo pair.
///
/// It exists as one value because it travels as one: the reader has to reach
/// a renderer the output stream already owns, and a lock is not open to the
/// callback, so the whole feed crosses a one-slot SPSC ring instead. Every
/// buffer here is allocated where the feed is built — on the thread that opens
/// the stream — because the callback that uses them may allocate nothing.
pub(crate) struct CaptureFeed {
    reader: CaptureRingReader,
    /// One render chunk of the device's own interleaved layout.
    interleaved: Box<[f32]>,
    left: Box<[f32; MAX_CALLBACK_FRAMES]>,
    right: Box<[f32; MAX_CALLBACK_FRAMES]>,
    /// The input device's channel count, which is not the output device's.
    channels: usize,
}

impl CaptureFeed {
    fn new(reader: CaptureRingReader, channels: usize) -> Self {
        // Stood up the way `CaptureShape` stands its own lanes up, so a
        // defensive zero cannot reach the deinterleave as a division by zero.
        let channels = channels.max(1);
        Self {
            reader,
            interleaved: vec![0.0f32; MAX_CALLBACK_FRAMES * channels].into_boxed_slice(),
            left: Box::new([0.0f32; MAX_CALLBACK_FRAMES]),
            right: Box::new([0.0f32; MAX_CALLBACK_FRAMES]),
            channels,
        }
    }

    /// Serve `frames` of captured audio into the deinterleaved pair, or leave
    /// both silent and report that this chunk has none.
    ///
    /// A mono device duplicates its one channel into both sides — the
    /// conventional treatment of a mono source on a stereo recorder, and what
    /// keeps a single-input interface from recording a take that only exists
    /// on the left. A device carrying more than two channels contributes its
    /// first two: the engine opens the default input, and its stereo front is
    /// what a record feed means.
    #[inline]
    fn serve(&mut self, frames: usize) -> bool {
        let channels = self.channels;
        let left = &mut self.left[..frames];
        let right = &mut self.right[..frames];
        let interleaved = &mut self.interleaved[..frames * channels];

        if !self.reader.read_into(interleaved) {
            left.fill(0.0);
            right.fill(0.0);
            return false;
        }

        for (index, frame) in interleaved.chunks_exact(channels).enumerate() {
            left[index] = frame[0];
            right[index] = if channels == 1 { frame[0] } else { frame[1] };
        }
        true
    }
}

/// The render callback's state and body, as a value the device seam wraps.
///
/// Named rather than written inline as a closure because it is the only place
/// the engine's audio becomes the device's — the monitor gate included — and a
/// boundary that exists in exactly one place has to be drivable without a
/// device to be provable at all. The callback the backend carries is
/// [`Self::render`] and nothing else, so a test driving this drives the
/// production path: same command drain, same timeline render, same device
/// write.
///
/// Runs on the audio thread: no heap allocation, no locks, no IPC — scratch is
/// fixed-size and owned here, and every channel it publishes into is
/// wait-free.
pub(crate) struct DeviceRenderer {
    scheduler: AudioScheduler,
    left_scratch: Box<[f32; MAX_CALLBACK_FRAMES]>,
    right_scratch: Box<[f32; MAX_CALLBACK_FRAMES]>,
    /// The one-slot handoff the capture side pushes its feed through. The
    /// renderer is already inside the output stream by then, so this is the
    /// only route to it that takes no lock.
    capture_rx: Consumer<CaptureFeed>,
    capture_feed: Option<CaptureFeed>,
    /// Capture frames this renderer has delivered, counted whether or not the
    /// ring served them. It is the monotonic timeline a consumer places a
    /// block on, and it belongs to the renderer because nothing else sees
    /// every chunk.
    capture_position_frames: u64,
}

impl DeviceRenderer {
    pub(crate) fn new(scheduler: AudioScheduler, capture_rx: Consumer<CaptureFeed>) -> Self {
        Self {
            scheduler,
            left_scratch: Box::new([0.0f32; MAX_CALLBACK_FRAMES]),
            right_scratch: Box::new([0.0f32; MAX_CALLBACK_FRAMES]),
            capture_rx,
            capture_feed: None,
            capture_position_frames: 0,
        }
    }

    /// Take the capture feed if one is waiting.
    ///
    /// One non-blocking pop per callback while the slot is empty: the capture
    /// side pushes exactly once, after its input stream started, so this stops
    /// costing anything the callback after that.
    #[inline]
    fn adopt_capture_feed(&mut self) {
        if self.capture_feed.is_some() {
            return;
        }

        if let Ok(feed) = self.capture_rx.pop() {
            self.capture_feed = Some(feed);
        }
    }

    /// Deliver one chunk of captured input to the scheduler's input bus.
    ///
    /// Without a feed nothing is delivered at all. An engine with no input
    /// device has no take to gap, and delivering silence would tell a recorder
    /// the microphone dropped out.
    #[inline]
    fn deliver_capture(&mut self, frames: usize) {
        let Some(feed) = self.capture_feed.as_mut() else {
            return;
        };

        let served = feed.serve(frames);
        let position_frames = self.capture_position_frames;
        self.capture_position_frames = position_frames.wrapping_add(frames as u64);
        self.scheduler.deliver_capture(CaptureInputBlock {
            left: &feed.left[..frames],
            right: &feed.right[..frames],
            frames,
            served,
            latency_frames: feed.reader.latency_frames(),
            position_frames,
        });
    }

    /// Fill one device buffer: interleaved f32, a whole number of frames.
    ///
    /// `channels` arrives per call because a Windows device-invalidation
    /// recovery may resume this same callback on an endpoint with a different
    /// channel layout; the cpal backends pass a constant.
    pub(crate) fn render(&mut self, data: &mut [f32], channels: usize) {
        if channels == 0 {
            return;
        }

        // 1. Process pending commands lock-free
        self.scheduler.update_graph();
        self.adopt_capture_feed();

        // The monitor gate, read once for this callback after the drain that
        // can set it, so a session's shadow lands on the same block boundary
        // as the topology it travelled with. A plain field read on a scheduler
        // this callback already owns: no atomic, no lock, no allocation.
        let shadowed = self.scheduler.monitor_shadowed();

        // The whole period this callback covers, taken before the chunk loop
        // splits it: the meter's hold window is measured in frames the device
        // consumed, not in the chunks the loop happened to render them in.
        let callback_frames = data.len() / channels;

        // What the device is actually handed this callback. A shadowed block
        // writes zeros and so contributes nothing, which is what keeps the
        // meter a statement about the output rather than about the render.
        let mut callback_peak = 0.0f32;

        // 2. Process the native effects chain (for standalone native rendering).
        // Scratch is fixed-size and owned here, so no heap allocation occurs
        // per buffer.
        for chunk in data.chunks_mut(MAX_CALLBACK_FRAMES * channels) {
            let frames = chunk.len() / channels;

            // Captured input is delivered per chunk, ahead of the block that
            // chunk renders, so a consumer's input and the graph's output
            // advance on the same boundaries. It runs whether or not the
            // monitor is shadowed: a shadowed session still records.
            self.deliver_capture(frames);

            let left = &mut self.left_scratch[..frames];
            let right = &mut self.right_scratch[..frames];
            left.fill(0.0);
            right.fill(0.0);

            // The timeline renders here, into scratch the
            // callback owns: clips, track device chains, sends,
            // buses and the master sum, then the master insert
            // chain and the master fader. An engine with no
            // tracks renders silence, exactly as before the
            // timeline existed. process_block always renders a
            // stereo pair regardless of the device's channel
            // layout.
            //
            // It runs whether or not the monitor is shadowed: the gate
            // silences the output, never the clock, so the playhead advances
            // and a loop seam closes on its own sample either way.
            self.scheduler.process_block(left, right, frames);

            if shadowed {
                // True zeros rather than a small gain, so "silent" is a thing
                // a leak test can assert exactly and no residue can hide
                // under a threshold.
                chunk.fill(0.0);
                continue;
            }

            // Adapt the rendered stereo pair to the device's actual
            // channel count.
            write_interleaved(chunk, left, right, channels, frames);

            // Meter the buffer the device was actually handed, not the
            // stereo scratch that fed it: a mono device folds left/right
            // into one channel before this point, and a channel count
            // above two leaves the extra channels zero-filled, which folds
            // in harmlessly.
            callback_peak = callback_peak.max(block_peak(&chunk[..frames * channels]));
        }

        self.scheduler.publish_midi_rt_diagnostics();
        self.scheduler.publish_timeline_rt_diagnostics();
        // Published last, after every block of this callback:
        // the snapshot's happens-before (GraphProgressSnapshot)
        // holds because everything it vouches for has already
        // been drained, rendered and popped above.
        self.scheduler.publish_graph_progress();
        // The cursor's channel, published on the same edge and for the same
        // reason: one write per callback, after every block of it, so a reader
        // between callbacks sees a position the engine actually reached.
        self.scheduler.publish_transport_position();
        // The meter's channel, on the same edge and for the same reason. It
        // carries the whole callback's frame count because the hold window is
        // measured in frames the device consumed, not in blocks this loop
        // happened to split them into.
        self.scheduler
            .publish_master_meter(callback_peak, callback_frames as u64);
    }
}

/// The loudest sample the interleaved buffer the device was just handed
/// holds, whatever its channel layout.
///
/// Runs inside the audio deadline: one pass over the slice the callback just
/// wrote and that is still in cache, no allocation and no branch on data.
#[inline]
fn block_peak(written: &[f32]) -> f32 {
    written
        .iter()
        .fold(0.0f32, |peak, sample| peak.max(sample.abs()))
}

/// Open the capture side and build the ring it feeds.
///
/// Generic over the backend for the reason the output seam is: the decisions
/// here — which bounds the ring takes, which refusals are named, what the
/// published latency is — have to be provable without a device attached.
///
/// Both figures the ring is built with are ceilings, and deliberately so. The
/// negotiated period is the largest block the device said it may hand back,
/// not the one it runs; the read ceiling is the largest callback the engine
/// accepts anywhere, because the period the render callback is handed belongs
/// to the output device and is not known here. The ring settles on the
/// cadence it observes at runtime, so a ceiling far above the running rate
/// costs capacity and nothing else — no depth, no latency, no shed quantum.
fn attach_capture<B: InputBackend>(
    engine_sample_rate: f32,
    on_error: StreamErrorFn,
    input_latency_slot: Arc<AtomicUsize>,
) -> Result<(<B::Open as OpenInput>::Stream, CaptureFeed), InputOpenRefusal> {
    // There is one refusal route and it is not the ring: `on_error` is
    // `FnMut`, so once it is handed to `open.start` below it may already be
    // consumed by the backend it was handed to — a stream that failed to
    // build or play drops it along with everything else the failed attempt
    // owned, with no way to call it back. An open refusal here holds the
    // callback un-consumed, and a start refusal never does, so calling
    // `on_error` from exactly one of those two places would report one
    // refusal shape and silently drop the other. Every refusal instead
    // crosses through `capture_side`'s capture-refusal slot, which needs no
    // callback at all: see its doc.
    let open = B::open_default_input(InputOpenRequest { engine_sample_rate })?;
    let negotiated = open.negotiated();
    let (mut writer, reader) = capture_ring(
        CaptureShape {
            input_block_ceiling: negotiated.period_frames,
            output_read_ceiling: MAX_CALLBACK_FRAMES,
            channels: negotiated.channels,
        },
        input_latency_slot,
    );

    // The capture thread's whole job: copy the device's block into the ring
    // or count that it could not. No allocation, no lock, no logging.
    let capture: CaptureFn = Box::new(move |data: &[f32], channels: usize| {
        writer.write_block(data, channels);
    });

    // Built here, on the thread that opens the stream, because the render
    // callback that deinterleaves through it may not allocate.
    let feed = CaptureFeed::new(reader, negotiated.channels);

    open.start(capture, on_error).map(|stream| (stream, feed))
}

/// Accept a capture attempt and never fail the engine over it.
///
/// Capture is additive. An engine that refuses to start because the machine
/// has no input device — or because its input device runs at another rate —
/// leaves the musician with no playback either, which is strictly worse than
/// starting without a record feed. So a refusal is named on the way past, the
/// latency slot is left at zero (how the layer above reads "no capture"), and
/// the kind is stored into `capture_refusal_slot` as `kind as u8 + 1` — the
/// encoding [`crate::engine_events::StreamErrorKind::from_slot`] decodes.
/// This runs synchronously on the owner thread in both of this function's
/// `Err` branches, which is what lets it report a refusal `attach_capture`
/// cannot: see its doc. [`crate::EngineHandle::drain_engine_events`] is what
/// turns a stored kind into the one `EngineEvent::StreamError` a host
/// observes — never here, and never more than once per refusal.
///
/// Nothing is published for an accepted open either. What the ring costs
/// depends on the block the device turns out to deliver and the slice the
/// render callback turns out to ask for, neither of which is known until
/// audio is flowing, so the reader publishes the figure itself once it
/// settles.
///
/// Handing the feed to the renderer is part of accepting the open, and it is
/// the last thing that can fail. A feed that cannot reach the renderer is a
/// ring nobody drains, which is exactly the state an unopened input leaves —
/// so it takes the same route out, and the stream goes with it rather than
/// writing into a ring whose consumer is about to be dropped. It is stored
/// under `BackendSpecific`: this crate has never observed it fire, so it
/// carries no kind of its own, and `BackendSpecific` is the vocabulary's
/// catch-all for exactly that case.
fn capture_side<Stream>(
    attempt: Result<(Stream, CaptureFeed), InputOpenRefusal>,
    feed_tx: &mut Producer<CaptureFeed>,
    input_latency_slot: &AtomicUsize,
    capture_refusal_slot: &AtomicU8,
) -> Option<Stream> {
    let (stream, feed) = match attempt {
        Ok(attached) => attached,
        Err(refusal) => {
            // The owner thread, not the audio thread: reporting costs a
            // stderr lock here and would be forbidden inside the callback.
            eprintln!("[Engine] Audio capture unavailable: {refusal:?}");
            input_latency_slot.store(0, Ordering::Relaxed);
            capture_refusal_slot.store(refusal.stream_error_kind() as u8 + 1, Ordering::Relaxed);
            return None;
        }
    };

    if feed_tx.push(feed).is_err() {
        // Unreachable: the slot is built empty and one attach fills it once.
        // Reported rather than asserted because the failure is otherwise
        // silent — a running input stream feeding a renderer that never
        // reads it. It is a refusal like any other, so it is stored the same
        // way; see this function's doc for why `BackendSpecific`.
        eprintln!("[Engine] Audio capture unavailable: the render feed slot was already taken");
        input_latency_slot.store(0, Ordering::Relaxed);
        capture_refusal_slot.store(
            StreamErrorKind::BackendSpecific as u8 + 1,
            Ordering::Relaxed,
        );
        return None;
    }

    Some(stream)
}

/// Open the capture side beside an output stream that started, and only then.
///
/// The order is load-bearing rather than incidental. An output that cannot
/// start is the engine failing, and opening an input device on the way to
/// that failure asks the OS — and on macOS the musician — for microphone
/// access a session that is about to die will never use. This function is a
/// convention, not a proof: `Result<Output, String>` is constructible without
/// a stream, and the seam's own tests build one. What holds the contract is
/// the pair of ordering tests below, which observe that a failed output build
/// never reaches the input device and that a started one does.
///
/// Capture is attempted at all only when the caller asked for it by handing
/// over an event ring of its own. That ring is SPSC and the two backends run
/// their error callbacks on different threads, so one producer cannot serve
/// both sides.
fn capture_beside<Output, B: InputBackend>(
    output: Result<Output, String>,
    capture_event_tx: Option<Producer<EngineEvent>>,
    engine_sample_rate: f32,
    input_latency_slot: &Arc<AtomicUsize>,
    feed_tx: &mut Producer<CaptureFeed>,
    capture_refusal_slot: &Arc<AtomicU8>,
) -> Result<(Option<<B::Open as OpenInput>::Stream>, Output), String> {
    let output = output?;
    let capture = capture_event_tx.and_then(|tx| {
        capture_side(
            attach_capture::<B>(
                engine_sample_rate,
                stream_error_sink(StreamSide::Input, tx),
                Arc::clone(input_latency_slot),
            ),
            feed_tx,
            input_latency_slot,
            capture_refusal_slot,
        )
    });

    Ok((capture, output))
}

/// The wait-free error sink a backend's error callback is handed.
///
/// The backend may call it from the real-time thread — ALSA reports from its
/// xrun path and WASAPI from inside the output run loop — so it does the one
/// wait-free thing open to it and nothing else: push a fixed-size `Copy`
/// event into a preallocated ring. No formatting, no stderr lock, no
/// allocation, no wait; a full ring drops the report rather than stalling the
/// audio side. Reporting the error is the drain side's job
/// (`drain_engine_events`).
///
/// The side is bound here, where the stream it belongs to is known, because
/// nothing downstream can recover it: the event is drained long after the
/// callback that pushed it.
fn stream_error_sink(
    side: StreamSide,
    mut engine_event_tx: Producer<EngineEvent>,
) -> StreamErrorFn {
    Box::new(move |kind: StreamErrorKind| {
        let _ = engine_event_tx.push(EngineEvent::StreamError { side, kind });
    })
}

/// The device streams one engine owns for the life of its audio thread.
///
/// The capture side is declared first so it stops before the ring it writes
/// into is dropped, and the whole value is what the owner thread holds and
/// drops: teardown stays a single `drop`, whether or not capture was opened.
/// The ring's reader lives inside the renderer the output stream owns, so this
/// order is what keeps the capture callback from writing into a ring whose
/// consumer has already gone.
type OwnedDeviceStreams = (Option<PlatformInputStream>, PlatformStream);

#[allow(clippy::too_many_arguments)]
fn build_audio_stream(
    command_rx: Consumer<GraphCommand>,
    retired_tx: rtrb::Producer<RetiredGraphObjects>,
    midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
    timeline_rt_diagnostics_tx: Input<TimelineRtDiagnosticsSnapshot>,
    graph_progress_tx: Input<GraphProgressSnapshot>,
    transport_position_tx: Input<TransportPositionSnapshot>,
    master_meter_tx: Input<MasterMeterSnapshot>,
    engine_event_tx: Producer<EngineEvent>,
    capture_event_tx: Option<Producer<EngineEvent>>,
    force_default_buffer: bool,
    sample_rate_out: &OnceLock<f32>,
    input_latency_slot: &Arc<AtomicUsize>,
    capture_refusal_slot: &Arc<AtomicU8>,
) -> Result<OwnedDeviceStreams, String> {
    let open = PlatformOutputBackend::open_default_output(DeviceOpenRequest {
        force_default_period: force_default_buffer,
        // WASAPI Exclusive is an explicit user opt-in (ADR 0027). No engine
        // setting is wired to it yet, so every open today takes the shared
        // default; the flag exists on the seam so wiring the setting is a
        // one-line change here and nowhere else.
        exclusive: false,
    })?;

    let negotiated = open.negotiated();
    if negotiated.channels == 0 {
        return Err("Audio output device reports zero channels".to_string());
    }

    let sample_rate = negotiated.sample_rate;
    let _ = sample_rate_out.set(sample_rate);
    let scheduler = AudioScheduler::with_rt_diagnostics(
        command_rx,
        retired_tx,
        sample_rate,
        midi_rt_diagnostics_tx,
        timeline_rt_diagnostics_tx,
        graph_progress_tx,
        transport_position_tx,
        master_meter_tx,
    );

    // Built before the renderer, because the renderer takes the consumer with
    // it into the output stream and nothing can reach it afterwards.
    let (mut capture_feed_tx, capture_feed_rx) = RingBuffer::<CaptureFeed>::new(1);
    let mut renderer = DeviceRenderer::new(scheduler, capture_feed_rx);
    let render: RenderFn = Box::new(move |data: &mut [f32], channels: usize| {
        renderer.render(data, channels);
    });

    capture_beside::<_, PlatformInputBackend>(
        open.start(
            render,
            stream_error_sink(StreamSide::Output, engine_event_tx),
        ),
        capture_event_tx,
        sample_rate,
        input_latency_slot,
        &mut capture_feed_tx,
        capture_refusal_slot,
    )
}

#[cfg(test)]
mod capture_seam_tests {
    use super::{
        attach_capture, capture_beside, capture_side, new_capture_refusal_slot,
        new_input_latency_slot, CaptureFeed,
    };
    use crate::capture::target_depth_frames;
    use crate::device::{
        CaptureFn, InputBackend, InputOpenRefusal, InputOpenRequest, NegotiatedInput, OpenInput,
        StreamErrorFn,
    };
    use crate::engine_events::{engine_event_channel, EngineEvent, StreamErrorKind, StreamSide};
    use rtrb::{Consumer, Producer, RingBuffer};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    const ENGINE_RATE: f32 = 48_000.0;
    const DEVICE_CHANNELS: usize = 2;

    /// What the device advertises, and what it actually runs. The gap is the
    /// ordinary CoreAudio case and the reason the ring observes its cadence.
    const ADVERTISED_CEILING: usize = 4096;
    const DELIVERED_BLOCK: usize = 512;
    const RENDER_READ: usize = 512;

    /// Blocks the fake device hands over as soon as its stream starts. Enough
    /// to carry the ring past the depth it settles at for that cadence.
    const BLOCKS_AT_START: usize = 8;

    /// A machine with no input device.
    struct AbsentInput;

    /// A machine with one, running the engine's own rate.
    struct PresentInput;

    /// One that counts every time it is asked to open, so a test can observe
    /// an open that must never happen.
    struct CountedInput;

    static OPENS_ATTEMPTED: AtomicUsize = AtomicUsize::new(0);

    struct OpenTestInput(NegotiatedInput);

    impl InputBackend for AbsentInput {
        type Open = OpenTestInput;

        fn open_default_input(_request: InputOpenRequest) -> Result<Self::Open, InputOpenRefusal> {
            Err(InputOpenRefusal::NoDefaultInputDevice)
        }
    }

    impl InputBackend for PresentInput {
        type Open = OpenTestInput;

        fn open_default_input(request: InputOpenRequest) -> Result<Self::Open, InputOpenRefusal> {
            Ok(OpenTestInput(NegotiatedInput {
                sample_rate: request.engine_sample_rate,
                channels: DEVICE_CHANNELS,
                // The advertised ceiling, which is what a backend reports and
                // is deliberately not the size of the blocks below.
                period_frames: ADVERTISED_CEILING,
            }))
        }
    }

    impl InputBackend for CountedInput {
        type Open = OpenTestInput;

        fn open_default_input(request: InputOpenRequest) -> Result<Self::Open, InputOpenRefusal> {
            OPENS_ATTEMPTED.fetch_add(1, Ordering::Relaxed);
            PresentInput::open_default_input(request)
        }
    }

    impl OpenInput for OpenTestInput {
        type Stream = ();

        fn negotiated(&self) -> NegotiatedInput {
            self.0
        }

        /// Starting the stream delivers audio, the way a real backend does:
        /// blocks of what the device runs, not of what it advertised. Driving
        /// the capture closure is what makes this a test of the seam rather
        /// than of the call that builds it.
        fn start(
            self,
            mut capture: CaptureFn,
            _on_error: StreamErrorFn,
        ) -> Result<Self::Stream, InputOpenRefusal> {
            let block = vec![0.5f32; DELIVERED_BLOCK * DEVICE_CHANNELS];
            for _ in 0..BLOCKS_AT_START {
                capture(&block, DEVICE_CHANNELS);
            }
            Ok(())
        }
    }

    fn error_sink() -> StreamErrorFn {
        let (tx, _rx) = engine_event_channel();
        super::stream_error_sink(StreamSide::Input, tx)
    }

    /// The one-slot handoff `build_audio_stream` builds, in the shape a test
    /// can hold both ends of.
    fn feed_channel() -> (Producer<CaptureFeed>, Consumer<CaptureFeed>) {
        RingBuffer::new(1)
    }

    /// A refusal costs the capture side and nothing else: it has no failure
    /// channel back to the caller, so a stream build that reaches it cannot be
    /// stopped by a machine with no microphone.
    #[test]
    fn a_refused_capture_open_yields_no_capture_side_and_no_latency() {
        let slot = new_input_latency_slot();
        let refusal_slot = new_capture_refusal_slot();
        let (mut feed_tx, mut feed_rx) = feed_channel();

        let capture = capture_side(
            attach_capture::<AbsentInput>(ENGINE_RATE, error_sink(), Arc::clone(&slot)),
            &mut feed_tx,
            &slot,
            &refusal_slot,
        );

        assert!(capture.is_none(), "no input device means no capture side");
        assert!(
            feed_rx.pop().is_err(),
            "a renderer must not be handed a feed no device is writing"
        );
        assert_eq!(
            slot.load(Ordering::Relaxed),
            0,
            "an absent capture publishes no latency to compensate"
        );
    }

    /// The handoff itself: a feed reaches the renderer's slot, and its reader
    /// is the one the device that just started is writing into.
    #[test]
    fn an_opened_capture_hands_the_renderer_the_feed_its_device_writes() {
        let slot = new_input_latency_slot();
        let refusal_slot = new_capture_refusal_slot();
        let (mut feed_tx, mut feed_rx) = feed_channel();

        let stream = capture_side(
            attach_capture::<PresentInput>(ENGINE_RATE, error_sink(), Arc::clone(&slot)),
            &mut feed_tx,
            &slot,
            &refusal_slot,
        );

        assert!(stream.is_some(), "a present input device opens");
        let mut feed = feed_rx.pop().expect("the renderer's slot holds the feed");
        assert!(
            feed.serve(RENDER_READ),
            "the blocks the device delivered carry the ring past its target"
        );
    }

    /// A feed the renderer cannot be handed leaves no capture side at all. The
    /// alternative is a running input stream filling a ring nobody drains,
    /// which reports as a healthy capture and records nothing.
    #[test]
    fn a_feed_that_cannot_reach_the_renderer_yields_no_capture_side() {
        let slot = new_input_latency_slot();
        let refusal_slot = new_capture_refusal_slot();
        let (mut feed_tx, _feed_rx) = feed_channel();
        let (_taken, feed) =
            attach_capture::<PresentInput>(ENGINE_RATE, error_sink(), Arc::clone(&slot))
                .expect("a present input device opens");
        feed_tx.push(feed).expect("the slot starts empty");

        let stream = capture_side(
            attach_capture::<PresentInput>(ENGINE_RATE, error_sink(), Arc::clone(&slot)),
            &mut feed_tx,
            &slot,
            &refusal_slot,
        );

        assert!(stream.is_none(), "a feed with no reader is not a capture");
        assert_eq!(slot.load(Ordering::Relaxed), 0);
    }

    /// The figure the control side reads describes the cadence the stream
    /// runs, and it appears when the ring settles rather than when it opens.
    /// A device advertising 4096 while delivering 512 would otherwise publish
    /// eight times the delay a take actually suffered.
    #[test]
    fn an_opened_capture_publishes_the_latency_its_ring_settles_at() {
        let slot = new_input_latency_slot();
        let refusal_slot = new_capture_refusal_slot();
        let (mut feed_tx, mut feed_rx) = feed_channel();

        capture_side(
            attach_capture::<PresentInput>(ENGINE_RATE, error_sink(), Arc::clone(&slot)),
            &mut feed_tx,
            &slot,
            &refusal_slot,
        )
        .expect("a present input device opens");
        let mut feed = feed_rx.pop().expect("the renderer's slot holds the feed");

        assert_eq!(
            slot.load(Ordering::Relaxed),
            0,
            "an open that has not settled has no figure to publish"
        );

        assert!(
            feed.serve(RENDER_READ),
            "the blocks the device delivered carry the ring past its target"
        );

        assert_eq!(
            slot.load(Ordering::Relaxed),
            DELIVERED_BLOCK + target_depth_frames(DELIVERED_BLOCK, RENDER_READ)
        );
        assert!(
            slot.load(Ordering::Relaxed)
                < ADVERTISED_CEILING + target_depth_frames(ADVERTISED_CEILING, RENDER_READ),
            "the advertised ceiling must not be what the figure is built from"
        );
    }

    /// An engine whose output stream never started must not have asked for a
    /// microphone on the way down. On macOS the first input open is what
    /// raises the system permission prompt, so a failing engine that opened
    /// one would prompt the musician for access to a session that is already
    /// over.
    #[test]
    fn an_output_that_never_started_never_reaches_the_input_device() {
        let slot = new_input_latency_slot();
        let refusal_slot = new_capture_refusal_slot();
        let (tx, _rx) = engine_event_channel();
        let (mut feed_tx, _feed_rx) = feed_channel();
        let before = OPENS_ATTEMPTED.load(Ordering::Relaxed);

        let built = capture_beside::<(), CountedInput>(
            Err("Audio output device reports zero channels".to_string()),
            Some(tx),
            ENGINE_RATE,
            &slot,
            &mut feed_tx,
            &refusal_slot,
        );

        assert!(built.is_err(), "a failed output build stays failed");
        assert_eq!(
            OPENS_ATTEMPTED.load(Ordering::Relaxed),
            before,
            "a failing engine must not open an input device"
        );
        assert_eq!(slot.load(Ordering::Relaxed), 0);
    }

    /// The same call with a started output does open one — without which the
    /// test above would pass on a seam that never opens an input at all.
    #[test]
    fn a_started_output_is_what_lets_the_input_open() {
        let slot = new_input_latency_slot();
        let refusal_slot = new_capture_refusal_slot();
        let (tx, _rx) = engine_event_channel();
        let before = OPENS_ATTEMPTED.load(Ordering::Relaxed);

        let (mut feed_tx, mut feed_rx) = feed_channel();
        let (capture, ()) = capture_beside::<(), CountedInput>(
            Ok(()),
            Some(tx),
            ENGINE_RATE,
            &slot,
            &mut feed_tx,
            &refusal_slot,
        )
        .expect("a started output build stays started");

        assert!(capture.is_some());
        assert!(feed_rx.pop().is_ok(), "a started capture hands over a feed");
        assert_eq!(OPENS_ATTEMPTED.load(Ordering::Relaxed), before + 1);
    }

    /// A caller that asked for no capture gets none, and no input device is
    /// touched: handing over an event ring is the whole of asking.
    #[test]
    fn a_caller_that_asked_for_no_capture_opens_no_input_device() {
        let slot = new_input_latency_slot();
        let refusal_slot = new_capture_refusal_slot();
        let before = OPENS_ATTEMPTED.load(Ordering::Relaxed);

        let (mut feed_tx, mut feed_rx) = feed_channel();
        let (capture, ()) = capture_beside::<(), CountedInput>(
            Ok(()),
            None,
            ENGINE_RATE,
            &slot,
            &mut feed_tx,
            &refusal_slot,
        )
        .expect("a started output build stays started");

        assert!(capture.is_none());
        assert!(feed_rx.pop().is_err());
        assert_eq!(OPENS_ATTEMPTED.load(Ordering::Relaxed), before);
        assert_eq!(slot.load(Ordering::Relaxed), 0);
    }

    /// A refused open is not a silent one: the seam names it, and the name
    /// carries into the vocabulary every other device failure is reported in.
    #[test]
    fn a_refused_capture_open_names_what_refused() {
        let slot = new_input_latency_slot();
        let refusal = attach_capture::<AbsentInput>(ENGINE_RATE, error_sink(), slot)
            .err()
            .expect("a machine with no input device cannot open one");

        assert_eq!(refusal, InputOpenRefusal::NoDefaultInputDevice);
        assert_eq!(
            refusal.stream_error_kind(),
            StreamErrorKind::DeviceNotAvailable
        );
    }

    /// A refused open is not silent, but the event ring is no longer where
    /// it is named: `capture_side` stores the refusal's kind into the
    /// capture refusal slot instead, because `attach_capture`'s `on_error`
    /// cannot be trusted un-consumed once a refusal can also come from
    /// `open.start` (see `attach_capture`'s doc). Nothing crosses the ring
    /// for either refusal route. Mutation: delete the
    /// `capture_refusal_slot.store(refusal.stream_error_kind() as u8 + 1,
    /// Ordering::Relaxed)` call in `capture_side`'s open-refusal branch —
    /// the slot then reads zero and this goes red.
    #[test]
    fn a_refused_capture_open_stores_device_not_available_and_crosses_no_event() {
        let slot = new_input_latency_slot();
        let refusal_slot = new_capture_refusal_slot();
        let (tx, mut rx) = engine_event_channel();
        let (mut feed_tx, _feed_rx) = feed_channel();

        let capture = capture_side(
            attach_capture::<AbsentInput>(
                ENGINE_RATE,
                super::stream_error_sink(StreamSide::Input, tx),
                Arc::clone(&slot),
            ),
            &mut feed_tx,
            &slot,
            &refusal_slot,
        );

        assert!(capture.is_none(), "no input device means no capture side");
        assert_eq!(
            StreamErrorKind::from_slot(refusal_slot.load(Ordering::Relaxed)),
            Some(StreamErrorKind::DeviceNotAvailable)
        );
        assert!(
            rx.pop().is_err(),
            "no refusal crosses the event ring; the slot is the whole report"
        );
    }

    /// A machine whose input device opens cleanly but whose stream refuses
    /// to start — the shape every remaining start-route refusal takes now
    /// that the format check moved into `open_default_input`
    /// (`cpal_backend::CpalInputBackend::open_default_input`): a backend
    /// build error or a play error, both discovered only once `start` runs.
    struct BusyStartInput;

    struct BusyStartOpen(OpenTestInput);

    impl InputBackend for BusyStartInput {
        type Open = BusyStartOpen;

        fn open_default_input(request: InputOpenRequest) -> Result<Self::Open, InputOpenRefusal> {
            PresentInput::open_default_input(request).map(BusyStartOpen)
        }
    }

    impl OpenInput for BusyStartOpen {
        type Stream = ();

        fn negotiated(&self) -> NegotiatedInput {
            self.0.negotiated()
        }

        fn start(
            self,
            _capture: CaptureFn,
            _on_error: StreamErrorFn,
        ) -> Result<Self::Stream, InputOpenRefusal> {
            Err(InputOpenRefusal::Backend(StreamErrorKind::DeviceBusy))
        }
    }

    /// A start-route refusal is stored exactly like an open-route one:
    /// `capture_side` does not, and does not need to, distinguish which
    /// route produced the `Err` it was handed. Mutation: delete the
    /// `capture_refusal_slot.store(refusal.stream_error_kind() as u8 + 1,
    /// Ordering::Relaxed)` call in `capture_side`'s open-refusal branch —
    /// this goes red.
    #[test]
    fn a_start_refusal_stores_device_busy_and_leaves_no_latency() {
        let slot = new_input_latency_slot();
        let refusal_slot = new_capture_refusal_slot();
        let (mut feed_tx, _feed_rx) = feed_channel();

        let capture = capture_side(
            attach_capture::<BusyStartInput>(ENGINE_RATE, error_sink(), Arc::clone(&slot)),
            &mut feed_tx,
            &slot,
            &refusal_slot,
        );

        assert!(capture.is_none(), "a start refusal yields no capture side");
        assert_eq!(
            slot.load(Ordering::Relaxed),
            0,
            "a refused start publishes no latency to compensate"
        );
        assert_eq!(
            StreamErrorKind::from_slot(refusal_slot.load(Ordering::Relaxed)),
            Some(StreamErrorKind::DeviceBusy)
        );
    }

    /// The capture stream's error sink reports as the input side. Reporting a
    /// microphone that vanished as an output failure is the reading this
    /// tagging exists to prevent.
    #[test]
    fn the_capture_error_sink_reports_on_the_input_side() {
        let (tx, mut rx) = engine_event_channel();
        let mut sink = super::stream_error_sink(StreamSide::Input, tx);

        sink(StreamErrorKind::Xrun);

        assert_eq!(
            rx.pop(),
            Ok(EngineEvent::StreamError {
                side: StreamSide::Input,
                kind: StreamErrorKind::Xrun
            })
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{
        spawn_owned_audio_stream, spawn_owned_audio_stream_with_timeout,
        spawn_retirement_reclaimer, AudioThreadHandle, StreamWithReclaimerShutdown,
        AUDIO_STREAM_SHUTDOWN_TIMEOUT,
    };
    use cpal::{BufferSize, SupportedBufferSize};
    use rtrb::RingBuffer;
    use std::rc::Rc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    /// The stall is this many timeouts long, so a timeout that returns is
    /// unambiguously distinguished from one that waited the stall out, on any runner.
    const STALL_MULTIPLE: u32 = 20;

    struct ThreadBoundResource {
        created_on: thread::ThreadId,
        dropped_tx: mpsc::Sender<(thread::ThreadId, thread::ThreadId)>,
        _not_send: Rc<()>,
    }

    impl Drop for ThreadBoundResource {
        fn drop(&mut self) {
            self.dropped_tx
                .send((self.created_on, thread::current().id()))
                .expect("drop observation receiver should remain connected");
        }
    }

    struct BlockingDropResource {
        release_rx: mpsc::Receiver<()>,
        dropped_tx: mpsc::Sender<()>,
        _not_send: Rc<()>,
    }

    struct BlockingReclaimerProbe {
        entered_tx: mpsc::Sender<String>,
        release_rx: mpsc::Receiver<()>,
    }

    impl Drop for BlockingDropResource {
        fn drop(&mut self) {
            let _ = self.release_rx.recv();
            let _ = self.dropped_tx.send(());
        }
    }

    impl Drop for BlockingReclaimerProbe {
        fn drop(&mut self) {
            let thread_name = thread::current().name().unwrap_or("unnamed").to_string();
            let _ = self.entered_tx.send(thread_name);
            let _ = self.release_rx.recv();
        }
    }

    struct DropNotifier(mpsc::Sender<()>);

    impl Drop for DropNotifier {
        fn drop(&mut self) {
            let _ = self.0.send(());
        }
    }

    /// Declaration order drops `_stream` before `_notifier`, so the notification
    /// is sent only once the owner's stream teardown has returned.
    struct NotifyingStream {
        _stream: StreamWithReclaimerShutdown<()>,
        _notifier: DropNotifier,
    }

    #[test]
    fn a_device_that_cannot_exceed_the_callback_limit_keeps_its_buffer_preference_untouched() {
        // Asking rewrites a device-global, user-facing setting on CoreAudio, so
        // a device whose whole range the callback can already carry must not be
        // asked for anything at all.
        assert_eq!(
            super::negotiated_buffer_size(&SupportedBufferSize::Range { min: 64, max: 2048 }),
            BufferSize::Default
        );
    }

    #[test]
    fn a_device_topping_out_exactly_at_the_callback_limit_keeps_its_buffer_preference_untouched() {
        // The boundary is the whole gate: a 4096-frame ceiling is still within
        // the callback's reach, so there is nothing to prevent.
        assert_eq!(
            super::negotiated_buffer_size(&SupportedBufferSize::Range {
                min: 1024,
                max: super::MAX_CALLBACK_FRAMES as u32
            }),
            BufferSize::Default
        );
    }

    #[test]
    fn a_device_reaching_past_the_callback_limit_is_asked_for_the_preferred_period() {
        assert_eq!(
            super::negotiated_buffer_size(&SupportedBufferSize::Range { min: 64, max: 8192 }),
            BufferSize::Fixed(super::PREFERRED_BUFFER_FRAMES)
        );
    }

    #[test]
    fn a_device_reaching_past_the_limit_with_a_coarse_minimum_is_asked_for_that_minimum() {
        // The preferred period is unavailable here, so the request is clamped up
        // to the smallest period the device advertises — still within reach.
        assert_eq!(
            super::negotiated_buffer_size(&SupportedBufferSize::Range {
                min: 4096,
                max: 8192
            }),
            BufferSize::Fixed(super::MAX_CALLBACK_FRAMES as u32)
        );
    }

    #[test]
    fn a_device_whose_minimum_period_exceeds_the_callback_limit_keeps_the_device_default() {
        // Nothing this device can be asked for stays within reach, so mutating
        // its preference would buy nothing.
        assert_eq!(
            super::negotiated_buffer_size(&SupportedBufferSize::Range {
                min: 6144,
                max: 8192
            }),
            BufferSize::Default
        );
        assert_eq!(
            super::negotiated_buffer_size(&SupportedBufferSize::Range {
                min: 8192,
                max: 16384
            }),
            BufferSize::Default
        );
    }

    #[test]
    fn a_degenerate_empty_range_keeps_the_device_default_rather_than_asking_for_zero_frames() {
        assert_eq!(
            super::negotiated_buffer_size(&SupportedBufferSize::Range { min: 0, max: 0 }),
            BufferSize::Default
        );
    }

    #[test]
    fn a_device_advertising_no_buffer_range_keeps_the_device_default() {
        assert_eq!(
            super::negotiated_buffer_size(&SupportedBufferSize::Unknown),
            BufferSize::Default
        );
    }

    #[test]
    fn the_fallback_build_asks_for_nothing_even_where_negotiation_would_intervene() {
        // The retry exists because a `Fixed` request can be the sole reason a
        // build fails, so it must not carry one on any device.
        let negotiable = SupportedBufferSize::Range { min: 64, max: 8192 };

        assert_eq!(
            super::effective_buffer_size(&negotiable, false),
            BufferSize::Fixed(super::PREFERRED_BUFFER_FRAMES)
        );
        assert_eq!(
            super::effective_buffer_size(&negotiable, true),
            BufferSize::Default
        );
    }

    #[test]
    fn a_stereo_device_interleaves_left_and_right_unchanged() {
        let left = [0.25_f32, 0.5, 0.75];
        let right = [-0.25_f32, -0.5, -0.75];
        let mut chunk = [0.0_f32; 6];

        super::write_interleaved(&mut chunk, &left, &right, 2, 3);

        assert_eq!(chunk, [0.25, -0.25, 0.5, -0.5, 0.75, -0.75]);
    }

    #[test]
    fn a_mono_device_downmixes_as_the_average_of_both_channels() {
        let left = [1.0_f32, 0.0];
        let right = [-1.0_f32, 0.5];
        let mut chunk = [0.0_f32; 2];

        super::write_interleaved(&mut chunk, &left, &right, 1, 2);

        // (1.0 + -1.0) / 2 = 0.0, (0.0 + 0.5) / 2 = 0.25
        assert_eq!(chunk, [0.0, 0.25]);
    }

    #[test]
    fn a_multichannel_device_gets_the_stereo_pair_on_the_first_two_channels_and_silence_elsewhere()
    {
        let left = [0.6_f32];
        let right = [0.3_f32];
        // A 6-channel (5.1) device: one frame is 6 interleaved samples.
        let mut chunk = [9.0_f32; 6];

        super::write_interleaved(&mut chunk, &left, &right, 6, 1);

        assert_eq!(chunk, [0.6, 0.3, 0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn audio_thread_handle_uses_only_derived_thread_traits() {
        let source = include_str!("audio_thread.rs");
        let unsafe_send = ["unsafe impl ", "Send for AudioThreadHandle"].concat();
        let unsafe_sync = ["unsafe impl ", "Sync for AudioThreadHandle"].concat();

        fn assert_send<T: Send>() {}

        assert!(!source.contains(&unsafe_send));
        assert!(!source.contains(&unsafe_sync));
        assert_send::<AudioThreadHandle>();
    }

    #[test]
    fn owned_stream_is_created_and_dropped_on_its_owner_thread() {
        let (dropped_tx, dropped_rx) = mpsc::channel();
        let handle = spawn_owned_audio_stream(move || {
            Ok(ThreadBoundResource {
                created_on: thread::current().id(),
                dropped_tx,
                _not_send: Rc::new(()),
            })
        })
        .expect("owner thread should start");

        assert_eq!(dropped_rx.try_recv(), Err(mpsc::TryRecvError::Empty));

        thread::spawn(move || drop(handle))
            .join()
            .expect("handle should be droppable from a different thread");

        let (created_on, dropped_on) = dropped_rx
            .recv()
            .expect("owned resource should report its drop thread");
        assert_eq!(dropped_on, created_on);
    }

    #[test]
    fn bounded_reclaimer_does_not_delay_audio_owner_shutdown() {
        let (mut retired_tx, retired_rx) = RingBuffer::new(3);
        let (reclaimer_shutdown_tx, _retired_adoption_tx) =
            spawn_retirement_reclaimer(retired_rx).expect("reclaimer should start");
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        retired_tx
            .push(BlockingReclaimerProbe {
                entered_tx,
                release_rx,
            })
            .unwrap();
        let drop_thread = entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("reclaimer should enter the blocking destructor");
        assert_eq!(drop_thread, "sourdaw-plugin-reclaimer");

        let (dropped_tx, dropped_rx) = mpsc::channel();
        let handle = spawn_owned_audio_stream(move || {
            Ok(NotifyingStream {
                _stream: StreamWithReclaimerShutdown(Some(()), reclaimer_shutdown_tx),
                _notifier: DropNotifier(dropped_tx),
            })
        })
        .expect("audio owner should start");
        drop(handle);
        // The reclaimer is still blocked here, because its release is sent only
        // afterwards, so receiving the drop notification proves the owner's
        // teardown did not wait on it.
        dropped_rx.recv_timeout(Duration::from_secs(1)).expect(
            "the owner must finish dropping its stream while the reclaimer is still blocked",
        );

        release_tx.send(()).unwrap();
    }

    #[test]
    fn owner_thread_reports_stream_startup_failure() {
        let result = spawn_owned_audio_stream::<ThreadBoundResource, _>(|| {
            Err("audio device unavailable".to_string())
        });
        let error = match result {
            Ok(_) => panic!("startup failure should not return a handle"),
            Err(error) => error,
        };

        assert_eq!(error, "audio device unavailable");
    }

    /// The release thread sets the flag before releasing the stall, so a call that waited the stall out sees it set.
    #[test]
    fn stalled_stream_startup_times_out_without_stranding_the_owner_resource() {
        const STALLED_STARTUP_TIMEOUT: Duration = Duration::from_millis(100);

        let (release_tx, release_rx) = mpsc::channel();
        let (dropped_tx, dropped_rx) = mpsc::channel();
        let released = Arc::new(AtomicBool::new(false));
        let release_flag = Arc::clone(&released);
        let release_thread = thread::spawn(move || {
            thread::sleep(STALLED_STARTUP_TIMEOUT * STALL_MULTIPLE);
            release_flag.store(true, Ordering::SeqCst);
            release_tx
                .send(())
                .expect("owner thread should still be waiting");
        });

        let result = spawn_owned_audio_stream_with_timeout(
            move || {
                release_rx
                    .recv()
                    .expect("startup release should remain connected");
                Ok(ThreadBoundResource {
                    created_on: thread::current().id(),
                    dropped_tx,
                    _not_send: Rc::new(()),
                })
            },
            STALLED_STARTUP_TIMEOUT,
        );
        let error = match result {
            Ok(handle) => {
                drop(handle);
                panic!("stalled startup should time out");
            }
            Err(error) => error,
        };

        assert_eq!(error, "Timed out waiting for audio stream startup");
        assert!(
            !released.load(Ordering::SeqCst),
            "the startup timeout must return before the stall releases"
        );
        release_thread.join().expect("release thread should finish");
        let (created_on, dropped_on) = dropped_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("late owner resource should still be dropped");
        assert_eq!(dropped_on, created_on);
    }

    /// This is how long a handle drop may block on a stalled stream teardown, which is what quitting
    /// or switching devices waits on, so raising it is a product decision that must be made here
    /// rather than inherited from an unrelated edit.
    #[test]
    fn audio_stream_shutdown_timeout_is_a_deliberate_product_bound() {
        assert_eq!(AUDIO_STREAM_SHUTDOWN_TIMEOUT, Duration::from_millis(100));
    }

    /// The release thread sets the flag before releasing the stall, so a call that waited the stall out sees it set.
    #[test]
    fn stalled_stream_teardown_cannot_block_handle_drop_indefinitely() {
        let (release_tx, release_rx) = mpsc::channel();
        let (dropped_tx, dropped_rx) = mpsc::channel();
        let handle = spawn_owned_audio_stream(move || {
            Ok(BlockingDropResource {
                release_rx,
                dropped_tx,
                _not_send: Rc::new(()),
            })
        })
        .expect("owner thread should start");
        let released = Arc::new(AtomicBool::new(false));
        let release_flag = Arc::clone(&released);
        let release_thread = thread::spawn(move || {
            thread::sleep(AUDIO_STREAM_SHUTDOWN_TIMEOUT * STALL_MULTIPLE);
            release_flag.store(true, Ordering::SeqCst);
            release_tx
                .send(())
                .expect("owner thread should still be waiting");
        });

        drop(handle);

        assert!(
            !released.load(Ordering::SeqCst),
            "the shutdown timeout must return before the stall releases"
        );
        release_thread.join().expect("release thread should finish");
        dropped_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("detached owner should finish after teardown unblocks");
    }
}

/// The native input path, driven through the production render callback.
///
/// [`DeviceRenderer::render`] is where a capture ring becomes a block on the
/// scheduler's input bus, so these drive that method with a device buffer of
/// their own and a feed handed over exactly as the capture side hands one over.
#[cfg(test)]
mod capture_render_tests {
    use super::{CaptureFeed, DeviceRenderer, MAX_CALLBACK_FRAMES};
    use crate::capture::{capture_ring, target_depth_frames, CaptureRingWriter, CaptureShape};
    use crate::midi::diagnostics::{
        active_midi_rt_diagnostics_channel, ActiveMidiRtDiagnosticsReader,
        ActiveMidiRtDiagnosticsSnapshot,
    };
    use crate::plugin_slot::{CaptureInputBlock, NativePlugin};
    use crate::scheduler::{
        graph_progress_channel, master_meter_channel, transport_position_channel, AudioScheduler,
        GraphCommand, RetiredGraphObjects,
    };
    use crate::timeline::timeline_rt_diagnostics_channel;
    use rtrb::{Consumer, Producer, RingBuffer};
    use std::any::Any;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    const SAMPLE_RATE: f32 = 48_000.0;
    const OUTPUT_CHANNELS: usize = 2;
    const COMMAND_CAPACITY: usize = 32;
    const CONSUMER_ID: usize = 77;
    /// What the fake input device delivers, and what the render callback asks
    /// for — deliberately different, because they are two devices' periods.
    const DEVICE_BLOCK: usize = 128;
    const CALLBACK_FRAMES: usize = 512;
    /// Enough blocks to carry the ring past the depth this cadence settles at
    /// and leave a few whole reads behind it.
    const BLOCKS_AT_START: usize = 16;

    /// One delivered block, copied out of the borrowed one the callback hands
    /// over.
    struct RecordedCapture {
        left: Vec<f32>,
        right: Vec<f32>,
        frames: usize,
        served: bool,
        latency_frames: usize,
        position_frames: u64,
    }

    struct CaptureRecordingPlugin {
        recorded: Arc<Mutex<Vec<RecordedCapture>>>,
    }

    impl NativePlugin for CaptureRecordingPlugin {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

        fn process_capture_input(&mut self, block: CaptureInputBlock<'_>) {
            self.recorded
                .lock()
                .expect("capture record lock")
                .push(RecordedCapture {
                    left: block.left.to_vec(),
                    right: block.right.to_vec(),
                    frames: block.frames,
                    served: block.served,
                    latency_frames: block.latency_frames,
                    position_frames: block.position_frames,
                });
        }

        fn name(&self) -> &str {
            "capture-recording-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// The render callback plus every end a test needs to drive it: commands
    /// in, retirements out, one capture feed to hand over, diagnostics back.
    struct RenderHarness {
        command_tx: Producer<GraphCommand>,
        retired_rx: Consumer<RetiredGraphObjects>,
        feed_tx: Producer<CaptureFeed>,
        renderer: DeviceRenderer,
        diagnostics: ActiveMidiRtDiagnosticsReader,
    }

    impl RenderHarness {
        fn new() -> Self {
            let (command_tx, command_rx) = RingBuffer::new(COMMAND_CAPACITY);
            let (retired_tx, retired_rx) = RingBuffer::new(COMMAND_CAPACITY + 1);
            let (midi_diagnostics_tx, diagnostics) = active_midi_rt_diagnostics_channel();
            let (timeline_diagnostics_tx, _timeline_reader) = timeline_rt_diagnostics_channel();
            let (graph_progress_tx, _progress_reader) = graph_progress_channel();
            let (transport_position_tx, _position_reader) = transport_position_channel();
            let (master_meter_tx, _meter_reader) = master_meter_channel();
            let scheduler = AudioScheduler::with_rt_diagnostics(
                command_rx,
                retired_tx,
                SAMPLE_RATE,
                midi_diagnostics_tx,
                timeline_diagnostics_tx,
                graph_progress_tx,
                transport_position_tx,
                master_meter_tx,
            );
            let (feed_tx, feed_rx) = RingBuffer::new(1);
            Self {
                command_tx,
                retired_rx,
                feed_tx,
                renderer: DeviceRenderer::new(scheduler, feed_rx),
                diagnostics,
            }
        }

        fn send(&mut self, command: GraphCommand) {
            self.command_tx
                .push(command)
                .map_err(|_| "the command ring should hold this test's batch")
                .expect("push");
        }

        fn register_consumer(&mut self, plugin: Box<dyn NativePlugin>) {
            self.send(GraphCommand::AddPlugin(CONSUMER_ID, plugin));
            self.send(GraphCommand::RegisterCaptureConsumer(CONSUMER_ID));
        }

        fn render(&mut self, frames: usize) {
            let mut data = vec![0.0f32; frames * OUTPUT_CHANNELS];
            self.renderer.render(&mut data, OUTPUT_CHANNELS);
            // This thread is both the command side and the render side, so
            // freeing here is safe and keeps the retirement ring moving.
            while self.retired_rx.pop().is_ok() {}
        }

        fn rt_diagnostics(&mut self) -> ActiveMidiRtDiagnosticsSnapshot {
            self.diagnostics.snapshot()
        }
    }

    /// A feed on a ring nothing has written yet, plus the writer that stands
    /// in for the device's capture callback.
    fn capture_feed(channels: usize) -> (CaptureRingWriter, CaptureFeed) {
        let (writer, reader) = capture_ring(
            CaptureShape {
                input_block_ceiling: MAX_CALLBACK_FRAMES,
                output_read_ceiling: MAX_CALLBACK_FRAMES,
                channels,
            },
            Arc::new(AtomicUsize::new(0)),
        );
        (writer, CaptureFeed::new(reader, channels))
    }

    /// The device's own sample for one channel of one absolute frame. Distinct
    /// per channel and per frame, so a deinterleave that crossed the two or
    /// slipped a frame is visible rather than plausible.
    fn device_sample(frame: usize, channel: usize) -> f32 {
        (frame + 1) as f32 * if channel == 0 { 1.0 } else { -1.0 }
    }

    /// Write what a running device would have written by the time the first
    /// render callback arrives.
    fn write_blocks(writer: &mut CaptureRingWriter, channels: usize, blocks: usize) {
        let mut frame = 0;
        for _ in 0..blocks {
            let mut block = Vec::with_capacity(DEVICE_BLOCK * channels);
            for _ in 0..DEVICE_BLOCK {
                for channel in 0..channels {
                    block.push(device_sample(frame, channel));
                }
                frame += 1;
            }
            writer.write_block(&block, channels);
        }
    }

    fn expected_channel(channel: usize) -> Vec<f32> {
        (0..CALLBACK_FRAMES)
            .map(|frame| device_sample(frame, channel))
            .collect()
    }

    /// No input device is not a gap. A renderer with no feed must deliver
    /// nothing at all, rather than delivering silence a recorder would write
    /// as a dropout for the life of the session.
    #[test]
    fn a_renderer_with_no_feed_delivers_no_capture_block_at_all() {
        let mut harness = RenderHarness::new();
        let recorded = Arc::new(Mutex::new(Vec::new()));
        harness.register_consumer(Box::new(CaptureRecordingPlugin {
            recorded: Arc::clone(&recorded),
        }));

        for _ in 0..4 {
            harness.render(CALLBACK_FRAMES);
        }

        assert!(
            recorded.lock().expect("capture record lock").is_empty(),
            "a registered consumer must hear nothing while no device feeds one"
        );
        let diagnostics = harness.rt_diagnostics();
        assert_eq!(
            diagnostics.capture_input_underruns, 0,
            "an engine with no input device suffers no capture shortfall"
        );
        assert_eq!(diagnostics.capture_blocks_dropped, 0);
    }

    /// The handoff, end to end: the feed arrives after the renderer is already
    /// inside its stream, and the very next callback delivers the audio the
    /// device wrote — deinterleaved, with the ring's own settled latency.
    #[test]
    fn a_feed_pushed_after_the_renderer_was_built_reaches_the_consumer_next_callback() {
        let mut harness = RenderHarness::new();
        let recorded = Arc::new(Mutex::new(Vec::new()));
        harness.register_consumer(Box::new(CaptureRecordingPlugin {
            recorded: Arc::clone(&recorded),
        }));
        harness.render(CALLBACK_FRAMES);
        assert!(recorded.lock().expect("capture record lock").is_empty());

        let (mut writer, feed) = capture_feed(OUTPUT_CHANNELS);
        write_blocks(&mut writer, OUTPUT_CHANNELS, BLOCKS_AT_START);
        harness.feed_tx.push(feed).expect("the slot starts empty");

        harness.render(CALLBACK_FRAMES);

        let recorded = recorded.lock().expect("capture record lock");
        assert_eq!(recorded.len(), 1, "one callback delivers one chunk");
        assert!(recorded[0].served);
        assert_eq!(recorded[0].frames, CALLBACK_FRAMES);
        assert_eq!(recorded[0].position_frames, 0);
        assert_eq!(
            recorded[0].latency_frames,
            DEVICE_BLOCK + target_depth_frames(DEVICE_BLOCK, CALLBACK_FRAMES),
            "the block carries the figure the ring settled at, for the take offset"
        );
        assert_eq!(recorded[0].left, expected_channel(0));
        assert_eq!(recorded[0].right, expected_channel(1));
    }

    /// A stereo device's channels reach the sides they belong to. Crossed or
    /// slipped, a take records with its image reversed and nothing says so.
    #[test]
    fn a_stereo_input_maps_channel_zero_to_left_and_channel_one_to_right() {
        let mut harness = RenderHarness::new();
        let recorded = Arc::new(Mutex::new(Vec::new()));
        harness.register_consumer(Box::new(CaptureRecordingPlugin {
            recorded: Arc::clone(&recorded),
        }));
        let (mut writer, feed) = capture_feed(2);
        write_blocks(&mut writer, 2, BLOCKS_AT_START);
        harness.feed_tx.push(feed).expect("the slot starts empty");

        harness.render(CALLBACK_FRAMES);

        let recorded = recorded.lock().expect("capture record lock");
        assert_eq!(recorded[0].left, expected_channel(0));
        assert_eq!(recorded[0].right, expected_channel(1));
        assert_ne!(
            recorded[0].left, recorded[0].right,
            "a stereo device's two channels must not arrive as one"
        );
    }

    /// A mono interface records to both sides, the way every DAW treats a
    /// mono source on a stereo recorder. Left alone, a single-input interface
    /// would record takes that exist only on the left.
    #[test]
    fn a_mono_input_duplicates_its_one_channel_into_both_sides() {
        let mut harness = RenderHarness::new();
        let recorded = Arc::new(Mutex::new(Vec::new()));
        harness.register_consumer(Box::new(CaptureRecordingPlugin {
            recorded: Arc::clone(&recorded),
        }));
        let (mut writer, feed) = capture_feed(1);
        write_blocks(&mut writer, 1, BLOCKS_AT_START);
        harness.feed_tx.push(feed).expect("the slot starts empty");

        harness.render(CALLBACK_FRAMES);

        let recorded = recorded.lock().expect("capture record lock");
        assert!(recorded[0].served);
        assert_eq!(recorded[0].left, expected_channel(0));
        assert_eq!(
            recorded[0].right, recorded[0].left,
            "a mono device's one channel has to reach both sides"
        );
    }

    /// The capture position is a timeline, so it counts every chunk the feed
    /// was asked for — including the ones the ring could not serve. A counter
    /// that skipped a starved chunk would let a recorder splice across the
    /// gap and place everything after it early by the length of the dropout.
    #[test]
    fn the_capture_position_advances_on_served_and_starved_chunks_alike() {
        const CALLBACKS: usize = 8;

        let mut harness = RenderHarness::new();
        let recorded = Arc::new(Mutex::new(Vec::new()));
        harness.register_consumer(Box::new(CaptureRecordingPlugin {
            recorded: Arc::clone(&recorded),
        }));
        // Written once and never topped up, so the ring serves a few reads and
        // then starves while the callbacks keep coming.
        let (mut writer, feed) = capture_feed(OUTPUT_CHANNELS);
        write_blocks(&mut writer, OUTPUT_CHANNELS, BLOCKS_AT_START);
        harness.feed_tx.push(feed).expect("the slot starts empty");

        for _ in 0..CALLBACKS {
            harness.render(CALLBACK_FRAMES);
        }

        let recorded = recorded.lock().expect("capture record lock");
        assert_eq!(recorded.len(), CALLBACKS);
        for (index, block) in recorded.iter().enumerate() {
            assert_eq!(
                block.position_frames,
                (index * CALLBACK_FRAMES) as u64,
                "chunk {index} broke the capture timeline"
            );
        }
        let starved = recorded.iter().filter(|block| !block.served).count();
        assert!(
            starved > 0 && starved < CALLBACKS,
            "this cadence has to serve some chunks and starve on others, not one or the other"
        );
        for block in recorded.iter().filter(|block| !block.served) {
            assert!(
                block.left.iter().all(|sample| *sample == 0.0)
                    && block.right.iter().all(|sample| *sample == 0.0),
                "a starved chunk is silence, never the samples of the one before it"
            );
        }
        assert_eq!(
            harness.rt_diagnostics().capture_input_underruns,
            starved as u64
        );
    }

    /// The allocation guard for the capture path inside the render callback.
    ///
    /// The interceptor is installed as the test binary's global allocator by
    /// the scheduler's own guards and exists only in debug builds
    /// (`assert_no_alloc`'s `disable_release` feature is on by default), which
    /// is why this module is `#[cfg(debug_assertions)]`.
    #[cfg(debug_assertions)]
    mod capture_render_alloc_guards {
        use super::*;
        use assert_no_alloc::assert_no_alloc;

        struct CaptureCountingPlugin {
            blocks: Arc<AtomicUsize>,
            served: Arc<AtomicUsize>,
        }

        impl NativePlugin for CaptureCountingPlugin {
            fn process_audio(
                &mut self,
                _left: &mut [f32],
                _right: &mut [f32],
                _num_samples: usize,
            ) {
            }

            fn process_capture_input(&mut self, block: CaptureInputBlock<'_>) {
                self.blocks.fetch_add(1, Ordering::Relaxed);
                if block.served {
                    self.served.fetch_add(1, Ordering::Relaxed);
                }
            }

            fn name(&self) -> &str {
                "capture-counting-plugin"
            }

            fn as_any(&self) -> &dyn Any {
                self
            }

            fn as_any_mut(&mut self) -> &mut dyn Any {
                self
            }
        }

        #[test]
        fn the_render_callback_with_a_feed_allocates_nothing() {
            const CALLBACKS: usize = 8;

            let mut harness = RenderHarness::new();
            let blocks = Arc::new(AtomicUsize::new(0));
            let served = Arc::new(AtomicUsize::new(0));
            harness.register_consumer(Box::new(CaptureCountingPlugin {
                blocks: Arc::clone(&blocks),
                served: Arc::clone(&served),
            }));
            let (mut writer, feed) = capture_feed(OUTPUT_CHANNELS);
            write_blocks(&mut writer, OUTPUT_CHANNELS, BLOCKS_AT_START);
            harness.feed_tx.push(feed).expect("the slot starts empty");
            // Sized outside, the way a device buffer is: the callback is what
            // is under test, not the buffer it is handed.
            let mut data = vec![0.0f32; CALLBACK_FRAMES * OUTPUT_CHANNELS];

            assert_no_alloc(|| {
                // Every arm of the path: the drain that registers the
                // consumer, the pop that adopts the feed, the served read and
                // its deinterleave, the delivery, and the starved reads after
                // the ring runs dry.
                for _ in 0..CALLBACKS {
                    harness.renderer.render(&mut data, OUTPUT_CHANNELS);
                }
            });

            assert_eq!(blocks.load(Ordering::Relaxed), CALLBACKS);
            let served = served.load(Ordering::Relaxed);
            assert!(
                served > 0 && served < CALLBACKS,
                "the guarded run has to cover both the served and the starved arm"
            );
            while harness.retired_rx.pop().is_ok() {}
        }
    }
}

/// What the device is handed, driven through the production render callback.
///
/// [`DeviceRenderer::render`] is the callback the device seam carries. The
/// shadow gate is applied there and nowhere else, and the master meter
/// measures the same buffer that gate decides the contents of, so both are
/// properties of this one method — these drive it directly with a device
/// buffer of their own rather than a device.
#[cfg(test)]
mod device_output_tests {
    use super::DeviceRenderer;
    use crate::midi::diagnostics::active_midi_rt_diagnostics_channel;
    use crate::plugin_slot::TransportState;
    use crate::scheduler::{
        graph_progress_channel, master_meter_channel, transport_position_channel, AudioScheduler,
        GraphCommand, GraphProgressReader, GraphProgressSnapshot, MasterMeterReader,
        RetiredGraphObjects, PEAK_HOLD_RELEASES_PER_SECOND,
    };
    use crate::timeline::{
        timeline_rt_diagnostics_channel, ClipPlacement, ClipPlayback, TimelineClip, TimelineTrack,
    };
    use crate::transport_map::{LoopRegion, MIN_LOOP_FRAMES};
    use rtrb::{Consumer, Producer, RingBuffer};

    const SAMPLE_RATE: f32 = 48_000.0;
    const DEVICE_CHANNELS: usize = 2;
    /// Left channel sample: subtle to catch one-channel folds.
    const LEFT_SAMPLE: f32 = 0.5;
    /// Right channel sample: louder and negative to catch averaging and missing abs().
    const RIGHT_SAMPLE: f32 = -0.75;
    /// The true peak across both channels: the magnitude the meter must report.
    const MATERIAL_PEAK: f32 = 0.75;
    const COMMAND_CAPACITY: usize = 32;

    /// How long a peak stands before a quieter callback replaces it, derived
    /// the way the scheduler derives it so the bracket below stays true when
    /// the release rate moves.
    fn peak_hold_frames() -> usize {
        (SAMPLE_RATE / PEAK_HOLD_RELEASES_PER_SECOND) as usize
    }

    /// The render callback plus the control side of its command ring.
    struct DeviceHarness {
        command_tx: Producer<GraphCommand>,
        retired_rx: Consumer<RetiredGraphObjects>,
        renderer: DeviceRenderer,
        progress: GraphProgressReader,
        meter: MasterMeterReader,
    }

    impl DeviceHarness {
        fn new() -> Self {
            let (command_tx, command_rx) = RingBuffer::new(COMMAND_CAPACITY);
            let (retired_tx, retired_rx) = RingBuffer::new(COMMAND_CAPACITY + 1);
            let (midi_diagnostics_tx, _midi_reader) = active_midi_rt_diagnostics_channel();
            let (timeline_diagnostics_tx, _timeline_reader) = timeline_rt_diagnostics_channel();
            let (graph_progress_tx, progress) = graph_progress_channel();
            let (transport_position_tx, _position_reader) = transport_position_channel();
            let (master_meter_tx, meter) = master_meter_channel();
            let scheduler = AudioScheduler::with_rt_diagnostics(
                command_rx,
                retired_tx,
                SAMPLE_RATE,
                midi_diagnostics_tx,
                timeline_diagnostics_tx,
                graph_progress_tx,
                transport_position_tx,
                master_meter_tx,
            );
            // No capture side: this module drives the monitor gate, and the
            // renderer with no feed delivers no input at all.
            let (_capture_feed_tx, capture_feed_rx) = RingBuffer::new(1);
            Self {
                command_tx,
                retired_rx,
                renderer: DeviceRenderer::new(scheduler, capture_feed_rx),
                progress,
                meter,
            }
        }

        fn send(&mut self, command: GraphCommand) {
            self.command_tx
                .push(command)
                .map_err(|_| "the command ring should hold this test's batch")
                .expect("push");
        }

        /// One device callback of `frames`, returning the interleaved buffer
        /// the device would have played.
        fn render(&mut self, frames: usize) -> Vec<f32> {
            self.render_with_channels(frames, DEVICE_CHANNELS)
        }

        /// One device callback of `frames` on a device exposing `channels`
        /// channels, returning the interleaved buffer the device would have
        /// played.
        fn render_with_channels(&mut self, frames: usize, channels: usize) -> Vec<f32> {
            let mut data = vec![0.0f32; frames * channels];
            self.renderer.render(&mut data, channels);
            // This thread is both the command side and the render side, so
            // freeing here is safe and keeps the retirement ring from
            // stalling the next drain.
            while self.retired_rx.pop().is_ok() {}
            data
        }

        fn progress(&mut self) -> GraphProgressSnapshot {
            self.progress.snapshot()
        }

        /// The master peak the last callback published — what a UI poll
        /// landing between callbacks would read.
        fn master_peak(&mut self) -> f32 {
            self.meter.snapshot().peak
        }
    }

    /// A track holding one clip with asymmetric material from frame zero, and a
    /// rolling transport — the smallest schedule whose device output is
    /// unmistakably non-zero. The left and right channels differ in magnitude and
    /// sign so that a fold missing either channel, dropping abs(), or averaging
    /// would produce a different peak than the true maximum.
    fn schedule_rolling_material(harness: &mut DeviceHarness, frames: usize) {
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddClip(
            1,
            TimelineClip::new(
                7,
                vec![LEFT_SAMPLE; frames].into(),
                vec![RIGHT_SAMPLE; frames].into(),
                ClipPlacement {
                    start_frame: 0,
                    source_offset_frames: 0,
                    length_frames: frames as u64,
                },
                ClipPlayback::at_gain(1.0),
            ),
        ));
        harness.send(GraphCommand::SetTransport(TransportState {
            is_playing: true,
            ..TransportState::default()
        }));
    }

    /// The gate's whole claim, against the one schedule that proves both
    /// halves: the same commands sound at the device unshadowed, and write
    /// exact zeros shadowed. A gate that leaked would fail the second
    /// assertion; one that over-muted — silencing the render rather than the
    /// output — would fail the first.
    #[test]
    fn a_shadowed_monitor_writes_true_zeros_where_the_same_schedule_sounds() {
        const FRAMES: usize = 512;

        let mut audible = DeviceHarness::new();
        schedule_rolling_material(&mut audible, FRAMES);
        let heard = audible.render(FRAMES);

        let mut shadowed = DeviceHarness::new();
        schedule_rolling_material(&mut shadowed, FRAMES);
        shadowed.send(GraphCommand::SetMonitorShadow(true));
        let silent = shadowed.render(FRAMES);

        assert!(
            heard.iter().any(|sample| *sample != 0.0),
            "the unshadowed schedule must reach the device, or the silent half proves nothing"
        );
        assert_eq!(heard[0], LEFT_SAMPLE);
        assert!(
            silent.iter().all(|sample| *sample == 0.0),
            "a shadowed monitor writes true zeros, not a small gain"
        );
    }

    /// The cutover the gate exists to make possible: lifting the shadow on a
    /// rolling session restores the device output at the next block boundary,
    /// with no restart and no reschedule.
    #[test]
    fn lifting_the_shadow_restores_the_device_output_mid_session() {
        const FRAMES: usize = 512;

        let mut harness = DeviceHarness::new();
        schedule_rolling_material(&mut harness, FRAMES * 4);
        harness.send(GraphCommand::SetMonitorShadow(true));
        let while_shadowed = harness.render(FRAMES);

        harness.send(GraphCommand::SetMonitorShadow(false));
        let after_cutover = harness.render(FRAMES);

        assert!(while_shadowed.iter().all(|sample| *sample == 0.0));
        assert!(after_cutover.iter().any(|sample| *sample != 0.0));
        assert_eq!(after_cutover[0], LEFT_SAMPLE);
    }

    /// The shadow silences the output, never the clock. A shadowed engine
    /// still advances its playhead and still closes a loop seam on its own
    /// sample, which is the whole reason the gate sits at the device write
    /// rather than anywhere upstream of it.
    #[test]
    fn a_shadowed_engine_still_advances_the_playhead_and_walks_a_loop_seam() {
        const FRAMES: usize = 512;
        /// Past the first callback's end, so the seam falls inside the second
        /// one and the test observes a callback that is split by it rather
        /// than one that merely stops on it.
        const LOOP_END: u64 = MIN_LOOP_FRAMES + 256;

        let mut harness = DeviceHarness::new();
        schedule_rolling_material(&mut harness, FRAMES * 4);
        harness.send(GraphCommand::SetLoopRegion(LoopRegion {
            enabled: true,
            start_frame: 0,
            end_frame: LOOP_END,
        }));
        harness.send(GraphCommand::SetMonitorShadow(true));

        let first = harness.render(FRAMES);
        let progressed = harness.progress();
        assert!(first.iter().all(|sample| *sample == 0.0));
        assert_eq!(progressed.playhead_frame, FRAMES as u64);
        assert_eq!(progressed.loop_wraps, 0);

        // The second callback crosses the region's end: the seam closes inside
        // it, and the walk continues from the region's start.
        let across_the_seam = harness.render(FRAMES);
        let wrapped = harness.progress();

        assert!(
            across_the_seam.iter().all(|sample| *sample == 0.0),
            "the seam must not leak a frame past the gate either"
        );
        assert_eq!(wrapped.loop_wraps, 1);
        assert_eq!(wrapped.last_wrap_frame, LOOP_END);
        assert_eq!(wrapped.playhead_frame, FRAMES as u64 * 2 - LOOP_END);
    }

    /// The meter's own claim: the level it publishes is the level the device
    /// was handed, measured as the maximum absolute value across both channels.
    /// The render is unity from the clip's gain through the master fader, so a
    /// meter that folded only one channel, dropped abs(), or averaged the pair
    /// would land somewhere other than the true peak.
    #[test]
    fn the_master_meter_publishes_the_peak_the_device_was_handed() {
        const FRAMES: usize = 512;

        let mut harness = DeviceHarness::new();
        schedule_rolling_material(&mut harness, FRAMES);
        let heard = harness.render(FRAMES);

        // Interleaved stereo: index 0 is left, index 1 is right.
        assert_eq!(heard[0], LEFT_SAMPLE);
        assert_eq!(heard[1], RIGHT_SAMPLE);
        assert_eq!(harness.master_peak(), MATERIAL_PEAK);
    }

    /// A meter fed per callback and read per animation frame needs the hold:
    /// the poll lands between callbacks, and the callback it lands after is
    /// rarely the loud one. So a peak stands for the hold window and falls
    /// only once the window has passed — never on the next quiet block.
    #[test]
    fn a_peak_stands_through_the_hold_window_and_falls_after_it() {
        const FRAMES: usize = 512;

        let mut harness = DeviceHarness::new();
        // Material for exactly one callback: every callback after the first
        // renders past the clip and hands the device silence.
        schedule_rolling_material(&mut harness, FRAMES);
        harness.render(FRAMES);
        assert_eq!(harness.master_peak(), MATERIAL_PEAK);

        harness.render(FRAMES);
        assert_eq!(
            harness.master_peak(),
            MATERIAL_PEAK,
            "one callback of silence is well inside the hold window; a meter that fell here \
             would read zero for every transient a poll did not happen to land on"
        );

        // The hold releases on a callback boundary, so the fall lands on the
        // first callback whose accumulated silence has passed the window —
        // within one further callback of it, never before it.
        let mut silent_frames = FRAMES;
        while harness.master_peak() != 0.0 {
            assert!(
                silent_frames < peak_hold_frames() + 2 * FRAMES,
                "the hold must release: the peak still stood after {silent_frames} silent frames"
            );
            harness.render(FRAMES);
            silent_frames += FRAMES;
        }

        assert!(
            silent_frames > peak_hold_frames(),
            "the peak fell after {silent_frames} silent frames, short of the hold window"
        );
    }

    /// The meter reports the output, not the render. A shadowed monitor hands
    /// the device zeros, so the level a musician sees is zero however loud the
    /// graph behind it is — and the same schedule, unshadowed, meters its own
    /// material's peak.
    #[test]
    fn a_shadowed_callback_meters_zero_where_the_same_schedule_meters_its_material() {
        const FRAMES: usize = 512;

        let mut audible = DeviceHarness::new();
        schedule_rolling_material(&mut audible, FRAMES);
        audible.render(FRAMES);

        let mut shadowed = DeviceHarness::new();
        schedule_rolling_material(&mut shadowed, FRAMES);
        shadowed.send(GraphCommand::SetMonitorShadow(true));
        shadowed.render(FRAMES);

        assert_eq!(audible.master_peak(), MATERIAL_PEAK);
        assert_eq!(shadowed.master_peak(), 0.0);
    }

    /// A mono device folds the stereo pair into one channel before the
    /// device ever sees it (`write_interleaved`'s averaging fold). The meter
    /// must report the peak of that folded sum, not the peak of the stereo
    /// scratch the device was never handed.
    #[test]
    fn a_mono_device_meters_the_fold_it_was_handed() {
        const FRAMES: usize = 512;
        const MONO_CHANNELS: usize = 1;
        const FOLDED_SAMPLE: f32 = (LEFT_SAMPLE + RIGHT_SAMPLE) * 0.5;

        let mut harness = DeviceHarness::new();
        schedule_rolling_material(&mut harness, FRAMES);
        let heard = harness.render_with_channels(FRAMES, MONO_CHANNELS);

        assert_eq!(heard[0], FOLDED_SAMPLE);
        assert_eq!(harness.master_peak(), FOLDED_SAMPLE.abs());
    }
}

/// Compensation's real-time contract, driven through the production render
/// callback.
///
/// Every delay line the graph runs is built control-side and reaches the
/// callback owning its buffers, and a line the callback replaces or gives up
/// leaves over the ADR 0020 retirement route. Both halves are one property of
/// this callback: an allocation and a free are equally fatal on the audio
/// thread, and `assert_no_alloc` catches both.
///
/// The interceptor is installed as the test binary's global allocator by the
/// scheduler's own guards and exists only in debug builds
/// (`assert_no_alloc`'s `disable_release` feature is on by default), which is
/// why this module is `#[cfg(all(test, debug_assertions))]`.
#[cfg(all(test, debug_assertions))]
mod compensation_render_alloc_guards {
    use super::DeviceRenderer;
    use crate::midi::diagnostics::active_midi_rt_diagnostics_channel;
    use crate::pdc::{CompensationDelay, MAX_COMPENSATION_FRAMES};
    use crate::plugin_slot::{NativePlugin, TransportState};
    use crate::scheduler::{
        graph_progress_channel, master_meter_channel, transport_position_channel, AudioScheduler,
        GraphCommand, RetiredGraphObjects,
    };
    use crate::timeline::{
        timeline_rt_diagnostics_channel, ChainEntry, ClipPlacement, ClipPlayback, DeviceKind,
        RouteTarget, SendTap, TimelineBus, TimelineClip, TimelineTrack,
    };
    use assert_no_alloc::assert_no_alloc;
    use rtrb::{Consumer, Producer, RingBuffer};
    use std::any::Any;

    const SAMPLE_RATE: f32 = 48_000.0;
    const DEVICE_CHANNELS: usize = 2;
    const CALLBACK_FRAMES: usize = 128;
    const COMMAND_CAPACITY: usize = 32;
    const EFFECT_ID: usize = 900;

    struct CompensationHarness {
        command_tx: Producer<GraphCommand>,
        retired_rx: Consumer<RetiredGraphObjects>,
        renderer: DeviceRenderer,
    }

    impl CompensationHarness {
        fn new() -> Self {
            let (command_tx, command_rx) = RingBuffer::new(COMMAND_CAPACITY);
            let (retired_tx, retired_rx) = RingBuffer::new(COMMAND_CAPACITY + 1);
            let (midi_diagnostics_tx, _midi_reader) = active_midi_rt_diagnostics_channel();
            let (timeline_diagnostics_tx, _timeline_reader) = timeline_rt_diagnostics_channel();
            let (graph_progress_tx, _progress_reader) = graph_progress_channel();
            let (transport_position_tx, _position_reader) = transport_position_channel();
            let (master_meter_tx, _meter_reader) = master_meter_channel();
            let scheduler = AudioScheduler::with_rt_diagnostics(
                command_rx,
                retired_tx,
                SAMPLE_RATE,
                midi_diagnostics_tx,
                timeline_diagnostics_tx,
                graph_progress_tx,
                transport_position_tx,
                master_meter_tx,
            );
            let (_capture_feed_tx, capture_feed_rx) = RingBuffer::new(1);
            Self {
                command_tx,
                retired_rx,
                renderer: DeviceRenderer::new(scheduler, capture_feed_rx),
            }
        }

        fn send(&mut self, command: GraphCommand) {
            self.command_tx
                .push(command)
                .map_err(|_| "the command ring should hold this test's batch")
                .expect("push");
        }
    }

    /// Something for the effect table to hold, so a declared latency lands on a
    /// registered effect and the second declaration replaces the first's line
    /// rather than being refused.
    struct SilentPlugin;

    impl NativePlugin for SilentPlugin {
        fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {}

        fn name(&self) -> &str {
            "silent-plugin"
        }

        fn as_any(&self) -> &dyn Any {
            self
        }

        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    /// The command the control thread builds for a declared latency.
    fn set_latency(latency_frames: usize) -> GraphCommand {
        GraphCommand::SetEffectLatency {
            effect_id: EFFECT_ID,
            latency_frames,
            dry_delay: CompensationDelay::for_latency(latency_frames),
        }
    }

    /// One mono clip of a constant value from frame zero, so the frame the
    /// material first sounds on is the only thing the assertion has to read.
    fn constant_clip(clip_id: usize, value: f32, frames: usize) -> Box<TimelineClip> {
        TimelineClip::new(
            clip_id,
            vec![value; frames].into(),
            [].into(),
            ClipPlacement {
                start_frame: 0,
                source_offset_frames: 0,
                length_frames: frames as u64,
            },
            ClipPlayback::at_gain(1.0),
        )
    }

    #[test]
    fn compensating_the_graph_neither_allocates_nor_frees_on_the_callback() {
        const CALLBACKS: usize = 4;
        const GROUP_CLIP_ID: usize = 202;
        const GROUP_CLIP_VALUE: f32 = 0.5;
        const HELD_FRAMES: usize = 128;
        /// The callback each bypass switch is sent on, so the guard covers a
        /// running device's dry line and a bypassed one's alike.
        const BYPASS_AT: usize = 1;
        const UNBYPASS_AT: usize = 2;

        let mut harness = CompensationHarness::new();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(2)));
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(3)));
        // The group's own material, so the render has something to hold and the
        // hold is readable at the master rather than only in the graph's state.
        harness.send(GraphCommand::AddClip(
            2,
            constant_clip(GROUP_CLIP_ID, GROUP_CLIP_VALUE, CALLBACKS * CALLBACK_FRAMES),
        ));
        harness.send(GraphCommand::SetTransport(TransportState {
            is_playing: true,
            ..TransportState::default()
        }));
        harness.send(GraphCommand::AddBus(TimelineBus::new(50)));
        harness.send(GraphCommand::AddSend {
            track_id: 1,
            bus_id: 50,
            tap: SendTap::PostFader,
            level: 0.5,
            delay: Box::new(CompensationDelay::new(MAX_COMPENSATION_FRAMES)),
        });
        harness.send(GraphCommand::AddPlugin(EFFECT_ID, Box::new(SilentPlugin)));
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 3,
            entry: ChainEntry {
                effect_id: EFFECT_ID,
                kind: DeviceKind::Effect,
            },
            index: 0,
            hold: None,
        });
        // A group: the latent track sums into track 2's input, which puts
        // track 2's source line at a non-zero delay and so on the render this
        // guard wraps.
        harness.send(GraphCommand::SetTrackOutput(3, RouteTarget::Track(2)));
        // Two on one effect: the second replaces the line the first installed,
        // which is the free this guard exists to catch.
        harness.send(set_latency(64));
        harness.send(set_latency(128));
        // Gives up a track that owns an output line, a source line and a send
        // line.
        harness.send(GraphCommand::RemoveTrack(1));

        // Sized outside, the way a device buffer is: the callback is what is
        // under test, not the buffer it is handed. So is the master the render
        // is read back from, for the same reason.
        let mut data = vec![0.0f32; CALLBACK_FRAMES * DEVICE_CHANNELS];
        let mut heard = vec![0.0f32; CALLBACKS * CALLBACK_FRAMES];

        assert_no_alloc(|| {
            for callback in 0..CALLBACKS {
                // The two passes a dry line takes are different code on the
                // callback: a running device feeds its line, a bypassed one
                // reads it. Switching inside the guard puts both under it,
                // along with the block each switch lands on.
                match callback {
                    BYPASS_AT => harness.send(GraphCommand::SetBypass(EFFECT_ID, true)),
                    UNBYPASS_AT => harness.send(GraphCommand::SetBypass(EFFECT_ID, false)),
                    _ => {}
                }
                harness.renderer.render(&mut data, DEVICE_CHANNELS);
                let block = &mut heard[callback * CALLBACK_FRAMES..][..CALLBACK_FRAMES];
                for (frame, sample) in block.iter_mut().enumerate() {
                    *sample = data[frame * DEVICE_CHANNELS];
                }
            }
        });

        // The feed a route line takes while it holds nothing is callback code
        // too, and this graph runs it inside the guard: the latent track
        // arrives at the group's input at exactly the group's depth, so its
        // output line holds nothing and is written rather than read on every
        // block above.
        assert_eq!(
            harness
                .renderer
                .scheduler
                .timeline()
                .track(3)
                .expect("the latent track is in the graph")
                .output_delay_frames(),
            0,
            "the latent track's output line held nothing, so the guard covered the \
             zero-hold feed as well as the holds"
        );

        // The guard only covers what the callback ran, and a line holding
        // nothing reads nothing back. Aiming it says the graph asked for the
        // hold; the master says the render took it. Both are needed, because
        // compensation aims a line whether or not the render path that runs it
        // was ever reached.
        assert_eq!(
            harness
                .renderer
                .scheduler
                .timeline()
                .track(2)
                .expect("the group track is in the graph")
                .source_delay_frames(),
            HELD_FRAMES,
            "the group's source line was aimed at the depth of the latent track feeding it"
        );
        let mut expected = vec![GROUP_CLIP_VALUE; CALLBACKS * CALLBACK_FRAMES];
        expected[..HELD_FRAMES].fill(0.0);
        assert_eq!(
            heard, expected,
            "the group's own clip waits the whole hold at the master, so the callback ran the line"
        );

        // Freed here, on the control side, which is the whole point of the
        // route: two objects the callback let go of and did not drop.
        let mut retired = 0;
        while harness.retired_rx.pop().is_ok() {
            retired += 1;
        }
        assert_eq!(
            retired, 2,
            "the replaced dry line and the removed track both leave over the retirement route"
        );
    }

    /// The guard above splices only a [`DeviceKind::Effect`], so
    /// `TrackDeviceChain::run_generator` and the `resolve_effect` lookup it
    /// shares with `run_device` never ran inside it. A hosted instrument
    /// arrives spliced exactly the way the control thread splices one:
    /// `AddHostedPlugin` registers it homed detached, and the splice ships
    /// the generator's input hold with it, the same pair the scheduler's own
    /// `insert_track_generator` test helper sends.
    #[test]
    fn compensating_a_generator_neither_allocates_nor_frees_on_the_callback() {
        const CALLBACKS: usize = 2;
        // Non-zero, so `run_generator`'s dry-line pass over the pass-through
        // signal actually runs the ring rather than the zero-delay no-op.
        const LATENCY: usize = 16;

        let mut harness = CompensationHarness::new();
        harness.send(GraphCommand::AddTrack(TimelineTrack::new(1)));
        harness.send(GraphCommand::AddClip(
            1,
            constant_clip(301, 0.5, CALLBACKS * CALLBACK_FRAMES),
        ));
        harness.send(GraphCommand::SetTransport(TransportState {
            is_playing: true,
            ..TransportState::default()
        }));
        harness.send(GraphCommand::AddHostedPlugin(
            EFFECT_ID,
            Box::new(SilentPlugin),
        ));
        let entry = ChainEntry {
            effect_id: EFFECT_ID,
            kind: DeviceKind::Generator,
        };
        harness.send(GraphCommand::InsertTrackDevice {
            track_id: 1,
            entry,
            index: 0,
            hold: entry.input_hold(),
        });
        harness.send(set_latency(LATENCY));

        let mut data = vec![0.0f32; CALLBACK_FRAMES * DEVICE_CHANNELS];

        assert_no_alloc(|| {
            for _ in 0..CALLBACKS {
                harness.renderer.render(&mut data, DEVICE_CHANNELS);
            }
        });
    }
}
