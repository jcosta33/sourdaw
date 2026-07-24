//! Level detection — RMS and peak detectors for sidechain analysis.

use crate::primitives::flush_denormal;

/// One-pole IIR RMS estimator.
pub struct RmsDetector {
    rms_sq: f32,
    coeff: f32,
}

impl RmsDetector {
    pub fn new(sample_rate: f32, window_ms: f32) -> Self {
        let tau = window_ms * 0.001;
        Self {
            rms_sq: 0.0,
            coeff: (-1.0 / (tau * sample_rate)).exp(),
        }
    }

    pub fn set_window(&mut self, sample_rate: f32, window_ms: f32) {
        let tau = window_ms * 0.001;
        self.coeff = (-1.0 / (tau * sample_rate)).exp();
    }

    #[inline]
    pub fn process(&mut self, sample: f32) -> f32 {
        let x_sq = sample * sample;
        // DSP-2: the `1e-20` below is a log-domain guard on the *read*, not a
        // flush — `rms_sq` itself keeps decaying into subnormals on silence.
        self.rms_sq = flush_denormal(self.coeff * self.rms_sq + (1.0 - self.coeff) * x_sq);
        // 10 * log10(rms_sq) = 20 * log10(sqrt(rms_sq))
        if self.rms_sq > 1e-20 {
            10.0 * self.rms_sq.log10()
        } else {
            -100.0
        }
    }

    pub fn reset(&mut self) {
        self.rms_sq = 0.0;
    }
}

/// Instantaneous peak detector (absolute value).
pub struct PeakDetector;

impl PeakDetector {
    #[inline]
    pub fn detect(sample: f32) -> f32 {
        let abs = sample.abs();
        if abs > 1e-10 {
            20.0 * abs.log10()
        } else {
            -100.0
        }
    }
}

/// Detection mode selector.
#[derive(Clone, Copy, PartialEq)]
pub enum DetectionMode {
    Rms,
    Peak,
}
