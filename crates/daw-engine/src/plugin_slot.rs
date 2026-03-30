//! Plugin slot — trait for external plugins processed on the native audio thread.
//!
//! This trait abstracts over CLAP, VST3, and future format wrappers so the
//! scheduler doesn't need to know about specific plugin formats.

/// Trait for a plugin that can process audio on the real-time thread.
/// Implementors: ClapWrapper, Vst3Wrapper (future), AuWrapper (future).
pub trait NativePlugin: Send {
    /// Process a block of stereo audio in-place.
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize);

    /// Set a parameter by ID and value (called from audio thread via rtrb command).
    fn set_param(&mut self, param_id: u32, value: f64);

    /// Get the plugin's name (for logging).
    fn name(&self) -> &str;
}
