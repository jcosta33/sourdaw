//! Parameter smoothing for Bacteria — prevents zipper noise.

/// One-pole smoothing filter for parameter changes.
pub struct SmoothedParam {
    current: f32,
    target: f32,
    coeff: f32,
}

impl SmoothedParam {
    pub fn new(initial: f32, smooth_ms: f32, sample_rate: f32) -> Self {
        let coeff = if smooth_ms > 0.0 {
            (-1.0 / (smooth_ms * 0.001 * sample_rate)).exp()
        } else {
            0.0
        };
        Self {
            current: initial,
            target: initial,
            coeff,
        }
    }

    pub fn set_target(&mut self, target: f32) {
        self.target = target;
    }

    pub fn next(&mut self) -> f32 {
        self.current = self.target + self.coeff * (self.current - self.target);
        self.current
    }

    pub fn next_with_offset(&mut self, offset: f32) -> f32 {
        self.current = self.target + self.coeff * (self.current - self.target);
        self.current + offset
    }

    pub fn target(&self) -> f32 {
        self.target
    }

    pub fn current(&self) -> f32 {
        self.current
    }

    pub fn snap(&mut self) {
        self.current = self.target;
    }
}

/// Convert dB to linear gain.
pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// Convert linear gain to dB.
pub fn linear_to_db(linear: f32) -> f32 {
    if linear <= 0.0 {
        -100.0
    } else {
        20.0 * linear.log10()
    }
}
