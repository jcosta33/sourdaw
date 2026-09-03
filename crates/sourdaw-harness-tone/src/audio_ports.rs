//! `clap.audio-ports`: one stereo input, one stereo output, both the main
//! bus. Declared so the host builds real 2-channel buffer tables for
//! `process` rather than treating this plugin as portless.

use clap_sys::ext::audio_ports::{
    clap_audio_port_info, clap_plugin_audio_ports, CLAP_AUDIO_PORT_IS_MAIN, CLAP_PORT_STEREO,
};
use clap_sys::id::{clap_id, CLAP_INVALID_ID};
use clap_sys::plugin::clap_plugin;
use clap_sys::string_sizes::CLAP_NAME_SIZE;
use std::ffi::c_char;

const MAIN_PORT_ID: clap_id = 0;
/// This bundle declares exactly one port per direction, at list index 0. An
/// index is a position in that list, not the port's own id — they only
/// share a value here because there is one port to enumerate.
const MAIN_PORT_INDEX: u32 = 0;
const STEREO_CHANNEL_COUNT: u32 = 2;

pub(crate) static AUDIO_PORTS: clap_plugin_audio_ports = clap_plugin_audio_ports {
    count: Some(count),
    get: Some(get),
};

/// One port per direction: the main stereo bus.
unsafe extern "C" fn count(_plugin: *const clap_plugin, _is_input: bool) -> u32 {
    1
}

unsafe extern "C" fn get(
    _plugin: *const clap_plugin,
    index: u32,
    is_input: bool,
    info: *mut clap_audio_port_info,
) -> bool {
    if info.is_null() || index != MAIN_PORT_INDEX {
        return false;
    }
    let label: &[u8] = if is_input { b"Input\0" } else { b"Output\0" };
    let mut name = [0 as c_char; CLAP_NAME_SIZE];
    for (slot, byte) in name.iter_mut().zip(label.iter()) {
        *slot = *byte as c_char;
    }
    *info = clap_audio_port_info {
        id: MAIN_PORT_ID,
        name,
        flags: CLAP_AUDIO_PORT_IS_MAIN,
        channel_count: STEREO_CHANNEL_COUNT,
        port_type: CLAP_PORT_STEREO.as_ptr(),
        in_place_pair: CLAP_INVALID_ID,
    };
    true
}
