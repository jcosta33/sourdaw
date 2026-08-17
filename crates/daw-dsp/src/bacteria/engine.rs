//! BacteriaEngine — top-level creative multi-effects orchestrator.
//!
//! Routes audio through: crossover → per-band effect chains → summing.
//! Handles multi-band splitting, serial/parallel/mid-side routing,
//! oversampling, modulation routing, macro mapping, and XY morphing.

use super::chorus::ChorusFlanger;
use super::chorus::Phaser;
use super::convolution::ConvolutionProcessor;
use super::crossover::CrossoverEngine;
use super::distortion::DistortionProcessor;
use super::filter::SvfFilter;
use super::granular::GranularProcessor;
use super::hilbert::HilbertShifter;
use super::lofi::LofiProcessor;
use super::modulation::{EnvelopeFollower, Lfo, LfoShape, LorenzAttractor};
use super::params::{db_to_linear, linear_to_db, SmoothedParam};
use super::stft::StftProcessor;
use super::waveshaper::CustomWaveshaper;
use crate::primitives::oversample::OversamplingChain;

const MAX_BANDS: usize = 6;
const MAX_MOD_ASSIGNMENTS: usize = 64;

/// Ceiling on stored macro mappings.
///
/// `add_macro_mapping` is a wasm export reached from the worklet — the audio
/// thread — and used to push onto an uncapped `Vec`. Every call past the
/// current capacity reallocated on that thread, and nothing ever removed an
/// entry, so a UI that re-sent its mapping table grew the per-sample
/// modulation pass without bound. Matched to [`MAX_MOD_ASSIGNMENTS`] because
/// the two tables are the same kind of thing and are walked by the same loop.
const MAX_MACRO_MAPPINGS: usize = 64;

/// Number of addressable modulation target slots.
///
/// `target_param` is a `u16` at the wasm boundary, so it spans far more than
/// this; ids at or above it are rejected by the setters rather than clamped,
/// since a clamp would silently retarget a mapping onto a parameter the caller
/// did not name.
const PARAM_OFFSET_COUNT: usize = 1024;

/// Distinct target slots the modulation pass can have to clear in one sample.
const MAX_MODULATED_TARGETS: usize = MAX_MOD_ASSIGNMENTS + MAX_MACRO_MAPPINGS;

/// Modulation sources the matrix can read from, and macro controls.
///
/// `source_id` and `macro_index` both arrive as `u8` from the wasm boundary,
/// which spans sixteen times the sources and thirty-two times the macros that
/// exist. Indexing either array with an unchecked one panics, and a panic in a
/// wasm build aborts — on the audio thread that is the AudioWorklet, so the
/// track goes silent and stays silent until the graph is rebuilt. The setters
/// reject out-of-range ids instead.
const MOD_SOURCE_COUNT: usize = 16;
const MACRO_COUNT: usize = 8;

/// Where the macros appear in `mod_values`, mirroring the source-id table
/// `BacteriaInstance::add_mod_assignment` documents.
const MACRO_SOURCE_BASE: usize = 6;

/// Centre position of a macro control.
const DEFAULT_MACRO: f32 = 0.5;

/// `mod_values` before a single sample has been processed.
///
/// The macros are copied into their source slots at control rate rather than
/// once per sample, so the resting state has to already agree with the resting
/// macro values or the first block reads a modulation depth of zero from
/// controls that are sitting at centre.
const MOD_VALUES_AT_REST: [f32; MOD_SOURCE_COUNT] = {
    let mut values = [0.0; MOD_SOURCE_COUNT];
    let mut index = 0;
    while index < MACRO_COUNT {
        values[MACRO_SOURCE_BASE + index] = DEFAULT_MACRO;
        index += 1;
    }
    values
};

/// Lowest and highest frequency a crossover corner may be placed at.
///
/// Mirrors the descriptor's declared 20 Hz–20 kHz range and the clamp
/// `CrossoverEngine::set_bands` applies on the way into the biquads, so the
/// stored corner and the running filter cannot disagree.
const MIN_CROSSOVER_HZ: f32 = 20.0;
const MAX_CROSSOVER_HZ: f32 = 20_000.0;

/// Ring size for the per-band alignment delay.
///
/// It has to cover the largest deficit any band can be asked to make up, which
/// is the whole latency of the slowest band measured against a band with none.
/// The oversampler contributes at most 11.375 base-rate samples (8x); Smudge's
/// overlap-add window contributes 2048 more at 1x, and less as the factor
/// divides it; the lo-fi codec's frame adds 256, and the spectral blur/freeze
/// window another 2048. 4363 is the worst case; 8192 is the next power of two,
/// so the wrap still compiles to a mask.
///
/// Heap-backed rather than a `[f32; ALIGNMENT_RING_LEN]` inside `BandChain`:
/// at this length the inline arrays would put ~400 kB of `BacteriaEngine`
/// through a by-value return on the worklet thread's stack. Sized once in
/// `new`, never resized, so changing the compensation still never allocates.
const ALIGNMENT_RING_LEN: usize = 8192;

/// Ring size for the dry mix tap.
///
/// The dry tap waits for the whole wet path, and under `Serial` routing that
/// path is every band's delay in succession rather than the longest one — up
/// to `MAX_BANDS` times a single band's worst case. 32768 is the next power of
/// two over 6 × 4363.
const DRY_ALIGNMENT_RING_LEN: usize = 32_768;

/// Whole-sample delay used to line one band's output up with the slowest one.
///
/// A whole-sample delay cannot change a signal's fractional delay, and the
/// oversampler latencies do not share one: 0 / 6.5 / 9.75 / 11.375 have
/// fractional parts .0 / .5 / .75 / .375. Those fractions survive any
/// compensation, so some residual skew is unavoidable without a fractional
/// interpolator on every band.
///
/// Round-to-nearest against one shared target leaves 0.75 of it — the plain
/// spread of those fractions. It is not the floor: the integer part of each
/// band is free, and pushing the 1x band a whole sample past the others
/// closes the widest cyclic gap between the fractions instead of the widest
/// linear one, reaching 0.625. Not taken. It buys a notch at 38 kHz over one
/// at 32 kHz, both already past Nyquist at 48 kHz, and it does it by holding
/// one band a full sample beyond the latency the host was told to expect.
///
/// Either way the residual is not the win: against the 11.375 samples it
/// removes, 0.75 moves the first cancellation notch from ~2.1 kHz — squarely
/// audible — to ~32 kHz.
struct AlignmentDelay {
    left: Vec<f32>,
    right: Vec<f32>,
    write: usize,
    /// `len - 1`. The length is per-instance — bands and the dry tap need
    /// different reaches — so the wrap is a stored mask rather than a `%`
    /// against a constant, which would otherwise become a real division.
    mask: usize,
    delay: usize,
}

impl AlignmentDelay {
    fn new(len: usize) -> Self {
        debug_assert!(len.is_power_of_two(), "the wrap below is a mask");
        Self {
            left: vec![0.0; len],
            right: vec![0.0; len],
            write: 0,
            mask: len - 1,
            delay: 0,
        }
    }

    /// Change the compensation, splicing rather than crossfading.
    ///
    /// A length change duplicates (growing) or drops (shrinking) up to
    /// `delay` samples at the seam. That is deliberate: the only parameters
    /// that move a band's delay are its factor, `distortionEnabled` and
    /// `bandCount`, and each already discards more state on the same call —
    /// a factor change rebuilds `OversamplingChain` from scratch, and
    /// `bandCount` resets every crossover biquad. Slewing the read pointer
    /// instead would spread the very misalignment this delay exists to remove
    /// across the whole ramp.
    ///
    /// The one seam that is new here is a *sibling* band's factor moving this
    /// band's target.
    ///
    /// **That seam used to be bounded at 11 samples — 0.24 ms — and is not any
    /// more.** Smudge contributes up to 2048 samples of window latency, so
    /// toggling it on one band can move a sibling's target by that much in a
    /// single step, and this splices rather than crossfades: ~43 ms of replayed
    /// or skipped audio, on a deliberate parameter change, once. Audible.
    ///
    /// Kept as a splice rather than fixed here because a crossfade is the wrong
    /// shape for it — ramping the delay spreads the very misalignment this
    /// exists to remove across the whole ramp, as the paragraph above says. What
    /// it actually wants is a short equal-power crossfade between two reads of
    /// the same ring at the old and new offsets, which is real work and is not
    /// this branch's subject. Recorded honestly rather than left reading as
    /// sub-millisecond.
    fn set_delay(&mut self, delay: usize) {
        self.delay = delay.min(self.mask);
    }

    /// Drop everything in flight.
    ///
    /// For a band leaving the sum: it stops being advanced at all, so without
    /// this its ring keeps whatever was in it and replays that audio if the
    /// band ever comes back.
    fn reset(&mut self) {
        self.left.fill(0.0);
        self.right.fill(0.0);
        self.write = 0;
    }

    /// Write one stereo frame and read the one `delay` frames older.
    ///
    /// The ring is written on every call even at zero delay — a bypass that
    /// skipped the write would let the buffer go stale and replay whatever
    /// was in it the moment a preset raised the delay again.
    #[inline]
    fn process(&mut self, left: f32, right: f32) -> (f32, f32) {
        self.left[self.write] = left;
        self.right[self.write] = right;
        let read = (self.write + self.left.len() - self.delay) & self.mask;
        let output = (self.left[read], self.right[read]);
        self.write = (self.write + 1) & self.mask;
        output
    }
}

/// Modulation assignment: source → target with amount.
///
/// `source_id` and `target_param` are validated by
/// [`BacteriaEngine::add_mod_assignment`] before an entry is ever built, so
/// the per-sample pass can index with them. Nothing else constructs one.
#[derive(Clone)]
#[allow(dead_code)]
struct ModAssignment {
    source_id: u8,
    target_param: u16,
    amount: f32,
    active: bool,
}

/// Macro mapping entry.
///
/// `macro_index` and `target_param` carry the same guarantee as
/// [`ModAssignment`], established by [`BacteriaEngine::add_macro_mapping`].
#[derive(Clone)]
#[allow(dead_code)]
struct MacroMapping {
    macro_index: u8,
    target_param: u16,
    min_value: f32,
    max_value: f32,
    active: bool,
}

/// Per-band processing chain with all effect modules.
#[allow(dead_code)]
struct BandChain {
    // DSP processors
    distortion: DistortionProcessor,
    waveshaper: CustomWaveshaper,
    filter_l: SvfFilter,
    filter_r: SvfFilter,
    chorus: ChorusFlanger,
    phaser: Phaser,
    granular_l: GranularProcessor,
    granular_r: GranularProcessor,
    stft_l: StftProcessor,
    stft_r: StftProcessor,
    hilbert_l: HilbertShifter,
    hilbert_r: HilbertShifter,
    lofi: LofiProcessor,
    convolution: ConvolutionProcessor,
    oversampler_l: OversamplingChain,
    oversampler_r: OversamplingChain,
    /// Pads this band out to the delay of the slowest band in the sum.
    alignment: AlignmentDelay,

    // Enable flags
    distortion_enabled: bool,
    filter_enabled: bool,
    granular_enabled: bool,
    spectral_enabled: bool,
    freq_shift_enabled: bool,
    chorus_enabled: bool,
    phaser_enabled: bool,
    lofi_enabled: bool,
    convolution_enabled: bool,

    // Band controls
    gain: SmoothedParam,
    solo: bool,
    mute: bool,
    enabled: bool,
    oversampling_factor: usize,

    // Metering
    peak_level: f32,
    meter_decay: f32,
}

impl BandChain {
    fn new(sample_rate: f32) -> Self {
        Self {
            distortion: DistortionProcessor::new(),
            waveshaper: CustomWaveshaper::new(),
            filter_l: SvfFilter::new(sample_rate),
            filter_r: SvfFilter::new(sample_rate),
            chorus: ChorusFlanger::new(sample_rate),
            phaser: Phaser::new(sample_rate),
            granular_l: GranularProcessor::new(sample_rate),
            granular_r: GranularProcessor::new(sample_rate),
            stft_l: StftProcessor::new(2048),
            stft_r: StftProcessor::new(2048),
            hilbert_l: HilbertShifter::new(sample_rate),
            hilbert_r: HilbertShifter::new(sample_rate),
            lofi: LofiProcessor::new(),
            convolution: ConvolutionProcessor::new(sample_rate),
            oversampler_l: OversamplingChain::new(1),
            oversampler_r: OversamplingChain::new(1),
            distortion_enabled: false,
            filter_enabled: false,
            granular_enabled: false,
            spectral_enabled: false,
            freq_shift_enabled: false,
            chorus_enabled: false,
            phaser_enabled: false,
            lofi_enabled: false,
            convolution_enabled: false,
            gain: SmoothedParam::new(1.0, 5.0, sample_rate),
            solo: false,
            mute: false,
            enabled: true,
            oversampling_factor: 1,
            alignment: AlignmentDelay::new(ALIGNMENT_RING_LEN),
            peak_level: 0.0,
            meter_decay: (-1.0 / (0.1 * sample_rate)).exp(),
        }
    }

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "enabled" => self.enabled = value > 0.5,
            "solo" => self.solo = value > 0.5,
            "mute" => self.mute = value > 0.5,
            "gain" => self.gain.set_target(db_to_linear(value)),
            "distortionEnabled" => self.distortion_enabled = value > 0.5,
            "filterEnabled" => self.filter_enabled = value > 0.5,
            "granularEnabled" => self.granular_enabled = value > 0.5,
            "spectralEnabled" => {
                let next = value > 0.5;
                // Switching the stage off strands up to a whole analysis
                // window in the overlap-add buffer, which flushes out over
                // whatever the band is playing the moment the stage comes
                // back. Same argument, and the same treatment, as leaving the
                // Smudge distortion mode in `DistortionProcessor::set_param`.
                //
                // Drained here at control rate rather than by clocking silence
                // through on the audio thread the way the frequency shifter is:
                // this stage runs an FFT every hop, so feeding a switched-off
                // one would cost a transform per hop to keep an empty buffer
                // empty. The shifter has no such choice — its all-pass network
                // is recursive and never drains on its own.
                if next != self.spectral_enabled && !next {
                    self.stft_l.reset();
                    self.stft_r.reset();
                }
                self.spectral_enabled = next;
            }
            "freqShiftEnabled" => self.freq_shift_enabled = value > 0.5,
            "chorusEnabled" => self.chorus_enabled = value > 0.5,
            "phaserEnabled" => self.phaser_enabled = value > 0.5,
            "lofiEnabled" => self.lofi_enabled = value > 0.5,
            "convolutionEnabled" => self.convolution_enabled = value > 0.5,
            "oversampling" => {
                let factor = (value as usize).clamp(1, 8);
                if factor != self.oversampling_factor {
                    self.oversampling_factor = factor;
                    self.oversampler_l = OversamplingChain::new(factor);
                    self.oversampler_r = OversamplingChain::new(factor);
                }
            }
            _ => {
                // Delegate to all sub-processors
                self.distortion.set_param(name, value);
                self.filter_l.set_param(name, value);
                self.filter_r.set_param(name, value);
                self.chorus.set_param(name, value);
                self.phaser.set_param(name, value);
                self.granular_l.set_param(name, value);
                self.granular_r.set_param(name, value);
                self.stft_l.set_param(name, value);
                self.stft_r.set_param(name, value);
                self.hilbert_l.set_param(name, value);
                self.hilbert_r.set_param(name, value);
                self.lofi.set_param(name, value);
                self.convolution.set_param(name, value);
            }
        }
    }

    /// Group delay this band contributes, in base-rate samples.
    ///
    /// Derived from the configured oversampling factor, deliberately NOT from
    /// the live `distortion_enabled` / `enabled` / `mute` flags. Those toggle
    /// during performance, and renegotiating host PDC on every toggle is worse
    /// than reporting a stable worst case. Over-reporting is the safe
    /// direction; under-reporting slides the track early against everything
    /// else.
    ///
    /// Both channel chains always share a factor (`set_param` sets them
    /// together), so the left one speaks for the band.
    ///
    /// The distortion stage's own delay rides on the same reasoning: it comes
    /// from the configured *mode*, which is a setup choice like the factor, not
    /// a performance toggle like `distortionEnabled`.
    ///
    /// The lo-fi codec's framed transform is the third contributor. It sits
    /// outside the oversampled loop, so its frame is base-rate samples already,
    /// and it is gated on `codecArtifact` rather than on `lofiEnabled` for the
    /// same reason the distortion stage reads its mode and not its enable flag.
    ///
    /// The spectral blur/freeze window is the fourth, and it is the one
    /// contributor that does follow an enable flag — see
    /// [`Self::spectral_latency_samples`] for why it has to.
    fn latency_samples(&self) -> f32 {
        self.oversampler_l.latency_samples()
            + self.distortion_latency_samples()
            + self.lofi.latency_samples()
            + self.spectral_latency_samples()
    }

    /// The spectral blur/freeze stage's group delay, in base-rate samples.
    ///
    /// A whole `StftProcessor` window — exact rather than estimated, and now
    /// the delay the stage really delivers at every `spectralMix` value since
    /// the processor holds its dry tap back to match (see
    /// `StftProcessor::process_sample`). It sits outside the oversampled loop,
    /// so its window is already base-rate samples.
    ///
    /// Read from `spectralEnabled`, unlike the distortion stage's own window,
    /// which is deliberately read from the configured mode so the report
    /// survives a performance toggle. The stage has no configured-but-idle
    /// state to read instead: `spectralEnabled` is its only gate, and the
    /// alternative — reporting the window unconditionally — would hand every
    /// Bacteria instance 2048 samples of host latency in its shipped default
    /// state, where the stage is switched off and delays nothing. The lo-fi
    /// codec already sets this precedent from the other direction: it is gated
    /// on `codecArtifact`, and `reported_latency_includes_the_lofi_codec_frame`
    /// pins the renegotiation that gating causes.
    fn spectral_latency_samples(&self) -> f32 {
        if self.spectral_enabled {
            return self.stft_l.latency_samples() as f32;
        }
        0.0
    }

    /// The distortion stage's group delay, converted to base-rate samples.
    ///
    /// Smudge's overlap-add window sits *inside* the oversampled loop, so its
    /// 2048 samples are 2048 samples of the oversampled stream — 256 base-rate
    /// samples at 8x. Every other mode contributes zero.
    fn distortion_latency_samples(&self) -> f32 {
        // Ask the chain what rate it is *actually* running at, not what was
        // requested. `oversampling_factor` is the raw parameter, clamped to
        // 1..=8 and nothing else, while `OversamplingChain` snaps it to a power
        // of two — 3 becomes 2, and 5/6/7 become 4 — because it is a cascade of
        // 2x stages and an odd factor would emit a slice no stage can decimate.
        //
        // Dividing by the requested value therefore reports a delay the band
        // does not deliver: at a requested 3 the window is 2048/3 ≈ 683 samples
        // on paper and 1024 in fact. A host trusting that number shifts the band
        // by the difference permanently, and the internal cross-band alignment
        // reads the same wrong figure, so the bands comb against each other
        // rather than merely arriving late.
        //
        // Harmless before this branch only because `oversampling_factor` was a
        // `> 1` boolean gate and never a divisor.
        self.distortion.latency_samples() / self.oversampler_l.factor() as f32
    }

    /// Group delay the band's own processing imposes *right now*.
    ///
    /// Unlike [`Self::latency_samples`] this does follow `distortion_enabled`:
    /// the oversampler only sits in the path when the distortion stage runs,
    /// so a band carrying a factor with distortion switched off delays
    /// nothing. The compensation has to close the real gap, not the reported
    /// one — and because it makes up the difference either way, the band's
    /// total delay stays put across a distortion toggle, which is what lets
    /// `latency_samples` keep reporting a flag-independent number honestly.
    ///
    /// Smudge's window is in the path on exactly the same condition — it is a
    /// distortion mode — so it is gated the same way.
    ///
    /// The lo-fi codec is an independent stage with its own enable flag, so it
    /// is added on its own condition rather than under the distortion one. The
    /// spectral window is the same shape, and because
    /// [`Self::spectral_latency_samples`] already follows `spectralEnabled`
    /// the two figures agree on it — that band's deficit for the spectral term
    /// is always zero, which is exactly what makes the flag-gated report
    /// honest.
    fn engaged_latency_samples(&self) -> f32 {
        let mut engaged = self.spectral_latency_samples();
        if self.lofi_enabled {
            engaged += self.lofi.latency_samples();
        }

        if !self.distortion_enabled {
            return engaged;
        }

        engaged += self.distortion_latency_samples();
        if self.oversampling_factor > 1 {
            engaged += self.oversampler_l.latency_samples();
        }
        engaged
    }

    /// Delay this band's output until it presents `target` base-rate samples.
    ///
    /// Called whenever a parameter could have moved any band's latency. The
    /// deficit rounds to whole samples, leaving the irreducible fractional
    /// skew described on [`AlignmentDelay`] — worst case 0.75 samples,
    /// between a band on 4x (9.75, padded to 11.75) and one on 1x (padded to
    /// 11.0), when some band holds the 8x target of 11.375.
    fn set_alignment_target(&mut self, target: f32) {
        let deficit = target - self.engaged_latency_samples();
        if deficit <= 0.0 {
            self.alignment.set_delay(0);
            return;
        }
        self.alignment.set_delay(deficit.round() as usize);
    }

    /// Advance the alignment ring by one silent frame for a band that
    /// produced no output this sample.
    ///
    /// A band the caller skips — solo, or a routing mode that does not use it
    /// — must keep its ring moving. A frozen ring replays whatever was in
    /// flight at the moment it was skipped, the instant the band comes back.
    ///
    /// The frequency shifter is on the same rule and is not self-draining: its
    /// all-pass network holds a ~5500-sample memory, so a frozen one flushes a
    /// full-scale burst on re-entry. See [`HilbertShifter::bypass`].
    fn skip_sample(&mut self) {
        self.alignment.process(0.0, 0.0);
        self.hilbert_l.bypass();
        self.hilbert_r.bypass();
        self.decay_meter();
    }

    /// Clock the band's delay line with audio that is passing *around* its
    /// processing rather than through it.
    ///
    /// `Serial` routing chains the bands, so a band the caller skips cannot
    /// simply contribute nothing the way it does under a sum — the signal has
    /// to reach the next link. Running it through the alignment ring anyway is
    /// what keeps the chain's total delay, and therefore the number the host
    /// was given, from moving when a band is soloed or muted mid-performance.
    fn pass_through_sample(&mut self, left: f32, right: f32) -> (f32, f32) {
        self.hilbert_l.bypass();
        self.hilbert_r.bypass();
        self.decay_meter();
        self.alignment.process(left, right)
    }

    /// Whether this band contributes its own processing this sample.
    fn contributes(&self, any_solo: bool) -> bool {
        self.enabled && !self.mute && (!any_solo || self.solo)
    }

    /// Let the peak meter fall for a sample this band did not produce.
    ///
    /// The band's true level while it is skipped is zero, and the meter has to
    /// say so or the UI leaves a bar standing at whatever the band was doing
    /// when it was soloed away, muted, or dropped by `bandCount`. Released
    /// through the same one-pole ballistic `process_sample` uses on the way
    /// down, so a skipped band's meter falls at the rate every other meter
    /// falls instead of snapping.
    fn decay_meter(&mut self) {
        self.peak_level *= self.meter_decay;
    }

    /// Drop the band's in-flight alignment audio.
    ///
    /// For a band dropping out of the sum entirely (`bandCount` shrinking),
    /// which stops even `skip_sample` from reaching it. Its ring would
    /// otherwise sit frozen on real audio and flush it the moment the count
    /// grows back over this index.
    fn clear_alignment(&mut self) {
        self.alignment.reset();
        self.hilbert_l.reset();
        self.hilbert_r.reset();
        self.peak_level = 0.0;
    }

    fn process_sample(&mut self, left: f32, right: f32, gain_offset: f32) -> (f32, f32) {
        if !self.enabled || self.mute {
            // Same reasoning as `skip_sample`: silence still has to flow
            // through the ring or an unmute flushes out pre-mute audio.
            self.skip_sample();
            return (0.0, 0.0);
        }

        let mut l = left;
        let mut r = right;

        // Distortion with optional oversampling
        if self.distortion_enabled {
            if self.oversampling_factor > 1 {
                // Upsample → process → downsample
                let mut processed_l = [0.0_f32; 8];
                let up_l_len = {
                    let up_l = self.oversampler_l.upsample(l);
                    for (i, &s) in up_l.iter().enumerate() {
                        processed_l[i] = self.distortion.process_sample(s, 0);
                    }
                    up_l.len()
                };
                l = self.oversampler_l.downsample(&processed_l[..up_l_len]);

                let mut processed_r = [0.0_f32; 8];
                let up_r_len = {
                    let up_r = self.oversampler_r.upsample(r);
                    for (i, &s) in up_r.iter().enumerate() {
                        processed_r[i] = self.distortion.process_sample(s, 1);
                    }
                    up_r.len()
                };
                r = self.oversampler_r.downsample(&processed_r[..up_r_len]);
            } else {
                l = self.distortion.process_sample(l, 0);
                r = self.distortion.process_sample(r, 1);
            }
        }

        // Filter
        if self.filter_enabled {
            l = self.filter_l.process_sample(l);
            r = self.filter_r.process_sample(r);
        }

        // Chorus/Flanger
        if self.chorus_enabled {
            let (cl, cr) = self.chorus.process_stereo(l, r);
            l = cl;
            r = cr;
        }

        // Phaser
        if self.phaser_enabled {
            let (pl, pr) = self.phaser.process_stereo(l, r);
            l = pl;
            r = pr;
        }

        // Granular
        if self.granular_enabled {
            l = self.granular_l.process_sample(l);
            r = self.granular_r.process_sample(r);
        }

        // Spectral (STFT-based blur/freeze)
        if self.spectral_enabled {
            l = self.stft_l.process_sample(l);
            r = self.stft_r.process_sample(r);
        }

        // Frequency shifter (Hilbert transform)
        if self.freq_shift_enabled {
            l = self.hilbert_l.process_sample(l);
            r = self.hilbert_r.process_sample(r);
        } else {
            // Switching the stage off has to empty it, not pause it — see
            // `skip_sample`.
            self.hilbert_l.bypass();
            self.hilbert_r.bypass();
        }

        // Lo-Fi / Codec
        if self.lofi_enabled {
            let (ll, lr) = self.lofi.process_stereo(l, r);
            l = ll;
            r = lr;
        }

        // Convolution body
        if self.convolution_enabled {
            let (cl, cr) = self.convolution.process_stereo(l, r);
            l = cl;
            r = cr;
        }

        // Apply band gain — gain_offset (linear) arrives from the modulation matrix
        let g = (self.gain.next() + gain_offset).max(0.0);
        l *= g;
        r *= g;

        // Pad out to the slowest band's delay. Bands are summed, so a band
        // that oversamples and a band that does not would otherwise arrive at
        // the sum up to 11.375 samples apart and comb at their shared
        // crossover.
        let (aligned_l, aligned_r) = self.alignment.process(l, r);
        l = aligned_l;
        r = aligned_r;

        // Update peak meter
        let peak = l.abs().max(r.abs());
        if peak > self.peak_level {
            self.peak_level = peak;
        } else {
            self.peak_level *= self.meter_decay;
        }

        (l, r)
    }
}

/// Routing mode — how the band chains are wired to each other.
///
/// `Parallel` and `MidSide` split first and combine after, so the chains never
/// see each other's output. `Serial` chains them instead: the whole signal
/// enters band 0's chain and each band's output is the next band's input, the
/// device output being the last band's. That is what a Serial/Parallel switch
/// means wherever a host offers one over a rack of effect lanes — Ableton's
/// Effect Rack chains, Bitwig's FX Chain against its FX Layer, which is the
/// convention `NodeGraphEditor.tsx` names as this panel's model — and the
/// panel promises nothing narrower than "choose how the bands behave".
///
/// The crossover therefore has nothing to do under `Serial`: a chain carries
/// one signal, not a set of slices, so `crossoverFreq*` shapes nothing while
/// this mode is selected. `bandCount` still decides how many chains are in the
/// cascade. This is the mode's definition rather than a gap in it — the
/// alternative, injecting each band's slice at its own stage, would need every
/// slice delayed by the chain built ahead of it, which is six more delay lines
/// as long as the whole cascade.
#[derive(Clone, Copy, PartialEq)]
enum RoutingMode {
    Serial,
    Parallel,
    MidSide,
}

impl RoutingMode {
    fn from_index(i: u32) -> Self {
        match i {
            0 => Self::Serial,
            1 => Self::Parallel,
            _ => Self::MidSide,
        }
    }
}

/// Snapshot state for XY morph (A/B/C/D).
#[allow(dead_code)]
struct MorphSnapshot {
    param_values: Vec<(String, f32)>,
}

impl MorphSnapshot {
    fn new() -> Self {
        Self {
            param_values: Vec::new(),
        }
    }
}

#[allow(dead_code)]
pub struct BacteriaEngine {
    sample_rate: f32,

    // Crossover
    crossover: CrossoverEngine,
    band_count: usize,
    crossover_freqs: [f32; 5],

    // Per-band chains
    bands: Vec<BandChain>,

    // Global
    input_gain: SmoothedParam,
    output_gain: SmoothedParam,
    mix: SmoothedParam,
    bypassed: bool,
    routing: RoutingMode,

    // Modulation sources
    lfo1: Lfo,
    lfo2: Lfo,
    env_follower: EnvelopeFollower,
    lorenz: LorenzAttractor,
    step_seq: StepSequencer,

    // Modulation state (current values from sources)
    mod_values: [f32; MOD_SOURCE_COUNT],

    // Modulation assignments. Capacity is reserved in `new`; the setters never
    // push past it, so the audio thread never sees a reallocation.
    mod_assignments: Vec<ModAssignment>,

    // Macro mapping, on the same terms.
    macro_mappings: Vec<MacroMapping>,

    /// Distinct `param_offsets` slots the tables above target, rebuilt at
    /// control rate whenever either table changes.
    ///
    /// The per-sample pass used to clear the whole 4 kB offset array — 1024
    /// stores per sample, ~49 M/s at 48 kHz — to make room for at most a
    /// handful of live modulations, and did it even with no modulation
    /// configured at all, which is every shipped preset. Only the slots
    /// something writes need clearing, and this is that set.
    modulated_targets: [u16; MAX_MODULATED_TARGETS],
    modulated_target_count: usize,

    // Macros
    macros: [f32; MACRO_COUNT],

    // XY morph
    morph_x: f32,
    morph_y: f32,
    snapshots: [MorphSnapshot; 4],

    // Metering
    input_peak: f32,
    output_peak: f32,
    meter_decay_global: f32,
    band_levels: [f32; MAX_BANDS],

    // Scratch buffers for band splitting
    bands_l: [f32; MAX_BANDS],
    bands_r: [f32; MAX_BANDS],

    /// Holds the dry mix tap back to the same delay the bands present.
    ///
    /// The wet path costs up to 11.375 samples through an oversampled band.
    /// Mixed against an undelayed dry signal that is the same comb this
    /// change removes between bands, just across the wet/dry blend instead —
    /// deepest at `mix` 0.5 and silent at the default `mix` 1.0, which is why
    /// it went unnoticed. Delaying dry alongside wet also makes the device
    /// present its reported latency at every mix value, not only fully wet.
    dry_alignment: AlignmentDelay,

    // Computed parameter offsets from modulations.
    // Convention: [0] = global mix; [1..=6] = per-band gain offsets (linear scale, bands 0-5).
    param_offsets: [f32; PARAM_OFFSET_COUNT],
}

/// Simple step sequencer modulation source.
#[allow(dead_code)]
struct StepSequencer {
    steps: Vec<f32>,
    num_steps: usize,
    position: f32,
    rate: f32, // Hz
    sample_rate: f32,
}

impl StepSequencer {
    fn new(sample_rate: f32) -> Self {
        Self {
            steps: vec![0.0; 32],
            num_steps: 16,
            position: 0.0,
            rate: 4.0,
            sample_rate,
        }
    }

    fn set_step(&mut self, index: usize, value: f32) {
        if index < self.steps.len() {
            self.steps[index] = value.clamp(-1.0, 1.0);
        }
    }

    fn next(&mut self) -> f32 {
        let step_inc = self.rate / self.sample_rate;
        self.position += step_inc;
        if self.position >= self.num_steps as f32 {
            self.position -= self.num_steps as f32;
        }
        let idx = (self.position as usize) % self.num_steps;
        self.steps[idx]
    }

    fn reset(&mut self) {
        self.position = 0.0;
    }
}

impl BacteriaEngine {
    pub fn new(sample_rate: f32) -> Self {
        let bands: Vec<BandChain> = (0..MAX_BANDS)
            .map(|_| BandChain::new(sample_rate))
            .collect();

        Self {
            sample_rate,
            crossover: CrossoverEngine::new(sample_rate),
            band_count: 1,
            crossover_freqs: [200.0, 800.0, 2500.0, 6000.0, 12000.0],
            bands,
            input_gain: SmoothedParam::new(1.0, 5.0, sample_rate),
            output_gain: SmoothedParam::new(1.0, 5.0, sample_rate),
            mix: SmoothedParam::new(1.0, 5.0, sample_rate),
            bypassed: false,
            routing: RoutingMode::Parallel,
            lfo1: Lfo::new(sample_rate),
            lfo2: Lfo::new(sample_rate),
            env_follower: EnvelopeFollower::new(sample_rate),
            lorenz: LorenzAttractor::new(sample_rate),
            step_seq: StepSequencer::new(sample_rate),
            mod_values: MOD_VALUES_AT_REST,
            mod_assignments: Vec::with_capacity(MAX_MOD_ASSIGNMENTS),
            macro_mappings: Vec::with_capacity(MAX_MACRO_MAPPINGS),
            modulated_targets: [0; MAX_MODULATED_TARGETS],
            modulated_target_count: 0,
            macros: [DEFAULT_MACRO; MACRO_COUNT],
            morph_x: 0.5,
            morph_y: 0.5,
            snapshots: [
                MorphSnapshot::new(),
                MorphSnapshot::new(),
                MorphSnapshot::new(),
                MorphSnapshot::new(),
            ],
            input_peak: 0.0,
            output_peak: 0.0,
            meter_decay_global: (-1.0 / (0.1 * sample_rate)).exp(), // ~100ms decay
            band_levels: [0.0; MAX_BANDS],
            bands_l: [0.0; MAX_BANDS],
            bands_r: [0.0; MAX_BANDS],
            dry_alignment: AlignmentDelay::new(DRY_ALIGNMENT_RING_LEN),
            param_offsets: [0.0; PARAM_OFFSET_COUNT],
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        self.apply_param(name, value);
        // Any parameter can move a band's engaged latency: the factor itself,
        // `bandCount`, or the distortion flag that decides whether the
        // oversampler is in the path at all. Names reach bands two ways (bare
        // names broadcast, `bandN_` prefixes target one), so gating this on a
        // name list would be one missed case away from a silent comb filter.
        // `set_param` is a control-rate call and this pass is allocation-free
        // over at most six bands.
        self.realign_bands();
        self.clear_inactive_band_levels();
    }

    /// Give every band the group delay the routing needs it to present.
    ///
    /// Under a sum — `Parallel` and `MidSide` — every band has to present the
    /// same delay or they comb at their shared crossover, so the target is the
    /// worst case over active bands derived from their configured factors.
    ///
    /// Under `Serial` nothing is summed, so there is nothing to equalize;
    /// each band is padded out to its *own* configured delay instead. That is
    /// not padding for its own sake: it holds the band's contribution steady
    /// across `distortionEnabled` and `lofiEnabled`, which is what lets the
    /// cascade's total — and so [`Self::latency_samples`] — stay put while
    /// stages are switched during a performance.
    ///
    /// Either way the target each band is given is exactly the term it
    /// contributes to the reported figure, so the report is what the device
    /// delivers.
    fn realign_bands(&mut self) {
        let serial = self.routing == RoutingMode::Serial;
        let summed_target = self
            .bands
            .iter()
            .take(self.band_count)
            .map(BandChain::latency_samples)
            .fold(0.0_f32, f32::max);

        let mut device_delay = 0.0_f32;
        for (index, band) in self.bands.iter_mut().enumerate() {
            // Bands past `bandCount` contribute nothing and must not hold a
            // stale delay into a later band-count change.
            if index >= self.band_count {
                band.set_alignment_target(0.0);
                // Nothing advances a band past `bandCount` — not even
                // `skip_sample` — so its ring has to be emptied here or it
                // replays pre-shrink audio when the count grows back.
                // Idempotent, and this only ever runs at control rate.
                band.clear_alignment();
                continue;
            }

            let target = if serial {
                band.latency_samples()
            } else {
                summed_target
            };
            band.set_alignment_target(target);

            // Chained delays add; summed ones do not.
            if serial {
                device_delay += target;
            } else {
                device_delay = target;
            }
        }

        // The dry mix tap bypasses the bands entirely, so it needs the whole
        // device delay rather than a deficit against something it already
        // spent.
        self.dry_alignment.set_delay(device_delay.round() as usize);
    }

    /// Zero the meter of every band past `bandCount`.
    ///
    /// Those bands are never advanced, so nothing else would move their
    /// published level off whatever it held when the count shrank — and with
    /// the transport stopped no block runs to do it either.
    fn clear_inactive_band_levels(&mut self) {
        for level in self.band_levels.iter_mut().skip(self.band_count) {
            *level = 0.0;
        }
    }

    /// Resolve the modulation matrix into `param_offsets` for this sample.
    ///
    /// Stays per-sample because its sources are audio-rate — an LFO or the
    /// envelope follower on a band gain has to arrive sample by sample or it
    /// steps — but it no longer *costs* per sample what it used to. The pass
    /// cleared all 1024 offset slots on the way in, 4 kB of stores per sample,
    /// to make room for at most a handful of live modulations; it did that with
    /// no modulation configured at all, which is the state every shipped preset
    /// is in, because the clear came before the check that there was anything
    /// to write. Only the slots something targets need clearing, and
    /// `modulated_targets` is that set, gathered when the tables grow.
    ///
    /// The bounds test each write used to carry is gone with it: both setters
    /// reject an out-of-range target before an entry exists, so a stored one
    /// addresses a slot that is there.
    fn evaluate_modulation(&mut self) {
        if self.modulated_target_count == 0 {
            return;
        }

        for index in 0..self.modulated_target_count {
            self.param_offsets[self.modulated_targets[index] as usize] = 0.0;
        }

        for index in 0..self.mod_assignments.len() {
            let assignment = &self.mod_assignments[index];
            if !assignment.active {
                continue;
            }
            let source = self.mod_values[assignment.source_id as usize];
            self.param_offsets[assignment.target_param as usize] += source * assignment.amount;
        }

        for index in 0..self.macro_mappings.len() {
            let mapping = &self.macro_mappings[index];
            if !mapping.active {
                continue;
            }
            let source = self.macros[mapping.macro_index as usize];
            let mapped = mapping.min_value + source * (mapping.max_value - mapping.min_value);
            self.param_offsets[mapping.target_param as usize] += mapped;
        }
    }

    /// Copy every band's meter out to the array the UI reads.
    ///
    /// Every active band, on every path — including the bands a solo, a mute,
    /// mid/side routing or bypass skipped. Publishing only the bands that were
    /// processed is what left their bars standing: a skipped band kept the
    /// level it last produced, so soloing one band froze the others' meters at
    /// whatever they were playing at that instant instead of letting them fall.
    /// The meters themselves are released in `BandChain::decay_meter`.
    fn publish_band_levels(&mut self) {
        for (index, level) in self.band_levels.iter_mut().enumerate() {
            *level = if index < self.band_count {
                self.bands[index].peak_level
            } else {
                0.0
            };
        }
    }

    fn apply_param(&mut self, name: &str, value: f32) {
        // Parse band-prefixed params: "band0_drive", "band1_filterCutoff", etc.
        // Only a digit after "band" makes it one — "bandCount" and friends must
        // fall through to the match below, not be swallowed by an early return.
        if name.starts_with("band") && name.len() > 5 {
            if let Some(idx_char) = name.chars().nth(4) {
                if let Some(band_idx) = idx_char.to_digit(10) {
                    let band_idx = band_idx as usize;
                    if band_idx < MAX_BANDS {
                        let param_name = &name[6..]; // skip "bandN_"
                        self.bands[band_idx].set_param(param_name, value);
                    }
                    return;
                }
            }
        }

        // Step sequencer steps: "stepSeqVal_N"
        if name.starts_with("stepSeqVal_") {
            if let Ok(idx) = name[11..].parse::<usize>() {
                self.step_seq.set_step(idx, value);
            }
            return;
        }

        match name {
            // Global
            "inputGain" => self.input_gain.set_target(db_to_linear(value)),
            "outputGain" => self.output_gain.set_target(db_to_linear(value)),
            "mix" => self.mix.set_target(value),
            "bypass" => self.bypassed = value > 0.5,

            // Crossover
            "bandCount" => {
                self.band_count = (value as usize).clamp(1, MAX_BANDS);
                self.crossover
                    .set_bands(self.band_count, &self.crossover_freqs);
            }
            "crossoverFreq1" => self.set_crossover(0, value),
            "crossoverFreq2" => self.set_crossover(1, value),
            "crossoverFreq3" => self.set_crossover(2, value),
            "crossoverFreq4" => self.set_crossover(3, value),
            "crossoverFreq5" => self.set_crossover(4, value),
            "crossoverSlope" | "crossoverMode" => {}

            // Routing
            "globalRouting" => self.routing = RoutingMode::from_index(value as u32),

            // Macros
            "macro1" => self.set_macro(0, value),
            "macro2" => self.set_macro(1, value),
            "macro3" => self.set_macro(2, value),
            "macro4" => self.set_macro(3, value),
            "macro5" => self.set_macro(4, value),
            "macro6" => self.set_macro(5, value),
            "macro7" => self.set_macro(6, value),
            "macro8" => self.set_macro(7, value),

            // XY morph
            "morphX" => self.morph_x = value,
            "morphY" => self.morph_y = value,

            // LFO
            "lfo1Rate" => self.lfo1.set_rate(value),
            "lfo1Shape" => self.lfo1.set_shape(LfoShape::from_index(value as u32)),
            "lfo1Amount" => self.lfo1.set_amount(value),
            "lfo2Rate" => self.lfo2.set_rate(value),
            "lfo2Shape" => self.lfo2.set_shape(LfoShape::from_index(value as u32)),
            "lfo2Amount" => self.lfo2.set_amount(value),

            // Envelope follower
            "envFollowerAttack" => self.env_follower.set_attack(value),
            "envFollowerRelease" => self.env_follower.set_release(value),

            // Lorenz
            "lorenzSigma" => self.lorenz.sigma = value,
            "lorenzRho" => self.lorenz.rho = value,
            "lorenzBeta" => self.lorenz.beta = value,
            "lorenzSpeed" => self.lorenz.speed = value,

            // Step sequencer
            "stepSeqSteps" => self.step_seq.num_steps = (value as usize).clamp(1, 32),
            "stepSeqRate" => self.step_seq.rate = value.max(0.01),

            // Per-band params without prefix go to all bands
            _ => {
                for band in &mut self.bands {
                    band.set_param(name, value);
                }
            }
        }
    }

    /// Move one crossover corner, keeping the set of corners in ascending
    /// order.
    ///
    /// The corners are consumed by `CrossoverEngine::set_bands` as a cascade —
    /// corner `i` splits what corner `i-1` passed upward — so an inverted pair
    /// does not produce an unusual split, it produces a broken one: the band
    /// between them is a low-pass of a higher high-pass and carries nothing,
    /// while its content stays folded into a neighbour. Nothing said so; the
    /// band meter simply sat at zero.
    ///
    /// Ordering is restored by yielding the *neighbours*, not by clamping the
    /// value that was just written. Clamping is what a fader does under a
    /// mouse, and it is wrong here because this setter is also the path a
    /// preset load and an automation lane take: corners arrive one at a time in
    /// descriptor order, so moving a whole set downward would have every corner
    /// blocked by the old one below it and silently land somewhere the caller
    /// never asked for. Yielding neighbours honours the value written every
    /// time and still leaves the array ascending, whatever order the writes
    /// arrive in.
    fn set_crossover(&mut self, index: usize, value: f32) {
        self.crossover_freqs[index] = value.clamp(MIN_CROSSOVER_HZ, MAX_CROSSOVER_HZ);

        for lower in (0..index).rev() {
            self.crossover_freqs[lower] =
                self.crossover_freqs[lower].min(self.crossover_freqs[lower + 1]);
        }
        for higher in index + 1..self.crossover_freqs.len() {
            self.crossover_freqs[higher] =
                self.crossover_freqs[higher].max(self.crossover_freqs[higher - 1]);
        }

        self.crossover
            .set_bands(self.band_count, &self.crossover_freqs);
    }

    /// Move one macro control, and its mirror in the modulation source table.
    ///
    /// The mirror used to be re-copied for all eight macros on every sample,
    /// which is control-rate data being refreshed at audio rate. It can only
    /// change here.
    fn set_macro(&mut self, index: usize, value: f32) {
        self.macros[index] = value;
        self.mod_values[MACRO_SOURCE_BASE + index] = value;
    }

    /// Add a modulation assignment.
    ///
    /// Ignores an assignment naming a source or a target that does not exist,
    /// and one arriving past [`MAX_MOD_ASSIGNMENTS`]. Both ids cross the wasm
    /// boundary as raw integers wider than the tables they index, and the
    /// per-sample pass indexes with them directly; a rejected call is a no-op
    /// where an accepted bad one would abort the AudioWorklet.
    pub fn add_mod_assignment(&mut self, source_id: u8, target_param: u16, amount: f32) {
        if source_id as usize >= MOD_SOURCE_COUNT || target_param as usize >= PARAM_OFFSET_COUNT {
            return;
        }
        if self.mod_assignments.len() == MAX_MOD_ASSIGNMENTS {
            return;
        }
        self.mod_assignments.push(ModAssignment {
            source_id,
            target_param,
            amount,
            active: true,
        });
        self.note_modulated_target(target_param);
    }

    /// Add a macro mapping.
    ///
    /// Carries the same rejections as [`Self::add_mod_assignment`], plus a
    /// ceiling this call did not have at all: it pushed onto an uncapped `Vec`
    /// from the audio thread, so a caller re-sending its mapping table both
    /// reallocated there and grew the per-sample pass without bound.
    pub fn add_macro_mapping(
        &mut self,
        macro_index: u8,
        target_param: u16,
        min_value: f32,
        max_value: f32,
    ) {
        if macro_index as usize >= MACRO_COUNT || target_param as usize >= PARAM_OFFSET_COUNT {
            return;
        }
        if self.macro_mappings.len() == MAX_MACRO_MAPPINGS {
            return;
        }
        self.macro_mappings.push(MacroMapping {
            macro_index,
            target_param,
            min_value,
            max_value,
            active: true,
        });
        self.note_modulated_target(target_param);
    }

    /// Record that something now writes `target`, so the per-sample pass knows
    /// to clear that slot and only that slot.
    ///
    /// Linear scan for the duplicate check: the list is bounded by
    /// [`MAX_MODULATED_TARGETS`] and this only runs when a table grows, which
    /// is control rate. Never removes, because neither table does.
    fn note_modulated_target(&mut self, target: u16) {
        if self.modulated_targets[..self.modulated_target_count].contains(&target) {
            return;
        }
        self.modulated_targets[self.modulated_target_count] = target;
        self.modulated_target_count += 1;
    }

    /// Process a stereo block in-place.
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        let len = left.len().min(right.len());

        if self.bypassed {
            // Pass through untouched, but keep every ring fed: the dry tap
            // with the real signal it would have carried, the bands with the
            // silence they produced. A frozen ring dumps pre-bypass audio the
            // moment bypass is released.
            for i in 0..len {
                self.dry_alignment.process(left[i], right[i]);
                for band in self.bands.iter_mut().take(self.band_count) {
                    band.skip_sample();
                }
            }
            self.publish_band_levels();
            return;
        }

        for i in 0..len {
            // Input gain
            let ig = self.input_gain.next();
            let dry_l = left[i];
            let dry_r = right[i];
            let in_l = dry_l * ig;
            let in_r = dry_r * ig;

            // Update input peak
            let in_peak = in_l.abs().max(in_r.abs());
            if in_peak > self.input_peak {
                self.input_peak = in_peak;
            } else {
                self.input_peak *= self.meter_decay_global;
            }

            // Advance modulation sources
            self.mod_values[0] = self.lfo1.next();
            self.mod_values[1] = self.lfo2.next();
            self.mod_values[2] = self.env_follower.process((in_l + in_r) * 0.5);
            let (lx, lz) = self.lorenz.next();
            self.mod_values[3] = lx;
            self.mod_values[4] = lz;
            self.mod_values[5] = self.step_seq.next();
            // The macro source slots [6..14] are written by `set_macro`, which
            // is the only thing that can move them.

            self.evaluate_modulation();

            // Split through crossover
            self.crossover
                .process_sample(in_l, in_r, &mut self.bands_l, &mut self.bands_r);

            // Check if any band is soloed
            let any_solo = self.bands[..self.band_count].iter().any(|b| b.solo);

            // Process each band and sum
            let mut sum_l = 0.0_f32;
            let mut sum_r = 0.0_f32;

            match self.routing {
                RoutingMode::Parallel => {
                    for b in 0..self.band_count {
                        if any_solo && !self.bands[b].solo {
                            self.bands[b].skip_sample();
                            continue;
                        }
                        // param_offsets[1..=6] carry per-band gain offsets (linear scale).
                        let gain_offset = self.param_offsets[1 + b];
                        let (bl, br) = self.bands[b].process_sample(
                            self.bands_l[b],
                            self.bands_r[b],
                            gain_offset,
                        );
                        sum_l += bl;
                        sum_r += br;
                    }
                }
                RoutingMode::Serial => {
                    // The chain carries the whole signal, not a slice of it:
                    // band 0 processes the input, band 1 processes band 0's
                    // output, and the device output is the last band's. This
                    // arm used to be written alongside `Parallel` and summed
                    // slices exactly like it, so selecting Serial — which is
                    // the shipped patch default — changed nothing at all.
                    //
                    // The crossover still ran above and its slices are
                    // deliberately left unread here rather than the split being
                    // skipped: its biquads would otherwise sit frozen on
                    // whatever was in flight and replay it the moment the mode
                    // changed back, which is the same stale-state fault the
                    // alignment rings are kept moving for.
                    let mut chain_l = in_l;
                    let mut chain_r = in_r;
                    for b in 0..self.band_count {
                        let (bl, br) = if self.bands[b].contributes(any_solo) {
                            let gain_offset = self.param_offsets[1 + b];
                            self.bands[b].process_sample(chain_l, chain_r, gain_offset)
                        } else {
                            // Bypassing a link in a chain passes the signal on;
                            // it does not cut it. Still routed through the
                            // band's alignment so the cascade's total delay —
                            // the number the host was given — does not move
                            // when a band is soloed or muted.
                            self.bands[b].pass_through_sample(chain_l, chain_r)
                        };
                        chain_l = bl;
                        chain_r = br;
                    }
                    sum_l = chain_l;
                    sum_r = chain_r;
                }
                RoutingMode::MidSide => {
                    // Encode to M/S
                    let mid = (in_l + in_r) * 0.5;
                    let side = (in_l - in_r) * 0.5;

                    // Process mid through band 0, side through band 1
                    let (pm, _) = if self.band_count > 0 {
                        self.bands[0].process_sample(mid, mid, self.param_offsets[1])
                    } else {
                        (mid, mid)
                    };
                    let (ps, _) = if self.band_count > 1 {
                        self.bands[1].process_sample(side, side, self.param_offsets[2])
                    } else {
                        (side, side)
                    };

                    // Decode back to L/R
                    sum_l = pm + ps;
                    sum_r = pm - ps;

                    // M/S only drives bands 0 and 1. The rest still have to
                    // advance, or switching back to Parallel replays whatever
                    // they were holding when the mode changed.
                    for b in 2..self.band_count {
                        self.bands[b].skip_sample();
                    }
                }
            }

            // Apply output gain
            let og = self.output_gain.next();
            sum_l *= og;
            sum_r *= og;

            // Wet/dry mix (Param ID 0 is conventionally assigned to mix in this mapping)
            let mix_offset = self.param_offsets[0];
            let m = (self.mix.next() + mix_offset).clamp(0.0, 1.0);
            // The dry tap waits for the bands rather than racing ahead of
            // them. `in_l`/`in_r` fed the crossover undelayed — only this
            // blend tap is held back.
            let (aligned_dry_l, aligned_dry_r) = self.dry_alignment.process(dry_l, dry_r);
            left[i] = aligned_dry_l * (1.0 - m) + sum_l * m;
            right[i] = aligned_dry_r * (1.0 - m) + sum_r * m;

            // Update output peak
            let out_peak = left[i].abs().max(right[i].abs());
            if out_peak > self.output_peak {
                self.output_peak = out_peak;
            } else {
                self.output_peak *= self.meter_decay_global;
            }
        }

        self.publish_band_levels();
    }

    pub fn current_input_db(&self) -> f32 {
        linear_to_db(self.input_peak)
    }

    pub fn current_output_db(&self) -> f32 {
        linear_to_db(self.output_peak)
    }

    pub fn band_levels(&self) -> &[f32; MAX_BANDS] {
        &self.band_levels
    }

    /// Latency reported to the host for plugin delay compensation.
    ///
    /// The LR4 crossover is zero-latency; a linear-phase mode would add its
    /// own term here. The oversampled distortion path is not zero-latency:
    /// `OversamplingChain` costs 6.5 / 9.75 / 11.375 base samples at 2x / 4x /
    /// 8x, pinned against the impulse centroid in `oversample.rs`.
    ///
    /// Under a summing mode the device's delay is the longest **active** band;
    /// under `Serial` the bands are chained, so their delays add and the
    /// device's is their total. All six `BandChain`s are allocated up front
    /// while only `band_count` run, so a stale factor on an inactive band must
    /// not inflate the report either way.
    ///
    /// This is also the alignment target every band is padded out to (see
    /// `realign_bands`), and the dry mix tap with it, so every path through
    /// the device now presents this delay instead of the shorter ones
    /// undercutting it.
    ///
    /// Exact to the rounding below and no further. Host PDC is whole-sample
    /// while the underlying delays are not, so 8x delivers 11.375 against a
    /// reported 11 — 0.375 samples, 7.8 µs, in the under-reporting direction
    /// this file elsewhere calls the unsafe one. Correcting that means
    /// changing the reported number, which `reported_latency_tracks_the_
    /// oversampling_factor` pins deliberately; it wants its own change.
    ///
    /// The distortion stage now contributes too: Smudge is an overlap-add
    /// transform, a flat 2048 samples at 1x, divided by the factor when it runs
    /// inside the oversampled loop. `StftProcessor::latency_samples` is exact
    /// rather than estimated, so this is not the guessed number the omission
    /// note below used to be about.
    ///
    /// The `spectralEnabled` blur/freeze path contributes its own
    /// `StftProcessor` window on the same terms — see
    /// [`BandChain::spectral_latency_samples`] for why that one term reads an
    /// enable flag where the distortion window reads a configured mode.
    pub fn latency_samples(&self) -> u32 {
        let active = self.bands.iter().take(self.band_count);
        let total = if self.routing == RoutingMode::Serial {
            active.map(BandChain::latency_samples).sum::<f32>()
        } else {
            active
                .map(BandChain::latency_samples)
                .fold(0.0_f32, f32::max)
        };
        total.round() as u32
    }

    /// Get current modulation source values (for UI visualization).
    pub fn mod_source_values(&self) -> &[f32; MOD_SOURCE_COUNT] {
        &self.mod_values
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::primitives::alias_probe::bin_magnitude;
    use std::f32::consts::PI;

    /// Deterministic pseudo-white noise (LCG) in [-1, 1).
    fn noise_block(len: usize, seed: &mut u32) -> Vec<f32> {
        (0..len)
            .map(|_| {
                *seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (*seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0
            })
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    /// The parameter id `BACTERIA_DESCRIPTOR` advertises for per-band gain.
    ///
    /// Mirrored here as a literal because a Rust crate cannot read the
    /// TypeScript descriptor. `descriptorEngineParamWeld.spec.ts` is what keeps
    /// the two in step mechanically; this constant is what makes the engine
    /// side of the contract measurable.
    const DESCRIPTOR_BAND_GAIN_ID: &str = "gain";

    /// The descriptor declares per-band gain in dB over -24..+24 and marks it
    /// automatable, so a lane drawn at -12 dB has to arrive as -12 dB of
    /// attenuation — not merely as "some change".
    ///
    /// The descriptor advertised `bandGain`; the engine's arm is `gain`, and
    /// `BandChain::set_param`'s catch-all hands an unknown name to every
    /// sub-processor, each of which also ignores it. So the write returned
    /// successfully, changed nothing, and the drawn curve still persisted into
    /// the project file.
    #[test]
    fn descriptor_band_gain_id_attenuates_by_the_declared_db() {
        let block = 8192usize;
        let mut seed = 19u32;
        let input_l = noise_block(block, &mut seed);
        let input_r = noise_block(block, &mut seed);

        let mut unity = BacteriaEngine::new(48_000.0);
        let mut unity_l = input_l.clone();
        let mut unity_r = input_r.clone();
        unity.process_block(&mut unity_l, &mut unity_r);

        let mut attenuated = BacteriaEngine::new(48_000.0);
        attenuated.set_param(DESCRIPTOR_BAND_GAIN_ID, -12.0);
        let mut att_l = input_l.clone();
        let mut att_r = input_r.clone();
        attenuated.process_block(&mut att_l, &mut att_r);

        // Skip the 5 ms gain smoother (240 samples at 48 kHz) and the
        // crossover warmup; measure where the target has been reached.
        let tail = 2048..block;
        let ratio = rms(&att_l[tail.clone()]) / rms(&unity_l[tail]);
        let expected = 10.0_f32.powf(-12.0 / 20.0);

        assert!(
            (ratio - expected).abs() < 0.01,
            "-12 dB on `{DESCRIPTOR_BAND_GAIN_ID}` must scale the band by {expected:.4}x, got {ratio:.4}x"
        );
    }

    /// bandCount must reach the crossover: with 2 bands engaged, the high band
    /// receives signal (band_levels[1] rises above zero for broadband input).
    #[test]
    fn band_count_param_engages_multiband_split() {
        let mut engine = BacteriaEngine::new(48_000.0);
        engine.set_param("crossoverFreq1", 1000.0);
        engine.set_param("bandCount", 2.0);

        let mut seed = 42u32;
        let mut left = noise_block(2048, &mut seed);
        let mut right = noise_block(2048, &mut seed);
        engine.process_block(&mut left, &mut right);

        assert!(
            engine.band_levels()[1] > 0.0,
            "band 1 received no signal — multiband not engaged: {:?}",
            engine.band_levels()
        );
    }

    /// Signal-in/signal-out: a 2-band split with the high band muted must
    /// produce measurably different output from a 1-band passthrough of the
    /// same input. Pre-fix, bandCount is swallowed by the band-prefix guard,
    /// both engines run single-band, and the outputs are identical.
    #[test]
    fn two_band_split_differs_from_one_band_output() {
        let block = 4096usize;
        let mut seed = 7u32;
        let input_l = noise_block(block, &mut seed);
        let input_r = noise_block(block, &mut seed);

        // Engine A: default single band.
        let mut engine_a = BacteriaEngine::new(48_000.0);
        let mut a_l = input_l.clone();
        let mut a_r = input_r.clone();
        engine_a.process_block(&mut a_l, &mut a_r);

        // Engine B: two bands, high band muted -> highs must disappear.
        let mut engine_b = BacteriaEngine::new(48_000.0);
        engine_b.set_param("crossoverFreq1", 1000.0);
        engine_b.set_param("bandCount", 2.0);
        engine_b.set_param("band1_mute", 1.0);
        let mut b_l = input_l.clone();
        let mut b_r = input_r.clone();
        engine_b.process_block(&mut b_l, &mut b_r);

        // Compare over the settled tail (skip crossover/LR4 warmup).
        let tail = 1024..block;
        let diff: Vec<f32> = a_l[tail.clone()]
            .iter()
            .zip(b_l[tail.clone()].iter())
            .map(|(a, b)| a - b)
            .collect();
        let diff_rms = rms(&diff);
        let input_rms = rms(&input_l[tail]);
        assert!(
            diff_rms > 0.25 * input_rms,
            "2-band (high muted) output matches 1-band output — bandCount did not engage: diff_rms={diff_rms} input_rms={input_rms}"
        );
    }

    /// The oversampled distortion path has real group delay — 6.5 / 9.75 /
    /// 11.375 base samples at 2x / 4x / 8x, pinned in `oversample.rs` against
    /// the impulse centroid. This reported a hardcoded 0 for every factor, and
    /// Wave 3 feeds the number straight into host PDC, so it silently
    /// miscompensated by up to ~11 samples whenever oversampling was on.
    #[test]
    fn reported_latency_tracks_the_oversampling_factor() {
        for (factor, expected) in [(1.0_f32, 0_u32), (2.0, 7), (4.0, 10), (8.0, 11)] {
            let mut engine = BacteriaEngine::new(48_000.0);
            engine.set_param("oversampling", factor);
            assert_eq!(
                engine.latency_samples(),
                expected,
                "oversampling {factor}x must report {expected} samples of latency"
            );
        }
    }

    /// Bands are summed, so the report follows the longest ACTIVE band — and
    /// a stale factor on a band beyond `bandCount` must not inflate it.
    #[test]
    fn reported_latency_follows_the_longest_active_band() {
        let mut engine = BacteriaEngine::new(48_000.0);
        engine.set_param("bandCount", 2.0);
        engine.set_param("band0_oversampling", 2.0);
        engine.set_param("band1_oversampling", 8.0);
        assert_eq!(
            engine.latency_samples(),
            11,
            "the report must follow the 8x band, not the 2x one"
        );

        engine.set_param("band1_oversampling", 2.0);
        engine.set_param("band2_oversampling", 8.0);
        assert_eq!(
            engine.latency_samples(),
            7,
            "band 2 is beyond bandCount=2 and must not inflate the report"
        );
    }

    /// Base-rate group delay of one oversampling factor, mirroring
    /// `OversamplingChain::latency_samples` (pinned there against the impulse
    /// centroid).
    fn factor_latency(factor: f32) -> f32 {
        match factor as usize {
            2 => 6.5,
            4 => 9.75,
            8 => 11.375,
            _ => 0.0,
        }
    }

    /// One band's oversampling configuration for the summing probes below.
    ///
    /// The distortion flag matters as much as the factor: the oversampler is
    /// only in the path while the distortion stage runs, so a band carrying
    /// 8x with distortion off delays nothing.
    #[derive(Clone, Copy)]
    struct BandSetup {
        factor: f32,
        distortion: bool,
    }

    const SAMPLE_RATE: f32 = 48_000.0;

    /// Base-rate delay the band actually imposes with this setup.
    fn engaged_latency(setup: BandSetup) -> f32 {
        if setup.distortion {
            return factor_latency(setup.factor);
        }
        0.0
    }

    /// Magnitude at `freq` of the device output for a two-band split, with the
    /// crossover placed on `freq` so both bands carry half the tone and any
    /// cancellation between them is maximally exposed.
    ///
    /// Drive is zeroed and the probe kept small so the distortion stage stays
    /// near-linear — it has to be enabled for the oversampler to be in the
    /// path at all, but its harmonics must not pollute the fundamental bin.
    fn two_band_sum_magnitude(setups: [BandSetup; 2], freq: f32) -> f32 {
        const BLOCK: usize = 8_192;
        const WARMUP: usize = 2_048;
        const AMPLITUDE: f32 = 0.1;

        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        engine.set_param("crossoverFreq1", freq);
        engine.set_param("bandCount", 2.0);
        engine.set_param("drive", 0.0);
        for (index, setup) in setups.iter().enumerate() {
            let enabled = if setup.distortion { 1.0 } else { 0.0 };
            engine.set_param(&format!("band{index}_distortionEnabled"), enabled);
            engine.set_param(&format!("band{index}_oversampling"), setup.factor);
        }

        let mut left: Vec<f32> = (0..BLOCK)
            .map(|n| {
                let phase = 2.0 * PI * freq * n as f32 / SAMPLE_RATE;
                phase.sin() * AMPLITUDE
            })
            .collect();
        let mut right = left.clone();
        engine.process_block(&mut left, &mut right);

        bin_magnitude(&left[WARMUP..], freq, SAMPLE_RATE)
    }

    /// Bands are summed, so a per-band oversampling factor is also a per-band
    /// group delay: 11.375 base samples at 8x against 0 at 1x is ~0.24 ms at
    /// 48 kHz, putting a cancellation notch at ~2.1 kHz — audible, and landing
    /// exactly on a crossover if the preset placed one there. The same gap
    /// opens when two bands share a factor but only one runs its distortion,
    /// because the oversampler is bypassed with the stage it feeds.
    ///
    /// Each case is measured against the same split with both bands delayed
    /// equally. Pre-compensation every case retained ≤0.03x — near-total
    /// cancellation of the tone.
    #[test]
    fn bands_with_mismatched_group_delay_still_sum_across_the_crossover() {
        let driven = |factor: f32| BandSetup {
            factor,
            distortion: true,
        };
        let cases = [
            [driven(8.0), driven(1.0)],
            [driven(4.0), driven(1.0)],
            [driven(8.0), driven(2.0)],
            [driven(4.0), driven(2.0)],
            [
                driven(8.0),
                BandSetup {
                    factor: 8.0,
                    distortion: false,
                },
            ],
        ];

        for case in cases {
            let delta = engaged_latency(case[0]) - engaged_latency(case[1]);
            // The frequency whose half period equals the offset — the first
            // place the two bands arrive in antiphase.
            let probe = SAMPLE_RATE / (2.0 * delta);
            let reference = [case[0], case[0]];

            let matched = two_band_sum_magnitude(reference, probe);
            let mismatched = two_band_sum_magnitude(case, probe);
            assert!(
                matched > 1.0e-4,
                "the equal-delay reference collapsed at {probe:.0} Hz \
                 ({matched:.6}) — the comparison below would prove nothing"
            );

            let retained = mismatched / matched;
            assert!(
                retained > 0.9,
                "a band delayed {delta} samples more than its neighbour combs \
                 at their shared crossover: {retained:.3}x of the equal-delay \
                 magnitude survives at {probe:.0} Hz"
            );
        }
    }

    /// The compensation must land the device on its reported latency and no
    /// further: a band whose oversampler already runs gets no padding, and a
    /// band that skips it gets exactly enough to match.
    ///
    /// Measured as the abs-weighted centroid of the impulse response, the way
    /// `oversample.rs` pins the chain's own delay. The probe is tiny and drive
    /// is zeroed so the distortion stage stays near-linear and does not skew
    /// the centroid.
    #[test]
    fn device_delay_lands_on_the_configured_latency_target() {
        const IMPULSE: f32 = 0.01;
        const BLOCK: usize = 512;

        for factor in [1.0_f32, 2.0, 4.0, 8.0] {
            for distortion in [false, true] {
                let mut engine = BacteriaEngine::new(SAMPLE_RATE);
                engine.set_param("drive", 0.0);
                engine.set_param("distortionEnabled", if distortion { 1.0 } else { 0.0 });
                engine.set_param("oversampling", factor);

                let mut left = vec![0.0_f32; BLOCK];
                left[0] = IMPULSE;
                let mut right = left.clone();
                engine.process_block(&mut left, &mut right);

                let mut numerator = 0.0_f32;
                let mut denominator = 0.0_f32;
                for (n, &sample) in left.iter().enumerate() {
                    numerator += n as f32 * sample.abs();
                    denominator += sample.abs();
                }
                let centroid = numerator / denominator;

                // Every band shares one factor here, so the target is that
                // factor's own delay whether or not the stage that carries it
                // is switched on.
                let target = factor_latency(factor);
                assert!(
                    (centroid - target).abs() < 0.55,
                    "{factor}x (distortion {distortion}) must present {target} \
                     samples of delay, measured centroid {centroid:.3}"
                );
            }
        }
    }

    /// Every band's alignment ring has to keep moving even when the band is
    /// skipped, or the moment it comes back it flushes out audio from before
    /// the skip. Probed here through the paths that skip a band without
    /// calling `process_sample`: solo, mid/side, and bypass.
    ///
    /// The ring is checked directly rather than through the output, because
    /// the stale audio is a handful of samples wide and a level assertion
    /// would not distinguish it from the band's normal signal.
    #[test]
    fn skipped_bands_keep_their_alignment_rings_moving() {
        const PROBE_BLOCK: usize = 70;

        // Returns (frames the ring advanced, loudest sample left in it).
        let advance = |configure: &dyn Fn(&mut BacteriaEngine), band: usize| -> (usize, f32) {
            let mut engine = BacteriaEngine::new(SAMPLE_RATE);
            engine.set_param("bandCount", 3.0);
            engine.set_param("distortionEnabled", 1.0);
            engine.set_param("oversampling", 8.0);
            configure(&mut engine);

            let before = engine.bands[band].alignment.write;
            let mut left = vec![0.1_f32; PROBE_BLOCK];
            let mut right = vec![0.1_f32; PROBE_BLOCK];
            engine.process_block(&mut left, &mut right);

            let ring = &engine.bands[band].alignment;
            let frames = (ring.write + ALIGNMENT_RING_LEN - before) % ALIGNMENT_RING_LEN;
            // A skipped band contributes nothing, so what it clocks through
            // must be silence. Advancing the pointer while writing signal
            // would still satisfy the frame count and hand the band a blip
            // to emit the moment it comes back.
            let loudest = ring
                .left
                .iter()
                .chain(ring.right.iter())
                .fold(0.0_f32, |worst, s| worst.max(s.abs()));
            (frames, loudest)
        };

        // A block that is a whole number of ring laps lands the write pointer
        // back where it started, which is indistinguishable from frozen.
        let expected = PROBE_BLOCK % ALIGNMENT_RING_LEN;
        assert_ne!(expected, 0, "probe block length must not alias the ring");

        let cases = [
            // Band 1 is skipped because band 0 is soloed.
            ("solo", 1usize, 1.0_f32, "band0_solo"),
            // Mid/side drives bands 0 and 1 only; band 2 is skipped.
            ("mid/side", 2, 2.0, "globalRouting"),
            // Bypass skips every band.
            ("bypass", 1, 1.0, "bypass"),
        ];

        for (label, band, value, param) in cases {
            let (frames, loudest) = advance(&|engine| engine.set_param(param, value), band);
            assert_eq!(
                frames, expected,
                "{label} froze band {band}'s ring ({frames} of {expected} frames)"
            );
            assert!(
                loudest == 0.0,
                "{label} clocked {loudest} through band {band}'s ring instead of silence"
            );
        }
    }

    /// A band dropping below `bandCount` stops being advanced at all — no
    /// `process_sample`, no `skip_sample` — so its ring freezes holding real
    /// audio. Raising the count back over that index must not flush it out.
    ///
    /// Driven with silence after the count is restored, so anything the band
    /// emits came from before the shrink.
    #[test]
    fn a_band_dropped_by_band_count_does_not_replay_stale_audio() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        engine.set_param("bandCount", 4.0);
        engine.set_param("distortionEnabled", 1.0);
        engine.set_param("oversampling", 8.0);
        engine.set_param("band3_oversampling", 1.0);

        // Fill band 3's ring with real content.
        let mut seed = 3u32;
        let mut left = noise_block(256, &mut seed);
        let mut right = noise_block(256, &mut seed);
        engine.process_block(&mut left, &mut right);

        // Drop it out of the sum, then bring it back.
        engine.set_param("bandCount", 1.0);
        engine.set_param("bandCount", 4.0);
        engine.set_param("band3_solo", 1.0);

        // Silence in: any output is stale audio from before the shrink.
        let mut silent_l = vec![0.0_f32; 64];
        let mut silent_r = vec![0.0_f32; 64];
        engine.process_block(&mut silent_l, &mut silent_r);

        let leaked = silent_l
            .iter()
            .chain(silent_r.iter())
            .fold(0.0_f32, |worst, s| worst.max(s.abs()));
        assert!(
            leaked < 1.0e-6,
            "band 3 flushed {leaked:.4} of pre-shrink audio when bandCount grew back"
        );
    }

    /// Muting a band with the frequency shifter running must empty the shifter,
    /// not pause it.
    ///
    /// The Hilbert network is eight all-pass sections with pole radius up to
    /// 0.9987 — ~5500 samples of memory, where the collapsed one-pole structure
    /// it replaced held about one. A frozen network keeps the whole burst and
    /// hands it back on the first samples after the unmute, above full scale,
    /// on every band at once.
    #[test]
    fn unmuting_a_band_does_not_flush_the_frequency_shifter() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        engine.set_param("freqShiftEnabled", 1.0);
        engine.set_param("freqShiftHz", 200.0);
        engine.set_param("freqShiftMix", 1.0);

        // Load the network up with loud audio.
        for block in 0..40usize {
            let mut left: Vec<f32> = (0..512usize)
                .map(|i| {
                    let n = (block * 512 + i) % 4_800;
                    (2.0 * PI * 440.0 * n as f32 / SAMPLE_RATE).sin()
                })
                .collect();
            let mut right = left.clone();
            engine.process_block(&mut left, &mut right);
        }

        // Mute, run a little, unmute — the ordinary performance gesture.
        engine.set_param("mute", 1.0);
        let mut muted_l = vec![0.0_f32; 64];
        let mut muted_r = vec![0.0_f32; 64];
        engine.process_block(&mut muted_l, &mut muted_r);
        engine.set_param("mute", 0.0);

        let mut silent_l = vec![0.0_f32; 8_192];
        let mut silent_r = vec![0.0_f32; 8_192];
        engine.process_block(&mut silent_l, &mut silent_r);

        let burst = silent_l
            .iter()
            .chain(silent_r.iter())
            .fold(0.0_f32, |worst, s| worst.max(s.abs()));
        assert!(
            burst < 1.0e-3,
            "unmuting over silence produced {burst} ({:.1} dBFS) — the frequency \
             shifter flushed what it was holding while muted",
            20.0 * burst.max(1e-12).log10()
        );
    }

    /// The lo-fi codec's framed transform delays the band, so the band has to
    /// say so. Its frames are per channel and base-rate, so it is a flat 256.
    #[test]
    fn reported_latency_includes_the_lofi_codec_frame() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        let quiet = engine.latency_samples();

        engine.set_param("codecArtifact", 0.5);
        assert_eq!(
            engine.latency_samples(),
            quiet + 256,
            "engaging the codec added delay the host was never told about"
        );

        engine.set_param("codecArtifact", 0.0);
        assert_eq!(
            engine.latency_samples(),
            quiet,
            "the codec kept reporting delay after being switched off"
        );
    }

    /// The wet path costs up to 11.375 samples through an oversampled band.
    /// Blended against an undelayed dry tap that is the same comb this change
    /// removes between bands, just across the wet/dry mix — invisible at the
    /// default `mix` 1.0 and deepest at 0.5.
    ///
    /// Probed at the notch frequency for a 1-band 8x configuration, against
    /// the same mix with no oversampling (where dry and wet already agree).
    #[test]
    fn the_dry_tap_stays_aligned_with_the_wet_path() {
        const BLOCK: usize = 8_192;
        const WARMUP: usize = 2_048;
        const AMPLITUDE: f32 = 0.1;

        // 11.375 samples of wet delay puts the first cancellation here.
        let probe = SAMPLE_RATE / (2.0 * 11.375);

        let render = |factor: f32| -> f32 {
            let mut engine = BacteriaEngine::new(SAMPLE_RATE);
            engine.set_param("drive", 0.0);
            engine.set_param("distortionEnabled", 1.0);
            engine.set_param("oversampling", factor);
            engine.set_param("mix", 0.5);

            let mut left: Vec<f32> = (0..BLOCK)
                .map(|n| {
                    let phase = 2.0 * PI * probe * n as f32 / SAMPLE_RATE;
                    phase.sin() * AMPLITUDE
                })
                .collect();
            let mut right = left.clone();
            engine.process_block(&mut left, &mut right);
            bin_magnitude(&left[WARMUP..], probe, SAMPLE_RATE)
        };

        let aligned = render(1.0);
        let oversampled = render(8.0);
        assert!(
            aligned > 1.0e-4,
            "the 1x reference collapsed ({aligned:.6}) — nothing to compare against"
        );

        let retained = oversampled / aligned;
        assert!(
            retained > 0.9,
            "at mix 0.5 the oversampled wet path combs against the dry tap: \
             {retained:.3}x of the 1x magnitude survives at {probe:.0} Hz"
        );
    }

    /// `globalRouting` values, mirroring `ROUTING_MODE_INDEX` in
    /// `bacteriaParamBridge/helpers.ts`. `serial` is the shipped patch default.
    const ROUTING_SERIAL: f32 = 0.0;
    const ROUTING_PARALLEL: f32 = 1.0;

    // ---- wasm boundary --------------------------------------------------

    /// `source_id` is a `u8` from the wasm boundary and `mod_values` holds
    /// sixteen entries, so the per-sample matrix pass indexed an array of 16
    /// with a number up to 255. In a wasm build the resulting panic aborts,
    /// and the thread it aborts is the AudioWorklet's: the track goes silent
    /// and stays silent until the graph is rebuilt.
    ///
    /// Rejected at the setter rather than clamped, so this also asserts the
    /// call changed nothing — a clamp would have quietly modulated from
    /// whichever source the clamp landed on.
    #[test]
    fn a_modulation_source_that_does_not_exist_is_a_safe_no_op() {
        let mut seed = 91u32;
        let input_l = noise_block(2048, &mut seed);
        let input_r = noise_block(2048, &mut seed);

        let mut reference = BacteriaEngine::new(SAMPLE_RATE);
        let mut reference_l = input_l.clone();
        let mut reference_r = input_r.clone();
        reference.process_block(&mut reference_l, &mut reference_r);

        let mut hostile = BacteriaEngine::new(SAMPLE_RATE);
        for source_id in [MOD_SOURCE_COUNT as u8, 100, u8::MAX] {
            hostile.add_mod_assignment(source_id, 1, 1.0);
        }
        hostile.add_mod_assignment(0, u16::MAX, 1.0);
        assert_eq!(
            hostile.mod_assignments.len(),
            0,
            "an assignment naming a source or target that does not exist was stored"
        );

        let mut hostile_l = input_l.clone();
        let mut hostile_r = input_r.clone();
        hostile.process_block(&mut hostile_l, &mut hostile_r);

        assert_eq!(
            hostile_l, reference_l,
            "a rejected assignment still moved the output"
        );
    }

    /// Same boundary, the other table: `macro_index` is a `u8` indexing eight
    /// macros.
    #[test]
    fn a_macro_index_that_does_not_exist_is_a_safe_no_op() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        for macro_index in [MACRO_COUNT as u8, 40, u8::MAX] {
            engine.add_macro_mapping(macro_index, 1, 0.0, 1.0);
        }
        engine.add_macro_mapping(0, u16::MAX, 0.0, 1.0);
        assert_eq!(
            engine.macro_mappings.len(),
            0,
            "a mapping naming a macro or target that does not exist was stored"
        );

        let mut seed = 5u32;
        let mut left = noise_block(512, &mut seed);
        let mut right = noise_block(512, &mut seed);
        engine.process_block(&mut left, &mut right);
    }

    /// `add_macro_mapping` had no ceiling at all where `add_mod_assignment`
    /// had one. It is a wasm export reached from the worklet, so every push
    /// past capacity reallocated on the audio thread, and nothing ever removed
    /// an entry — a caller re-sending its mapping table grew both the
    /// allocation and the per-sample pass without bound.
    ///
    /// The capacity assertion is the allocation claim: `new` reserves the
    /// ceiling, so a bounded table never reallocates.
    #[test]
    fn macro_mappings_stop_at_their_ceiling_without_reallocating() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        let reserved = engine.macro_mappings.capacity();
        assert_eq!(reserved, MAX_MACRO_MAPPINGS);

        for _ in 0..(MAX_MACRO_MAPPINGS * 8) {
            engine.add_macro_mapping(0, 1, 0.0, 1.0);
        }

        assert_eq!(engine.macro_mappings.len(), MAX_MACRO_MAPPINGS);
        assert_eq!(
            engine.macro_mappings.capacity(),
            reserved,
            "the mapping table reallocated on the audio thread"
        );
    }

    // ---- crossover ordering ---------------------------------------------

    /// The corners feed a cascade — corner `i` splits what corner `i-1` passed
    /// upward — so an inverted pair does not make an unusual split, it makes a
    /// broken one: the band between them low-passes a higher high-pass and
    /// carries nothing, while its content stays folded into a neighbour and
    /// the panel goes on displaying the corners the user asked for.
    ///
    /// Every write order is checked, because this setter is the path a
    /// preset load and an automation lane take as well as a knob drag.
    #[test]
    fn crossover_corners_stay_ordered_however_they_are_written() {
        let writes = [
            // A single corner dragged above the ones over it.
            vec![("crossoverFreq1", 15_000.0_f32)],
            // And below the ones under it.
            vec![("crossoverFreq5", 30.0_f32)],
            // A pair inverted against each other, both orders.
            vec![("crossoverFreq2", 9_000.0), ("crossoverFreq3", 300.0)],
            vec![("crossoverFreq3", 300.0), ("crossoverFreq2", 9_000.0)],
            // The whole set written backwards.
            vec![
                ("crossoverFreq1", 12_000.0),
                ("crossoverFreq2", 6_000.0),
                ("crossoverFreq3", 2_500.0),
                ("crossoverFreq4", 800.0),
                ("crossoverFreq5", 200.0),
            ],
        ];

        for sequence in writes {
            let mut engine = BacteriaEngine::new(SAMPLE_RATE);
            engine.set_param("bandCount", 6.0);
            for (name, value) in &sequence {
                engine.set_param(name, *value);
            }

            let corners = engine.crossover_freqs;
            assert!(
                corners.windows(2).all(|pair| pair[0] <= pair[1]),
                "{sequence:?} left the corners inverted: {corners:?}"
            );

            // The value written last is the one the caller most recently
            // asked for, so it is the one that must survive intact.
            let (last_name, last_value) = sequence.last().expect("sequence is not empty");
            let index = last_name["crossoverFreq".len()..]
                .parse::<usize>()
                .expect("crossover name carries its index")
                - 1;
            assert_eq!(
                corners[index], *last_value,
                "{last_name} was written as {last_value} and stored as {}",
                corners[index]
            );
        }
    }

    /// Ordering is restored by yielding the neighbours rather than clamping
    /// the value just written, and this is why: corners reach the engine one
    /// at a time in descriptor order, so a preset moving the whole set
    /// *downward* would have every corner blocked by the old, higher one below
    /// it and land nowhere near what it asked for.
    #[test]
    fn a_preset_lowering_every_corner_lands_on_the_values_it_asked_for() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        engine.set_param("bandCount", 6.0);

        let wanted = [80.0_f32, 300.0, 900.0, 2_000.0, 4_500.0];
        for (index, value) in wanted.iter().enumerate() {
            engine.set_param(&format!("crossoverFreq{}", index + 1), *value);
        }

        assert_eq!(
            engine.crossover_freqs, wanted,
            "an ascending write of a lower corner set was blocked by the old corners"
        );
    }

    /// Corners are also held inside the range the descriptor declares, since
    /// `CrossoverEngine::set_bands` clamps on the way into the biquads and a
    /// stored corner outside it would disagree with the filter it configured.
    #[test]
    fn crossover_corners_are_held_inside_the_declared_range() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        engine.set_param("crossoverFreq1", -5_000.0);
        assert_eq!(engine.crossover_freqs[0], MIN_CROSSOVER_HZ);

        engine.set_param("crossoverFreq5", 96_000.0);
        assert_eq!(engine.crossover_freqs[4], MAX_CROSSOVER_HZ);
    }

    // ---- serial routing --------------------------------------------------

    /// `Serial` shared an arm with `Parallel` and summed band slices exactly
    /// like it, so the routing chip changed nothing — on the mode the shipped
    /// patch selects by default.
    ///
    /// Probed where chaining is the whole difference: band 0 clips hard and
    /// band 1 low-passes. Summed, the filter never sees the clipper's
    /// harmonics because they are in another band's slice. Chained, it removes
    /// them, and the two outputs cannot agree.
    #[test]
    fn serial_routing_chains_the_bands_instead_of_summing_them() {
        const BLOCK: usize = 8_192;

        let render = |routing: f32| -> Vec<f32> {
            let mut engine = BacteriaEngine::new(SAMPLE_RATE);
            engine.set_param("bandCount", 2.0);
            engine.set_param("crossoverFreq1", 1_000.0);
            engine.set_param("mix", 1.0);

            engine.set_param("band0_distortionEnabled", 1.0);
            engine.set_param("band0_distortionMode", 1.0); // hard clip
            engine.set_param("band0_drive", 12.0);

            engine.set_param("band1_filterEnabled", 1.0);
            engine.set_param("band1_filterMode", 0.0); // low pass
            engine.set_param("band1_filterCutoff", 300.0);

            engine.set_param("globalRouting", routing);

            let mut seed = 23u32;
            let mut left = noise_block(BLOCK, &mut seed);
            let mut right = noise_block(BLOCK, &mut seed);
            engine.process_block(&mut left, &mut right);
            left
        };

        let serial = render(ROUTING_SERIAL);
        let parallel = render(ROUTING_PARALLEL);

        let tail = 2_048..BLOCK;
        let difference: Vec<f32> = serial[tail.clone()]
            .iter()
            .zip(parallel[tail.clone()].iter())
            .map(|(s, p)| s - p)
            .collect();

        let parallel_rms = rms(&parallel[tail]);
        assert!(
            parallel_rms > 1.0e-3,
            "the parallel reference is silent ({parallel_rms}) — nothing to compare against"
        );
        let difference_rms = rms(&difference);
        assert!(
            difference_rms > 0.25 * parallel_rms,
            "serial and parallel routing produced the same audio \
             (difference {difference_rms:.5} against {parallel_rms:.5}) — the bands are \
             still being summed rather than chained"
        );
    }

    /// A chain's delays add where a sum's do not, so the number handed to host
    /// PDC has to follow the routing. Reported as the longest band under a
    /// sum, it would undercut a serial cascade by every band after the first.
    #[test]
    fn serial_routing_reports_the_whole_chains_delay() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        engine.set_param("bandCount", 2.0);
        engine.set_param("distortionEnabled", 1.0);
        engine.set_param("oversampling", 8.0);

        engine.set_param("globalRouting", ROUTING_PARALLEL);
        let summed = engine.latency_samples();
        assert_eq!(summed, 11, "two 8x bands summed present one band's delay");

        engine.set_param("globalRouting", ROUTING_SERIAL);
        assert_eq!(
            engine.latency_samples(),
            23,
            "chained, the two 8x bands present 2 × 11.375 samples"
        );
    }

    /// Soloing or muting a link in a chain bypasses it; it does not cut the
    /// chain. The signal still has to reach the bands after it, and it still
    /// has to carry the skipped band's alignment, or a monitoring gesture
    /// would move the delay the host was told to expect.
    #[test]
    fn a_soloed_serial_chain_still_passes_signal_to_the_bands_after_it() {
        const BLOCK: usize = 4_096;

        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        engine.set_param("bandCount", 3.0);
        engine.set_param("mix", 1.0);
        engine.set_param("globalRouting", ROUTING_SERIAL);
        // Solo the *first* link: bands 1 and 2 are bypassed, and a chain that
        // cut at a bypass would emit nothing at all.
        engine.set_param("band0_solo", 1.0);

        let mut seed = 61u32;
        let mut left = noise_block(BLOCK, &mut seed);
        let mut right = noise_block(BLOCK, &mut seed);
        let input_rms = rms(&left[1_024..]);
        engine.process_block(&mut left, &mut right);

        let output_rms = rms(&left[1_024..]);
        assert!(
            output_rms > 0.5 * input_rms,
            "soloing the first link of a serial chain silenced the device \
             ({output_rms:.5} out of {input_rms:.5})"
        );
    }

    // ---- band metering ---------------------------------------------------

    /// A band the routing skips produced nothing, so its meter has to say so.
    /// Only the bands that were processed had their level published, which
    /// left every other bar standing at whatever the band was playing the
    /// instant it was skipped — soloing one band froze the rest of the meters
    /// rather than dropping them.
    #[test]
    fn the_meter_of_a_skipped_band_falls() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        engine.set_param("bandCount", 3.0);
        engine.set_param("crossoverFreq1", 500.0);
        engine.set_param("crossoverFreq2", 4_000.0);

        let mut seed = 17u32;
        let mut left = noise_block(4_096, &mut seed);
        let mut right = noise_block(4_096, &mut seed);
        engine.process_block(&mut left, &mut right);

        let loaded = engine.band_levels()[1];
        assert!(
            loaded > 1.0e-3,
            "band 1 never registered a level to fall from ({loaded})"
        );

        // Solo band 0 and keep the same signal running: band 1 is skipped from
        // here on, so its bar has to come down.
        engine.set_param("band0_solo", 1.0);
        for _ in 0..8 {
            let mut solo_l = noise_block(4_096, &mut seed);
            let mut solo_r = noise_block(4_096, &mut seed);
            engine.process_block(&mut solo_l, &mut solo_r);
        }

        let skipped = engine.band_levels()[1];
        assert!(
            skipped < 0.01 * loaded,
            "band 1's meter held {skipped} of its {loaded} after being soloed away"
        );
    }

    /// The same for a band dropped below `bandCount`, which is not advanced at
    /// all — with the transport stopped no block would ever run to clear it,
    /// so the count change itself has to.
    #[test]
    fn dropping_a_band_below_the_count_clears_its_meter() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        engine.set_param("bandCount", 3.0);
        engine.set_param("crossoverFreq1", 500.0);

        let mut seed = 29u32;
        let mut left = noise_block(2_048, &mut seed);
        let mut right = noise_block(2_048, &mut seed);
        engine.process_block(&mut left, &mut right);
        assert!(engine.band_levels()[2] > 1.0e-4);

        engine.set_param("bandCount", 1.0);
        assert_eq!(
            engine.band_levels()[2],
            0.0,
            "band 2 kept its bar after dropping out of the band count"
        );
    }

    // ---- modulation matrix ------------------------------------------------

    /// The matrix pass cleared all 1024 offset slots on the way into every
    /// sample — 4 kB of stores, ~49 M/s at 48 kHz — to make room for at most a
    /// handful of live modulations, and did it before checking whether there
    /// were any. Only the slots something targets are cleared now, so the
    /// clearing has to actually reach them: an offset that is accumulated
    /// without being cleared grows by its own value every sample.
    ///
    /// Read straight off the offset array, because a level assertion could not
    /// tell an offset of 0.5 from one of 0.5 × block length once the gain
    /// clamp and the smoother are in the way.
    #[test]
    fn a_modulation_offset_is_recomputed_each_sample_rather_than_accumulated() {
        const OFFSET: f32 = 0.5;
        const BAND_0_GAIN_TARGET: u16 = 1;

        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        // A macro mapping is a constant source, so the expected offset is
        // exactly its mapped value on every sample.
        engine.add_macro_mapping(0, BAND_0_GAIN_TARGET, OFFSET, OFFSET);

        let mut seed = 11u32;
        let mut left = noise_block(1_024, &mut seed);
        let mut right = noise_block(1_024, &mut seed);
        engine.process_block(&mut left, &mut right);

        let offset = engine.param_offsets[BAND_0_GAIN_TARGET as usize];
        assert!(
            (offset - OFFSET).abs() < 1.0e-4,
            "the band 0 gain offset reached {offset} against a constant {OFFSET} — \
             the matrix is accumulating across samples instead of being recomputed"
        );
    }

    /// With nothing assigned — the state every shipped preset is in — the pass
    /// does no work at all, and the offsets it would have written stay zero so
    /// the mix and the band gains are untouched.
    #[test]
    fn an_unmodulated_engine_leaves_every_offset_alone() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        let mut seed = 13u32;
        let mut left = noise_block(512, &mut seed);
        let mut right = noise_block(512, &mut seed);
        engine.process_block(&mut left, &mut right);

        assert_eq!(engine.modulated_target_count, 0);
        assert!(engine.param_offsets.iter().all(|offset| *offset == 0.0));
    }

    /// The macros are mirrored into the modulation source table at control
    /// rate now rather than being re-copied for all eight on every sample.
    /// That mirror is what a macro-sourced assignment reads, so it has to be
    /// current before the first sample of the block that follows the move —
    /// and correct at rest, since the macros start centred rather than at zero.
    #[test]
    fn a_macro_reaches_the_matrix_as_a_modulation_source() {
        const MACRO_1_SOURCE: u8 = MACRO_SOURCE_BASE as u8;
        const MIX_TARGET: u16 = 0;

        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        engine.add_mod_assignment(MACRO_1_SOURCE, MIX_TARGET, 1.0);

        let mut seed = 3u32;
        let mut left = noise_block(64, &mut seed);
        let mut right = noise_block(64, &mut seed);
        engine.process_block(&mut left, &mut right);
        assert!(
            (engine.param_offsets[MIX_TARGET as usize] - DEFAULT_MACRO).abs() < 1.0e-6,
            "a macro at rest reached the matrix as {}",
            engine.param_offsets[MIX_TARGET as usize]
        );

        engine.set_param("macro1", 0.25);
        let mut moved_l = noise_block(64, &mut seed);
        let mut moved_r = noise_block(64, &mut seed);
        engine.process_block(&mut moved_l, &mut moved_r);
        assert!(
            (engine.param_offsets[MIX_TARGET as usize] - 0.25).abs() < 1.0e-6,
            "moving macro1 did not reach the matrix: {}",
            engine.param_offsets[MIX_TARGET as usize]
        );
    }

    // ---- spectral path ---------------------------------------------------

    /// The blur/freeze stage rendered the raw overlap-add reconstruction,
    /// which for a Hann pair at a hop of N/4 carries a gain of exactly 3/2.
    /// Switching `spectralEnabled` on therefore added +3.5 dB to the band on
    /// top of whatever the blur did. The correction had landed on the Smudge
    /// wrapper only.
    ///
    /// Measured through the one configuration where the transform is an
    /// identity — `spectralBlur` 0 passes magnitudes and phases untouched — so
    /// the only thing left between the two renders is the gain.
    #[test]
    fn the_spectral_stage_does_not_change_the_bands_level() {
        const BLOCK: usize = 32_768;
        // Past the stage's own 2048-sample window and the crossover warmup.
        const TAIL: usize = 8_192;

        let render = |spectral: f32| -> f32 {
            let mut engine = BacteriaEngine::new(SAMPLE_RATE);
            engine.set_param("mix", 1.0);
            engine.set_param("spectralBlur", 0.0);
            engine.set_param("spectralMix", 1.0);
            engine.set_param("spectralEnabled", spectral);

            let mut seed = 77u32;
            let mut left = noise_block(BLOCK, &mut seed);
            let mut right = noise_block(BLOCK, &mut seed);
            engine.process_block(&mut left, &mut right);
            rms(&left[TAIL..])
        };

        let bypassed = render(0.0);
        let engaged = render(1.0);
        assert!(bypassed > 1.0e-3, "the reference render is silent");

        let gain_db = 20.0 * (engaged / bypassed).log10();
        assert!(
            gain_db.abs() < 0.5,
            "switching the spectral stage on moved the band {gain_db:+.2} dB; \
             the overlap-add gain is not being divided back out"
        );
    }

    /// The stage costs a whole analysis window and the host was never told.
    /// The lo-fi codec's frame is folded in on exactly these terms — see
    /// `reported_latency_includes_the_lofi_codec_frame` — and this is the same
    /// omission on the other transform in the band.
    #[test]
    fn reported_latency_includes_the_spectral_window() {
        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        let quiet = engine.latency_samples();

        engine.set_param("spectralEnabled", 1.0);
        assert_eq!(
            engine.latency_samples(),
            quiet + 2_048,
            "engaging the spectral stage added delay the host was never told about"
        );

        engine.set_param("spectralEnabled", 0.0);
        assert_eq!(
            engine.latency_samples(),
            quiet,
            "the spectral stage kept reporting delay after being switched off"
        );
    }

    /// And it has to deliver the delay it reports, not merely declare it:
    /// the stage holds its own dry tap back to match, so the whole band
    /// arrives one window late rather than half of it arriving on time.
    ///
    /// Measured as the abs-weighted centroid of the impulse response, the way
    /// `device_delay_lands_on_the_configured_latency_target` measures the
    /// oversampled path.
    #[test]
    fn the_spectral_band_delivers_the_delay_it_reports() {
        const IMPULSE: f32 = 0.5;
        const BLOCK: usize = 16_384;

        let mut engine = BacteriaEngine::new(SAMPLE_RATE);
        engine.set_param("mix", 1.0);
        engine.set_param("spectralBlur", 0.0);
        engine.set_param("spectralMix", 0.5);
        engine.set_param("spectralEnabled", 1.0);

        let mut left = vec![0.0_f32; BLOCK];
        left[0] = IMPULSE;
        let mut right = left.clone();
        engine.process_block(&mut left, &mut right);

        let mut numerator = 0.0_f32;
        let mut denominator = 0.0_f32;
        for (index, sample) in left.iter().enumerate() {
            numerator += index as f32 * sample.abs();
            denominator += sample.abs();
        }
        assert!(denominator > 1.0e-4, "the impulse never came out");
        let centroid = numerator / denominator;

        let reported = engine.latency_samples() as f32;
        assert!(
            (centroid - reported).abs() < 8.0,
            "the spectral band reports {reported} samples of delay and delivers a \
             centroid of {centroid:.1} — half its output is arriving a window early"
        );
    }
}
