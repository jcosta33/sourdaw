/// Audio preprocessing for pitch detection.
/// DC removal, adaptive bandpass, RMS gate, Hann windowing.

use std::f32::consts::TAU;

/// First-order IIR highpass for DC removal (~20 Hz cutoff).
pub struct DcBlocker {
    prev_in: f32,
    prev_out: f32,
    coeff: f32,
}

impl DcBlocker {
    pub fn new(sample_rate: f32) -> Self {
        // Highpass at ~20 Hz
        let coeff = 1.0 - (TAU * 20.0 / sample_rate);
        Self { prev_in: 0.0, prev_out: 0.0, coeff }
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let output = self.coeff * (self.prev_out + input - self.prev_in);
        self.prev_in = input;
        self.prev_out = output;
        output
    }
}

/// SVF bandpass filter (adaptive, 40 Hz – 5 kHz).
pub struct Bandpass {
    ic1: f32,
    ic2: f32,
    g: f32,
    k: f32,
}

impl Bandpass {
    pub fn new(center_hz: f32, q: f32, sample_rate: f32) -> Self {
        let g = (TAU * center_hz / sample_rate * 0.5).tan();
        let k = 1.0 / q;
        Self { ic1: 0.0, ic2: 0.0, g, k }
    }

    pub fn set_freq(&mut self, center_hz: f32, q: f32, sample_rate: f32) {
        self.g = (TAU * center_hz / sample_rate * 0.5).tan();
        self.k = 1.0 / q;
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let a1 = 1.0 / (1.0 + self.g * (self.g + self.k));
        let a2 = self.g * a1;
        let a3 = self.g * a2;

        let v3 = input - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;

        // Bandpass output
        self.k * v1
    }
}

/// RMS level with exponential averaging.
pub struct RmsTracker {
    rms_sq: f32,
    coeff: f32,
}

impl RmsTracker {
    pub fn new(sample_rate: f32, time_constant: f32) -> Self {
        Self {
            rms_sq: 0.0,
            coeff: (-1.0 / (time_constant * sample_rate)).exp(),
        }
    }

    #[inline]
    pub fn update(&mut self, sample: f32) -> f32 {
        self.rms_sq = self.rms_sq * self.coeff + sample * sample * (1.0 - self.coeff);
        self.rms_sq.sqrt()
    }

    pub fn level(&self) -> f32 {
        self.rms_sq.sqrt()
    }
}

/// Apply Hann window to a buffer in-place.
pub fn apply_hann_window(buffer: &mut [f32]) {
    let n = buffer.len();
    if n == 0 { return; }
    let inv_n = 1.0 / n as f32;
    for i in 0..n {
        let w = 0.5 * (1.0 - (TAU * i as f32 * inv_n).cos());
        buffer[i] *= w;
    }
}

/// Normalize amplitude to [-1, 1] range.
pub fn normalize(buffer: &mut [f32]) {
    let peak = buffer.iter().map(|s| s.abs()).fold(0.0_f32, f32::max);
    if peak > 1e-10 {
        let inv = 1.0 / peak;
        for s in buffer.iter_mut() {
            *s *= inv;
        }
    }
}
