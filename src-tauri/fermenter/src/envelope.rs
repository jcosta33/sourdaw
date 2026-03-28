/// ADSR envelope generator with exponential curves.
/// All times in seconds. Sustain is a level (0.0–1.0).
#[derive(Clone)]
pub struct Envelope {
    state: EnvState,
    level: f32,
    attack_coeff: f32,
    decay_coeff: f32,
    release_coeff: f32,
    sustain_level: f32,
    sample_rate: f32,
}

#[derive(Clone, Copy, PartialEq)]
enum EnvState {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

impl Envelope {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            state: EnvState::Idle,
            level: 0.0,
            attack_coeff: time_to_coeff(0.01, sample_rate),
            decay_coeff: time_to_coeff(0.2, sample_rate),
            release_coeff: time_to_coeff(0.3, sample_rate),
            sustain_level: 0.7,
            sample_rate,
        }
    }

    pub fn set_params(&mut self, attack: f32, decay: f32, sustain: f32, release: f32) {
        self.attack_coeff = time_to_coeff(attack.max(0.001), self.sample_rate);
        self.decay_coeff = time_to_coeff(decay.max(0.001), self.sample_rate);
        self.sustain_level = sustain.clamp(0.0, 1.0);
        self.release_coeff = time_to_coeff(release.max(0.001), self.sample_rate);
    }

    pub fn note_on(&mut self) {
        self.state = EnvState::Attack;
    }

    pub fn note_off(&mut self) {
        if self.state != EnvState::Idle {
            self.state = EnvState::Release;
        }
    }

    pub fn is_active(&self) -> bool {
        self.state != EnvState::Idle
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        match self.state {
            EnvState::Idle => 0.0,
            EnvState::Attack => {
                self.level += self.attack_coeff * (1.1 - self.level);
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.state = EnvState::Decay;
                }
                self.level
            }
            EnvState::Decay => {
                self.level += self.decay_coeff * (self.sustain_level - self.level);
                if (self.level - self.sustain_level).abs() < 0.001 {
                    self.level = self.sustain_level;
                    self.state = EnvState::Sustain;
                }
                self.level
            }
            EnvState::Sustain => self.sustain_level,
            EnvState::Release => {
                self.level += self.release_coeff * (0.0 - self.level);
                if self.level < 0.0001 {
                    self.level = 0.0;
                    self.state = EnvState::Idle;
                }
                self.level
            }
        }
    }

    pub fn reset(&mut self) {
        self.state = EnvState::Idle;
        self.level = 0.0;
    }
}

/// Convert time in seconds to one-pole coefficient.
/// Targets ~99.3% convergence in the given time.
#[inline]
fn time_to_coeff(time_s: f32, sample_rate: f32) -> f32 {
    let samples = time_s * sample_rate;
    if samples < 1.0 {
        return 1.0;
    }
    1.0 - (-1.0 / samples).exp()
}
