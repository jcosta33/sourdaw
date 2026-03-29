//! Lookahead delay — circular buffer for compensating detector latency.

pub struct LookaheadDelay {
    buffer: Vec<f32>,
    write_pos: usize,
    size: usize,
}

impl LookaheadDelay {
    pub fn new(max_delay_ms: f32, sample_rate: f32) -> Self {
        let size = (max_delay_ms * 0.001 * sample_rate) as usize + 1;
        Self {
            buffer: vec![0.0; size.max(1)],
            write_pos: 0,
            size: size.max(1),
        }
    }

    /// Process one sample with the given delay in samples.
    #[inline]
    pub fn process(&mut self, input: f32, delay_samples: usize) -> f32 {
        self.buffer[self.write_pos] = input;
        let delay = delay_samples.min(self.size - 1);
        let read_pos = (self.write_pos + self.size - delay) % self.size;
        let output = self.buffer[read_pos];
        self.write_pos = (self.write_pos + 1) % self.size;
        output
    }

    pub fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.write_pos = 0;
    }

    /// Get the current delay in samples for latency reporting.
    pub fn delay_samples(&self, delay_ms: f32, sample_rate: f32) -> usize {
        (delay_ms * 0.001 * sample_rate) as usize
    }
}
