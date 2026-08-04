//! CR-78 drum voices — simplified bridged-T with single-transistor VCA.
//!
//! Two modes:
//!   Drum: bridged-T oscillator with simpler envelope (less defined transients, organic decay).
//!   Metallic: Three filtered square waves through an RLC resonator (inductor-based filter),
//!             modeled as second-order bandpass biquad with Q≈10–15.
//!
//! Hi-hat: Square waves mixed with white noise through a bridged-T bandpass filter.
//! The CR-78 sounds more delicate and organic than the 808, owing to simpler VCA envelopes.

use crate::primitives::flush_denormal;
use crate::toaster::bridged_t::BridgedTFilter;
use crate::toaster::dc_block::DcBlocker;
use crate::toaster::poly_blep::PolyBlepSquare;

pub enum Cr78Mode {
    /// Drum voice: bridged-T resonator (kick, snare, tom variants)
    Drum {
        r_eff: f32,
        r_shunt: f32,
        c1: f32,
        c2: f32,
        decay_s: f32,
    },
    /// Metallic voice: 3 square waves through RLC bandpass biquad (cowbell, metallic beat)
    Metallic {
        freq1: f32,
        freq2: f32,
        freq3: f32,
        rlc_freq: f32,
        rlc_q: f32,
        decay_s: f32,
    },
}

pub struct Cr78Engine {
    mode: Cr78Mode,

    // Drum mode
    bridged_t: BridgedTFilter,

    // Metallic mode: 3 square oscillators
    osc1: PolyBlepSquare,
    osc2: PolyBlepSquare,
    osc3: PolyBlepSquare,
    rlc_s1: f32,
    rlc_s2: f32,
    rlc_b0: f32,
    rlc_b1: f32,
    rlc_b2: f32,
    rlc_a1: f32,
    rlc_a2: f32,

    // Amplitude envelope (simpler single-transistor VCA — slightly looser than 808)
    amp_env: f32,
    amp_decay_coeff: f32,

    // DC blocker
    dc_block: DcBlocker,

    // Parameters
    decay: f32,
    tune: f32,

    active: bool,
    sample_rate: f32,
}

impl Cr78Engine {
    /// Create a CR-78 drum voice (bridged-T).
    pub fn new_drum(sample_rate: f32) -> Self {
        // Default: "kick-like" at ~100 Hz
        Self::new_drum_with_params(
            sample_rate,
            30_000.0,  // r_eff
            820_000.0, // r_shunt
            8e-9,      // c1
            8e-9,      // c2
            0.15,      // decay_s
        )
    }

    pub fn new_drum_with_params(
        sample_rate: f32,
        r_eff: f32,
        r_shunt: f32,
        c1: f32,
        c2: f32,
        decay_s: f32,
    ) -> Self {
        let mut bridged_t = BridgedTFilter::new();
        bridged_t.update_coefficients(r_eff, r_shunt, c1, c2, sample_rate);

        Self {
            mode: Cr78Mode::Drum {
                r_eff,
                r_shunt,
                c1,
                c2,
                decay_s,
            },
            bridged_t,
            osc1: PolyBlepSquare::new(100.0),
            osc2: PolyBlepSquare::new(200.0),
            osc3: PolyBlepSquare::new(300.0),
            rlc_s1: 0.0,
            rlc_s2: 0.0,
            rlc_b0: 0.0,
            rlc_b1: 0.0,
            rlc_b2: 0.0,
            rlc_a1: 0.0,
            rlc_a2: 0.0,
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            dc_block: DcBlocker::new(sample_rate),
            decay: 0.5,
            tune: 0.0,
            active: false,
            sample_rate,
        }
    }

    /// Create a CR-78 metallic voice (RLC biquad bandpass).
    pub fn new_metallic(sample_rate: f32) -> Self {
        // Default metallic beat: three square waves through RLC at ~700 Hz, Q≈12
        Self::new_metallic_with_params(
            sample_rate,
            300.0,
            420.0,
            550.0, // three square wave freqs
            700.0,
            12.0, // RLC center + Q
            0.3,  // decay_s
        )
    }

    pub fn new_metallic_with_params(
        sample_rate: f32,
        freq1: f32,
        freq2: f32,
        freq3: f32,
        rlc_freq: f32,
        rlc_q: f32,
        decay_s: f32,
    ) -> Self {
        let (b0, b1, b2, a1, a2) = compute_rlc_biquad(rlc_freq, rlc_q, sample_rate);

        Self {
            mode: Cr78Mode::Metallic {
                freq1,
                freq2,
                freq3,
                rlc_freq,
                rlc_q,
                decay_s,
            },
            bridged_t: BridgedTFilter::new(),
            osc1: PolyBlepSquare::new(freq1),
            osc2: PolyBlepSquare::new(freq2),
            osc3: PolyBlepSquare::new(freq3),
            rlc_s1: 0.0,
            rlc_s2: 0.0,
            rlc_b0: b0,
            rlc_b1: b1,
            rlc_b2: b2,
            rlc_a1: a1,
            rlc_a2: a2,
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            dc_block: DcBlocker::new(sample_rate),
            decay: 0.5,
            tune: 0.0,
            active: false,
            sample_rate,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.active = true;
        self.amp_env = velocity;

        let base_decay_s = match &self.mode {
            Cr78Mode::Drum { decay_s, .. } => *decay_s,
            Cr78Mode::Metallic { decay_s, .. } => *decay_s,
        };
        let decay_s = base_decay_s * (0.5 + self.decay);
        self.amp_decay_coeff = (-1.0 / (decay_s * sample_rate)).exp();

        match &self.mode {
            Cr78Mode::Drum {
                r_eff,
                r_shunt,
                c1,
                c2,
                ..
            } => {
                let (r_eff, r_shunt, c1, c2) = (*r_eff, *r_shunt, *c1, *c2);
                self.bridged_t.reset();
                self.bridged_t
                    .update_coefficients(r_eff, r_shunt, c1, c2, sample_rate);
            }
            Cr78Mode::Metallic {
                freq1,
                freq2,
                freq3,
                rlc_freq,
                rlc_q,
                ..
            } => {
                let (f1, f2, f3, rf, rq) = (*freq1, *freq2, *freq3, *rlc_freq, *rlc_q);
                let tune_ratio = (self.tune / 12.0_f32).exp2();
                self.osc1.set_freq(f1 * tune_ratio);
                self.osc2.set_freq(f2 * tune_ratio);
                self.osc3.set_freq(f3 * tune_ratio);
                self.osc1.reset();
                self.osc2.reset();
                self.osc3.reset();
                let (b0, b1, b2, a1, a2) = compute_rlc_biquad(rf * tune_ratio, rq, sample_rate);
                self.rlc_b0 = b0;
                self.rlc_b1 = b1;
                self.rlc_b2 = b2;
                self.rlc_a1 = a1;
                self.rlc_a2 = a2;
                self.rlc_s1 = 0.0;
                self.rlc_s2 = 0.0;
            }
        }

        self.dc_block.reset();
    }

    pub fn release(&mut self) {}

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if !self.active || self.amp_env < 1e-6 {
            self.active = false;
            return 0.0;
        }

        let signal = match self.mode {
            Cr78Mode::Drum { .. } => {
                // Self-decaying bridged-T oscillator
                self.bridged_t.process(self.amp_env)
            }
            Cr78Mode::Metallic { .. } => {
                let s = self.osc1.tick(sample_rate)
                    + self.osc2.tick(sample_rate)
                    + self.osc3.tick(sample_rate);
                let mixed = s / 3.0;

                // RLC bandpass biquad (TDF-II)
                let out = self.rlc_b0 * mixed + self.rlc_s1;
                self.rlc_s1 = self.rlc_b1 * mixed - self.rlc_a1 * out + self.rlc_s2;
                self.rlc_s2 = self.rlc_b2 * mixed - self.rlc_a2 * out;

                self.rlc_s1 = flush_denormal(self.rlc_s1);
                self.rlc_s2 = flush_denormal(self.rlc_s2);

                out
            }
        };

        self.amp_env *= self.amp_decay_coeff;
        let output = self.dc_block.process(signal * self.amp_env);

        if self.amp_env < 1e-6 {
            self.active = false;
        }

        output
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "decay" => self.decay = value.clamp(0.0, 1.0),
            "tune" => self.tune = value.clamp(-24.0, 24.0),
            _ => {}
        }
    }
}

/// Compute second-order bandpass biquad coefficients for RLC resonator.
/// Q≈10–15 to capture inductor resonant character.
fn compute_rlc_biquad(freq: f32, q: f32, sample_rate: f32) -> (f32, f32, f32, f32, f32) {
    use core::f32::consts::TAU;
    // Analog bandpass: H(s) = (ω₀/Q)s / (s² + (ω₀/Q)s + ω₀²)
    // Via bilinear transform with prewarping
    let w0 = TAU * freq;
    let bw = w0 / q;

    // Bilinear transform
    let c = 2.0 * sample_rate;
    let d = c * c + bw * c + w0 * w0;
    let b0 = bw * c / d;
    let b1 = 0.0_f32;
    let b2 = -bw * c / d;
    let a1 = (2.0 * w0 * w0 - 2.0 * c * c) / d;
    let a2 = (c * c - bw * c + w0 * w0) / d;

    (b0, b1, b2, a1, a2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cr78_drum_renders_cleanly() {
        let sample_rate = 48_000.0_f32;
        let mut engine = Cr78Engine::new_drum(sample_rate);
        engine.trigger(1.0, sample_rate);

        for i in 0..48_000 {
            let s = engine.tick(sample_rate);
            assert!(!s.is_nan(), "NaN at sample {i}");
            assert!(!s.is_infinite(), "Inf at sample {i}");
        }
    }

    #[test]
    fn cr78_metallic_renders_cleanly() {
        let sample_rate = 48_000.0_f32;
        let mut engine = Cr78Engine::new_metallic(sample_rate);
        engine.trigger(1.0, sample_rate);

        for i in 0..48_000 {
            let s = engine.tick(sample_rate);
            assert!(!s.is_nan(), "NaN at sample {i}");
            assert!(!s.is_infinite(), "Inf at sample {i}");
        }
    }
}
