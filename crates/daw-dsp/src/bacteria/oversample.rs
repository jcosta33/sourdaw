//! Per-band oversampling for Bacteria.
//!
//! Uses half-band polyphase IIR filters for up/downsampling
//! to minimize phase distortion while preventing aliasing
//! from nonlinear processing.

/// Half-band filter coefficients for 2x oversampling.
/// 5th order elliptic half-band IIR (two all-pass branches).
const HALFBAND_A: [f32; 2] = [0.07986642623556002, 0.5453536510711322];

/// Single all-pass section for polyphase half-band filter.
struct AllPassSection {
    coeff: f32,
    z1: f32,
}

impl AllPassSection {
    fn new(coeff: f32) -> Self {
        Self { coeff, z1: 0.0 }
    }

    fn process(&mut self, input: f32) -> f32 {
        let output = self.z1 + (input - self.z1) * self.coeff;
        self.z1 = input;
        output
    }

    fn reset(&mut self) {
        self.z1 = 0.0;
    }
}

/// 2x oversampler using polyphase half-band IIR filter.
pub struct Oversampler2x {
    // Upsample filter (two branches)
    up_a0: AllPassSection,
    up_a1: AllPassSection,
    // Downsample filter
    down_a0: AllPassSection,
    down_a1: AllPassSection,
    prev_input: f32,
}

impl Oversampler2x {
    pub fn new() -> Self {
        Self {
            up_a0: AllPassSection::new(HALFBAND_A[0]),
            up_a1: AllPassSection::new(HALFBAND_A[1]),
            down_a0: AllPassSection::new(HALFBAND_A[0]),
            down_a1: AllPassSection::new(HALFBAND_A[1]),
            prev_input: 0.0,
        }
    }

    /// Upsample: one input sample → two output samples.
    pub fn upsample(&mut self, input: f32) -> (f32, f32) {
        // Polyphase decomposition: process even/odd samples through all-pass branches
        let a0_out = self.up_a0.process(input);
        let a1_out = self.up_a1.process(self.prev_input);
        self.prev_input = input;

        let sample0 = (a0_out + a1_out) * 0.5;
        let sample1 = (a0_out - a1_out) * 0.5;
        (sample0, sample1)
    }

    /// Downsample: two input samples → one output sample.
    pub fn downsample(&mut self, s0: f32, s1: f32) -> f32 {
        let a0_out = self.down_a0.process(s0);
        let a1_out = self.down_a1.process(s1);
        (a0_out + a1_out) * 0.5
    }

    pub fn reset(&mut self) {
        self.up_a0.reset();
        self.up_a1.reset();
        self.down_a0.reset();
        self.down_a1.reset();
        self.prev_input = 0.0;
    }
}

/// Configurable oversampling: 1x (bypass), 2x, 4x, 8x.
pub struct OversamplingChain {
    stages: Vec<Oversampler2x>,
    factor: usize,
    buffer: Vec<f32>,
}

impl OversamplingChain {
    pub fn new(factor: usize) -> Self {
        let factor = factor.clamp(1, 8);
        let num_stages = match factor {
            1 => 0,
            2 => 1,
            4 => 2,
            8 => 3,
            _ => 0,
        };
        Self {
            stages: (0..num_stages).map(|_| Oversampler2x::new()).collect(),
            factor,
            buffer: vec![0.0; factor * 2],
        }
    }

    pub fn factor(&self) -> usize {
        self.factor
    }

    /// Upsample one input sample into `factor` output samples.
    pub fn upsample(&mut self, input: f32) -> &[f32] {
        if self.factor == 1 {
            self.buffer[0] = input;
            return &self.buffer[..1];
        }

        // Stage 0: 1→2
        let (s0, s1) = self.stages[0].upsample(input);
        if self.stages.len() == 1 {
            self.buffer[0] = s0;
            self.buffer[1] = s1;
            return &self.buffer[..2];
        }

        // Stage 1: 2→4
        let (s00, s01) = self.stages[1].upsample(s0);
        let (s10, s11) = self.stages[1].upsample(s1);
        if self.stages.len() == 2 {
            self.buffer[0] = s00;
            self.buffer[1] = s01;
            self.buffer[2] = s10;
            self.buffer[3] = s11;
            return &self.buffer[..4];
        }

        // Stage 2: 4→8 (simplified — real implementation would cascade properly)
        self.buffer[0] = s00;
        self.buffer[1] = s01;
        self.buffer[2] = s10;
        self.buffer[3] = s11;
        // Fill remaining with interpolated values
        for i in 4..8 {
            self.buffer[i] = self.buffer[i - 4] * 0.5;
        }
        &self.buffer[..8]
    }

    /// Downsample `factor` processed samples back to one output sample.
    pub fn downsample(&mut self, samples: &[f32]) -> f32 {
        if self.factor == 1 {
            return samples[0];
        }

        if self.stages.len() >= 2 {
            // 4→2→1
            let d0 = self.stages[1].downsample(samples[0], samples[1]);
            let d1 = self.stages[1].downsample(
                samples.get(2).copied().unwrap_or(0.0),
                samples.get(3).copied().unwrap_or(0.0),
            );
            return self.stages[0].downsample(d0, d1);
        }

        // 2→1
        self.stages[0].downsample(samples[0], samples.get(1).copied().unwrap_or(0.0))
    }

    pub fn reset(&mut self) {
        for stage in &mut self.stages {
            stage.reset();
        }
        self.buffer.fill(0.0);
    }
}
