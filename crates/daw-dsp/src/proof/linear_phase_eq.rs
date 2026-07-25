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
#[derive(Clone, Copy)]
pub struct LinearPhaseEqBand {
    pub enabled: bool,
    pub coeffs: BiquadCoeffs, // used only for magnitude response computation
}

/// Upper bound on bands a design can take, matching `MasteringEq`'s band count.
/// Fixing it lets the band set live inline instead of in a `Vec` that the
/// redesign would have to reallocate (DSP-7).
pub const MAX_LINEAR_PHASE_BANDS: usize = 8;

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
    /// True until a FIR has actually been designed. While set, `process` is a
    /// no-op and `latency_samples` reports 0 -- the filter is not in the path,
    /// so it must not claim delay the signal does not experience.
    needs_rebuild: bool,
    bands: [LinearPhaseEqBand; MAX_LINEAR_PHASE_BANDS],
    band_count: usize,
    // DSP-7: redesign scratch, preallocated so `rebuild` never allocates.
    magnitude: Vec<f64>,
    impulse: Vec<f64>,
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
            bands: [LinearPhaseEqBand {
                enabled: false,
                coeffs: BiquadCoeffs::unity(),
            }; MAX_LINEAR_PHASE_BANDS],
            band_count: 0,
            magnitude: vec![1.0; FIR_SIZE / 2 + 1],
            impulse: vec![0.0; FIR_SIZE],
        }
    }

    /// Whether the FIR is designed and actually filtering. The chain uses this
    /// to decide both which EQ to run and what latency to report; the two must
    /// never disagree.
    pub fn is_active(&self) -> bool {
        !self.bypassed && !self.needs_rebuild
    }

    /// Rebuild the FIR filter from band settings.
    ///
    /// **Allocation-free** (DSP-7): the band set, the magnitude response and
    /// the impulse response all live in buffers sized once in [`Self::new`],
    /// and the centring shift is folded into the index arithmetic instead of
    /// calling `rotate_right`.
    ///
    /// It is still **not** safe to call from the audio thread, for a reason
    /// allocation was never the whole of: the inverse transform is evaluated
    /// naively, so it costs `FIR_SIZE * FIR_SIZE/2` = 2,097,152 cosine
    /// evaluations -- roughly four 128-sample blocks' worth of budget at
    /// 48 kHz, in one call. Wiring this to a parameter change needs the work
    /// amortized across blocks behind a double-buffered FIR; until then the
    /// chain keeps the IIR `MasteringEq` in the path (see `ProofChain`), so no
    /// caller reaches this from `process`.
    pub fn rebuild(&mut self, bands: &[LinearPhaseEqBand]) {
        self.band_count = bands.len().min(MAX_LINEAR_PHASE_BANDS);
        self.bands[..self.band_count].copy_from_slice(&bands[..self.band_count]);
        let bands = &self.bands[..self.band_count];

        // Desired magnitude response at each frequency bin.
        for i in 0..=FIR_SIZE / 2 {
            let freq = i as f64 * self.sample_rate / FIR_SIZE as f64;
            if freq < 1.0 {
                self.magnitude[i] = 1.0;
                continue;
            }
            let mut mag = 1.0_f64;
            for band in bands {
                if band.enabled {
                    mag *= biquad_magnitude(&band.coeffs, freq, self.sample_rate);
                }
            }
            self.magnitude[i] = mag;
        }

        // Symmetric (linear-phase) impulse response via a real inverse
        // transform, written straight into its centred position: the old code
        // built it at `n` and then rotated right by HALF_FIR, which maps index
        // `n` to `n + HALF_FIR`, so index `j` here reads source index
        // `j - HALF_FIR` modulo FIR_SIZE.
        for j in 0..FIR_SIZE {
            let n = (j + FIR_SIZE - HALF_FIR) % FIR_SIZE;
            let mut sum = self.magnitude[0]; // DC component
            for k in 1..FIR_SIZE / 2 {
                let angle = 2.0 * PI * k as f64 * n as f64 / FIR_SIZE as f64;
                sum += 2.0 * self.magnitude[k] * angle.cos();
            }
            sum += self.magnitude[FIR_SIZE / 2] * (PI * n as f64).cos(); // Nyquist
            self.impulse[j] = sum / FIR_SIZE as f64;
        }

        // Window in place, then narrow into both channels' taps.
        for j in 0..FIR_SIZE {
            let windowed = self.impulse[j] * blackman_harris(j, FIR_SIZE);
            self.fir_l[j] = windowed as f32;
            self.fir_r[j] = windowed as f32;
        }
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

    /// Delay the FIR actually imposes.
    ///
    /// DSP-7: this used to return `HALF_FIR` whenever `bypassed` was false --
    /// and nothing ever sets `bypassed` -- so a Proof instance reported 1024
    /// samples of latency it did not have. Wave 3 feeds this into host PDC, so
    /// that was a real 21.3 ms timing error at 48 kHz, not a cosmetic one. An
    /// undesigned FIR is not in the signal path and delays nothing.
    pub fn latency_samples(&self) -> usize {
        if self.is_active() {
            HALF_FIR
        } else {
            0
        }
    }
}
