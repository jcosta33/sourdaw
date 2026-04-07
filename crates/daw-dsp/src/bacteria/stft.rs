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
            ready: false,
        }
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

        // Read output from overlap-add buffer
        let dry = input;
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

        dry * (1.0 - self.mix) + wet * self.mix
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
        self.stft.blur_alpha = 0.5 + amount * 0.49; // 0.5 to 0.99
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        self.stft.process_sample(input)
    }

    pub fn reset(&mut self) {
        self.stft.reset();
    }
}

/// Breakdown processor — pitch-down via phase vocoder bin remapping + foldback clipping.
/// f_new = f_original × 2^(-n) where n = octaver depth.
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
