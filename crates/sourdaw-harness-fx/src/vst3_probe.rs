//! Purpose-built VST3 classes that each put one hosting rule to the test
//! through the real module loader.
//!
//! Both are combined classes (component, audio processor and edit controller
//! in one object) that copy their main input to their main output channel by
//! channel and keep a log of the lifecycle calls a host makes on them, which
//! their state chunk carries back out:
//!
//! * **Mono Copy** declares a mono main input and a mono main output, so what
//!   comes out is exactly what the host fed its one input channel.
//! * **Reconfiguring** starts with a stereo input and a mono output and
//!   changes itself when a host writes one of its trigger parameters, then
//!   asks for a restart the way a plugin's controller does: widening its
//!   output to stereo (`kIoChanged`), moving to a six-channel output no stereo
//!   host can feed (`kIoChanged`), or publishing one more parameter
//!   (`kReloadComponent`).
//!
//! Like the rest of the crate, test-only.

use crate::vst3_front::{write_chunk, write_tchar};
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use vst3::Steinberg::Vst::{
    BusDirection, BusDirections_, BusInfo, BusInfo_::BusFlags_, BusTypes_, IAudioProcessor,
    IAudioProcessorTrait, IComponent, IComponentHandler, IComponentHandlerTrait, IComponentTrait,
    IEditController, IEditControllerTrait, IoMode, MediaType, MediaTypes_, ParamID, ParamValue,
    ParameterInfo, ParameterInfo_::ParameterFlags_, ProcessData, ProcessSetup, RestartFlags_,
    RoutingInfo, SpeakerArr, SpeakerArrangement, String128, SymbolicSampleSizes_, TChar,
};
use vst3::Steinberg::{
    int32, kInvalidArgument, kNotImplemented, kResultFalse, kResultOk, tresult, uint32, FIDString,
    FUnknown, IBStream, IPlugView, IPluginBaseTrait, TBool, TUID,
};
use vst3::{uid, Class, ComPtr, ComRef, ComWrapper};

/// The class id of the mono-in, mono-out copy.
pub const VST3_MONO_COPY_CLASS_ID: TUID = uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4B1);
/// The class id of the class that reconfigures itself on a trigger write.
pub const VST3_RECONFIGURING_CLASS_ID: TUID =
    uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4B2);
/// The class id of the same reconfiguring class, listed as an instrument.
pub const VST3_RECONFIGURING_INSTRUMENT_CLASS_ID: TUID =
    uid(0x5D0A_F0E5, 0x4A7C_4F1B, 0x9C3E_2B61, 0x7E0D_F4B3);
const MONO_COPY_CLASS_NAME: &str = "Sourdaw Harness Fx Mono Copy";
const RECONFIGURING_CLASS_NAME: &str = "Sourdaw Harness Fx Reconfiguring";
const RECONFIGURING_INSTRUMENT_CLASS_NAME: &str = "Sourdaw Harness Fx Reconfiguring Instrument";

/// How many classes this module adds to the factory's list.
pub(crate) const PROBE_CLASSES: int32 = 4;

/// Writing this above one half widens the output to stereo and asks for
/// `kIoChanged`.
pub const WIDEN_OUTPUT_PARAM_ID: ParamID = 10;
/// Writing this above one half moves the output to six channels — which this
/// class then refuses to narrow — and asks for `kIoChanged`.
pub const SURROUND_OUTPUT_PARAM_ID: ParamID = 11;
/// Writing this above one half publishes [`ADDED_PARAM_ID`] and asks for
/// `kReloadComponent`.
pub const ADD_PARAMETER_PARAM_ID: ParamID = 12;
/// The parameter a reload publishes.
pub const ADDED_PARAM_ID: ParamID = 13;
/// Writing this above one half asks for `kIoChanged`, and from then on every
/// activation asks for it again from inside `setActive`.
pub const RESTART_FOREVER_PARAM_ID: ParamID = 14;
const TRIGGER_PARAMS: [ParamID; 4] = [
    WIDEN_OUTPUT_PARAM_ID,
    SURROUND_OUTPUT_PARAM_ID,
    ADD_PARAMETER_PARAM_ID,
    RESTART_FOREVER_PARAM_ID,
];

/// One byte per lifecycle call in the log the state chunk carries.
pub const LOG_DEACTIVATE: u8 = b'd';
pub const LOG_ACTIVATE: u8 = b'a';
pub const LOG_BUS_INFO: u8 = b'i';
pub const LOG_BUS_ARRANGEMENTS: u8 = b'r';
pub const LOG_SETUP_PROCESSING: u8 = b's';

const SURROUND_CHANNELS: usize = 6;

/// The id and name of the probe at `index` in this module's list.
pub(crate) fn class_at(index: int32) -> Option<(TUID, &'static str)> {
    match index {
        0 => Some((VST3_MONO_COPY_CLASS_ID, MONO_COPY_CLASS_NAME)),
        1 => Some((VST3_RECONFIGURING_CLASS_ID, RECONFIGURING_CLASS_NAME)),
        2 => Some((
            VST3_RECONFIGURING_INSTRUMENT_CLASS_ID,
            RECONFIGURING_INSTRUMENT_CLASS_NAME,
        )),
        3 => Some((
            crate::vst3_emitter::VST3_EMITTER_CLASS_ID,
            crate::vst3_emitter::EMITTER_CLASS_NAME,
        )),
        _ => None,
    }
}

/// Whether the factory lists `class_id` under the `Instrument` sub-category.
pub(crate) fn is_instrument_class(class_id: &TUID) -> bool {
    *class_id == VST3_RECONFIGURING_INSTRUMENT_CLASS_ID
}

/// A fresh instance of the probe `class_id` names, or `None` for another id.
pub(crate) fn create(class_id: &TUID) -> Option<ComPtr<FUnknown>> {
    if *class_id == crate::vst3_emitter::VST3_EMITTER_CLASS_ID {
        return crate::vst3_emitter::create();
    }
    let (inputs, outputs) = if *class_id == VST3_MONO_COPY_CLASS_ID {
        (1, 1)
    } else if *class_id == VST3_RECONFIGURING_CLASS_ID
        || *class_id == VST3_RECONFIGURING_INSTRUMENT_CLASS_ID
    {
        (2, 1)
    } else {
        return None;
    };
    ComWrapper::new(Probe::new(inputs, outputs)).to_com_ptr::<FUnknown>()
}

struct Probe {
    /// Main input channels the class declares and runs.
    inputs: usize,
    /// Main output channels the class declares and runs.
    outputs: AtomicUsize,
    /// Whether the class runs only its six-channel output.
    surround: AtomicBool,
    extra_parameter: AtomicBool,
    /// Whether every activation asks for another bus restart.
    restarts_forever: AtomicBool,
    trigger_values: [AtomicU64; TRIGGER_PARAMS.len()],
    handler: AtomicPtr<IComponentHandler>,
    log: Mutex<Vec<u8>>,
}

impl Class for Probe {
    type Interfaces = (IComponent, IAudioProcessor, IEditController);
}

impl Probe {
    fn new(inputs: usize, outputs: usize) -> Self {
        Self {
            inputs,
            outputs: AtomicUsize::new(outputs),
            surround: AtomicBool::new(false),
            extra_parameter: AtomicBool::new(false),
            restarts_forever: AtomicBool::new(false),
            trigger_values: std::array::from_fn(|_| AtomicU64::new(0f64.to_bits())),
            handler: AtomicPtr::new(ptr::null_mut()),
            log: Mutex::new(Vec::new()),
        }
    }

    /// Control path only: every logged call is one VST3 binds to the UI
    /// thread, so the lock never meets `process`.
    fn record(&self, call: u8) {
        self.log
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(call);
    }

    fn output_channels(&self) -> usize {
        if self.surround.load(Ordering::Relaxed) {
            SURROUND_CHANNELS
        } else {
            self.outputs.load(Ordering::Relaxed)
        }
    }

    fn channels(&self, direction: BusDirection) -> usize {
        if direction == BusDirections_::kInput as BusDirection {
            self.inputs
        } else {
            self.output_channels()
        }
    }

    /// Reconfigure as `id` names, then ask the host for the restart that
    /// change needs, from the controller as a plugin does.
    fn trigger(&self, id: ParamID) {
        let flag = match id {
            WIDEN_OUTPUT_PARAM_ID => {
                self.outputs.store(2, Ordering::Relaxed);
                RestartFlags_::kIoChanged
            }
            SURROUND_OUTPUT_PARAM_ID => {
                self.surround.store(true, Ordering::Relaxed);
                RestartFlags_::kIoChanged
            }
            ADD_PARAMETER_PARAM_ID => {
                self.extra_parameter.store(true, Ordering::Relaxed);
                RestartFlags_::kReloadComponent
            }
            RESTART_FOREVER_PARAM_ID => {
                self.restarts_forever.store(true, Ordering::Relaxed);
                RestartFlags_::kIoChanged
            }
            _ => return,
        };
        self.ask_for_restart(flag);
    }

    /// Call the host's `restartComponent`, as a plugin does from its own call.
    fn ask_for_restart(&self, flag: int32) {
        // SAFETY: the host handed this pointer to `setComponentHandler` and
        // keeps the handler alive until it clears it.
        if let Some(handler) = unsafe { ComRef::from_raw(self.handler.load(Ordering::Acquire)) } {
            // SAFETY: a live handler, called from inside one of this plugin's
            // own calls.
            unsafe { handler.restartComponent(flag) };
        }
    }

    fn parameter_ids(&self) -> impl Iterator<Item = ParamID> {
        let extra = self
            .extra_parameter
            .load(Ordering::Relaxed)
            .then_some(ADDED_PARAM_ID);
        TRIGGER_PARAMS.into_iter().chain(extra)
    }

    fn trigger_slot(id: ParamID) -> Option<usize> {
        TRIGGER_PARAMS.iter().position(|trigger| *trigger == id)
    }
}

fn is_audio(media: MediaType) -> bool {
    media == MediaTypes_::kAudio as MediaType
}

fn is_direction(direction: BusDirection) -> bool {
    direction == BusDirections_::kInput as BusDirection
        || direction == BusDirections_::kOutput as BusDirection
}

/// The speaker arrangement this class states for a bus of `channels`.
fn arrangement_of(channels: usize) -> SpeakerArrangement {
    match channels {
        1 => SpeakerArr::kMono,
        2 => SpeakerArr::kStereo,
        _ => SpeakerArr::k51,
    }
}

impl IPluginBaseTrait for Probe {
    unsafe fn initialize(&self, _context: *mut FUnknown) -> tresult {
        kResultOk
    }

    unsafe fn terminate(&self) -> tresult {
        kResultOk
    }
}

impl IComponentTrait for Probe {
    unsafe fn getControllerClassId(&self, _class_id: *mut TUID) -> tresult {
        kNotImplemented
    }

    unsafe fn setIoMode(&self, _mode: IoMode) -> tresult {
        kResultOk
    }

    unsafe fn getBusCount(&self, media: MediaType, direction: BusDirection) -> int32 {
        if is_audio(media) && is_direction(direction) {
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
        if !is_audio(media) || !is_direction(direction) || index != 0 || bus.is_null() {
            return kInvalidArgument;
        }
        self.record(LOG_BUS_INFO);
        // SAFETY: `bus` is a valid out parameter.
        let bus = unsafe { &mut *bus };
        bus.mediaType = media;
        bus.direction = direction;
        bus.channelCount = self.channels(direction) as int32;
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
        self.record(if state != 0 {
            LOG_ACTIVATE
        } else {
            LOG_DEACTIVATE
        });
        if state != 0 && self.restarts_forever.load(Ordering::Relaxed) {
            self.ask_for_restart(RestartFlags_::kIoChanged);
        }
        kResultOk
    }

    unsafe fn setState(&self, _state: *mut IBStream) -> tresult {
        kResultOk
    }

    /// The lifecycle log, one byte per call.
    unsafe fn getState(&self, state: *mut IBStream) -> tresult {
        let log = self
            .log
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        // SAFETY: the host passes a live stream for this call.
        unsafe { write_chunk(state, &log) }
    }
}

impl IAudioProcessorTrait for Probe {
    /// Accepts exactly the widths the class declares, as a plugin with fixed
    /// buses does.
    unsafe fn setBusArrangements(
        &self,
        inputs: *mut SpeakerArrangement,
        num_ins: int32,
        outputs: *mut SpeakerArrangement,
        num_outs: int32,
    ) -> tresult {
        self.record(LOG_BUS_ARRANGEMENTS);
        if num_ins != 1 || num_outs != 1 || inputs.is_null() || outputs.is_null() {
            return kResultFalse;
        }
        // SAFETY: the input array holds the one arrangement its count declares.
        let input = unsafe { *inputs };
        // SAFETY: the output array holds the one arrangement its count declares.
        let output = unsafe { *outputs };
        if input == arrangement_of(self.inputs) && output == arrangement_of(self.output_channels())
        {
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
        unsafe { *arrangement = arrangement_of(self.channels(direction)) };
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
            return kInvalidArgument;
        }
        self.record(LOG_SETUP_PROCESSING);
        kResultOk
    }

    unsafe fn setProcessing(&self, _state: TBool) -> tresult {
        kResultOk
    }

    /// Copy each input channel to the output channel of the same index, and
    /// silence any output channel past the input's width. Allocation- and
    /// lock-free.
    unsafe fn process(&self, data: *mut ProcessData) -> tresult {
        if data.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: the host passes a live `ProcessData` for this call.
        let data = unsafe { &*data };
        if data.numOutputs < 1 || data.outputs.is_null() || data.numSamples <= 0 {
            return kResultOk;
        }
        // SAFETY: the output bus array holds `numOutputs` entries.
        let output = unsafe { &*data.outputs };
        // SAFETY: reading the union's 32-bit arm, the only size this class accepts.
        let out_table = unsafe { output.__field0.channelBuffers32 };
        if out_table.is_null() {
            return kResultOk;
        }
        let (in_table, in_width) = if data.numInputs < 1 || data.inputs.is_null() {
            (ptr::null_mut(), 0)
        } else {
            // SAFETY: the input bus array holds `numInputs` entries.
            let input = unsafe { &*data.inputs };
            // SAFETY: as above, for the input bus.
            let table = unsafe { input.__field0.channelBuffers32 };
            (table, input.numChannels.max(0) as usize)
        };
        let frames = data.numSamples as usize;
        for channel in 0..output.numChannels.max(0) as usize {
            // SAFETY: `channel < numChannels`, inside the output channel table.
            let slot = unsafe { out_table.add(channel) };
            // SAFETY: `slot` points at an initialised entry of that table.
            let target = unsafe { *slot };
            if target.is_null() {
                continue;
            }
            // SAFETY: the host's channel buffer holds `numSamples` frames.
            let target = unsafe { std::slice::from_raw_parts_mut(target, frames) };
            let source = if in_table.is_null() || channel >= in_width {
                ptr::null_mut()
            } else {
                // SAFETY: `channel < in_width`, inside the input channel table.
                let slot = unsafe { in_table.add(channel) };
                // SAFETY: `slot` points at an initialised entry of that table.
                unsafe { *slot }
            };
            if source.is_null() {
                target.fill(0.0);
                continue;
            }
            // SAFETY: the host's channel buffer holds `numSamples` frames.
            let source = unsafe { std::slice::from_raw_parts(source, frames) };
            target.copy_from_slice(source);
        }
        kResultOk
    }

    unsafe fn getTailSamples(&self) -> uint32 {
        0
    }
}

impl IEditControllerTrait for Probe {
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
        self.parameter_ids().count() as int32
    }

    unsafe fn getParameterInfo(&self, index: int32, info: *mut ParameterInfo) -> tresult {
        let Some(id) = usize::try_from(index)
            .ok()
            .and_then(|index| self.parameter_ids().nth(index))
        else {
            return kInvalidArgument;
        };
        if info.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: `info` is a valid out parameter.
        let info = unsafe { &mut *info };
        info.id = id;
        let title = if id == ADDED_PARAM_ID {
            "Added"
        } else {
            "Trigger"
        };
        write_tchar(&mut info.title, title);
        write_tchar(&mut info.shortTitle, title);
        write_tchar(&mut info.units, "");
        info.stepCount = 0;
        info.defaultNormalizedValue = 0.0;
        info.unitId = 0;
        info.flags = ParameterFlags_::kCanAutomate as int32;
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
        Self::trigger_slot(id).map_or(0.0, |slot| {
            f64::from_bits(self.trigger_values[slot].load(Ordering::Relaxed))
        })
    }

    /// A trigger fires when its value crosses above one half.
    unsafe fn setParamNormalized(&self, id: ParamID, value: ParamValue) -> tresult {
        let Some(slot) = Self::trigger_slot(id) else {
            return if id == ADDED_PARAM_ID && self.extra_parameter.load(Ordering::Relaxed) {
                kResultOk
            } else {
                kInvalidArgument
            };
        };
        let previous =
            f64::from_bits(self.trigger_values[slot].swap(value.to_bits(), Ordering::Relaxed));
        if previous <= 0.5 && value > 0.5 {
            self.trigger(id);
        }
        kResultOk
    }

    unsafe fn setComponentHandler(&self, handler: *mut IComponentHandler) -> tresult {
        self.handler.store(handler, Ordering::Release);
        kResultOk
    }

    unsafe fn createView(&self, _name: FIDString) -> *mut IPlugView {
        ptr::null_mut()
    }
}
