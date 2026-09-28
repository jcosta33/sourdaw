//! 12AX7 Preamp Triode Model — Norman Koren phenomenological model.
//!
//! Includes grid conduction, coupling-capacitor blocking distortion,
//! and dynamic Miller capacitance.
//!
//! E₁ = (Vpk/Kp) · ln[1 + exp(Kp · (1/μ + (Vgk + Vct)/√(Kvb + Vpk²)))]
//! Ip = (E₁^Ex / Kg) · (1 + sgn(E₁))

use super::oversample::StageOversampler2x;
use crate::primitives::flush_denormal_f64;

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
    grid_conduction_amount: f64,
    coupling_cap_charge: f64,
    coupling_cap_tau: f64,
    oversampler: StageOversampler2x,

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
            grid_conduction_amount: 0.5,
            coupling_cap_charge: 0.0,
            coupling_cap_tau: 0.01, // 10ms RC time constant
            oversampler: StageOversampler2x::new(),
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
            "gridConduction" => self.grid_conduction_amount = value as f64,
            "couplingCapCharge" => {
                // Recovery length after grid-current charging.
                self.coupling_cap_tau = 0.003 + value as f64 * 0.060;
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
        let onset = 0.22 - self.grid_conduction_amount * 0.16;
        if vgk <= onset {
            0.0
        } else {
            let over = vgk - onset;
            let curvature = 3.5 + self.grid_conduction_amount * 8.5;
            let strength = 0.0012 + self.grid_conduction_amount * 0.0105;
            let shaped = 1.0 - (-over * curvature).exp();
            (over * shaped * strength).max(0.0)
        }
    }

    fn process_substep(&mut self, input_d: f64, dt: f64) -> f64 {
        // Grid voltage = input signal + bias + coupling cap charge offset
        let vgk = self.vgk + input_d * 50.0 + self.bias_offset - self.coupling_cap_charge;

        // Grid conduction
        let ig = self.grid_current_model(vgk);
        self.grid_current = ig;

        // Coupling cap charges from grid current, discharges through RC
        let charge_drive = 550.0 + self.grid_conduction_amount * 2_400.0;
        self.coupling_cap_charge +=
            dt * (ig * charge_drive - self.coupling_cap_charge / self.coupling_cap_tau);
        self.coupling_cap_charge = self.coupling_cap_charge.clamp(-5.0, 5.0);

        // Plate current
        let conduction_drop = ig * (420.0 + self.grid_conduction_amount * 980.0);
        let effective_vgk = vgk - conduction_drop;
        let vpk = self.plate_voltage;
        let ip = self.plate_current(effective_vgk, vpk);

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
        // DSP-2: Miller low-pass state trails `output` to zero on silence.
        self.miller_lp_state =
            flush_denormal_f64(output + miller_coeff * (self.miller_lp_state - output));

        self.miller_lp_state
    }

    /// Process a single sample through the triode stage.
    ///
    /// DSP-3: the ODE still takes two substeps per host sample, but the rate
    /// conversion around it is now a real half-band pair instead of linear
    /// interpolation up and a 2-tap box average down.
    pub fn process_sample(&mut self, input: f32) -> f32 {
        let (first_input, second_input) = self.oversampler.upsample(input);
        let substep_dt = 0.5 / self.sample_rate;

        let first = self.process_substep(first_input as f64, substep_dt);
        let second = self.process_substep(second_input as f64, substep_dt);

        self.oversampler.downsample(first as f32, second as f32)
    }

    pub fn reset(&mut self) {
        self.recompute_quiescent_plate_voltage();
        self.plate_voltage = self.quiescent_plate_voltage;
        self.coupling_cap_charge = 0.0;
        self.grid_current = 0.0;
        self.oversampler.reset();
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
    amp_model: AmpModel,
    model_drive_state: f32,
    bright_cap_state: f32,
    model_low_state: f32,
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
            amp_model: AmpModel::CrunchJcm,
            model_drive_state: 0.0,
            bright_cap_state: 0.0,
            model_low_state: 0.0,
            channel: 1,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "gain" => self.gain = value,
            "bright" => self.bright = value > 0.5,
            "ampModel" => self.amp_model = AmpModel::from_index(value as u32),
            "channel" => self.channel = value as u32,
            _ => {
                for stage in &mut self.stages {
                    stage.set_param(name, value);
                }
            }
        }
    }

    pub fn latency_samples(&self) -> f32 {
        let num_stages = match self.channel {
            0 => 1,
            1 => 2,
            _ => 3,
        };
        num_stages as f32 * StageOversampler2x::GROUP_DELAY_SAMPLES
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        let gain_scale = self.gain / 10.0;
        let (
            model_trim,
            interstage_attenuation,
            model_brightness,
            model_low_end,
            model_compression,
        ): (f32, f32, f32, f32, f32) = match self.amp_model {
            AmpModel::CleanTwin => (0.75, 0.18, 0.05, -0.04, 0.02),
            AmpModel::CrunchJcm => (1.00, 0.14, 0.00, 0.02, 0.08),
            AmpModel::LeadJcm => (1.14, 0.12, -0.01, -0.06, 0.10),
            AmpModel::Ac30TopBoost => (0.95, 0.15, 0.08, -0.03, 0.09),
            AmpModel::Rectifier => (0.94, 0.10, -0.13, 0.32, 0.84),
            AmpModel::Custom => (1.00, 0.12, 0.00, 0.00, 0.10),
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

        if model_compression > 0.0 {
            let dt = 1.0 / self.sample_rate;
            let env_coeff = (2.0 * std::f32::consts::PI * 85.0 * dt).min(0.22);
            self.model_drive_state += env_coeff * (signal.abs() - self.model_drive_state);
            let clamp = 1.0
                / (1.0
                    + self.model_drive_state * model_compression * (0.7 + gain_scale * 1.5) * 2.2);
            let compressed = signal * clamp;
            let soft_mix = (model_compression * 0.45).clamp(0.0, 0.22);
            let softened = (compressed * (1.0 + model_compression * 0.7)).tanh()
                * (0.98 - model_compression * 0.08);
            signal = compressed * (1.0 - soft_mix) + softened * soft_mix;
        }

        let mut final_out = 0.0;
        let stage_count = num_stages.min(self.stages.len());
        for i in 0..stage_count {
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

        if model_compression > 0.0 {
            let post_mix =
                (model_compression * (0.16 + self.model_drive_state * 0.22)).clamp(0.0, 0.30);
            let post_shaped = (final_out * (1.0 + model_compression * 0.9)).tanh()
                * (0.96 - model_compression * 0.06);
            final_out = final_out * (1.0 - post_mix) + post_shaped * post_mix;
        }

        // DSP-10: `model_low_end` voices the cascade output, not the cascade
        // input. Lifted before the stages, high-gain grid clamping absorbs the
        // boost and every model comes out with the same low band. Applied
        // after the oversampled nonlinearity it survives, as a first-order
        // tilt around 180 Hz: the low band gains (1 + model_low_end), the
        // upper band loses model_low_end against a 2.3:1 scoop — the
        // high-gain voice trades edge for body. Positive values fatten the
        // lows and darken the top (Rectifier); negative values tighten the
        // lows and chime the top (Lead JCM, Clean Twin, AC30).
        if model_low_end.abs() > 0.01 {
            let dt = 1.0 / self.sample_rate;
            let low_coeff = (2.0 * std::f32::consts::PI * 180.0 * dt).min(0.35);
            self.model_low_state += low_coeff * (final_out - self.model_low_state);
            let low_band = self.model_low_state;
            let upper_band = final_out - low_band;
            final_out += (low_band - upper_band * 2.3) * model_low_end;
        }

        final_out
    }

    pub fn reset(&mut self) {
        for stage in &mut self.stages {
            stage.reset();
        }
        self.model_drive_state = 0.0;
        self.bright_cap_state = 0.0;
        self.model_low_state = 0.0;
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

    fn average_abs_output_for_sample_rate(sample_rate: f32) -> f32 {
        let mut preamp = Preamp::new(sample_rate);
        preamp.set_param("ampModel", 4.0);
        preamp.set_param("channel", 2.0);
        preamp.set_param("gain", 8.4);
        preamp.set_param("fat", 1.0);
        preamp.set_param("tubeBias", 0.56);
        preamp.set_param("millerCapacitance", 0.58);

        let total = 4096;
        let mut sum = 0.0_f32;
        for n in 0..total {
            let phase = (n as f32 * 2.0 * std::f32::consts::PI * 1_750.0) / sample_rate;
            let sample = phase.sin() * 0.16;
            let out = preamp.process_sample(sample);
            assert!(out.is_finite(), "preamp output should remain finite");
            sum += out.abs();
        }

        sum / total as f32
    }

    fn burst_metrics_for_preamp(grid_conduction: f32, coupling_cap_charge: f32) -> (f32, f32) {
        let sample_rate = 48_000.0;
        let mut preamp = Preamp::new(sample_rate);
        preamp.set_param("ampModel", 4.0);
        preamp.set_param("channel", 2.0);
        preamp.set_param("gain", 8.8);
        preamp.set_param("fat", 1.0);
        preamp.set_param("tubeBias", 0.58);
        preamp.set_param("millerCapacitance", 0.62);
        preamp.set_param("gridConduction", grid_conduction);
        preamp.set_param("couplingCapCharge", coupling_cap_charge);

        let total = 2048;
        let burst_len = 320;
        let mut attack_peak = 0.0_f32;
        let mut tail_sum = 0.0_f32;
        let mut tail_count = 0_usize;

        for n in 0..total {
            let sample = if n < burst_len {
                let fundamental =
                    ((n as f32 * 2.0 * std::f32::consts::PI * 140.0) / sample_rate).sin() * 0.20;
                let edge =
                    ((n as f32 * 2.0 * std::f32::consts::PI * 1_950.0) / sample_rate).sin() * 0.10;
                (fundamental + edge) * 1.6
            } else {
                0.0
            };

            let out = preamp.process_sample(sample);
            if n < 120 {
                attack_peak = attack_peak.max(out.abs());
            }
            if (480..1200).contains(&n) {
                tail_sum += out.abs();
                tail_count += 1;
            }
        }

        let tail_avg = tail_sum / tail_count.max(1) as f32;
        (attack_peak, tail_avg)
    }

    /// Returns `(low_band_body, edge)` for a palm-muted burst: `body` is the
    /// summed 220 Hz low-pass magnitude, `edge` the summed envelope of what is
    /// left above it.
    fn body_and_edge_for_amp_model(amp_model: f32) -> (f32, f32) {
        let sample_rate = 48_000.0;
        let mut preamp = Preamp::new(sample_rate);
        preamp.set_param("ampModel", amp_model);
        preamp.set_param("channel", 2.0);
        preamp.set_param("gain", 8.2);
        preamp.set_param("tubeBias", 0.56);
        preamp.set_param("gridConduction", 0.62);
        preamp.set_param("couplingCapCharge", 0.70);

        let total = 4096;
        let burst_len = 1024;
        let mut low_state = 0.0_f32;
        let mut edge_state = 0.0_f32;
        let mut body_sum = 0.0_f32;
        let mut edge_sum = 0.0_f32;

        for n in 0..total {
            let env = if n < burst_len { 1.0 } else { 0.0 };
            let low = ((n as f32 * 2.0 * std::f32::consts::PI * 130.0) / sample_rate).sin() * 0.22;
            let pick =
                ((n as f32 * 2.0 * std::f32::consts::PI * 1_850.0) / sample_rate).sin() * 0.08;
            let input = (low + pick) * env;
            let out = preamp.process_sample(input);

            let low_coeff = (2.0 * std::f32::consts::PI * 220.0 / sample_rate).min(0.25);
            low_state += low_coeff * (out - low_state);
            let edge = out - low_state;
            edge_state += 0.04 * (edge.abs() - edge_state);

            if (256..1400).contains(&n) {
                body_sum += low_state.abs();
                edge_sum += edge_state;
            }
        }

        (body_sum, edge_sum)
    }

    /// Returns `(low_band_peak, low_band_sustain)` for the high-gain burst:
    /// the peak of a 150 Hz low-passed output during the attack and its
    /// average over the sustain window — the band a palm-mute chug lives in.
    fn low_band_density_for_amp_model(amp_model: f32) -> (f32, f32) {
        let sample_rate = 48_000.0;
        let mut preamp = Preamp::new(sample_rate);
        preamp.set_param("ampModel", amp_model);
        preamp.set_param("channel", 2.0);
        preamp.set_param("gain", 8.6);
        preamp.set_param("gridConduction", 0.60);
        preamp.set_param("couplingCapCharge", 0.72);
        preamp.set_param("tubeBias", 0.56);

        let total = 2048;
        let mut low_state = 0.0_f32;
        let mut peak = 0.0_f32;
        let mut sustain_sum = 0.0_f32;
        let mut sustain_count = 0_usize;
        for n in 0..total {
            let env = if n < 384 { 1.0 } else { 0.0 };
            let low = ((n as f32 * 2.0 * std::f32::consts::PI * 120.0) / sample_rate).sin() * 0.24;
            let edge =
                ((n as f32 * 2.0 * std::f32::consts::PI * 1_600.0) / sample_rate).sin() * 0.09;
            let out = preamp.process_sample((low + edge) * env);
            let low_coeff = (2.0 * std::f32::consts::PI * 150.0 / sample_rate).min(0.3);
            low_state += low_coeff * (out - low_state);
            if n < 192 {
                peak = peak.max(low_state.abs());
            }
            if (192..640).contains(&n) {
                sustain_sum += low_state.abs();
                sustain_count += 1;
            }
        }

        (peak, sustain_sum / sustain_count.max(1) as f32)
    }

    fn decay_edge_ratios_for_preamp(amp_model: f32) -> (f32, f32) {
        let sample_rate = 48_000.0;
        let mut preamp = Preamp::new(sample_rate);
        preamp.set_param("ampModel", amp_model);
        preamp.set_param("channel", 2.0);
        preamp.set_param("gain", 8.9);
        preamp.set_param("fat", 1.0);
        preamp.set_param("tubeBias", 0.58);
        preamp.set_param("gridConduction", 0.70);
        preamp.set_param("couplingCapCharge", 0.82);
        preamp.set_param("millerCapacitance", 0.68);

        let total = 3072;
        let burst_len = 640;
        let mut low_state = 0.0_f32;
        let mut sustain_body = 0.0_f32;
        let mut sustain_edge = 0.0_f32;
        let mut tail_body = 0.0_f32;
        let mut tail_edge = 0.0_f32;
        let mut sustain_count = 0_usize;
        let mut tail_count = 0_usize;

        for n in 0..total {
            let input = if n < burst_len {
                let low =
                    ((n as f32 * 2.0 * std::f32::consts::PI * 130.0) / sample_rate).sin() * 0.24;
                let edge =
                    ((n as f32 * 2.0 * std::f32::consts::PI * 2_100.0) / sample_rate).sin() * 0.11;
                (low + edge) * 1.7
            } else {
                0.0
            };

            let out = preamp.process_sample(input);
            let low_coeff = (2.0 * std::f32::consts::PI * 260.0 / sample_rate).min(0.3);
            low_state += low_coeff * (out - low_state);
            let edge = out - low_state;

            if (224..640).contains(&n) {
                sustain_body += low_state.abs();
                sustain_edge += edge.abs();
                sustain_count += 1;
            } else if (896..1664).contains(&n) {
                tail_body += low_state.abs();
                tail_edge += edge.abs();
                tail_count += 1;
            }
        }

        let sustain_ratio = (sustain_edge / sustain_count.max(1) as f32)
            / (sustain_body / sustain_count.max(1) as f32).max(1.0e-6);
        let tail_ratio = (tail_edge / tail_count.max(1) as f32)
            / (tail_body / tail_count.max(1) as f32).max(1.0e-6);
        (sustain_ratio, tail_ratio)
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
    fn amp_model_changes_the_preamp_voice() {
        let total = 4096;

        let mut clean = Preamp::new(48_000.0);
        clean.set_param("ampModel", 0.0);
        clean.set_param("gain", 5.0);

        let mut recto = Preamp::new(48_000.0);
        recto.set_param("ampModel", 4.0);
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
            "amp models should audibly change preamp voicing, got diff {average_diff}"
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

    #[test]
    fn high_gain_preamp_is_reasonably_sample_rate_stable() {
        let output_48k = average_abs_output_for_sample_rate(48_000.0);
        let output_96k = average_abs_output_for_sample_rate(96_000.0);
        let relative_delta = (output_48k - output_96k).abs() / output_96k.max(1.0e-6);

        assert!(
            relative_delta <= 0.12,
            "high-gain preamp should stay reasonably stable across sample rates (48k={output_48k}, 96k={output_96k}, delta={relative_delta})"
        );
    }

    #[test]
    fn grid_conduction_changes_hard_attack_clamping() {
        let (low_peak, _) = burst_metrics_for_preamp(0.0, 0.55);
        let (high_peak, _) = burst_metrics_for_preamp(1.0, 0.55);
        let peak_delta = (low_peak - high_peak).abs();

        assert!(
            peak_delta > 1.5e-2,
            "grid conduction should audibly change hard-attack clamping (low={low_peak}, high={high_peak}, delta={peak_delta})"
        );
    }

    #[test]
    fn coupling_cap_charge_changes_recovery_tail() {
        let (_, short_tail) = burst_metrics_for_preamp(0.55, 0.1);
        let (_, long_tail) = burst_metrics_for_preamp(0.55, 0.95);
        let tail_delta = (short_tail - long_tail).abs();

        assert!(
            tail_delta > 2.0e-3,
            "coupling-cap charge should audibly change blocking recovery (short={short_tail}, long={long_tail}, delta={tail_delta})"
        );
    }

    /// DSP-10: `model_low_end` must deliver the low-band separation it names,
    /// asserted as a measurable ordering per ADR 0022.
    ///
    /// Rectifier sets `model_low_end` 0.32 against Lead JCM's -0.06 (see the
    /// per-model table in `Preamp::process_sample`), so Rectifier must come out
    /// measurably fatter in the low band and Lead JCM must keep at least
    /// Rectifier's share of content above 220 Hz.
    ///
    /// History: an earlier version of this test asserted
    /// `rectifier_balance - lead_balance > 0.14` and passed — but it passed on
    /// aliasing. Before DSP-3 replaced Grinder's 2-tap box-average
    /// "oversampling" with a real half-band FIR, fold-back from the high-order
    /// harmonics landed below 220 Hz and was counted as body. With the FIR in
    /// place the models tied and the surviving edge difference ran backward,
    /// because the lift acted *before* the cascade where high-gain grid
    /// clamping absorbs it. Measured on this exact fixture, before the retune:
    ///
    /// | model     | body  | edge  |
    /// |-----------|-------|-------|
    /// | Lead JCM  | 387.2 | 192.3 |
    /// | Rectifier | 386.3 | 212.5 |
    ///
    /// The fix voices the cascade output: a first-order tilt around 180 Hz
    /// driven by `model_low_end`, lifting the low band by
    /// (1 + model_low_end) against a 2.3:1 scoop of the upper band. With the
    /// parameter live, Lead JCM's inert-era 0.05 no longer matched its named
    /// edge-forward voice and was retuned to -0.06. Measured on this exact
    /// fixture after the retune:
    ///
    /// | model     | body  | edge  | body ratio |
    /// |-----------|-------|-------|------------|
    /// | Lead JCM  | 400.1 | 211.9 | 1.00       |
    /// | Rectifier | 441.3 | 182.2 | 1.103      |
    #[test]
    fn rectifier_low_band_body_exceeds_lead_jcm_on_the_oversampled_path() {
        let (lead_body, lead_edge) = body_and_edge_for_amp_model(2.0);
        let (rectifier_body, rectifier_edge) = body_and_edge_for_amp_model(4.0);

        assert!(
            lead_body > 100.0 && rectifier_body > 100.0,
            "both models must actually produce low-band output, or the \
             comparison below is vacuous (lead={lead_body}, rectifier={rectifier_body})"
        );

        let body_ratio = rectifier_body / lead_body;
        let edge_slack = (lead_edge - rectifier_edge) / lead_edge;
        println!(
            "measured: lead body={lead_body} edge={lead_edge}, rectifier \
             body={rectifier_body} edge={rectifier_edge}, body ratio={body_ratio}, \
             edge slack={edge_slack}"
        );

        assert!(
            body_ratio > 1.06,
            "Rectifier's model_low_end (0.32 vs Lead JCM's -0.06) must buy at \
             least a 6% low-band body margin on the oversampled path — below \
             that the voicing has stopped separating the models \
             (lead={lead_body}, rectifier={rectifier_body}, ratio={body_ratio})"
        );

        assert!(
            lead_edge >= rectifier_edge,
            "Lead JCM should keep at least Rectifier's content above 220 Hz — \
             the Rectifier's voicing spends its energy in the low band \
             (lead={lead_edge}, rectifier={rectifier_edge}, slack={edge_slack})"
        );
    }

    /// The Rectifier chug: under the same high-gain burst its low band must
    /// sustain denser (lower peak-to-sustain ratio) than Lead JCM's.
    ///
    /// The density is measured on the low band — a 150 Hz low-pass of the
    /// output — because that is the band a palm-mute chug lives in, and the
    /// DSP-10 output voicing deliberately adds low-band body to the attack
    /// kick, which would otherwise inflate the raw wideband peak and bury the
    /// density ordering the subject names.
    #[test]
    fn rectifier_preamp_has_lower_peak_to_sustain_ratio_than_lead_jcm() {
        let (lead_peak, lead_sustain) = low_band_density_for_amp_model(2.0);
        let (rectifier_peak, rectifier_sustain) = low_band_density_for_amp_model(4.0);
        let lead_ratio = lead_peak / lead_sustain.max(1.0e-6);
        let rectifier_ratio = rectifier_peak / rectifier_sustain.max(1.0e-6);

        assert!(
            rectifier_ratio + 0.02 < lead_ratio,
            "rectifier preamp should sustain more densely than lead JCM under the same high-gain burst (lead_ratio={lead_ratio}, rectifier_ratio={rectifier_ratio}, lead_peak={lead_peak}, lead_sustain={lead_sustain}, rectifier_peak={rectifier_peak}, rectifier_sustain={rectifier_sustain})"
        );
    }

    #[test]
    fn extreme_gain_preamp_decay_smooths_after_the_attack() {
        let (sustain_ratio, tail_ratio) = decay_edge_ratios_for_preamp(4.0);

        assert!(
            tail_ratio + 0.12 < sustain_ratio,
            "extreme-gain preamp decay should get less edge-heavy after the attack (sustain_ratio={sustain_ratio}, tail_ratio={tail_ratio})"
        );
    }

    #[test]
    fn tube_bias_audibly_changes_the_preamp_response() {
        let total = 4096;

        let mut cold = Preamp::new(48_000.0);
        cold.set_param("ampModel", 2.0);
        cold.set_param("channel", 2.0);
        cold.set_param("gain", 7.2);
        cold.set_param("tubeBias", 0.2);

        let mut hot = Preamp::new(48_000.0);
        hot.set_param("ampModel", 2.0);
        hot.set_param("channel", 2.0);
        hot.set_param("gain", 7.2);
        hot.set_param("tubeBias", 0.8);

        let mut diff_sum = 0.0_f32;
        for n in 0..total {
            let low = ((n as f32 * 2.0 * std::f32::consts::PI * 130.0) / 48_000.0).sin() * 0.11;
            let high = ((n as f32 * 2.0 * std::f32::consts::PI * 1_300.0) / 48_000.0).sin() * 0.05;
            let sample = low + high;
            let cold_out = cold.process_sample(sample);
            let hot_out = hot.process_sample(sample);
            diff_sum += (cold_out - hot_out).abs();
        }

        let average_diff = diff_sum / total as f32;
        assert!(
            average_diff > 5.0e-3,
            "tube bias should audibly change the preamp response, got diff {average_diff}"
        );
    }

    #[test]
    fn preamp_latency_tracks_channel_stage_count() {
        let mut preamp = Preamp::new(48_000.0);

        preamp.set_param("channel", 0.0);
        assert_eq!(preamp.latency_samples(), 6.5);

        preamp.set_param("channel", 1.0);
        assert_eq!(preamp.latency_samples(), 13.0);

        preamp.set_param("channel", 2.0);
        assert_eq!(preamp.latency_samples(), 19.5);
    }
}
