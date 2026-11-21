//! A VST3 class that talks back through `process`: the outputs a host must
//! hear from a processor.
//!
//! Every call it reports, in `outputParameterChanges`, a read-only meter (the
//! block's input peak). Whenever the host hands it `Drive` it echoes the value
//! straight back, as wrapper-generated plugins do — or, above
//! [`DRIVE_CEILING`], reports the ceiling it clamped the value to — and reports
//! the dependent control `Drive` moves (half of the value it kept). For every note it is handed it emits
//! the note an octave up, one frame later, in `outputEvents`. Audio passes
//! through unchanged.
//!
//! Two writes put the host's guards to the test: with `Drive` it also claims an
//! output queue for [`EMPTY_CLAIM_PARAM_ID`] and adds no point to it, and a
//! write to [`REFUSE_PARAM_ID`] makes it report [`REFUSED_REPORT`] for the
//! modulated control and emit its notes, and then fail the block.
//!
//! The controller half holds only what the host tells it, so a test reads
//! through the controller exactly what the host forwarded.

use crate::vst3_front::{write_chunk, write_tchar};
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};
use vst3::Steinberg::Vst::{
    BusDirection, BusDirections_, BusInfo, BusInfo_::BusFlags_, BusTypes_, Event,
    Event_::EventTypes_, IAudioProcessor, IAudioProcessorTrait, IComponent, IComponentHandler,
    IComponentTrait, IEditController, IEditControllerTrait, IEventListTrait, IParamValueQueueTrait,
    IParameterChanges, IParameterChangesTrait, IoMode, MediaType, MediaTypes_, ParamID, ParamValue,
    ParameterInfo, ParameterInfo_::ParameterFlags_, ProcessData, ProcessSetup, RoutingInfo,
    SpeakerArr, SpeakerArrangement, String128, SymbolicSampleSizes_, TChar,
};
use vst3::Steinberg::{
    int32, kInvalidArgument, kNotImplemented, kResultFalse, kResultOk, tresult, uint32, FIDString,
    FUnknown, IBStream, IPlugView, IPluginBaseTrait, TBool, TUID,
};
use vst3::{uid, Class, ComPtr, ComRef, ComWrapper};

/// The class id of the emitting class.
pub const VST3_EMITTER_CLASS_ID: TUID = uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4C1);
pub(crate) const EMITTER_CLASS_NAME: &str = "Sourdaw Harness Fx Emitter";

/// The control the host writes. Echoed back on every call that carries it.
pub const DRIVE_PARAM_ID: ParamID = 20;
/// The highest `Drive` the processor keeps: a write above it is clamped, and
/// the clamped value is what the processor reports.
pub const DRIVE_CEILING: ParamValue = 0.9;
/// A read-only readout: the block's input peak.
pub const METER_PARAM_ID: ParamID = 21;
/// A control the processor moves itself: half of `Drive`, whenever `Drive`
/// moves.
pub const MODULATED_PARAM_ID: ParamID = 22;
const PARAMS: [ParamID; 3] = [DRIVE_PARAM_ID, METER_PARAM_ID, MODULATED_PARAM_ID];

/// An output queue the processor claims on every `Drive` write and never
/// fills. Not a declared parameter: only the host's output list sees it.
pub const EMPTY_CLAIM_PARAM_ID: ParamID = 23;
/// Writing this makes the processor report [`REFUSED_REPORT`] and emit its
/// notes, and then refuse the block. Not a declared parameter.
pub const REFUSE_PARAM_ID: ParamID = 24;
/// What a refused block reports for [`MODULATED_PARAM_ID`] before failing.
pub const REFUSED_REPORT: ParamValue = 0.25;

/// How far an emitted note sits from the note that caused it.
pub const EMITTED_TRANSPOSE: i16 = 12;
/// How many frames after its cause an emitted note lands.
pub const EMITTED_DELAY_FRAMES: int32 = 1;
/// The pitch of the note-on the processor emits, at frame 0, on every call
/// that writes `Drive`, so a call with no input notes still says whether it was
/// handed an output event list.
pub const DRIVE_MARKER_PITCH: i16 = 1;

const MIDI_CHANNELS: int32 = 16;

/// A fresh instance of the emitter.
pub(crate) fn create() -> Option<ComPtr<FUnknown>> {
    ComWrapper::new(Emitter::new()).to_com_ptr::<FUnknown>()
}

struct Emitter {
    /// Each parameter as the controller believes it, in `PARAMS` order.
    controller_values: [AtomicU64; PARAMS.len()],
}

impl Class for Emitter {
    type Interfaces = (IComponent, IAudioProcessor, IEditController);
}

impl Emitter {
    fn new() -> Self {
        Self {
            controller_values: std::array::from_fn(|_| AtomicU64::new(0f64.to_bits())),
        }
    }

    fn slot(id: ParamID) -> Option<usize> {
        PARAMS.iter().position(|param| *param == id)
    }
}

fn is_direction(direction: BusDirection) -> bool {
    direction == BusDirections_::kInput as BusDirection
        || direction == BusDirections_::kOutput as BusDirection
}

/// The last value one call's input list carries for `param_id`, if any.
///
/// # Safety
/// `changes` must be the live input list of the current `process` call.
unsafe fn last_written(
    changes: ComRef<'_, IParameterChanges>,
    param_id: ParamID,
) -> Option<ParamValue> {
    let mut written = None;
    // SAFETY: the list is live for this call.
    let count = unsafe { changes.getParameterCount() };
    for index in 0..count {
        // SAFETY: `index` is below the count the list reported.
        let queue = unsafe { changes.getParameterData(index) };
        // SAFETY: a queue pointer the list just handed out, live for the call.
        let Some(queue) = (unsafe { ComRef::from_raw(queue) }) else {
            continue;
        };
        // SAFETY: a live queue.
        if unsafe { queue.getParameterId() } != param_id {
            continue;
        }
        // SAFETY: a live queue.
        let points = unsafe { queue.getPointCount() };
        if points <= 0 {
            continue;
        }
        let (mut offset, mut value) = (0, 0.0);
        // SAFETY: `points - 1` is the last point; both out parameters are locals.
        let read = unsafe { queue.getPoint(points - 1, &mut offset, &mut value) };
        if read == kResultOk {
            written = Some(value);
        }
    }
    written
}

/// Claim an output queue for `id` and add no point to it.
///
/// # Safety
/// `changes` must be the live output list of the current `process` call.
unsafe fn claim_without_point(changes: ComRef<'_, IParameterChanges>, id: ParamID) {
    let mut index = 0;
    // SAFETY: the list is live; `id` and `index` are locals.
    unsafe { changes.addParameterData(&id, &mut index) };
}

/// Add one value at the head of the block to an output list.
///
/// # Safety
/// `changes` must be the live output list of the current `process` call.
unsafe fn report(changes: ComRef<'_, IParameterChanges>, id: ParamID, value: ParamValue) {
    let mut index = 0;
    // SAFETY: the list is live; `id` and `index` are locals.
    let queue = unsafe { changes.addParameterData(&id, &mut index) };
    // SAFETY: a queue pointer the list just handed out, live for the call.
    if let Some(queue) = unsafe { ComRef::from_raw(queue) } {
        // SAFETY: a live queue; `index` is a local.
        unsafe { queue.addPoint(0, value, &mut index) };
    }
}

/// Copy the main input to the main output and answer the input's peak.
///
/// # Safety
/// `data` must be the live `ProcessData` of the current call.
unsafe fn pass_audio(data: &ProcessData) -> f32 {
    if data.numSamples <= 0
        || data.numInputs < 1
        || data.numOutputs < 1
        || data.inputs.is_null()
        || data.outputs.is_null()
    {
        return 0.0;
    }
    let frames = data.numSamples as usize;
    // SAFETY: the input bus array holds `numInputs` entries.
    let input = unsafe { &*data.inputs };
    // SAFETY: the output bus array holds `numOutputs` entries.
    let output = unsafe { &*data.outputs };
    // SAFETY: the 32-bit arm, the only size this class accepts.
    let in_table = unsafe { input.__field0.channelBuffers32 };
    // SAFETY: as above, for the output bus.
    let out_table = unsafe { output.__field0.channelBuffers32 };
    if in_table.is_null() || out_table.is_null() {
        return 0.0;
    }
    let channels = input.numChannels.min(output.numChannels).max(0) as usize;
    let mut peak = 0.0f32;
    for channel in 0..channels {
        // SAFETY: `channel` is inside both channel tables.
        let in_slot = unsafe { in_table.add(channel) };
        // SAFETY: as above, for the output table.
        let out_slot = unsafe { out_table.add(channel) };
        // SAFETY: an initialised entry of the input table.
        let source = unsafe { *in_slot };
        // SAFETY: an initialised entry of the output table.
        let target = unsafe { *out_slot };
        if source.is_null() || target.is_null() {
            continue;
        }
        // SAFETY: the host's channel buffer holds `numSamples` frames.
        let source = unsafe { std::slice::from_raw_parts(source, frames) };
        // SAFETY: as above, for the output buffer.
        let target = unsafe { std::slice::from_raw_parts_mut(target, frames) };
        target.copy_from_slice(source);
        peak = source
            .iter()
            .fold(peak, |peak, sample| peak.max(sample.abs()));
    }
    peak
}

/// Emit the note-on that marks a `Drive` write.
///
/// # Safety
/// `data` must be the live `ProcessData` of the current call.
unsafe fn emit_drive_marker(data: &ProcessData) {
    // SAFETY: the output list is live for this call, or null.
    let Some(outputs) = (unsafe { ComRef::from_raw(data.outputEvents) }) else {
        return;
    };
    // SAFETY: `Event` is plain C data; zero is valid for every arm.
    let mut event: Event = unsafe { std::mem::zeroed() };
    event.r#type = EventTypes_::kNoteOnEvent as u16;
    event.__field0.noteOn.pitch = DRIVE_MARKER_PITCH;
    event.__field0.noteOn.velocity = 1.0;
    // SAFETY: a live list; `event` is a local the host copies.
    unsafe { outputs.addEvent(&mut event) };
}

/// Emit every note of the input list an octave up and a frame later.
///
/// # Safety
/// `data` must be the live `ProcessData` of the current call.
unsafe fn emit_notes(data: &ProcessData) {
    // SAFETY: the input list is live for this call, or null.
    let Some(inputs) = (unsafe { ComRef::from_raw(data.inputEvents) }) else {
        return;
    };
    // SAFETY: the output list is live for this call, or null.
    let Some(outputs) = (unsafe { ComRef::from_raw(data.outputEvents) }) else {
        return;
    };
    // SAFETY: a live list.
    let count = unsafe { inputs.getEventCount() };
    for index in 0..count {
        // SAFETY: `Event` is plain C data; zero is valid for every arm.
        let mut event: Event = unsafe { std::mem::zeroed() };
        // SAFETY: `index` is below the count; `event` is a local.
        if unsafe { inputs.getEvent(index, &mut event) } != kResultOk {
            continue;
        }
        if event.r#type == EventTypes_::kNoteOnEvent as u16 {
            // SAFETY: the type tag names the `noteOn` arm.
            unsafe { event.__field0.noteOn.pitch += EMITTED_TRANSPOSE };
        } else if event.r#type == EventTypes_::kNoteOffEvent as u16 {
            // SAFETY: the type tag names the `noteOff` arm.
            unsafe { event.__field0.noteOff.pitch += EMITTED_TRANSPOSE };
        } else {
            continue;
        }
        event.sampleOffset += EMITTED_DELAY_FRAMES;
        // SAFETY: a live list; `event` is a local the host copies.
        unsafe { outputs.addEvent(&mut event) };
    }
}

impl IPluginBaseTrait for Emitter {
    unsafe fn initialize(&self, _context: *mut FUnknown) -> tresult {
        kResultOk
    }

    unsafe fn terminate(&self) -> tresult {
        kResultOk
    }
}

impl IComponentTrait for Emitter {
    unsafe fn getControllerClassId(&self, _class_id: *mut TUID) -> tresult {
        kNotImplemented
    }

    unsafe fn setIoMode(&self, _mode: IoMode) -> tresult {
        kResultOk
    }

    /// One stereo audio bus and one event bus each way.
    unsafe fn getBusCount(&self, _media: MediaType, direction: BusDirection) -> int32 {
        if is_direction(direction) {
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
        if !is_direction(direction) || index != 0 || bus.is_null() {
            return kInvalidArgument;
        }
        let audio = media == MediaTypes_::kAudio as MediaType;
        if !audio && media != MediaTypes_::kEvent as MediaType {
            return kInvalidArgument;
        }
        // SAFETY: `bus` is a valid out parameter.
        let bus = unsafe { &mut *bus };
        bus.mediaType = media;
        bus.direction = direction;
        bus.channelCount = if audio { 2 } else { MIDI_CHANNELS };
        write_tchar(&mut bus.name, if audio { "Main" } else { "Notes" });
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

    unsafe fn setActive(&self, _state: TBool) -> tresult {
        kResultOk
    }

    unsafe fn setState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn getState(&self, state: *mut IBStream) -> tresult {
        // SAFETY: the host passes a live stream for this call.
        unsafe { write_chunk(state, &[]) }
    }
}

impl IAudioProcessorTrait for Emitter {
    unsafe fn setBusArrangements(
        &self,
        inputs: *mut SpeakerArrangement,
        num_ins: int32,
        outputs: *mut SpeakerArrangement,
        num_outs: int32,
    ) -> tresult {
        if num_ins != 1 || num_outs != 1 || inputs.is_null() || outputs.is_null() {
            return kResultFalse;
        }
        // SAFETY: the input array holds the one arrangement its count declares.
        let input = unsafe { *inputs };
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
        if !is_direction(direction) || index != 0 || arrangement.is_null() {
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
        0
    }

    unsafe fn setupProcessing(&self, setup: *mut ProcessSetup) -> tresult {
        if setup.is_null() {
            kInvalidArgument
        } else {
            kResultOk
        }
    }

    unsafe fn setProcessing(&self, _state: TBool) -> tresult {
        kResultOk
    }

    /// Allocation- and lock-free.
    unsafe fn process(&self, data: *mut ProcessData) -> tresult {
        if data.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: the host passes a live `ProcessData` for this call.
        let data = unsafe { &*data };

        // SAFETY: the input list is live for this call, or null.
        let inputs = unsafe { ComRef::from_raw(data.inputParameterChanges) };
        // SAFETY: the current call's live input list.
        let written = inputs.and_then(|changes| unsafe { last_written(changes, DRIVE_PARAM_ID) });
        // SAFETY: as above.
        let refuse = inputs.and_then(|changes| unsafe { last_written(changes, REFUSE_PARAM_ID) });
        if refuse.is_some() {
            // SAFETY: the output list is live for this call, or null.
            if let Some(changes) = unsafe { ComRef::from_raw(data.outputParameterChanges) } {
                // SAFETY: the current call's live output list.
                unsafe { report(changes, MODULATED_PARAM_ID, REFUSED_REPORT) };
            }
            // SAFETY: the current call's live `ProcessData`.
            unsafe { emit_notes(data) };
            return kResultFalse;
        }
        // SAFETY: the current call's live `ProcessData`.
        let peak = unsafe { pass_audio(data) };

        // SAFETY: the output list is live for this call, or null.
        if let Some(changes) = unsafe { ComRef::from_raw(data.outputParameterChanges) } {
            if let Some(value) = written.map(|value| value.min(DRIVE_CEILING)) {
                // SAFETY: the current call's live output list.
                unsafe { report(changes, DRIVE_PARAM_ID, value) };
                // SAFETY: as above.
                unsafe { report(changes, MODULATED_PARAM_ID, value * 0.5) };
                // SAFETY: as above.
                unsafe { claim_without_point(changes, EMPTY_CLAIM_PARAM_ID) };
            }
            // SAFETY: as above.
            unsafe { report(changes, METER_PARAM_ID, f64::from(peak.min(1.0))) };
        }

        if written.is_some() {
            // SAFETY: the current call's live `ProcessData`.
            unsafe { emit_drive_marker(data) };
        }
        // SAFETY: the current call's live `ProcessData`.
        unsafe { emit_notes(data) };
        kResultOk
    }

    unsafe fn getTailSamples(&self) -> uint32 {
        0
    }
}

impl IEditControllerTrait for Emitter {
    unsafe fn setComponentState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn setState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn getState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    unsafe fn getParameterCount(&self) -> int32 {
        PARAMS.len() as int32
    }

    unsafe fn getParameterInfo(&self, index: int32, info: *mut ParameterInfo) -> tresult {
        let Some(id) = usize::try_from(index)
            .ok()
            .and_then(|index| PARAMS.get(index).copied())
        else {
            return kInvalidArgument;
        };
        if info.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: `info` is a valid out parameter.
        let info = unsafe { &mut *info };
        info.id = id;
        let (title, flags) = match id {
            METER_PARAM_ID => ("Meter", ParameterFlags_::kIsReadOnly),
            MODULATED_PARAM_ID => ("Modulated", ParameterFlags_::kCanAutomate),
            _ => ("Drive", ParameterFlags_::kCanAutomate),
        };
        write_tchar(&mut info.title, title);
        write_tchar(&mut info.shortTitle, title);
        write_tchar(&mut info.units, "");
        info.stepCount = 0;
        info.defaultNormalizedValue = 0.0;
        info.unitId = 0;
        info.flags = flags as int32;
        kResultOk
    }

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

    unsafe fn normalizedParamToPlain(&self, _id: ParamID, normalized: ParamValue) -> ParamValue {
        normalized
    }

    unsafe fn plainParamToNormalized(&self, _id: ParamID, plain: ParamValue) -> ParamValue {
        plain
    }

    unsafe fn getParamNormalized(&self, id: ParamID) -> ParamValue {
        Self::slot(id).map_or(0.0, |slot| {
            f64::from_bits(self.controller_values[slot].load(Ordering::Relaxed))
        })
    }

    unsafe fn setParamNormalized(&self, id: ParamID, value: ParamValue) -> tresult {
        let Some(slot) = Self::slot(id) else {
            return kInvalidArgument;
        };
        self.controller_values[slot].store(value.to_bits(), Ordering::Relaxed);
        kResultOk
    }

    unsafe fn setComponentHandler(&self, _handler: *mut IComponentHandler) -> tresult {
        kResultOk
    }

    unsafe fn createView(&self, _name: FIDString) -> *mut IPlugView {
        ptr::null_mut()
    }
}
