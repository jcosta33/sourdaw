//! Dynamic EQ — per-band compressor/expander modulating EQ gain.
//!
//! Each band has a sidechain bandpass detector that tracks the signal level
//! in a specific frequency range. When the level crosses the threshold,
//! the EQ band's gain is modulated by the gain reduction amount.
//!
//! This allows frequency-selective compression: e.g., tame 2-4kHz harshness
//! only when it gets too loud, without affecting quiet passages.

use super::biquad::{BiquadCoeffs, BiquadState};

const MAX_DYN_BANDS: usize = 4;

#[derive(Clone, Copy, PartialEq)]
pub enum DynEqMode {
    /// Reduce gain when level exceeds threshold (tame resonances)
    Compress,
    /// Increase gain when level exceeds threshold (boost when present)
    Expand,
}

struct DynEqBand {
    enabled: bool,
    mode: DynEqMode,
    freq: f64,
    q: f64,
    threshold_db: f32,
    ratio: f32,           // > 1 for compression
    attack_coeff: f32,
    release_coeff: f32,
    max_gain_db: f32,     // range limit (±24 dB)
    // Sidechain bandpass filter for level detection
    sc_bp_l: BiquadState,
    sc_bp_r: BiquadState,
    sc_bp_coeffs: BiquadCoeffs,
    // EQ band filter for applying the gain
    eq_l: BiquadState,
    eq_r: BiquadState,
    eq_coeffs: BiquadCoeffs,
    // Envelope
    envelope: f32,
    sample_rate: f64,
}

impl DynEqBand {
    fn new(freq: f64, sr: f64) -> Self {
        let q = 1.0;
        Self {
            enabled: false,
            mode: DynEqMode::Compress,
            freq,
            q,
            threshold_db: -20.0,
            ratio: 2.0,
            attack_coeff: (-1.0 / (0.01 * sr as f32)).exp(),
            release_coeff: (-1.0 / (0.1 * sr as f32)).exp(),
            max_gain_db: 12.0,
            sc_bp_l: BiquadState::new(),
            sc_bp_r: BiquadState::new(),
            sc_bp_coeffs: BiquadCoeffs::bandpass(freq, q, sr),
            eq_l: BiquadState::new(),
            eq_r: BiquadState::new(),
            eq_coeffs: BiquadCoeffs::unity(),
            envelope: -100.0,
            sample_rate: sr,
        }
    }

    fn recompute_sc(&mut self) {
        self.sc_bp_coeffs = BiquadCoeffs::bandpass(self.freq, self.q, self.sample_rate);
    }

    fn set_attack(&mut self, ms: f32) {
        self.attack_coeff = (-1.0 / (ms * 0.001 * self.sample_rate as f32)).exp();
    }

    fn set_release(&mut self, ms: f32) {
        self.release_coeff = (-1.0 / (ms * 0.001 * self.sample_rate as f32)).exp();
    }

    /// Process a stereo sample pair. Returns the output with dynamic EQ applied.
    #[inline]
    fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        if !self.enabled { return (l, r); }

        // 1. Sidechain: bandpass filter the input to detect level in target frequency range
        let sc_l = self.sc_bp_l.process(l, &self.sc_bp_coeffs);
        let sc_r = self.sc_bp_r.process(r, &self.sc_bp_coeffs);
        let level = sc_l.abs().max(sc_r.abs());

        // 2. Envelope follower
        let level_db = if level > 1e-10 { 20.0 * level.log10() } else { -100.0 };
        let coeff = if level_db > self.envelope { self.attack_coeff } else { self.release_coeff };
        self.envelope = coeff * self.envelope + (1.0 - coeff) * level_db;

        // 3. Gain computer
        let overshoot = self.envelope - self.threshold_db;
        let gr_db = match self.mode {
            DynEqMode::Compress => {
                if overshoot > 0.0 {
                    -(1.0 - 1.0 / self.ratio) * overshoot
                } else {
                    0.0
                }
            }
            DynEqMode::Expand => {
                if overshoot > 0.0 {
                    (1.0 - 1.0 / self.ratio) * overshoot
                } else {
                    0.0
                }
            }
        };

        // Clamp to range
        let gr_db = gr_db.clamp(-self.max_gain_db, self.max_gain_db);

        // 4. Rebuild EQ coefficients with modulated gain and apply
        // For efficiency, we blend between dry and fully-EQ'd based on GR amount
        // rather than rebuilding coefficients per-sample
        if gr_db.abs() < 0.01 { return (l, r); }

        // Update EQ band with the computed dynamic gain
        self.eq_coeffs = BiquadCoeffs::peak(self.freq, gr_db as f64, self.q, self.sample_rate);
        let eq_l = self.eq_l.process(l, &self.eq_coeffs);
        let eq_r = self.eq_r.process(r, &self.eq_coeffs);

        (eq_l, eq_r)
    }
}

pub struct DynamicEq {
    bands: [DynEqBand; MAX_DYN_BANDS],
    sample_rate: f64,
    bypassed: bool,
}

impl DynamicEq {
    pub fn new(sr: f64) -> Self {
        let default_freqs = [200.0, 1000.0, 3000.0, 8000.0];
        Self {
            bands: core::array::from_fn(|i| DynEqBand::new(default_freqs[i], sr)),
            sample_rate: sr,
            bypassed: false,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        if name == "dyneq_bypass" { self.bypassed = value > 0.5; return; }

        // Per-band: dyneq_bandN_param
        if !name.starts_with("dyneq_band") || name.len() < 13 { return; }
        let idx = match name.as_bytes()[10] {
            b'0'..=b'3' => (name.as_bytes()[10] - b'0') as usize,
            _ => return,
        };
        let param = &name[12..]; // skip "dyneq_bandN_"
        let band = &mut self.bands[idx];

        match param {
            "freq" => { band.freq = (value as f64).clamp(20.0, 20000.0); band.recompute_sc(); }
            "q" => { band.q = (value as f64).clamp(0.1, 10.0); band.recompute_sc(); }
            "threshold" => band.threshold_db = value.clamp(-60.0, 0.0),
            "ratio" => band.ratio = value.clamp(1.0, 20.0),
            "attack" => band.set_attack(value.clamp(1.0, 200.0)),
            "release" => band.set_release(value.clamp(10.0, 2000.0)),
            "range" => band.max_gain_db = value.clamp(0.0, 24.0),
            "mode" => band.mode = if value > 0.5 { DynEqMode::Expand } else { DynEqMode::Compress },
            "enabled" => band.enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed { return; }

        for i in 0..left.len() {
            let mut l = left[i];
            let mut r = right[i];

            for band in self.bands.iter_mut() {
                let (nl, nr) = band.process(l, r);
                l = nl;
                r = nr;
            }

            left[i] = l;
            right[i] = r;
        }
    }

    pub fn is_bypassed(&self) -> bool { self.bypassed }
}
