//! Input conditioning: impedance, noise gate, calibration.

use super::params::db_to_linear;

/// Noise gate with attack/release envelope.
pub struct NoiseGate {
    threshold_linear: f32,
    detector_attack_coeff: f32,
    detector_release_coeff: f32,
    gain_attack_coeff: f32,
    gain_release_coeff: f32,
    hysteresis_linear: f32,
    floor_gain: f32,
    envelope: f32,
    gate_gain: f32,
    is_open: bool,
    hold_samples: u32,
    hold_counter: u32,
    enabled: bool,
    sample_rate: f32,
}

impl NoiseGate {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            threshold_linear: db_to_linear(-60.0),
            detector_attack_coeff: Self::time_to_coeff(0.5, sample_rate),
            detector_release_coeff: Self::time_to_coeff(50.0, sample_rate),
            gain_attack_coeff: Self::time_to_coeff(0.5, sample_rate),
            gain_release_coeff: Self::time_to_coeff(90.0, sample_rate),
            hysteresis_linear: db_to_linear(2.0) - 1.0,
            floor_gain: db_to_linear(-48.0),
            envelope: 0.0,
            gate_gain: 1.0,
            is_open: true,
            hold_samples: (sample_rate * 0.020) as u32,
            hold_counter: 0,
            enabled: false,
            sample_rate,
        }
    }

    fn time_to_coeff(ms: f32, sample_rate: f32) -> f32 {
        (-1.0 / (ms.max(0.01) * 0.001 * sample_rate)).exp()
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "gateEnabled" => {
                self.enabled = value > 0.5;
                if !self.enabled {
                    self.gate_gain = 1.0;
                    self.is_open = true;
                }
            }
            "gateThreshold" => self.threshold_linear = db_to_linear(value),
            "gateAttack" => {
                self.detector_attack_coeff = Self::time_to_coeff((value * 0.5).max(0.1), self.sample_rate);
                self.gain_attack_coeff = Self::time_to_coeff(value.max(0.1), self.sample_rate);
            }
            "gateRelease" => {
                self.detector_release_coeff = Self::time_to_coeff((value * 0.6).max(5.0), self.sample_rate);
                self.gain_release_coeff = Self::time_to_coeff(value.max(5.0), self.sample_rate);
            }
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
            self.envelope = abs_in + self.detector_attack_coeff * (self.envelope - abs_in);
        } else {
            self.envelope = abs_in + self.detector_release_coeff * (self.envelope - abs_in);
        }

        // Add a little hysteresis so the gate doesn't chatter on marginal notes.
        let open_threshold = self.threshold_linear * (1.0 + self.hysteresis_linear * 0.5);
        let close_threshold = self.threshold_linear * (1.0 - self.hysteresis_linear * 0.5);
        if self.envelope >= open_threshold {
            self.is_open = true;
            self.hold_counter = self.hold_samples;
        } else if self.envelope <= close_threshold {
            if self.hold_counter > 0 {
                self.hold_counter -= 1;
            } else {
                self.is_open = false;
            }
        }
        let target_gain = if self.is_open {
            1.0
        } else {
            let denom = (open_threshold - close_threshold).max(1.0e-6);
            let transition = ((self.envelope - close_threshold) / denom).clamp(0.0, 1.0);
            self.floor_gain + transition * (1.0 - self.floor_gain)
        };
        let coeff = if target_gain > self.gate_gain {
            self.gain_attack_coeff
        } else {
            self.gain_release_coeff
        };
        self.gate_gain = target_gain + coeff * (self.gate_gain - target_gain);

        input * self.gate_gain
    }

    pub fn reset(&mut self) {
        self.envelope = 0.0;
        self.gate_gain = if self.enabled { self.floor_gain } else { 1.0 };
        self.is_open = !self.enabled;
        self.hold_counter = 0;
    }

    pub fn gain(&self) -> f32 {
        self.gate_gain
    }

    pub fn envelope_db(&self) -> f32 {
        let safe = self.envelope.max(1.0e-6);
        20.0 * safe.log10()
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
        let impedance = self.impedance.clamp(10.0, 10_000.0);
        let impedance_norm = ((impedance.log10() - 1.0) / 3.0).clamp(0.0, 1.0);
        let load_freq = 4_000.0 + impedance_norm * 24_000.0;
        let dt = 1.0 / self.sample_rate;
        let coeff = (2.0 * std::f32::consts::PI * load_freq * dt).min(0.99);
        self.impedance_filter_state += coeff * (input - self.impedance_filter_state);

        self.impedance_filter_state * self.gain_linear
    }

    pub fn reset(&mut self) {
        self.impedance_filter_state = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::NoiseGate;

    #[test]
    fn default_gate_is_transparent() {
        let mut gate = NoiseGate::new(48_000.0);
        let output = gate.process_sample(0.2);
        assert!(
            (output - 0.2).abs() < 1.0e-6,
            "default gate should not fade in the initial preset"
        );
    }

    #[test]
    fn enabled_gate_opens_for_sustained_pick_attack() {
        let mut gate = NoiseGate::new(48_000.0);
        gate.set_param("gateEnabled", 1.0);
        gate.set_param("gateThreshold", -50.0);
        gate.set_param("gateAttack", 1.0);
        gate.set_param("gateRelease", 100.0);

        let mut output = 0.0_f32;
        for _ in 0..512 {
            output = gate.process_sample(0.2);
        }

        assert!(
            output > 0.15,
            "gate should fully open on a healthy sustained note, got {output}"
        );
    }
}
