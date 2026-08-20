use clap_sys::ext::gui::{clap_host_gui, CLAP_EXT_GUI};
use clap_sys::ext::latency::{clap_host_latency, CLAP_EXT_LATENCY};
use clap_sys::ext::params::{clap_host_params, CLAP_EXT_PARAMS};
use clap_sys::ext::state::{clap_host_state, CLAP_EXT_STATE};
/// CLAP Host implementation — provides the `clap_host_t` and host extensions.
///
/// The CLAP spec requires the host to provide callback function pointers
/// that plugins call for services like param changes, GUI resize, state dirty.
use clap_sys::host::clap_host;
use clap_sys::version::CLAP_VERSION;
use std::ffi::CStr;
use std::os::raw::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

/// Host-supplied wake invoked whenever a plugin flags a latency change.
///
/// Runs on whatever thread the plugin called the host callback from, so it must
/// not block, allocate unboundedly, or re-enter the wrapper. The host
/// application installs it to wake its own control path; keeping it an opaque
/// closure is what lets this crate stay free of any transport dependency.
pub type LatencyChangeNotifier = Box<dyn Fn() + Send + Sync>;

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

unsafe extern "C" fn host_params_rescan(_host: *const clap_host, _flags: u32) {
    // Plugin is telling us its parameter list changed.
    // Not yet acted on: re-enumerating parameters belongs on the control thread.
    // No logging here — this callback can arrive from a plugin's own thread.
}

unsafe extern "C" fn host_params_clear(_host: *const clap_host, _param_id: u32, _flags: u32) {
    // Plugin is telling us to clear automation for a parameter.
}

unsafe extern "C" fn host_params_request_flush(_host: *const clap_host) {
    // Plugin wants us to call params.flush() outside of process().
    // We'll handle this in the next audio callback via a flag.
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

unsafe extern "C" fn host_gui_request_resize(
    _host: *const clap_host,
    width: u32,
    height: u32,
) -> bool {
    let _ = (width, height);
    // Accepted without applying: routing this to the shell window's set_size
    // callback is #2174.
    true
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

unsafe extern "C" fn host_state_mark_dirty(_host: *const clap_host) {
    // Plugin state changed — the project should be marked unsaved.
    // Not yet wired, and deliberately not logged: this callback can arrive from
    // a plugin's own thread, where stderr I/O is not acceptable.
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

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn get_extension_exposes_the_latency_extension() {
        unsafe {
            let ptr = host_get_extension(std::ptr::null(), CLAP_EXT_LATENCY.as_ptr());
            assert!(!ptr.is_null(), "host advertises clap.latency");
            let ext = &*(ptr as *const clap_host_latency);
            assert!(ext.changed.is_some());
        }
    }
}
