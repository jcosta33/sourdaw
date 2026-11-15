//! The CLAP front end: `clap_entry`, a factory with two classes over the same
//! DSP, and the extensions the host's process-mode path reads.
//!
//! The second class differs only in its `clap.render` answer: it declares a
//! hard real-time requirement, which is what a host building an offline
//! instance must refuse.

use crate::echo::{Echo, CHANNELS, ECHO_FRAMES, GAIN_DEFAULT, GAIN_MAX, GAIN_MIN, LATENCY_FRAMES};
use crate::state::CHUNK_BYTES;
use clap_sys::entry::clap_plugin_entry;
use clap_sys::events::{
    clap_event_param_value, clap_input_events, clap_output_events, CLAP_CORE_EVENT_SPACE_ID,
    CLAP_EVENT_PARAM_VALUE,
};
use clap_sys::ext::audio_ports::{
    clap_audio_port_info, clap_plugin_audio_ports, CLAP_AUDIO_PORT_IS_MAIN, CLAP_EXT_AUDIO_PORTS,
    CLAP_PORT_STEREO,
};
use clap_sys::ext::latency::{clap_plugin_latency, CLAP_EXT_LATENCY};
use clap_sys::ext::params::{
    clap_param_info, clap_plugin_params, CLAP_EXT_PARAMS, CLAP_PARAM_IS_AUTOMATABLE,
};
use clap_sys::ext::render::{
    clap_plugin_render, clap_plugin_render_mode, CLAP_EXT_RENDER, CLAP_RENDER_REALTIME,
};
use clap_sys::ext::state::{clap_plugin_state, CLAP_EXT_STATE};
use clap_sys::ext::tail::{clap_plugin_tail, CLAP_EXT_TAIL};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::host::clap_host;
use clap_sys::id::{clap_id, CLAP_INVALID_ID};
use clap_sys::plugin::{clap_plugin, clap_plugin_descriptor};
use clap_sys::process::{
    clap_process, clap_process_status, CLAP_PROCESS_CONTINUE, CLAP_PROCESS_ERROR,
};
use clap_sys::stream::{clap_istream, clap_ostream};
use clap_sys::string_sizes::{CLAP_NAME_SIZE, CLAP_PATH_SIZE};
use clap_sys::version::CLAP_VERSION;
use std::ffi::{c_char, c_void, CStr};
use std::mem::size_of;
use std::ptr;

/// The class that renders offline when asked.
pub const CLAP_PLUGIN_ID: &str = "com.sourdaw.harness-fx";
/// The class whose `clap.render` declares a hard real-time requirement.
pub const CLAP_HARD_REALTIME_PLUGIN_ID: &str = "com.sourdaw.harness-fx.hard-realtime";
/// The `Gain` parameter's id, in both formats.
pub const GAIN_PARAM_ID: u32 = 0;

static PLUGIN_ID: &[u8] = b"com.sourdaw.harness-fx\0";
static HARD_REALTIME_PLUGIN_ID: &[u8] = b"com.sourdaw.harness-fx.hard-realtime\0";
static PLUGIN_NAME: &[u8] = b"Sourdaw Harness Fx\0";
static HARD_REALTIME_PLUGIN_NAME: &[u8] = b"Sourdaw Harness Fx Hard Realtime\0";
static PLUGIN_VENDOR: &[u8] = b"Sourdaw\0";
static PLUGIN_VERSION: &[u8] = concat!(env!("CARGO_PKG_VERSION"), "\0").as_bytes();
static FEATURE_AUDIO_EFFECT: &[u8] = b"audio-effect\0";
static FEATURE_STEREO: &[u8] = b"stereo\0";

/// A null-terminated static array of C string pointers, as
/// `clap_plugin_descriptor.features` requires. Every pointer is `as_ptr()` of a
/// `'static` byte string, so sharing it across threads is sound.
struct StaticCStrList<const N: usize>([*const c_char; N]);

// SAFETY: every pointer addresses immutable `'static` bytes.
unsafe impl<const N: usize> Sync for StaticCStrList<N> {}

static FEATURES: StaticCStrList<3> = StaticCStrList([
    FEATURE_AUDIO_EFFECT.as_ptr() as *const c_char,
    FEATURE_STEREO.as_ptr() as *const c_char,
    ptr::null(),
]);

const fn descriptor(id: &'static [u8], name: &'static [u8]) -> clap_plugin_descriptor {
    clap_plugin_descriptor {
        clap_version: CLAP_VERSION,
        id: id.as_ptr() as *const c_char,
        name: name.as_ptr() as *const c_char,
        vendor: PLUGIN_VENDOR.as_ptr() as *const c_char,
        url: ptr::null(),
        manual_url: ptr::null(),
        support_url: ptr::null(),
        version: PLUGIN_VERSION.as_ptr() as *const c_char,
        description: ptr::null(),
        features: FEATURES.0.as_ptr(),
    }
}

static DESCRIPTOR: clap_plugin_descriptor = descriptor(PLUGIN_ID, PLUGIN_NAME);
static HARD_REALTIME_DESCRIPTOR: clap_plugin_descriptor =
    descriptor(HARD_REALTIME_PLUGIN_ID, HARD_REALTIME_PLUGIN_NAME);

/// One instance, boxed behind `clap_plugin.plugin_data`.
struct ClapInstance {
    echo: Echo,
    hard_realtime: bool,
}

// ── Entry and factory ───────────────────────────────────────────────────

unsafe extern "C" fn entry_init(_plugin_path: *const c_char) -> bool {
    true
}

unsafe extern "C" fn entry_deinit() {}

unsafe extern "C" fn entry_get_factory(factory_id: *const c_char) -> *const c_void {
    if factory_id.is_null() {
        return ptr::null();
    }
    // SAFETY: the host passes a NUL-terminated factory id.
    let id = unsafe { CStr::from_ptr(factory_id) };
    if id == CLAP_PLUGIN_FACTORY_ID {
        return &raw const FACTORY as *const c_void;
    }
    ptr::null()
}

/// The symbol every CLAP host resolves by name.
#[no_mangle]
pub static clap_entry: clap_plugin_entry = clap_plugin_entry {
    clap_version: CLAP_VERSION,
    init: Some(entry_init),
    deinit: Some(entry_deinit),
    get_factory: Some(entry_get_factory),
};

static FACTORY: clap_plugin_factory = clap_plugin_factory {
    get_plugin_count: Some(plugin_count),
    get_plugin_descriptor: Some(plugin_descriptor),
    create_plugin: Some(create_plugin),
};

unsafe extern "C" fn plugin_count(_factory: *const clap_plugin_factory) -> u32 {
    2
}

unsafe extern "C" fn plugin_descriptor(
    _factory: *const clap_plugin_factory,
    index: u32,
) -> *const clap_plugin_descriptor {
    match index {
        0 => &raw const DESCRIPTOR,
        1 => &raw const HARD_REALTIME_DESCRIPTOR,
        _ => ptr::null(),
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
    // SAFETY: the host passes a NUL-terminated plugin id.
    let requested = unsafe { CStr::from_ptr(plugin_id) }.to_bytes_with_nul();
    let (desc, hard_realtime) = if requested == PLUGIN_ID {
        (&raw const DESCRIPTOR, false)
    } else if requested == HARD_REALTIME_PLUGIN_ID {
        (&raw const HARD_REALTIME_DESCRIPTOR, true)
    } else {
        return ptr::null();
    };

    let instance = Box::into_raw(Box::new(ClapInstance {
        echo: Echo::new(),
        hard_realtime,
    }));
    Box::into_raw(Box::new(clap_plugin {
        desc,
        plugin_data: instance as *mut c_void,
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

// ── The plugin vtable ───────────────────────────────────────────────────

/// The instance behind a `clap_plugin`, shared and never exclusive: the main
/// thread may read state while the audio thread processes.
///
/// # Safety
/// `plugin`, when non-null, must be a live `clap_plugin` from `create_plugin`.
unsafe fn instance_of<'a>(plugin: *const clap_plugin) -> Option<&'a ClapInstance> {
    if plugin.is_null() {
        return None;
    }
    // SAFETY: the caller guarantees `plugin` is live.
    let data = unsafe { (*plugin).plugin_data };
    if data.is_null() {
        return None;
    }
    // SAFETY: `create_plugin` stored a live `Box<ClapInstance>` here.
    Some(unsafe { &*(data as *const ClapInstance) })
}

unsafe extern "C" fn init(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn destroy(plugin: *const clap_plugin) {
    if plugin.is_null() {
        return;
    }
    // SAFETY: CLAP calls `destroy` once per instance, so both boxes
    // `create_plugin` leaked are reclaimed exactly once.
    unsafe {
        let data = (*plugin).plugin_data;
        if !data.is_null() {
            drop(Box::from_raw(data as *mut ClapInstance));
        }
        drop(Box::from_raw(plugin as *mut clap_plugin));
    }
}

unsafe extern "C" fn activate(
    plugin: *const clap_plugin,
    _sample_rate: f64,
    _min_frames_count: u32,
    _max_frames_count: u32,
) -> bool {
    // SAFETY: the host passes the plugin it created.
    match unsafe { instance_of(plugin) } {
        Some(instance) => {
            instance.echo.reset();
            true
        }
        None => false,
    }
}

unsafe extern "C" fn deactivate(_plugin: *const clap_plugin) {}

unsafe extern "C" fn start_processing(_plugin: *const clap_plugin) -> bool {
    true
}

unsafe extern "C" fn stop_processing(_plugin: *const clap_plugin) {}

unsafe extern "C" fn reset(plugin: *const clap_plugin) {
    // SAFETY: the host passes the plugin it created.
    if let Some(instance) = unsafe { instance_of(plugin) } {
        instance.echo.reset();
    }
}

unsafe extern "C" fn on_main_thread(_plugin: *const clap_plugin) {}

unsafe extern "C" fn get_extension(
    _plugin: *const clap_plugin,
    extension_id: *const c_char,
) -> *const c_void {
    if extension_id.is_null() {
        return ptr::null();
    }
    // SAFETY: the host passes a NUL-terminated extension id.
    let id = unsafe { CStr::from_ptr(extension_id) };
    if id == CLAP_EXT_AUDIO_PORTS {
        return &raw const AUDIO_PORTS as *const c_void;
    }
    if id == CLAP_EXT_PARAMS {
        return &raw const PARAMS as *const c_void;
    }
    if id == CLAP_EXT_STATE {
        return &raw const STATE as *const c_void;
    }
    if id == CLAP_EXT_LATENCY {
        return &raw const LATENCY as *const c_void;
    }
    if id == CLAP_EXT_TAIL {
        return &raw const TAIL as *const c_void;
    }
    if id == CLAP_EXT_RENDER {
        return &raw const RENDER as *const c_void;
    }
    ptr::null()
}

/// Apply the block's `Gain` writes, then render it. Allocation- and lock-free:
/// pointer arithmetic over host-owned buffers only.
unsafe extern "C" fn process(
    plugin: *const clap_plugin,
    process: *const clap_process,
) -> clap_process_status {
    if process.is_null() {
        return CLAP_PROCESS_ERROR;
    }
    // SAFETY: the host passes the plugin it created.
    let Some(instance) = (unsafe { instance_of(plugin) }) else {
        return CLAP_PROCESS_ERROR;
    };
    // SAFETY: `process` is valid for the duration of this call.
    let process = unsafe { &*process };
    // SAFETY: `in_events` is valid for the duration of this call.
    unsafe { apply_parameter_events(&instance.echo, process.in_events) };
    // SAFETY: the bus tables are valid for the duration of this call.
    unsafe { render_block(&instance.echo, process) };
    CLAP_PROCESS_CONTINUE
}

/// # Safety
/// `in_events`, when non-null, must be a live `clap_input_events`.
unsafe fn apply_parameter_events(echo: &Echo, in_events: *const clap_input_events) {
    if in_events.is_null() {
        return;
    }
    // SAFETY: the caller guarantees the list is live.
    let events = unsafe { &*in_events };
    let (Some(size), Some(get)) = (events.size, events.get) else {
        return;
    };
    // SAFETY: the list's own callbacks, called on the list they belong to.
    let count = unsafe { size(in_events) };
    for index in 0..count {
        // SAFETY: as above; `index` is below the list's own count.
        let header = unsafe { get(in_events, index) };
        if header.is_null() {
            continue;
        }
        // SAFETY: a non-null header the list handed out is readable.
        let header_ref = unsafe { &*header };
        if header_ref.space_id != CLAP_CORE_EVENT_SPACE_ID
            || header_ref.type_ != CLAP_EVENT_PARAM_VALUE
            || (header_ref.size as usize) < size_of::<clap_event_param_value>()
        {
            continue;
        }
        // SAFETY: a core-space param-value event of at least that size is a
        // `clap_event_param_value`.
        let event = unsafe { &*(header as *const clap_event_param_value) };
        if event.param_id == GAIN_PARAM_ID {
            echo.set_gain(event.value);
        }
    }
}

/// # Safety
/// The bus tables `process` names must be valid for its `frames_count`.
unsafe fn render_block(echo: &Echo, process: &clap_process) {
    if process.audio_outputs.is_null() || process.audio_outputs_count == 0 {
        return;
    }
    // SAFETY: the caller guarantees the output table is valid.
    let output = unsafe { &*process.audio_outputs };
    if output.data32.is_null() || (output.channel_count as usize) < CHANNELS {
        return;
    }
    let input = if process.audio_inputs.is_null() || process.audio_inputs_count == 0 {
        None
    } else {
        // SAFETY: the caller guarantees the input table is valid.
        Some(unsafe { &*process.audio_inputs })
    }
    .filter(|input| !input.data32.is_null() && input.channel_count as usize >= CHANNELS);

    for frame in 0..process.frames_count as usize {
        let mut sample_in = [0.0; CHANNELS];
        if let Some(input) = input {
            for (channel, sample) in sample_in.iter_mut().enumerate() {
                // SAFETY: `channel < CHANNELS <= channel_count` and
                // `frame < frames_count`.
                *sample = unsafe { *(*input.data32.add(channel)).add(frame) };
            }
        }
        let sample_out = echo.next_frame(sample_in);
        for (channel, sample) in sample_out.iter().enumerate() {
            // SAFETY: as above, for the output bus.
            unsafe { *(*output.data32.add(channel)).add(frame) = *sample };
        }
    }
}

// ── clap.audio-ports ────────────────────────────────────────────────────

static AUDIO_PORTS: clap_plugin_audio_ports = clap_plugin_audio_ports {
    count: Some(audio_port_count),
    get: Some(audio_port_get),
};

unsafe extern "C" fn audio_port_count(_plugin: *const clap_plugin, _is_input: bool) -> u32 {
    1
}

unsafe extern "C" fn audio_port_get(
    _plugin: *const clap_plugin,
    index: u32,
    is_input: bool,
    info: *mut clap_audio_port_info,
) -> bool {
    if info.is_null() || index != 0 {
        return false;
    }
    let label: &[u8] = if is_input { b"Input\0" } else { b"Output\0" };
    // SAFETY: `info` is a valid out parameter.
    unsafe {
        *info = clap_audio_port_info {
            id: 0,
            name: c_name(label),
            flags: CLAP_AUDIO_PORT_IS_MAIN,
            channel_count: CHANNELS as u32,
            port_type: CLAP_PORT_STEREO.as_ptr(),
            in_place_pair: CLAP_INVALID_ID,
        }
    };
    true
}

fn c_name(label: &[u8]) -> [c_char; CLAP_NAME_SIZE] {
    let mut name = [0 as c_char; CLAP_NAME_SIZE];
    for (slot, byte) in name.iter_mut().zip(label.iter()) {
        *slot = *byte as c_char;
    }
    name
}

// ── clap.params ─────────────────────────────────────────────────────────

static PARAMS: clap_plugin_params = clap_plugin_params {
    count: Some(param_count),
    get_info: Some(param_get_info),
    get_value: Some(param_get_value),
    value_to_text: Some(param_value_to_text),
    text_to_value: Some(param_text_to_value),
    flush: Some(param_flush),
};

unsafe extern "C" fn param_count(_plugin: *const clap_plugin) -> u32 {
    1
}

unsafe extern "C" fn param_get_info(
    _plugin: *const clap_plugin,
    index: u32,
    info: *mut clap_param_info,
) -> bool {
    if info.is_null() || index != 0 {
        return false;
    }
    // SAFETY: `info` is a valid out parameter.
    unsafe {
        *info = clap_param_info {
            id: GAIN_PARAM_ID as clap_id,
            flags: CLAP_PARAM_IS_AUTOMATABLE,
            cookie: ptr::null_mut(),
            name: c_name(b"Gain\0"),
            module: [0; CLAP_PATH_SIZE],
            min_value: GAIN_MIN,
            max_value: GAIN_MAX,
            default_value: GAIN_DEFAULT,
        }
    };
    true
}

unsafe extern "C" fn param_get_value(
    plugin: *const clap_plugin,
    param_id: clap_id,
    out_value: *mut f64,
) -> bool {
    if out_value.is_null() || param_id != GAIN_PARAM_ID {
        return false;
    }
    // SAFETY: the host passes the plugin it created.
    let Some(instance) = (unsafe { instance_of(plugin) }) else {
        return false;
    };
    // SAFETY: `out_value` is a valid out parameter.
    unsafe { *out_value = instance.echo.gain() };
    true
}

/// No display text: the host's tests read values, never their spelling.
unsafe extern "C" fn param_value_to_text(
    _plugin: *const clap_plugin,
    _param_id: clap_id,
    _value: f64,
    _out_buffer: *mut c_char,
    _out_buffer_capacity: u32,
) -> bool {
    false
}

unsafe extern "C" fn param_text_to_value(
    _plugin: *const clap_plugin,
    _param_id: clap_id,
    _param_value_text: *const c_char,
    _out_value: *mut f64,
) -> bool {
    false
}

/// `[active ? audio-thread : main-thread]`, never concurrent with `process`,
/// so it shares `process`'s allocation-free event reader.
unsafe extern "C" fn param_flush(
    plugin: *const clap_plugin,
    in_events: *const clap_input_events,
    _out_events: *const clap_output_events,
) {
    // SAFETY: the host passes the plugin it created and a live event list.
    unsafe {
        if let Some(instance) = instance_of(plugin) {
            apply_parameter_events(&instance.echo, in_events);
        }
    }
}

// ── clap.state ──────────────────────────────────────────────────────────

static STATE: clap_plugin_state = clap_plugin_state {
    save: Some(state_save),
    load: Some(state_load),
};

unsafe extern "C" fn state_save(plugin: *const clap_plugin, stream: *const clap_ostream) -> bool {
    if stream.is_null() {
        return false;
    }
    // SAFETY: the host passes the plugin it created.
    let Some(instance) = (unsafe { instance_of(plugin) }) else {
        return false;
    };
    // SAFETY: the host passes a live stream.
    let Some(write) = (unsafe { (*stream).write }) else {
        return false;
    };
    let chunk = instance.echo.save();
    let mut written = 0;
    while written < chunk.len() {
        let remaining = &chunk[written..];
        // SAFETY: `remaining` is valid for its length.
        let count = unsafe {
            write(
                stream,
                remaining.as_ptr() as *const c_void,
                remaining.len() as u64,
            )
        };
        if count <= 0 {
            return false;
        }
        written += count as usize;
    }
    true
}

unsafe extern "C" fn state_load(plugin: *const clap_plugin, stream: *const clap_istream) -> bool {
    if stream.is_null() {
        return false;
    }
    // SAFETY: the host passes the plugin it created.
    let Some(instance) = (unsafe { instance_of(plugin) }) else {
        return false;
    };
    // SAFETY: the host passes a live stream.
    let Some(read) = (unsafe { (*stream).read }) else {
        return false;
    };
    let mut chunk = [0u8; CHUNK_BYTES];
    let mut filled = 0;
    while filled < CHUNK_BYTES {
        let remaining = &mut chunk[filled..];
        // SAFETY: `remaining` is writable for its length.
        let count = unsafe {
            read(
                stream,
                remaining.as_mut_ptr() as *mut c_void,
                remaining.len() as u64,
            )
        };
        if count <= 0 {
            return false;
        }
        filled += count as usize;
    }
    instance.echo.load(&chunk)
}

// ── clap.latency, clap.tail ─────────────────────────────────────────────

static LATENCY: clap_plugin_latency = clap_plugin_latency {
    get: Some(latency_get),
};

unsafe extern "C" fn latency_get(_plugin: *const clap_plugin) -> u32 {
    LATENCY_FRAMES as u32
}

static TAIL: clap_plugin_tail = clap_plugin_tail {
    get: Some(tail_get),
};

unsafe extern "C" fn tail_get(_plugin: *const clap_plugin) -> u32 {
    ECHO_FRAMES as u32
}

// ── clap.render ─────────────────────────────────────────────────────────

static RENDER: clap_plugin_render = clap_plugin_render {
    has_hard_realtime_requirement: Some(render_has_hard_realtime_requirement),
    set: Some(render_set),
};

unsafe extern "C" fn render_has_hard_realtime_requirement(plugin: *const clap_plugin) -> bool {
    // SAFETY: the host passes the plugin it created.
    unsafe { instance_of(plugin) }.is_some_and(|instance| instance.hard_realtime)
}

/// Record the mode the host chose. A class with a hard real-time requirement
/// accepts only real-time rendering, as the CLAP header says it must.
unsafe extern "C" fn render_set(plugin: *const clap_plugin, mode: clap_plugin_render_mode) -> bool {
    // SAFETY: the host passes the plugin it created.
    let Some(instance) = (unsafe { instance_of(plugin) }) else {
        return false;
    };
    if instance.hard_realtime && mode != CLAP_RENDER_REALTIME {
        return false;
    }
    instance.echo.record_configured_mode(mode);
    true
}
