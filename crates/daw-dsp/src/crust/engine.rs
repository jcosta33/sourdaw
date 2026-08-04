//! Crust — Sourdaw's true-peak mastering limiter.
//!
//! ## Signal order, and why it is this order
//!
//! ```text
//! in ─ input gain ─ saturation ─ [M/S encode] ─ band split ─ per-band limiters ─ sum ─ [M/S decode]
//!    ─ dither ─ wideband true-peak safety stage ─ unity-gain trim ─ [delta listen] ─ out
//! ```
//!
//! * **Saturation before limiting.** A nonlinearity after the gain stage would
//!   push samples back over the ceiling the limiter had just enforced.
//! * **M/S limiting is decoded before the safety stage.** Mid and side each
//!   under the ceiling decode to `L = M + S` up to *twice* the ceiling, so the
//!   stage that carries the invariant has to run in L/R.
//! * **Multiband limiters are summed before the safety stage.** Independent
//!   bands each under the ceiling also sum above it.
//! * **Dither before the safety stage.** A dither LSB is far below any sane
//!   ceiling, but it is still added signal, and the stage that guarantees the
//!   ceiling should be the last thing that touches level.
//! * **Unity-gain trim last.** It only ever attenuates — it removes the input
//!   gain so a bypass A/B is level-fair — so it cannot breach anything.
//!
//! The ceiling invariant is carried by the final wideband stage in every mode.
//! See [`super::limiter`] for the standard followed (ITU-R BS.1770-4, Annex 2)
//! and for the argument that the gain reaches its target before the peak it is
//! reacting to leaves the delay line.

use super::bands::{MultibandSplitter, MAX_BANDS};
use super::limiter::{TruePeakLimiter, MAX_LOOKAHEAD_SAMPLES};
use super::params::{band_count_from_index, Algorithm, DitherKind, StereoMode};
use super::saturator::{SatAlgorithm, Saturator};
use crate::proof::biquad::{BiquadCoeffs, BiquadState};
use crate::proof::dither::Ditherer;
use crate::proof::metering::{IntegratedLufs, LoudnessRange, MomentaryLufs, ShortTermLufs};
use crate::proof::true_peak::TruePeakUpsampler;

/// Longest total delay the engine can impose: a band stage's look-ahead plus
/// the safety stage's.
const MAX_TOTAL_LATENCY: usize = MAX_LOOKAHEAD_SAMPLES * 2 + 8;

/// Largest block the engine buffers dry samples for. Matches the wasm
/// instance's own clamp, so `process_block` never needs to grow anything.
const MAX_BLOCK: usize = 4_096;

/// How much of the previous block's peak reading survives into the next one.
/// Without a decay the panel's level meters would latch at the loudest sample
/// of the session; without any hold they would flicker, since a render quantum
/// is 128 frames and the panel polls at frame rate.
const METER_DECAY: f32 = 0.85;

/// Look-ahead the final safety stage runs with, in samples.
///
/// Not the minimum the detector allows, and the difference matters. A gain
/// stage guarantees `|x[n] · g[n]| <= ceiling` in the *sample* domain, but the
/// BS.1770 reconstruction of the output mixes twelve consecutive `x · g`
/// products, and a gain that changes across those twelve taps reconstructs
/// slightly above what the detector sanctioned — measured at 0.06 dB on a
/// 5-band programme. Widening the window to span the filter's whole tap length
/// makes the applied gain bounded by the peak over every sample the
/// reconstruction can reach, which closes that gap without costing the ceiling
/// any headroom (a margin below the ceiling would have cost exactly the
/// loudness the user asked for).
fn safety_lookahead(true_peak: bool) -> usize {
    if true_peak {
        crate::proof::true_peak::TAPS + crate::crust::limiter::TRUE_PEAK_GROUP_DELAY
    } else {
        0
    }
}

/// Meter snapshot the worklet publishes into its telemetry slot.
#[derive(Clone, Copy)]
pub struct CrustMeters {
    pub gr_db: f32,
    pub input_db: f32,
    pub output_db: f32,
    pub lufs_integrated: f32,
    pub lufs_short_term: f32,
    pub lufs_momentary: f32,
    pub lra: f32,
    pub true_peak_max: f32,
    pub true_peak_exceeded: bool,
    pub latency: f32,
}

/// Detector-side high-pass. One second-order section per channel — enough to
/// stop a kick from steering the whole gain computer without audibly changing
/// what the detector hears above it.
struct SidechainHighpass {
    left: BiquadState,
    right: BiquadState,
    coefficients: BiquadCoeffs,
    enabled: bool,
}

impl SidechainHighpass {
    fn new(sample_rate: f64) -> Self {
        Self {
            left: BiquadState::new(),
            right: BiquadState::new(),
            coefficients: BiquadCoeffs::highpass(
                60.0,
                std::f64::consts::FRAC_1_SQRT_2,
                sample_rate,
            ),
            enabled: false,
        }
    }

    fn set_frequency(&mut self, frequency: f32, sample_rate: f64) {
        self.coefficients = BiquadCoeffs::highpass(
            f64::from(frequency.clamp(20.0, 200.0)),
            std::f64::consts::FRAC_1_SQRT_2,
            sample_rate,
        );
    }

    #[inline]
    fn process(&mut self, left: f32, right: f32) -> (f32, f32) {
        if !self.enabled {
            return (left, right);
        }
        (
            self.left.process(left, &self.coefficients),
            self.right.process(right, &self.coefficients),
        )
    }

    fn reset(&mut self) {
        self.left = BiquadState::new();
        self.right = BiquadState::new();
    }
}

/// Integer delay that aligns the untouched input with the processed output, so
/// delta listening subtracts two things that happened at the same moment.
struct DryDelay {
    left: Vec<f32>,
    right: Vec<f32>,
    write: usize,
}

impl DryDelay {
    fn new() -> Self {
        Self {
            left: vec![0.0; MAX_TOTAL_LATENCY + 1],
            right: vec![0.0; MAX_TOTAL_LATENCY + 1],
            write: 0,
        }
    }

    #[inline]
    fn push_read(&mut self, left: f32, right: f32, delay: usize) -> (f32, f32) {
        let capacity = self.left.len();
        self.left[self.write] = left;
        self.right[self.write] = right;
        let read = (self.write + capacity - delay.min(capacity - 1)) % capacity;
        let output = (self.left[read], self.right[read]);
        self.write = (self.write + 1) % capacity;
        output
    }

    fn reset(&mut self) {
        self.left.fill(0.0);
        self.right.fill(0.0);
        self.write = 0;
    }
}

pub struct CrustEngine {
    sample_rate: f32,

    // Stages
    saturator: Saturator,
    splitter: MultibandSplitter,
    band_limiters: Vec<TruePeakLimiter>,
    safety: TruePeakLimiter,
    sidechain: SidechainHighpass,
    ditherer: Ditherer,
    dry: DryDelay,
    band_scratch: [(f32, f32); MAX_BANDS],
    dry_scratch_left: Vec<f32>,
    dry_scratch_right: Vec<f32>,

    // Output metering
    output_true_peak_left: TruePeakUpsampler,
    output_true_peak_right: TruePeakUpsampler,
    momentary: MomentaryLufs,
    short_term: ShortTermLufs,
    integrated: IntegratedLufs,
    loudness_range: LoudnessRange,

    // Parameters
    bypassed: bool,
    input_gain_db: f32,
    input_gain: f32,
    ceiling_db: f32,
    algorithm: Algorithm,
    lookahead_ms: f32,
    attack_ms: f32,
    release_ms: f32,
    attack_auto: bool,
    release_auto: bool,
    link_transient: f32,
    link_release: f32,
    true_peak: bool,
    oversampling: usize,
    delta_listen: bool,
    unity_gain: bool,
    stereo_mode: StereoMode,
    crossover_low: f32,
    crossover_high: f32,
    dither_index: u32,
    output_bit_depth: u32,

    // Meters
    meter_input_peak: f32,
    meter_output_peak: f32,
    meter_gr_db: f32,
    meter_true_peak: f32,
}

impl CrustEngine {
    pub fn new(sample_rate: f32) -> Self {
        let rate = f64::from(sample_rate);
        let mut engine = Self {
            sample_rate,
            saturator: Saturator::new(),
            splitter: MultibandSplitter::new(rate),
            band_limiters: (0..MAX_BANDS)
                .map(|_| TruePeakLimiter::new(sample_rate))
                .collect(),
            safety: TruePeakLimiter::new(sample_rate),
            sidechain: SidechainHighpass::new(rate),
            ditherer: Ditherer::new(24),
            dry: DryDelay::new(),
            band_scratch: [(0.0, 0.0); MAX_BANDS],
            dry_scratch_left: vec![0.0; MAX_BLOCK],
            dry_scratch_right: vec![0.0; MAX_BLOCK],
            output_true_peak_left: TruePeakUpsampler::new(),
            output_true_peak_right: TruePeakUpsampler::new(),
            momentary: MomentaryLufs::new(rate),
            short_term: ShortTermLufs::new(rate),
            integrated: IntegratedLufs::new(rate),
            loudness_range: LoudnessRange::new(rate),
            bypassed: false,
            input_gain_db: 0.0,
            input_gain: 1.0,
            ceiling_db: -0.3,
            algorithm: Algorithm::Transparent,
            lookahead_ms: 2.0,
            attack_ms: 0.0,
            release_ms: 0.0,
            attack_auto: true,
            release_auto: true,
            link_transient: 1.0,
            link_release: 1.0,
            true_peak: true,
            oversampling: 4,
            delta_listen: false,
            unity_gain: false,
            stereo_mode: StereoMode::LeftRight,
            crossover_low: 80.0,
            crossover_high: 2_000.0,
            dither_index: 0,
            output_bit_depth: 24,
            meter_input_peak: 0.0,
            meter_output_peak: 0.0,
            meter_gr_db: 0.0,
            meter_true_peak: 0.0,
        };
        engine.splitter.set_crossovers(80.0, 2_000.0);
        engine.apply_geometry();
        engine
    }

    /// Push attack, release and link onto every gain stage.
    fn apply_envelope(&mut self) {
        let profile = self.algorithm.profile();

        let attack_ms = if self.attack_auto {
            profile.attack_ms
        } else {
            self.attack_ms
        };
        // The panel documents 0 as "auto" for both time controls, so a zero
        // release means the program-dependent branch rather than a 0 ms one,
        // which would be a gain step per sample and audible as distortion.
        let release_auto = self.release_auto || self.release_ms <= 0.0;
        let release_ms = if release_auto {
            profile.release_ms
        } else {
            self.release_ms
        };
        let link_transient = (self.link_transient * profile.link_scale).clamp(0.0, 1.0);
        let link_release = (self.link_release * profile.link_scale).clamp(0.0, 1.0);

        for limiter in &mut self.band_limiters {
            limiter.set_attack_ms(attack_ms);
            limiter.set_release_ms(release_ms);
            limiter.set_release_auto(release_auto);
            limiter.set_link(link_transient, link_release);
        }

        // The safety stage is not a musical stage: it exists to catch what the
        // band sum, the M/S decode and the dither add, so it holds the ceiling
        // with no attack at all and recovers fast enough to stay inaudible on
        // the rare sample it engages.
        self.safety.set_attack_ms(0.0);
        self.safety.set_release_ms(20.0);
        self.safety.set_release_auto(false);
        self.safety.set_link(1.0, 1.0);
    }

    /// Push ceiling, look-ahead and detection mode onto every gain stage.
    fn apply_geometry(&mut self) {
        for limiter in &mut self.band_limiters {
            limiter.set_true_peak(self.true_peak);
            limiter.set_ceiling_db(self.ceiling_db);
            limiter.set_lookahead_ms(self.lookahead_ms);
        }
        self.safety.set_true_peak(self.true_peak);
        self.safety.set_ceiling_db(self.ceiling_db);
        self.safety
            .set_lookahead_samples(safety_lookahead(self.true_peak));
        // The attack clamp is derived from the look-ahead, so a geometry change
        // has to re-derive it or a shortened window leaves a stale ramp budget.
        self.apply_envelope();
    }

    /// Total delay imposed on the audio path, in samples.
    ///
    /// Delay-line latency only, following the same contract as
    /// [`crate::proof::chain::ProofChain::latency_samples`]: the saturation
    /// stage's oversampling filters and the crossover biquads have group delay
    /// that this deliberately does not claim, because it is fractional and
    /// frequency-dependent and a host cannot compensate it with an integer
    /// delay.
    pub fn latency_samples(&self) -> usize {
        self.band_limiters[0].latency_samples() + self.safety.latency_samples()
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "bypass" => self.bypassed = value > 0.5,
            // Routed as a parameter rather than as its own message so the
            // panel's TP reset travels the same bridge every other Crust
            // control does. Clearing only the store would leave the engine's
            // held maximum in place, and the next meter tick would put the
            // indicator straight back.
            "reset_true_peak" if value > 0.5 => self.reset_true_peak(),
            "gain" => {
                self.input_gain_db = value.clamp(0.0, 24.0);
                self.input_gain = 10.0_f32.powf(self.input_gain_db / 20.0);
            }
            "ceiling" => {
                self.ceiling_db = value.clamp(-24.0, 0.0);
                self.apply_geometry();
            }
            "style" => {
                self.algorithm = Algorithm::from_style_index(value.max(0.0) as u32);
                self.apply_envelope();
            }
            "algorithm" => {
                self.algorithm = Algorithm::from_index(value.max(0.0) as u32);
                self.apply_envelope();
            }
            "lookahead" => {
                self.lookahead_ms = value.clamp(0.0, 10.0);
                self.apply_geometry();
            }
            "attack" => {
                self.attack_ms = value.clamp(0.0, 100.0);
                self.apply_envelope();
            }
            "release" => {
                self.release_ms = value.clamp(0.0, 1_000.0);
                self.apply_envelope();
            }
            "attack_auto" => {
                self.attack_auto = value > 0.5;
                self.apply_envelope();
            }
            "release_auto" => {
                self.release_auto = value > 0.5;
                self.apply_envelope();
            }
            "channel_link_transient" => {
                self.link_transient = (value * 0.01).clamp(0.0, 1.0);
                self.apply_envelope();
            }
            "channel_link_release" => {
                self.link_release = (value * 0.01).clamp(0.0, 1.0);
                self.apply_envelope();
            }
            "true_peak" => {
                self.true_peak = value > 0.5;
                self.apply_geometry();
            }
            "oversampling" => {
                self.oversampling = value.max(1.0) as usize;
                self.saturator.set_oversampling(self.oversampling);
            }
            "sat_enabled" => self.saturator.set_enabled(value > 0.5),
            "sat_algorithm" => self
                .saturator
                .set_algorithm(SatAlgorithm::from_index(value.max(0.0) as u32)),
            "sat_drive" => self.saturator.set_drive_db(value),
            "sat_mix" => self.saturator.set_mix(value * 0.01),
            "delta_listen" => self.delta_listen = value > 0.5,
            "unity_gain" => self.unity_gain = value > 0.5,
            "multi_band" => {
                self.splitter
                    .set_bands(band_count_from_index(value.max(0.0) as u32));
                for limiter in &mut self.band_limiters {
                    limiter.reset();
                }
            }
            "crossover1" => {
                self.crossover_low = value.clamp(20.0, 2_000.0);
                self.splitter
                    .set_crossovers(self.crossover_low, self.crossover_high);
            }
            "crossover2" => {
                self.crossover_high = value.clamp(200.0, 18_000.0);
                self.splitter
                    .set_crossovers(self.crossover_low, self.crossover_high);
            }
            "sc_hpf_enabled" => self.sidechain.enabled = value > 0.5,
            "sc_hpf_freq" => self
                .sidechain
                .set_frequency(value, f64::from(self.sample_rate)),
            "stereo_mode" => self.stereo_mode = StereoMode::from_index(value.max(0.0) as u32),
            "dither" => {
                self.dither_index = value.max(0.0) as u32;
                self.apply_dither();
            }
            "output_bit_depth" => {
                self.output_bit_depth = value.clamp(8.0, 32.0) as u32;
                self.apply_dither();
            }
            _ => {}
        }
    }

    fn apply_dither(&mut self) {
        let kind = DitherKind::from_index(self.dither_index);
        let bits =
            DitherKind::implied_bit_depth(self.dither_index).unwrap_or(self.output_bit_depth);
        self.ditherer.set_param("dither_bits", bits as f32);
        self.ditherer
            .set_param("dither_mode", kind.shared_mode_index());
    }

    pub fn reset(&mut self) {
        self.saturator.reset();
        for limiter in &mut self.band_limiters {
            limiter.reset();
        }
        self.safety.reset();
        self.sidechain.reset();
        self.dry.reset();
        self.output_true_peak_left.reset();
        self.output_true_peak_right.reset();
        // The two windowed loudness meters carry no `reset`, so they are
        // rebuilt. `reset` runs from control-rate paths (construction and a
        // device reset), never from `process_block`, so the allocation is not
        // on the audio thread.
        let rate = f64::from(self.sample_rate);
        self.momentary = MomentaryLufs::new(rate);
        self.short_term = ShortTermLufs::new(rate);
        self.integrated.reset();
        self.loudness_range.reset();
        self.meter_input_peak = 0.0;
        self.meter_output_peak = 0.0;
        self.meter_gr_db = 0.0;
        self.meter_true_peak = 0.0;
    }

    /// Clear the held true-peak maximum. The panel's TP readout has a reset
    /// button, and a held maximum that could not be cleared would report a
    /// long-gone overshoot for the rest of the session.
    pub fn reset_true_peak(&mut self) {
        self.meter_true_peak = 0.0;
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed {
            return;
        }

        let frames = left.len().min(right.len()).min(MAX_BLOCK);
        let latency = self.latency_samples();
        let bands = self.splitter.bands();
        let unity_trim = if self.unity_gain {
            1.0 / self.input_gain
        } else {
            1.0
        };
        // A shared sidechain filter fed five different band signals would be
        // one filter with five interleaved histories. The control belongs to
        // the wideband detector; in multiband modes the split already gives the
        // low band its own gain stage, which is what the filter was for.
        let sidechain_active = bands == 1;

        let mut input_peak = 0.0_f32;
        let mut output_peak = 0.0_f32;

        for frame in 0..frames {
            // Trap a non-finite sample at the door.
            //
            // This is the last device in a mastering chain, so a NaN reaching it
            // from anywhere upstream is on the master bus from here to the
            // speakers. Nothing downstream removes one.
            //
            // The ceiling does not catch it on its own, in either direction. A
            // NaN is invisible to the detector — `f32::max` and `>` both discard
            // it, so the gain computer sees roughly zero, applies unity, and the
            // delay line emits the NaN verbatim. An infinity is worse for being
            // arithmetically reasonable: `required_gain` computes
            // `ceiling / inf == 0.0`, and IEEE-754 makes `inf * 0.0` a NaN, so
            // the limiter manufactures one out of a sample it was asked to pull
            // down.
            //
            // Silenced rather than clamped to the ceiling: a non-finite sample
            // is not signal, and emitting the ceiling would invent full-scale
            // content where the upstream device produced garbage.
            let dry_left = if left[frame].is_finite() {
                left[frame]
            } else {
                0.0
            };
            let dry_right = if right[frame].is_finite() {
                right[frame]
            } else {
                0.0
            };
            input_peak = input_peak.max(dry_left.abs()).max(dry_right.abs());

            let (delayed_dry_left, delayed_dry_right) =
                self.dry.push_read(dry_left, dry_right, latency);
            self.dry_scratch_left[frame] = delayed_dry_left;
            self.dry_scratch_right[frame] = delayed_dry_right;

            let driven_left = dry_left * self.input_gain;
            let driven_right = dry_right * self.input_gain;
            let (saturated_left, saturated_right) =
                self.saturator.process_sample(driven_left, driven_right);

            let (stage_left, stage_right) = match self.stereo_mode {
                StereoMode::LeftRight => (saturated_left, saturated_right),
                StereoMode::MidSide => (
                    (saturated_left + saturated_right) * 0.5,
                    (saturated_left - saturated_right) * 0.5,
                ),
            };

            self.splitter
                .process(stage_left, stage_right, &mut self.band_scratch);

            let mut summed_left = 0.0_f32;
            let mut summed_right = 0.0_f32;
            for band in 0..bands {
                let (band_left, band_right) = self.band_scratch[band];
                let (detector_left, detector_right) = if sidechain_active {
                    self.sidechain.process(band_left, band_right)
                } else {
                    (band_left, band_right)
                };
                let (limited_left, limited_right) = self.band_limiters[band]
                    .process_sample_detected(band_left, band_right, detector_left, detector_right);
                summed_left += limited_left;
                summed_right += limited_right;
            }

            let (decoded_left, decoded_right) = match self.stereo_mode {
                StereoMode::LeftRight => (summed_left, summed_right),
                StereoMode::MidSide => (summed_left + summed_right, summed_left - summed_right),
            };

            left[frame] = decoded_left;
            right[frame] = decoded_right;
        }

        // The shared ditherer is a block stage; it still runs ahead of the
        // safety limiter in the chain.
        self.ditherer
            .process(&mut left[..frames], &mut right[..frames]);

        for frame in 0..frames {
            let (safe_left, safe_right) = self.safety.process_sample(left[frame], right[frame]);
            let mut out_left = safe_left * unity_trim;
            let mut out_right = safe_right * unity_trim;

            output_peak = output_peak.max(out_left.abs()).max(out_right.abs());

            let reconstructed = self
                .output_true_peak_left
                .push_max_abs(out_left)
                .max(self.output_true_peak_right.push_max_abs(out_right))
                .max(out_left.abs())
                .max(out_right.abs());
            if reconstructed > self.meter_true_peak {
                self.meter_true_peak = reconstructed;
            }

            self.momentary.process_sample(out_left, out_right);
            self.short_term.process_sample(out_left, out_right);
            self.integrated.process_sample(out_left, out_right);
            self.loudness_range.process_sample(out_left, out_right);

            // Delta listening is a monitoring mode, not a delivery mode: it
            // replaces the programme with exactly what the device removed, so
            // it deliberately does not respect the ceiling and is measured
            // after the meters above rather than before them.
            if self.delta_listen {
                out_left = self.dry_scratch_left[frame] - out_left;
                out_right = self.dry_scratch_right[frame] - out_right;
            }

            left[frame] = out_left;
            right[frame] = out_right;
        }

        let mut deepest_gain_reduction = 0.0_f32;
        for band in 0..bands {
            deepest_gain_reduction =
                deepest_gain_reduction.min(self.band_limiters[band].take_gr_db());
        }
        deepest_gain_reduction = deepest_gain_reduction.min(self.safety.take_gr_db());

        self.meter_gr_db = deepest_gain_reduction.min(self.meter_gr_db * METER_DECAY);
        self.meter_input_peak = input_peak.max(self.meter_input_peak * METER_DECAY);
        self.meter_output_peak = output_peak.max(self.meter_output_peak * METER_DECAY);
    }

    pub fn meters(&self) -> CrustMeters {
        let to_db = |linear: f32| {
            if linear > 1e-10 {
                20.0 * linear.log10()
            } else {
                -100.0
            }
        };
        let true_peak_db = to_db(self.meter_true_peak);
        CrustMeters {
            gr_db: self.meter_gr_db,
            input_db: to_db(self.meter_input_peak),
            output_db: to_db(self.meter_output_peak),
            lufs_integrated: self.integrated.get_lufs(),
            lufs_short_term: self.short_term.get_lufs(),
            lufs_momentary: self.momentary.get_lufs(),
            lra: self.loudness_range.get_lra(),
            true_peak_max: true_peak_db,
            true_peak_exceeded: true_peak_db > self.ceiling_db,
            latency: self.latency_samples() as f32,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::CrustEngine;
    use crate::proof::true_peak::TruePeakUpsampler;

    const SAMPLE_RATE: f32 = 48_000.0;

    /// Reconstructed inter-sample peak of a rendered stereo buffer, in linear
    /// units — the same BS.1770-4 measurement the limiter enforces against, so
    /// a ceiling assertion here is a claim about dBTP and not about samples.
    fn true_peak_of(left: &[f32], right: &[f32]) -> f32 {
        let mut upsampler_left = TruePeakUpsampler::new();
        let mut upsampler_right = TruePeakUpsampler::new();
        let mut peak = 0.0_f32;
        for (l, r) in left.iter().zip(right.iter()) {
            let reconstructed = upsampler_left
                .push_max_abs(*l)
                .max(upsampler_right.push_max_abs(*r))
                .max(l.abs())
                .max(r.abs());
            peak = peak.max(reconstructed);
        }
        peak
    }

    fn db(linear: f32) -> f32 {
        20.0 * linear.max(1e-9).log10()
    }

    /// Programme that clips hard without a limiter.
    ///
    /// Deliberately two regimes, because they fail differently. The second half
    /// is sustained material well over the ceiling, where the required gain
    /// barely moves — that half is satisfied by almost any gain computer. The
    /// first half is a *quiet* bed with isolated bursts, where the required gain
    /// sits at unity between bursts and has to arrive exactly when each burst
    /// leaves the delay line. A look-ahead window that is misaligned by even a
    /// few samples passes the burst through at full level here, and passes the
    /// sustained half regardless — which is why the sustained half alone is not
    /// a test of the ceiling.
    fn overdriven_programme(frames: usize) -> (Vec<f32>, Vec<f32>) {
        let mut left = Vec::with_capacity(frames);
        let mut right = Vec::with_capacity(frames);
        let sparse = frames / 2;
        for n in 0..frames {
            let phase = 2.0 * std::f32::consts::PI * 220.0 * n as f32 / SAMPLE_RATE;
            if n < sparse {
                let bed = 0.04 * phase.sin();
                let burst = if n % 2_400 < 12 { 3.0 } else { 0.0 };
                left.push(bed + burst);
                right.push(0.03 * (phase * 1.5).sin() - burst);
                continue;
            }
            let tone = 2.0 * phase.sin();
            let transient = if n % 4_800 < 24 { 3.5 } else { 0.0 };
            left.push(tone + transient);
            // A different partial on the right so channel linking has two
            // genuinely different detector signals to reconcile.
            right.push(1.8 * (phase * 1.5).sin() - transient);
        }
        (left, right)
    }

    fn render(engine: &mut CrustEngine, left: &[f32], right: &[f32]) -> (Vec<f32>, Vec<f32>) {
        let mut out_left = left.to_vec();
        let mut out_right = right.to_vec();
        for start in (0..out_left.len()).step_by(512) {
            let end = (start + 512).min(out_left.len());
            engine.process_block(&mut out_left[start..end], &mut out_right[start..end]);
        }
        (out_left, out_right)
    }

    // -----------------------------------------------------------------------
    // The ceiling
    // -----------------------------------------------------------------------

    /// The whole product claim: whatever goes in, nothing comes out above the
    /// ceiling. Asserted as a true-peak measurement, not a sample maximum,
    /// because the ceiling is advertised in dBTP.
    /// A non-finite sample from upstream must not reach the output.
    ///
    /// The ceiling does not catch this by itself. A NaN is invisible to the
    /// detector — `f32::max` and `>` both discard it — so the gain computer
    /// applies unity and the delay line emits it verbatim. An infinity is
    /// converted *into* a NaN by the limiter's own arithmetic:
    /// `required_gain` is `ceiling / inf == 0.0`, and `inf * 0.0` is NaN.
    ///
    /// This is the last device before the master output, so a NaN that survives
    /// here survives to the speakers.
    #[test]
    fn a_non_finite_sample_from_upstream_never_reaches_the_output() {
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut engine = CrustEngine::new(SAMPLE_RATE);
            let mut left = vec![0.05_f32; 256];
            let mut right = vec![0.05_f32; 256];
            left[64] = bad;
            right[64] = bad;

            // Long enough to push the bad sample out past the look-ahead delay.
            for _ in 0..8 {
                engine.process_block(&mut left, &mut right);
            }

            let escaped = left
                .iter()
                .chain(right.iter())
                .filter(|s| !s.is_finite())
                .count();
            assert_eq!(
                escaped, 0,
                "{bad} reached the output {escaped} times — the master bus carries it \
                 from here to the speakers, and nothing downstream removes it"
            );
        }
    }

    #[test]
    fn output_never_exceeds_the_ceiling_on_material_that_clips_without_it() {
        let (left, right) = overdriven_programme(48_000);

        for ceiling_db in [-0.1_f32, -0.3, -1.0, -3.0] {
            let mut engine = CrustEngine::new(SAMPLE_RATE);
            engine.set_param("ceiling", ceiling_db);
            engine.set_param("lookahead", 2.0);
            engine.set_param("true_peak", 1.0);
            engine.set_param("gain", 6.0);

            let (out_left, out_right) = render(&mut engine, &left, &right);
            let measured = db(true_peak_of(&out_left, &out_right));

            assert!(
                measured <= ceiling_db + 0.05,
                "ceiling {ceiling_db:.1} dBTP breached: output measured {measured:.3} dBTP"
            );
        }
    }

    /// The other half of that claim: the input really would have breached it,
    /// so the test above is measuring the limiter and not a quiet signal.
    #[test]
    fn the_same_programme_breaches_the_ceiling_when_the_device_is_bypassed() {
        let (left, right) = overdriven_programme(48_000);
        let mut engine = CrustEngine::new(SAMPLE_RATE);
        engine.set_param("ceiling", -0.3);
        engine.set_param("bypass", 1.0);

        let (out_left, out_right) = render(&mut engine, &left, &right);

        assert!(
            db(true_peak_of(&out_left, &out_right)) > 6.0,
            "the stimulus does not clip, so the ceiling guard proves nothing"
        );
    }

    /// The ceiling has to survive every routing mode, because M/S decode and a
    /// multiband sum can each put a signal back over a ceiling its own stage
    /// respected. This is what the final wideband stage is for.
    #[test]
    fn the_ceiling_holds_in_mid_side_and_multiband_modes() {
        let (left, right) = overdriven_programme(24_000);
        let ceiling_db = -1.0_f32;

        for (stereo_mode, multiband, label) in [
            (1.0_f32, 0.0_f32, "mid/side"),
            (0.0, 1.0, "3-band"),
            (0.0, 2.0, "5-band"),
            (1.0, 2.0, "mid/side 5-band"),
        ] {
            let mut engine = CrustEngine::new(SAMPLE_RATE);
            engine.set_param("ceiling", ceiling_db);
            engine.set_param("stereo_mode", stereo_mode);
            engine.set_param("multi_band", multiband);
            engine.set_param("lookahead", 3.0);

            let (out_left, out_right) = render(&mut engine, &left, &right);
            let measured = db(true_peak_of(&out_left, &out_right));

            assert!(
                measured <= ceiling_db + 0.05,
                "{label} breached {ceiling_db:.1} dBTP: measured {measured:.3} dBTP"
            );
        }
    }

    /// Saturation runs *before* the limiter precisely so that it cannot undo
    /// it. Drive it hard and the ceiling must still hold.
    #[test]
    fn saturation_cannot_push_the_output_back_over_the_ceiling() {
        let (left, right) = overdriven_programme(24_000);
        let ceiling_db = -0.3_f32;
        let mut engine = CrustEngine::new(SAMPLE_RATE);
        engine.set_param("ceiling", ceiling_db);
        engine.set_param("sat_enabled", 1.0);
        engine.set_param("sat_algorithm", 4.0); // fold — the least polite curve
        engine.set_param("sat_drive", 18.0);
        engine.set_param("sat_mix", 100.0);

        let (out_left, out_right) = render(&mut engine, &left, &right);
        let measured = db(true_peak_of(&out_left, &out_right));

        assert!(
            measured <= ceiling_db + 0.05,
            "saturation breached {ceiling_db:.1} dBTP: measured {measured:.3} dBTP"
        );
    }

    // -----------------------------------------------------------------------
    // True-peak detection
    // -----------------------------------------------------------------------

    /// The textbook inter-sample peak: a full-scale sine at fs/4 offset 45°
    /// puts every *sample* at ±0.7071 (−3.01 dBFS) while the reconstructed
    /// waveform still touches 0 dBFS. Against a −2.5 dBTP ceiling a sample-peak
    /// detector sees nothing to do and lets a 2.5 dB overshoot through; the
    /// BS.1770 detector has to catch it.
    #[test]
    fn true_peak_detection_catches_an_inter_sample_peak_a_sample_detector_misses() {
        let frames = 8_000;
        let ceiling_db = -2.5_f32;
        let signal: Vec<f32> = (0..frames)
            .map(|n| {
                let phase = 2.0 * std::f32::consts::PI * 12_000.0 * n as f32 / SAMPLE_RATE;
                (phase + std::f32::consts::FRAC_PI_4).sin()
            })
            .collect();

        let sample_peak = signal.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
        assert!(
            db(sample_peak) < ceiling_db,
            "stimulus must sit under the ceiling in the sample domain, measured {:.2} dBFS",
            db(sample_peak)
        );

        let mut sample_domain = CrustEngine::new(SAMPLE_RATE);
        sample_domain.set_param("ceiling", ceiling_db);
        sample_domain.set_param("true_peak", 0.0);
        sample_domain.set_param("lookahead", 2.0);
        let (naive_left, naive_right) = render(&mut sample_domain, &signal, &signal);
        let naive_db = db(true_peak_of(&naive_left, &naive_right));

        let mut true_peak = CrustEngine::new(SAMPLE_RATE);
        true_peak.set_param("ceiling", ceiling_db);
        true_peak.set_param("true_peak", 1.0);
        true_peak.set_param("lookahead", 2.0);
        let (limited_left, limited_right) = render(&mut true_peak, &signal, &signal);
        let limited_db = db(true_peak_of(&limited_left, &limited_right));

        assert!(
            naive_db > ceiling_db + 2.0,
            "sample-peak detection should have missed this by ~3 dB, measured {naive_db:.2} dBTP"
        );
        assert!(
            limited_db <= ceiling_db + 0.05,
            "true-peak detection let {limited_db:.3} dBTP through a {ceiling_db:.1} dBTP ceiling"
        );
    }

    // -----------------------------------------------------------------------
    // Latency
    // -----------------------------------------------------------------------

    /// An unreported look-ahead delay is its own defect: the host compensates
    /// by the number this returns, so it has to be the number the signal is
    /// actually delayed by. Measured as the position of an impulse small enough
    /// that no gain reduction moves it.
    #[test]
    fn reported_latency_equals_the_delay_the_signal_actually_takes() {
        for (lookahead_ms, true_peak) in [
            (0.0_f32, 1.0_f32),
            (0.5, 1.0),
            (2.0, 1.0),
            (10.0, 1.0),
            (0.0, 0.0),
            (2.0, 0.0),
        ] {
            let mut engine = CrustEngine::new(SAMPLE_RATE);
            engine.set_param("true_peak", true_peak);
            engine.set_param("lookahead", lookahead_ms);
            engine.set_param("ceiling", -0.3);

            let reported = engine.latency_samples();

            let frames = 4_096;
            let mut left = vec![0.0_f32; frames];
            let mut right = vec![0.0_f32; frames];
            left[0] = 0.25;
            right[0] = 0.25;
            let (out_left, _) = render(&mut engine, &left, &right);

            let delivered = out_left
                .iter()
                .position(|sample| sample.abs() > 1e-6)
                .unwrap_or(usize::MAX);

            assert_eq!(
                delivered, reported,
                "look-ahead {lookahead_ms} ms (true peak {true_peak}) reports {reported} \
                 samples of latency but delivers the impulse at {delivered}"
            );
            assert!(
                (out_left[delivered] - 0.25).abs() < 1e-4,
                "the probe impulse must pass unattenuated, got {}",
                out_left[delivered]
            );
        }
    }

    // -----------------------------------------------------------------------
    // Release
    // -----------------------------------------------------------------------

    /// Recovery time in samples for the gain to climb back to within 1 dB of
    /// unity after a single transient, read off a steady bed whose own level is
    /// well under the ceiling — so the bed's output *is* the applied gain.
    fn measured_recovery_samples(release_ms: f32) -> usize {
        const BED: f32 = 0.5;
        const IMPULSE_AT: usize = 4_000;

        let mut engine = CrustEngine::new(SAMPLE_RATE);
        engine.set_param("ceiling", -0.3);
        engine.set_param("lookahead", 1.0);
        engine.set_param("release_auto", 0.0);
        engine.set_param("release", release_ms);

        let frames = 200_000;
        let mut left = vec![BED; frames];
        let mut right = vec![BED; frames];
        left[IMPULSE_AT] = 6.0;
        right[IMPULSE_AT] = 6.0;

        let (out_left, _) = render(&mut engine, &left, &right);

        let latency = engine.latency_samples();
        let onset = IMPULSE_AT + latency;
        let recovered = 10.0_f32.powf(-1.0 / 20.0);
        for index in (onset + 1)..frames {
            if out_left[index] / BED >= recovered {
                return index - onset;
            }
        }
        frames
    }

    /// The release control has to mean its own units. A one-pole recovering
    /// from gain `g0` to within 1 dB of unity takes
    /// `tau * sr * ln((1 - g0) / (1 - 10^(-1/20)))` samples, so the two
    /// settings must land in that ratio — not merely "slower" and "faster".
    #[test]
    fn recovery_time_scales_with_the_release_parameter() {
        let fast = measured_recovery_samples(50.0);
        let slow = measured_recovery_samples(400.0);

        let ratio = slow as f32 / fast as f32;
        assert!(
            (7.2..=8.8).contains(&ratio),
            "400 ms took {slow} samples and 50 ms took {fast}: ratio {ratio:.2}, expected ~8"
        );

        // Absolute check as well, so both could not drift together: a 50 ms
        // one-pole from the ~0.16 gain a 6.0 impulse forces against a −0.3 dBTP
        // ceiling reaches −1 dB in roughly 2.0 time constants.
        let expected_fast = 0.050 * SAMPLE_RATE * ((1.0_f32 - 0.16) / (1.0 - 0.8913)).ln();
        assert!(
            (fast as f32 / expected_fast - 1.0).abs() < 0.15,
            "50 ms release recovered in {fast} samples, analytic prediction {expected_fast:.0}"
        );
    }

    /// A release setting the panel leaves at 0 must not become a 0 ms release —
    /// that is a per-sample gain step, which is distortion, not a fast limiter.
    #[test]
    fn a_zero_release_falls_back_to_the_program_dependent_branch() {
        let mut engine = CrustEngine::new(SAMPLE_RATE);
        engine.set_param("release_auto", 0.0);
        engine.set_param("release", 0.0);

        let recovery = {
            let mut probe = CrustEngine::new(SAMPLE_RATE);
            probe.set_param("release_auto", 0.0);
            probe.set_param("release", 0.0);
            probe.set_param("ceiling", -0.3);
            probe.set_param("lookahead", 1.0);
            let frames = 40_000;
            let mut left = vec![0.5_f32; frames];
            let mut right = vec![0.5_f32; frames];
            left[4_000] = 6.0;
            right[4_000] = 6.0;
            let (out, _) = render(&mut probe, &left, &right);
            let onset = 4_000 + probe.latency_samples();
            out[(onset + 1)..]
                .iter()
                .position(|sample| sample / 0.5 >= 0.8913)
                .unwrap_or(frames)
        };

        engine.set_param("release", 0.0);
        assert!(
            recovery > 480,
            "a 0 ms release recovered in {recovery} samples — that is a gain step, not a release"
        );
    }

    // -----------------------------------------------------------------------
    // Meters and modes
    // -----------------------------------------------------------------------

    /// The TP indicator earns its place in exactly the case the limiter cannot
    /// cover: with true-peak detection switched off, the inter-sample content
    /// the sample-domain detector never saw still shows up on the output meter.
    /// It must light, and the panel's reset must clear it.
    #[test]
    fn the_true_peak_meter_flags_the_overshoot_a_sample_domain_detector_leaves() {
        let frames = 4_096;
        let signal: Vec<f32> = (0..frames)
            .map(|n| {
                let phase = 2.0 * std::f32::consts::PI * 12_000.0 * n as f32 / SAMPLE_RATE;
                (phase + std::f32::consts::FRAC_PI_4).sin()
            })
            .collect();

        let mut engine = CrustEngine::new(SAMPLE_RATE);
        engine.set_param("ceiling", -2.5);
        engine.set_param("true_peak", 0.0);
        render(&mut engine, &signal, &signal);

        let flagged = engine.meters();
        assert!(flagged.true_peak_exceeded);
        assert!(
            flagged.true_peak_max > -2.5,
            "held true peak read {:.2} dBTP, which is not an overshoot",
            flagged.true_peak_max
        );

        engine.reset_true_peak();

        let cleared = engine.meters();
        assert!(!cleared.true_peak_exceeded);
        assert_eq!(cleared.true_peak_max, -100.0);
    }

    /// Delta listening must hand back what the device removed. With the device
    /// doing nothing, the difference is silence.
    #[test]
    fn delta_listen_returns_the_difference_and_not_the_programme() {
        let frames = 4_096;
        let signal: Vec<f32> = (0..frames)
            .map(|n| 0.2 * (2.0 * std::f32::consts::PI * 440.0 * n as f32 / SAMPLE_RATE).sin())
            .collect();

        let mut engine = CrustEngine::new(SAMPLE_RATE);
        engine.set_param("ceiling", -0.3);
        engine.set_param("delta_listen", 1.0);

        let (out_left, _) = render(&mut engine, &signal, &signal);
        let settled = out_left[2_048..]
            .iter()
            .fold(0.0_f32, |a, s| a.max(s.abs()));

        assert!(
            settled < 1e-4,
            "an idle limiter removed nothing, so delta must be silent; measured {settled:.5}"
        );
    }

    /// Unity gain exists so a bypass comparison is level-fair: it must remove
    /// exactly the input gain, not approximately.
    #[test]
    fn unity_gain_removes_the_input_gain_it_was_given() {
        let frames = 2_048;
        let signal: Vec<f32> = (0..frames)
            .map(|n| 0.05 * (2.0 * std::f32::consts::PI * 440.0 * n as f32 / SAMPLE_RATE).sin())
            .collect();

        let mut engine = CrustEngine::new(SAMPLE_RATE);
        engine.set_param("gain", 12.0);
        engine.set_param("unity_gain", 1.0);
        let (trimmed, _) = render(&mut engine, &signal, &signal);

        let mut reference = CrustEngine::new(SAMPLE_RATE);
        let (untouched, _) = render(&mut reference, &signal, &signal);

        let trimmed_peak = trimmed[1_024..].iter().fold(0.0_f32, |a, s| a.max(s.abs()));
        let reference_peak = untouched[1_024..]
            .iter()
            .fold(0.0_f32, |a, s| a.max(s.abs()));

        assert!(
            (db(trimmed_peak) - db(reference_peak)).abs() < 0.05,
            "unity gain left {:.3} dB of the 12 dB push in place",
            db(trimmed_peak) - db(reference_peak)
        );
    }
}
