/// Noise gate with threshold, attack, hold, release, and range.

pub struct NoiseGate {
    sample_rate: f32,
    threshold: f32,     // dB
    attack: f32,        // seconds
    hold: f32,          // seconds
    release: f32,       // seconds
    range: f32,         // dB (how much to attenuate when closed)

    // State
    gain: f32,          // current gate gain (0..1)
    hold_counter: u32,
    attack_coeff: f32,
    release_coeff: f32,
    range_linear: f32,
}

impl NoiseGate {
    pub fn new(sample_rate: f32) -> Self {
        let mut g = Self {
            sample_rate,
            threshold: -40.0,
            attack: 0.001,
            hold: 0.05,
            release: 0.1,
            range: -80.0,
            gain: 0.0,
            hold_counter: 0,
            attack_coeff: 0.0,
            release_coeff: 0.0,
            range_linear: 0.0001,
        };
        g.update_coeffs();
        g
    }

    fn update_coeffs(&mut self) {
        self.attack_coeff = (-1.0 / (self.attack * self.sample_rate)).exp();
        self.release_coeff = (-1.0 / (self.release * self.sample_rate)).exp();
        self.range_linear = 10.0_f32.powf(self.range / 20.0);
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "threshold" => { self.threshold = value.clamp(-80.0, 0.0); }
            "attack" => { self.attack = value.clamp(0.0001, 0.1); self.update_coeffs(); }
            "hold" => { self.hold = value.clamp(0.0, 0.5); }
            "release" => { self.release = value.clamp(0.005, 2.0); self.update_coeffs(); }
            "range" => { self.range = value.clamp(-80.0, 0.0); self.update_coeffs(); }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let hold_samples = (self.hold * self.sample_rate) as u32;

        for i in 0..left.len() {
            // Peak detection
            let peak = left[i].abs().max(right[i].abs());
            let peak_db = if peak > 1e-10 { 20.0 * peak.log10() } else { -100.0 };

            // Gate logic
            if peak_db >= self.threshold {
                // Open gate
                self.hold_counter = hold_samples;
                // Smooth attack
                self.gain = 1.0 - self.attack_coeff * (1.0 - self.gain);
            } else if self.hold_counter > 0 {
                // Hold phase
                self.hold_counter -= 1;
                self.gain = 1.0;
            } else {
                // Release phase
                let target = self.range_linear;
                self.gain = target + self.release_coeff * (self.gain - target);
            }

            left[i] *= self.gain;
            right[i] *= self.gain;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        vec!["threshold", "attack", "hold", "release", "range"]
    }
}
