//! Opto compressor topology — LA-2A / Shadow Hills style.
//!
//! T4 opto cell with program-dependent release and physical memory effect.
//! Feedback topology with soft, inherently program-dependent ratio.

use super::detector::{DetectionMode, StereoDetector};
use super::gain_computer::{auto_makeup, db_to_linear};
use crate::primitives::flush_denormal;

/// One side's opto cell. The CdS memory is per-channel because it *is* the
/// cell: two unlinked channels drive two physical cells with two charge
/// histories.
#[derive(Clone, Default)]
struct OptoChannel {
    gr_state: f32,
    /// CdS memory accumulator (0.0 – 1.0)
    memory_state: f32,
}

pub struct OptoCompressor {
    sample_rate: f32,
    threshold: f32,
    /// Fixed soft ratio that increases with excess (3:1 → ~10:1)
    base_ratio: f32,
    channel_l: OptoChannel,
    channel_r: OptoChannel,
    detector: StereoDetector,
    last_output_l: f32,
    last_output_r: f32,
    /// ~10ms fixed attack (EL panel rise time)
    tau_attack: f32,
    /// ~60ms fast release
    tau_release_fast: f32,
    /// ~200ms memory charge
    tau_memory_charge: f32,
    /// ~2s memory decay
    tau_memory_decay: f32,
    /// Compress vs Limit mode (LA-2A)
    limit_mode: bool,
}

impl OptoCompressor {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            threshold: -20.0,
            base_ratio: 3.0,
            channel_l: OptoChannel::default(),
            channel_r: OptoChannel::default(),
            detector: StereoDetector::new(sample_rate),
            last_output_l: 0.0,
            last_output_r: 0.0,
            tau_attack: 0.010,
            tau_release_fast: 0.060,
            tau_memory_charge: 0.200,
            tau_memory_decay: 2.0,
            limit_mode: false,
        }
    }

    pub fn get_threshold(&self) -> f32 {
        self.threshold
    }

    fn ratio_for_excess(&self, excess: f32) -> f32 {
        let max_ratio = if self.limit_mode {
            10.0
        } else {
            3.0 + self.base_ratio
        };
        self.base_ratio + (max_ratio - self.base_ratio) * (excess / 20.0).min(1.0)
    }

    pub fn auto_makeup_gain(&self) -> f32 {
        let excess = (0.0 - self.threshold).max(0.0);
        auto_makeup(self.threshold, self.ratio_for_excess(excess))
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "threshold" => self.threshold = value.clamp(-60.0, 0.0),
            "limit_mode" => self.limit_mode = value > 0.5,
            "peak_reduction" => {
                // LA-2A style: maps 0-100 to threshold range
                self.threshold = -(value.clamp(0.0, 100.0) * 0.5);
            }
            _ => {}
        }
    }

    pub fn set_detection(&mut self, mode: DetectionMode) {
        self.detector.set_mode(mode);
    }

    /// See `VcaCompressor::set_stereo_link` — the right cell is seeded from the
    /// left one on the way out of fully-linked so the two do not step apart.
    pub fn set_stereo_link(&mut self, link: f32) {
        if self.detector.is_fully_linked() && link < 1.0 {
            self.channel_r = self.channel_l.clone();
        }
        self.detector.set_link(link);
    }

    /// One cell's gain reduction, in positive dB. Returns the reduction rather
    /// than the applied gain so the caller keeps the sign convention.
    #[inline]
    fn channel_gr_db(&mut self, detect_db: f32, right_channel: bool) -> f32 {
        let excess = (detect_db - self.threshold).max(0.0);

        // Program-dependent ratio: increases with excess
        let effective_ratio = self.ratio_for_excess(excess);
        let desired_gr_db = excess * (1.0 - 1.0 / effective_ratio);

        let sample_rate = self.sample_rate;
        let tau_attack = self.tau_attack;
        let tau_release_fast = self.tau_release_fast;
        let tau_memory_charge = self.tau_memory_charge;
        let tau_memory_decay = self.tau_memory_decay;
        let channel = if right_channel {
            &mut self.channel_r
        } else {
            &mut self.channel_l
        };

        // Update memory state (CdS charge trapping)
        if desired_gr_db > 0.5 {
            let charge_alpha = 1.0 - (-1.0 / (tau_memory_charge * sample_rate)).exp();
            channel.memory_state += charge_alpha * (1.0 - channel.memory_state);
        } else {
            let decay_alpha = 1.0 - (-1.0 / (tau_memory_decay * sample_rate)).exp();
            channel.memory_state =
                flush_denormal(channel.memory_state - decay_alpha * channel.memory_state);
        }

        // Release time stretches with memory
        let tau_release = tau_release_fast + (5.0 - tau_release_fast) * channel.memory_state;

        // Ballistics
        let alpha = if desired_gr_db > channel.gr_state {
            1.0 - (-1.0 / (tau_attack * sample_rate)).exp()
        } else {
            1.0 - (-1.0 / (tau_release * sample_rate)).exp()
        };

        channel.gr_state =
            flush_denormal(channel.gr_state + alpha * (desired_gr_db - channel.gr_state));
        channel.gr_state
    }

    pub(crate) fn detector_source(&self) -> (f32, f32) {
        (self.last_output_l, self.last_output_r)
    }

    #[inline]
    pub fn process_sample(&mut self, left: f32, right: f32) -> (f32, f32, f32) {
        let detector = self.detector_source();
        self.process_sample_with_detector(left, right, detector.0, detector.1)
    }

    #[inline]
    pub(crate) fn process_sample_with_detector(
        &mut self,
        left: f32,
        right: f32,
        detector_l: f32,
        detector_r: f32,
    ) -> (f32, f32, f32) {
        let (detect_l_db, detect_r_db) = self.detector.detect_db(detector_l, detector_r);

        let gr_l = self.channel_gr_db(detect_l_db, false);
        let gr_r = if self.detector.is_fully_linked() {
            gr_l
        } else {
            self.channel_gr_db(detect_r_db, true)
        };

        let out_l = left * db_to_linear(-gr_l);
        let out_r = right * db_to_linear(-gr_r);
        self.last_output_l = out_l;
        self.last_output_r = out_r;

        (out_l, out_r, -gr_l.max(gr_r))
    }

    pub fn reset(&mut self) {
        self.channel_l = OptoChannel::default();
        self.channel_r = OptoChannel::default();
        self.detector.reset();
        self.last_output_l = 0.0;
        self.last_output_r = 0.0;
    }
}
