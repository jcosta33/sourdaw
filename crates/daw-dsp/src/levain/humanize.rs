//! Humanization — per-note random variations for levain realism.
//!
//! All variations are scaled by a single "Humanize" knob (0-1).
//! Uses seeded RNG for deterministic renders (same seed = same output).

// ---------------------------------------------------------------------------
// Simple seeded PRNG (xorshift32 — fast, no allocation)
// ---------------------------------------------------------------------------

pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        // Mix seed down to u32 (avoid zero state).
        let s = (seed ^ (seed >> 32)) as u32;
        Self {
            state: if s == 0 { 1 } else { s },
        }
    }

    /// Generate a u32.
    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        self.state
    }

    /// Generate a float in [0, 1).
    #[inline]
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u32() as f32) / (u32::MAX as f32)
    }

    /// Generate a float in [-1, 1).
    #[inline]
    pub fn next_bipolar(&mut self) -> f32 {
        self.next_f32() * 2.0 - 1.0
    }
}

// ---------------------------------------------------------------------------
// Humanize parameters (computed per note)
// ---------------------------------------------------------------------------

/// Per-note humanization offsets.
#[derive(Debug, Clone, Copy)]
pub struct NoteHumanization {
    /// Timing offset in seconds (applied as sample delay).
    pub timing_offset: f32,
    /// Tuning offset in cents.
    pub tuning_cents: f32,
    /// Dynamic variation (gain multiplier, centered on 1.0).
    pub dynamic_scale: f32,
    /// Vibrato rate variation (fraction, centered on 1.0).
    pub vibrato_rate_scale: f32,
    /// Vibrato depth variation (fraction, centered on 1.0).
    pub vibrato_depth_scale: f32,
    /// Vibrato starting phase in [0, 1). Always randomized regardless of
    /// the humanize amount — ensemble realism (spec §4.2) requires that
    /// individual players have decorrelated vibrato phases even when no
    /// other humanization is in effect, otherwise the section sounds like
    /// one player chorused, with audible flanging.
    pub vibrato_phase: f32,
    /// Sample start offset in samples (for round-robin variation).
    pub start_offset: u32,
}

impl Default for NoteHumanization {
    fn default() -> Self {
        Self {
            timing_offset: 0.0,
            tuning_cents: 0.0,
            dynamic_scale: 1.0,
            vibrato_rate_scale: 1.0,
            vibrato_depth_scale: 1.0,
            vibrato_phase: 0.0,
            start_offset: 0,
        }
    }
}

// ---------------------------------------------------------------------------
// Humanizer
// ---------------------------------------------------------------------------

use super::types::HumanizeConfig;

pub struct Humanizer {
    rng: Rng,
    /// The master humanize amount (0.0 = machine, 1.0 = full variation).
    pub amount: f32,
    pub config: HumanizeConfig,
}

impl Humanizer {
    pub fn new(config: HumanizeConfig) -> Self {
        Self {
            rng: Rng::new(config.seed),
            amount: 0.5,
            config,
        }
    }

    /// Generate humanization offsets for a new note.
    pub fn generate(&mut self) -> NoteHumanization {
        // Vibrato phase is always randomized (ensemble decorrelation, spec
        // §4.2) — even at humanize=0 the section needs decorrelated vibrato
        // phases to avoid the chorus-flange artifact.
        let phase = self.rng.next_f32();

        if self.amount < 0.001 {
            return NoteHumanization {
                vibrato_phase: phase,
                ..NoteHumanization::default()
            };
        }

        let a = self.amount;

        NoteHumanization {
            timing_offset: self.rng.next_bipolar() * self.config.timing_max * a,
            tuning_cents: self.rng.next_bipolar() * self.config.tuning_max * a,
            dynamic_scale: 1.0 + self.rng.next_bipolar() * self.config.dynamic_max * a,
            vibrato_rate_scale: 1.0 + self.rng.next_bipolar() * self.config.vibrato_var_max * a,
            vibrato_depth_scale: 1.0 + self.rng.next_bipolar() * self.config.vibrato_var_max * a,
            vibrato_phase: phase,
            start_offset: (self.rng.next_f32() * 64.0 * a) as u32,
        }
    }

    pub fn set_amount(&mut self, amount: f32) {
        self.amount = amount.clamp(0.0, 1.0);
    }

    pub fn set_seed(&mut self, seed: u64) {
        self.config.seed = seed;
        self.rng = Rng::new(seed);
    }
}
