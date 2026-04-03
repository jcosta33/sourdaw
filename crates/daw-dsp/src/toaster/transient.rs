//! Transient shaper — split into transient and sustain, apply independent gain.
//! Uses dual envelope followers (fast + slow) to detect transients.

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

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let rect = input.abs();

        self.fast_env += self.fast_coeff * (rect - self.fast_env);
        self.slow_env += self.slow_coeff * (rect - self.slow_env);

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
