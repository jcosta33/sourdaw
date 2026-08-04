//! TR-909 kick drum — VCO with diode waveshaper.
//!
//! Two parallel signal paths:
//!   Upper path (tone): VCO triangle/sawtooth soft-clipped by back-to-back 1N4148 diodes.
//!     EG3 provides pitch sweep down to resting frequency ~55 Hz.
//!     VCO phase resets on every trigger for consistent click.
//!   Lower path (attack/click): Trigger → LPF → BPF transient, mixed with LFSR noise.
//!
//! Key difference from 808: VCO + explicit envelopes (not self-decaying resonant circuit).
//! Results in more midrange punch, less sub-bass, audible click.

use super::lfsr::Lfsr31;
use crate::primitives::flush_denormal_in_place;
use crate::toaster::adaa::{adaa_first_order, antiderivative_tanh};
use crate::toaster::dc_block::DcBlocker;

const RESTING_FREQ: f32 = 55.0; // Hz (~55 Hz default resting pitch)
const PITCH_SWEEP_RANGE: f32 = 2.0; // octaves of pitch sweep on attack (EG3): 55 Hz × 2² = 220 Hz start

pub struct Kick909Engine {
    // VCO state
    phase: f32,
    freq: f32,

    // Pitch envelope (EG3)
    pitch_env: f32,
    pitch_decay_coeff: f32,

    // Amplitude envelope
    amp_env: f32,
    amp_decay_coeff: f32,

    // Click/attack path
    click_env: f32,
    click_decay_coeff: f32,

    // Click LPF + BPF states
    click_lpf: f32,
    click_bp_ic1: f32,
    click_bp_ic2: f32,

    // ADAA state for diode waveshaper
    ws_xprev: f32,
    ws_f1_xprev: f32,

    // LFSR for click path noise
    lfsr: Lfsr31,

    // DC blocker
    dc_block: DcBlocker,

    // Parameters
    decay: f32,
    tune: f32,   // semitones
    attack: f32, // click attack amount 0..1

    active: bool,
    sample_rate: f32,
}

impl Kick909Engine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            phase: 0.0,
            freq: RESTING_FREQ,
            pitch_env: 0.0,
            pitch_decay_coeff: 0.0,
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            click_env: 0.0,
            click_decay_coeff: 0.0,
            click_lpf: 0.0,
            click_bp_ic1: 0.0,
            click_bp_ic2: 0.0,
            ws_xprev: 0.0,
            ws_f1_xprev: antiderivative_tanh(0.0),
            lfsr: Lfsr31::new(0x00000001),
            dc_block: DcBlocker::new(sample_rate),
            decay: 0.5,
            tune: 0.0,
            attack: 0.5,
            active: false,
            sample_rate,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.active = true;

        // VCO phase reset on trigger (consistent attack regardless of phase)
        self.phase = 0.0;

        // Base frequency with tune
        self.freq = RESTING_FREQ * (2.0_f32).powf(self.tune / 12.0);

        // Pitch envelope: instant attack, decay controls sweep duration
        self.pitch_env = 1.0;
        let pitch_decay_s = 0.03 + self.decay * 0.07; // 30..100ms
        self.pitch_decay_coeff = (-1.0 / (pitch_decay_s * sample_rate)).exp();

        // Amplitude envelope
        self.amp_env = velocity;
        let amp_decay_s = 0.05 + self.decay * 0.55; // 50..600ms
        self.amp_decay_coeff = (-1.0 / (amp_decay_s * sample_rate)).exp();

        // Click envelope: very short ~5ms
        self.click_env = velocity * self.attack;
        self.click_decay_coeff = (-1.0 / (0.005 * sample_rate)).exp();

        // Reset states (including LFSR to fixed initial state for consistent attack)
        self.click_lpf = 0.0;
        self.click_bp_ic1 = 0.0;
        self.click_bp_ic2 = 0.0;
        self.ws_xprev = 0.0;
        self.ws_f1_xprev = antiderivative_tanh(0.0);
        self.lfsr.reset(0x00000001);
        self.dc_block.reset();
    }

    pub fn release(&mut self) {}

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if !self.active || self.amp_env < 1e-6 {
            self.active = false;
            return 0.0;
        }

        // Pitch envelope: EG3 sweeps frequency down to resting pitch
        self.pitch_env *= self.pitch_decay_coeff;
        let current_freq = self.freq * (2.0_f32).powf(self.pitch_env * PITCH_SWEEP_RANGE);

        // VCO: triangle/sawtooth mix
        self.phase += current_freq / sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        // Triangle wave: /\  shape
        let triangle = if self.phase < 0.5 {
            4.0 * self.phase - 1.0
        } else {
            3.0 - 4.0 * self.phase
        };

        // Diode waveshaper (back-to-back 1N4148 ≈ soft clip)
        // Transfer function: V_clip × tanh(x / V_clip), V_clip ≈ 0.65V
        let v_clip = 0.65_f32;
        let ws_in = triangle / v_clip;
        let f_xn = ws_in.tanh() * v_clip;
        let f1_xn = antiderivative_tanh(ws_in) * v_clip;
        let shaped = adaa_first_order(f1_xn, self.ws_f1_xprev, ws_in, self.ws_xprev, f_xn);
        self.ws_xprev = ws_in;
        self.ws_f1_xprev = f1_xn;

        // Amplitude envelope
        self.amp_env *= self.amp_decay_coeff;
        let tone_signal = shaped * self.amp_env;

        // Click/attack path: LFSR noise → LPF → BPF
        let noise = self.lfsr.step();
        self.click_lpf += 0.3 * (noise - self.click_lpf); // one-pole LPF
        let click_filtered = svf_bandpass_909(
            self.click_lpf,
            2500.0,
            1.5,
            sample_rate,
            &mut self.click_bp_ic1,
            &mut self.click_bp_ic2,
        );

        self.click_env *= self.click_decay_coeff;
        let click_signal = click_filtered * self.click_env;

        let mixed = tone_signal + click_signal * 0.3;
        let output = self.dc_block.process(mixed);

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
            "attack" => self.attack = value.clamp(0.0, 1.0),
            _ => {}
        }
    }
}

#[inline]
fn svf_bandpass_909(
    input: f32,
    freq: f32,
    q: f32,
    sample_rate: f32,
    ic1: &mut f32,
    ic2: &mut f32,
) -> f32 {
    use core::f32::consts::TAU;
    let g = (TAU * freq / sample_rate * 0.5).tan();
    let k = 1.0 / q;
    let a1 = 1.0 / (1.0 + g * (g + k));
    let a2 = g * a1;
    let a3 = g * a2;

    let v3 = input - *ic2;
    let v1 = a1 * (*ic1) + a2 * v3;
    let v2 = *ic2 + a2 * (*ic1) + a3 * v3;
    *ic1 = 2.0 * v1 - *ic1;
    *ic2 = 2.0 * v2 - *ic2;

    flush_denormal_in_place(ic1);
    flush_denormal_in_place(ic2);

    v1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kick_909_renders_cleanly() {
        let sample_rate = 48_000.0_f32;
        let mut engine = Kick909Engine::new(sample_rate);
        engine.trigger(1.0, sample_rate);

        for i in 0..48_000 {
            let s = engine.tick(sample_rate);
            assert!(!s.is_nan(), "NaN at sample {i}");
            assert!(!s.is_infinite(), "Inf at sample {i}");
        }
    }

    /// Phase resets on trigger — two triggers should produce same first few samples.
    #[test]
    fn kick_909_phase_resets_on_trigger() {
        let sample_rate = 48_000.0_f32;
        let mut engine = Kick909Engine::new(sample_rate);

        engine.trigger(1.0, sample_rate);
        let first_10: Vec<f32> = (0..10).map(|_| engine.tick(sample_rate)).collect();

        // Let engine run a bit, then retrigger
        for _ in 0..1000 {
            engine.tick(sample_rate);
        }

        engine.trigger(1.0, sample_rate);
        let second_10: Vec<f32> = (0..10).map(|_| engine.tick(sample_rate)).collect();

        // Should be identical (phase reset, same coefficients)
        for i in 0..10 {
            assert!(
                (first_10[i] - second_10[i]).abs() < 1e-5,
                "Trigger phase reset mismatch at sample {i}: {} vs {}",
                first_10[i],
                second_10[i]
            );
        }
    }
}
