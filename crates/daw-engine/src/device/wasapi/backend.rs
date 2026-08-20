//! The Windows COM plumbing behind the device seam: IAudioClient3 shared
//! low-latency by default, WASAPI Exclusive on explicit opt-in (ADR 0027).
//!
//! Every COM object lives on one dedicated stream thread —
//! `sourdaw-wasapi-output` — which negotiates, runs the event-driven
//! buffer loop, and performs control-side recovery when the device is
//! invalidated mid-stream. The decisions themselves (period arithmetic,
//! format ladder, HRESULT taxonomy, exclusive degrade) are the pure
//! `policy` module's; this file only carries them to the API.

use super::policy::{
    self, negotiate_windows_stream, stream_error_kind_for_hresult, CandidateSource,
    DeviceNegotiation, FormatCandidate, MixFormatReport, NegotiatedPlan, NegotiationFailure,
    SampleLayout, SharedEnginePeriods, WindowsStreamPath,
};
use crate::device::{
    DeviceOpenRequest, NegotiatedOutput, OpenOutput, OutputBackend, RenderFn, StreamErrorFn,
};
use crate::engine_events::StreamErrorKind;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use windows::core::{Interface, GUID, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioClient, IAudioClient3, IAudioRenderClient, IMMDevice,
    IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

/// `mmreg.h` format tags and `ksmedia.h` subformat GUIDs, restated here so
/// the crate does not pull two extra Windows feature families for three
/// constants that have been ABI-frozen since Windows 2000.
const WAVE_FORMAT_TAG_PCM: u16 = 0x0001;
const WAVE_FORMAT_TAG_IEEE_FLOAT: u16 = 0x0003;
const WAVE_FORMAT_TAG_EXTENSIBLE: u16 = 0xFFFE;
const KSDATAFORMAT_SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
    GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

/// How long one event wait may sit before the loop re-checks the stop flag
/// and probes stream health. A healthy event-driven stream signals every
/// engine period (milliseconds), so this bound is only reached when the
/// stream has gone silent.
const EVENT_WAIT_SLICE_MS: u32 = 100;

/// Control-side recovery budget after a device invalidation: how many
/// reopen attempts, and the pause between them. Five seconds total —
/// enough for a default-device switch or a driver restart to settle,
/// short enough that a truly gone device reports out promptly.
const REOPEN_ATTEMPTS: u32 = 20;
const REOPEN_INTERVAL: Duration = Duration::from_millis(250);

pub(crate) struct WasapiOutputBackend;

enum StartMessage {
    Start {
        render: RenderFn,
        on_error: StreamErrorFn,
        ack: Sender<Result<(), String>>,
    },
    Abort,
}

pub(crate) struct WasapiOpenOutput {
    negotiated: NegotiatedOutput,
    start_tx: Sender<StartMessage>,
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

pub(crate) struct WasapiStream {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl OutputBackend for WasapiOutputBackend {
    type Open = WasapiOpenOutput;

    fn open_default_output(request: DeviceOpenRequest) -> Result<WasapiOpenOutput, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let (start_tx, start_rx) = mpsc::channel();
        let (negotiated_tx, negotiated_rx) = mpsc::channel();

        let thread_stop = Arc::clone(&stop);
        let join = thread::Builder::new()
            .name("sourdaw-wasapi-output".to_string())
            .spawn(move || stream_thread_main(request, thread_stop, negotiated_tx, start_rx))
            .map_err(|error| format!("Failed to spawn the WASAPI stream thread: {error}"))?;

        match negotiated_rx.recv() {
            Ok(Ok(negotiated)) => Ok(WasapiOpenOutput {
                negotiated,
                start_tx,
                stop,
                join: Some(join),
            }),
            Ok(Err(error)) => {
                let _ = join.join();
                Err(error)
            }
            Err(_) => {
                let _ = join.join();
                Err("The WASAPI stream thread exited before negotiating a stream".to_string())
            }
        }
    }
}

impl OpenOutput for WasapiOpenOutput {
    type Stream = WasapiStream;

    fn negotiated(&self) -> NegotiatedOutput {
        self.negotiated
    }

    fn start(mut self, render: RenderFn, on_error: StreamErrorFn) -> Result<WasapiStream, String> {
        let (ack_tx, ack_rx) = mpsc::channel();
        self.start_tx
            .send(StartMessage::Start {
                render,
                on_error,
                ack: ack_tx,
            })
            .map_err(|_| "The WASAPI stream thread exited before starting".to_string())?;

        match ack_rx.recv() {
            Ok(Ok(())) => Ok(WasapiStream {
                stop: Arc::clone(&self.stop),
                // Taking the handle disarms this Open's Drop: the running
                // stream now owns the thread.
                join: self.join.take(),
            }),
            Ok(Err(error)) => Err(error),
            Err(_) => Err("The WASAPI stream thread exited before starting the stream".to_string()),
        }
    }
}

impl Drop for WasapiOpenOutput {
    fn drop(&mut self) {
        // Only a never-started open still owns the thread here; a started
        // one handed its join to the stream.
        if let Some(join) = self.join.take() {
            self.stop.store(true, Ordering::Release);
            let _ = self.start_tx.send(StartMessage::Abort);
            let _ = join.join();
        }
    }
}

impl Drop for WasapiStream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

/// Per-process COM initialization scope for the stream thread.
struct ComGuard;

impl ComGuard {
    fn initialize() -> Result<Self, String> {
        // S_FALSE (already initialized on this thread) is success here.
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if hr.is_err() {
            return Err(format!("CoInitializeEx failed: {hr:?}"));
        }
        Ok(Self)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

/// An owned Win32 event handle.
struct EventHandle(HANDLE);

impl EventHandle {
    fn create() -> Result<Self, String> {
        let handle = unsafe { CreateEventW(None, false, false, PCWSTR::null()) }
            .map_err(|error| format!("CreateEventW failed: {error}"))?;
        Ok(Self(handle))
    }
}

impl Drop for EventHandle {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}

/// One owned `WAVEFORMATEX(TENSIBLE)` blob plus the facts the engine and
/// the buffer loop need from it.
#[derive(Clone)]
struct DeviceFormat {
    bytes: Vec<u8>,
    layout: SampleLayout,
    rate: u32,
    channels: u16,
}

impl DeviceFormat {
    fn as_wave_format(&self) -> *const WAVEFORMATEX {
        self.bytes.as_ptr().cast::<WAVEFORMATEX>()
    }

    fn bytes_per_sample(&self) -> usize {
        match self.layout {
            SampleLayout::F32 => 4,
            SampleLayout::I16 => 2,
        }
    }
}

/// Build the extensible blob for one of the engine's own ladder rungs.
fn engine_format_blob(layout: SampleLayout, rate: u32, channels: u16) -> DeviceFormat {
    let bits: u16 = match layout {
        SampleLayout::F32 => 32,
        SampleLayout::I16 => 16,
    };
    let block_align = channels * (bits / 8);
    let extensible = WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_TAG_EXTENSIBLE,
            nChannels: channels,
            nSamplesPerSec: rate,
            nAvgBytesPerSec: rate * u32::from(block_align),
            nBlockAlign: block_align,
            wBitsPerSample: bits,
            cbSize: 22,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 {
            wValidBitsPerSample: bits,
        },
        dwChannelMask: channel_mask(channels),
        SubFormat: match layout {
            SampleLayout::F32 => KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
            SampleLayout::I16 => KSDATAFORMAT_SUBTYPE_PCM,
        },
    };
    let bytes = unsafe {
        std::slice::from_raw_parts(
            (&extensible as *const WAVEFORMATEXTENSIBLE).cast::<u8>(),
            std::mem::size_of::<WAVEFORMATEXTENSIBLE>(),
        )
    }
    .to_vec();
    DeviceFormat {
        bytes,
        layout,
        rate,
        channels,
    }
}

/// The standard speaker masks for the common layouts; a plain low-bit
/// fill for anything wider, which the audio engine accepts for any
/// configuration.
fn channel_mask(channels: u16) -> u32 {
    match channels {
        1 => 0x4, // SPEAKER_FRONT_CENTER
        2 => 0x3, // FRONT_LEFT | FRONT_RIGHT
        _ => (1u32 << channels.min(31)) - 1,
    }
}

/// Copy the device-owned mix format into an owned blob and classify it.
///
/// Returns the blob (always — its rate and channel count seed the ladder
/// even when its layout is not renderable) and the parsed report.
unsafe fn parse_mix_format(raw: *const WAVEFORMATEX) -> (Vec<u8>, MixFormatReport) {
    let header = std::ptr::read_unaligned(raw);
    let total_len = std::mem::size_of::<WAVEFORMATEX>() + usize::from(header.cbSize);
    let bytes = std::slice::from_raw_parts(raw.cast::<u8>(), total_len).to_vec();

    let renderable = match header.wFormatTag {
        WAVE_FORMAT_TAG_IEEE_FLOAT if header.wBitsPerSample == 32 => Some(SampleLayout::F32),
        WAVE_FORMAT_TAG_PCM if header.wBitsPerSample == 16 => Some(SampleLayout::I16),
        WAVE_FORMAT_TAG_EXTENSIBLE if total_len >= std::mem::size_of::<WAVEFORMATEXTENSIBLE>() => {
            let extensible = std::ptr::read_unaligned(raw.cast::<WAVEFORMATEXTENSIBLE>());
            // Copies, not references: the struct is packed, and a reference
            // to an unaligned field is undefined behavior (E0793).
            let valid_bits = { extensible.Samples.wValidBitsPerSample };
            let sub_format = { extensible.SubFormat };
            if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT && header.wBitsPerSample == 32 {
                Some(SampleLayout::F32)
            } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM
                && header.wBitsPerSample == 16
                && valid_bits == 16
            {
                Some(SampleLayout::I16)
            } else {
                None
            }
        }
        _ => None,
    };

    (
        bytes,
        MixFormatReport {
            rate: header.nSamplesPerSec,
            channels: header.nChannels,
            renderable,
        },
    )
}

fn hresult_of(error: &windows::core::Error) -> i32 {
    error.code().0
}

/// A stream that `Initialize` (or `InitializeSharedAudioStream`) has
/// accepted, before the event handle and render client are attached.
struct InitializedClient {
    client: IAudioClient,
    format: DeviceFormat,
    exclusive: bool,
}

/// The live counterpart of the policy's negotiation seam: each call is
/// the corresponding WASAPI method on a fresh `IAudioClient` activation —
/// fresh because `Initialize` is one-shot per client instance and a
/// refused instance must not be reused.
struct LiveNegotiation {
    device: IMMDevice,
    mix_blob: Option<Vec<u8>>,
    mix_report: Option<MixFormatReport>,
    initialized: Option<InitializedClient>,
}

impl LiveNegotiation {
    fn new(device: IMMDevice) -> Self {
        Self {
            device,
            mix_blob: None,
            mix_report: None,
            initialized: None,
        }
    }

    fn activate_client(&self) -> Result<IAudioClient, i32> {
        unsafe { self.device.Activate::<IAudioClient>(CLSCTX_ALL, None) }
            .map_err(|error| hresult_of(&error))
    }

    fn format_for(&self, candidate: &FormatCandidate) -> Result<DeviceFormat, i32> {
        match candidate.source {
            CandidateSource::DeviceMix => {
                let bytes = self
                    .mix_blob
                    .clone()
                    .ok_or(policy::AUDCLNT_E_UNSUPPORTED_FORMAT)?;
                Ok(DeviceFormat {
                    bytes,
                    layout: candidate.spec.layout,
                    rate: candidate.spec.rate,
                    channels: candidate.spec.channels,
                })
            }
            CandidateSource::EngineF32 | CandidateSource::EngineI16 => Ok(engine_format_blob(
                candidate.spec.layout,
                candidate.spec.rate,
                candidate.spec.channels,
            )),
        }
    }
}

impl DeviceNegotiation for LiveNegotiation {
    fn mix_format(&mut self) -> Result<MixFormatReport, i32> {
        if let Some(report) = self.mix_report {
            return Ok(report);
        }
        let client = self.activate_client()?;
        let raw = unsafe { client.GetMixFormat() }.map_err(|error| hresult_of(&error))?;
        let (bytes, report) = unsafe { parse_mix_format(raw) };
        unsafe { CoTaskMemFree(Some(raw.cast())) };
        self.mix_blob = Some(bytes);
        self.mix_report = Some(report);
        Ok(report)
    }

    fn shared_engine_periods(
        &mut self,
        candidate: &FormatCandidate,
    ) -> Result<SharedEnginePeriods, i32> {
        let format = self.format_for(candidate)?;
        let client = self.activate_client()?;
        let client3: IAudioClient3 = client.cast().map_err(|error| hresult_of(&error))?;
        let mut periods = SharedEnginePeriods {
            default: 0,
            fundamental: 0,
            min: 0,
            max: 0,
        };
        unsafe {
            client3.GetSharedModeEnginePeriod(
                format.as_wave_format(),
                &mut periods.default,
                &mut periods.fundamental,
                &mut periods.min,
                &mut periods.max,
            )
        }
        .map_err(|error| hresult_of(&error))?;
        Ok(periods)
    }

    fn init_shared_low_latency(
        &mut self,
        candidate: &FormatCandidate,
        period_frames: u32,
    ) -> Result<(), i32> {
        let format = self.format_for(candidate)?;
        let client = self.activate_client()?;
        let client3: IAudioClient3 = client.cast().map_err(|error| hresult_of(&error))?;
        unsafe {
            client3.InitializeSharedAudioStream(
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                period_frames,
                format.as_wave_format(),
                None,
            )
        }
        .map_err(|error| hresult_of(&error))?;
        self.initialized = Some(InitializedClient {
            client,
            format,
            exclusive: false,
        });
        Ok(())
    }

    fn init_shared_default(&mut self, candidate: &FormatCandidate) -> Result<(), i32> {
        let format = self.format_for(candidate)?;
        let client = self.activate_client()?;
        unsafe {
            client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                0,
                0,
                format.as_wave_format(),
                None,
            )
        }
        .map_err(|error| hresult_of(&error))?;
        self.initialized = Some(InitializedClient {
            client,
            format,
            exclusive: false,
        });
        Ok(())
    }

    fn init_exclusive(&mut self, candidate: &FormatCandidate) -> Result<(), i32> {
        let format = self.format_for(candidate)?;
        let client = self.activate_client()?;

        let mut default_period_hns: i64 = 0;
        let mut minimum_period_hns: i64 = 0;
        unsafe {
            client.GetDevicePeriod(Some(&mut default_period_hns), Some(&mut minimum_period_hns))
        }
        .map_err(|error| hresult_of(&error))?;

        // Event-driven exclusive requires equal buffer duration and period.
        let attempt = |client: &IAudioClient, period_hns: i64| -> Result<(), i32> {
            unsafe {
                client.Initialize(
                    AUDCLNT_SHAREMODE_EXCLUSIVE,
                    AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                    period_hns,
                    period_hns,
                    format.as_wave_format(),
                    None,
                )
            }
            .map_err(|error| hresult_of(&error))
        };

        match attempt(&client, default_period_hns) {
            Ok(()) => {
                self.initialized = Some(InitializedClient {
                    client,
                    format,
                    exclusive: true,
                });
                Ok(())
            }
            Err(hresult) if hresult == policy::AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED => {
                // The documented realignment dance: read the aligned buffer
                // size, convert it back to a period, and retry once on a
                // fresh client (a refused Initialize consumes the instance).
                let aligned_frames =
                    unsafe { client.GetBufferSize() }.map_err(|error| hresult_of(&error))?;
                let aligned_period_hns = ((10_000_000.0 * f64::from(aligned_frames)
                    / f64::from(format.rate))
                    + 0.5) as i64;
                let fresh = self.activate_client()?;
                attempt(&fresh, aligned_period_hns)?;
                self.initialized = Some(InitializedClient {
                    client: fresh,
                    format,
                    exclusive: true,
                });
                Ok(())
            }
            Err(hresult) => Err(hresult),
        }
    }
}

/// A fully attached, started stream: what the buffer loop runs against.
struct StreamRuntime {
    client: IAudioClient,
    render_client: IAudioRenderClient,
    event: EventHandle,
    format: DeviceFormat,
    buffer_frames: u32,
    exclusive: bool,
    /// Preallocated interleaved f32 the render callback fills; sized to
    /// the whole device buffer at attach time so the loop never allocates.
    scratch: Vec<f32>,
}

enum LoopExit {
    Stopped,
    Error(i32),
}

impl StreamRuntime {
    fn attach(initialized: InitializedClient) -> Result<Self, String> {
        let event = EventHandle::create()?;
        unsafe { initialized.client.SetEventHandle(event.0) }
            .map_err(|error| format!("SetEventHandle failed: {error}"))?;
        let buffer_frames = unsafe { initialized.client.GetBufferSize() }
            .map_err(|error| format!("GetBufferSize failed: {error}"))?;
        let render_client = unsafe { initialized.client.GetService::<IAudioRenderClient>() }
            .map_err(|error| format!("GetService(IAudioRenderClient) failed: {error}"))?;
        let scratch =
            vec![0.0f32; buffer_frames as usize * usize::from(initialized.format.channels)];
        Ok(Self {
            client: initialized.client,
            render_client,
            event,
            format: initialized.format,
            buffer_frames,
            exclusive: initialized.exclusive,
            scratch,
        })
    }

    fn start(&self) -> Result<(), String> {
        unsafe { self.client.Start() }.map_err(|error| format!("Failed to play stream: {error}"))
    }

    fn negotiated(&self) -> NegotiatedOutput {
        NegotiatedOutput {
            sample_rate: self.format.rate as f32,
            channels: usize::from(self.format.channels),
        }
    }

    /// How many frames this wakeup may write. Shared mode fills whatever
    /// the engine has consumed; event-driven exclusive owns the whole
    /// buffer each period.
    fn writable_frames(&self) -> Result<u32, i32> {
        if self.exclusive {
            return Ok(self.buffer_frames);
        }
        let padding =
            unsafe { self.client.GetCurrentPadding() }.map_err(|error| hresult_of(&error))?;
        Ok(self.buffer_frames.saturating_sub(padding))
    }

    /// A control-rate liveliness probe for a stream whose event has gone
    /// silent: any client call surfaces `AUDCLNT_E_DEVICE_INVALIDATED`.
    fn health_probe(&self) -> Result<(), i32> {
        unsafe { self.client.GetCurrentPadding() }
            .map(|_| ())
            .map_err(|error| hresult_of(&error))
    }

    /// The event-driven buffer loop.
    ///
    /// RT LAW — this loop and the render callback it invokes run on the
    /// audio path: they allocate nothing, lock nothing, and block on
    /// nothing but the WASAPI buffer event itself. The scratch buffer is
    /// preallocated at attach time; the sample conversion writes in place;
    /// every error exits the loop so that negotiation and recovery — the
    /// things that do allocate — happen control-side, outside it.
    fn run_buffer_loop(&mut self, stop: &AtomicBool, render: &mut RenderFn) -> LoopExit {
        let channels = usize::from(self.format.channels);
        loop {
            if stop.load(Ordering::Acquire) {
                return LoopExit::Stopped;
            }

            let wait = unsafe { WaitForSingleObject(self.event.0, EVENT_WAIT_SLICE_MS) };
            if wait == WAIT_TIMEOUT {
                // A healthy stream signals every period; silence this long
                // means the device may be gone. Probe so a dead endpoint
                // reports as an HRESULT instead of an eternal quiet loop.
                if let Err(hresult) = self.health_probe() {
                    return LoopExit::Error(hresult);
                }
                continue;
            }
            if wait != WAIT_OBJECT_0 {
                return LoopExit::Error(policy::AUDCLNT_E_DEVICE_INVALIDATED);
            }

            let frames = match self.writable_frames() {
                Ok(frames) => frames.min(self.buffer_frames),
                Err(hresult) => return LoopExit::Error(hresult),
            };
            if frames == 0 {
                continue;
            }

            let buffer = match unsafe { self.render_client.GetBuffer(frames) } {
                Ok(buffer) => buffer,
                Err(error) => return LoopExit::Error(hresult_of(&error)),
            };

            let samples = frames as usize * channels;
            let interleaved = &mut self.scratch[..samples];
            render(interleaved, channels);

            unsafe {
                match self.format.layout {
                    SampleLayout::F32 => {
                        std::ptr::copy_nonoverlapping(
                            interleaved.as_ptr().cast::<u8>(),
                            buffer,
                            samples * self.format.bytes_per_sample(),
                        );
                    }
                    SampleLayout::I16 => {
                        let out = buffer.cast::<i16>();
                        for (index, sample) in interleaved.iter().enumerate() {
                            *out.add(index) =
                                (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16;
                        }
                    }
                }
            }

            if let Err(error) = unsafe { self.render_client.ReleaseBuffer(frames, 0) } {
                return LoopExit::Error(hresult_of(&error));
            }
        }
    }
}

impl Drop for StreamRuntime {
    fn drop(&mut self) {
        let _ = unsafe { self.client.Stop() };
    }
}

/// Negotiate and attach one stream on the current (COM-initialized)
/// thread, reporting the chosen path and every refusal on the way there.
fn open_stream_runtime(request: &DeviceOpenRequest) -> Result<StreamRuntime, String> {
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|error| format!("Failed to reach the audio device enumerator: {error}"))?;
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }
        .map_err(|error| format!("No default audio output device found ({error})"))?;

    let mut negotiation = LiveNegotiation::new(device);
    let plan = negotiate_windows_stream(
        &mut negotiation,
        request.exclusive,
        request.force_default_period,
    )
    .map_err(|failure| describe_negotiation_failure(&failure))?;

    report_negotiated_plan(&plan);

    let initialized = negotiation
        .initialized
        .take()
        .ok_or_else(|| "Negotiation reported success without an initialized client".to_string())?;
    StreamRuntime::attach(initialized)
}

fn describe_negotiation_failure(failure: &NegotiationFailure) -> String {
    match failure {
        NegotiationFailure::Fatal { hresult } => format!(
            "The audio endpoint cannot be negotiated with (HRESULT {hresult:#010X}: {:?})",
            stream_error_kind_for_hresult(*hresult)
        ),
        NegotiationFailure::Exhausted { refusals } => {
            let mut message =
                String::from("Every offered stream format was refused by the device:");
            for refusal in refusals {
                message.push_str(&format!(
                    " [{:?}/{:?} {:#010X}]",
                    refusal.source, refusal.stage, refusal.hresult
                ));
            }
            message
        }
    }
}

/// The native-side diagnostics line for which path this stream actually
/// runs on — the report ADR 0027 requires (IAudioClient3 low-latency vs
/// plain shared vs Exclusive), plus every recorded refusal and any
/// exclusive-claim degrade. Control-side only, never in the buffer loop.
fn report_negotiated_plan(plan: &NegotiatedPlan) {
    let path = match plan.path {
        WindowsStreamPath::Exclusive => "WASAPI Exclusive".to_string(),
        WindowsStreamPath::SharedLowLatency { period_frames } => {
            format!("IAudioClient3 shared low-latency, {period_frames}-frame period")
        }
        WindowsStreamPath::SharedDefaultPeriod => {
            "shared default period (IAudioClient3 negotiation unavailable or bypassed)".to_string()
        }
    };
    eprintln!(
        "[Engine] Windows audio path: {path}; format {:?} {} Hz {} ch",
        plan.format.spec.layout, plan.format.spec.rate, plan.format.spec.channels
    );
    for refusal in &plan.refusals {
        eprintln!(
            "[Engine] Windows audio negotiation refusal: {:?} at {:?} (HRESULT {:#010X})",
            refusal.source, refusal.stage, refusal.hresult
        );
    }
    if let Some(hresult) = plan.exclusive_degraded {
        eprintln!(
            "[Engine] Exclusive claim refused (HRESULT {hresult:#010X}); degraded to the shared path"
        );
    }
}

/// The stream thread: negotiate, answer the open, run the buffer loop,
/// and recover control-side when the device is invalidated mid-stream.
fn stream_thread_main(
    request: DeviceOpenRequest,
    stop: Arc<AtomicBool>,
    negotiated_tx: Sender<Result<NegotiatedOutput, String>>,
    start_rx: Receiver<StartMessage>,
) {
    let _com = match ComGuard::initialize() {
        Ok(guard) => guard,
        Err(error) => {
            let _ = negotiated_tx.send(Err(error));
            return;
        }
    };

    let mut runtime = match open_stream_runtime(&request) {
        Ok(runtime) => runtime,
        Err(error) => {
            let _ = negotiated_tx.send(Err(error));
            return;
        }
    };

    if negotiated_tx.send(Ok(runtime.negotiated())).is_err() {
        return;
    }

    let (mut render, mut on_error) = match start_rx.recv() {
        Ok(StartMessage::Start {
            render,
            on_error,
            ack,
        }) => match runtime.start() {
            Ok(()) => {
                let _ = ack.send(Ok(()));
                (render, on_error)
            }
            Err(error) => {
                let _ = ack.send(Err(error));
                return;
            }
        },
        Ok(StartMessage::Abort) | Err(_) => return,
    };

    let original_rate = runtime.negotiated().sample_rate;

    loop {
        match runtime.run_buffer_loop(&stop, &mut render) {
            LoopExit::Stopped => return,
            LoopExit::Error(hresult) => {
                let kind = stream_error_kind_for_hresult(hresult);
                on_error(kind);
                if kind != StreamErrorKind::DeviceNotAvailable {
                    // Not a vanished device: the stream is over, the engine
                    // session above survives and has been told why.
                    return;
                }

                // Control-side re-negotiation (AUDCLNT_E_DEVICE_INVALIDATED
                // family): the engine session — scheduler, graph, the render
                // callback itself — stays alive; only the device stack below
                // it is rebuilt, against whatever the default endpoint now
                // is. All of this allocates freely: we are outside the
                // buffer loop.
                match reopen_after_invalidation(&request, &stop, original_rate) {
                    ReopenOutcome::Reopened(new_runtime) => {
                        runtime = new_runtime;
                        on_error(StreamErrorKind::DeviceChanged);
                    }
                    ReopenOutcome::RateChanged => {
                        // The new endpoint runs at a different rate; resuming
                        // would replay the whole session at the wrong speed.
                        // Report and end the stream; the engine session and
                        // its diagnostics survive.
                        on_error(StreamErrorKind::StreamInvalidated);
                        return;
                    }
                    ReopenOutcome::Stopped | ReopenOutcome::Gone => return,
                }
            }
        }
    }
}

enum ReopenOutcome {
    Reopened(StreamRuntime),
    RateChanged,
    Stopped,
    Gone,
}

fn reopen_after_invalidation(
    request: &DeviceOpenRequest,
    stop: &AtomicBool,
    original_rate: f32,
) -> ReopenOutcome {
    for _ in 0..REOPEN_ATTEMPTS {
        if stop.load(Ordering::Acquire) {
            return ReopenOutcome::Stopped;
        }
        match open_stream_runtime(request) {
            Ok(runtime) => {
                if (runtime.negotiated().sample_rate - original_rate).abs() > f32::EPSILON {
                    return ReopenOutcome::RateChanged;
                }
                if runtime.start().is_err() {
                    thread::sleep(REOPEN_INTERVAL);
                    continue;
                }
                return ReopenOutcome::Reopened(runtime);
            }
            Err(_) => thread::sleep(REOPEN_INTERVAL),
        }
    }
    ReopenOutcome::Gone
}
