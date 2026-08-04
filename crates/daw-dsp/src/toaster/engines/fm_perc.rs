//! FM/Loopback FM percussion engine.
//! Produces metallic, bell-like, and pitched percussive sounds.
//! One operator with self-feedback + a second modulator operator.

use core::f32::consts::TAU;

const DEFAULT_BASE_FREQ: f32 = 200.0;

pub struct FmPercEngine {
    // Carrier
    carrier_phase: f32,
    carrier_freq: f32,
    y_prev: f32, // previous output for feedback

    // Modulator
    mod_phase: f32,
    mod_ratio: f32,  // freq ratio to carrier
    mod_amount: f32, // modulation depth

    // Feedback
    feedback: f32, // self-feedback amount (0-1)

    // Envelopes
    amp_env: f32,
    amp_decay_coeff: f32,
    mod_env: f32, // modulation index envelope (decays fast for metallic attack)
    mod_decay_coeff: f32,

    // Params
    base_freq: f32,
    tune_ratio: f32,
    drive: f32,
    active: bool,
}

impl FmPercEngine {
    pub fn new(_sample_rate: f32) -> Self {
        Self {
            carrier_phase: 0.0,
            carrier_freq: 200.0,
            y_prev: 0.0,
            mod_phase: 0.0,
            mod_ratio: 3.0,
            mod_amount: 1.5,
            feedback: 0.3,
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            mod_env: 0.0,
            mod_decay_coeff: 0.0,
            base_freq: DEFAULT_BASE_FREQ,
            tune_ratio: 1.0,
            drive: 0.0,
            active: false,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.carrier_phase = 0.0;
        self.mod_phase = 0.0;
        self.y_prev = 0.0;
        self.amp_env = velocity;
        self.mod_env = 1.0;
        self.carrier_freq = self.base_freq * self.tune_ratio;
        // Amp decays over ~200ms (clamp to avoid division by zero)
        let safe_amp_decay = 0.2_f32.max(0.001);
        self.amp_decay_coeff = (-1.0 / (safe_amp_decay * sample_rate)).exp();
        // Mod index decays much faster (~20ms) for metallic attack
        let safe_mod_decay = 0.02_f32.max(0.001);
        self.mod_decay_coeff = (-1.0 / (safe_mod_decay * sample_rate)).exp();
        self.active = true;
    }

    pub fn release(&mut self) {
        // FM percussion is typically one-shot, release just accelerates decay
        self.amp_decay_coeff *= 0.95;
    }

    #[inline]
    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if !self.active {
            return 0.0;
        }

        // Envelopes
        self.amp_env *= self.amp_decay_coeff;
        self.mod_env *= self.mod_decay_coeff;

        if self.amp_env < 1e-6 {
            self.active = false;
            return 0.0;
        }

        // Modulator
        let mod_freq = self.carrier_freq * self.mod_ratio;
        self.mod_phase += mod_freq / sample_rate;
        if self.mod_phase >= 1.0 {
            self.mod_phase -= 1.0;
        }
        let mod_out = (self.mod_phase * TAU).sin() * self.mod_amount * self.mod_env;

        // Carrier with feedback + modulator input
        let fb = self.y_prev * self.feedback;
        let carrier_out = (self.carrier_phase * TAU + mod_out + fb).sin();

        self.carrier_phase += self.carrier_freq / sample_rate;
        if self.carrier_phase >= 1.0 {
            self.carrier_phase -= 1.0;
        }
        self.y_prev = carrier_out;

        // Apply drive
        let output = if self.drive > 0.001 {
            let x = carrier_out * (1.0 + self.drive * 3.0);
            let x2 = x * x;
            x * (27.0 + x2) / (27.0 + 9.0 * x2) // fast_tanh approx
        } else {
            carrier_out
        };

        output * self.amp_env
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn reset_base_freq(&mut self) {
        self.base_freq = DEFAULT_BASE_FREQ;
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "decay" => {
                // Normalize 0-1 to amp decay range 0.02-2.0s
                let v = value.clamp(0.0, 1.0);
                let decay_s = 0.02 + v * 1.98;
                self.amp_decay_coeff = (-1.0 / (decay_s * 44100.0)).exp();
            }
            "tune" => {
                self.tune_ratio = 2.0f32.powf(value.clamp(-24.0, 24.0) / 12.0);
            }
            "tone" => {
                // Map 0-1 to mod_amount (FM brightness)
                self.mod_amount = value.clamp(0.0, 1.0) * 8.0;
            }
            "drive" => self.drive = value.clamp(0.0, 10.0),
            "base_freq" | "freq" => self.base_freq = value.clamp(40.0, 4000.0),
            "mod_ratio" | "ratio" => self.mod_ratio = value.clamp(0.5, 16.0),
            "mod_amount" | "amount" => self.mod_amount = value.clamp(0.0, 8.0),
            "feedback" | "fb" => self.feedback = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    pub fn engine_type(&self) -> u8 {
        8
    } // new engine type id
}
