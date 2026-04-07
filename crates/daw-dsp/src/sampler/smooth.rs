/// One-pole exponential parameter smoother.
///
/// Prevents zipper noise when parameters change during playback.
/// Includes denormal prevention via a tiny DC offset (1e-18).
use super::types::DENORMAL_DC;

#[derive(Debug, Clone)]
pub struct ParamSmoother {
    current: f32,
    target: f32,
    coeff: f32,
    sample_rate: f32,
}

impl ParamSmoother {
    /// Create a new smoother with the given time constant in seconds.
    ///
    /// Typical values: 0.005–0.020 (5–20ms).
    pub fn new(sample_rate: f32, time_constant_secs: f32) -> Self {
        let coeff = compute_coeff(sample_rate, time_constant_secs);
        Self {
            current: 0.0,
            target: 0.0,
            coeff,
            sample_rate,
        }
    }

    /// Create a smoother pre-set to a specific value (no ramp on first use).
    pub fn with_value(sample_rate: f32, time_constant_secs: f32, value: f32) -> Self {
        let coeff = compute_coeff(sample_rate, time_constant_secs);
        Self {
            current: value,
            target: value,
            coeff,
            sample_rate,
        }
    }

    /// Set a new target value. The smoother will ramp toward it.
    pub fn set(&mut self, value: f32) {
        self.target = value;
    }

    /// Set both current and target immediately (no smoothing).
    pub fn set_immediate(&mut self, value: f32) {
        self.current = value;
        self.target = value;
    }

    /// Update the time constant.
    pub fn set_time_constant(&mut self, time_constant_secs: f32) {
        self.coeff = compute_coeff(self.sample_rate, time_constant_secs);
    }

    /// Advance one sample and return the smoothed value.
    pub fn tick(&mut self) -> f32 {
        // One-pole IIR: current += coeff * (target - current)
        // With denormal prevention via DC offset.
        self.current = self.current + self.coeff * (self.target - self.current) + DENORMAL_DC;
        self.current -= DENORMAL_DC;
        self.current
    }

    /// Check if the smoother has reached its target (within epsilon).
    pub fn is_settled(&self) -> bool {
        (self.current - self.target).abs() < 1e-6
    }

    /// Get the current smoothed value without advancing.
    pub fn value(&self) -> f32 {
        self.current
    }

    /// Get the target value.
    pub fn target(&self) -> f32 {
        self.target
    }
}

/// Compute the one-pole coefficient from a time constant.
///
/// The coefficient determines how quickly the smoother converges:
///   `coeff = 1 - exp(-1 / (sample_rate * time_constant))`
///
/// A 10ms time constant at 44100Hz reaches ~63% in 441 samples.
fn compute_coeff(sample_rate: f32, time_constant_secs: f32) -> f32 {
    if time_constant_secs <= 0.0 {
        return 1.0; // Instant — no smoothing.
    }
    1.0 - (-1.0 / (sample_rate * time_constant_secs)).exp()
}
