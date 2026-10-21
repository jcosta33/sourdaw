// Frozen test-only source oracle from cdf56ae23082998f2f3be0264309ca2c6025dee2.
// Captured before the shared-pitch extraction; never used by production.
#![allow(dead_code)]

//! Top-level engine wrapper for Knead Real-time pitch manipulation.

use daw_dsp::knead::psola::{psola_process_span, PsolaConfig};
use daw_dsp::knead::voicing::{is_voiced, VoicingConfig};
use super::yin::{yin_frame, YinConfig};

/// Distance from the retune target, in semitones, at which the glide snaps.
const RETUNE_SETTLE_SEMITONES: f32 = 0.001;

/// One-pole step of the retune glide, `frame_ms` of output time wide.
///
/// The deadband is what makes the glide *terminate*: a one-pole approach
/// is asymptotic, and without a snap the residual would hold the applied
/// shift non-zero forever, pinning the analysis gate open on a clip that
/// has returned to unshifted. 0.001 st is 0.1 cent — an order of magnitude
/// under the ~1 cent that is audible on a sustained tone.
pub(crate) fn advance_retune_glide(
    applied_shift: &mut f32,
    target: f32,
    retune_speed_ms: f32,
    frame_ms: f32,
) {
    if retune_speed_ms <= 0.0 {
        *applied_shift = target;
        return;
    }
    let alpha = 1.0 - (-frame_ms / retune_speed_ms).exp();
    *applied_shift += (target - *applied_shift) * alpha;
    if (target - *applied_shift).abs() < RETUNE_SETTLE_SEMITONES {
        *applied_shift = target;
    }
}

pub struct KneadEngine {
    pub yin_cfg: YinConfig,
    pub voicing_cfg: VoicingConfig,

    // Scratch buffers to avoid RT allocations
    work_d: Vec<f32>,
    work_cmnd: Vec<f32>,
    pitch_marks: Vec<usize>,
    target_f0_curve: Vec<f32>,
    grain_rate_curve: Vec<f32>,
    window_scratchpad: Vec<f32>,
    psola_l_buffer: Vec<f32>,
    psola_r_buffer: Vec<f32>,
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
    // Grain overhang: the current frame's grains extend up to one target
    // period past the frame end. Those right tails cover the START of the
    // next frame (the next frame's own first center starts at
    // synth_phase > 0), so they are saved and overlap-added into the next
    // frame's body. Without them, frames whose lattice phase is large emit
    // a zero gap at the body start (measured 708 samples at a -30 to -12
    // crossing).
    overhang_l: Vec<f32>,
    overhang_r: Vec<f32>,
    overhang_len: usize,
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
    /// The shift actually rendered this frame, gliding toward
    /// [`Self::shift_semitones`] at [`Self::retune_speed_ms`].
    ///
    /// Separate from the target because the target steps: it is recomputed
    /// per render quantum from the blob under the playhead, so every blob
    /// boundary is a discontinuity in it. Retune speed is the control that
    /// decides whether that discontinuity reaches the ear as a step or as a
    /// portamento, and it needs somewhere to put the intermediate value.
    applied_shift: f32,
    /// Glide time constant in milliseconds. `0` snaps — the hard, immediate
    /// arrival that is the whole point of the control's bottom end.
    retune_speed_ms: f32,
    /// Whether the spectral envelope stays put while the fundamental moves.
    /// Drives the frame's grain-rate curve; see `psola_process_span` for the
    /// mechanism.
    formant_preserve: bool,
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
            grain_rate_curve: vec![1.0; frame_size + tail_capacity],
            window_scratchpad: vec![0.0; scratch_size],
            psola_l_buffer: vec![0.0; frame_size + 2 * tail_capacity],
            psola_r_buffer: vec![0.0; frame_size + 2 * tail_capacity],
            hist_l: vec![0.0; tail_capacity],
            hist_r: vec![0.0; tail_capacity],
            span_l: vec![0.0; frame_size + tail_capacity],
            span_r: vec![0.0; frame_size + tail_capacity],
            held_l: vec![0.0; tail_capacity],
            held_r: vec![0.0; tail_capacity],
            held_len: 0,
            overhang_l: vec![0.0; tail_capacity],
            overhang_r: vec![0.0; tail_capacity],
            overhang_len: 0,
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
            applied_shift: 0.0,
            retune_speed_ms: 0.0,
            formant_preserve: true,
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
                // Determine if we need to run YIN.
                //
                // `applied_shift` is in the gate as well as the target: a
                // glide that is still unwinding toward zero is still shifting
                // audio, and keying bypass off the target alone would cut the
                // glide off at the blob boundary — exactly the step the
                // retune-speed control exists to remove.
                let needs_analysis =
                    self.shift_semitones != 0.0 || self.applied_shift != 0.0 || self.always_analyze;

                if !needs_analysis {
                    // Flush any held tail from a preceding shifted frame
                    // before bypass passthrough (see the !shifted path).
                    for j in 0..self.held_len {
                        let l = self.held_l[j];
                        let r = self.held_r[j];
                        if self.out_count < ring_cap {
                            self.out_buffer_l[self.out_write_pos] = l;
                            self.out_buffer_r[self.out_write_pos] = r;
                            self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                            self.out_count += 1;
                        }
                    }
                    for j in 0..self.in_buffer_l.len() {
                        if self.out_count < ring_cap {
                            self.out_buffer_l[self.out_write_pos] = self.in_buffer_l[j];
                            self.out_buffer_r[self.out_write_pos] = self.in_buffer_r[j];
                            self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                            self.out_count += 1;
                        }
                    }
                    // Bypass: reset continuity state (a stale held tail would
                    // replay pre-bypass "ghost" audio at re-engage) and keep
                    // the raw-input history rolling so re-engage starts from
                    // current audio, not from before the bypass.
                    self.held_len = 0;
                    self.overhang_len = 0;
                    self.synth_phase = 0.0;
                    self.roll_history();
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
        // Advance the retune glide once per analysis frame, which is the rate
        // at which this engine can change its rendered pitch at all (the
        // target f0 is constant across a frame's synthesis lattice). The
        // control therefore resolves to `frame_size` samples, not to one.
        let frame_ms = self.in_buffer_l.len() as f32 * 1000.0 / self.yin_cfg.sample_rate;
        self.advance_retune_glide(frame_ms);

        let yin_res = yin_frame(
            &self.in_buffer_l,
            &self.yin_cfg,
            &mut self.work_d,
            &mut self.work_cmnd,
        );

        self.current_f0 = yin_res.f0_hz;
        self.current_periodicity = yin_res.periodicity;
        self.is_actively_voiced =
            is_voiced(&self.in_buffer_l, yin_res.periodicity, &self.voicing_cfg);

        let frame_len = self.in_buffer_l.len();
        let mut shifted = false;

        if self.applied_shift != 0.0 && self.is_actively_voiced {
            if let Some(f0_val) = yin_res.f0_hz {
                let ratio = 2.0_f32.powf(self.applied_shift / 12.0);
                let target_f0 = f0_val * ratio;

                // Formant correction, decided per frame because the ratio it
                // tracks moves with the glide. Preserving is `1.0` (grains
                // copied, envelope fixed); not preserving reads each grain at
                // the pitch ratio so the envelope rides along.
                let grain_rate = if self.formant_preserve { 1.0 } else { ratio };

                // Output margin: one target period, capped at one frame so
                // the hold/completion bookkeeping stays inside this frame.
                // Input history depth covers the slower of target and source
                // period: two target periods keep margin grains inside the
                // span, two SOURCE periods guarantee ≥ 3 analysis marks in
                // every span — sizing to the target period alone starved
                // bass upshifts (e.g. +18 st at 50 Hz) into unshifted
                // passthrough on a fifth of all frames.
                let target_period = self.yin_cfg.sample_rate / target_f0;
                let source_period = self.yin_cfg.sample_rate / f0_val;
                let t = (target_period.ceil() as usize)
                    .min(self.hist_l.len())
                    .min(frame_len);
                let h = (2 * (target_period.ceil() as usize))
                    .max(2 * (source_period.ceil() as usize))
                    .min(self.hist_l.len());

                // Frames whose target period exceeds the scratch capacity
                // cannot be shifted (every grain would bail, emitting
                // zeroed voiced audio). Treat them as unshiftable and fall
                // through to passthrough instead.
                let shiftable = 2 * (target_period.ceil() as usize) <= self.window_scratchpad.len();

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

                if shiftable && self.pitch_marks.len() >= 3 {
                    shifted = true;
                    self.target_f0_curve[..span_len].fill(target_f0);
                    self.grain_rate_curve[..span_len].fill(grain_rate);

                    // Render output coordinates [0, frame_len) into the work
                    // buffer (work index = coordinate + t): grains near the
                    // frame start spill their left halves into the margin
                    // indices [0, t) — exactly the contributions needed to
                    // complete the previous frame's held tail. The render
                    // also captures the grain overhang [frame_len, frame_len
                    // + t) — the right tails that cover the start of the
                    // next frame. Synthesis starts at the carried lattice
                    // phase so no center is rendered by two frames.
                    let work_len = t + frame_len + t;
                    let end_t = psola_process_span(
                        &self.span_l[..span_len],
                        &self.pitch_marks,
                        &self.target_f0_curve,
                        &self.grain_rate_curve,
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
                        &self.grain_rate_curve,
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

                    // Body: coords [0, frame_len - t), overlap-adding the
                    // previous frame's grain overhang (its right tails cover
                    // these coordinates; the current render's own first
                    // center starts at synth_phase > 0). Body/hold tiling is
                    // exact per frame: body [0, F - t) ++ next margin
                    // [F - t, F) covers every coordinate once, for any
                    // t_prev. (Keying the body off t_prev double-emitted
                    // the held tail on re-engage — measured as a
                    // bit-exact duplicated window at lag ~= t.)
                    let ola = self.overhang_len.min(frame_len - t);
                    for j in 0..(frame_len - t) {
                        let idx = t + j;
                        let mut l = self.psola_l_buffer[idx];
                        let mut r = self.psola_r_buffer[idx];
                        if j < ola {
                            l += self.overhang_l[j];
                            r += self.overhang_r[j];
                        }
                        if self.out_count < ring_cap {
                            self.out_buffer_l[self.out_write_pos] = l;
                            self.out_buffer_r[self.out_write_pos] = r;
                            self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                            self.out_count += 1;
                        }
                    }

                    // Hold coords [frame_len - t, frame_len) for the next
                    // frame (work indices [frame_len, frame_len + t)), and
                    // the grain overhang [frame_len, frame_len + t) that
                    // covers the next frame's start (work indices
                    // [frame_len + t, frame_len + 2t)).
                    self.held_l[..t]
                        .copy_from_slice(&self.psola_l_buffer[frame_len..frame_len + t]);
                    self.held_r[..t]
                        .copy_from_slice(&self.psola_r_buffer[frame_len..frame_len + t]);
                    self.held_len = t;
                    self.overhang_l[..t]
                        .copy_from_slice(&self.psola_l_buffer[frame_len + t..frame_len + 2 * t]);
                    self.overhang_r[..t]
                        .copy_from_slice(&self.psola_r_buffer[frame_len + t..frame_len + 2 * t]);
                    self.overhang_len = t;
                }
            }
        }

        if !shifted {
            // Passthrough production: flush any held tail from the previous
            // shifted frame first — dropping it skipped up to one target
            // period of audio at shifted-to-unshiftable crossings. The ring
            // absorbs the one-time emission jitter on the crossing frame.
            let ring_cap = self.out_buffer_l.len();
            for j in 0..self.held_len {
                let l = self.held_l[j];
                let r = self.held_r[j];
                if self.out_count < ring_cap {
                    self.out_buffer_l[self.out_write_pos] = l;
                    self.out_buffer_r[self.out_write_pos] = r;
                    self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                    self.out_count += 1;
                }
            }
            self.held_len = 0;
            self.overhang_len = 0;
            self.synth_phase = 0.0;
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
        self.roll_history();
    }

    /// Roll the raw-input history forward with the current frame.
    fn roll_history(&mut self) {
        let frame_len = self.in_buffer_l.len();
        let t_max = self.hist_l.len();
        if frame_len >= t_max {
            self.hist_l
                .copy_from_slice(&self.in_buffer_l[frame_len - t_max..]);
            self.hist_r
                .copy_from_slice(&self.in_buffer_r[frame_len - t_max..]);
        } else {
            self.hist_l.copy_within(frame_len..t_max, 0);
            self.hist_l[t_max - frame_len..].copy_from_slice(&self.in_buffer_l);
            self.hist_r.copy_within(frame_len..t_max, 0);
            self.hist_r[t_max - frame_len..].copy_from_slice(&self.in_buffer_r);
        }
    }

    /// Group delay of `process_block`, in samples, for plugin delay compensation.
    ///
    /// `process_block` emits nothing until it has accumulated a full analysis
    /// frame. Walking the loop: samples 0..frame_size-2 push and read an empty
    /// ring (silence out); on sample `frame_size - 1` the push completes the frame,
    /// the whole frame is written to the ring, and the *same* iteration reads back
    /// ring slot 0 — which holds input sample 0. So output index `frame_size - 1`
    /// carries input index 0, and the delay is `frame_size - 1`, one sample short
    /// of a full frame. Steady state holds the same figure: every subsequent frame
    /// fill tops the ring back up before it drains.
    ///
    /// This is the delay at *zero shift* too — the non-analysing branch buffers
    /// identically — so it is unconditional and is exactly what PDC must offset.
    /// Measured, not assumed: `reported_latency_matches_measured_group_delay`
    /// recovers it bit-exactly from the engine's own output.
    pub fn latency_samples(&self) -> u32 {
        (self.yin_cfg.frame_size - 1) as u32
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
        // Reset continuity state when re-engaging from bypass: a stale held
        // tail would replay pre-bypass audio at the next clip boundary.
        // `applied_shift` is in the test because a glide still unwinding is
        // still rendering — the engine never went to bypass, so there is
        // nothing stale to discard and discarding it would cut the glide.
        if self.shift_semitones == 0.0 && self.applied_shift == 0.0 && semitones != 0.0 {
            self.held_len = 0;
            self.overhang_len = 0;
            self.synth_phase = 0.0;
        }
        self.shift_semitones = semitones;
    }

    /// Retune speed, in milliseconds, for the glide from one blob's shift to
    /// the next. `0` snaps.
    ///
    /// The range and sense follow the pitch-corrector convention the panel
    /// already advertises (Antares Auto-Tune's Retune Speed, Waves Tune's
    /// Speed, Logic Flex Pitch): a time constant in ms where the fast end is
    /// the hard, immediately-arriving correction and the slow end lets the
    /// note slide into place. Non-finite input is refused rather than
    /// propagated into `exp()`.
    pub fn set_retune_speed_ms(&mut self, ms: f32) {
        if !ms.is_finite() {
            return;
        }
        self.retune_speed_ms = ms.max(0.0);
    }

    /// Whether the spectral envelope stays fixed while the fundamental moves.
    pub fn set_formant_preserve(&mut self, preserve: bool) {
        self.formant_preserve = preserve;
    }

    /// The shift being rendered right now, which trails
    /// [`Self::shift_semitones`] whenever the retune speed is above zero.
    pub fn applied_shift_semitones(&self) -> f32 {
        self.applied_shift
    }

    fn advance_retune_glide(&mut self, frame_ms: f32) {
        advance_retune_glide(
            &mut self.applied_shift,
            self.shift_semitones,
            self.retune_speed_ms,
            frame_ms,
        );
    }
}
