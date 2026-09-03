//! The tone itself, kept free of any CLAP/FFI vocabulary so it can be
//! exercised as plain Rust: a phase accumulator advanced by a fixed
//! per-sample increment, scaled by the host-controlled `Level` parameter.

/// The one frequency this harness plugin ever sounds. Fixed because the
/// harness proves "plugin audio reached the master", not general synthesis.
pub(crate) const TONE_FREQUENCY_HZ: f64 = 440.0;

pub(crate) const LEVEL_MIN: f64 = 0.0;
pub(crate) const LEVEL_MAX: f64 = 1.0;
pub(crate) const LEVEL_DEFAULT: f64 = 0.25;

/// Per-instance state, boxed behind `clap_plugin.plugin_data`. `process`
/// never allocates: every field here is fixed size and mutated in place.
pub(crate) struct Tone {
    /// The rate `activate` was called with. Zero until then, which
    /// `next_sample` treats as "hold the phase" rather than divide by it.
    sample_rate: f64,
    /// Radians, wrapped into `[0, TAU)` every sample so it stays precise
    /// across a session's worth of blocks.
    phase: f64,
    pub(crate) level: f64,
}

impl Tone {
    pub(crate) fn new() -> Self {
        Self {
            sample_rate: 0.0,
            phase: 0.0,
            level: LEVEL_DEFAULT,
        }
    }

    /// Record the rate the host activated at and restart the phase, per this
    /// plugin's own contract: phase starts at 0 on `activate`.
    pub(crate) fn activate(&mut self, sample_rate: f64) {
        self.sample_rate = sample_rate;
        self.reset();
    }

    /// Restart the phase without touching the recorded sample rate or level,
    /// per CLAP's `reset`: the host may call it any number of times between
    /// `activate` and `deactivate` to force silence without reactivating.
    pub(crate) fn reset(&mut self) {
        self.phase = 0.0;
    }

    /// One sample of the tone at the current level, and the phase advanced
    /// by `2*pi*440/sample_rate` for the sample after it.
    pub(crate) fn next_sample(&mut self) -> f32 {
        let sample = (self.level * self.phase.sin()) as f32;
        if self.sample_rate > 0.0 {
            let increment = std::f64::consts::TAU * TONE_FREQUENCY_HZ / self.sample_rate;
            self.phase = (self.phase + increment) % std::f64::consts::TAU;
        }
        sample
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_sample_after_activate_is_silent_phase_zero() {
        let mut tone = Tone::new();
        tone.activate(48_000.0);
        assert_eq!(tone.next_sample(), 0.0);
    }

    #[test]
    fn the_level_scales_the_peak() {
        let mut tone = Tone::new();
        tone.activate(48_000.0);
        tone.level = 0.5;
        // One full period, so the nearest sample to the true peak is within
        // half a phase increment of it rather than landing wherever a single
        // fixed offset happens to fall.
        let period_frames = (48_000.0 / TONE_FREQUENCY_HZ).ceil() as usize;
        let mut peak = 0.0f32;
        for _ in 0..period_frames {
            peak = peak.max(tone.next_sample().abs());
        }
        assert!((peak - 0.5).abs() < 1e-3, "peak was {peak}");
    }

    #[test]
    fn an_unactivated_tone_holds_its_phase_rather_than_dividing_by_zero() {
        let mut tone = Tone::new();
        let sample = tone.next_sample();
        assert_eq!(sample, 0.0);
        assert!(!sample.is_nan());
    }

    #[test]
    fn reset_restarts_the_phase_without_reactivating() {
        let mut tone = Tone::new();
        tone.activate(48_000.0);
        for _ in 0..10 {
            tone.next_sample();
        }
        assert_ne!(
            tone.next_sample(),
            0.0,
            "phase should have moved off zero by now"
        );

        tone.reset();

        assert_eq!(
            tone.next_sample(),
            0.0,
            "reset should restart the phase at zero"
        );
    }
}
