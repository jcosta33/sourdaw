//! Power amplifier modeling with sag, transformer saturation, and push-pull dynamics.
//!
//! dV_B+/dt = (V_nominal - V_B+) / τ_sag - k·|x(t)|

/// Power tube family.
#[derive(Clone, Copy, PartialEq)]
pub enum PowerTubeType {
    Type6L6,  // Fender-style: clean headroom, tight low end
    TypeEL34, // Marshall-style: midrange growl, earlier breakup
    TypeEL84, // Vox-style: chimey, compressed, early saturation
}

impl PowerTubeType {
    pub fn from_index(i: u32) -> Self {
        match i {
            0 => Self::Type6L6,
            1 => Self::TypeEL34,
            _ => Self::TypeEL84,
        }
    }
}

/// Rectifier type affecting sag behavior.
#[derive(Clone, Copy, PartialEq)]
pub enum RectifierType {
    Tube,       // More sag, slower recovery
    SolidState, // Minimal sag, fast recovery
    Variac,     // Reduced voltage operation
}

impl RectifierType {
    pub fn from_index(i: u32) -> Self {
        match i {
            0 => Self::Tube,
            1 => Self::SolidState,
            _ => Self::Variac,
        }
    }
}

/// Power amplifier with supply sag, push-pull dynamics, and negative feedback.
pub struct PowerAmp {
    sample_rate: f32,
    tube_type: PowerTubeType,
    rectifier_type: RectifierType,

    // Master volume
    master: f32,

    // Supply sag state
    vb_plus: f32,    // current rail voltage (normalized 0-1)
    v_nominal: f32,  // unloaded rail voltage
    sag_amount: f32, // load sensitivity k
    sag_tau: f32,    // recovery time constant (seconds)

    // Push-pull state
    bias: f32,
    neg_feedback: f32,
    presence: f32,
    resonance: f32,
    feedback_state: f32,
    feedback_low_state: f32,
    load_envelope: f32,
    meter_decay_coeff: f32,

    // Metering
    peak_level: f32,
}

impl PowerAmp {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            tube_type: PowerTubeType::TypeEL34,
            rectifier_type: RectifierType::Tube,
            master: 0.5,
            vb_plus: 1.0,
            v_nominal: 1.0,
            sag_amount: 0.4,
            sag_tau: 0.2,
            bias: 0.5,
            neg_feedback: 0.5,
            presence: 0.5,
            resonance: 0.5,
            feedback_state: 0.0,
            feedback_low_state: 0.0,
            load_envelope: 0.0,
            meter_decay_coeff: (-1.0 / (sample_rate * 0.150)).exp(),
            peak_level: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "master" => self.master = value / 10.0,
            "powerTubeType" => self.tube_type = PowerTubeType::from_index(value as u32),
            "rectifierType" => {
                self.rectifier_type = RectifierType::from_index(value as u32);
                self.update_rectifier_params();
            }
            "sagAmount" => self.sag_amount = value,
            "sagRecovery" => self.sag_tau = value * 0.001, // ms to seconds
            "negFeedback" => self.neg_feedback = value,
            "powerAmpBias" => self.bias = value,
            "presence" => self.presence = (value / 10.0).clamp(0.0, 1.0),
            "resonance" => self.resonance = (value / 10.0).clamp(0.0, 1.0),
            _ => {}
        }
    }

    fn update_rectifier_params(&mut self) {
        match self.rectifier_type {
            RectifierType::Tube => {
                // More sag, slower recovery
                self.v_nominal = 1.0;
            }
            RectifierType::SolidState => {
                // Less sag, fast recovery
                self.v_nominal = 1.0;
                self.sag_tau = self.sag_tau.min(0.05);
            }
            RectifierType::Variac => {
                // Reduced voltage
                self.v_nominal = 0.75;
            }
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        let dt = 1.0 / self.sample_rate;

        // Apply master volume
        let master_drive = 0.15 + self.master * 1.85;
        let driven = input * master_drive;

        // Presence/resonance shape the negative-feedback loop by reducing
        // feedback in the high and low bands respectively.
        let feedback_low_coeff = (2.0 * std::f32::consts::PI * 180.0 * dt).min(0.35);
        self.feedback_low_state +=
            feedback_low_coeff * (self.feedback_state - self.feedback_low_state);
        let feedback_low = self.feedback_low_state;
        let feedback_high = self.feedback_state - feedback_low;
        let low_feedback = feedback_low * (1.0 - self.resonance * 0.75);
        let high_feedback = feedback_high * (1.0 - self.presence * 0.75);
        let shaped_feedback = low_feedback + high_feedback;
        let with_nfb = driven - shaped_feedback * self.neg_feedback * 0.3;

        // Power supply sag: dV_B+/dt = (V_nominal - V_B+)/τ_sag - k·|x(t)|
        let load = with_nfb.abs();
        let load_coeff = 1.0 - (-dt / 0.008).exp();
        self.load_envelope += (load - self.load_envelope) * load_coeff;
        let sag_rate = (self.v_nominal - self.vb_plus) / self.sag_tau.max(0.001)
            - self.sag_amount * self.load_envelope;
        self.vb_plus += dt * sag_rate;
        self.vb_plus = self.vb_plus.clamp(0.3, self.v_nominal);

        // Power tube nonlinearity depends on tube type
        let headroom = self.vb_plus;
        let (saturation_curve, asymmetry) = match self.tube_type {
            PowerTubeType::Type6L6 => (0.8, 0.05),  // Clean, tight
            PowerTubeType::TypeEL34 => (0.6, 0.12), // Midrange growl
            PowerTubeType::TypeEL84 => (0.4, 0.18), // Early compression
        };

        // Push-pull saturation with bias-dependent crossover
        let bias_shift = (self.bias - 0.5) * 0.2;
        let signal = with_nfb * headroom;

        // Asymmetric soft clipping (push-pull tube behavior)
        let clipped = if signal >= 0.0 {
            (signal * (1.0 + asymmetry)).tanh() * saturation_curve
        } else {
            (signal * (1.0 - asymmetry)).tanh() * saturation_curve
        };

        // Bias affects crossover distortion
        let crossover = if signal > 0.0 {
            1.0
        } else if signal < 0.0 {
            -1.0
        } else {
            0.0
        };
        let tube_makeup = match self.tube_type {
            PowerTubeType::Type6L6 => 1.10,
            PowerTubeType::TypeEL34 => 1.20,
            PowerTubeType::TypeEL84 => 1.32,
        };
        let sag_makeup = 1.0 + (self.v_nominal - self.vb_plus) * 0.12;
        let output = (clipped + bias_shift * crossover * 0.005) * tube_makeup * sag_makeup;

        // Update negative feedback state
        self.feedback_state = output;

        // Update peak meter
        let peak = output.abs();
        if peak > self.peak_level {
            self.peak_level = peak;
        } else {
            self.peak_level *= self.meter_decay_coeff;
        }

        output
    }

    pub fn sag_voltage(&self) -> f32 {
        self.vb_plus
    }

    pub fn peak_db(&self) -> f32 {
        super::params::linear_to_db(self.peak_level)
    }

    pub fn reset(&mut self) {
        self.vb_plus = self.v_nominal;
        self.feedback_state = 0.0;
        self.feedback_low_state = 0.0;
        self.load_envelope = 0.0;
        self.peak_level = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::PowerAmp;

    #[test]
    fn presence_and_resonance_shape_the_power_stage_response() {
        let total = 4096;

        let mut flat = PowerAmp::new(48_000.0);
        flat.set_param("master", 6.0);

        let mut shaped = PowerAmp::new(48_000.0);
        shaped.set_param("master", 6.0);
        shaped.set_param("presence", 9.0);
        shaped.set_param("resonance", 9.0);

        let mut diff_sum = 0.0_f32;
        for n in 0..total {
            let low = ((n as f32 * 2.0 * std::f32::consts::PI * 90.0) / 48_000.0).sin() * 0.12;
            let high = ((n as f32 * 2.0 * std::f32::consts::PI * 3200.0) / 48_000.0).sin() * 0.06;
            let input = low + high;
            let flat_out = flat.process_sample(input);
            let shaped_out = shaped.process_sample(input);
            diff_sum += (flat_out - shaped_out).abs();
        }

        let average_diff = diff_sum / total as f32;
        assert!(
            average_diff > 1.0e-3,
            "presence and resonance should audibly change the power amp response, got diff {average_diff}"
        );
    }
}
