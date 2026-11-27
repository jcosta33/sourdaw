//! The refusals of the graph-command surface (`commands::graph`).
//!
//! The napi edge sends every command error as text, so these enums exist to make
//! the Rust side of that contract compile-checked: each failure kind is a variant,
//! `Display` carries the exact text the caller receives, and callers convert with
//! `to_string()` at the existing edge. Some of that text is matched by TypeScript
//! (`pumpNativeLiveAutomationWriter.ts`, `engineNotRenderingRefusal.ts`,
//! `createNativeOfflineGraphBackend.ts`, `isNativeOfflineRenderHeadPastCeiling.ts`); rewording any message needs the matching
//! TypeScript change (ADR 0059). All of these are built on control threads, never
//! the audio callback.

use std::fmt;

use super::levain::LevainBankError;
use super::timeline_sample_lifecycle::TimelineMaterialError;

use daw_dsp::grinder::nam::NamAdmissionError;
use daw_dsp::toaster::transient::TransientShaperError;
use daw_engine::offline::OfflineCommandError;
use daw_engine::scheduler::TIMELINE_CHAIN_SLOT_BUDGET;
use daw_engine::timeline::{
    TimelineRtDiagnosticsSnapshot, AUTOMATION_QUEUE_CAPACITY, BUILTIN_PARAM_NAME_CAPACITY,
    DEVICE_PARAM_QUEUE_CAPACITY, MAX_TIMELINE_BUSES, MAX_TIMELINE_TRACKS, MAX_TRACK_CLIPS,
    MAX_TRACK_SENDS,
};

use super::graph::{
    BACTERIA_MOD_SOURCE_COUNT, BACTERIA_MOD_TARGET_COUNT, GRAND_BOULE_PREVIEW_LIVE_ONLY,
    MAX_BACTERIA_MOD_ASSIGNMENTS, MAX_BATCH_COMMANDS, MAX_IMMEDIATE_DEVICE_PARAMETERS,
    MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH, MAX_MIDI_CONTROLLER, MAX_MIDI_CONTROLLER_VALUE,
    MAX_MIDI_VELOCITY, MAX_OFFLINE_RENDER_FRAMES, OFFLINE_RENDER_HEAD_PAST_CEILING,
    OFFLINE_RENDER_SAMPLE_RATES,
};
use super::offline_plugins::OfflineRenderError;

/// A queue-ledger refusal: the batch is refused whole instead of letting the
/// engine drop a write silently.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum QueueCapacityRefusal {
    Automation,
    DeviceParam,
}

impl fmt::Display for QueueCapacityRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Automation => write!(
                f,
                "automation-queue-capacity — this parameter's native queue is full: \
                 {AUTOMATION_QUEUE_CAPACITY} unlanded writes are pending, counting this \
                 batch and every earlier accepted one; the engine would drop further \
                 writes silently, so the batch refuses whole. These slots release when \
                 the engine's progress echo proves earlier writes landed (playback \
                 passing their stamps frees them for the next batch), when a replace or \
                 hold cancels the stale writes, or when a locate behind their stamps \
                 drops them"
            ),
            Self::DeviceParam => write!(
                f,
                "device-param-queue-capacity — this device's pending window is full: \
                 {DEVICE_PARAM_QUEUE_CAPACITY} changes are charged, counting this batch \
                 and every earlier accepted one; the engine would drop the writes \
                 silently, so the batch refuses whole instead. The window frees as the \
                 engine's progress echo proves earlier changes landed — playback passing \
                 their stamps releases them for the next batch"
            ),
        }
    }
}

impl std::error::Error for QueueCapacityRefusal {}

/// The engine slot is filled but its render callback is not running.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EngineNotRendering {
    /// A graph batch met a stalled stream; `fault` is the stream's last reported
    /// fault kind, already formatted (empty when it reported none).
    StreamStalled {
        fault: String,
    },
    TimelineRetirement,
}

impl fmt::Display for EngineNotRendering {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StreamStalled { fault } => write!(
                f,
                "engine-not-rendering: the output stream stopped calling back{fault}; the \
                 engine renders nothing until the stream resumes or it is restarted"
            ),
            Self::TimelineRetirement => {
                f.write_str("engine-not-rendering: timeline retirement requires engine recovery")
            }
        }
    }
}

impl std::error::Error for EngineNotRendering {}

/// A fault in an offline mapping call that crosses the wire as an error rather
/// than a batch refusal; the TypeScript backend matches the text prefix.
#[derive(Debug)]
pub(crate) enum MappingFault {
    /// A `prior` that was already accepted once no longer replays.
    PriorNoLongerMaps { reason: Box<GraphRefusal> },
    /// The named session is absent or held at a different revision.
    SessionUnknown { session_id: String, revision: u64 },
}

impl fmt::Display for MappingFault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PriorNoLongerMaps { reason } => {
                write!(f, "previously applied commands no longer map: {reason}")
            }
            Self::SessionUnknown {
                session_id,
                revision,
            } => write!(
                f,
                "mapping session unknown: '{session_id}' is not held at revision {revision} — \
                 resend the full prior to re-establish it"
            ),
        }
    }
}

impl std::error::Error for MappingFault {}

/// A value off the wire that no engine quantity can be built from. `what` names
/// the field as the refusal prints it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ValueRefusal {
    NotFinite { what: String },
    Negative { what: String },
    ExceedsFrameRange { what: String },
    ExceedsRampSpan { what: String },
}

impl fmt::Display for ValueRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFinite { what } => write!(f, "{what} is not a finite number"),
            Self::Negative { what } => write!(f, "{what} is negative"),
            Self::ExceedsFrameRange { what } => write!(f, "{what} exceeds the frame range"),
            Self::ExceedsRampSpan { what } => write!(f, "{what} does not fit a ramp span"),
        }
    }
}

impl std::error::Error for ValueRefusal {}

/// Why the graph surface refused a batch, a command, or a helper's input.
///
/// A refusal that names the command carrying it either has a `command` field
/// or is wrapped in [`GraphRefusal::WithCommand`]; one about a device is
/// wrapped in [`GraphRefusal::ForDevice`] where the text prefixes the device.
#[derive(Debug)]
pub(crate) enum GraphRefusal {
    Value(ValueRefusal),
    QueueCapacity(QueueCapacityRefusal),
    Mapping(MappingFault),
    /// `{command}: {reason}`.
    WithCommand {
        command: &'static str,
        reason: Box<GraphRefusal>,
    },
    /// `device '{device_id}' {reason}`.
    ForDevice {
        device_id: String,
        reason: Box<GraphRefusal>,
    },
    /// Every refused command of one batch, by index.
    Commands(Vec<(usize, GraphRefusal)>),
    LockPoisoned {
        lock: &'static str,
        cause: String,
    },
    /// A poisoned mutex reported by its poison error's text alone.
    Poisoned {
        cause: String,
    },
    /// A refusal from the timeline-material lifecycle.
    TimelineMaterial(TimelineMaterialError),
    /// A levain bank build's refusal.
    LevainBank(LevainBankError),
    /// A refusal from the offline render's plugin instances or its cancel.
    OfflineRender(OfflineRenderError),
    OfflineCommand(OfflineCommandError),
    OfflineDroppedCommands {
        diagnostics: TimelineRtDiagnosticsSnapshot,
    },
    /// The engine refused scheduled notes after admission: the print would
    /// carry them as rests.
    OfflineDroppedMidi {
        batches_refused: u64,
        event_buffer_overflows: u64,
    },
    TransientShaper(TransientShaperError),
    InvalidBatch(serde_json::Error),
    CorrelationMalformed(serde_json::Error),
    CorrelationStale {
        app_revision: u64,
        runtime_revision: u64,
    },
    ResultNotSerialized(serde_json::Error),
    UnsupportedSchemaVersion {
        schema_version: u32,
    },
    BatchTooLarge {
        commands: usize,
    },
    TimelineOwnedElsewhere,
    TimelineLeaseRequired,

    PreviewTargetOffStrip,
    PreviewTargetNotGrandBoule,
    PreviewIncarnationUnavailable,
    PreviewGenerationStale,
    PreviewLiveOnly,
    PreviewNoteOutOfRange,
    PreviewVelocityOutOfRange,

    NamAdmission(NamAdmissionError),
    NamPayloadLimit,
    NamTooManyRequests,
    NamRequiresPlainGrinder,
    NamByteSumOverflow,
    NamTransactionByteLimit,
    NamTargetMissing,
    NamTargetGenerationMismatch,
    NamRequestCommandAbsent,
    NamSampleRateMismatch,
    NamReservationAbsent,
    NamPlanAbsent,
    NamInitialBodyAbsent,
    NamReplacementCommandAbsent,
    NamReceiptMetadataLimit,
    NamRequiresSchemaVersion2,
    NamOfflineGated,

    RecordParameterCeiling {
        parameters: usize,
    },
    BatchParameterCeiling {
        parameters: usize,
    },

    UnknownStrip {
        command: &'static str,
        strip_id: String,
    },
    UnknownBus {
        command: &'static str,
        bus_id: String,
    },
    UnknownDevice {
        command: &'static str,
        device_id: String,
    },
    DeviceNotOnStrip {
        command: &'static str,
        device_id: String,
        strip_id: String,
    },
    StripExists {
        command: &'static str,
        strip_id: String,
    },
    TrackCapacity,
    BusCapacity,
    NegativeVcaMultiplier {
        command: &'static str,
    },
    ChainExceeds {
        command: &'static str,
        max: usize,
    },
    ClosesCycle {
        command: &'static str,
        strip_id: String,
    },
    RouteTargetUnknown {
        strip_id: String,
    },
    AlreadySends {
        track_id: String,
        bus_id: String,
    },
    SendCapacity {
        track_id: String,
    },
    SendTargetIsTrack {
        bus_id: String,
    },
    NoSend {
        command: &'static str,
        track_id: String,
        bus_id: String,
    },
    ChainAtCapacity {
        track_id: String,
    },
    VcaMultiplierRange,

    NoNoteStore {
        command: &'static str,
        device_id: String,
    },
    ProbabilityOutOfRange {
        probability: f64,
    },
    NoteUnaddressable {
        command: &'static str,
        note: u8,
    },
    ChannelUnaddressable {
        command: &'static str,
        channel: i16,
    },
    /// More note events scheduled at one device than its store may hold: in
    /// one batch, or across an offline render's whole batch.
    MidiNoteCeiling {
        notes: usize,
        ceiling: usize,
    },
    VelocityOutOfRange {
        velocity: u8,
    },
    ControllerOutOfRange {
        controller: u8,
    },
    ControllerValueOutOfRange {
        value: u8,
    },
    ClearWindowInverted {
        from_frame: u64,
        to_frame: u64,
    },
    MasterGainNegative,

    NotHostedParameterId {
        parameter_id: String,
    },
    NoNativeAddress {
        parameter_id: String,
    },
    GrinderModelUnknownDevice,
    GrinderModelTargetMismatch,
    HostedParametersElsewhere {
        device_id: String,
    },
    HostedBypassElsewhere {
        device_id: String,
    },
    NotBacteria {
        device_id: String,
    },
    ModAssignmentRowCeiling {
        rows: usize,
    },
    ModSourceUnknown {
        source_id: u8,
    },
    ModTargetUnknown {
        target_param: u16,
    },

    ExternalPluginUnbound {
        device_id: String,
    },
    NoNativeRealisation {
        device_id: String,
        device_type: String,
    },
    NotInstrumentParameterName {
        device_id: String,
        key: String,
    },
    FractionalProofParameter {
        device_id: String,
        key: String,
    },
    ProofParameterRefused {
        device_id: String,
        key: String,
    },
    DuplicateProofModuleOrder {
        device_id: String,
    },
    NoProofParameter {
        device_id: String,
        key: String,
    },
    NoTransientShaperParameter {
        device_id: String,
        key: String,
    },
    KneadUnmapped {
        device_id: String,
        key: String,
    },
    HostedInstanceNotAttached {
        device_id: String,
        instance_id: String,
    },
    DeviceAlreadyInChain {
        device_id: String,
    },
    ModAssignmentsNotBacteria {
        device_id: String,
        device_type: String,
    },
    CrumbsNotAttached {
        device_id: String,
    },
    TooManyModAssignments {
        device_id: String,
        rows: usize,
    },
    LevainNoBank {
        device_id: String,
    },
    LevainBankUnregistered {
        device_id: String,
        bank_key: String,
    },
    ChainSlotBudget {
        device_id: String,
    },

    GateWriteShapeUnsupported {
        gate: &'static str,
    },
    RampLandsBeforeStart,
    SmoothedWriteUnsupported,

    ClipOnBus {
        track_id: String,
    },
    ClipCapacity {
        track_id: String,
    },
    ClipRateNotPositive {
        rate: f64,
    },
    ClipRateUnrenderable,
    ClipGainNegative,
    FadeInBeforeStart,
    FadeOutAfterEnd,

    PcmNotWholeFrames {
        pcm_len: usize,
        channels: usize,
    },
    PcmEmpty,
    PcmTooLong {
        frames: usize,
    },

    OfflineSampleRateOutOfRange {
        sample_rate: f64,
    },
    OfflineFrameCountZero,
    OfflineFrameCountTooLarge {
        frames: usize,
    },
    /// The requested frames fit the ceiling, the compensation head rendered
    /// ahead of them does not.
    OfflineHeadPastCeiling {
        frames: usize,
        head_frames: usize,
    },
}

impl GraphRefusal {
    pub(crate) fn with_command(command: &'static str, reason: impl Into<Self>) -> Self {
        Self::WithCommand {
            command,
            reason: Box::new(reason.into()),
        }
    }

    pub(crate) fn for_device(device_id: &str, reason: impl Into<Self>) -> Self {
        Self::ForDevice {
            device_id: device_id.to_string(),
            reason: Box::new(reason.into()),
        }
    }

    pub(crate) fn lock_poisoned(lock: &'static str, cause: &impl fmt::Display) -> Self {
        Self::LockPoisoned {
            lock,
            cause: cause.to_string(),
        }
    }
}

impl From<ValueRefusal> for GraphRefusal {
    fn from(refusal: ValueRefusal) -> Self {
        Self::Value(refusal)
    }
}

impl From<QueueCapacityRefusal> for GraphRefusal {
    fn from(refusal: QueueCapacityRefusal) -> Self {
        Self::QueueCapacity(refusal)
    }
}

impl From<MappingFault> for GraphRefusal {
    fn from(fault: MappingFault) -> Self {
        Self::Mapping(fault)
    }
}

impl From<NamAdmissionError> for GraphRefusal {
    fn from(error: NamAdmissionError) -> Self {
        Self::NamAdmission(error)
    }
}

impl fmt::Display for GraphRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Value(refusal) => refusal.fmt(f),
            Self::QueueCapacity(refusal) => refusal.fmt(f),
            Self::Mapping(fault) => fault.fmt(f),
            Self::WithCommand { command, reason } => write!(f, "{command}: {reason}"),
            Self::ForDevice { device_id, reason } => write!(f, "device '{device_id}' {reason}"),
            Self::Commands(refusals) => {
                for (position, (index, reason)) in refusals.iter().enumerate() {
                    if position > 0 {
                        f.write_str("; ")?;
                    }
                    write!(f, "commands[{index}]: {reason}")?;
                }
                Ok(())
            }
            Self::LockPoisoned { lock, cause } => write!(f, "Failed to lock {lock}: {cause}"),
            Self::Poisoned { cause } => f.write_str(cause),
            Self::TimelineMaterial(refusal) => refusal.fmt(f),
            Self::LevainBank(refusal) => refusal.fmt(f),
            Self::OfflineRender(error) => error.fmt(f),
            Self::OfflineCommand(error) => error.fmt(f),
            Self::OfflineDroppedCommands { diagnostics } => write!(
                f,
                "offline-render-dropped-commands: the engine refused part of the batch after \
                 admission ({diagnostics:?}); the output is not the batch and is discarded"
            ),
            Self::OfflineDroppedMidi {
                batches_refused,
                event_buffer_overflows,
            } => write!(
                f,
                "offline-render-dropped-midi: the engine refused scheduled notes after \
                 admission (note-store batch refusals: {batches_refused}, event-buffer \
                 overflows: {event_buffer_overflows}); the output is not the batch and is \
                 discarded"
            ),
            Self::TransientShaper(error) => error.fmt(f),
            Self::InvalidBatch(error) => write!(f, "Invalid graph command batch: {error}"),
            Self::CorrelationMalformed(error) => write!(f, "correlation-malformed: {error}"),
            Self::CorrelationStale {
                app_revision,
                runtime_revision,
            } => write!(
                f,
                "correlation-stale — the batch was built against live-engine revision \
                 {app_revision}, but the engine is at revision {runtime_revision}; the batch \
                 lost its race and refuses before the graph changes"
            ),
            Self::ResultNotSerialized(error) => write!(f, "Result did not serialize: {error}"),
            Self::UnsupportedSchemaVersion { schema_version } => write!(
                f,
                "unsupported schemaVersion {schema_version} (this backend speaks 1 and model \
                 wire 2)"
            ),
            Self::BatchTooLarge { commands } => write!(
                f,
                "batch carries {commands} commands, past the ceiling of {MAX_BATCH_COMMANDS}"
            ),
            Self::TimelineOwnedElsewhere => {
                f.write_str("Timeline graph belongs to another project owner")
            }
            Self::TimelineLeaseRequired => {
                f.write_str("Graph batch requires a timeline material lease")
            }

            Self::PreviewTargetOffStrip => {
                f.write_str("Grand Boule preview target is not on the requested strip")
            }
            Self::PreviewTargetNotGrandBoule => {
                f.write_str("Grand Boule preview target is not a Grand Boule device")
            }
            Self::PreviewIncarnationUnavailable => {
                f.write_str("Grand Boule preview engine incarnation is unavailable")
            }
            Self::PreviewGenerationStale => {
                f.write_str("Grand Boule preview target generation is stale")
            }
            Self::PreviewLiveOnly => f.write_str(GRAND_BOULE_PREVIEW_LIVE_ONLY),
            Self::PreviewNoteOutOfRange => {
                f.write_str("Grand Boule preview note must be in A0 through C8")
            }
            Self::PreviewVelocityOutOfRange => {
                f.write_str("Grand Boule preview velocity must be in (0, 1]")
            }

            Self::NamAdmission(error) => error.fmt(f),
            Self::NamPayloadLimit => f.write_str("Native NAM payload identity/byte limit"),
            Self::NamTooManyRequests => {
                f.write_str("Native NAM transaction has too many or duplicate device requests")
            }
            Self::NamRequiresPlainGrinder => {
                f.write_str("Native NAM payload requires a plain built-in Grinder")
            }
            Self::NamByteSumOverflow => f.write_str("Native NAM byte sum overflow"),
            Self::NamTransactionByteLimit => f.write_str("Native NAM transaction byte limit"),
            Self::NamTargetMissing => f.write_str("Native NAM target was removed or not mapped"),
            Self::NamTargetGenerationMismatch => {
                f.write_str("Native NAM target generation mismatch")
            }
            Self::NamRequestCommandAbsent => f.write_str("Native NAM request command absent"),
            Self::NamSampleRateMismatch => {
                f.write_str("Native NAM capture/actual engine sample-rate mismatch")
            }
            Self::NamReservationAbsent => f.write_str("Native NAM reservation absent"),
            Self::NamPlanAbsent => f.write_str("Native NAM preflight plan absent"),
            Self::NamInitialBodyAbsent => f.write_str("Native NAM initial Grinder body absent"),
            Self::NamReplacementCommandAbsent => {
                f.write_str("Native NAM replacement command absent")
            }
            Self::NamReceiptMetadataLimit => f.write_str("Native NAM receipt metadata limit"),
            Self::NamRequiresSchemaVersion2 => {
                f.write_str("Native NAM payload requires schemaVersion 2")
            }
            Self::NamOfflineGated => {
                f.write_str("Imported native NAM is live-only; offline NAM remains gated")
            }

            Self::RecordParameterCeiling { parameters } => write!(
                f,
                "record carries {parameters} parameters, past the ceiling of \
                 {MAX_IMMEDIATE_DEVICE_PARAMETERS}"
            ),
            Self::BatchParameterCeiling { parameters } => write!(
                f,
                "batch carries {parameters} immediate parameters, past the ceiling of \
                 {MAX_IMMEDIATE_DEVICE_PARAMETERS_PER_BATCH}"
            ),

            Self::UnknownStrip { command, strip_id } => {
                write!(f, "{command}: unknown strip '{strip_id}'")
            }
            Self::UnknownBus { command, bus_id } => write!(f, "{command}: unknown bus '{bus_id}'"),
            Self::UnknownDevice { command, device_id } => {
                write!(f, "{command}: unknown device '{device_id}'")
            }
            Self::DeviceNotOnStrip {
                command,
                device_id,
                strip_id,
            } => write!(
                f,
                "{command}: device '{device_id}' is not on strip '{strip_id}'"
            ),
            Self::StripExists { command, strip_id } => {
                write!(f, "{command}: strip id '{strip_id}' already exists")
            }
            Self::TrackCapacity => write!(
                f,
                "create-track-strip: the graph holds its maximum of {MAX_TIMELINE_TRACKS} tracks"
            ),
            Self::BusCapacity => write!(
                f,
                "create-bus-strip: the graph holds its maximum of {MAX_TIMELINE_BUSES} buses"
            ),
            Self::NegativeVcaMultiplier { command } => {
                write!(f, "{command}: vcaMultiplier is negative")
            }
            Self::ChainExceeds { command, max } => {
                write!(f, "{command}: chain exceeds {max} devices")
            }
            Self::ClosesCycle { command, strip_id } => {
                write!(f, "{command}: routing '{strip_id}' there closes a cycle")
            }
            Self::RouteTargetUnknown { strip_id } => {
                write!(
                    f,
                    "route target '{strip_id}' is not a strip this graph holds"
                )
            }
            Self::AlreadySends { track_id, bus_id } => {
                write!(f, "add-send: '{track_id}' already sends to '{bus_id}'")
            }
            Self::SendCapacity { track_id } => write!(
                f,
                "add-send: '{track_id}' holds its maximum of {MAX_TRACK_SENDS} sends"
            ),
            Self::SendTargetIsTrack { bus_id } => write!(
                f,
                "add-send: send target '{bus_id}' is a track, and a native send lands only on \
                 a bus"
            ),
            Self::NoSend {
                command,
                track_id,
                bus_id,
            } => write!(f, "{command}: '{track_id}' has no send to '{bus_id}'"),
            Self::ChainAtCapacity { track_id } => {
                write!(f, "insert-device: the chain on '{track_id}' is at capacity")
            }
            Self::VcaMultiplierRange => {
                f.write_str("set-strip-vca-multiplier requires a nonnegative f32 multiplier")
            }

            Self::NoNoteStore { command, device_id } => {
                write!(f, "{command}: device '{device_id}' holds no note store")
            }
            Self::ProbabilityOutOfRange { probability } => write!(
                f,
                "schedule-midi: probability {probability} is outside 0..=1"
            ),
            Self::NoteUnaddressable { command, note } => {
                write!(f, "{command}: note {note} has no address in the note store")
            }
            Self::ChannelUnaddressable { command, channel } => write!(
                f,
                "{command}: channel {channel} has no address in the note store"
            ),
            Self::MidiNoteCeiling { notes, ceiling } => write!(
                f,
                "schedule-midi: {notes} notes for one device, past the store's ceiling of \
                 {ceiling}"
            ),
            Self::VelocityOutOfRange { velocity } => write!(
                f,
                "send-midi-note: velocity {velocity} is outside 0..={MAX_MIDI_VELOCITY}"
            ),
            Self::ControllerOutOfRange { controller } => write!(
                f,
                "send-midi-control: controller {controller} is outside 0..={MAX_MIDI_CONTROLLER}"
            ),
            Self::ControllerValueOutOfRange { value } => write!(
                f,
                "send-midi-control: value {value} is outside 0..={MAX_MIDI_CONTROLLER_VALUE}"
            ),
            Self::ClearWindowInverted {
                from_frame,
                to_frame,
            } => write!(
                f,
                "clear-midi: window {from_frame}..{to_frame} ends before it starts"
            ),
            Self::MasterGainNegative => f.write_str("set-master-gain: gain is negative"),

            Self::NotHostedParameterId { parameter_id } => write!(
                f,
                "write-device-parameter: parameter '{parameter_id}' is not a hosted plugin \
                 parameter id"
            ),
            Self::NoNativeAddress { parameter_id } => write!(
                f,
                "write-device-parameter: parameter '{parameter_id}' has no native address"
            ),
            Self::GrinderModelUnknownDevice => f.write_str("set-grinder-model: unknown device"),
            Self::GrinderModelTargetMismatch => {
                f.write_str("set-grinder-model: target is not the requested Grinder")
            }
            Self::HostedParametersElsewhere { device_id } => write!(
                f,
                "set-device-parameters: device '{device_id}' is an externally hosted plugin, \
                 whose parameters take the plugin host's own control path"
            ),
            Self::HostedBypassElsewhere { device_id } => write!(
                f,
                "set-device-bypass: device '{device_id}' is an externally hosted plugin, \
                 whose bypass takes the plugin host's own control path"
            ),
            Self::NotBacteria { device_id } => write!(
                f,
                "set-device-mod-assignments: device '{device_id}' is not a bacteria device"
            ),
            Self::ModAssignmentRowCeiling { rows } => write!(
                f,
                "set-device-mod-assignments: batch carries {rows} rows, past the ceiling of \
                 {MAX_BACTERIA_MOD_ASSIGNMENTS}"
            ),
            Self::ModSourceUnknown { source_id } => write!(
                f,
                "sourceId {source_id} names no engine modulation source, past the ceiling of \
                 {BACTERIA_MOD_SOURCE_COUNT}"
            ),
            Self::ModTargetUnknown { target_param } => write!(
                f,
                "targetParam {target_param} names no engine modulation target, past the ceiling \
                 of {BACTERIA_MOD_TARGET_COUNT}"
            ),

            Self::ExternalPluginUnbound { device_id } => write!(
                f,
                "device '{device_id}' is an externally hosted plugin with no engine-owned \
                 instance to bind"
            ),
            Self::NoNativeRealisation {
                device_id,
                device_type,
            } => write!(
                f,
                "device '{device_id}' of type '{device_type}' has no native realisation"
            ),
            Self::NotInstrumentParameterName { device_id, key } => write!(
                f,
                "device '{device_id}' carries parameter '{key}', which is not an instrument \
                 parameter name: a name is 1 to {BUILTIN_PARAM_NAME_CAPACITY} bytes of ASCII \
                 letters, digits and underscores"
            ),
            Self::FractionalProofParameter { device_id, key } => write!(
                f,
                "device '{device_id}' refuses fractional Proof parameter '{key}'"
            ),
            Self::ProofParameterRefused { device_id, key } => write!(
                f,
                "device '{device_id}' refuses Proof parameter '{key}' or its value"
            ),
            Self::DuplicateProofModuleOrder { device_id } => write!(
                f,
                "device '{device_id}' carries a duplicate Proof module order"
            ),
            Self::NoProofParameter { device_id, key } => {
                write!(f, "device '{device_id}' has no Proof parameter '{key}'")
            }
            Self::NoTransientShaperParameter { device_id, key } => write!(
                f,
                "device '{device_id}' has no Transient Shaper parameter '{key}'"
            ),
            Self::KneadUnmapped { device_id, key } => write!(
                f,
                "device '{device_id}' carries parameter '{key}', which knead does not map"
            ),
            Self::HostedInstanceNotAttached {
                device_id,
                instance_id,
            } => write!(
                f,
                "device '{device_id}' names hosted plugin instance '{instance_id}', which is \
                 not attached to the engine"
            ),
            Self::DeviceAlreadyInChain { device_id } => {
                write!(f, "device id '{device_id}' is already in a chain")
            }
            Self::ModAssignmentsNotBacteria {
                device_id,
                device_type,
            } => write!(
                f,
                "device '{device_id}' of type '{device_type}' carries modAssignments, which \
                 only a bacteria device may set"
            ),
            Self::CrumbsNotAttached { device_id } => write!(
                f,
                "device '{device_id}' is a Crumbs sampler whose native instance is not \
                 attached to the engine"
            ),
            Self::TooManyModAssignments { device_id, rows } => write!(
                f,
                "device '{device_id}' names {rows} mod assignments, past the engine's ceiling \
                 of {MAX_BACTERIA_MOD_ASSIGNMENTS}"
            ),
            Self::LevainNoBank { device_id } => {
                write!(
                    f,
                    "device '{device_id}' of type levain names no sample bank"
                )
            }
            Self::LevainBankUnregistered {
                device_id,
                bank_key,
            } => write!(
                f,
                "device '{device_id}' names levain bank '{bank_key}', which is not registered"
            ),
            Self::ChainSlotBudget { device_id } => write!(
                f,
                "device '{device_id}': the project holds its maximum of \
                 {TIMELINE_CHAIN_SLOT_BUDGET} native devices"
            ),

            Self::GateWriteShapeUnsupported { gate } => write!(
                f,
                "write-parameter: gate-write-shape-unsupported — {gate} accepts only a step \
                 natively"
            ),
            Self::RampLandsBeforeStart => {
                f.write_str("write-parameter: ramp-to lands before it starts")
            }
            Self::SmoothedWriteUnsupported => f.write_str(
                "write-parameter: smoothed-write-unsupported — the native automation queue has \
                 no exponential-approach primitive (Web Audio setTargetAtTime); refused rather \
                 than landed as a different shape",
            ),

            Self::ClipOnBus { track_id } => write!(
                f,
                "schedule-clip: strip '{track_id}' is a bus; only a track plays clips"
            ),
            Self::ClipCapacity { track_id } => write!(
                f,
                "schedule-clip: track '{track_id}' holds its maximum of {MAX_TRACK_CLIPS} clips"
            ),
            Self::ClipRateNotPositive { rate } => write!(
                f,
                "schedule-clip: playbackRate {rate} refused — a clip rate must be positive"
            ),
            Self::ClipRateUnrenderable => {
                f.write_str("schedule-clip: the clip's effective rate is not renderable")
            }
            Self::ClipGainNegative => f.write_str("schedule-clip: clip gain is negative"),
            Self::FadeInBeforeStart => {
                f.write_str("schedule-clip: fadeIn reaches full before the clip starts")
            }
            Self::FadeOutAfterEnd => {
                f.write_str("schedule-clip: fadeOut begins after the clip ends")
            }

            Self::PcmNotWholeFrames { pcm_len, channels } => write!(
                f,
                "PCM byte length {pcm_len} is not a whole number of {channels}-channel f32 frames"
            ),
            Self::PcmEmpty => f.write_str(
                "PCM payload holds zero frames — a clip scheduled from it could only render \
                 silence, which the contract forbids for a real source",
            ),
            Self::PcmTooLong { frames } => write!(
                f,
                "PCM payload holds {frames} frames per channel, above the \
                 {MAX_OFFLINE_RENDER_FRAMES}-frame ceiling"
            ),

            Self::OfflineSampleRateOutOfRange { sample_rate } => write!(
                f,
                "Sample rate {sample_rate} Hz is outside the offline render's supported range of \
                 {} to {} Hz",
                OFFLINE_RENDER_SAMPLE_RATES.start(),
                OFFLINE_RENDER_SAMPLE_RATES.end()
            ),
            Self::OfflineFrameCountZero => f.write_str("Frame count must be at least 1"),
            Self::OfflineFrameCountTooLarge { frames } => write!(
                f,
                "Frame count {frames} exceeds the offline render ceiling of \
                 {MAX_OFFLINE_RENDER_FRAMES}"
            ),
            Self::OfflineHeadPastCeiling {
                frames,
                head_frames,
            } => write!(
                f,
                "{OFFLINE_RENDER_HEAD_PAST_CEILING}: frame count {frames} plus the \
                 {head_frames}-frame compensation head exceeds the offline render ceiling \
                 of {MAX_OFFLINE_RENDER_FRAMES}"
            ),
        }
    }
}

impl std::error::Error for GraphRefusal {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::OfflineRender(error) => Some(error),
            Self::TimelineMaterial(error) => Some(error),
            Self::LevainBank(error) => Some(error),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_render_bound_refusals_keep_their_text() {
        assert_eq!(
            GraphRefusal::OfflineSampleRateOutOfRange {
                sample_rate: 7_999.0
            }
            .to_string(),
            "Sample rate 7999 Hz is outside the offline render's supported range of 8000 to \
             384000 Hz"
        );
        assert_eq!(
            GraphRefusal::OfflineFrameCountZero.to_string(),
            "Frame count must be at least 1"
        );
        assert_eq!(
            GraphRefusal::OfflineFrameCountTooLarge { frames: 28_800_001 }.to_string(),
            "Frame count 28800001 exceeds the offline render ceiling of 28800000"
        );
        assert_eq!(
            GraphRefusal::OfflineHeadPastCeiling {
                frames: 28_800_000,
                head_frames: 512,
            }
            .to_string(),
            "offline-render-head-past-ceiling: frame count 28800000 plus the 512-frame \
             compensation head exceeds the offline render ceiling of 28800000"
        );
    }

    #[test]
    fn queue_capacity_refusals_start_with_the_tokens_typescript_matches() {
        assert!(QueueCapacityRefusal::Automation
            .to_string()
            .starts_with("automation-queue-capacity — this parameter's native queue is full: "));
        assert!(QueueCapacityRefusal::DeviceParam
            .to_string()
            .starts_with("device-param-queue-capacity — this device's pending window is full: "));
    }

    #[test]
    fn engine_not_rendering_refusals_carry_the_prefix_typescript_matches() {
        let stalled = EngineNotRendering::StreamStalled {
            fault: " after reporting DeviceChanged".into(),
        }
        .to_string();
        assert_eq!(
            stalled,
            "engine-not-rendering: the output stream stopped calling back after reporting \
             DeviceChanged; the engine renders nothing until the stream resumes or it is restarted"
        );
        assert_eq!(
            EngineNotRendering::TimelineRetirement.to_string(),
            "engine-not-rendering: timeline retirement requires engine recovery"
        );
    }

    #[test]
    fn mapping_faults_carry_the_prefixes_typescript_matches() {
        assert_eq!(
            MappingFault::PriorNoLongerMaps {
                reason: Box::new(GraphRefusal::Commands(vec![(
                    0,
                    GraphRefusal::UnknownStrip {
                        command: "set-track-output",
                        strip_id: "t1".into(),
                    },
                )])),
            }
            .to_string(),
            "previously applied commands no longer map: commands[0]: set-track-output: unknown \
             strip 't1'"
        );
        assert_eq!(
            MappingFault::SessionUnknown {
                session_id: "s1".into(),
                revision: 3
            }
            .to_string(),
            "mapping session unknown: 's1' is not held at revision 3 — resend the full prior \
             to re-establish it"
        );
    }

    /// The composite refusals rebuild the text the per-site `format!` calls
    /// they replaced produced: a batch's refusals joined by `; `, a command
    /// prefix, a device prefix, and a lock's poison text.
    #[test]
    fn composite_refusals_print_the_text_the_formatted_strings_did() {
        let refusal = GraphRefusal::Commands(vec![
            (
                0,
                GraphRefusal::with_command(
                    "set-device-mod-assignments",
                    GraphRefusal::for_device(
                        "d1",
                        GraphRefusal::ModSourceUnknown { source_id: 20 },
                    ),
                ),
            ),
            (
                2,
                GraphRefusal::with_command("write-parameter", QueueCapacityRefusal::Automation),
            ),
        ]);
        let text = refusal.to_string();
        assert!(
            text.starts_with(
                "commands[0]: set-device-mod-assignments: device 'd1' sourceId 20 names no engine \
                 modulation source, past the ceiling of 16; commands[2]: write-parameter: \
                 automation-queue-capacity — "
            ),
            "got: {text}"
        );
        assert_eq!(
            GraphRefusal::lock_poisoned("engine", &"poisoned lock: another task failed inside")
                .to_string(),
            "Failed to lock engine: poisoned lock: another task failed inside"
        );
        assert_eq!(
            GraphRefusal::Value(ValueRefusal::NotFinite {
                what: "gain".into()
            })
            .to_string(),
            "gain is not a finite number"
        );
    }
}
