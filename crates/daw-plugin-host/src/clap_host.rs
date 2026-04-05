use clap_sys::ext::gui::{clap_host_gui, CLAP_EXT_GUI};
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

    std::ptr::null()
}

// ── Host callbacks ─────────────────────────────────────────────────────

unsafe extern "C" fn host_request_restart(_host: *const clap_host) {
    eprintln!("[CLAP Host] Plugin requested restart — scheduling deactivate/reactivate");
    // TODO: Schedule deactivation + reactivation via rtrb command
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
    // In a full implementation, re-enumerate parameters and update the UI.
    eprintln!("[CLAP Host] Plugin requested param rescan");
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
    eprintln!(
        "[CLAP Host] Plugin requested resize to {}x{}",
        width, height
    );
    // TODO: Resize the Tauri window to match
    // For now, accept but don't actually resize
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
    // Plugin closed its own GUI (e.g. user clicked X in the plugin)
    eprintln!("[CLAP Host] Plugin GUI closed by plugin");
}

// ── clap_host_state extension ──────────────────────────────────────────

static HOST_STATE: clap_host_state = clap_host_state {
    mark_dirty: Some(host_state_mark_dirty),
};

unsafe extern "C" fn host_state_mark_dirty(_host: *const clap_host) {
    // Plugin state changed — mark the project as unsaved
    eprintln!("[CLAP Host] Plugin state marked dirty");
}
