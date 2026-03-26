/// CLAP Host implementation — provides the `clap_host_t` struct that plugins receive.
///
/// The CLAP spec requires the host to provide a set of callback function pointers
/// that the plugin can call for services like requesting restarts, parameter flushes, etc.

use clap_sys::host::clap_host;
use clap_sys::version::CLAP_VERSION;
use std::os::raw::c_void;

/// A static host descriptor that outlives all plugin instances.
/// CLAP plugins receive a pointer to this during creation.
static HOST_NAME: &[u8] = b"Sourdaw\0";
static HOST_VENDOR: &[u8] = b"Sourdaw Team\0";
static HOST_URL: &[u8] = b"https://webdaw.app\0";
static HOST_VERSION: &[u8] = b"0.1.0\0";

/// Create a static `clap_host` descriptor.
/// # Safety
/// The returned struct contains raw function pointers and must remain valid for
/// the lifetime of every plugin that references it.
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

/// Called by the plugin to query host extensions.
/// For V1 we don't provide any extensions, so we return null.
unsafe extern "C" fn host_get_extension(
    _host: *const clap_host,
    _extension_id: *const i8,
) -> *const c_void {
    std::ptr::null()
}

/// Called by the plugin when it needs a restart (e.g. sample rate change).
unsafe extern "C" fn host_request_restart(_host: *const clap_host) {
    // In a full implementation, we'd schedule deactivation + reactivation.
    // For V1, log and ignore.
    eprintln!("[CLAP Host] Plugin requested restart (not yet implemented)");
}

/// Called by the plugin when it wants to be processed (was sleeping).
unsafe extern "C" fn host_request_process(_host: *const clap_host) {
    // Plugin is asking to be woken up for processing.
    // Our host always processes, so this is a no-op.
}

/// Called by the plugin from any thread to schedule a callback on the main thread.
unsafe extern "C" fn host_request_callback(_host: *const clap_host) {
    // Would normally schedule a main-thread callback via plugin.on_main_thread().
    // For V1 this is a no-op.
}
