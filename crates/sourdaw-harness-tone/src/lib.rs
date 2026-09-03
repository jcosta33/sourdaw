//! A self-sounding CLAP effect: it ignores its input and writes a 440 Hz
//! sine at a host-controlled level so the packaged-app latency harness
//! (#3070) can prove "plugin audio reached the master" through the real
//! plugin scanner and host, with no clips or MIDI involved.
//!
//! Entry point: `clap_entry`, the CLAP spec's own symbol name, exported
//! `#[no_mangle]` below. Everything it reaches is `pub(crate)` — nothing
//! else in this crate is meant to be linked against directly.

mod audio_ports;
mod descriptor;
mod factory;
mod params;
mod plugin;
mod tone;

use clap_sys::entry::clap_plugin_entry;
use clap_sys::factory::plugin_factory::CLAP_PLUGIN_FACTORY_ID;
use clap_sys::version::CLAP_VERSION;
use std::ffi::{c_char, c_void, CStr};
use std::ptr;

unsafe extern "C" fn entry_init(_plugin_path: *const c_char) -> bool {
    true
}

unsafe extern "C" fn entry_deinit() {}

unsafe extern "C" fn entry_get_factory(factory_id: *const c_char) -> *const c_void {
    if factory_id.is_null() {
        return ptr::null();
    }
    let id = CStr::from_ptr(factory_id);
    if id == CLAP_PLUGIN_FACTORY_ID {
        return &raw const factory::FACTORY as *const c_void;
    }
    ptr::null()
}

/// The symbol every CLAP host `dlopen`s by name. `#[no_mangle]` is what makes
/// it reachable as `clap_entry` from outside this crate at all.
#[no_mangle]
pub static clap_entry: clap_plugin_entry = clap_plugin_entry {
    clap_version: CLAP_VERSION,
    init: Some(entry_init),
    deinit: Some(entry_deinit),
    get_factory: Some(entry_get_factory),
};
