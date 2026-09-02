//! The cpal implementation of the device seam — the default backend for
//! macOS and Linux, byte-for-byte the behavior the engine had before the
//! seam existed: same device choice, same period negotiation, same error
//! strings, same f32-only format stance.

use super::{
    accept_input, CaptureFn, DeviceOpenRequest, InputBackend, InputOpenRefusal, InputOpenRequest,
    NegotiatedInput, NegotiatedOutput, OpenInput, OpenOutput, OutputBackend, RenderFn,
    StreamErrorFn,
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

pub(crate) struct CpalInputBackend;

pub(crate) struct CpalOpenInput {
    device: cpal::Device,
    sample_format: cpal::SampleFormat,
    stream_config: cpal::StreamConfig,
    negotiated: NegotiatedInput,
}

/// The buffer size the engine asks an input device for: never a fixed one.
///
/// A `Fixed` request is not a per-stream preference. On CoreAudio it writes
/// `kAudioDevicePropertyBufferFrameSize`, which is device-global — the same
/// value the user set in Audio MIDI Setup, shared with every other client of
/// that device. The output path pays that price deliberately, to keep a
/// device's period within the bridge's reach for hosted plugins. Capture has
/// no equivalent need: the ring is a sample FIFO that absorbs whatever block
/// size arrives. So asking would buy nothing and cost a shared, user-facing
/// setting — and on an interface that is both the default input and the
/// default output, it would rewrite the period underneath the already-running
/// output stream, including one that had itself fallen back to `Default`.
const fn capture_buffer_size() -> cpal::BufferSize {
    cpal::BufferSize::Default
}

/// Frames the device is expected to deliver per capture callback, at most.
///
/// The engine sends no period (see `capture_buffer_size`), so the device runs
/// its own and cpal reports none back. The only bound available is the one the
/// device advertises, and it is the figure the capture ring is sized from.
///
/// A device advertising no range is refused rather than guessed at. There is
/// no engine-side constant standing in for a period a device never named: the
/// callback limit is the size of the render scratch, not a promise any device
/// makes, and cpal's ALSA host reports `Unknown` for exactly the devices that
/// break that guess — a period range whose effective maximum falls below its
/// minimum, which is how a device pinned above the limit presents. A ring
/// sized from the guess would then refuse most of every block it was given.
fn expected_period_frames(
    supported: &cpal::SupportedBufferSize,
) -> Result<usize, InputOpenRefusal> {
    match *supported {
        cpal::SupportedBufferSize::Range { max, .. } => Ok(max as usize),
        cpal::SupportedBufferSize::Unknown => Err(InputOpenRefusal::UnsupportedConfiguration),
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

        // Capture takes the device's own period rather than negotiating one:
        // see `capture_buffer_size`. There is no retry lever on this path
        // because there is nothing to retry — the engine sends no period, so
        // no period can be the reason a build fails.
        let mut stream_config: cpal::StreamConfig = config.into();
        stream_config.buffer_size = capture_buffer_size();

        let negotiated = accept_input(
            NegotiatedInput {
                sample_rate: config.sample_rate() as f32,
                channels: config.channels() as usize,
                period_frames: expected_period_frames(config.buffer_size())?,
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
    use super::{capture_buffer_size, expected_period_frames};
    use crate::audio_thread::negotiated_buffer_size;
    use crate::device::InputOpenRefusal;

    #[test]
    fn a_device_left_on_its_own_period_is_sized_from_the_range_it_advertises() {
        // The engine sends the device nothing, so it runs its own period and
        // the advertised maximum is what bounds a capture block. Sizing the
        // ring from a period the engine merely prefers would be wrong from
        // the first block the device delivered.
        let range = cpal::SupportedBufferSize::Range { min: 64, max: 2048 };
        assert_eq!(expected_period_frames(&range), Ok(2048));
    }

    #[test]
    fn a_device_that_advertises_no_period_range_refuses_to_open() {
        // cpal reports `Unknown` where a host cannot bound the period at all
        // — an ALSA device whose effective maximum falls below its minimum,
        // which is how one pinned above the engine's callback limit presents.
        // Substituting a constant here would size the ring below the blocks
        // that device actually delivers, so it is refused instead.
        assert_eq!(
            expected_period_frames(&cpal::SupportedBufferSize::Unknown),
            Err(InputOpenRefusal::UnsupportedConfiguration)
        );
    }

    #[test]
    fn the_engine_never_asks_an_input_device_to_change_its_period() {
        // A range the output side does negotiate a fixed period out of: its
        // maximum is above the callback limit and its minimum below it.
        let range = cpal::SupportedBufferSize::Range { min: 64, max: 8192 };
        assert!(matches!(
            negotiated_buffer_size(&range),
            cpal::BufferSize::Fixed(_)
        ));

        // Capture leaves that same device alone. A fixed request writes a
        // device-global period on CoreAudio, and on an interface serving as
        // both default input and default output that would rewrite the period
        // under the running output stream.
        assert!(matches!(capture_buffer_size(), cpal::BufferSize::Default));
        assert_eq!(
            expected_period_frames(&range),
            Ok(8192),
            "the reported period must be one the untouched device can deliver"
        );
    }
}
