//! Step Sequencer modulation source.
//! 16 steps with configurable values, synced to a rate in Hz.

pub const SEQ_STEPS: usize = 16;

#[derive(Clone)]
pub struct StepSequencer {
    steps: [f32; SEQ_STEPS],
    num_steps: usize,
    current_step: usize,
    phase: f32,
    /// Output value (smoothed between steps)
    output: f32,
    /// Smoothing coefficient
    smooth_coeff: f32,
}

impl StepSequencer {
    pub fn new() -> Self {
        // Default: alternating pattern
        let mut steps = [0.5f32; SEQ_STEPS];
        for i in 0..SEQ_STEPS {
            steps[i] = if i % 2 == 0 { 0.8 } else { 0.2 };
        }
        Self {
            steps,
            num_steps: 8,
            current_step: 0,
            phase: 0.0,
            output: 0.0,
            smooth_coeff: 0.01,
        }
    }

    pub fn set_step(&mut self, idx: usize, value: f32) {
        if idx < SEQ_STEPS {
            self.steps[idx] = value.clamp(0.0, 1.0);
        }
    }

    pub fn set_num_steps(&mut self, n: usize) {
        self.num_steps = n.clamp(1, SEQ_STEPS);
    }

    pub fn set_smoothing(&mut self, amount: f32) {
        // amount 0-1 maps to coefficient
        self.smooth_coeff = (0.001 + amount * 0.1).min(1.0);
    }

    pub fn reset(&mut self) {
        self.current_step = 0;
        self.phase = 0.0;
        self.output = self.steps[0];
    }

    /// Advance the sequencer. rate_hz controls how fast it steps.
    /// Returns output value in -1..1
    #[inline]
    pub fn tick(&mut self, rate_hz: f32, sample_rate: f32) -> f32 {
        self.phase += rate_hz / sample_rate;

        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.current_step = (self.current_step + 1) % self.num_steps;
        }

        let target = self.steps[self.current_step];
        self.output += self.smooth_coeff * (target - self.output);

        // Map from 0..1 to -1..1 for modulation
        self.output * 2.0 - 1.0
    }
}
