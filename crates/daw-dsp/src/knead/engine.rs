//! Top-level engine wrapper for Knead Real-time pitch manipulation.

use crate::knead::psola::{psola_process_offline_inplace, PsolaConfig};
use crate::knead::voicing::{is_voiced, VoicingConfig};
use crate::knead::yin::{yin_frame, YinConfig};

pub struct KneadEngine {
    pub yin_cfg: YinConfig,
    pub voicing_cfg: VoicingConfig,

    // Scratch buffers to avoid RT allocations
    work_d: Vec<f32>,
    work_cmnd: Vec<f32>,
    pitch_marks: Vec<usize>,
    target_f0_curve: Vec<f32>,
    window_scratchpad: Vec<f32>,
    psola_l_buffer: Vec<f32>,
    psola_r_buffer: Vec<f32>,
    psola_work_buffer: Vec<f32>,

    // Accumulator buffers for RT block processing
    in_buffer_l: Vec<f32>,
    in_buffer_r: Vec<f32>,
    
    // Fixed-size output ring buffers to avoid allocations
    out_buffer_l: Vec<f32>,
    out_buffer_r: Vec<f32>,
    out_read_pos: usize,
    out_write_pos: usize,
    out_count: usize,

    pub shift_semitones: f32,
    pub always_analyze: bool, // Set to true when UI is open to see pitch
    psola_cfg: PsolaConfig,

    // Current State
    current_f0: Option<f32>,
    current_periodicity: f32,
    is_actively_voiced: bool,
}

impl KneadEngine {
    pub fn new(sample_rate: f32) -> Self {
        let mut yin_cfg = YinConfig::default();
        yin_cfg.sample_rate = sample_rate;

        let tau_max = (sample_rate / yin_cfg.f0_min).ceil() as usize;
        let frame_size = yin_cfg.frame_size;
        let ring_capacity = frame_size * 8;

        Self {
            yin_cfg,
            voicing_cfg: VoicingConfig::default(),
            work_d: vec![0.0; tau_max + 1],
            work_cmnd: vec![1.0; tau_max + 1],
            pitch_marks: Vec::with_capacity(256),
            target_f0_curve: vec![0.0; frame_size],
            window_scratchpad: vec![0.0; 4096],
            psola_l_buffer: vec![0.0; frame_size],
            psola_r_buffer: vec![0.0; frame_size],
            psola_work_buffer: vec![0.0; frame_size],
            in_buffer_l: Vec::with_capacity(frame_size),
            in_buffer_r: Vec::with_capacity(frame_size),
            out_buffer_l: vec![0.0; ring_capacity],
            out_buffer_r: vec![0.0; ring_capacity],
            out_read_pos: 0,
            out_write_pos: 0,
            out_count: 0,
            shift_semitones: 0.0,
            always_analyze: false,
            psola_cfg: PsolaConfig {
                sample_rate,
                ..PsolaConfig::default()
            },
            current_f0: None,
            current_periodicity: 0.0,
            is_actively_voiced: false,
        }
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        let num_samples = left.len();
        let ring_cap = self.out_buffer_l.len();
        
        for i in 0..num_samples {
            self.in_buffer_l.push(left[i]);
            self.in_buffer_r.push(right[i]);

            if self.in_buffer_l.len() >= self.yin_cfg.frame_size {
                // Determine if we need to run YIN
                let needs_analysis = self.shift_semitones != 0.0 || self.always_analyze;

                if !needs_analysis {
                    for j in 0..self.in_buffer_l.len() {
                        if self.out_count < ring_cap {
                            self.out_buffer_l[self.out_write_pos] = self.in_buffer_l[j];
                            self.out_buffer_r[self.out_write_pos] = self.in_buffer_r[j];
                            self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                            self.out_count += 1;
                        }
                    }
                } else {
                    self.analyze_and_shift();
                }
                
                self.in_buffer_l.clear();
                self.in_buffer_r.clear();
            }

            if self.out_count > 0 {
                left[i] = self.out_buffer_l[self.out_read_pos];
                right[i] = self.out_buffer_r[self.out_read_pos];
                self.out_read_pos = (self.out_read_pos + 1) % ring_cap;
                self.out_count -= 1;
            } else {
                left[i] = 0.0;
                right[i] = 0.0;
            }
        }
    }

    fn analyze_and_shift(&mut self) {
        let yin_res = yin_frame(
            &self.in_buffer_l,
            &self.yin_cfg,
            &mut self.work_d,
            &mut self.work_cmnd
        );

        self.current_f0 = yin_res.f0_hz;
        self.current_periodicity = yin_res.periodicity;
        self.is_actively_voiced = is_voiced(&self.in_buffer_l, yin_res.periodicity, &self.voicing_cfg);

        if self.shift_semitones != 0.0 && self.is_actively_voiced {
            if let Some(f0_val) = yin_res.f0_hz {
                let ratio = 2.0_f32.powf(self.shift_semitones / 12.0);
                let target_f0 = f0_val * ratio;

                self.target_f0_curve.fill(target_f0);

                // TD-PSOLA analysis marks: one epoch per detected period.
                // Without marks PSOLA degenerates to passthrough, and with a
                // single shared output the right channel collapses to left.
                self.pitch_marks.clear();
                let period = self.yin_cfg.sample_rate / f0_val;
                let mut mark = 0.0_f32;
                while (mark as usize) < self.in_buffer_l.len() {
                    self.pitch_marks.push(mark as usize);
                    mark += period;
                }

                psola_process_offline_inplace(
                    &self.in_buffer_l,
                    &self.pitch_marks,
                    &self.target_f0_curve,
                    &self.psola_cfg,
                    &mut self.window_scratchpad,
                    &mut self.psola_l_buffer
                );
                psola_process_offline_inplace(
                    &self.in_buffer_r,
                    &self.pitch_marks,
                    &self.target_f0_curve,
                    &self.psola_cfg,
                    &mut self.window_scratchpad,
                    &mut self.psola_r_buffer
                );

                let ring_cap = self.out_buffer_l.len();
                for i in 0..self.psola_l_buffer.len() {
                    if self.out_count < ring_cap {
                        self.out_buffer_l[self.out_write_pos] = self.psola_l_buffer[i];
                        self.out_buffer_r[self.out_write_pos] = self.psola_r_buffer[i];
                        self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                        self.out_count += 1;
                    }
                }
                return;
            }
        }

        // Fallback: Passthrough to output buffers
        let ring_cap = self.out_buffer_l.len();
        for i in 0..self.in_buffer_l.len() {
            if self.out_count < ring_cap {
                self.out_buffer_l[self.out_write_pos] = self.in_buffer_l[i];
                self.out_buffer_r[self.out_write_pos] = self.in_buffer_r[i];
                self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                self.out_count += 1;
            }
        }
    }

    pub fn get_f0(&self) -> Option<f32> {
        self.current_f0
    }

    pub fn get_periodicity(&self) -> f32 {
        self.current_periodicity
    }

    pub fn is_voiced(&self) -> bool {
        self.is_actively_voiced
    }

    pub fn set_shift_semitones(&mut self, semitones: f32) {
        self.shift_semitones = semitones;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    /// Harmonically rich periodic signal. PSOLA is epoch-based: it respaces
    /// pitch epochs, which a pure sine does not have — a sine is pathological
    /// input for any TD-PSOLA shifter, real material is harmonic.
    fn pitched(freq: f32, sample_rate: f32, n: usize) -> f32 {
        let mut s = 0.0_f32;
        for h in 1..=8 {
            s += (TAU * freq * h as f32 * n as f32 / sample_rate).sin() / h as f32;
        }
        s * 0.8
    }

    /// Feed stereo input through the engine in 128-sample blocks (the
    /// AudioWorklet pattern) and collect the processed output. `invert_right`
    /// flips the right channel's polarity so a right-equals-left collapse is
    /// detectable via correlation.
    fn run_engine(
        engine: &mut KneadEngine,
        freq_l: f32,
        freq_r: f32,
        sample_rate: f32,
        seconds: f32,
        invert_right: bool,
    ) -> (Vec<f32>, Vec<f32>) {
        let total = (sample_rate * seconds) as usize;
        let mut out_l = Vec::with_capacity(total);
        let mut out_r = Vec::with_capacity(total);
        let sign = if invert_right { -1.0 } else { 1.0 };
        let mut n = 0usize;
        while n < total {
            let block = (total - n).min(128);
            let mut left: Vec<f32> = (0..block).map(|i| pitched(freq_l, sample_rate, n + i)).collect();
            let mut right: Vec<f32> = (0..block)
                .map(|i| sign * pitched(freq_r, sample_rate, n + i))
                .collect();
            engine.process_block(&mut left, &mut right);
            out_l.extend_from_slice(&left);
            out_r.extend_from_slice(&right);
            n += block;
        }
        (out_l, out_r)
    }

    /// Dominant epoch rate of a signal slice via autocorrelation: the
    /// smallest lag whose peak reaches 60% of the global maximum. PSOLA
    /// octave-up repeats each source grain, so the shifted output keeps
    /// residual source-rate correlation alongside the new epoch rate — a
    /// plain global-max estimate flips between the two, while the epoch rate
    /// (perceived pitch) is the smallest strong peak.
    fn estimate_f0(samples: &[f32], sample_rate: f32) -> Option<f32> {
        if samples.len() < 2048 {
            return None;
        }
        let lo = (sample_rate / 1000.0) as usize;
        let hi = ((sample_rate / 50.0) as usize).min(samples.len() / 2);
        let mut r = vec![0.0_f32; hi + 1];
        for tau in lo..=hi {
            let mut acc = 0.0_f32;
            for i in 0..samples.len() - tau {
                acc += samples[i] * samples[i + tau];
            }
            r[tau] = acc;
        }
        let global = r[lo..=hi].iter().cloned().fold(0.0_f32, f32::max);
        if global <= 0.0 {
            return None;
        }
        let threshold = 0.6 * global;
        for tau in lo..hi {
            if r[tau] >= threshold && r[tau] >= r[tau - 1] && r[tau] > r[tau + 1] {
                return Some(sample_rate / tau as f32);
            }
        }
        let mut best_tau = lo;
        for tau in lo..=hi {
            if r[tau] > r[best_tau] {
                best_tau = tau;
            }
        }
        Some(sample_rate / best_tau as f32)
    }

    /// Median per-window f0 across the tail of a processed signal. The RT
    /// engine re-detects f0 per 2048-sample frame and individual frames can
    /// fall back to passthrough when YIN/voicing reject the frame, so a
    /// single-window estimate is brittle; the median pins the dominant
    /// behavior.
    fn median_tail_f0(samples: &[f32], sample_rate: f32) -> f32 {
        let mut estimates: Vec<f32> = samples[SKIP..]
            .chunks(2048)
            .filter_map(|chunk| estimate_f0(chunk, sample_rate))
            .collect();
        estimates.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        assert!(!estimates.is_empty(), "no pitch detected in output tail");
        estimates[estimates.len() / 2]
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len().max(1) as f32).sqrt()
    }

    // The engine buffers one YIN frame before producing analyzed output; skip
    // latency + detector warm-up before measuring.
    const SKIP: usize = 4096;

    /// Signal-in/signal-out: zero shift must pass the signal through.
    #[test]
    fn zero_shift_passes_signal_through() {
        let sr = 44100.0;
        let mut engine = KneadEngine::new(sr);
        engine.set_shift_semitones(0.0);
        let (out_l, _) = run_engine(&mut engine, 220.0, 220.0, sr, 0.5, false);
        let tail = &out_l[SKIP..];
        assert!(
            rms(tail) > 0.4,
            "zero-shift output lost the signal (rms={:.3})",
            rms(tail)
        );
        let f0 = median_tail_f0(&out_l, sr);
        let err = (f0 - 220.0).abs() / 220.0;
        assert!(err < 0.05, "zero-shift f0 {f0:.1} Hz, expected ~220 Hz");
    }

    /// Signal-in/signal-out: +12 semitones on a voiced input must double the
    /// output fundamental. This is the path that was unreachable (F1) and
    /// then degenerate (empty pitch marks, F2).
    #[test]
    fn octave_up_shift_doubles_fundamental() {
        let sr = 44100.0;
        let mut engine = KneadEngine::new(sr);
        engine.set_shift_semitones(12.0);
        let (out_l, _) = run_engine(&mut engine, 220.0, 220.0, sr, 1.0, false);
        let f0 = median_tail_f0(&out_l, sr);
        let err_cents = 1200.0 * (f0 / 440.0).log2().abs();
        assert!(
            err_cents < 60.0,
            "shifted f0 {f0:.1} Hz, expected ~440 Hz ({err_cents:.0} cents off)"
        );
    }

    /// Signal-in/signal-out: the shift path must not collapse stereo (F2
    /// wrote the mono left result into both output rings). Feed the right
    /// channel polarity-inverted: if the right output is the left result
    /// copied over, the channels correlate +1; if right is processed from
    /// right input, they correlate ≈ −1.
    #[test]
    fn shift_preserves_stereo_separation() {
        let sr = 44100.0;
        let mut engine = KneadEngine::new(sr);
        engine.set_shift_semitones(12.0);
        let (out_l, out_r) = run_engine(&mut engine, 220.0, 220.0, sr, 1.0, true);

        // Both channels shift to the octave up...
        let f0_r = median_tail_f0(&out_r, sr);
        let err_cents = 1200.0 * (f0_r / 440.0).log2().abs();
        assert!(
            err_cents < 60.0,
            "right shifted f0 {f0_r:.1} Hz, expected ~440 Hz ({err_cents:.0} cents off)"
        );

        // ...and the right output is the right input processed, not a copy
        // of the left result.
        let mut dot = 0.0f32;
        let mut e_l = 0.0f32;
        let mut e_r = 0.0f32;
        for i in SKIP..out_l.len() {
            dot += out_l[i] * out_r[i];
            e_l += out_l[i] * out_l[i];
            e_r += out_r[i] * out_r[i];
        }
        let corr = dot / (e_l.sqrt() * e_r.sqrt()).max(1e-9);
        assert!(
            corr < 0.0,
            "stereo collapsed to dual-mono: L/R correlation {corr:.2}, expected < 0 for inverted right"
        );
    }
}
