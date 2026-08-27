//! The host side of a VST3 connection: the objects a plugin is given, and the
//! state it writes through them.
//!
//! A VST3 plugin talks back to its host through three objects it never
//! allocates: `IHostApplication` (identity, and the factory for the shared
//! objects the format lets a plugin ask the host for), `IPlugInterfaceSupport`
//! (which optional host interfaces exist), and `IComponentHandler` (parameter
//! gestures and restart requests). All three live here, together with
//! [`Vst3HostState`] — the record of everything a plugin has told the host that
//! the host has not acted on yet.
//!
//! Nothing here calls back into the plugin.
//!
//! What each object may do is set by the thread VST3 binds it to, and the two
//! groups differ:
//!
//! * `IComponentHandler` is the *controller's* handler, and the format binds the
//!   controller to the UI thread. Its methods are still written lock-free and
//!   allocation-free — a plugin that ignores that rule and edits from its
//!   processor then costs this host nothing, which is why the gesture and
//!   deferred-message queues are fixed-size slot arrays rather than channels.
//! * `IHostApplication::createInstance`, and the `IMessage` and `IAttributeList`
//!   it returns, allocate and lock. They have to: the plugin owns the lifetime of
//!   the object it asks for, so the host cannot hand out preallocated storage,
//!   and an attribute list is a keyed map by definition. VST3 expects a plugin to
//!   compose messages off its processing path for exactly this reason.
//!
//! Sourdaw's own audio thread reaches none of this.

use crate::traits::{HostParameterUpdate, LatencyChangeNotifier};
use std::collections::BTreeMap;
use std::ffi::{c_void, CStr, CString};
use std::sync::atomic::{
    AtomicBool, AtomicI32, AtomicPtr, AtomicU32, AtomicU64, AtomicU8, Ordering,
};
use std::sync::{Mutex, OnceLock};
use vst3::com_scrape_types::Guid;
use vst3::Steinberg::Linux::IRunLoop;
use vst3::Steinberg::Vst::{
    IAttributeList, IAttributeListTrait, IAttributeList_::AttrID, IComponentHandler,
    IComponentHandlerTrait, IHostApplication, IHostApplicationTrait, IMessage, IMessageTrait,
    IParamValueQueue, IParameterChanges, IPlugInterfaceSupport, IPlugInterfaceSupportTrait,
    ParamID, ParamValue, RestartFlags_, String128,
};
use vst3::Steinberg::{
    int32, kInvalidArgument, kNotImplemented, kResultFalse, kResultOk, tresult, uint32, FIDString,
    FUnknown, IBStream, IPlugFrame, IPlugView, TUID,
};
use vst3::{Class, ComPtr, ComWrapper, Interface};

/// The most parameter gestures the host will carry from one editor pass into
/// one audio block.
///
/// A bound rather than a queue that grows, because the enqueue side is reachable
/// from a plugin's own threads and the drain side is the audio thread: neither
/// may allocate. A knob drag produces one gesture per parameter per pass — the
/// slots coalesce by parameter id — so this is a ceiling on *distinct*
/// parameters moved between two blocks, not on mouse events.
const MAX_PARAMETER_GESTURES: usize = 64;

/// The most off-thread `IConnectionPoint` messages the host will hold for the
/// control path to deliver.
const MAX_DEFERRED_MESSAGES: usize = 32;

const SLOT_EMPTY: u8 = 0;
const SLOT_WRITING: u8 = 1;
const SLOT_READY: u8 = 2;

// ── Parameter gestures ──────────────────────────────────────────────────

struct GestureSlot {
    param_id: AtomicU32,
    value_bits: AtomicU64,
    state: AtomicU8,
}

impl GestureSlot {
    fn new() -> Self {
        Self {
            param_id: AtomicU32::new(0),
            value_bits: AtomicU64::new(0),
            state: AtomicU8::new(SLOT_EMPTY),
        }
    }
}

/// The editor gestures a plugin has performed that the processor has not seen.
///
/// VST3 forbids the processor and the controller from talking to each other, so
/// a value the user moved in the editor reaches the DSP only if the host carries
/// it — as a point on an `IParamValueQueue` inside the next block's
/// `inputParameterChanges`. This is where it waits in between.
struct ParameterGestureQueue {
    slots: [GestureSlot; MAX_PARAMETER_GESTURES],
}

impl ParameterGestureQueue {
    fn new() -> Self {
        Self {
            slots: std::array::from_fn(|_| GestureSlot::new()),
        }
    }

    /// Record one `performEdit`. A parameter already waiting is overwritten
    /// rather than queued behind itself: the processor is owed the value the
    /// user landed on, and a drag that outran the block rate would otherwise
    /// fill the queue with values nobody will ever hear.
    fn record(&self, param_id: ParamID, value: ParamValue) {
        let value_bits = value.to_bits();
        if self.overwrite(param_id, value_bits) {
            return;
        }

        for slot in &self.slots {
            if slot
                .state
                .compare_exchange(
                    SLOT_EMPTY,
                    SLOT_WRITING,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                )
                .is_err()
            {
                continue;
            }
            slot.param_id.store(param_id, Ordering::Relaxed);
            slot.value_bits.store(value_bits, Ordering::Relaxed);
            slot.state.store(SLOT_READY, Ordering::Release);
            return;
        }

        // Every slot is taken by a different parameter and the drain has not
        // run. Retry the overwrite once — a slot may have been claimed by this
        // same parameter in between — and otherwise drop the gesture, which is
        // the only option that does not allocate here.
        self.overwrite(param_id, value_bits);
    }

    fn overwrite(&self, param_id: ParamID, value_bits: u64) -> bool {
        for slot in &self.slots {
            if slot.state.load(Ordering::Acquire) != SLOT_READY
                || slot.param_id.load(Ordering::Relaxed) != param_id
            {
                continue;
            }
            if slot
                .state
                .compare_exchange(
                    SLOT_READY,
                    SLOT_WRITING,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                )
                .is_err()
            {
                continue;
            }
            slot.value_bits.store(value_bits, Ordering::Relaxed);
            slot.state.store(SLOT_READY, Ordering::Release);
            return true;
        }
        false
    }

    /// Move every waiting gesture into `out`, in ascending parameter id.
    ///
    /// Ordered because `IParameterChanges` is read by index and a plugin is
    /// entitled to assume one queue per parameter: emitting the same id twice in
    /// one block, or in an order that varies between blocks, makes the automation
    /// a plugin sees depend on which slot happened to be free.
    fn drain(&self, out: &mut [HostParameterUpdate]) -> usize {
        let mut count = 0;
        for slot in &self.slots {
            if count >= out.len() {
                break;
            }
            if slot
                .state
                .compare_exchange(
                    SLOT_READY,
                    SLOT_WRITING,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                )
                .is_err()
            {
                continue;
            }
            out[count] = HostParameterUpdate {
                param_id: slot.param_id.load(Ordering::Relaxed),
                value: f64::from_bits(slot.value_bits.load(Ordering::Relaxed)),
            };
            count += 1;
            slot.state.store(SLOT_EMPTY, Ordering::Release);
        }
        // Unstable because it is the only sort with no allocating path, and this
        // runs on the audio thread. Nothing is lost by it: a slot coalesces per
        // parameter, so no two drained updates share a `param_id` and there is
        // no equal-key order for a stable sort to preserve.
        out[..count].sort_unstable_by_key(|update| update.param_id);
        count
    }
}

// ── Deferred connection-point messages ──────────────────────────────────

/// One `IConnectionPoint::notify` the host accepted on a thread that must not
/// deliver it.
///
/// The SDK's own connection proxy drops these. A silent drop is indistinguishable
/// from a plugin bug — the component believes it told the controller something —
/// so they are held here and delivered by the control path instead.
struct DeferredMessage {
    message: AtomicPtr<IMessage>,
    /// True when the message is bound for the controller, false for the
    /// component. A message must arrive at the peer of whoever raised it.
    to_controller: AtomicBool,
    state: AtomicU8,
}

impl DeferredMessage {
    fn new() -> Self {
        Self {
            message: AtomicPtr::new(std::ptr::null_mut()),
            to_controller: AtomicBool::new(false),
            state: AtomicU8::new(SLOT_EMPTY),
        }
    }
}

/// Where a deferred message is going.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageTarget {
    Component,
    Controller,
}

/// A message the control path took ownership of, with its destination.
pub struct PendingMessage {
    pub target: MessageTarget,
    pub message: ComPtr<IMessage>,
}

// ── Host state ──────────────────────────────────────────────────────────

/// Everything a plugin has told this host that the host has not acted on.
///
/// Shared between the host objects a plugin holds and the wrapper that owns
/// them, so a plugin's callback never has to reach the wrapper — which is what
/// keeps the callbacks free of locks a control thread could be holding.
pub struct Vst3HostState {
    latency_dirty: AtomicBool,
    parameter_values_dirty: AtomicBool,
    parameter_titles_dirty: AtomicBool,
    /// Every `restartComponent` flag this host does not act on, accumulated.
    ///
    /// Recorded rather than ignored: a flag nobody handles and nobody counted is
    /// a behaviour difference with no evidence of itself.
    unhandled_restart_flags: AtomicI32,
    latency_notifier: OnceLock<LatencyChangeNotifier>,
    gestures: ParameterGestureQueue,
    deferred_messages: [DeferredMessage; MAX_DEFERRED_MESSAGES],
}

impl Default for Vst3HostState {
    fn default() -> Self {
        Self {
            latency_dirty: AtomicBool::new(false),
            parameter_values_dirty: AtomicBool::new(false),
            parameter_titles_dirty: AtomicBool::new(false),
            unhandled_restart_flags: AtomicI32::new(0),
            latency_notifier: OnceLock::new(),
            gestures: ParameterGestureQueue::new(),
            deferred_messages: std::array::from_fn(|_| DeferredMessage::new()),
        }
    }
}

impl Vst3HostState {
    /// Install the wake fired when this plugin flags a latency change. First
    /// install wins, so the wake cannot be hijacked mid-life.
    pub fn set_latency_notifier(&self, notifier: LatencyChangeNotifier) -> bool {
        self.latency_notifier.set(notifier).is_ok()
    }

    pub fn take_latency_dirty(&self) -> bool {
        self.latency_dirty.swap(false, Ordering::AcqRel)
    }

    pub fn clear_latency_dirty(&self) {
        self.latency_dirty.store(false, Ordering::Release);
    }

    pub fn take_parameter_values_dirty(&self) -> bool {
        self.parameter_values_dirty.swap(false, Ordering::AcqRel)
    }

    pub fn take_parameter_titles_dirty(&self) -> bool {
        self.parameter_titles_dirty.swap(false, Ordering::AcqRel)
    }

    /// The restart flags this host has been asked for and does not act on.
    pub fn unhandled_restart_flags(&self) -> i32 {
        self.unhandled_restart_flags.load(Ordering::Acquire)
    }

    /// Record an editor gesture. Callable from any thread.
    pub fn record_parameter_edit(&self, param_id: ParamID, value: ParamValue) {
        self.gestures.record(param_id, value);
    }

    /// Move waiting gestures into `out`. **Audio thread.** Allocation-free.
    pub fn drain_parameter_edits(&self, out: &mut [HostParameterUpdate]) -> usize {
        self.gestures.drain(out)
    }

    /// Record what `restartComponent` asked for.
    ///
    /// Split from the handler so the flag rules can be read, and tested, without
    /// a COM object: which flags this host acts on is a hosting decision, not a
    /// property of the vtable.
    pub fn record_restart(&self, flags: int32) {
        if flags & RestartFlags_::kLatencyChanged as i32 != 0 {
            self.latency_dirty.store(true, Ordering::Release);
        }
        if flags & RestartFlags_::kParamValuesChanged as i32 != 0 {
            self.parameter_values_dirty.store(true, Ordering::Release);
        }
        if flags & RestartFlags_::kParamTitlesChanged as i32 != 0 {
            self.parameter_titles_dirty.store(true, Ordering::Release);
        }

        let handled = RestartFlags_::kLatencyChanged as i32
            | RestartFlags_::kParamValuesChanged as i32
            | RestartFlags_::kParamTitlesChanged as i32;
        self.unhandled_restart_flags
            .fetch_or(flags & !handled, Ordering::AcqRel);

        // Wake only once the flags are visible, so an observer this call wakes
        // sees the change it is being woken for. The wake itself may allocate,
        // and may because `restartComponent` reaches this host through
        // `IComponentHandler` — the controller's interface, which VST3 binds to
        // the UI thread. The flags above are set first and unconditionally, so a
        // plugin that flags from somewhere else still has its change picked up by
        // the next control-path visit even if the wake is the wrong thing to do
        // there.
        if flags & RestartFlags_::kLatencyChanged as i32 != 0 {
            if let Some(notify) = self.latency_notifier.get() {
                notify();
            }
        }
    }

    /// Take ownership of a message raised on a thread that must not deliver it.
    ///
    /// Returns false when the deferral buffer is full, which is the one case the
    /// caller must report rather than swallow.
    pub(crate) fn defer_message(&self, target: MessageTarget, message: ComPtr<IMessage>) -> bool {
        for slot in &self.deferred_messages {
            if slot
                .state
                .compare_exchange(
                    SLOT_EMPTY,
                    SLOT_WRITING,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                )
                .is_err()
            {
                continue;
            }
            slot.to_controller
                .store(target == MessageTarget::Controller, Ordering::Relaxed);
            slot.message.store(message.into_raw(), Ordering::Relaxed);
            slot.state.store(SLOT_READY, Ordering::Release);
            return true;
        }
        false
    }

    /// Hand every deferred message to the caller, which is expected to be on the
    /// thread allowed to deliver them. Control path only.
    pub fn take_deferred_messages(&self) -> Vec<PendingMessage> {
        let mut taken = Vec::new();
        for slot in &self.deferred_messages {
            if slot
                .state
                .compare_exchange(
                    SLOT_READY,
                    SLOT_WRITING,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                )
                .is_err()
            {
                continue;
            }
            let raw = slot.message.swap(std::ptr::null_mut(), Ordering::Relaxed);
            let target = if slot.to_controller.load(Ordering::Relaxed) {
                MessageTarget::Controller
            } else {
                MessageTarget::Component
            };
            slot.state.store(SLOT_EMPTY, Ordering::Release);
            if let Some(message) = unsafe { ComPtr::from_raw(raw) } {
                taken.push(PendingMessage { target, message });
            }
        }
        taken
    }
}

impl Drop for Vst3HostState {
    fn drop(&mut self) {
        // Undelivered messages still hold a reference each. Taking them here
        // releases those references rather than leaking one per message.
        let _ = self.take_deferred_messages();
    }
}

// ── IComponentHandler ───────────────────────────────────────────────────

/// The handler a plugin's controller writes its edits and restart requests to.
pub struct Vst3ComponentHandler {
    state: std::sync::Arc<Vst3HostState>,
}

impl Vst3ComponentHandler {
    pub fn new(state: std::sync::Arc<Vst3HostState>) -> Self {
        Self { state }
    }
}

impl Class for Vst3ComponentHandler {
    type Interfaces = (IComponentHandler,);
}

impl IComponentHandlerTrait for Vst3ComponentHandler {
    /// The gesture boundary. Sourdaw has no automation-write target yet
    /// (packet 4), so there is nothing to open here — and answering `kResultOk`
    /// is the truth about what the host did with the call, not a claim that a
    /// write is recording.
    unsafe fn beginEdit(&self, _id: ParamID) -> tresult {
        kResultOk
    }

    unsafe fn performEdit(&self, id: ParamID, value_normalized: ParamValue) -> tresult {
        if !value_normalized.is_finite() {
            return kInvalidArgument;
        }
        self.state.record_parameter_edit(id, value_normalized);
        kResultOk
    }

    unsafe fn endEdit(&self, _id: ParamID) -> tresult {
        kResultOk
    }

    unsafe fn restartComponent(&self, flags: int32) -> tresult {
        self.state.record_restart(flags);
        kResultOk
    }
}

// ── IHostApplication / IPlugInterfaceSupport ────────────────────────────

static HOST_NAME: &str = "Sourdaw";

/// The host object a component and a controller are `initialize`d with.
///
/// It is also the only allocator a plugin has for the shared objects the format
/// lets it ask for. `IMessage` is the one that matters: a component that cannot
/// allocate a message cannot say anything to its controller at all, so refusing
/// `createInstance` outright would silently disable every plugin that
/// communicates between its two halves.
pub struct Vst3HostApplication;

impl Class for Vst3HostApplication {
    type Interfaces = (IHostApplication, IPlugInterfaceSupport);
}

impl IHostApplicationTrait for Vst3HostApplication {
    unsafe fn getName(&self, name: *mut String128) -> tresult {
        if name.is_null() {
            return kInvalidArgument;
        }
        write_string128(&mut *name, HOST_NAME);
        kResultOk
    }

    unsafe fn createInstance(
        &self,
        cid: *mut TUID,
        _iid: *mut TUID,
        obj: *mut *mut c_void,
    ) -> tresult {
        if cid.is_null() || obj.is_null() {
            return kInvalidArgument;
        }
        if !tuid_matches(&*cid, &IMessage::IID) {
            return kNotImplemented;
        }
        let Some(message) = ComWrapper::new(Vst3Message::default()).to_com_ptr::<IMessage>() else {
            return kNotImplemented;
        };
        *obj = message.into_raw() as *mut c_void;
        kResultOk
    }
}

impl IPlugInterfaceSupportTrait for Vst3HostApplication {
    /// Answered from the list of interfaces this host actually implements.
    ///
    /// A host that answers `kResultTrue` to everything is telling plugins to
    /// take paths it cannot serve; one that answers `kNotImplemented` is telling
    /// them nothing. Both are worse than the list. `IWaylandHost` and
    /// `IWaylandFrame` are absent because this host has no Wayland embedding
    /// path, and claiming them would send a plugin down a route that ends in a
    /// host with no surface to attach to.
    unsafe fn isPlugInterfaceSupported(&self, _iid: *const TUID) -> tresult {
        if _iid.is_null() {
            return kInvalidArgument;
        }
        let supported = [
            IComponentHandler::IID,
            IHostApplication::IID,
            IPlugInterfaceSupport::IID,
            IParameterChanges::IID,
            IParamValueQueue::IID,
            IMessage::IID,
            IAttributeList::IID,
            IBStream::IID,
            // The editor path: the host hosts an `IPlugView` and gives it an
            // `IPlugFrame` of its own (`crate::vst3_editor`).
            IPlugView::IID,
            IPlugFrame::IID,
        ];
        if supported
            .iter()
            .any(|candidate| tuid_matches(&*_iid, candidate))
        {
            return kResultOk;
        }
        // Only Linux advertises a run loop, for the same reason the frame only
        // answers `queryInterface` for one there.
        if cfg!(target_os = "linux") && tuid_matches(&*_iid, &IRunLoop::IID) {
            return kResultOk;
        }
        kResultFalse
    }
}

/// Whether a 16-byte class or interface id names the given interface.
///
/// `TUID` is a `c_char` array and a `Guid` is a `u8` array of the same bytes;
/// the platform-dependent byte order the format uses is already baked into both,
/// so this compares them as raw bytes and nothing reorders anything.
fn tuid_matches(candidate: &TUID, iid: &Guid) -> bool {
    candidate
        .iter()
        .zip(iid.iter())
        .all(|(left, right)| *left as u8 == *right)
}

/// The `TUID` spelling of an interface id, for the calls that take one.
pub fn tuid_from_guid(iid: &Guid) -> TUID {
    let mut tuid: TUID = [0; 16];
    for (slot, byte) in tuid.iter_mut().zip(iid.iter()) {
        *slot = *byte as std::ffi::c_char;
    }
    tuid
}

/// Write a UTF-8 string into a VST3 `String128`, truncating at the buffer and
/// always leaving it null-terminated.
fn write_string128(target: &mut String128, value: &str) {
    let mut index = 0;
    for unit in value.encode_utf16() {
        if index + 1 >= target.len() {
            break;
        }
        target[index] = unit;
        index += 1;
    }
    target[index] = 0;
}

/// Read a VST3 `String128` back as a Rust string, stopping at the terminator.
pub fn read_string128(value: &String128) -> String {
    let length = value
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..length])
}

// ── Host-provided IMessage / IAttributeList ─────────────────────────────

#[derive(Clone)]
enum AttributeValue {
    Int(i64),
    Float(f64),
    String(Vec<u16>),
    Binary(Vec<u8>),
}

/// The host's `IAttributeList`, handed out as part of an `IMessage`.
///
/// Locks, and cannot not: it is a keyed map the plugin writes and reads through
/// a shared reference, and both halves of the plugin may hold one at once. The
/// thread it is touched from is the plugin's choice — whichever one composed or
/// read the message — so this is not on Sourdaw's audio path but may be on the
/// plugin's, which is why VST3 tells a plugin to compose messages elsewhere.
/// Delivery is separate and always lands on the control path; see
/// [`Vst3HostState::take_deferred_messages`].
#[derive(Default)]
pub struct Vst3AttributeList {
    entries: Mutex<BTreeMap<Vec<u8>, AttributeValue>>,
    /// The last binary value handed out through `getBinary`, which returns a
    /// borrowed pointer the caller reads before the next call. Held so that
    /// pointer stays valid for exactly that long.
    borrowed_binary: Mutex<Vec<u8>>,
}

impl Class for Vst3AttributeList {
    type Interfaces = (IAttributeList,);
}

fn attribute_key(id: AttrID) -> Option<Vec<u8>> {
    if id.is_null() {
        return None;
    }
    Some(unsafe { CStr::from_ptr(id) }.to_bytes().to_vec())
}

impl Vst3AttributeList {
    fn set(&self, id: AttrID, value: AttributeValue) -> tresult {
        let Some(key) = attribute_key(id) else {
            return kInvalidArgument;
        };
        let Ok(mut entries) = self.entries.lock() else {
            return kInvalidArgument;
        };
        entries.insert(key, value);
        kResultOk
    }

    fn get(&self, id: AttrID) -> Option<AttributeValue> {
        let key = attribute_key(id)?;
        let entries = self.entries.lock().ok()?;
        entries.get(&key).cloned()
    }
}

impl IAttributeListTrait for Vst3AttributeList {
    unsafe fn setInt(&self, id: AttrID, value: i64) -> tresult {
        self.set(id, AttributeValue::Int(value))
    }

    unsafe fn getInt(&self, id: AttrID, value: *mut i64) -> tresult {
        if value.is_null() {
            return kInvalidArgument;
        }
        match self.get(id) {
            Some(AttributeValue::Int(stored)) => {
                *value = stored;
                kResultOk
            }
            _ => kResultFalse,
        }
    }

    unsafe fn setFloat(&self, id: AttrID, value: f64) -> tresult {
        self.set(id, AttributeValue::Float(value))
    }

    unsafe fn getFloat(&self, id: AttrID, value: *mut f64) -> tresult {
        if value.is_null() {
            return kInvalidArgument;
        }
        match self.get(id) {
            Some(AttributeValue::Float(stored)) => {
                *value = stored;
                kResultOk
            }
            _ => kResultFalse,
        }
    }

    unsafe fn setString(&self, id: AttrID, string: *const u16) -> tresult {
        if string.is_null() {
            return kInvalidArgument;
        }
        let mut units = Vec::new();
        let mut cursor = string;
        while *cursor != 0 {
            units.push(*cursor);
            cursor = cursor.add(1);
        }
        self.set(id, AttributeValue::String(units))
    }

    unsafe fn getString(&self, id: AttrID, string: *mut u16, size_in_bytes: uint32) -> tresult {
        if string.is_null() || size_in_bytes < 2 {
            return kInvalidArgument;
        }
        let Some(AttributeValue::String(stored)) = self.get(id) else {
            return kResultFalse;
        };
        let capacity = (size_in_bytes as usize / 2).saturating_sub(1);
        let length = stored.len().min(capacity);
        std::ptr::copy_nonoverlapping(stored.as_ptr(), string, length);
        *string.add(length) = 0;
        kResultOk
    }

    unsafe fn setBinary(&self, id: AttrID, data: *const c_void, size_in_bytes: uint32) -> tresult {
        if data.is_null() {
            return kInvalidArgument;
        }
        let bytes = std::slice::from_raw_parts(data as *const u8, size_in_bytes as usize).to_vec();
        self.set(id, AttributeValue::Binary(bytes))
    }

    unsafe fn getBinary(
        &self,
        id: AttrID,
        data: *mut *const c_void,
        size_in_bytes: *mut uint32,
    ) -> tresult {
        if data.is_null() || size_in_bytes.is_null() {
            return kInvalidArgument;
        }
        let Some(AttributeValue::Binary(stored)) = self.get(id) else {
            return kResultFalse;
        };
        let Ok(mut borrowed) = self.borrowed_binary.lock() else {
            return kInvalidArgument;
        };
        *borrowed = stored;
        *data = borrowed.as_ptr() as *const c_void;
        *size_in_bytes = borrowed.len() as uint32;
        kResultOk
    }
}

/// The host's `IMessage`, the envelope a component sends its controller.
pub struct Vst3Message {
    id: Mutex<Option<CString>>,
    /// `getAttributes` returns a *borrowed* pointer by the format's rule, so the
    /// list is owned here for the message's whole life and handed out without a
    /// reference-count change.
    attributes: ComWrapper<Vst3AttributeList>,
}

impl Default for Vst3Message {
    fn default() -> Self {
        Self {
            id: Mutex::new(None),
            attributes: ComWrapper::new(Vst3AttributeList::default()),
        }
    }
}

impl Class for Vst3Message {
    type Interfaces = (IMessage,);
}

impl IMessageTrait for Vst3Message {
    unsafe fn getMessageID(&self) -> FIDString {
        let Ok(id) = self.id.lock() else {
            return std::ptr::null();
        };
        match id.as_ref() {
            Some(id) => id.as_ptr(),
            None => std::ptr::null(),
        }
    }

    unsafe fn setMessageID(&self, id: FIDString) {
        let Ok(mut stored) = self.id.lock() else {
            return;
        };
        *stored = if id.is_null() {
            None
        } else {
            Some(CStr::from_ptr(id).to_owned())
        };
    }

    unsafe fn getAttributes(&self) -> *mut IAttributeList {
        self.attributes
            .as_com_ref::<IAttributeList>()
            .map(|list| list.as_ptr())
            .unwrap_or(std::ptr::null_mut())
    }
}

// ── The host objects one hosted plugin holds ────────────────────────────

/// The host context one hosted VST3 plugin is given, and the state behind it.
///
/// Owned by the wrapper (and by the scanner, which needs a host context to
/// `initialize` an instance at all). Every COM object here outlives the plugin
/// that holds a reference to it, which is what the ownership order in
/// `Vst3Wrapper` exists to guarantee.
pub struct Vst3HostContext {
    pub state: std::sync::Arc<Vst3HostState>,
    application: ComWrapper<Vst3HostApplication>,
    handler: ComWrapper<Vst3ComponentHandler>,
}

impl Vst3HostContext {
    pub fn new() -> Self {
        let state = std::sync::Arc::new(Vst3HostState::default());
        Self {
            application: ComWrapper::new(Vst3HostApplication),
            handler: ComWrapper::new(Vst3ComponentHandler::new(std::sync::Arc::clone(&state))),
            state,
        }
    }

    /// The `FUnknown` a plugin is `initialize`d with.
    ///
    /// Borrowed, not owned: `initialize` and `setComponentHandler` both retain
    /// what they are given if they need it, and handing them an owned reference
    /// would leak one per call.
    pub fn as_unknown(&self) -> *mut FUnknown {
        self.application
            .as_com_ref::<FUnknown>()
            .map(|pointer| pointer.as_ptr())
            .unwrap_or(std::ptr::null_mut())
    }

    /// The handler a controller is given through `setComponentHandler`.
    pub fn component_handler(&self) -> *mut IComponentHandler {
        self.handler
            .as_com_ref::<IComponentHandler>()
            .map(|pointer| pointer.as_ptr())
            .unwrap_or(std::ptr::null_mut())
    }

    /// Accept a message raised off the delivering thread. See
    /// [`Vst3HostState::take_deferred_messages`].
    pub fn defer_message(&self, target: MessageTarget, message: ComPtr<IMessage>) -> bool {
        self.state.defer_message(target, message)
    }
}

impl Default for Vst3HostContext {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drained(state: &Vst3HostState) -> Vec<HostParameterUpdate> {
        let mut buffer = [HostParameterUpdate::default(); MAX_PARAMETER_GESTURES];
        let count = state.drain_parameter_edits(&mut buffer);
        buffer[..count].to_vec()
    }

    /// The processor never hears from the controller. A gesture that does not
    /// reach the block's `inputParameterChanges` is a knob the user moved and
    /// the DSP never saw.
    #[test]
    fn an_editor_gesture_reaches_the_next_block_as_a_parameter_update() {
        let state = Vst3HostState::default();

        state.record_parameter_edit(7, 0.25);

        assert_eq!(
            drained(&state),
            vec![HostParameterUpdate {
                param_id: 7,
                value: 0.25
            }]
        );
        assert!(
            drained(&state).is_empty(),
            "a drained gesture is not delivered twice"
        );
    }

    /// A plugin reads `IParameterChanges` by index and expects one queue per
    /// parameter. Emitting ids in whatever order the slots freed up makes the
    /// automation a plugin sees depend on allocation order.
    #[test]
    fn drained_gestures_are_ordered_by_parameter_id() {
        let state = Vst3HostState::default();

        state.record_parameter_edit(9, 0.9);
        state.record_parameter_edit(1, 0.1);
        state.record_parameter_edit(5, 0.5);

        assert_eq!(
            drained(&state)
                .iter()
                .map(|update| update.param_id)
                .collect::<Vec<_>>(),
            vec![1, 5, 9]
        );
    }

    /// A drag produces far more gestures than there are blocks. The processor
    /// is owed the value the knob landed on, and one slot per parameter is what
    /// keeps a drag from evicting every other parameter in the queue.
    #[test]
    fn repeated_edits_of_one_parameter_collapse_to_the_latest_value() {
        let state = Vst3HostState::default();

        for step in 0..500 {
            state.record_parameter_edit(3, f64::from(step) / 1000.0);
        }
        state.record_parameter_edit(4, 1.0);

        assert_eq!(
            drained(&state),
            vec![
                HostParameterUpdate {
                    param_id: 3,
                    value: 0.499
                },
                HostParameterUpdate {
                    param_id: 4,
                    value: 1.0
                },
            ]
        );
    }

    #[test]
    fn a_latency_restart_flags_the_instance_and_wakes_the_observer() {
        use std::sync::atomic::AtomicUsize;
        use std::sync::Arc;

        let state = Vst3HostState::default();
        let wakes = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&wakes);
        assert!(state.set_latency_notifier(Box::new(move || {
            counter.fetch_add(1, Ordering::Relaxed);
        })));

        state.record_restart(RestartFlags_::kLatencyChanged as i32);

        assert_eq!(wakes.load(Ordering::Relaxed), 1);
        assert!(state.take_latency_dirty());
        assert!(!state.take_latency_dirty(), "take clears the flag");
    }

    /// Two flags this host acts on and one it does not. The unhandled one is
    /// recorded rather than dropped, so "we do not handle that" is a fact with
    /// evidence instead of a silent difference in behaviour.
    #[test]
    fn restart_flags_are_split_into_handled_and_recorded_unhandled() {
        let state = Vst3HostState::default();
        let unhandled = RestartFlags_::kIoChanged as i32;

        state.record_restart(
            RestartFlags_::kParamValuesChanged as i32
                | RestartFlags_::kParamTitlesChanged as i32
                | unhandled,
        );

        assert!(state.take_parameter_values_dirty());
        assert!(state.take_parameter_titles_dirty());
        assert!(!state.take_latency_dirty());
        assert_eq!(state.unhandled_restart_flags(), unhandled);
    }

    #[test]
    fn a_non_finite_edit_is_refused_rather_than_queued() {
        let handler_state = std::sync::Arc::new(Vst3HostState::default());
        let handler = Vst3ComponentHandler::new(std::sync::Arc::clone(&handler_state));

        let refusal = unsafe { handler.performEdit(1, f64::NAN) };

        assert_eq!(refusal, kInvalidArgument);
        assert!(drained(&handler_state).is_empty());
    }

    #[test]
    fn the_host_names_itself_to_the_plugin() {
        let mut name: String128 = [0; 128];
        let application = Vst3HostApplication;

        assert_eq!(unsafe { application.getName(&mut name) }, kResultOk);
        assert_eq!(read_string128(&name), "Sourdaw");
    }

    /// A component that cannot allocate a message cannot talk to its controller
    /// at all, so this is the one class the host must be able to create.
    #[test]
    fn the_host_creates_the_message_class_a_plugin_asks_for() {
        let application = Vst3HostApplication;
        let mut cid = tuid_from_guid(&IMessage::IID);
        let mut iid = tuid_from_guid(&IMessage::IID);
        let mut object: *mut c_void = std::ptr::null_mut();

        let created = unsafe {
            application.createInstance(&mut cid, &mut iid, &mut object as *mut *mut c_void)
        };

        assert_eq!(created, kResultOk);
        assert!(!object.is_null());
        let message = unsafe { ComPtr::<IMessage>::from_raw(object as *mut IMessage) }
            .expect("the created object is a message");
        let id = CString::new("sourdaw.test").expect("a literal has no null byte");
        unsafe { message.setMessageID(id.as_ptr()) };
        let read = unsafe { CStr::from_ptr(message.getMessageID()) };
        assert_eq!(read, id.as_c_str());
    }

    #[test]
    fn the_host_refuses_a_class_it_does_not_implement() {
        let application = Vst3HostApplication;
        let mut cid: TUID = [7; 16];
        let mut iid: TUID = [7; 16];
        let mut object: *mut c_void = std::ptr::null_mut();

        assert_eq!(
            unsafe { application.createInstance(&mut cid, &mut iid, &mut object) },
            kNotImplemented
        );
    }

    /// Answering "supported" to everything sends plugins down paths this host
    /// cannot serve.
    #[test]
    fn interface_support_answers_from_the_list_the_host_implements() {
        let application = Vst3HostApplication;
        let as_tuid = tuid_from_guid;

        let supported = as_tuid(&IComponentHandler::IID);
        assert_eq!(
            unsafe { application.isPlugInterfaceSupported(&supported) },
            kResultOk
        );

        // The editor path is implemented, so a plugin that asks whether it can
        // put a view up gets a true answer rather than a refusal.
        let view = as_tuid(&IPlugView::IID);
        assert_eq!(
            unsafe { application.isPlugInterfaceSupported(&view) },
            kResultOk
        );

        let wayland = as_tuid(&vst3::Steinberg::IWaylandHost::IID);
        assert_eq!(
            unsafe { application.isPlugInterfaceSupported(&wayland) },
            kResultFalse,
            "no Wayland embedding path is implemented, and claiming one would be a lie"
        );
    }

    /// The run loop is the one host interface whose availability is a platform
    /// fact rather than a code fact: on Linux an editor cannot run without it,
    /// and everywhere else the platform's own loop already runs the editor.
    #[test]
    fn run_loop_support_is_answered_per_platform() {
        let application = Vst3HostApplication;
        let run_loop = tuid_from_guid(&IRunLoop::IID);

        let expected = if cfg!(target_os = "linux") {
            kResultOk
        } else {
            kResultFalse
        };
        assert_eq!(
            unsafe { application.isPlugInterfaceSupported(&run_loop) },
            expected
        );
    }

    #[test]
    fn a_deferred_message_is_handed_to_the_control_path_with_its_destination() {
        let context = Vst3HostContext::new();
        let message = ComWrapper::new(Vst3Message::default())
            .to_com_ptr::<IMessage>()
            .expect("a host message implements IMessage");

        assert!(context.defer_message(MessageTarget::Controller, message));

        let taken = context.state.take_deferred_messages();
        assert_eq!(taken.len(), 1);
        assert_eq!(taken[0].target, MessageTarget::Controller);
        assert!(
            context.state.take_deferred_messages().is_empty(),
            "a delivered message is not delivered twice"
        );
    }

    #[test]
    fn an_attribute_list_round_trips_every_value_kind() {
        let list = Vst3AttributeList::default();
        let key = CString::new("value").expect("a literal has no null byte");

        unsafe {
            assert_eq!(list.setInt(key.as_ptr(), -12), kResultOk);
            let mut integer = 0i64;
            assert_eq!(list.getInt(key.as_ptr(), &mut integer), kResultOk);
            assert_eq!(integer, -12);

            assert_eq!(list.setFloat(key.as_ptr(), 0.5), kResultOk);
            let mut float = 0.0f64;
            assert_eq!(list.getFloat(key.as_ptr(), &mut float), kResultOk);
            assert_eq!(float, 0.5);

            let text: Vec<u16> = "hi\0".encode_utf16().collect();
            assert_eq!(list.setString(key.as_ptr(), text.as_ptr()), kResultOk);
            let mut read = [0u16; 8];
            assert_eq!(
                list.getString(key.as_ptr(), read.as_mut_ptr(), 16),
                kResultOk
            );
            assert_eq!(read_string128_prefix(&read), "hi");

            let payload = [1u8, 2, 3];
            assert_eq!(
                list.setBinary(key.as_ptr(), payload.as_ptr() as *const c_void, 3),
                kResultOk
            );
            let mut data: *const c_void = std::ptr::null();
            let mut size: uint32 = 0;
            assert_eq!(
                list.getBinary(key.as_ptr(), &mut data, &mut size),
                kResultOk
            );
            assert_eq!(
                std::slice::from_raw_parts(data as *const u8, size as usize),
                &payload
            );
        }
    }

    fn read_string128_prefix(value: &[u16]) -> String {
        let length = value
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(value.len());
        String::from_utf16_lossy(&value[..length])
    }

    #[test]
    fn a_type_mismatch_reads_as_absent_rather_than_as_a_zero() {
        let list = Vst3AttributeList::default();
        let key = CString::new("value").expect("a literal has no null byte");

        unsafe {
            list.setInt(key.as_ptr(), 3);
            let mut float = 99.0f64;
            assert_eq!(list.getFloat(key.as_ptr(), &mut float), kResultFalse);
            assert_eq!(
                float, 99.0,
                "a refused read leaves the caller's value alone"
            );
        }
    }
}
