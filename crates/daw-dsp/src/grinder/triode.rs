//! 12AX7 Preamp Triode Model — Norman Koren phenomenological model.
//!
//! Includes grid conduction, coupling-capacitor blocking distortion,
//! and dynamic Miller capacitance.
//!
//! E₁ = (Vpk/Kp) · ln[1 + exp(Kp · (1/μ + (Vgk + Vct)/√(Kvb + Vpk²)))]
//! Ip = (E₁^Ex / Kg) · (1 + sgn(E₁))

#[derive(Clone, Copy)]
enum AmpModel {
    CleanTwin,
    CrunchJcm,
    LeadJcm,
    Ac30TopBoost,
    Rectifier,
    Custom,
}

impl AmpModel {
    fn from_index(index: u32) -> Self {
        match index {
            0 => Self::CleanTwin,
            1 => Self::CrunchJcm,
            2 => Self::LeadJcm,
            3 => Self::Ac30TopBoost,
            4 => Self::Rectifier,
            _ => Self::Custom,
        }
    }
}

/// Koren model parameters for a tube type.
#[derive(Clone)]
pub struct TubeParams {
    pub mu: f64,  // amplification factor
    pub ex: f64,  // transfer curve exponent
    pub kg: f64,  // plate current scaling
    pub kp: f64,  // plate voltage scaling
    pub kvb: f64, // breakdown voltage parameter
    pub vct: f64, // contact potential offset
}

impl TubeParams {
    /// Default 12AX7 parameters.
    pub fn ax7() -> Self {
        Self {
            mu: 100.0,
            ex: 1.4,
            kg: 1060.0,
            kp: 600.0,
            kvb: 300.0,
            vct: 0.5,
        }
    }
}

/// Single triode gain stage with grid conduction and coupling cap.
#[allow(dead_code)]
pub struct TriodeStage {
    params: TubeParams,

    // Operating point
    vgk: f64,
    vpk: f64,
    plate_voltage: f64,
    quiescent_plate_voltage: f64,
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
        let mut stage = Self {
            params: TubeParams::ax7(),
            vgk: -2.0,
            vpk: 200.0,
            plate_voltage: 200.0,
            quiescent_plate_voltage: 200.0,
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
        };
        stage.recompute_quiescent_plate_voltage();
        stage.plate_voltage = stage.quiescent_plate_voltage;
        stage
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "tubeBias" => {
                self.bias_offset = (value as f64 - 0.5) * 4.0;
                self.recompute_quiescent_plate_voltage();
            }
            "tubeAge" => {
                self.age_factor = value as f64;
                self.recompute_quiescent_plate_voltage();
            }
            "millerCapacitance" => self.miller_cap_factor = value as f64,
            "gridConduction" => self.coupling_cap_tau = 0.001 + value as f64 * 0.05,
            "couplingCapCharge" => {
                // Scale the coupling cap RC time constant
                self.coupling_cap_tau = 0.005 + value as f64 * 0.04;
            }
            _ => {}
        }
    }

    fn recompute_quiescent_plate_voltage(&mut self) {
        let mut vpk = self.supply_voltage * 0.67;
        let vgk = self.vgk + self.bias_offset;

        for _ in 0..32 {
            let ip = self.plate_current(vgk, vpk);
            let target =
                (self.supply_voltage - ip * self.plate_resistor).clamp(0.0, self.supply_voltage);
            vpk += (target - vpk) * 0.25;
        }

        self.quiescent_plate_voltage = vpk;
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
        let vgk = self.vgk + input_d * 50.0 + self.bias_offset - self.coupling_cap_charge;

        // Grid conduction
        let ig = self.grid_current_model(vgk);
        self.grid_current = ig;

        // Coupling cap charges from grid current, discharges through RC
        self.coupling_cap_charge +=
            dt * (ig * 1000.0 - self.coupling_cap_charge / self.coupling_cap_tau);
        self.coupling_cap_charge = self.coupling_cap_charge.clamp(-5.0, 5.0);

        // Plate current
        let vpk = self.plate_voltage;
        let ip = self.plate_current(vgk, vpk);

        // Update plate voltage: V_plate = V_supply - Ip * R_plate
        let target_plate_voltage =
            (self.supply_voltage - ip * self.plate_resistor).clamp(0.0, self.supply_voltage);
        let plate_tau = 1.0e-4;
        let plate_coeff = 1.0 - (-dt / plate_tau).exp();
        self.plate_voltage += (target_plate_voltage - self.plate_voltage) * plate_coeff;

        // Output = inverted plate voltage swing, normalized
        let output =
            (self.plate_voltage - self.quiescent_plate_voltage) / (self.supply_voltage * 0.5);

        // Miller capacitance: dynamic low-pass that depends on stage gain
        let stage_gain = (ip * self.plate_resistor / self.supply_voltage)
            .abs()
            .clamp(0.0, 10.0);
        let miller_freq = 20000.0 / (1.0 + self.miller_cap_factor * stage_gain * 2.0);
        let miller_coeff = (-2.0 * std::f64::consts::PI * miller_freq * dt).exp();
        self.miller_lp_state = output + miller_coeff * (self.miller_lp_state - output);

        self.miller_lp_state as f32
    }

    pub fn reset(&mut self) {
        self.recompute_quiescent_plate_voltage();
        self.plate_voltage = self.quiescent_plate_voltage;
        self.coupling_cap_charge = 0.0;
        self.grid_current = 0.0;
        self.miller_lp_state = 0.0;
    }
}

/// Multi-stage preamp (typically 3-4 cascaded triode stages for high-gain amps).
pub struct Preamp {
    stages: Vec<TriodeStage>,
    dc_x: Vec<f32>,
    dc_y: Vec<f32>,
    dc_initialized: bool,
    gain: f32,
    bright: bool,
    fat: bool,
    amp_model: AmpModel,
    bright_cap_state: f32,
    fat_low_state: f32,
    channel: u32,
    sample_rate: f32,
}

impl Preamp {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            stages: vec![
                TriodeStage::new(sample_rate),
                TriodeStage::new(sample_rate),
                TriodeStage::new(sample_rate),
            ],
            dc_x: vec![0.0; 3],
            dc_y: vec![0.0; 3],
            dc_initialized: false,
            gain: 5.0,
            bright: false,
            fat: false,
            amp_model: AmpModel::CrunchJcm,
            bright_cap_state: 0.0,
            fat_low_state: 0.0,
            channel: 1,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "gain" => self.gain = value,
            "bright" => self.bright = value > 0.5,
            "fat" => self.fat = value > 0.5,
            "ampModel" => self.amp_model = AmpModel::from_index(value as u32),
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
        let (model_trim, interstage_attenuation, model_brightness, model_low_end): (
            f32,
            f32,
            f32,
            f32,
        ) = match self.amp_model {
            AmpModel::CleanTwin => (0.75, 0.18, 0.05, -0.04),
            AmpModel::CrunchJcm => (1.00, 0.14, 0.00, 0.02),
            AmpModel::LeadJcm => (1.15, 0.12, -0.02, 0.05),
            AmpModel::Ac30TopBoost => (0.95, 0.15, 0.08, -0.03),
            AmpModel::Rectifier => (1.30, 0.10, -0.08, 0.10),
            AmpModel::Custom => (1.00, 0.12, 0.00, 0.00),
        };

        // Number of active stages depends on channel
        let num_stages = match self.channel {
            0 => 1, // clean
            1 => 2, // crunch
            _ => 3, // lead
        };

        let mut signal = input * gain_scale * model_trim;

        // Bright voicing: a narrower, smoother top-end lift that stays polite
        // on hard pick transients instead of acting like a click enhancer.
        if self.bright || model_brightness.abs() > 0.01 {
            let dt = 1.0 / self.sample_rate;
            let bright_cutoff_hz = match self.amp_model {
                AmpModel::CleanTwin => 1_900.0,
                AmpModel::CrunchJcm => 2_100.0,
                AmpModel::LeadJcm => 2_300.0,
                AmpModel::Ac30TopBoost => 2_600.0,
                AmpModel::Rectifier => 2_400.0,
                AmpModel::Custom => 2_100.0,
            };
            let bright_coeff = (2.0 * std::f32::consts::PI * bright_cutoff_hz * dt).min(0.22);
            self.bright_cap_state += (signal - self.bright_cap_state) * bright_coeff;
            let hp = signal - self.bright_cap_state;
            let switch_amount = if self.bright { 0.045 } else { 0.0 };
            let channel_trim = match self.channel {
                0 => 1.0,
                1 => 0.72,
                _ => 0.42,
            };
            let bright_amount = ((1.0 - gain_scale) * 0.14 + model_brightness + switch_amount)
                .max(0.0)
                * channel_trim;
            signal += hp * bright_amount;
        }

        if self.fat || model_low_end.abs() > 0.01 {
            let dt = 1.0 / self.sample_rate;
            let low_coeff = (2.0 * std::f32::consts::PI * 180.0 * dt).min(0.35);
            self.fat_low_state += low_coeff * (signal - self.fat_low_state);
            let fat_amount = (if self.fat { 0.22 } else { 0.0 }) + model_low_end;
            signal += self.fat_low_state * fat_amount;
        }

        let mut final_out = 0.0;
        for i in 0..num_stages.min(self.stages.len()) {
            let out = self.stages[i].process_sample(signal);

            if !self.dc_initialized {
                self.dc_x[i] = out;
                self.dc_y[i] = 0.0;
                final_out = 0.0;
                signal = 0.0;
                continue;
            }

            // Simulate the coupling capacitor between gain stages so later stages
            // do not get driven into a DC-biased cut-off state.
            let r = 0.999;
            let dc_out = out - self.dc_x[i] + r * self.dc_y[i];
            self.dc_x[i] = out;
            self.dc_y[i] = dc_out;

            final_out = dc_out;

            // A real inter-stage network attenuates the previous plate swing
            // before it hits the next grid. Without this divider, crunch/lead
            // channels collapse because every later stage sees an unrealistically
            // huge grid excursion.
            signal = dc_out * interstage_attenuation;
        }

        if !self.dc_initialized {
            self.dc_initialized = true;
            return 0.0;
        }

        final_out
    }

    pub fn reset(&mut self) {
        for stage in &mut self.stages {
            stage.reset();
        }
        self.bright_cap_state = 0.0;
        self.fat_low_state = 0.0;
        self.dc_x.fill(0.0);
        self.dc_y.fill(0.0);
        self.dc_initialized = false;
    }
}

#[cfg(test)]
mod tests {
    use super::Preamp;

    fn average_abs_output(channel: u32) -> f32 {
        let mut preamp = Preamp::new(48_000.0);
        preamp.set_param("channel", channel as f32);
        preamp.set_param("gain", 6.0);

        let mut sum = 0.0_f32;
        let total = 2048;

        for n in 0..total {
            let phase = (n as f32 * 2.0 * std::f32::consts::PI * 220.0) / 48_000.0;
            let sample = phase.sin() * 0.1;
            let out = preamp.process_sample(sample);
            assert!(out.is_finite(), "preamp output should remain finite");
            sum += out.abs();
        }

        sum / total as f32
    }

    #[test]
    fn crunch_channel_produces_audible_output() {
        assert!(average_abs_output(1) > 1.0e-3);
    }

    #[test]
    fn lead_channel_produces_audible_output() {
        assert!(average_abs_output(2) > 1.0e-3);
    }

    #[test]
    fn amp_model_and_fat_change_the_preamp_voice() {
        let total = 4096;

        let mut clean = Preamp::new(48_000.0);
        clean.set_param("ampModel", 0.0);
        clean.set_param("gain", 5.0);

        let mut recto = Preamp::new(48_000.0);
        recto.set_param("ampModel", 4.0);
        recto.set_param("fat", 1.0);
        recto.set_param("gain", 5.0);

        let mut diff_sum = 0.0_f32;
        for n in 0..total {
            let phase = (n as f32 * 2.0 * std::f32::consts::PI * 110.0) / 48_000.0;
            let sample = phase.sin() * 0.12;
            let clean_out = clean.process_sample(sample);
            let recto_out = recto.process_sample(sample);
            diff_sum += (clean_out - recto_out).abs();
        }

        let average_diff = diff_sum / total as f32;
        assert!(
            average_diff > 1.0e-3,
            "amp model and fat controls should audibly change preamp voicing, got diff {average_diff}"
        );
    }

    #[test]
    fn clean_twin_bright_voicing_stays_polite_on_pick_transients() {
        let mut neutral = Preamp::new(48_000.0);
        neutral.set_param("ampModel", 0.0);
        neutral.set_param("channel", 2.0);
        neutral.set_param("gain", 4.5);

        let mut bright = Preamp::new(48_000.0);
        bright.set_param("ampModel", 0.0);
        bright.set_param("channel", 2.0);
        bright.set_param("gain", 4.5);
        bright.set_param("bright", 1.0);

        let total = 2048;
        let mut neutral_peak = 0.0_f32;
        let mut bright_peak = 0.0_f32;

        for n in 0..total {
            let env = (-3.8 * n as f32 / total as f32).exp();
            let sample =
                ((n as f32 * 2.0 * std::f32::consts::PI * 220.0) / 48_000.0).sin() * 0.18 * env;
            neutral_peak = neutral_peak.max(neutral.process_sample(sample).abs());
            bright_peak = bright_peak.max(bright.process_sample(sample).abs());
        }

        assert!(
            bright_peak < neutral_peak * 1.45,
            "bright voicing should add bite without spiky transient clicks (neutral={neutral_peak}, bright={bright_peak})"
        );
    }
}
