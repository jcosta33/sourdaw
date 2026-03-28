/// TPT (Topology-Preserving Transform) State Variable Filter.
/// Implements LP, HP, BP, Notch with zero-delay feedback.
/// Based on Vadim Zavalishin's "The Art of VA Filter Design."

#[derive(Clone, Copy, PartialEq)]
pub enum FilterMode {
    Lowpass,
    Highpass,
    Bandpass,
    Notch,
}

#[derive(Clone)]
pub struct SvfFilter {
    ic1eq: f32,
    ic2eq: f32,
    mode: FilterMode,
    drive: f32,
}

impl SvfFilter {
    pub fn new() -> Self {
        Self {
            ic1eq: 0.0,
            ic2eq: 0.0,
            mode: FilterMode::Lowpass,
            drive: 0.0,
        }
    }

    pub fn set_mode(&mut self, mode: FilterMode) {
        self.mode = mode;
    }

    pub fn set_drive(&mut self, drive: f32) {
        self.drive = drive.clamp(0.0, 10.0);
    }

    /// Process a single sample through the SVF.
    /// `cutoff` in Hz, `resonance` as Q (0.5–20.0), `sample_rate` in Hz.
    #[inline]
    pub fn process(&mut self, input: f32, cutoff: f32, resonance: f32, sample_rate: f32) -> f32 {
        // Pre-warp cutoff frequency
        let g = (std::f32::consts::PI * cutoff / sample_rate).tan();
        let k = 1.0 / resonance.max(0.5);

        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;

        let v3 = input - self.ic2eq;
        let v1 = a1 * self.ic1eq + a2 * v3;
        let v2 = self.ic2eq + a2 * self.ic1eq + a3 * v3;

        self.ic1eq = 2.0 * v1 - self.ic1eq;
        self.ic2eq = 2.0 * v2 - self.ic2eq;

        let output = match self.mode {
            FilterMode::Lowpass => v2,
            FilterMode::Highpass => input - k * v1 - v2,
            FilterMode::Bandpass => v1,
            FilterMode::Notch => input - k * v1,
        };

        // Apply drive/saturation when drive > 0.001
        if self.drive > 0.001 {
            fast_tanh(output * (1.0 + self.drive))
        } else {
            output
        }
    }

    pub fn reset(&mut self) {
        self.ic1eq = 0.0;
        self.ic2eq = 0.0;
    }
}

/// Fast tanh approximation for saturation.
#[inline]
fn fast_tanh(x: f32) -> f32 {
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}
