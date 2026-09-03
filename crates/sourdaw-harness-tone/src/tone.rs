//! The tone itself, kept free of any CLAP/FFI vocabulary so it can be
//! exercised as plain Rust: a phase accumulator advanced by a fixed
//! per-sample increment, scaled by the host-controlled `Level` parameter.

use std::cell::Cell;
use std::sync::atomic::{AtomicU64, Ordering};

/// The one frequency this harness plugin ever sounds. Fixed because the
/// harness proves "plugin audio reached the master", not general synthesis.
pub(crate) const TONE_FREQUENCY_HZ: f64 = 440.0;

pub(crate) const LEVEL_MIN: f64 = 0.0;
pub(crate) const LEVEL_MAX: f64 = 1.0;
pub(crate) const LEVEL_DEFAULT: f64 = 0.25;

/// Per-instance state, boxed behind `clap_plugin.plugin_data`, shared by
/// `&Tone` alone: `get_value` may run on the main thread at the same moment
/// `process` is inside `apply_parameter_events` on the audio thread, so no
/// method here ever mints `&mut Tone`.
///
/// `sample_rate` and `phase` change hands by lifecycle state, not by a fixed
/// thread: `clap/plugin.h` annotates `activate` `[main-thread & !active]`, so
/// it writes both fields on the main thread while this instance is still
/// inactive; `reset` and `process` are `[audio-thread & active]`, so they
/// touch the same fields on the audio thread once it is. What excludes
/// `activate` from the other two is that predicate — never active and
/// active can't both hold — not which thread called in, and the host's own
/// activation handoff (it must not call `process` before `activate`
/// returns, nor `activate` again before `deactivate`) is what supplies the
/// happens-before edge between the writer and the next reader. That is
/// exactly what a plain `Cell` needs: one thread touching the field at a
/// time, with a caller-supplied ordering guarantee, so no fence or atomic
/// is required. Any future field on this pattern gets the same treatment
/// only if every callback that touches it is `[audio-thread]` or
/// `[main-thread & !active]` — anything reachable from a
/// `[main-thread & active]` or thread-unconstrained callback (as `level` is,
/// see below) needs an atomic instead.
///
/// `level` is the one field both threads touch: the main thread through
/// `clap.params.get_value`/`text_to_value`, the audio thread through
/// `flush`/`process`. It lives in an `AtomicU64` carrying `f64::to_bits`,
/// with `Relaxed` ordering — the value itself is the only thing that needs
/// to cross threads, not anything it happens alongside.
pub(crate) struct Tone {
    /// The rate `activate` was called with. Zero until then, which
    /// `next_sample` treats as "hold the phase" rather than divide by it.
    sample_rate: Cell<f64>,
    /// Radians, wrapped into `[0, TAU)` every sample so it stays precise
    /// across a session's worth of blocks.
    phase: Cell<f64>,
    level: AtomicU64,
}

impl Tone {
    pub(crate) fn new() -> Self {
        Self {
            sample_rate: Cell::new(0.0),
            phase: Cell::new(0.0),
            level: AtomicU64::new(LEVEL_DEFAULT.to_bits()),
        }
    }

    pub(crate) fn level(&self) -> f64 {
        f64::from_bits(self.level.load(Ordering::Relaxed))
    }

    pub(crate) fn set_level(&self, level: f64) {
        self.level.store(level.to_bits(), Ordering::Relaxed);
    }

    /// Record the rate the host activated at and restart the phase, per this
    /// plugin's own contract: phase starts at 0 on `activate`.
    pub(crate) fn activate(&self, sample_rate: f64) {
        self.sample_rate.set(sample_rate);
        self.reset();
    }

    /// Restart the phase without touching the recorded sample rate or level,
    /// per CLAP's `reset`: the host may call it any number of times between
    /// `activate` and `deactivate` to force silence without reactivating.
    pub(crate) fn reset(&self) {
        self.phase.set(0.0);
    }

    /// One sample of the tone at the current level, and the phase advanced
    /// by `2*pi*440/sample_rate` for the sample after it.
    pub(crate) fn next_sample(&self) -> f32 {
        let phase = self.phase.get();
        let sample = (self.level() * phase.sin()) as f32;
        let sample_rate = self.sample_rate.get();
        if sample_rate > 0.0 {
            let increment = std::f64::consts::TAU * TONE_FREQUENCY_HZ / sample_rate;
            self.phase.set((phase + increment) % std::f64::consts::TAU);
        }
        sample
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activate_restarts_the_phase() {
        let tone = Tone::new();
        tone.activate(48_000.0);
        for _ in 0..10 {
            tone.next_sample();
        }
        assert_ne!(
            tone.next_sample(),
            0.0,
            "phase should have moved off zero by now"
        );

        tone.activate(48_000.0);

        assert_eq!(
            tone.next_sample(),
            0.0,
            "activate should restart the phase at zero"
        );
    }

    #[test]
    fn the_level_scales_the_peak() {
        let tone = Tone::new();
        tone.activate(48_000.0);
        tone.set_level(0.5);
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
        let tone = Tone::new();
        let sample = tone.next_sample();
        assert_eq!(sample, 0.0);
        assert!(!sample.is_nan());
    }

    #[test]
    fn reset_restarts_the_phase_without_reactivating() {
        let tone = Tone::new();
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
