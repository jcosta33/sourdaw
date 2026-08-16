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

/// Ring size for the per-band alignment delay.
///
/// It has to cover the largest deficit any band can be asked to make up, which
/// is the whole latency of the slowest band measured against a band with none.
/// The oversampler contributes at most 11.375 base-rate samples (8x); Smudge's
/// overlap-add window contributes 2048 more at 1x, and less as the factor
/// divides it. 2060 is the worst case; 4096 is the next power of two, so the
/// wrap still compiles to a mask.
///
/// Heap-backed rather than a `[f32; ALIGNMENT_RING_LEN]` inside `BandChain`:
/// at this length the inline arrays would put ~200 kB of `BacteriaEngine`
/// through a by-value return on the worklet thread's stack. Sized once in
/// `new`, never resized, so changing the compensation still never allocates.
const ALIGNMENT_RING_LEN: usize = 4096;

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
    delay: usize,
}

impl AlignmentDelay {
    fn new() -> Self {
        Self {
            left: vec![0.0; ALIGNMENT_RING_LEN],
            right: vec![0.0; ALIGNMENT_RING_LEN],
            write: 0,
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
        self.delay = delay.min(ALIGNMENT_RING_LEN - 1);
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
        let read = (self.write + ALIGNMENT_RING_LEN - self.delay) % ALIGNMENT_RING_LEN;
        let output = (self.left[read], self.right[read]);
        self.write = (self.write + 1) % ALIGNMENT_RING_LEN;
        output
    }
}

/// Modulation assignment: source → target with amount.
#[derive(Clone)]
#[allow(dead_code)]
struct ModAssignment {
    source_id: u8,
    target_param: u16,
    amount: f32,
    active: bool,
}

/// Macro mapping entry.
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
            alignment: AlignmentDelay::new(),
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
            "spectralEnabled" => self.spectral_enabled = value > 0.5,
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
    fn latency_samples(&self) -> f32 {
        self.oversampler_l.latency_samples() + self.distortion_latency_samples()
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
    fn engaged_latency_samples(&self) -> f32 {
        if !self.distortion_enabled {
            return 0.0;
        }

        let mut engaged = self.distortion_latency_samples();
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
    fn skip_sample(&mut self) {
        self.alignment.process(0.0, 0.0);
    }

    /// Drop the band's in-flight alignment audio.
    ///
    /// For a band dropping out of the sum entirely (`bandCount` shrinking),
    /// which stops even `skip_sample` from reaching it. Its ring would
    /// otherwise sit frozen on real audio and flush it the moment the count
    /// grows back over this index.
    fn clear_alignment(&mut self) {
        self.alignment.reset();
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

/// Routing mode.
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
    mod_values: [f32; 16],

    // Modulation assignments
    mod_assignments: Vec<ModAssignment>,

    // Macro mapping
    macro_mappings: Vec<MacroMapping>,

    // Macros
    macros: [f32; 8],

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

    // Computed parameter offsets per-block from modulations.
    // Convention: [0] = global mix; [1..=6] = per-band gain offsets (linear scale, bands 0-5).
    param_offsets: [f32; 1024],
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
            mod_values: [0.0; 16],
            mod_assignments: Vec::new(),
            macro_mappings: Vec::new(),
            macros: [0.5; 8],
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
            dry_alignment: AlignmentDelay::new(),
            param_offsets: [0.0; 1024],
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
    }

    /// Equalize the group delay of every band feeding the sum.
    ///
    /// The target is the worst case over active bands derived from their
    /// configured factors — the same number [`Self::latency_samples`] reports
    /// to the host — so the report stays exactly what the device delivers.
    fn realign_bands(&mut self) {
        let target = self
            .bands
            .iter()
            .take(self.band_count)
            .map(BandChain::latency_samples)
            .fold(0.0_f32, f32::max);
        for (index, band) in self.bands.iter_mut().enumerate() {
            // Bands past `bandCount` contribute nothing to the sum and must
            // not hold a stale delay into a later band-count change.
            if index < self.band_count {
                band.set_alignment_target(target);
            } else {
                band.set_alignment_target(0.0);
                // Nothing advances a band past `bandCount` — not even
                // `skip_sample` — so its ring has to be emptied here or it
                // replays pre-shrink audio when the count grows back.
                // Idempotent, and this only ever runs at control rate.
                band.clear_alignment();
            }
        }
        // The dry mix tap bypasses the bands entirely, so it needs the whole
        // target rather than a deficit against something it already spent.
        self.dry_alignment.set_delay(target.round() as usize);
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
            "crossoverFreq1" => {
                self.crossover_freqs[0] = value;
                self.crossover
                    .set_bands(self.band_count, &self.crossover_freqs);
            }
            "crossoverFreq2" => {
                self.crossover_freqs[1] = value;
                self.crossover
                    .set_bands(self.band_count, &self.crossover_freqs);
            }
            "crossoverFreq3" => {
                self.crossover_freqs[2] = value;
                self.crossover
                    .set_bands(self.band_count, &self.crossover_freqs);
            }
            "crossoverFreq4" => {
                self.crossover_freqs[3] = value;
                self.crossover
                    .set_bands(self.band_count, &self.crossover_freqs);
            }
            "crossoverFreq5" => {
                self.crossover_freqs[4] = value;
                self.crossover
                    .set_bands(self.band_count, &self.crossover_freqs);
            }
            "crossoverSlope" | "crossoverMode" => {}

            // Routing
            "globalRouting" => self.routing = RoutingMode::from_index(value as u32),

            // Macros
            "macro1" => self.macros[0] = value,
            "macro2" => self.macros[1] = value,
            "macro3" => self.macros[2] = value,
            "macro4" => self.macros[3] = value,
            "macro5" => self.macros[4] = value,
            "macro6" => self.macros[5] = value,
            "macro7" => self.macros[6] = value,
            "macro8" => self.macros[7] = value,

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

    /// Add a modulation assignment.
    pub fn add_mod_assignment(&mut self, source_id: u8, target_param: u16, amount: f32) {
        if self.mod_assignments.len() < MAX_MOD_ASSIGNMENTS {
            self.mod_assignments.push(ModAssignment {
                source_id,
                target_param,
                amount,
                active: true,
            });
        }
    }

    /// Add a macro mapping.
    pub fn add_macro_mapping(
        &mut self,
        macro_index: u8,
        target_param: u16,
        min_value: f32,
        max_value: f32,
    ) {
        self.macro_mappings.push(MacroMapping {
            macro_index,
            target_param,
            min_value,
            max_value,
            active: true,
        });
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
            // Macros as mod sources [6..13]
            for m in 0..8 {
                self.mod_values[6 + m] = self.macros[m];
            }

            // Evaluate modulation matrix to offsets
            self.param_offsets.fill(0.0);
            for i_mod in 0..self.mod_assignments.len() {
                let assignment = &self.mod_assignments[i_mod];
                if assignment.active {
                    let source_val = self.mod_values[assignment.source_id as usize];
                    let idx = assignment.target_param as usize;
                    if idx < self.param_offsets.len() {
                        self.param_offsets[idx] += source_val * assignment.amount;
                    }
                }
            }
            for i_mac in 0..self.macro_mappings.len() {
                let mapping = &self.macro_mappings[i_mac];
                if mapping.active {
                    let source_val = self.macros[mapping.macro_index as usize];
                    let idx = mapping.target_param as usize;
                    if idx < self.param_offsets.len() {
                        let mapped = mapping.min_value
                            + source_val * (mapping.max_value - mapping.min_value);
                        self.param_offsets[idx] += mapped;
                    }
                }
            }

            // Split through crossover
            self.crossover
                .process_sample(in_l, in_r, &mut self.bands_l, &mut self.bands_r);

            // Check if any band is soloed
            let any_solo = self.bands[..self.band_count].iter().any(|b| b.solo);

            // Process each band and sum
            let mut sum_l = 0.0_f32;
            let mut sum_r = 0.0_f32;

            match self.routing {
                RoutingMode::Parallel | RoutingMode::Serial => {
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
                        self.band_levels[b] = self.bands[b].peak_level;
                    }
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

                    if self.band_count > 0 {
                        self.band_levels[0] = self.bands[0].peak_level;
                    }
                    if self.band_count > 1 {
                        self.band_levels[1] = self.bands[1].peak_level;
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
    /// Bands are summed, so the device's delay is the longest **active** band.
    /// All six `BandChain`s are allocated up front while only `band_count`
    /// run, so a stale factor on an inactive band must not inflate the report.
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
    /// **Still deliberately not included:** the same `StftProcessor` windowing
    /// latency on the separate `spectralEnabled` blur/freeze path. That stage
    /// is untouched here and its omission is unchanged; the accessor it needs
    /// now exists, but folding it in moves audio this change did not otherwise
    /// touch. It keeps its own finding.
    pub fn latency_samples(&self) -> u32 {
        let longest = self
            .bands
            .iter()
            .take(self.band_count)
            .map(BandChain::latency_samples)
            .fold(0.0_f32, f32::max);
        longest.round() as u32
    }

    /// Get current modulation source values (for UI visualization).
    pub fn mod_source_values(&self) -> &[f32; 16] {
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
}
