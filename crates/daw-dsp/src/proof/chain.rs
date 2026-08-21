//! ProofChain — reorderable mastering signal chain.
//!
//! Default order: EQ → Multiband Dynamics → Stereo Imager → Exciter → Limiter
//! Each stage has an inline MeterTap after it for signal visualization.

use super::clamped_param;
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

/// Declared range of the chain's input and output trim, in dB. Mirrored at the
/// worklet wire boundary in `proofProcessor.ts`; held here as well so the
/// engine never trusts its caller to have checked.
pub(super) const MIN_CHAIN_GAIN_DB: f32 = -24.0;
pub(super) const MAX_CHAIN_GAIN_DB: f32 = 24.0;

/// Unity trim, in dB — the fallback for a value that is not finite.
pub(super) const DEFAULT_CHAIN_GAIN_DB: f32 = 0.0;

/// Linear gain for a dB trim, clamped to the declared range.
///
/// Unclamped, `10^(value / 20)` answers `inf` for any value past ~+38 dB, and
/// the poisoned gain then multiplies every later sample: one malformed control
/// message took the chain out permanently, since nothing recomputes the factor
/// until the next message arrives. [`clamped_param`] carries the NaN handling
/// this shares with the limiter's setters.
pub(super) fn gain_from_db(value: f32) -> f32 {
    let db = clamped_param(
        value,
        MIN_CHAIN_GAIN_DB,
        MAX_CHAIN_GAIN_DB,
        DEFAULT_CHAIN_GAIN_DB,
    );
    10.0_f32.powf(db / 20.0)
}

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

    /// Latch: set while the input loudness meter has already been cleared for
    /// the current run of non-finite input. See [`Self::meter_input_sample`].
    input_meter_cleared: bool,
    /// The same latch for the two output loudness meters.
    output_meter_cleared: bool,
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
            input_meter_cleared: false,
            output_meter_cleared: false,
        }
    }

    /// Feed one sample to the input loudness meter, clearing the meter instead
    /// when the sample is not finite.
    ///
    /// A sliding-window loudness meter carries a running sum of squares, so one
    /// non-finite sample parks it at NaN permanently: every later
    /// `sum_sq -= old*old` / `sum_sq += new*new` propagates the NaN, the window
    /// energy stays NaN, and `loudness_from_energy` answers the −100 LUFS
    /// silence floor forever. `ProofInstance::process` scrubs non-finite
    /// samples out of the *output buffer* after this chain has run, so it
    /// protects downstream audio and not these meters.
    ///
    /// `input_lufs`, `output_lufs` and `output_st_lufs` are read straight off
    /// this struct by the mastering panel and no caller resets them —
    /// `ProofInstance::reset_integrated` reaches `integrated_lufs`, `true_peak`
    /// and `lra`, which is why those three have a recovery path and these do
    /// not. The answer here is the same one `IntegratedLufs::reset` gives:
    /// clear the filter state, the ring buffer and the running sums, so the
    /// next valid block reads normally.
    ///
    /// **The latch is what makes it affordable on the audio thread.** Clearing
    /// is O(window) — the short-term meter's ring buffers are three seconds of
    /// `f64` per channel, over a megabyte at 48 kHz and four at 192 kHz — so
    /// clearing per non-finite sample would memset hundreds of megabytes for a
    /// single render quantum of NaN and miss the deadline outright. One clear
    /// per contiguous run of bad samples is all the recovery needs, because
    /// after the first the window is already zero. It allocates nothing and
    /// takes no lock either way.
    #[inline]
    fn meter_input_sample(&mut self, l: f32, r: f32) {
        if l.is_finite() && r.is_finite() {
            self.input_meter_cleared = false;
            self.input_lufs.process_sample(l, r);
        } else if !self.input_meter_cleared {
            self.input_meter_cleared = true;
            self.input_lufs.reset();
        }
    }

    /// The output twin of [`Self::meter_input_sample`], covering the momentary
    /// and short-term meters the panel reads after processing.
    #[inline]
    fn meter_output_sample(&mut self, l: f32, r: f32) {
        if l.is_finite() && r.is_finite() {
            self.output_meter_cleared = false;
            self.output_lufs.process_sample(l, r);
            self.output_st_lufs.process_sample(l, r);
        } else if !self.output_meter_cleared {
            self.output_meter_cleared = true;
            self.output_lufs.reset();
            self.output_st_lufs.reset();
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "bypass" => self.bypassed = value > 0.5,
            "ab_bypass" => self.ab_bypass = value > 0.5,
            "input_gain" => self.input_gain = gain_from_db(value),
            "output_gain" => self.output_gain = gain_from_db(value),
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
            self.meter_input_sample(left[i], right[i]);
        }

        // A/B comparison: auto gain-match the dry signal to the processed level
        if self.ab_bypass {
            let ab_gain = 10.0_f32.powf(self.ab_gain_offset / 20.0);
            for i in 0..left.len() {
                left[i] *= ab_gain;
                right[i] *= ab_gain;
                self.meter_output_sample(left[i], right[i]);
                self.true_peak.process_sample(left[i], right[i]);
            }
            return;
        }

        if self.bypassed {
            for i in 0..left.len() {
                self.meter_output_sample(left[i], right[i]);
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
                    // Fall back to the IIR EQ unless the FIR is designed
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
            self.meter_output_sample(left[i], right[i]);
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
mod gain_range_tests {
    //! `input_gain` and `output_gain` fed `10^(value / 20)` straight from the
    //! wire. Past roughly +38 dB that answers `inf`, and the factor is stored,
    //! not recomputed per block — so one malformed control message multiplied
    //! every subsequent sample by infinity for the life of the device, with no
    //! recovery short of another message. The worklet checks the range too;
    //! this is the engine declining to trust that it did.

    use super::{gain_from_db, ProofChain, MAX_CHAIN_GAIN_DB, MIN_CHAIN_GAIN_DB};

    const SR: f64 = 48_000.0;
    const INPUT_LEVEL: f32 = 0.25;

    fn linear(db: f32) -> f32 {
        10.0_f32.powf(db / 20.0)
    }

    /// A chain whose every processing stage is bypassed, so the only thing
    /// between input and output is the pair of trims under test.
    fn trim_only_chain() -> ProofChain {
        let mut chain = ProofChain::new(SR);
        for stage in [
            "eq_bypass",
            "dyneq_bypass",
            "dyn_bypass",
            "img_bypass",
            "exc_bypass",
            "lim_bypass",
        ] {
            chain.set_param(stage, 1.0);
        }
        chain
    }

    fn render_one_block(chain: &mut ProofChain) -> f32 {
        let mut left = [INPUT_LEVEL; 8];
        let mut right = [INPUT_LEVEL; 8];
        chain.process(&mut left, &mut right);
        left[0]
    }

    #[test]
    fn an_overflowing_trim_is_clamped_instead_of_reaching_the_signal_path_as_infinity() {
        for name in ["input_gain", "output_gain"] {
            let mut chain = trim_only_chain();
            chain.set_param(name, f32::MAX);
            let out = render_one_block(&mut chain);

            assert!(
                out.is_finite(),
                "{name} = f32::MAX reached the signal path as {out}; \
                 10^(f32::MAX / 20) is inf and the factor is stored, so one \
                 malformed message poisons the device permanently"
            );
            let expected = INPUT_LEVEL * linear(MAX_CHAIN_GAIN_DB);
            assert!(
                (out - expected).abs() <= expected * 1e-4,
                "{name} = f32::MAX must apply the top of the declared range \
                 ({MAX_CHAIN_GAIN_DB} dB, {expected:.6}), got {out:.6}"
            );
        }
    }

    #[test]
    fn an_underflowing_trim_is_clamped_to_the_bottom_of_the_declared_range() {
        for name in ["input_gain", "output_gain"] {
            let mut chain = trim_only_chain();
            chain.set_param(name, -f32::MAX);
            let out = render_one_block(&mut chain);

            let expected = INPUT_LEVEL * linear(MIN_CHAIN_GAIN_DB);
            assert!(
                (out - expected).abs() <= expected * 1e-4,
                "{name} = -f32::MAX must apply the bottom of the declared range \
                 ({MIN_CHAIN_GAIN_DB} dB, {expected:.6}), got {out:.6}"
            );
        }
    }

    #[test]
    fn a_non_finite_trim_leaves_the_gain_at_unity() {
        // `f32::clamp` answers NaN for a NaN input, so clamping alone would
        // still hand `powf` a NaN and silence the device permanently.
        for name in ["input_gain", "output_gain"] {
            let mut chain = trim_only_chain();
            chain.set_param(name, f32::NAN);
            let out = render_one_block(&mut chain);

            assert!(
                (out - INPUT_LEVEL).abs() <= INPUT_LEVEL * 1e-6,
                "{name} = NaN must leave the trim at unity, got {out:?}"
            );
        }
    }

    #[test]
    fn an_in_range_trim_is_applied_unchanged() {
        // The counter-check: the clamp must not be swallowing ordinary values,
        // or the tests above would pass against a trim wired to a constant.
        for db in [-18.0_f32, -6.0, 0.0, 6.0, 18.0] {
            let mut chain = trim_only_chain();
            chain.set_param("input_gain", db);
            let out = render_one_block(&mut chain);

            let expected = INPUT_LEVEL * linear(db);
            assert!(
                (out - expected).abs() <= expected * 1e-5,
                "an in-range {db} dB trim must pass through exactly: \
                 expected {expected:.6}, got {out:.6}"
            );
            assert_eq!(gain_from_db(db), linear(db));
        }
    }
}

#[cfg(test)]
mod latency_contract_tests {
    //! Wave 3 feeds `ProofInstance::get_latency_samples()` into host
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
        // `rebuild` used to build its magnitude response, impulse
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
mod metering_nan_recovery_tests {
    //! The three loudness meters the mastering panel reads live on this struct:
    //! `input_lufs`, `output_lufs` and `output_st_lufs`. Each carries a running
    //! sum of squares over a sliding window, so one non-finite sample parks it
    //! at NaN permanently — the ring buffer overwrites the bad value but the
    //! sum never recovers, and the readout sits on the −100 LUFS silence floor
    //! for the rest of the session.
    //!
    //! Nothing resets them. `ProofInstance::reset_integrated` reaches
    //! `integrated_lufs`, `true_peak` and `lra`, which is why those three have
    //! a user-facing recovery path; these do not, and
    //! `ProofInstance::process` scrubs non-finite samples out of the output
    //! buffer only *after* this chain has already metered them.
    //!
    //! The oracle is a second chain fed the same audio without the NaN, so the
    //! assertion is "reads what it would have read anyway" rather than a
    //! hardcoded level that would also pass for a mis-calibrated meter.

    use super::ProofChain;

    const SR: f64 = 48_000.0;
    const BLOCK: usize = 128;
    /// Longer than the short-term meter's 3 s window, so by the end both
    /// chains' windows hold nothing but the tone.
    const SETTLE_SECONDS: usize = 4;

    fn tone(n: usize) -> f32 {
        (0.25 * (2.0 * core::f64::consts::PI * 1_000.0 * n as f64 / SR).sin()) as f32
    }

    /// Render `seconds` of 1 kHz tone through `chain`, optionally poisoning the
    /// very first sample of the very first block.
    fn render(chain: &mut ProofChain, seconds: usize, poison_first_sample: bool) {
        let blocks = seconds * SR as usize / BLOCK;
        for b in 0..blocks {
            let mut left = [0.0f32; BLOCK];
            let mut right = [0.0f32; BLOCK];
            for (i, (l, r)) in left.iter_mut().zip(right.iter_mut()).enumerate() {
                let s = tone(b * BLOCK + i);
                *l = s;
                *r = s;
            }
            if b == 0 && poison_first_sample {
                left[0] = f32::NAN;
                right[0] = f32::NAN;
            }
            chain.process(&mut left, &mut right);
        }
    }

    /// Bypassed, so the NaN reaches the output meters unchanged rather than
    /// being reshaped by the limiter on its way. The input meter is fed before
    /// the bypass branch either way, so one render covers all three.
    fn bypassed_chain() -> ProofChain {
        let mut chain = ProofChain::new(SR);
        chain.set_param("bypass", 1.0);
        chain
    }

    #[test]
    fn one_non_finite_sample_does_not_park_the_displayed_loudness_meters() {
        let mut poisoned = bypassed_chain();
        render(&mut poisoned, SETTLE_SECONDS, true);

        let mut clean = bypassed_chain();
        render(&mut clean, SETTLE_SECONDS, false);

        for (name, measured, expected) in [
            (
                "input_lufs",
                poisoned.input_lufs.get_lufs(),
                clean.input_lufs.get_lufs(),
            ),
            (
                "output_lufs",
                poisoned.output_lufs.get_lufs(),
                clean.output_lufs.get_lufs(),
            ),
            (
                "output_st_lufs",
                poisoned.output_st_lufs.get_lufs(),
                clean.output_st_lufs.get_lufs(),
            ),
        ] {
            assert!(
                expected > -100.0,
                "{name} on the unpoisoned chain reads {expected}, so this comparison \
                 cannot distinguish recovery from the silence floor"
            );
            assert!(
                measured > -100.0,
                "{name} is still parked on the silence floor {SETTLE_SECONDS} s after a \
                 single NaN sample — one poisoned sample has taken the meter out for \
                 the rest of the session"
            );
            assert!(
                (measured - expected).abs() < 0.1,
                "{name} reads {measured:.4} LUFS after recovering from one NaN sample \
                 against {expected:.4} LUFS on a chain that never saw it"
            );
        }
    }

    #[test]
    fn a_sustained_run_of_non_finite_samples_latches_and_then_releases() {
        // Recovery has to survive a *sustained* fault, not just an isolated
        // sample, and the latch that keeps the clear affordable has to release
        // again — a latch stuck set would leave the next poisoning event
        // unanswered, which is the failure mode the latch itself introduces.
        let mut chain = bypassed_chain();
        let mut left = [f32::NAN; BLOCK];
        let mut right = [f32::NAN; BLOCK];
        chain.process(&mut left, &mut right);
        assert!(
            chain.input_meter_cleared && chain.output_meter_cleared,
            "a block of non-finite samples must latch both meter groups, or the \
             clear is running once per sample"
        );

        render(&mut chain, SETTLE_SECONDS, false);
        assert!(
            !chain.input_meter_cleared && !chain.output_meter_cleared,
            "the latch must release on the first finite sample — held set, a second \
             poisoning event would never be cleared at all"
        );

        let mut clean = bypassed_chain();
        render(&mut clean, SETTLE_SECONDS, false);

        assert!(
            (chain.output_st_lufs.get_lufs() - clean.output_st_lufs.get_lufs()).abs() < 0.1,
            "short-term loudness reads {:.4} LUFS after a full block of NaN against \
             {:.4} LUFS on a chain that never saw one",
            chain.output_st_lufs.get_lufs(),
            clean.output_st_lufs.get_lufs()
        );
        assert!(
            (chain.output_lufs.get_lufs() - clean.output_lufs.get_lufs()).abs() < 0.1,
            "momentary loudness reads {:.4} LUFS after a full block of NaN against \
             {:.4} LUFS on a chain that never saw one",
            chain.output_lufs.get_lufs(),
            clean.output_lufs.get_lufs()
        );
    }
}

#[cfg(test)]
mod metering_rt_tests {
    //! An audit hedged this as "RT-unsafe *if* it ever fires inside
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
            //
            // This covers the ordinary path only: the block stores hold an
            // hour, so nothing here reaches capacity or takes the reservoir's
            // replacement branch. That path is guarded separately by
            // `metering::loudness_block_store_tests::sampling_past_capacity_does_not_allocate`,
            // which forces the store three hours past capacity rather than
            // waiting for wall-clock to get there.
            render_seconds(&mut chain, 30);
            let _ = chain.integrated_lufs.get_lufs();
            let _ = chain.lra.get_lra();
        });
    }
}
