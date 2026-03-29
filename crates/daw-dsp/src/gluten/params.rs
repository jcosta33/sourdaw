//! Smoothed parameter helper — one-pole filter for click-free parameter changes.

pub struct SmoothedParam {
    current: f32,
    target: f32,
    coeff: f32,
}

impl SmoothedParam {
    pub fn new(initial: f32, smooth_ms: f32, sample_rate: f32) -> Self {
        Self {
            current: initial,
            target: initial,
            coeff: if smooth_ms > 0.0 {
                (-1.0 / (smooth_ms * 0.001 * sample_rate)).exp()
            } else {
                0.0
            },
        }
    }

    pub fn set_target(&mut self, target: f32) {
        self.target = target;
    }

    pub fn set_immediate(&mut self, value: f32) {
        self.current = value;
        self.target = value;
    }

    #[inline]
    pub fn next(&mut self) -> f32 {
        self.current = self.coeff * self.current + (1.0 - self.coeff) * self.target;
        self.current
    }

    pub fn current(&self) -> f32 {
        self.current
    }
}
