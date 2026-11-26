//! The VST3 front end: one combined class (component, audio processor and edit
//! controller in one object) over the same DSP, its factory, and the module
//! entry points each platform's host resolves.
//!
//! The factory lists the class seven times: the second differs only in
//! answering one `process` call ([`crate::FAILING_PROCESS_CALL`]) with
//! `kResultFalse`, and the third only in refusing `setProcessing(true)`: both
//! are what a host must not let pass as processed audio. The fourth is shaped
//! like a plugin whose processor is the truth about its parameters: its
//! controller refuses `setParamNormalized` and reads every value back from the
//! processor, and its `setProcessing` answers the SDK's default
//! `kNotImplemented`. The seventh is an instrument: no audio input, an event
//! input bus, and the note-driven voice of [`crate::note_voice`] in place of
//! the echo, with no latency and no tail. The factory also lists the
//! purpose-built bus and restart classes of [`crate::vst3_probe`].

use crate::clap_front::GAIN_PARAM_ID;
use crate::echo::{
    Echo, GainPoints, ProcessCalls, CHANNELS, ECHO_FRAMES, GAIN_DEFAULT, LATENCY_FRAMES,
};
use crate::note_voice::NoteVoice;
use crate::state::CHUNK_BYTES;
use std::ffi::{c_char, c_void};
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use vst3::Steinberg::Vst::{
    BusDirection, BusDirections_, BusInfo, BusInfo_::BusFlags_, BusTypes_, Event,
    Event_::EventTypes_, IAudioProcessor, IAudioProcessorTrait, IComponent, IComponentHandler,
    IComponentTrait, IEditController, IEditControllerTrait, IEventListTrait, IParamValueQueueTrait,
    IParameterChangesTrait, IoMode, MediaType, MediaTypes_, ParamID, ParamValue, ParameterInfo,
    ParameterInfo_::ParameterFlags_, ProcessData, ProcessSetup, RoutingInfo, SpeakerArr,
    SpeakerArrangement, String128, SymbolicSampleSizes_, TChar,
};
use vst3::Steinberg::{
    int32, kInvalidArgument, kNotImplemented, kResultFalse, kResultOk, tresult, uint32, FIDString,
    FUnknown, IBStream, IBStreamTrait, IPlugView, IPluginBaseTrait, IPluginFactory,
    IPluginFactory2, IPluginFactory2Trait, IPluginFactoryTrait, PClassInfo, PClassInfo2,
    PClassInfo_::ClassCardinality_, PFactoryInfo, TBool, TUID,
};
use vst3::{uid, Class, ComRef, ComWrapper};

/// The class id of the class that processes every block.
pub const VST3_CLASS_ID: TUID = uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4A2);
/// The class id of the class that fails one `process` call.
pub const VST3_PROCESS_ERROR_CLASS_ID: TUID =
    uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4A3);
const CLASS_NAME: &str = "Sourdaw Harness Fx";
const PROCESS_ERROR_CLASS_NAME: &str = "Sourdaw Harness Fx Process Error";
/// The class id of the class that refuses to start processing.
pub const VST3_START_REFUSED_CLASS_ID: TUID =
    uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4A4);
const START_REFUSED_CLASS_NAME: &str = "Sourdaw Harness Fx Start Refused";
/// The class id of the class whose processor holds the truth about `Gain`.
pub const VST3_PROCESSOR_TRUTH_CLASS_ID: TUID =
    uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4A5);
const PROCESSOR_TRUTH_CLASS_NAME: &str = "Sourdaw Harness Fx Processor Truth";
/// The class id of the processor-truth class that also fails one `process`
/// call, flush or block alike.
pub const VST3_PROCESSOR_TRUTH_FAILING_CLASS_ID: TUID =
    uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4A6);
const PROCESSOR_TRUTH_FAILING_CLASS_NAME: &str = "Sourdaw Harness Fx Processor Truth Failing";
/// The class id of the processor-truth variant that refuses its first
/// `setProcessing(1)` and accepts every later one.
pub const VST3_PROCESSOR_TRUTH_LATE_START_CLASS_ID: TUID =
    uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4A7);
const PROCESSOR_TRUTH_LATE_START_CLASS_NAME: &str = "Sourdaw Harness Fx Processor Truth Late Start";
/// The class id of the instrument class: it sounds the notes it is sent.
pub const VST3_INSTRUMENT_CLASS_ID: TUID = uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4A8);
const INSTRUMENT_CLASS_NAME: &str = "Sourdaw Harness Fx Instrument";

/// The class id of the class that refuses every odd-numbered `setProcessing(1)`
/// (the first, the third, ...) and accepts the even ones, so a host sees
/// refusal episodes separated by recoveries.
pub const VST3_ALTERNATING_START_CLASS_ID: TUID =
    uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4A9);
const ALTERNATING_START_CLASS_NAME: &str = "Sourdaw Harness Fx Alternating Start";

/// How one class departs from the plain effect.
#[derive(Clone, Copy, Default)]
struct Departures {
    fails_a_process_call: bool,
    refuses_to_start_processing: bool,
    refuses_first_processing_start: bool,
    refuses_alternate_processing_starts: bool,
    controller_defers_to_processor: bool,
    instrument: bool,
}

struct Vst3Echo {
    echo: Echo,
    /// `Gain` as the controller half believes it. Moved only by the host's
    /// controller calls and by `setComponentState`; the processor's gain moves
    /// only through `ProcessData` and `setState`, as VST3 separates the two.
    controller_gain: AtomicU64,
    process_calls: ProcessCalls,
    refuses_to_start_processing: bool,
    /// Set while the first `setProcessing(1)` is still to be refused.
    refusing_first_start: AtomicBool,
    /// Whether every odd-numbered `setProcessing(1)` is refused, and how many
    /// have been asked so far.
    refuses_alternate_starts: bool,
    start_requests: AtomicU32,
    /// Whether the controller refuses host writes and answers every read from
    /// the processor's own value, with `setProcessing` left at the SDK default.
    controller_defers_to_processor: bool,
    /// Whether this is the instrument class, which sounds notes in place of
    /// echoing its input.
    instrument: bool,
    voice: NoteVoice,
}

impl Class for Vst3Echo {
    type Interfaces = (IComponent, IAudioProcessor, IEditController);
}

impl Vst3Echo {
    fn new(departures: Departures) -> Self {
        Self {
            echo: Echo::new(),
            controller_gain: AtomicU64::new(GAIN_DEFAULT.to_bits()),
            process_calls: ProcessCalls::new(departures.fails_a_process_call),
            refuses_to_start_processing: departures.refuses_to_start_processing,
            refusing_first_start: AtomicBool::new(departures.refuses_first_processing_start),
            refuses_alternate_starts: departures.refuses_alternate_processing_starts,
            start_requests: AtomicU32::new(0),
            controller_defers_to_processor: departures.controller_defers_to_processor,
            instrument: departures.instrument,
            voice: NoteVoice::new(),
        }
    }
}

impl IPluginBaseTrait for Vst3Echo {
    unsafe fn initialize(&self, _context: *mut FUnknown) -> tresult {
        kResultOk
    }

    unsafe fn terminate(&self) -> tresult {
        kResultOk
    }
}

fn is_audio(media: MediaType) -> bool {
    media == MediaTypes_::kAudio as MediaType
}

fn is_event(media: MediaType) -> bool {
    media == MediaTypes_::kEvent as MediaType
}

fn is_input(direction: BusDirection) -> bool {
    direction == BusDirections_::kInput as BusDirection
}

impl Vst3Echo {
    /// An instrument declares no audio input bus; everything else has one bus
    /// each way.
    fn has_audio_bus(&self, direction: BusDirection) -> bool {
        !(self.instrument && is_input(direction))
    }
}

fn is_direction(direction: BusDirection) -> bool {
    direction == BusDirections_::kInput as BusDirection
        || direction == BusDirections_::kOutput as BusDirection
}

impl IComponentTrait for Vst3Echo {
    unsafe fn getControllerClassId(&self, _class_id: *mut TUID) -> tresult {
        kNotImplemented
    }

    unsafe fn setIoMode(&self, _mode: IoMode) -> tresult {
        kResultOk
    }

    unsafe fn getBusCount(&self, media: MediaType, direction: BusDirection) -> int32 {
        if self.instrument && is_event(media) && is_input(direction) {
            return 1;
        }
        if is_audio(media) && is_direction(direction) && self.has_audio_bus(direction) {
            1
        } else {
            0
        }
    }

    unsafe fn getBusInfo(
        &self,
        media: MediaType,
        direction: BusDirection,
        index: int32,
        bus: *mut BusInfo,
    ) -> tresult {
        if index != 0 || bus.is_null() {
            return kInvalidArgument;
        }
        if self.instrument && is_event(media) && is_input(direction) {
            // SAFETY: `bus` is a valid out parameter.
            let bus = unsafe { &mut *bus };
            bus.mediaType = media;
            bus.direction = direction;
            bus.channelCount = 1;
            write_tchar(&mut bus.name, "Notes");
            bus.busType = BusTypes_::kMain as int32;
            bus.flags = BusFlags_::kDefaultActive as uint32;
            return kResultOk;
        }
        if !is_audio(media) || !is_direction(direction) || !self.has_audio_bus(direction) {
            return kInvalidArgument;
        }
        // SAFETY: `bus` is a valid out parameter.
        let bus = unsafe { &mut *bus };
        bus.mediaType = media;
        bus.direction = direction;
        bus.channelCount = CHANNELS as int32;
        write_tchar(&mut bus.name, "Main");
        bus.busType = BusTypes_::kMain as int32;
        bus.flags = BusFlags_::kDefaultActive as uint32;
        kResultOk
    }

    unsafe fn getRoutingInfo(
        &self,
        _in_info: *mut RoutingInfo,
        _out_info: *mut RoutingInfo,
    ) -> tresult {
        kNotImplemented
    }

    unsafe fn activateBus(
        &self,
        _media: MediaType,
        _direction: BusDirection,
        _index: int32,
        _state: TBool,
    ) -> tresult {
        kResultOk
    }

    unsafe fn setActive(&self, state: TBool) -> tresult {
        if state != 0 {
            self.echo.reset();
            self.voice.reset();
        }
        kResultOk
    }

    unsafe fn setState(&self, state: *mut IBStream) -> tresult {
        // SAFETY: the host passes a live stream for this call.
        let Some(chunk) = (unsafe { read_chunk(state) }) else {
            return kResultFalse;
        };
        if self.echo.load(&chunk) {
            kResultOk
        } else {
            kResultFalse
        }
    }

    unsafe fn getState(&self, state: *mut IBStream) -> tresult {
        // SAFETY: the host passes a live stream for this call.
        unsafe { write_chunk(state, &self.echo.save()) }
    }
}

impl IAudioProcessorTrait for Vst3Echo {
    unsafe fn setBusArrangements(
        &self,
        inputs: *mut SpeakerArrangement,
        num_ins: int32,
        outputs: *mut SpeakerArrangement,
        num_outs: int32,
    ) -> tresult {
        let expected_inputs = if self.instrument { 0 } else { 1 };
        if num_ins != expected_inputs || num_outs != 1 || outputs.is_null() {
            return kResultFalse;
        }
        if !self.instrument && inputs.is_null() {
            return kResultFalse;
        }
        let input = if self.instrument {
            SpeakerArr::kStereo
        } else {
            // SAFETY: the input array holds the one arrangement its count declares.
            unsafe { *inputs }
        };
        // SAFETY: the output array holds the one arrangement its count declares.
        let output = unsafe { *outputs };
        if input == SpeakerArr::kStereo && output == SpeakerArr::kStereo {
            kResultOk
        } else {
            kResultFalse
        }
    }

    unsafe fn getBusArrangement(
        &self,
        direction: BusDirection,
        index: int32,
        arrangement: *mut SpeakerArrangement,
    ) -> tresult {
        if !is_direction(direction)
            || index != 0
            || arrangement.is_null()
            || !self.has_audio_bus(direction)
        {
            return kInvalidArgument;
        }
        // SAFETY: `arrangement` is a valid out parameter.
        unsafe { *arrangement = SpeakerArr::kStereo };
        kResultOk
    }

    unsafe fn canProcessSampleSize(&self, symbolic_sample_size: int32) -> tresult {
        if symbolic_sample_size == SymbolicSampleSizes_::kSample32 as int32 {
            kResultOk
        } else {
            kResultFalse
        }
    }

    unsafe fn getLatencySamples(&self) -> uint32 {
        if self.instrument {
            return 0;
        }
        LATENCY_FRAMES as uint32
    }

    unsafe fn setupProcessing(&self, setup: *mut ProcessSetup) -> tresult {
        if setup.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: the host passes a live setup for this call.
        let setup = unsafe { &*setup };
        if setup.symbolicSampleSize != SymbolicSampleSizes_::kSample32 as int32 {
            return kResultFalse;
        }
        self.echo.record_configured_mode(setup.processMode);
        kResultOk
    }

    unsafe fn setProcessing(&self, state: TBool) -> tresult {
        if state != 0 && self.refuses_to_start_processing {
            return kResultFalse;
        }
        if state != 0 && self.refusing_first_start.swap(false, Ordering::Relaxed) {
            return kResultFalse;
        }
        if state != 0
            && self.refuses_alternate_starts
            && self
                .start_requests
                .fetch_add(1, Ordering::Relaxed)
                .is_multiple_of(2)
        {
            return kResultFalse;
        }
        if self.controller_defers_to_processor {
            // `AudioEffect::setProcessing`'s own answer in the SDK.
            return kNotImplemented;
        }
        kResultOk
    }

    /// Render the block, applying each `Gain` point on the sample its
    /// `sampleOffset` names. Allocation- and lock-free: pointer arithmetic over
    /// host-owned buffers only.
    unsafe fn process(&self, data: *mut ProcessData) -> tresult {
        if data.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: the host passes a live `ProcessData` for this call.
        let data = unsafe { &*data };
        if self.process_calls.this_call_fails() {
            return kResultFalse;
        }
        self.echo.record_block_mode(data.processMode);
        // SAFETY: every pointer inside `data` is valid for this call.
        let mut gain_points = unsafe { read_parameter_changes(data) };
        if self.instrument {
            // SAFETY: as above.
            unsafe { render_notes(&self.echo, &self.voice, &mut gain_points, data) };
        } else {
            // SAFETY: as above.
            unsafe { render_block(&self.echo, &mut gain_points, data) };
        }
        // A block with no bus to render — a parameter flush — still ends on
        // its last point.
        gain_points.apply_all(&self.echo);
        kResultOk
    }

    unsafe fn getTailSamples(&self) -> uint32 {
        if self.instrument {
            return 0;
        }
        ECHO_FRAMES as uint32
    }
}

/// Collect every `Gain` point of the block, each at its own `sampleOffset`.
///
/// # Safety
/// `data.inputParameterChanges`, when non-null, must be live for this call.
unsafe fn read_parameter_changes(data: &ProcessData) -> GainPoints {
    let mut gain_points = GainPoints::new();
    // SAFETY: the caller guarantees the list is live.
    let Some(changes) = (unsafe { ComRef::from_raw(data.inputParameterChanges) }) else {
        return gain_points;
    };
    // SAFETY: the list is live for this call.
    let parameter_count = unsafe { changes.getParameterCount() };
    for index in 0..parameter_count {
        // SAFETY: the list is live for this call.
        let queue_pointer = unsafe { changes.getParameterData(index) };
        // SAFETY: a queue the live list hands out is live for this call.
        let Some(queue) = (unsafe { ComRef::from_raw(queue_pointer) }) else {
            continue;
        };
        // SAFETY: the queue is live for this call.
        if unsafe { queue.getParameterId() } != GAIN_PARAM_ID {
            continue;
        }
        // SAFETY: the queue is live for this call.
        let points = unsafe { queue.getPointCount() };
        for point in 0..points {
            let mut offset = 0;
            let mut value = 0.0;
            // SAFETY: the queue is live and the out-pointers are local.
            let read = unsafe { queue.getPoint(point, &mut offset, &mut value) };
            if read == kResultOk {
                gain_points.push(offset.max(0) as u32, value);
            }
        }
    }
    gain_points
}

/// # Safety
/// The bus arrays `data` names must be valid for its `numSamples`.
unsafe fn render_block(echo: &Echo, gain_points: &mut GainPoints, data: &ProcessData) {
    if data.numOutputs < 1 || data.outputs.is_null() {
        return;
    }
    // SAFETY: the caller guarantees the output bus array is valid.
    let output = unsafe { &*data.outputs };
    // SAFETY: reading the union's 32-bit arm, which is what this plugin
    // accepted in `canProcessSampleSize`.
    let out_channels = unsafe { output.__field0.channelBuffers32 };
    if out_channels.is_null() || (output.numChannels as usize) < CHANNELS {
        return;
    }
    let in_channels = if data.numInputs < 1 || data.inputs.is_null() {
        ptr::null_mut()
    } else {
        // SAFETY: as above, for the input bus array.
        let input = unsafe { &*data.inputs };
        if (input.numChannels as usize) < CHANNELS {
            ptr::null_mut()
        } else {
            // SAFETY: as above.
            unsafe { input.__field0.channelBuffers32 }
        }
    };

    for frame in 0..data.numSamples.max(0) as usize {
        let mut sample_in = [0.0; CHANNELS];
        if !in_channels.is_null() {
            for (channel, sample) in sample_in.iter_mut().enumerate() {
                // SAFETY: `channel < CHANNELS <= numChannels`, so the entry is
                // inside the channel table.
                let entry = unsafe { in_channels.add(channel) };
                // SAFETY: `entry` is a table slot, as above.
                let channel_buffer = unsafe { *entry };
                // SAFETY: `frame < numSamples`.
                let source = unsafe { channel_buffer.add(frame) };
                // SAFETY: `source` is inside the channel buffer, as above.
                *sample = unsafe { *source };
            }
        }
        gain_points.apply_due(echo, frame as u32);
        let sample_out = echo.next_frame(sample_in);
        for (channel, sample) in sample_out.iter().enumerate() {
            // SAFETY: as above, for the output bus.
            let entry = unsafe { out_channels.add(channel) };
            // SAFETY: `entry` is a table slot, as above.
            let channel_buffer = unsafe { *entry };
            // SAFETY: `frame < numSamples`, as above.
            let target = unsafe { channel_buffer.add(frame) };
            // SAFETY: `target` is inside the output channel buffer.
            unsafe { *target = *sample };
        }
    }
}

/// Render the block of the instrument class: the voice's level in both
/// channels, each note applied on the sample its event names.
///
/// # Safety
/// `data.inputEvents`, when non-null, must be live for this call and the output
/// bus array `data` names must be valid for its `numSamples`.
unsafe fn render_notes(
    echo: &Echo,
    voice: &NoteVoice,
    gain_points: &mut GainPoints,
    data: &ProcessData,
) {
    if data.numOutputs < 1 || data.outputs.is_null() {
        return;
    }
    // SAFETY: the caller guarantees the output bus array is valid.
    let output = unsafe { &*data.outputs };
    // SAFETY: reading the union's 32-bit arm, which is what this plugin
    // accepted in `canProcessSampleSize`.
    let out_channels = unsafe { output.__field0.channelBuffers32 };
    if out_channels.is_null() || (output.numChannels as usize) < CHANNELS {
        return;
    }
    // SAFETY: the caller guarantees the list is live, or null.
    let events = unsafe { ComRef::from_raw(data.inputEvents) };
    // SAFETY: the list is live for this call.
    let count = events.map_or(0, |events| unsafe { events.getEventCount() });
    let mut next_event = 0;
    // SAFETY: `Event` is a plain `repr(C)` POD for which zero is valid.
    let mut event: Event = unsafe { std::mem::zeroed() };
    let mut pending = false;
    for frame in 0..data.numSamples.max(0) {
        gain_points.apply_due(echo, frame as u32);
        while next_event < count || pending {
            if !pending {
                let Some(events) = events else { break };
                // SAFETY: `next_event` is below the list's own count and
                // `event` is a local out parameter.
                if unsafe { events.getEvent(next_event, &mut event) } != kResultOk {
                    next_event += 1;
                    continue;
                }
                next_event += 1;
                pending = true;
            }
            if event.sampleOffset > frame {
                break;
            }
            pending = false;
            if event.r#type == EventTypes_::kNoteOnEvent as u16 {
                // SAFETY: the type tag says the note-on arm is the live one.
                let note = unsafe { event.__field0.noteOn };
                voice.note_on(note.pitch, note.velocity);
            } else if event.r#type == EventTypes_::kNoteOffEvent as u16 {
                // SAFETY: the type tag says the note-off arm is the live one.
                let note = unsafe { event.__field0.noteOff };
                voice.note_off(note.pitch);
            }
        }
        let level = voice.level(echo.gain() as f32);
        for channel in 0..CHANNELS {
            // SAFETY: `channel < CHANNELS <= numChannels`, inside the channel table.
            let entry = unsafe { out_channels.add(channel) };
            // SAFETY: `entry` is a table slot, as above.
            let channel_buffer = unsafe { *entry };
            // SAFETY: `frame < numSamples`.
            let target = unsafe { channel_buffer.add(frame as usize) };
            // SAFETY: `target` is inside the output channel buffer.
            unsafe { *target = level };
        }
    }
}

impl IEditControllerTrait for Vst3Echo {
    unsafe fn setComponentState(&self, state: *mut IBStream) -> tresult {
        // SAFETY: the host passes a live stream for this call.
        let Some(chunk) = (unsafe { read_chunk(state) }) else {
            return kResultFalse;
        };
        let Some(recorded) = crate::state::decode(&chunk) else {
            return kResultFalse;
        };
        self.controller_gain
            .store(recorded.gain.to_bits(), Ordering::Relaxed);
        kResultOk
    }

    /// The controller keeps no state of its own.
    unsafe fn setState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn getState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn getParameterCount(&self) -> int32 {
        1
    }

    unsafe fn getParameterInfo(&self, index: int32, info: *mut ParameterInfo) -> tresult {
        if index != 0 || info.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: `info` is a valid out parameter.
        let info = unsafe { &mut *info };
        info.id = GAIN_PARAM_ID;
        write_tchar(&mut info.title, "Gain");
        write_tchar(&mut info.shortTitle, "Gain");
        write_tchar(&mut info.units, "");
        info.stepCount = 0;
        info.defaultNormalizedValue = GAIN_DEFAULT;
        info.unitId = 0;
        info.flags = ParameterFlags_::kCanAutomate as int32;
        kResultOk
    }

    /// No display text: the host's tests read values, never their spelling.
    unsafe fn getParamStringByValue(
        &self,
        _id: ParamID,
        _value_normalized: ParamValue,
        _string: *mut String128,
    ) -> tresult {
        kNotImplemented
    }

    unsafe fn getParamValueByString(
        &self,
        _id: ParamID,
        _string: *mut TChar,
        _value_normalized: *mut ParamValue,
    ) -> tresult {
        kNotImplemented
    }

    /// `Gain`'s range is 0..1, so its plain and normalised values coincide.
    unsafe fn normalizedParamToPlain(&self, _id: ParamID, normalized: ParamValue) -> ParamValue {
        normalized
    }

    unsafe fn plainParamToNormalized(&self, _id: ParamID, plain: ParamValue) -> ParamValue {
        plain
    }

    unsafe fn getParamNormalized(&self, id: ParamID) -> ParamValue {
        if id != GAIN_PARAM_ID {
            return 0.0;
        }
        if self.controller_defers_to_processor {
            return self.echo.gain();
        }
        f64::from_bits(self.controller_gain.load(Ordering::Relaxed))
    }

    unsafe fn setParamNormalized(&self, id: ParamID, value: ParamValue) -> tresult {
        if id != GAIN_PARAM_ID {
            return kInvalidArgument;
        }
        if self.controller_defers_to_processor {
            return kResultFalse;
        }
        self.controller_gain
            .store(value.to_bits(), Ordering::Relaxed);
        kResultOk
    }

    unsafe fn setComponentHandler(&self, _handler: *mut IComponentHandler) -> tresult {
        kResultOk
    }

    unsafe fn createView(&self, _name: FIDString) -> *mut IPlugView {
        ptr::null_mut()
    }
}

/// Read exactly one chunk from a host stream, or `None` when it holds less.
///
/// # Safety
/// `stream`, when non-null, must be live for this call.
unsafe fn read_chunk(stream: *mut IBStream) -> Option<[u8; CHUNK_BYTES]> {
    // SAFETY: the caller guarantees the stream is live.
    let stream = unsafe { ComRef::from_raw(stream) }?;
    let mut chunk = [0u8; CHUNK_BYTES];
    let mut filled = 0;
    while filled < CHUNK_BYTES {
        let remaining = &mut chunk[filled..];
        let mut read = 0;
        // SAFETY: `remaining` is writable for its length.
        let result = unsafe {
            stream.read(
                remaining.as_mut_ptr() as *mut c_void,
                remaining.len() as int32,
                &mut read,
            )
        };
        if result != kResultOk || read <= 0 {
            return None;
        }
        filled += read as usize;
    }
    Some(chunk)
}

/// # Safety
/// `stream`, when non-null, must be live for this call.
pub(crate) unsafe fn write_chunk(stream: *mut IBStream, chunk: &[u8]) -> tresult {
    // SAFETY: the caller guarantees the stream is live.
    let Some(stream) = (unsafe { ComRef::from_raw(stream) }) else {
        return kInvalidArgument;
    };
    let mut written = 0;
    while written < chunk.len() {
        let remaining = &chunk[written..];
        let mut count = 0;
        // SAFETY: `remaining` is readable for its length; VST3 declares the
        // buffer mutable but `write` only reads it.
        let result = unsafe {
            stream.write(
                remaining.as_ptr() as *mut c_void,
                remaining.len() as int32,
                &mut count,
            )
        };
        if result != kResultOk || count <= 0 {
            return kResultFalse;
        }
        written += count as usize;
    }
    kResultOk
}

pub(crate) fn write_tchar(target: &mut [TChar], value: &str) {
    let mut written = 0;
    for (slot, unit) in target.iter_mut().zip(value.encode_utf16()) {
        *slot = unit as TChar;
        written += 1;
    }
    if let Some(terminator) = target.get_mut(written) {
        *terminator = 0;
    }
}

fn write_char8(target: &mut [c_char], value: &str) {
    let mut written = 0;
    for (slot, byte) in target.iter_mut().zip(value.bytes()) {
        *slot = byte as c_char;
        written += 1;
    }
    if let Some(terminator) = target.get_mut(written) {
        *terminator = 0;
    }
}

// ── The factory ─────────────────────────────────────────────────────────

struct Factory;

impl Class for Factory {
    type Interfaces = (IPluginFactory2,);
}

/// The id and name of the class at `index` in the factory's list.
fn class_entry(index: int32) -> Option<(TUID, &'static str)> {
    match index {
        0 => Some((VST3_CLASS_ID, CLASS_NAME)),
        1 => Some((VST3_PROCESS_ERROR_CLASS_ID, PROCESS_ERROR_CLASS_NAME)),
        2 => Some((VST3_START_REFUSED_CLASS_ID, START_REFUSED_CLASS_NAME)),
        3 => Some((VST3_PROCESSOR_TRUTH_CLASS_ID, PROCESSOR_TRUTH_CLASS_NAME)),
        4 => Some((
            VST3_PROCESSOR_TRUTH_FAILING_CLASS_ID,
            PROCESSOR_TRUTH_FAILING_CLASS_NAME,
        )),
        5 => Some((
            VST3_PROCESSOR_TRUTH_LATE_START_CLASS_ID,
            PROCESSOR_TRUTH_LATE_START_CLASS_NAME,
        )),
        6 => Some((VST3_INSTRUMENT_CLASS_ID, INSTRUMENT_CLASS_NAME)),
        7 => Some((
            VST3_ALTERNATING_START_CLASS_ID,
            ALTERNATING_START_CLASS_NAME,
        )),
        probe => crate::vst3_probe::class_at(probe - ECHO_CLASSES),
    }
}

impl IPluginFactoryTrait for Factory {
    unsafe fn getFactoryInfo(&self, info: *mut PFactoryInfo) -> tresult {
        if info.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: `info` is a valid out parameter.
        let info = unsafe { &mut *info };
        write_char8(&mut info.vendor, "Sourdaw");
        write_char8(&mut info.url, "");
        write_char8(&mut info.email, "");
        info.flags = 0;
        kResultOk
    }

    unsafe fn countClasses(&self) -> int32 {
        ECHO_CLASSES + crate::vst3_probe::PROBE_CLASSES
    }

    unsafe fn getClassInfo(&self, index: int32, info: *mut PClassInfo) -> tresult {
        let Some((cid, name)) = class_entry(index) else {
            return kInvalidArgument;
        };
        if info.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: `info` is a valid out parameter.
        let info = unsafe { &mut *info };
        info.cid = cid;
        info.cardinality = ClassCardinality_::kManyInstances as int32;
        write_char8(&mut info.category, "Audio Module Class");
        write_char8(&mut info.name, name);
        kResultOk
    }

    unsafe fn createInstance(
        &self,
        cid: FIDString,
        iid: FIDString,
        obj: *mut *mut c_void,
    ) -> tresult {
        if cid.is_null() || iid.is_null() || obj.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: a class id is sixteen bytes.
        let requested = unsafe { *(cid as *const TUID) };
        let departures = if requested == VST3_CLASS_ID {
            Departures::default()
        } else if requested == VST3_PROCESS_ERROR_CLASS_ID {
            Departures {
                fails_a_process_call: true,
                ..Departures::default()
            }
        } else if requested == VST3_START_REFUSED_CLASS_ID {
            Departures {
                refuses_to_start_processing: true,
                ..Departures::default()
            }
        } else if requested == VST3_PROCESSOR_TRUTH_CLASS_ID {
            Departures {
                controller_defers_to_processor: true,
                ..Departures::default()
            }
        } else if requested == VST3_PROCESSOR_TRUTH_FAILING_CLASS_ID {
            Departures {
                controller_defers_to_processor: true,
                fails_a_process_call: true,
                ..Departures::default()
            }
        } else if requested == VST3_PROCESSOR_TRUTH_LATE_START_CLASS_ID {
            Departures {
                controller_defers_to_processor: true,
                refuses_first_processing_start: true,
                ..Departures::default()
            }
        } else if requested == VST3_ALTERNATING_START_CLASS_ID {
            Departures {
                refuses_alternate_processing_starts: true,
                ..Departures::default()
            }
        } else if requested == VST3_INSTRUMENT_CLASS_ID {
            Departures {
                instrument: true,
                ..Departures::default()
            }
        } else if let Some(probe) = crate::vst3_probe::create(&requested) {
            // SAFETY: the caller's `iid` and `obj` are checked non-null above.
            return unsafe { hand_out(probe, iid, obj) };
        } else {
            return kInvalidArgument;
        };
        let Some(instance) = ComWrapper::new(Vst3Echo::new(departures)).to_com_ptr::<FUnknown>()
        else {
            return kResultFalse;
        };
        // SAFETY: the caller's `iid` and `obj` are checked non-null above.
        unsafe { hand_out(instance, iid, obj) }
    }
}

impl IPluginFactory2Trait for Factory {
    /// The same list with sub-categories, which is where VST3 says whether a
    /// class is an instrument or an effect.
    unsafe fn getClassInfo2(&self, index: int32, info: *mut PClassInfo2) -> tresult {
        let Some((cid, name)) = class_entry(index) else {
            return kInvalidArgument;
        };
        if info.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: `info` is a valid out parameter.
        let info = unsafe { &mut *info };
        info.cid = cid;
        info.cardinality = ClassCardinality_::kManyInstances as int32;
        info.classFlags = 0;
        write_char8(&mut info.category, "Audio Module Class");
        write_char8(&mut info.name, name);
        let sub_categories =
            if cid == VST3_INSTRUMENT_CLASS_ID || crate::vst3_probe::is_instrument_class(&cid) {
                "Instrument"
            } else {
                "Fx"
            };
        write_char8(&mut info.subCategories, sub_categories);
        write_char8(&mut info.vendor, "Sourdaw");
        write_char8(&mut info.version, "1.0.0");
        write_char8(&mut info.sdkVersion, "VST 3.7");
        kResultOk
    }
}

/// The number of [`Vst3Echo`] classes the factory lists before the probes.
const ECHO_CLASSES: int32 = 8;

/// Answer a `createInstance` with the interface `iid` names on `instance`.
///
/// # Safety
/// `iid` must point at a 16-byte interface id and `obj` must be writable.
pub(crate) unsafe fn hand_out(
    instance: vst3::ComPtr<FUnknown>,
    iid: FIDString,
    obj: *mut *mut c_void,
) -> tresult {
    let pointer = instance.as_ptr();
    // SAFETY: `pointer` is a live `FUnknown`, so its vtable pointer is readable.
    let vtbl = unsafe { (*pointer).vtbl };
    // SAFETY: a live `FUnknown`'s vtable is valid.
    let query_interface = unsafe { (*vtbl).queryInterface };
    // SAFETY: `queryInterface` takes its own reference for the caller, and
    // `instance` releases this one on drop; the caller vouches for `iid` and `obj`.
    unsafe { query_interface(pointer, iid as *const TUID, obj) }
}

// ── Module entry points ─────────────────────────────────────────────────

/// The one symbol every platform's host resolves. The caller owns the
/// returned reference.
#[no_mangle]
pub extern "system" fn GetPluginFactory() -> *mut IPluginFactory {
    ComWrapper::new(Factory)
        .to_com_ptr::<IPluginFactory>()
        .map_or(ptr::null_mut(), |factory| factory.into_raw())
}

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn bundleEntry(_bundle: *mut c_void) -> bool {
    true
}

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn bundleExit() -> bool {
    true
}

#[cfg(all(unix, not(target_os = "macos")))]
#[no_mangle]
pub extern "C" fn ModuleEntry(_library: *mut c_void) -> bool {
    true
}

#[cfg(all(unix, not(target_os = "macos")))]
#[no_mangle]
pub extern "C" fn ModuleExit() -> bool {
    true
}

#[cfg(target_os = "windows")]
#[no_mangle]
pub extern "system" fn InitDll() -> bool {
    true
}

#[cfg(target_os = "windows")]
#[no_mangle]
pub extern "system" fn ExitDll() -> bool {
    true
}
