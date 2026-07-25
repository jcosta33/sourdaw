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
                    // DSP-7: fall back to the IIR EQ unless the FIR is designed
                    // and filtering. `LinearPhaseEq::process` returns early
                    // while its FIR is undesigned, so routing to it
                    // unconditionally turned the mastering EQ into a dry
                    // passthrough -- and no caller has ever designed the FIR.
                    if self.linear_eq.is_active() {
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

    /// Pure delay this chain imposes, in samples, for host PDC.
    ///
    /// Reports delay-line latency only. The multiband crossovers, the imager
    /// and the exciter are IIR and smear an impulse by a few samples
    /// (measured: 4 at the shipped defaults), but that is frequency-dependent
    /// phase, not a constant delay a compensating buffer can undo, so it is
    /// deliberately excluded -- see `latency_contract_tests`, which measures
    /// against those stages bypassed for exactly this reason.
    pub fn latency_samples(&self) -> usize {
        self.limiter.latency_samples() + self.linear_eq.latency_samples()
    }
}


#[cfg(test)]
mod latency_contract_tests {
    //! DSP-7. Wave 3 feeds `ProofInstance::get_latency_samples()` into host
    //! plugin-delay compensation, so a reported number the signal path does not
    //! produce is a measurable timing error, not a cosmetic one. These tests
    //! measure the delay rather than reading the field back.
    //!
    //! Before the fix the chain reported **1264** samples while delaying by
    //! **240**: `LinearPhaseEq::latency_samples()` returned `HALF_FIR` whenever
    //! its `bypassed` flag was false, and nothing in the crate or the app ever
    //! sets that flag — nor ever designs the FIR, nor even sends
    //! `eq_linear_phase`. Every Proof instance therefore claimed 1024 samples
    //! (21.3 ms at 48 kHz) of delay it did not have.

    use super::super::biquad::BiquadCoeffs;
    use super::super::linear_phase_eq::LinearPhaseEqBand;
    use super::ProofChain;
    use assert_no_alloc::assert_no_alloc;

    const SR: f64 = 48_000.0;
    const BLOCK: usize = 128;
    /// Comfortably longer than the limiter look-ahead plus a full linear-phase
    /// FIR delay, so a wrong answer in either direction lands inside the window.
    const RENDER: usize = 8_192;

    /// The multiband crossovers, imager and exciter are IIR: they smear an
    /// impulse by a few samples (measured: 4 at the shipped defaults) as
    /// frequency-dependent phase, which no compensating delay buffer can undo
    /// and which `latency_samples()` therefore does not claim. Bypassing them
    /// leaves only the pure delay elements, so the assertion can be exact.
    fn bypass_all_iir_stages(chain: &mut ProofChain) {
        for param in ["dyn_bypass", "img_bypass", "exc_bypass", "dyneq_bypass"] {
            chain.set_param(param, 1.0);
        }
    }

    /// Push one impulse through the chain and return the sample index it peaks
    /// at. 0.5 sits under the −1 dBTP ceiling so the limiter delays it without
    /// reshaping it, and dither defaults to off.
    fn measured_pure_delay(chain: &mut ProofChain) -> usize {
        let mut out = Vec::with_capacity(RENDER);
        for block in 0..RENDER / BLOCK {
            let mut left = [0.0f32; BLOCK];
            let mut right = [0.0f32; BLOCK];
            if block == 0 {
                left[0] = 0.5;
                right[0] = 0.5;
            }
            chain.process(&mut left, &mut right);
            out.extend_from_slice(&left);
        }
        let mut peak_index = 0;
        let mut peak = 0.0f32;
        for (i, &s) in out.iter().enumerate() {
            if s.abs() > peak {
                peak = s.abs();
                peak_index = i;
            }
        }
        assert!(
            peak > 1e-6,
            "the impulse never reached the output (peak {peak:e}) — the probe measures nothing"
        );
        peak_index
    }

    #[test]
    fn reported_latency_matches_measured_pure_delay() {
        let mut chain = ProofChain::new(SR);
        bypass_all_iir_stages(&mut chain);
        let measured = measured_pure_delay(&mut chain);
        assert_eq!(
            chain.latency_samples(),
            measured,
            "Proof must not report latency the signal path does not impose \
             (pre-fix this read 1264 against a measured 240)"
        );
    }

    #[test]
    fn reported_latency_tracks_the_limiter_lookahead() {
        // Bidirectional: the number has to follow a real change in the path,
        // not be a constant that happens to line up once.
        let mut short_chain = ProofChain::new(SR);
        bypass_all_iir_stages(&mut short_chain);
        short_chain.set_param("lim_lookahead", 1.0);
        let short = measured_pure_delay(&mut short_chain);
        assert_eq!(short_chain.latency_samples(), short);

        let mut long_chain = ProofChain::new(SR);
        bypass_all_iir_stages(&mut long_chain);
        long_chain.set_param("lim_lookahead", 10.0);
        let long = measured_pure_delay(&mut long_chain);
        assert_eq!(long_chain.latency_samples(), long);

        assert!(
            long > short,
            "a 10 ms look-ahead ({long}) must delay more than a 1 ms one ({short})"
        );
    }

    fn flat_bands() -> Vec<LinearPhaseEqBand> {
        vec![LinearPhaseEqBand {
            enabled: true,
            coeffs: BiquadCoeffs::peak(1_000.0, 0.0, 1.0, SR),
        }]
    }

    #[test]
    fn a_designed_fir_reports_and_imposes_its_group_delay() {
        // The other half of the contract: once the FIR *is* in the path, the
        // reported number must grow by exactly the delay it adds. This is also
        // the only test that exercises `rebuild`, which has no production
        // caller.
        let mut chain = ProofChain::new(SR);
        bypass_all_iir_stages(&mut chain);
        let without_fir = measured_pure_delay(&mut chain);

        let mut chain = ProofChain::new(SR);
        bypass_all_iir_stages(&mut chain);
        chain.linear_eq.rebuild(&flat_bands());
        let with_fir = measured_pure_delay(&mut chain);

        assert_eq!(
            chain.latency_samples(),
            with_fir,
            "a designed FIR must report the delay it actually imposes"
        );
        assert_eq!(
            with_fir - without_fir,
            1_024,
            "a 2048-tap linear-phase FIR delays by half its length"
        );
    }

    #[test]
    fn enabling_linear_phase_never_silently_bypasses_the_eq() {
        // `LinearPhaseEq::process` returns early while its FIR is undesigned,
        // so routing to it unconditionally turned the mastering EQ into a dry
        // passthrough — with no caller anywhere that designs the FIR, that was
        // permanent. A +18 dB band must boost whichever EQ is in the path.
        let mut chain = ProofChain::new(SR);
        chain.set_param("eq_linear_phase", 1.0);
        chain.set_param("eq_band3_type", 0.0); // peak
        chain.set_param("eq_band3_freq", 1_000.0);
        chain.set_param("eq_band3_q", 1.0);
        chain.set_param("eq_band3_gain", 18.0);
        chain.set_param("eq_band3_enabled", 1.0);
        chain.set_param("lim_bypass", 1.0);
        bypass_all_iir_stages(&mut chain);

        let tone_hz = 1_000.0;
        let total = 16_384;
        let mut peak_in = 0.0f32;
        let mut peak_out = 0.0f32;
        let mut n = 0usize;
        while n < total {
            let mut left = [0.0f32; BLOCK];
            let mut right = [0.0f32; BLOCK];
            for i in 0..BLOCK {
                let s = 0.25
                    * (2.0 * core::f64::consts::PI * tone_hz * (n + i) as f64 / SR).sin() as f32;
                left[i] = s;
                right[i] = s;
            }
            // Ignore the first half while the coefficient ramp settles.
            if n >= total / 2 {
                for &s in left.iter() {
                    peak_in = peak_in.max(s.abs());
                }
            }
            chain.process(&mut left, &mut right);
            if n >= total / 2 {
                for &s in left.iter() {
                    peak_out = peak_out.max(s.abs());
                }
            }
            n += BLOCK;
        }
        let gain_db = 20.0 * (peak_out / peak_in).log10();
        assert!(
            gain_db > 12.0,
            "a +18 dB band realized {gain_db:.2} dB with linear phase requested; \
             a dry passthrough reads 0.00 dB, which is what shipped"
        );
    }

    #[test]
    fn fir_redesign_does_not_allocate() {
        // DSP-7 as filed. `rebuild` built its magnitude response, impulse
        // response and both tap arrays with `vec![]` / `.collect()` on every
        // call; the scratch is preallocated now. The redesign is still far too
        // expensive to sit on the audio thread — see `rebuild`'s own docs — but
        // it no longer allocates when it runs.
        let mut chain = ProofChain::new(SR);
        let bands = flat_bands();
        chain.linear_eq.rebuild(&bands); // warm: first call is the same path
        assert_no_alloc(|| {
            chain.linear_eq.rebuild(&bands);
        });
        assert!(
            chain.linear_eq.is_active(),
            "a designed FIR must report itself as filtering"
        );
    }
}

#[cfg(test)]
mod metering_rt_tests {
    //! WB-7. The audit hedged "RT-unsafe *if* it ever fires inside
    //! `process()`". It does: the loudness meters push one entry per 100 ms
    //! into unbounded `Vec`s from `process_sample`, and `proofProcessor.ts`
    //! polls `get_integrated_lufs()` / `get_lra()` from inside `process()`
    //! every 8 render quanta, each of which collected and sorted
    //! session-length vectors.

    use super::ProofChain;
    use assert_no_alloc::assert_no_alloc;

    const SR: f64 = 48_000.0;
    const BLOCK: usize = 128;

    fn render_seconds(chain: &mut ProofChain, seconds: usize) {
        let blocks = seconds * SR as usize / BLOCK;
        for b in 0..blocks {
            let mut left = [0.0f32; BLOCK];
            let mut right = [0.0f32; BLOCK];
            for (i, (l, r)) in left.iter_mut().zip(right.iter_mut()).enumerate() {
                let n = (b * BLOCK + i) as f64;
                let s = 0.25 * (2.0 * core::f64::consts::PI * 440.0 * n / SR).sin();
                *l = s as f32;
                *r = s as f32;
            }
            chain.process(&mut left, &mut right);
        }
    }

    #[test]
    fn long_running_metering_does_not_allocate_on_the_audio_thread() {
        let mut chain = ProofChain::new(SR);
        // Warm past the first few 100 ms hop boundaries so nothing lazy is
        // left to initialize inside the guarded region.
        render_seconds(&mut chain, 1);

        assert_no_alloc(|| {
            // 30 s of audio crosses 300 hop boundaries in each meter, and the
            // getters are polled the way the worklet polls them.
            render_seconds(&mut chain, 30);
            let _ = chain.integrated_lufs.get_lufs();
            let _ = chain.lra.get_lra();
        });
    }
}
