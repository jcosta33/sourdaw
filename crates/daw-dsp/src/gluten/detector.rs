//! Level detection — RMS and peak detectors for sidechain analysis.

use super::stereo::stereo_link;
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
        self.advance(sample);
        Self::mean_square_to_db(self.rms_sq)
    }

    /// Advance the integrator without paying for the logarithm.
    ///
    /// Split out from `process` so a caller that only needs the *louder* of two
    /// channels can compare mean squares — `log10` is monotonic, so the max of
    /// the two dB readings is the dB of the max of the two mean squares — and
    /// take a single logarithm instead of two.
    #[inline]
    pub fn advance(&mut self, sample: f32) {
        let x_sq = sample * sample;
        // DSP-2: the `1e-20` in `mean_square_to_db` is a log-domain guard on the
        // *read*, not a flush — `rms_sq` itself keeps decaying into subnormals
        // on silence.
        self.rms_sq = flush_denormal(self.coeff * self.rms_sq + (1.0 - self.coeff) * x_sq);
    }

    /// Current mean square (not yet a level).
    #[inline]
    pub fn mean_square(&self) -> f32 {
        self.rms_sq
    }

    #[inline]
    pub fn mean_square_to_db(mean_square: f32) -> f32 {
        // 10 * log10(rms_sq) = 20 * log10(sqrt(rms_sq))
        if mean_square > 1e-20 {
            10.0 * mean_square.log10()
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

/// Window the RMS detector integrates over, in milliseconds.
///
/// 10 ms is the window the engine was already constructing its (unused)
/// detectors with, and it is the usual bus-compressor figure: long enough that
/// a single sample cannot steer the gain computer, short enough that the RMS
/// reading still tracks a syllable.
pub const RMS_WINDOW_MS: f32 = 10.0;

/// The detector every topology shares: rectification mode plus stereo link,
/// resolved once so that the Detection and Link controls mean the same thing
/// whichever topology is active.
///
/// Emits a **pair** of levels because that is what stereo link is: at link 1
/// both channels see the louder one and the two sides move together; at link 0
/// each channel gets its own level and they breathe independently. Anything
/// between blends the two detector readings, which is where every mainstream
/// bus compressor puts the control (FabFilter Pro-C 2's Stereo Link, the
/// SSL-style Link switch) — the blend is on the *detector*, never on the
/// output.
pub struct StereoDetector {
    rms_left: RmsDetector,
    rms_right: RmsDetector,
    mode: DetectionMode,
    link: f32,
}

impl StereoDetector {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            rms_left: RmsDetector::new(sample_rate, RMS_WINDOW_MS),
            rms_right: RmsDetector::new(sample_rate, RMS_WINDOW_MS),
            mode: DetectionMode::Peak,
            link: 1.0,
        }
    }

    pub fn set_mode(&mut self, mode: DetectionMode) {
        self.mode = mode;
    }

    pub fn set_link(&mut self, link: f32) {
        self.link = link.clamp(0.0, 1.0);
    }

    /// True while both channels are guaranteed to read the same level, which
    /// lets a topology run one gain path instead of two. `stereo_link` returns
    /// the linked level *itself* at link 1 rather than a lerp that lands near
    /// it, so this is an exact claim, not an approximation.
    #[inline]
    pub fn is_fully_linked(&self) -> bool {
        self.link >= 1.0
    }

    /// Detection level per channel, in dB.
    ///
    /// Both RMS integrators are advanced on every call regardless of mode or
    /// link, so switching either control mid-programme picks up a settled
    /// envelope instead of one starting from silence.
    ///
    /// Fully linked is the shipped default and takes a single logarithm — the
    /// same count the hard-linked `max(|l|, |r|)` detection this replaced paid —
    /// so the default configuration costs what it always did. Only an unlinked
    /// detector pays for the second one.
    #[inline]
    pub fn detect_db(&mut self, left: f32, right: f32) -> (f32, f32) {
        self.rms_left.advance(left);
        self.rms_right.advance(right);

        if self.is_fully_linked() {
            let linked = match self.mode {
                DetectionMode::Rms => RmsDetector::mean_square_to_db(
                    self.rms_left
                        .mean_square()
                        .max(self.rms_right.mean_square()),
                ),
                DetectionMode::Peak => PeakDetector::detect(left.abs().max(right.abs())),
            };
            return (linked, linked);
        }

        let (raw_left, raw_right) = match self.mode {
            DetectionMode::Rms => (
                RmsDetector::mean_square_to_db(self.rms_left.mean_square()),
                RmsDetector::mean_square_to_db(self.rms_right.mean_square()),
            ),
            DetectionMode::Peak => (PeakDetector::detect(left), PeakDetector::detect(right)),
        };

        stereo_link(raw_left, raw_right, self.link)
    }

    pub fn reset(&mut self) {
        self.rms_left.reset();
        self.rms_right.reset();
    }
}
