/// YIN pitch detection (CMNDF) with FFT acceleration.
///
/// Difference function computed via autocorrelation:
///   d(τ) = S(0) + S(τ) - 2r(τ)
/// where r(τ) = autocorrelation via FFT.
///
/// Candidate selection uses harmonic-weighted scoring to suppress octave errors.
/// Sub-sample interpolation via parabolic fit around the best minimum.
use std::f32::consts::TAU;

/// Maximum analysis window / max tau.
pub const MAX_TAU: usize = 4096;
pub const MAX_FFT: usize = 8192;

/// Simple radix-2 FFT for autocorrelation.
fn fft_autocorrelation(input: &[f32], output: &mut [f32], n: usize) {
    // Zero-pad input to n, FFT, multiply by conjugate, iFFT
    let mut re = vec![0.0_f32; n];
    let mut im = vec![0.0_f32; n];
    re[..input.len().min(n)].copy_from_slice(&input[..input.len().min(n)]);

    fft_inplace(&mut re, &mut im, false);

    // Multiply by conjugate (power spectrum)
    for i in 0..n {
        let mag_sq = re[i] * re[i] + im[i] * im[i];
        re[i] = mag_sq;
        im[i] = 0.0;
    }

    fft_inplace(&mut re, &mut im, true);

    // Output is the autocorrelation
    let len = output.len().min(n);
    output[..len].copy_from_slice(&re[..len]);
}

pub fn fft_inplace(re: &mut [f32], im: &mut [f32], inverse: bool) {
    let n = re.len();
    if !n.is_power_of_two() || n < 2 {
        return;
    }

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
        let (cos_a, sin_a) = (angle.cos(), angle.sin());
        for k in (0..n).step_by(size) {
            let (mut w_re, mut w_im) = (1.0_f32, 0.0_f32);
            for jj in 0..half {
                let (i1, i2) = (k + jj, k + jj + half);
                let t_re = w_re * re[i2] - w_im * im[i2];
                let t_im = w_re * im[i2] + w_im * re[i2];
                re[i2] = re[i1] - t_re;
                im[i2] = im[i1] - t_im;
                re[i1] += t_re;
                im[i1] += t_im;
                let nw = (w_re * cos_a - w_im * sin_a, w_re * sin_a + w_im * cos_a);
                w_re = nw.0;
                w_im = nw.1;
            }
        }
        size *= 2;
    }

    if inverse {
        let s = 1.0 / n as f32;
        for i in 0..n {
            re[i] *= s;
            im[i] *= s;
        }
    }
}

fn next_pow2(n: usize) -> usize {
    let mut v = n.max(1) - 1;
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    v + 1
}

/// YIN pitch detector state.
pub struct YinDetector {
    pub sample_rate: f32,
    pub fmin: f32,
    pub fmax: f32,
    pub threshold: f32,
    pub win_size: usize,
    max_tau: usize,
    min_tau: usize,

    // Preallocated buffers
    diff: Vec<f32>,
    cmndf: Vec<f32>,
    autocorr: Vec<f32>,

    // Result
    pub frequency: f32,
    pub confidence: f32,
    pub period: f32,
}

impl YinDetector {
    pub fn new(sample_rate: f32, fmin: f32, fmax: f32) -> Self {
        let max_tau = (sample_rate / fmin) as usize + 1;
        let min_tau = (sample_rate / fmax) as usize;
        let win_size = max_tau.min(MAX_TAU);
        let fft_size = next_pow2(win_size * 2);

        Self {
            sample_rate,
            fmin,
            fmax,
            threshold: 0.1,
            win_size,
            max_tau: max_tau.min(MAX_TAU),
            min_tau: min_tau.max(2),
            diff: vec![0.0; max_tau.min(MAX_TAU) + 1],
            cmndf: vec![0.0; max_tau.min(MAX_TAU) + 1],
            autocorr: vec![0.0; fft_size],
            frequency: 0.0,
            confidence: 0.0,
            period: 0.0,
        }
    }

    /// Run YIN on an audio buffer. Returns (frequency, confidence).
    ///
    /// The buffer is used at full length: truncating to `win_size` (= max_tau)
    /// made the `len >= 2 * min_tau` check below unsatisfiable for any band
    /// narrower than an octave, and the `len / 2` clamp on max_tau silently
    /// raised the low-frequency floor.
    pub fn detect(&mut self, buffer: &[f32]) -> (f32, f32) {
        let len = buffer.len();
        if len < self.min_tau * 2 {
            self.frequency = 0.0;
            self.confidence = 0.0;
            return (0.0, 0.0);
        }

        // Compute autocorrelation via FFT
        let fft_size = next_pow2(len * 2);
        if self.autocorr.len() < fft_size {
            self.autocorr.resize(fft_size, 0.0);
        }
        fft_autocorrelation(&buffer[..len], &mut self.autocorr, fft_size);

        // Compute difference function: d(τ) = S(0) + S(τ) - 2r(τ)
        // S(τ) = Σ_{j=τ}^{len-1} x[j]² (energy of the shifted signal)
        let s0 = self.autocorr[0]; // = Σ x[j]²
        let max_tau = self.max_tau.min(len / 2);

        // S(τ) shrinks as samples leave the window; track it incrementally.
        let mut s_tau = s0;
        for tau in 0..=max_tau {
            if tau > 0 {
                s_tau -= buffer[tau - 1] * buffer[tau - 1];
            }
            if tau < self.diff.len() {
                let r_tau = if tau < self.autocorr.len() {
                    self.autocorr[tau]
                } else {
                    0.0
                };
                self.diff[tau] = s0 + s_tau - 2.0 * r_tau;
            }
        }

        // CMNDF
        self.cmndf[0] = 1.0;
        let mut running_sum = 0.0_f32;
        for tau in 1..=max_tau {
            if tau < self.diff.len() && tau < self.cmndf.len() {
                running_sum += self.diff[tau];
                self.cmndf[tau] = if running_sum > 0.0 {
                    self.diff[tau] * tau as f32 / running_sum
                } else {
                    1.0
                };
            }
        }

        // Find best candidate using harmonic-weighted scoring
        let mut best_tau = 0;
        let mut best_score = -1.0_f32;

        for tau in self.min_tau..=max_tau {
            if tau >= self.cmndf.len() {
                break;
            }

            // Check for local minimum
            if tau > 0 && tau < max_tau {
                let prev = if tau > 0 { self.cmndf[tau - 1] } else { 1.0 };
                let curr = self.cmndf[tau];
                let next = if tau + 1 < self.cmndf.len() {
                    self.cmndf[tau + 1]
                } else {
                    1.0
                };

                if curr <= prev && curr <= next && curr < self.threshold * 2.0 {
                    // Harmonic bias: prefer shorter periods (higher fundamentals)
                    let harmonic_weight = 1.0 / (1.0 + tau as f32 * 0.0005);
                    let score = (1.0 - curr) * harmonic_weight;

                    if score > best_score {
                        best_score = score;
                        best_tau = tau;
                    }
                }
            }
        }

        if best_tau == 0 || best_score < 0.0 {
            self.frequency = 0.0;
            self.confidence = 0.0;
            return (0.0, 0.0);
        }

        // Sub-sample interpolation (parabolic fit)
        let k = best_tau;
        let y_minus = if k > 0 && k - 1 < self.cmndf.len() {
            self.cmndf[k - 1]
        } else {
            self.cmndf[k]
        };
        let y0 = self.cmndf[k];
        let y_plus = if k + 1 < self.cmndf.len() {
            self.cmndf[k + 1]
        } else {
            self.cmndf[k]
        };

        let denom = y_minus - 2.0 * y0 + y_plus;
        let delta = if denom.abs() > 1e-10 {
            ((y_minus - y_plus) / (2.0 * denom)).clamp(-0.5, 0.5)
        } else {
            0.0
        };

        let tau_refined = k as f32 + delta;
        let freq = self.sample_rate / tau_refined;
        let conf = 1.0 - y0;

        self.frequency = freq;
        self.confidence = conf.clamp(0.0, 1.0);
        self.period = tau_refined;

        (self.frequency, self.confidence)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, sample_rate: f32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| (TAU * freq * i as f32 / sample_rate).sin())
            .collect()
    }

    /// Signal-in/signal-out: a pure sine across the guitar/bass fundamental
    /// range must be detected at the played frequency with usable confidence.
    fn assert_detects(freq: f32, sample_rate: f32) {
        let mut det = YinDetector::new(sample_rate, 40.0, 5000.0);
        let buf = sine(freq, sample_rate, 4096);
        let (f, c) = det.detect(&buf);
        assert!(f > 0.0, "YIN returned no pitch for {freq} Hz input");
        let err_cents = 1200.0 * (f / freq).log2().abs();
        assert!(
            err_cents < 30.0,
            "YIN {freq} Hz -> {f:.2} Hz ({err_cents:.1} cents off)"
        );
        assert!(c > 0.5, "YIN {freq} Hz confidence {c:.2}, expected > 0.5");
    }

    #[test]
    fn detects_guitar_and_bass_fundamentals() {
        for freq in [82.41, 110.0, 146.83, 196.0, 246.94, 329.63] {
            assert_detects(freq, 44100.0);
        }
    }

    #[test]
    fn detects_reference_pitches_at_48k() {
        for freq in [82.41, 440.0, 880.0] {
            assert_detects(freq, 48000.0);
        }
    }

    /// Narrow per-string band (as used by the poly tracker) must still detect.
    #[test]
    fn detects_within_narrow_string_band() {
        let target = 82.41_f32;
        let lo = target * 2.0_f32.powf(-2.0 / 12.0);
        let hi = target * 2.0_f32.powf(2.0 / 12.0);
        let mut det = YinDetector::new(44100.0, lo, hi);
        let buf = sine(target, 44100.0, 2048);
        let (f, c) = det.detect(&buf);
        assert!(
            f > 0.0,
            "YIN returned no pitch for {target} Hz in a ±2-semitone band"
        );
        let err_cents = 1200.0 * (f / target).log2().abs();
        assert!(
            err_cents < 30.0,
            "YIN {target} Hz -> {f:.2} Hz ({err_cents:.1} cents off)"
        );
        assert!(c > 0.4, "YIN {target} Hz confidence {c:.2}, expected > 0.4");
    }
}
