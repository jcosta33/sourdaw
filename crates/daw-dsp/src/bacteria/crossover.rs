//! Crossover filters for Bacteria's multi-band processing.
//!
//! Default: 4th-order Linkwitz-Riley (LR4) — cascade of two 2nd-order Butterworth.
//! Each crossover point splits signal into low-pass and high-pass outputs.
//! Supports 1–6 bands with up to 5 crossover points.

use std::f32::consts::PI;

/// 2nd-order biquad filter (used to cascade into LR4).
#[derive(Clone)]
struct Biquad {
    b0: f32, b1: f32, b2: f32,
    a1: f32, a2: f32,
    z1: f32, z2: f32,
}

impl Biquad {
    fn new() -> Self {
        Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z1: 0.0, z2: 0.0 }
    }

    fn set_butterworth_lp(&mut self, freq: f32, sample_rate: f32) {
        let w0 = 2.0 * PI * freq / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * 2.0_f32.sqrt()); // Q = sqrt(2) for Butterworth

        let a0 = 1.0 + alpha;
        self.b0 = ((1.0 - cos_w0) / 2.0) / a0;
        self.b1 = (1.0 - cos_w0) / a0;
        self.b2 = self.b0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    fn set_butterworth_hp(&mut self, freq: f32, sample_rate: f32) {
        let w0 = 2.0 * PI * freq / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * 2.0_f32.sqrt());

        let a0 = 1.0 + alpha;
        self.b0 = ((1.0 + cos_w0) / 2.0) / a0;
        self.b1 = (-(1.0 + cos_w0)) / a0;
        self.b2 = self.b0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    fn process_sample(&mut self, input: f32) -> f32 {
        // Direct Form II Transposed
        let out = self.b0 * input + self.z1;
        self.z1 = self.b1 * input - self.a1 * out + self.z2;
        self.z2 = self.b2 * input - self.a2 * out;
        out
    }

    fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

/// LR4 crossover point — splits signal into low-pass and high-pass.
/// Implemented as two cascaded 2nd-order Butterworth filters.
#[derive(Clone)]
pub struct Lr4CrossoverPoint {
    lp1: Biquad,
    lp2: Biquad,
    hp1: Biquad,
    hp2: Biquad,
    freq: f32,
}

impl Lr4CrossoverPoint {
    pub fn new(freq: f32, sample_rate: f32) -> Self {
        let mut point = Self {
            lp1: Biquad::new(),
            lp2: Biquad::new(),
            hp1: Biquad::new(),
            hp2: Biquad::new(),
            freq,
        };
        point.set_freq(freq, sample_rate);
        point
    }

    pub fn set_freq(&mut self, freq: f32, sample_rate: f32) {
        self.freq = freq;
        self.lp1.set_butterworth_lp(freq, sample_rate);
        self.lp2.set_butterworth_lp(freq, sample_rate);
        self.hp1.set_butterworth_hp(freq, sample_rate);
        self.hp2.set_butterworth_hp(freq, sample_rate);
    }

    /// Process one sample, returns (low, high).
    pub fn process(&mut self, input: f32) -> (f32, f32) {
        let lp = self.lp2.process_sample(self.lp1.process_sample(input));
        let hp = self.hp2.process_sample(self.hp1.process_sample(input));
        (lp, hp)
    }

    pub fn reset(&mut self) {
        self.lp1.reset();
        self.lp2.reset();
        self.hp1.reset();
        self.hp2.reset();
    }
}

/// Multi-band crossover engine. Splits stereo input into up to 6 bands.
pub struct CrossoverEngine {
    /// Crossover points for left channel (up to 5)
    points_l: Vec<Lr4CrossoverPoint>,
    /// Crossover points for right channel (up to 5)
    points_r: Vec<Lr4CrossoverPoint>,
    band_count: usize,
    sample_rate: f32,
}

impl CrossoverEngine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            points_l: Vec::new(),
            points_r: Vec::new(),
            band_count: 1,
            sample_rate,
        }
    }

    /// Set the number of bands and crossover frequencies.
    pub fn set_bands(&mut self, band_count: usize, freqs: &[f32]) {
        let n = band_count.clamp(1, 6);
        let num_xovers = n.saturating_sub(1);

        self.band_count = n;
        self.points_l.resize_with(num_xovers, || Lr4CrossoverPoint::new(1000.0, self.sample_rate));
        self.points_r.resize_with(num_xovers, || Lr4CrossoverPoint::new(1000.0, self.sample_rate));

        for i in 0..num_xovers {
            let freq = freqs.get(i).copied().unwrap_or(1000.0).clamp(20.0, 20000.0);
            self.points_l[i].set_freq(freq, self.sample_rate);
            self.points_r[i].set_freq(freq, self.sample_rate);
        }
    }

    /// Split a stereo sample into per-band outputs.
    /// Returns arrays of (left, right) for each band.
    pub fn process_sample(&mut self, left: f32, right: f32, bands_l: &mut [f32], bands_r: &mut [f32]) {
        if self.band_count <= 1 {
            bands_l[0] = left;
            bands_r[0] = right;
            return;
        }

        // Cascading split: input → xover[0] → (low0, rest) → xover[1] → (low1, rest) → ...
        let mut remaining_l = left;
        let mut remaining_r = right;

        for i in 0..self.band_count - 1 {
            let (lo_l, hi_l) = self.points_l[i].process(remaining_l);
            let (lo_r, hi_r) = self.points_r[i].process(remaining_r);
            bands_l[i] = lo_l;
            bands_r[i] = lo_r;
            remaining_l = hi_l;
            remaining_r = hi_r;
        }
        // Last band gets the remaining high-pass
        bands_l[self.band_count - 1] = remaining_l;
        bands_r[self.band_count - 1] = remaining_r;
    }

    pub fn band_count(&self) -> usize {
        self.band_count
    }

    pub fn reset(&mut self) {
        for p in &mut self.points_l {
            p.reset();
        }
        for p in &mut self.points_r {
            p.reset();
        }
    }
}
