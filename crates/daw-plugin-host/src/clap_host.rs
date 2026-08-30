use clap_sys::ext::gui::{clap_host_gui, CLAP_EXT_GUI};
use clap_sys::ext::latency::{clap_host_latency, CLAP_EXT_LATENCY};
use clap_sys::ext::params::{clap_host_params, CLAP_EXT_PARAMS};
use clap_sys::ext::state::{clap_host_state, CLAP_EXT_STATE};
use clap_sys::ext::tail::{clap_host_tail, CLAP_EXT_TAIL};
/// CLAP Host implementation — provides the `clap_host_t` and host extensions.
///
/// The CLAP spec requires the host to provide callback function pointers
/// that plugins call for services like param changes, GUI resize, state dirty.
use clap_sys::host::clap_host;
use clap_sys::version::CLAP_VERSION;
use std::ffi::CStr;
use std::os::raw::c_void;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;

use crate::parameter_events::signal_pending_parameter_flush;

/// Re-exported so every existing `clap_host::LatencyChangeNotifier` path still
/// resolves. The type itself is seam vocabulary — see [`crate::traits`].
pub use crate::traits::LatencyChangeNotifier;
pub use crate::traits::{PluginHostRequest, PluginHostRequestNotifier};

/// One editor size held in a single atomic, so the plugin's own callback can
/// state both dimensions without a lock and without tearing them apart.
///
/// Zero is the "nothing pending" value rather than a second flag beside it. It
/// is unambiguous because a request naming a zero dimension is refused before it
/// ever reaches this packing: a window with no area is not a size any plugin can
/// be drawn at.
const fn pack_editor_size(width: u32, height: u32) -> u64 {
    ((width as u64) << 32) | height as u64
}

const fn unpack_editor_size(packed: u64) -> Option<(u32, u32)> {
    if packed == 0 {
        return None;
    }
    Some(((packed >> 32) as u32, packed as u32))
}

/// Per-instance host callback state, reachable from a plugin's host callbacks
/// through `clap_host::host_data`. Each `ClapWrapper` owns one of these and pins
/// its address into the host descriptor before the plugin is created.
///
/// It carries the latency-invalidation flag and the wake that turns it into a
/// push. A plugin signals that its reported latency changed via
/// `clap_host_latency.changed()` (main-thread) and/or
/// `clap_host.request_restart()`; both set `latency_dirty` and then fire the
/// notifier. The control thread reacts by re-activating the plugin and
/// re-querying `clap_plugin_latency.get()` — CLAP forbids latency changes while
/// active, so a re-query must follow a deactivate/reactivate cycle, which is
/// exactly why the callback cannot do the work itself.
#[derive(Default)]
pub struct HostCallbackState {
    latency_dirty: AtomicBool,
    latency_notifier: OnceLock<LatencyChangeNotifier>,
    /// The editor size the plugin last asked for, packed by
    /// [`pack_editor_size`]. Zero means nothing is pending.
    pending_editor_resize: AtomicU64,
    /// Whether an editor window that can be resized is currently installed.
    /// Written by the control path as the editor opens and closes; read
    /// lock-free by the plugin's own callback, which has to answer
    /// `request_resize` truthfully without taking a lock.
    editor_resize_available: AtomicBool,
    /// Whether the plugin has reported a state change that has not been
    /// consumed. Set from the plugin's own thread; cleared on the control path.
    state_dirty: AtomicBool,
    /// Whether the plugin has reported that its parameter list changed and the
    /// host has not re-enumerated since.
    parameters_rescan: AtomicBool,
    /// Whether the plugin has asked the host to call `params.flush()` and the
    /// host has not done so since.
    parameters_flush: AtomicBool,
    /// Whether the plugin has reported a new processing tail the host has not
    /// re-read. Set from `clap_host_tail.changed`, which CLAP marks
    /// `[audio-thread]`; cleared on the control path.
    tail_dirty: AtomicBool,
    /// The wake fired for the asks CLAP marks `[main-thread]` — state-dirty and
    /// parameter-rescan — which a plugin raises where allocating is ordinary.
    /// Its install also gates the `[thread-safe]` asks' acceptance: it happens
    /// exactly when the native engine takes the instance, which is exactly the
    /// set the drain thread serves, so an instance with no install is one whose
    /// recorded ask nothing would ever carry.
    request_notifier: OnceLock<PluginHostRequestNotifier>,
}

impl std::fmt::Debug for HostCallbackState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostCallbackState")
            .field("latency_dirty", &self.latency_dirty.load(Ordering::Relaxed))
            .field(
                "has_latency_notifier",
                &self.latency_notifier.get().is_some(),
            )
            .field(
                "pending_editor_resize",
                &unpack_editor_size(self.pending_editor_resize.load(Ordering::Relaxed)),
            )
            .field(
                "editor_resize_available",
                &self.editor_resize_available.load(Ordering::Relaxed),
            )
            .field("state_dirty", &self.state_dirty.load(Ordering::Relaxed))
            .field(
                "parameters_rescan",
                &self.parameters_rescan.load(Ordering::Relaxed),
            )
            .field(
                "parameters_flush",
                &self.parameters_flush.load(Ordering::Relaxed),
            )
            .field("tail_dirty", &self.tail_dirty.load(Ordering::Relaxed))
            .field(
                "has_request_notifier",
                &self.request_notifier.get().is_some(),
            )
            .finish()
    }
}

impl HostCallbackState {
    /// Install the wake fired on a latency change. First install wins; a second
    /// call changes nothing and reports `false` so the caller can flag the bug.
    pub fn set_latency_notifier(&self, notifier: LatencyChangeNotifier) -> bool {
        self.latency_notifier.set(notifier).is_ok()
    }

    /// Mark that the plugin's latency may have changed and must be re-queried
    /// after a deactivate/reactivate cycle, then wake the observer.
    pub fn mark_latency_dirty(&self) {
        self.latency_dirty.store(true, Ordering::Release);
        // Wake only after the flag is visible, so an observer this call wakes
        // always sees the dirt it is being woken for. `OnceLock::get` is
        // lock-free, so a plugin that (against spec) calls back from the audio
        // thread does not take a lock here.
        if let Some(notify) = self.latency_notifier.get() {
            notify();
        }
    }

    /// Atomically read-and-clear the latency-dirty flag. Returns `true` if a
    /// latency change was pending since the last call.
    pub fn take_latency_dirty(&self) -> bool {
        self.latency_dirty.swap(false, Ordering::AcqRel)
    }

    /// Clear the flag without reporting it. Used after a completed re-query to
    /// swallow a flag that the re-query's own reactivation provoked — the value
    /// just read already reflects it, so scheduling another cycle would loop.
    pub fn clear_latency_dirty(&self) {
        self.latency_dirty.store(false, Ordering::Release);
    }

    /// Install the wake fired for the asks CLAP marks `[main-thread]`. First
    /// install wins; a second call changes nothing and reports `false`, so the
    /// wake cannot be hijacked mid-life.
    ///
    /// The install is also the `[thread-safe]` asks' acceptance gate — see
    /// [`Self::request_editor_resize`].
    pub fn set_request_notifier(&self, notifier: PluginHostRequestNotifier) -> bool {
        self.request_notifier.set(notifier).is_ok()
    }

    /// State whether there is a host window the plugin's editor can be resized
    /// in. Control path only, either side of the editor's life.
    pub fn set_editor_resize_available(&self, available: bool) {
        if !available {
            // Withdraw first, so nothing further is accepted, then drop the size
            // asked for against the window that is going away.
            self.editor_resize_available.store(false, Ordering::Release);
            self.pending_editor_resize.store(0, Ordering::Release);
            return;
        }

        // Clearing on the way in narrows the race the withdrawal cannot close on
        // its own: a plugin thread that read availability just before the
        // withdrawal can still store its size after the clear above, and this
        // clear discards it. Safe to clear here because no request is accepted
        // until the flag below is set, and both calls are control path.
        //
        // It does not close the race. A plugin thread descheduled between its
        // availability read and its store — across the whole destroy, create and
        // open of the next editor — still lands a dead window's size on the new
        // one. Closing that needs the slot to carry which editor the size was
        // asked for; it is not closed because the interleaving requires
        // preemption spanning an entire editor lifecycle, and its outcome is one
        // wrong resize the plugin can ask again for.
        self.pending_editor_resize.store(0, Ordering::Release);
        self.editor_resize_available.store(true, Ordering::Release);
    }

    /// Record an editor size the plugin asked for, and report whether it will
    /// actually be applied.
    ///
    /// Three ways it will not, and each is a `false` rather than a silent drop:
    /// a dimension with no area is not a size; an editor with no host window has
    /// nothing to resize; and an instance with no wake installed is one the
    /// drain thread never serves, so accepting would be a claim nothing backs.
    /// CLAP lets the host refuse, and a refusal a plugin can see beats an
    /// acceptance it cannot verify.
    ///
    /// The recording is [`Self::request_parameters_flush`]'s discipline exactly:
    /// the packed size slot is the record, the process-wide hint is the wake,
    /// and the drain thread answers both — because CLAP marks
    /// `gui.request_resize` `[thread-safe & !floating]`, so a plugin may raise
    /// it from the audio thread, where the request-notifier channel's
    /// heap-allocated instance id and channel node are a missed device period.
    pub fn request_editor_resize(&self, width: u32, height: u32) -> bool {
        if width == 0 || height == 0 {
            return false;
        }
        if !self.editor_resize_available.load(Ordering::Acquire) {
            return false;
        }
        if self.request_notifier.get().is_none() {
            return false;
        }

        // Published before the hint, so the drain pass the hint wakes always
        // applies the size it is being woken for.
        self.pending_editor_resize
            .store(pack_editor_size(width, height), Ordering::Release);
        signal_pending_editor_resize();
        true
    }

    /// Atomically read-and-clear the size the plugin asked for, or `None` when
    /// nothing is pending.
    pub fn take_editor_resize(&self) -> Option<(u32, u32)> {
        unpack_editor_size(self.pending_editor_resize.swap(0, Ordering::AcqRel))
    }

    /// Record that the plugin's own state changed, then wake the observer.
    pub fn mark_state_dirty(&self) {
        self.state_dirty.store(true, Ordering::Release);
        if let Some(notify) = self.request_notifier.get() {
            notify(PluginHostRequest::StateDirty);
        }
    }

    /// Atomically read-and-clear the state-dirty flag.
    pub fn take_state_dirty(&self) -> bool {
        self.state_dirty.swap(false, Ordering::AcqRel)
    }

    /// Record that the plugin's parameter list changed, then wake the observer.
    ///
    /// The flags CLAP passes are not kept. Every one of them — values, text,
    /// info, all — is answered by the same act here, a full re-enumeration on
    /// the control thread, because this host holds no partial parameter model it
    /// could refresh a slice of. Storing a discriminator nothing reads would be
    /// a claim that the answer varies with it.
    pub fn mark_parameters_rescan(&self) {
        self.parameters_rescan.store(true, Ordering::Release);
        if let Some(notify) = self.request_notifier.get() {
            notify(PluginHostRequest::ParametersRescan);
        }
    }

    /// Atomically read-and-clear the parameter-rescan flag.
    pub fn take_parameters_rescan(&self) -> bool {
        self.parameters_rescan.swap(false, Ordering::AcqRel)
    }

    /// Record that the plugin wants `params.flush()` called.
    ///
    /// Two release stores and nothing else — deliberately, and unlike every
    /// other ask on this type. CLAP marks `request_flush` `[thread-safe]`, so a
    /// plugin may call it from inside `process()`; the request-notifier channel
    /// the other asks wake copies the instance id onto the heap and takes an
    /// allocator lock, which on the render thread is a missed device period. So
    /// this ask has no channel: the flag is the record, the process-wide hint is
    /// the wake, and the drain thread answers both.
    pub fn request_parameters_flush(&self) {
        self.parameters_flush.store(true, Ordering::Release);
        signal_pending_parameter_flush();
    }

    /// Atomically read-and-clear the flush request.
    pub fn take_parameters_flush(&self) -> bool {
        self.parameters_flush.swap(false, Ordering::AcqRel)
    }

    /// Record that the plugin's processing tail changed.
    ///
    /// Two release stores and nothing else, for the same reason
    /// [`Self::request_parameters_flush`] has none: CLAP marks
    /// `clap_host_tail.changed` `[audio-thread]`, so a plugin raises it from
    /// inside `process()`, where copying an instance id onto the heap to wake a
    /// channel is a missed device period. The flag is the record and the
    /// process-wide hint is the wake.
    pub fn mark_tail_dirty(&self) {
        self.tail_dirty.store(true, Ordering::Release);
        signal_pending_tail_change();
    }

    /// Atomically read-and-clear the tail-dirty flag.
    pub fn take_tail_dirty(&self) -> bool {
        self.tail_dirty.swap(false, Ordering::AcqRel)
    }
}

/// Process-wide hint that some plugin reported a new processing tail.
///
/// A hint, never the record — each instance's own flag is that. A lost signal
/// costs at most one drain interval, because the flag stays set until a control
/// pass takes it.
static TAIL_CHANGE_PENDING: AtomicBool = AtomicBool::new(false);

/// Raise the tail hint. **Called from the plugin's own audio thread**, so it is
/// one release store and nothing else.
pub fn signal_pending_tail_change() {
    TAIL_CHANGE_PENDING.store(true, Ordering::Release);
}

/// Read and clear the tail hint.
pub fn take_pending_tail_change_signal() -> bool {
    TAIL_CHANGE_PENDING.swap(false, Ordering::AcqRel)
}

/// Process-wide hint that some plugin asked for a different editor size.
///
/// A hint, never the record — each instance's own packed size slot is that. A
/// lost signal costs at most one drain interval, because the recorded size
/// stays until a drain pass applies it.
static EDITOR_RESIZE_PENDING: AtomicBool = AtomicBool::new(false);

/// Raise the editor-resize hint. **Called from the plugin's own thread** — CLAP
/// marks `gui.request_resize` `[thread-safe & !floating]`, so this may be the
/// audio thread — one release store and nothing else.
pub fn signal_pending_editor_resize() {
    EDITOR_RESIZE_PENDING.store(true, Ordering::Release);
}

/// Read and clear the editor-resize hint.
pub fn take_pending_editor_resize_signal() -> bool {
    EDITOR_RESIZE_PENDING.swap(false, Ordering::AcqRel)
}

/// Borrow the host callback state pinned into a `clap_host`'s `host_data`.
/// Returns `None` when `host` or `host_data` is null (e.g. a descriptor created
/// without per-instance state, such as legacy test fixtures).
unsafe fn host_state<'a>(host: *const clap_host) -> Option<&'a HostCallbackState> {
    if host.is_null() {
        return None;
    }
    let data = (*host).host_data as *const HostCallbackState;
    if data.is_null() {
        return None;
    }
    Some(&*data)
}

static HOST_NAME: &[u8] = b"Sourdaw\0";
static HOST_VENDOR: &[u8] = b"Sourdaw Team\0";
static HOST_URL: &[u8] = b"https://sourdaw.app\0";
static HOST_VERSION: &[u8] = b"0.1.0\0";

/// Create a `clap_host` descriptor with extension support.
pub fn create_host_descriptor() -> clap_host {
    clap_host {
        clap_version: CLAP_VERSION,
        host_data: std::ptr::null_mut(),
        name: HOST_NAME.as_ptr() as *const i8,
        vendor: HOST_VENDOR.as_ptr() as *const i8,
        url: HOST_URL.as_ptr() as *const i8,
        version: HOST_VERSION.as_ptr() as *const i8,
        get_extension: Some(host_get_extension),
        request_restart: Some(host_request_restart),
        request_process: Some(host_request_process),
        request_callback: Some(host_request_callback),
    }
}

// ── Extension dispatch ─────────────────────────────────────────────────

/// Called by the plugin to query host extensions.
unsafe extern "C" fn host_get_extension(
    _host: *const clap_host,
    extension_id: *const i8,
) -> *const c_void {
    if extension_id.is_null() {
        return std::ptr::null();
    }

    let id = CStr::from_ptr(extension_id);

    if id == CLAP_EXT_PARAMS {
        return &HOST_PARAMS as *const clap_host_params as *const c_void;
    }
    if id == CLAP_EXT_GUI {
        return &HOST_GUI as *const clap_host_gui as *const c_void;
    }
    if id == CLAP_EXT_STATE {
        return &HOST_STATE as *const clap_host_state as *const c_void;
    }
    if id == CLAP_EXT_LATENCY {
        return &HOST_LATENCY as *const clap_host_latency as *const c_void;
    }
    if id == CLAP_EXT_TAIL {
        return &HOST_TAIL as *const clap_host_tail as *const c_void;
    }

    std::ptr::null()
}

// ── Host callbacks ─────────────────────────────────────────────────────

unsafe extern "C" fn host_request_restart(host: *const clap_host) {
    // A restart request is how a running plugin asks to change latency (and other
    // activation-time invariants). CLAP forbids latency changes while active, so
    // flag the instance dirty; the control thread reacts by deactivating,
    // reactivating, and re-querying `clap_plugin_latency.get()`.
    //
    // Deliberately silent: CLAP marks `request_restart` [thread-safe], so a
    // plugin may call it from its audio thread, and `eprintln!` locks stderr and
    // makes a write syscall. The flag is the record; the control thread reads it.
    if let Some(state) = host_state(host) {
        state.mark_latency_dirty();
    }
}

unsafe extern "C" fn host_request_process(_host: *const clap_host) {
    // Plugin wants to be woken up. Our host always processes, so this is a no-op.
}

unsafe extern "C" fn host_request_callback(_host: *const clap_host) {
    // TODO: Schedule a main-thread callback via app.run_on_main_thread()
    // For now, log and skip — most plugins work without this.
}

// ── clap_host_params extension ─────────────────────────────────────────

static HOST_PARAMS: clap_host_params = clap_host_params {
    rescan: Some(host_params_rescan),
    clear: Some(host_params_clear),
    request_flush: Some(host_params_request_flush),
};

/// The plugin's parameter list changed.
///
/// Flag and wake, nothing else. Re-enumerating means calling `count`,
/// `get_info` and `get_value` back into the plugin, all of which CLAP annotates
/// `[main-thread]` — so the work belongs to the control path, and this callback
/// only says that there is work. Deliberately unlogged: it can arrive from a
/// plugin's own thread, where stderr I/O is not acceptable.
unsafe extern "C" fn host_params_rescan(host: *const clap_host, _flags: u32) {
    if let Some(state) = host_state(host) {
        state.mark_parameters_rescan();
    }
}

/// The plugin asks the host to clear the automation or modulation it holds for
/// one parameter.
///
/// **Deliberately deferred, and the bound is this**: the only thing Sourdaw
/// holds for a parameter is automation lane points in the project document, so
/// honouring this call means deleting a user's recorded automation. That write
/// has to go through the project's own action path to be undoable and to reach
/// collaborators, and this host has no route to it — the backend cannot reach
/// the renderer, and a destructive project edit a plugin initiated and the user
/// cannot undo is worse than one that never happened.
///
/// Nothing is recorded either: a flag nobody drains is a leak, and answering the
/// plugin with silence is the same outcome as answering it with a flag no
/// control path reads. It is reinstated when the host has a project-side "clear
/// automation for this parameter" command with undo behind it.
unsafe extern "C" fn host_params_clear(_host: *const clap_host, _param_id: u32, _flags: u32) {}

/// The plugin has parameter output waiting and is not being handed blocks.
///
/// Flag and wake. `flush()` is legal only while the plugin is not processing,
/// and deciding that plus making the call is the control path's job; this
/// callback is `[thread-safe]` and may be the audio thread.
unsafe extern "C" fn host_params_request_flush(host: *const clap_host) {
    if let Some(state) = host_state(host) {
        state.request_parameters_flush();
    }
}

// ── clap_host_gui extension ────────────────────────────────────────────

static HOST_GUI: clap_host_gui = clap_host_gui {
    resize_hints_changed: Some(host_gui_resize_hints_changed),
    request_resize: Some(host_gui_request_resize),
    request_show: Some(host_gui_request_show),
    request_hide: Some(host_gui_request_hide),
    closed: Some(host_gui_closed),
};

unsafe extern "C" fn host_gui_resize_hints_changed(_host: *const clap_host) {
    // Plugin's resize constraints changed — re-query can_resize/get_resize_hints
}

/// The plugin asks for a different editor size.
///
/// Recorded and hinted rather than applied here: resizing reaches the shell's
/// window server, and this callback arrives from inside the plugin — CLAP marks
/// it `[thread-safe & !floating]`, so a plugin may raise it from any thread,
/// including the audio one, where an allocation, a lock, or a blocking wake is
/// a missed device period. The size slot is the record, the process-wide hint
/// is the wake, and the drain thread applies the newest recorded size at the
/// window seam — the same split `clap_host_params.request_flush` uses.
///
/// The answer is the truth about what will happen, not a courtesy: `false` when
/// nothing is going to apply this size.
unsafe extern "C" fn host_gui_request_resize(
    host: *const clap_host,
    width: u32,
    height: u32,
) -> bool {
    match host_state(host) {
        Some(state) => state.request_editor_resize(width, height),
        None => false,
    }
}

unsafe extern "C" fn host_gui_request_show(_host: *const clap_host) -> bool {
    // Plugin wants us to show its GUI window
    true
}

unsafe extern "C" fn host_gui_request_hide(_host: *const clap_host) -> bool {
    // Plugin wants us to hide its GUI window
    true
}

unsafe extern "C" fn host_gui_closed(_host: *const clap_host, _was_destroyed: bool) {
    // Plugin closed its own GUI (e.g. user clicked X in the plugin).
    // No logging here — this callback can arrive from a plugin's own thread.
}

// ── clap_host_state extension ──────────────────────────────────────────

static HOST_STATE: clap_host_state = clap_host_state {
    mark_dirty: Some(host_state_mark_dirty),
};

/// The plugin's own state changed — a knob moved in its editor, a preset loaded
/// inside it — so the project holding it has unsaved changes.
///
/// Flag and wake, nothing else. Deliberately not logged: this callback can
/// arrive from a plugin's own thread, where stderr I/O is not acceptable, and
/// for the same reason nothing here reaches the renderer directly. The control
/// path consumes the flag and publishes the change.
unsafe extern "C" fn host_state_mark_dirty(host: *const clap_host) {
    if let Some(state) = host_state(host) {
        state.mark_state_dirty();
    }
}

// ── clap_host_latency extension ────────────────────────────────────────

static HOST_LATENCY: clap_host_latency = clap_host_latency {
    changed: Some(host_latency_changed),
};

/// The plugin reports that its latency changed. Per CLAP this is called on the
/// main thread; latency itself may only change across a deactivate/reactivate,
/// so we flag the instance dirty and let the control thread re-query.
unsafe extern "C" fn host_latency_changed(host: *const clap_host) {
    if let Some(state) = host_state(host) {
        state.mark_latency_dirty();
    }
    eprintln!("[CLAP Host] Plugin reported a latency change");
}

// ── clap_host_tail extension ───────────────────────────────────────────

static HOST_TAIL: clap_host_tail = clap_host_tail {
    changed: Some(host_tail_changed),
};

/// The plugin reports that its processing tail changed.
///
/// Flag and hint, nothing else — and deliberately unlogged. CLAP marks this
/// callback `[audio-thread]`, so it can be the render thread, where locking
/// stderr and making a write syscall is a dropout. Re-reading `clap.tail` is the
/// control path's job.
unsafe extern "C" fn host_tail_changed(host: *const clap_host) {
    if let Some(state) = host_state(host) {
        state.mark_tail_dirty();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Build a host descriptor whose `host_data` points at `state`, mimicking
    /// how `ClapWrapper::new` pins per-instance state before plugin creation.
    fn host_with_state(state: &HostCallbackState) -> clap_host {
        let mut host = create_host_descriptor();
        host.host_data = (state as *const HostCallbackState) as *mut c_void;
        host
    }

    #[test]
    fn latency_changed_callback_sets_the_dirty_flag() {
        let state = HostCallbackState::default();
        let host = host_with_state(&state);

        assert!(!state.take_latency_dirty(), "flag starts clear");
        unsafe { host_latency_changed(&host as *const clap_host) };
        assert!(
            state.take_latency_dirty(),
            "changed() marks the instance dirty"
        );
        assert!(!state.take_latency_dirty(), "take clears the flag");
    }

    #[test]
    fn request_restart_marks_latency_dirty() {
        let state = HostCallbackState::default();
        let host = host_with_state(&state);

        unsafe { host_request_restart(&host as *const clap_host) };
        assert!(
            state.take_latency_dirty(),
            "request_restart() marks the instance dirty so latency is re-queried"
        );
    }

    #[test]
    fn latency_callbacks_wake_the_installed_notifier() {
        use std::sync::atomic::AtomicUsize;
        use std::sync::Arc;

        let wakes = Arc::new(AtomicUsize::new(0));
        let state = HostCallbackState::default();
        let counter = Arc::clone(&wakes);
        assert!(
            state.set_latency_notifier(Box::new(move || {
                counter.fetch_add(1, Ordering::Relaxed);
            })),
            "first install wins"
        );
        let host = host_with_state(&state);

        assert_eq!(
            wakes.load(Ordering::Relaxed),
            0,
            "no wake before a callback"
        );
        unsafe { host_latency_changed(&host as *const clap_host) };
        assert_eq!(
            wakes.load(Ordering::Relaxed),
            1,
            "changed() wakes the observer"
        );
        unsafe { host_request_restart(&host as *const clap_host) };
        assert_eq!(
            wakes.load(Ordering::Relaxed),
            2,
            "request_restart() also wakes the observer"
        );

        // A second install is refused, so the wake cannot be hijacked mid-life.
        assert!(!state.set_latency_notifier(Box::new(|| {})));
        unsafe { host_latency_changed(&host as *const clap_host) };
        assert_eq!(
            wakes.load(Ordering::Relaxed),
            3,
            "original notifier still fires"
        );
    }

    #[test]
    fn clear_latency_dirty_drops_a_pending_flag_without_reporting_it() {
        let state = HostCallbackState::default();
        state.mark_latency_dirty();

        state.clear_latency_dirty();

        assert!(
            !state.take_latency_dirty(),
            "a cleared flag is not reported to the next observer"
        );
    }

    #[test]
    fn callbacks_tolerate_a_null_host_state() {
        // Legacy descriptors (e.g. command fixtures) carry a null host_data.
        let host = create_host_descriptor();
        assert!(host.host_data.is_null());
        unsafe {
            host_latency_changed(&host as *const clap_host);
            host_request_restart(&host as *const clap_host);
        }
    }

    /// Serialises every test that raises the process-wide flush hint, so one
    /// test's raise cannot stand in for another's deleted one.
    static FLUSH_SIGNAL_TEST_LOCK: Mutex<()> = Mutex::new(());

    /// Serialises every test that raises the process-wide tail hint, for the
    /// same reason.
    static TAIL_SIGNAL_TEST_LOCK: Mutex<()> = Mutex::new(());

    /// Serialises every test that raises the process-wide editor-resize hint,
    /// for the same reason.
    static RESIZE_SIGNAL_TEST_LOCK: Mutex<()> = Mutex::new(());

    /// Arm a state so a resize request can be accepted: an open editor window
    /// and an installed wake, recording what the wake was told.
    fn state_with_open_editor() -> (HostCallbackState, Arc<Mutex<Vec<PluginHostRequest>>>) {
        let state = HostCallbackState::default();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&requests);
        assert!(state.set_request_notifier(Box::new(move |request| {
            recorded.lock().expect("request log").push(request);
        })));
        state.set_editor_resize_available(true);
        (state, requests)
    }

    /// The whole point of #2174: the dimensions the plugin asked for used to be
    /// dropped on the floor and answered `true`. They must survive to the drain
    /// thread intact, and the hint — not a channel the calling thread cannot
    /// afford — is what says they are waiting.
    #[test]
    fn a_resize_request_carries_its_dimensions_to_the_control_path() {
        let _guard = RESIZE_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);
        take_pending_editor_resize_signal();

        let accepted = unsafe { host_gui_request_resize(&host as *const clap_host, 1024, 768) };

        assert!(accepted, "an applicable request is accepted");
        assert!(
            requests.lock().expect("request log").is_empty(),
            "the ask must not wake the allocating channel from a thread it may not allocate on"
        );
        assert!(
            take_pending_editor_resize_signal(),
            "the drain thread's wake is the process-wide hint, and nothing else raises it here"
        );
        assert_eq!(
            state.take_editor_resize(),
            Some((1024, 768)),
            "the size the plugin asked for reaches the drain thread unchanged"
        );
        assert_eq!(
            state.take_editor_resize(),
            None,
            "taking the size clears it, so one ask is applied once"
        );

        // Consumption must clear the slot, not disarm it: a plugin resizes its
        // editor repeatedly over one editor's life.
        assert!(unsafe { host_gui_request_resize(&host as *const clap_host, 800, 600) });
        assert!(
            take_pending_editor_resize_signal(),
            "an ask made after the last one was consumed raises the hint in its turn"
        );
        assert_eq!(
            state.take_editor_resize(),
            Some((800, 600)),
            "and is recorded in its turn"
        );
    }

    /// CLAP marks `gui.request_resize` `[thread-safe & !floating]`, so a plugin
    /// may raise it from inside `process()`. The request-notifier channel the
    /// `[main-thread]` asks wake copies the instance id onto the heap and takes
    /// an allocator lock, which on the render thread is a missed device period —
    /// so this ask must record its size and raise the wait-free hint, and touch
    /// the channel not at all.
    #[test]
    fn a_resize_request_records_without_waking_the_allocating_channel() {
        // The resize hint is process-wide, and every other test here that raises
        // one would otherwise mask a deleted raise in this one.
        let _guard = RESIZE_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);
        take_pending_editor_resize_signal();

        let accepted = unsafe { host_gui_request_resize(&host as *const clap_host, 1024, 768) };

        assert!(accepted, "the ask is recorded, only silently");
        assert!(
            requests.lock().expect("request log").is_empty(),
            "a resize request must not send on the channel, which allocates"
        );
        assert!(
            take_pending_editor_resize_signal(),
            "the drain thread's wake is the process-wide hint"
        );
        assert!(state.take_editor_resize().is_some());
    }

    /// Width and height are packed into one atomic, so a swap cannot report one
    /// dimension of this ask beside the other of the last one. Values that
    /// differ in both halves, and that are not each other reversed, are what
    /// distinguishes a correct packing from a transposed one.
    #[test]
    fn the_newest_requested_size_replaces_an_unread_older_one() {
        let (state, _requests) = state_with_open_editor();
        let host = host_with_state(&state);

        unsafe {
            host_gui_request_resize(&host as *const clap_host, 640, 480);
            host_gui_request_resize(&host as *const clap_host, 1280, 720);
        }

        assert_eq!(state.take_editor_resize(), Some((1280, 720)));
    }

    /// A window with no area is not a size the plugin can be drawn at, and the
    /// zero packing is what "nothing pending" means — so it must never be
    /// recorded as a request.
    #[test]
    fn a_resize_request_with_no_area_is_refused_rather_than_recorded() {
        let _guard = RESIZE_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);
        take_pending_editor_resize_signal();

        let zero_width = unsafe { host_gui_request_resize(&host as *const clap_host, 0, 480) };
        let zero_height = unsafe { host_gui_request_resize(&host as *const clap_host, 640, 0) };

        assert!(!zero_width);
        assert!(!zero_height);
        assert_eq!(state.take_editor_resize(), None);
        assert!(requests.lock().expect("request log").is_empty());
        assert!(
            !take_pending_editor_resize_signal(),
            "a refused ask must not wake the drain for nothing"
        );
    }

    /// `true` from `request_resize` tells the plugin the host took the size. A
    /// plugin whose editor has no host window would be told a size was applied
    /// that nothing could apply.
    #[test]
    fn a_resize_request_is_refused_while_no_editor_window_is_installed() {
        let (state, _requests) = state_with_open_editor();
        state.set_editor_resize_available(false);
        let host = host_with_state(&state);

        let accepted = unsafe { host_gui_request_resize(&host as *const clap_host, 1024, 768) };

        assert!(!accepted);
        assert_eq!(state.take_editor_resize(), None);
    }

    /// Closing the editor drops a size asked for against the window that is
    /// going away: applying it to whichever window opens next would resize an
    /// editor to a size its plugin never asked for.
    #[test]
    fn closing_the_editor_discards_a_size_that_was_never_applied() {
        let _guard = RESIZE_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (state, _requests) = state_with_open_editor();
        let host = host_with_state(&state);
        unsafe { host_gui_request_resize(&host as *const clap_host, 1024, 768) };

        state.set_editor_resize_available(false);

        assert_eq!(state.take_editor_resize(), None);
    }

    /// The plugin thread stores its size without holding anything, so a store
    /// can land *after* the release has withdrawn availability and cleared the
    /// slot — the withdrawal cannot order a call that already read the flag.
    /// Only clearing on the way back in stops that dead window's size being
    /// applied to the editor opening now.
    #[test]
    fn a_size_that_raced_the_editors_release_is_not_applied_to_the_next_editor() {
        let (state, _requests) = state_with_open_editor();

        state.set_editor_resize_available(false);
        // The raced store, reconstructed: the plugin thread had already passed
        // the availability check when the release ran.
        state
            .pending_editor_resize
            .store(pack_editor_size(1024, 768), Ordering::Release);

        state.set_editor_resize_available(true);

        assert_eq!(
            state.take_editor_resize(),
            None,
            "the next editor must open with nothing pending against it"
        );
    }

    /// With no wake installed nothing carries the ask onto the control path, so
    /// accepting it would be a claim the host cannot keep.
    #[test]
    fn a_resize_request_is_refused_when_no_wake_is_installed() {
        let state = HostCallbackState::default();
        state.set_editor_resize_available(true);
        let host = host_with_state(&state);

        assert!(!unsafe { host_gui_request_resize(&host as *const clap_host, 1024, 768) });
        assert_eq!(state.take_editor_resize(), None);
    }

    #[test]
    fn mark_dirty_records_the_signal_and_wakes_the_control_path() {
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);

        assert!(!state.take_state_dirty(), "flag starts clear");
        unsafe { host_state_mark_dirty(&host as *const clap_host) };

        assert_eq!(
            requests.lock().expect("request log").as_slice(),
            [PluginHostRequest::StateDirty]
        );
        assert!(state.take_state_dirty(), "the edit is recorded");
        assert!(
            !state.take_state_dirty(),
            "taking the flag clears it, so one edit marks the project dirty once"
        );

        // Clearing must re-arm rather than disarm, or only a session's first
        // plugin edit would ever reach the project.
        unsafe { host_state_mark_dirty(&host as *const clap_host) };
        assert!(
            state.take_state_dirty(),
            "an edit made after the last one was consumed is recorded in its turn"
        );
    }

    /// The flag is the record and the wake is only a nudge, so a plugin loaded
    /// before anything installed a wake must still record its edit rather than
    /// panicking on the missing one.
    #[test]
    fn mark_dirty_records_the_signal_with_no_wake_installed() {
        let state = HostCallbackState::default();
        let host = host_with_state(&state);

        unsafe { host_state_mark_dirty(&host as *const clap_host) };

        assert!(state.take_state_dirty());
    }

    /// Legacy descriptors carry a null `host_data`. A resize cannot be applied
    /// through one, so it must be refused rather than accepted blind.
    #[test]
    fn the_gui_and_state_callbacks_tolerate_a_null_host_state() {
        let host = create_host_descriptor();
        assert!(host.host_data.is_null());

        unsafe {
            assert!(!host_gui_request_resize(
                &host as *const clap_host,
                640,
                480
            ));
            host_state_mark_dirty(&host as *const clap_host);
        }
    }

    /// The whole of AC-002's first half: the callback used to be a comment. The
    /// control path can only re-enumerate if the callback records that it must.
    #[test]
    fn a_rescan_callback_records_the_ask_and_wakes_the_control_path() {
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);

        assert!(!state.take_parameters_rescan(), "flag starts clear");
        unsafe { host_params_rescan(&host as *const clap_host, 0) };

        assert_eq!(
            requests.lock().expect("request log").as_slice(),
            [PluginHostRequest::ParametersRescan]
        );
        assert!(state.take_parameters_rescan());
        assert!(
            !state.take_parameters_rescan(),
            "taking the flag clears it, so one ask re-enumerates once"
        );
    }

    /// Every CLAP rescan flag is answered by the same full re-enumeration, so a
    /// plugin that reports only values must arm the control path exactly as one
    /// that reports everything.
    #[test]
    fn a_rescan_is_recorded_whatever_flags_it_carries() {
        for flags in [0u32, 1, 1 << 3, u32::MAX] {
            let state = HostCallbackState::default();
            let host = host_with_state(&state);

            unsafe { host_params_rescan(&host as *const clap_host, flags) };

            assert!(state.take_parameters_rescan(), "flags {flags} were ignored");
        }
    }

    /// CLAP marks `request_flush` `[thread-safe]`, so a plugin may raise it from
    /// inside `process()`. The request-notifier channel every other ask wakes
    /// copies the instance id onto the heap and takes an allocator lock, which
    /// on the render thread is a missed device period — so this ask must record
    /// its flag and raise the wait-free hint, and touch the channel not at all.
    #[test]
    fn a_flush_request_records_the_ask_without_waking_the_allocating_channel() {
        // The flush hint is process-wide, and every other test here that raises
        // one would otherwise mask a deleted raise in this one.
        let _guard = FLUSH_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);
        crate::parameter_events::take_pending_parameter_flush_signal();

        assert!(!state.take_parameters_flush(), "flag starts clear");
        unsafe { host_params_request_flush(&host as *const clap_host) };

        assert!(
            requests.lock().expect("request log").is_empty(),
            "a flush request must not send on the channel, which allocates"
        );
        assert!(
            crate::parameter_events::take_pending_parameter_flush_signal(),
            "the drain thread's wake is the process-wide hint, and nothing else raises it here"
        );
        assert!(state.take_parameters_flush());
        assert!(!state.take_parameters_flush());
    }

    /// The `[main-thread]` asks keep their channel: their callbacks arrive on a
    /// thread CLAP says may allocate, and the follow-up needs to name the
    /// instance that made it.
    #[test]
    fn the_main_thread_asks_still_wake_the_channel() {
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);

        unsafe { host_params_rescan(&host as *const clap_host, 0) };

        assert_eq!(
            requests.lock().expect("request log").as_slice(),
            [PluginHostRequest::ParametersRescan]
        );
    }

    /// The two asks are separate flags: a rescan must not be consumed by the
    /// flush follow-up, or a parameter list change would be answered by a flush
    /// and never re-enumerated.
    #[test]
    fn the_rescan_and_flush_flags_do_not_consume_each_other() {
        let _guard = FLUSH_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let state = HostCallbackState::default();
        let host = host_with_state(&state);

        unsafe {
            host_params_rescan(&host as *const clap_host, 0);
            host_params_request_flush(&host as *const clap_host);
        }

        assert!(state.take_parameters_flush());
        assert!(
            state.take_parameters_rescan(),
            "the rescan survives the flush being answered"
        );
    }

    /// The flag is the record and the wake is a nudge, so a plugin whose
    /// instance never got one must still record its ask.
    #[test]
    fn the_params_callbacks_record_with_no_wake_installed() {
        let _guard = FLUSH_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let state = HostCallbackState::default();
        let host = host_with_state(&state);

        unsafe {
            host_params_rescan(&host as *const clap_host, 0);
            host_params_request_flush(&host as *const clap_host);
        }

        assert!(state.take_parameters_rescan());
        assert!(state.take_parameters_flush());
    }

    #[test]
    fn the_params_callbacks_tolerate_a_null_host_state() {
        let _guard = FLUSH_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let host = create_host_descriptor();
        assert!(host.host_data.is_null());

        unsafe {
            host_params_rescan(&host as *const clap_host, 0);
            host_params_request_flush(&host as *const clap_host);
            host_params_clear(&host as *const clap_host, 3, 0);
        }
    }

    /// `clear` is deliberately deferred, and "deferred" has to mean it records
    /// nothing: a flag no control path drains is a leak that reads, to the next
    /// author, like an implemented callback.
    #[test]
    fn clear_records_nothing_because_it_is_deferred_rather_than_queued() {
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);

        unsafe { host_params_clear(&host as *const clap_host, 3, u32::MAX) };

        assert!(requests.lock().expect("request log").is_empty());
        assert!(!state.take_parameters_rescan());
        assert!(!state.take_parameters_flush());
        assert!(!state.take_state_dirty());
    }

    #[test]
    fn get_extension_exposes_the_params_extension_with_every_callback_bound() {
        unsafe {
            let ptr = host_get_extension(std::ptr::null(), CLAP_EXT_PARAMS.as_ptr());
            assert!(!ptr.is_null(), "host advertises clap.params");
            let ext = &*(ptr as *const clap_host_params);
            assert!(ext.rescan.is_some());
            assert!(ext.clear.is_some());
            assert!(ext.request_flush.is_some());
        }
    }

    #[test]
    fn get_extension_exposes_the_latency_extension() {
        unsafe {
            let ptr = host_get_extension(std::ptr::null(), CLAP_EXT_LATENCY.as_ptr());
            assert!(!ptr.is_null(), "host advertises clap.latency");
            let ext = &*(ptr as *const clap_host_latency);
            assert!(ext.changed.is_some());
        }
    }

    /// A plugin only calls `clap_host_tail.changed` if the host answers the
    /// query for `clap.tail`. Without this the tail flag can never be raised, so
    /// every tail the host reports is the one read at load and nothing else.
    #[test]
    fn get_extension_exposes_the_tail_extension() {
        unsafe {
            let ptr = host_get_extension(std::ptr::null(), CLAP_EXT_TAIL.as_ptr());
            assert!(!ptr.is_null(), "host advertises clap.tail");
            let ext = &*(ptr as *const clap_host_tail);
            assert!(ext.changed.is_some());
        }
    }

    #[test]
    fn a_tail_change_callback_raises_the_flag_the_control_path_reads() {
        let _guard = TAIL_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = HostCallbackState::default();
        let host = host_with_state(&state);

        assert!(
            !state.take_tail_dirty(),
            "nothing is pending before the call"
        );

        unsafe { host_tail_changed(&host as *const clap_host) };

        assert!(state.take_tail_dirty(), "the callback records the change");
        assert!(
            !state.take_tail_dirty(),
            "the flag is read-and-clear, so one change is answered once"
        );
    }

    /// The callback is `[audio-thread]`, so the wake it raises has to be the
    /// process-wide hint rather than a channel send: a control thread that never
    /// learns a tail moved re-reads it only by polling every instance.
    #[test]
    fn a_tail_change_raises_the_process_wide_hint() {
        // The tail hint is process-wide, and the callback test above raises one
        // too; without this its raise would mask a deleted raise here.
        let _guard = TAIL_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = HostCallbackState::default();
        let host = host_with_state(&state);
        take_pending_tail_change_signal();

        unsafe { host_tail_changed(&host as *const clap_host) };

        assert!(take_pending_tail_change_signal(), "the hint is raised");
        assert!(
            !take_pending_tail_change_signal(),
            "the hint is read-and-clear"
        );
    }
}
