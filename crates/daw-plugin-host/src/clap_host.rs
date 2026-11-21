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
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::OnceLock;

use crate::parameter_events::signal_pending_parameter_flush;

/// Re-exported so every existing `clap_host::LatencyChangeNotifier` path still
/// resolves. The type itself is seam vocabulary — see [`crate::traits`].
pub use crate::traits::LatencyChangeNotifier;
use crate::traits::{EditorClosed, EditorVisibility, EditorWindowAsks};
pub use crate::traits::{PluginHostRequest, PluginHostRequestNotifier};

/// The visibility slot's "nothing asked", and its two answers.
const NO_VISIBILITY_ASK: u8 = 0;
const SHOW_ASKED: u8 = 1;
const HIDE_ASKED: u8 = 2;

/// The closed slot's "not closed", and its two reports, ordered so that
/// `fetch_max` keeps the stronger one: an editor reported destroyed stays
/// destroyed whatever a second report says.
const NOT_CLOSED: u8 = 0;
const CLOSED_ALIVE: u8 = 1;
const CLOSED_DESTROYED: u8 = 2;

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
/// `clap_host_latency.changed()` ([main-thread], which fires the notifier) or
/// `clap_host.request_restart()` ([thread-safe], which raises the wait-free
/// hint instead — see [`Self::flag_latency_requery`]); both leave
/// `latency_dirty` set. The control thread reacts by re-activating the plugin
/// and re-querying `clap_plugin_latency.get()` — CLAP forbids latency changes
/// while active, so a re-query must follow a deactivate/reactivate cycle, which
/// is exactly why the callback cannot do the work itself.
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
    /// Whether the plugin has asked the host to call `on_main_thread` on it
    /// and no control visit has since done so. Set by `clap_host
    /// .request_callback`; cleared by the carrier that makes the call.
    main_thread_callback_pending: AtomicBool,
    /// The newest show or hide the plugin asked of its editor window.
    editor_visibility_ask: AtomicU8,
    /// Whether the plugin reported its editor gone, and whether destroyed.
    editor_closed_ask: AtomicU8,
    /// Whether the plugin reported new resize constraints not yet re-read.
    editor_resize_hints_changed: AtomicBool,
    /// The wake fired for the asks CLAP marks `[main-thread]` — state-dirty
    /// and parameter-rescan — which a plugin raises where allocating is
    /// ordinary. Its install also gates the `[thread-safe]` asks' acceptance:
    /// it happens exactly when the native engine takes the instance, which is
    /// exactly the set the drain thread serves, so an instance with no install
    /// is one whose recorded ask nothing would ever carry.
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
            .field(
                "main_thread_callback_pending",
                &self.main_thread_callback_pending.load(Ordering::Relaxed),
            )
            .field("tail_dirty", &self.tail_dirty.load(Ordering::Relaxed))
            .field(
                "editor_visibility_ask",
                &self.editor_visibility_ask.load(Ordering::Relaxed),
            )
            .field(
                "editor_closed_ask",
                &self.editor_closed_ask.load(Ordering::Relaxed),
            )
            .field(
                "editor_resize_hints_changed",
                &self.editor_resize_hints_changed.load(Ordering::Relaxed),
            )
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
    ///
    /// The notifier is a channel send that allocates, so only a callback whose
    /// own CLAP annotation vouches for the raising thread may use this entry:
    /// `clap_host_latency.changed` is `[main-thread]` and passes.
    /// `request_restart` is `[thread-safe]` and must use
    /// [`Self::flag_latency_requery`] instead.
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

    /// Record that the plugin's latency may have changed, without waking
    /// anything that allocates.
    ///
    /// This is [`Self::mark_latency_dirty`]'s recording half on its own: the
    /// flag is stored, the process-wide wait-free hint is raised, and the
    /// channel is not touched. It is the entry for a callback CLAP marks
    /// `[thread-safe]` — `request_restart` — which a plugin may call from
    /// inside `process()`, where the notifier's heap-copied instance id and
    /// channel node are a missed device period. The latency watcher services
    /// the hint on its control thread, which makes the same re-query the
    /// channel wake would have.
    pub fn flag_latency_requery(&self) {
        // Published before the hint, so a control pass the hint wakes always
        // finds the dirt it is being woken for.
        self.latency_dirty.store(true, Ordering::Release);
        signal_pending_latency_requery();
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
    /// [`Self::request_editor_resize`] — and the moment the instance joins the
    /// set the request watcher sweeps. A main-thread callback the plugin asked
    /// for before then had its hint raised while no sweep could find it, so the
    /// hint is raised again here and the ask is served on the next sweep rather
    /// than left until the plugin happens to ask again.
    pub fn set_request_notifier(&self, notifier: PluginHostRequestNotifier) -> bool {
        if self.request_notifier.set(notifier).is_err() {
            return false;
        }
        if self.main_thread_callback_pending.load(Ordering::Acquire) {
            signal_pending_main_thread_callback();
        }
        true
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

    /// Record that the plugin asked for its editor window to be shown or
    /// hidden, and report whether it will be.
    ///
    /// The same gates and the same wait-free recording as
    /// [`Self::request_editor_resize`], for the same reason: CLAP marks
    /// `gui.request_show` and `gui.request_hide` `[thread-safe]`. The newest
    /// ask wins, because a hide the host has not reached yet is moot once the
    /// plugin asks to be shown again.
    pub fn request_editor_visibility(&self, visibility: EditorVisibility) -> bool {
        if !self.editor_resize_available.load(Ordering::Acquire) {
            return false;
        }
        if self.request_notifier.get().is_none() {
            return false;
        }

        let asked = match visibility {
            EditorVisibility::Show => SHOW_ASKED,
            EditorVisibility::Hide => HIDE_ASKED,
        };
        self.editor_visibility_ask.store(asked, Ordering::Release);
        signal_pending_editor_resize();
        true
    }

    /// Record that the plugin's editor ended on its own. CLAP marks
    /// `gui.closed` `[thread-safe]`, so this is atomics and the hint only.
    pub fn mark_editor_closed(&self, was_destroyed: bool) {
        let reported = if was_destroyed {
            CLOSED_DESTROYED
        } else {
            CLOSED_ALIVE
        };
        self.editor_closed_ask.fetch_max(reported, Ordering::AcqRel);
        signal_pending_editor_resize();
    }

    /// Record that the plugin's resize constraints changed. CLAP marks
    /// `gui.resize_hints_changed` `[thread-safe & !floating]`.
    pub fn mark_editor_resize_hints_changed(&self) {
        self.editor_resize_hints_changed
            .store(true, Ordering::Release);
        signal_pending_editor_resize();
    }

    /// Drop whatever the plugin asked of a previous editor's window, so none of
    /// it lands on the editor about to open.
    pub fn discard_editor_window_asks(&self) {
        let _ = self.take_editor_window_asks();
    }

    /// Whether the plugin has asked anything of its editor window that no one
    /// has taken yet. Reads without clearing.
    pub fn has_pending_editor_window_asks(&self) -> bool {
        self.editor_visibility_ask.load(Ordering::Acquire) != NO_VISIBILITY_ASK
            || self.editor_closed_ask.load(Ordering::Acquire) != NOT_CLOSED
            || self.editor_resize_hints_changed.load(Ordering::Acquire)
    }

    /// Read and clear everything the plugin asked of its editor window.
    pub fn take_editor_window_asks(&self) -> EditorWindowAsks {
        let visibility = match self
            .editor_visibility_ask
            .swap(NO_VISIBILITY_ASK, Ordering::AcqRel)
        {
            SHOW_ASKED => Some(EditorVisibility::Show),
            HIDE_ASKED => Some(EditorVisibility::Hide),
            _ => None,
        };
        let closed = match self.editor_closed_ask.swap(NOT_CLOSED, Ordering::AcqRel) {
            CLOSED_DESTROYED => Some(EditorClosed {
                was_destroyed: true,
            }),
            CLOSED_ALIVE => Some(EditorClosed {
                was_destroyed: false,
            }),
            _ => None,
        };
        EditorWindowAsks {
            visibility,
            closed,
            resize_hints_changed: self
                .editor_resize_hints_changed
                .swap(false, Ordering::AcqRel),
        }
    }

    /// Record that the plugin asked the host to call `on_main_thread` on it.
    ///
    /// Two release stores and nothing else, for the same reason
    /// [`Self::request_parameters_flush`] has none: CLAP marks
    /// `request_callback` `[thread-safe]`, and plugins raise it from inside
    /// `process()` to hand work to the main thread, where the request-notifier
    /// channel's heap-copied instance id and channel node are a missed device
    /// period. #6566 was that allocation. The flag is the record, the
    /// process-wide hint is the wake, and the request watcher's sweep makes the
    /// call. The flag is read-and-clear, so a burst of asks before one control
    /// visit coalesces into a single `on_main_thread` call — enough for the
    /// contract: the call completes whatever the plugin parked on it.
    pub fn mark_main_thread_callback_requested(&self) {
        // Published before the hint, so a sweep the hint wakes always finds the
        // ask it is being woken for.
        self.main_thread_callback_pending
            .store(true, Ordering::Release);
        signal_pending_main_thread_callback();
    }

    /// Atomically read-and-clear the pending main-thread callback request.
    pub fn take_main_thread_callback_requested(&self) -> bool {
        self.main_thread_callback_pending
            .swap(false, Ordering::AcqRel)
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

/// Process-wide hint that some plugin asked something of its editor window: a
/// different size, to be shown or hidden, a closed editor, new resize hints.
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

/// Serialises every raiser of the process-wide tail hint against every asserter
/// of it. The hint is raised from this module's tests and from the wrapper's, so
/// the lock is crate-visible beside the hint it guards; `#[cfg(test)]` keeps it
/// out of production builds.
#[cfg(test)]
pub(crate) static TAIL_SIGNAL_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Serialises every raiser of the process-wide editor-resize hint against
/// every asserter of it, so one test's raise cannot stand in for another's
/// deleted one. Raisers live in more than one of this crate's test modules,
/// which is why the lock is crate-visible here beside the hint it guards;
/// `#[cfg(test)]` keeps it out of production builds.
#[cfg(test)]
pub(crate) static RESIZE_SIGNAL_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Serialises every test that reads or clears the restart hint, for the same
/// reason the resize lock exists: the hint is process-wide, and its raisers
/// live in more than one of this crate's test modules.
#[cfg(test)]
pub(crate) static LATENCY_REQUERY_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Process-wide hint that some plugin raised `clap_host.request_restart`.
///
/// A hint, never the record — each instance's own latency-dirty flag is that.
/// A lost signal costs at most one watcher interval, because the flag stays set
/// until a control pass takes it. The hint carries no instance id because the
/// raising callback is `[thread-safe]`: a plugin may raise it from inside
/// `process()`, where copying the id onto the heap is the allocation this
/// whole path exists to keep off the callback.
static LATENCY_REQUERY_PENDING: AtomicBool = AtomicBool::new(false);

/// Raise the restart hint. **Called from the plugin's own thread — CLAP marks
/// `request_restart` `[thread-safe]`, so this may be the audio thread — so it
/// is one release store and nothing else.**
pub fn signal_pending_latency_requery() {
    LATENCY_REQUERY_PENDING.store(true, Ordering::Release);
}

/// Read and clear the restart hint.
pub fn take_pending_latency_requery_signal() -> bool {
    LATENCY_REQUERY_PENDING.swap(false, Ordering::AcqRel)
}

/// Process-wide hint that some plugin raised `clap_host.request_callback`.
///
/// A hint, never the record — each instance's own pending flag is that. A lost
/// signal costs at most one watcher interval, because the flag stays set until
/// a control visit takes it. The hint carries no instance id because the raising
/// callback is `[thread-safe]`: a plugin may raise it from inside `process()`,
/// where copying the id onto the heap is the allocation this path exists to keep
/// off the calling thread.
static MAIN_THREAD_CALLBACK_PENDING: AtomicBool = AtomicBool::new(false);

/// Raise the main-thread callback hint. **Called from the plugin's own thread —
/// CLAP marks `request_callback` `[thread-safe]`, so this may be the audio
/// thread — so it is one release store and nothing else.**
pub fn signal_pending_main_thread_callback() {
    MAIN_THREAD_CALLBACK_PENDING.store(true, Ordering::Release);
}

/// Read and clear the main-thread callback hint.
pub fn take_pending_main_thread_callback_signal() -> bool {
    MAIN_THREAD_CALLBACK_PENDING.swap(false, Ordering::AcqRel)
}

/// Serialises every test that raises or reads the main-thread callback hint,
/// for the same reason the restart lock exists: the hint is process-wide.
#[cfg(test)]
pub(crate) static MAIN_THREAD_CALLBACK_SIGNAL_TEST_LOCK: std::sync::Mutex<()> =
    std::sync::Mutex::new(());

/// Borrow the host callback state pinned into a `clap_host`'s `host_data`.
/// Returns `None` when `host` or `host_data` is null (e.g. a descriptor created
/// without per-instance state, such as legacy test fixtures).
///
/// # Safety
/// `host` must be null or point to a live `clap_host`, and that descriptor's
/// `host_data` must be null or point to a `HostCallbackState` that stays alive
/// and is not mutated through a unique reference for `'a`.
unsafe fn host_state<'a>(host: *const clap_host) -> Option<&'a HostCallbackState> {
    if host.is_null() {
        return None;
    }
    // SAFETY: `host` is non-null (checked above) and live per this fn's contract.
    let data = unsafe { (*host).host_data } as *const HostCallbackState;
    if data.is_null() {
        return None;
    }
    // SAFETY: `data` is non-null (checked above) and, per this fn's contract,
    // points to a `HostCallbackState` valid for `'a`.
    Some(unsafe { &*data })
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

    // SAFETY: `extension_id` is non-null (checked above), and CLAP requires the
    // plugin to pass a NUL-terminated string that outlives this call.
    let id = unsafe { CStr::from_ptr(extension_id) };

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
    // A restart request is how a running plugin asks to change latency (and
    // other activation-time invariants). CLAP forbids latency changes while
    // active, so the flag is recorded and the control thread reacts by
    // deactivating, reactivating and re-querying `clap_plugin_latency.get()`.
    //
    // Deliberately silent, and the wake is the wait-free hint rather than the
    // notifier's channel: CLAP marks `request_restart` [thread-safe], so a
    // plugin may call it from its audio thread, where the notifier's
    // heap-copied instance id and channel node are a missed device period.
    // #3745 was that allocation. The flag is the record; the latency watcher
    // services the hint and makes the same re-query the channel wake did.
    //
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    if let Some(state) = unsafe { host_state(host) } {
        state.flag_latency_requery();
    }
}

unsafe extern "C" fn host_request_process(_host: *const clap_host) {
    // Plugin wants to be woken up. Our host always processes, so this is a no-op.
}

/// The plugin asks the host to call `on_main_thread` on it.
///
/// Recorded and hinted, never answered here: the plugin call is `[main-thread]`
/// work, and this callback is `[thread-safe]` — plugins raise it from inside
/// `process()` on the audio thread, where re-entering the instance is exactly
/// what the access seam exists to prevent, and where an allocation, a lock or a
/// syscall is a missed device period. The flag is the record, the process-wide
/// hint is the wake, and the request watcher's sweep makes the call through the
/// control seam. #3746 was this being a no-op, leaving a conforming plugin's
/// deferred worker results and editor updates forever pending; #6566 was its
/// wake allocating on the calling thread.
unsafe extern "C" fn host_request_callback(host: *const clap_host) {
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    if let Some(state) = unsafe { host_state(host) } {
        state.mark_main_thread_callback_requested();
    }
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
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    if let Some(state) = unsafe { host_state(host) } {
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
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    if let Some(state) = unsafe { host_state(host) } {
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

/// The plugin's resize constraints changed.
///
/// Recorded and hinted, like `request_resize`: CLAP marks it
/// `[thread-safe & !floating]`, and re-reading `can_resize` and the hints is
/// editor work for the thread that owns the window.
unsafe extern "C" fn host_gui_resize_hints_changed(host: *const clap_host) {
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    if let Some(state) = unsafe { host_state(host) } {
        state.mark_editor_resize_hints_changed();
    }
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
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    match unsafe { host_state(host) } {
        Some(state) => state.request_editor_resize(width, height),
        None => false,
    }
}

/// The plugin asks for its editor window to be shown. `[thread-safe]`, so
/// recorded and hinted; `false` when nothing is going to show it.
unsafe extern "C" fn host_gui_request_show(host: *const clap_host) -> bool {
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    match unsafe { host_state(host) } {
        Some(state) => state.request_editor_visibility(EditorVisibility::Show),
        None => false,
    }
}

/// The plugin asks for its editor window to be hidden. `[thread-safe]`, so
/// recorded and hinted; `false` when nothing is going to hide it.
unsafe extern "C" fn host_gui_request_hide(host: *const clap_host) -> bool {
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    match unsafe { host_state(host) } {
        Some(state) => state.request_editor_visibility(EditorVisibility::Hide),
        None => false,
    }
}

/// The plugin's editor ended on its own — its own close control, or a lost
/// connection. `[thread-safe]`, so recorded and hinted: tearing the editor
/// session down is window work, and with `was_destroyed` the host still owes
/// the plugin a `gui.destroy` to acknowledge it.
unsafe extern "C" fn host_gui_closed(host: *const clap_host, was_destroyed: bool) {
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    if let Some(state) = unsafe { host_state(host) } {
        state.mark_editor_closed(was_destroyed);
    }
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
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    if let Some(state) = unsafe { host_state(host) } {
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
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    if let Some(state) = unsafe { host_state(host) } {
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
    // SAFETY: `host` is the `clap_host` this crate handed the plugin, whose
    // `host_data` is null or the `HostCallbackState` pinned for the instance's life.
    if let Some(state) = unsafe { host_state(host) } {
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
        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
        unsafe { host_latency_changed(&host as *const clap_host) };
        assert!(
            state.take_latency_dirty(),
            "changed() marks the instance dirty"
        );
        assert!(!state.take_latency_dirty(), "take clears the flag");
    }

    #[test]
    fn request_restart_marks_latency_dirty() {
        // The callback raises the process-wide hint as a side effect, so this
        // test must not interleave with the tests that read that hint.
        let _hint_guard = LATENCY_REQUERY_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = HostCallbackState::default();
        let host = host_with_state(&state);

        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
        unsafe { host_request_restart(&host as *const clap_host) };
        assert!(
            state.take_latency_dirty(),
            "request_restart() marks the instance dirty so latency is re-queried"
        );
    }

    #[test]
    fn latency_changed_callback_wakes_the_installed_notifier_and_restart_does_not() {
        use std::sync::atomic::AtomicUsize;
        use std::sync::Arc;

        // The restart leg of this test raises and reads the process-wide hint.
        let _hint_guard = LATENCY_REQUERY_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        take_pending_latency_requery_signal();

        assert_eq!(
            wakes.load(Ordering::Relaxed),
            0,
            "no wake before a callback"
        );
        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
        unsafe { host_latency_changed(&host as *const clap_host) };
        assert_eq!(
            wakes.load(Ordering::Relaxed),
            1,
            "changed() wakes the observer"
        );

        // `request_restart` is [thread-safe], so a plugin may call it from the
        // audio thread: waking the allocating channel from there is the #3745
        // defect, and the wait-free hint is the wake instead.
        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
        unsafe { host_request_restart(&host as *const clap_host) };
        assert_eq!(
            wakes.load(Ordering::Relaxed),
            1,
            "request_restart() must not send on the allocating channel"
        );
        assert!(
            take_pending_latency_requery_signal(),
            "the restart's wake is the wait-free hint"
        );

        // A second install is refused, so the wake cannot be hijacked mid-life.
        assert!(!state.set_latency_notifier(Box::new(|| {})));
        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
        unsafe { host_latency_changed(&host as *const clap_host) };
        assert_eq!(
            wakes.load(Ordering::Relaxed),
            2,
            "original notifier still fires"
        );
    }

    /// The hint is a wake, never the record: a restart's re-query is owed
    /// whether or not a control pass has seen the hint yet, so the dirty flag
    /// the [thread-safe] callback leaves behind must be exactly the one the
    /// re-query consumes.
    #[test]
    fn a_restart_request_records_the_dirty_flag_beside_its_hint() {
        let _guard = LATENCY_REQUERY_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = HostCallbackState::default();
        let host = host_with_state(&state);
        take_pending_latency_requery_signal();

        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
        unsafe { host_request_restart(&host as *const clap_host) };

        assert!(
            state.take_latency_dirty(),
            "the restart is recorded as a latency re-query the control path owes"
        );
        assert!(
            take_pending_latency_requery_signal(),
            "one restart raises the hint once"
        );
        assert!(
            !take_pending_latency_requery_signal(),
            "and the hint is read-and-clear"
        );
    }

    /// Restarts are coalesced by the flag they share: several before one
    /// control pass leave one re-query owed and one hint standing.
    #[test]
    fn repeated_restart_requests_coalesce_into_one_owed_requery() {
        let _guard = LATENCY_REQUERY_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = HostCallbackState::default();
        let host = host_with_state(&state);
        take_pending_latency_requery_signal();

        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
        unsafe { host_request_restart(&host as *const clap_host) };
        // SAFETY: as above.
        unsafe { host_request_restart(&host as *const clap_host) };

        assert!(state.take_latency_dirty());
        assert!(
            !state.take_latency_dirty(),
            "two restarts are one re-query, not two"
        );
        assert!(take_pending_latency_requery_signal());
        assert!(!take_pending_latency_requery_signal());
    }

    /// #3746's recording half: `request_callback` used to be a no-op, so a
    /// conforming plugin's deferred main-thread work never ran. The ask must
    /// reach the control path as a recorded request with its hint raised, and
    /// never through the allocating channel wake.
    #[test]
    fn a_main_thread_callback_request_is_recorded_and_raises_the_hint() {
        let _guard = MAIN_THREAD_CALLBACK_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);
        take_pending_main_thread_callback_signal();

        assert!(
            !state.take_main_thread_callback_requested(),
            "nothing is pending before the call"
        );
        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
        unsafe { host_request_callback(&host as *const clap_host) };

        assert!(
            take_pending_main_thread_callback_signal(),
            "the ask raises the hint the request watcher sweeps on"
        );
        assert!(
            requests.lock().expect("request log").is_empty(),
            "the ask never reaches the channel wake"
        );
        assert!(
            state.take_main_thread_callback_requested(),
            "the ask is recorded, so a lost hint costs a delay and never the call"
        );

        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
        unsafe { host_request_callback(&host as *const clap_host) };
        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
        unsafe { host_request_callback(&host as *const clap_host) };
        assert!(
            state.take_main_thread_callback_requested(),
            "a fresh ask after a consumed one is recorded in its turn"
        );
    }

    /// #6566: CLAP marks `request_callback` `[thread-safe]`, and plugins raise it
    /// from inside `process()`. The wake installed here does what the native
    /// host's does — copies the instance id and sends it on a channel — so a
    /// callback that still reached it would allocate on the calling thread.
    #[test]
    fn a_main_thread_callback_request_allocates_nothing_on_the_calling_thread() {
        let _guard = MAIN_THREAD_CALLBACK_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = HostCallbackState::default();
        let (sender, receiver) = std::sync::mpsc::channel();
        assert!(state.set_request_notifier(Box::new(move |request| {
            let _ = sender.send(("instance-1".to_string(), request));
        })));
        let host = host_with_state(&state);
        take_pending_main_thread_callback_signal();

        let before = crate::allocation_counter::allocation_count();
        for _ in 0..64 {
            // SAFETY: `host` is a live local descriptor whose `host_data` points
            // at a `state` that outlives the call.
            unsafe { host_request_callback(&host as *const clap_host) };
        }
        let allocations = crate::allocation_counter::allocation_count() - before;

        assert_eq!(
            allocations, 0,
            "request_callback allocated {allocations} times on the calling thread"
        );
        assert!(
            receiver.try_recv().is_err(),
            "the allocating channel wake is not reached"
        );
        assert!(
            take_pending_main_thread_callback_signal(),
            "the wait-free hint is the wake instead"
        );
        assert!(
            state.take_main_thread_callback_requested(),
            "the ask is still recorded"
        );
    }

    /// An ask raised before the native engine took the instance raised its hint
    /// while no sweep could find the instance, and that sweep spent the hint.
    /// Installing the wake is when the instance becomes sweepable, so the
    /// install raises the hint again for the ask still standing.
    #[test]
    fn installing_the_wake_re_raises_the_hint_for_an_ask_made_before_it() {
        let _guard = MAIN_THREAD_CALLBACK_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = HostCallbackState::default();
        let host = host_with_state(&state);
        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
        unsafe { host_request_callback(&host as *const clap_host) };
        assert!(take_pending_main_thread_callback_signal());

        assert!(state.set_request_notifier(Box::new(|_| {})));

        assert!(
            take_pending_main_thread_callback_signal(),
            "the standing ask is hinted again once the instance can be swept"
        );
        assert!(state.take_main_thread_callback_requested());
    }

    #[test]
    fn installing_the_wake_with_no_standing_ask_raises_no_hint() {
        let _guard = MAIN_THREAD_CALLBACK_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = HostCallbackState::default();
        take_pending_main_thread_callback_signal();

        assert!(state.set_request_notifier(Box::new(|_| {})));

        assert!(!take_pending_main_thread_callback_signal());
    }

    #[test]
    fn the_restart_and_callback_callbacks_tolerate_a_null_host_state() {
        let _guard = LATENCY_REQUERY_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _callback_guard = MAIN_THREAD_CALLBACK_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let host = create_host_descriptor();
        assert!(host.host_data.is_null());
        take_pending_latency_requery_signal();
        take_pending_main_thread_callback_signal();

        // SAFETY: `host` is a live local descriptor whose `host_data` is null,
        // which `host_state` maps to `None`.
        unsafe { host_request_restart(&host as *const clap_host) };
        // SAFETY: as above.
        unsafe { host_request_callback(&host as *const clap_host) };

        assert!(
            !take_pending_latency_requery_signal(),
            "a descriptor with no per-instance state records nothing"
        );
        assert!(
            !take_pending_main_thread_callback_signal(),
            "a descriptor with no per-instance state raises no callback hint"
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
        // SAFETY: `host` is a live local descriptor whose `host_data` is null,
        // which `host_state` maps to `None`.
        unsafe { host_latency_changed(&host as *const clap_host) };
        // SAFETY: as above.
        unsafe { host_request_restart(&host as *const clap_host) };
    }

    /// Serialises every test that raises the process-wide flush hint, so one
    /// test's raise cannot stand in for another's deleted one.
    static FLUSH_SIGNAL_TEST_LOCK: Mutex<()> = Mutex::new(());

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

    fn resize_signal_guard() -> std::sync::MutexGuard<'static, ()> {
        RESIZE_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// #6567: CLAP marks `request_show`, `request_hide` and `closed`
    /// `[thread-safe]` and `resize_hints_changed` `[thread-safe & !floating]`, so a
    /// plugin may raise any of them from inside `process()`. The wake installed
    /// here allocates the way the native host's does, so reaching it would
    /// allocate on the calling thread.
    #[test]
    fn the_editor_window_callbacks_allocate_nothing_on_the_calling_thread() {
        let _guard = resize_signal_guard();
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);
        take_pending_editor_resize_signal();

        let before = crate::allocation_counter::allocation_count();
        for _ in 0..64 {
            // SAFETY: `host` is a live local descriptor whose `host_data` points
            // at a `state` that outlives each call.
            unsafe { host_gui_request_hide(&host as *const clap_host) };
            // SAFETY: as above.
            unsafe { host_gui_request_show(&host as *const clap_host) };
            // SAFETY: as above.
            unsafe { host_gui_resize_hints_changed(&host as *const clap_host) };
            // SAFETY: as above.
            unsafe { host_gui_closed(&host as *const clap_host, false) };
        }
        let allocations = crate::allocation_counter::allocation_count() - before;

        assert_eq!(
            allocations, 0,
            "the editor window callbacks allocated {allocations} times on the calling thread"
        );
        assert!(
            requests.lock().expect("request log").is_empty(),
            "the allocating channel wake is not reached"
        );
        assert!(
            take_pending_editor_resize_signal(),
            "the wait-free editor hint is the wake instead"
        );
        assert_eq!(
            state.take_editor_window_asks(),
            EditorWindowAsks {
                visibility: Some(EditorVisibility::Show),
                closed: Some(EditorClosed {
                    was_destroyed: false
                }),
                resize_hints_changed: true,
            },
            "every ask is recorded, the newest visibility winning"
        );
    }

    /// One callback's wake must not be borrowed from another's, so each is
    /// called alone against a cleared hint.
    #[test]
    fn each_editor_window_callback_raises_the_wake_on_its_own() {
        fn raises_the_hint(call: impl FnOnce()) -> bool {
            take_pending_editor_resize_signal();
            call();
            take_pending_editor_resize_signal()
        }

        let _guard = resize_signal_guard();
        let (state, _requests) = state_with_open_editor();
        let host = host_with_state(&state);
        let host_ptr = &host as *const clap_host;

        assert!(
            // SAFETY: `host` is a live local descriptor whose `host_data`
            // points at a `state` that outlives each call.
            raises_the_hint(|| {
                // SAFETY: as above.
                let _accepted = unsafe { host_gui_request_show(host_ptr) };
            }),
            "request_show did not raise the editor hint"
        );
        assert!(
            // SAFETY: as above.
            raises_the_hint(|| {
                // SAFETY: as above.
                let _accepted = unsafe { host_gui_request_hide(host_ptr) };
            }),
            "request_hide did not raise the editor hint"
        );
        assert!(
            // SAFETY: as above.
            raises_the_hint(|| unsafe { host_gui_closed(host_ptr, false) }),
            "closed did not raise the editor hint"
        );
        assert!(
            // SAFETY: as above.
            raises_the_hint(|| unsafe { host_gui_resize_hints_changed(host_ptr) }),
            "resize_hints_changed did not raise the editor hint"
        );
    }

    #[test]
    fn a_show_or_hide_is_accepted_only_where_a_window_and_a_wake_will_carry_it() {
        let _guard = resize_signal_guard();
        let (state, _requests) = state_with_open_editor();
        let host = host_with_state(&state);
        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
        assert!(unsafe { host_gui_request_hide(&host as *const clap_host) });
        assert_eq!(
            state.take_editor_window_asks().visibility,
            Some(EditorVisibility::Hide)
        );

        state.set_editor_resize_available(false);
        // SAFETY: as above.
        assert!(!unsafe { host_gui_request_show(&host as *const clap_host) });
        assert!(state.take_editor_window_asks().is_empty());

        let unwoken = HostCallbackState::default();
        unwoken.set_editor_resize_available(true);
        let unwoken_host = host_with_state(&unwoken);
        // SAFETY: as above, for `unwoken`.
        assert!(!unsafe { host_gui_request_show(&unwoken_host as *const clap_host) });
        assert!(unwoken.take_editor_window_asks().is_empty());
    }

    /// gui.h: with `was_destroyed` the host must acknowledge with `destroy`, so
    /// a later report that the editor merely closed must not weaken it into a
    /// hide on a view that is gone.
    #[test]
    fn a_destroyed_report_is_kept_over_a_later_closed_one() {
        let _guard = resize_signal_guard();
        let state = HostCallbackState::default();
        state.mark_editor_closed(true);
        state.mark_editor_closed(false);

        assert_eq!(
            state.take_editor_window_asks().closed,
            Some(EditorClosed {
                was_destroyed: true
            })
        );
        assert!(state.take_editor_window_asks().is_empty(), "taking clears");
    }

    #[test]
    fn asks_about_a_previous_editor_are_discarded_before_the_next_opens() {
        let _guard = resize_signal_guard();
        let state = HostCallbackState::default();
        state.mark_editor_closed(true);
        state.mark_editor_resize_hints_changed();

        state.discard_editor_window_asks();

        assert!(state.take_editor_window_asks().is_empty());
    }

    #[test]
    fn the_editor_window_callbacks_tolerate_a_null_host_state() {
        let host = create_host_descriptor();
        // SAFETY: `host` is a live local descriptor with a null `host_data`.
        assert!(!unsafe { host_gui_request_show(&host as *const clap_host) });
        // SAFETY: as above.
        assert!(!unsafe { host_gui_request_hide(&host as *const clap_host) });
        // SAFETY: as above.
        unsafe { host_gui_closed(&host as *const clap_host, true) };
        // SAFETY: as above.
        unsafe { host_gui_resize_hints_changed(&host as *const clap_host) };
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

        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
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
        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
        let accepted_again =
            unsafe { host_gui_request_resize(&host as *const clap_host, 800, 600) };
        assert!(accepted_again);
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
        // The resize hint is process-wide, so a raise from any other test
        // landing between this test's clear and its assert would mask a deleted
        // raise. RESIZE_SIGNAL_TEST_LOCK prevents that only because every
        // raiser in the crate — this module's tests and the wrapper's alike —
        // holds it; an unserialised raiser anywhere reopens the window.
        let _guard = RESIZE_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);
        take_pending_editor_resize_signal();

        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
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
        let _guard = RESIZE_SIGNAL_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (state, _requests) = state_with_open_editor();
        let host = host_with_state(&state);

        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
        unsafe { host_gui_request_resize(&host as *const clap_host, 640, 480) };
        // SAFETY: as above.
        unsafe { host_gui_request_resize(&host as *const clap_host, 1280, 720) };

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

        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
        let zero_width = unsafe { host_gui_request_resize(&host as *const clap_host, 0, 480) };
        // SAFETY: as above.
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

        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
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
        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
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

        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
        let accepted = unsafe { host_gui_request_resize(&host as *const clap_host, 1024, 768) };
        assert!(!accepted);
        assert_eq!(state.take_editor_resize(), None);
    }

    #[test]
    fn mark_dirty_records_the_signal_and_wakes_the_control_path() {
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);

        assert!(!state.take_state_dirty(), "flag starts clear");
        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
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
        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
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

        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
        unsafe { host_state_mark_dirty(&host as *const clap_host) };

        assert!(state.take_state_dirty());
    }

    /// Legacy descriptors carry a null `host_data`. A resize cannot be applied
    /// through one, so it must be refused rather than accepted blind.
    #[test]
    fn the_gui_and_state_callbacks_tolerate_a_null_host_state() {
        let host = create_host_descriptor();
        assert!(host.host_data.is_null());

        // SAFETY: `host` is a live local descriptor whose `host_data` is null,
        // which `host_state` maps to `None`.
        let accepted = unsafe { host_gui_request_resize(&host as *const clap_host, 640, 480) };
        assert!(!accepted);
        // SAFETY: as above.
        unsafe { host_state_mark_dirty(&host as *const clap_host) };
    }

    /// The whole of AC-002's first half: the callback used to be a comment. The
    /// control path can only re-enumerate if the callback records that it must.
    #[test]
    fn a_rescan_callback_records_the_ask_and_wakes_the_control_path() {
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);

        assert!(!state.take_parameters_rescan(), "flag starts clear");
        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
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

            // SAFETY: `host` is a live local descriptor whose `host_data` points
            // at a `state` that outlives the call.
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
        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
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

        // SAFETY: `host` is a live local descriptor whose `host_data` is null or
        // points at a `state` that outlives the call.
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

        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
        unsafe { host_params_rescan(&host as *const clap_host, 0) };
        // SAFETY: as above.
        unsafe { host_params_request_flush(&host as *const clap_host) };

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

        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
        unsafe { host_params_rescan(&host as *const clap_host, 0) };
        // SAFETY: as above.
        unsafe { host_params_request_flush(&host as *const clap_host) };

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

        // SAFETY: `host` is a live local descriptor whose `host_data` is null,
        // which `host_state` maps to `None`.
        unsafe { host_params_rescan(&host as *const clap_host, 0) };
        // SAFETY: as above.
        unsafe { host_params_request_flush(&host as *const clap_host) };
        // SAFETY: `host_params_clear` ignores its arguments.
        unsafe { host_params_clear(&host as *const clap_host, 3, 0) };
    }

    /// `clear` is deliberately deferred, and "deferred" has to mean it records
    /// nothing: a flag no control path drains is a leak that reads, to the next
    /// author, like an implemented callback.
    #[test]
    fn clear_records_nothing_because_it_is_deferred_rather_than_queued() {
        let (state, requests) = state_with_open_editor();
        let host = host_with_state(&state);

        // SAFETY: `host_params_clear` ignores its arguments; `host` is a live local
        // descriptor anyway.
        unsafe { host_params_clear(&host as *const clap_host, 3, u32::MAX) };

        assert!(requests.lock().expect("request log").is_empty());
        assert!(!state.take_parameters_rescan());
        assert!(!state.take_parameters_flush());
        assert!(!state.take_state_dirty());
    }

    #[test]
    fn get_extension_exposes_the_params_extension_with_every_callback_bound() {
        // SAFETY: `host_get_extension` ignores its host argument, and
        // `CLAP_EXT_PARAMS` is a NUL-terminated C string.
        let ptr = unsafe { host_get_extension(std::ptr::null(), CLAP_EXT_PARAMS.as_ptr()) };
        assert!(!ptr.is_null(), "host advertises clap.params");
        // SAFETY: for `clap.params` the host returns `&HOST_PARAMS`, a `'static`
        // `clap_host_params`, and the assert above ruled out null.
        let ext = unsafe { &*(ptr as *const clap_host_params) };
        assert!(ext.rescan.is_some());
        assert!(ext.clear.is_some());
        assert!(ext.request_flush.is_some());
    }

    #[test]
    fn get_extension_exposes_the_latency_extension() {
        // SAFETY: `host_get_extension` ignores its host argument, and
        // `CLAP_EXT_LATENCY` is a NUL-terminated C string.
        let ptr = unsafe { host_get_extension(std::ptr::null(), CLAP_EXT_LATENCY.as_ptr()) };
        assert!(!ptr.is_null(), "host advertises clap.latency");
        // SAFETY: for `clap.latency` the host returns `&HOST_LATENCY`, a `'static`
        // `clap_host_latency`, and the assert above ruled out null.
        let ext = unsafe { &*(ptr as *const clap_host_latency) };
        assert!(ext.changed.is_some());
    }

    /// A plugin only calls `clap_host_tail.changed` if the host answers the
    /// query for `clap.tail`. Without this the tail flag can never be raised, so
    /// every tail the host reports is the one read at load and nothing else.
    #[test]
    fn get_extension_exposes_the_tail_extension() {
        // SAFETY: `host_get_extension` ignores its host argument, and
        // `CLAP_EXT_TAIL` is a NUL-terminated C string.
        let ptr = unsafe { host_get_extension(std::ptr::null(), CLAP_EXT_TAIL.as_ptr()) };
        assert!(!ptr.is_null(), "host advertises clap.tail");
        // SAFETY: for `clap.tail` the host returns `&HOST_TAIL`, a `'static`
        // `clap_host_tail`, and the assert above ruled out null.
        let ext = unsafe { &*(ptr as *const clap_host_tail) };
        assert!(ext.changed.is_some());
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

        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
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

        // SAFETY: `host` is a live local descriptor whose `host_data` points at
        // a `state` that outlives the call.
        unsafe { host_tail_changed(&host as *const clap_host) };

        assert!(take_pending_tail_change_signal(), "the hint is raised");
        assert!(
            !take_pending_tail_change_signal(),
            "the hint is read-and-clear"
        );
    }
}
