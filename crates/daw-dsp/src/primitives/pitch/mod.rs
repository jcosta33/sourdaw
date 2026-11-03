//! Shared Rust pitch analysis. Direct shrinking-overlap and FFT/right-zero
//! differences retain their existing arithmetic; both YIN profiles share CMND,
//! candidate finalization and interpolation. NSDF remains the MPM cross-check.

mod mpm;
mod overlap;
mod pipeline;
mod scoring;

#[cfg(test)]
mod pipeline_tests;

pub use mpm::MpmDetector;
pub use overlap::{yin_frame, YinConfig, YinResult};
pub use pipeline::parabolic_minimum;
pub use scoring::{fft_inplace, max_analysis_window, YinDetector, MAX_FFT, MAX_TAU};
