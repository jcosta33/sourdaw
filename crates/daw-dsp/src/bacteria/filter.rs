//! Multi-mode State Variable Filter (SVF) for Bacteria.
//!
//! Supports: low-pass, high-pass, band-pass, notch, formant, comb.
//! Stable under audio-rate modulation.

use std::f32::consts::PI;

/// Filter mode selector.
#[derive(Clone, Copy, PartialEq)]
pub enum FilterMode {
    LowPass,
    HighPass,
    BandPass,
    Notch,
    Formant,
    Comb,
}

impl FilterMode {
    pub fn from_index(i: u32) -> Self {
        match i {
            0 => Self::LowPass,
            1 => Self::HighPass,
            2 => Self::BandPass,
            3 => Self::Notch,
            4 => Self::Formant,
            _ => Self::Comb,
        }
    }
}

/// State Variable Filter with integrated envelope follower.
pub struct SvfFilter {
    mode: FilterMode,
    cutoff: f32,
    resonance: f32,
    sample_rate: f32,

    // SVF state
    ic1eq: f32,
    ic2eq: f32,

    // Envelope follower for cutoff modulation
    env_amount: f32,
    env_attack_coeff: f32,
    env_release_coeff: f32,
    env_level: f32,

    // Comb filter delay line
    comb_buffer: Vec<f32>,
    comb_write_pos: usize,
}

impl SvfFilter {
    pub fn new(sample_rate: f32) -> Self {
        let comb_size = (sample_rate * 0.05) as usize; // 50ms max delay for comb
        Self {
            mode: FilterMode::LowPass,
            cutoff: 8000.0,
            resonance: 0.3,
            sample_rate,
            ic1eq: 0.0,
            ic2eq: 0.0,
            env_amount: 0.0,
            env_attack_coeff: Self::time_to_coeff(5.0, sample_rate),
            env_release_coeff: Self::time_to_coeff(200.0, sample_rate),
            env_level: 0.0,
            comb_buffer: vec![0.0; comb_size.max(1)],
            comb_write_pos: 0,
        }
    }

    fn time_to_coeff(ms: f32, sample_rate: f32) -> f32 {
        if ms <= 0.0 {
            1.0
        } else {
            (-1.0 / (ms * 0.001 * sample_rate)).exp()
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "filterMode" => self.mode = FilterMode::from_index(value as u32),
            "filterCutoff" => self.cutoff = value.clamp(20.0, 20000.0),
            "filterResonance" => self.resonance = value.clamp(0.0, 1.0),
            "filterEnvAmount" => self.env_amount = value,
            "filterEnvAttack" => {
                self.env_attack_coeff = Self::time_to_coeff(value, self.sample_rate);
            }
            "filterEnvRelease" => {
                self.env_release_coeff = Self::time_to_coeff(value, self.sample_rate);
            }
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        match self.mode {
            FilterMode::Comb => self.process_comb(input),
            _ => self.process_svf(input),
        }
    }

    fn process_svf(&mut self, input: f32) -> f32 {
        // Update envelope follower
        let abs_input = input.abs();
        if abs_input > self.env_level {
            self.env_level = abs_input + self.env_attack_coeff * (self.env_level - abs_input);
        } else {
            self.env_level = abs_input + self.env_release_coeff * (self.env_level - abs_input);
        }

        // Modulate cutoff with envelope
        let mod_cutoff = (self.cutoff * (1.0 + self.env_amount * self.env_level * 4.0))
            .clamp(20.0, 20000.0);

        // SVF coefficients (Hal Chamberlin / Andrew Simper variant)
        let g = (PI * mod_cutoff / self.sample_rate).tan();
        let k = 2.0 - 2.0 * self.resonance * 0.99; // prevent self-oscillation
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;

        let v3 = input - self.ic2eq;
        let v1 = a1 * self.ic1eq + a2 * v3;
        let v2 = self.ic2eq + a2 * self.ic1eq + a3 * v3;

        self.ic1eq = 2.0 * v1 - self.ic1eq;
        self.ic2eq = 2.0 * v2 - self.ic2eq;

        match self.mode {
            FilterMode::LowPass => v2,
            FilterMode::HighPass => input - k * v1 - v2,
            FilterMode::BandPass => v1,
            FilterMode::Notch => input - k * v1,
            FilterMode::Formant => {
                // Simple formant: resonant bandpass with boosted Q
                v1 * 2.0
            }
            FilterMode::Comb => unreachable!(),
        }
    }

    fn process_comb(&mut self, input: f32) -> f32 {
        let delay_samples = (self.sample_rate / self.cutoff.max(20.0)) as usize;
        let delay_samples = delay_samples.clamp(1, self.comb_buffer.len() - 1);

        let read_pos = if self.comb_write_pos >= delay_samples {
            self.comb_write_pos - delay_samples
        } else {
            self.comb_buffer.len() - (delay_samples - self.comb_write_pos)
        };

        let delayed = self.comb_buffer[read_pos];
        let output = input + delayed * self.resonance;

        self.comb_buffer[self.comb_write_pos] = output;
        self.comb_write_pos = (self.comb_write_pos + 1) % self.comb_buffer.len();

        output
    }

    pub fn reset(&mut self) {
        self.ic1eq = 0.0;
        self.ic2eq = 0.0;
        self.env_level = 0.0;
        self.comb_buffer.fill(0.0);
        self.comb_write_pos = 0;
    }
}
