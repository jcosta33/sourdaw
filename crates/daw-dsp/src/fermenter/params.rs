/// Smoothed parameter with one-pole exponential filter.
/// Prevents clicks/pops when parameters change.
#[derive(Clone)]
pub struct SmoothedParam {
    target: f32,
    current: f32,
    coeff: f32,
}

impl SmoothedParam {
    /// Create a new smoothed parameter.
    /// `smooth_ms` is the time constant in milliseconds.
    pub fn new(initial: f32, smooth_ms: f32, sample_rate: f32) -> Self {
        let coeff = if smooth_ms > 0.0 {
            1.0 - (-std::f32::consts::TAU / (smooth_ms * 0.001 * sample_rate)).exp()
        } else {
            1.0 // No smoothing
        };
        Self {
            target: initial,
            current: initial,
            coeff,
        }
    }

    #[inline]
    pub fn set(&mut self, value: f32) {
        self.target = value;
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        self.current += self.coeff * (self.target - self.current);
        self.current
    }

    #[inline]
    pub fn snap(&mut self) {
        self.current = self.target;
    }

    #[inline]
    pub fn value(&self) -> f32 {
        self.current
    }

    #[inline]
    pub fn target(&self) -> f32 {
        self.target
    }

    pub fn update_sample_rate(&mut self, smooth_ms: f32, sample_rate: f32) {
        self.coeff = if smooth_ms > 0.0 {
            1.0 - (-std::f32::consts::TAU / (smooth_ms * 0.001 * sample_rate)).exp()
        } else {
            1.0
        };
    }
}

/// Block of pre-allocated scratch buffers for audio processing.
/// Avoids allocation in the audio thread.
pub struct ScratchBuffers {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
    pub mono: Vec<f32>,
}

impl ScratchBuffers {
    pub fn new(block_size: usize) -> Self {
        Self {
            left: vec![0.0; block_size],
            right: vec![0.0; block_size],
            mono: vec![0.0; block_size],
        }
    }

    pub fn clear(&mut self) {
        self.left.fill(0.0);
        self.right.fill(0.0);
        self.mono.fill(0.0);
    }
}
