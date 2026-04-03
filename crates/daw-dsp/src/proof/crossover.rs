//! LR-4 crossover filter — 4th-order Linkwitz-Riley.
//! Two cascaded Butterworth biquads per output. LP + HP sum to flat allpass.

use super::biquad::{BiquadCoeffs, BiquadState};

const BUTTERWORTH_Q: f64 = std::f64::consts::FRAC_1_SQRT_2;

/// Single LR-4 crossover point — splits into low and high bands.
pub struct Lr4Crossover {
    lp1_l: BiquadState,
    lp2_l: BiquadState,
    hp1_l: BiquadState,
    hp2_l: BiquadState,
    lp1_r: BiquadState,
    lp2_r: BiquadState,
    hp1_r: BiquadState,
    hp2_r: BiquadState,
    lp_coeffs: BiquadCoeffs,
    hp_coeffs: BiquadCoeffs,
}

impl Lr4Crossover {
    pub fn new(freq: f64, sr: f64) -> Self {
        Self {
            lp1_l: BiquadState::new(),
            lp2_l: BiquadState::new(),
            hp1_l: BiquadState::new(),
            hp2_l: BiquadState::new(),
            lp1_r: BiquadState::new(),
            lp2_r: BiquadState::new(),
            hp1_r: BiquadState::new(),
            hp2_r: BiquadState::new(),
            lp_coeffs: BiquadCoeffs::lowpass(freq, BUTTERWORTH_Q, sr),
            hp_coeffs: BiquadCoeffs::highpass(freq, BUTTERWORTH_Q, sr),
        }
    }

    pub fn set_freq(&mut self, freq: f64, sr: f64) {
        self.lp_coeffs = BiquadCoeffs::lowpass(freq, BUTTERWORTH_Q, sr);
        self.hp_coeffs = BiquadCoeffs::highpass(freq, BUTTERWORTH_Q, sr);
    }

    /// Process stereo sample, returns ((low_l, low_r), (high_l, high_r)).
    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> ((f32, f32), (f32, f32)) {
        let low_l = self
            .lp2_l
            .process(self.lp1_l.process(l, &self.lp_coeffs), &self.lp_coeffs);
        let low_r = self
            .lp2_r
            .process(self.lp1_r.process(r, &self.lp_coeffs), &self.lp_coeffs);
        let high_l = self
            .hp2_l
            .process(self.hp1_l.process(l, &self.hp_coeffs), &self.hp_coeffs);
        let high_r = self
            .hp2_r
            .process(self.hp1_r.process(r, &self.hp_coeffs), &self.hp_coeffs);
        ((low_l, low_r), (high_l, high_r))
    }
}

/// 4-band splitter using 3 cascaded LR-4 crossovers.
/// Crossover frequencies: f1 < f2 < f3.
pub struct FourBandSplitter {
    xover1: Lr4Crossover,
    xover2: Lr4Crossover,
    xover3: Lr4Crossover,
}

impl FourBandSplitter {
    pub fn new(f1: f64, f2: f64, f3: f64, sr: f64) -> Self {
        Self {
            xover1: Lr4Crossover::new(f1, sr),
            xover2: Lr4Crossover::new(f2, sr),
            xover3: Lr4Crossover::new(f3, sr),
        }
    }

    pub fn set_freqs(&mut self, f1: f64, f2: f64, f3: f64, sr: f64) {
        self.xover1.set_freq(f1, sr);
        self.xover2.set_freq(f2, sr);
        self.xover3.set_freq(f3, sr);
    }

    /// Returns 4 bands: (low_l, low_r), (low_mid_l, low_mid_r), (high_mid_l, high_mid_r), (high_l, high_r)
    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> [(f32, f32); 4] {
        let (low, high_a) = self.xover1.process(l, r);
        let (low_mid, high_b) = self.xover2.process(high_a.0, high_a.1);
        let (high_mid, high) = self.xover3.process(high_b.0, high_b.1);
        [low, low_mid, high_mid, high]
    }
}
