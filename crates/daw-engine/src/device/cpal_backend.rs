//! The cpal implementation of the device seam — the default backend for
//! macOS and Linux, byte-for-byte the behavior the engine had before the
//! seam existed: same device choice, same period negotiation, same error
//! strings, same f32-only format stance.

use super::{
    DeviceOpenRequest, NegotiatedOutput, OpenOutput, OutputBackend, RenderFn, StreamErrorFn,
};
use crate::audio_thread::effective_buffer_size;
use crate::engine_events::StreamErrorKind;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

pub(crate) struct CpalOutputBackend;

pub(crate) struct CpalOpenOutput {
    device: cpal::Device,
    config: cpal::SupportedStreamConfig,
    stream_config: cpal::StreamConfig,
    negotiated: NegotiatedOutput,
}

impl OutputBackend for CpalOutputBackend {
    type Open = CpalOpenOutput;

    fn open_default_output(request: DeviceOpenRequest) -> Result<CpalOpenOutput, String> {
        if request.exclusive {
            // Exclusive endpoint access is a WASAPI-only mode (ADR 0027).
            // This backend opens the shared route and says so — a mode the
            // platform does not have must degrade observably, not silently.
            eprintln!("[Engine] Exclusive device access is a Windows-only mode; opening shared");
        }

        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "No default audio output device found".to_string())?;

        let config = device
            .default_output_config()
            .map_err(|e| format!("Failed to get default output config: {}", e))?;

        let channels = config.channels() as usize;
        let sample_rate = config.sample_rate() as f32;

        // Ask the device for a period the callback and the plugin bridge can
        // carry, but only where the device could otherwise exceed it (see
        // `audio_thread::negotiated_buffer_size`), or not at all on the
        // fallback build.
        let mut stream_config: cpal::StreamConfig = config.into();
        stream_config.buffer_size =
            effective_buffer_size(config.buffer_size(), request.force_default_period);

        Ok(CpalOpenOutput {
            device,
            config,
            stream_config,
            negotiated: NegotiatedOutput {
                sample_rate,
                channels,
            },
        })
    }
}

impl OpenOutput for CpalOpenOutput {
    type Stream = cpal::Stream;

    fn negotiated(&self) -> NegotiatedOutput {
        self.negotiated
    }

    fn start(
        self,
        mut render: RenderFn,
        mut on_error: StreamErrorFn,
    ) -> Result<cpal::Stream, String> {
        // We strictly use f32 streams.
        //
        // The backend runs the error callback on the real-time thread — ALSA
        // reports from its xrun path and WASAPI from inside the output run
        // loop — so it does the one wait-free thing open to it and nothing
        // else: map the error onto a fixed `Copy` kind and hand it to the
        // seam's error sink (a push into a preallocated ring). No formatting,
        // no stderr lock, no allocation, no wait.
        let err_fn = move |err: cpal::Error| on_error(StreamErrorKind::from(&err));
        let channels = self.negotiated.channels;

        let stream = match self.config.sample_format() {
            cpal::SampleFormat::F32 => self
                .device
                .build_output_stream(
                    self.stream_config,
                    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| render(data, channels),
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build output stream: {}", e))?,
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
}
