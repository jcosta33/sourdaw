//! Native OS Audio Thread using CPAL

use crate::engine_events::{engine_event_channel, EngineEvent, StreamErrorKind};
use crate::midi::diagnostics::{
    active_midi_rt_diagnostics_channel, ActiveMidiRtDiagnosticsSnapshot,
};
use crate::scheduler::{
    AudioScheduler, GraphCommand, RetiredGraphObjects, RETIREMENT_QUEUE_CAPACITY,
};
use crate::timeline::{timeline_rt_diagnostics_channel, TimelineRtDiagnosticsSnapshot};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rtrb::{Consumer, Producer, RingBuffer};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration;
use triple_buffer::Input;

pub(crate) const MAX_CALLBACK_FRAMES: usize = 4096;
/// The period the engine asks a device for when the device lets it choose.
/// 512 frames is the common professional default (Live, Logic, Reaper all ship
/// a buffer of this order): low enough for playable monitoring latency, high
/// enough that a bridged plugin chain is not woken more often than it can serve.
const PREFERRED_BUFFER_FRAMES: cpal::FrameCount = 512;
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
#[cfg(test)]
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

fn spawn_retirement_reclaimer<T: Send + 'static>(
    mut retired_rx: Consumer<T>,
) -> Result<Sender<()>, String> {
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    thread::Builder::new()
        .name("sourdaw-plugin-reclaimer".to_string())
        .spawn(move || loop {
            while let Ok(retired) = retired_rx.pop() {
                reclaim_retired(retired);
            }

            match shutdown_rx.recv_timeout(RETIREMENT_RECLAIMER_POLL_INTERVAL) {
                Ok(()) | Err(RecvTimeoutError::Disconnected) => {
                    while let Ok(retired) = retired_rx.pop() {
                        reclaim_retired(retired);
                    }
                    break;
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
        })
        .map_err(|error| format!("Failed to spawn plugin reclaimer thread: {error}"))?;

    Ok(shutdown_tx)
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
    let (engine_event_tx, _engine_event_rx) = engine_event_channel();
    spawn_audio_thread_with_diagnostics(
        command_rx,
        diagnostics_tx,
        timeline_diagnostics_tx,
        engine_event_tx,
        false,
    )
}

pub(crate) fn spawn_audio_thread_with_diagnostics(
    command_rx: Consumer<GraphCommand>,
    midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
    timeline_rt_diagnostics_tx: Input<TimelineRtDiagnosticsSnapshot>,
    engine_event_tx: Producer<EngineEvent>,
    force_default_buffer: bool,
) -> Result<AudioThreadHandle, String> {
    let (retired_tx, retired_rx) = RingBuffer::new(RETIREMENT_QUEUE_CAPACITY);
    let reclaimer_shutdown_tx = spawn_retirement_reclaimer(retired_rx)?;

    spawn_owned_audio_stream(move || {
        match build_audio_stream(
            command_rx,
            retired_tx,
            midi_rt_diagnostics_tx,
            timeline_rt_diagnostics_tx,
            engine_event_tx,
            force_default_buffer,
        ) {
            Ok(stream) => Ok(StreamWithReclaimerShutdown(
                Some(stream),
                reclaimer_shutdown_tx,
            )),
            Err(error) => {
                let _ = reclaimer_shutdown_tx.send(());
                Err(error)
            }
        }
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
/// overrun anything: the callback chunks its fixed scratch, and the bridge
/// clamps the frame count and counts the shortfall as
/// `callback_frames_over_bridge_reach`. The failure is a counted throughput
/// deficit for bridged plugins, not corruption — real, but not worth mutating a
/// shared device setting to avoid where it cannot occur.
///
/// So the engine intervenes on exactly one shape of device: one whose advertised
/// range reaches above the callback's limit *and* can be asked for something at
/// or below it. A device that cannot exceed the limit keeps its preference
/// untouched; a device whose whole range sits above the limit cannot be helped
/// and keeps it too.
fn negotiated_buffer_size(supported: &cpal::SupportedBufferSize) -> cpal::BufferSize {
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
fn effective_buffer_size(
    supported: &cpal::SupportedBufferSize,
    force_default: bool,
) -> cpal::BufferSize {
    if force_default {
        return cpal::BufferSize::Default;
    }

    negotiated_buffer_size(supported)
}

fn build_audio_stream(
    command_rx: Consumer<GraphCommand>,
    retired_tx: rtrb::Producer<RetiredGraphObjects>,
    midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
    timeline_rt_diagnostics_tx: Input<TimelineRtDiagnosticsSnapshot>,
    mut engine_event_tx: Producer<EngineEvent>,
    force_default_buffer: bool,
) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No default audio output device found".to_string())?;

    let config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get default output config: {}", e))?;

    let channels = config.channels() as usize;
    if channels == 0 {
        return Err("Audio output device reports zero channels".to_string());
    }

    let sample_rate = config.sample_rate() as f32;
    let mut scheduler = AudioScheduler::with_rt_diagnostics(
        command_rx,
        retired_tx,
        sample_rate,
        midi_rt_diagnostics_tx,
        timeline_rt_diagnostics_tx,
    );

    // Ask the device for a period the callback and the plugin bridge can carry,
    // but only where the device could otherwise exceed it (see
    // `negotiated_buffer_size`), or not at all on the fallback build.
    let mut stream_config: cpal::StreamConfig = config.into();
    stream_config.buffer_size = effective_buffer_size(config.buffer_size(), force_default_buffer);

    // We strictly use f32 streams.
    //
    // The backend runs this on the real-time thread — ALSA reports from its xrun
    // path and WASAPI from inside the output run loop — so the callback does the
    // one wait-free thing open to it and nothing else: push a fixed-size `Copy`
    // event into a preallocated ring. No formatting, no stderr lock, no
    // allocation, no wait; a full ring drops the report rather than stalling the
    // audio side. Reporting the error is the drain side's job
    // (`drain_engine_events`).
    let err_fn = move |err: cpal::Error| {
        let _ = engine_event_tx.push(EngineEvent::StreamError {
            kind: StreamErrorKind::from(&err),
        });
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let mut left_scratch = Box::new([0.0f32; MAX_CALLBACK_FRAMES]);
            let mut right_scratch = Box::new([0.0f32; MAX_CALLBACK_FRAMES]);

            device
                .build_output_stream(
                    stream_config,
                    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                        // 1. Process pending commands lock-free
                        scheduler.update_graph();

                        // 2. Process ring-buffer audio bridges (production path)
                        // Reads input from worklets via main thread, processes through
                        // CLAP/VST3, writes output back for main thread to return.
                        // The device's frame count for this period is the budget:
                        // a bridge may spend it plus one quantum of catch-up, so a
                        // backlog never renders as one spike inside the deadline.
                        scheduler.process_audio_bridges(data.len() / channels);

                        // 3. Process the native effects chain (for standalone native rendering).
                        // Scratch is fixed-size and captured by the callback, so no heap
                        // allocation occurs per buffer.
                        for chunk in data.chunks_mut(MAX_CALLBACK_FRAMES * channels) {
                            let frames = chunk.len() / channels;
                            let left = &mut left_scratch[..frames];
                            let right = &mut right_scratch[..frames];
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
                            scheduler.process_block(left, right, frames);

                            // Adapt the rendered stereo pair to the device's actual
                            // channel count.
                            write_interleaved(chunk, left, right, channels, frames);
                        }

                        scheduler.publish_midi_rt_diagnostics();
                        scheduler.publish_timeline_rt_diagnostics();
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build output stream: {}", e))?
        }
        _ => {
            return Err(
                "Unsupported sample format (only F32 is supported by the engine)".to_string(),
            )
        }
    };

    stream
        .play()
        .map_err(|e| format!("Failed to play stream: {}", e))?;

    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::{
        spawn_owned_audio_stream, spawn_owned_audio_stream_with_timeout,
        spawn_retirement_reclaimer, AudioThreadHandle, StreamWithReclaimerShutdown,
    };
    use cpal::{BufferSize, SupportedBufferSize};
    use rtrb::RingBuffer;
    use std::rc::Rc;
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};

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
        let reclaimer_shutdown_tx =
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

        let handle = spawn_owned_audio_stream(move || {
            Ok(StreamWithReclaimerShutdown(Some(()), reclaimer_shutdown_tx))
        })
        .expect("audio owner should start");
        let started_at = Instant::now();
        drop(handle);
        assert!(started_at.elapsed() < Duration::from_millis(250));

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

    #[test]
    fn stalled_stream_startup_times_out_without_stranding_the_owner_resource() {
        let (release_tx, release_rx) = mpsc::channel();
        let (dropped_tx, dropped_rx) = mpsc::channel();
        let release_thread = thread::spawn(move || {
            thread::sleep(Duration::from_millis(400));
            release_tx
                .send(())
                .expect("owner thread should still be waiting");
        });

        let started_at = Instant::now();
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
            Duration::from_millis(100),
        );
        let startup_duration = started_at.elapsed();
        let error = match result {
            Ok(handle) => {
                drop(handle);
                panic!("stalled startup should time out");
            }
            Err(error) => error,
        };

        assert_eq!(error, "Timed out waiting for audio stream startup");
        assert!(startup_duration < Duration::from_millis(250));
        release_thread.join().expect("release thread should finish");
        let (created_on, dropped_on) = dropped_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("late owner resource should still be dropped");
        assert_eq!(dropped_on, created_on);
    }

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
        let release_thread = thread::spawn(move || {
            thread::sleep(Duration::from_millis(400));
            release_tx
                .send(())
                .expect("owner thread should still be waiting");
        });

        let started_at = Instant::now();
        drop(handle);
        let drop_duration = started_at.elapsed();

        assert!(drop_duration < Duration::from_millis(250));
        release_thread.join().expect("release thread should finish");
        dropped_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("detached owner should finish after teardown unblocks");
    }
}
