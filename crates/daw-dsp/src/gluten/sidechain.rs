//! Sidechain processing — HPF, LPF, tilt filter (Thrust), parametric EQ.

use crate::primitives::flush_denormal;
use std::f32::consts::{FRAC_1_SQRT_2, PI};

/// 2nd-order Butterworth highpass filter for sidechain.
pub struct SidechainHpf {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
    enabled: bool,
}

impl SidechainHpf {
    pub fn new(sample_rate: f32, freq: f32) -> Self {
        let mut f = Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
            enabled: true,
        };
        f.set_freq(sample_rate, freq);
        f
    }

    pub fn set_freq(&mut self, sample_rate: f32, freq: f32) {
        if !sample_rate.is_finite() || sample_rate <= 0.0 || !freq.is_finite() {
            return;
        }
        let w0 = 2.0 * PI * freq / sample_rate;
        let alpha = w0.sin() / (2.0 * FRAC_1_SQRT_2);
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
        let y = flush_denormal(
            self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
                - self.a1 * self.y1
                - self.a2 * self.y2,
        );
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }

    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

/// 2nd-order Butterworth lowpass filter for sidechain.
pub struct SidechainLpf {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
    enabled: bool,
}

impl SidechainLpf {
    pub fn new(sample_rate: f32, freq: f32) -> Self {
        let mut f = Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
            enabled: false,
        };
        f.set_freq(sample_rate, freq);
        f
    }

    pub fn set_freq(&mut self, sample_rate: f32, freq: f32) {
        if !sample_rate.is_finite() || sample_rate <= 0.0 || !freq.is_finite() {
            return;
        }
        let w0 = 2.0 * PI * freq / sample_rate;
        let alpha = w0.sin() / (2.0 * FRAC_1_SQRT_2);
        let cos_w0 = w0.cos();
        let a0 = 1.0 + alpha;

        self.b0 = ((1.0 - cos_w0) / 2.0) / a0;
        self.b1 = (1.0 - cos_w0) / a0;
        self.b2 = ((1.0 - cos_w0) / 2.0) / a0;
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
        let y = flush_denormal(
            self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
                - self.a1 * self.y1
                - self.a2 * self.y2,
        );
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }

    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

/// Thrust-style tilt filter for sidechain spectral shaping.
pub struct ThrustFilter {
    lp_state: f32,
    tilt_amount: f32,
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
        let lp = (1.0 - self.coeff) * 0.5 * x + self.lp_state;
        self.lp_state = self.coeff * lp + (1.0 - self.coeff) * 0.5 * x;
        let hp = x - lp;
        lp * (1.0 - self.tilt_amount) + hp * (1.0 + self.tilt_amount)
    }

    pub fn reset(&mut self) {
        self.lp_state = 0.0;
    }
}

/// Parametric EQ band for sidechain — peaking/bell filter.
/// Allows surgical frequency-dependent compression control.
pub struct SidechainEq {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
    enabled: bool,
    freq: f32,
    gain_db: f32,
    q: f32,
    sample_rate: f32,
}

impl SidechainEq {
    pub fn new(sample_rate: f32) -> Self {
        let mut eq = Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
            enabled: false,
            freq: 1000.0,
            gain_db: 0.0,
            q: 1.0,
            sample_rate,
        };
        eq.update_coeffs();
        eq
    }

    pub fn set_freq(&mut self, freq: f32) {
        if !freq.is_finite() {
            return;
        }
        self.freq = freq.clamp(20.0, 20000.0);
        self.update_coeffs();
    }
    pub fn set_gain(&mut self, gain_db: f32) {
        if !gain_db.is_finite() {
            return;
        }
        self.gain_db = gain_db.clamp(-18.0, 18.0);
        self.update_coeffs();
    }
    pub fn set_q(&mut self, q: f32) {
        if !q.is_finite() {
            return;
        }
        self.q = q.clamp(0.1, 10.0);
        self.update_coeffs();
    }
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn update_coeffs(&mut self) {
        let a = 10.0_f32.powf(self.gain_db / 40.0);
        let w0 = 2.0 * PI * self.freq / self.sample_rate;
        let alpha = w0.sin() / (2.0 * self.q);
        let cos_w0 = w0.cos();
        let a0 = 1.0 + alpha / a;

        self.b0 = (1.0 + alpha * a) / a0;
        self.b1 = (-2.0 * cos_w0) / a0;
        self.b2 = (1.0 - alpha * a) / a0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha / a) / a0;
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        if !self.enabled || self.gain_db.abs() < 0.01 {
            return x;
        }
        let y = flush_denormal(
            self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
                - self.a1 * self.y1
                - self.a2 * self.y2,
        );
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }

    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

/// One topology's stereo detector-conditioning path.
///
/// Every topology keeps independent stereo filter history; sharing would couple
/// channels and make a dual-stage chain advance the same state twice per sample.
pub struct SidechainChain {
    hpf_l: SidechainHpf,
    hpf_r: SidechainHpf,
    lpf_l: SidechainLpf,
    lpf_r: SidechainLpf,
    eq_l: SidechainEq,
    eq_r: SidechainEq,
    thrust_l: ThrustFilter,
    thrust_r: ThrustFilter,
}

impl SidechainChain {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            hpf_l: SidechainHpf::new(sample_rate, 80.0),
            hpf_r: SidechainHpf::new(sample_rate, 80.0),
            lpf_l: SidechainLpf::new(sample_rate, 20_000.0),
            lpf_r: SidechainLpf::new(sample_rate, 20_000.0),
            eq_l: SidechainEq::new(sample_rate),
            eq_r: SidechainEq::new(sample_rate),
            thrust_l: ThrustFilter::new(sample_rate),
            thrust_r: ThrustFilter::new(sample_rate),
        }
    }
    pub fn set_hpf_freq(&mut self, sample_rate: f32, frequency: f32) {
        let frequency = frequency.clamp(20.0, 500.0);
        self.hpf_l.set_freq(sample_rate, frequency);
        self.hpf_r.set_freq(sample_rate, frequency);
    }
    pub fn set_hpf_enabled(&mut self, enabled: bool) {
        self.hpf_l.set_enabled(enabled);
        self.hpf_r.set_enabled(enabled);
    }
    pub fn set_lpf_freq(&mut self, sample_rate: f32, frequency: f32) {
        let frequency = frequency.clamp(1000.0, 20_000.0);
        self.lpf_l.set_freq(sample_rate, frequency);
        self.lpf_r.set_freq(sample_rate, frequency);
    }
    pub fn set_lpf_enabled(&mut self, enabled: bool) {
        self.lpf_l.set_enabled(enabled);
        self.lpf_r.set_enabled(enabled);
    }
    pub fn set_eq_freq(&mut self, frequency: f32) {
        self.eq_l.set_freq(frequency);
        self.eq_r.set_freq(frequency);
    }
    pub fn set_eq_gain(&mut self, gain_db: f32) {
        self.eq_l.set_gain(gain_db);
        self.eq_r.set_gain(gain_db);
    }
    pub fn set_eq_q(&mut self, q: f32) {
        self.eq_l.set_q(q);
        self.eq_r.set_q(q);
    }
    pub fn set_eq_enabled(&mut self, enabled: bool) {
        self.eq_l.set_enabled(enabled);
        self.eq_r.set_enabled(enabled);
    }
    pub fn set_thrust(&mut self, mode: f32) {
        self.thrust_l.set_mode(mode);
        self.thrust_r.set_mode(mode);
    }

    #[inline]
    pub fn process(&mut self, left: f32, right: f32) -> (f32, f32) {
        let left = self.thrust_l.process(
            self.eq_l
                .process(self.lpf_l.process(self.hpf_l.process(left))),
        );
        let right = self.thrust_r.process(
            self.eq_r
                .process(self.lpf_r.process(self.hpf_r.process(right))),
        );
        (left, right)
    }
}
