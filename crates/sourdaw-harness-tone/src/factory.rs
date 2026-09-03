//! `clap.plugin-factory`: this bundle declares exactly one plugin, the
//! harness tone itself.

use crate::descriptor::{DESCRIPTOR, PLUGIN_ID};
use crate::plugin::{
    activate, deactivate, destroy, get_extension, init, on_main_thread, process, reset,
    start_processing, stop_processing,
};
use crate::tone::Tone;
use clap_sys::factory::plugin_factory::clap_plugin_factory;
use clap_sys::host::clap_host;
use clap_sys::plugin::{clap_plugin, clap_plugin_descriptor};
use std::ffi::{c_char, c_void, CStr};
use std::ptr;

pub(crate) static FACTORY: clap_plugin_factory = clap_plugin_factory {
    get_plugin_count: Some(plugin_count),
    get_plugin_descriptor: Some(plugin_descriptor),
    create_plugin: Some(create_plugin),
};

unsafe extern "C" fn plugin_count(_factory: *const clap_plugin_factory) -> u32 {
    1
}

unsafe extern "C" fn plugin_descriptor(
    _factory: *const clap_plugin_factory,
    index: u32,
) -> *const clap_plugin_descriptor {
    if index == 0 {
        &raw const DESCRIPTOR
    } else {
        ptr::null()
    }
}

unsafe extern "C" fn create_plugin(
    _factory: *const clap_plugin_factory,
    _host: *const clap_host,
    plugin_id: *const c_char,
) -> *const clap_plugin {
    if plugin_id.is_null() {
        return ptr::null();
    }
    let requested = CStr::from_ptr(plugin_id);
    if requested.to_bytes_with_nul() != PLUGIN_ID {
        return ptr::null();
    }

    let tone = Box::into_raw(Box::new(Tone::new()));
    Box::into_raw(Box::new(clap_plugin {
        desc: &raw const DESCRIPTOR,
        plugin_data: tone as *mut c_void,
        init: Some(init),
        destroy: Some(destroy),
        activate: Some(activate),
        deactivate: Some(deactivate),
        start_processing: Some(start_processing),
        stop_processing: Some(stop_processing),
        reset: Some(reset),
        process: Some(process),
        get_extension: Some(get_extension),
        on_main_thread: Some(on_main_thread),
    }))
}
