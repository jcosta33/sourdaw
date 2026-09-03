//! The `clap_plugin` vtable: lifecycle callbacks and the RT `process` path.
//! Everything that touches audio buffers or event lists lives here; the tone
//! itself (`crate::tone::Tone`) stays free of FFI.

use crate::audio_ports::AUDIO_PORTS;
use crate::params::{LEVEL_PARAM_ID, PARAMS};
use crate::tone::{Tone, LEVEL_MAX, LEVEL_MIN};
use clap_sys::events::{
    clap_event_param_value, clap_input_events, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE,
};
use clap_sys::ext::audio_ports::CLAP_EXT_AUDIO_PORTS;
use clap_sys::ext::params::CLAP_EXT_PARAMS;
use clap_sys::plugin::clap_plugin;
use clap_sys::process::{
    clap_process, clap_process_status, CLAP_PROCESS_CONTINUE, CLAP_PROCESS_ERROR,
};
use std::ffi::{c_char, c_void, CStr};
use std::mem::size_of;
use std::ptr;

/// The `Tone` behind a `clap_plugin`'s `plugin_data`, or `None` for a null
/// plugin or an instance the factory never attached one to.
///
/// Shared, never exclusive: the main thread can call `clap.params.get_value`
/// at the same moment the audio thread is inside `process`, so this returns
/// `&Tone` rather than `&mut Tone` and no caller may claim exclusivity over
/// it — `Tone`'s own methods already serialise the state that needs it
/// (`Cell` for the fields only `[audio-thread]` and `[main-thread & !active]`
/// callbacks touch) or share it safely (`AtomicU64` for `level`).
///
/// # Safety
/// `plugin`, when non-null, must point to a live `clap_plugin` created by
/// `factory::create_plugin`, whose `plugin_data` is a live `Box<Tone>` for
/// the duration of this reference.
pub(crate) unsafe fn tone_from_plugin<'a>(plugin: *const clap_plugin) -> Option<&'a Tone> {
    if plugin.is_null() {
        return None;
    }
    let data = (*plugin).plugin_data;
    if data.is_null() {
        return None;
    }
    Some(&*(data as *const Tone))
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

/// No teardown needed: `activate` re-records the sample rate and `reset`
/// re-zeros the phase, so there is nothing this instance holds only while
/// active.
pub(crate) unsafe extern "C" fn deactivate(_plugin: *const clap_plugin) {}

/// Nothing to prepare: `process` allocates nothing and reads no per-block
/// setup state, so there is no processing-session resource to acquire here.
pub(crate) unsafe extern "C" fn start_processing(_plugin: *const clap_plugin) -> bool {
    true
}

/// Mirrors `start_processing`: nothing was acquired, so nothing is released.
pub(crate) unsafe extern "C" fn stop_processing(_plugin: *const clap_plugin) {}

/// Force silence without a full `activate`: restart the phase, per CLAP's
/// `reset` contract, leaving the recorded sample rate and `Level` alone.
pub(crate) unsafe extern "C" fn reset(plugin: *const clap_plugin) {
    if let Some(tone) = tone_from_plugin(plugin) {
        tone.reset();
    }
}

/// No main-thread work queued by this plugin, so there is nothing to react
/// to when the host invites it to run some.
pub(crate) unsafe extern "C" fn on_main_thread(_plugin: *const clap_plugin) {}

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
pub(crate) unsafe fn apply_parameter_events(tone: &Tone, in_events: *const clap_input_events) {
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
        // A foreign event space may reuse this event type with a payload
        // this plugin does not understand; only the core space's own
        // `clap_event_param_value` layout is safe to cast the header to.
        if (*header).space_id != CLAP_CORE_EVENT_SPACE_ID {
            continue;
        }
        if ((*header).size as usize) < size_of::<clap_event_param_value>() {
            continue;
        }
        let event = &*(header as *const clap_event_param_value);
        if event.param_id == LEVEL_PARAM_ID {
            tone.set_level(event.value.clamp(LEVEL_MIN, LEVEL_MAX));
        }
    }
}

/// Write the tone into every channel of the first declared output bus. No
/// allocation: only pointer arithmetic over host-owned buffers, as CLAP's
/// `[audio-thread]` contract on `process` requires.
unsafe fn render_block(tone: &Tone, process: &clap_process) {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A `clap_input_events` list backed by a plain `Vec`, cheap enough to
    /// build in a unit test: `get` hands back the address of each event's
    /// own `header` field, which is exactly what a real host's event list
    /// does for a `clap_event_param_value` stored inline.
    struct EventListFixture {
        events: Vec<clap_event_param_value>,
    }

    unsafe extern "C" fn fixture_size(list: *const clap_input_events) -> u32 {
        let fixture = &*((*list).ctx as *const EventListFixture);
        fixture.events.len() as u32
    }

    unsafe extern "C" fn fixture_get(
        list: *const clap_input_events,
        index: u32,
    ) -> *const clap_sys::events::clap_event_header {
        let fixture = &*((*list).ctx as *const EventListFixture);
        &fixture.events[index as usize].header
    }

    fn input_events(fixture: &mut EventListFixture) -> clap_input_events {
        clap_input_events {
            ctx: fixture as *mut EventListFixture as *mut c_void,
            size: Some(fixture_size),
            get: Some(fixture_get),
        }
    }

    fn param_value_event(
        space_id: u16,
        param_id: clap_sys::id::clap_id,
        value: f64,
    ) -> clap_event_param_value {
        clap_event_param_value {
            header: clap_sys::events::clap_event_header {
                size: size_of::<clap_event_param_value>() as u32,
                time: 0,
                space_id,
                type_: CLAP_EVENT_PARAM_VALUE,
                flags: 0,
            },
            param_id,
            cookie: ptr::null_mut(),
            note_id: -1,
            port_index: -1,
            channel: -1,
            key: -1,
            value,
        }
    }

    #[test]
    fn a_core_space_param_value_event_updates_level() {
        let starting_level = 0.25;
        let mut fixture = EventListFixture {
            events: vec![param_value_event(
                CLAP_CORE_EVENT_SPACE_ID,
                LEVEL_PARAM_ID,
                0.9,
            )],
        };
        let events = input_events(&mut fixture);
        let tone = Tone::new();
        tone.set_level(starting_level);

        unsafe {
            apply_parameter_events(&tone, &events);
        }

        assert_eq!(tone.level(), 0.9);
    }

    #[test]
    fn a_foreign_space_param_value_event_leaves_level_unchanged() {
        let starting_level = 0.25;
        let foreign_space_id = CLAP_CORE_EVENT_SPACE_ID + 1;
        let mut fixture = EventListFixture {
            events: vec![param_value_event(foreign_space_id, LEVEL_PARAM_ID, 0.9)],
        };
        let events = input_events(&mut fixture);
        let tone = Tone::new();
        tone.set_level(starting_level);

        unsafe {
            apply_parameter_events(&tone, &events);
        }

        assert_eq!(
            tone.level(),
            starting_level,
            "an event outside the core event space must not be read as a clap_event_param_value"
        );
    }
}
