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

/// The backend this build routes device opens through: Windows compiles
/// the IAudioClient3/WASAPI backend, everything else keeps cpal.
#[cfg(windows)]
pub(crate) type PlatformOutputBackend = wasapi::backend::WasapiOutputBackend;
#[cfg(not(windows))]
pub(crate) type PlatformOutputBackend = cpal_backend::CpalOutputBackend;

/// The stream type the platform backend produces.
pub(crate) type PlatformStream =
    <<PlatformOutputBackend as OutputBackend>::Open as OpenOutput>::Stream;
