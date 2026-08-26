//! The VST3 backend tested against a VST3 plugin written in Rust.
//!
//! No `.vst3` binary is loaded. CI has none, and executing a third-party one
//! there would be exactly the thing the bounded scan worker exists to avoid — so
//! the fake below implements the same COM interfaces a real plugin does, and the
//! wrapper reaches it through the same factory call, the same `initialize`, the
//! same `setupProcessing`, and the same `process`. What is faked is the plugin,
//! not the path to it.

use super::*;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU64, Ordering};
use vst3::Steinberg::Vst::{
    BusInfo, BusTypes_, IComponentHandler, IComponentHandlerTrait, IMessage, RestartFlags_,
    RoutingInfo, TChar,
};
use vst3::Steinberg::{
    char8, kNoInterface, kNotImplemented, kResultFalse, tresult, uint32, FIDString, FUnknown,
    IPlugView, IPluginFactory2Trait, IPluginFactory3, IPluginFactory3Trait, PClassInfo,
    PClassInfo2, PClassInfoW, PFactoryInfo,
};
use vst3::{uid, ComRef};

const COMBINED_CID: TUID = uid(0x11111111, 0x22222222, 0x33333333, 0x44444444);
const SPLIT_COMPONENT_CID: TUID = uid(0xAAAAAAAA, 0xBBBBBBBB, 0xCCCCCCCC, 0xDDDDDDDD);
const SPLIT_CONTROLLER_CID: TUID = uid(0xAAAAAAAA, 0xBBBBBBBB, 0xCCCCCCCC, 0xEEEEEEEE);

const GAIN_PARAM: ParamID = 0;
const HIDDEN_PARAM: ParamID = 1;

/// Everything a test can observe about what the host did to the plugin.
#[derive(Default)]
struct FakeState {
    initialize_calls: AtomicI32,
    terminate_calls: AtomicI32,
    setup_calls: AtomicI32,
    set_active_calls: AtomicI32,
    set_processing_calls: AtomicI32,
    process_calls: AtomicI32,
    /// Parameter queues the last block carried, so a test can prove it measured
    /// a busy block rather than an empty one.
    parameter_queues_seen: AtomicI32,
    active: AtomicBool,
    processing: AtomicBool,
    component_connects: AtomicI32,
    controller_connects: AtomicI32,

    /// Normalised gain, as the *processor* believes it. Only a parameter change
    /// arriving inside `ProcessData` moves this, which is what makes it evidence
    /// that the host mediated the write.
    processor_gain: AtomicU64,
    /// Normalised gain, as the *controller* believes it.
    controller_gain: AtomicU64,

    latency: AtomicU32,
    event_input_buses: AtomicI32,
    max_block: AtomicI32,
    sample_rate: AtomicU64,
    saw_process_context: AtomicBool,
    saw_tempo: AtomicU64,

    component_chunk: Mutex<Vec<u8>>,
    controller_chunk: Mutex<Vec<u8>>,
    controller_saw_component_chunk: Mutex<Vec<u8>>,
    notes: Mutex<Vec<(i16, i16, bool)>>,
    handler: Mutex<Option<ComPtr<IComponentHandler>>>,
}

impl FakeState {
    fn new() -> Arc<Self> {
        let state = Arc::new(Self::default());
        state
            .processor_gain
            .store(1.0f64.to_bits(), Ordering::Release);
        state
            .controller_gain
            .store(1.0f64.to_bits(), Ordering::Release);
        // Reserved up front so the note log cannot allocate inside `process`:
        // the allocation test measures the whole call, and a fake that grows a
        // `Vec` there would be indistinguishable from a host that allocates.
        state
            .notes
            .lock()
            .expect("notes mutex")
            .reserve(MAX_MIDI * 4);
        state
    }

    fn with_event_input() -> Arc<Self> {
        let state = Self::new();
        state.event_input_buses.store(1, Ordering::Release);
        state
    }

    fn processor_gain(&self) -> f64 {
        f64::from_bits(self.processor_gain.load(Ordering::Acquire))
    }

    fn controller_gain(&self) -> f64 {
        f64::from_bits(self.controller_gain.load(Ordering::Acquire))
    }

    /// The plugin's own editor moving a parameter, which is how a real plugin
    /// tells the host a value changed.
    fn perform_edit_from_editor(&self, value: f64) {
        self.perform_edit_on(GAIN_PARAM, value);
    }

    fn perform_edit_on(&self, param_id: ParamID, value: f64) {
        let handler = self.handler.lock().expect("handler mutex");
        let Some(handler) = handler.as_ref() else {
            panic!("the host never gave the plugin a component handler");
        };
        // SAFETY: the handler is live for as long as the wrapper is.
        unsafe {
            handler.beginEdit(param_id);
            handler.performEdit(param_id, value);
            handler.endEdit(param_id);
        }
    }

    /// The plugin declaring a new latency, the way a real one does.
    fn declare_latency(&self, samples: u32) {
        self.latency.store(samples, Ordering::Release);
        let handler = self.handler.lock().expect("handler mutex");
        let Some(handler) = handler.as_ref() else {
            panic!("the host never gave the plugin a component handler");
        };
        // SAFETY: the handler is live for as long as the wrapper is.
        unsafe {
            handler.restartComponent(RestartFlags_::kLatencyChanged as int32);
        }
    }
}

// ── The fake plugin ─────────────────────────────────────────────────────

/// A plugin whose component and controller are one object — the shape most
/// modern VST3 plugins ship.
struct FakeCombined {
    state: Arc<FakeState>,
}

impl Class for FakeCombined {
    type Interfaces = (IComponent, IAudioProcessor, IEditController);
}

/// The processor half of a plugin that ships its controller as a separate class.
struct FakeSplitComponent {
    state: Arc<FakeState>,
}

impl Class for FakeSplitComponent {
    type Interfaces = (IComponent, IAudioProcessor, IConnectionPoint);
}

/// The controller half of that same plugin.
struct FakeController {
    state: Arc<FakeState>,
}

impl Class for FakeController {
    type Interfaces = (IEditController, IConnectionPoint);
}

// ── Component behaviour, shared by both shapes ──────────────────────────

fn component_bus_count(state: &FakeState, media: int32, direction: int32) -> int32 {
    if media == MediaTypes_::kAudio as int32 {
        return 1;
    }
    if media == MediaTypes_::kEvent as int32 && direction == BusDirections_::kInput as int32 {
        return state.event_input_buses.load(Ordering::Acquire);
    }
    0
}

unsafe fn write_bus_info(bus: *mut BusInfo, media: int32, direction: int32, channels: int32) {
    if bus.is_null() {
        return;
    }
    (*bus).mediaType = media;
    (*bus).direction = direction;
    (*bus).channelCount = channels;
    (*bus).busType = BusTypes_::kMain as int32;
    (*bus).flags = 0;
}

unsafe fn component_set_state(state: &FakeState, stream: *mut IBStream) -> tresult {
    let Some(stream) = ComRef::from_raw(stream) else {
        return kInvalidArgument;
    };
    *state.component_chunk.lock().expect("chunk mutex") = read_all(stream);
    kResultOk
}

unsafe fn component_get_state(state: &FakeState, stream: *mut IBStream) -> tresult {
    let Some(stream) = ComRef::from_raw(stream) else {
        return kInvalidArgument;
    };
    write_all(stream, &state.component_chunk.lock().expect("chunk mutex"))
}

unsafe fn read_all(stream: ComRef<'_, IBStream>) -> Vec<u8> {
    let mut collected = Vec::new();
    let mut buffer = [0u8; 64];
    loop {
        let mut read = 0;
        if stream.read(
            buffer.as_mut_ptr() as *mut std::ffi::c_void,
            buffer.len() as int32,
            &mut read,
        ) != kResultOk
            || read == 0
        {
            return collected;
        }
        collected.extend_from_slice(&buffer[..read as usize]);
    }
}

unsafe fn write_all(stream: ComRef<'_, IBStream>, bytes: &[u8]) -> tresult {
    let mut written = 0;
    stream.write(
        bytes.as_ptr() as *mut std::ffi::c_void,
        bytes.len() as int32,
        &mut written,
    )
}

/// Apply whatever the host put in `inputParameterChanges`, then scale the block.
///
/// Reading the queue is the point: a host that never fills it leaves the gain at
/// its previous value and every gain assertion in this file fails.
unsafe fn fake_process(state: &FakeState, data: *mut ProcessData) -> tresult {
    if data.is_null() {
        return kInvalidArgument;
    }
    state.process_calls.fetch_add(1, Ordering::AcqRel);
    let data = &mut *data;

    state
        .saw_process_context
        .store(!data.processContext.is_null(), Ordering::Release);
    if !data.processContext.is_null() {
        state
            .saw_tempo
            .store((*data.processContext).tempo.to_bits(), Ordering::Release);
    }

    state.parameter_queues_seen.store(0, Ordering::Release);
    if let Some(changes) = ComRef::from_raw(data.inputParameterChanges) {
        state
            .parameter_queues_seen
            .store(changes.getParameterCount(), Ordering::Release);
        for index in 0..changes.getParameterCount() {
            let Some(queue) = ComRef::from_raw(changes.getParameterData(index)) else {
                continue;
            };
            if queue.getParameterId() != GAIN_PARAM {
                continue;
            }
            let points = queue.getPointCount();
            if points == 0 {
                continue;
            }
            let mut offset = 0;
            let mut value = 0.0;
            if queue.getPoint(points - 1, &mut offset, &mut value) == kResultOk {
                state
                    .processor_gain
                    .store(value.to_bits(), Ordering::Release);
            }
        }
    }

    if let Some(events) = ComRef::from_raw(data.inputEvents) {
        let mut notes = state.notes.lock().expect("notes mutex");
        for index in 0..events.getEventCount() {
            let mut event: Event = std::mem::zeroed();
            if events.getEvent(index, &mut event) != kResultOk {
                continue;
            }
            let is_on = event.r#type == EventTypes_::kNoteOnEvent as u16;
            let note = if is_on {
                event.__field0.noteOn
            } else {
                NoteOnEvent {
                    channel: event.__field0.noteOff.channel,
                    pitch: event.__field0.noteOff.pitch,
                    tuning: 0.0,
                    velocity: 0.0,
                    length: 0,
                    noteId: -1,
                }
            };
            notes.push((note.channel, note.pitch, is_on));
        }
    }

    if data.inputs.is_null() || data.outputs.is_null() {
        return kResultOk;
    }
    let gain = state.processor_gain() as f32;
    let input = &*data.inputs;
    let output = &*data.outputs;
    let channels = input.numChannels.min(output.numChannels).max(0) as usize;
    let in_buffers = input.__field0.channelBuffers32;
    let out_buffers = output.__field0.channelBuffers32;
    for channel in 0..channels {
        let source = *in_buffers.add(channel);
        let target = *out_buffers.add(channel);
        for sample in 0..data.numSamples as usize {
            *target.add(sample) = *source.add(sample) * gain;
        }
    }
    kResultOk
}

macro_rules! fake_component_impls {
    ($type:ty) => {
        impl IPluginBaseTrait for $type {
            unsafe fn initialize(&self, _context: *mut FUnknown) -> tresult {
                self.state.initialize_calls.fetch_add(1, Ordering::AcqRel);
                kResultOk
            }

            unsafe fn terminate(&self) -> tresult {
                self.state.terminate_calls.fetch_add(1, Ordering::AcqRel);
                kResultOk
            }
        }

        impl IComponentTrait for $type {
            unsafe fn getControllerClassId(&self, class_id: *mut TUID) -> tresult {
                Self::write_controller_class_id(class_id)
            }

            unsafe fn setIoMode(&self, _mode: int32) -> tresult {
                kResultOk
            }

            unsafe fn getBusCount(&self, r#type: int32, dir: int32) -> int32 {
                component_bus_count(&self.state, r#type, dir)
            }

            unsafe fn getBusInfo(
                &self,
                r#type: int32,
                dir: int32,
                index: int32,
                bus: *mut BusInfo,
            ) -> tresult {
                if index != 0 || component_bus_count(&self.state, r#type, dir) == 0 {
                    return kInvalidArgument;
                }
                let channels = if r#type == MediaTypes_::kAudio as int32 {
                    2
                } else {
                    0
                };
                write_bus_info(bus, r#type, dir, channels);
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
                _type: int32,
                _dir: int32,
                _index: int32,
                _state: u8,
            ) -> tresult {
                kResultOk
            }

            unsafe fn setActive(&self, state: u8) -> tresult {
                self.state.set_active_calls.fetch_add(1, Ordering::AcqRel);
                self.state.active.store(state != 0, Ordering::Release);
                kResultOk
            }

            unsafe fn setState(&self, state: *mut IBStream) -> tresult {
                component_set_state(&self.state, state)
            }

            unsafe fn getState(&self, state: *mut IBStream) -> tresult {
                component_get_state(&self.state, state)
            }
        }

        impl IAudioProcessorTrait for $type {
            unsafe fn setBusArrangements(
                &self,
                _inputs: *mut u64,
                _num_ins: int32,
                _outputs: *mut u64,
                _num_outs: int32,
            ) -> tresult {
                kResultOk
            }

            unsafe fn getBusArrangement(
                &self,
                _dir: int32,
                _index: int32,
                _arr: *mut u64,
            ) -> tresult {
                kNotImplemented
            }

            unsafe fn canProcessSampleSize(&self, symbolic_sample_size: int32) -> tresult {
                if symbolic_sample_size == SymbolicSampleSizes_::kSample32 as int32 {
                    kResultOk
                } else {
                    kResultFalse
                }
            }

            unsafe fn getLatencySamples(&self) -> uint32 {
                self.state.latency.load(Ordering::Acquire)
            }

            unsafe fn setupProcessing(&self, setup: *mut ProcessSetup) -> tresult {
                if setup.is_null() {
                    return kInvalidArgument;
                }
                self.state.setup_calls.fetch_add(1, Ordering::AcqRel);
                self.state
                    .max_block
                    .store((*setup).maxSamplesPerBlock, Ordering::Release);
                self.state
                    .sample_rate
                    .store((*setup).sampleRate.to_bits(), Ordering::Release);
                kResultOk
            }

            unsafe fn setProcessing(&self, state: u8) -> tresult {
                self.state
                    .set_processing_calls
                    .fetch_add(1, Ordering::AcqRel);
                self.state.processing.store(state != 0, Ordering::Release);
                kResultOk
            }

            unsafe fn process(&self, data: *mut ProcessData) -> tresult {
                fake_process(&self.state, data)
            }

            unsafe fn getTailSamples(&self) -> uint32 {
                0
            }
        }
    };
}

fake_component_impls!(FakeCombined);
fake_component_impls!(FakeSplitComponent);

impl FakeCombined {
    /// A combined class has no separate controller to name.
    unsafe fn write_controller_class_id(_class_id: *mut TUID) -> tresult {
        kNotImplemented
    }
}

impl FakeSplitComponent {
    unsafe fn write_controller_class_id(class_id: *mut TUID) -> tresult {
        if class_id.is_null() {
            return kInvalidArgument;
        }
        *class_id = SPLIT_CONTROLLER_CID;
        kResultOk
    }
}

// ── Controller behaviour, shared by both shapes ─────────────────────────

fn write_tchar(target: &mut [TChar], value: &str) {
    let mut written = 0;
    for (slot, character) in target.iter_mut().zip(value.encode_utf16()) {
        *slot = character;
        written += 1;
    }
    if written < target.len() {
        target[written] = 0;
    }
}

unsafe fn controller_parameter_info(index: int32, info: *mut ParameterInfo) -> tresult {
    if info.is_null() {
        return kInvalidArgument;
    }
    let (id, title, flags) = match index {
        0 => (GAIN_PARAM, "Gain", ParameterFlags_::kCanAutomate),
        1 => (
            HIDDEN_PARAM,
            "Internal",
            ParameterFlags_::kCanAutomate | ParameterFlags_::kIsHidden,
        ),
        _ => return kInvalidArgument,
    };
    (*info).id = id;
    (*info).stepCount = 0;
    (*info).defaultNormalizedValue = 1.0;
    (*info).unitId = 0;
    (*info).flags = flags;
    write_tchar(&mut (*info).title, title);
    write_tchar(&mut (*info).shortTitle, title);
    write_tchar(&mut (*info).units, "dB");
    kResultOk
}

macro_rules! fake_controller_impls {
    ($type:ty) => {
        impl IEditControllerTrait for $type {
            unsafe fn setComponentState(&self, state: *mut IBStream) -> tresult {
                let Some(stream) = ComRef::from_raw(state) else {
                    return kInvalidArgument;
                };
                *self
                    .state
                    .controller_saw_component_chunk
                    .lock()
                    .expect("chunk mutex") = read_all(stream);
                kResultOk
            }

            unsafe fn setState(&self, state: *mut IBStream) -> tresult {
                let Some(stream) = ComRef::from_raw(state) else {
                    return kInvalidArgument;
                };
                *self.state.controller_chunk.lock().expect("chunk mutex") = read_all(stream);
                kResultOk
            }

            unsafe fn getState(&self, state: *mut IBStream) -> tresult {
                let Some(stream) = ComRef::from_raw(state) else {
                    return kInvalidArgument;
                };
                write_all(
                    stream,
                    &self.state.controller_chunk.lock().expect("chunk mutex"),
                )
            }

            unsafe fn getParameterCount(&self) -> int32 {
                2
            }

            unsafe fn getParameterInfo(
                &self,
                param_index: int32,
                info: *mut ParameterInfo,
            ) -> tresult {
                controller_parameter_info(param_index, info)
            }

            unsafe fn getParamStringByValue(
                &self,
                _id: ParamID,
                _value_normalized: ParamValue,
                _string: *mut [TChar; 128],
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

            unsafe fn normalizedParamToPlain(
                &self,
                _id: ParamID,
                normalized: ParamValue,
            ) -> ParamValue {
                normalized
            }

            unsafe fn plainParamToNormalized(&self, _id: ParamID, plain: ParamValue) -> ParamValue {
                plain
            }

            unsafe fn getParamNormalized(&self, id: ParamID) -> ParamValue {
                if id == GAIN_PARAM {
                    return self.state.controller_gain();
                }
                0.0
            }

            unsafe fn setParamNormalized(&self, id: ParamID, value: ParamValue) -> tresult {
                if id != GAIN_PARAM {
                    return kInvalidArgument;
                }
                self.state
                    .controller_gain
                    .store(value.to_bits(), Ordering::Release);
                kResultOk
            }

            unsafe fn setComponentHandler(&self, handler: *mut IComponentHandler) -> tresult {
                let mut slot = self.state.handler.lock().expect("handler mutex");
                *slot = ComRef::from_raw(handler).map(|handler| handler.to_com_ptr());
                kResultOk
            }

            unsafe fn createView(&self, _name: FIDString) -> *mut IPlugView {
                ptr::null_mut()
            }
        }
    };
}

fake_controller_impls!(FakeCombined);
fake_controller_impls!(FakeController);

impl IPluginBaseTrait for FakeController {
    unsafe fn initialize(&self, _context: *mut FUnknown) -> tresult {
        self.state.initialize_calls.fetch_add(1, Ordering::AcqRel);
        kResultOk
    }

    unsafe fn terminate(&self) -> tresult {
        self.state.terminate_calls.fetch_add(1, Ordering::AcqRel);
        kResultOk
    }
}

impl IConnectionPointTrait for FakeSplitComponent {
    unsafe fn connect(&self, other: *mut IConnectionPoint) -> tresult {
        if other.is_null() {
            return kInvalidArgument;
        }
        self.state.component_connects.fetch_add(1, Ordering::AcqRel);
        kResultOk
    }

    unsafe fn disconnect(&self, _other: *mut IConnectionPoint) -> tresult {
        self.state.component_connects.fetch_sub(1, Ordering::AcqRel);
        kResultOk
    }

    unsafe fn notify(&self, _message: *mut IMessage) -> tresult {
        kResultOk
    }
}

impl IConnectionPointTrait for FakeController {
    unsafe fn connect(&self, other: *mut IConnectionPoint) -> tresult {
        if other.is_null() {
            return kInvalidArgument;
        }
        self.state
            .controller_connects
            .fetch_add(1, Ordering::AcqRel);
        kResultOk
    }

    unsafe fn disconnect(&self, _other: *mut IConnectionPoint) -> tresult {
        self.state
            .controller_connects
            .fetch_sub(1, Ordering::AcqRel);
        kResultOk
    }

    unsafe fn notify(&self, _message: *mut IMessage) -> tresult {
        kResultOk
    }
}

// ── The fake factory ────────────────────────────────────────────────────

struct FakeFactory {
    state: Arc<FakeState>,
}

impl Class for FakeFactory {
    type Interfaces = (IPluginFactory3,);
}

unsafe fn tuid_from_fid(value: FIDString) -> Option<TUID> {
    if value.is_null() {
        return None;
    }
    let mut id: TUID = [0; 16];
    ptr::copy_nonoverlapping(value, id.as_mut_ptr(), 16);
    Some(id)
}

fn same_tuid(left: &TUID, right: &TUID) -> bool {
    left.iter().zip(right.iter()).all(|(a, b)| a == b)
}

impl IPluginFactoryTrait for FakeFactory {
    unsafe fn getFactoryInfo(&self, info: *mut PFactoryInfo) -> tresult {
        if info.is_null() {
            return kInvalidArgument;
        }
        write_char8(&mut (*info).vendor, "Fake Audio");
        kResultOk
    }

    unsafe fn countClasses(&self) -> int32 {
        3
    }

    unsafe fn getClassInfo(&self, index: int32, info: *mut PClassInfo) -> tresult {
        let Some((cid, category, name)) = class_entry(index) else {
            return kInvalidArgument;
        };
        if info.is_null() {
            return kInvalidArgument;
        }
        (*info).cid = cid;
        (*info).cardinality = 0x7FFF_FFFF;
        write_char8(&mut (*info).category, category);
        write_char8(&mut (*info).name, name);
        kResultOk
    }

    unsafe fn createInstance(
        &self,
        cid: FIDString,
        _iid: FIDString,
        obj: *mut *mut std::ffi::c_void,
    ) -> tresult {
        let Some(cid) = tuid_from_fid(cid) else {
            return kInvalidArgument;
        };
        if obj.is_null() {
            return kInvalidArgument;
        }
        let state = Arc::clone(&self.state);
        let pointer = if same_tuid(&cid, &COMBINED_CID) {
            ComWrapper::new(FakeCombined { state })
                .to_com_ptr::<IComponent>()
                .map(|component| component.into_raw() as *mut std::ffi::c_void)
        } else if same_tuid(&cid, &SPLIT_COMPONENT_CID) {
            ComWrapper::new(FakeSplitComponent { state })
                .to_com_ptr::<IComponent>()
                .map(|component| component.into_raw() as *mut std::ffi::c_void)
        } else if same_tuid(&cid, &SPLIT_CONTROLLER_CID) {
            ComWrapper::new(FakeController { state })
                .to_com_ptr::<IEditController>()
                .map(|controller| controller.into_raw() as *mut std::ffi::c_void)
        } else {
            None
        };
        let Some(pointer) = pointer else {
            return kNoInterface;
        };
        *obj = pointer;
        kResultOk
    }
}

impl IPluginFactory2Trait for FakeFactory {
    unsafe fn getClassInfo2(&self, index: int32, info: *mut PClassInfo2) -> tresult {
        let Some((cid, category, name)) = class_entry(index) else {
            return kInvalidArgument;
        };
        if info.is_null() {
            return kInvalidArgument;
        }
        (*info).cid = cid;
        (*info).cardinality = 0x7FFF_FFFF;
        write_char8(&mut (*info).category, category);
        write_char8(&mut (*info).name, name);
        write_char8(&mut (*info).vendor, "Fake Audio");
        write_char8(&mut (*info).version, "3.2.1");
        write_char8(&mut (*info).subCategories, "Fx|Reverb");
        kResultOk
    }
}

impl IPluginFactory3Trait for FakeFactory {
    unsafe fn getClassInfoUnicode(&self, _index: int32, _info: *mut PClassInfoW) -> tresult {
        kNotImplemented
    }

    unsafe fn setHostContext(&self, _context: *mut FUnknown) -> tresult {
        kResultOk
    }
}

fn class_entry(index: int32) -> Option<(TUID, &'static str, &'static str)> {
    match index {
        0 => Some((COMBINED_CID, "Audio Module Class", "Fake Combined")),
        1 => Some((SPLIT_COMPONENT_CID, "Audio Module Class", "Fake Split")),
        2 => Some((
            SPLIT_CONTROLLER_CID,
            "Component Controller Class",
            "Fake Split Controller",
        )),
        _ => None,
    }
}

fn write_char8(target: &mut [char8], value: &str) {
    let mut written = 0;
    for (slot, byte) in target.iter_mut().zip(value.bytes()) {
        *slot = byte as char8;
        written += 1;
    }
    if written < target.len() {
        target[written] = 0;
    }
}

// ── Harness ─────────────────────────────────────────────────────────────

fn factory_for(state: &Arc<FakeState>) -> ComPtr<IPluginFactory> {
    ComWrapper::new(FakeFactory {
        state: Arc::clone(state),
    })
    .to_com_ptr::<IPluginFactory>()
    .expect("the fake factory implements IPluginFactory")
}

fn instantiate(state: &Arc<FakeState>, class_id: TUID) -> Vst3Instance {
    Vst3Instance::create(
        None,
        &factory_for(state),
        Vst3HostContext::new(),
        &class_id,
        "Fake Plugin",
    )
    .expect("the fake plugin instantiates")
}

fn load(state: &Arc<FakeState>, class_id: TUID) -> Vst3Wrapper {
    Vst3Wrapper::activated(instantiate(state, class_id), class_id, 48_000.0)
        .expect("the fake plugin activates")
}

/// Hand the plugin one block of a constant signal and read what came back.
fn render(wrapper: &mut Vst3Wrapper, level: f32, frames: usize) -> Vec<f32> {
    let left = vec![level; frames];
    let right = vec![level; frames];
    let mut out_left = vec![0.0; frames];
    let mut out_right = vec![0.0; frames];
    {
        let inputs: [&[f32]; 2] = [&left, &right];
        let mut out_slices: Vec<&mut [f32]> = vec![&mut out_left, &mut out_right];
        wrapper.process(&inputs, &mut out_slices, frames);
    }
    out_left
}

// ── Lifecycle ───────────────────────────────────────────────────────────

/// A combined class answers `queryInterface` for both halves. Creating the
/// controller class as well would initialise the same object twice, which the
/// format does not permit and a real plugin is entitled to treat as a fault.
#[test]
fn a_combined_class_is_initialised_exactly_once() {
    let state = FakeState::new();
    let _wrapper = load(&state, COMBINED_CID);

    assert_eq!(state.initialize_calls.load(Ordering::Acquire), 1);
}

/// A split plugin talks to itself across its connection points. A host that
/// creates both halves and never joins them leaves every processor-to-editor
/// update on the floor.
#[test]
fn a_split_plugin_has_its_two_halves_connected_in_both_directions() {
    let state = FakeState::new();
    let _wrapper = load(&state, SPLIT_COMPONENT_CID);

    assert_eq!(state.initialize_calls.load(Ordering::Acquire), 2);
    assert_eq!(state.component_connects.load(Ordering::Acquire), 1);
    assert_eq!(state.controller_connects.load(Ordering::Acquire), 1);
}

/// Dropping the wrapper must leave the plugin the way it was found, and in the
/// order VST3 requires: stop processing, deactivate, disconnect, terminate.
#[test]
fn dropping_a_split_plugin_disconnects_and_terminates_both_halves() {
    let state = FakeState::new();
    drop(load(&state, SPLIT_COMPONENT_CID));

    assert!(!state.active.load(Ordering::Acquire), "left active");
    assert!(!state.processing.load(Ordering::Acquire), "left processing");
    assert_eq!(state.component_connects.load(Ordering::Acquire), 0);
    assert_eq!(state.controller_connects.load(Ordering::Acquire), 0);
    assert_eq!(state.terminate_calls.load(Ordering::Acquire), 2);
}

/// `setProcessing` is audio-thread-only in VST3. A loader that calls it has
/// already broken the thread model before the plugin sees its first block, and
/// no amount of exclusive access substitutes for thread affinity.
#[test]
fn the_loader_activates_but_never_enters_the_processing_state() {
    let state = FakeState::new();
    let mut wrapper = load(&state, COMBINED_CID);

    assert_eq!(state.set_active_calls.load(Ordering::Acquire), 1);
    assert_eq!(state.setup_calls.load(Ordering::Acquire), 1);
    assert_eq!(
        state.set_processing_calls.load(Ordering::Acquire),
        0,
        "the loader entered the processing state off the audio thread"
    );
    assert!(!wrapper.processing_gate().is_processing());

    render(&mut wrapper, 1.0, 8);

    assert_eq!(state.set_processing_calls.load(Ordering::Acquire), 1);
    assert!(wrapper.processing_gate().is_processing());
}

/// The setup the plugin is given must be the one the host actually honours; a
/// larger block than declared is a buffer overrun waiting for a big project.
#[test]
fn the_plugin_is_set_up_with_the_hosts_real_block_and_rate() {
    let state = FakeState::new();
    let _wrapper = load(&state, COMBINED_CID);

    assert_eq!(state.max_block.load(Ordering::Acquire), MAX_BUFFER as int32);
    assert_eq!(
        f64::from_bits(state.sample_rate.load(Ordering::Acquire)),
        48_000.0
    );
}

/// A block handed to a plugin that is not processing is a block handed to a
/// plugin that has not been told to expect one.
#[test]
fn a_stopped_plugin_passes_the_block_through_untouched() {
    let state = FakeState::new();
    let mut wrapper = load(&state, COMBINED_CID);
    render(&mut wrapper, 1.0, 8);

    wrapper.processing_gate().request_stop();
    wrapper.set_parameter(GAIN_PARAM, 0.0);
    let output = render(&mut wrapper, 0.75, 8);

    assert!(
        output.iter().all(|sample| (*sample - 0.75).abs() < 1e-6),
        "a stopped plugin silenced or altered the block: {output:?}"
    );
}

// ── Parameters ──────────────────────────────────────────────────────────

/// VST3 forbids the controller from writing to the processor. The host mediates:
/// it tells the controller so the editor agrees, and it queues the same value
/// into the next block's `inputParameterChanges`, which is the processor's only
/// route.
#[test]
fn a_host_parameter_write_reaches_both_halves_by_their_own_routes() {
    let state = FakeState::new();
    let mut wrapper = load(&state, SPLIT_COMPONENT_CID);
    render(&mut wrapper, 1.0, 8);

    wrapper.set_parameter(GAIN_PARAM, 0.25);

    assert_eq!(
        state.controller_gain(),
        0.25,
        "the controller was not told, so its editor would show a stale value"
    );
    assert_eq!(
        state.processor_gain(),
        1.0,
        "the processor heard the write outside a block"
    );

    let output = render(&mut wrapper, 1.0, 8);

    assert_eq!(state.processor_gain(), 0.25);
    assert!(output.iter().all(|sample| (*sample - 0.25).abs() < 1e-6));
}

/// A user moving a control in the plugin's own editor is a `performEdit` from
/// the plugin. The processor never hears it unless the host carries it into the
/// next block — which is what makes an editor move audible.
#[test]
fn an_editor_gesture_reaches_the_processor_in_the_next_block() {
    let state = FakeState::new();
    let mut wrapper = load(&state, COMBINED_CID);
    render(&mut wrapper, 1.0, 8);

    state.perform_edit_from_editor(0.5);
    let output = render(&mut wrapper, 1.0, 8);

    assert_eq!(state.processor_gain(), 0.5);
    assert!(output.iter().all(|sample| (*sample - 0.5).abs() < 1e-6));
}

/// A host write is the newer intent, so it must win over a gesture staged for
/// the same parameter in the same block rather than being overwritten by it.
#[test]
fn a_host_write_outranks_an_editor_gesture_in_the_same_block() {
    let state = FakeState::new();
    let mut wrapper = load(&state, COMBINED_CID);
    render(&mut wrapper, 1.0, 8);

    state.perform_edit_from_editor(0.5);
    wrapper.process_with_parameter_updates(
        &[&[1.0; 8], &[1.0; 8]],
        &mut [&mut [0.0; 8], &mut [0.0; 8]],
        8,
        &[HostParameterUpdate {
            param_id: GAIN_PARAM,
            value: 0.125,
        }],
    );

    assert_eq!(state.processor_gain(), 0.125);
}

/// Hidden parameters are the plugin's internals. A generic editor that lists
/// them shows the user controls the plugin's own author chose to hide.
#[test]
fn the_parameter_list_omits_hidden_parameters() {
    let state = FakeState::new();
    let wrapper = load(&state, COMBINED_CID);

    let parameters = wrapper.get_parameters();

    assert_eq!(parameters.len(), 1);
    assert_eq!(parameters[0].id, GAIN_PARAM);
    assert_eq!(parameters[0].name, "Gain");
    assert_eq!(parameters[0].unit.as_deref(), Some("dB"));
    assert_eq!(parameters[0].min_value, 0.0);
    assert_eq!(parameters[0].max_value, 1.0);
    assert!(parameters[0].is_automatable);
}

/// A non-finite value has no normalised meaning, and handing one to a plugin is
/// how a NaN reaches the output bus.
#[test]
fn a_non_finite_parameter_write_is_refused() {
    let state = FakeState::new();
    let mut wrapper = load(&state, COMBINED_CID);

    wrapper.set_parameter(GAIN_PARAM, f64::NAN);

    assert_eq!(state.controller_gain(), 1.0);
}

// ── Events ──────────────────────────────────────────────────────────────

/// The plugin's own bus declaration is the answer. An effect with no event input
/// must not be handed notes just because the engine's slot assumes every plugin
/// takes them.
#[test]
fn a_plugin_without_an_event_input_is_never_handed_notes() {
    let state = FakeState::new();
    let mut wrapper = load(&state, COMBINED_CID);
    render(&mut wrapper, 1.0, 8);

    assert!(!wrapper.accepts_midi());

    wrapper.process_with_midi_and_parameters(
        &[&[1.0; 8], &[1.0; 8]],
        &mut [&mut [0.0; 8], &mut [0.0; 8]],
        8,
        &[(60, 100, 0, true)],
        &[],
    );

    assert!(state.notes.lock().expect("notes mutex").is_empty());
}

#[test]
fn a_plugin_with_an_event_input_receives_the_notes_it_is_sent() {
    let state = FakeState::with_event_input();
    let mut wrapper = load(&state, COMBINED_CID);
    render(&mut wrapper, 1.0, 8);

    assert!(wrapper.accepts_midi());

    wrapper.process_with_midi_and_parameters(
        &[&[1.0; 8], &[1.0; 8]],
        &mut [&mut [0.0; 8], &mut [0.0; 8]],
        8,
        &[(60, 100, 1, true), (60, 0, 1, false)],
        &[],
    );

    assert_eq!(
        *state.notes.lock().expect("notes mutex"),
        vec![(1, 60, true), (1, 60, false)]
    );
}

// ── Transport ───────────────────────────────────────────────────────────

/// A null process context is VST3 for "the host has no timeline". Sending a
/// zeroed one instead tells the plugin it is stopped at zero BPM, which is a
/// different and false statement.
#[test]
fn the_transport_is_absent_until_the_host_supplies_one() {
    let state = FakeState::new();
    let mut wrapper = load(&state, COMBINED_CID);

    render(&mut wrapper, 1.0, 8);
    assert!(!state.saw_process_context.load(Ordering::Acquire));

    wrapper.set_transport(HostTransport {
        tempo: 132.0,
        time_sig_num: 3,
        time_sig_denom: 4,
        is_playing: true,
        song_pos_beats: 8.0,
        song_pos_seconds: 4.0,
    });
    render(&mut wrapper, 1.0, 8);

    assert!(state.saw_process_context.load(Ordering::Acquire));
    assert_eq!(
        f64::from_bits(state.saw_tempo.load(Ordering::Acquire)),
        132.0
    );
}

// ── Latency ─────────────────────────────────────────────────────────────

/// VST3 only defines `getLatencySamples` for a component that is active and set
/// up. A plugin that changed its latency has to be taken through the full cycle
/// first, or the value read is the one it has already abandoned.
#[test]
fn a_latency_change_reactivates_the_plugin_before_the_new_value_is_read() {
    let state = FakeState::new();
    let mut wrapper = load(&state, COMBINED_CID);
    render(&mut wrapper, 1.0, 8);
    let setups_before = state.setup_calls.load(Ordering::Acquire);

    state.declare_latency(512);
    let reported = wrapper
        .poll_latency_change()
        .expect("the reactivation succeeds");

    assert_eq!(reported, Some(512));
    assert!(
        state.setup_calls.load(Ordering::Acquire) > setups_before,
        "the plugin was re-read without being re-set-up"
    );
    assert!(state.active.load(Ordering::Acquire), "left deactivated");
    assert_eq!(wrapper.latency_samples(), 512);
}

/// Nothing was flagged, so nothing is re-read: a poll that reactivates on every
/// call would deactivate a plugin mid-session for no reason.
#[test]
fn a_poll_with_no_flag_leaves_the_plugin_alone() {
    let state = FakeState::new();
    let mut wrapper = load(&state, COMBINED_CID);
    let setups_before = state.setup_calls.load(Ordering::Acquire);

    assert_eq!(wrapper.poll_latency_change(), Ok(None));
    assert_eq!(state.setup_calls.load(Ordering::Acquire), setups_before);
}

/// A latency reported in frames means nothing without the rate it was measured
/// at, and that rate is known here and nowhere upstream.
#[test]
fn latency_converts_to_milliseconds_at_the_activation_rate() {
    let state = FakeState::new();
    state.latency.store(480, Ordering::Release);
    let wrapper = load(&state, COMBINED_CID);

    assert!((wrapper.latency_ms() - 10.0).abs() < 1e-9);
}

// ── State ───────────────────────────────────────────────────────────────

/// Both chunks must survive a save and load. Keeping only the component's would
/// silently drop every editor-side setting; concatenating them without a
/// boundary would make neither recoverable.
#[test]
fn both_state_chunks_round_trip_through_the_seams_single_blob() {
    let source = FakeState::new();
    *source.component_chunk.lock().expect("chunk mutex") = b"processor-state".to_vec();
    *source.controller_chunk.lock().expect("chunk mutex") = b"editor-state".to_vec();
    let saved = load(&source, SPLIT_COMPONENT_CID).get_state();

    let restored = FakeState::new();
    let mut wrapper = load(&restored, SPLIT_COMPONENT_CID);
    wrapper.set_state(&saved).expect("the blob is this host's");

    assert_eq!(
        *restored.component_chunk.lock().expect("chunk mutex"),
        b"processor-state".to_vec()
    );
    assert_eq!(
        *restored.controller_chunk.lock().expect("chunk mutex"),
        b"editor-state".to_vec()
    );
    assert_eq!(
        *restored
            .controller_saw_component_chunk
            .lock()
            .expect("chunk mutex"),
        b"processor-state".to_vec(),
        "the controller was never shown the processor state, so its editor \
         would open on the values of the previous session"
    );
}

/// A combined class is one object, so its two `getState` entry points return the
/// same chunk. Storing it twice would double the blob and re-apply it twice on
/// load.
#[test]
fn a_combined_class_contributes_one_chunk_not_two() {
    let state = FakeState::new();
    *state.component_chunk.lock().expect("chunk mutex") = b"everything".to_vec();

    let saved = load(&state, COMBINED_CID).get_state();
    let (component, controller) = decode_state(&saved).expect("this host wrote it");

    assert_eq!(component, b"everything".to_vec());
    assert!(controller.is_empty());
}

#[test]
fn a_blob_this_host_did_not_write_is_refused_by_name() {
    let error = decode_state(b"CLAPnot-a-vst3-state-at-all").expect_err("foreign magic");

    assert!(error.contains("not written by this host"), "{error}");
}

#[test]
fn a_blob_from_a_newer_host_is_refused_rather_than_misread() {
    let mut future = encode_state(b"a", b"b");
    future[4] = 99;

    let error = decode_state(&future).expect_err("an unknown version");

    assert!(error.contains("version 99"), "{error}");
}

/// A truncated blob whose header still declares the full length would otherwise
/// panic on the slice, turning a corrupt project file into a crash.
#[test]
fn a_blob_shorter_than_its_header_declares_is_refused() {
    let mut truncated = encode_state(b"processor", b"editor");
    truncated.truncate(truncated.len() - 4);

    let error = decode_state(&truncated).expect_err("a short blob");

    assert!(error.contains("shorter than its own header"), "{error}");
}

#[test]
fn an_empty_blob_is_refused_rather_than_read_as_two_empty_chunks() {
    assert!(decode_state(&[]).is_err());
    assert!(decode_state(b"SDV3").is_err());
}

// ── Identity ────────────────────────────────────────────────────────────

/// The scan publishes this spelling and a project stores it, so parsing and
/// formatting must be inverses or a saved plugin never loads again.
#[test]
fn a_class_id_round_trips_through_the_spelling_projects_store() {
    let spelling = "1122334455667788AABBCCDDEEFF0011";

    let parsed = parse_class_id(spelling).expect("32 hex characters");

    assert_eq!(format_class_id(&parsed), spelling);
}

#[test]
fn a_lowercase_class_id_parses_to_the_same_identity() {
    assert_eq!(
        parse_class_id("aabbccddeeff00112233445566778899").expect("hex is case insensitive"),
        parse_class_id("AABBCCDDEEFF00112233445566778899").expect("hex is case insensitive")
    );
}

/// Anything that is not a class id must be refused before it reaches a factory,
/// where the bytes would be read as some other class entirely.
#[test]
fn a_malformed_class_id_is_refused_rather_than_padded() {
    assert!(parse_class_id("").is_err());
    assert!(parse_class_id("1122").is_err());
    assert!(parse_class_id("com.example.plugin").is_err());
    assert!(parse_class_id("zz22334455667788AABBCCDDEEFF0011").is_err());
}

/// The identity the wrapper reports is the one it was created from — a saved
/// project reloads by this string.
#[test]
fn the_wrapper_reports_the_class_it_was_created_from() {
    let state = FakeState::new();
    let wrapper = load(&state, COMBINED_CID);

    assert_eq!(
        wrapper.descriptor_id(),
        format_class_id(&COMBINED_CID).as_str()
    );
    assert_eq!(wrapper.get_name(), "Fake Plugin");
}

// ── RT-path allocation ──────────────────────────────────────────────────

/// The audio path must not allocate. The queues, the event list, the scratch
/// buffers and the process context are all built during load; a block that
/// grows any of them would allocate on the audio thread.
///
/// Observed rather than asserted by inspection: the counting allocator below
/// records every allocation this thread makes, and the assertion is over the
/// difference across one `process` call.
#[test]
fn a_render_block_performs_no_heap_allocation() {
    let state = FakeState::with_event_input();
    let mut wrapper = load(&state, COMBINED_CID);
    // The first block enters the processing state; measure a steady-state one.
    render(&mut wrapper, 1.0, 128);

    let inputs_left = vec![0.5f32; 128];
    let inputs_right = vec![0.5f32; 128];
    let mut out_left = vec![0.0f32; 128];
    let mut out_right = vec![0.0f32; 128];
    let updates = [HostParameterUpdate {
        param_id: GAIN_PARAM,
        value: 0.5,
    }];
    let notes = [(60u8, 100u8, 0i16, true)];

    // A block that carries a full gesture queue rather than a token one: the
    // drain sorts what it collected, and a sort only reaches its allocating
    // path once the slice is long enough. Measuring a one-gesture block would
    // report zero and prove nothing about a busy one.
    for param_id in 0..MAX_PARAMETER_QUEUES as ParamID {
        state.perform_edit_on(param_id, 1.0);
    }

    let inputs: [&[f32]; 2] = [&inputs_left, &inputs_right];
    let mut outputs: Vec<&mut [f32]> = vec![&mut out_left, &mut out_right];

    let before = allocation_count();
    wrapper.process_with_midi_and_parameters(&inputs, &mut outputs, 128, &notes, &updates);
    let after = allocation_count();

    assert_eq!(
        state.parameter_queues_seen.load(Ordering::Acquire),
        MAX_PARAMETER_QUEUES as int32,
        "the measured block was not the busy one this test means to measure"
    );
    assert_eq!(
        after - before,
        0,
        "the render path allocated {} times",
        after - before
    );
}

/// A counting allocator that counts *per thread*.
///
/// Per thread rather than per process because `cargo test` runs these tests
/// concurrently: a global counter would pick up every other test's allocations
/// and fail this one for reasons that have nothing to do with the render path.
///
/// The counter is a `Cell` behind a `const`-initialised thread local, so reading
/// or incrementing it allocates nothing itself and cannot recurse into the
/// allocator.
struct CountingAllocator;

thread_local! {
    static ALLOCATIONS: Cell<u64> = const { Cell::new(0) };
}

fn allocation_count() -> u64 {
    ALLOCATIONS.with(Cell::get)
}

unsafe impl std::alloc::GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        count_allocation();
        std::alloc::System.alloc(layout)
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: std::alloc::Layout) {
        std::alloc::System.dealloc(pointer, layout)
    }

    unsafe fn realloc(
        &self,
        pointer: *mut u8,
        layout: std::alloc::Layout,
        new_size: usize,
    ) -> *mut u8 {
        count_allocation();
        std::alloc::System.realloc(pointer, layout, new_size)
    }
}

/// `try_with` rather than `with`: an allocation during thread teardown finds the
/// thread local already destroyed, and panicking there would abort the process.
fn count_allocation() {
    let _ = ALLOCATIONS.try_with(|count| count.set(count.get() + 1));
}

#[global_allocator]
static COUNTING_ALLOCATOR: CountingAllocator = CountingAllocator;
