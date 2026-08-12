//! Karplus-Strong physical modeling synthesis.
//! Excitation → delay line → lowpass feedback → output.

pub struct KarplusStrong {
    buffer: Vec<f32>,
    write_pos: usize,
    filter_state: f32,
    damping: f32,
    delay_samples: f32,
    active: bool,
    seed: u32,
}

impl KarplusStrong {
    pub fn new(sample_rate: f32) -> Self {
        let max_samples = (sample_rate / 20.0) as usize + 4;
        Self {
            buffer: vec![0.0; max_samples],
            write_pos: 0,
            filter_state: 0.0,
            damping: 0.5,
            delay_samples: 100.0,
            active: false,
            seed: 54321,
        }
    }

    pub fn set_damping(&mut self, damping: f32) {
        self.damping = damping.clamp(0.0, 0.99);
    }

    fn next_noise(&mut self) -> f32 {
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 17;
        self.seed ^= self.seed << 5;
        (self.seed as f32 / u32::MAX as f32) * 2.0 - 1.0
    }

    pub fn excite(&mut self, start_freq: f32, target_freq: f32, sample_rate: f32, brightness: f32) {
        self.delay_samples = sample_rate / start_freq.max(20.0);
        let target_delay_samples = sample_rate / target_freq.max(20.0);
        let excitation_len =
            (self.delay_samples.max(target_delay_samples) as usize).min(self.buffer.len());
        let brightness = brightness.clamp(0.1, 1.0);
        let buf_len = self.buffer.len();

        // Seed every delay length the monotonic glide can visit. Advancing by
        // the longest delay leaves the start-frequency tap inside this seeded
        // interval; as the tap moves in either direction it never enters stale
        // storage. With no glide, start and target are equal and this is the
        // original one-delay excitation.
        let mut lp_state = 0.0f32;
        for i in 0..excitation_len {
            let white = self.next_noise();
            lp_state += brightness * (white - lp_state);
            self.buffer[(self.write_pos + i) % buf_len] = lp_state;
        }
        self.write_pos = (self.write_pos + excitation_len) % buf_len;

        self.filter_state = 0.0;
        self.active = true;
    }

    #[inline]
    pub fn tick(&mut self, freq: f32, sample_rate: f32) -> f32 {
        if !self.active {
            return 0.0;
        }

        let buf_len = self.buffer.len();
        self.delay_samples = (sample_rate / freq.max(20.0)).min((buf_len - 1) as f32);
        let int_delay = self.delay_samples as usize;
        let frac = self.delay_samples - int_delay as f32;

        // Read from delay line with linear interpolation
        let read0 = (self.write_pos + buf_len - int_delay) % buf_len;
        let read1 = (read0 + buf_len - 1) % buf_len;
        let delayed = self.buffer[read0] * (1.0 - frac) + self.buffer[read1] * frac;

        // One-pole lowpass in feedback path — determines timbre and decay
        let coeff = 1.0 - self.damping * 0.5;
        let filtered = self.filter_state + coeff * (delayed - self.filter_state);
        self.filter_state = if filtered.abs() < 1e-15 {
            0.0
        } else {
            filtered
        };

        // Write filtered sample back (feedback loop)
        self.buffer[self.write_pos] = filtered;
        self.write_pos = (self.write_pos + 1) % buf_len;

        // Only deactivate when truly silent
        if filtered.abs() < 1e-10 && delayed.abs() < 1e-10 {
            self.active = false;
        }

        filtered
    }

    pub fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.filter_state = 0.0;
        self.active = false;
        self.write_pos = 0;
    }

    pub fn is_active(&self) -> bool {
        self.active
    }
}
