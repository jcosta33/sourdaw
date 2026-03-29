/// McLeod Pitch Method (MPM / NSDF) — cross-check and confidence.
///
/// NSDF(τ) = 2r(τ) / m₀(τ) — values in [-1, 1] with built-in clarity.
/// Used as secondary confidence validation and fallback when YIN is uncertain.

use crate::yin::fft_inplace;

fn next_pow2(n: usize) -> usize {
    let mut v = n.max(1) - 1;
    v |= v >> 1; v |= v >> 2; v |= v >> 4; v |= v >> 8; v |= v >> 16;
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

    pub frequency: f32,
    pub clarity: f32,
}

impl MpmDetector {
    pub fn new(sample_rate: f32, fmin: f32, fmax: f32) -> Self {
        let max_tau = (sample_rate / fmin) as usize + 1;
        let min_tau = (sample_rate / fmax) as usize;
        let fft_size = next_pow2(max_tau * 2);
        Self {
            sample_rate,
            fmin,
            fmax,
            k_rel: 0.8,
            max_tau: max_tau.min(4096),
            min_tau: min_tau.max(2),
            nsdf: vec![0.0; max_tau.min(4096) + 1],
            autocorr: vec![0.0; fft_size],
            frequency: 0.0,
            clarity: 0.0,
        }
    }

    /// Run MPM on a windowed buffer. Returns (frequency, clarity).
    pub fn detect(&mut self, buffer: &[f32]) -> (f32, f32) {
        let len = buffer.len();
        if len < self.min_tau * 2 {
            return (0.0, 0.0);
        }

        let fft_size = next_pow2(len * 2);
        if self.autocorr.len() < fft_size {
            self.autocorr.resize(fft_size, 0.0);
        }

        // Compute autocorrelation via FFT
        let mut re = vec![0.0_f32; fft_size];
        let mut im = vec![0.0_f32; fft_size];
        re[..len.min(fft_size)].copy_from_slice(&buffer[..len.min(fft_size)]);
        fft_inplace(&mut re, &mut im, false);
        for i in 0..fft_size {
            re[i] = re[i] * re[i] + im[i] * im[i];
            im[i] = 0.0;
        }
        fft_inplace(&mut re, &mut im, true);

        // Compute NSDF: 2r(τ) / m₀(τ)
        // m₀(τ) = cumulative energy normalization
        let max_tau = self.max_tau.min(len / 2);
        let r0 = re[0]; // = sum of x² (total energy)

        for tau in 0..=max_tau {
            if tau >= self.nsdf.len() { break; }
            let m0 = 2.0 * (r0 - re[tau].abs() * 0.001); // approximation
            // More accurate: m₀(τ) = Σ(x_j² + x_{j+τ}²) for j=0..W-τ
            // Simplified: use 2*r(0) as upper bound
            let m0_approx = 2.0 * r0 * (1.0 - tau as f32 / len as f32).max(0.01);
            self.nsdf[tau] = if m0_approx > 1e-10 {
                2.0 * re[tau] / m0_approx
            } else {
                0.0
            };
        }

        // Peak-picking: find key maxima between zero crossings
        // Select first peak above k_rel * global_max
        let mut global_max = 0.0_f32;
        for tau in self.min_tau..=max_tau {
            if tau < self.nsdf.len() && self.nsdf[tau] > global_max {
                global_max = self.nsdf[tau];
            }
        }

        let threshold = self.k_rel * global_max;
        let mut best_tau = 0;
        let mut best_val = 0.0_f32;
        let mut in_positive = false;

        for tau in self.min_tau..=max_tau {
            if tau >= self.nsdf.len() { break; }
            let val = self.nsdf[tau];

            if val > 0.0 && !in_positive {
                in_positive = true;
            }

            if in_positive && val < 0.0 {
                // Just crossed zero downward — check if we found a peak
                if best_val >= threshold {
                    break; // use this peak (first above threshold)
                }
                in_positive = false;
                best_val = 0.0;
                best_tau = 0;
            }

            if in_positive && val > best_val {
                best_val = val;
                best_tau = tau;
            }
        }

        // If we didn't find a peak above threshold, use global max
        if best_tau == 0 || best_val < threshold {
            for tau in self.min_tau..=max_tau {
                if tau < self.nsdf.len() && self.nsdf[tau] > best_val {
                    best_val = self.nsdf[tau];
                    best_tau = tau;
                }
            }
        }

        if best_tau == 0 {
            self.frequency = 0.0;
            self.clarity = 0.0;
            return (0.0, 0.0);
        }

        // Parabolic interpolation
        let k = best_tau;
        let y_m = if k > 0 { self.nsdf[k - 1] } else { self.nsdf[k] };
        let y0 = self.nsdf[k];
        let y_p = if k + 1 <= max_tau && k + 1 < self.nsdf.len() { self.nsdf[k + 1] } else { self.nsdf[k] };
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
