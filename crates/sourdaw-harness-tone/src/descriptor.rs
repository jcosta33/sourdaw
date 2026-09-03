//! The plugin's CLAP descriptor and the static, NUL-terminated C strings it
//! points into. A real `.clap` bundle's descriptor must outlive every
//! instance the factory creates, so every string here is `'static`.

use clap_sys::plugin::clap_plugin_descriptor;
use clap_sys::version::CLAP_VERSION;
use std::ffi::c_char;
use std::ptr;

/// The id `extract_clap_metadata` reads back and the id a host names in
/// `create_plugin`. Kept as the raw NUL-terminated bytes so
/// `factory::create_plugin` can compare an incoming `CStr` against it without
/// re-parsing the descriptor.
pub(crate) static PLUGIN_ID: &[u8] = b"com.sourdaw.harness-tone\0";
static PLUGIN_NAME: &[u8] = b"Sourdaw Harness Tone\0";
static PLUGIN_VENDOR: &[u8] = b"Sourdaw\0";
// Pinned to the crate's own `Cargo.toml` version rather than duplicated, so
// the descriptor can never drift from the version cargo actually built.
static PLUGIN_VERSION: &[u8] = concat!(env!("CARGO_PKG_VERSION"), "\0").as_bytes();
static PLUGIN_DESCRIPTION: &[u8] =
    b"Self-sounding CLAP test plugin for the packaged-app latency harness.\0";

static FEATURE_AUDIO_EFFECT: &[u8] = b"audio-effect\0";
static FEATURE_STEREO: &[u8] = b"stereo\0";

/// A null-terminated static array of C string pointers, as CLAP's
/// `clap_plugin_descriptor.features` requires.
///
/// `*const c_char` is `!Sync`, so a bare `static [*const c_char; N]` will not
/// compile; every pointer here is `as_ptr()` of a `'static` byte string, so
/// sharing it across threads is sound — the same reasoning `clap-sys`'s own
/// `unsafe impl Sync for clap_plugin_descriptor` relies on for its raw
/// pointer fields.
struct StaticCStrList<const N: usize>([*const c_char; N]);

unsafe impl<const N: usize> Sync for StaticCStrList<N> {}

static FEATURES: StaticCStrList<3> = StaticCStrList([
    FEATURE_AUDIO_EFFECT.as_ptr() as *const c_char,
    FEATURE_STEREO.as_ptr() as *const c_char,
    ptr::null(),
]);

pub(crate) static DESCRIPTOR: clap_plugin_descriptor = clap_plugin_descriptor {
    clap_version: CLAP_VERSION,
    id: PLUGIN_ID.as_ptr() as *const c_char,
    name: PLUGIN_NAME.as_ptr() as *const c_char,
    vendor: PLUGIN_VENDOR.as_ptr() as *const c_char,
    url: ptr::null(),
    manual_url: ptr::null(),
    support_url: ptr::null(),
    version: PLUGIN_VERSION.as_ptr() as *const c_char,
    description: PLUGIN_DESCRIPTION.as_ptr() as *const c_char,
    features: FEATURES.0.as_ptr(),
};
