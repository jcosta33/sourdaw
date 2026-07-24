//! True-peak (inter-sample peak) reconstruction — ITU-R BS.1770-4, Annex 2.
//!
//! A signal whose samples all sit under a ceiling can still reconstruct above
//! it between samples; BS.1770 defines the true-peak level as the maximum of
//! the waveform reconstructed at **at least 4x** the base rate. This module
//! implements the standard's 4x over-sampling FIR as a 4-phase polyphase bank
//! (12 taps per phase), which is the interpolator the recommendation specifies
//! for the true-peak meter.
//!
//! Both the Proof limiter's detector and the dBTP meter run through this one
//! filter so the number the meter shows and the number the limiter enforces
//! come from the same reconstruction.
//!
//! Allocation-free and branch-light: fixed-size state, a 12-sample shift, and
//! 48 multiply-accumulates per sample per channel.

/// Taps per polyphase branch (BS.1770-4 Annex 2, Table 3).
pub const TAPS: usize = 12;
/// Over-sampling factor — the recommendation's minimum for true-peak.
pub const PHASES: usize = 4;

/// Polyphase branches of the BS.1770-4 4x over-sampling filter. Branch `p`
/// reconstructs the waveform at base-rate offset `p / 4`.
const PHASE_COEFFS: [[f32; TAPS]; PHASES] = [
    [
        0.001_708_984_375,
        0.010_986_328_125,
        -0.019_653_320_312_5,
        0.033_203_125,
        -0.059_448_242_187_5,
        0.137_329_101_562_5,
        0.972_167_968_75,
        -0.102_294_921_875,
        0.047_607_421_875,
        -0.026_611_328_125,
        0.014_892_578_125,
        -0.008_300_781_25,
    ],
    [
        -0.029_174_804_687_5,
        0.029_296_875,
        -0.051_757_812_5,
        0.089_111_328_125,
        -0.166_503_906_25,
        0.465_087_890_625,
        0.779_785_156_25,
        -0.200_317_382_812_5,
        0.101_562_5,
        -0.058_227_539_062_5,
        0.033_081_054_687_5,
        -0.018_920_898_437_5,
    ],
    [
        -0.018_920_898_437_5,
        0.033_081_054_687_5,
        -0.058_227_539_062_5,
        0.101_562_5,
        -0.200_317_382_812_5,
        0.779_785_156_25,
        0.465_087_890_625,
        -0.166_503_906_25,
        0.089_111_328_125,
        -0.051_757_812_5,
        0.029_296_875,
        -0.029_174_804_687_5,
    ],
    [
        -0.008_300_781_25,
        0.014_892_578_125,
        -0.026_611_328_125,
        0.047_607_421_875,
        -0.102_294_921_875,
        0.972_167_968_75,
        0.137_329_101_562_5,
        -0.059_448_242_187_5,
        0.033_203_125,
        -0.019_653_320_312_5,
        0.010_986_328_125,
        0.001_708_984_375,
    ],
];

/// Single-channel 4x true-peak reconstructor.
///
/// The filter is causal with roughly six base-rate samples of group delay: the
/// magnitude reported for input sample `n` describes the continuous waveform
/// around `n - 6`. Callers that use it for look-ahead limiting therefore spend
/// six samples of their look-ahead window on detection latency.
pub struct TruePeakUpsampler {
    /// `history[k]` holds `x[n - k]`.
    history: [f32; TAPS],
}

impl TruePeakUpsampler {
    pub const fn new() -> Self {
        Self {
            history: [0.0; TAPS],
        }
    }

    /// Push one base-rate sample and return the largest magnitude across the
    /// four reconstructed 4x-rate phases.
    #[inline]
    pub fn push_max_abs(&mut self, sample: f32) -> f32 {
        self.history.copy_within(0..TAPS - 1, 1);
        self.history[0] = sample;

        let mut peak = 0.0_f32;
        for phase in &PHASE_COEFFS {
            let mut accumulator = 0.0_f32;
            for (coefficient, delayed) in phase.iter().zip(self.history.iter()) {
                accumulator += coefficient * delayed;
            }
            let magnitude = accumulator.abs();
            if magnitude > peak {
                peak = magnitude;
            }
        }
        peak
    }

    pub fn reset(&mut self) {
        self.history = [0.0; TAPS];
    }
}

impl Default for TruePeakUpsampler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::TruePeakUpsampler;

    const SAMPLE_RATE: f32 = 48_000.0;

    fn tone(frequency: f32, amplitude: f32, phase: f32, samples: usize) -> Vec<f32> {
        (0..samples)
            .map(|n| {
                amplitude
                    * (2.0 * std::f32::consts::PI * frequency * n as f32 / SAMPLE_RATE + phase)
                        .sin()
            })
            .collect()
    }

    fn detected_peak(signal: &[f32]) -> f32 {
        let mut detector = TruePeakUpsampler::new();
        let mut peak = 0.0_f32;
        for &sample in signal {
            peak = peak.max(detector.push_max_abs(sample));
        }
        peak
    }

    /// The textbook inter-sample-peak signal: a full-scale sine at fs/4 offset
    /// 45 degrees puts every sample at +-0.7071 (-3.01 dBFS) while the
    /// continuous waveform still touches 1.0 (0 dBFS). Sample-peak detection
    /// reads -3 dB; a BS.1770 reconstruction must read ~0 dB.
    #[test]
    fn quarter_rate_sine_at_45_degrees_reconstructs_full_scale() {
        let signal = tone(12_000.0, 1.0, std::f32::consts::FRAC_PI_4, 2_000);

        let sample_peak = signal.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
        let true_peak = detected_peak(&signal);

        assert!(
            (0.706..=0.708).contains(&sample_peak),
            "sample peak of the fs/4 test tone must be 1/sqrt(2), got {sample_peak:.4}"
        );
        assert!(
            (0.99..=1.02).contains(&true_peak),
            "reconstructed peak must recover full scale, got {true_peak:.4} ({:+.2} dBTP)",
            20.0 * true_peak.log10()
        );
    }

    /// A 0 dBFS 1 kHz sine already peaks on a sample: the reconstruction must
    /// stay at unity rather than inventing resampling gain.
    #[test]
    fn full_scale_low_frequency_sine_stays_at_unity() {
        let true_peak = detected_peak(&tone(1_000.0, 1.0, 0.0, 4_800));

        assert!(
            (0.995..=1.01).contains(&true_peak),
            "1 kHz 0 dBFS sine must measure ~1.0, got {true_peak:.4}"
        );
    }

    /// Steady DC exercises the branch DC gains (1.0016 and 0.9730 by design);
    /// the reported magnitude tracks the input level, not a filter artefact.
    #[test]
    fn steady_dc_is_reported_at_its_own_level() {
        let mut detector = TruePeakUpsampler::new();
        let mut last = 0.0_f32;
        for _ in 0..64 {
            last = detector.push_max_abs(0.5);
        }

        assert!(
            (0.499..=0.502).contains(&last),
            "steady 0.5 DC must reconstruct at 0.5, got {last:.5}"
        );
    }

    #[test]
    fn silence_reconstructs_to_zero() {
        assert_eq!(detected_peak(&vec![0.0; 128]), 0.0);
    }

    #[test]
    fn reset_clears_the_reconstruction_history() {
        let mut detector = TruePeakUpsampler::new();
        for _ in 0..32 {
            detector.push_max_abs(1.0);
        }

        detector.reset();

        assert_eq!(detector.push_max_abs(0.0), 0.0);
    }
}
