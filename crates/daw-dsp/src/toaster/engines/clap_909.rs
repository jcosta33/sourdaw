//! TR-909 clap — four-burst LFSR noise.
//!
//! Bandpass-filtered LFSR noise at ~1140 Hz (Q≈1.95) through two parallel VCA paths:
//!   Primary path: Four sequential attack-decay envelopes ~11ms apart — "ta-ta-ta-TAA" signature.
//!   Reverb tail path: Simple AR envelope with longer decay.

use super::lfsr::Lfsr31;
use crate::primitives::flush_denormal_in_place;
use crate::toaster::dc_block::DcBlocker;

const CLAP_BPF_FREQ: f32 = 1140.0;
const CLAP_BPF_Q: f32 = 1.95;
const BURST_INTERVAL_S: f32 = 0.011; // 11ms between bursts
const BURST_DECAY_S: f32 = 0.008; // each burst ~8ms

pub struct Clap909Engine {
    lfsr: Lfsr31,

    // BPF state
    bp_ic1: f32,
    bp_ic2: f32,

    // Burst state
    burst_idx: u8,
    burst_env: f32,
    burst_decay_coeff: f32,
    burst_gap_samples: u32,
    burst_gap_counter: u32,
    bursts_done: bool,

    // Tail state
    tail_env: f32,
    tail_decay_coeff: f32,

    // DC blocker
    dc_block: DcBlocker,

    // Parameters
    decay: f32,
    velocity: f32,

    active: bool,
    sample_rate: f32,
}

impl Clap909Engine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            lfsr: Lfsr31::new(0x00000002), // Different initial state than kick
            bp_ic1: 0.0,
            bp_ic2: 0.0,
            burst_idx: 0,
            burst_env: 0.0,
            burst_decay_coeff: 0.0,
            burst_gap_samples: 0,
            burst_gap_counter: 0,
            bursts_done: false,
            tail_env: 0.0,
            tail_decay_coeff: 0.0,
            dc_block: DcBlocker::new(sample_rate),
            decay: 0.5,
            velocity: 1.0,
            active: false,
            sample_rate,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.active = true;
        self.velocity = velocity.clamp(0.0, 1.0);

        self.burst_idx = 0;
        self.burst_env = velocity;
        self.burst_decay_coeff = (-1.0 / (BURST_DECAY_S * sample_rate)).exp();
        self.burst_gap_samples = (BURST_INTERVAL_S * sample_rate) as u32;
        self.burst_gap_counter = 0;
        self.bursts_done = false;

        let tail_decay_s = 0.05 + self.decay * 0.2; // 50..250ms
        self.tail_decay_coeff = (-1.0 / (tail_decay_s * sample_rate)).exp();
        self.tail_env = 0.0;

        self.bp_ic1 = 0.0;
        self.bp_ic2 = 0.0;
        self.dc_block.reset();
    }

    pub fn release(&mut self) {}

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if !self.active {
            return 0.0;
        }

        let noise = self.lfsr.step();
        let bpf_out = svf_bandpass_909_clap(
            noise,
            CLAP_BPF_FREQ,
            CLAP_BPF_Q,
            sample_rate,
            &mut self.bp_ic1,
            &mut self.bp_ic2,
        );

        let mut burst_out = 0.0_f32;
        let tail_out;

        if !self.bursts_done {
            // Burst amplitudes diminish: 1.0, 0.85, 0.65, 0.9 (final is loudest = "TAA")
            let burst_amp = match self.burst_idx {
                0 => 0.5_f32,
                1 => 0.65,
                2 => 0.75,
                3 => 1.0, // The "TAA" — loudest burst
                _ => 0.0,
            };

            burst_out = bpf_out * self.burst_env * burst_amp * self.velocity;
            self.burst_env *= self.burst_decay_coeff;
            self.burst_gap_counter += 1;

            if self.burst_env < 0.01 || self.burst_gap_counter >= self.burst_gap_samples {
                if self.burst_idx < 3 {
                    self.burst_idx += 1;
                    self.burst_env = self.velocity;
                    self.burst_gap_counter = 0;
                } else {
                    // All 4 bursts done — start tail
                    self.bursts_done = true;
                    self.tail_env = self.velocity * 0.4;
                }
            }
        }

        tail_out = if self.bursts_done {
            let out = bpf_out * self.tail_env;
            self.tail_env *= self.tail_decay_coeff;
            if self.tail_env < 1e-5 {
                self.active = false;
            }
            out
        } else {
            0.0
        };

        let mixed = burst_out + tail_out;
        self.dc_block.process(mixed)
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "decay" => self.decay = value.clamp(0.0, 1.0),
            _ => {}
        }
    }
}

#[inline]
fn svf_bandpass_909_clap(
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
    fn clap_909_renders_cleanly() {
        let sample_rate = 48_000.0_f32;
        let mut engine = Clap909Engine::new(sample_rate);
        engine.trigger(1.0, sample_rate);

        for i in 0..48_000 {
            let s = engine.tick(sample_rate);
            assert!(!s.is_nan(), "NaN at sample {i}");
            assert!(!s.is_infinite(), "Inf at sample {i}");
        }
    }

    /// 909 clap should produce energy in four distinct 11ms windows.
    #[test]
    fn clap_909_has_four_bursts() {
        let sample_rate = 48_000.0_f32;
        let mut engine = Clap909Engine::new(sample_rate);
        engine.trigger(1.0, sample_rate);

        let burst_window = (BURST_INTERVAL_S * sample_rate) as usize;
        let mut burst_energies = [0.0_f32; 4];

        for i in 0..burst_window * 4 {
            let s = engine.tick(sample_rate);
            let burst = (i / burst_window).min(3);
            burst_energies[burst] += s * s;
        }

        for (i, &e) in burst_energies.iter().enumerate() {
            assert!(e > 1e-6, "Burst {i} should have energy, got {e}");
        }
    }
}
