//! Native OS Audio Thread using CPAL

use crate::midi::diagnostics::{
    active_midi_rt_diagnostics_channel, ActiveMidiRtDiagnosticsSnapshot,
};
use crate::scheduler::{AudioScheduler, GraphCommand};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rtrb::Consumer;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration;
use triple_buffer::Input;

const MAX_CALLBACK_FRAMES: usize = 4096;
const AUDIO_STREAM_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(100);

pub struct AudioThreadHandle {
    shutdown_tx: Sender<()>,
    shutdown_complete_rx: Receiver<()>,
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

    match ready_rx.recv() {
        Ok(Ok(())) => Ok(AudioThreadHandle {
            shutdown_tx,
            shutdown_complete_rx,
        }),
        Ok(Err(error)) => Err(error),
        Err(error) => Err(format!("Audio owner thread exited during startup: {error}")),
    }
}

pub fn spawn_audio_thread(command_rx: Consumer<GraphCommand>) -> Result<AudioThreadHandle, String> {
    let (midi_rt_diagnostics_tx, _midi_rt_diagnostics_reader) =
        active_midi_rt_diagnostics_channel();
    spawn_audio_thread_with_diagnostics(command_rx, midi_rt_diagnostics_tx)
}

pub(crate) fn spawn_audio_thread_with_diagnostics(
    command_rx: Consumer<GraphCommand>,
    midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
) -> Result<AudioThreadHandle, String> {
    spawn_owned_audio_stream(move || build_audio_stream(command_rx, midi_rt_diagnostics_tx))
}

fn build_audio_stream(
    command_rx: Consumer<GraphCommand>,
    midi_rt_diagnostics_tx: Input<ActiveMidiRtDiagnosticsSnapshot>,
) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No default audio output device found".to_string())?;

    let config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get default output config: {}", e))?;

    let sample_rate = config.sample_rate() as f32;
    let mut scheduler =
        AudioScheduler::with_midi_rt_diagnostics(command_rx, sample_rate, midi_rt_diagnostics_tx);

    // We strictly use f32 streams
    let err_fn = |err| eprintln!("an error occurred on stream: {}", err);

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let mut left_scratch = Box::new([0.0f32; MAX_CALLBACK_FRAMES]);
            let mut right_scratch = Box::new([0.0f32; MAX_CALLBACK_FRAMES]);

            device
                .build_output_stream(
                    config.into(),
                    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                        // 1. Process pending commands lock-free
                        scheduler.update_graph();

                        // 2. Process ring-buffer audio bridges (production path)
                        // Reads input from worklets via main thread, processes through
                        // CLAP/VST3, writes output back for main thread to return.
                        scheduler.process_audio_bridges();

                        // 3. Process the native effects chain (for standalone native rendering).
                        // Scratch is fixed-size and captured by the callback, so no heap
                        // allocation occurs per buffer.
                        for chunk in data.chunks_mut(MAX_CALLBACK_FRAMES * 2) {
                            let frames = chunk.len() / 2;
                            let left = &mut left_scratch[..frames];
                            let right = &mut right_scratch[..frames];
                            left.fill(0.0);
                            right.fill(0.0);

                            // Silent input — native chain only processes bridged plugins above.
                            // Standalone native rendering (without Web Audio) would inject
                            // timeline audio here.
                            scheduler.process_block(left, right, frames);

                            // Interleave output for CPAL (silent unless standalone mode)
                            for (i, frame) in chunk.chunks_exact_mut(2).enumerate() {
                                if i < frames {
                                    frame[0] = left[i];
                                    frame[1] = right[i];
                                }
                            }
                        }

                        scheduler.publish_midi_rt_diagnostics();
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
    use super::{spawn_owned_audio_stream, AudioThreadHandle};
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

    impl Drop for BlockingDropResource {
        fn drop(&mut self) {
            let _ = self.release_rx.recv();
            let _ = self.dropped_tx.send(());
        }
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
