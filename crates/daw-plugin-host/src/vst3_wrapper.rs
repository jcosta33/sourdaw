//! Hosting one VST3 plugin instance behind the format-neutral seam.
//!
//! Flow: open the module → `IPluginFactory::createInstance` for the class the
//! descriptor names → `IComponent::initialize` → find or create the paired
//! `IEditController` → connect them → `setupProcessing` → `setActive(true)` →
//! `setProcessing(true)` on the processing thread → `IAudioProcessor::process`.
//! The processing thread is the audio thread, or an offline instance's render
//! thread. Two control-path exceptions, each made under the exclusive access
//! seam so no processing thread is inside the plugin: a forced stop before a
//! lifecycle call, and the zero-sample parameter flush of an idle instance,
//! which enters and leaves the processing state around its one `process`.
//!
//! RT-safety: every buffer, parameter queue, bus array and event the processing
//! thread hands the plugin is allocated while activating — including the
//! per-bus storage the negotiated layout sizes — and refilled in place.
//! `process` takes no lock, allocates nothing, and performs no I/O.

use crate::output_notes::OutputNoteQueue;
use crate::parameter_events::PluginParameterEventQueue;
use crate::params::PluginParameter;
use crate::traits::{
    signal_pending_process_refusal, AudioPlugin, EditorWindowResizer, HostMidiEvent,
    HostParameterUpdate, HostTransport, HostedPluginRuntime, LatencyChangeNotifier, PluginError,
    PluginHostRequestNotifier, ProcessMode, ProcessingGate, DEFAULT_EDITOR_CONTENT_SCALE,
    MAX_MIDI_EVENTS_PER_BLOCK,
};
use crate::vst3_bus_layout::{
    activate_main_audio_bus, negotiate_bus_layout, silent_channel_flags, BusGeometry, BusLayout,
    BusLayoutError, HOST_CHANNELS,
};
use crate::vst3_class_id::{same_class_id, ClassIdError};
use crate::vst3_editor::{
    plugin_offers_an_editor, EditorError, EditorSession, EditorSize, Vst3Editor,
};
use crate::vst3_host::{
    read_string128, MessageTarget, Vst3HostContext, Vst3HostState, COMPONENT_RESTART_FLAGS,
    MAX_PARAMETER_GESTURES,
};
use crate::vst3_module::{ModuleError, Vst3Module};
use crate::vst3_scanner::{category_from_vst3_sub_categories, split_sub_categories};
use std::cell::Cell;
use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::{Arc, Mutex, OnceLock};
use vst3::Steinberg::Vst::{
    AudioBusBuffers, BusDirections_, Event, Event_::EventTypes_, Event__type0, IAudioProcessor,
    IAudioProcessorTrait, IComponent, IComponentTrait, IConnectionPoint, IConnectionPointTrait,
    IEditController, IEditControllerTrait, IEventList, IEventListTrait, IMessage, IParamValueQueue,
    IParamValueQueueTrait, IParameterChanges, IParameterChangesTrait, MediaTypes_, NoteOffEvent,
    NoteOnEvent, ParamID, ParamValue, ParameterInfo, ParameterInfo_::ParameterFlags_,
    ProcessContext, ProcessContext_::StatesAndFlags_, ProcessData, ProcessModes_, ProcessSetup,
    RestartFlags_, SymbolicSampleSizes_,
};
use vst3::Steinberg::{
    int32, int64, kInvalidArgument, kNotImplemented, kOutOfMemory, kResultFalse, kResultOk,
    tresult, IBStream, IBStreamTrait, IBStream_::IStreamSeekMode_, IPluginBaseTrait,
    IPluginFactory, IPluginFactory2, IPluginFactory2Trait, IPluginFactoryTrait, TUID,
};
use vst3::{Class, ComPtr, ComRef, ComWrapper, Interface};

pub use crate::vst3_class_id::{format_class_id, parse_class_id};

/// Largest block this host hands a plugin, and the `maxSamplesPerBlock` every
/// instance is set up with. One figure for both wrapper formats, owned by the
/// CLAP wrapper's declaration.
use crate::clap_wrapper::MAX_BUFFER;
/// Channels the seam carries, and therefore the scratch a main bus is mapped
/// onto. The negotiated bus layout decides how many of them a given plugin
/// actually reads or writes.
const CHANNELS: usize = HOST_CHANNELS;
/// Distinct parameters whose value can reach a plugin in one block.
const MAX_PARAMETER_QUEUES: usize = 64;
/// How many deactivate/reactivate/re-query passes one `poll_latency_change`
/// makes before it stops chasing a plugin that re-flags from inside its own
/// activation. Mirrors the CLAP backend's cap for the same reason.
const MAX_LATENCY_REQUERY_PASSES: u32 = 4;
/// How many reactivation cycles one `apply_component_restart` runs before it
/// stops chasing a plugin that asks for another from inside the last one.
/// Bounded for the reason `MAX_LATENCY_REQUERY_PASSES` is.
const MAX_COMPONENT_RESTART_PASSES: u32 = 4;
/// Consecutive blocks in which a refused `setProcessing(1)` is retried before
/// the slot settles on passing audio through.
///
/// A plugin that will not enter the processing state is not going to change its
/// mind on the next buffer, and asking it 47 000 times a minute is a call into
/// third-party code on the audio thread for an answer already given. Bounded
/// for the same reason `MAX_LATENCY_REQUERY_PASSES` is.
const MAX_PROCESSING_START_REFUSALS: u32 = 8;
/// The most bytes a plugin may write into one host state stream.
///
/// `write` is reached from third-party code across the COM boundary and its
/// length argument is the plugin's own, so it is untrusted: with no ceiling a
/// plugin that reports a nonsense length turns a preset save into an
/// out-of-memory abort of the whole application. 256 MiB is orders of magnitude
/// above any real plugin state and still far below what refusing would cost a
/// legitimate one.
const MAX_STREAM_BYTES: usize = 256 * 1024 * 1024;

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
        // SAFETY: non-null (checked above); `IParamValueQueue::getPoint` gives
        // the plugin's own writable out-parameter, live for this call.
        unsafe { *sample_offset = 0 };
        // SAFETY: non-null (checked above); the plugin's own out-parameter.
        unsafe { *value = self.value.get() };
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
            // SAFETY: non-null (checked above); `addPoint`'s `index` is the
            // plugin's own writable out-parameter, live for this call.
            unsafe { *index = 0 };
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
        let queue = &self.queues[position];
        queue.value.set(value);
        queue.filled.set(true);
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
        // A queue claimed by the plugin through `addParameterData` holds no
        // value until it adds a point; one the host stages is filled at once.
        queue.filled.set(false);
        self.used.set(used + 1);
        Some(used)
    }

    fn is_empty(&self) -> bool {
        self.used.get() == 0
    }

    /// Every value the list holds, as `(parameter, value)`: what the host
    /// staged for the coming block, or what the plugin reported in an output
    /// list. A queue the plugin claimed and never added a point to holds none.
    fn staged(&self) -> impl Iterator<Item = (ParamID, ParamValue)> + '_ {
        self.queues[..self.used.get()]
            .iter()
            .filter(|queue| queue.filled.get())
            .map(|queue| (queue.param_id.get(), queue.value.get()))
    }

    /// Whether the list carries a value for `param_id`. RT-safe: a linear scan
    /// of at most `MAX_PARAMETER_QUEUES` entries.
    fn carries(&self, param_id: ParamID) -> bool {
        self.staged().any(|(staged, _)| staged == param_id)
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
        // SAFETY: non-null (checked above); `addParameterData`'s `id` points at
        // the plugin's `ParamID`, live for this call.
        let Some(position) = self.queue_index_for(unsafe { *id }) else {
            return ptr::null_mut();
        };
        if !index.is_null() {
            // SAFETY: non-null (checked above); the plugin's own writable
            // out-parameter, live for this call.
            unsafe { *index = position as int32 };
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
    events: Cell<[Event; MAX_MIDI_EVENTS_PER_BLOCK]>,
    count: Cell<usize>,
}

impl HostEventList {
    fn new() -> Self {
        Self {
            events: Cell::new([empty_event(); MAX_MIDI_EVENTS_PER_BLOCK]),
            count: Cell::new(0),
        }
    }

    fn reset(&self) {
        self.count.set(0);
    }

    /// Append one note event. RT-safe.
    ///
    /// The list holds [`MAX_MIDI_EVENTS_PER_BLOCK`], the most the seam hands
    /// over in one call, so the bound never cuts a caller's events: it only
    /// stops a caller breaking that contract from writing past the array.
    fn push(&self, event: Event) {
        let count = self.count.get();
        if count == MAX_MIDI_EVENTS_PER_BLOCK {
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
        // SAFETY: `Cell::as_ptr` yields the live array and `index` is below the
        // pushed count; nothing writes the list during the `process` reading it.
        let event = unsafe { (*self.events.as_ptr())[index as usize] };
        // SAFETY: non-null (checked above); `getEvent`'s `e` is the plugin's own
        // writable out-parameter, live for this call.
        unsafe { *e = event };
        kResultOk
    }

    unsafe fn addEvent(&self, _e: *mut Event) -> int32 {
        // Output events are absorbed: the seam has nowhere to route a plugin's
        // generated MIDI yet, and accepting it silently would claim otherwise.
        kInvalidArgument
    }
}

/// The `outputEvents` list one block hands the plugin.
///
/// Write-only from the plugin's side: each note it adds goes straight into the
/// instance's [`OutputNoteQueue`], which is wait-free, so nothing is buffered
/// here and nothing here allocates.
struct HostOutputEventList {
    notes: Arc<OutputNoteQueue>,
}

impl Class for HostOutputEventList {
    type Interfaces = (IEventList,);
}

impl IEventListTrait for HostOutputEventList {
    unsafe fn getEventCount(&self) -> int32 {
        0
    }

    unsafe fn getEvent(&self, _index: int32, _e: *mut Event) -> int32 {
        kInvalidArgument
    }

    /// Capture a note the plugin produced. Any other event type is accepted
    /// and not kept: the seam carries notes, and refusing the rest would tell
    /// the plugin its output failed. A full queue refuses the note, and the
    /// queue counts it.
    unsafe fn addEvent(&self, e: *mut Event) -> int32 {
        if e.is_null() {
            return kInvalidArgument;
        }
        // SAFETY: non-null (checked above); `addEvent`'s `e` points at the
        // plugin's event, live for this call.
        let event = unsafe { &*e };
        let Some(note) = output_note(event) else {
            return kResultOk;
        };
        if self.notes.push(note) {
            kResultOk
        } else {
            kResultFalse
        }
    }
}

/// The note one output event carries, or `None` for an event that is not one.
fn output_note(event: &Event) -> Option<HostMidiEvent> {
    let frame_offset = u32::try_from(event.sampleOffset).unwrap_or(0);
    if event.r#type == EventTypes_::kNoteOnEvent as u16 {
        // SAFETY: the type tag names the `noteOn` arm of the payload union.
        let on = unsafe { event.__field0.noteOn };
        return Some(HostMidiEvent {
            note: midi_byte(on.pitch),
            velocity: midi_velocity(on.velocity),
            channel: on.channel,
            is_note_on: true,
            frame_offset,
        });
    }
    if event.r#type == EventTypes_::kNoteOffEvent as u16 {
        // SAFETY: the type tag names the `noteOff` arm of the payload union.
        let off = unsafe { event.__field0.noteOff };
        return Some(HostMidiEvent {
            note: midi_byte(off.pitch),
            velocity: midi_velocity(off.velocity),
            channel: off.channel,
            is_note_on: false,
            frame_offset,
        });
    }
    None
}

/// A VST3 pitch as a MIDI note number, clamped to the 0..=127 range.
fn midi_byte(pitch: i16) -> u8 {
    pitch.clamp(0, 127) as u8
}

/// A normalised VST3 velocity as a MIDI velocity, the inverse of
/// [`note_event`]'s `velocity / 127`.
fn midi_velocity(velocity: f32) -> u8 {
    (velocity.clamp(0.0, 1.0) * 127.0).round() as u8
}

fn empty_event() -> Event {
    // SAFETY: `Event` is a plain `repr(C)` POD whose payload is a union; zero is
    // a valid bit pattern for every arm.
    unsafe { std::mem::zeroed() }
}

/// Build the VST3 event for one host note.
///
/// `sampleOffset` carries the event's `frame_offset`, which is what sounds a
/// note on the sample it was written on rather than at the head of whichever
/// block carried it.
fn note_event(source: HostMidiEvent) -> Event {
    let mut event = empty_event();
    event.busIndex = 0;
    event.sampleOffset = source.frame_offset as i32;
    event.ppqPosition = 0.0;
    event.flags = 0;
    let normalised_velocity = f32::from(source.velocity) / 127.0;
    if source.is_note_on {
        event.r#type = EventTypes_::kNoteOnEvent as u16;
        event.__field0 = Event__type0 {
            noteOn: NoteOnEvent {
                channel: source.channel,
                pitch: i16::from(source.note),
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
            channel: source.channel,
            pitch: i16::from(source.note),
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
///
/// Every argument these methods take is a plugin's, arriving across the COM
/// boundary where a Rust panic is undefined behaviour rather than an unwind. So
/// no method here indexes, adds or allocates on an unchecked plugin-supplied
/// value: an out-of-range position reads nothing, and an impossible length is
/// refused with a result code the plugin is required to handle.
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
        // Past the end reads nothing. Slicing first would index out of range,
        // and a panic here unwinds into the plugin's frame.
        let Some(remaining) = cursor.bytes.get(cursor.position..) else {
            if !num_bytes_read.is_null() {
                // SAFETY: non-null (checked); `IBStream::read`'s out-parameter
                // is the plugin's writable `int32`, live for this call.
                unsafe { *num_bytes_read = 0 };
            }
            return kResultOk;
        };
        let count = remaining.len().min(num_bytes as usize);
        // SAFETY: `IBStream::read` gives a non-null (checked) plugin buffer of at
        // least `num_bytes` bytes; `count` is at most that and at most what
        // `remaining` holds, and the plugin's buffer cannot alias this `Vec`.
        unsafe { ptr::copy_nonoverlapping(remaining.as_ptr(), buffer as *mut u8, count) };
        cursor.position += count;
        if !num_bytes_read.is_null() {
            // SAFETY: non-null (checked); the plugin's own writable out-parameter.
            unsafe { *num_bytes_read = count as int32 };
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
        // An unchecked `position + count` wraps in release, which turns the
        // `resize` below into a no-op and the copy into a heap overflow.
        let Some(end) = cursor.position.checked_add(count) else {
            return kOutOfMemory;
        };
        if end > MAX_STREAM_BYTES {
            return kOutOfMemory;
        }
        if cursor.bytes.len() < end {
            cursor.bytes.resize(end, 0);
        }
        let start = cursor.position;
        // SAFETY: `IBStream::write` gives a non-null (checked) plugin buffer of
        // `num_bytes` readable bytes; the destination was resized to at least
        // `start + count` above, and the plugin's buffer cannot alias this `Vec`.
        unsafe {
            ptr::copy_nonoverlapping(
                buffer as *const u8,
                cursor.bytes[start..].as_mut_ptr(),
                count,
            )
        };
        cursor.position = end;
        if !num_bytes_written.is_null() {
            // SAFETY: non-null (checked); the plugin's own writable out-parameter.
            unsafe { *num_bytes_written = count as int32 };
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
        // Clamped to the end, as the SDK's own `MemoryStream` clamps: a cursor
        // parked past the buffer is a read or a write addressed at memory this
        // stream never has.
        let clamped = (target as u64).min(cursor.bytes.len() as u64) as usize;
        cursor.position = clamped;
        if !result.is_null() {
            // SAFETY: non-null (checked); `seek`'s `result` is the plugin's own
            // writable out-parameter, live for this call.
            unsafe { *result = clamped as int64 };
        }
        kResultOk
    }

    unsafe fn tell(&self, pos: *mut int64) -> int32 {
        let Ok(cursor) = self.inner.lock() else {
            return kInvalidArgument;
        };
        if !pos.is_null() {
            // SAFETY: non-null (checked); `tell`'s `pos` is the plugin's own
            // writable out-parameter, live for this call.
            unsafe { *pos = cursor.position as int64 };
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

/// Why a VST3 instance could not be opened, activated, saved, restored, or
/// driven through its editor.
///
/// Every variant is built on the control path. The process path reports a
/// refusal through flags and never builds one of these.
#[derive(Debug)]
pub enum Vst3Error {
    /// The stored blob is shorter than its header.
    StateTooShort,
    /// The stored blob does not carry this host's magic.
    StateForeign,
    /// The stored blob was written by a newer state version.
    StateNewerVersion { version: u16 },
    /// The header's lengths overflow.
    StateImpossibleLength,
    /// The blob is shorter than its header declares.
    StateTruncated,
    /// The descriptor id is not a class id.
    ClassId(ClassIdError),
    /// The bundle's module could not be opened.
    Module(ModuleError),
    /// The bundle's factory lists no class with the descriptor's id.
    ClassNotImplemented {
        bundle: PathBuf,
        descriptor_id: String,
    },
    /// `initialize` refused the host context.
    InitializeRefused { name: String },
    /// `createInstance` refused the component.
    FactoryRefusedComponent { name: String },
    /// `createInstance` succeeded with no component.
    NoComponent { name: String },
    /// `createInstance` refused the controller.
    FactoryRefusedController { name: String },
    /// `createInstance` succeeded with no controller.
    NoController { name: String },
    /// The component exposes no `IAudioProcessor`.
    NoAudioProcessor { name: String },
    /// No bus layout the host can feed was agreed.
    BusLayout(BusLayoutError),
    /// `setupProcessing` refused the host's setup.
    ProcessingSetupRefused { name: String },
    /// `setActive(1)` refused.
    ActivateRefused { name: String },
    /// An editor is already open on this instance.
    EditorAlreadyOpen { name: String },
    /// The instance has no edit controller.
    NoEditController { name: String },
    /// The editor refused to open, re-scale or resize.
    Editor(EditorError),
    /// A host-initiated editor operation found no open editor.
    NoOpenEditor { name: String },
    /// `setupProcessing` refused after a latency change.
    LatencyResetupRefused { name: String },
    /// `setActive(1)` refused after a latency change.
    LatencyReactivationRefused { name: String },
    /// The component would not write its state.
    ProcessorStateUnreported { name: String },
    /// The component refused the stored state.
    ProcessorStateRefused { name: String },
}

impl std::fmt::Display for Vst3Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::StateTooShort => f.write_str("VST3 state is too short to carry its own header"),
            Self::StateForeign => f.write_str("VST3 state was not written by this host"),
            Self::StateNewerVersion { version } => write!(
                f,
                "VST3 state version {version} was written by a newer host and cannot be read"
            ),
            Self::StateImpossibleLength => {
                f.write_str("VST3 state declares more bytes than can exist")
            }
            Self::StateTruncated => {
                f.write_str("VST3 state is shorter than its own header declares")
            }
            Self::ClassId(error) => write!(f, "{error}"),
            Self::Module(error) => write!(f, "{error}"),
            Self::ClassNotImplemented {
                bundle,
                descriptor_id,
            } => write!(
                f,
                "[VST3] '{}' does not implement class {descriptor_id}; its own factory lists no \
                 such class",
                bundle.display()
            ),
            Self::InitializeRefused { name } => write!(f, "[VST3] '{name}' refused to initialize"),
            Self::FactoryRefusedComponent { name } => {
                write!(f, "[VST3] factory refused to create '{name}'")
            }
            Self::NoComponent { name } => {
                write!(f, "[VST3] factory returned no component for '{name}'")
            }
            Self::FactoryRefusedController { name } => {
                write!(f, "[VST3] factory refused the controller of '{name}'")
            }
            Self::NoController { name } => {
                write!(f, "[VST3] factory returned no controller for '{name}'")
            }
            Self::NoAudioProcessor { name } => {
                write!(f, "[VST3] '{name}' exposes no audio processor")
            }
            Self::BusLayout(error) => write!(f, "{error}"),
            Self::ProcessingSetupRefused { name } => {
                write!(f, "[VST3] '{name}' refused the host's processing setup")
            }
            Self::ActivateRefused { name } => write!(f, "[VST3] '{name}' refused to activate"),
            Self::EditorAlreadyOpen { name } => {
                write!(f, "[VST3] '{name}' already has an open editor")
            }
            Self::NoEditController { name } => write!(
                f,
                "[VST3] '{name}' has no edit controller, and so no editor"
            ),
            Self::Editor(error) => write!(f, "{error}"),
            Self::NoOpenEditor { name } => {
                write!(f, "[VST3] '{name}' has no open editor to address")
            }
            Self::LatencyResetupRefused { name } => {
                write!(f, "[VST3] '{name}' refused re-setup after a latency change")
            }
            Self::LatencyReactivationRefused { name } => write!(
                f,
                "[VST3] '{name}' refused reactivation after a latency change"
            ),
            Self::ProcessorStateUnreported { name } => {
                write!(f, "[VST3] '{name}' refused to report its processor state")
            }
            Self::ProcessorStateRefused { name } => write!(
                f,
                "[VST3] '{name}' refused the processor state saved in this project"
            ),
        }
    }
}

impl std::error::Error for Vst3Error {}

impl From<ClassIdError> for Vst3Error {
    fn from(error: ClassIdError) -> Self {
        Self::ClassId(error)
    }
}

impl From<ModuleError> for Vst3Error {
    fn from(error: ModuleError) -> Self {
        Self::Module(error)
    }
}

impl From<BusLayoutError> for Vst3Error {
    fn from(error: BusLayoutError) -> Self {
        Self::BusLayout(error)
    }
}

impl From<EditorError> for Vst3Error {
    fn from(error: EditorError) -> Self {
        Self::Editor(error)
    }
}

/// Split a stored blob back into the two chunks, refusing anything this host did
/// not write.
pub fn decode_state(encoded: &[u8]) -> Result<(Vec<u8>, Vec<u8>), Vst3Error> {
    if encoded.len() < STATE_HEADER_BYTES {
        return Err(Vst3Error::StateTooShort);
    }
    if &encoded[..4] != STATE_MAGIC {
        return Err(Vst3Error::StateForeign);
    }
    let version = u16::from_le_bytes([encoded[4], encoded[5]]);
    if version != STATE_VERSION {
        return Err(Vst3Error::StateNewerVersion { version });
    }
    let component_len =
        u32::from_le_bytes([encoded[6], encoded[7], encoded[8], encoded[9]]) as usize;
    let controller_len =
        u32::from_le_bytes([encoded[10], encoded[11], encoded[12], encoded[13]]) as usize;
    let expected = STATE_HEADER_BYTES
        .checked_add(component_len)
        .and_then(|total| total.checked_add(controller_len))
        .ok_or(Vst3Error::StateImpossibleLength)?;
    if encoded.len() < expected {
        return Err(Vst3Error::StateTruncated);
    }
    let component_end = STATE_HEADER_BYTES + component_len;
    Ok((
        encoded[STATE_HEADER_BYTES..component_end].to_vec(),
        encoded[component_end..component_end + controller_len].to_vec(),
    ))
}

// ---------------------------------------------------------------------------
// Host-owned connection proxies
// ---------------------------------------------------------------------------

/// The host object one half of a split plugin is connected to.
///
/// VST3 delivers an `IMessage` by calling `notify` on the peer's connection
/// point, which runs the peer's code on whichever thread raised the message. A
/// processor reporting a meter level from inside `process` would therefore run
/// controller code on the audio thread. The host takes that decision instead:
/// every message is parked here with the half it is bound for, and the control
/// path delivers it.
struct Vst3ConnectionProxy {
    state: Arc<Vst3HostState>,
    /// The half a message arriving here is bound for — the *peer* of whichever
    /// half was handed this proxy.
    peer: MessageTarget,
}

impl Class for Vst3ConnectionProxy {
    type Interfaces = (IConnectionPoint,);
}

impl IConnectionPointTrait for Vst3ConnectionProxy {
    /// The host connected both ends itself, so a plugin connecting back tells
    /// this proxy nothing it does not already hold.
    unsafe fn connect(&self, other: *mut IConnectionPoint) -> tresult {
        if other.is_null() {
            return kInvalidArgument;
        }
        kResultOk
    }

    unsafe fn disconnect(&self, _other: *mut IConnectionPoint) -> tresult {
        kResultOk
    }

    unsafe fn notify(&self, message: *mut IMessage) -> tresult {
        // SAFETY: `IConnectionPoint::notify` passes null, which `from_raw` maps to
        // `None`, or a message the plugin keeps alive for this call; it is
        // retained before the call returns.
        let Some(message) = (unsafe { ComRef::from_raw(message) }) else {
            return kInvalidArgument;
        };
        if self.state.defer_message(self.peer, message.to_com_ptr()) {
            return kResultOk;
        }
        // The deferral buffer is full. Reported rather than swallowed: a half
        // that believes it told the other something it never did is a bug with
        // no symptom of its own.
        kResultFalse
    }
}

/// The pair of proxies one split plugin is wired through.
struct ConnectionProxyPair {
    /// Handed to the component; anything arriving is bound for the controller.
    for_component: ComPtr<IConnectionPoint>,
    /// Handed to the controller; anything arriving is bound for the component.
    for_controller: ComPtr<IConnectionPoint>,
}

impl ConnectionProxyPair {
    fn new(state: Arc<Vst3HostState>) -> Option<Self> {
        Some(Self {
            for_component: ComWrapper::new(Vst3ConnectionProxy {
                state: Arc::clone(&state),
                peer: MessageTarget::Controller,
            })
            .to_com_ptr()?,
            for_controller: ComWrapper::new(Vst3ConnectionProxy {
                state,
                peer: MessageTarget::Component,
            })
            .to_com_ptr()?,
        })
    }
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
    /// The host objects the plugin's two halves are connected to instead of to
    /// each other. Declared after the plugin's own objects so they are released
    /// only once nothing can call back into them.
    proxies: Option<ConnectionProxyPair>,
    host: Vst3HostContext,
    /// Kept alive for the instance's whole life. `None` only for a factory built
    /// in-process by a test.
    _module: Option<Arc<Vst3Module>>,
    name: String,
    /// Whether the factory calls this class an instrument. Read once here,
    /// because the factory is only in hand while the instance is being created
    /// and the audio thread may not walk a class list.
    is_instrument: bool,
}

// SAFETY: the fields are COM pointers this struct owns (released in `Drop`),
// the host context and the module `Arc`. VST3 binds lifecycle calls to the
// host's main thread, which this type does not enforce: it holds because the
// embedding host constructs and drops every instance on its UI thread and
// otherwise reaches it only through its owner's exclusive access seam.
unsafe impl Send for Vst3Instance {}
// SAFETY: `&self` methods call into the plugin (`accepts_midi`, the state and
// connection calls), so shared access from two threads at once is not sound
// from this type alone. It holds because its only holders — a `Vst3Wrapper`
// behind the embedding host's access seam, or the scanner on its own thread —
// never share one across threads concurrently.
unsafe impl Sync for Vst3Instance {}

impl Vst3Instance {
    /// Open a bundle and instantiate the class the descriptor names, without
    /// activating it.
    ///
    /// `descriptor_id` is the class CID as 32 hex characters, which is what the
    /// scanner publishes and what a saved project stores.
    pub fn open(bundle_path: &Path, descriptor_id: &str) -> Result<Self, Vst3Error> {
        let class_id = parse_class_id(descriptor_id)?;
        let host = Vst3HostContext::new();
        let module = Vst3Module::open(bundle_path)?;

        // The factory is the only authority on which classes a bundle carries.
        // A bundle's `moduleinfo.json` is an unsigned side-car file, so a CID
        // read from it may name a class this binary does not implement — or one
        // that belongs to somebody else's plugin, which is how an early-ranked
        // copy evicts the genuine registration of the plugin it names.
        if !factory_declares_class(module.factory(), &class_id) {
            return Err(Vst3Error::ClassNotImplemented {
                bundle: bundle_path.to_path_buf(),
                descriptor_id: descriptor_id.to_string(),
            });
        }

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
    ) -> Result<Self, Vst3Error> {
        let component = create_component(factory, class_id, name)?;

        // SAFETY: `component` was just created by the factory and has not been
        // initialised. A failed `initialize` is released without `terminate` —
        // the plugin never reached the state `terminate` undoes.
        unsafe {
            if component.initialize(host.as_unknown()) != kResultOk {
                return Err(Vst3Error::InitializeRefused {
                    name: name.to_string(),
                });
            }
        }

        let mut instance = Self {
            controller_connection: None,
            component_connection: None,
            controller: None,
            component,
            controller_is_component: false,
            proxies: None,
            host,
            _module: module,
            name: name.to_string(),
            is_instrument: class_is_instrument(factory, class_id),
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

    /// Whether the factory calls this class an instrument, as read at creation.
    pub fn is_instrument(&self) -> bool {
        self.is_instrument
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
        self.show_controller_the_processor_state();
    }

    /// Hand the controller the processor's current state, once, at
    /// instantiation.
    ///
    /// The SDK's own host does this immediately after connecting the two halves,
    /// and for a split plugin it is the only thing that agrees them: the
    /// controller boots on its parameter defaults, while the component boots on
    /// whatever state it restored or was built with. Skipping it opens the
    /// editor on values the processor is not using.
    ///
    /// A combined class already is the component, so there is nothing to carry
    /// across and asking it to read its own state back is work with no effect.
    fn show_controller_the_processor_state(&self) {
        if self.controller_is_component {
            return;
        }
        let Some(controller) = &self.controller else {
            return;
        };
        // SAFETY: control path only; both objects are live and initialised.
        let Some(processor_state) = read_chunk(|stream| unsafe { self.component.getState(stream) })
        else {
            return;
        };
        // SAFETY: control path only; the controller is live and initialised, and
        // `stream` is the host stream `write_chunk` keeps alive for the call.
        write_chunk(&processor_state, |stream| unsafe {
            controller.setComponentState(stream)
        });
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

    /// Put the host between the component's and the controller's connection
    /// points.
    ///
    /// A split plugin talks to itself across this pair, and a plugin whose
    /// halves are never connected loses every processor-to-editor update — the
    /// classic symptom being an editor whose meters never move. Connecting them
    /// to *each other* is the other failure: `notify` then runs the peer's code
    /// on whichever thread raised the message, and a processor that reports a
    /// meter level from inside `process` would run controller code on the audio
    /// thread.
    ///
    /// So each half is connected to a host object that owns the delivery
    /// decision instead, which is what the SDK's own connection proxy exists
    /// for. Every message is parked and handed on by
    /// [`Vst3Wrapper::deliver_deferred_messages`]: the host cannot tell which
    /// thread a plugin called from, and parking costs one control-path hop
    /// where guessing costs the audio thread.
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
        let Some(proxies) = ConnectionProxyPair::new(Arc::clone(&self.host.state)) else {
            return;
        };

        // SAFETY: `component_point` is a live reference on the component this
        // instance owns, and the proxy outlives it (field order).
        unsafe { component_point.connect(proxies.for_component.as_ptr()) };
        // SAFETY: `controller_point` is a live reference on the controller this
        // instance owns, and the proxy outlives it (field order).
        unsafe { controller_point.connect(proxies.for_controller.as_ptr()) };
        self.component_connection = Some(component_point);
        self.controller_connection = Some(controller_point);
        self.proxies = Some(proxies);
    }
}

impl Drop for Vst3Instance {
    fn drop(&mut self) {
        // The order below is the reverse of construction, which is what VST3
        // requires; every object is live until the fields drop after this body.
        if let Some(proxies) = &self.proxies {
            if let Some(component_point) = self.component_connection.as_ref() {
                // SAFETY: the component's connection point is retained by this
                // field, and the proxy it was connected to is still alive.
                unsafe { component_point.disconnect(proxies.for_component.as_ptr()) };
            }
            if let Some(controller_point) = self.controller_connection.as_ref() {
                // SAFETY: the controller's connection point is retained by this
                // field, and the proxy it was connected to is still alive.
                unsafe { controller_point.disconnect(proxies.for_controller.as_ptr()) };
            }
        }

        if let Some(controller) = &self.controller {
            // SAFETY: the controller is retained by this field; null is how VST3
            // clears the handler so the plugin stops calling back into it.
            unsafe { controller.setComponentHandler(ptr::null_mut()) };
            if !self.controller_is_component {
                // SAFETY: a separate controller is initialised only once, in
                // `attach_controller`, and this is its one matching `terminate`.
                unsafe { controller.terminate() };
            }
        }
        // SAFETY: `create` stores the component only after `initialize`
        // succeeded, and this is its one matching `terminate`.
        unsafe { self.component.terminate() };
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
    /// The open editor, if one is. First field because it holds objects the
    /// plugin's controller created, and those must be released before `instance`
    /// terminates the plugin that owns them.
    editor: Option<Vst3Editor>,
    processor: Option<ComPtr<IAudioProcessor>>,
    instance: Vst3Instance,

    /// Whether the plugin offers an editor, as answered once by its own
    /// `createView`. Cached because that answer costs a real view creation and
    /// the question is asked on every editor open, every capability report and
    /// every close.
    has_editor: OnceLock<bool>,
    /// How the host resizes the window an editor is drawn into, once it has told
    /// the backend. Held here rather than in the editor because it is installed
    /// before the editor exists.
    editor_window: Option<EditorWindowResizer>,
    /// The display scale the host window an editor will be parented into runs
    /// at, as the shell measured it. Held here for the same reason the resizer
    /// is: it is stated before the editor exists.
    editor_scale: f64,

    descriptor_id: String,
    sample_rate: f64,
    /// The `ProcessModes_` value this instance was built with, stated in every
    /// `setupProcessing` and every `ProcessData`. Held as the format's own
    /// value so a block reads a field rather than converting one.
    process_mode: int32,
    activated: bool,
    accepts_midi: bool,
    processing: Arc<ProcessingGate>,

    /// Preallocated audio scratch. The plugin is handed pointers into these.
    input_scratch: Box<[[f32; MAX_BUFFER]; CHANNELS]>,
    output_scratch: Box<[[f32; MAX_BUFFER]; CHANNELS]>,
    parameter_changes: ComWrapper<HostParameterChanges>,
    event_list: ComWrapper<HostEventList>,
    /// The `outputParameterChanges` list: what the processor reports back.
    output_parameter_changes: ComWrapper<HostParameterChanges>,
    output_events: ComWrapper<HostOutputEventList>,
    /// The notes the plugin produced, for the control path to drain.
    output_notes: Arc<OutputNoteQueue>,
    /// The plugin's read-only parameters — meters and readouts — in ascending
    /// order, read on the control path whenever the list may have changed so a
    /// block can tell a readout from a value without asking the controller.
    read_only_parameters: Vec<ParamID>,
    process_context: Box<ProcessContext>,
    has_transport: bool,
    /// Scratch the audio thread drains editor gestures into, so draining costs
    /// no allocation.
    gesture_scratch: Box<[HostParameterUpdate; MAX_PARAMETER_QUEUES]>,

    /// The audio buses this instance runs with, agreed at activation.
    bus_layout: BusLayout,
    /// One `AudioBusBuffers` per declared bus, sized at activation because the
    /// bus count is the plugin's and a block may not allocate.
    input_bus_buffers: Vec<AudioBusBuffers>,
    output_bus_buffers: Vec<AudioBusBuffers>,
    /// Consecutive blocks in which the plugin has refused to start processing.
    processing_start_refusals: u32,
    /// Whether the plugin has refused a `process` call. Raised by the audio
    /// thread, which may not allocate or take the I/O lock, and read by the
    /// control path, which is the only thread that may report it.
    process_refused: bool,
    /// Whether a block passed through untouched because the plugin was not in
    /// the processing state while the host wanted it there — its start was
    /// refused. A requested stop is not this. Raised by the audio thread, read
    /// by the control path, like the process-failure latch above. The block is
    /// still passed through: only a caller that needs every block processed
    /// (an offline print) refuses on it.
    processing_start_refused: bool,
    /// Whether that refusal has already been reported. A plugin that refuses
    /// every block would otherwise print once per control visit for the rest of
    /// the session.
    process_refusal_reported: bool,
    /// The restart flags this host does not act on, as last reported. Held so a
    /// flag word that stops growing stops printing.
    reported_restart_flags: int32,
    /// Why the instance is out of service after a component restart left it
    /// with buses this host cannot route. While set the instance is inactive
    /// and every block is handled as for a failed slot, never processed with
    /// the geometry it had before the restart.
    layout_refusal: Option<String>,
    /// Whether that refusal has already been reported.
    layout_refusal_reported: bool,
    /// Whether the factory calls this class an instrument. Copied off the
    /// instance at activation so the audio thread reads a plain bool.
    is_instrument: bool,
}

// SAFETY: beyond the `Vst3Instance` it owns, the fields are COM pointers, boxed
// scratch and host objects built on `Cell`s, all owned here. The type does not
// pin itself to a thread; it holds because the embedding host constructs and
// drops it on its UI thread and reaches it otherwise only through its exclusive
// access seam (`SharedHostedPlugin` in `sourdaw-native`).
unsafe impl Send for Vst3Wrapper {}
// SAFETY: `&self` methods call into the plugin (`get_parameters`, `get_state`,
// `deliver_deferred_messages`, `latency_samples`, `tail_samples`) and the event
// and parameter lists are `Cell`-based, so shared access from two threads at
// once is not sound from this type alone. It holds because the embedding host's
// access seam serialises every reference, shared or exclusive, to one holder.
unsafe impl Sync for Vst3Wrapper {}

impl Vst3Wrapper {
    /// Load a bundle, instantiate the class the descriptor names, and activate
    /// it at the given sample rate.
    pub fn new(
        bundle_path: &Path,
        descriptor_id: &str,
        sample_rate: f64,
    ) -> Result<Self, Vst3Error> {
        Self::new_with_mode(
            bundle_path,
            descriptor_id,
            sample_rate,
            ProcessMode::Realtime,
        )
    }

    /// [`Vst3Wrapper::new`], with the process mode the plugin is set up in and
    /// told on every block.
    pub fn new_with_mode(
        bundle_path: &Path,
        descriptor_id: &str,
        sample_rate: f64,
        mode: ProcessMode,
    ) -> Result<Self, Vst3Error> {
        let instance = Vst3Instance::open(bundle_path, descriptor_id)?;
        Self::activated_with_mode(instance, parse_class_id(descriptor_id)?, sample_rate, mode)
    }

    /// Activate an already-instantiated plugin. Separate so a test can build the
    /// instance from an in-process factory.
    pub fn activated(
        instance: Vst3Instance,
        class_id: TUID,
        sample_rate: f64,
    ) -> Result<Self, Vst3Error> {
        Self::activated_with_mode(instance, class_id, sample_rate, ProcessMode::Realtime)
    }

    /// [`Vst3Wrapper::activated`], in the given process mode.
    pub fn activated_with_mode(
        instance: Vst3Instance,
        class_id: TUID,
        sample_rate: f64,
        mode: ProcessMode,
    ) -> Result<Self, Vst3Error> {
        let output_notes = Arc::new(OutputNoteQueue::default());
        let read_only_parameters = instance
            .controller()
            .map(read_only_parameter_ids)
            .unwrap_or_default();
        let mut wrapper = Self {
            editor: None,
            processor: None,
            accepts_midi: instance.accepts_midi(),
            is_instrument: instance.is_instrument(),
            instance,
            has_editor: OnceLock::new(),
            editor_window: None,
            editor_scale: DEFAULT_EDITOR_CONTENT_SCALE,
            descriptor_id: format_class_id(&class_id),
            sample_rate,
            process_mode: vst3_process_mode(mode),
            activated: false,
            processing: Arc::new(ProcessingGate::default()),
            input_scratch: Box::new([[0.0; MAX_BUFFER]; CHANNELS]),
            output_scratch: Box::new([[0.0; MAX_BUFFER]; CHANNELS]),
            parameter_changes: ComWrapper::new(HostParameterChanges::new()),
            event_list: ComWrapper::new(HostEventList::new()),
            output_parameter_changes: ComWrapper::new(HostParameterChanges::new()),
            output_events: ComWrapper::new(HostOutputEventList {
                notes: Arc::clone(&output_notes),
            }),
            output_notes,
            read_only_parameters,
            process_context: Box::new(empty_process_context(sample_rate)),
            has_transport: false,
            gesture_scratch: Box::new([HostParameterUpdate::default(); MAX_PARAMETER_QUEUES]),
            bus_layout: BusLayout::default(),
            input_bus_buffers: Vec::new(),
            output_bus_buffers: Vec::new(),
            processing_start_refusals: 0,
            process_refused: false,
            processing_start_refused: false,
            process_refusal_reported: false,
            reported_restart_flags: 0,
            layout_refusal: None,
            layout_refusal_reported: false,
        };
        wrapper.activate()?;
        Ok(wrapper)
    }

    /// Find the component's audio processor and bring the component up on it.
    /// Entering the processing state is left to the processing thread — the
    /// audio thread, or an offline instance's render thread — which is the only
    /// thread that enters it once blocks flow.
    fn activate(&mut self) -> Result<(), Vst3Error> {
        let Some(processor) = self.instance.component().cast::<IAudioProcessor>() else {
            return Err(Vst3Error::NoAudioProcessor {
                name: self.instance.name().to_string(),
            });
        };
        // SAFETY: `activate` runs once, from `activated`, on an instance that
        // `Vst3Instance::create` initialised and never activated; `processor` is
        // that component's own audio processor.
        unsafe { self.configure_and_activate(&processor) }?;
        self.processor = Some(processor);
        Ok(())
    }

    /// Negotiate buses, activate them, declare the processing setup, and make
    /// the component active — the whole of what an inactive component needs
    /// before blocks, and the order VST3 defines it in.
    ///
    /// # Safety
    /// The component must be initialised and inactive, `processor` must be its
    /// own audio processor, and the caller must hold exclusive access, so no
    /// `process` runs concurrently.
    unsafe fn configure_and_activate(
        &mut self,
        processor: &ComPtr<IAudioProcessor>,
    ) -> Result<(), Vst3Error> {
        let component = self.instance.component();

        // Before activation, because `setBusArrangements` is only defined
        // while the component is inactive — and after it, every block's
        // shape is fixed by what the plugin agreed to here.
        // SAFETY: this fn's contract makes the component initialised and
        // inactive and `processor` its own audio processor.
        let bus_layout =
            unsafe { negotiate_bus_layout(component, processor, self.instance.name()) }?;

        // SAFETY: the component is initialised and still inactive, the only
        // state in which bus activation is defined.
        unsafe { activate_main_audio_bus(component, BusDirections_::kInput as int32) };
        // SAFETY: as above; the component is initialised and inactive.
        unsafe { activate_main_audio_bus(component, BusDirections_::kOutput as int32) };
        if self.accepts_midi {
            // SAFETY: as above; the component is initialised and inactive.
            unsafe { activate_first_event_bus(component) };
        }

        let mut setup = self.process_setup();
        // SAFETY: the component is initialised and inactive, the state
        // `setupProcessing` requires; `setup` is a live local read during the call.
        if unsafe { processor.setupProcessing(&mut setup) } != kResultOk {
            return Err(Vst3Error::ProcessingSetupRefused {
                name: self.instance.name().to_string(),
            });
        }

        // SAFETY: the component is initialised, set up and inactive; the caller's
        // exclusive access keeps any `process` from running concurrently.
        if unsafe { component.setActive(1) } != kResultOk {
            return Err(Vst3Error::ActivateRefused {
                name: self.instance.name().to_string(),
            });
        }

        // Every geometry-dependent allocation happens here, on the control
        // path: a block reads the bus count out of these arrays rather than out
        // of the plugin, and growing them would be an allocation on the audio
        // thread.
        self.input_bus_buffers = empty_bus_buffers(bus_layout.inputs.len());
        self.output_bus_buffers = empty_bus_buffers(bus_layout.outputs.len());
        self.bus_layout = bus_layout;
        self.activated = true;
        self.processing_start_refusals = 0;
        // The first audio block enters the processing state, on the thread VST3
        // requires for it.
        self.processing.request_start();
        Ok(())
    }

    fn process_setup(&self) -> ProcessSetup {
        ProcessSetup {
            processMode: self.process_mode,
            symbolicSampleSize: SymbolicSampleSizes_::kSample32 as int32,
            maxSamplesPerBlock: MAX_BUFFER as int32,
            sampleRate: self.sample_rate,
        }
    }

    /// The per-instance host state the plugin's callbacks write into.
    pub fn host_state(&self) -> Arc<Vst3HostState> {
        Arc::clone(&self.instance.host.state)
    }

    /// The queue this plugin's own editor edits land in. Clone it to drain
    /// without holding the wrapper.
    pub fn parameter_event_queue(&self) -> Arc<PluginParameterEventQueue> {
        self.instance.host.state.parameter_event_queue()
    }

    /// Install the wake fired when this plugin flags a latency change. First
    /// install wins, so the wake cannot be hijacked mid-life.
    pub fn set_latency_change_notifier(&self, notifier: LatencyChangeNotifier) -> bool {
        self.instance.host.state.set_latency_notifier(notifier)
    }

    /// Install the wake fired for every plugin-initiated ask this host answers
    /// off the calling thread — today, the `IComponentHandler2::setDirty`
    /// report that an edit the plugin made itself is unsaved. First install
    /// wins; a second call reports `false`.
    pub fn set_plugin_host_request_notifier(&self, notifier: PluginHostRequestNotifier) -> bool {
        self.instance.host.state.set_request_notifier(notifier)
    }

    // ── Editor ──────────────────────────────────────────────────────────

    /// Whether this plugin offers an editor.
    ///
    /// `createView` is the only question VST3 has, and asking it creates a real
    /// view — so the answer is cached and the probe runs once per instance. The
    /// first ask runs on whatever thread made it, which makes the first ask the
    /// caller's to place: the load path is that first ask, and it carries the
    /// question to the shell's UI thread (`editor_support_on_ui_thread` in
    /// `sourdaw-native`) before any window exists, so every later capability
    /// read — the engine record's own flag, `is_plugin_gui_supported`, the open
    /// path's pre-check — answers from this cache and creates no view at all.
    pub fn has_editor(&self) -> bool {
        *self.has_editor.get_or_init(|| {
            self.instance
                .controller()
                .is_some_and(plugin_offers_an_editor)
        })
    }

    /// Create the plugin's editor and attach it to the native window `parent`
    /// names, returning the size the host window has to be.
    ///
    /// Crate-internal, and that is what makes it safe to call: the one caller is
    /// [`AudioPlugin::open_gui`], and `parent` is the handle the desktop shell
    /// produced for this platform's editor window and keeps alive until the
    /// editor is closed. That is the whole of what [`Vst3Editor::open`] asks of
    /// its caller, so this function discharges the contract rather than passing
    /// it on to a trait that models the same handle as safe for every backend.
    pub(crate) fn open_editor(&mut self, parent: *mut c_void) -> Result<EditorSize, Vst3Error> {
        if self.editor.is_some() {
            return Err(Vst3Error::EditorAlreadyOpen {
                name: self.instance.name().to_string(),
            });
        }
        let controller = self
            .instance
            .controller()
            .ok_or_else(|| Vst3Error::NoEditController {
                name: self.instance.name().to_string(),
            })?;

        // SAFETY: `parent` reaches here only from `AudioPlugin::open_gui`, whose
        // argument is the live native window handle the shell created for this
        // editor and destroys only after the editor is closed, and the control
        // claim is what serialises this call against the rest of the instance.
        let editor = unsafe {
            Vst3Editor::open(
                controller,
                parent,
                self.instance.name(),
                EditorSession::current(),
                self.editor_window.clone(),
                self.editor_scale,
            )
        }?;
        let size = editor.size();
        self.editor = Some(editor);
        Ok(size)
    }

    /// Detach and release the editor. A plugin with none open has nothing to do.
    pub fn close_editor(&mut self) {
        self.editor = None;
    }

    /// The open editor, for a host-initiated resize or a size read.
    pub fn editor(&self) -> Option<&Vst3Editor> {
        self.editor.as_ref()
    }

    /// The open editor, or why there is nothing to address.
    ///
    /// Every host-initiated editor operation starts here, and names the plugin
    /// in its refusal: the caller reaches this from a window event, where "no
    /// editor" is a report about one instance among several.
    fn open_editor_or_refuse(&self) -> Result<&Vst3Editor, Vst3Error> {
        self.editor.as_ref().ok_or_else(|| Vst3Error::NoOpenEditor {
            name: self.instance.name().to_string(),
        })
    }

    /// The class CID this instance was created from, as the scanner spells it.
    pub fn descriptor_id(&self) -> &str {
        &self.descriptor_id
    }

    /// The rate this instance was activated at.
    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
    }

    /// Deliver messages the plugin's halves sent each other through the host.
    ///
    /// VST3 routes an `IMessage` from one connection point to the other, and a
    /// plugin may send one from its processor — where re-entering the peer
    /// directly would run plugin code on the audio thread. The host's own
    /// connection proxies park every message instead; this hands them on, and
    /// the control path calls it wherever it already visits the plugin.
    pub fn deliver_deferred_messages(&self) {
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

    /// Record a refused process call, and wake the control path the first time.
    ///
    /// Audio thread. One release store, and only on the first refusal: a plugin
    /// refusing every block latches once and then costs one bool test.
    fn latch_process_refusal(&mut self) {
        if self.process_refused {
            return;
        }
        self.process_refused = true;
        signal_pending_process_refusal();
    }

    /// Say out loud what the audio thread and the plugin's callbacks recorded.
    ///
    /// The audio thread cannot report anything itself — it may not allocate or
    /// take the I/O lock — so what it saw is left as a flag for the control path
    /// to read. The restart flags this host does not act on are named for the
    /// same reason: a behaviour difference nobody prints has no evidence of
    /// itself. Both are latched, so a plugin that misbehaves on every block still
    /// produces one line.
    fn report_plugin_observations(&mut self) {
        if self.process_refused && !self.process_refusal_reported {
            self.process_refusal_reported = true;
            eprintln!(
                "[VST3] '{}' refused a process call; blocks pass through it unprocessed",
                self.instance.name()
            );
        }

        if let Some(report) = self.take_layout_refusal_report() {
            eprintln!("{report}");
        }

        let unhandled = self.instance.host.state.unhandled_restart_flags();
        if unhandled != self.reported_restart_flags {
            self.reported_restart_flags = unhandled;
            eprintln!(
                "[VST3] '{}' asked for restart flags this host does not act on: {unhandled:#010x}",
                self.instance.name()
            );
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
    pub fn reactivate_for_latency(&mut self) -> Result<u32, Vst3Error> {
        let Some(processor) = self.processor.clone() else {
            return Ok(0);
        };
        // An instance a component restart took out of service holds a layout
        // the host refused; only a restart that routes can bring it back.
        if self.layout_refusal.is_some() {
            return Ok(0);
        }

        if self.activated {
            self.force_stop_processing_off_audio_thread();
        }

        if self.activated {
            // SAFETY: exclusive control access (`&mut self`, caller's claim);
            // the component is live and active, and processing was stopped above.
            unsafe { self.instance.component().setActive(0) };
            self.activated = false;
        }

        let mut setup = self.process_setup();
        // SAFETY: exclusive control access; the component is initialised and
        // inactive, the state `setupProcessing` requires; `setup` is a live local.
        if unsafe { processor.setupProcessing(&mut setup) } != kResultOk {
            return Err(Vst3Error::LatencyResetupRefused {
                name: self.instance.name().to_string(),
            });
        }

        // SAFETY: exclusive control access; the component is initialised, set up
        // and inactive.
        if unsafe { self.instance.component().setActive(1) } != kResultOk {
            return Err(Vst3Error::LatencyReactivationRefused {
                name: self.instance.name().to_string(),
            });
        }

        self.activated = true;
        self.processing.request_start();
        Ok(self.latency_samples())
    }

    /// Run the reactivation cycles the plugin asked for with `kIoChanged` or
    /// `kReloadComponent`, and report whether any ran.
    ///
    /// Each cycle stops processing, deactivates, re-reads and re-negotiates the
    /// buses, sets processing up again and reactivates — the deactivate,
    /// re-read, reactivate answer VST3 asks of a host for both flags. A reload
    /// also asks for the parameter list to be read again, because the plugin
    /// may have changed what it publishes.
    ///
    /// **Control path, on the host's UI thread**: every call in the cycle is
    /// one VST3 binds to that thread. The caller holds the exclusive claim, so
    /// the audio thread cannot run a block concurrently, which is also why the
    /// stop uses the counted off-audio-thread route.
    ///
    /// A layout the host cannot route leaves the instance inactive and its
    /// slot out of service, with the reason latched for the control path to
    /// report; the cycle answers with that reason.
    pub fn apply_component_restart(&mut self) -> Result<bool, Vst3Error> {
        let mut restarted = false;
        for _ in 0..MAX_COMPONENT_RESTART_PASSES {
            let flags = self.instance.host.state.take_component_restart();
            if flags & COMPONENT_RESTART_FLAGS == 0 {
                return Ok(restarted);
            }
            self.restart_component(flags)?;
            restarted = true;
        }
        if self.instance.host.state.take_component_restart() != 0 {
            eprintln!(
                "[VST3] '{}' asked for another component restart on all {} passes; \
                 keeping the layout the last pass agreed and dropping the request",
                self.instance.name(),
                MAX_COMPONENT_RESTART_PASSES
            );
        }
        Ok(restarted)
    }

    /// One deactivate/re-read/reactivate cycle. See
    /// [`Self::apply_component_restart`].
    fn restart_component(&mut self, flags: int32) -> Result<(), Vst3Error> {
        let Some(processor) = self.processor.clone() else {
            return Ok(());
        };

        if self.activated {
            self.force_stop_processing_off_audio_thread();
            // SAFETY: exclusive control access (`&mut self`, caller's claim);
            // the component is live and active, and processing was stopped above.
            unsafe { self.instance.component().setActive(0) };
            self.activated = false;
        }

        // SAFETY: the component is initialised and was just made inactive (or
        // already was), `processor` is its own, and `&mut self` is the caller's
        // exclusive claim.
        if let Err(reason) = unsafe { self.configure_and_activate(&processor) } {
            self.layout_refusal = Some(reason.to_string());
            self.layout_refusal_reported = false;
            // The control path's failure reporter is what prints it.
            signal_pending_process_refusal();
            return Err(reason);
        }
        self.layout_refusal = None;

        if flags & RestartFlags_::kReloadComponent != 0 {
            self.read_only_parameters = self
                .instance
                .controller()
                .map(read_only_parameter_ids)
                .unwrap_or_default();
            self.instance.host.state.request_parameters_rescan();
        }
        Ok(())
    }

    /// Answer a block the plugin must not be handed, the way ADR 0021 DG-003
    /// decides for a failed slot: only an effect with a valid dry input passes
    /// it, because muting a crashed EQ takes the track with it.
    ///
    /// Two shapes have no valid dry input to pass. An instrument, which the
    /// factory's sub-categories name — a synth fed routed audio would otherwise
    /// emit that signal at unity out of a voice slot. And any plugin declaring
    /// no main input bus, a generator such as a test-tone, whose own bus
    /// declaration says it consumes no audio and so has none to hand back.
    ///
    /// The CLAP backend splits on the same two, for the same reasons.
    fn pass_failed_block(&self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
        if self.fails_silent() {
            Self::silence_outputs(outputs, num_samples);
        } else {
            Self::pass_through(inputs, outputs, num_samples);
        }
    }

    /// Whether a failed slot is silenced rather than passed dry: see
    /// [`Self::pass_failed_block`].
    fn fails_silent(&self) -> bool {
        self.is_instrument || self.bus_layout.main_input_channels() == 0
    }

    /// The line saying this slot is out of service for a layout the host
    /// refused, the first time it is asked after the refusal; `None` once it
    /// has been taken, or while no refusal stands. **Control path only.**
    pub fn take_layout_refusal_report(&mut self) -> Option<String> {
        if self.layout_refusal_reported {
            return None;
        }
        let reason = self.layout_refusal.as_ref()?;
        let handling = if self.fails_silent() {
            "its blocks are silenced"
        } else {
            "its blocks pass through unprocessed"
        };
        let report = format!("{reason}; {handling}");
        self.layout_refusal_reported = true;
        Some(report)
    }

    /// Hand the plugin the parameter writes waiting for it, with no audio, while
    /// nothing else will. **Control path only.**
    ///
    /// A processor learns a host write only from a block's
    /// `inputParameterChanges`, and an instance no engine is running receives
    /// no block — so a plugin whose controller defers to its processor (one
    /// that refuses `setParamNormalized` and reads its values back from the
    /// processor) would hold the old value, report it, and save it, for as long
    /// as the instance stays out of the engine. VST3 defines the host's answer:
    /// a `process` call with no audio buses, which exists to flush parameters.
    ///
    /// Only while the instance is active and not in the processing state, which
    /// with the caller's exclusive access means no processing thread is inside
    /// or about to enter the plugin. The writes are read without being taken
    /// and cleared only once the plugin has processed them, so a plugin that
    /// refuses the flush keeps them queued for its first real block, and an
    /// editor edit made meanwhile is never replaced by the older value.
    fn flush_parameters_while_idle(&mut self) {
        if !self.activated || self.processing.is_processing() {
            return;
        }
        let Some(processor) = self.processor.clone() else {
            return;
        };

        self.parameter_changes.reset();
        let peeked = self
            .instance
            .host
            .state
            .peek_parameter_edits(self.gesture_scratch.as_mut_slice());
        if peeked == 0 {
            return;
        }
        for update in &self.gesture_scratch[..peeked] {
            self.parameter_changes.stage(update.param_id, update.value);
        }

        // SAFETY: exclusive control access, the claim every control-path
        // lifecycle call is made under; the component is active and not
        // processing, so no processing thread is inside the plugin.
        if !entered_processing(unsafe { processor.setProcessing(1) }) {
            self.parameter_changes.reset();
            return;
        }

        self.output_parameter_changes.reset();
        let mut data = flush_process_data(
            self.process_mode,
            borrowed_ptr::<_, IParameterChanges>(&self.parameter_changes),
            borrowed_ptr::<_, IParameterChanges>(&self.output_parameter_changes),
            borrowed_ptr::<_, IEventList>(&self.output_events),
        );
        // SAFETY: exclusive control access inside the processing state just
        // entered; `data` names no audio bus, and its parameter list is this
        // wrapper's own, live for the call.
        let flushed = unsafe { processor.process(&mut data) } == kResultOk;
        // SAFETY: as for the `setProcessing(1)` above.
        unsafe { processor.setProcessing(0) };

        if flushed {
            self.forward_processor_output();
            self.instance
                .host
                .state
                .settle_parameter_edits(&self.gesture_scratch[..peeked]);
        }
        self.parameter_changes.reset();
    }

    /// Carry what the processor reported in this call's
    /// `outputParameterChanges` to the controller and the host's observers.
    /// **RT-safe**: the audio thread runs it after every block.
    ///
    /// A value for a parameter the host handed the processor in this same call
    /// is the processor repeating what it was told — automation played back, a
    /// knob the user is turning in the editor, a host write — and is dropped
    /// for the length of the call, as the CLAP backend drops the same echo:
    /// forwarded, it would come back as a plugin-made edit and mark the project
    /// dirty on every automation point played. Every other parameter passes.
    /// The same accepted bound applies: a processor that corrects a value it
    /// was handed has that correction dropped with the echo.
    fn forward_processor_output(&self) {
        for (param_id, value) in self.output_parameter_changes.staged() {
            if self.parameter_changes.carries(param_id) {
                continue;
            }
            let observed = self.read_only_parameters.binary_search(&param_id).is_err();
            self.instance
                .host
                .state
                .record_processor_output(param_id, value, observed);
        }
        self.output_parameter_changes.reset();
    }

    /// The notes this instance's plugin produced, for the control path to
    /// drain. Routing them is not this backend's concern; each keeps the frame
    /// offset the plugin gave it inside its block.
    pub fn output_note_queue(&self) -> Arc<OutputNoteQueue> {
        Arc::clone(&self.output_notes)
    }

    /// Queue the engine's writes for a block the plugin is not handed, so they
    /// land on the first block that reaches the processor. They go in as host
    /// writes, which take precedence over a gesture for the same parameter
    /// exactly as they would have inside the block.
    ///
    /// RT-safe: the queue coalesces into preallocated slots without a lock.
    fn hold_host_parameter_updates(&self, parameter_updates: &[HostParameterUpdate]) {
        for update in parameter_updates {
            self.instance
                .host
                .state
                .queue_host_parameter_write(update.param_id, update.value);
        }
    }

    /// Write silence over the engine's bus, for a block whose output the plugin
    /// did not produce.
    fn silence_outputs(outputs: &mut [&mut [f32]], num_samples: usize) {
        for out in outputs.iter_mut() {
            let len = num_samples.min(out.len());
            out[..len].fill(0.0);
        }
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

    fn stage_midi(&self, midi_events: &[HostMidiEvent]) {
        self.event_list.reset();
        if !self.accepts_midi {
            // A plugin with no event input bus must not be handed events. This
            // is the point at which VST3 declines to inherit the "every plugin
            // accepts MIDI" answer the engine's slot gives for CLAP.
            return;
        }
        for event in midi_events {
            self.event_list.push(note_event(*event));
        }
    }

    /// Hand one block to the plugin. **Audio thread only.**
    ///
    /// RT-safe: no allocation, no lock, no I/O. Everything it hands the plugin
    /// was allocated in `from_factory` and is refilled in place.
    ///
    /// The waiting parameter writes are taken only once the block is known to
    /// reach the plugin: a block it is not handed leaves the editor's gestures
    /// queued and queues the engine's writes behind them, so nothing is lost
    /// and nothing older is put back over a newer edit.
    fn process_block(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        parameter_updates: &[HostParameterUpdate],
    ) {
        if self.layout_refusal.is_some() || !self.activated {
            self.hold_host_parameter_updates(parameter_updates);
            if self.layout_refusal.is_some() {
                self.pass_failed_block(inputs, outputs, num_samples);
            } else {
                Self::pass_through(inputs, outputs, num_samples);
            }
            return;
        }

        // The audio thread is the only thread VST3 allows to enter or leave the
        // processing state, so this is where the control thread's intent lands.
        self.sync_processing_state();

        if !self.processing.is_processing() {
            if self.processing.wants_processing() {
                self.processing_start_refused = true;
            }
            self.hold_host_parameter_updates(parameter_updates);
            Self::pass_through(inputs, outputs, num_samples);
            return;
        }

        // An active instance always holds its processor: activation needs it.
        self.stage_parameter_updates(parameter_updates);

        // Borrowed, not cloned: cloning would put an `AddRef`/`Release` pair —
        // vendor code, and an atomic each — on every block. Bound once here so
        // the check and the `process` call below share one borrow, leaving no
        // second lookup that could panic on the audio thread.
        let Some(processor) = self.processor.as_ref() else {
            Self::pass_through(inputs, outputs, num_samples);
            return;
        };

        let samples = num_samples.min(MAX_BUFFER);
        let fed_channels = self.bus_layout.main_input_channels().min(CHANNELS);
        let taken_channels = self.bus_layout.main_output_channels().min(CHANNELS);

        fill_input_scratch(&mut self.input_scratch, inputs, fed_channels, samples);
        self.output_scratch[0][..samples].fill(0.0);
        self.output_scratch[1][..samples].fill(0.0);

        // Every pointer below addresses this wrapper's own preallocated storage
        // and is valid for the duration of the `process` call, which is the only
        // span VST3 lets a plugin read them for. The bus arrays were sized at
        // activation from the layout the plugin agreed to, so nothing here
        // allocates and nothing indexes past what the plugin declared.
        let mut in_ptrs: [*mut f32; CHANNELS] = [
            self.input_scratch[0].as_mut_ptr(),
            self.input_scratch[1].as_mut_ptr(),
        ];
        let mut out_ptrs: [*mut f32; CHANNELS] = [
            self.output_scratch[0].as_mut_ptr(),
            self.output_scratch[1].as_mut_ptr(),
        ];

        // SAFETY: `in_ptrs` holds `HOST_CHANNELS` pointers into this wrapper's
        // boxed input scratch, and both the array and the scratch outlive the
        // `process` call below in this same scope.
        unsafe {
            point_buses_at_scratch(
                &mut self.input_bus_buffers,
                &self.bus_layout.inputs,
                in_ptrs.as_mut_ptr(),
            )
        };
        // SAFETY: as above, for `out_ptrs` and the boxed output scratch.
        unsafe {
            point_buses_at_scratch(
                &mut self.output_bus_buffers,
                &self.bus_layout.outputs,
                out_ptrs.as_mut_ptr(),
            )
        };

        self.output_parameter_changes.reset();
        let refused = {
            let mut data = ProcessData {
                processMode: self.process_mode,
                symbolicSampleSize: SymbolicSampleSizes_::kSample32 as int32,
                numSamples: samples as int32,
                numInputs: self.input_bus_buffers.len() as int32,
                numOutputs: self.output_bus_buffers.len() as int32,
                inputs: first_bus_pointer(&mut self.input_bus_buffers),
                outputs: first_bus_pointer(&mut self.output_bus_buffers),
                inputParameterChanges: if self.parameter_changes.is_empty() {
                    ptr::null_mut()
                } else {
                    borrowed_ptr::<_, IParameterChanges>(&self.parameter_changes)
                },
                outputParameterChanges: borrowed_ptr::<_, IParameterChanges>(
                    &self.output_parameter_changes,
                ),
                inputEvents: if self.event_list.is_empty() {
                    ptr::null_mut()
                } else {
                    borrowed_ptr::<_, IEventList>(&self.event_list)
                },
                outputEvents: borrowed_ptr::<_, IEventList>(&self.output_events),
                // A null context tells the plugin the host has no timeline, so
                // it is only replaced once that stops being true.
                processContext: if self.has_transport {
                    self.process_context.as_mut() as *mut ProcessContext
                } else {
                    ptr::null_mut()
                },
            };

            // SAFETY: the thread that runs this instance's blocks (the audio thread,
            // or the render thread of an offline instance), inside the processing
            // state the gate just confirmed; `processor` is retained by `self.processor`, and every
            // pointer in `data` addresses storage that outlives this call.
            unsafe { processor.process(&mut data) != kResultOk }
        };

        if !refused {
            self.forward_processor_output();
        }

        if refused {
            // The output scratch holds nothing the plugin stands behind, so it
            // never reaches the bus.
            self.pass_failed_block(inputs, outputs, num_samples);
            self.latch_process_refusal();
            return;
        }

        if taken_channels == 0 {
            // No audio output bus at all — an analyzer taps the signal and
            // produces none of its own, so the block continues past it.
            Self::pass_through(inputs, outputs, num_samples);
            return;
        }

        // A main output bus narrower than the host's pair is fanned across it,
        // which is what a mono plugin in a stereo slot sounds like everywhere
        // else. Scratch above the accepted width was never written by the
        // plugin, so it must not reach the output.
        for (channel, out) in outputs.iter_mut().enumerate() {
            let source = channel.min(taken_channels - 1);
            let len = samples.min(out.len());
            out[..len].copy_from_slice(&self.output_scratch[source][..len]);
        }
    }
}

impl Drop for Vst3Wrapper {
    /// Leave the processing and active states here, before `instance` drops and
    /// terminates the plugin. VST3 requires that order, and a component
    /// terminated while still active is a plugin asked to tear down state it
    /// believes is in use.
    fn drop(&mut self) {
        // Before anything else: the editor is detached and released while the
        // plugin that created its view is still initialised.
        self.close_editor();
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
        self.stage_midi(&[]);
        self.process_block(inputs, outputs, num_samples, &[]);
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
            .queue_host_parameter_write(param_id, clamped);
        self.flush_parameters_while_idle();
    }

    /// The controller's parameter list, and the control-path visit the rest of
    /// this backend's deferred work rides on.
    ///
    /// The plugin's halves talk through host-owned proxies that park every
    /// message, so something on the control path has to hand them on. This is
    /// the call the runtime owner already makes there, and doing it here is what
    /// keeps the deferral from being a queue nobody drains.
    ///
    /// It is also what `kParamValuesChanged` and `kParamTitlesChanged` were
    /// asking for — a re-read of the whole list — so those flags are cleared
    /// here, by the call that satisfies them.
    fn get_parameters(&self) -> Vec<PluginParameter> {
        self.deliver_deferred_messages();
        self.instance.host.state.take_parameter_values_dirty();
        self.instance.host.state.take_parameter_titles_dirty();
        self.instance
            .controller()
            .map(read_parameters)
            .unwrap_or_default()
    }

    /// Both chunks, or the plugin's refusal.
    ///
    /// A component that could not produce its state has not produced *empty*
    /// state, and a container built out of that refusal looks exactly like a
    /// valid save — which then overwrites the last good one in the project file.
    /// The controller's own chunk stays tolerant: `getState` answering
    /// `kNotImplemented` is ordinary for a controller with nothing to persist.
    fn get_state(&self) -> Result<Vec<u8>, PluginError> {
        let component = read_chunk(|stream| {
            // SAFETY: control path only; the component is live.
            unsafe { self.instance.component().getState(stream) }
        })
        .ok_or_else(|| Vst3Error::ProcessorStateUnreported {
            name: self.instance.name().to_string(),
        })?;

        let controller = self
            .instance
            .controller()
            .filter(|_| !self.instance.controller_is_component)
            .and_then(|controller| {
                read_chunk(|stream| {
                    // SAFETY: control path only; the controller is live.
                    unsafe { controller.getState(stream) }
                })
            })
            .unwrap_or_default();
        Ok(encode_state(&component, &controller))
    }

    /// Restore both chunks in the order VST3 requires: the processor first, then
    /// the controller's *view* of that same processor state, then the
    /// controller's own editor state. Skipping `setComponentState` leaves an
    /// editor showing the values of the session before the load.
    ///
    /// The component's answer decides the result: a processor that refused the
    /// saved state is running on something else, and reporting success would
    /// tell the project it reloaded when it did not. The controller's two
    /// entry points stay tolerant, because `kNotImplemented` is the ordinary
    /// answer from a combined class that already took the same bytes.
    fn set_state(&mut self, state: &[u8]) -> Result<(), PluginError> {
        let (component, controller_chunk) = decode_state(state)?;

        let restored = write_chunk(&component, |stream| {
            // SAFETY: control path only; the component is live.
            unsafe { self.instance.component().setState(stream) }
        });
        if restored != kResultOk {
            return Err(Vst3Error::ProcessorStateRefused {
                name: self.instance.name().to_string(),
            }
            .into());
        }

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

    fn has_gui(&self) -> bool {
        self.has_editor()
    }

    fn open_gui(&mut self, handle_ptr: *mut c_void) -> Result<(u32, u32), PluginError> {
        let size = self.open_editor(handle_ptr)?;
        Ok((size.width, size.height))
    }

    fn close_gui(&mut self) {
        self.close_editor();
    }

    fn set_editor_window_resizer(&mut self, resize: EditorWindowResizer) {
        self.editor_window = Some(resize);
    }

    fn set_editor_content_scale(&mut self, scale: f64) {
        self.editor_scale = scale;
    }

    fn editor_can_resize(&self) -> bool {
        self.editor.as_ref().is_some_and(Vst3Editor::can_resize)
    }

    fn request_editor_size(&mut self, width: u32, height: u32) -> Result<(u32, u32), PluginError> {
        let granted = self
            .open_editor_or_refuse()?
            .request_size(EditorSize { width, height })
            .map_err(Vst3Error::from)?;
        Ok((granted.width, granted.height))
    }

    /// The stated scale is kept as well as applied: an editor closed and
    /// reopened on the display it was moved to must open at the scale it is on,
    /// not at the one it was created under.
    fn apply_editor_content_scale(&mut self, scale: f64) -> Result<(u32, u32), PluginError> {
        self.editor_scale = scale;
        let granted = self
            .open_editor_or_refuse()?
            .apply_content_scale(scale)
            .map_err(Vst3Error::from)?;
        Ok((granted.width, granted.height))
    }

    /// Read and clear the "plugin state changed" signal its editor raised
    /// through `IComponentHandler2::setDirty`. The control path turns it into
    /// the project-level dirty mark.
    fn take_state_dirty(&mut self) -> bool {
        self.instance.host.state.take_state_dirty()
    }

    /// Hand the controller what the processor reported since the last visit.
    ///
    /// VST3 keeps the processor and the controller apart, so a meter or a
    /// value the processor's own modulation moved reaches the editor only
    /// through the host; this is the control-path half of
    /// [`Vst3HostState::record_processor_output`], answered on the same hint
    /// and the same drain tick a CLAP flush request is.
    fn flush_parameters_off_audio_thread(&mut self) -> bool {
        let Some(controller) = self.instance.controller() else {
            return false;
        };
        let mut updates = [HostParameterUpdate::default(); MAX_PARAMETER_GESTURES];
        let drained = self
            .instance
            .host
            .state
            .drain_controller_updates(&mut updates);
        for update in &updates[..drained] {
            // SAFETY: control path, under the caller's exclusive access; the
            // controller is live and the id is one the processor reported.
            unsafe { controller.setParamNormalized(update.param_id, update.value) };
        }
        drained > 0
    }

    fn take_parameters_rescan(&mut self) -> bool {
        self.instance.host.state.take_parameters_rescan()
    }

    fn parameter_event_queue(&self) -> Option<Arc<PluginParameterEventQueue>> {
        Some(Vst3Wrapper::parameter_event_queue(self))
    }
}

impl HostedPluginRuntime for Vst3Wrapper {
    fn is_activated(&self) -> bool {
        self.activated
    }

    fn processing_gate(&self) -> Arc<ProcessingGate> {
        Arc::clone(&self.processing)
    }

    /// **Audio thread only.** The processing thread is where the engine's
    /// intent to start or stop lands; the control path enters the processing
    /// state only around an idle flush (see the module note).
    ///
    /// A plugin that keeps refusing to start is asked a bounded number of times
    /// and then left alone. Retrying on every block spends an unbounded number of
    /// vendor calls on the audio thread for an answer that has not changed, and
    /// the block passes through either way.
    fn sync_processing_state(&mut self) {
        let wants = self.processing.wants_processing();
        if wants == self.processing.is_processing() {
            return;
        }

        let Some(processor) = &self.processor else {
            return;
        };

        if !wants {
            // SAFETY: the processor is live and the component is active.
            unsafe { processor.setProcessing(0) };
            self.processing.mark_stopped();
            self.processing_start_refusals = 0;
            return;
        }

        if self.processing_start_refusals >= MAX_PROCESSING_START_REFUSALS {
            return;
        }

        // SAFETY: the processor is live and the component is active.
        if entered_processing(unsafe { processor.setProcessing(1) }) {
            self.processing.mark_started();
            self.processing_start_refusals = 0;
            return;
        }
        self.processing_start_refusals += 1;
    }

    /// Show the plugin's editor a value the host wrote. Control path only.
    ///
    /// Only `setParamNormalized`: the processor is already being told through the
    /// audio thread's own parameter queue, and recording this as a plugin-side
    /// gesture would send the host's own write back around a second time.
    fn apply_host_parameter_write_to_editor(&mut self, param_id: u32, value: f64) {
        if !value.is_finite() {
            return;
        }
        let Some(controller) = self.instance.controller() else {
            return;
        };
        // SAFETY: control path only; the controller is live.
        unsafe {
            controller.setParamNormalized(param_id, value.clamp(0.0, 1.0));
        }
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
        self.stage_midi(&[]);
        self.process_block(inputs, outputs, num_samples, parameter_updates);
    }

    fn process_with_midi_and_parameters(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        midi_events: &[HostMidiEvent],
        parameter_updates: &[HostParameterUpdate],
    ) {
        self.stage_midi(midi_events);
        self.process_block(inputs, outputs, num_samples, parameter_updates);
    }

    fn poll_latency_change(&mut self) -> Result<Option<u32>, PluginError> {
        self.report_plugin_observations();
        self.deliver_deferred_messages();

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

    fn tail_samples(&self) -> u32 {
        let Some(processor) = &self.processor else {
            return 0;
        };
        // SAFETY: control path only; the processor is live. Unlike
        // `getLatencySamples`, VST3 places no activation precondition on this
        // one, so it is not gated on `activated`.
        unsafe { processor.getTailSamples() }
    }

    fn apply_component_restart(&mut self) -> Result<bool, PluginError> {
        Ok(Vst3Wrapper::apply_component_restart(self)?)
    }

    fn report_plugin_observations(&mut self) {
        Vst3Wrapper::report_plugin_observations(self)
    }

    fn has_failed_a_process_call(&self) -> bool {
        self.process_refused
    }

    /// A slot out of service on a refused layout passes its blocks through
    /// unprocessed exactly as a refused start does.
    fn has_passed_a_block_unprocessed(&self) -> bool {
        self.processing_start_refused || self.layout_refusal.is_some()
    }
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

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
/// The ids of every parameter the controller marks read-only, hidden or not,
/// in ascending order: the readouts a processor reports and nobody edits.
fn read_only_parameter_ids(controller: &ComPtr<IEditController>) -> Vec<ParamID> {
    // SAFETY: live, initialised controller.
    let count = unsafe { controller.getParameterCount() };
    let mut ids: Vec<ParamID> = (0..count)
        .filter_map(|index| {
            // SAFETY: `ParameterInfo` is a plain C struct of integers, floats and
            // UTF-16 arrays, for which all-zero bytes are a valid value.
            let mut info: ParameterInfo = unsafe { std::mem::zeroed() };
            // SAFETY: live, initialised controller; `info` is a local the plugin
            // writes for the call's duration only.
            if unsafe { controller.getParameterInfo(index, &mut info) } != kResultOk {
                return None;
            }
            (info.flags & ParameterFlags_::kIsReadOnly != 0).then_some(info.id)
        })
        .collect();
    ids.sort_unstable();
    ids
}

pub fn read_parameters(controller: &ComPtr<IEditController>) -> Vec<PluginParameter> {
    // SAFETY: control path only; the `ComPtr` holds a reference on a live,
    // initialised controller.
    let count = unsafe { controller.getParameterCount() };
    (0..count)
        .filter_map(|index| {
            // SAFETY: `ParameterInfo` is a plain C struct of integers, floats and
            // UTF-16 arrays, for which all-zero bytes are a valid value.
            let mut info: ParameterInfo = unsafe { std::mem::zeroed() };
            // SAFETY: live, initialised controller; `info` is a local the plugin
            // writes for the call's duration only.
            if unsafe { controller.getParameterInfo(index, &mut info) } != kResultOk {
                return None;
            }
            if info.flags & ParameterFlags_::kIsHidden != 0 {
                return None;
            }
            Some(PluginParameter {
                id: info.id,
                name: read_string128(&info.title),
                // SAFETY: live, initialised controller; `info.id` is an id the
                // controller itself just reported.
                value: unsafe { controller.getParamNormalized(info.id) },
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

/// The name the factory gives a class, when it lists one with this CID.
pub fn class_name(factory: &ComPtr<IPluginFactory>, class_id: &TUID) -> Option<String> {
    // SAFETY: the `ComPtr` holds a reference on a live factory.
    let count = unsafe { factory.countClasses() };
    for index in 0..count {
        // SAFETY: `PClassInfo` is a plain C struct of byte arrays and an
        // integer, for which all-zero bytes are a valid value.
        let mut info: vst3::Steinberg::PClassInfo = unsafe { std::mem::zeroed() };
        // SAFETY: live factory; `info` is a local the plugin writes for the
        // call's duration only.
        if unsafe { factory.getClassInfo(index, &mut info) } != kResultOk {
            continue;
        }
        if same_class_id(&info.cid, class_id) {
            return non_empty(read_char8(&info.name));
        }
    }
    None
}

/// Whether the factory calls this class an instrument.
///
/// Read from `getClassInfo2`, which is where VST3 keeps sub-categories, and
/// mapped by the same function the scanner categorises with — so the browser and
/// the audio path cannot disagree about what a plugin is. A factory too old to
/// answer `IPluginFactory2`, or one listing no sub-categories, is not an
/// instrument: the same default the scanner falls back to.
pub fn class_is_instrument(factory: &ComPtr<IPluginFactory>, class_id: &TUID) -> bool {
    let Some(factory2) = factory.cast::<IPluginFactory2>() else {
        return false;
    };
    // SAFETY: `factory2` is a live reference `queryInterface` just returned.
    let count = unsafe { factory2.countClasses() };
    for index in 0..count {
        // SAFETY: `PClassInfo2` is a plain C struct of byte arrays and integers,
        // for which all-zero bytes are a valid value.
        let mut info: vst3::Steinberg::PClassInfo2 = unsafe { std::mem::zeroed() };
        // SAFETY: live factory; `info` is a local the plugin writes for the
        // call's duration only.
        if unsafe { factory2.getClassInfo2(index, &mut info) } != kResultOk {
            continue;
        }
        if !same_class_id(&info.cid, class_id) {
            continue;
        }
        let sub_categories = split_sub_categories(&read_char8(&info.subCategories));
        return category_from_vst3_sub_categories(&sub_categories) == "instrument";
    }
    false
}

/// Whether the factory itself lists this class.
///
/// Separate from `class_name`, which answers `None` for a class the factory does
/// list under an empty name. The two questions only look alike: a bundle whose
/// `moduleinfo.json` advertises a CID its factory does not implement is either
/// stale metadata or a file describing someone else's plugin, and asking such a
/// factory to instantiate that CID is handing untrusted bytes to a loader.
pub fn factory_declares_class(factory: &ComPtr<IPluginFactory>, class_id: &TUID) -> bool {
    // SAFETY: the `ComPtr` holds a reference on a live factory.
    let count = unsafe { factory.countClasses() };
    (0..count).any(|index| {
        // SAFETY: `PClassInfo` is a plain C struct of byte arrays and an
        // integer, for which all-zero bytes are a valid value.
        let mut info: vst3::Steinberg::PClassInfo = unsafe { std::mem::zeroed() };
        // SAFETY: live factory; `info` is a local the plugin writes for the
        // call's duration only.
        (unsafe { factory.getClassInfo(index, &mut info) }) == kResultOk
            && same_class_id(&info.cid, class_id)
    })
}

fn create_component(
    factory: &ComPtr<IPluginFactory>,
    class_id: &TUID,
    name: &str,
) -> Result<ComPtr<IComponent>, Vst3Error> {
    let mut object: *mut std::ffi::c_void = ptr::null_mut();
    let iid = crate::vst3_host::tuid_from_guid(&IComponent::IID);
    // SAFETY: the `ComPtr` holds a reference on a live factory; `class_id` and
    // `iid` are live 16-byte locals, and `object` is a live out-parameter.
    if unsafe { factory.createInstance(class_id.as_ptr(), iid.as_ptr(), &mut object) } != kResultOk
    {
        return Err(Vst3Error::FactoryRefusedComponent {
            name: name.to_string(),
        });
    }
    // SAFETY: a successful `createInstance` for `IComponent::IID` leaves in
    // `object` null or an owned `IComponent` reference, adopted here exactly once.
    unsafe { ComPtr::from_raw(object as *mut IComponent) }.ok_or_else(|| Vst3Error::NoComponent {
        name: name.to_string(),
    })
}

fn create_controller(
    factory: &ComPtr<IPluginFactory>,
    class_id: &TUID,
    name: &str,
) -> Result<ComPtr<IEditController>, Vst3Error> {
    let mut object: *mut std::ffi::c_void = ptr::null_mut();
    let iid = crate::vst3_host::tuid_from_guid(&IEditController::IID);
    // SAFETY: the `ComPtr` holds a reference on a live factory; `class_id` and
    // `iid` are live 16-byte locals, and `object` is a live out-parameter.
    if unsafe { factory.createInstance(class_id.as_ptr(), iid.as_ptr(), &mut object) } != kResultOk
    {
        return Err(Vst3Error::FactoryRefusedController {
            name: name.to_string(),
        });
    }
    // SAFETY: a successful `createInstance` for `IEditController::IID` leaves in
    // `object` null or an owned `IEditController` reference, adopted here once.
    unsafe { ComPtr::from_raw(object as *mut IEditController) }.ok_or_else(|| {
        Vst3Error::NoController {
            name: name.to_string(),
        }
    })
}

/// Activate event bus zero, when the component has one. Bus zero is the main bus
/// by VST3 convention, and a component with no event input is not an error.
///
/// # Safety
/// `component` must be initialised and inactive.
unsafe fn activate_first_event_bus(component: &ComPtr<IComponent>) {
    let media = MediaTypes_::kEvent as int32;
    let direction = BusDirections_::kInput as int32;
    // SAFETY: the `ComPtr` holds a reference on a live component, initialised
    // by this fn's contract.
    if unsafe { component.getBusCount(media, direction) } <= 0 {
        return;
    }
    // SAFETY: the component is initialised and inactive (this fn's contract), as
    // `activateBus` requires, and bus zero exists per the count just read.
    unsafe { component.activateBus(media, direction, 0, 1) };
}

/// Whether a `setProcessing(true)` answer means the plugin is processing.
///
/// `kNotImplemented` is the SDK's own default — `AudioEffect::setProcessing`
/// answers it — so a plugin that never overrode the call is telling the host it
/// has nothing to do on the transition, not refusing it. Reading it as a
/// refusal leaves every such plugin passing audio through unprocessed.
fn entered_processing(result: tresult) -> bool {
    result == kResultOk || result == kNotImplemented
}

/// The `ProcessData` of a parameter flush: no audio buses and no input events,
/// the host's parameter list in and the output lists the processor answers on. VST3 defines a `process` call with `numInputs` and
/// `numOutputs` zeroed as the host's way to deliver parameter changes without
/// audio.
fn flush_process_data(
    process_mode: int32,
    parameters: *mut IParameterChanges,
    output_parameters: *mut IParameterChanges,
    output_events: *mut IEventList,
) -> ProcessData {
    ProcessData {
        processMode: process_mode,
        symbolicSampleSize: SymbolicSampleSizes_::kSample32 as int32,
        numSamples: 0,
        numInputs: 0,
        numOutputs: 0,
        inputs: ptr::null_mut(),
        outputs: ptr::null_mut(),
        inputParameterChanges: parameters,
        outputParameterChanges: output_parameters,
        inputEvents: ptr::null_mut(),
        outputEvents: output_events,
        processContext: ptr::null_mut(),
    }
}

/// Copy the engine's channels into the main input bus's scratch for one block.
///
/// A main input narrower than the engine's pair hears the pair's average, which
/// is the stereo-to-mono downmix the Web Audio channel rules state for a mono
/// destination (`0.5 * (L + R)`) and what a mono-input plugin on a stereo
/// channel hears in an established DAW. Feeding it channel 0 alone would leave
/// anything panned right unheard. The average keeps a centred source at unity,
/// where an equal-power sum would raise it by 3 dB. The narrower output side
/// fans the other way (`process_block`), so a mono plugin on a stereo slot
/// takes the middle and returns to it.
///
/// RT-safe: plain loops over preallocated scratch.
fn fill_input_scratch(
    scratch: &mut [[f32; MAX_BUFFER]; CHANNELS],
    inputs: &[&[f32]],
    fed_channels: usize,
    samples: usize,
) {
    if let ([left, right, ..], 1) = (inputs, fed_channels) {
        let len = left.len().min(right.len()).min(samples);
        let downmix = scratch[0][..len]
            .iter_mut()
            .zip(left[..len].iter().zip(&right[..len]));
        for (sample, (left, right)) in downmix {
            *sample = 0.5 * (left + right);
        }
        scratch[0][len..samples].fill(0.0);
        scratch[1][..samples].fill(0.0);
        return;
    }

    for (channel, destination) in scratch.iter_mut().enumerate() {
        let source = inputs.get(channel).filter(|_| channel < fed_channels);
        let len = source.map_or(0, |source| source.len().min(samples));
        if let Some(source) = source {
            destination[..len].copy_from_slice(&source[..len]);
        }
        destination[len..samples].fill(0.0);
    }
}

/// One zeroed `AudioBusBuffers` per declared bus, allocated at activation so the
/// audio thread only ever refills them.
fn empty_bus_buffers(count: usize) -> Vec<AudioBusBuffers> {
    (0..count)
        // SAFETY: `AudioBusBuffers` is plain `repr(C)` data whose union member
        // is a pointer; all-zero is the "no channels, no buffers" value VST3
        // defines.
        .map(|_| unsafe { std::mem::zeroed::<AudioBusBuffers>() })
        .collect()
}

/// Refill the per-bus buffer descriptors in place for one block.
///
/// Only the main bus is fed: the host renders one stereo pair, so a sidechain or
/// an auxiliary output gets a null channel array with every one of its declared
/// channels flagged silent, which is how VST3 spells "this bus carries nothing
/// this block" without inventing buffers for it.
///
/// # Safety
/// `scratch` must address at least `HOST_CHANNELS` valid channel pointers that
/// outlive the `process` call these descriptors are handed to.
unsafe fn point_buses_at_scratch(
    buffers: &mut [AudioBusBuffers],
    geometry: &[BusGeometry],
    scratch: *mut *mut f32,
) {
    for (buffer, bus) in buffers.iter_mut().zip(geometry.iter()) {
        buffer.numChannels = bus.channels as int32;
        if bus.is_main && bus.channels > 0 {
            buffer.silenceFlags = 0;
            buffer.__field0.channelBuffers32 = scratch;
            continue;
        }
        buffer.silenceFlags = silent_channel_flags(bus.channels);
        buffer.__field0.channelBuffers32 = ptr::null_mut();
    }
}

/// The pointer VST3 reads a bus array from: the first element, or null when the
/// plugin declared no bus in that direction. An empty `Vec`'s `as_mut_ptr` is a
/// dangling non-null address, and handing that to a plugin alongside a zero count
/// invites it to be dereferenced anyway.
fn first_bus_pointer(buffers: &mut [AudioBusBuffers]) -> *mut AudioBusBuffers {
    if buffers.is_empty() {
        return ptr::null_mut();
    }
    buffers.as_mut_ptr()
}

/// The bytes the plugin wrote, or `None` when it refused to write any.
///
/// The distinction is the whole point: a refusal and an empty chunk are different
/// answers, and only the caller knows whether this particular refusal is fatal.
fn read_chunk(read: impl FnOnce(*mut IBStream) -> int32) -> Option<Vec<u8>> {
    let stream = ComWrapper::new(HostStream::empty());
    if read(borrowed_ptr::<_, IBStream>(&stream)) != kResultOk {
        return None;
    }
    Some(stream.snapshot())
}

/// Hand the plugin a stream over `bytes` and return its verdict on them.
fn write_chunk(bytes: &[u8], write: impl FnOnce(*mut IBStream) -> int32) -> int32 {
    let stream = ComWrapper::new(HostStream::over(bytes));
    write(borrowed_ptr::<_, IBStream>(&stream))
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

fn vst3_process_mode(mode: ProcessMode) -> int32 {
    match mode {
        ProcessMode::Realtime => ProcessModes_::kRealtime as int32,
        ProcessMode::Offline => ProcessModes_::kOffline as int32,
    }
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

    // The flag constants are `c_int` on Windows and `c_uint` elsewhere, while
    // the field is always `u32`; reinterpreting the bytes is the same bits.
    target.state = u32::from_ne_bytes(state.to_ne_bytes());
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
