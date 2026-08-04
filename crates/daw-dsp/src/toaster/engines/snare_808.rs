//! TR-808 snare drum — dual bridged-T resonators plus Sallen-Key filtered noise.
//!
//! Two bridged-T oscillators at service manual component-derived frequencies:
//!   Lower: R196=680Ω, R197=820kΩ, C58=56nF, C59=27nF → fc ≈ 173 Hz
//!   Upper: R195=2.2kΩ, R198=1MΩ, C60=6.8nF, C61=15nF → fc ≈ 335 Hz
//!
//! Tone knob crossfades between oscillators.
//! Snappy knob controls noise VCA amplitude.
//! Noise source: white noise through Sallen-Key 2-pole HPF at ~2749 Hz.

use crate::primitives::flush_denormal;
use crate::toaster::bridged_t::BridgedTFilter;
use crate::toaster::dc_block::DcBlocker;
use crate::toaster::tolerance::{cap, prng_state, res};

// Lower oscillator component values
const R196_NOM: f32 = 680.0; // Ω
const R197_NOM: f32 = 820_000.0; // Ω
const C58_NOM: f32 = 56e-9; // F
const C59_NOM: f32 = 27e-9; // F

// Upper oscillator component values
const R195_NOM: f32 = 2_200.0; // Ω
const R198_NOM: f32 = 1_000_000.0; // Ω
const C60_NOM: f32 = 6.8e-9; // F
const C61_NOM: f32 = 15e-9; // F

// Sallen-Key HPF cutoff ~2749 Hz
const SK_HPF_FREQ: f32 = 2749.0;

pub struct Snare808Engine {
    // Bridged-T filters
    lower_osc: BridgedTFilter,
    upper_osc: BridgedTFilter,

    // Component values (may be jittered)
    r196: f32,
    r197: f32,
    c58: f32,
    c59: f32,
    r195: f32,
    r198: f32,
    c60: f32,
    c61: f32,

    // Amplitude envelopes
    amp_env: f32,
    amp_decay_coeff: f32,
    noise_env: f32,
    noise_decay_coeff: f32,

    // Sallen-Key HPF state (2-pole, biquad approximation)
    hpf_s1: f32,
    hpf_s2: f32,
    hpf_b0: f32,
    hpf_b1: f32,
    hpf_b2: f32,
    hpf_a1: f32,
    hpf_a2: f32,

    // Noise state (xorshift32)
    noise_state: u32,

    // DC blockers
    dc_block: DcBlocker,

    // Parameters
    tone: f32,   // 0..1: crossfade between lower and upper oscillator
    snappy: f32, // 0..1: noise level
    decay: f32,  // 0..1 normalized

    active: bool,
}

impl Snare808Engine {
    pub fn new(sample_rate: f32) -> Self {
        Self::with_tolerance(sample_rate, 0)
    }

    pub fn with_tolerance(sample_rate: f32, tolerance_seed: u32) -> Self {
        let mut state = prng_state(tolerance_seed);
        let r196 = res(R196_NOM, &mut state);
        let r197 = res(R197_NOM, &mut state);
        let c58 = cap(C58_NOM, &mut state);
        let c59 = cap(C59_NOM, &mut state);
        let r195 = res(R195_NOM, &mut state);
        let r198 = res(R198_NOM, &mut state);
        let c60 = cap(C60_NOM, &mut state);
        let c61 = cap(C61_NOM, &mut state);

        let mut lower_osc = BridgedTFilter::new();
        let mut upper_osc = BridgedTFilter::new();
        lower_osc.update_coefficients(r196, r197, c58, c59, sample_rate);
        upper_osc.update_coefficients(r195, r198, c60, c61, sample_rate);

        let (hpf_b0, hpf_b1, hpf_b2, hpf_a1, hpf_a2) = compute_hpf_biquad(SK_HPF_FREQ, sample_rate);

        Self {
            lower_osc,
            upper_osc,
            r196,
            r197,
            c58,
            c59,
            r195,
            r198,
            c60,
            c61,
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            noise_env: 0.0,
            noise_decay_coeff: 0.0,
            hpf_s1: 0.0,
            hpf_s2: 0.0,
            hpf_b0,
            hpf_b1,
            hpf_b2,
            hpf_a1,
            hpf_a2,
            noise_state: 0x12345678,
            dc_block: DcBlocker::new(sample_rate),
            tone: 0.5,
            snappy: 0.5,
            decay: 0.5,
            active: false,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.active = true;
        self.amp_env = velocity;
        self.noise_env = velocity * self.snappy;

        let decay_s = 0.05 + self.decay * 0.25; // 50ms..300ms
        self.amp_decay_coeff = (-1.0 / (decay_s * sample_rate)).exp();
        self.noise_decay_coeff = (-1.0 / (0.08 * sample_rate)).exp(); // 80ms noise decay

        // Reset oscillators and filters
        self.lower_osc.reset();
        self.upper_osc.reset();
        self.hpf_s1 = 0.0;
        self.hpf_s2 = 0.0;
        self.dc_block.reset();

        // Recalculate coefficients with current sample_rate
        self.lower_osc
            .update_coefficients(self.r196, self.r197, self.c58, self.c59, sample_rate);
        self.upper_osc
            .update_coefficients(self.r195, self.r198, self.c60, self.c61, sample_rate);
    }

    pub fn release(&mut self) {
        // Snare is envelope-driven
    }

    pub fn tick(&mut self, _sample_rate: f32) -> f32 {
        if !self.active || self.amp_env < 1e-6 {
            self.active = false;
            return 0.0;
        }

        // Noise (xorshift32) → Sallen-Key HPF at 2749 Hz
        let noise_raw = xorshift_noise(&mut self.noise_state);
        let noise_filtered = self.hpf_process(noise_raw);

        // Combined excitation: tonal impulse + attenuated noise coupling (single pass per filter)
        let noise_coupled = noise_filtered * self.noise_env * 0.1;
        let excitation = self.amp_env + noise_coupled;

        // Lower and upper bridged-T oscillators (each processed exactly once per sample)
        let lower = self.lower_osc.process(excitation);
        let upper = self.upper_osc.process(excitation);

        // Tone crossfade
        let tonal = lower * (1.0 - self.tone) + upper * self.tone;

        // Amplitude envelope
        self.amp_env *= self.amp_decay_coeff;
        self.noise_env *= self.noise_decay_coeff;

        // Sum tonal + noise VCA
        let noise_out = noise_filtered * self.noise_env * self.snappy;
        let mixed = tonal * self.amp_env + noise_out;

        let output = self.dc_block.process(mixed);

        if self.amp_env < 1e-6 {
            self.active = false;
        }

        output
    }

    /// Biquad HPF process (TDF-II).
    #[inline]
    fn hpf_process(&mut self, input: f32) -> f32 {
        let output = self.hpf_b0 * input + self.hpf_s1;
        self.hpf_s1 = self.hpf_b1 * input - self.hpf_a1 * output + self.hpf_s2;
        self.hpf_s2 = self.hpf_b2 * input - self.hpf_a2 * output;

        self.hpf_s1 = flush_denormal(self.hpf_s1);
        self.hpf_s2 = flush_denormal(self.hpf_s2);

        output
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "tone" => self.tone = value.clamp(0.0, 1.0),
            "snappy" => self.snappy = value.clamp(0.0, 1.0),
            "decay" => self.decay = value.clamp(0.0, 1.0),
            _ => {}
        }
    }
}

/// Compute biquad 2-pole Butterworth HPF coefficients via bilinear transform.
fn compute_hpf_biquad(freq: f32, sample_rate: f32) -> (f32, f32, f32, f32, f32) {
    let g = (core::f32::consts::PI * freq / sample_rate).tan();
    let sqrt2 = core::f32::consts::SQRT_2;
    let a0 = 1.0 + sqrt2 * g + g * g;
    let b0 = 1.0 / a0;
    let b1 = -2.0 / a0;
    let b2 = 1.0 / a0;
    let a1 = (2.0 * g * g - 2.0) / a0;
    let a2 = (1.0 - sqrt2 * g + g * g) / a0;
    (b0, b1, b2, a1, a2)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snare_808_renders_cleanly() {
        let sample_rate = 48_000.0_f32;
        let mut engine = Snare808Engine::new(sample_rate);
        engine.trigger(1.0, sample_rate);

        for i in 0..48_000 {
            let s = engine.tick(sample_rate);
            assert!(!s.is_nan(), "NaN at sample {i}");
            assert!(!s.is_infinite(), "Inf at sample {i}");
        }
    }

    /// Verify lower oscillator uses ~173 Hz and upper ~335 Hz (within ±5%).
    #[test]
    fn snare_808_oscillator_frequencies() {
        // Calculate expected fc for lower oscillator
        let fc_lower =
            1.0 / (2.0 * core::f32::consts::PI * (R196_NOM * R197_NOM * C58_NOM * C59_NOM).sqrt());
        let fc_upper =
            1.0 / (2.0 * core::f32::consts::PI * (R195_NOM * R198_NOM * C60_NOM * C61_NOM).sqrt());

        assert!(
            (fc_lower - 173.0).abs() < 10.0,
            "Lower fc {fc_lower:.1} Hz should be near 173 Hz"
        );
        assert!(
            (fc_upper - 335.0).abs() < 20.0,
            "Upper fc {fc_upper:.1} Hz should be near 335 Hz"
        );

        // Also verify they differ significantly from current engine's 200/360 Hz
        assert!(
            (fc_lower - 200.0).abs() > 10.0,
            "Lower fc should differ from old 200 Hz"
        );
    }
}
