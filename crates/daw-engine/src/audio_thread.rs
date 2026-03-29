//! Native OS Audio Thread using CPAL

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::thread;
use crate::scheduler::{AudioScheduler, GraphCommand};
use rtrb::Consumer;

pub struct AudioThreadHandle {
    // Keep stream alive
    _stream: cpal::Stream,
}

pub fn spawn_audio_thread(command_rx: Consumer<GraphCommand>) -> Result<AudioThreadHandle, String> {
    let host = cpal::default_host();
    let device = host.default_output_device()
        .ok_or_else(|| "No default audio output device found".to_string())?;

    let config = device.default_output_config()
        .map_err(|e| format!("Failed to get default output config: {}", e))?;

    let sample_rate = config.sample_rate().0 as f32;
    let mut scheduler = AudioScheduler::new(command_rx, sample_rate);

    // Provide a simple test sine wave for now so we know native audio is running!
    // TODO: In the future, this input buffer should read from daw-core track timelines.
    let mut phase: f32 = 0.0;
    
    // We strictly use f32 streams
    let err_fn = |err| eprintln!("an error occurred on stream: {}", err);

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            device.build_output_stream(
                &config.into(),
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    scheduler.update_graph();

                    // For this MVP, we inject a very quiet 440Hz test sine wave to process through our effects chain.
                    // A proper implementation would pull `daw-core` timeline audio buffers here.
                    let frames = data.len() / 2;
                    let mut left = vec![0.0f32; frames];
                    let mut right = vec![0.0f32; frames];
                    
                    for i in 0..frames {
                        let sample = (phase * 2.0 * std::f32::consts::PI).sin() * 0.05;
                        left[i] = sample;
                        right[i] = sample;
                        phase += 440.0 / sample_rate;
                        if phase > 1.0 { phase -= 1.0; }
                    }

                    // Process lock-free effect chain natively
                    scheduler.process_block(&mut left, &mut right, frames);

                    // Interleave output for CPAL
                    for (i, frame) in data.chunks_mut(2).enumerate() {
                        frame[0] = left[i];
                        frame[1] = right[i];
                    }
                },
                err_fn,
                None,
            ).map_err(|e| format!("Failed to build output stream: {}", e))?
        },
        _ => return Err("Unsupported sample format (only F32 is supported by the engine)".to_string()),
    };

    stream.play().map_err(|e| format!("Failed to play stream: {}", e))?;

    Ok(AudioThreadHandle { _stream: stream })
}
