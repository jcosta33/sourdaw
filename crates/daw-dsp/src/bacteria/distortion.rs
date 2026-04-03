//! Distortion algorithms for Bacteria.
//!
//! Supports: soft clip, hard clip, foldback, wavefold, bitcrush,
//! tube emulation, breakdown (pitch-down + clipping).

/// Distortion mode selector.
#[derive(Clone, Copy, PartialEq)]
pub enum DistortionMode {
    SoftClip,
    HardClip,
    Foldback,
    Wavefold,
    Bitcrush,
    Tube,
    Breakdown,
    Smudge,
    Custom,
}

impl DistortionMode {
    pub fn from_index(i: u32) -> Self {
        match i {
            0 => Self::SoftClip,
            1 => Self::HardClip,
            2 => Self::Foldback,
            3 => Self::Wavefold,
            4 => Self::Bitcrush,
            5 => Self::Tube,
            6 => Self::Breakdown,
            7 => Self::Smudge,
            _ => Self::Custom,
        }
    }
}

/// Per-band distortion processor.
pub struct DistortionProcessor {
    mode: DistortionMode,
    drive: f32,           // 0–100
    asymmetry: f32,       // -1 to 1
    fold_threshold: f32,  // 0.1–1.0
    bit_depth: u32,       // 1–24
    sr_reduce: u32,       // sample rate divider
    tube_bias: f32,       // 0–1
    breakdown_depth: f32, // 0–4 octaves
    sr_counter: u32,      // sample-rate reduction counter
    sr_hold: f32,         // held sample for SR reduction
}

impl DistortionProcessor {
    pub fn new() -> Self {
        Self {
            mode: DistortionMode::SoftClip,
            drive: 25.0,
            asymmetry: 0.0,
            fold_threshold: 0.7,
            bit_depth: 16,
            sr_reduce: 1,
            tube_bias: 0.5,
            breakdown_depth: 1.0,
            sr_counter: 0,
            sr_hold: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "distortionMode" => self.mode = DistortionMode::from_index(value as u32),
            "drive" => self.drive = value,
            "asymmetry" => self.asymmetry = value,
            "foldbackThreshold" => self.fold_threshold = value.max(0.01),
            "bitDepth" => self.bit_depth = (value as u32).clamp(1, 24),
            "sampleRateReduce" => self.sr_reduce = (value as u32).max(1),
            "tubeBias" => self.tube_bias = value,
            "breakdownDepth" => self.breakdown_depth = value,
            _ => {}
        }
    }

    /// Process a single sample through the selected distortion algorithm.
    pub fn process_sample(&mut self, input: f32) -> f32 {
        let drive_linear = 1.0 + self.drive * 0.2; // scale drive to useful range
        let driven = input * drive_linear;

        let shaped = match self.mode {
            DistortionMode::SoftClip => self.soft_clip(driven),
            DistortionMode::HardClip => self.hard_clip(driven),
            DistortionMode::Foldback => self.foldback(driven),
            DistortionMode::Wavefold => self.wavefold(driven),
            DistortionMode::Bitcrush => self.bitcrush(driven),
            DistortionMode::Tube => self.tube(driven),
            DistortionMode::Breakdown | DistortionMode::Smudge | DistortionMode::Custom => {
                // These require FFT/phase vocoder — pass through for now
                self.soft_clip(driven)
            }
        };

        // Apply asymmetry: blend between symmetric and asymmetric
        if self.asymmetry.abs() > 0.001 {
            let asym = if shaped > 0.0 {
                shaped * (1.0 + self.asymmetry * 0.5)
            } else {
                shaped * (1.0 - self.asymmetry * 0.5)
            };
            return asym / drive_linear;
        }

        shaped / drive_linear
    }

    /// y = tanh(k * x)
    fn soft_clip(&self, x: f32) -> f32 {
        x.tanh()
    }

    /// Hard clip at ±1.
    fn hard_clip(&self, x: f32) -> f32 {
        x.clamp(-1.0, 1.0)
    }

    /// Foldback distortion — mirrors signal when exceeding threshold.
    fn foldback(&self, x: f32) -> f32 {
        let t = self.fold_threshold;
        if x.abs() <= t {
            x
        } else if x > t {
            2.0 * t - x
        } else {
            -2.0 * t - x
        }
    }

    /// Multi-stage wavefold.
    fn wavefold(&self, x: f32) -> f32 {
        // Sine-based wavefold for dense harmonics
        (x * std::f32::consts::PI).sin()
    }

    /// Bit depth and sample rate reduction.
    fn bitcrush(&mut self, x: f32) -> f32 {
        // Sample rate reduction
        self.sr_counter += 1;
        if self.sr_counter >= self.sr_reduce {
            self.sr_counter = 0;
            self.sr_hold = x;
        }
        let held = self.sr_hold;

        // Bit depth reduction
        let levels = 2.0_f32.powi(self.bit_depth as i32);
        (held * levels).round() / levels
    }

    /// Simple tube saturation with bias.
    fn tube(&self, x: f32) -> f32 {
        let biased = x + self.tube_bias * 0.1;
        let sat = if biased >= 0.0 {
            1.0 - (-biased).exp()
        } else {
            -(1.0 - biased.exp())
        };
        // Mix in even harmonics from bias
        sat * 0.9 + biased.tanh() * 0.1
    }
}
