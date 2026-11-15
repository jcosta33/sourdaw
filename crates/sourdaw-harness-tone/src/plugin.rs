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
    // SAFETY: `plugin` is non-null (checked above) and, per this function's
    // `# Safety` contract, points to a live `clap_plugin`.
    let data = unsafe { (*plugin).plugin_data };
    if data.is_null() {
        return None;
    }
    // SAFETY: `data` is non-null (checked above) and, per this function's
    // `# Safety` contract, is the live `Box<Tone>` `factory::create_plugin`
    // attached, so it is aligned and initialised. Only shared references to
    // it are ever created (see above), so no `&mut Tone` aliases this one.
    Some(unsafe { &*(data as *const Tone) })
}

pub(crate) unsafe extern "C" fn init(_plugin: *const clap_plugin) -> bool {
    true
}

/// Free the `Tone` and the `clap_plugin` itself. CLAP calls `destroy` at
/// most once per instance, after processing has stopped, so this is the only
/// place either allocation is freed.
///
/// # Safety
/// `plugin`, when non-null, must be a `clap_plugin` returned by
/// `factory::create_plugin` that has not been destroyed, and no other
/// callback for this instance may run during or after this call, as
/// `clap/plugin.h` requires of the host's `destroy` call.
pub(crate) unsafe extern "C" fn destroy(plugin: *const clap_plugin) {
    if plugin.is_null() {
        return;
    }
    // SAFETY: `plugin` is non-null (checked above) and, per this function's
    // `# Safety` contract, a live `clap_plugin` from `factory::create_plugin`.
    let data = unsafe { (*plugin).plugin_data };
    if !data.is_null() {
        // SAFETY: a non-null `plugin_data` is the pointer
        // `factory::create_plugin` took from `Box::into_raw(Box::new(Tone))`,
        // and the `# Safety` contract guarantees this is its only release and
        // that no reference into it outlives this call.
        drop(unsafe { Box::from_raw(data as *mut Tone) });
    }
    // SAFETY: `plugin` is the pointer `factory::create_plugin` took from
    // `Box::into_raw(Box::new(clap_plugin { .. }))`, and the `# Safety`
    // contract guarantees this is its only release and that the host never
    // touches it again.
    drop(unsafe { Box::from_raw(plugin as *mut clap_plugin) });
}

/// # Safety
/// `plugin` must satisfy `tone_from_plugin`'s `# Safety` contract, as
/// `clap/plugin.h` guarantees for every callback the host makes on a live
/// instance.
pub(crate) unsafe extern "C" fn activate(
    plugin: *const clap_plugin,
    sample_rate: f64,
    _min_frames_count: u32,
    _max_frames_count: u32,
) -> bool {
    // SAFETY: this function's `# Safety` contract passes on
    // `tone_from_plugin`'s requirement on `plugin` unchanged.
    match unsafe { tone_from_plugin(plugin) } {
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
///
/// # Safety
/// `plugin` must satisfy `tone_from_plugin`'s `# Safety` contract, as
/// `clap/plugin.h` guarantees for every callback the host makes on a live
/// instance.
pub(crate) unsafe extern "C" fn reset(plugin: *const clap_plugin) {
    // SAFETY: this function's `# Safety` contract passes on
    // `tone_from_plugin`'s requirement on `plugin` unchanged.
    if let Some(tone) = unsafe { tone_from_plugin(plugin) } {
        tone.reset();
    }
}

/// No main-thread work queued by this plugin, so there is nothing to react
/// to when the host invites it to run some.
pub(crate) unsafe extern "C" fn on_main_thread(_plugin: *const clap_plugin) {}

/// # Safety
/// `extension_id`, when non-null, must point to a NUL-terminated C string
/// that stays live and unmodified for the call, as `clap/plugin.h` requires
/// of the host's `get_extension` argument.
pub(crate) unsafe extern "C" fn get_extension(
    _plugin: *const clap_plugin,
    extension_id: *const c_char,
) -> *const c_void {
    if extension_id.is_null() {
        return ptr::null();
    }
    // SAFETY: `extension_id` is non-null (checked above) and, per this
    // function's `# Safety` contract, NUL-terminated and unmodified for the
    // call; `id` does not outlive the call.
    let id = unsafe { CStr::from_ptr(extension_id) };
    if id == CLAP_EXT_AUDIO_PORTS {
        return &raw const AUDIO_PORTS as *const c_void;
    }
    if id == CLAP_EXT_PARAMS {
        return &raw const PARAMS as *const c_void;
    }
    ptr::null()
}

/// # Safety
/// `plugin` must satisfy `tone_from_plugin`'s `# Safety` contract, and
/// `process`, when non-null, must point to a `clap_process` that is live for
/// the call, whose `in_events` satisfies `apply_parameter_events`'s contract
/// and whose buffers satisfy `render_block`'s, as `clap/process.h` requires
/// of the host's `process` arguments.
pub(crate) unsafe extern "C" fn process(
    plugin: *const clap_plugin,
    process: *const clap_process,
) -> clap_process_status {
    if plugin.is_null() || process.is_null() {
        return CLAP_PROCESS_ERROR;
    }
    // SAFETY: this function's `# Safety` contract passes on
    // `tone_from_plugin`'s requirement on `plugin` unchanged.
    let Some(tone) = (unsafe { tone_from_plugin(plugin) }) else {
        return CLAP_PROCESS_ERROR;
    };
    // SAFETY: `process` is non-null (checked above) and, per this function's
    // `# Safety` contract, points to a `clap_process` live for the call; the
    // plugin never writes through it, so a shared reference is sound.
    let process_ref = unsafe { &*process };
    // SAFETY: this function's `# Safety` contract guarantees `in_events`
    // satisfies `apply_parameter_events`'s requirement.
    unsafe { apply_parameter_events(tone, process_ref.in_events) };
    // SAFETY: this function's `# Safety` contract guarantees the buffers
    // satisfy `render_block`'s requirement.
    unsafe { render_block(tone, process_ref) };
    CLAP_PROCESS_CONTINUE
}

/// Apply every pending `CLAP_EVENT_PARAM_VALUE` for the Level parameter.
/// Block-level: the last matching event in the block wins, with no
/// sample-accurate split.
///
/// # Safety
/// `in_events`, when non-null, must be a live `clap_input_events` whose
/// `size`/`get` callbacks are valid for the duration of this call, and whose
/// `get(index)` for every `index < size()` returns null or the header of a
/// live event of the concrete type its `space_id` and `type_` name — the
/// contract `process` and `clap.params.flush` both receive it under
/// (`clap/events.h`).
pub(crate) unsafe fn apply_parameter_events(tone: &Tone, in_events: *const clap_input_events) {
    if in_events.is_null() {
        return;
    }
    // SAFETY: `in_events` is non-null (checked above) and, per this
    // function's `# Safety` contract, a live `clap_input_events` for the call.
    let events = unsafe { &*in_events };
    let (Some(size_fn), Some(get_fn)) = (events.size, events.get) else {
        return;
    };
    // SAFETY: the `# Safety` contract makes `size` a valid callback on this
    // live list for the call.
    let count = unsafe { size_fn(in_events) };
    for index in 0..count {
        // SAFETY: `index < count` from `size`, and the `# Safety` contract
        // makes `get` a valid callback on this live list for the call.
        let header = unsafe { get_fn(in_events, index) };
        // SAFETY: the `||` short-circuits on null, and a non-null `get`
        // result is a live event header per the `# Safety` contract.
        if header.is_null() || unsafe { (*header).type_ } != CLAP_EVENT_PARAM_VALUE {
            continue;
        }
        // A foreign event space may reuse this event type with a payload
        // this plugin does not understand; only the core space's own
        // `clap_event_param_value` layout is safe to cast the header to.
        // SAFETY: `header` is non-null (checked above) and a live event
        // header per the `# Safety` contract.
        if unsafe { (*header).space_id } != CLAP_CORE_EVENT_SPACE_ID {
            continue;
        }
        // SAFETY: as above, `header` is a non-null live event header.
        if (unsafe { (*header).size } as usize) < size_of::<clap_event_param_value>() {
            continue;
        }
        // SAFETY: the checks above establish a core-space
        // `CLAP_EVENT_PARAM_VALUE` header whose event is at least
        // `size_of::<clap_event_param_value>()` bytes, and the `# Safety`
        // contract makes such a header the first field of a live, aligned
        // `clap_event_param_value` that nothing mutates during the call.
        let event = unsafe { &*(header as *const clap_event_param_value) };
        if event.param_id == LEVEL_PARAM_ID {
            tone.set_level(event.value.clamp(LEVEL_MIN, LEVEL_MAX));
        }
    }
}

/// Write the tone into every channel of the first declared output bus. No
/// allocation: only pointer arithmetic over host-owned buffers, as CLAP's
/// `[audio-thread]` contract on `process` requires.
///
/// # Safety
/// When `process.audio_outputs` is non-null and `audio_outputs_count > 0`,
/// it must point to a live `clap_audio_buffer` the host does not access
/// during the call; when that buffer's `data32` is non-null it must point to
/// `channel_count` channel pointers, each null or valid for writes of
/// `process.frames_count` `f32`s that no other pointer aliases during the
/// call, as `clap/process.h` and `clap/audio-buffer.h` require of the host.
unsafe fn render_block(tone: &Tone, process: &clap_process) {
    if process.audio_outputs.is_null() || process.audio_outputs_count == 0 {
        return;
    }
    // SAFETY: `audio_outputs` is non-null with at least one entry (checked
    // above) and, per this function's `# Safety` contract, a live buffer the
    // host leaves alone for the call, so this is the only reference to it.
    let output = unsafe { &mut *process.audio_outputs };
    if output.data32.is_null() || output.channel_count == 0 {
        return;
    }
    let frames = process.frames_count as usize;
    let channels = output.channel_count as usize;
    for frame in 0..frames {
        let sample = tone.next_sample();
        for channel in 0..channels {
            // SAFETY: `data32` is non-null (checked above) and
            // `channel < channel_count`, so the offset stays inside the
            // `channel_count`-entry table the `# Safety` contract guarantees.
            let channel_slot = unsafe { output.data32.add(channel) };
            // SAFETY: `channel_slot` is in bounds of that live, aligned
            // table (see above).
            let channel_ptr = unsafe { *channel_slot };
            if channel_ptr.is_null() {
                continue;
            }
            // SAFETY: `channel_ptr` is non-null (checked above) and
            // `frame < frames_count`, so the offset stays inside the
            // `frames_count`-sample channel the `# Safety` contract
            // guarantees.
            let sample_slot = unsafe { channel_ptr.add(frame) };
            // SAFETY: `sample_slot` is in bounds of that channel, which the
            // `# Safety` contract makes valid and unaliased for `f32` writes.
            unsafe { *sample_slot = sample };
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

    /// # Safety
    /// `list` must be a live `clap_input_events` built by `input_events`,
    /// whose `ctx` still points to its live `EventListFixture`.
    unsafe extern "C" fn fixture_size(list: *const clap_input_events) -> u32 {
        // SAFETY: the `# Safety` contract makes `list` a live list.
        let ctx = unsafe { (*list).ctx };
        // SAFETY: the `# Safety` contract makes `ctx` the live fixture
        // `input_events` stored, which no `&mut` aliases while the test reads.
        let fixture = unsafe { &*(ctx as *const EventListFixture) };
        fixture.events.len() as u32
    }

    /// # Safety
    /// `list` must be a live `clap_input_events` built by `input_events`,
    /// whose `ctx` still points to its live `EventListFixture`.
    unsafe extern "C" fn fixture_get(
        list: *const clap_input_events,
        index: u32,
    ) -> *const clap_sys::events::clap_event_header {
        // SAFETY: the `# Safety` contract makes `list` a live list.
        let ctx = unsafe { (*list).ctx };
        // SAFETY: the `# Safety` contract makes `ctx` the live fixture
        // `input_events` stored, which no `&mut` aliases while the test reads.
        let fixture = unsafe { &*(ctx as *const EventListFixture) };
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

        // SAFETY: `events` is a live list from `input_events` over the live
        // `fixture`, whose `get` returns the header of a live, aligned
        // `clap_event_param_value` for every in-range index.
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

        // SAFETY: `events` is a live list from `input_events` over the live
        // `fixture`, whose `get` returns the header of a live, aligned
        // `clap_event_param_value` for every in-range index.
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
