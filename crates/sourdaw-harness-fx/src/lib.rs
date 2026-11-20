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
mod vst3_emitter;
mod vst3_front;
mod vst3_probe;

pub use clap_front::{
    CLAP_HARD_REALTIME_PLUGIN_ID, CLAP_PLUGIN_ID, CLAP_PROCESS_ERROR_PLUGIN_ID,
    CLAP_START_REFUSED_PLUGIN_ID, GAIN_PARAM_ID,
};
pub use echo::{ECHO_FRAMES, FAILING_PROCESS_CALL, GAIN_DEFAULT, LATENCY_FRAMES};
pub use vst3_emitter::{
    DRIVE_PARAM_ID, EMITTED_DELAY_FRAMES, EMITTED_TRANSPOSE, METER_PARAM_ID, MODULATED_PARAM_ID,
    VST3_EMITTER_CLASS_ID,
};
pub use vst3_front::{
    VST3_CLASS_ID, VST3_PROCESSOR_TRUTH_CLASS_ID, VST3_PROCESSOR_TRUTH_FAILING_CLASS_ID,
    VST3_PROCESS_ERROR_CLASS_ID, VST3_START_REFUSED_CLASS_ID,
};
pub use vst3_probe::{
    ADDED_PARAM_ID, ADD_PARAMETER_PARAM_ID, LOG_ACTIVATE, LOG_BUS_ARRANGEMENTS, LOG_BUS_INFO,
    LOG_DEACTIVATE, LOG_SETUP_PROCESSING, RESTART_FOREVER_PARAM_ID, SURROUND_OUTPUT_PARAM_ID,
    VST3_MONO_COPY_CLASS_ID, VST3_RECONFIGURING_CLASS_ID, VST3_RECONFIGURING_INSTRUMENT_CLASS_ID,
    WIDEN_OUTPUT_PARAM_ID,
};
