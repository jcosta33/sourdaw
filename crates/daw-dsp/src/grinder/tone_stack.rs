//! Tone Stack modeling using interactive passive network simulation.
//!
//! Fender / Marshall / Vox style tone stacks are interactive passive networks
//! where adjusting one control affects the others. Modeled using a simplified
//! DK-method inspired approach with coupled filter coefficients.

use crate::primitives::flush_denormal;
use std::f32::consts::PI;

/// Tone stack topology.
#[derive(Clone, Copy, PartialEq)]
pub enum ToneStackType {
    Fender,
    Marshall,
    Vox,
}

impl ToneStackType {
    pub fn from_index(i: u32) -> Self {
        match i {
            0 => Self::Fender,
            1 => Self::Marshall,
            _ => Self::Vox,
        }
    }
}

/// Component values defining a tone stack circuit.
#[allow(dead_code)]
struct ToneStackCircuit {
    r1: f32,
    r2: f32,
    r3: f32,
    r4: f32,
    c1: f32,
    c2: f32,
    c3: f32,
}

impl ToneStackCircuit {
    fn fender() -> Self {
        Self {
            r1: 250e3,
            r2: 1e6,
            r3: 25e3,
            r4: 56e3,
            c1: 250e-12,
            c2: 20e-9,
            c3: 20e-9,
        }
    }

    fn marshall() -> Self {
        Self {
            r1: 220e3,
            r2: 1e6,
            r3: 22e3,
            r4: 33e3,
            c1: 470e-12,
            c2: 22e-9,
            c3: 22e-9,
        }
    }

    fn vox() -> Self {
        Self {
            r1: 1e6,
            r2: 1e6,
            r3: 10e3,
            r4: 100e3,
            c1: 50e-12,
            c2: 22e-9,
            c3: 22e-9,
        }
    }
}

/// Interactive tone stack with coupled Bass/Mid/Treble.
pub struct ToneStack {
    stack_type: ToneStackType,
    bass: f32,
    mid: f32,
    treble: f32,
    bright_cap: bool,
    sample_rate: f32,

    // State-variable filter states for 3-band coupled network
    lp_state: f32,
    bp_state: f32,
    hp_state: f32,

    // Cached coefficients
    lp_freq: f32,
    hp_freq: f32,
    mid_q: f32,
    insertion_loss: f32,
}

impl ToneStack {
    pub fn new(sample_rate: f32) -> Self {
        let mut ts = Self {
            stack_type: ToneStackType::Marshall,
            bass: 0.5,
            mid: 0.5,
            treble: 0.5,
            bright_cap: false,
            sample_rate,
            lp_state: 0.0,
            bp_state: 0.0,
            hp_state: 0.0,
            lp_freq: 200.0,
            hp_freq: 2000.0,
            mid_q: 0.7,
            insertion_loss: 0.5,
        };
        ts.update_coefficients();
        ts
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        let changed = match name {
            "toneStackType" => {
                self.stack_type = ToneStackType::from_index(value as u32);
                true
            }
            "bass" => {
                self.bass = value / 10.0;
                true
            }
            "mid" => {
                self.mid = value / 10.0;
                true
            }
            "treble" => {
                self.treble = value / 10.0;
                true
            }
            "brightCap" => {
                self.bright_cap = value > 0.5;
                true
            }
            _ => false,
        };
        if changed {
            self.update_coefficients();
        }
    }

    /// Recompute filter coefficients based on knob positions.
    /// This models the interaction between controls in a passive tone stack.
    fn update_coefficients(&mut self) {
        let circuit = match self.stack_type {
            ToneStackType::Fender => ToneStackCircuit::fender(),
            ToneStackType::Marshall => ToneStackCircuit::marshall(),
            ToneStackType::Vox => ToneStackCircuit::vox(),
        };

        // Bass control affects low-pass turnover frequency
        // Treble control affects high-pass turnover frequency
        // Mid control affects the depth of the mid scoop
        // All interact because they share the passive network

        let bass_r = circuit.r1 * (1.0 - self.bass) + circuit.r3;
        let treble_r = circuit.r2 * (1.0 - self.treble) + circuit.r4;

        self.lp_freq = 1.0 / (2.0 * PI * bass_r * circuit.c2);
        self.hp_freq = 1.0 / (2.0 * PI * treble_r * circuit.c1);

        // Mid Q depends on both bass and treble positions (interaction)
        self.mid_q = 0.3 + self.mid * 1.5 + (self.bass - self.treble).abs() * 0.3;

        // Passive network insertion loss (typically -8 to -15 dB)
        self.insertion_loss = 0.15 + self.mid * 0.3;

        // Bright cap effect: increase treble at low gain
        if self.bright_cap {
            self.hp_freq *= 0.7; // shift treble response down
        }

        // Clamp to valid ranges
        self.lp_freq = self.lp_freq.clamp(50.0, 2000.0);
        self.hp_freq = self.hp_freq.clamp(500.0, 15000.0);
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        let dt = 1.0 / self.sample_rate;

        // Low-pass path (bass)
        let lp_coeff = (2.0 * PI * self.lp_freq * dt).min(0.99);
        self.lp_state = flush_denormal(self.lp_state + lp_coeff * (input - self.lp_state));
        let lp_out = self.lp_state * self.bass;

        // High-pass path (treble)
        let hp_coeff = (2.0 * PI * self.hp_freq * dt).min(0.99);
        self.hp_state = flush_denormal(self.hp_state + hp_coeff * (input - self.hp_state));
        let hp_out = (input - self.hp_state) * self.treble;

        // Band-pass path (mid) — derived from interaction
        let mid_freq = (self.lp_freq * self.hp_freq).sqrt();
        let bp_coeff = (2.0 * PI * mid_freq * dt).min(0.99);
        self.bp_state = flush_denormal(self.bp_state + bp_coeff * (input - self.bp_state));
        let bp_raw = self.bp_state - self.lp_state;
        let bp_out = bp_raw * self.mid * self.mid_q;

        // Sum with passive network insertion loss
        let output = (lp_out + bp_out + hp_out) * self.insertion_loss;

        output
    }

    pub fn reset(&mut self) {
        self.lp_state = 0.0;
        self.bp_state = 0.0;
        self.hp_state = 0.0;
    }
}
