//! `clap.params`: the single `Level` parameter, id 0.

use crate::plugin::{apply_parameter_events, tone_from_plugin};
use crate::tone::{LEVEL_DEFAULT, LEVEL_MAX, LEVEL_MIN};
use clap_sys::events::{clap_input_events, clap_output_events};
use clap_sys::ext::params::{clap_param_info, clap_plugin_params, CLAP_PARAM_IS_AUTOMATABLE};
use clap_sys::id::clap_id;
use clap_sys::plugin::clap_plugin;
use clap_sys::string_sizes::{CLAP_NAME_SIZE, CLAP_PATH_SIZE};
use std::ffi::{c_char, CStr};
use std::ptr;

pub(crate) const LEVEL_PARAM_ID: clap_id = 0;
/// This plugin declares exactly one parameter, at list index 0. An index is
/// a position in that list, not the parameter's own id — they only share a
/// value here because there is one parameter to enumerate.
const LEVEL_PARAM_INDEX: u32 = 0;

pub(crate) static PARAMS: clap_plugin_params = clap_plugin_params {
    count: Some(count),
    get_info: Some(get_info),
    get_value: Some(get_value),
    value_to_text: Some(value_to_text),
    text_to_value: Some(text_to_value),
    flush: Some(flush),
};

unsafe extern "C" fn count(_plugin: *const clap_plugin) -> u32 {
    1
}

unsafe extern "C" fn get_info(
    _plugin: *const clap_plugin,
    index: u32,
    info: *mut clap_param_info,
) -> bool {
    if info.is_null() || index != LEVEL_PARAM_INDEX {
        return false;
    }
    let mut name = [0 as c_char; CLAP_NAME_SIZE];
    for (slot, byte) in name.iter_mut().zip(b"Level\0".iter()) {
        *slot = *byte as c_char;
    }
    *info = clap_param_info {
        id: LEVEL_PARAM_ID,
        flags: CLAP_PARAM_IS_AUTOMATABLE,
        cookie: ptr::null_mut(),
        name,
        module: [0; CLAP_PATH_SIZE],
        min_value: LEVEL_MIN,
        max_value: LEVEL_MAX,
        default_value: LEVEL_DEFAULT,
    };
    true
}

unsafe extern "C" fn get_value(
    plugin: *const clap_plugin,
    param_id: clap_id,
    out_value: *mut f64,
) -> bool {
    if out_value.is_null() || param_id != LEVEL_PARAM_ID {
        return false;
    }
    match tone_from_plugin(plugin) {
        Some(tone) => {
            *out_value = tone.level();
            true
        }
        None => false,
    }
}

unsafe extern "C" fn value_to_text(
    _plugin: *const clap_plugin,
    param_id: clap_id,
    value: f64,
    out_buffer: *mut c_char,
    out_buffer_capacity: u32,
) -> bool {
    if param_id != LEVEL_PARAM_ID || out_buffer.is_null() {
        return false;
    }
    let text = format!("{value:.2}");
    let bytes = text.as_bytes();
    if bytes.len() + 1 > out_buffer_capacity as usize {
        return false;
    }
    for (index, byte) in bytes.iter().enumerate() {
        *out_buffer.add(index) = *byte as c_char;
    }
    *out_buffer.add(bytes.len()) = 0;
    true
}

unsafe extern "C" fn text_to_value(
    _plugin: *const clap_plugin,
    param_id: clap_id,
    param_value_text: *const c_char,
    out_value: *mut f64,
) -> bool {
    if param_id != LEVEL_PARAM_ID || param_value_text.is_null() || out_value.is_null() {
        return false;
    }
    let Ok(text) = CStr::from_ptr(param_value_text).to_str() else {
        return false;
    };
    match text.trim().parse::<f64>() {
        Ok(value) => {
            *out_value = value;
            true
        }
        Err(_) => false,
    }
}

/// `clap/ext/params.h` annotates `flush` `[active ? audio-thread : main-thread]`,
/// so it runs on the audio thread whenever this instance is active — which
/// is the only state a real host flushes parameters mid-session for. The
/// header also guarantees `flush` is never called concurrently with
/// `process`, so the two never race for `level` and the `AtomicU64` alone
/// is enough; nothing here needs a lock on top of it. Because this can run
/// on the audio thread, `apply_parameter_events` must stay allocation- and
/// lock-free. No output events: this plugin never raises one of its own.
unsafe extern "C" fn flush(
    plugin: *const clap_plugin,
    in_: *const clap_input_events,
    _out: *const clap_output_events,
) {
    if let Some(tone) = tone_from_plugin(plugin) {
        apply_parameter_events(tone, in_);
    }
}
