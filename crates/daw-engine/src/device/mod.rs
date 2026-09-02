//! The device seam: one narrow contract between the engine's render
//! callback and whatever platform API carries it to a device.
//!
//! cpal remains the host abstraction wherever it suffices — macOS and
//! Linux route through [`cpal_backend`] unchanged. Windows routes around
//! cpal's WASAPI host because that host can negotiate neither
//! IAudioClient3 small engine periods nor an Exclusive-mode claim, the
//! two modes ADR 0027 commits the Windows device layer to. Per that ADR
//! the seam is extended rather than a second device abstraction grown
//! beside it: every backend answers the same five obligations — open the
//! default output, negotiate period and format, start the stream around
//! the engine's render callback, stop on drop, and report device
//! invalidation through the engine's stream-error vocabulary.
//!
//! The seam has an input half in the same shape, and a backend answers
//! five obligations there too — open the default input, report the
//! period, rate and channel count the device will actually run so a
//! capture ring can be sized from facts rather than hopes, start the
//! stream around the engine's capture callback, stop on drop, and report
//! invalidation through that same vocabulary. Two things differ, and
//! both are deliberate. Capture negotiates no period: it takes the
//! device's own, because asking for one rewrites a setting shared with
//! every other client of that device. And capture may refuse to open at
//! all — a platform without a capture path, a machine with no input
//! device, or a device running a rate the engine is not — which is why
//! its refusals are named ([`InputOpenRefusal`]) rather than assumed
//! away: an engine with no capture side still runs.

// The cpal backend is what every non-Windows build runs; Windows builds
// compile it only under test so the shared negotiation tests keep running
// everywhere without shipping a dead second backend.
#[cfg(any(not(windows), test))]
pub(crate) mod cpal_backend;
#[cfg(any(windows, test))]
pub(crate) mod wasapi;

use crate::engine_events::StreamErrorKind;

/// What the caller asks of the platform when opening the default output.
#[derive(Clone, Copy, Debug)]
pub(crate) struct DeviceOpenRequest {
    /// Skip period negotiation and take the device or engine default —
    /// the retry lever `EngineHandle::new` pulls when a negotiated
    /// period may have been the sole reason a build failed.
    pub force_default_period: bool,
    /// Claim the endpoint exclusively (WASAPI Exclusive). An explicit
    /// user opt-in per ADR 0027, never a default: a refused claim
    /// degrades observably to the shared path, and a backend without an
    /// exclusive mode opens shared and says so rather than failing.
    pub exclusive: bool,
}

/// What the open negotiated: the two facts the engine must build its
/// scheduler and render callback around before any audio flows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct NegotiatedOutput {
    pub sample_rate: f32,
    pub channels: usize,
}

/// The engine's render callback: fill `data` — interleaved f32, whose
/// length is a whole number of frames — for a device currently running
/// `channels` channels. The channel count travels per call because a
/// device-invalidation recovery may resume the same callback on an
/// endpoint with a different layout. Runs on the audio thread: it must
/// not allocate, lock, or block, and neither may the backend code around
/// its invocation.
pub(crate) type RenderFn = Box<dyn FnMut(&mut [f32], usize) + Send + 'static>;

/// Mid-stream error notification — device invalidation included. Backends
/// map their native error codes onto [`StreamErrorKind`] before calling
/// this; it may be invoked from real-time context, so implementations
/// must be wait-free (the engine's is a push into a bounded SPSC ring).
pub(crate) type StreamErrorFn = Box<dyn FnMut(StreamErrorKind) + Send + 'static>;

/// A platform's way of opening the default output device.
pub(crate) trait OutputBackend {
    type Open: OpenOutput;

    /// Open the default output and negotiate period and format. No audio
    /// flows yet: the caller reads [`OpenOutput::negotiated`], builds its
    /// scheduler and callback on those facts, then starts the stream.
    fn open_default_output(request: DeviceOpenRequest) -> Result<Self::Open, String>;
}

/// An opened, negotiated, not-yet-running output stream.
pub(crate) trait OpenOutput {
    /// The running stream. Stopping is dropping — every backend releases
    /// the device when this value goes away, which is what lets the
    /// audio owner thread's teardown stay a single `drop`.
    type Stream;

    fn negotiated(&self) -> NegotiatedOutput;

    /// Start the stream: `render` fills every device buffer from here on,
    /// and `on_error` receives every mid-stream error the backend sees.
    fn start(self, render: RenderFn, on_error: StreamErrorFn) -> Result<Self::Stream, String>;
}

/// What the caller asks of the platform when opening the default input.
#[derive(Clone, Copy, Debug)]
pub(crate) struct InputOpenRequest {
    /// The rate the output stream already opened at. Capture is refused on
    /// any other rate — see [`InputOpenRefusal::SampleRateMismatch`].
    pub engine_sample_rate: f32,
}

/// What an input open negotiated: the three facts the capture ring is built
/// from before any audio arrives.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct NegotiatedInput {
    pub sample_rate: f32,
    pub channels: usize,
    /// Frames the device is expected to deliver per capture callback. The
    /// ring carries slack for a device that hands back more.
    pub period_frames: usize,
}

/// Why an input open refused.
///
/// Named variants rather than a message string, because every one of these
/// is a condition the layer above reacts to differently, and because the
/// refusal has to reach the engine's fixed stream-error vocabulary without
/// anything parsing prose to get there. Public for the same reason: "there
/// is no capture" is only actionable for a host that can say why.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InputOpenRefusal {
    /// This build's device backend has no capture path at all.
    CaptureUnsupportedOnPlatform,
    /// The machine exposes no default input device.
    NoDefaultInputDevice,
    /// The device does not run at the rate the output stream opened at. The
    /// engine never resamples capture, so this is a refusal rather than a
    /// conversion.
    SampleRateMismatch { device_hz: u32, engine_hz: u32 },
    /// The device offers no f32 stream, or reports a layout the engine
    /// cannot shape a ring around.
    UnsupportedConfiguration,
    /// The backend refused, in its own vocabulary.
    Backend(StreamErrorKind),
}

impl InputOpenRefusal {
    /// The refusal in the engine's stream-error vocabulary, so a capture that
    /// never opened is reported on the route every other device failure
    /// already travels rather than through a second mechanism.
    pub fn stream_error_kind(self) -> StreamErrorKind {
        match self {
            Self::NoDefaultInputDevice => StreamErrorKind::DeviceNotAvailable,
            Self::SampleRateMismatch { .. } | Self::UnsupportedConfiguration => {
                StreamErrorKind::StreamInvalidated
            }
            Self::CaptureUnsupportedOnPlatform => StreamErrorKind::BackendSpecific,
            Self::Backend(kind) => kind,
        }
    }
}

/// Accept a device's shape for the engine, or name what makes it unusable.
///
/// The rate check lives on the seam rather than inside a backend so every
/// backend answers a mismatch identically, and so the refusal is provable
/// without a device attached.
pub(crate) fn accept_input(
    device: NegotiatedInput,
    request: InputOpenRequest,
) -> Result<NegotiatedInput, InputOpenRefusal> {
    if device.sample_rate != request.engine_sample_rate {
        return Err(InputOpenRefusal::SampleRateMismatch {
            device_hz: device.sample_rate as u32,
            engine_hz: request.engine_sample_rate as u32,
        });
    }

    if device.channels == 0 || device.period_frames == 0 {
        return Err(InputOpenRefusal::UnsupportedConfiguration);
    }

    Ok(device)
}

/// The engine's capture callback: take `data` — interleaved f32 carrying a
/// whole number of frames of a device currently running `channels` channels.
/// The channel count travels per call for the reason it does on
/// [`RenderFn`]. Runs on the capture thread: it must not allocate, lock, or
/// block, and neither may the backend code around its invocation.
///
/// A block carries at most [`NegotiatedInput::period_frames`] frames. That
/// is the contract a capture ring is sized against, so a backend owes a
/// figure the device can actually deliver rather than one the engine would
/// have preferred. A block above it is not corruption — the ring refuses
/// what it cannot hold and counts the refusal — but it is lost audio, which
/// makes the bound worth stating rather than discovering.
pub(crate) type CaptureFn = Box<dyn FnMut(&[f32], usize) + Send + 'static>;

/// A platform's way of opening the default input device.
pub(crate) trait InputBackend {
    type Open: OpenInput;

    /// Open the default input and negotiate format. No audio flows yet: the
    /// caller reads [`OpenInput::negotiated`], sizes its capture ring on
    /// those facts, then starts the stream.
    // The tests already call this; only the non-test build has no caller until
    // the audio thread gains one.
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "wired by the audio-thread capture slice of #3069")
    )]
    fn open_default_input(request: InputOpenRequest) -> Result<Self::Open, InputOpenRefusal>;
}

/// An opened, negotiated, not-yet-running input stream.
pub(crate) trait OpenInput {
    /// The running stream. Stopping is dropping, as on the output side.
    type Stream;

    #[expect(dead_code, reason = "wired by the audio-thread capture slice of #3069")]
    fn negotiated(&self) -> NegotiatedInput;

    /// Start the stream: `capture` receives every device buffer from here on,
    /// and `on_error` every mid-stream error the backend sees.
    #[expect(dead_code, reason = "wired by the audio-thread capture slice of #3069")]
    fn start(
        self,
        capture: CaptureFn,
        on_error: StreamErrorFn,
    ) -> Result<Self::Stream, InputOpenRefusal>;
}

/// The backend this build routes device opens through: Windows compiles
/// the IAudioClient3/WASAPI backend, everything else keeps cpal.
#[cfg(windows)]
pub(crate) type PlatformOutputBackend = wasapi::backend::WasapiOutputBackend;
#[cfg(not(windows))]
pub(crate) type PlatformOutputBackend = cpal_backend::CpalOutputBackend;

/// The capture counterpart. Windows capture is out of scope (ADR 0027 covers
/// the output path only, and jcosta33/sourdaw#2230 owns the input one), so
/// that build answers by name instead of opening a stream it has no
/// negotiation for.
#[cfg(windows)]
pub(crate) type PlatformInputBackend = wasapi::policy::WasapiInputBackend;
#[cfg(not(windows))]
pub(crate) type PlatformInputBackend = cpal_backend::CpalInputBackend;

/// The stream type the platform backend produces.
pub(crate) type PlatformStream =
    <<PlatformOutputBackend as OutputBackend>::Open as OpenOutput>::Stream;

/// The input stream type the platform backend produces.
#[expect(dead_code, reason = "wired by the audio-thread capture slice of #3069")]
pub(crate) type PlatformInputStream =
    <<PlatformInputBackend as InputBackend>::Open as OpenInput>::Stream;

#[cfg(test)]
mod tests {
    use super::{accept_input, InputOpenRefusal, InputOpenRequest, NegotiatedInput};
    use crate::engine_events::StreamErrorKind;

    const DEVICE: NegotiatedInput = NegotiatedInput {
        sample_rate: 48_000.0,
        channels: 2,
        period_frames: 512,
    };

    #[test]
    fn an_input_sample_rate_the_engine_cannot_carry_refuses_observably() {
        let request = InputOpenRequest {
            engine_sample_rate: 48_000.0,
        };
        let device = NegotiatedInput {
            sample_rate: 44_100.0,
            ..DEVICE
        };

        let refusal = accept_input(device, request).expect_err(
            "an input clock the engine does not run on must refuse rather than be resampled",
        );

        assert_eq!(
            refusal,
            InputOpenRefusal::SampleRateMismatch {
                device_hz: 44_100,
                engine_hz: 48_000,
            }
        );
        // Observably: the refusal reaches the same vocabulary the engine
        // already publishes device failures through.
        assert_eq!(
            refusal.stream_error_kind(),
            StreamErrorKind::StreamInvalidated
        );
    }

    #[test]
    fn an_input_running_the_engine_s_rate_is_accepted_unchanged() {
        let request = InputOpenRequest {
            engine_sample_rate: 48_000.0,
        };

        assert_eq!(accept_input(DEVICE, request), Ok(DEVICE));
    }

    #[test]
    fn a_device_with_no_channels_or_no_period_cannot_shape_a_ring() {
        let request = InputOpenRequest {
            engine_sample_rate: 48_000.0,
        };

        for device in [
            NegotiatedInput {
                channels: 0,
                ..DEVICE
            },
            NegotiatedInput {
                period_frames: 0,
                ..DEVICE
            },
        ] {
            assert_eq!(
                accept_input(device, request),
                Err(InputOpenRefusal::UnsupportedConfiguration)
            );
        }
    }
}
