//! Sidechain processing — HPF, tilt filter (Thrust), parametric EQ.

use std::f32::consts::PI;

/// 2nd-order Butterworth highpass filter for sidechain.
pub struct SidechainHpf {
    b0: f32, b1: f32, b2: f32,
    a1: f32, a2: f32,
    x1: f32, x2: f32,
    y1: f32, y2: f32,
    enabled: bool,
}

impl SidechainHpf {
    pub fn new(sample_rate: f32, freq: f32) -> Self {
        let mut f = Self {
            b0: 1.0, b1: 0.0, b2: 0.0,
            a1: 0.0, a2: 0.0,
            x1: 0.0, x2: 0.0,
            y1: 0.0, y2: 0.0,
            enabled: true,
        };
        f.set_freq(sample_rate, freq);
        f
    }

    pub fn set_freq(&mut self, sample_rate: f32, freq: f32) {
        let w0 = 2.0 * PI * freq / sample_rate;
        let alpha = w0.sin() / (2.0 * 0.7071); // Q = √2/2 for Butterworth
        let cos_w0 = w0.cos();
        let a0 = 1.0 + alpha;

        self.b0 = ((1.0 + cos_w0) / 2.0) / a0;
        self.b1 = (-(1.0 + cos_w0)) / a0;
        self.b2 = ((1.0 + cos_w0) / 2.0) / a0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        if !self.enabled {
            return x;
        }
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }

    pub fn reset(&mut self) {
        self.x1 = 0.0; self.x2 = 0.0;
        self.y1 = 0.0; self.y2 = 0.0;
    }
}

/// Thrust-style tilt filter for sidechain spectral shaping.
/// Tilts the spectrum: boost high frequencies relative to low,
/// reducing bass-triggered pumping.
pub struct ThrustFilter {
    lp_state: f32,
    /// 0.0 = flat, 1.0 = full tilt (+3 dB/octave)
    tilt_amount: f32,
    /// Center frequency (~640 Hz geometric mean of 20Hz-20kHz)
    center_freq: f32,
    coeff: f32,
    sample_rate: f32,
}

impl ThrustFilter {
    pub fn new(sample_rate: f32) -> Self {
        let mut f = Self {
            lp_state: 0.0,
            tilt_amount: 0.0,
            center_freq: 640.0,
            coeff: 0.0,
            sample_rate,
        };
        f.update_coeff();
        f
    }

    fn update_coeff(&mut self) {
        let wc = 2.0 * PI * self.center_freq / self.sample_rate;
        self.coeff = (1.0 - wc.sin()) / wc.cos();
    }

    /// Set thrust mode: 0 = off/flat, 1 = medium, 2 = loud/full tilt
    pub fn set_mode(&mut self, mode: f32) {
        self.tilt_amount = match mode as u8 {
            0 => 0.0,
            1 => 0.5,
            _ => 1.0,
        };
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        if self.tilt_amount < 0.001 {
            return x;
        }
        // Regalia-Mitra allpass-based tilt
        let lp = (1.0 - self.coeff) * 0.5 * x + self.lp_state;
        self.lp_state = self.coeff * lp + (1.0 - self.coeff) * 0.5 * x;
        let hp = x - lp;
        // Tilt: boost HP, cut LP
        lp * (1.0 - self.tilt_amount) + hp * (1.0 + self.tilt_amount)
    }

    pub fn reset(&mut self) {
        self.lp_state = 0.0;
    }
}
