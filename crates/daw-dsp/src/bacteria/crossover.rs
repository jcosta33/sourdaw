//! Crossover filters for Bacteria's multi-band processing.
//!
//! Default: 4th-order Linkwitz-Riley (LR4) — cascade of two 2nd-order Butterworth.
//! Each crossover point splits signal into low-pass and high-pass outputs.
//! Supports 1–6 bands with up to 5 crossover points.

use crate::primitives::flush_denormal;
use std::f32::consts::PI;

/// Butterworth Q for one stage of an LR4 cascade (1/√2), matching the sister
/// implementation in proof/crossover.rs.
const BUTTERWORTH_Q: f32 = std::f32::consts::FRAC_1_SQRT_2;

/// 2nd-order biquad filter (used to cascade into LR4).
#[derive(Clone)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    fn new() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    fn set_butterworth_lp(&mut self, freq: f32, sample_rate: f32) {
        let w0 = 2.0 * PI * freq / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        // RBJ: alpha = sin(w0) / (2Q). One LR4 stage is Butterworth, Q = 1/√2 —
        // Q = √2 here put +6 dB/stage into every crossover (audit #508 row 25).
        let alpha = sin_w0 / (2.0 * BUTTERWORTH_Q);

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
        let alpha = sin_w0 / (2.0 * BUTTERWORTH_Q);

        let a0 = 1.0 + alpha;
        self.b0 = ((1.0 + cos_w0) / 2.0) / a0;
        self.b1 = (-(1.0 + cos_w0)) / a0;
        self.b2 = self.b0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    fn process_sample(&mut self, input: f32) -> f32 {
        // Direct Form II Transposed
        let out = flush_denormal(self.b0 * input + self.z1);
        self.z1 = flush_denormal(self.b1 * input - self.a1 * out + self.z2);
        self.z2 = flush_denormal(self.b2 * input - self.a2 * out);
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
    /// Allpass points for left channel to compensate lower bands (up to 10)
    allpass_points_l: Vec<Lr4CrossoverPoint>,
    /// Allpass points for right channel to compensate lower bands (up to 10)
    allpass_points_r: Vec<Lr4CrossoverPoint>,
    band_count: usize,
    sample_rate: f32,
}

/// Maximum crossover split points (6 bands → 5 points).
const MAX_CROSSOVER_POINTS: usize = 5;
/// Maximum allpass compensation points (Σ i for i in 1..5).
const MAX_ALLPASS_POINTS: usize = 10;

impl CrossoverEngine {
    pub fn new(sample_rate: f32) -> Self {
        // Pre-allocate the full topology at construction: set_bands runs on the
        // audio rendering thread (via set_param), so it must never grow these
        // Vecs — activity is gated by band_count, not Vec length.
        let make_points = |count: usize| {
            let mut points = Vec::with_capacity(count);
            points.resize_with(count, || Lr4CrossoverPoint::new(1000.0, sample_rate));
            points
        };
        Self {
            points_l: make_points(MAX_CROSSOVER_POINTS),
            points_r: make_points(MAX_CROSSOVER_POINTS),
            allpass_points_l: make_points(MAX_ALLPASS_POINTS),
            allpass_points_r: make_points(MAX_ALLPASS_POINTS),
            band_count: 1,
            sample_rate,
        }
    }

    /// Set the number of bands and crossover frequencies.
    pub fn set_bands(&mut self, band_count: usize, freqs: &[f32]) {
        let n = band_count.clamp(1, 6);
        let num_xovers = n.saturating_sub(1);

        // Topology switch: reset biquad state (z1/z2) so newly activated points
        // don't replay stale state from a previous configuration (click) and
        // active points don't carry history across the band-layout change.
        if n != self.band_count {
            self.reset();
        }
        self.band_count = n;

        let mut ap_idx = 0;
        for i in 0..num_xovers {
            let freq = freqs.get(i).copied().unwrap_or(1000.0).clamp(20.0, 20000.0);
            self.points_l[i].set_freq(freq, self.sample_rate);
            self.points_r[i].set_freq(freq, self.sample_rate);

            if i > 0 {
                for _j in 0..i {
                    self.allpass_points_l[ap_idx].set_freq(freq, self.sample_rate);
                    self.allpass_points_r[ap_idx].set_freq(freq, self.sample_rate);
                    ap_idx += 1;
                }
            }
        }
    }

    /// Split a stereo sample into per-band outputs.
    /// Returns arrays of (left, right) for each band.
    pub fn process_sample(
        &mut self,
        left: f32,
        right: f32,
        bands_l: &mut [f32],
        bands_r: &mut [f32],
    ) {
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

        // Apply allpasses to lower bands to compensate for phase delays introduced by subsequent crossovers
        let mut ap_idx = 0;
        for i in 1..self.band_count - 1 {
            for j in 0..i {
                let (lp_l, hp_l) = self.allpass_points_l[ap_idx].process(bands_l[j]);
                bands_l[j] = lp_l + hp_l;

                let (lp_r, hp_r) = self.allpass_points_r[ap_idx].process(bands_r[j]);
                bands_r[j] = lp_r + hp_r;

                ap_idx += 1;
            }
        }
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
        for p in &mut self.allpass_points_l {
            p.reset();
        }
        for p in &mut self.allpass_points_r {
            p.reset();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RT contract: the full topology is allocated at construction and
    /// set_bands (which runs on the audio thread via set_param) never grows
    /// or shrinks storage — activity is gated by band_count alone.
    #[test]
    fn new_preallocates_full_topology_and_set_bands_never_grows_storage() {
        let mut xover = CrossoverEngine::new(48_000.0);
        assert_eq!(
            (
                xover.points_l.len(),
                xover.points_r.len(),
                xover.allpass_points_l.len(),
                xover.allpass_points_r.len(),
            ),
            (
                MAX_CROSSOVER_POINTS,
                MAX_CROSSOVER_POINTS,
                MAX_ALLPASS_POINTS,
                MAX_ALLPASS_POINTS
            )
        );
        let capacities = (
            xover.points_l.capacity(),
            xover.points_r.capacity(),
            xover.allpass_points_l.capacity(),
            xover.allpass_points_r.capacity(),
        );

        let freqs = [200.0, 800.0, 2500.0, 6000.0, 12000.0];
        for n in [2usize, 6, 3, 1, 5, 6] {
            xover.set_bands(n, &freqs);
            assert_eq!(xover.points_l.len(), MAX_CROSSOVER_POINTS);
            assert_eq!(xover.allpass_points_r.len(), MAX_ALLPASS_POINTS);
            assert_eq!(
                (
                    xover.points_l.capacity(),
                    xover.points_r.capacity(),
                    xover.allpass_points_l.capacity(),
                    xover.allpass_points_r.capacity(),
                ),
                capacities,
                "set_bands({n}) changed storage — allocation on the RT path"
            );
        }
    }

    /// A band-count change must clear biquad z1/z2 state so the new topology
    /// does not replay stale filter history (transient click).
    #[test]
    fn band_count_change_resets_filter_state() {
        let mut xover = CrossoverEngine::new(48_000.0);
        let freqs = [1000.0, 3000.0, 8000.0, 12000.0, 16000.0];
        xover.set_bands(3, &freqs);

        let mut bands_l = [0.0_f32; 6];
        let mut bands_r = [0.0_f32; 6];
        for i in 0..512 {
            let s = (i as f32 * 0.1).sin();
            xover.process_sample(s, s, &mut bands_l, &mut bands_r);
        }
        let dirty = xover
            .points_l
            .iter()
            .any(|p| p.lp1.z1 != 0.0 || p.lp1.z2 != 0.0);
        assert!(
            dirty,
            "expected filter state to accumulate while processing"
        );

        xover.set_bands(2, &freqs);
        let clean = xover
            .points_l
            .iter()
            .chain(xover.points_r.iter())
            .chain(xover.allpass_points_l.iter())
            .chain(xover.allpass_points_r.iter())
            .all(|p| p.lp1.z1 == 0.0 && p.lp1.z2 == 0.0 && p.hp2.z1 == 0.0 && p.hp2.z2 == 0.0);
        assert!(clean, "topology switch left stale filter state");
    }

    /// Steady-state magnitude (dB) of the summed band outputs for a sine at
    /// `test_freq`, relative to the input. A correct LR4 crossover sums flat
    /// (allpass); the wrong Q peaks at every crossover frequency.
    fn band_sum_db(num_bands: usize, freqs: &[f32], test_freq: f32, sr: f32) -> f32 {
        let mut xover = CrossoverEngine::new(sr);
        xover.set_bands(num_bands, freqs);
        let mut bands_l = [0.0_f32; 6];
        let mut bands_r = [0.0_f32; 6];
        let total = (sr * 1.5) as usize;
        let measure_from = total / 3; // 0.5 s warmup, 1 s measurement
        let mut in_energy = 0.0_f64;
        let mut out_energy = 0.0_f64;
        for n in 0..total {
            let s = (2.0 * PI * test_freq * n as f32 / sr).sin();
            xover.process_sample(s, s, &mut bands_l, &mut bands_r);
            if n >= measure_from {
                let sum: f32 = bands_l[..num_bands].iter().sum();
                in_energy += (s as f64) * (s as f64);
                out_energy += (sum as f64) * (sum as f64);
            }
        }
        (10.0 * (out_energy / in_energy).log10()) as f32
    }

    /// Log-spaced sweep 20 Hz–16 kHz plus every crossover frequency (the exact
    /// points where a wrong Butterworth Q peaks hardest).
    fn sweep_plus(xover_freqs: &[f32]) -> Vec<f32> {
        let mut points: Vec<f32> = (0..40)
            .map(|i| 20.0 * (800.0_f32).powf(i as f32 / 39.0))
            .collect();
        points.extend_from_slice(xover_freqs);
        points
    }

    #[test]
    fn two_band_sum_is_flat_across_frequency_including_crossover() {
        let freqs = [1000.0_f32, 3000.0, 8000.0, 12000.0, 16000.0];
        let mut worst_db = 0.0_f32;
        let mut worst_freq = 0.0_f32;
        for f in sweep_plus(&freqs[..1]) {
            let db = band_sum_db(2, &freqs, f, 48_000.0);
            if db.abs() > worst_db.abs() {
                worst_db = db;
                worst_freq = f;
            }
        }
        eprintln!("2-band worst deviation: {worst_db:+.2} dB at {worst_freq} Hz");
        assert!(
            worst_db.abs() <= 0.5,
            "2-band sum not flat: {worst_db:+.2} dB at {worst_freq} Hz"
        );
    }

    #[test]
    fn four_band_sum_is_flat_across_frequency_including_all_crossovers() {
        let freqs = [200.0_f32, 800.0, 2500.0, 6000.0, 12000.0];
        let mut worst_db = 0.0_f32;
        let mut worst_freq = 0.0_f32;
        for f in sweep_plus(&freqs[..3]) {
            let db = band_sum_db(4, &freqs, f, 48_000.0);
            if db.abs() > worst_db.abs() {
                worst_db = db;
                worst_freq = f;
            }
        }
        eprintln!("4-band worst deviation: {worst_db:+.2} dB at {worst_freq} Hz");
        assert!(
            worst_db.abs() <= 0.5,
            "4-band sum not flat: {worst_db:+.2} dB at {worst_freq} Hz"
        );
    }
}
