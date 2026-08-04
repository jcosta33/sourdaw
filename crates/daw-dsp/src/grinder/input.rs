//! Input conditioning: impedance, noise gate, calibration.

use crate::primitives::flush_denormal;

use super::params::db_to_linear;

#[derive(Clone, Copy)]
enum InputMode {
    Instrument,
    Line,
    Reamp,
}

impl InputMode {
    fn from_index(index: u32) -> Self {
        match index {
            1 => Self::Line,
            2 => Self::Reamp,
            _ => Self::Instrument,
        }
    }
}

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
            floor_gain: db_to_linear(-72.0),
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
                self.detector_attack_coeff =
                    Self::time_to_coeff((value * 0.5).max(0.1), self.sample_rate);
                self.gain_attack_coeff = Self::time_to_coeff(value.max(0.1), self.sample_rate);
            }
            "gateRelease" => {
                self.detector_release_coeff =
                    Self::time_to_coeff((value * 0.6).max(5.0), self.sample_rate);
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
            self.envelope =
                flush_denormal(abs_in + self.detector_attack_coeff * (self.envelope - abs_in));
        } else {
            self.envelope =
                flush_denormal(abs_in + self.detector_release_coeff * (self.envelope - abs_in));
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
        let coeff = if !self.is_open {
            self.gain_attack_coeff
        } else if target_gain > self.gate_gain {
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
    input_mode: InputMode,
    impedance_filter_state: f32,
    mode_tilt_state: f32,
    sample_rate: f32,
}

impl InputConditioner {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            gain_linear: 1.0,
            impedance: 1000.0,
            input_mode: InputMode::Instrument,
            impedance_filter_state: 0.0,
            mode_tilt_state: 0.0,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "inputGain" => self.gain_linear = db_to_linear(value),
            "inputImpedance" => self.impedance = value,
            "inputMode" => self.input_mode = InputMode::from_index(value.round().max(0.0) as u32),
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        let (impedance_scale, mode_gain, low_mix, edge_mix) = match self.input_mode {
            InputMode::Instrument => (1.0, 1.06, 1.0, 1.14),
            InputMode::Line => (1.8, 0.82, 0.97, 0.90),
            InputMode::Reamp => (0.55, 0.90, 1.03, 0.78),
        };

        // Impedance loading effect: lower impedance = more HF rolloff (pickup loading)
        let impedance = (self.impedance * impedance_scale).clamp(10.0, 10_000.0);
        let impedance_norm = ((impedance.log10() - 1.0) / 3.0).clamp(0.0, 1.0);
        let load_freq = 4_000.0 + impedance_norm * 24_000.0;
        let dt = 1.0 / self.sample_rate;
        let coeff = (2.0 * std::f32::consts::PI * load_freq * dt).min(0.99);
        self.impedance_filter_state = flush_denormal(
            self.impedance_filter_state + coeff * (input - self.impedance_filter_state),
        );

        let tilt_cutoff_hz = match self.input_mode {
            InputMode::Instrument => 360.0,
            InputMode::Line => 320.0,
            InputMode::Reamp => 280.0,
        };
        let tilt_coeff = (2.0 * std::f32::consts::PI * tilt_cutoff_hz * dt).min(0.18);
        self.mode_tilt_state = flush_denormal(
            self.mode_tilt_state
                + tilt_coeff * (self.impedance_filter_state - self.mode_tilt_state),
        );
        let low = self.mode_tilt_state;
        let edge = self.impedance_filter_state - low;
        let conditioned = low * low_mix + edge * edge_mix;

        conditioned * self.gain_linear * mode_gain
    }

    pub fn reset(&mut self) {
        self.impedance_filter_state = 0.0;
        self.mode_tilt_state = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::{InputConditioner, NoiseGate};

    fn conditioned_burst_metrics(input_mode: f32) -> (f32, f32, f32) {
        let sample_rate = 48_000.0;
        let mut conditioner = InputConditioner::new(sample_rate);
        conditioner.set_param("inputMode", input_mode);
        conditioner.set_param("inputGain", 0.0);
        conditioner.set_param("inputImpedance", 1_000.0);

        let total = 2048;
        let burst_len = 512;
        let mut peak = 0.0_f32;
        let mut edge_state = 0.0_f32;
        let mut edge_sum = 0.0_f32;
        let mut body_sum = 0.0_f32;
        let mut count = 0_usize;

        for n in 0..total {
            let input = if n < burst_len {
                let low =
                    ((n as f32 * 2.0 * std::f32::consts::PI * 120.0) / sample_rate).sin() * 0.22;
                let pick =
                    ((n as f32 * 2.0 * std::f32::consts::PI * 2_400.0) / sample_rate).sin() * 0.08;
                low + pick
            } else {
                0.0
            };
            let out = conditioner.process_sample(input);
            if n < 192 {
                peak = peak.max(out.abs());
            }
            edge_state += 0.12 * ((out.abs()) - edge_state);
            if (96..640).contains(&n) {
                edge_sum += edge_state;
                body_sum += out.abs();
                count += 1;
            }
        }

        (
            peak,
            edge_sum / count.max(1) as f32,
            body_sum / count.max(1) as f32,
        )
    }

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

    #[test]
    fn enabled_gate_can_close_to_a_real_noise_floor() {
        let mut gate = NoiseGate::new(48_000.0);
        gate.set_param("gateEnabled", 1.0);
        gate.set_param("gateThreshold", -45.0);
        gate.set_param("gateAttack", 1.0);
        gate.set_param("gateRelease", 40.0);

        for _ in 0..1024 {
            gate.process_sample(0.18);
        }

        for _ in 0..12_288 {
            gate.process_sample(0.0);
        }

        assert!(
            gate.gain() < 1.0e-3,
            "enabled gate should clamp to a deep closed gain, got {}",
            gate.gain()
        );
    }

    #[test]
    fn input_modes_are_not_interchangeable() {
        let instrument = conditioned_burst_metrics(0.0);
        let line = conditioned_burst_metrics(1.0);
        let reamp = conditioned_burst_metrics(2.0);
        let line_diff = (instrument.0 - line.0).abs()
            + (instrument.1 - line.1).abs()
            + (instrument.2 - line.2).abs();
        let reamp_diff = (instrument.0 - reamp.0).abs()
            + (instrument.1 - reamp.1).abs()
            + (instrument.2 - reamp.2).abs();

        assert!(
            line_diff > 0.035 && reamp_diff > 0.05,
            "input modes should not collapse into the same conditioner response (instrument={instrument:?}, line={line:?}, reamp={reamp:?})"
        );
    }

    #[test]
    fn instrument_mode_preserves_more_pick_attack_than_reamp() {
        let (instrument_peak, instrument_edge, _) = conditioned_burst_metrics(0.0);
        let (reamp_peak, reamp_edge, _) = conditioned_burst_metrics(2.0);

        assert!(
            instrument_peak > reamp_peak + 0.015 && instrument_edge > reamp_edge + 0.01,
            "instrument mode should preserve more pick attack than reamp (instrument_peak={instrument_peak}, reamp_peak={reamp_peak}, instrument_edge={instrument_edge}, reamp_edge={reamp_edge})"
        );
    }

    #[test]
    fn line_mode_is_more_padded_than_instrument() {
        let (instrument_peak, _, instrument_body) = conditioned_burst_metrics(0.0);
        let (line_peak, _, line_body) = conditioned_burst_metrics(1.0);

        assert!(
            line_peak + 0.02 < instrument_peak && line_body + 0.015 < instrument_body,
            "line mode should stay more padded than instrument (instrument_peak={instrument_peak}, line_peak={line_peak}, instrument_body={instrument_body}, line_body={line_body})"
        );
    }
}
