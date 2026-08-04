//! Power amplifier modeling with sag, transformer saturation, and push-pull dynamics.
//!
//! dV_B+/dt = (V_nominal - V_B+) / τ_sag - k·|x(t)|

use super::oversample::StageOversampler2x;
use crate::primitives::flush_denormal;

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
    base_sag_amount: f32,
    base_sag_tau: f32,
    oversampler: StageOversampler2x,

    // Push-pull state
    bias: f32,
    neg_feedback: f32,
    presence: f32,
    resonance: f32,
    feedback_state: f32,
    feedback_low_state: f32,
    load_envelope: f32,
    recovery_envelope: f32,
    output_low_state: f32,
    meter_decay_coeff: f32,

    // Metering
    peak_level: f32,
}

impl PowerAmp {
    pub fn new(sample_rate: f32) -> Self {
        let mut amp = Self {
            sample_rate,
            tube_type: PowerTubeType::TypeEL34,
            rectifier_type: RectifierType::Tube,
            master: 0.5,
            vb_plus: 1.0,
            v_nominal: 1.0,
            sag_amount: 0.4,
            sag_tau: 0.2,
            base_sag_amount: 0.4,
            base_sag_tau: 0.2,
            oversampler: StageOversampler2x::new(),
            bias: 0.5,
            neg_feedback: 0.5,
            presence: 0.5,
            resonance: 0.5,
            feedback_state: 0.0,
            feedback_low_state: 0.0,
            load_envelope: 0.0,
            recovery_envelope: 0.0,
            output_low_state: 0.0,
            meter_decay_coeff: (-1.0 / (sample_rate * 0.150)).exp(),
            peak_level: 0.0,
        };
        amp.update_rectifier_params();
        amp
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "master" => self.master = value / 10.0,
            "powerTubeType" => self.tube_type = PowerTubeType::from_index(value as u32),
            "rectifierType" => {
                self.rectifier_type = RectifierType::from_index(value as u32);
                self.update_rectifier_params();
            }
            "sagAmount" => {
                self.base_sag_amount = value;
                self.update_rectifier_params();
            }
            "sagRecovery" => {
                self.base_sag_tau = value * 0.001; // ms to seconds
                self.update_rectifier_params();
            }
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
                self.v_nominal = 1.0;
                self.sag_amount = self.base_sag_amount * 2.8;
                self.sag_tau = self.base_sag_tau * 1.75;
            }
            RectifierType::SolidState => {
                self.v_nominal = 1.0;
                self.sag_amount = self.base_sag_amount * 0.65;
                self.sag_tau = self.base_sag_tau * 0.40;
            }
            RectifierType::Variac => {
                self.v_nominal = 0.76;
                self.sag_amount = self.base_sag_amount * 3.5;
                self.sag_tau = self.base_sag_tau * 2.10;
            }
        }
        self.vb_plus = self.vb_plus.min(self.v_nominal);
    }

    fn process_substep(&mut self, input: f32, dt: f32) -> f32 {
        // Apply master volume
        let master_drive = 0.15 + self.master * 1.85;
        let driven = input * master_drive;

        // Presence/resonance shape the negative-feedback loop by reducing
        // feedback in the high and low bands respectively.
        let feedback_low_coeff = (2.0 * std::f32::consts::PI * 180.0 * dt).min(0.35);
        self.feedback_low_state = flush_denormal(
            self.feedback_low_state
                + feedback_low_coeff * (self.feedback_state - self.feedback_low_state),
        );
        let feedback_low = self.feedback_low_state;
        let feedback_high = self.feedback_state - feedback_low;
        let low_feedback = feedback_low * (1.0 - self.resonance * 0.75);
        let high_feedback = feedback_high * (1.0 - self.presence * 0.75);
        let shaped_feedback = low_feedback + high_feedback;
        let with_nfb = driven - shaped_feedback * self.neg_feedback * 0.3;

        // Power supply sag: dV_B+/dt = (V_nominal - V_B+)/τ_sag - k·|x(t)|
        let load = with_nfb.abs() * (0.8 + master_drive * 1.15);
        let load_attack = match self.rectifier_type {
            RectifierType::Tube => 0.012,
            RectifierType::SolidState => 0.004,
            RectifierType::Variac => 0.016,
        };
        let load_coeff = 1.0 - (-dt / load_attack).exp();
        self.load_envelope += (load - self.load_envelope) * load_coeff;
        let sag_rate = (self.v_nominal - self.vb_plus) / self.sag_tau.max(0.001)
            - self.sag_amount * self.load_envelope * 3.2;
        self.vb_plus += dt * sag_rate;
        self.vb_plus = self.vb_plus.clamp(0.3, self.v_nominal);

        // Power tube nonlinearity depends on tube type
        let headroom = self.vb_plus;
        let (saturation_curve, asymmetry) = match self.tube_type {
            PowerTubeType::Type6L6 => (0.8, 0.05),  // Clean, tight
            PowerTubeType::TypeEL34 => (0.6, 0.12), // Midrange growl
            PowerTubeType::TypeEL84 => (0.4, 0.18), // Early compression
        };

        // Push-pull saturation with bias-dependent crossover and headroom.
        let bias_shift = (self.bias - 0.5) * 2.0;
        let bias_headroom = (1.0 - bias_shift * 0.10).clamp(0.82, 1.18);
        let crossover_width = (0.028 - bias_shift * 0.012).clamp(0.006, 0.05);
        let signal = with_nfb * headroom / bias_headroom;

        let positive_drive = (1.0 + asymmetry + bias_shift * 0.10).clamp(0.8, 1.35);
        let negative_drive = (1.0 - asymmetry + bias_shift * 0.06).clamp(0.72, 1.20);
        let clipped =
            biased_push_pull_clip(signal, positive_drive, negative_drive, crossover_width)
                * saturation_curve;

        let crossover = if signal > crossover_width {
            1.0
        } else if signal < -crossover_width {
            -1.0
        } else {
            signal / crossover_width.max(1.0e-4)
        };
        let tube_makeup = match self.tube_type {
            PowerTubeType::Type6L6 => 1.10,
            PowerTubeType::TypeEL34 => 1.20,
            PowerTubeType::TypeEL84 => 1.32,
        };
        let sag_makeup = 1.0 + (self.v_nominal - self.vb_plus) * 0.12;
        let bias_even = signal * bias_shift * 0.02;
        let mut output =
            (clipped + bias_even + bias_shift * crossover * 0.02) * tube_makeup * sag_makeup;

        // During recovery after a hard burst, real power stages and their load
        // interaction stop feeling as edge-heavy as the initial attack. Model
        // that as a bounded release-dependent damping stage instead of a static
        // low-pass glued on the whole output.
        let recovery_target = (self.load_envelope - with_nfb.abs()).max(0.0);
        let recovery_attack = match self.rectifier_type {
            RectifierType::Tube => 0.010,
            RectifierType::SolidState => 0.006,
            RectifierType::Variac => 0.014,
        };
        let recovery_coeff = 1.0 - (-dt / recovery_attack).exp();
        self.recovery_envelope += (recovery_target - self.recovery_envelope) * recovery_coeff;
        let damping_amount = (self.recovery_envelope
            * (0.70 + self.sag_amount * 0.24 + (1.0 - self.neg_feedback) * 0.14))
            .clamp(0.0, 0.82);
        let damping_cutoff_hz = match self.tube_type {
            PowerTubeType::Type6L6 => 760.0,
            PowerTubeType::TypeEL34 => 620.0,
            PowerTubeType::TypeEL84 => 560.0,
        } + self.presence * 180.0;
        let damping_coeff = (2.0 * std::f32::consts::PI * damping_cutoff_hz * dt).min(0.24);
        self.output_low_state += damping_coeff * (output - self.output_low_state);
        let low = self.output_low_state;
        let edge = output - low;
        let low_hold = 1.0 + damping_amount * (0.55 + self.resonance * 0.28);
        output = low * low_hold + edge * (1.0 - damping_amount);

        // Update negative feedback state (DSP-2: closes the NFB loop).
        self.feedback_state = flush_denormal(output);

        // Update peak meter
        let peak = output.abs();
        if peak > self.peak_level {
            self.peak_level = peak;
        } else {
            self.peak_level *= self.meter_decay_coeff;
        }

        output
    }

    /// DSP-3: two substeps as before, but behind a real half-band pair rather
    /// than linear interpolation up and a 2-tap box average down.
    pub fn process_sample(&mut self, input: f32) -> f32 {
        let (first_input, second_input) = self.oversampler.upsample(input);
        let substep_dt = 0.5 / self.sample_rate;

        let first = self.process_substep(first_input, substep_dt);
        let second = self.process_substep(second_input, substep_dt);

        self.oversampler.downsample(first, second)
    }

    pub fn sag_voltage(&self) -> f32 {
        self.vb_plus
    }

    pub fn peak_db(&self) -> f32 {
        super::params::linear_to_db(self.peak_level)
    }

    pub fn reset(&mut self) {
        self.vb_plus = self.v_nominal;
        self.oversampler.reset();
        self.feedback_state = 0.0;
        self.feedback_low_state = 0.0;
        self.load_envelope = 0.0;
        self.recovery_envelope = 0.0;
        self.output_low_state = 0.0;
        self.peak_level = 0.0;
    }
}

fn biased_push_pull_clip(
    signal: f32,
    positive_drive: f32,
    negative_drive: f32,
    crossover_width: f32,
) -> f32 {
    if signal >= crossover_width {
        ((signal - crossover_width) * positive_drive).tanh()
    } else if signal <= -crossover_width {
        ((signal + crossover_width) * negative_drive).tanh()
    } else {
        let normalized = signal / crossover_width.max(1.0e-4);
        normalized * 0.12
    }
}

#[cfg(test)]
mod tests {
    use super::{biased_push_pull_clip, PowerAmp};

    fn average_abs_output_for_sample_rate(sample_rate: f32) -> f32 {
        let mut amp = PowerAmp::new(sample_rate);
        amp.set_param("master", 8.0);
        amp.set_param("powerTubeType", 1.0);
        amp.set_param("rectifierType", 0.0);
        amp.set_param("sagAmount", 0.62);
        amp.set_param("sagRecovery", 260.0);
        amp.set_param("negFeedback", 0.42);
        amp.set_param("powerAmpBias", 0.58);
        amp.set_param("presence", 6.0);
        amp.set_param("resonance", 6.0);

        let total = 4096;
        let mut sum = 0.0_f32;
        for n in 0..total {
            let phase = (n as f32 * 2.0 * std::f32::consts::PI * 1_450.0) / sample_rate;
            let sample = phase.sin() * 0.22;
            let out = amp.process_sample(sample);
            assert!(out.is_finite(), "power amp output should remain finite");
            sum += out.abs();
        }

        sum / total as f32
    }

    fn rectifier_burst_metrics(rectifier_type: f32) -> (f32, f32) {
        let sample_rate = 48_000.0;
        let mut amp = PowerAmp::new(sample_rate);
        amp.set_param("master", 8.0);
        amp.set_param("powerTubeType", 1.0);
        amp.set_param("rectifierType", rectifier_type);
        amp.set_param("sagAmount", 0.62);
        amp.set_param("sagRecovery", 260.0);
        amp.set_param("negFeedback", 0.42);
        amp.set_param("powerAmpBias", 0.58);
        amp.set_param("presence", 6.0);
        amp.set_param("resonance", 6.0);

        let total = 2048;
        let burst_len = 448;
        let mut min_vb_plus = 1.0_f32;
        let mut tail_sum = 0.0_f32;
        let mut tail_count = 0_usize;

        for n in 0..total {
            let sample = if n < burst_len {
                let low =
                    ((n as f32 * 2.0 * std::f32::consts::PI * 110.0) / sample_rate).sin() * 0.28;
                let bite =
                    ((n as f32 * 2.0 * std::f32::consts::PI * 1_250.0) / sample_rate).sin() * 0.12;
                low + bite
            } else {
                0.0
            };

            let out = amp.process_sample(sample);
            min_vb_plus = min_vb_plus.min(amp.sag_voltage());
            if (512..1200).contains(&n) {
                tail_sum += out.abs();
                tail_count += 1;
            }
        }

        let tail_avg = tail_sum / tail_count.max(1) as f32;
        (min_vb_plus, tail_avg)
    }

    fn tube_family_burst_metrics(power_tube_type: f32) -> (f32, f32) {
        let sample_rate = 48_000.0;
        let mut amp = PowerAmp::new(sample_rate);
        amp.set_param("master", 8.2);
        amp.set_param("powerTubeType", power_tube_type);
        amp.set_param("rectifierType", 0.0);
        amp.set_param("sagAmount", 0.55);
        amp.set_param("sagRecovery", 240.0);
        amp.set_param("negFeedback", 0.48);
        amp.set_param("powerAmpBias", 0.56);
        amp.set_param("presence", 5.5);
        amp.set_param("resonance", 5.8);

        let total = 2048;
        let burst_len = 512;
        let mut attack_peak = 0.0_f32;
        let mut sustain_sum = 0.0_f32;
        let mut sustain_count = 0_usize;

        for n in 0..total {
            let input = if n < burst_len {
                let low =
                    ((n as f32 * 2.0 * std::f32::consts::PI * 115.0) / sample_rate).sin() * 0.26;
                let edge =
                    ((n as f32 * 2.0 * std::f32::consts::PI * 1_500.0) / sample_rate).sin() * 0.11;
                low + edge
            } else {
                0.0
            };
            let out = amp.process_sample(input);
            if n < 128 {
                attack_peak = attack_peak.max(out.abs());
            }
            if (192..720).contains(&n) {
                sustain_sum += out.abs();
                sustain_count += 1;
            }
        }

        let sustain_avg = sustain_sum / sustain_count.max(1) as f32;
        (attack_peak, sustain_avg)
    }

    fn decay_metrics_for_power_amp() -> (f32, f32, f32, f32) {
        let sample_rate = 48_000.0;
        let mut amp = PowerAmp::new(sample_rate);
        amp.set_param("master", 9.0);
        amp.set_param("powerTubeType", 1.0);
        amp.set_param("rectifierType", 0.0);
        amp.set_param("sagAmount", 0.66);
        amp.set_param("sagRecovery", 280.0);
        amp.set_param("negFeedback", 0.36);
        amp.set_param("powerAmpBias", 0.58);
        amp.set_param("presence", 6.8);
        amp.set_param("resonance", 6.4);

        let total = 3072;
        let burst_len = 768;
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
                    ((n as f32 * 2.0 * std::f32::consts::PI * 115.0) / sample_rate).sin() * 0.28;
                let edge =
                    ((n as f32 * 2.0 * std::f32::consts::PI * 1_700.0) / sample_rate).sin() * 0.12;
                low + edge
            } else {
                0.0
            };
            let out = amp.process_sample(input);
            let low_coeff = (2.0 * std::f32::consts::PI * 240.0 / sample_rate).min(0.28);
            low_state += low_coeff * (out - low_state);
            let edge = out - low_state;

            if (256..640).contains(&n) {
                sustain_body += low_state.abs();
                sustain_edge += edge.abs();
                sustain_count += 1;
            } else if (768..960).contains(&n) {
                tail_body += low_state.abs();
                tail_edge += edge.abs();
                tail_count += 1;
            }
        }

        (
            sustain_body / sustain_count.max(1) as f32,
            sustain_edge / sustain_count.max(1) as f32,
            tail_body / tail_count.max(1) as f32,
            tail_edge / tail_count.max(1) as f32,
        )
    }

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

    #[test]
    fn high_drive_power_amp_is_reasonably_sample_rate_stable() {
        let output_48k = average_abs_output_for_sample_rate(48_000.0);
        let output_96k = average_abs_output_for_sample_rate(96_000.0);
        let relative_delta = (output_48k - output_96k).abs() / output_96k.max(1.0e-6);

        assert!(
            relative_delta <= 0.12,
            "high-drive power amp should stay reasonably stable across sample rates (48k={output_48k}, 96k={output_96k}, delta={relative_delta})"
        );
    }

    #[test]
    fn rectifier_type_changes_burst_sag_and_recovery() {
        let (tube_min_sag, tube_tail) = rectifier_burst_metrics(0.0);
        let (solid_state_min_sag, solid_state_tail) = rectifier_burst_metrics(1.0);
        let sag_delta = (tube_min_sag - solid_state_min_sag).abs();
        let tail_delta = (tube_tail - solid_state_tail).abs();

        assert!(
            sag_delta > 1.5e-2 || tail_delta > 2.5e-3,
            "rectifier type should audibly change burst sag/recovery (tube_sag={tube_min_sag}, solid_sag={solid_state_min_sag}, tube_tail={tube_tail}, solid_tail={solid_state_tail})"
        );
    }

    #[test]
    fn sixl6_keeps_more_attack_headroom_than_el84() {
        let (sixl6_peak, sixl6_sustain) = tube_family_burst_metrics(0.0);
        let (el84_peak, el84_sustain) = tube_family_burst_metrics(2.0);

        assert!(
            sixl6_peak > el84_peak + 0.06,
            "6L6 should keep more burst headroom than EL84 (6L6_peak={sixl6_peak}, EL84_peak={el84_peak}, 6L6_sustain={sixl6_sustain}, EL84_sustain={el84_sustain})"
        );
    }

    #[test]
    fn power_tube_families_are_not_interchangeable() {
        let (sixl6_peak, sixl6_sustain) = tube_family_burst_metrics(0.0);
        let (el34_peak, el34_sustain) = tube_family_burst_metrics(1.0);
        let (el84_peak, el84_sustain) = tube_family_burst_metrics(2.0);
        let el34_diff = (sixl6_peak - el34_peak).abs() + (sixl6_sustain - el34_sustain).abs();
        let el84_diff = (sixl6_peak - el84_peak).abs() + (sixl6_sustain - el84_sustain).abs();

        assert!(
            el34_diff > 0.045 && el84_diff > 0.09,
            "power-tube families should not collapse into near-identical burst behavior (6L6=({sixl6_peak}, {sixl6_sustain}), EL34=({el34_peak}, {el34_sustain}), EL84=({el84_peak}, {el84_sustain}))"
        );
    }

    #[test]
    fn extreme_gain_power_amp_decay_smooths_after_the_attack() {
        let (sustain_body, sustain_edge, tail_body, tail_edge) = decay_metrics_for_power_amp();
        let sustain_ratio = sustain_edge / sustain_body.max(1.0e-6);
        let tail_ratio = tail_edge / tail_body.max(1.0e-6);
        let edge_retention = tail_edge / sustain_edge.max(1.0e-6);

        assert!(
            tail_ratio < 0.95 && edge_retention < 0.50,
            "extreme-gain power amp decay should get less edge-heavy after the attack (sustain_ratio={sustain_ratio}, tail_ratio={tail_ratio}, sustain_body={sustain_body}, sustain_edge={sustain_edge}, tail_body={tail_body}, tail_edge={tail_edge}, edge_retention={edge_retention})"
        );
    }

    #[test]
    fn power_amp_bias_audibly_changes_the_response() {
        let total = 4096;

        let mut cold = PowerAmp::new(48_000.0);
        cold.set_param("master", 7.0);
        cold.set_param("powerAmpBias", 0.15);

        let mut hot = PowerAmp::new(48_000.0);
        hot.set_param("master", 7.0);
        hot.set_param("powerAmpBias", 0.85);

        let mut diff_sum = 0.0_f32;
        for n in 0..total {
            let low = ((n as f32 * 2.0 * std::f32::consts::PI * 120.0) / 48_000.0).sin() * 0.15;
            let high = ((n as f32 * 2.0 * std::f32::consts::PI * 1_400.0) / 48_000.0).sin() * 0.08;
            let input = low + high;
            let cold_out = cold.process_sample(input);
            let hot_out = hot.process_sample(input);
            diff_sum += (cold_out - hot_out).abs();
        }

        let average_diff = diff_sum / total as f32;
        assert!(
            average_diff > 5.0e-3,
            "power amp bias should audibly change the response, got diff {average_diff}"
        );
    }

    #[test]
    fn biased_push_pull_clip_has_a_real_crossover_region() {
        let inside = biased_push_pull_clip(0.002, 1.0, 1.0, 0.02);
        let outside = biased_push_pull_clip(0.08, 1.0, 1.0, 0.02);

        assert!(
            inside.abs() < outside.abs(),
            "crossover region should soften the response near zero crossing (inside={inside}, outside={outside})"
        );
    }
}
