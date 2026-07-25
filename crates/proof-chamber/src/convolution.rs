/// Convolution reverb engine — non-uniform partitioned convolution.
///
/// García (2002) inspired: head in time domain (zero latency), tail in FFT
/// with increasing partition sizes (256 → 512 → 1024 → 2048 → 4096).
/// True stereo support (4-channel IR: LL, LR, RL, RR).
/// IR management: auto-trim, exponential decay stretching, frequency-domain EQ.
use std::f32::consts::TAU;

// The `decay` contract is crate-wide: `decay` is a normalised coefficient, and
// this engine needs it as a stretch factor for the loaded IR.
use crate::decay_curve::{decay_to_ir_stretch, MAX_IR_STRETCH, MIN_IR_STRETCH};

// ---------------------------------------------------------------------------
// Radix-2 FFT
// ---------------------------------------------------------------------------

fn fft(re: &mut [f32], im: &mut [f32], inverse: bool) {
    let n = re.len();
    if !n.is_power_of_two() || n < 2 {
        return;
    }

    // Bit-reversal permutation
    let mut j = 0;
    for i in 0..n {
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
        let mut m = n >> 1;
        while m >= 1 && j >= m {
            j -= m;
            m >>= 1;
        }
        j += m;
    }

    let sign = if inverse { 1.0 } else { -1.0 };
    let mut size = 2;
    while size <= n {
        let half = size / 2;
        let angle = sign * TAU / size as f32;
        let cos_a = angle.cos();
        let sin_a = angle.sin();

        for k in (0..n).step_by(size) {
            let mut w_re = 1.0_f32;
            let mut w_im = 0.0_f32;
            for jj in 0..half {
                let i1 = k + jj;
                let i2 = k + jj + half;
                let t_re = w_re * re[i2] - w_im * im[i2];
                let t_im = w_re * im[i2] + w_im * re[i2];
                re[i2] = re[i1] - t_re;
                im[i2] = im[i1] - t_im;
                re[i1] += t_re;
                im[i1] += t_im;
                let nw_re = w_re * cos_a - w_im * sin_a;
                let nw_im = w_re * sin_a + w_im * cos_a;
                w_re = nw_re;
                w_im = nw_im;
            }
        }
        size *= 2;
    }

    if inverse {
        let scale = 1.0 / n as f32;
        for i in 0..n {
            re[i] *= scale;
            im[i] *= scale;
        }
    }
}

#[inline]
fn complex_mul(a_re: f32, a_im: f32, b_re: f32, b_im: f32) -> (f32, f32) {
    (a_re * b_re - a_im * b_im, a_re * b_im + a_im * b_re)
}

fn next_power_of_2(n: usize) -> usize {
    let mut v = n;
    v -= 1;
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    v + 1
}

// ---------------------------------------------------------------------------
// Non-uniform partition stage
// ---------------------------------------------------------------------------

/// Simple ring-buffer delay line (zero-length = passthrough).
struct DelayLine {
    buf: Vec<f32>,
    pos: usize,
}

impl DelayLine {
    fn new(samples: usize) -> Self {
        Self {
            buf: vec![0.0; samples],
            pos: 0,
        }
    }

    #[inline]
    fn push(&mut self, input: f32) -> f32 {
        if self.buf.is_empty() {
            return input;
        }
        let out = self.buf[self.pos];
        self.buf[self.pos] = input;
        self.pos = (self.pos + 1) % self.buf.len();
        out
    }
}

struct ConvStage {
    partition_size: usize,
    fft_size: usize,
    num_partitions: usize,
    ir_re: Vec<Vec<f32>>,
    ir_im: Vec<Vec<f32>>,
    fdl_re: Vec<Vec<f32>>,
    fdl_im: Vec<Vec<f32>>,
    fdl_pos: usize,
    // Per-stage input delay aligning the stage's segment to the global
    // latency reference: a stage emits its segment at
    // (input delay + partition_size + local offset), which must equal the
    // segment's absolute IR offset plus the global latency.
    input_delay: DelayLine,
    input_acc: Vec<f32>,
    input_acc_pos: usize,
    // Overlap-add state. `emit_buf` holds the fully summed output block
    // (first half of the IFFT plus the tail carried from the previous
    // block); `tail_buf` carries this block's second half forward.
    emit_buf: Vec<f32>,
    tail_buf: Vec<f32>,
    emit_pos: usize,
}

impl ConvStage {
    fn new(partition_size: usize, ir_segment: &[f32], delay_samples: usize) -> Self {
        let fft_size = partition_size * 2;
        let num_partitions = (ir_segment.len() + partition_size - 1) / partition_size;

        let mut ir_re = Vec::with_capacity(num_partitions);
        let mut ir_im = Vec::with_capacity(num_partitions);

        for p in 0..num_partitions {
            let start = p * partition_size;
            let end = (start + partition_size).min(ir_segment.len());
            let mut re = vec![0.0_f32; fft_size];
            let mut im = vec![0.0_f32; fft_size];
            for (i, &s) in ir_segment[start..end].iter().enumerate() {
                re[i] = s;
            }
            fft(&mut re, &mut im, false);
            ir_re.push(re);
            ir_im.push(im);
        }

        let fdl_re = (0..num_partitions).map(|_| vec![0.0; fft_size]).collect();
        let fdl_im = (0..num_partitions).map(|_| vec![0.0; fft_size]).collect();

        Self {
            partition_size,
            fft_size,
            num_partitions,
            ir_re,
            ir_im,
            fdl_re,
            fdl_im,
            fdl_pos: 0,
            input_delay: DelayLine::new(delay_samples),
            input_acc: vec![0.0; partition_size],
            input_acc_pos: 0,
            emit_buf: vec![0.0; partition_size],
            tail_buf: vec![0.0; partition_size],
            // The first output block is silent: a block's convolution can only
            // be emitted while the next block accumulates, so the stage has an
            // inherent one-partition streaming latency.
            emit_pos: partition_size,
        }
    }

    /// Feed one sample, get one output sample.
    #[inline]
    fn process_sample(&mut self, input: f32) -> f32 {
        let delayed = self.input_delay.push(input);
        self.input_acc[self.input_acc_pos] = delayed;
        self.input_acc_pos += 1;

        let output = if self.emit_pos < self.partition_size {
            self.emit_buf[self.emit_pos]
        } else {
            0.0
        };
        self.emit_pos += 1;

        if self.input_acc_pos >= self.partition_size {
            self.input_acc_pos = 0;
            self.emit_pos = 0;

            let mut in_re = vec![0.0_f32; self.fft_size];
            let mut in_im = vec![0.0_f32; self.fft_size];
            in_re[..self.partition_size].copy_from_slice(&self.input_acc);
            fft(&mut in_re, &mut in_im, false);

            self.fdl_pos = if self.fdl_pos == 0 {
                self.num_partitions.saturating_sub(1)
            } else {
                self.fdl_pos - 1
            };
            if self.fdl_pos < self.fdl_re.len() {
                self.fdl_re[self.fdl_pos] = in_re;
                self.fdl_im[self.fdl_pos] = in_im;
            }

            let mut acc_re = vec![0.0_f32; self.fft_size];
            let mut acc_im = vec![0.0_f32; self.fft_size];
            for p in 0..self.num_partitions {
                let fdl_idx = (self.fdl_pos + p) % self.num_partitions;
                for k in 0..self.fft_size {
                    let (r, i) = complex_mul(
                        self.fdl_re[fdl_idx][k],
                        self.fdl_im[fdl_idx][k],
                        self.ir_re[p][k],
                        self.ir_im[p][k],
                    );
                    acc_re[k] += r;
                    acc_im[k] += i;
                }
            }

            fft(&mut acc_re, &mut acc_im, true);

            // Overlap-add: the linear convolution of this block is the first
            // half of the IFFT summed with the second half carried from the
            // previous block. Carry this block's second half forward.
            // (Previously the buffer was *replaced* and only the second half
            // was emitted — the correct first half was discarded every block,
            // so an impulse produced essentially zero tail output.)
            for i in 0..self.partition_size {
                self.emit_buf[i] = acc_re[i] + self.tail_buf[i];
                self.tail_buf[i] = acc_re[self.partition_size + i];
            }
        }

        output
    }
}

// ---------------------------------------------------------------------------
// IR processing utilities
// ---------------------------------------------------------------------------

/// Auto-trim IR at -60 dB below peak.
fn auto_trim(ir: &[f32]) -> &[f32] {
    let peak = ir.iter().map(|s| s.abs()).fold(0.0_f32, f32::max);
    let threshold = peak * 0.001;
    let end = ir.iter().rposition(|s| s.abs() > threshold).unwrap_or(0) + 1;
    &ir[..end]
}

/// Stretch IR decay time by modifying the exponential envelope.
/// factor > 1.0 = longer decay, factor < 1.0 = shorter decay.
fn stretch_ir_decay(ir: &mut [f32], factor: f32) {
    if factor == 1.0 || ir.is_empty() {
        return;
    }
    let len = ir.len() as f32;
    for (i, sample) in ir.iter_mut().enumerate() {
        let t = i as f32 / len;
        // Modify the natural decay envelope: multiply by 10^(3*t*(1-1/factor)/len_sec)
        let env_mod = (3.0 * t * (1.0 - 1.0 / factor)).exp();
        *sample *= env_mod.min(4.0); // clamp to prevent extreme boosting
    }
}

/// Apply frequency-domain EQ to an IR (modifies in-place).
/// `eq_gains` is [6] bands of gain in dB at [100, 400, 1200, 3500, 8000, 12000] Hz.
fn apply_ir_eq(ir: &mut [f32], eq_gains: &[f32; 6], sample_rate: f32) {
    if eq_gains.iter().all(|&g| g.abs() < 0.1) {
        return; // flat EQ, skip
    }

    let fft_size = next_power_of_2(ir.len());
    let mut re = vec![0.0_f32; fft_size];
    let mut im = vec![0.0_f32; fft_size];
    re[..ir.len()].copy_from_slice(ir);

    fft(&mut re, &mut im, false);

    // Apply EQ in frequency domain
    let band_freqs = [100.0, 400.0, 1200.0, 3500.0, 8000.0, 12000.0];
    for k in 0..fft_size / 2 {
        let freq = k as f32 * sample_rate / fft_size as f32;
        // Interpolate gain from nearest bands
        let mut gain_db = 0.0_f32;
        for b in 0..6 {
            let dist = ((freq - band_freqs[b]).abs() / band_freqs[b]).min(2.0);
            let weight = (1.0 - dist * 0.5).max(0.0);
            gain_db += eq_gains[b] * weight;
        }
        let gain_linear = 10.0_f32.powf(gain_db / 20.0);
        re[k] *= gain_linear;
        im[k] *= gain_linear;
        if k > 0 && k < fft_size / 2 {
            re[fft_size - k] *= gain_linear;
            im[fft_size - k] *= gain_linear;
        }
    }

    fft(&mut re, &mut im, true);
    ir.copy_from_slice(&re[..ir.len()]);
}

// ---------------------------------------------------------------------------
// Convolution engine with non-uniform partitioning
// ---------------------------------------------------------------------------

const MAX_IR_SAMPLES: usize = 288000;
const HEAD_SIZE: usize = 128;

/// Non-uniform partition sizes (increasing for efficiency).
const STAGE_SIZES: [usize; 5] = [256, 512, 1024, 2048, 4096];

/// Global latency reference, in samples. Every part of the wet path — head,
/// every tail stage, and the dry reference — is aligned so an IR tap at
/// absolute index `m` lands at output index `m + GLOBAL_LATENCY`.
/// Stage i's segment starts at absolute offset `HEAD_SIZE + S_i` and the
/// stage adds `P_i` of streaming latency, so its input is delayed by
/// `HEAD_SIZE + S_i + GLOBAL_LATENCY - P_i`; the minimum over stages of
/// `(absolute offset) - P_i` is `HEAD_SIZE - STAGE_SIZES[0] = -128`, which
/// fixes `GLOBAL_LATENCY = 128` (the largest zero-delay choice).
const GLOBAL_LATENCY: usize = HEAD_SIZE;

pub struct ConvolutionEngine {
    sample_rate: f32,

    // Direct head (time-domain, zero latency before alignment)
    head_ir: Vec<f32>,
    head_len: usize,
    input_history: Vec<f32>,
    input_pos: usize,
    // Alignment delays: the head and the dry reference are delayed by
    // GLOBAL_LATENCY so they land on the same timeline as the input-delayed
    // tail stages (see GLOBAL_LATENCY).
    head_delay: DelayLine,
    stereo_head_delay: DelayLine,
    dry_delay_l: DelayLine,
    dry_delay_r: DelayLine,

    // Non-uniform FFT stages
    stages: Vec<ConvStage>,

    // True stereo (second channel for RL→RR path)
    stereo_head_ir: Vec<f32>,
    stereo_stages: Vec<ConvStage>,
    has_true_stereo: bool,

    // IR EQ (applied at load time)
    ir_eq: [f32; 6],
    // Decay stretch factor
    decay_stretch: f32,

    pub mix: f32,
    pub loaded: bool,
}

impl ConvolutionEngine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            head_ir: Vec::new(),
            head_len: 0,
            input_history: vec![0.0; HEAD_SIZE + 1],
            input_pos: 0,
            head_delay: DelayLine::new(GLOBAL_LATENCY),
            stereo_head_delay: DelayLine::new(GLOBAL_LATENCY),
            dry_delay_l: DelayLine::new(GLOBAL_LATENCY),
            dry_delay_r: DelayLine::new(GLOBAL_LATENCY),
            stages: Vec::new(),
            stereo_head_ir: Vec::new(),
            stereo_stages: Vec::new(),
            has_true_stereo: false,
            ir_eq: [0.0; 6],
            decay_stretch: 1.0,
            mix: 0.3,
            loaded: false,
        }
    }

    /// Load an IR. Channels: 1=mono, 2=stereo parallel, 4=true stereo (LL,LR,RL,RR).
    pub fn load_ir(&mut self, ir_data: &[f32], channels: usize) {
        if ir_data.is_empty() || channels == 0 {
            return;
        }

        let frame_count = ir_data.len() / channels;

        // Extract left channel (or LL for true stereo)
        let mut left_ir: Vec<f32> = (0..frame_count).map(|i| ir_data[i * channels]).collect();

        // Auto-trim
        let trim_len = {
            let trimmed = auto_trim(&left_ir);
            trimmed.len().min(MAX_IR_SAMPLES)
        };
        left_ir.truncate(trim_len);

        // Apply decay stretch
        if self.decay_stretch != 1.0 {
            stretch_ir_decay(&mut left_ir, self.decay_stretch);
        }

        // Apply IR EQ
        apply_ir_eq(&mut left_ir, &self.ir_eq, self.sample_rate);

        // Build head
        let head_len = HEAD_SIZE.min(left_ir.len());
        self.head_ir = left_ir[..head_len].to_vec();
        self.head_len = head_len;
        self.input_history = vec![0.0; head_len + 1];
        self.input_pos = 0;

        // Build non-uniform partition stages
        let tail = &left_ir[head_len..];
        self.stages = build_stages(tail);

        // True stereo: extract right-input channel (RL or channel index 2)
        self.has_true_stereo = channels == 4;
        if self.has_true_stereo {
            let mut right_ir: Vec<f32> = (0..frame_count.min(trim_len))
                .map(|i| {
                    let idx = i * channels + 2; // RL channel
                    if idx < ir_data.len() {
                        ir_data[idx]
                    } else {
                        0.0
                    }
                })
                .collect();

            if self.decay_stretch != 1.0 {
                stretch_ir_decay(&mut right_ir, self.decay_stretch);
            }
            apply_ir_eq(&mut right_ir, &self.ir_eq, self.sample_rate);

            let stereo_head_len = HEAD_SIZE.min(right_ir.len());
            self.stereo_head_ir = right_ir[..stereo_head_len].to_vec();
            let stereo_tail = &right_ir[stereo_head_len..];
            self.stereo_stages = build_stages(stereo_tail);
        }

        self.loaded = true;
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "mix" => self.mix = value.clamp(0.0, 1.0),
            "ir_stretch" => self.decay_stretch = value.clamp(MIN_IR_STRETCH, MAX_IR_STRETCH),
            // Host contract: `decay` is the normalised 0..0.999 coefficient the
            // `dutch-oven` descriptor declares, converted to a stretch factor by
            // the same law the FDN uses for RT60. Handled here rather than at the
            // call site so the hybrid engine's blind forwarding gets it too.
            // Note this only bites at `load_ir` time, and nothing calls `load_ir`
            // yet — see the caveat in `decay_curve`.
            "decay" => self.decay_stretch = decay_to_ir_stretch(value),
            "ir_eq_1" => self.ir_eq[0] = value.clamp(-12.0, 12.0),
            "ir_eq_2" => self.ir_eq[1] = value.clamp(-12.0, 12.0),
            "ir_eq_3" => self.ir_eq[2] = value.clamp(-12.0, 12.0),
            "ir_eq_4" => self.ir_eq[3] = value.clamp(-12.0, 12.0),
            "ir_eq_5" => self.ir_eq[4] = value.clamp(-12.0, 12.0),
            "ir_eq_6" => self.ir_eq[5] = value.clamp(-12.0, 12.0),
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if !self.loaded {
            return;
        }

        for i in 0..left.len() {
            let dry_l = left[i];
            let dry_r = right[i];
            let mono = (dry_l + dry_r) * 0.5;

            // Head: direct convolution
            self.input_history[self.input_pos] = mono;
            let mut head_out = 0.0_f32;
            for k in 0..self.head_len {
                let idx =
                    (self.input_pos + self.input_history.len() - k) % self.input_history.len();
                head_out += self.input_history[idx] * self.head_ir[k];
            }
            self.input_pos = (self.input_pos + 1) % self.input_history.len();

            // Tail: non-uniform partitioned stages
            let mut tail_out = 0.0_f32;
            for stage in self.stages.iter_mut() {
                tail_out += stage.process_sample(mono);
            }

            let wet_l = self.head_delay.push(head_out) + tail_out;

            // True stereo: process right input through RL/RR path
            let wet_r = if self.has_true_stereo {
                let mut stereo_head = 0.0_f32;
                for k in 0..self.stereo_head_ir.len() {
                    let idx =
                        (self.input_pos + self.input_history.len() - k) % self.input_history.len();
                    stereo_head += self.input_history[idx] * self.stereo_head_ir[k];
                }
                let mut stereo_tail = 0.0_f32;
                for stage in self.stereo_stages.iter_mut() {
                    stereo_tail += stage.process_sample(mono);
                }
                self.stereo_head_delay.push(stereo_head) + stereo_tail
            } else {
                wet_l // mono-to-stereo: same on both channels
            };

            // The dry reference takes the same alignment delay as the wet
            // path so the mix stays time-coherent; the plugin reports
            // GLOBAL_LATENCY via get_latency for host PDC.
            let aligned_dry_l = self.dry_delay_l.push(dry_l);
            let aligned_dry_r = self.dry_delay_r.push(dry_r);

            left[i] = aligned_dry_l * (1.0 - self.mix) + wet_l * self.mix;
            right[i] = aligned_dry_r * (1.0 - self.mix) + wet_r * self.mix;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        vec![
            "mix",
            "decay",
            "ir_stretch",
            "ir_eq_1",
            "ir_eq_2",
            "ir_eq_3",
            "ir_eq_4",
            "ir_eq_5",
            "ir_eq_6",
        ]
    }
}

/// Build non-uniform partition stages from a tail IR segment.
fn build_stages(tail: &[f32]) -> Vec<ConvStage> {
    if tail.is_empty() {
        return Vec::new();
    }

    let mut stages = Vec::new();
    let mut offset = 0;

    for &stage_size in &STAGE_SIZES {
        if offset >= tail.len() {
            break;
        }
        // Each stage covers stage_size * 8 samples of the IR (8 partitions per stage)
        let stage_coverage = stage_size * 8;
        let end = (offset + stage_coverage).min(tail.len());
        let segment = &tail[offset..end];

        if !segment.is_empty() {
            // Align the stage to the global reference: its segment starts at
            // absolute IR offset HEAD_SIZE + offset, and the stage adds
            // stage_size of streaming latency, so its input is delayed until
            // (delay + stage_size + local offset) == (absolute offset +
            // GLOBAL_LATENCY). Without this every stage emitted its segment
            // at partition_size + local offset — late for the first stage,
            // progressively early for the rest.
            let delay = (HEAD_SIZE + offset + GLOBAL_LATENCY).saturating_sub(stage_size);
            stages.push(ConvStage::new(stage_size, segment, delay));
        }
        offset = end;
    }

    // Any remaining tail goes into the largest stage size
    if offset < tail.len() {
        let largest = *STAGE_SIZES.last().unwrap();
        let delay = (HEAD_SIZE + offset + GLOBAL_LATENCY).saturating_sub(largest);
        stages.push(ConvStage::new(largest, &tail[offset..], delay));
    }

    stages
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::ConvolutionEngine;

    /// Deterministic decaying-noise IR. The generator must be spectrally
    /// white at the stage-delay lags (a multiply-without-carries hash is
    /// pathologically correlated at lag 1792 and would fake an energy
    /// deficit in the stage-overlap region).
    fn make_ir(len: usize) -> Vec<f32> {
        let mut state = 12345_u32;
        (0..len)
            .map(|i| {
                state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = ((state >> 8) as f32 / (1 << 24) as f32) * 2.0 - 1.0;
                noise * (-(i as f32) / 1500.0).exp()
            })
            .collect()
    }

    /// Run the engine over `input` (fed identically on both channels) with
    /// mix = 1.0, in host-sized blocks, returning the wet left channel.
    fn run_engine(ir: &[f32], input: &[f32]) -> Vec<f32> {
        let mut engine = ConvolutionEngine::new(48_000.0);
        engine.load_ir(ir, 1);
        engine.set_param("mix", 1.0);

        let mut left = input.to_vec();
        let mut right = input.to_vec();
        for start in (0..left.len()).step_by(1024) {
            let end = (start + 1024).min(left.len());
            engine.process(&mut left[start..end], &mut right[start..end]);
        }
        left
    }

    /// Naive time-domain convolution, used as the ground-truth reference.
    fn reference_convolution(input: &[f32], ir: &[f32]) -> Vec<f32> {
        let mut out = vec![0.0_f32; input.len() + ir.len() - 1];
        for (n, &x) in input.iter().enumerate() {
            if x == 0.0 {
                continue;
            }
            for (k, &h) in ir.iter().enumerate() {
                out[n + k] += x * h;
            }
        }
        out
    }

    #[test]
    fn impulse_produces_tail_energy_matching_reference_convolution() {
        // 6000 samples: head (128) + stage 1 (2048) + a stage-2 crossing.
        let ir = make_ir(6000);
        let mut input = vec![0.0_f32; 8192];
        input[0] = 1.0;

        let out = run_engine(&ir, &input);
        let reference = reference_convolution(&input, &ir);

        let engine_energy: f32 = out.iter().map(|s| s * s).sum();
        let reference_energy: f32 = reference.iter().map(|s| s * s).sum();
        assert!(
            (engine_energy - reference_energy).abs() / reference_energy < 0.05,
            "total wet energy must match true convolution (engine={engine_energy}, reference={reference_energy})"
        );

        // The decisive assertion for the discarded-tail bug: pre-fix the tail
        // stages emitted ~1e-14 total; the head alone cannot reach this bound.
        let tail_energy: f32 = out[256..].iter().map(|s| s * s).sum();
        assert!(
            tail_energy > 0.5 * reference_energy,
            "tail stages must contribute the bulk of the response (tail={tail_energy}, total={reference_energy})"
        );
    }

    #[test]
    fn impulse_taps_land_at_their_ir_index_plus_global_latency() {
        // One tap per FFT stage: stage 1 (abs 200), stage 2 (abs 3000),
        // stage 3 (abs 7000). Every tap must appear at output index
        // (IR index + GLOBAL_LATENCY) — the alignment the undelayed-stage
        // design violated (stage 1 ran 128 late, stage 2 1664 early, stage 3
        // 5248 early). Energy/RMS tests are delay-insensitive and cannot see
        // the misalignment; this one can.
        let mut ir = vec![0.0_f32; 7001];
        ir[200] = 1.0;
        ir[3000] = 0.5;
        ir[7000] = 0.25;
        let mut input = vec![0.0_f32; 16384];
        input[0] = 1.0;

        let out = run_engine(&ir, &input);

        for &(tap, amp) in &[(200usize, 1.0f32), (3000, 0.5), (7000, 0.25)] {
            let at = tap + super::GLOBAL_LATENCY;
            assert!(
                (out[at] - amp).abs() < 1.0e-3,
                "tap at IR index {tap} must appear at output index {at} (got {})",
                out[at]
            );
        }

        // And nothing but the three taps anywhere: total energy equals the
        // tap energies within FFT roundoff.
        let total: f32 = out.iter().map(|s| s * s).sum();
        let taps: f32 = 1.0f32.powi(2) + 0.5f32.powi(2) + 0.25f32.powi(2);
        assert!(
            (total - taps).abs() < 1.0e-2,
            "taps must not smear beyond their aligned positions (total={total}, taps={taps})"
        );
    }

    #[test]
    fn dc_input_converges_to_ir_sum_without_tearing() {
        // Positive decaying IR: the steady-state DC response is exactly the IR
        // sum. The discarded-tail bug tore this to a small oscillating
        // fraction of the true value.
        let ir: Vec<f32> = (0..2000).map(|i| (-(i as f32) / 800.0).exp()).collect();
        let input = vec![1.0_f32; 8192];

        let out = run_engine(&ir, &input);

        let ir_sum: f32 = ir.iter().sum();
        for (n, &s) in out.iter().enumerate().skip(4096) {
            assert!(
                (s - ir_sum).abs() / ir_sum < 0.01,
                "steady-state DC output must equal the IR sum (n={n}, out={s}, ir_sum={ir_sum})"
            );
        }
    }

    #[test]
    fn sine_output_is_continuous_across_partition_boundaries() {
        // IR long enough to cross the stage-1/stage-2 partition boundary.
        let ir = make_ir(6000);
        let input: Vec<f32> = (0..16384)
            .map(|n| (n as f32 * 2.0 * std::f32::consts::PI * 440.0 / 48_000.0).sin() * 0.5)
            .collect();

        let out = run_engine(&ir, &input);

        // An LTI system driven by a steady sine reaches constant-amplitude
        // steady state. Compare against the true convolution: pre-fix this
        // ratio was 2.14 (torn leakage coherently amplifies a continuous
        // tone); with correct overlap-add it sits near 1.0 — the residual
        // spread is incoherent cross-stage overlap with a noise IR.
        let reference = reference_convolution(&input, &ir);
        let rms =
            |slice: &[f32]| (slice.iter().map(|s| s * s).sum::<f32>() / slice.len() as f32).sqrt();
        let engine_rms = rms(&out[8192..]);
        let reference_rms = rms(&reference[8192..input.len()]);
        let ratio = engine_rms / reference_rms;
        assert!(
            (ratio - 1.0).abs() < 0.15,
            "steady-state sine response must match true convolution (engine={engine_rms}, reference={reference_rms}, ratio={ratio})"
        );

        // No periodic amplitude tearing across partition boundaries either.
        let block_rms: Vec<f32> = out[8192..]
            .chunks(256)
            .map(|chunk| (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt())
            .collect();
        let max_rms = block_rms.iter().copied().fold(0.0_f32, f32::max);
        let min_rms = block_rms.iter().copied().fold(f32::MAX, f32::min);
        assert!(
            min_rms > 0.5 * max_rms,
            "steady-state sine RMS must not tear across partition boundaries (min={min_rms}, max={max_rms})"
        );
    }
}
