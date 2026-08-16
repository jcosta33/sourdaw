/// Background audio analysis pipeline.
///
/// All analysis runs offline (not on the RT audio thread). Results are
/// stored in `SampleMeta` and used for auto-mode detection, waveform
/// rendering, and sample organization.
pub mod bpm;
pub mod fft;
pub mod loop_points;
pub mod onset;
pub mod peaks;
pub mod pitch;
