//! Top-level engine wrapper for Knead Real-time pitch manipulation.

use crate::knead::psola::{psola_process_span, PsolaConfig};
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
    // Cross-frame continuity state. Each analysis frame is rendered from a
    // span of `t` history samples ++ the current frame, with synthesis
    // covering a margin of `t` samples before the frame start. The last `t`
    // samples of each frame's body are held and completed by the next
    // frame's margin (overlap-add), so frame boundaries stay COLA-continuous
    // instead of restarting at zero energy every 2048 samples.
    hist_l: Vec<f32>,
    hist_r: Vec<f32>,
    span_l: Vec<f32>,
    span_r: Vec<f32>,
    held_l: Vec<f32>,
    held_r: Vec<f32>,
    held_len: usize,
    // Synthesis lattice phase carried across frames: the coordinate of the
    // next synthesis center relative to the current frame start. Without it
    // each frame restarts the lattice at 0 and 2048 mod P_t samples of
    // misalignment double-cover every frame boundary.
    synth_phase: f32,
    // Absolute count of analyzed samples; anchors the pitch-mark lattice so
    // marks land at a consistent signal phase in every frame instead of
    // drifting by 2048 mod P_s per frame.
    abs_pos: usize,

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
        // Grain width follows the target period (≈2·P_t), so scratch must
        // cover the slowest reachable target — same sizing as the offline
        // path (f0 down to 10 Hz). The history margin is at most one
        // analysis frame; the hold/span buffers use the full max period.
        let scratch_size = (sample_rate / 20.0) as usize * 4;
        let tail_capacity = scratch_size / 2;

        Self {
            yin_cfg,
            voicing_cfg: VoicingConfig::default(),
            work_d: vec![0.0; tau_max + 1],
            work_cmnd: vec![1.0; tau_max + 1],
            pitch_marks: Vec::with_capacity(256),
            target_f0_curve: vec![0.0; frame_size + tail_capacity],
            window_scratchpad: vec![0.0; scratch_size],
            psola_l_buffer: vec![0.0; frame_size + 2 * tail_capacity],
            psola_r_buffer: vec![0.0; frame_size + 2 * tail_capacity],
            psola_work_buffer: vec![0.0; frame_size],
            hist_l: vec![0.0; tail_capacity],
            hist_r: vec![0.0; tail_capacity],
            span_l: vec![0.0; frame_size + tail_capacity],
            span_r: vec![0.0; frame_size + tail_capacity],
            held_l: vec![0.0; tail_capacity],
            held_r: vec![0.0; tail_capacity],
            held_len: 0,
            synth_phase: 0.0,
            abs_pos: 0,
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

        let frame_len = self.in_buffer_l.len();
        let mut shifted = false;

        if self.shift_semitones != 0.0 && self.is_actively_voiced {
            if let Some(f0_val) = yin_res.f0_hz {
                let ratio = 2.0_f32.powf(self.shift_semitones / 12.0);
                let target_f0 = f0_val * ratio;

                // Output margin: one target period, capped at one frame so
                // the hold/completion bookkeeping stays inside this frame.
                // Input history depth is two target periods so the grains
                // covering the margin stay fully inside the span — a span
                // that starts exactly at the margin edge clamps the first
                // marks' grains and starves the boundary of energy.
                let target_period = self.yin_cfg.sample_rate / target_f0;
                let t = (target_period.ceil() as usize)
                    .min(self.hist_l.len())
                    .min(frame_len);
                let h = (2 * (target_period.ceil() as usize)).min(self.hist_l.len());

                // Span = last h samples of raw input history ++ this frame.
                let hist_start = self.hist_l.len() - h;
                self.span_l[..h].copy_from_slice(&self.hist_l[hist_start..]);
                self.span_l[h..h + frame_len].copy_from_slice(&self.in_buffer_l);
                self.span_r[..h].copy_from_slice(&self.hist_r[hist_start..]);
                self.span_r[h..h + frame_len].copy_from_slice(&self.in_buffer_r);

                // TD-PSOLA analysis marks: one epoch per detected period,
                // in span coordinates, anchored to an absolute lattice
                // (k·P_s from stream start) so the mark phase does not drift
                // by 2048 mod P_s every frame — drift made grain content
                // phase jump per frame (per-frame level flutter).
                self.pitch_marks.clear();
                let period = self.yin_cfg.sample_rate / f0_val;
                let span_len = h + frame_len;
                let span_start_abs = self.abs_pos as f32 - h as f32;
                let k0 = (span_start_abs / period).ceil();
                let mut mark = k0 * period - span_start_abs;
                while mark < span_len as f32 {
                    if mark >= 0.0 {
                        self.pitch_marks.push(mark as usize);
                    }
                    mark += period;
                }

                if self.pitch_marks.len() >= 3 {
                    shifted = true;
                    self.target_f0_curve[..span_len].fill(target_f0);

                    // Render output coordinates [0, frame_len) into the work
                    // buffer (work index = coordinate + t): grains near the
                    // frame start spill their left halves into the margin
                    // indices [0, t) — exactly the contributions needed to
                    // complete the previous frame's held tail. Synthesis
                    // starts at coordinate 0 so no center is rendered by two
                    // consecutive frames (a -t start double-renders centers
                    // [-t, 0), doubling seam energy).
                    let work_len = t + frame_len;
                    let end_t = psola_process_span(
                        &self.span_l[..span_len],
                        &self.pitch_marks,
                        &self.target_f0_curve,
                        &self.psola_cfg,
                        &mut self.window_scratchpad,
                        &mut self.psola_l_buffer[..work_len],
                        h as isize,
                        t as isize,
                        self.synth_phase,
                        frame_len as f32,
                    );
                    psola_process_span(
                        &self.span_r[..span_len],
                        &self.pitch_marks,
                        &self.target_f0_curve,
                        &self.psola_cfg,
                        &mut self.window_scratchpad,
                        &mut self.psola_r_buffer[..work_len],
                        h as isize,
                        t as isize,
                        self.synth_phase,
                        frame_len as f32,
                    );
                    // Carry the lattice phase into the next frame.
                    self.synth_phase = end_t - frame_len as f32;

                    let ring_cap = self.out_buffer_l.len();
                    let t_prev = self.held_len;

                    // Completed margin: previous held tail (coords
                    // [frame_len - t_prev, frame_len) of the previous frame)
                    // plus this render's margin grains at those coords.
                    for j in 0..t_prev {
                        let mut l = self.held_l[j];
                        let mut r = self.held_r[j];
                        let idx = j as isize + t as isize - t_prev as isize;
                        if idx >= 0 {
                            l += self.psola_l_buffer[idx as usize];
                            r += self.psola_r_buffer[idx as usize];
                        }
                        if self.out_count < ring_cap {
                            self.out_buffer_l[self.out_write_pos] = l;
                            self.out_buffer_r[self.out_write_pos] = r;
                            self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                            self.out_count += 1;
                        }
                    }

                    // Body: coords [0, frame_len - t_prev).
                    for j in 0..(frame_len - t_prev) {
                        let idx = t + j;
                        if self.out_count < ring_cap {
                            self.out_buffer_l[self.out_write_pos] = self.psola_l_buffer[idx];
                            self.out_buffer_r[self.out_write_pos] = self.psola_r_buffer[idx];
                            self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                            self.out_count += 1;
                        }
                    }

                    // Hold coords [frame_len - t, frame_len) for the next
                    // frame (work indices [frame_len, frame_len + t)).
                    self.held_l[..t].copy_from_slice(&self.psola_l_buffer[frame_len..frame_len + t]);
                    self.held_r[..t].copy_from_slice(&self.psola_r_buffer[frame_len..frame_len + t]);
                    self.held_len = t;
                }
            }
        }

        if !shifted {
            // Fallback: passthrough to output buffers. Drop any held shifted
            // tail and lattice phase so they cannot bleed into a later frame.
            self.held_len = 0;
            self.synth_phase = 0.0;
            let ring_cap = self.out_buffer_l.len();
            for i in 0..frame_len {
                if self.out_count < ring_cap {
                    self.out_buffer_l[self.out_write_pos] = self.in_buffer_l[i];
                    self.out_buffer_r[self.out_write_pos] = self.in_buffer_r[i];
                    self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                    self.out_count += 1;
                }
            }
        }

        self.abs_pos += frame_len;

        // Roll the raw-input history forward with this frame.
        let t_max = self.hist_l.len();
        if frame_len >= t_max {
            self.hist_l.copy_from_slice(&self.in_buffer_l[frame_len - t_max..]);
            self.hist_r.copy_from_slice(&self.in_buffer_r[frame_len - t_max..]);
        } else {
            self.hist_l.copy_within(frame_len..t_max, 0);
            self.hist_l[t_max - frame_len..].copy_from_slice(&self.in_buffer_l);
            self.hist_r.copy_within(frame_len..t_max, 0);
            self.hist_r[t_max - frame_len..].copy_from_slice(&self.in_buffer_r);
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

    /// Regression (PR #532 rotation-2 review): the RT scratch was fixed at
    /// 4096 while grain width follows the target period, so target f0 below
    /// sr/2048 made every grain bail and zeroed the output (measured
    /// tail_rms 0.0000 at -14 st, 48 kHz / 50 Hz).
    #[test]
    fn downshift_beyond_frame_period_still_sounds() {
        let sr = 48000.0;
        let mut engine = KneadEngine::new(sr);
        engine.set_shift_semitones(-14.0);
        let (out_l, _) = run_engine(&mut engine, 50.0, 50.0, sr, 1.5, false);
        let tail = rms(&out_l[8192..]);
        assert!(
            tail > 0.05,
            "overflow downshift muted the output (tail rms {tail:.4})"
        );
    }

    /// Regression (PR #532 rotation-2 review): without cross-frame COLA the
    /// production restarts every 2048-sample frame and the boundaries went
    /// near-silent (measured edge blocks at 3-20% of interior RMS). Edge
    /// blocks must now stay within a bounded ratio of the interior median.
    #[test]
    fn frame_boundaries_stay_continuous() {
        let sr = 44100.0;
        for shift in [12.0_f32, -12.0] {
            let mut engine = KneadEngine::new(sr);
            engine.set_shift_semitones(shift);
            let (out_l, _) = run_engine(&mut engine, 220.0, 220.0, sr, 1.5, false);

            let block = 512usize;
            let mut edge_min = f32::MAX;
            let mut interior = Vec::new();
            let mut start = 12288usize;
            while start + block < out_l.len() {
                let rel = start % 2048;
                let v = rms(&out_l[start..start + block]);
                if rel <= 256 || rel >= 1792 {
                    edge_min = edge_min.min(v);
                } else {
                    interior.push(v);
                }
                start += 256;
            }
            interior.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let med = interior[interior.len() / 2];
            assert!(
                edge_min >= 0.6 * med,
                "shift {shift:+.0}: frame-boundary dip {edge_min:.3} vs interior median {med:.3}"
            );

            // No near-silent run longer than one target period.
            let target = if shift > 0.0 { 440.0 } else { 110.0 };
            let bound = (sr / target) as usize + 16;
            let mut longest = 0usize;
            let mut run = 0usize;
            for &s in &out_l[8192..] {
                if s.abs() < 0.001 {
                    run += 1;
                    longest = longest.max(run);
                } else {
                    run = 0;
                }
            }
            assert!(
                longest <= bound,
                "shift {shift:+.0}: dropout run {longest} samples, bound {bound}"
            );
        }
    }
}
