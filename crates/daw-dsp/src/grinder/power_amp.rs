//! Power amplifier modeling with sag, transformer saturation, and push-pull dynamics.
//!
//! dV_B+/dt = (V_nominal - V_B+) / τ_sag - k·|x(t)|

/// Power tube family.
#[derive(Clone, Copy, PartialEq)]
pub enum PowerTubeType {
    Type6L6,   // Fender-style: clean headroom, tight low end
    TypeEL34,  // Marshall-style: midrange growl, earlier breakup
    TypeEL84,  // Vox-style: chimey, compressed, early saturation
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
    Tube,        // More sag, slower recovery
    SolidState,  // Minimal sag, fast recovery
    Variac,      // Reduced voltage operation
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
    vb_plus: f32,       // current rail voltage (normalized 0-1)
    v_nominal: f32,     // unloaded rail voltage
    sag_amount: f32,    // load sensitivity k
    sag_tau: f32,       // recovery time constant (seconds)

    // Push-pull state
    bias: f32,
    neg_feedback: f32,
    feedback_state: f32,

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
            feedback_state: 0.0,
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
        let driven = input * self.master;

        // Apply negative feedback
        let with_nfb = driven - self.feedback_state * self.neg_feedback * 0.3;

        // Power supply sag: dV_B+/dt = (V_nominal - V_B+)/τ_sag - k·|x(t)|
        let load = with_nfb.abs();
        let sag_rate = (self.v_nominal - self.vb_plus) / self.sag_tau.max(0.001)
            - self.sag_amount * load;
        self.vb_plus += dt * sag_rate;
        self.vb_plus = self.vb_plus.clamp(0.3, self.v_nominal);

        // Power tube nonlinearity depends on tube type
        let headroom = self.vb_plus;
        let (saturation_curve, asymmetry) = match self.tube_type {
            PowerTubeType::Type6L6 => (0.8, 0.05),    // Clean, tight
            PowerTubeType::TypeEL34 => (0.6, 0.12),    // Midrange growl
            PowerTubeType::TypeEL84 => (0.4, 0.18),    // Early compression
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
        let output = clipped + bias_shift * signal.signum() * 0.01;

        // Update negative feedback state
        self.feedback_state = output;

        // Update peak meter
        let peak = output.abs();
        if peak > self.peak_level {
            self.peak_level = peak;
        } else {
            self.peak_level *= 0.9999;
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
        self.peak_level = 0.0;
    }
}
