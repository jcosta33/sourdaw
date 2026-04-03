//! ProofChain — reorderable mastering signal chain.
//!
//! Default order: EQ → Multiband Dynamics → Stereo Imager → Exciter → Limiter
//! Each stage has an inline MeterTap after it for signal visualization.

use super::dither::Ditherer;
use super::dynamic_eq::DynamicEq;
use super::eq::MasteringEq;
use super::exciter::HarmonicExciter;
use super::imager::StereoImager;
use super::limiter::LookaheadLimiter;
use super::linear_phase_eq::LinearPhaseEq;
use super::match_eq::MatchEq;
use super::metering::{
    IntegratedLufs, LoudnessRange, MeterTap, MomentaryLufs, ShortTermLufs, TruePeakDetector,
};
use super::multiband::MultibandDynamics;

/// Module identifier for the reorderable chain.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ModuleId {
    Eq = 0,
    Dynamics = 1,
    Imager = 2,
    Exciter = 3,
    Limiter = 4,
}

const NUM_MODULES: usize = 5;
// 6 taps: input + after each of the 5 modules
const NUM_TAPS: usize = NUM_MODULES + 1;

pub struct ProofChain {
    pub eq: MasteringEq,
    pub linear_eq: LinearPhaseEq,
    pub eq_linear_phase: bool,
    pub dynamic_eq: DynamicEq,
    pub match_eq: MatchEq,
    pub dynamics: MultibandDynamics,
    pub imager: StereoImager,
    pub exciter: HarmonicExciter,
    pub limiter: LookaheadLimiter,
    pub dither: Ditherer,

    /// Processing order (indices into the modules above).
    order: [ModuleId; NUM_MODULES],

    /// Inline metering taps: taps[0] = input, taps[1] = after first module, etc.
    taps: [MeterTap; NUM_TAPS],

    // Global metering
    pub input_lufs: MomentaryLufs,
    pub output_lufs: MomentaryLufs,
    pub output_st_lufs: ShortTermLufs,
    pub integrated_lufs: IntegratedLufs,
    pub true_peak: TruePeakDetector,
    pub lra: LoudnessRange,

    input_gain: f32,
    output_gain: f32,
    bypassed: bool,
    /// A/B comparison: when true, bypasses processing but applies gain offset
    /// so the dry signal matches the processed signal's loudness.
    ab_bypass: bool,
    ab_gain_offset: f32, // dB offset applied when in A (bypass) mode
}

impl ProofChain {
    pub fn new(sr: f64) -> Self {
        Self {
            eq: MasteringEq::new(sr),
            linear_eq: LinearPhaseEq::new(sr),
            eq_linear_phase: false,
            dynamic_eq: DynamicEq::new(sr),
            match_eq: MatchEq::new(),
            dynamics: MultibandDynamics::new(sr),
            imager: StereoImager::new(sr),
            exciter: HarmonicExciter::new(sr),
            limiter: LookaheadLimiter::new(sr as f32),
            dither: Ditherer::new(16),
            order: [
                ModuleId::Eq,
                ModuleId::Dynamics,
                ModuleId::Imager,
                ModuleId::Exciter,
                ModuleId::Limiter,
            ],
            taps: core::array::from_fn(|_| MeterTap::new(sr as f32)),
            input_lufs: MomentaryLufs::new(sr),
            output_lufs: MomentaryLufs::new(sr),
            output_st_lufs: ShortTermLufs::new(sr),
            integrated_lufs: IntegratedLufs::new(sr),
            true_peak: TruePeakDetector::new(),
            lra: LoudnessRange::new(sr),
            input_gain: 1.0,
            output_gain: 1.0,
            bypassed: false,
            ab_bypass: false,
            ab_gain_offset: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "bypass" => self.bypassed = value > 0.5,
            "ab_bypass" => self.ab_bypass = value > 0.5,
            "input_gain" => self.input_gain = 10.0_f32.powf(value / 20.0),
            "output_gain" => self.output_gain = 10.0_f32.powf(value / 20.0),
            _ => {}
        }

        // Route to submodules by prefix
        if name == "eq_linear_phase" {
            self.eq_linear_phase = value > 0.5;
            if self.eq_linear_phase {
                self.linear_eq.mark_dirty();
            }
            return;
        }
        if name.starts_with("eq_") {
            self.eq.set_param(name, value);
        } else if name.starts_with("dyneq_") {
            self.dynamic_eq.set_param(name, value);
        } else if name.starts_with("match_") {
            self.match_eq.set_param(name, value);
        } else if name.starts_with("dyn_") {
            self.dynamics.set_param(name, value);
        } else if name.starts_with("img_") {
            self.imager.set_param(name, value);
        } else if name.starts_with("exc_") {
            self.exciter.set_param(name, value);
        } else if name.starts_with("lim_") {
            self.limiter.set_param(name, value);
        } else if name.starts_with("dither_") {
            self.dither.set_param(name, value);
        }
    }

    /// Reorder modules. `new_order` contains ModuleId values in desired order.
    pub fn reorder(&mut self, new_order: [u8; NUM_MODULES]) {
        let mut seen = [false; NUM_MODULES];
        for &id in &new_order {
            if id as usize >= NUM_MODULES || seen[id as usize] {
                return;
            }
            seen[id as usize] = true;
        }

        for (i, &id) in new_order.iter().enumerate() {
            self.order[i] = match id {
                0 => ModuleId::Eq,
                1 => ModuleId::Dynamics,
                2 => ModuleId::Imager,
                3 => ModuleId::Exciter,
                4 => ModuleId::Limiter,
                _ => unreachable!(),
            };
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        // Input gain
        for i in 0..left.len() {
            left[i] *= self.input_gain;
            right[i] *= self.input_gain;
        }

        // Input metering
        for i in 0..left.len() {
            self.taps[0].process(left[i], right[i]);
            self.input_lufs.process_sample(left[i], right[i]);
        }

        // A/B comparison: auto gain-match the dry signal to the processed level
        if self.ab_bypass {
            let ab_gain = 10.0_f32.powf(self.ab_gain_offset / 20.0);
            for i in 0..left.len() {
                left[i] *= ab_gain;
                right[i] *= ab_gain;
                self.output_lufs.process_sample(left[i], right[i]);
                self.output_st_lufs.process_sample(left[i], right[i]);
                self.true_peak.process_sample(left[i], right[i]);
            }
            return;
        }

        if self.bypassed {
            for i in 0..left.len() {
                self.output_lufs.process_sample(left[i], right[i]);
                self.output_st_lufs.process_sample(left[i], right[i]);
                self.integrated_lufs.process_sample(left[i], right[i]);
                self.true_peak.process_sample(left[i], right[i]);
                self.lra.process_sample(left[i], right[i]);
            }
            return;
        }

        // Process modules in order
        for (slot, &module_id) in self.order.iter().enumerate() {
            match module_id {
                ModuleId::Eq => {
                    if self.eq_linear_phase {
                        self.linear_eq.process(left, right);
                    } else {
                        self.eq.process(left, right);
                    }
                    self.dynamic_eq.process(left, right);
                }
                ModuleId::Dynamics => self.dynamics.process(left, right),
                ModuleId::Imager => self.imager.process(left, right),
                ModuleId::Exciter => self.exciter.process(left, right),
                ModuleId::Limiter => self.limiter.process(left, right),
            }

            // Tap after this module
            let tap = &mut self.taps[slot + 1];
            for i in 0..left.len() {
                tap.process(left[i], right[i]);
            }
        }

        // Dither (always last, after limiter)
        self.dither.process(left, right);

        // Output gain
        for i in 0..left.len() {
            left[i] *= self.output_gain;
            right[i] *= self.output_gain;
        }

        // Output metering
        for i in 0..left.len() {
            self.output_lufs.process_sample(left[i], right[i]);
            self.output_st_lufs.process_sample(left[i], right[i]);
            self.integrated_lufs.process_sample(left[i], right[i]);
            self.true_peak.process_sample(left[i], right[i]);
            self.lra.process_sample(left[i], right[i]);
        }

        if !self.bypassed {
            let in_lufs = self.input_lufs.get_lufs();
            let out_lufs = self.output_lufs.get_lufs();
            if in_lufs > -100.0 && out_lufs > -100.0 {
                self.ab_gain_offset = out_lufs - in_lufs;
            }
        }
    }

    pub fn get_module_order(&self) -> [u8; NUM_MODULES] {
        self.order.map(|m| m as u8)
    }

    pub fn get_tap(&self, idx: usize) -> Option<&MeterTap> {
        self.taps.get(idx)
    }

    pub fn ab_gain_offset_db(&self) -> f32 {
        self.ab_gain_offset
    }

    pub fn latency_samples(&self) -> usize {
        self.limiter.latency_samples() + self.linear_eq.latency_samples()
    }
}
