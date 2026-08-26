//! Hosting one VST3 plugin instance behind the format-neutral seam.
//!
//! Flow: open the module → `IPluginFactory::createInstance` for the class the
//! descriptor names → `IComponent::initialize` → find or create the paired
//! `IEditController` → connect them → `setupProcessing` → `setActive(true)` →
//! `setProcessing(true)` on the audio thread → `IAudioProcessor::process`.
//!
//! RT-safety: every buffer, parameter queue and event the audio thread hands the
//! plugin is allocated in `from_factory` and refilled in place. `process` takes
//! no lock, allocates nothing, and performs no I/O.

use crate::params::PluginParameter;
use crate::traits::{
    AudioPlugin, HostParameterUpdate, HostTransport, HostedPluginRuntime, LatencyChangeNotifier,
    ProcessingGate,
};
use crate::vst3_host::{read_string128, MessageTarget, Vst3HostContext, Vst3HostState};
use crate::vst3_module::Vst3Module;
use std::cell::Cell;
use std::path::Path;
use std::ptr;
use std::sync::{Arc, Mutex};
use vst3::Steinberg::Vst::{
    AudioBusBuffers, AudioBusBuffers__type0, BusDirections_, Event, Event_::EventTypes_,
    Event__type0, IAudioProcessor, IAudioProcessorTrait, IComponent, IComponentTrait,
    IConnectionPoint, IConnectionPointTrait, IEditController, IEditControllerTrait, IEventList,
    IEventListTrait, IParamValueQueue, IParamValueQueueTrait, IParameterChanges,
    IParameterChangesTrait, MediaTypes_, NoteOffEvent, NoteOnEvent, ParamID, ParamValue,
    ParameterInfo, ParameterInfo_::ParameterFlags_, ProcessContext,
    ProcessContext_::StatesAndFlags_, ProcessData, ProcessModes_, ProcessSetup,
    SymbolicSampleSizes_,
};
use vst3::Steinberg::{
    int32, int64, kInvalidArgument, kResultOk, IBStream, IBStreamTrait,
    IBStream_::IStreamSeekMode_, IPluginBaseTrait, IPluginFactory, IPluginFactoryTrait, TUID,
};
use vst3::{Class, ComPtr, ComWrapper, Interface};

/// Largest block this host hands a plugin, and the `maxSamplesPerBlock` every
/// instance is set up with.
const MAX_BUFFER: usize = 4096;
/// Channels the seam carries. VST3 buses are wider, but the engine's plugin
/// slots are stereo, so a wider main bus is fed silence rather than garbage.
const CHANNELS: usize = 2;
/// MIDI events forwarded per block. Extra events are dropped rather than
/// allocated for.
const MAX_MIDI: usize = 64;
/// Distinct parameters whose value can reach a plugin in one block.
const MAX_PARAMETER_QUEUES: usize = 64;
/// How many deactivate/reactivate/re-query passes one `poll_latency_change`
/// makes before it stops chasing a plugin that re-flags from inside its own
/// activation. Mirrors the CLAP backend's cap for the same reason.
const MAX_LATENCY_REQUERY_PASSES: u32 = 4;

/// Magic and version of the container that carries a VST3 instance's two state
/// chunks as the one opaque blob the seam persists.
const STATE_MAGIC: &[u8; 4] = b"SDV3";
const STATE_VERSION: u16 = 1;
const STATE_HEADER_BYTES: usize = 14;

// ---------------------------------------------------------------------------
// RT-side host objects
// ---------------------------------------------------------------------------

/// One parameter's value for the coming block.
///
/// A single point at sample offset zero, deliberately: the seam delivers the
/// value a parameter has *reached*, not a curve through the block. Sample
/// accurate automation is the automation lane's job and is not modelled here, so
/// pretending to a ramp would be inventing data.
#[derive(Default)]
struct HostParamValueQueue {
    param_id: Cell<ParamID>,
    value: Cell<ParamValue>,
    filled: Cell<bool>,
}

impl Class for HostParamValueQueue {
    type Interfaces = (IParamValueQueue,);
}

impl IParamValueQueueTrait for HostParamValueQueue {
    unsafe fn getParameterId(&self) -> ParamID {
        self.param_id.get()
    }

    unsafe fn getPointCount(&self) -> int32 {
        if self.filled.get() {
            1
        } else {
            0
        }
    }

    unsafe fn getPoint(
        &self,
        index: int32,
        sample_offset: *mut int32,
        value: *mut ParamValue,
    ) -> int32 {
        if index != 0 || !self.filled.get() || sample_offset.is_null() || value.is_null() {
            return kInvalidArgument;
        }
        *sample_offset = 0;
        *value = self.value.get();
        kResultOk
    }

    unsafe fn addPoint(
        &self,
        _sample_offset: int32,
        value: ParamValue,
        index: *mut int32,
    ) -> int32 {
        self.value.set(value);
        self.filled.set(true);
        if !index.is_null() {
            *index = 0;
        }
        kResultOk
    }
}

/// The `inputParameterChanges` list one block hands the plugin.
///
/// The queues are allocated once and reused: `reset` marks them free without
/// dropping anything, so filling this from the audio thread costs no allocation.
struct HostParameterChanges {
    queues: Vec<ComWrapper<HostParamValueQueue>>,
    used: Cell<usize>,
}

impl HostParameterChanges {
    fn new() -> Self {
        Self {
            queues: (0..MAX_PARAMETER_QUEUES)
                .map(|_| ComWrapper::new(HostParamValueQueue::default()))
                .collect(),
            used: Cell::new(0),
        }
    }

    /// Release every queue for reuse. RT-safe.
    fn reset(&self) {
        self.used.set(0);
    }

    /// Stage one parameter's value for the coming block, replacing any value
    /// already staged for the same parameter. RT-safe; silently drops writes
    /// past `MAX_PARAMETER_QUEUES` rather than growing on the audio thread.
    fn stage(&self, param_id: ParamID, value: ParamValue) {
        let Some(position) = self.queue_index_for(param_id) else {
            return;
        };
        self.queues[position].value.set(value);
    }

    /// The queue already holding this parameter, or a freshly claimed one.
    /// `None` once every queue is spoken for.
    fn queue_index_for(&self, param_id: ParamID) -> Option<usize> {
        let used = self.used.get();
        if let Some(position) = self.queues[..used]
            .iter()
            .position(|queue| queue.param_id.get() == param_id)
        {
            return Some(position);
        }
        if used == self.queues.len() {
            return None;
        }
        let queue = &self.queues[used];
        queue.param_id.set(param_id);
        queue.value.set(0.0);
        queue.filled.set(true);
        self.used.set(used + 1);
        Some(used)
    }

    fn is_empty(&self) -> bool {
        self.used.get() == 0
    }
}

impl Class for HostParameterChanges {
    type Interfaces = (IParameterChanges,);
}

impl IParameterChangesTrait for HostParameterChanges {
    unsafe fn getParameterCount(&self) -> int32 {
        self.used.get() as int32
    }

    unsafe fn getParameterData(&self, index: int32) -> *mut IParamValueQueue {
        if index < 0 || index as usize >= self.used.get() {
            return ptr::null_mut();
        }
        borrowed_ptr(&self.queues[index as usize])
    }

    unsafe fn addParameterData(
        &self,
        id: *const ParamID,
        index: *mut int32,
    ) -> *mut IParamValueQueue {
        if id.is_null() {
            return ptr::null_mut();
        }
        let Some(position) = self.queue_index_for(*id) else {
            return ptr::null_mut();
        };
        if !index.is_null() {
            *index = position as int32;
        }
        borrowed_ptr(&self.queues[position])
    }
}

/// Borrow the interface pointer of a host object without touching its refcount.
///
/// Every pointer this host puts inside `ProcessData` is borrowed for the length
/// of one `process` call and never retained by the plugin, so handing out an
/// owning pointer would leak a reference per block.
fn borrowed_ptr<C, I>(wrapper: &ComWrapper<C>) -> *mut I
where
    C: Class,
    I: Interface,
{
    wrapper
        .as_com_ref::<I>()
        .map_or(ptr::null_mut(), |reference| reference.as_ptr())
}

/// The `inputEvents` list one block hands the plugin.
struct HostEventList {
    events: Cell<[Event; MAX_MIDI]>,
    count: Cell<usize>,
}

impl HostEventList {
    fn new() -> Self {
        Self {
            events: Cell::new([empty_event(); MAX_MIDI]),
            count: Cell::new(0),
        }
    }

    fn reset(&self) {
        self.count.set(0);
    }

    /// Append one note event. RT-safe; drops events past `MAX_MIDI`.
    fn push(&self, event: Event) {
        let count = self.count.get();
        if count == MAX_MIDI {
            return;
        }
        // SAFETY: `Cell::as_ptr` yields the live array; nothing else aliases it,
        // because only the audio thread touches this list and only between
        // `reset` and the `process` call that reads it.
        unsafe {
            (*self.events.as_ptr())[count] = event;
        }
        self.count.set(count + 1);
    }

    fn is_empty(&self) -> bool {
        self.count.get() == 0
    }
}

impl Class for HostEventList {
    type Interfaces = (IEventList,);
}

impl IEventListTrait for HostEventList {
    unsafe fn getEventCount(&self) -> int32 {
        self.count.get() as int32
    }

    unsafe fn getEvent(&self, index: int32, e: *mut Event) -> int32 {
        if index < 0 || index as usize >= self.count.get() || e.is_null() {
            return kInvalidArgument;
        }
        *e = (*self.events.as_ptr())[index as usize];
        kResultOk
    }

    unsafe fn addEvent(&self, _e: *mut Event) -> int32 {
        // Output events are absorbed: the seam has nowhere to route a plugin's
        // generated MIDI yet, and accepting it silently would claim otherwise.
        kInvalidArgument
    }
}

fn empty_event() -> Event {
    // SAFETY: `Event` is a plain `repr(C)` POD whose payload is a union; zero is
    // a valid bit pattern for every arm.
    unsafe { std::mem::zeroed() }
}

fn note_event(note: u8, velocity: u8, channel: i16, is_on: bool) -> Event {
    let mut event = empty_event();
    event.busIndex = 0;
    event.sampleOffset = 0;
    event.ppqPosition = 0.0;
    event.flags = 0;
    let normalised_velocity = f32::from(velocity) / 127.0;
    if is_on {
        event.r#type = EventTypes_::kNoteOnEvent as u16;
        event.__field0 = Event__type0 {
            noteOn: NoteOnEvent {
                channel,
                pitch: i16::from(note),
                tuning: 0.0,
                velocity: normalised_velocity,
                length: 0,
                noteId: -1,
            },
        };
        return event;
    }
    event.r#type = EventTypes_::kNoteOffEvent as u16;
    event.__field0 = Event__type0 {
        noteOff: NoteOffEvent {
            channel,
            pitch: i16::from(note),
            velocity: normalised_velocity,
            noteId: -1,
            tuning: 0.0,
        },
    };
    event
}

// ---------------------------------------------------------------------------
// Control-side stream
// ---------------------------------------------------------------------------

/// An `IBStream` over an in-memory buffer, for reading and writing plugin state.
///
/// Control path only — state transfer never happens on the audio thread — so a
/// mutex here costs nothing and removes every question about which thread the
/// plugin calls back from.
#[derive(Default)]
pub struct HostStream {
    inner: Mutex<StreamCursor>,
}

#[derive(Default)]
struct StreamCursor {
    bytes: Vec<u8>,
    position: usize,
}

impl HostStream {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn over(bytes: &[u8]) -> Self {
        Self {
            inner: Mutex::new(StreamCursor {
                bytes: bytes.to_vec(),
                position: 0,
            }),
        }
    }

    /// A copy of everything written so far. Reading through a borrow rather than
    /// consuming the stream, because the plugin may still hold a reference to it
    /// when the host wants the bytes.
    pub fn snapshot(&self) -> Vec<u8> {
        self.inner
            .lock()
            .map(|cursor| cursor.bytes.clone())
            .unwrap_or_default()
    }
}

impl Class for HostStream {
    type Interfaces = (IBStream,);
}

impl IBStreamTrait for HostStream {
    unsafe fn read(
        &self,
        buffer: *mut std::ffi::c_void,
        num_bytes: int32,
        num_bytes_read: *mut int32,
    ) -> int32 {
        if buffer.is_null() || num_bytes < 0 {
            return kInvalidArgument;
        }
        let Ok(mut cursor) = self.inner.lock() else {
            return kInvalidArgument;
        };
        let available = cursor.bytes.len().saturating_sub(cursor.position);
        let count = available.min(num_bytes as usize);
        ptr::copy_nonoverlapping(
            cursor.bytes[cursor.position..].as_ptr(),
            buffer as *mut u8,
            count,
        );
        cursor.position += count;
        if !num_bytes_read.is_null() {
            *num_bytes_read = count as int32;
        }
        kResultOk
    }

    unsafe fn write(
        &self,
        buffer: *mut std::ffi::c_void,
        num_bytes: int32,
        num_bytes_written: *mut int32,
    ) -> int32 {
        if buffer.is_null() || num_bytes < 0 {
            return kInvalidArgument;
        }
        let Ok(mut cursor) = self.inner.lock() else {
            return kInvalidArgument;
        };
        let count = num_bytes as usize;
        let end = cursor.position + count;
        if cursor.bytes.len() < end {
            cursor.bytes.resize(end, 0);
        }
        let start = cursor.position;
        ptr::copy_nonoverlapping(
            buffer as *const u8,
            cursor.bytes[start..].as_mut_ptr(),
            count,
        );
        cursor.position = end;
        if !num_bytes_written.is_null() {
            *num_bytes_written = count as int32;
        }
        kResultOk
    }

    unsafe fn seek(&self, pos: int64, mode: int32, result: *mut int64) -> int32 {
        let Ok(mut cursor) = self.inner.lock() else {
            return kInvalidArgument;
        };
        let origin = match mode {
            mode if mode == IStreamSeekMode_::kIBSeekSet as int32 => 0,
            mode if mode == IStreamSeekMode_::kIBSeekCur as int32 => cursor.position as i64,
            mode if mode == IStreamSeekMode_::kIBSeekEnd as int32 => cursor.bytes.len() as i64,
            _ => return kInvalidArgument,
        };
        let target = origin.saturating_add(pos);
        if target < 0 {
            return kInvalidArgument;
        }
        cursor.position = target as usize;
        if !result.is_null() {
            *result = target;
        }
        kResultOk
    }

    unsafe fn tell(&self, pos: *mut int64) -> int32 {
        let Ok(cursor) = self.inner.lock() else {
            return kInvalidArgument;
        };
        if !pos.is_null() {
            *pos = cursor.position as int64;
        }
        kResultOk
    }
}

// ---------------------------------------------------------------------------
// Two-chunk state container
// ---------------------------------------------------------------------------

/// Pack a VST3 instance's component and controller chunks into the single
/// opaque blob the seam stores.
///
/// VST3 splits state in two on purpose: the processor's chunk is what the audio
/// engine needs, and the controller's is editor-side presentation the processor
/// must never be handed. Concatenating them without a boundary would make one
/// unrecoverable, and storing only the component chunk would silently lose every
/// editor-only setting on reload — so the container is versioned from the first
/// release rather than after the first migration.
pub fn encode_state(component: &[u8], controller: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(STATE_HEADER_BYTES + component.len() + controller.len());
    encoded.extend_from_slice(STATE_MAGIC);
    encoded.extend_from_slice(&STATE_VERSION.to_le_bytes());
    encoded.extend_from_slice(&(component.len() as u32).to_le_bytes());
    encoded.extend_from_slice(&(controller.len() as u32).to_le_bytes());
    encoded.extend_from_slice(component);
    encoded.extend_from_slice(controller);
    encoded
}

/// Split a stored blob back into the two chunks, refusing anything this host did
/// not write.
pub fn decode_state(encoded: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    if encoded.len() < STATE_HEADER_BYTES {
        return Err("VST3 state is too short to carry its own header".to_string());
    }
    if &encoded[..4] != STATE_MAGIC {
        return Err("VST3 state was not written by this host".to_string());
    }
    let version = u16::from_le_bytes([encoded[4], encoded[5]]);
    if version != STATE_VERSION {
        return Err(format!(
            "VST3 state version {version} was written by a newer host and cannot be read"
        ));
    }
    let component_len =
        u32::from_le_bytes([encoded[6], encoded[7], encoded[8], encoded[9]]) as usize;
    let controller_len =
        u32::from_le_bytes([encoded[10], encoded[11], encoded[12], encoded[13]]) as usize;
    let expected = STATE_HEADER_BYTES
        .checked_add(component_len)
        .and_then(|total| total.checked_add(controller_len))
        .ok_or_else(|| "VST3 state declares more bytes than can exist".to_string())?;
    if encoded.len() < expected {
        return Err("VST3 state is shorter than its own header declares".to_string());
    }
    let component_end = STATE_HEADER_BYTES + component_len;
    Ok((
        encoded[STATE_HEADER_BYTES..component_end].to_vec(),
        encoded[component_end..component_end + controller_len].to_vec(),
    ))
}

// ---------------------------------------------------------------------------
// An instantiated, unactivated plugin
// ---------------------------------------------------------------------------

/// One VST3 plugin's component and edit controller, created, initialised and
/// wired together — and nothing more.
///
/// Kept apart from [`Vst3Wrapper`] because instantiation and activation are two
/// different questions with two different callers. The scanner wants a plugin it
/// can interrogate and throw away, and activating one to read its parameter list
/// would make it allocate its processing buffers for a question about metadata.
///
/// Field order is drop order, and it is load-bearing: the plugin's own objects
/// are released before the host context they hold a pointer to, and both before
/// the module whose code their vtables live in.
pub struct Vst3Instance {
    /// The controller's connection point, held so it can be disconnected.
    controller_connection: Option<ComPtr<IConnectionPoint>>,
    /// The component's connection point, held so it can be disconnected.
    component_connection: Option<ComPtr<IConnectionPoint>>,
    /// `IEditController`, when the plugin has one. A combined class answers with
    /// the same object as `component`.
    controller: Option<ComPtr<IEditController>>,
    component: ComPtr<IComponent>,
    /// Whether `controller` is the same object as `component`. A combined class
    /// is initialised and terminated once, not twice.
    controller_is_component: bool,
    host: Vst3HostContext,
    /// Kept alive for the instance's whole life. `None` only for a factory built
    /// in-process by a test.
    _module: Option<Arc<Vst3Module>>,
    name: String,
}

// SAFETY: every VST3 object here is reached through `&self`/`&mut self` under
// the seam's access lock, and every pointer is owned by this struct and released
// in `Drop`.
unsafe impl Send for Vst3Instance {}
unsafe impl Sync for Vst3Instance {}

impl Vst3Instance {
    /// Open a bundle and instantiate the class the descriptor names, without
    /// activating it.
    ///
    /// `descriptor_id` is the class CID as 32 hex characters, which is what the
    /// scanner publishes and what a saved project stores.
    pub fn open(bundle_path: &Path, descriptor_id: &str) -> Result<Self, String> {
        let class_id = parse_class_id(descriptor_id)?;
        let host = Vst3HostContext::new();
        let module = Vst3Module::open(bundle_path, host.as_unknown())?;
        let name = class_name(module.factory(), &class_id)
            .unwrap_or_else(|| bundle_name(bundle_path).to_string());
        let factory = module.factory().clone();
        Self::create(Some(module), &factory, host, &class_id, &name)
    }

    /// Instantiate against an already-obtained factory.
    ///
    /// Separate from [`Vst3Instance::open`] so the whole instantiation path is
    /// reachable from a test with an in-process factory — no `.vst3` binary,
    /// which CI does not have and must not execute.
    pub fn create(
        module: Option<Arc<Vst3Module>>,
        factory: &ComPtr<IPluginFactory>,
        host: Vst3HostContext,
        class_id: &TUID,
        name: &str,
    ) -> Result<Self, String> {
        let component = create_component(factory, class_id, name)?;

        // SAFETY: `component` was just created by the factory and has not been
        // initialised. A failed `initialize` is released without `terminate` —
        // the plugin never reached the state `terminate` undoes.
        unsafe {
            if component.initialize(host.as_unknown()) != kResultOk {
                return Err(format!("[VST3] '{name}' refused to initialize"));
            }
        }

        let mut instance = Self {
            controller_connection: None,
            component_connection: None,
            controller: None,
            component,
            controller_is_component: false,
            host,
            _module: module,
            name: name.to_string(),
        };
        instance.attach_controller(factory);
        Ok(instance)
    }

    pub fn component(&self) -> &ComPtr<IComponent> {
        &self.component
    }

    pub fn controller(&self) -> Option<&ComPtr<IEditController>> {
        self.controller.as_ref()
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Whether the plugin declares an event input bus.
    ///
    /// The only honest answer to "does this accept MIDI": VST3 states it in the
    /// plugin's own bus declaration, so nothing here has to assume.
    pub fn accepts_midi(&self) -> bool {
        // SAFETY: the component is live and initialised.
        unsafe {
            self.component.getBusCount(
                MediaTypes_::kEvent as int32,
                BusDirections_::kInput as int32,
            ) > 0
        }
    }

    /// Find the plugin's edit controller and wire it to the component.
    ///
    /// A combined class answers `queryInterface` for `IEditController` on the
    /// component itself; only when it does not does the paired controller class
    /// get created, initialised and connected. Asking the component first is the
    /// order the SDK's own host uses, and it is what keeps a combined class from
    /// being initialised twice — which a plugin is entitled to treat as a fault.
    ///
    /// A plugin with no controller is legal: it has no parameters and no editor,
    /// so failing to find one is not an error.
    fn attach_controller(&mut self, factory: &ComPtr<IPluginFactory>) {
        if let Some(controller) = self.component.cast::<IEditController>() {
            self.controller_is_component = true;
            self.controller = Some(controller);
            self.set_component_handler();
            return;
        }

        let Some(controller_class) = self.controller_class_id() else {
            return;
        };
        let Ok(controller) = create_controller(factory, &controller_class, &self.name) else {
            return;
        };

        // SAFETY: freshly created, not yet initialised. On refusal it is dropped
        // without `terminate`, which it never earned.
        unsafe {
            if controller.initialize(self.host.as_unknown()) != kResultOk {
                return;
            }
        }

        self.controller = Some(controller);
        self.set_component_handler();
        self.connect_component_and_controller();
    }

    fn controller_class_id(&self) -> Option<TUID> {
        let mut class_id: TUID = [0; 16];
        // SAFETY: `component` is live and initialised; `class_id` is a valid out
        // parameter of exactly the declared size.
        let result = unsafe { self.component.getControllerClassId(&mut class_id) };
        (result == kResultOk).then_some(class_id)
    }

    fn set_component_handler(&self) {
        let Some(controller) = &self.controller else {
            return;
        };
        // SAFETY: the handler is owned by `self.host`, which outlives every
        // plugin object in field order, and the pointer is borrowed rather than
        // owned so the plugin's own retain governs its lifetime.
        unsafe {
            controller.setComponentHandler(self.host.component_handler());
        }
    }

    /// Join the component's and controller's connection points.
    ///
    /// A split plugin talks to itself across this pair, and a plugin whose halves
    /// are never connected loses every processor-to-editor update — the classic
    /// symptom being an editor whose meters never move.
    fn connect_component_and_controller(&mut self) {
        let Some(controller) = &self.controller else {
            return;
        };
        let (Some(component_point), Some(controller_point)) = (
            self.component.cast::<IConnectionPoint>(),
            controller.cast::<IConnectionPoint>(),
        ) else {
            return;
        };

        // SAFETY: both points belong to live objects this instance owns.
        unsafe {
            component_point.connect(controller_point.as_ptr());
            controller_point.connect(component_point.as_ptr());
        }
        self.component_connection = Some(component_point);
        self.controller_connection = Some(controller_point);
    }
}

impl Drop for Vst3Instance {
    fn drop(&mut self) {
        // SAFETY: every object is live until this point, and the order below is
        // the reverse of construction, which is what VST3 requires.
        unsafe {
            if let (Some(component_point), Some(controller_point)) = (
                self.component_connection.as_ref(),
                self.controller_connection.as_ref(),
            ) {
                component_point.disconnect(controller_point.as_ptr());
                controller_point.disconnect(component_point.as_ptr());
            }

            if let Some(controller) = &self.controller {
                controller.setComponentHandler(ptr::null_mut());
                if !self.controller_is_component {
                    controller.terminate();
                }
            }
            self.component.terminate();
        }
    }
}

// ---------------------------------------------------------------------------
// The wrapper
// ---------------------------------------------------------------------------

/// A loaded, activated VST3 plugin, in the vocabulary the seam speaks.
///
/// Field order is drop order: the wrapper's own `Drop` leaves the processing and
/// active states before `instance` releases the plugin.
pub struct Vst3Wrapper {
    processor: Option<ComPtr<IAudioProcessor>>,
    instance: Vst3Instance,

    descriptor_id: String,
    sample_rate: f64,
    activated: bool,
    accepts_midi: bool,
    processing: Arc<ProcessingGate>,

    /// Preallocated audio scratch. The plugin is handed pointers into these.
    input_scratch: Box<[[f32; MAX_BUFFER]; CHANNELS]>,
    output_scratch: Box<[[f32; MAX_BUFFER]; CHANNELS]>,
    parameter_changes: ComWrapper<HostParameterChanges>,
    event_list: ComWrapper<HostEventList>,
    process_context: Box<ProcessContext>,
    has_transport: bool,
    /// Scratch the audio thread drains editor gestures into, so draining costs
    /// no allocation.
    gesture_scratch: Box<[HostParameterUpdate; MAX_PARAMETER_QUEUES]>,
}

// SAFETY: as `Vst3Instance` — every VST3 object is reached under the seam's
// access lock, and the RT path touches only preallocated storage this struct
// owns.
unsafe impl Send for Vst3Wrapper {}
unsafe impl Sync for Vst3Wrapper {}

impl Vst3Wrapper {
    /// Load a bundle, instantiate the class the descriptor names, and activate
    /// it at the given sample rate.
    pub fn new(bundle_path: &Path, descriptor_id: &str, sample_rate: f64) -> Result<Self, String> {
        let instance = Vst3Instance::open(bundle_path, descriptor_id)?;
        Self::activated(instance, parse_class_id(descriptor_id)?, sample_rate)
    }

    /// Activate an already-instantiated plugin. Separate so a test can build the
    /// instance from an in-process factory.
    pub fn activated(
        instance: Vst3Instance,
        class_id: TUID,
        sample_rate: f64,
    ) -> Result<Self, String> {
        let mut wrapper = Self {
            processor: None,
            accepts_midi: instance.accepts_midi(),
            instance,
            descriptor_id: format_class_id(&class_id),
            sample_rate,
            activated: false,
            processing: Arc::new(ProcessingGate::default()),
            input_scratch: Box::new([[0.0; MAX_BUFFER]; CHANNELS]),
            output_scratch: Box::new([[0.0; MAX_BUFFER]; CHANNELS]),
            parameter_changes: ComWrapper::new(HostParameterChanges::new()),
            event_list: ComWrapper::new(HostEventList::new()),
            process_context: Box::new(empty_process_context(sample_rate)),
            has_transport: false,
            gesture_scratch: Box::new([HostParameterUpdate::default(); MAX_PARAMETER_QUEUES]),
        };
        wrapper.activate()?;
        Ok(wrapper)
    }

    /// Activate buses, declare the processing setup, and make the component
    /// active. Entering the processing state is left to the audio thread, which
    /// is the only thread VST3 allows `setProcessing` from.
    fn activate(&mut self) -> Result<(), String> {
        let component = self.instance.component();
        let Some(processor) = component.cast::<IAudioProcessor>() else {
            return Err(format!(
                "[VST3] '{}' exposes no audio processor",
                self.instance.name()
            ));
        };

        // SAFETY: the component is initialised and inactive, which is the only
        // state in which bus activation and `setupProcessing` are defined.
        unsafe {
            activate_first_bus(
                component,
                MediaTypes_::kAudio as int32,
                BusDirections_::kInput as int32,
            );
            activate_first_bus(
                component,
                MediaTypes_::kAudio as int32,
                BusDirections_::kOutput as int32,
            );
            if self.accepts_midi {
                activate_first_bus(
                    component,
                    MediaTypes_::kEvent as int32,
                    BusDirections_::kInput as int32,
                );
            }

            let mut setup = self.process_setup();
            if processor.setupProcessing(&mut setup) != kResultOk {
                return Err(format!(
                    "[VST3] '{}' refused the host's processing setup",
                    self.instance.name()
                ));
            }

            if component.setActive(1) != kResultOk {
                return Err(format!(
                    "[VST3] '{}' refused to activate",
                    self.instance.name()
                ));
            }
        }

        self.processor = Some(processor);
        self.activated = true;
        // The first audio block enters the processing state, on the thread VST3
        // requires for it.
        self.processing.request_start();
        Ok(())
    }

    fn process_setup(&self) -> ProcessSetup {
        ProcessSetup {
            processMode: ProcessModes_::kRealtime as int32,
            symbolicSampleSize: SymbolicSampleSizes_::kSample32 as int32,
            maxSamplesPerBlock: MAX_BUFFER as int32,
            sampleRate: self.sample_rate,
        }
    }

    /// The per-instance host state the plugin's callbacks write into.
    pub fn host_state(&self) -> Arc<Vst3HostState> {
        Arc::clone(&self.instance.host.state)
    }

    /// Install the wake fired when this plugin flags a latency change. First
    /// install wins, so the wake cannot be hijacked mid-life.
    pub fn set_latency_change_notifier(&self, notifier: LatencyChangeNotifier) -> bool {
        self.instance.host.state.set_latency_notifier(notifier)
    }

    /// The class CID this instance was created from, as the scanner spells it.
    pub fn descriptor_id(&self) -> &str {
        &self.descriptor_id
    }

    /// Deliver messages the plugin's halves sent each other through the host.
    ///
    /// VST3 routes an `IMessage` from one connection point to the other, and a
    /// plugin may send one from its processor — where re-entering the peer
    /// directly would run plugin code on the audio thread. The host callbacks
    /// park those messages instead; this hands them on from the control thread.
    pub fn deliver_deferred_messages(&mut self) {
        for pending in self.instance.host.state.take_deferred_messages() {
            let point = match pending.target {
                MessageTarget::Component => self.instance.component_connection.as_ref(),
                MessageTarget::Controller => self.instance.controller_connection.as_ref(),
            };
            let Some(point) = point else {
                continue;
            };
            // SAFETY: the connection point is live for as long as this wrapper
            // is, and the message is owned by `pending` for this call.
            unsafe {
                point.notify(pending.message.as_ptr());
            }
        }
    }

    /// Leave the processing state from a thread that is not the audio thread.
    ///
    /// Only correct when no further block will arrive: VST3 requires
    /// `setProcessing(false)` before `setActive(false)`, and a slot already out
    /// of the graph has no audio thread left to do it. Counted so the deviation
    /// stays visible.
    pub fn force_stop_processing_off_audio_thread(&mut self) {
        self.processing.request_stop();
        if !self.processing.is_processing() {
            return;
        }
        if let Some(processor) = &self.processor {
            // SAFETY: the processor is live and active.
            unsafe {
                processor.setProcessing(0);
            }
        }
        self.processing.mark_stopped();
        self.processing.count_off_audio_thread_stop();
    }

    /// Run the deactivate/reactivate cycle a latency change requires, and report
    /// the latency the plugin declares afterwards.
    ///
    /// VST3 defines `getLatencySamples` as meaningful only while the component
    /// is active and set up, and a plugin that changed its latency has to be
    /// taken through `setActive(false)`/`setupProcessing`/`setActive(true)`
    /// before the new value is the one it will actually use. Reading before the
    /// cycle reports the latency of a configuration the plugin has abandoned.
    ///
    /// Control path only: the caller holds the exclusive control claim, so the
    /// audio thread cannot run concurrently — which is also why the stop here
    /// uses the counted off-audio-thread route.
    pub fn reactivate_for_latency(&mut self) -> Result<u32, String> {
        let Some(processor) = self.processor.clone() else {
            return Ok(0);
        };

        if self.activated {
            self.force_stop_processing_off_audio_thread();
        }

        // SAFETY: exclusive control access; the component is live.
        unsafe {
            if self.activated {
                self.instance.component().setActive(0);
                self.activated = false;
            }

            let mut setup = self.process_setup();
            if processor.setupProcessing(&mut setup) != kResultOk {
                return Err(format!(
                    "[VST3] '{}' refused re-setup after a latency change",
                    self.instance.name()
                ));
            }

            if self.instance.component().setActive(1) != kResultOk {
                return Err(format!(
                    "[VST3] '{}' refused reactivation after a latency change",
                    self.instance.name()
                ));
            }
        }

        self.activated = true;
        self.processing.request_start();
        Ok(self.latency_samples())
    }

    /// Copy the block straight through, for every case where the plugin must not
    /// be handed it.
    fn pass_through(inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
        for (channel, out) in outputs.iter_mut().enumerate() {
            if channel >= inputs.len() {
                continue;
            }
            let len = num_samples.min(inputs[channel].len()).min(out.len());
            out[..len].copy_from_slice(&inputs[channel][..len]);
        }
    }

    /// Stage every parameter write the coming block should carry: first the
    /// edits the plugin's own editor made, then the host's, so a value the app
    /// just wrote wins over a stale gesture for the same parameter.
    ///
    /// RT-safe: drains into preallocated scratch and writes into preallocated
    /// queues.
    fn stage_parameter_updates(&mut self, parameter_updates: &[HostParameterUpdate]) {
        self.parameter_changes.reset();

        let drained = self
            .instance
            .host
            .state
            .drain_parameter_edits(self.gesture_scratch.as_mut_slice());
        for update in &self.gesture_scratch[..drained] {
            self.parameter_changes.stage(update.param_id, update.value);
        }
        for update in parameter_updates {
            self.parameter_changes.stage(update.param_id, update.value);
        }
    }

    fn stage_midi(&self, midi_events: &[(u8, u8, i16, bool)]) {
        self.event_list.reset();
        if !self.accepts_midi {
            // A plugin with no event input bus must not be handed events. This
            // is the point at which VST3 declines to inherit the "every plugin
            // accepts MIDI" answer the engine's slot gives for CLAP.
            return;
        }
        for (note, velocity, channel, is_on) in midi_events {
            self.event_list
                .push(note_event(*note, *velocity, *channel, *is_on));
        }
    }

    /// Hand one block to the plugin. **Audio thread only.**
    ///
    /// RT-safe: no allocation, no lock, no I/O. Everything it hands the plugin
    /// was allocated in `from_factory` and is refilled in place.
    fn process_block(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
        if !self.activated {
            Self::pass_through(inputs, outputs, num_samples);
            return;
        }

        // The audio thread is the only thread VST3 allows to enter or leave the
        // processing state, so this is where the control thread's intent lands.
        self.sync_processing_state();

        if !self.processing.is_processing() {
            Self::pass_through(inputs, outputs, num_samples);
            return;
        }

        let Some(processor) = self.processor.clone() else {
            Self::pass_through(inputs, outputs, num_samples);
            return;
        };

        let samples = num_samples.min(MAX_BUFFER);
        let channels = inputs.len().min(CHANNELS);

        for (channel, source) in inputs.iter().enumerate().take(channels) {
            let len = source.len().min(samples);
            self.input_scratch[channel][..len].copy_from_slice(&source[..len]);
            self.input_scratch[channel][len..samples].fill(0.0);
        }
        for channel in channels..CHANNELS {
            self.input_scratch[channel][..samples].fill(0.0);
        }
        self.output_scratch[0][..samples].fill(0.0);
        self.output_scratch[1][..samples].fill(0.0);

        // SAFETY: every pointer below addresses this wrapper's own preallocated
        // storage and is valid for the duration of the `process` call, which is
        // the only span VST3 lets a plugin read them for.
        unsafe {
            let mut in_ptrs: [*mut f32; CHANNELS] = [
                self.input_scratch[0].as_mut_ptr(),
                self.input_scratch[1].as_mut_ptr(),
            ];
            let mut out_ptrs: [*mut f32; CHANNELS] = [
                self.output_scratch[0].as_mut_ptr(),
                self.output_scratch[1].as_mut_ptr(),
            ];

            let mut input_bus = AudioBusBuffers {
                numChannels: CHANNELS as int32,
                silenceFlags: 0,
                __field0: AudioBusBuffers__type0 {
                    channelBuffers32: in_ptrs.as_mut_ptr(),
                },
            };
            let mut output_bus = AudioBusBuffers {
                numChannels: CHANNELS as int32,
                silenceFlags: 0,
                __field0: AudioBusBuffers__type0 {
                    channelBuffers32: out_ptrs.as_mut_ptr(),
                },
            };

            let mut data = ProcessData {
                processMode: ProcessModes_::kRealtime as int32,
                symbolicSampleSize: SymbolicSampleSizes_::kSample32 as int32,
                numSamples: samples as int32,
                numInputs: 1,
                numOutputs: 1,
                inputs: &mut input_bus,
                outputs: &mut output_bus,
                inputParameterChanges: if self.parameter_changes.is_empty() {
                    ptr::null_mut()
                } else {
                    borrowed_ptr::<_, IParameterChanges>(&self.parameter_changes)
                },
                outputParameterChanges: ptr::null_mut(),
                inputEvents: if self.event_list.is_empty() {
                    ptr::null_mut()
                } else {
                    borrowed_ptr::<_, IEventList>(&self.event_list)
                },
                outputEvents: ptr::null_mut(),
                // A null context tells the plugin the host has no timeline, so
                // it is only replaced once that stops being true.
                processContext: if self.has_transport {
                    self.process_context.as_mut() as *mut ProcessContext
                } else {
                    ptr::null_mut()
                },
            };

            processor.process(&mut data);
        }

        for (channel, out) in outputs.iter_mut().enumerate().take(channels) {
            let len = samples.min(out.len());
            out[..len].copy_from_slice(&self.output_scratch[channel][..len]);
        }
    }
}

impl Drop for Vst3Wrapper {
    /// Leave the processing and active states here, before `instance` drops and
    /// terminates the plugin. VST3 requires that order, and a component
    /// terminated while still active is a plugin asked to tear down state it
    /// believes is in use.
    fn drop(&mut self) {
        self.force_stop_processing_off_audio_thread();

        if !self.activated {
            return;
        }
        // SAFETY: the component is live and active until this call.
        unsafe {
            self.instance.component().setActive(0);
        }
        self.activated = false;
    }
}

impl AudioPlugin for Vst3Wrapper {
    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
        self.stage_parameter_updates(&[]);
        self.stage_midi(&[]);
        self.process_block(inputs, outputs, num_samples);
    }

    /// Write a parameter the way VST3 requires a host to: the controller is told
    /// so its editor and its value formatting agree, and the same write is queued
    /// for the processor, which never hears from the controller directly.
    fn set_parameter(&mut self, param_id: u32, value: f64) {
        if !value.is_finite() {
            return;
        }
        let clamped = value.clamp(0.0, 1.0);
        if let Some(controller) = self.instance.controller() {
            // SAFETY: control path only; the controller is live.
            unsafe {
                controller.setParamNormalized(param_id, clamped);
            }
        }
        self.instance
            .host
            .state
            .record_parameter_edit(param_id, clamped);
    }

    fn get_parameters(&self) -> Vec<PluginParameter> {
        self.instance
            .controller()
            .map(read_parameters)
            .unwrap_or_default()
    }

    fn get_state(&self) -> Vec<u8> {
        let component = read_chunk(|stream| {
            // SAFETY: control path only; the component is live.
            unsafe { self.instance.component().getState(stream) }
        });
        let controller = self
            .instance
            .controller()
            .filter(|_| !self.instance.controller_is_component)
            .map(|controller| {
                read_chunk(|stream| {
                    // SAFETY: control path only; the controller is live.
                    unsafe { controller.getState(stream) }
                })
            })
            .unwrap_or_default();
        encode_state(&component, &controller)
    }

    /// Restore both chunks in the order VST3 requires: the processor first, then
    /// the controller's *view* of that same processor state, then the
    /// controller's own editor state. Skipping `setComponentState` leaves an
    /// editor showing the values of the session before the load.
    fn set_state(&mut self, state: &[u8]) -> Result<(), String> {
        let (component, controller_chunk) = decode_state(state)?;

        write_chunk(&component, |stream| {
            // SAFETY: control path only; the component is live.
            unsafe { self.instance.component().setState(stream) }
        });

        let Some(controller) = self.instance.controller() else {
            return Ok(());
        };

        write_chunk(&component, |stream| {
            // SAFETY: control path only; the controller is live.
            unsafe { controller.setComponentState(stream) }
        });

        if !controller_chunk.is_empty() {
            write_chunk(&controller_chunk, |stream| {
                // SAFETY: control path only; the controller is live.
                unsafe { controller.setState(stream) }
            });
        }

        Ok(())
    }

    fn get_name(&self) -> &str {
        self.instance.name()
    }

    /// The plugin's own event bus declaration, not an assumption. A VST3 effect
    /// with no event input must not be handed note events.
    fn accepts_midi(&self) -> bool {
        self.accepts_midi
    }

    // The editor path is not implemented yet, so the trait's honest defaults —
    // no editor, nothing to open, nothing to close — are exactly what this
    // backend can truthfully say. Overriding them with a stub that returns a
    // size would claim an editor the host cannot embed.
}

impl HostedPluginRuntime for Vst3Wrapper {
    fn is_activated(&self) -> bool {
        self.activated
    }

    fn processing_gate(&self) -> Arc<ProcessingGate> {
        Arc::clone(&self.processing)
    }

    /// **Audio thread only** — the caller's thread affinity is what makes
    /// `setProcessing` legal.
    fn sync_processing_state(&mut self) {
        let wants = self.processing.wants_processing();
        if wants == self.processing.is_processing() {
            return;
        }

        let Some(processor) = &self.processor else {
            return;
        };

        // SAFETY: the processor is live and the component is active.
        unsafe {
            if wants {
                if processor.setProcessing(1) == kResultOk {
                    self.processing.mark_started();
                }
                return;
            }
            processor.setProcessing(0);
        }
        self.processing.mark_stopped();
    }

    fn set_transport(&mut self, transport: HostTransport) {
        fill_process_context(&mut self.process_context, transport, self.sample_rate);
        self.has_transport = true;
    }

    fn process_with_parameter_updates(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        parameter_updates: &[HostParameterUpdate],
    ) {
        self.stage_parameter_updates(parameter_updates);
        self.stage_midi(&[]);
        self.process_block(inputs, outputs, num_samples);
    }

    fn process_with_midi_and_parameters(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        midi_events: &[(u8, u8, i16, bool)],
        parameter_updates: &[HostParameterUpdate],
    ) {
        self.stage_parameter_updates(parameter_updates);
        self.stage_midi(midi_events);
        self.process_block(inputs, outputs, num_samples);
    }

    fn poll_latency_change(&mut self) -> Result<Option<u32>, String> {
        if !self.instance.host.state.take_latency_dirty() {
            return Ok(None);
        }

        let mut latency = self.reactivate_for_latency()?;

        // A flag raised *during* that cycle is ambiguous — the plugin may have
        // re-flagged from inside its own activation, or an independent
        // `restartComponent` may have landed — and only a further cycle can
        // report the latency of the second case. Re-querying wastes a cycle;
        // clearing blindly loses a change silently and for a long time.
        for _ in 1..MAX_LATENCY_REQUERY_PASSES {
            if !self.instance.host.state.take_latency_dirty() {
                return Ok(Some(latency));
            }
            latency = self.reactivate_for_latency()?;
        }

        if self.instance.host.state.take_latency_dirty() {
            eprintln!(
                "[VST3] '{}' re-flagged a latency change on all {} re-query passes; \
                 reporting the last value read and dropping the flag",
                self.instance.name(),
                MAX_LATENCY_REQUERY_PASSES
            );
        }
        Ok(Some(latency))
    }

    fn latency_ms(&self) -> f64 {
        if self.sample_rate <= 0.0 {
            return 0.0;
        }
        f64::from(self.latency_samples()) / self.sample_rate * 1000.0
    }

    fn latency_samples(&self) -> u32 {
        if !self.activated {
            return 0;
        }
        let Some(processor) = &self.processor else {
            return 0;
        };
        // SAFETY: control path only; the component is active, which is the only
        // state in which VST3 defines this value.
        unsafe { processor.getLatencySamples() }
    }
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

/// Parse a class CID as the scanner publishes it: 32 hex characters.
pub fn parse_class_id(descriptor_id: &str) -> Result<TUID, String> {
    let trimmed = descriptor_id.trim();
    if trimmed.len() != 32 || !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!(
            "'{descriptor_id}' is not a VST3 class id (expected 32 hexadecimal characters)"
        ));
    }
    let mut class_id: TUID = [0; 16];
    for (index, slot) in class_id.iter_mut().enumerate() {
        let byte = u8::from_str_radix(&trimmed[index * 2..index * 2 + 2], 16)
            .map_err(|error| format!("'{descriptor_id}' is not a VST3 class id: {error}"))?;
        *slot = byte as std::ffi::c_char;
    }
    Ok(class_id)
}

/// The bundle's own name, for a plugin whose factory lists no name for the class.
fn bundle_name(bundle_path: &Path) -> &str {
    bundle_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("VST3 Plugin")
}

/// Read a controller's parameter list in the seam's vocabulary.
///
/// VST3 parameters are always normalised to 0..1, so the range reported here is
/// the format's own rather than a rescaling this host invented. Hidden
/// parameters are omitted: the format marks them as not for a user to see, and a
/// generic editor that shows them is showing the plugin's internals.
///
/// Free function because the scanner reads the same list from an instance it
/// never activates.
pub fn read_parameters(controller: &ComPtr<IEditController>) -> Vec<PluginParameter> {
    // SAFETY: control path only; the controller is live and initialised.
    unsafe {
        let count = controller.getParameterCount();
        (0..count)
            .filter_map(|index| {
                let mut info: ParameterInfo = std::mem::zeroed();
                if controller.getParameterInfo(index, &mut info) != kResultOk {
                    return None;
                }
                if info.flags & ParameterFlags_::kIsHidden != 0 {
                    return None;
                }
                Some(PluginParameter {
                    id: info.id,
                    name: read_string128(&info.title),
                    value: controller.getParamNormalized(info.id),
                    default_value: info.defaultNormalizedValue,
                    min_value: 0.0,
                    max_value: 1.0,
                    unit: non_empty(read_string128(&info.units)),
                    is_automatable: info.flags & ParameterFlags_::kCanAutomate != 0
                        && info.flags & ParameterFlags_::kIsReadOnly == 0,
                })
            })
            .collect()
    }
}

/// Spell a class CID the way a saved project stores it.
pub fn format_class_id(class_id: &TUID) -> String {
    class_id
        .iter()
        .map(|byte| format!("{:02X}", *byte as u8))
        .collect()
}

/// The name the factory gives a class, when it lists one with this CID.
pub fn class_name(factory: &ComPtr<IPluginFactory>, class_id: &TUID) -> Option<String> {
    // SAFETY: the factory is live; each `info` is a valid out parameter.
    unsafe {
        let count = factory.countClasses();
        for index in 0..count {
            let mut info: vst3::Steinberg::PClassInfo = std::mem::zeroed();
            if factory.getClassInfo(index, &mut info) != kResultOk {
                continue;
            }
            if info.cid.iter().zip(class_id.iter()).all(|(a, b)| a == b) {
                return non_empty(read_char8(&info.name));
            }
        }
    }
    None
}

fn create_component(
    factory: &ComPtr<IPluginFactory>,
    class_id: &TUID,
    name: &str,
) -> Result<ComPtr<IComponent>, String> {
    // SAFETY: the factory is live; `object` is a valid out parameter and the
    // returned pointer is taken as an owning reference exactly once.
    unsafe {
        let mut object: *mut std::ffi::c_void = ptr::null_mut();
        let iid = crate::vst3_host::tuid_from_guid(&IComponent::IID);
        if factory.createInstance(class_id.as_ptr(), iid.as_ptr(), &mut object) != kResultOk {
            return Err(format!("[VST3] factory refused to create '{name}'"));
        }
        ComPtr::from_raw(object as *mut IComponent)
            .ok_or_else(|| format!("[VST3] factory returned no component for '{name}'"))
    }
}

fn create_controller(
    factory: &ComPtr<IPluginFactory>,
    class_id: &TUID,
    name: &str,
) -> Result<ComPtr<IEditController>, String> {
    // SAFETY: as `create_component`.
    unsafe {
        let mut object: *mut std::ffi::c_void = ptr::null_mut();
        let iid = crate::vst3_host::tuid_from_guid(&IEditController::IID);
        if factory.createInstance(class_id.as_ptr(), iid.as_ptr(), &mut object) != kResultOk {
            return Err(format!("[VST3] factory refused the controller of '{name}'"));
        }
        ComPtr::from_raw(object as *mut IEditController)
            .ok_or_else(|| format!("[VST3] factory returned no controller for '{name}'"))
    }
}

/// Activate bus zero of one media type and direction, when the component has
/// one. Bus zero is the main bus by VST3 convention, and a component with no bus
/// of that kind is not an error.
///
/// # Safety
/// `component` must be initialised and inactive.
unsafe fn activate_first_bus(component: &ComPtr<IComponent>, media: int32, direction: int32) {
    if component.getBusCount(media, direction) <= 0 {
        return;
    }
    component.activateBus(media, direction, 0, 1);
}

fn read_chunk(read: impl FnOnce(*mut IBStream) -> int32) -> Vec<u8> {
    let stream = ComWrapper::new(HostStream::empty());
    if read(borrowed_ptr::<_, IBStream>(&stream)) != kResultOk {
        return Vec::new();
    }
    stream.snapshot()
}

fn write_chunk(bytes: &[u8], write: impl FnOnce(*mut IBStream) -> int32) {
    let stream = ComWrapper::new(HostStream::over(bytes));
    write(borrowed_ptr::<_, IBStream>(&stream));
}

fn read_char8(value: &[std::ffi::c_char]) -> String {
    let bytes: Vec<u8> = value
        .iter()
        .take_while(|byte| **byte != 0)
        .map(|byte| *byte as u8)
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

fn non_empty(value: String) -> Option<String> {
    (!value.trim().is_empty()).then_some(value)
}

fn empty_process_context(sample_rate: f64) -> ProcessContext {
    // SAFETY: `ProcessContext` is plain `repr(C)` data; zero is a valid value
    // for every field, and `state` zero means "nothing below is valid".
    let mut context: ProcessContext = unsafe { std::mem::zeroed() };
    context.sampleRate = sample_rate;
    context
}

/// Refill the preallocated process context in place from the host timeline.
///
/// The `state` flags say which fields carry meaning, so a plugin does not read
/// an unset field as a real value — a zero tempo is the difference between "no
/// timeline" and "stopped at zero BPM".
fn fill_process_context(target: &mut ProcessContext, source: HostTransport, sample_rate: f64) {
    let mut state = StatesAndFlags_::kTempoValid
        | StatesAndFlags_::kTimeSigValid
        | StatesAndFlags_::kProjectTimeMusicValid;
    if source.is_playing {
        state |= StatesAndFlags_::kPlaying;
    }

    target.state = state as u32;
    target.sampleRate = sample_rate;
    target.projectTimeSamples = (source.song_pos_seconds * sample_rate) as i64;
    target.projectTimeMusic = source.song_pos_beats;
    target.tempo = source.tempo;
    target.timeSigNumerator = int32::from(source.time_sig_num);
    target.timeSigDenominator = int32::from(source.time_sig_denom);
    // Bar position, cycle and SMPTE are not modelled by the host yet; their
    // flags are deliberately absent above so these read as unknown rather than
    // as a loop from bar zero to bar zero.
    target.barPositionMusic = 0.0;
    target.cycleStartMusic = 0.0;
    target.cycleEndMusic = 0.0;
}

#[cfg(test)]
mod tests;
