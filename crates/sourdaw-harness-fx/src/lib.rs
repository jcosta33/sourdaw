//! A deterministic stereo effect hosted as both a CLAP and a VST3 plugin from
//! one dylib, so the host's process modes can be proved through the real
//! wrappers against exact samples.
//!
//! Per channel the effect is `y[n] = g * (x[n - L] + 0.5 * x[n - L - E])`: `L`
//! is the latency it reports, `E` the tail it declares, and `g` its one
//! parameter, `Gain`. Its state chunk also records the process mode the host
//! gave the instance (see [`state`]).
//!
//! Test-only: no script packages or installs it.

#![cfg_attr(
    test,
    allow(clippy::unwrap_used, reason = "tests assert by unwrapping")
)]

mod clap_front;
mod echo;
pub mod state;
mod vst3_front;

pub use clap_front::{
    CLAP_HARD_REALTIME_PLUGIN_ID, CLAP_PLUGIN_ID, CLAP_PROCESS_ERROR_PLUGIN_ID, GAIN_PARAM_ID,
};
pub use echo::{ECHO_FRAMES, FAILING_PROCESS_CALL, GAIN_DEFAULT, LATENCY_FRAMES};
pub use vst3_front::{VST3_CLASS_ID, VST3_PROCESS_ERROR_CLASS_ID};
