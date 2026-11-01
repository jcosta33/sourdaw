//! Transient shaper — split into transient and sustain, apply independent gain.
//! Uses dual envelope followers (fast + slow) to detect transients.

use crate::primitives::flush_denormal;

pub struct TransientShaper {
    fast_env: f32,     // fast envelope follower state
    slow_env: f32,     // slow envelope follower state
    attack_gain: f32,  // transient gain (0-2, 1 = unity)
    sustain_gain: f32, // sustain gain (0-2, 1 = unity)
    fast_coeff: f32,   // ~0.5ms attack
    slow_coeff: f32,   // ~20ms attack
}

impl TransientShaper {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            fast_env: 0.0,
            slow_env: 0.0,
            attack_gain: 1.0,
            sustain_gain: 1.0,
            fast_coeff: 1.0 - (-1.0 / (0.0005 * sample_rate)).exp(),
            slow_coeff: 1.0 - (-1.0 / (0.02 * sample_rate)).exp(),
        }
    }

    pub fn set_attack(&mut self, gain: f32) {
        self.attack_gain = gain.clamp(0.0, 2.0);
    }

    pub fn set_sustain(&mut self, gain: f32) {
        self.sustain_gain = gain.clamp(0.0, 2.0);
    }

    /// The installed (attack, sustain) gains. A hit that locked either one
    /// swaps its value in for its own samples and restores these afterwards,
    /// so the lock never re-persists into the pad's shared shaper (#4636).
    pub fn gains(&self) -> (f32, f32) {
        (self.attack_gain, self.sustain_gain)
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let rect = input.abs();

        self.fast_env = flush_denormal(self.fast_env + self.fast_coeff * (rect - self.fast_env));
        self.slow_env = flush_denormal(self.slow_env + self.slow_coeff * (rect - self.slow_env));

        let transient_measure = (self.fast_env - self.slow_env).max(0.0);
        let is_transient = transient_measure > 0.01;

        if is_transient {
            input * self.attack_gain
        } else {
            input * self.sustain_gain
        }
    }

    // Process a block
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        // Skip if both gains are unity
        if (self.attack_gain - 1.0).abs() < 0.001 && (self.sustain_gain - 1.0).abs() < 0.001 {
            return;
        }
        for i in 0..left.len() {
            left[i] = self.process(left[i]);
            right[i] = self.process(right[i]);
        }
    }
}

/// Stereo adapter for the standalone effect. The pad shaper above keeps its
/// historical API and block behavior; this adapter advances one state per channel.
#[wasm_bindgen::prelude::wasm_bindgen]
pub struct TransientShaperInstance {
    left: TransientShaper,
    right: TransientShaper,
}

#[wasm_bindgen::prelude::wasm_bindgen]
impl TransientShaperInstance {
    #[wasm_bindgen::prelude::wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Result<TransientShaperInstance, String> {
        if !sample_rate.is_finite() || sample_rate <= 0.0 {
            return Err("Transient Shaper requires a positive finite sample rate".into());
        }
        Ok(Self {
            left: TransientShaper::new(sample_rate),
            right: TransientShaper::new(sample_rate),
        })
    }

    pub fn process_left(&mut self, input: f32, attack_gain: f32, sustain_gain: f32) -> f32 {
        process_channel(&mut self.left, input, attack_gain, sustain_gain)
    }

    pub fn process_right(&mut self, input: f32, attack_gain: f32, sustain_gain: f32) -> f32 {
        process_channel(&mut self.right, input, attack_gain, sustain_gain)
    }

    /// Reset detector history without rebuilding coefficients or changing gains.
    pub fn reset(&mut self) {
        self.left.fast_env = 0.0;
        self.left.slow_env = 0.0;
        self.right.fast_env = 0.0;
        self.right.slow_env = 0.0;
    }
}

#[inline]
fn process_channel(
    shaper: &mut TransientShaper,
    input: f32,
    attack_gain: f32,
    sustain_gain: f32,
) -> f32 {
    if attack_gain.is_finite() {
        shaper.set_attack(attack_gain);
    }
    if sustain_gain.is_finite() {
        shaper.set_sustain(sustain_gain);
    }
    let input = if input.is_finite() { input } else { 0.0 };
    let output = shaper.process(input);
    if output.is_finite() {
        output
    } else {
        0.0
    }
}
