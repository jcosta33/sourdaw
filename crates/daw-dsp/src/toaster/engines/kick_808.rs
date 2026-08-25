//! TR-808 kick drum — circuit-faithful bridged-T resonator model.
//!
//! Based on Werner's 2016 Stanford dissertation analysis of the Roland TR-808 bass drum circuit.
//!
//! Six-block cascade: trigger logic → pulse shaper (1N4148 diode clip) → bridged-T →
//! feedback buffer (high-shelf) → envelope → output (tone LPF + DC block).
//!
//! Component values from Roland TR-808 service manual (June 1981):
//!   R165 = 47kΩ, R166 = 6.8kΩ, R167 = 1MΩ, C41 = C42 = 15nF
//!
//! Adapted from mi-plaits-dsp-rs by Oliver Rockstedt (sourcebox)
//! Original: Mutable Instruments Plaits by Émilie Gillet
//! License: MIT — Copyright (c) 2022 Oliver Rockstedt
//! https://github.com/sourcebox/mi-plaits-dsp-rs

use crate::toaster::adaa::pulse_shape_diode;

#[inline]
fn fast_tanh(x: f32) -> f32 {
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}
use crate::toaster::bridged_t::BridgedTFilter;
use crate::toaster::dc_block::DcBlocker;
use crate::toaster::tolerance::{cap, prng_state, res};

// Roland TR-808 service manual component values
const R165_NOM: f32 = 47_000.0; // Ω
const R166_NOM: f32 = 6_800.0; // Ω
const R167_NOM: f32 = 1_000_000.0; // Ω
const C41_NOM: f32 = 15e-9; // F
const C42_NOM: f32 = 15e-9; // F

// Decay range
const DECAY_MIN_S: f32 = 0.05;
const DECAY_MAX_S: f32 = 0.8;
const DECAY_CENTER_S: f32 = 0.3;

/// TR-808 kick drum engine.
pub struct Kick808Engine {
    // Component values (may be jittered by tolerance seed)
    r166: f32,
    r167: f32,
    c41: f32,
    c42: f32,
    // R_eff range
    r_eff_attack: f32, // R166 alone (~6.8kΩ) — during attack pulse
    r_eff_rest: f32,   // R165+R166 (~53.8kΩ) — resting state

    // Bridged-T filter
    bridged_t: BridgedTFilter,

    // Envelope state
    amp_env: f32,
    amp_decay_coeff: f32,

    // Pitch envelope (controls R_eff sweep)
    pitch_env: f32,
    pitch_decay_coeff: f32,

    // Pitch "sigh" — slow drift from attack freq back to rest freq
    sigh_phase: f32, // 0 = attack, 1 = fully sighed (resting)
    sigh_coeff: f32,

    // Feedback buffer state (first-order high-shelf, decay-controlled)
    fb_state: f32,
    fb_gain: f32,
    fb_hs_state: f32, // LPF state for high-shelf computation
    fb_hs_coeff: f32, // one-pole LPF coeff for shelf at ~800 Hz

    // Pulse shaper ADAA state
    ps_xprev: f32,
    ps_f1_xprev: f32,

    // Tone LPF
    tone_state: f32,
    tone_coeff: f32,

    // DC blocker
    dc_block: DcBlocker,

    // Parameters
    decay: f32, // 0..1 normalized
    tune: f32,  // semitones offset

    // Velocity (for accent behavior)
    velocity: f32,

    // Active flag
    active: bool,
}

impl Kick808Engine {
    pub fn new(sample_rate: f32) -> Self {
        Self::with_tolerance(sample_rate, 0)
    }

    pub fn with_tolerance(sample_rate: f32, tolerance_seed: u32) -> Self {
        let mut state = prng_state(tolerance_seed);
        let r165 = res(R165_NOM, &mut state);
        let r166 = res(R166_NOM, &mut state);
        let r167 = res(R167_NOM, &mut state);
        let c41 = cap(C41_NOM, &mut state);
        let c42 = cap(C42_NOM, &mut state);

        let r_eff_attack = r166;
        let r_eff_rest = r165 + r166;

        let mut engine = Self {
            r166,
            r167,
            c41,
            c42,
            r_eff_attack,
            r_eff_rest,
            bridged_t: BridgedTFilter::new(),
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            pitch_env: 0.0,
            pitch_decay_coeff: 0.0,
            sigh_phase: 1.0, // start at rest
            sigh_coeff: 0.0,
            fb_state: 0.0,
            fb_gain: 0.5,
            fb_hs_state: 0.0,
            fb_hs_coeff: (-2.0 * core::f32::consts::PI * 800.0 / sample_rate).exp(),
            ps_xprev: 0.0,
            ps_f1_xprev: 0.0,
            tone_state: 0.0,
            tone_coeff: 0.9,
            dc_block: DcBlocker::new(sample_rate),
            decay: 0.5,
            tune: 0.0,
            velocity: 1.0,
            active: false,
        };

        // Initialize bridged-T at resting R_eff
        engine
            .bridged_t
            .update_coefficients(r_eff_rest, r167, c41, c42, sample_rate);

        engine
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.velocity = velocity.clamp(0.0, 1.0);
        self.active = true;

        // Amplitude envelope
        // Accent: velocity maps to 5V–15V trigger range. Higher velocity = more energy.
        self.amp_env = velocity;
        let decay_s = DECAY_MIN_S + self.decay * (DECAY_MAX_S - DECAY_MIN_S);
        self.amp_decay_coeff = (-1.0 / (decay_s * sample_rate)).exp();

        // Pitch envelope: fast ~5ms attack pulse
        self.pitch_env = 1.0;
        self.pitch_decay_coeff = (-1.0 / (0.005 * sample_rate)).exp();

        // Sigh: slow drift back to rest frequency ~300ms
        self.sigh_phase = 0.0;
        self.sigh_coeff = (-1.0 / (0.3 * sample_rate)).exp();

        // Reset filter state to avoid click from stale oscillation
        self.bridged_t.reset();
        self.fb_state = 0.0;
        self.fb_hs_state = 0.0;
        self.fb_hs_coeff = (-2.0 * core::f32::consts::PI * 800.0 / sample_rate).exp();
        self.dc_block.reset();
        self.ps_xprev = 0.0;
        self.ps_f1_xprev = 0.0;
    }

    pub fn release(&mut self) {
        // Kick is envelope-driven; release does nothing.
    }

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if !self.active || self.amp_env < 1e-6 {
            self.active = false;
            return 0.0;
        }

        // --- Pitch envelope → R_eff sweep ---
        // Fast attack pulse: R_eff starts at r_eff_attack, sigh drifts to r_eff_rest
        self.pitch_env *= self.pitch_decay_coeff;
        self.sigh_phase = 1.0 - (1.0 - self.sigh_phase) * self.sigh_coeff;

        // R_eff controlled by pitch_env (attack chirp) and sigh_phase (slow drift)
        // During attack (~5ms): R_eff ≈ r_eff_attack → high fc (~130Hz)
        // After attack: R_eff drifts toward r_eff_rest → low fc (~49Hz)
        let r_eff = self.r_eff_attack
            + (self.r_eff_rest - self.r_eff_attack)
                * (1.0 - self.pitch_env * (1.0 - self.sigh_phase));

        // Per-sample coefficient update (critical during attack phase)
        self.bridged_t
            .update_coefficients(r_eff, self.r167, self.c41, self.c42, sample_rate);

        // --- Pulse shaper excitation ---
        // Accent: trigger voltage scales pulse amplitude (5V unaccented, 15V full accent)
        // Map velocity [0,1] → [5,15]V, normalize back to [-1,1] output range
        let trigger_voltage = 5.0 + self.velocity * 10.0;
        let pulse_in = self.amp_env * trigger_voltage * 0.05; // normalize

        // 1N4148 diode clip (ADAA first-order)
        let f_xn = pulse_shape_diode(pulse_in);
        let f1_xn = pulse_shape_diode_antiderivative(pulse_in);
        let dx = pulse_in - self.ps_xprev;
        let excitation = if dx.abs() > 1e-7 {
            (f1_xn - self.ps_f1_xprev) / dx
        } else {
            f_xn
        };
        self.ps_xprev = pulse_in;
        self.ps_f1_xprev = f1_xn;

        // --- Bridged-T resonator (with unit delay feedback to break delay-free loop) ---
        // Feedback gain < 1.0 to ensure stability. The decay knob controls this.
        let fb_gain = self.fb_gain * (0.3 + self.decay * 0.5); // 0.15..0.4
        let resonator_in = excitation + self.fb_state * fb_gain;
        let resonator_out = self.bridged_t.process(resonator_in);

        // Soft-clip the resonator output to prevent runaway
        let resonator_clipped = fast_tanh(resonator_out);

        // First-order high-shelf in feedback path: y = x + hs_gain * (x - lpf(x))
        // hs_gain scales with decay: higher decay → more high-frequency boost → longer sustain
        let hs_gain = self.decay * 0.5; // 0..0.5 range
        let lpf_out =
            self.fb_hs_coeff * self.fb_hs_state + (1.0 - self.fb_hs_coeff) * resonator_clipped;
        self.fb_hs_state = lpf_out;
        self.fb_state = resonator_clipped + hs_gain * (resonator_clipped - lpf_out);

        // --- Amplitude envelope ---
        self.amp_env *= self.amp_decay_coeff;

        let signal = resonator_clipped * self.amp_env;

        // --- Tone LPF ---
        self.tone_state += self.tone_coeff * (signal - self.tone_state);

        // --- DC blocker ---
        let output = self.dc_block.process(self.tone_state);

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
            "decay" => {
                self.decay = value.clamp(0.0, 1.0);
            }
            "tune" => {
                self.tune = value.clamp(-24.0, 24.0);
            }
            "tone" => {
                // Tone controls tone LPF coefficient
                self.tone_coeff = (value.clamp(0.0, 1.0) * 0.99).max(0.01);
            }
            "level" | "volume" => {
                // Level handled upstream
            }
            _ => {}
        }
    }
}

/// Numerical antiderivative of the pulse-shaper diode nonlinearity.
/// f(v) = v if v >= 0, else -0.71 * (exp(v) - 1)
/// F1(v) = v²/2 if v >= 0, else -0.71 * (exp(v) - v - 1)
#[inline]
fn pulse_shape_diode_antiderivative(v: f32) -> f32 {
    if v >= 0.0 {
        v * v * 0.5
    } else {
        -0.71 * (v.exp() - v - 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kick808 renders 1 second at 48 kHz without NaN/Inf.
    #[test]
    fn kick_808_renders_cleanly() {
        let sample_rate = 48_000.0_f32;
        let mut engine = Kick808Engine::new(sample_rate);
        engine.trigger(1.0, sample_rate);

        for i in 0..48_000 {
            let s = engine.tick(sample_rate);
            assert!(!s.is_nan(), "NaN at sample {i}");
            assert!(!s.is_infinite(), "Inf at sample {i}");
        }
    }

    /// Accent at velocity=1.0 should have longer ring than velocity=0.5.
    /// We verify by comparing RMS energy in the second 100ms window.
    #[test]
    fn kick_808_accent_affects_ring_time() {
        let sample_rate = 48_000.0_f32;
        let window_start = (sample_rate * 0.1) as usize;
        let window_end = (sample_rate * 0.2) as usize;

        let energy = |vel: f32| {
            let mut engine = Kick808Engine::new(sample_rate);
            engine.trigger(vel, sample_rate);
            let mut sum = 0.0_f32;
            for i in 0..window_end {
                let s = engine.tick(sample_rate);
                if i >= window_start {
                    sum += s * s;
                }
            }
            sum
        };

        let energy_full = energy(1.0);
        let energy_half = energy(0.5);

        // Full accent should produce more energy in the decay tail
        assert!(
            energy_full > energy_half,
            "Full accent energy {energy_full:.6} should exceed half accent {energy_half:.6}"
        );
    }

    /// Component tolerance produces different center frequencies with different seeds.
    #[test]
    fn kick_808_tolerance_varies_per_seed() {
        let sample_rate = 48_000.0_f32;
        let mut e1 = Kick808Engine::with_tolerance(sample_rate, 1);
        let mut e2 = Kick808Engine::with_tolerance(sample_rate, 42);

        e1.trigger(1.0, sample_rate);
        e2.trigger(1.0, sample_rate);

        // Collect first 256 samples and compare RMS — should differ due to different fc
        let collect = |engine: &mut Kick808Engine| {
            (0..256)
                .map(|_| engine.tick(sample_rate))
                .collect::<Vec<_>>()
        };
        let s1 = collect(&mut e1);
        let s2 = collect(&mut e2);
        let diff_rms = (s1
            .iter()
            .zip(s2.iter())
            .map(|(a, b)| (a - b) * (a - b))
            .sum::<f32>()
            / 256.0)
            .sqrt();
        assert!(
            diff_rms > 1e-6,
            "Different seeds should produce measurably different output; diff_rms={diff_rms}"
        );
    }
}
