//! Zero-alloc Fixed Delay Line

pub struct DelayLine {
    buffer: Vec<f32>,
    write_idx: usize,
    mask: usize, // power of two sizing
}

impl DelayLine {
    pub fn new(max_length: usize) -> Self {
        let size = max_length.next_power_of_two();
        Self {
            buffer: vec![0.0; size],
            write_idx: 0,
            mask: size - 1,
        }
    }

    #[inline(always)]
    pub fn read(&self, delay_samples: usize) -> f32 {
        let read_idx = (self.write_idx + self.buffer.len() - delay_samples) & self.mask;
        self.buffer[read_idx]
    }

    #[inline(always)]
    pub fn write(&mut self, input: f32) {
        // Magnitude truncation to eliminate limit cycles in feedback networks
        let truncated = if input.abs() < 1e-15 { 0.0 } else { input };
        self.buffer[self.write_idx] = truncated;
        self.write_idx = (self.write_idx + 1) & self.mask;
    }
}
