//! TR-808 clap — dual-path multi-burst envelope.
//!
//! Bandpass-filtered white noise (~1000 Hz) through two parallel VCA paths:
//!   Path 1 (bursts): 3 rapid sawtooth-shaped sub-envelopes at ~100 Hz rate
//!                    (~10 ms each) with diminishing amplitudes, then 20ms final discharge.
//!   Path 2 (reverb tail): simple 100ms RC decay, starts after bursts complete.
//!
//! Both paths summed at output.

use crate::primitives::flush_denormal_in_place;
use crate::toaster::dc_block::DcBlocker;

/// Clap envelope state machine.
enum ClapState {
    Idle,
    Burst { burst_idx: u8, burst_phase: f32 },
    Tail { env: f32 },
}

pub struct Clap808Engine {
    state: ClapState,

    // BPF state (SVF, ~1000 Hz)
    bp_ic1: f32,
    bp_ic2: f32,

    // Burst envelope state
    burst_env: f32,
    burst_decay_coeff: f32,

    // Tail envelope
    tail_env: f32,
    tail_decay_coeff: f32,

    // Inter-burst timing
    burst_gap_counter: u32,
    burst_gap_samples: u32,

    // Noise state
    noise_state: u32,

    // DC blocker
    dc_block: DcBlocker,

    // Parameters
    decay: f32,
    snappy: f32,
    velocity: f32,

    active: bool,
    sample_rate: f32,
}

impl Clap808Engine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            state: ClapState::Idle,
            bp_ic1: 0.0,
            bp_ic2: 0.0,
            burst_env: 0.0,
            burst_decay_coeff: 0.0,
            tail_env: 0.0,
            tail_decay_coeff: 0.0,
            burst_gap_counter: 0,
            burst_gap_samples: 0,
            noise_state: 0x12345678,
            dc_block: DcBlocker::new(sample_rate),
            decay: 0.5,
            snappy: 0.7,
            velocity: 1.0,
            active: false,
            sample_rate,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.velocity = velocity.clamp(0.0, 1.0);
        self.active = true;

        // Each burst lasts ~10ms, gap between bursts ~10ms (100 Hz rate)
        self.burst_gap_samples = (0.010 * sample_rate) as u32;
        self.burst_gap_counter = 0;

        // Start with burst 0
        self.burst_env = velocity;
        self.burst_decay_coeff = (-1.0 / (0.010 * sample_rate)).exp(); // 10ms per burst

        // Tail: 100ms RC decay
        let tail_decay_s = 0.05 + self.decay * 0.15; // 50..200ms based on decay param
        self.tail_decay_coeff = (-1.0 / (tail_decay_s * sample_rate)).exp();
        self.tail_env = 0.0; // tail starts after bursts

        self.state = ClapState::Burst {
            burst_idx: 0,
            burst_phase: 0.0,
        };

        self.bp_ic1 = 0.0;
        self.bp_ic2 = 0.0;
        self.dc_block.reset();
    }

    pub fn release(&mut self) {}

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if !self.active {
            return 0.0;
        }

        // Generate white noise
        let noise = xorshift_noise(&mut self.noise_state);

        // BPF at ~1000 Hz (SVF)
        let bpf_out = svf_bandpass_clap(
            noise,
            1000.0,
            1.5,
            sample_rate,
            &mut self.bp_ic1,
            &mut self.bp_ic2,
        );

        let mut burst_out = 0.0_f32;
        let mut tail_out = 0.0_f32;

        match &mut self.state {
            ClapState::Idle => {
                self.active = false;
                return 0.0;
            }
            ClapState::Burst {
                burst_idx,
                burst_phase: _,
            } => {
                let idx = *burst_idx;

                // Diminishing burst amplitudes: 1.0, 0.7, 0.45
                let burst_amp = match idx {
                    0 => 1.0_f32,
                    1 => 0.7,
                    2 => 0.45,
                    _ => 0.25,
                };

                burst_out = bpf_out * self.burst_env * burst_amp * self.velocity;
                self.burst_env *= self.burst_decay_coeff;

                self.burst_gap_counter += 1;

                if self.burst_env < 0.01 {
                    // Burst exhausted
                    if idx < 2 {
                        // Start next burst after gap
                        self.burst_env = self.velocity;
                        self.burst_gap_counter = 0;
                        self.state = ClapState::Burst {
                            burst_idx: idx + 1,
                            burst_phase: 0.0,
                        };
                    } else {
                        // Final 20ms discharge + start tail
                        self.tail_env = self.velocity * 0.3;
                        self.state = ClapState::Tail {
                            env: self.velocity * 0.3,
                        };
                    }
                }
            }
            ClapState::Tail { env } => {
                tail_out = bpf_out * *env * self.snappy;
                *env *= self.tail_decay_coeff;
                self.tail_env = *env;

                if *env < 1e-5 {
                    self.state = ClapState::Idle;
                    self.active = false;
                }
            }
        }

        let mixed = burst_out + tail_out;
        self.dc_block.process(mixed)
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "decay" => self.decay = value.clamp(0.0, 1.0),
            "snappy" => self.snappy = value.clamp(0.0, 1.0),
            _ => {}
        }
    }
}

#[inline]
fn xorshift_noise(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    (x as i32 as f32) / (i32::MAX as f32)
}

#[inline]
fn svf_bandpass_clap(
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
    fn clap_808_renders_cleanly() {
        let sample_rate = 48_000.0_f32;
        let mut engine = Clap808Engine::new(sample_rate);
        engine.trigger(1.0, sample_rate);

        for i in 0..48_000 {
            let s = engine.tick(sample_rate);
            assert!(!s.is_nan(), "NaN at sample {i}");
            assert!(!s.is_infinite(), "Inf at sample {i}");
        }
    }

    /// Clap should have audible multi-burst attack — verify non-zero energy in burst window.
    #[test]
    fn clap_808_produces_burst_energy() {
        let sample_rate = 48_000.0_f32;
        let mut engine = Clap808Engine::new(sample_rate);
        engine.trigger(1.0, sample_rate);

        // First 50ms should have burst energy
        let burst_window = (sample_rate * 0.05) as usize;
        let energy: f32 = (0..burst_window)
            .map(|_| {
                let s = engine.tick(sample_rate);
                s * s
            })
            .sum();

        assert!(
            energy > 0.001,
            "Clap burst window should have energy > 0.001, got {energy}"
        );
    }
}
