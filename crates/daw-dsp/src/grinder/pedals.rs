//! Pedalboard DSP: compressor plus core drive pedals.

use std::f32::consts::PI;

pub struct OverdrivePedal {
    drive: f32,
    tone: f32,
    level: f32,
    enabled: bool,
    input_hp_state: f32,
    tone_lp_state: f32,
    output_hp_state: f32,
    sag_state: f32,
    sample_rate: f32,
}

impl OverdrivePedal {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            drive: 0.45,
            tone: 0.55,
            level: 0.6,
            enabled: false,
            input_hp_state: 0.0,
            tone_lp_state: 0.0,
            output_hp_state: 0.0,
            sag_state: 0.0,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "drive" => self.drive = (value / 10.0).clamp(0.0, 1.0),
            "tone" => self.tone = (value / 10.0).clamp(0.0, 1.0),
            "level" => self.level = (value / 10.0).clamp(0.0, 1.0),
            "enabled" => self.enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.enabled {
            return input;
        }

        let dt = 1.0 / self.sample_rate;
        let pre_hp_freq = 95.0 + self.drive * 220.0;
        let pre_hp_coeff = (2.0 * PI * pre_hp_freq * dt).min(0.45);
        self.input_hp_state += pre_hp_coeff * (input - self.input_hp_state);
        let tightened = input - self.input_hp_state;

        let gain = 1.0 + self.drive * 4.4;
        let pushed = tightened * gain;

        self.sag_state += 0.0014 * (pushed.abs() - self.sag_state);
        let headroom = (1.08 - self.sag_state * (0.10 + self.drive * 0.14)).clamp(0.72, 1.02);
        let clipped = Self::soft_clip(pushed / headroom.max(0.55), self.drive) * headroom;

        let tone_freq = 720.0 + self.tone * 3_600.0;
        let tone_coeff = (2.0 * PI * tone_freq * dt).min(0.72);
        self.tone_lp_state += tone_coeff * (clipped - self.tone_lp_state);
        let brightness = clipped - self.tone_lp_state;
        let voiced = self.tone_lp_state * (1.02 - self.tone * 0.06) + brightness * (0.10 + self.tone * 0.46);

        let output_hp_coeff = (2.0 * PI * 75.0 * dt).min(0.35);
        self.output_hp_state += output_hp_coeff * (voiced - self.output_hp_state);
        let dc_trimmed = voiced - self.output_hp_state;

        let level = 0.28 + self.level * 1.04;
        let drive_compensation = 1.0 / (1.0 + self.drive * 1.6);
        dc_trimmed * level * drive_compensation
    }

    fn soft_clip(x: f32, drive: f32) -> f32 {
        let asymmetry = 0.03 + drive * 0.05;
        let positive = ((x + asymmetry) * (1.15 + drive * 0.35)).tanh();
        let negative = ((x - asymmetry) * (1.05 + drive * 0.22)).tanh();
        let blended = if x >= 0.0 { positive } else { negative };
        blended * (0.94 - drive * 0.06)
    }

    pub fn reset(&mut self) {
        self.input_hp_state = 0.0;
        self.tone_lp_state = 0.0;
        self.output_hp_state = 0.0;
        self.sag_state = 0.0;
    }
}

pub struct DistortionPedal {
    drive: f32,
    tone: f32,
    level: f32,
    enabled: bool,
    input_hp_state: f32,
    tone_lp_state: f32,
    tone_hp_state: f32,
    slew_state: f32,
    sample_rate: f32,
}

impl DistortionPedal {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            drive: 0.5,
            tone: 0.5,
            level: 0.58,
            enabled: false,
            input_hp_state: 0.0,
            tone_lp_state: 0.0,
            tone_hp_state: 0.0,
            slew_state: 0.0,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "drive" => self.drive = (value / 10.0).clamp(0.0, 1.0),
            "tone" => self.tone = (value / 10.0).clamp(0.0, 1.0),
            "level" => self.level = (value / 10.0).clamp(0.0, 1.0),
            "enabled" => self.enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.enabled {
            return input;
        }

        let dt = 1.0 / self.sample_rate;
        let pre_hp_coeff = (2.0 * PI * 140.0 * dt).min(0.42);
        self.input_hp_state += pre_hp_coeff * (input - self.input_hp_state);
        let tightened = input - self.input_hp_state;

        let gain = 2.4 + self.drive * 26.0;
        let pushed = tightened * gain;

        let slew_coeff = (0.1 + (1.0 - self.drive) * 0.22).clamp(0.06, 0.34);
        self.slew_state += slew_coeff * (pushed - self.slew_state);

        let clip_threshold = 0.78 - self.drive * 0.2;
        let clipped = Self::rat_clip(self.slew_state, clip_threshold);

        let low_pass_hz = 1_000.0 + self.tone * 5_200.0;
        let low_pass_coeff = (2.0 * PI * low_pass_hz * dt).min(0.92);
        self.tone_lp_state += low_pass_coeff * (clipped - self.tone_lp_state);

        let high_pass_hz = 120.0 + (1.0 - self.tone) * 320.0;
        let high_pass_coeff = (2.0 * PI * high_pass_hz * dt).min(0.42);
        self.tone_hp_state += high_pass_coeff * (self.tone_lp_state - self.tone_hp_state);
        let voiced = self.tone_lp_state - self.tone_hp_state;

        let level = 0.68 + self.level * 0.82;
        voiced * level
    }

    fn rat_clip(input: f32, threshold: f32) -> f32 {
        let abs = input.abs();
        if abs <= threshold {
            return input * 0.92;
        }

        let sign = input.signum();
        let over = (abs - threshold) / (1.0 - threshold).max(1.0e-4);
        let compressed = threshold + (1.0 - (-4.0 * over).exp()) * (0.98 - threshold);
        sign * compressed
    }

    pub fn reset(&mut self) {
        self.input_hp_state = 0.0;
        self.tone_lp_state = 0.0;
        self.tone_hp_state = 0.0;
        self.slew_state = 0.0;
    }
}

pub struct FuzzPedal {
    fuzz: f32,
    tone: f32,
    level: f32,
    enabled: bool,
    bias_state: f32,
    tone_lp_state: f32,
    cleanup_state: f32,
    sample_rate: f32,
}

impl FuzzPedal {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            fuzz: 0.68,
            tone: 0.48,
            level: 0.62,
            enabled: false,
            bias_state: 0.0,
            tone_lp_state: 0.0,
            cleanup_state: 0.0,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "fuzz" => self.fuzz = (value / 10.0).clamp(0.0, 1.0),
            "tone" => self.tone = (value / 10.0).clamp(0.0, 1.0),
            "level" => self.level = (value / 10.0).clamp(0.0, 1.0),
            "enabled" => self.enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.enabled {
            return input;
        }

        let dt = 1.0 / self.sample_rate;
        self.cleanup_state += 0.002 * (input.abs() - self.cleanup_state);
        let cleanup = (1.0 - self.cleanup_state * (0.9 - self.fuzz * 0.45)).clamp(0.45, 1.0);

        let bias_offset = (self.fuzz - 0.5) * 0.22;
        let pushed = input * cleanup * (2.4 + self.fuzz * 24.0) + bias_offset;
        self.bias_state += 0.0008 * (pushed - self.bias_state);
        let biased = pushed - self.bias_state * (0.32 + self.fuzz * 0.18);

        let clipped = if biased >= 0.0 {
            1.0 - (-biased * (2.1 + self.fuzz * 1.4)).exp()
        } else {
            -(1.0 - (biased * (1.55 + self.fuzz * 0.95)).exp())
        };

        let starve = (1.0 - input.abs() * self.fuzz * 0.38).clamp(0.52, 1.0);
        let saturated = clipped * starve;

        let tone_freq = 420.0 + self.tone * 5_600.0;
        let tone_coeff = (2.0 * PI * tone_freq * dt).min(0.92);
        self.tone_lp_state += tone_coeff * (saturated - self.tone_lp_state);
        let edge = saturated - self.tone_lp_state;
        let voiced =
            self.tone_lp_state * (1.16 - self.tone * 0.34) + edge * (0.14 + self.tone * 1.08);

        let level = 0.64 + self.level * 0.84;
        voiced * level
    }

    pub fn reset(&mut self) {
        self.bias_state = 0.0;
        self.tone_lp_state = 0.0;
        self.cleanup_state = 0.0;
    }
}

/// Simple compressor pedal.
pub struct CompressorPedal {
    threshold: f32,
    ratio: f32,
    attack_coeff: f32,
    release_coeff: f32,
    envelope: f32,
    enabled: bool,
    sample_rate: f32,
}

impl CompressorPedal {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            threshold: super::params::db_to_linear(-20.0),
            ratio: 4.0,
            attack_coeff: (-1.0 / (0.01 * sample_rate)).exp(),
            release_coeff: (-1.0 / (0.2 * sample_rate)).exp(),
            envelope: 0.0,
            enabled: false,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "threshold" => self.threshold = super::params::db_to_linear(value),
            "ratio" => self.ratio = value.max(1.0),
            "attack" => {
                self.attack_coeff = (-1.0 / (value.max(0.1) * 0.001 * self.sample_rate)).exp()
            }
            "release" => {
                self.release_coeff = (-1.0 / (value.max(1.0) * 0.001 * self.sample_rate)).exp()
            }
            "enabled" => self.enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.enabled {
            return input;
        }

        let abs_in = input.abs();
        if abs_in > self.envelope {
            self.envelope = abs_in + self.attack_coeff * (self.envelope - abs_in);
        } else {
            self.envelope = abs_in + self.release_coeff * (self.envelope - abs_in);
        }

        let gain = if self.envelope > self.threshold {
            let over_db = super::params::linear_to_db(self.envelope / self.threshold);
            let reduced = over_db / self.ratio;
            super::params::db_to_linear(reduced - over_db)
        } else {
            1.0
        };

        input * gain
    }

    pub fn reset(&mut self) {
        self.envelope = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::OverdrivePedal;

    fn average_abs_overdrive_output(drive: f32, tone: f32, level: f32, enabled: bool) -> f32 {
        let mut pedal = OverdrivePedal::new(48_000.0);
        pedal.set_param("enabled", if enabled { 1.0 } else { 0.0 });
        pedal.set_param("drive", drive);
        pedal.set_param("tone", tone);
        pedal.set_param("level", level);

        let total = 4096;
        let mut sum = 0.0_f32;
        for index in 0..total {
            let phase = (index as f32 * 2.0 * std::f32::consts::PI * 220.0) / 48_000.0;
            let input = phase.sin() * 0.08;
            let output = pedal.process_sample(input);
            assert!(output.is_finite(), "overdrive output should stay finite");
            sum += output.abs();
        }

        sum / total as f32
    }

    #[test]
    fn moderate_overdrive_stays_in_a_usable_loudness_range() {
        let dry_average = average_abs_overdrive_output(2.5, 5.0, 5.0, false);
        let driven_average = average_abs_overdrive_output(2.5, 5.0, 5.0, true);
        let loudness_ratio = driven_average / dry_average.max(1.0e-6);

        assert!(
            (0.7..=1.7).contains(&loudness_ratio),
            "moderate overdrive should stay near a usable loudness range, got ratio {loudness_ratio} (dry={dry_average}, driven={driven_average})"
        );
    }

    #[test]
    fn overdrive_still_changes_the_signal_when_enabled() {
        let dry_average = average_abs_overdrive_output(4.0, 5.0, 5.5, false);
        let driven_average = average_abs_overdrive_output(4.0, 5.0, 5.5, true);

        assert!(
            (driven_average - dry_average).abs() > 1.0e-3,
            "overdrive should still audibly change the signal path (dry={dry_average}, driven={driven_average})"
        );
    }
}
