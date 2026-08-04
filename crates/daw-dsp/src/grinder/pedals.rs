//! Pedalboard DSP: compressor plus core drive pedals.

use super::oversample::StageOversampler2x;
use crate::primitives::flush_denormal;
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
        self.input_hp_state =
            flush_denormal(self.input_hp_state + pre_hp_coeff * (input - self.input_hp_state));
        let tightened = input - self.input_hp_state;

        let gain = 1.0 + self.drive * 4.4;
        let pushed = tightened * gain;

        self.sag_state = flush_denormal(self.sag_state + 0.0014 * (pushed.abs() - self.sag_state));
        let headroom = (1.08 - self.sag_state * (0.10 + self.drive * 0.14)).clamp(0.72, 1.02);
        let clipped = Self::soft_clip(pushed / headroom.max(0.55), self.drive) * headroom;

        let tone_freq = 720.0 + self.tone * 3_600.0;
        let tone_coeff = (2.0 * PI * tone_freq * dt).min(0.72);
        self.tone_lp_state =
            flush_denormal(self.tone_lp_state + tone_coeff * (clipped - self.tone_lp_state));
        let brightness = clipped - self.tone_lp_state;
        let voiced =
            self.tone_lp_state * (1.02 - self.tone * 0.06) + brightness * (0.10 + self.tone * 0.46);

        let output_hp_coeff = (2.0 * PI * 75.0 * dt).min(0.35);
        self.output_hp_state = flush_denormal(
            self.output_hp_state + output_hp_coeff * (voiced - self.output_hp_state),
        );
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
    pre_shape_state: f32,
    oversampler: StageOversampler2x,
    tone_lp_state: f32,
    tone_hp_state: f32,
    output_hp_state: f32,
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
            pre_shape_state: 0.0,
            oversampler: StageOversampler2x::new(),
            tone_lp_state: 0.0,
            tone_hp_state: 0.0,
            output_hp_state: 0.0,
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
        let pre_hp_freq = 110.0 + self.drive * 160.0;
        let pre_hp_coeff = (2.0 * PI * pre_hp_freq * dt).min(0.36);
        self.input_hp_state =
            flush_denormal(self.input_hp_state + pre_hp_coeff * (input - self.input_hp_state));
        let tightened = input - self.input_hp_state;

        let pre_shape_hz = 2_200.0 + (1.0 - self.drive) * 2_000.0;
        let pre_shape_coeff = (2.0 * PI * pre_shape_hz * dt).min(0.48);
        self.pre_shape_state = flush_denormal(
            self.pre_shape_state + pre_shape_coeff * (tightened - self.pre_shape_state),
        );
        let conditioned = tightened * 0.58 + self.pre_shape_state * 0.42;

        let gain = 1.35 + self.drive * 7.2;
        let pushed = conditioned * gain;
        let drive = self.drive;
        let clipped = self
            .oversampler
            .process(pushed, |sample| Self::rat_core(sample, drive));

        let low_pass_hz = 1_000.0 + self.tone * 5_200.0;
        let low_pass_coeff = (2.0 * PI * low_pass_hz * dt).min(0.92);
        self.tone_lp_state =
            flush_denormal(self.tone_lp_state + low_pass_coeff * (clipped - self.tone_lp_state));

        let high_pass_hz = 120.0 + (1.0 - self.tone) * 320.0;
        let high_pass_coeff = (2.0 * PI * high_pass_hz * dt).min(0.42);
        self.tone_hp_state = flush_denormal(
            self.tone_hp_state + high_pass_coeff * (self.tone_lp_state - self.tone_hp_state),
        );
        let body = self.tone_lp_state - self.tone_hp_state;
        let edge = clipped - self.tone_lp_state;
        let voiced = body * (0.96 - self.tone * 0.08) + edge * (0.08 + self.tone * 0.32);

        let output_hp_coeff = (2.0 * PI * 70.0 * dt).min(0.34);
        self.output_hp_state = flush_denormal(
            self.output_hp_state + output_hp_coeff * (voiced - self.output_hp_state),
        );
        let dc_trimmed = voiced - self.output_hp_state;

        let level = 0.36 + self.level * 0.98;
        let drive_compensation = 1.0 / (1.0 + self.drive * 1.25);
        dc_trimmed * level * drive_compensation
    }

    fn rat_core(input: f32, drive: f32) -> f32 {
        let threshold = 0.52 - drive * 0.12;
        let abs = input.abs();
        let sign = input.signum();
        let clipped = if abs <= threshold {
            input * 0.86
        } else {
            let over = (abs - threshold) / (1.0 + abs);
            let knee = 1.0 - (-3.2 * over).exp();
            let limited = threshold + knee * (0.96 - threshold);
            sign * limited
        };
        let edge = (input * (0.55 + drive * 0.95)).tanh();
        clipped * (0.82 - drive * 0.10) + edge * (0.18 + drive * 0.10)
    }

    pub fn reset(&mut self) {
        self.input_hp_state = 0.0;
        self.pre_shape_state = 0.0;
        self.oversampler.reset();
        self.tone_lp_state = 0.0;
        self.tone_hp_state = 0.0;
        self.output_hp_state = 0.0;
    }
}

pub struct FuzzPedal {
    fuzz: f32,
    tone: f32,
    level: f32,
    enabled: bool,
    input_hp_state: f32,
    bias_state: f32,
    oversampler: StageOversampler2x,
    tone_lp_state: f32,
    cleanup_state: f32,
    output_hp_state: f32,
    sample_rate: f32,
}

impl FuzzPedal {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            fuzz: 0.68,
            tone: 0.48,
            level: 0.62,
            enabled: false,
            input_hp_state: 0.0,
            bias_state: 0.0,
            oversampler: StageOversampler2x::new(),
            tone_lp_state: 0.0,
            cleanup_state: 0.0,
            output_hp_state: 0.0,
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
        let pre_hp_freq = 75.0 + self.fuzz * 120.0;
        let pre_hp_coeff = (2.0 * PI * pre_hp_freq * dt).min(0.34);
        self.input_hp_state =
            flush_denormal(self.input_hp_state + pre_hp_coeff * (input - self.input_hp_state));
        let tightened = input - self.input_hp_state;

        self.cleanup_state =
            flush_denormal(self.cleanup_state + 0.0025 * (tightened.abs() - self.cleanup_state));
        let cleanup = (1.0 - self.cleanup_state * (0.28 + self.fuzz * 0.18)).clamp(0.68, 1.0);

        let bias_target = tightened * (0.06 + self.fuzz * 0.10);
        self.bias_state =
            flush_denormal(self.bias_state + 0.0020 * (bias_target - self.bias_state));

        let conditioned = (tightened + self.bias_state) * cleanup;
        let pushed = conditioned * (1.9 + self.fuzz * 10.5);
        let fuzz = self.fuzz;
        let saturated = self
            .oversampler
            .process(pushed, |sample| Self::fuzz_core(sample, fuzz));

        let tone_freq = 420.0 + self.tone * 5_600.0;
        let tone_coeff = (2.0 * PI * tone_freq * dt).min(0.92);
        self.tone_lp_state =
            flush_denormal(self.tone_lp_state + tone_coeff * (saturated - self.tone_lp_state));
        let edge = saturated - self.tone_lp_state;
        let voiced =
            self.tone_lp_state * (1.08 - self.tone * 0.24) + edge * (0.12 + self.tone * 0.68);

        let output_hp_coeff = (2.0 * PI * 65.0 * dt).min(0.34);
        self.output_hp_state = flush_denormal(
            self.output_hp_state + output_hp_coeff * (voiced - self.output_hp_state),
        );
        let dc_trimmed = voiced - self.output_hp_state;

        let level = 0.22 + self.level * 0.84;
        let fuzz_compensation = 1.0 / (1.0 + self.fuzz * 3.4);
        dc_trimmed * level * fuzz_compensation
    }

    fn fuzz_core(input: f32, fuzz: f32) -> f32 {
        let magnitude = input.abs();
        let starve = 1.0 / (1.0 + magnitude * (0.34 + fuzz * 0.46));

        if input >= 0.0 {
            let positive = 1.0 - (-(input * (1.9 + fuzz * 2.0))).exp();
            positive * starve
        } else {
            let negative = -(1.0 - (-(magnitude * (1.45 + fuzz * 1.35))).exp());
            negative * starve
        }
    }

    pub fn reset(&mut self) {
        self.input_hp_state = 0.0;
        self.bias_state = 0.0;
        self.oversampler.reset();
        self.tone_lp_state = 0.0;
        self.cleanup_state = 0.0;
        self.output_hp_state = 0.0;
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
            self.envelope = flush_denormal(abs_in + self.attack_coeff * (self.envelope - abs_in));
        } else {
            self.envelope = flush_denormal(abs_in + self.release_coeff * (self.envelope - abs_in));
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
    use super::{DistortionPedal, FuzzPedal, OverdrivePedal};

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

    fn average_abs_distortion_output(drive: f32, tone: f32, level: f32, enabled: bool) -> f32 {
        let mut pedal = DistortionPedal::new(48_000.0);
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
            assert!(output.is_finite(), "distortion output should stay finite");
            sum += output.abs();
        }

        sum / total as f32
    }

    fn average_abs_fuzz_output(fuzz: f32, tone: f32, level: f32, enabled: bool) -> f32 {
        let mut pedal = FuzzPedal::new(48_000.0);
        pedal.set_param("enabled", if enabled { 1.0 } else { 0.0 });
        pedal.set_param("fuzz", fuzz);
        pedal.set_param("tone", tone);
        pedal.set_param("level", level);

        let total = 4096;
        let mut sum = 0.0_f32;
        for index in 0..total {
            let phase = (index as f32 * 2.0 * std::f32::consts::PI * 220.0) / 48_000.0;
            let input = phase.sin() * 0.08;
            let output = pedal.process_sample(input);
            assert!(output.is_finite(), "fuzz output should stay finite");
            sum += output.abs();
        }

        sum / total as f32
    }

    fn average_abs_fuzz_silence_tail(fuzz: f32, tone: f32, level: f32) -> f32 {
        let mut pedal = FuzzPedal::new(48_000.0);
        pedal.set_param("enabled", 1.0);
        pedal.set_param("fuzz", fuzz);
        pedal.set_param("tone", tone);
        pedal.set_param("level", level);

        let total = 4096;
        let settle_start = total / 2;
        let mut sum = 0.0_f32;
        for index in 0..total {
            let output = pedal.process_sample(0.0);
            assert!(output.is_finite(), "fuzz silence output should stay finite");
            if index >= settle_start {
                sum += output.abs();
            }
        }

        sum / (total - settle_start) as f32
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

    #[test]
    fn moderate_distortion_stays_in_a_usable_loudness_range() {
        let dry_average = average_abs_distortion_output(4.0, 5.0, 5.0, false);
        let driven_average = average_abs_distortion_output(4.0, 5.0, 5.0, true);
        let loudness_ratio = driven_average / dry_average.max(1.0e-6);

        assert!(
            (0.8..=2.0).contains(&loudness_ratio),
            "moderate distortion should stay near a usable loudness range, got ratio {loudness_ratio} (dry={dry_average}, driven={driven_average})"
        );
    }

    #[test]
    fn moderate_fuzz_stays_in_a_usable_loudness_range() {
        let dry_average = average_abs_fuzz_output(4.0, 5.0, 5.0, false);
        let driven_average = average_abs_fuzz_output(4.0, 5.0, 5.0, true);
        let loudness_ratio = driven_average / dry_average.max(1.0e-6);

        assert!(
            (0.8..=2.0).contains(&loudness_ratio),
            "moderate fuzz should stay near a usable loudness range, got ratio {loudness_ratio} (dry={dry_average}, driven={driven_average})"
        );
    }

    #[test]
    fn enabled_fuzz_settles_near_silence_for_silence_input() {
        let silence_average = average_abs_fuzz_silence_tail(6.0, 5.0, 5.0);

        assert!(
            silence_average <= 1.0e-3,
            "enabled fuzz should settle near silence for silence input, got average {silence_average}"
        );
    }
}
