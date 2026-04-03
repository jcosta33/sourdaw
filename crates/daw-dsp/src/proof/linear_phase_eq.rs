//! Linear Phase EQ — FIR-based EQ with zero phase distortion.
//!
//! Design process:
//! 1. Compute desired magnitude response from EQ band settings
//! 2. IFFT to get symmetric impulse response
//! 3. Apply Blackman-Harris window
//! 4. Convolve with input via overlap-add
//!
//! Latency = FIR_SIZE / 2 samples.

use super::biquad::BiquadCoeffs;
use core::f64::consts::PI;

const FIR_SIZE: usize = 2048;
const HALF_FIR: usize = FIR_SIZE / 2;

/// Blackman-Harris window function.
fn blackman_harris(n: usize, len: usize) -> f64 {
    let x = 2.0 * PI * n as f64 / (len - 1) as f64;
    0.35875 - 0.48829 * x.cos() + 0.14128 * (2.0 * x).cos() - 0.01168 * (3.0 * x).cos()
}

/// Compute the magnitude response of a biquad filter at a given frequency.
fn biquad_magnitude(coeffs: &BiquadCoeffs, freq_hz: f64, sr: f64) -> f64 {
    let w = 2.0 * PI * freq_hz / sr;
    let cos_w = w.cos();
    let cos_2w = (2.0 * w).cos();
    let sin_w = w.sin();
    let sin_2w = (2.0 * w).sin();

    let b0 = coeffs.b0 as f64;
    let b1 = coeffs.b1 as f64;
    let b2 = coeffs.b2 as f64;
    let a1 = coeffs.a1 as f64;
    let a2 = coeffs.a2 as f64;

    let num_real = b0 + b1 * cos_w + b2 * cos_2w;
    let num_imag = -(b1 * sin_w + b2 * sin_2w);
    let den_real = 1.0 + a1 * cos_w + a2 * cos_2w;
    let den_imag = -(a1 * sin_w + a2 * sin_2w);

    let num_mag = (num_real * num_real + num_imag * num_imag).sqrt();
    let den_mag = (den_real * den_real + den_imag * den_imag).sqrt();

    if den_mag < 1e-10 {
        1.0
    } else {
        num_mag / den_mag
    }
}

/// Band specification for linear phase EQ design.
pub struct LinearPhaseEqBand {
    pub enabled: bool,
    pub coeffs: BiquadCoeffs, // used only for magnitude response computation
}

pub struct LinearPhaseEq {
    fir_l: Vec<f32>,
    fir_r: Vec<f32>,
    // Overlap-add state
    input_buffer_l: Vec<f32>,
    input_buffer_r: Vec<f32>,
    overlap_l: Vec<f32>,
    overlap_r: Vec<f32>,
    write_pos: usize,
    block_size: usize,
    sample_rate: f64,
    bypassed: bool,
    needs_rebuild: bool,
    bands: Vec<LinearPhaseEqBand>,
}

impl LinearPhaseEq {
    pub fn new(sr: f64) -> Self {
        Self {
            fir_l: vec![0.0; FIR_SIZE],
            fir_r: vec![0.0; FIR_SIZE],
            input_buffer_l: vec![0.0; FIR_SIZE],
            input_buffer_r: vec![0.0; FIR_SIZE],
            overlap_l: vec![0.0; HALF_FIR],
            overlap_r: vec![0.0; HALF_FIR],
            write_pos: 0,
            block_size: HALF_FIR,
            sample_rate: sr,
            bypassed: false,
            needs_rebuild: true,
            bands: Vec::new(),
        }
    }

    /// Rebuild the FIR filter from band settings.
    pub fn rebuild(&mut self, bands: &[LinearPhaseEqBand]) {
        self.bands = bands
            .iter()
            .map(|b| LinearPhaseEqBand {
                enabled: b.enabled,
                coeffs: b.coeffs.clone(),
            })
            .collect();

        // Compute desired magnitude response at each frequency bin
        let mut magnitude = vec![1.0_f64; FIR_SIZE / 2 + 1];
        for i in 0..=FIR_SIZE / 2 {
            let freq = i as f64 * self.sample_rate / FIR_SIZE as f64;
            if freq < 1.0 {
                continue;
            }
            for band in &self.bands {
                if band.enabled {
                    magnitude[i] *= biquad_magnitude(&band.coeffs, freq, self.sample_rate);
                }
            }
        }

        // Build symmetric impulse response via real IFFT
        // Since we want linear phase, the impulse response is symmetric (real-only spectrum)
        let mut ir = vec![0.0_f64; FIR_SIZE];
        for n in 0..FIR_SIZE {
            let mut sum = magnitude[0]; // DC component
            for k in 1..FIR_SIZE / 2 {
                let angle = 2.0 * PI * k as f64 * n as f64 / FIR_SIZE as f64;
                sum += 2.0 * magnitude[k] * angle.cos();
            }
            sum += magnitude[FIR_SIZE / 2] * (PI * n as f64).cos(); // Nyquist
            ir[n] = sum / FIR_SIZE as f64;
        }

        // Circular shift to center the impulse
        ir.rotate_right(HALF_FIR);

        // Apply Blackman-Harris window
        for (n, sample) in ir.iter_mut().enumerate() {
            *sample *= blackman_harris(n, FIR_SIZE);
        }

        // Store as f32 FIR
        self.fir_l = ir.iter().map(|&v| v as f32).collect();
        self.fir_r = self.fir_l.clone();
        self.needs_rebuild = false;
    }

    pub fn set_bypassed(&mut self, bypassed: bool) {
        self.bypassed = bypassed;
    }

    pub fn mark_dirty(&mut self) {
        self.needs_rebuild = true;
    }

    /// Process stereo audio using overlap-add convolution.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed {
            return;
        }
        if self.needs_rebuild {
            return;
        } // wait for rebuild

        // Simple direct-form FIR (not FFT-based for simplicity at this FIR size)
        // For FIR_SIZE=2048, direct convolution is acceptable for real-time at typical block sizes
        for i in 0..left.len() {
            self.input_buffer_l[self.write_pos] = left[i];
            self.input_buffer_r[self.write_pos] = right[i];

            let mut sum_l = 0.0_f32;
            let mut sum_r = 0.0_f32;
            for k in 0..FIR_SIZE {
                let idx = (self.write_pos + FIR_SIZE - k) % FIR_SIZE;
                sum_l += self.input_buffer_l[idx] * self.fir_l[k];
                sum_r += self.input_buffer_r[idx] * self.fir_r[k];
            }

            left[i] = sum_l;
            right[i] = sum_r;
            self.write_pos = (self.write_pos + 1) % FIR_SIZE;
        }
    }

    pub fn latency_samples(&self) -> usize {
        if self.bypassed {
            0
        } else {
            HALF_FIR
        }
    }
}
