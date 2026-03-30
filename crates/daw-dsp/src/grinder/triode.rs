//! 12AX7 Preamp Triode Model — Norman Koren phenomenological model.
//!
//! Includes grid conduction, coupling-capacitor blocking distortion,
//! and dynamic Miller capacitance.
//!
//! E₁ = (Vpk/Kp) · ln[1 + exp(Kp · (1/μ + (Vgk + Vct)/√(Kvb + Vpk²)))]
//! Ip = (E₁^Ex / Kg) · (1 + sgn(E₁))

/// Koren model parameters for a tube type.
#[derive(Clone)]
pub struct TubeParams {
    pub mu: f64,     // amplification factor
    pub ex: f64,     // transfer curve exponent
    pub kg: f64,     // plate current scaling
    pub kp: f64,     // plate voltage scaling
    pub kvb: f64,    // breakdown voltage parameter
    pub vct: f64,    // contact potential offset
}

impl TubeParams {
    /// Default 12AX7 parameters.
    pub fn ax7() -> Self {
        Self { mu: 100.0, ex: 1.4, kg: 1060.0, kp: 600.0, kvb: 300.0, vct: 0.5 }
    }
}

/// Single triode gain stage with grid conduction and coupling cap.
pub struct TriodeStage {
    params: TubeParams,

    // Operating point
    vgk: f64,
    vpk: f64,
    plate_voltage: f64,
    supply_voltage: f64,
    plate_resistor: f64,

    // Grid conduction state
    grid_current: f64,
    coupling_cap_charge: f64,
    coupling_cap_tau: f64,

    // Miller capacitance
    miller_cap_factor: f64,
    miller_lp_state: f64,

    // Bias and aging
    bias_offset: f64,
    age_factor: f64,

    sample_rate: f64,
}

impl TriodeStage {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            params: TubeParams::ax7(),
            vgk: -2.0,
            vpk: 200.0,
            plate_voltage: 200.0,
            supply_voltage: 300.0,
            plate_resistor: 100_000.0,
            grid_current: 0.0,
            coupling_cap_charge: 0.0,
            coupling_cap_tau: 0.01, // 10ms RC time constant
            miller_cap_factor: 0.5,
            miller_lp_state: 0.0,
            bias_offset: 0.0,
            age_factor: 0.0,
            sample_rate: sample_rate as f64,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "tubeBias" => self.bias_offset = (value as f64 - 0.5) * 4.0,
            "tubeAge" => self.age_factor = value as f64,
            "millerCapacitance" => self.miller_cap_factor = value as f64,
            "gridConduction" => self.coupling_cap_tau = 0.001 + value as f64 * 0.05,
            "couplingCapCharge" => {
                // Scale the coupling cap RC time constant
                self.coupling_cap_tau = 0.005 + value as f64 * 0.04;
            }
            _ => {}
        }
    }

    /// Compute plate current using Koren model.
    fn plate_current(&self, vgk: f64, vpk: f64) -> f64 {
        let p = &self.params;
        let vpk_safe = vpk.max(1.0);

        // E₁ = (Vpk/Kp) · ln[1 + exp(Kp · (1/μ + (Vgk + Vct)/√(Kvb + Vpk²)))]
        let inner = p.kp * (1.0 / p.mu + (vgk + p.vct) / (p.kvb + vpk_safe * vpk_safe).sqrt());
        let inner_clamped = inner.clamp(-50.0, 50.0); // prevent overflow
        let e1 = (vpk_safe / p.kp) * (1.0 + inner_clamped.exp()).ln();

        // Ip = (E₁^Ex / Kg) · (1 + sgn(E₁))
        if e1 <= 0.0 {
            0.0
        } else {
            let ip = e1.powf(p.ex) / p.kg;
            // Apply aging: slightly reduce gain and shift bias
            ip * (1.0 - self.age_factor * 0.15)
        }
    }

    /// Compute grid current (for grid conduction modeling).
    fn grid_current_model(&self, vgk: f64) -> f64 {
        if vgk <= 0.0 {
            0.0
        } else {
            // Piecewise: exponential onset of grid conduction
            let ig = 0.001 * (vgk * 10.0).tanh() * vgk;
            ig.max(0.0)
        }
    }

    /// Process a single sample through the triode stage.
    pub fn process_sample(&mut self, input: f32) -> f32 {
        let input_d = input as f64;
        let dt = 1.0 / self.sample_rate;

        // Grid voltage = input signal + bias + coupling cap charge offset
        let vgk = input_d * 50.0 + self.bias_offset - self.coupling_cap_charge;

        // Grid conduction
        let ig = self.grid_current_model(vgk);
        self.grid_current = ig;

        // Coupling cap charges from grid current, discharges through RC
        self.coupling_cap_charge += dt * (ig * 1000.0 - self.coupling_cap_charge / self.coupling_cap_tau);
        self.coupling_cap_charge = self.coupling_cap_charge.clamp(-5.0, 5.0);

        // Plate current
        let vpk = self.plate_voltage;
        let ip = self.plate_current(vgk, vpk);

        // Update plate voltage: V_plate = V_supply - Ip * R_plate
        self.plate_voltage = self.supply_voltage - ip * self.plate_resistor;
        self.plate_voltage = self.plate_voltage.clamp(0.0, self.supply_voltage);

        // Output = inverted plate voltage swing, normalized
        let output = (self.plate_voltage - self.supply_voltage * 0.5) / (self.supply_voltage * 0.5);

        // Miller capacitance: dynamic low-pass that depends on stage gain
        let stage_gain = (ip * self.plate_resistor / self.supply_voltage).abs().clamp(0.0, 10.0);
        let miller_freq = 20000.0 / (1.0 + self.miller_cap_factor * stage_gain * 2.0);
        let miller_coeff = (-2.0 * std::f64::consts::PI * miller_freq * dt).exp();
        self.miller_lp_state = output + miller_coeff * (self.miller_lp_state - output);

        self.miller_lp_state as f32
    }

    pub fn reset(&mut self) {
        self.plate_voltage = self.supply_voltage * 0.67;
        self.coupling_cap_charge = 0.0;
        self.grid_current = 0.0;
        self.miller_lp_state = 0.0;
    }
}

/// Multi-stage preamp (typically 3-4 cascaded triode stages for high-gain amps).
pub struct Preamp {
    stages: Vec<TriodeStage>,
    gain: f32,
    bright: bool,
    bright_cap_state: f32,
    channel: u32,
}

impl Preamp {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            stages: vec![
                TriodeStage::new(sample_rate),
                TriodeStage::new(sample_rate),
                TriodeStage::new(sample_rate),
            ],
            gain: 5.0,
            bright: false,
            bright_cap_state: 0.0,
            channel: 1,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "gain" => self.gain = value,
            "bright" => self.bright = value > 0.5,
            "channel" => self.channel = value as u32,
            _ => {
                for stage in &mut self.stages {
                    stage.set_param(name, value);
                }
            }
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        let gain_scale = self.gain / 10.0;

        // Number of active stages depends on channel
        let num_stages = match self.channel {
            0 => 1, // clean
            1 => 2, // crunch
            _ => 3, // lead
        };

        let mut signal = input * gain_scale;

        // Bright cap: high-frequency boost at low gain
        if self.bright {
            let hp = signal - self.bright_cap_state;
            self.bright_cap_state += (signal - self.bright_cap_state) * 0.05;
            signal += hp * (1.0 - gain_scale) * 0.3;
        }

        for i in 0..num_stages.min(self.stages.len()) {
            signal = self.stages[i].process_sample(signal);
        }

        signal
    }

    pub fn reset(&mut self) {
        for stage in &mut self.stages {
            stage.reset();
        }
        self.bright_cap_state = 0.0;
    }
}
