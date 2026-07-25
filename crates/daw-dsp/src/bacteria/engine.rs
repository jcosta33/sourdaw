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
            convolution: ConvolutionProcessor::new(),
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
    fn latency_samples(&self) -> f32 {
        self.oversampler_l.latency_samples()
    }

    fn process_sample(&mut self, left: f32, right: f32, gain_offset: f32) -> (f32, f32) {
        if !self.enabled || self.mute {
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
                        processed_l[i] = self.distortion.process_sample(s);
                    }
                    up_l.len()
                };
                l = self.oversampler_l.downsample(&processed_l[..up_l_len]);

                let mut processed_r = [0.0_f32; 8];
                let up_r_len = {
                    let up_r = self.oversampler_r.upsample(r);
                    for (i, &s) in up_r.iter().enumerate() {
                        processed_r[i] = self.distortion.process_sample(s);
                    }
                    up_r.len()
                };
                r = self.oversampler_r.downsample(&processed_r[..up_r_len]);
            } else {
                l = self.distortion.process_sample(l);
                r = self.distortion.process_sample(r);
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
            param_offsets: [0.0; 1024],
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
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
        if self.bypassed {
            return;
        }

        let len = left.len().min(right.len());

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
            left[i] = dry_l * (1.0 - m) + sum_l * m;
            right[i] = dry_r * (1.0 - m) + sum_r * m;

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
    /// **Deliberately not included:** `StftProcessor`'s windowing latency on
    /// the spectral path. That omission predates the oversampler rewrite and
    /// the type exposes no accessor to report it; folding in a guessed number
    /// would be worse than a known, stated omission. It needs its own finding.
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
}
