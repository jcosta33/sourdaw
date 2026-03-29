/// Feed-forward compressor based on the Giannoulis/Massberg/Reiss algorithm.
/// JAES 2012 "Digital Dynamic Range Compressor Design — A Tutorial and Analysis"

pub struct Compressor {
    sample_rate: f32,
    threshold: f32,   // dB
    ratio: f32,       // e.g. 4.0 = 4:1
    attack: f32,      // seconds
    release: f32,     // seconds
    knee_width: f32,  // dB
    makeup_gain: f32, // dB (linear applied at output)
    mix: f32,         // 0..1 dry/wet

    // Internal state
    envelope: f32,    // smoothed level (linear)
    attack_coeff: f32,
    release_coeff: f32,
    makeup_linear: f32,
}

impl Compressor {
    pub fn new(sample_rate: f32) -> Self {
        let mut c = Self {
            sample_rate,
            threshold: -18.0,
            ratio: 4.0,
            attack: 0.01,
            release: 0.1,
            knee_width: 6.0,
            makeup_gain: 0.0,
            mix: 1.0,
            envelope: 0.0,
            attack_coeff: 0.0,
            release_coeff: 0.0,
            makeup_linear: 1.0,
        };
        c.update_coeffs();
        c
    }

    fn update_coeffs(&mut self) {
        self.attack_coeff = (-1.0 / (self.attack * self.sample_rate)).exp();
        self.release_coeff = (-1.0 / (self.release * self.sample_rate)).exp();
        self.makeup_linear = 10.0_f32.powf(self.makeup_gain / 20.0);
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "threshold" => { self.threshold = value.clamp(-60.0, 0.0); }
            "ratio" => { self.ratio = value.clamp(1.0, 20.0); }
            "attack" => { self.attack = value.clamp(0.0001, 0.5); self.update_coeffs(); }
            "release" => { self.release = value.clamp(0.005, 2.0); self.update_coeffs(); }
            "knee" => { self.knee_width = value.clamp(0.0, 24.0); }
            "makeup" => { self.makeup_gain = value.clamp(0.0, 40.0); self.update_coeffs(); }
            "mix" => { self.mix = value.clamp(0.0, 1.0); }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for i in 0..left.len() {
            // Peak detection (stereo linked)
            let input_abs = left[i].abs().max(right[i].abs());
            let input_db = if input_abs > 1e-10 { 20.0 * input_abs.log10() } else { -100.0 };

            // Gain computer with soft knee
            let gain_db = self.compute_gain(input_db);

            // Smooth envelope
            let coeff = if gain_db < self.envelope {
                self.attack_coeff
            } else {
                self.release_coeff
            };
            self.envelope = coeff * self.envelope + (1.0 - coeff) * gain_db;

            // Apply gain reduction
            let gr_linear = 10.0_f32.powf(self.envelope / 20.0) * self.makeup_linear;

            let dry_l = left[i];
            let dry_r = right[i];
            left[i] = dry_l * gr_linear * self.mix + dry_l * (1.0 - self.mix);
            right[i] = dry_r * gr_linear * self.mix + dry_r * (1.0 - self.mix);
        }
    }

    fn compute_gain(&self, input_db: f32) -> f32 {
        let t = self.threshold;
        let r = self.ratio;
        let w = self.knee_width;

        if w <= 0.0 || (input_db - t).abs() > w / 2.0 {
            // Hard knee
            if input_db <= t {
                0.0
            } else {
                (t + (input_db - t) / r) - input_db
            }
        } else {
            // Soft knee (quadratic interpolation)
            let x = input_db - t + w / 2.0;
            let gain = (1.0 / r - 1.0) * x * x / (2.0 * w);
            gain
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        vec!["threshold", "ratio", "attack", "release", "knee", "makeup", "mix"]
    }
}
