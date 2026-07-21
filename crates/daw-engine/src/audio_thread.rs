//! Native OS Audio Thread using CPAL

use crate::midi::diagnostics::MidiRtDiagnosticsSnapshot;
use crate::scheduler::{AudioScheduler, GraphCommand};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rtrb::Consumer;
use triple_buffer::Input;

const MAX_CALLBACK_FRAMES: usize = 4096;

pub struct AudioThreadHandle {
    // Keep stream alive
    _stream: cpal::Stream,
}

// SAFETY: The cpal::Stream is only created and dropped on the main thread.
// We hold it in Arc<Mutex> in EngineHandle and never access it from other threads.
// The stream's internal audio callback runs on the cpal audio thread independently.
unsafe impl Send for AudioThreadHandle {}
unsafe impl Sync for AudioThreadHandle {}

pub fn spawn_audio_thread(
    command_rx: Consumer<GraphCommand>,
    midi_rt_diagnostics_tx: Input<MidiRtDiagnosticsSnapshot>,
) -> Result<AudioThreadHandle, String> {
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

    Ok(AudioThreadHandle { _stream: stream })
}
