/// Six-state AHDSR envelope generator.
///
/// Uses a 1-multiply iterative exponential curve:
///   `level = (level - offset) * multiplier + offset`
///
/// The `target_ratio` parameter controls curve shape:
///   - 0.0001 → steep exponential (natural amp/filter envelopes)
///   - 1.0+   → nearly linear (useful for pitch envelopes)
use super::types::ENV_TARGET_EXP;

// ── Envelope State ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnvelopeState {
    Idle,
    Attack,
    Hold,
    Decay,
    Sustain,
    Release,
}

// ── AHDSR Envelope ─────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AhdsrEnvelope {
    state: EnvelopeState,
    level: f32,
    sample_rate: f32,

    // Time parameters (seconds)
    attack_time: f32,
    hold_time: f32,
    decay_time: f32,
    sustain_level: f32,
    release_time: f32,

    // Curve shape (target_ratio per stage)
    attack_target_ratio: f32,
    decay_target_ratio: f32,
    release_target_ratio: f32,

    // Computed coefficients
    attack_coeff: f32,
    attack_offset: f32,
    decay_coeff: f32,
    decay_offset: f32,
    release_coeff: f32,
    release_offset: f32,

    // Hold counter
    hold_samples: u32,
    hold_counter: u32,
}

impl AhdsrEnvelope {
    pub fn new(sample_rate: f32) -> Self {
        let mut env = Self {
            state: EnvelopeState::Idle,
            level: 0.0,
            sample_rate,
            attack_time: 0.001,
            hold_time: 0.0,
            decay_time: 0.1,
            sustain_level: 1.0,
            release_time: 0.01,
            attack_target_ratio: ENV_TARGET_EXP,
            decay_target_ratio: ENV_TARGET_EXP,
            release_target_ratio: ENV_TARGET_EXP,
            attack_coeff: 0.0,
            attack_offset: 0.0,
            decay_coeff: 0.0,
            decay_offset: 0.0,
            release_coeff: 0.0,
            release_offset: 0.0,
            hold_samples: 0,
            hold_counter: 0,
        };
        env.recalculate();
        env
    }

    // ── Parameter Setters ──────────────────────────────────────────────

    pub fn set_attack(&mut self, time_secs: f32) {
        self.attack_time = time_secs.max(0.0);
        self.recalculate_attack();
    }

    pub fn set_hold(&mut self, time_secs: f32) {
        self.hold_time = time_secs.max(0.0);
        self.hold_samples = (self.hold_time * self.sample_rate) as u32;
    }

    pub fn set_decay(&mut self, time_secs: f32) {
        self.decay_time = time_secs.max(0.0);
        self.recalculate_decay();
    }

    pub fn set_sustain(&mut self, level: f32) {
        self.sustain_level = level.clamp(0.0, 1.0);
        self.recalculate_decay();
    }

    pub fn set_release(&mut self, time_secs: f32) {
        self.release_time = time_secs.max(0.0);
        self.recalculate_release();
    }

    pub fn set_attack_curve(&mut self, target_ratio: f32) {
        self.attack_target_ratio = target_ratio.max(0.00001);
        self.recalculate_attack();
    }

    pub fn set_decay_curve(&mut self, target_ratio: f32) {
        self.decay_target_ratio = target_ratio.max(0.00001);
        self.recalculate_decay();
    }

    pub fn set_release_curve(&mut self, target_ratio: f32) {
        self.release_target_ratio = target_ratio.max(0.00001);
        self.recalculate_release();
    }

    // ── State Control ──────────────────────────────────────────────────

    pub fn note_on(&mut self) {
        if self.attack_time > 0.0 {
            self.state = EnvelopeState::Attack;
        } else if self.hold_samples > 0 {
            self.level = 1.0;
            self.hold_counter = 0;
            self.state = EnvelopeState::Hold;
        } else {
            self.level = 1.0;
            self.state = EnvelopeState::Decay;
        }
    }

    pub fn note_off(&mut self) {
        if self.state != EnvelopeState::Idle {
            self.state = EnvelopeState::Release;
        }
    }

    pub fn is_active(&self) -> bool {
        self.state != EnvelopeState::Idle
    }

    pub fn state(&self) -> EnvelopeState {
        self.state
    }

    pub fn level(&self) -> f32 {
        self.level
    }

    pub fn reset(&mut self) {
        self.state = EnvelopeState::Idle;
        self.level = 0.0;
        self.hold_counter = 0;
    }

    // ── Per-Sample Processing ──────────────────────────────────────────

    /// Advance the envelope by one sample and return the current level.
    pub fn tick(&mut self) -> f32 {
        match self.state {
            EnvelopeState::Idle => {
                return 0.0;
            }

            EnvelopeState::Attack => {
                self.level = self.level * self.attack_coeff + self.attack_offset;
                if self.level >= 1.0 {
                    self.level = 1.0;
                    if self.hold_samples > 0 {
                        self.hold_counter = 0;
                        self.state = EnvelopeState::Hold;
                    } else {
                        self.state = EnvelopeState::Decay;
                    }
                }
            }

            EnvelopeState::Hold => {
                self.hold_counter += 1;
                if self.hold_counter >= self.hold_samples {
                    self.state = EnvelopeState::Decay;
                }
            }

            EnvelopeState::Decay => {
                self.level = self.level * self.decay_coeff + self.decay_offset;
                if self.level <= self.sustain_level {
                    self.level = self.sustain_level;
                    self.state = EnvelopeState::Sustain;
                }
            }

            EnvelopeState::Sustain => {
                // Level stays at sustain_level until note_off.
            }

            EnvelopeState::Release => {
                self.level = self.level * self.release_coeff + self.release_offset;
                if self.level <= 0.0001 {
                    self.level = 0.0;
                    self.state = EnvelopeState::Idle;
                }
            }
        }

        self.level
    }

    // ── Coefficient Calculation ────────────────────────────────────────

    fn recalculate(&mut self) {
        self.recalculate_attack();
        self.hold_samples = (self.hold_time * self.sample_rate) as u32;
        self.recalculate_decay();
        self.recalculate_release();
    }

    fn recalculate_attack(&mut self) {
        // Attack goes 0 → 1, overshooting toward (1 + target_ratio).
        let samples = (self.attack_time * self.sample_rate).max(1.0);
        let rate = ((1.0 + self.attack_target_ratio) / self.attack_target_ratio).ln() / samples;
        self.attack_coeff = (-rate).exp();
        // Offset drives level toward (1 + target_ratio); tick() clamps at 1.0.
        self.attack_offset = (1.0 + self.attack_target_ratio) * (1.0 - self.attack_coeff);
    }

    fn recalculate_decay(&mut self) {
        // Decay goes 1 → sustain, undershooting toward (sustain - target_ratio).
        let samples = (self.decay_time * self.sample_rate).max(1.0);
        let rate = ((1.0 + self.decay_target_ratio) / self.decay_target_ratio).ln() / samples;
        self.decay_coeff = (-rate).exp();
        let target = self.sustain_level - self.decay_target_ratio;
        self.decay_offset = target * (1.0 - self.decay_coeff);
    }

    fn recalculate_release(&mut self) {
        // Release goes current → 0, undershooting toward -target_ratio.
        let samples = (self.release_time * self.sample_rate).max(1.0);
        let rate = ((1.0 + self.release_target_ratio) / self.release_target_ratio).ln() / samples;
        self.release_coeff = (-rate).exp();
        let target = -self.release_target_ratio;
        self.release_offset = target * (1.0 - self.release_coeff);
    }
}
