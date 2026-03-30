//! Input conditioning: impedance, noise gate, calibration.

use super::params::db_to_linear;

/// Noise gate with attack/release envelope.
pub struct NoiseGate {
    threshold_linear: f32,
    attack_coeff: f32,
    release_coeff: f32,
    envelope: f32,
    gate_gain: f32,
    enabled: bool,
    sample_rate: f32,
}

impl NoiseGate {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            threshold_linear: db_to_linear(-60.0),
            attack_coeff: Self::time_to_coeff(0.5, sample_rate),
            release_coeff: Self::time_to_coeff(50.0, sample_rate),
            envelope: 0.0,
            gate_gain: 0.0,
            enabled: true,
            sample_rate,
        }
    }

    fn time_to_coeff(ms: f32, sample_rate: f32) -> f32 {
        (-1.0 / (ms.max(0.01) * 0.001 * sample_rate)).exp()
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "gateEnabled" => self.enabled = value > 0.5,
            "gateThreshold" => self.threshold_linear = db_to_linear(value),
            "gateAttack" => self.attack_coeff = Self::time_to_coeff(value, self.sample_rate),
            "gateRelease" => self.release_coeff = Self::time_to_coeff(value, self.sample_rate),
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.enabled {
            return input;
        }

        // Envelope follower
        let abs_in = input.abs();
        if abs_in > self.envelope {
            self.envelope = abs_in + self.attack_coeff * (self.envelope - abs_in);
        } else {
            self.envelope = abs_in + self.release_coeff * (self.envelope - abs_in);
        }

        // Gate gain
        if self.envelope > self.threshold_linear {
            self.gate_gain = 1.0 + 0.05 * (self.gate_gain - 1.0); // fast open
        } else {
            self.gate_gain *= 0.999; // smooth close
        }
        self.gate_gain = self.gate_gain.clamp(0.0, 1.0);

        input * self.gate_gain
    }

    pub fn reset(&mut self) {
        self.envelope = 0.0;
        self.gate_gain = 0.0;
    }
}

/// Input conditioning: impedance, gain, calibration.
pub struct InputConditioner {
    gain_linear: f32,
    impedance: f32,
    impedance_filter_state: f32,
    sample_rate: f32,
}

impl InputConditioner {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            gain_linear: 1.0,
            impedance: 1000.0,
            impedance_filter_state: 0.0,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "inputGain" => self.gain_linear = db_to_linear(value),
            "inputImpedance" => self.impedance = value,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        // Impedance loading effect: lower impedance = more HF rolloff (pickup loading)
        let load_freq = 1000.0 + self.impedance * 10.0; // Higher impedance = brighter
        let load_freq = load_freq.clamp(500.0, 100000.0);
        let dt = 1.0 / self.sample_rate;
        let coeff = (2.0 * std::f32::consts::PI * load_freq * dt).min(0.99);
        self.impedance_filter_state += coeff * (input - self.impedance_filter_state);

        self.impedance_filter_state * self.gain_linear
    }

    pub fn reset(&mut self) {
        self.impedance_filter_state = 0.0;
    }
}
