/// Brick-wall limiter with lookahead.
/// Uses a delay buffer to look ahead and catch peaks before they clip.

pub struct BrickwallLimiter {
    sample_rate: f32,
    ceiling: f32,       // dB
    release: f32,       // seconds
    lookahead_ms: f32,  // milliseconds

    ceiling_linear: f32,
    release_coeff: f32,
    envelope: f32,

    // Lookahead delay line (circular buffer, stereo interleaved)
    delay_buf_l: Vec<f32>,
    delay_buf_r: Vec<f32>,
    delay_len: usize,
    write_pos: usize,
}

impl BrickwallLimiter {
    pub fn new(sample_rate: f32) -> Self {
        let lookahead_ms = 5.0;
        let delay_len = ((lookahead_ms / 1000.0) * sample_rate) as usize;
        Self {
            sample_rate,
            ceiling: -0.3,
            release: 0.05,
            lookahead_ms,
            ceiling_linear: 10.0_f32.powf(-0.3 / 20.0),
            release_coeff: (-1.0 / (0.05 * sample_rate)).exp(),
            envelope: 0.0,
            delay_buf_l: vec![0.0; delay_len + 1],
            delay_buf_r: vec![0.0; delay_len + 1],
            delay_len,
            write_pos: 0,
        }
    }

    fn update_coeffs(&mut self) {
        self.ceiling_linear = 10.0_f32.powf(self.ceiling / 20.0);
        self.release_coeff = (-1.0 / (self.release * self.sample_rate)).exp();
        let new_len = ((self.lookahead_ms / 1000.0) * self.sample_rate) as usize;
        if new_len != self.delay_len {
            self.delay_len = new_len;
            self.delay_buf_l.resize(new_len + 1, 0.0);
            self.delay_buf_r.resize(new_len + 1, 0.0);
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "ceiling" => { self.ceiling = value.clamp(-12.0, 0.0); self.update_coeffs(); }
            "release" => { self.release = value.clamp(0.01, 0.5); self.update_coeffs(); }
            "lookahead" => { self.lookahead_ms = value.clamp(0.5, 10.0); self.update_coeffs(); }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let buf_len = self.delay_len + 1;
        if buf_len == 0 { return; }

        for i in 0..left.len() {
            // Write current sample to delay
            self.delay_buf_l[self.write_pos % buf_len] = left[i];
            self.delay_buf_r[self.write_pos % buf_len] = right[i];

            // Read delayed sample (lookahead behind)
            let read_pos = (self.write_pos + buf_len - self.delay_len) % buf_len;
            let delayed_l = self.delay_buf_l[read_pos];
            let delayed_r = self.delay_buf_r[read_pos];

            // Peak detection on current (ahead) sample
            let peak = left[i].abs().max(right[i].abs());

            // Compute gain reduction needed
            let target_gr = if peak > self.ceiling_linear {
                self.ceiling_linear / peak
            } else {
                1.0
            };

            // Smooth envelope (instant attack, smooth release)
            if target_gr < self.envelope {
                self.envelope = target_gr; // instant attack
            } else {
                self.envelope = self.release_coeff * self.envelope + (1.0 - self.release_coeff) * target_gr;
            }

            // Apply gain reduction to delayed signal
            left[i] = delayed_l * self.envelope;
            right[i] = delayed_r * self.envelope;

            self.write_pos = (self.write_pos + 1) % buf_len;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        vec!["ceiling", "release", "lookahead"]
    }
}
