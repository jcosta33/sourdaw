//! Multiband dynamics — per-band feed-forward compressor with LR-4 crossover.

use super::crossover::FourBandSplitter;

const NUM_BANDS: usize = 4;

/// Per-band compressor state.
struct BandCompressor {
    threshold: f32,    // dB
    ratio: f32,        // 1:1 to inf
    attack_coeff: f32,
    release_coeff: f32,
    knee_width: f32,   // dB
    makeup_db: f32,
    auto_makeup: bool,
    envelope: f32,     // current envelope in dB
    bypassed: bool,
    solo: bool,
    sample_rate: f32,
}

impl BandCompressor {
    fn new(sr: f32) -> Self {
        Self {
            threshold: -20.0,
            ratio: 2.0,
            attack_coeff: (-1.0 / (0.01 * sr)).exp(),
            release_coeff: (-1.0 / (0.1 * sr)).exp(),
            knee_width: 6.0,
            makeup_db: 0.0,
            auto_makeup: true,
            envelope: -100.0,
            bypassed: false,
            solo: false,
            sample_rate: sr,
        }
    }

    fn set_attack(&mut self, ms: f32) {
        self.attack_coeff = (-1.0 / (ms * 0.001 * self.sample_rate)).exp();
    }

    fn set_release(&mut self, ms: f32) {
        self.release_coeff = (-1.0 / (ms * 0.001 * self.sample_rate)).exp();
    }

    /// Process a single sample, returns gain reduction in dB (negative).
    #[inline]
    fn compute_gr(&mut self, level_db: f32) -> f32 {
        // Envelope follower
        let coeff = if level_db > self.envelope { self.attack_coeff } else { self.release_coeff };
        self.envelope = coeff * self.envelope + (1.0 - coeff) * level_db;

        // Gain computer (soft-knee)
        let slope = 1.0 - 1.0 / self.ratio;
        let half_w = self.knee_width / 2.0;
        let overshoot = self.envelope - self.threshold;

        let gr_db = if overshoot <= -half_w {
            0.0
        } else if overshoot >= half_w {
            -slope * overshoot
        } else {
            -0.5 * slope * (overshoot + half_w) * (overshoot + half_w) / self.knee_width
        };

        // Apply makeup
        let makeup = if self.auto_makeup {
            let at_0 = (0.0 - self.threshold).max(0.0) * (1.0 - 1.0 / self.ratio);
            at_0 / 2.0
        } else {
            self.makeup_db
        };

        gr_db + makeup
    }

    fn current_gr_db(&self) -> f32 {
        let slope = 1.0 - 1.0 / self.ratio;
        let overshoot = self.envelope - self.threshold;
        if overshoot > 0.0 { -slope * overshoot } else { 0.0 }
    }
}

pub struct MultibandDynamics {
    splitter: FourBandSplitter,
    bands: [BandCompressor; NUM_BANDS],
    crossover_freqs: [f64; 3],
    sample_rate: f64,
    bypassed: bool,
    // Metering: per-band GR
    meter_gr: [f32; NUM_BANDS],
}

impl MultibandDynamics {
    pub fn new(sr: f64) -> Self {
        let freqs = [120.0, 1000.0, 8000.0];
        Self {
            splitter: FourBandSplitter::new(freqs[0], freqs[1], freqs[2], sr),
            bands: core::array::from_fn(|_| BandCompressor::new(sr as f32)),
            crossover_freqs: freqs,
            sample_rate: sr,
            bypassed: false,
            meter_gr: [0.0; NUM_BANDS],
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        if name == "dyn_bypass" { self.bypassed = value > 0.5; return; }

        // Crossover frequencies: dyn_xover0, dyn_xover1, dyn_xover2
        if name.starts_with("dyn_xover") {
            if let Some(idx_char) = name.as_bytes().get(9) {
                let idx = (*idx_char - b'0') as usize;
                if idx < 3 {
                    self.crossover_freqs[idx] = (value as f64).clamp(20.0, 20000.0);
                    self.splitter.set_freqs(
                        self.crossover_freqs[0], self.crossover_freqs[1], self.crossover_freqs[2],
                        self.sample_rate,
                    );
                }
            }
            return;
        }

        // Per-band params: dyn_bandN_param
        if !name.starts_with("dyn_band") || name.len() < 11 { return; }
        let idx = match name.as_bytes()[8] {
            b'0'..=b'3' => (name.as_bytes()[8] - b'0') as usize,
            _ => return,
        };
        let param = &name[10..]; // skip "dyn_bandN_"
        let band = &mut self.bands[idx];

        match param {
            "threshold" => band.threshold = value.clamp(-60.0, 0.0),
            "ratio" => band.ratio = value.clamp(1.0, 20.0),
            "attack" => band.set_attack(value.clamp(1.0, 200.0)),
            "release" => band.set_release(value.clamp(10.0, 2000.0)),
            "knee" => band.knee_width = value.clamp(0.0, 12.0),
            "makeup" => band.makeup_db = value.clamp(-12.0, 24.0),
            "auto_makeup" => band.auto_makeup = value > 0.5,
            "bypass" => band.bypassed = value > 0.5,
            "solo" => band.solo = value > 0.5,
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed { return; }

        let any_solo = self.bands.iter().any(|b| b.solo);

        for i in 0..left.len() {
            let band_signals = self.splitter.process(left[i], right[i]);
            let mut out_l = 0.0_f32;
            let mut out_r = 0.0_f32;

            for (b_idx, (bl, br)) in band_signals.iter().enumerate() {
                let band = &mut self.bands[b_idx];
                let mut l = *bl;
                let mut r = *br;

                if !band.bypassed {
                    // Detect level (peak of L/R)
                    let peak = l.abs().max(r.abs());
                    let level_db = if peak > 1e-10 { 20.0 * peak.log10() } else { -100.0 };

                    let gr_lin = {
                        let gr_db = band.compute_gr(level_db);
                        10.0_f32.powf(gr_db / 20.0)
                    };

                    l *= gr_lin;
                    r *= gr_lin;
                }

                // Solo mode: only output soloed bands
                if any_solo && !band.solo {
                    continue;
                }

                out_l += l;
                out_r += r;
            }

            left[i] = out_l;
            right[i] = out_r;
        }

        // Update metering
        for (b_idx, band) in self.bands.iter().enumerate() {
            self.meter_gr[b_idx] = band.current_gr_db();
        }
    }

    pub fn get_band_gr(&self) -> &[f32; NUM_BANDS] { &self.meter_gr }
    pub fn is_bypassed(&self) -> bool { self.bypassed }
}
