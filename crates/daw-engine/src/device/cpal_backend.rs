//! The cpal implementation of the device seam — the default backend for
//! macOS and Linux, byte-for-byte the behavior the engine had before the
//! seam existed: same device choice, same period negotiation, same error
//! strings, same f32-only format stance.

use super::{
    accept_input, CaptureFn, DeviceOpenRequest, InputBackend, InputOpenRefusal, InputOpenRequest,
    NegotiatedInput, NegotiatedOutput, OpenInput, OpenOutput, OutputBackend, RenderFn,
    StreamErrorFn,
};
use crate::audio_thread::{effective_buffer_size, PREFERRED_BUFFER_FRAMES};
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

pub(crate) struct CpalInputBackend;

pub(crate) struct CpalOpenInput {
    device: cpal::Device,
    sample_format: cpal::SampleFormat,
    stream_config: cpal::StreamConfig,
    negotiated: NegotiatedInput,
}

/// Frames the device is expected to deliver per capture callback.
///
/// cpal reports no period back, so the expectation is the request itself: the
/// negotiated size where the engine asked for one, and the period the engine
/// prefers where it left the device's own preference alone. The capture ring
/// carries slack above the largest callback the engine accepts, so a device
/// that answers with more than this still fits.
fn expected_period_frames(buffer_size: cpal::BufferSize) -> usize {
    match buffer_size {
        cpal::BufferSize::Fixed(frames) => frames as usize,
        cpal::BufferSize::Default => PREFERRED_BUFFER_FRAMES as usize,
    }
}

impl InputBackend for CpalInputBackend {
    type Open = CpalOpenInput;

    fn open_default_input(request: InputOpenRequest) -> Result<CpalOpenInput, InputOpenRefusal> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or(InputOpenRefusal::NoDefaultInputDevice)?;

        let config = device
            .default_input_config()
            .map_err(|error| InputOpenRefusal::Backend(StreamErrorKind::from(&error)))?;

        // The engine never asks an input device for the device default as a
        // fallback: there is no second attempt to protect, and the period the
        // ring is sized from has to be the period actually requested.
        let mut stream_config: cpal::StreamConfig = config.into();
        stream_config.buffer_size = effective_buffer_size(config.buffer_size(), false);

        let negotiated = accept_input(
            NegotiatedInput {
                sample_rate: config.sample_rate() as f32,
                channels: config.channels() as usize,
                period_frames: expected_period_frames(stream_config.buffer_size),
            },
            request,
        )?;

        Ok(CpalOpenInput {
            device,
            sample_format: config.sample_format(),
            stream_config,
            negotiated,
        })
    }
}

impl OpenInput for CpalOpenInput {
    type Stream = cpal::Stream;

    fn negotiated(&self) -> NegotiatedInput {
        self.negotiated
    }

    fn start(
        self,
        mut capture: CaptureFn,
        mut on_error: StreamErrorFn,
    ) -> Result<cpal::Stream, InputOpenRefusal> {
        // We strictly use f32 streams, on the capture side for the same
        // reason as on the render side: a format ladder here would be a
        // conversion the engine has decided not to make.
        if self.sample_format != cpal::SampleFormat::F32 {
            return Err(InputOpenRefusal::UnsupportedConfiguration);
        }

        // Wait-free, like the output stream's: map the error onto a fixed
        // `Copy` kind and hand it to the seam's error sink. No formatting, no
        // stderr lock, no allocation.
        let err_fn = move |error: cpal::Error| on_error(StreamErrorKind::from(&error));
        let channels = self.negotiated.channels;

        let stream = self
            .device
            .build_input_stream(
                self.stream_config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| capture(data, channels),
                err_fn,
                None,
            )
            .map_err(|error| InputOpenRefusal::Backend(StreamErrorKind::from(&error)))?;

        stream
            .play()
            .map_err(|error| InputOpenRefusal::Backend(StreamErrorKind::from(&error)))?;

        Ok(stream)
    }
}

#[cfg(test)]
mod tests {
    use super::expected_period_frames;
    use crate::audio_thread::PREFERRED_BUFFER_FRAMES;

    #[test]
    fn a_device_left_on_its_own_period_is_sized_from_the_period_the_engine_prefers() {
        assert_eq!(
            expected_period_frames(cpal::BufferSize::Default),
            PREFERRED_BUFFER_FRAMES as usize
        );
        assert_eq!(expected_period_frames(cpal::BufferSize::Fixed(256)), 256);
    }
}
