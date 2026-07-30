use crate::primitives::flush_denormal;

/// Stereo ping-pong delay effect.
pub struct StereoDelay {
    buffer_l: Vec<f32>,
    buffer_r: Vec<f32>,
    write_pos: usize,
    sample_rate: f32,
}

impl StereoDelay {
    pub fn new(sample_rate: f32) -> Self {
        // Max 2 seconds at the given sample rate
        let max_samples = (sample_rate * 2.0) as usize;
        Self {
            buffer_l: vec![0.0; max_samples],
            buffer_r: vec![0.0; max_samples],
            write_pos: 0,
            sample_rate,
        }
    }

    /// Longest interval before buffered energy can reappear; not the total decay time.
    pub fn max_tail_gap_samples(&self, time_ms: f32) -> u64 {
        let delay_samples = time_ms.clamp(10.0, 2000.0) * 0.001 * self.sample_rate;
        delay_samples.ceil() as u64 + 1
    }

    /// Read from a delay buffer with linear interpolation for fractional delay.
    #[inline]
    fn read_interp(buffer: &[f32], write_pos: usize, delay_samples: f32) -> f32 {
        let len = buffer.len();
        let idx_f = delay_samples;
        let idx_i = idx_f as usize;
        let frac = idx_f - idx_i as f32;

        let i0 = (write_pos + len - idx_i) % len;
        let i1 = (write_pos + len - idx_i - 1) % len;

        buffer[i0] * (1.0 - frac) + buffer[i1] * frac
    }

    /// Process a stereo block with ping-pong delay.
    /// `time_ms`: 10-2000, `feedback`: 0-0.95, `mix`: 0-1.
    pub fn process_block(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        time_ms: f32,
        feedback: f32,
        mix: f32,
    ) {
        let time_ms = time_ms.clamp(10.0, 2000.0);
        let feedback = feedback.clamp(0.0, 0.95);
        let mix = mix.clamp(0.0, 1.0);
        let delay_samples = time_ms * 0.001 * self.sample_rate;
        let max_delay = self.buffer_l.len() as f32 - 1.0;
        let delay_samples = delay_samples.min(max_delay).max(1.0);
        let dry = 1.0 - mix;

        let block_size = left.len().min(right.len());
        for i in 0..block_size {
            let dl = Self::read_interp(&self.buffer_l, self.write_pos, delay_samples);
            let dr = Self::read_interp(&self.buffer_r, self.write_pos, delay_samples);

            // Ping-pong: left input feeds right delay, right input feeds left delay
            self.buffer_l[self.write_pos] = left[i] + dr * feedback;
            self.buffer_r[self.write_pos] = right[i] + dl * feedback;

            left[i] = left[i] * dry + dl * mix;
            right[i] = right[i] * dry + dr * mix;

            self.write_pos = (self.write_pos + 1) % self.buffer_l.len();
        }
    }
}

/// Stereo chorus effect with modulated delay lines.
pub struct StereoChorus {
    buffer_l: Vec<f32>,
    buffer_r: Vec<f32>,
    write_pos: usize,
    lfo_phase_l: f32,
    lfo_phase_r: f32,
    sample_rate: f32,
}

impl StereoChorus {
    pub fn new(sample_rate: f32) -> Self {
        // Need enough buffer for max modulated delay: ~20ms
        let buf_size = (sample_rate * 0.05) as usize; // 50ms safety margin
        Self {
            buffer_l: vec![0.0; buf_size],
            buffer_r: vec![0.0; buf_size],
            write_pos: 0,
            lfo_phase_l: 0.0,
            lfo_phase_r: 0.25, // 90-degree offset for stereo
            sample_rate,
        }
    }

    /// Longest interval before buffered energy can reappear; not the total decay time.
    pub fn max_tail_gap_samples(&self) -> u64 {
        self.buffer_l.len() as u64
    }

    /// Advance free-running modulation and the empty delay line without rendering audio.
    pub fn advance_silence(&mut self, frames: usize, rate: f32) {
        let phase_inc = rate.clamp(0.1, 5.0) / self.sample_rate;
        for _ in 0..frames {
            self.buffer_l[self.write_pos] = 0.0;
            self.buffer_r[self.write_pos] = 0.0;
            self.lfo_phase_l = (self.lfo_phase_l + phase_inc) % 1.0;
            self.lfo_phase_r = (self.lfo_phase_r + phase_inc) % 1.0;
            self.write_pos = (self.write_pos + 1) % self.buffer_l.len();
        }
    }

    /// Read from buffer with linear interpolation.
    #[inline]
    fn read_interp(buffer: &[f32], write_pos: usize, delay_samples: f32) -> f32 {
        let len = buffer.len();
        let idx_f = delay_samples;
        let idx_i = idx_f as usize;
        let frac = idx_f - idx_i as f32;

        let i0 = (write_pos + len - idx_i) % len;
        let i1 = (write_pos + len - idx_i - 1) % len;

        buffer[i0] * (1.0 - frac) + buffer[i1] * frac
    }

    /// Process stereo block.
    /// `rate`: 0.1-5 Hz, `depth`: 0-1, `mix`: 0-1.
    pub fn process_block(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        rate: f32,
        depth: f32,
        mix: f32,
    ) {
        let rate = rate.clamp(0.1, 5.0);
        let depth = depth.clamp(0.0, 1.0);
        let mix = mix.clamp(0.0, 1.0);
        let dry = 1.0 - mix;

        // Base delay: 10ms, modulation range: up to 5ms
        let base_delay_samples = 0.010 * self.sample_rate;
        let mod_depth_samples = 0.005 * self.sample_rate * depth;
        let phase_inc = rate / self.sample_rate;
        let max_delay = self.buffer_l.len() as f32 - 2.0;

        let block_size = left.len().min(right.len());
        for i in 0..block_size {
            // LFO values (sine)
            let lfo_l = (self.lfo_phase_l * std::f32::consts::TAU).sin();
            let lfo_r = (self.lfo_phase_r * std::f32::consts::TAU).sin();

            // Modulated delay times
            let delay_l = (base_delay_samples + lfo_l * mod_depth_samples).clamp(1.0, max_delay);
            let delay_r = (base_delay_samples + lfo_r * mod_depth_samples).clamp(1.0, max_delay);

            // Write dry signal into delay buffer
            self.buffer_l[self.write_pos] = left[i];
            self.buffer_r[self.write_pos] = right[i];

            // Read modulated delay
            let wet_l = Self::read_interp(&self.buffer_l, self.write_pos, delay_l);
            let wet_r = Self::read_interp(&self.buffer_r, self.write_pos, delay_r);

            left[i] = left[i] * dry + wet_l * mix;
            right[i] = right[i] * dry + wet_r * mix;

            // Advance LFO phases
            self.lfo_phase_l += phase_inc;
            if self.lfo_phase_l >= 1.0 {
                self.lfo_phase_l -= 1.0;
            }
            self.lfo_phase_r += phase_inc;
            if self.lfo_phase_r >= 1.0 {
                self.lfo_phase_r -= 1.0;
            }

            self.write_pos = (self.write_pos + 1) % self.buffer_l.len();
        }
    }
}

/// 4-stage allpass phaser with swept notch frequencies.
pub struct StereoPhaser {
    allpass_l: [f32; 4], // allpass states for left
    allpass_r: [f32; 4], // allpass states for right
    lfo_phase: f32,
    sample_rate: f32,
}

impl StereoPhaser {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            allpass_l: [0.0; 4],
            allpass_r: [0.0; 4],
            lfo_phase: 0.0,
            sample_rate,
        }
    }

    pub fn process_block(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        rate: f32,  // LFO rate 0.1-5 Hz
        depth: f32, // 0-1
        mix: f32,   // 0-1 wet/dry
    ) {
        for i in 0..left.len() {
            // LFO sweeps the allpass frequency
            self.lfo_phase += rate / self.sample_rate;
            if self.lfo_phase >= 1.0 {
                self.lfo_phase -= 1.0;
            }
            let lfo = (self.lfo_phase * core::f32::consts::TAU).sin();

            // Map LFO to allpass coefficient range
            // Sweep between ~200Hz and ~4000Hz
            let min_freq = 200.0 + (1.0 - depth) * 800.0;
            let max_freq = 2000.0 + depth * 6000.0;
            let freq = min_freq + (lfo + 1.0) * 0.5 * (max_freq - min_freq);
            let coeff = (core::f32::consts::PI * freq / self.sample_rate).tan();
            let a1 = (coeff - 1.0) / (coeff + 1.0);

            // Process left channel through 4 allpass stages
            let dry_l = left[i];
            let mut wet_l = left[i];
            for s in 0..4 {
                let y = a1 * wet_l + self.allpass_l[s];
                self.allpass_l[s] = flush_denormal(wet_l - a1 * y);
                wet_l = y;
            }
            left[i] = dry_l * (1.0 - mix) + wet_l * mix;

            // Process right channel (slightly offset LFO for stereo)
            let dry_r = right[i];
            let mut wet_r = right[i];
            let lfo_r = ((self.lfo_phase + 0.25) * core::f32::consts::TAU).sin();
            let freq_r = min_freq + (lfo_r + 1.0) * 0.5 * (max_freq - min_freq);
            let coeff_r = (core::f32::consts::PI * freq_r / self.sample_rate).tan();
            let a1_r = (coeff_r - 1.0) / (coeff_r + 1.0);
            for s in 0..4 {
                let y = a1_r * wet_r + self.allpass_r[s];
                self.allpass_r[s] = flush_denormal(wet_r - a1_r * y);
                wet_r = y;
            }
            right[i] = dry_r * (1.0 - mix) + wet_r * mix;
        }
    }

    /// Advance the free-running LFO while the processor-owned audio state is quiescent.
    pub fn advance_silence(&mut self, frames: usize, rate: f32) {
        let phase_inc = rate / self.sample_rate;
        for _ in 0..frames {
            self.lfo_phase = (self.lfo_phase + phase_inc) % 1.0;
        }
        self.allpass_l.fill(0.0);
        self.allpass_r.fill(0.0);
    }
}

/// Distortion with 2x oversampling to reduce aliasing from nonlinear waveshaping.
pub struct Distortion {
    /// Previous sample for the simple 2x upsampling interpolation
    prev_l: f32,
    prev_r: f32,
    /// Downsampling filter state (simple one-pole lowpass)
    ds_l: f32,
    ds_r: f32,
}

impl Distortion {
    pub fn new() -> Self {
        Self {
            prev_l: 0.0,
            prev_r: 0.0,
            ds_l: 0.0,
            ds_r: 0.0,
        }
    }

    pub fn process_block(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        drive: f32, // 0-10
        tone: f32,  // 0-1 (low=dark, high=bright)
        mix: f32,   // 0-1
    ) {
        if mix < 0.001 {
            return;
        }

        let gain = 1.0 + drive * 3.0;
        // Simple one-pole for tone control (higher tone = less filtering)
        let lp_coeff = 0.2 + tone * 0.8; // 0.2 (dark) to 1.0 (bright)

        for i in 0..left.len() {
            let dry_l = left[i];
            let dry_r = right[i];

            // 2x oversample: process at double rate with interpolated samples
            // Sample 1: interpolated midpoint
            let mid_l = (self.prev_l + left[i]) * 0.5;
            let mid_r = (self.prev_r + right[i]) * 0.5;

            // Waveshape both oversampled points
            let ws1_l = Self::waveshape(mid_l * gain);
            let ws1_r = Self::waveshape(mid_r * gain);
            let ws2_l = Self::waveshape(left[i] * gain);
            let ws2_r = Self::waveshape(right[i] * gain);

            // Average (simple 2x decimation with box filter)
            let dist_l = (ws1_l + ws2_l) * 0.5;
            let dist_r = (ws1_r + ws2_r) * 0.5;

            // Tone filter (one-pole lowpass on the distorted signal)
            self.ds_l = flush_denormal(self.ds_l + lp_coeff * (dist_l - self.ds_l));
            self.ds_r = flush_denormal(self.ds_r + lp_coeff * (dist_r - self.ds_r));

            left[i] = dry_l * (1.0 - mix) + self.ds_l * mix;
            right[i] = dry_r * (1.0 - mix) + self.ds_r * mix;

            self.prev_l = dry_l;
            self.prev_r = dry_r;
        }
    }

    /// Soft-clip waveshaper: tanh-like curve with asymmetric harmonics
    #[inline]
    fn waveshape(x: f32) -> f32 {
        let x = x.clamp(-4.0, 4.0);
        let x2 = x * x;
        x * (27.0 + x2) / (27.0 + 9.0 * x2)
    }
}

/// Simple feed-forward compressor with auto-makeup gain.
pub struct Compressor {
    envelope: f32,
}

impl Compressor {
    pub fn new() -> Self {
        Self { envelope: 0.0 }
    }

    pub fn process_block(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        threshold: f32, // dB (-60 to 0)
        ratio: f32,     // 1:1 to 20:1
        attack: f32,    // ms (0.1-100)
        release: f32,   // ms (10-1000)
        mix: f32,       // 0-1
        sample_rate: f32,
    ) {
        if mix < 0.001 {
            return;
        }

        let threshold_lin = 10.0f32.powf(threshold / 20.0);
        let att_coeff = (-1.0 / (attack * 0.001 * sample_rate)).exp();
        let rel_coeff = (-1.0 / (release * 0.001 * sample_rate)).exp();
        // Auto makeup: compensate for gain reduction at threshold
        let makeup = if ratio > 1.0 {
            (1.0 / ratio - 1.0) * threshold / 20.0
        } else {
            0.0
        };
        let makeup_lin = 10.0f32.powf(-makeup / 20.0);

        for i in 0..left.len() {
            let input_level = (left[i].abs()).max(right[i].abs());

            // Envelope follower
            let coeff = if input_level > self.envelope {
                att_coeff
            } else {
                rel_coeff
            };
            self.envelope = coeff * self.envelope + (1.0 - coeff) * input_level;

            // Gain computation
            let gain = if self.envelope > threshold_lin {
                let db_over = 20.0 * (self.envelope / threshold_lin).log10();
                let db_reduction = db_over * (1.0 - 1.0 / ratio);
                10.0f32.powf(-db_reduction / 20.0) * makeup_lin
            } else {
                makeup_lin
            };

            left[i] = left[i] * (1.0 - mix) + left[i] * gain * mix;
            right[i] = right[i] * (1.0 - mix) + right[i] * gain * mix;
        }
    }

    /// Follow the zero-input release curve without running the full gain computer.
    pub fn advance_silence(&mut self, frames: usize, release: f32, sample_rate: f32) {
        let rel_coeff = (-1.0 / (release * 0.001 * sample_rate)).exp();
        for _ in 0..frames {
            self.envelope = flush_denormal(rel_coeff * self.envelope);
        }
    }
}

/// Stereo width processor using Mid/Side encoding.
pub struct StereoWidth;

impl StereoWidth {
    /// Process a block. width: 0=mono, 1=unchanged, 2=extra wide
    pub fn process_block(left: &mut [f32], right: &mut [f32], width: f32) {
        if (width - 1.0).abs() < 0.001 {
            return;
        } // unity = no-op
        let w = width.clamp(0.0, 2.0);
        for i in 0..left.len() {
            let mid = (left[i] + right[i]) * 0.5;
            let side = (left[i] - right[i]) * 0.5;
            left[i] = mid + side * w;
            right[i] = mid - side * w;
        }
    }
}

// ── FDN Reverb ─────────────────────────────────────────────────────────────

/// Feedback Delay Network reverb — 4 delay lines with Hadamard mixing matrix.
/// Produces denser, more diffuse reverb than the plate algorithm.
pub struct FdnReverb {
    delays: [Vec<f32>; 4],
    write_pos: [usize; 4],
    feedback: [f32; 4], // one-pole filter states for damping
    damping: f32,
    decay: f32,
    mix: f32,
}

// Prime-length delay times in samples at 44100Hz (avoid metallic modes)
const FDN_DELAY_LENGTHS_44K: [usize; 4] = [1087, 1283, 1531, 1811];

impl FdnReverb {
    pub fn new(sample_rate: f32) -> Self {
        let ratio = sample_rate / 44100.0;
        let delays = [
            vec![0.0f32; (FDN_DELAY_LENGTHS_44K[0] as f32 * ratio) as usize],
            vec![0.0f32; (FDN_DELAY_LENGTHS_44K[1] as f32 * ratio) as usize],
            vec![0.0f32; (FDN_DELAY_LENGTHS_44K[2] as f32 * ratio) as usize],
            vec![0.0f32; (FDN_DELAY_LENGTHS_44K[3] as f32 * ratio) as usize],
        ];
        Self {
            delays,
            write_pos: [0; 4],
            feedback: [0.0; 4],
            damping: 0.5,
            decay: 0.5,
            mix: 0.0,
        }
    }

    /// Conservative interval before energy can traverse the complete FDN topology.
    pub fn max_tail_gap_samples(&self) -> u64 {
        self.delays.iter().map(|delay| delay.len() as u64).sum()
    }

    pub fn set_params(&mut self, decay: f32, mix: f32, damping: f32) {
        self.decay = decay.clamp(0.0, 0.99);
        self.mix = mix.clamp(0.0, 1.0);
        self.damping = damping.clamp(0.0, 0.99);
    }

    pub fn process(&mut self, in_l: f32, in_r: f32) -> (f32, f32) {
        if self.mix < 0.001 {
            return (in_l, in_r);
        }

        // Read from delay lines
        let mut taps = [0.0f32; 4];
        for i in 0..4 {
            taps[i] = self.delays[i][self.write_pos[i]];
        }

        // Hadamard-like mixing matrix (orthogonal, unitary)
        // H = 0.5 * [[1,1,1,1],[1,-1,1,-1],[1,1,-1,-1],[1,-1,-1,1]]
        let mixed = [
            0.5 * (taps[0] + taps[1] + taps[2] + taps[3]),
            0.5 * (taps[0] - taps[1] + taps[2] - taps[3]),
            0.5 * (taps[0] + taps[1] - taps[2] - taps[3]),
            0.5 * (taps[0] - taps[1] - taps[2] + taps[3]),
        ];

        // Apply damping (one-pole lowpass) and decay, write back
        let input_l = in_l * 0.25;
        let input_r = in_r * 0.25;
        let inputs = [input_l, input_r, input_l, input_r];

        for i in 0..4 {
            // DSP-2: the tank feedback state decays toward zero once input stops.
            let damped = flush_denormal(
                self.feedback[i] + (1.0 - self.damping) * (mixed[i] - self.feedback[i]),
            );
            self.feedback[i] = damped;
            let len = self.delays[i].len();
            self.delays[i][self.write_pos[i]] = inputs[i] + damped * self.decay;
            self.write_pos[i] = (self.write_pos[i] + 1) % len;
        }

        // Output: mix wet (taps 0+2 for L, 1+3 for R)
        let wet_l = (taps[0] + taps[2]) * 0.5;
        let wet_r = (taps[1] + taps[3]) * 0.5;

        (
            in_l * (1.0 - self.mix) + wet_l * self.mix,
            in_r * (1.0 - self.mix) + wet_r * self.mix,
        )
    }
}

// ── Parametric EQ ──────────────────────────────────────────────────────────

/// 3-band parametric EQ using RBJ Audio EQ Cookbook biquad filters.
pub struct ParametricEq {
    bands_l: [BiquadState; 3],
    bands_r: [BiquadState; 3],
    coeffs: [BiquadCoeffs; 3],
    /// Whether each band is enabled
    enabled: [bool; 3],
}

#[derive(Clone, Copy, Default)]
struct BiquadState {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

#[derive(Clone, Copy)]
struct BiquadCoeffs {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl Default for BiquadCoeffs {
    fn default() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }
}

impl BiquadCoeffs {
    /// Peaking EQ filter (RBJ cookbook)
    fn peaking(freq: f32, gain_db: f32, q: f32, sample_rate: f32) -> Self {
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = core::f32::consts::TAU * freq / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }
}

impl BiquadState {
    #[inline]
    fn process(&mut self, x: f32, c: &BiquadCoeffs) -> f32 {
        let raw = c.b0 * x + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
        // DSP-2: Direct-Form-I copy of proof::biquad — the recursive y-state decays
        // into the subnormal range on silence. Flushing once keeps both the stored
        // state and the returned sample clean.
        let y = flush_denormal(raw);
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

impl ParametricEq {
    pub fn new() -> Self {
        Self {
            bands_l: [BiquadState::default(); 3],
            bands_r: [BiquadState::default(); 3],
            coeffs: [BiquadCoeffs::default(); 3],
            enabled: [false; 3],
        }
    }

    /// Set band parameters. band_idx 0-2.
    pub fn set_band(&mut self, idx: usize, freq: f32, gain_db: f32, q: f32, sample_rate: f32) {
        if idx >= 3 {
            return;
        }
        self.coeffs[idx] = BiquadCoeffs::peaking(
            freq.clamp(20.0, 20000.0),
            gain_db.clamp(-24.0, 24.0),
            q.clamp(0.1, 20.0),
            sample_rate,
        );
        self.enabled[idx] = gain_db.abs() > 0.1;
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        for band_idx in 0..3 {
            if !self.enabled[band_idx] {
                continue;
            }
            let c = self.coeffs[band_idx];
            for i in 0..left.len() {
                left[i] = self.bands_l[band_idx].process(left[i], &c);
                right[i] = self.bands_r[band_idx].process(right[i], &c);
            }
        }
    }
}

// ── Plate Reverb ───────────────────────────────────────────────────────────

/// Simplified Dattorro plate reverb.
/// Based on Jon Dattorro's "Effect Design Part 1" (JAES, 1997).
/// Canonical base sample rate: 29761 Hz — all delay lengths scale proportionally.

const BASE_SR: f32 = 29761.0;

// Pre-delay lengths (samples at 29761 Hz)
const APF1_LEN: usize = 142;
const APF2_LEN: usize = 107;
const APF3_LEN: usize = 379;
const APF4_LEN: usize = 277;

// Tank delay lengths
const DELAY1_LEN: usize = 672;
const DELAY2_LEN: usize = 1800;
const DELAY3_LEN: usize = 908;
const DELAY4_LEN: usize = 2656;

// Allpass decay coefficients
const APF_COEFF: f32 = 0.7;
const DECAY: f32 = 0.5;

struct DelayLine {
    buffer: Vec<f32>,
    write_pos: usize,
}

impl DelayLine {
    fn new(max_len: usize) -> Self {
        Self {
            buffer: vec![0.0; max_len.max(1)],
            write_pos: 0,
        }
    }

    #[inline]
    fn read(&self, delay: usize) -> f32 {
        let len = self.buffer.len();
        let idx = (self.write_pos + len - delay.min(len - 1)) % len;
        self.buffer[idx]
    }

    #[inline]
    fn write(&mut self, sample: f32) {
        self.buffer[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.buffer.len();
    }
}

pub struct PlateReverb {
    // Input diffusion allpasses
    apf1: DelayLine,
    apf2: DelayLine,
    apf3: DelayLine,
    apf4: DelayLine,
    // Tank delays
    del1: DelayLine,
    del2: DelayLine,
    del3: DelayLine,
    del4: DelayLine,
    // Scaled delay lengths for current sample rate
    apf1_len: usize,
    apf2_len: usize,
    apf3_len: usize,
    apf4_len: usize,
    del1_len: usize,
    del2_len: usize,
    del3_len: usize,
    del4_len: usize,
    // Tank state
    tank_l: f32,
    tank_r: f32,
    decay: f32,
    mix: f32,
    damping: f32,
    damp_state_l: f32,
    damp_state_r: f32,
}

impl PlateReverb {
    pub fn new(sample_rate: f32) -> Self {
        let scale = sample_rate / BASE_SR;
        let s = |base: usize| -> usize { (base as f32 * scale).round() as usize };

        Self {
            apf1: DelayLine::new(s(APF1_LEN) + 1),
            apf2: DelayLine::new(s(APF2_LEN) + 1),
            apf3: DelayLine::new(s(APF3_LEN) + 1),
            apf4: DelayLine::new(s(APF4_LEN) + 1),
            del1: DelayLine::new(s(DELAY1_LEN) + 1),
            del2: DelayLine::new(s(DELAY2_LEN) + 1),
            del3: DelayLine::new(s(DELAY3_LEN) + 1),
            del4: DelayLine::new(s(DELAY4_LEN) + 1),
            apf1_len: s(APF1_LEN),
            apf2_len: s(APF2_LEN),
            apf3_len: s(APF3_LEN),
            apf4_len: s(APF4_LEN),
            del1_len: s(DELAY1_LEN),
            del2_len: s(DELAY2_LEN),
            del3_len: s(DELAY3_LEN),
            del4_len: s(DELAY4_LEN),
            tank_l: 0.0,
            tank_r: 0.0,
            decay: DECAY,
            mix: 0.3,
            damping: 0.5,
            damp_state_l: 0.0,
            damp_state_r: 0.0,
        }
    }

    /// Conservative interval before energy can traverse the complete plate topology.
    pub fn max_tail_gap_samples(&self) -> u64 {
        [
            self.apf1_len,
            self.apf2_len,
            self.apf3_len,
            self.apf4_len,
            self.del1_len,
            self.del2_len,
            self.del3_len,
            self.del4_len,
        ]
        .into_iter()
        .map(|length| length as u64)
        .sum()
    }

    pub fn set_params(&mut self, decay: f32, mix: f32, damping: f32) {
        self.decay = decay.clamp(0.0, 0.99);
        self.mix = mix.clamp(0.0, 1.0);
        self.damping = damping.clamp(0.0, 0.99);
    }

    #[inline]
    fn allpass(dl: &mut DelayLine, input: f32, len: usize, coeff: f32) -> f32 {
        let delayed = dl.read(len);
        let output = -coeff * input + delayed;
        dl.write(input + coeff * output);
        output
    }

    /// Process stereo input, return (left, right) with reverb mixed in.
    #[inline]
    pub fn process(&mut self, left: f32, right: f32) -> (f32, f32) {
        let input = (left + right) * 0.5;

        // Input diffusion
        let d1 = Self::allpass(&mut self.apf1, input, self.apf1_len, APF_COEFF);
        let d2 = Self::allpass(&mut self.apf2, d1, self.apf2_len, APF_COEFF);

        // Tank left
        let in_l = d2 + self.tank_r * self.decay;
        let t1 = Self::allpass(&mut self.apf3, in_l, self.apf3_len, -self.decay);
        self.del1.write(t1);
        let t2 = self.del1.read(self.del1_len);
        // Damping (one-pole lowpass)
        // DSP-2: the tank damping state decays toward zero once the tank empties.
        self.damp_state_l =
            flush_denormal(t2 * (1.0 - self.damping) + self.damp_state_l * self.damping);
        self.del2.write(self.damp_state_l * self.decay);
        self.tank_l = self.del2.read(self.del2_len);

        // Tank right
        let in_r = d2 + self.tank_l * self.decay;
        let t3 = Self::allpass(&mut self.apf4, in_r, self.apf4_len, -self.decay);
        self.del3.write(t3);
        let t4 = self.del3.read(self.del3_len);
        // Damping (one-pole lowpass)
        // DSP-2: the tank damping state decays toward zero once the tank empties.
        self.damp_state_r =
            flush_denormal(t4 * (1.0 - self.damping) + self.damp_state_r * self.damping);
        self.del4.write(self.damp_state_r * self.decay);
        self.tank_r = self.del4.read(self.del4_len);

        // Mix dry/wet
        let wet_l = self.tank_l;
        let wet_r = self.tank_r;
        let dry = 1.0 - self.mix;
        (
            left * dry + wet_l * self.mix,
            right * dry + wet_r * self.mix,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{Compressor, StereoChorus, StereoPhaser};

    const SAMPLE_RATE: f32 = 48_000.0;
    const FRAMES: usize = 128;

    fn assert_blocks_close(left: &[f32], right: &[f32], label: &str) {
        let max_error = left
            .iter()
            .zip(right)
            .map(|(left, right)| (left - right).abs())
            .fold(0.0f32, f32::max);
        assert!(max_error <= 1.0e-6, "{label} diverged by {max_error}");
    }

    #[test]
    fn chorus_silent_advance_matches_continuous_zero_input() {
        let mut continuous = StereoChorus::new(SAMPLE_RATE);
        let mut sleeping = StereoChorus::new(SAMPLE_RATE);
        let mut zero_left = [0.0; FRAMES];
        let mut zero_right = [0.0; FRAMES];

        continuous.process_block(&mut zero_left, &mut zero_right, 2.75, 0.8, 0.6);
        sleeping.advance_silence(FRAMES, 2.75);

        let mut continuous_left = [0.0; FRAMES];
        let mut continuous_right = [0.0; FRAMES];
        let mut sleeping_left = [0.0; FRAMES];
        let mut sleeping_right = [0.0; FRAMES];
        continuous_left[0] = 1.0;
        continuous_right[0] = 1.0;
        sleeping_left[0] = 1.0;
        sleeping_right[0] = 1.0;
        continuous.process_block(&mut continuous_left, &mut continuous_right, 2.75, 0.8, 0.6);
        sleeping.process_block(&mut sleeping_left, &mut sleeping_right, 2.75, 0.8, 0.6);

        assert_blocks_close(&continuous_left, &sleeping_left, "chorus left");
        assert_blocks_close(&continuous_right, &sleeping_right, "chorus right");
    }

    #[test]
    fn phaser_silent_advance_matches_continuous_zero_input() {
        let mut continuous = StereoPhaser::new(SAMPLE_RATE);
        let mut sleeping = StereoPhaser::new(SAMPLE_RATE);
        let mut zero_left = [0.0; FRAMES];
        let mut zero_right = [0.0; FRAMES];

        continuous.process_block(&mut zero_left, &mut zero_right, 3.0, 0.7, 0.5);
        sleeping.advance_silence(FRAMES, 3.0);

        let mut continuous_left = [0.0; FRAMES];
        let mut continuous_right = [0.0; FRAMES];
        let mut sleeping_left = [0.0; FRAMES];
        let mut sleeping_right = [0.0; FRAMES];
        continuous_left[0] = 1.0;
        continuous_right[0] = 1.0;
        sleeping_left[0] = 1.0;
        sleeping_right[0] = 1.0;
        continuous.process_block(&mut continuous_left, &mut continuous_right, 3.0, 0.7, 0.5);
        sleeping.process_block(&mut sleeping_left, &mut sleeping_right, 3.0, 0.7, 0.5);

        assert_blocks_close(&continuous_left, &sleeping_left, "phaser left");
        assert_blocks_close(&continuous_right, &sleeping_right, "phaser right");
    }

    #[test]
    fn compressor_silent_advance_matches_continuous_release() {
        let mut continuous = Compressor::new();
        let mut sleeping = Compressor::new();
        let mut prime_left = [0.8; FRAMES];
        let mut prime_right = [0.8; FRAMES];
        let mut sleeping_prime_left = prime_left;
        let mut sleeping_prime_right = prime_right;
        continuous.process_block(
            &mut prime_left,
            &mut prime_right,
            -24.0,
            8.0,
            1.0,
            250.0,
            1.0,
            SAMPLE_RATE,
        );
        sleeping.process_block(
            &mut sleeping_prime_left,
            &mut sleeping_prime_right,
            -24.0,
            8.0,
            1.0,
            250.0,
            1.0,
            SAMPLE_RATE,
        );

        let mut zero_left = [0.0; FRAMES];
        let mut zero_right = [0.0; FRAMES];
        continuous.process_block(
            &mut zero_left,
            &mut zero_right,
            -24.0,
            8.0,
            1.0,
            250.0,
            1.0,
            SAMPLE_RATE,
        );
        sleeping.advance_silence(FRAMES, 250.0, SAMPLE_RATE);

        let mut continuous_left = [0.4; FRAMES];
        let mut continuous_right = [0.4; FRAMES];
        let mut sleeping_left = continuous_left;
        let mut sleeping_right = continuous_right;
        continuous.process_block(
            &mut continuous_left,
            &mut continuous_right,
            -24.0,
            8.0,
            1.0,
            250.0,
            1.0,
            SAMPLE_RATE,
        );
        sleeping.process_block(
            &mut sleeping_left,
            &mut sleeping_right,
            -24.0,
            8.0,
            1.0,
            250.0,
            1.0,
            SAMPLE_RATE,
        );

        assert_blocks_close(&continuous_left, &sleeping_left, "compressor left");
        assert_blocks_close(&continuous_right, &sleeping_right, "compressor right");
    }
}
