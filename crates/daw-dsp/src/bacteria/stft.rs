//! STFT (Short-Time Fourier Transform) engine for Bacteria.
//!
//! Used for: spectral freeze, spectral blur (smudge), breakdown
//! pitch-shifting, and codec artifact simulation.
//!
//! Implements overlap-add with Hann windowing.

use std::f32::consts::PI;

const MAX_FFT_SIZE: usize = 4096;
const HOP_DIVISOR: usize = 4; // 75% overlap
const DEFAULT_FFT_SIZE: usize = 2048;

/// Coherent gain of the Hann analysis + Hann synthesis pair at this
/// processor's 75 % overlap.
///
/// Every frame is windowed on the way in and again on the way out, so the
/// overlap-add sum carries `Σ_k w²(n − kN/4)`, which for a Hann window at a
/// hop of `N/4` is exactly `3/2` and independent of `n`. A stage that means to
/// be unity through the transform has to divide it back out, so
/// [`StftProcessor::output_scale`] defaults to `1 / OLA_GAIN`: a transform
/// that changes nothing has to deliver the level it was handed, and a stage
/// that wants the raw reconstruction says so.
pub const OLA_GAIN: f32 = 1.5;
const DEFAULT_BIT_REVERSE: [usize; DEFAULT_FFT_SIZE] =
    build_bit_reverse_indices::<DEFAULT_FFT_SIZE>();

const fn build_bit_reverse_indices<const SIZE: usize>() -> [usize; SIZE] {
    let mut indices = [0usize; SIZE];
    let mut index = 0;
    let bits = SIZE.trailing_zeros() as usize;

    while index < SIZE {
        let mut value = index;
        let mut reversed = 0usize;
        let mut shift = 0;

        while shift < bits {
            reversed = (reversed << 1) | (value & 1);
            value >>= 1;
            shift += 1;
        }

        indices[index] = reversed;
        index += 1;
    }

    indices
}

fn generate_bit_reverse_indices(size: usize) -> Vec<usize> {
    let bits = size.trailing_zeros() as usize;
    let mut indices = vec![0usize; size];

    for (index, slot) in indices.iter_mut().enumerate() {
        let mut value = index;
        let mut reversed = 0usize;

        for _ in 0..bits {
            reversed = (reversed << 1) | (value & 1);
            value >>= 1;
        }

        *slot = reversed;
    }

    indices
}

/// In-place radix-2 Cooley-Tukey FFT.
fn fft(real: &mut [f32], imag: &mut [f32], bit_reverse: &[usize], inverse: bool) {
    let n = real.len();
    assert!(n.is_power_of_two());
    assert_eq!(imag.len(), n);
    assert_eq!(bit_reverse.len(), n);

    // Bit-reversal permutation
    for i in 0..n {
        let j = bit_reverse[i];
        if i < j {
            real.swap(i, j);
            imag.swap(i, j);
        }
    }

    // Butterfly stages
    let mut stage_size = 2;
    while stage_size <= n {
        let half = stage_size / 2;
        let angle_sign = if inverse { 1.0 } else { -1.0 };
        let w_step = angle_sign * 2.0 * PI / stage_size as f32;

        for k in (0..n).step_by(stage_size) {
            for j in 0..half {
                let angle = w_step * j as f32;
                let wr = angle.cos();
                let wi = angle.sin();

                let idx1 = k + j;
                let idx2 = k + j + half;

                let tr = wr * real[idx2] - wi * imag[idx2];
                let ti = wr * imag[idx2] + wi * real[idx2];

                real[idx2] = real[idx1] - tr;
                imag[idx2] = imag[idx1] - ti;
                real[idx1] += tr;
                imag[idx1] += ti;
            }
        }
        stage_size <<= 1;
    }

    if inverse {
        let scale = 1.0 / n as f32;
        for i in 0..n {
            real[i] *= scale;
            imag[i] *= scale;
        }
    }
}

/// Overlap-add STFT processor with pluggable spectral transform.
pub struct StftProcessor {
    fft_size: usize,
    hop_size: usize,
    window: Vec<f32>,
    bit_reverse: Vec<usize>,

    // Input accumulation
    input_buffer: Vec<f32>,
    input_write_pos: usize,
    samples_since_last_hop: usize,

    // FFT workspace
    fft_real: Vec<f32>,
    fft_imag: Vec<f32>,
    magnitudes: Vec<f32>,
    phases: Vec<f32>,

    // Output overlap-add
    output_buffer: Vec<f32>,
    output_read_pos: usize,

    // Spectral state for blur/freeze
    smoothed_mags: Vec<f32>,
    frozen_mags: Vec<f32>,
    frozen_phases: Vec<f32>,

    // Parameters
    blur_alpha: f32,
    freeze: bool,
    mix: f32,
    /// Gain applied to the wet path only, defaulting to `1 / OLA_GAIN` so the
    /// transform is unity end to end. See [`OLA_GAIN`].
    output_scale: f32,

    ready: bool,
}

impl StftProcessor {
    pub fn new(fft_size: usize) -> Self {
        let fft_size = fft_size.min(MAX_FFT_SIZE).next_power_of_two();
        let hop_size = fft_size / HOP_DIVISOR;
        let half = fft_size / 2 + 1;

        // Hann window
        let window: Vec<f32> = (0..fft_size)
            .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f32 / fft_size as f32).cos()))
            .collect();
        let bit_reverse = if fft_size == DEFAULT_FFT_SIZE {
            Vec::from(const { DEFAULT_BIT_REVERSE })
        } else {
            generate_bit_reverse_indices(fft_size)
        };

        Self {
            fft_size,
            hop_size,
            window,
            bit_reverse,
            input_buffer: vec![0.0; fft_size * 2],
            input_write_pos: 0,
            samples_since_last_hop: 0,
            fft_real: vec![0.0; fft_size],
            fft_imag: vec![0.0; fft_size],
            magnitudes: vec![0.0; half],
            phases: vec![0.0; half],
            output_buffer: vec![0.0; fft_size * 2],
            output_read_pos: 0,
            smoothed_mags: vec![0.0; half],
            frozen_mags: vec![0.0; half],
            frozen_phases: vec![0.0; half],
            blur_alpha: 0.5,
            freeze: false,
            mix: 0.5,
            output_scale: 1.0 / OLA_GAIN,
            ready: false,
        }
    }

    /// Group delay of the overlap-add path, in samples at whatever rate this
    /// processor is being fed.
    ///
    /// A frame analysed after the write of sample `t` covers inputs
    /// `t+1-N ..= t` (see `process_frame`'s read cursor) and is overlap-added
    /// starting at output position `t+1`. Frame tap `i` therefore carries
    /// input `t+1-N+i` and lands at output `t+1+i`: a flat `N`-sample delay,
    /// the same for every tap and so for the window's centroid too.
    ///
    /// Exact, not an estimate — this is the number the host needs for delay
    /// compensation when a stage built on this processor is in the path.
    pub fn latency_samples(&self) -> usize {
        self.fft_size
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "spectralBlur" => self.blur_alpha = value.clamp(0.0, 0.999),
            "spectralFreeze" => {
                let new_freeze = value > 0.5;
                if new_freeze && !self.freeze {
                    // Capture current state
                    self.frozen_mags.copy_from_slice(&self.smoothed_mags);
                    self.frozen_phases.copy_from_slice(&self.phases);
                }
                self.freeze = new_freeze;
            }
            "spectralMix" => self.mix = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    /// Process one sample. Returns processed output.
    pub fn process_sample(&mut self, input: f32) -> f32 {
        // Write input into circular buffer
        self.input_buffer[self.input_write_pos] = input;
        self.input_write_pos = (self.input_write_pos + 1) % (self.fft_size * 2);
        self.samples_since_last_hop += 1;

        // The dry tap is held back to the transform's own delay rather than
        // taken from `input`.
        //
        // The wet path costs [`Self::latency_samples`]; blending it against an
        // undelayed dry made the stage a comb — silent at `mix` 1.0, where
        // Smudge lives, and deepest at 0.5, which is the freeze/blur default.
        // It also left the stage with no single group delay to report: half its
        // output arrived a full window early, so any number handed to host PDC
        // was wrong for the other half. Delayed here, the stage presents
        // `latency_samples()` at every mix value and the report is exact.
        //
        // The ring already holds the history, so this is a read offset, not a
        // second buffer.
        let dry =
            self.input_buffer[(self.input_write_pos + self.fft_size - 1) % (self.fft_size * 2)];

        // Read output from overlap-add buffer
        let wet = self.output_buffer[self.output_read_pos];
        self.output_buffer[self.output_read_pos] = 0.0; // Clear after reading
        self.output_read_pos = (self.output_read_pos + 1) % (self.fft_size * 2);

        // Process a hop when enough samples accumulated
        if self.samples_since_last_hop >= self.hop_size {
            self.samples_since_last_hop = 0;
            self.process_frame();
            self.ready = true;
        }

        if !self.ready {
            return dry;
        }

        dry * (1.0 - self.mix) + wet * self.output_scale * self.mix
    }

    fn process_frame(&mut self) {
        let n = self.fft_size;
        let half = n / 2 + 1;

        // Copy windowed input into FFT buffer
        for i in 0..n {
            let read_pos = (self.input_write_pos + self.fft_size * 2 - n + i) % (self.fft_size * 2);
            self.fft_real[i] = self.input_buffer[read_pos] * self.window[i];
            self.fft_imag[i] = 0.0;
        }

        // Forward FFT
        fft(
            &mut self.fft_real,
            &mut self.fft_imag,
            &self.bit_reverse,
            false,
        );

        // Extract magnitudes and phases
        for k in 0..half {
            let re = self.fft_real[k];
            let im = self.fft_imag[k];
            self.magnitudes[k] = (re * re + im * im).sqrt();
            self.phases[k] = im.atan2(re);
        }

        // Apply spectral processing
        if self.freeze {
            // Use frozen magnitudes with original phases
            for k in 0..half {
                self.magnitudes[k] = self.frozen_mags[k];
                self.phases[k] = self.frozen_phases[k];
            }
        } else {
            // Spectral blur: recursive magnitude smoothing
            // M_avg[k,n] = alpha * M[k,n] + (1-alpha) * M_avg[k,n-1]
            let alpha = 1.0 - self.blur_alpha;
            for k in 0..half {
                self.smoothed_mags[k] =
                    alpha * self.magnitudes[k] + (1.0 - alpha) * self.smoothed_mags[k];
                self.magnitudes[k] = self.smoothed_mags[k];
            }
        }

        // Reconstruct complex spectrum
        for k in 0..half {
            self.fft_real[k] = self.magnitudes[k] * self.phases[k].cos();
            self.fft_imag[k] = self.magnitudes[k] * self.phases[k].sin();
        }
        // Mirror for real signal
        for k in half..n {
            self.fft_real[k] = self.fft_real[n - k];
            self.fft_imag[k] = -self.fft_imag[n - k];
        }

        // Inverse FFT
        fft(
            &mut self.fft_real,
            &mut self.fft_imag,
            &self.bit_reverse,
            true,
        );

        // Window and overlap-add into output buffer
        let out_start = self.output_read_pos;
        for i in 0..n {
            let pos = (out_start + i) % (self.fft_size * 2);
            self.output_buffer[pos] += self.fft_real[i] * self.window[i];
        }
    }

    pub fn reset(&mut self) {
        self.input_buffer.fill(0.0);
        self.output_buffer.fill(0.0);
        self.smoothed_mags.fill(0.0);
        self.frozen_mags.fill(0.0);
        self.frozen_phases.fill(0.0);
        self.input_write_pos = 0;
        self.output_read_pos = 0;
        self.samples_since_last_hop = 0;
        self.ready = false;
    }
}

/// Smudge processor — temporal/spectral hybrid that blurs transients before distortion.
/// Operates in STFT domain, smooths FFT magnitudes across successive frames.
///
/// Fully wet and gain-corrected: [`StftProcessor`] divides the Hann-pair
/// overlap-add gain back out (see [`OLA_GAIN`]) so selecting Smudge changes the
/// character of a band without changing its level by +3.5 dB.
///
/// Costs [`Self::latency_samples`] of group delay, which the band chain folds
/// into the engine's reported latency.
pub struct SmudgeProcessor {
    stft: StftProcessor,
}

impl SmudgeProcessor {
    pub fn new() -> Self {
        let mut stft = StftProcessor::new(2048);
        stft.blur_alpha = 0.85; // Heavy smoothing for smudge
        stft.mix = 1.0;
        Self { stft }
    }

    pub fn set_amount(&mut self, amount: f32) {
        self.stft.blur_alpha = (0.5 + amount * 0.49).clamp(0.0, 0.999); // 0.5 to 0.99
    }

    /// Group delay in samples at the rate this processor is fed.
    pub fn latency_samples(&self) -> usize {
        self.stft.latency_samples()
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        self.stft.process_sample(input)
    }

    pub fn reset(&mut self) {
        self.stft.reset();
    }
}

impl Default for SmudgeProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// Breakdown processor — **not implemented**. Do not wire this into a band.
///
/// The intent is pitch-down by `f_new = f_original × 2^(-n)` via phase-vocoder
/// bin remapping, followed by foldback clipping. None of that is here:
///
/// - `process_sample` does no pitch shift. It maps `depth` onto
///   [`StftProcessor::blur_alpha`] and delegates, so the octave control moves
///   a *spectral blur* coefficient. Its own comment says so.
/// - `remap_mags` / `remap_phases` are allocated and zeroed by `reset` and are
///   never read or written anywhere else. They are the shape of the missing
///   algorithm, not the algorithm.
/// - [`StftProcessor`] has no hook to remap bins through (`process_frame`
///   hard-codes freeze-or-blur) and carries neither the previous-frame
///   analysis phases nor the synthesis phase accumulator a phase vocoder needs.
/// - There is no foldback clipping.
///
/// What it *does* is `SmudgeProcessor` with a different blur coefficient.
/// Routing `DistortionMode::Breakdown` here would put a control labelled
/// "Breakdown, 0–4 oct" in front of a blur knob — the same defect class as
/// leaving the mode inert, with the added cost of looking finished. Completing
/// it means writing a phase vocoder, which is DSP this type does not contain.
pub struct BreakdownProcessor {
    stft: StftProcessor,
    depth: f32, // octaves to shift down
    remap_mags: Vec<f32>,
    remap_phases: Vec<f32>,
}

impl BreakdownProcessor {
    pub fn new() -> Self {
        let fft_size = 2048;
        let half = fft_size / 2 + 1;
        let mut stft = StftProcessor::new(fft_size);
        stft.mix = 1.0;
        Self {
            stft,
            depth: 1.0,
            remap_mags: vec![0.0; half],
            remap_phases: vec![0.0; half],
        }
    }

    pub fn set_depth(&mut self, octaves: f32) {
        self.depth = octaves.clamp(0.0, 4.0);
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        // The STFT processor handles the frame-based processing;
        // bin remapping would be injected into the spectral transform.
        // For now, use the STFT with heavy blur as approximation.
        self.stft.blur_alpha = 0.3 + self.depth * 0.15;
        self.stft.process_sample(input)
    }

    pub fn reset(&mut self) {
        self.stft.reset();
        self.remap_mags.fill(0.0);
        self.remap_phases.fill(0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FFT_SIZE: usize = 2048;

    /// `latency_samples` is the number the host is given for delay
    /// compensation, so it has to be the delay the transform actually
    /// delivers — not a plausible one.
    ///
    /// Measured against the one configuration where the transform is an
    /// identity: `spectralBlur` 0 makes the recursive smoother's coefficient
    /// 1, so magnitudes pass through untouched alongside their original
    /// phases and the overlap-add reconstructs the input exactly, scaled by
    /// [`OLA_GAIN`]. An impulse in therefore comes out as an impulse, and its
    /// position is the group delay by direct reading.
    ///
    /// `output_scale` is pushed back to 1 here so the same reading still pins
    /// the raw overlap-add gain. The shipped default divides it out; that is
    /// what `the_default_output_scale_makes_the_transform_unity` measures.
    #[test]
    fn latency_samples_is_the_delay_the_transform_delivers() {
        let mut stft = StftProcessor::new(FFT_SIZE);
        stft.set_param("spectralBlur", 0.0);
        stft.set_param("spectralMix", 1.0);
        stft.output_scale = 1.0;

        // Past the first hop, so the `!ready` dry passthrough is behind us.
        const IMPULSE_AT: usize = 4096;
        const TOTAL: usize = IMPULSE_AT + 3 * FFT_SIZE;

        let rendered: Vec<f32> = (0..TOTAL)
            .map(|index| {
                let input = if index == IMPULSE_AT { 1.0 } else { 0.0 };
                stft.process_sample(input)
            })
            .collect();

        let (arrival, amplitude) = rendered
            .iter()
            .enumerate()
            .skip(IMPULSE_AT)
            .max_by(|(_, a), (_, b)| a.abs().total_cmp(&b.abs()))
            .map(|(index, value)| (index, *value))
            .expect("render produced no samples");

        assert_eq!(
            arrival - IMPULSE_AT,
            stft.latency_samples(),
            "the impulse arrived {} samples late against a reported {}",
            arrival - IMPULSE_AT,
            stft.latency_samples()
        );
        // The same reading pins the overlap-add gain: a Hann pair at a hop of
        // N/4 sums to exactly 3/2, which is what `SmudgeProcessor` divides out.
        assert!(
            (amplitude - OLA_GAIN).abs() < 0.01,
            "overlap-add gain measured {amplitude:.4}, expected {OLA_GAIN}"
        );
    }

    /// Nothing before the delay elapses, because a transform that leaked the
    /// input early would satisfy the arrival assertion above by accident.
    #[test]
    fn nothing_arrives_before_the_reported_delay() {
        let mut stft = StftProcessor::new(FFT_SIZE);
        stft.set_param("spectralBlur", 0.0);
        stft.set_param("spectralMix", 1.0);

        const IMPULSE_AT: usize = 4096;
        let latency = stft.latency_samples();
        let rendered: Vec<f32> = (0..IMPULSE_AT + latency)
            .map(|index| {
                let input = if index == IMPULSE_AT { 1.0 } else { 0.0 };
                stft.process_sample(input)
            })
            .collect();

        let leak = rendered[IMPULSE_AT..]
            .iter()
            .fold(0.0_f32, |acc, s| acc.max(s.abs()));
        assert!(
            leak < 1e-5,
            "{leak:.3e} of the impulse appeared inside the {latency}-sample \
             delay it is supposed to sit behind"
        );
    }

    /// `SmudgeProcessor` divides [`OLA_GAIN`] back out, so a steady tone —
    /// whose magnitudes the recursive smoother converges onto exactly — comes
    /// through at unity rather than +3.5 dB.
    #[test]
    fn smudge_is_unity_gain_on_steady_material() {
        let mut smudge = SmudgeProcessor::new();
        let tone = |index: usize| (2.0 * PI * 440.0 * index as f32 / 48_000.0).sin() * 0.5;

        let total = 48_000;
        let rendered: Vec<f32> = (0..total)
            .map(|index| smudge.process_sample(tone(index)))
            .collect();

        // Settled tail only: the smoother needs several frames to converge.
        let tail = total / 2;
        let output_peak = rendered[tail..]
            .iter()
            .fold(0.0_f32, |acc, s| acc.max(s.abs()));
        let gain_db = 20.0 * (output_peak / 0.5).log10();
        assert!(
            gain_db.abs() < 0.5,
            "smudge delivers {gain_db:+.2} dB on a steady tone; the \
             overlap-add gain is not being divided back out"
        );
    }

    /// The freeze/blur path used to render the raw overlap-add reconstruction,
    /// so switching `spectralEnabled` on added +3.5 dB to the band on top of
    /// whatever the blur did. Only the Smudge wrapper divided the gain out.
    ///
    /// Same identity configuration as the delay reading above, so the impulse
    /// that arrives is the input unchanged and its height is the stage's gain.
    #[test]
    fn the_default_output_scale_makes_the_transform_unity() {
        let mut stft = StftProcessor::new(FFT_SIZE);
        stft.set_param("spectralBlur", 0.0);
        stft.set_param("spectralMix", 1.0);

        const IMPULSE_AT: usize = 4096;
        const TOTAL: usize = IMPULSE_AT + 3 * FFT_SIZE;

        let peak = (0..TOTAL)
            .map(|index| {
                let input = if index == IMPULSE_AT { 1.0 } else { 0.0 };
                stft.process_sample(input)
            })
            .fold(0.0_f32, |worst, s| worst.max(s.abs()));

        assert!(
            (peak - 1.0).abs() < 0.01,
            "the transform delivered {peak:.4}x on an identity configuration; \
             the overlap-add gain is not being divided back out"
        );
    }

    /// The stage blends a dry tap against a wet path that costs a whole
    /// window, so the dry tap has to wait for it. Undelayed, the blend was a
    /// comb — invisible at `mix` 1.0 where Smudge sits, deepest at the
    /// freeze/blur default of 0.5 — and the stage had no single group delay to
    /// report to host PDC.
    ///
    /// Probed at `mix` 0, where the output is dry alone and its delay can be
    /// read directly off an impulse.
    #[test]
    fn the_dry_tap_carries_the_reported_delay() {
        let mut stft = StftProcessor::new(FFT_SIZE);
        stft.set_param("spectralMix", 0.0);

        const IMPULSE_AT: usize = 4096;
        let latency = stft.latency_samples();
        let rendered: Vec<f32> = (0..IMPULSE_AT + 2 * FFT_SIZE)
            .map(|index| {
                let input = if index == IMPULSE_AT { 1.0 } else { 0.0 };
                stft.process_sample(input)
            })
            .collect();

        let (arrival, amplitude) = rendered
            .iter()
            .enumerate()
            .skip(IMPULSE_AT)
            .max_by(|(_, a), (_, b)| a.abs().total_cmp(&b.abs()))
            .map(|(index, value)| (index, *value))
            .expect("render produced no samples");

        assert_eq!(
            arrival - IMPULSE_AT,
            latency,
            "the dry tap arrived {} samples late against a reported {latency}",
            arrival - IMPULSE_AT
        );
        assert!(
            (amplitude - 1.0).abs() < 1.0e-4,
            "the dry tap must be the input itself, got {amplitude}"
        );
    }

    /// The window is what sets the delay, so the accessor has to follow it
    /// rather than return a constant that happens to match at 2048.
    #[test]
    fn latency_follows_the_configured_window() {
        assert_eq!(StftProcessor::new(1024).latency_samples(), 1024);
        assert_eq!(StftProcessor::new(2048).latency_samples(), 2048);
        assert_eq!(StftProcessor::new(4096).latency_samples(), 4096);
    }
}
