/// Stereo delay with feedback, filtering, and ping-pong mode.

pub struct StereoDelay {
    sample_rate: f32,
    time_l: f32,      // seconds
    time_r: f32,      // seconds
    feedback: f32,    // 0..0.95
    mix: f32,         // 0..1
    filter_cutoff: f32, // Hz (one-pole lowpass in feedback path)
    ping_pong: bool,

    // Delay lines
    buf_l: Vec<f32>,
    buf_r: Vec<f32>,
    write_pos: usize,
    buf_size: usize,

    // Filter state
    filter_state_l: f32,
    filter_state_r: f32,
    filter_coeff: f32,
}

impl StereoDelay {
    pub fn new(sample_rate: f32) -> Self {
        // Max 2 seconds of delay
        let buf_size = (sample_rate * 2.0) as usize;
        let mut d = Self {
            sample_rate,
            time_l: 0.25,
            time_r: 0.375,
            feedback: 0.4,
            mix: 0.3,
            filter_cutoff: 8000.0,
            ping_pong: false,
            buf_l: vec![0.0; buf_size],
            buf_r: vec![0.0; buf_size],
            write_pos: 0,
            buf_size,
            filter_state_l: 0.0,
            filter_state_r: 0.0,
            filter_coeff: 0.0,
        };
        d.update_filter();
        d
    }

    fn update_filter(&mut self) {
        let x = (-2.0 * core::f32::consts::PI * self.filter_cutoff / self.sample_rate).exp();
        self.filter_coeff = x;
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "time_l" => { self.time_l = value.clamp(0.001, 2.0); }
            "time_r" => { self.time_r = value.clamp(0.001, 2.0); }
            "feedback" => { self.feedback = value.clamp(0.0, 0.95); }
            "mix" => { self.mix = value.clamp(0.0, 1.0); }
            "filter" => { self.filter_cutoff = value.clamp(200.0, 20000.0); self.update_filter(); }
            "ping_pong" => { self.ping_pong = value > 0.5; }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let delay_l = (self.time_l * self.sample_rate) as usize;
        let delay_r = (self.time_r * self.sample_rate) as usize;

        for i in 0..left.len() {
            let dry_l = left[i];
            let dry_r = right[i];

            // Read from delay
            let read_l = (self.write_pos + self.buf_size - delay_l.min(self.buf_size - 1)) % self.buf_size;
            let read_r = (self.write_pos + self.buf_size - delay_r.min(self.buf_size - 1)) % self.buf_size;
            let wet_l = self.buf_l[read_l];
            let wet_r = self.buf_r[read_r];

            // One-pole lowpass in feedback path
            self.filter_state_l = wet_l * (1.0 - self.filter_coeff) + self.filter_state_l * self.filter_coeff;
            self.filter_state_r = wet_r * (1.0 - self.filter_coeff) + self.filter_state_r * self.filter_coeff;

            // Write to delay (with feedback)
            if self.ping_pong {
                // Cross-feed: L feedback goes to R, R goes to L
                self.buf_l[self.write_pos] = dry_l + self.filter_state_r * self.feedback;
                self.buf_r[self.write_pos] = dry_r + self.filter_state_l * self.feedback;
            } else {
                self.buf_l[self.write_pos] = dry_l + self.filter_state_l * self.feedback;
                self.buf_r[self.write_pos] = dry_r + self.filter_state_r * self.feedback;
            }

            left[i] = dry_l * (1.0 - self.mix) + wet_l * self.mix;
            right[i] = dry_r * (1.0 - self.mix) + wet_r * self.mix;

            self.write_pos = (self.write_pos + 1) % self.buf_size;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        vec!["time_l", "time_r", "feedback", "mix", "filter", "ping_pong"]
    }
}
