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

/// # Safety
/// `info`, when non-null, must be valid and aligned for a write of one
/// `clap_param_info`, as `clap/ext/params.h` requires of the host's
/// `get_info` argument.
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
    // SAFETY: `info` is non-null (checked above) and, per this function's
    // `# Safety` contract, valid and aligned for one `clap_param_info` write;
    // the type is `Copy`, so the overwritten value needs no drop.
    unsafe {
        *info = clap_param_info {
            id: LEVEL_PARAM_ID,
            flags: CLAP_PARAM_IS_AUTOMATABLE,
            cookie: ptr::null_mut(),
            name,
            module: [0; CLAP_PATH_SIZE],
            min_value: LEVEL_MIN,
            max_value: LEVEL_MAX,
            default_value: LEVEL_DEFAULT,
        }
    };
    true
}

/// # Safety
/// `plugin` must satisfy `tone_from_plugin`'s `# Safety` contract, and
/// `out_value`, when non-null, must be valid and aligned for one `f64` write,
/// as `clap/ext/params.h` requires of the host's `get_value` arguments.
unsafe extern "C" fn get_value(
    plugin: *const clap_plugin,
    param_id: clap_id,
    out_value: *mut f64,
) -> bool {
    if out_value.is_null() || param_id != LEVEL_PARAM_ID {
        return false;
    }
    // SAFETY: this function's `# Safety` contract passes on
    // `tone_from_plugin`'s own requirement on `plugin` unchanged.
    match unsafe { tone_from_plugin(plugin) } {
        Some(tone) => {
            // SAFETY: `out_value` is non-null (checked above) and, per this
            // function's `# Safety` contract, valid and aligned for one `f64`
            // write.
            unsafe { *out_value = tone.level() };
            true
        }
        None => false,
    }
}

/// # Safety
/// `out_buffer`, when non-null, must be valid for writes of
/// `out_buffer_capacity` consecutive `c_char`s, as `clap/ext/params.h`
/// requires of the host's `value_to_text` arguments.
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
        // SAFETY: `index < bytes.len()` and `bytes.len() + 1 <=
        // out_buffer_capacity` (checked above), so the offset stays inside
        // the `out_buffer_capacity`-element allocation this function's
        // `# Safety` contract guarantees.
        let slot = unsafe { out_buffer.add(index) };
        // SAFETY: `slot` is in bounds of that host buffer (see above), which
        // the `# Safety` contract makes valid for `c_char` writes.
        unsafe { *slot = *byte as c_char };
    }
    // SAFETY: `bytes.len() < out_buffer_capacity` (checked above), so the
    // terminator offset stays inside the host buffer the `# Safety` contract
    // guarantees.
    let terminator = unsafe { out_buffer.add(bytes.len()) };
    // SAFETY: `terminator` is in bounds of that host buffer (see above), which
    // the `# Safety` contract makes valid for `c_char` writes.
    unsafe { *terminator = 0 };
    true
}

/// # Safety
/// `param_value_text`, when non-null, must point to a NUL-terminated C string
/// that stays live and unmodified for the call, and `out_value`, when
/// non-null, must be valid and aligned for one `f64` write, as
/// `clap/ext/params.h` requires of the host's `text_to_value` arguments.
unsafe extern "C" fn text_to_value(
    _plugin: *const clap_plugin,
    param_id: clap_id,
    param_value_text: *const c_char,
    out_value: *mut f64,
) -> bool {
    if param_id != LEVEL_PARAM_ID || param_value_text.is_null() || out_value.is_null() {
        return false;
    }
    // SAFETY: `param_value_text` is non-null (checked above) and, per this
    // function's `# Safety` contract, NUL-terminated and unmodified for the
    // call; `text` does not outlive the call.
    let Ok(text) = unsafe { CStr::from_ptr(param_value_text) }.to_str() else {
        return false;
    };
    match text.trim().parse::<f64>() {
        Ok(value) => {
            // SAFETY: `out_value` is non-null (checked above) and, per this
            // function's `# Safety` contract, valid and aligned for one `f64`
            // write.
            unsafe { *out_value = value };
            true
        }
        Err(_) => false,
    }
}

/// `clap/ext/params.h` annotates `flush` `[active ? audio-thread : main-thread]`,
/// so it runs on the audio thread while this instance is active and on the
/// main thread while it is not — this plugin must be correct in both
/// branches. The header also guarantees `flush` is never called concurrently
/// with `process`, so the two never race for `level` and the `AtomicU64`
/// alone is enough; nothing here needs a lock on top of it. Because this can
/// run on the audio thread, `apply_parameter_events` must stay allocation-
/// and lock-free. No output events: this plugin never raises one of its own.
///
/// # Safety
/// `plugin` must satisfy `tone_from_plugin`'s `# Safety` contract and `in_`
/// must satisfy `apply_parameter_events`'s, as `clap/ext/params.h` requires
/// of the host's `flush` arguments.
unsafe extern "C" fn flush(
    plugin: *const clap_plugin,
    in_: *const clap_input_events,
    _out: *const clap_output_events,
) {
    // SAFETY: this function's `# Safety` contract passes on
    // `tone_from_plugin`'s requirement on `plugin` unchanged.
    if let Some(tone) = unsafe { tone_from_plugin(plugin) } {
        // SAFETY: this function's `# Safety` contract passes on
        // `apply_parameter_events`'s requirement on `in_` unchanged.
        unsafe { apply_parameter_events(tone, in_) };
    }
}
