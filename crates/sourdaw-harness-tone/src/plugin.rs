//! The `clap_plugin` vtable: lifecycle callbacks and the RT `process` path.
//! Everything that touches audio buffers or event lists lives here; the tone
//! itself (`crate::tone::Tone`) stays free of FFI.

use crate::audio_ports::AUDIO_PORTS;
use crate::params::{LEVEL_PARAM_ID, PARAMS};
use crate::tone::{Tone, LEVEL_MAX, LEVEL_MIN};
use clap_sys::events::{clap_event_param_value, clap_input_events, CLAP_EVENT_PARAM_VALUE};
use clap_sys::ext::audio_ports::CLAP_EXT_AUDIO_PORTS;
use clap_sys::ext::params::CLAP_EXT_PARAMS;
use clap_sys::plugin::clap_plugin;
use clap_sys::process::{
    clap_process, clap_process_status, CLAP_PROCESS_CONTINUE, CLAP_PROCESS_ERROR,
};
use std::ffi::{c_char, c_void, CStr};
use std::ptr;

/// The `Tone` behind a `clap_plugin`'s `plugin_data`, or `None` for a null
/// plugin or an instance the factory never attached one to.
///
/// # Safety
/// `plugin`, when non-null, must point to a live `clap_plugin` created by
/// `factory::create_plugin`, whose `plugin_data` is a live `Box<Tone>` this
/// call is the only live reference to.
pub(crate) unsafe fn tone_from_plugin<'a>(plugin: *const clap_plugin) -> Option<&'a mut Tone> {
    if plugin.is_null() {
        return None;
    }
    let data = (*plugin).plugin_data;
    if data.is_null() {
        return None;
    }
    Some(&mut *(data as *mut Tone))
}

pub(crate) unsafe extern "C" fn init(_plugin: *const clap_plugin) -> bool {
    true
}

/// Free the `Tone` and the `clap_plugin` itself. CLAP calls `destroy` at
/// most once per instance, after processing has stopped, so this is the only
/// place either allocation is freed.
pub(crate) unsafe extern "C" fn destroy(plugin: *const clap_plugin) {
    if plugin.is_null() {
        return;
    }
    let data = (*plugin).plugin_data;
    if !data.is_null() {
        drop(Box::from_raw(data as *mut Tone));
    }
    drop(Box::from_raw(plugin as *mut clap_plugin));
}

pub(crate) unsafe extern "C" fn activate(
    plugin: *const clap_plugin,
    sample_rate: f64,
    _min_frames_count: u32,
    _max_frames_count: u32,
) -> bool {
    match tone_from_plugin(plugin) {
        Some(tone) => {
            tone.activate(sample_rate);
            true
        }
        None => false,
    }
}

pub(crate) unsafe extern "C" fn get_extension(
    _plugin: *const clap_plugin,
    extension_id: *const c_char,
) -> *const c_void {
    if extension_id.is_null() {
        return ptr::null();
    }
    let id = CStr::from_ptr(extension_id);
    if id == CLAP_EXT_AUDIO_PORTS {
        return &raw const AUDIO_PORTS as *const c_void;
    }
    if id == CLAP_EXT_PARAMS {
        return &raw const PARAMS as *const c_void;
    }
    ptr::null()
}

pub(crate) unsafe extern "C" fn process(
    plugin: *const clap_plugin,
    process: *const clap_process,
) -> clap_process_status {
    if plugin.is_null() || process.is_null() {
        return CLAP_PROCESS_ERROR;
    }
    let Some(tone) = tone_from_plugin(plugin) else {
        return CLAP_PROCESS_ERROR;
    };
    let process_ref = &*process;
    apply_parameter_events(tone, process_ref.in_events);
    render_block(tone, process_ref);
    CLAP_PROCESS_CONTINUE
}

/// Apply every pending `CLAP_EVENT_PARAM_VALUE` for the Level parameter.
/// Block-level: the last matching event in the block wins, with no
/// sample-accurate split.
///
/// # Safety
/// `in_events`, when non-null, must be a live `clap_input_events` whose
/// `size`/`get` callbacks are valid for the duration of this call — the
/// contract `process` and `clap.params.flush` both receive it under.
pub(crate) unsafe fn apply_parameter_events(tone: &mut Tone, in_events: *const clap_input_events) {
    if in_events.is_null() {
        return;
    }
    let events = &*in_events;
    let (Some(size_fn), Some(get_fn)) = (events.size, events.get) else {
        return;
    };
    let count = size_fn(in_events);
    for index in 0..count {
        let header = get_fn(in_events, index);
        if header.is_null() || (*header).type_ != CLAP_EVENT_PARAM_VALUE {
            continue;
        }
        let event = &*(header as *const clap_event_param_value);
        if event.param_id == LEVEL_PARAM_ID {
            tone.level = event.value.clamp(LEVEL_MIN, LEVEL_MAX);
        }
    }
}

/// Write the tone into every channel of the first declared output bus. No
/// allocation: only pointer arithmetic over host-owned buffers, as CLAP's
/// `[audio-thread]` contract on `process` requires.
unsafe fn render_block(tone: &mut Tone, process: &clap_process) {
    if process.audio_outputs.is_null() || process.audio_outputs_count == 0 {
        return;
    }
    let output = &mut *process.audio_outputs;
    if output.data32.is_null() || output.channel_count == 0 {
        return;
    }
    let frames = process.frames_count as usize;
    let channels = output.channel_count as usize;
    for frame in 0..frames {
        let sample = tone.next_sample();
        for channel in 0..channels {
            let channel_ptr = *output.data32.add(channel);
            if channel_ptr.is_null() {
                continue;
            }
            *channel_ptr.add(frame) = sample;
        }
    }
}
