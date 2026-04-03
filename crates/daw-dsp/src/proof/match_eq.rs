//! Match EQ — analyze a reference track's spectrum and build a corrective FIR.
//!
//! Algorithm (per spec §2.4):
//! 1. Analyze reference: FFT overlapping frames → average power spectrum
//! 2. Analyze input: same process
//! 3. Difference curve = H_ref - H_input (in dB)
//! 4. Smooth with fractional-octave smoothing (1/3 octave)
//! 5. Clamp correction range (±12 dB)
//! 6. Build linear-phase FIR from correction curve
//! 7. Apply with amount control (0–100%)
//!
//! The analysis pass runs offline (on a provided buffer).
//! The correction FIR is applied in real-time.

use super::linear_phase_eq::LinearPhaseEq;
use core::f64::consts::PI;

const ANALYSIS_FFT_SIZE: usize = 8192;
const ANALYSIS_HOP: usize = ANALYSIS_FFT_SIZE / 2; // 50% overlap
const MAX_CORRECTION_DB: f32 = 12.0;

/// Average power spectrum (in dB) computed from audio.
pub struct SpectrumProfile {
    /// dB values per frequency bin (ANALYSIS_FFT_SIZE / 2 + 1 bins).
    pub bins: Vec<f32>,
    pub sample_rate: f64,
    pub fft_size: usize,
}

impl SpectrumProfile {
    /// Analyze a mono audio buffer and compute the average power spectrum.
    pub fn from_audio(samples: &[f32], sample_rate: f64) -> Self {
        let fft_size = ANALYSIS_FFT_SIZE;
        let num_bins = fft_size / 2 + 1;
        let mut avg_power = vec![0.0_f64; num_bins];
        let mut frame_count = 0usize;

        // Hann window
        let window: Vec<f64> = (0..fft_size)
            .map(|n| 0.5 * (1.0 - (2.0 * PI * n as f64 / (fft_size - 1) as f64).cos()))
            .collect();

        let mut pos = 0;
        while pos + fft_size <= samples.len() {
            // Window the frame
            let mut real = vec![0.0_f64; fft_size];
            for i in 0..fft_size {
                real[i] = samples[pos + i] as f64 * window[i];
            }

            // DFT (real-only, compute magnitude at each bin)
            // Using direct DFT for correctness (FFT crate not available in this no-std-like context)
            for k in 0..num_bins {
                let mut sum_re = 0.0_f64;
                let mut sum_im = 0.0_f64;
                for n in 0..fft_size {
                    let angle = -2.0 * PI * k as f64 * n as f64 / fft_size as f64;
                    sum_re += real[n] * angle.cos();
                    sum_im += real[n] * angle.sin();
                }
                let power = sum_re * sum_re + sum_im * sum_im;
                avg_power[k] += power;
            }

            frame_count += 1;
            pos += ANALYSIS_HOP;
        }

        // Average and convert to dB
        let bins = avg_power
            .iter()
            .map(|&p| {
                let avg = if frame_count > 0 {
                    p / frame_count as f64
                } else {
                    1e-20
                };
                (10.0 * avg.max(1e-20).log10()) as f32
            })
            .collect();

        Self {
            bins,
            sample_rate,
            fft_size,
        }
    }
}

/// Compute the correction curve (difference) between reference and input spectra.
pub fn compute_correction(
    reference: &SpectrumProfile,
    input: &SpectrumProfile,
    smoothing_octaves: f32,
    max_correction_db: f32,
    amount: f32, // 0.0 – 1.0
) -> Vec<f32> {
    let num_bins = reference.bins.len().min(input.bins.len());
    let sr = reference.sample_rate;
    let fft_size = reference.fft_size;

    // Raw difference
    let mut diff: Vec<f32> = (0..num_bins)
        .map(|k| reference.bins[k] - input.bins[k])
        .collect();

    // Fractional-octave smoothing
    if smoothing_octaves > 0.0 {
        diff = smooth_spectrum_fractional_octave(&diff, smoothing_octaves, sr, fft_size);
    }

    // Clamp and apply amount
    diff.iter_mut().for_each(|d| {
        *d = d.clamp(-max_correction_db, max_correction_db) * amount;
    });

    diff
}

/// Smooth a spectrum using fractional-octave averaging in log-frequency space.
fn smooth_spectrum_fractional_octave(
    spectrum_db: &[f32],
    fraction: f32,
    sample_rate: f64,
    fft_size: usize,
) -> Vec<f32> {
    let n_bins = spectrum_db.len();
    let mut smoothed = vec![0.0_f32; n_bins];

    for i in 1..n_bins {
        let freq = i as f64 * sample_rate / fft_size as f64;
        let oct_low = freq / 2.0_f64.powf(fraction as f64 / 2.0);
        let oct_high = freq * 2.0_f64.powf(fraction as f64 / 2.0);

        let bin_low = (oct_low * fft_size as f64 / sample_rate).round().max(1.0) as usize;
        let bin_high = (oct_high * fft_size as f64 / sample_rate)
            .round()
            .min((n_bins - 1) as f64) as usize;

        if bin_high <= bin_low {
            smoothed[i] = spectrum_db[i];
        } else {
            let sum: f32 = spectrum_db[bin_low..=bin_high].iter().sum();
            smoothed[i] = sum / (bin_high - bin_low + 1) as f32;
        }
    }
    smoothed[0] = spectrum_db[0];
    smoothed
}

/// Match EQ state — holds reference profile and correction curve.
pub struct MatchEq {
    reference_profile: Option<SpectrumProfile>,
    correction_curve: Vec<f32>,
    amount: f32,
    smoothing: f32, // 1/3 octave default
    max_correction: f32,
    enabled: bool,
}

impl MatchEq {
    pub fn new() -> Self {
        Self {
            reference_profile: None,
            correction_curve: Vec::new(),
            amount: 0.5,
            smoothing: 1.0 / 3.0,
            max_correction: MAX_CORRECTION_DB,
            enabled: false,
        }
    }

    /// Load a reference spectrum from pre-analyzed audio data.
    pub fn set_reference(&mut self, samples: &[f32], sample_rate: f64) {
        self.reference_profile = Some(SpectrumProfile::from_audio(samples, sample_rate));
    }

    /// Analyze the input and compute the correction curve.
    pub fn analyze_and_compute(&mut self, input_samples: &[f32], sample_rate: f64) {
        if let Some(ref reference) = self.reference_profile {
            let input = SpectrumProfile::from_audio(input_samples, sample_rate);
            self.correction_curve = compute_correction(
                reference,
                &input,
                self.smoothing,
                self.max_correction,
                self.amount,
            );
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "match_enabled" => self.enabled = value > 0.5,
            "match_amount" => self.amount = value.clamp(0.0, 1.5), // allow over-correction
            "match_smoothing" => self.smoothing = value.clamp(1.0 / 12.0, 1.0),
            "match_max_correction" => self.max_correction = value.clamp(3.0, 18.0),
            _ => {}
        }
    }

    pub fn has_reference(&self) -> bool {
        self.reference_profile.is_some()
    }
    pub fn is_enabled(&self) -> bool {
        self.enabled && !self.correction_curve.is_empty()
    }
    pub fn get_correction_curve(&self) -> &[f32] {
        &self.correction_curve
    }
}
