//! The VST3 backend tested against a VST3 plugin written in Rust.
//!
//! No `.vst3` binary is loaded. CI has none, and executing a third-party one
//! there would be exactly the thing the bounded scan worker exists to avoid — so
//! the fake below implements the same COM interfaces a real plugin does, and the
//! wrapper reaches it through the same factory call, the same `initialize`, the
//! same `setupProcessing`, and the same `process`. What is faked is the plugin,
//! not the path to it.

use super::*;
use crate::vst3_host::tuid_from_guid;
use std::ffi::{CStr, CString};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU64, Ordering};
use std::thread::ThreadId;
use vst3::Steinberg::Vst::{
    BusInfo, BusTypes_, IComponentHandler, IComponentHandlerTrait, IHostApplication,
    IHostApplicationTrait, IMessage, IMessageTrait, RestartFlags_, RoutingInfo, SpeakerArr,
    SpeakerArrangement, TChar,
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
const UNKNOWN_CID: TUID = uid(0x00000000, 0x00000000, 0x00000000, 0x0000BEEF);

const GAIN_PARAM: ParamID = 0;
const HIDDEN_PARAM: ParamID = 1;

/// A six-channel speaker bitmask, for a plugin that ships wider than the host
/// carries. Any six bits will do: the host reads the speaker count out of an
/// arrangement and nothing else.
const SIX_CHANNELS: SpeakerArrangement = 0b111111;

/// Bus observations reserved per direction, so recording one costs no
/// allocation inside `process`.
const OBSERVED_BUS_CAPACITY: usize = 8;

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

    /// The audio buses the plugin declares, and the arrangement it currently
    /// runs each of them at.
    buses: Mutex<FakeBuses>,
    /// A plugin that will not change a bus arrangement for anybody.
    refuses_arrangements: AtomicBool,
    /// How many times the host stated an arrangement, so a test can prove it
    /// asked rather than assumed.
    arrangement_requests: AtomicI32,
    /// The exact bus shape the last block was handed, per direction.
    observed_inputs: Mutex<Vec<ObservedBus>>,
    observed_outputs: Mutex<Vec<ObservedBus>>,

    /// A processor that refuses the state a project restores into it.
    refuses_set_state: AtomicBool,
    /// A processor that will not report its own state.
    fails_get_state: AtomicBool,

    /// The connection point each half was given, which is the host's proxy.
    component_peer: Mutex<Option<ComPtr<IConnectionPoint>>>,
    /// The host application a plugin allocates its messages from.
    host_application: Mutex<Option<ComPtr<IHostApplication>>>,
    /// Message ids each half received, with the thread that delivered them.
    component_notifications: Mutex<Vec<(String, ThreadId)>>,
    controller_notifications: Mutex<Vec<(String, ThreadId)>>,
}

impl FakeState {
    /// The shape most plugins ship: one stereo main bus in each direction.
    fn new() -> Arc<Self> {
        Self::with_buses(
            vec![FakeBus::main(SpeakerArr::kStereo)],
            vec![FakeBus::main(SpeakerArr::kStereo)],
        )
    }

    fn with_buses(inputs: Vec<FakeBus>, outputs: Vec<FakeBus>) -> Arc<Self> {
        let state = Arc::new(Self::default());
        state
            .processor_gain
            .store(1.0f64.to_bits(), Ordering::Release);
        state
            .controller_gain
            .store(1.0f64.to_bits(), Ordering::Release);
        *state.buses.lock().expect("bus mutex") = FakeBuses { inputs, outputs };
        // Reserved up front so neither the note log nor the bus observation can
        // allocate inside `process`: the allocation test measures the whole
        // call, and a fake that grows a `Vec` there would be indistinguishable
        // from a host that allocates.
        state
            .notes
            .lock()
            .expect("notes mutex")
            .reserve(MAX_MIDI * 4);
        state
            .observed_inputs
            .lock()
            .expect("observation mutex")
            .reserve(OBSERVED_BUS_CAPACITY);
        state
            .observed_outputs
            .lock()
            .expect("observation mutex")
            .reserve(OBSERVED_BUS_CAPACITY);
        state
    }

    fn with_event_input() -> Arc<Self> {
        let state = Self::new();
        state.event_input_buses.store(1, Ordering::Release);
        state
    }

    fn observed_inputs(&self) -> Vec<ObservedBus> {
        self.observed_inputs
            .lock()
            .expect("observation mutex")
            .clone()
    }

    fn observed_outputs(&self) -> Vec<ObservedBus> {
        self.observed_outputs
            .lock()
            .expect("observation mutex")
            .clone()
    }

    fn controller_notifications(&self) -> Vec<(String, ThreadId)> {
        self.controller_notifications
            .lock()
            .expect("notification mutex")
            .clone()
    }

    /// Remember the host application VST3 hands a plugin in `initialize`, which
    /// is the only place a plugin can get one.
    ///
    /// # Safety
    /// `context` is the pointer the host passed to `initialize`.
    unsafe fn remember_host(&self, context: *mut FUnknown) {
        let Some(context) = ComRef::from_raw(context) else {
            return;
        };
        let Some(application) = context.cast::<IHostApplication>() else {
            return;
        };
        *self.host_application.lock().expect("host mutex") = Some(application);
    }

    /// The component telling its controller something, exactly the way a real
    /// one does: a message allocated from the host, handed to the connection
    /// point the host connected it to.
    fn send_from_component(&self, message_id: &str) -> tresult {
        let message = self
            .new_message(message_id)
            .expect("the host allocates a message for the plugin");
        let peer = self.component_peer.lock().expect("peer mutex");
        let peer = peer
            .as_ref()
            .expect("the host connected the component to something");
        // SAFETY: the peer is the host's own proxy, live for the instance's life.
        unsafe { peer.notify(message.as_ptr()) }
    }

    fn new_message(&self, message_id: &str) -> Option<ComPtr<IMessage>> {
        let application = self.host_application.lock().expect("host mutex");
        let application = application.as_ref()?;
        let mut class_id = tuid_from_guid(&IMessage::IID);
        let mut interface_id = tuid_from_guid(&IMessage::IID);
        let mut object: *mut std::ffi::c_void = ptr::null_mut();
        // SAFETY: the application is live, and both ids are valid out-parameters
        // of exactly the declared size.
        let message = unsafe {
            if application.createInstance(&mut class_id, &mut interface_id, &mut object)
                != kResultOk
            {
                return None;
            }
            ComPtr::<IMessage>::from_raw(object as *mut IMessage)?
        };
        let id = CString::new(message_id).expect("a test id has no null byte");
        // SAFETY: the message is live and the id outlives the call, which copies it.
        unsafe { message.setMessageID(id.as_ptr()) };
        Some(message)
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

// ── The plugin's bus declaration ────────────────────────────────────────

/// One audio bus the fake declares, and the arrangement it runs it at.
#[derive(Clone, Copy)]
struct FakeBus {
    arrangement: SpeakerArrangement,
    is_main: bool,
}

impl FakeBus {
    fn main(arrangement: SpeakerArrangement) -> Self {
        Self {
            arrangement,
            is_main: true,
        }
    }

    fn aux(arrangement: SpeakerArrangement) -> Self {
        Self {
            arrangement,
            is_main: false,
        }
    }

    fn channels(self) -> int32 {
        self.arrangement.count_ones() as int32
    }
}

#[derive(Default)]
struct FakeBuses {
    inputs: Vec<FakeBus>,
    outputs: Vec<FakeBus>,
}

impl FakeBuses {
    fn of(&self, direction: int32) -> &[FakeBus] {
        if direction == BusDirections_::kInput as int32 {
            &self.inputs
        } else {
            &self.outputs
        }
    }
}

/// One bus of a `ProcessData`, exactly as the plugin was handed it.
///
/// This is what a real plugin reads before it touches a sample, and it is the
/// only place a host's bus mistake is visible.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ObservedBus {
    channels: int32,
    silence_flags: u64,
    has_buffers: bool,
}

/// A bus the host mapped its own scratch onto.
fn fed(channels: int32) -> ObservedBus {
    ObservedBus {
        channels,
        silence_flags: 0,
        has_buffers: true,
    }
}

/// A bus the host declared and has no signal for.
fn unfed(channels: int32) -> ObservedBus {
    ObservedBus {
        channels,
        silence_flags: (1u64 << channels) - 1,
        has_buffers: false,
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
        return state.buses.lock().expect("bus mutex").of(direction).len() as int32;
    }
    if media == MediaTypes_::kEvent as int32 && direction == BusDirections_::kInput as int32 {
        return state.event_input_buses.load(Ordering::Acquire);
    }
    0
}

fn audio_bus_at(state: &FakeState, direction: int32, index: int32) -> Option<FakeBus> {
    let index = usize::try_from(index).ok()?;
    state
        .buses
        .lock()
        .expect("bus mutex")
        .of(direction)
        .get(index)
        .copied()
}

unsafe fn component_bus_info(
    state: &FakeState,
    media: int32,
    direction: int32,
    index: int32,
    bus: *mut BusInfo,
) -> tresult {
    if media == MediaTypes_::kAudio as int32 {
        let Some(declared) = audio_bus_at(state, direction, index) else {
            return kInvalidArgument;
        };
        write_bus_info(bus, media, direction, declared.channels(), declared.is_main);
        return kResultOk;
    }
    if index != 0 || component_bus_count(state, media, direction) == 0 {
        return kInvalidArgument;
    }
    write_bus_info(bus, media, direction, 0, true);
    kResultOk
}

unsafe fn write_bus_info(
    bus: *mut BusInfo,
    media: int32,
    direction: int32,
    channels: int32,
    is_main: bool,
) {
    if bus.is_null() {
        return;
    }
    (*bus).mediaType = media;
    (*bus).direction = direction;
    (*bus).channelCount = channels;
    (*bus).busType = if is_main {
        BusTypes_::kMain as int32
    } else {
        BusTypes_::kAux as int32
    };
    (*bus).flags = 0;
}

/// The plugin's answer to the arrangement the host states.
///
/// A real plugin either takes the host's width or keeps its own, and
/// `getBusArrangement` afterwards is the only thing that says which happened —
/// so the fake stores what it accepted and reports it back.
unsafe fn fake_set_bus_arrangements(
    state: &FakeState,
    inputs: *mut SpeakerArrangement,
    num_ins: int32,
    outputs: *mut SpeakerArrangement,
    num_outs: int32,
) -> tresult {
    state.arrangement_requests.fetch_add(1, Ordering::AcqRel);
    if state.refuses_arrangements.load(Ordering::Acquire) {
        return kResultFalse;
    }
    let mut buses = state.buses.lock().expect("bus mutex");
    if usize::try_from(num_ins) != Ok(buses.inputs.len())
        || usize::try_from(num_outs) != Ok(buses.outputs.len())
    {
        return kResultFalse;
    }
    accept_arrangements(&mut buses.inputs, inputs);
    accept_arrangements(&mut buses.outputs, outputs);
    kResultOk
}

/// # Safety
/// `requested` addresses at least `buses.len()` arrangements.
unsafe fn accept_arrangements(buses: &mut [FakeBus], requested: *mut SpeakerArrangement) {
    if requested.is_null() {
        return;
    }
    for (index, bus) in buses.iter_mut().enumerate() {
        bus.arrangement = *requested.add(index);
    }
}

unsafe fn fake_get_bus_arrangement(
    state: &FakeState,
    direction: int32,
    index: int32,
    arrangement: *mut SpeakerArrangement,
) -> tresult {
    if arrangement.is_null() {
        return kInvalidArgument;
    }
    let Some(bus) = audio_bus_at(state, direction, index) else {
        return kInvalidArgument;
    };
    *arrangement = bus.arrangement;
    kResultOk
}

unsafe fn component_set_state(state: &FakeState, stream: *mut IBStream) -> tresult {
    if state.refuses_set_state.load(Ordering::Acquire) {
        return kResultFalse;
    }
    let Some(stream) = ComRef::from_raw(stream) else {
        return kInvalidArgument;
    };
    *state.component_chunk.lock().expect("chunk mutex") = read_all(stream);
    kResultOk
}

unsafe fn component_get_state(state: &FakeState, stream: *mut IBStream) -> tresult {
    if state.fails_get_state.load(Ordering::Acquire) {
        return kResultFalse;
    }
    let Some(stream) = ComRef::from_raw(stream) else {
        return kInvalidArgument;
    };
    write_all(stream, &state.component_chunk.lock().expect("chunk mutex"))
}

/// What a half was told, and on which thread — the whole reason a message is
/// routed through the host instead of straight to the peer.
unsafe fn record_notification(
    log: &Mutex<Vec<(String, ThreadId)>>,
    message: *mut IMessage,
) -> tresult {
    let Some(message) = ComRef::from_raw(message) else {
        return kInvalidArgument;
    };
    let id = message.getMessageID();
    if id.is_null() {
        return kInvalidArgument;
    }
    log.lock().expect("notification mutex").push((
        CStr::from_ptr(id).to_string_lossy().into_owned(),
        std::thread::current().id(),
    ));
    kResultOk
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

    record_bus_shape(&state.observed_inputs, data.inputs, data.numInputs);
    record_bus_shape(&state.observed_outputs, data.outputs, data.numOutputs);

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

    if data.numInputs < 1 || data.numOutputs < 1 || data.inputs.is_null() || data.outputs.is_null()
    {
        return kResultOk;
    }
    let gain = state.processor_gain() as f32;
    // Bus zero is the main bus this fake declares, in both directions.
    let input = &*data.inputs;
    let output = &*data.outputs;
    let in_buffers = input.__field0.channelBuffers32;
    let out_buffers = output.__field0.channelBuffers32;
    if in_buffers.is_null() || out_buffers.is_null() {
        return kResultOk;
    }
    let channels = input.numChannels.min(output.numChannels).max(0) as usize;
    for channel in 0..channels {
        let source = *in_buffers.add(channel);
        let target = *out_buffers.add(channel);
        for sample in 0..data.numSamples as usize {
            *target.add(sample) = *source.add(sample) * gain;
        }
    }
    kResultOk
}

/// Record one direction's bus shape without allocating.
///
/// The vectors were reserved at construction because `process` is measured for
/// allocation, and a fake that grew one here would be indistinguishable from a
/// host that allocated on the audio thread.
unsafe fn record_bus_shape(
    into: &Mutex<Vec<ObservedBus>>,
    buses: *mut AudioBusBuffers,
    count: int32,
) {
    let mut observed = into.lock().expect("observation mutex");
    observed.clear();
    if buses.is_null() {
        return;
    }
    for index in 0..count.max(0) as usize {
        let bus = &*buses.add(index);
        observed.push(ObservedBus {
            channels: bus.numChannels,
            silence_flags: bus.silenceFlags,
            has_buffers: !bus.__field0.channelBuffers32.is_null(),
        });
    }
}

macro_rules! fake_component_impls {
    ($type:ty) => {
        impl IPluginBaseTrait for $type {
            unsafe fn initialize(&self, context: *mut FUnknown) -> tresult {
                self.state.initialize_calls.fetch_add(1, Ordering::AcqRel);
                self.state.remember_host(context);
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
                component_bus_info(&self.state, r#type, dir, index, bus)
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
                inputs: *mut u64,
                num_ins: int32,
                outputs: *mut u64,
                num_outs: int32,
            ) -> tresult {
                fake_set_bus_arrangements(&self.state, inputs, num_ins, outputs, num_outs)
            }

            unsafe fn getBusArrangement(&self, dir: int32, index: int32, arr: *mut u64) -> tresult {
                fake_get_bus_arrangement(&self.state, dir, index, arr)
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
    unsafe fn initialize(&self, context: *mut FUnknown) -> tresult {
        self.state.initialize_calls.fetch_add(1, Ordering::AcqRel);
        self.state.remember_host(context);
        kResultOk
    }

    unsafe fn terminate(&self) -> tresult {
        self.state.terminate_calls.fetch_add(1, Ordering::AcqRel);
        kResultOk
    }
}

impl IConnectionPointTrait for FakeSplitComponent {
    unsafe fn connect(&self, other: *mut IConnectionPoint) -> tresult {
        let Some(peer) = ComRef::from_raw(other) else {
            return kInvalidArgument;
        };
        self.state.component_connects.fetch_add(1, Ordering::AcqRel);
        *self.state.component_peer.lock().expect("peer mutex") = Some(peer.to_com_ptr());
        kResultOk
    }

    unsafe fn disconnect(&self, _other: *mut IConnectionPoint) -> tresult {
        self.state.component_connects.fetch_sub(1, Ordering::AcqRel);
        *self.state.component_peer.lock().expect("peer mutex") = None;
        kResultOk
    }

    unsafe fn notify(&self, message: *mut IMessage) -> tresult {
        record_notification(&self.state.component_notifications, message)
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

    unsafe fn notify(&self, message: *mut IMessage) -> tresult {
        record_notification(&self.state.controller_notifications, message)
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
    try_load(state, class_id).expect("the fake plugin activates")
}

fn try_load(state: &Arc<FakeState>, class_id: TUID) -> Result<Vst3Wrapper, String> {
    Vst3Wrapper::activated(instantiate(state, class_id), class_id, 48_000.0)
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

/// The runtime owner queues a host write for the audio thread, and the audio
/// thread's queue is not something a separate controller object ever sees. This
/// is the seam that carries the same write to the editor, and a backend that
/// leaves it as the trait's no-op default leaves the plugin's own knob behind.
#[test]
fn a_host_write_shown_to_the_editor_reaches_the_controller() {
    let state = FakeState::new();
    let mut wrapper = load(&state, SPLIT_COMPONENT_CID);

    wrapper.apply_host_parameter_write_to_editor(GAIN_PARAM, 0.25);

    assert_eq!(state.controller_gain(), 0.25);
    assert_eq!(
        state.processor_gain(),
        1.0,
        "the processor heard a write that belongs to the editor's route"
    );
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
    let saved = load(&source, SPLIT_COMPONENT_CID)
        .get_state()
        .expect("the fake reports its state");

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

    let saved = load(&state, COMBINED_CID)
        .get_state()
        .expect("the fake reports its state");
    let (component, controller) = decode_state(&saved).expect("this host wrote it");

    assert_eq!(component, b"everything".to_vec());
    assert!(controller.is_empty());
}

/// A processor that will not take the saved state has not taken it. Reporting
/// success anyway leaves the project believing a preset loaded that the plugin
/// is not running.
#[test]
fn a_processor_that_refuses_the_saved_state_makes_the_restore_fail() {
    let state = FakeState::new();
    let mut wrapper = load(&state, COMBINED_CID);
    state.refuses_set_state.store(true, Ordering::Release);

    let error = wrapper
        .set_state(&encode_state(b"processor-state", b""))
        .expect_err("the processor refused the chunk");

    assert!(error.contains("refused the processor state"), "{error}");
}

/// A refusal and an empty state are different answers, and only one of them may
/// be written over a project's last good save.
#[test]
fn a_processor_that_will_not_report_its_state_is_an_error_not_an_empty_save() {
    let state = FakeState::new();
    let wrapper = load(&state, COMBINED_CID);
    state.fails_get_state.store(true, Ordering::Release);

    let error = wrapper
        .get_state()
        .expect_err("the processor refused to report");

    assert!(
        error.contains("refused to report its processor state"),
        "{error}"
    );
}

/// A split plugin's controller boots on its parameter defaults while the
/// component boots on the state it was built with. Nothing else agrees them, so
/// an editor opened without this shows values the processor is not using.
#[test]
fn a_split_controller_is_shown_the_processor_state_it_booted_beside() {
    let state = FakeState::new();
    *state.component_chunk.lock().expect("chunk mutex") = b"booted-processor-state".to_vec();

    let _instance = instantiate(&state, SPLIT_COMPONENT_CID);

    assert_eq!(
        *state
            .controller_saw_component_chunk
            .lock()
            .expect("chunk mutex"),
        b"booted-processor-state".to_vec()
    );
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

/// A bundle's `moduleinfo.json` is an unsigned side-car file, so a class id read
/// out of one may name a class the binary beside it does not implement — or one
/// that belongs to somebody else's plugin. The factory is the only authority,
/// and it is asked before anything is instantiated.
#[test]
fn a_class_the_bundles_own_factory_does_not_list_is_not_declared() {
    let state = FakeState::new();
    let factory = factory_for(&state);

    assert!(factory_declares_class(&factory, &COMBINED_CID));
    assert!(factory_declares_class(&factory, &SPLIT_COMPONENT_CID));
    assert!(
        !factory_declares_class(&factory, &UNKNOWN_CID),
        "a class id the factory never lists was accepted as this bundle's own"
    );
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

// ── Bus geometry ────────────────────────────────────────────────────────

/// The ordinary case, pinned so the shapes below read as differences from it:
/// one stereo bus in each direction, both fed by the host's own scratch.
#[test]
fn a_stereo_effect_is_handed_one_fed_stereo_bus_in_each_direction() {
    let state = FakeState::new();
    let mut wrapper = load(&state, COMBINED_CID);

    render(&mut wrapper, 1.0, 8);

    assert_eq!(state.observed_inputs(), vec![fed(2)]);
    assert_eq!(state.observed_outputs(), vec![fed(2)]);
}

/// A plugin whose main output is mono must be told it has one output channel.
/// Claiming two while it only ever writes one is how a host reads a channel the
/// plugin never touched and calls the result audio.
#[test]
fn a_mono_output_plugin_is_handed_exactly_one_output_channel() {
    let state = FakeState::with_buses(
        vec![FakeBus::main(SpeakerArr::kStereo)],
        vec![FakeBus::main(SpeakerArr::kMono)],
    );
    let mut wrapper = load(&state, COMBINED_CID);

    let output = render(&mut wrapper, 1.0, 8);

    assert_eq!(state.observed_inputs(), vec![fed(2)]);
    assert_eq!(state.observed_outputs(), vec![fed(1)]);
    assert!(
        output.iter().all(|sample| (*sample - 1.0).abs() < 1e-6),
        "the accepted mono channel never reached the host's pair: {output:?}"
    );
}

/// An instrument declares no audio input bus at all. Handing it one anyway
/// states a bus its own declaration denies, and `numInputs` is what a plugin
/// loops over.
#[test]
fn an_instrument_with_no_audio_input_is_handed_no_input_bus() {
    let state = FakeState::with_buses(Vec::new(), vec![FakeBus::main(SpeakerArr::kStereo)]);
    let mut wrapper = load(&state, COMBINED_CID);

    render(&mut wrapper, 1.0, 8);

    assert!(
        state.observed_inputs().is_empty(),
        "an instrument was handed an audio input bus it never declared"
    );
    assert_eq!(state.observed_outputs(), vec![fed(2)]);
}

/// Every bus the plugin declared has to be passed, or the plugin indexes past
/// the end of the host's own array. The sidechain this host has no signal for is
/// passed empty and flagged silent — a null buffer without the flag is an
/// invitation to read it.
#[test]
fn a_sidechain_bus_is_declared_to_the_plugin_and_flagged_silent() {
    let state = FakeState::with_buses(
        vec![
            FakeBus::main(SpeakerArr::kStereo),
            FakeBus::aux(SpeakerArr::kMono),
        ],
        vec![FakeBus::main(SpeakerArr::kStereo)],
    );
    let mut wrapper = load(&state, COMBINED_CID);

    render(&mut wrapper, 1.0, 8);

    assert_eq!(state.observed_inputs(), vec![fed(2), unfed(1)]);
    assert_eq!(state.observed_outputs(), vec![fed(2)]);
}

/// Stating the host's own width on the main pair is the whole reason
/// `setBusArrangements` is called: a surround-capable plugin left on its
/// shipped default runs a bus the engine's slots cannot fill.
#[test]
fn a_surround_capable_plugin_that_accepts_stereo_runs_stereo() {
    let state = FakeState::with_buses(
        vec![FakeBus::main(SIX_CHANNELS)],
        vec![FakeBus::main(SIX_CHANNELS)],
    );
    let mut wrapper = load(&state, COMBINED_CID);

    render(&mut wrapper, 1.0, 8);

    assert!(
        state.arrangement_requests.load(Ordering::Acquire) > 0,
        "the host never stated an arrangement, so the plugin kept its own"
    );
    assert_eq!(state.observed_inputs(), vec![fed(2)]);
    assert_eq!(state.observed_outputs(), vec![fed(2)]);
}

/// A plugin that will not leave its surround main bus has nowhere for the host's
/// two channels to go. Refusing it at load is the only honest outcome: handing
/// it two pointers while telling it six channels is a read into memory this host
/// never allocated.
#[test]
fn a_plugin_that_refuses_every_arrangement_the_host_can_feed_is_refused_at_load() {
    let state = FakeState::with_buses(
        vec![FakeBus::main(SpeakerArr::kStereo)],
        vec![FakeBus::main(SIX_CHANNELS)],
    );
    state.refuses_arrangements.store(true, Ordering::Release);

    let error = try_load(&state, COMBINED_CID)
        .err()
        .expect("six output channels cannot be fed");

    assert!(error.contains("Fake Plugin"), "{error}");
    assert!(error.contains("main output bus runs 6 channels"), "{error}");
    assert!(
        state.arrangement_requests.load(Ordering::Acquire) > 0,
        "the host refused the plugin without ever offering it a width"
    );
}

// ── Host stream ─────────────────────────────────────────────────────────

/// Every argument these take crosses the COM boundary from a plugin, where a
/// Rust panic is undefined behaviour rather than an unwind.
unsafe fn write_bytes(stream: &HostStream, bytes: &[u8]) -> tresult {
    let mut written = 0;
    stream.write(
        bytes.as_ptr() as *mut std::ffi::c_void,
        bytes.len() as int32,
        &mut written,
    )
}

/// A plugin may seek anywhere. Parking the cursor where it asked turns the next
/// write into a resize to whatever number it named.
#[test]
fn a_seek_past_the_end_parks_the_cursor_at_the_end() {
    let stream = HostStream::over(b"1234");
    let mut landed = -1;

    let sought = unsafe {
        stream.seek(
            1_000_000,
            IStreamSeekMode_::kIBSeekSet as int32,
            &mut landed,
        )
    };
    let written = unsafe { write_bytes(&stream, b"56") };

    assert_eq!(sought, kResultOk);
    assert_eq!(landed, 4, "the cursor was left past the end of the buffer");
    assert_eq!(written, kResultOk);
    assert_eq!(stream.snapshot(), b"123456".to_vec());
}

/// Reading at the end answers "no bytes" rather than slicing from a position the
/// buffer does not have.
#[test]
fn a_read_at_the_end_of_the_stream_returns_no_bytes() {
    let stream = HostStream::over(b"1234");
    let mut landed = -1;
    unsafe { stream.seek(0, IStreamSeekMode_::kIBSeekEnd as int32, &mut landed) };

    let mut buffer = [0u8; 8];
    let mut read = -1;
    let result = unsafe {
        stream.read(
            buffer.as_mut_ptr() as *mut std::ffi::c_void,
            buffer.len() as int32,
            &mut read,
        )
    };

    assert_eq!(result, kResultOk);
    assert_eq!(read, 0);
}

/// `kIBSeekEnd` plus an offset is arithmetic on a plugin-supplied number. Left
/// unsaturated it overflows, and an overflow panic in a debug build unwinds into
/// the plugin's frame.
#[test]
fn a_seek_from_the_end_by_a_huge_offset_does_not_overflow() {
    let stream = HostStream::over(b"1234");
    let mut landed = -1;

    let sought = unsafe {
        stream.seek(
            int64::MAX,
            IStreamSeekMode_::kIBSeekEnd as int32,
            &mut landed,
        )
    };
    let written = unsafe { write_bytes(&stream, b"5") };

    assert_eq!(sought, kResultOk);
    assert_eq!(landed, 4);
    assert_eq!(written, kResultOk);
    assert_eq!(stream.snapshot(), b"12345".to_vec());
}

/// A length no host has memory for comes back as a result code the plugin is
/// required to handle, rather than being attempted as an allocation.
#[test]
fn a_write_larger_than_the_stream_ceiling_is_refused() {
    let stream = HostStream::empty();
    let byte = [0u8; 1];
    let mut written = -1;

    let result = unsafe {
        stream.write(
            byte.as_ptr() as *mut std::ffi::c_void,
            int32::MAX,
            &mut written,
        )
    };

    assert_eq!(result, kOutOfMemory);
    assert!(
        stream.snapshot().is_empty(),
        "the stream grew for a write it refused"
    );
}

/// Null pointers, negative lengths, unknown seek modes and a seek before the
/// start all arrive from the plugin's side of a COM call. Every one of them must
/// come back as a result code.
#[test]
fn no_stream_call_panics_on_an_argument_a_plugin_supplied() {
    let stream = HostStream::over(b"1234");
    let mut byte = [0u8; 1];
    let scratch = byte.as_mut_ptr() as *mut std::ffi::c_void;

    // SAFETY: this is the abuse the methods exist to survive.
    unsafe {
        assert_eq!(
            stream.read(ptr::null_mut(), 1, ptr::null_mut()),
            kInvalidArgument
        );
        assert_eq!(stream.read(scratch, -1, ptr::null_mut()), kInvalidArgument);
        assert_eq!(
            stream.write(ptr::null_mut(), 1, ptr::null_mut()),
            kInvalidArgument
        );
        assert_eq!(stream.write(scratch, -1, ptr::null_mut()), kInvalidArgument);
        assert_eq!(
            stream.seek(-1, IStreamSeekMode_::kIBSeekSet as int32, ptr::null_mut()),
            kInvalidArgument
        );
        assert_eq!(
            stream.seek(
                int64::MIN,
                IStreamSeekMode_::kIBSeekCur as int32,
                ptr::null_mut()
            ),
            kInvalidArgument
        );
        assert_eq!(stream.seek(0, 99, ptr::null_mut()), kInvalidArgument);
        assert_eq!(stream.tell(ptr::null_mut()), kResultOk);
    }
    assert_eq!(stream.snapshot(), b"1234".to_vec());
}

// ── Connection-point messages ───────────────────────────────────────────

/// A component reports to its controller from whatever thread it happens to be
/// on. Delivering that straight to the peer runs controller code there — the
/// classic case being a meter level raised inside `process`, which would run the
/// editor on the audio thread. The host parks it and hands it over itself.
#[test]
fn a_message_raised_off_the_control_path_is_delivered_on_it() {
    let state = FakeState::new();
    let wrapper = load(&state, SPLIT_COMPONENT_CID);

    let sender = Arc::clone(&state);
    let raising_thread = std::thread::spawn(move || {
        assert_eq!(sender.send_from_component("sourdaw.meter"), kResultOk);
        std::thread::current().id()
    })
    .join()
    .expect("the raising thread finished");

    assert!(
        state.controller_notifications().is_empty(),
        "the controller ran on the thread that raised the message"
    );

    wrapper.deliver_deferred_messages();

    let delivered = state.controller_notifications();
    assert_eq!(delivered.len(), 1);
    assert_eq!(delivered[0].0, "sourdaw.meter");
    assert_ne!(
        delivered[0].1, raising_thread,
        "the message was delivered on the thread that raised it"
    );
    assert_eq!(delivered[0].1, std::thread::current().id());

    wrapper.deliver_deferred_messages();

    assert_eq!(
        state.controller_notifications().len(),
        1,
        "a delivered message was left in the queue and delivered again"
    );
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
