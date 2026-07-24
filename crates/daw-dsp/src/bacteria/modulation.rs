//! Modulation sources for Bacteria: LFO, envelope follower, Lorenz attractor.

use crate::primitives::flush_denormal;
use std::f32::consts::PI;

/// LFO shape.
#[derive(Clone, Copy)]
pub enum LfoShape {
    Sine,
    Triangle,
    Saw,
    Square,
    SampleAndHold,
}

impl LfoShape {
    pub fn from_index(i: u32) -> Self {
        match i {
            0 => Self::Sine,
            1 => Self::Triangle,
            2 => Self::Saw,
            3 => Self::Square,
            _ => Self::SampleAndHold,
        }
    }
}

/// Low-frequency oscillator.
pub struct Lfo {
    phase: f32,
    rate: f32,
    shape: LfoShape,
    amount: f32,
    sample_rate: f32,
    sh_value: f32,
}

impl Lfo {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            phase: 0.0,
            rate: 2.0,
            shape: LfoShape::Sine,
            amount: 0.5,
            sample_rate,
            sh_value: 0.0,
        }
    }

    pub fn set_rate(&mut self, hz: f32) {
        self.rate = hz.max(0.001);
    }

    pub fn set_shape(&mut self, shape: LfoShape) {
        self.shape = shape;
    }

    pub fn set_amount(&mut self, amount: f32) {
        self.amount = amount;
    }

    /// Compute next LFO value in [-1, 1] range.
    pub fn next(&mut self) -> f32 {
        let phase_inc = self.rate / self.sample_rate;
        self.phase += phase_inc;

        if self.phase >= 1.0 {
            self.phase -= 1.0;
            // Update S&H on phase wrap
            if matches!(self.shape, LfoShape::SampleAndHold) {
                // Simple pseudo-random using phase fraction
                self.sh_value = (self.phase * 12345.6789).sin();
            }
        }

        let raw = match self.shape {
            LfoShape::Sine => (self.phase * 2.0 * PI).sin(),
            LfoShape::Triangle => {
                if self.phase < 0.5 {
                    4.0 * self.phase - 1.0
                } else {
                    3.0 - 4.0 * self.phase
                }
            }
            LfoShape::Saw => 2.0 * self.phase - 1.0,
            LfoShape::Square => {
                if self.phase < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            LfoShape::SampleAndHold => self.sh_value,
        };

        raw * self.amount
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
    }
}

/// Envelope follower for amplitude-tracking modulation.
pub struct EnvelopeFollower {
    level: f32,
    attack_coeff: f32,
    release_coeff: f32,
    sample_rate: f32,
}

impl EnvelopeFollower {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            level: 0.0,
            attack_coeff: Self::time_to_coeff(5.0, sample_rate),
            release_coeff: Self::time_to_coeff(200.0, sample_rate),
            sample_rate,
        }
    }

    fn time_to_coeff(ms: f32, sample_rate: f32) -> f32 {
        (-1.0 / (ms.max(0.01) * 0.001 * sample_rate)).exp()
    }

    pub fn set_attack(&mut self, ms: f32) {
        self.attack_coeff = Self::time_to_coeff(ms, self.sample_rate);
    }

    pub fn set_release(&mut self, ms: f32) {
        self.release_coeff = Self::time_to_coeff(ms, self.sample_rate);
    }

    /// Process one sample and return the current envelope level [0, 1].
    pub fn process(&mut self, input: f32) -> f32 {
        let abs_in = input.abs();
        if abs_in > self.level {
            self.level = flush_denormal(abs_in + self.attack_coeff * (self.level - abs_in));
        } else {
            self.level = flush_denormal(abs_in + self.release_coeff * (self.level - abs_in));
        }
        self.level
    }

    pub fn reset(&mut self) {
        self.level = 0.0;
    }
}

/// Lorenz attractor — chaotic modulation source.
/// Uses 4th-order Runge-Kutta integration.
pub struct LorenzAttractor {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub sigma: f32,
    pub rho: f32,
    pub beta: f32,
    pub speed: f32,
    sample_rate: f32,
}

impl LorenzAttractor {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            x: 0.1,
            y: 0.0,
            z: 0.0,
            sigma: 10.0,
            rho: 28.0,
            beta: 8.0 / 3.0,
            speed: 1.0,
            sample_rate,
        }
    }

    /// Advance one step using RK4 integration.
    /// Returns normalized (x, z) values in approximately [-1, 1].
    pub fn next(&mut self) -> (f32, f32) {
        let dt = self.speed / self.sample_rate;

        // RK4 integration
        let (k1x, k1y, k1z) = self.derivatives(self.x, self.y, self.z);
        let (k2x, k2y, k2z) = self.derivatives(
            self.x + 0.5 * dt * k1x,
            self.y + 0.5 * dt * k1y,
            self.z + 0.5 * dt * k1z,
        );
        let (k3x, k3y, k3z) = self.derivatives(
            self.x + 0.5 * dt * k2x,
            self.y + 0.5 * dt * k2y,
            self.z + 0.5 * dt * k2z,
        );
        let (k4x, k4y, k4z) =
            self.derivatives(self.x + dt * k3x, self.y + dt * k3y, self.z + dt * k3z);

        self.x += dt / 6.0 * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
        self.y += dt / 6.0 * (k1y + 2.0 * k2y + 2.0 * k3y + k4y);
        self.z += dt / 6.0 * (k1z + 2.0 * k2z + 2.0 * k3z + k4z);

        // Normalize to ~[-1, 1] range (Lorenz attractor typically stays within ±30 for x, ±50 for z)
        let norm_x = (self.x / 30.0).clamp(-1.0, 1.0);
        let norm_z = ((self.z - 25.0) / 25.0).clamp(-1.0, 1.0);

        (norm_x, norm_z)
    }

    fn derivatives(&self, x: f32, y: f32, z: f32) -> (f32, f32, f32) {
        let dx = self.sigma * (y - x);
        let dy = x * (self.rho - z) - y;
        let dz = x * y - self.beta * z;
        (dx, dy, dz)
    }

    pub fn reset(&mut self) {
        self.x = 0.1;
        self.y = 0.0;
        self.z = 0.0;
    }
}
