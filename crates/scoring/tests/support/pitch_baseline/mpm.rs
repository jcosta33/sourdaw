// Frozen test-only source oracle from cdf56ae23082998f2f3be0264309ca2c6025dee2.
// Captured before the shared-pitch extraction; never used by production.
#![allow(dead_code)]

/// McLeod Pitch Method (MPM / NSDF) — cross-check and confidence.
///
/// NSDF(τ) = 2r(τ) / m₀(τ) — values in [-1, 1] with built-in clarity.
/// Used as secondary confidence validation and fallback when YIN is uncertain.
use super::yin::{fft_autocorrelation, max_analysis_window, MAX_TAU};

fn next_pow2(n: usize) -> usize {
    let mut v = n.max(1) - 1;
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    v + 1
}

pub struct MpmDetector {
    pub sample_rate: f32,
    pub fmin: f32,
    pub fmax: f32,
    pub k_rel: f32, // typically 0.8-1.0
    max_tau: usize,
    min_tau: usize,
    nsdf: Vec<f32>,
    autocorr: Vec<f32>,
    scratch_re: Vec<f32>,
    scratch_im: Vec<f32>,

    pub frequency: f32,
    pub clarity: f32,
}

impl MpmDetector {
    pub fn new(sample_rate: f32, fmin: f32, fmax: f32) -> Self {
        let max_tau = (sample_rate / fmin) as usize + 1;
        let min_tau = (sample_rate / fmax) as usize;
        // Preallocate for the largest window this detector will ever see, so
        // detect() never allocates on the audio thread.
        let fft_size = next_pow2(max_analysis_window(sample_rate, fmin) * 2);
        Self {
            sample_rate,
            fmin,
            fmax,
            k_rel: 0.8,
            max_tau: max_tau.min(MAX_TAU),
            min_tau: min_tau.max(2),
            nsdf: vec![0.0; max_tau.min(MAX_TAU) + 1],
            autocorr: vec![0.0; fft_size],
            scratch_re: vec![0.0; fft_size],
            scratch_im: vec![0.0; fft_size],
            frequency: 0.0,
            clarity: 0.0,
        }
    }

    /// Run MPM on a windowed buffer. Returns (frequency, clarity).
    pub fn detect(&mut self, buffer: &[f32]) -> (f32, f32) {
        let len = buffer.len();
        if len < self.min_tau * 2 {
            self.frequency = 0.0;
            self.clarity = 0.0;
            return (0.0, 0.0);
        }

        // Compute autocorrelation via FFT into preallocated scratch. The
        // resize only fires for external buffers larger than the configured
        // range ever produces — never on the engine audio path.
        let fft_size = next_pow2(len * 2);
        if self.autocorr.len() < fft_size {
            self.autocorr.resize(fft_size, 0.0);
            self.scratch_re.resize(fft_size, 0.0);
            self.scratch_im.resize(fft_size, 0.0);
        }
        fft_autocorrelation(
            &buffer[..len],
            &mut self.autocorr,
            &mut self.scratch_re[..fft_size],
            &mut self.scratch_im[..fft_size],
        );

        // Move the autocorrelation out to satisfy the borrow checker without
        // allocating; put it back afterwards.
        let autocorr = std::mem::take(&mut self.autocorr);
        let result = self.detect_from_autocorr(buffer, &autocorr);
        self.autocorr = autocorr;
        result
    }

    /// MPM peak-picking on a precomputed autocorrelation of `buffer` (full
    /// length, zero-padded FFT form). Shared with the engine, which computes
    /// one autocorrelation per analysis window for both detectors.
    pub(crate) fn detect_from_autocorr(&mut self, buffer: &[f32], autocorr: &[f32]) -> (f32, f32) {
        let len = buffer.len();
        if len < self.min_tau * 2 {
            self.frequency = 0.0;
            self.clarity = 0.0;
            return (0.0, 0.0);
        }

        // Compute NSDF: 2r(τ) / m₀(τ)
        // m₀(τ) = cumulative energy normalization
        let max_tau = self.max_tau.min(len / 2);
        let r0 = autocorr[0]; // = sum of x² (total energy)

        for tau in 0..=max_tau {
            if tau >= self.nsdf.len() {
                break;
            }
            // More accurate: m₀(τ) = Σ(x_j² + x_{j+τ}²) for j=0..W-τ
            // Simplified: use 2*r(0) decaying linearly as the window empties
            let m0_approx = 2.0 * r0 * (1.0 - tau as f32 / len as f32).max(0.01);
            self.nsdf[tau] = if m0_approx > 1e-10 {
                2.0 * autocorr[tau] / m0_approx
            } else {
                0.0
            };
        }

        // Advance past the initial NSDF descent — the trivial lobe hanging
        // off τ=0. For any input whose period sits comfortably above min_tau
        // this lobe is a near-monotone descent whose noise ripples otherwise
        // win the first-above-threshold race and lock the detector to
        // min_tau (≈5 kHz). If instead the NSDF rises well above its
        // boundary value, min_tau sits inside a real lobe (period ≈
        // min_tau, top of the detector range) and no skip is needed.
        let mut start = self.min_tau;
        if self.nsdf[start] > 0.0 {
            let boundary = self.nsdf[start];
            let mut k = start + 1;
            let mut rose_above_ripple = false;
            while k <= max_tau && k < self.nsdf.len() && self.nsdf[k] > 0.0 {
                if self.nsdf[k] > boundary + 0.05 {
                    rose_above_ripple = true;
                    break;
                }
                k += 1;
            }
            if !rose_above_ripple {
                start = k; // first non-positive τ after the descent
            }
        }

        // Peak-picking (classic MPM): consider only interior local maxima of
        // the NSDF and select the first peak above k_rel * global_max.
        // A monotonic descent from min_tau (present for any periodic input,
        // windowed or not) must not count as a peak — otherwise the detector
        // locks to min_tau and reports sr/min_tau (≈5+ kHz) for every input.
        let mut global_max = 0.0_f32;
        for tau in start..=max_tau {
            if tau < self.nsdf.len() && self.nsdf[tau] > global_max {
                global_max = self.nsdf[tau];
            }
        }

        let threshold = self.k_rel * global_max;
        let mut best_tau = 0;
        let mut best_val = 0.0_f32;

        for tau in (start + 1)..max_tau {
            if tau + 1 >= self.nsdf.len() {
                break;
            }
            let val = self.nsdf[tau];
            let is_local_max = val > 0.0 && val >= self.nsdf[tau - 1] && val > self.nsdf[tau + 1];
            if !is_local_max {
                continue;
            }
            if val >= threshold {
                best_tau = tau;
                best_val = val;
                break;
            }
            if val > best_val {
                best_val = val;
                best_tau = tau;
            }
        }

        if best_tau == 0 {
            self.frequency = 0.0;
            self.clarity = 0.0;
            return (0.0, 0.0);
        }

        // Parabolic interpolation
        let k = best_tau;
        let y_m = if k > 0 {
            self.nsdf[k - 1]
        } else {
            self.nsdf[k]
        };
        let y0 = self.nsdf[k];
        let y_p = if k + 1 <= max_tau && k + 1 < self.nsdf.len() {
            self.nsdf[k + 1]
        } else {
            self.nsdf[k]
        };
        let denom = y_m - 2.0 * y0 + y_p;
        let delta = if denom.abs() > 1e-10 {
            ((y_m - y_p) / (2.0 * denom)).clamp(-0.5, 0.5)
        } else {
            0.0
        };

        let tau_refined = k as f32 + delta;
        self.frequency = self.sample_rate / tau_refined;
        self.clarity = best_val.clamp(0.0, 1.0);

        (self.frequency, self.clarity)
    }
}
