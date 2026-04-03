/// Low Frequency Oscillator for modulation.

#[derive(Clone, Copy)]
pub enum LfoShape {
    Sine,
    Triangle,
    Saw,
    Square,
}

#[derive(Clone)]
pub struct Lfo {
    phase: f32,
    shape: LfoShape,
}

impl Lfo {
    pub fn new() -> Self {
        Self {
            phase: 0.0,
            shape: LfoShape::Sine,
        }
    }

    pub fn set_shape(&mut self, shape: LfoShape) {
        self.shape = shape;
    }

    /// Advance and return value in range [-1, 1].
    #[inline]
    pub fn tick(&mut self, rate_hz: f32, sample_rate: f32) -> f32 {
        self.phase += rate_hz / sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        match self.shape {
            LfoShape::Sine => (self.phase * std::f32::consts::TAU).sin(),
            LfoShape::Triangle => {
                if self.phase < 0.5 {
                    4.0 * self.phase - 1.0
                } else {
                    3.0 - 4.0 * self.phase
                }
            }
            LfoShape::Saw => 2.0 * self.phase - 1.0,
            LfoShape::Square => {
                if self.phase < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
        }
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
    }
}
