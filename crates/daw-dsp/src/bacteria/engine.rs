//! BacteriaEngine — top-level creative multi-effects orchestrator.
//!
//! Routes audio through: crossover → per-band effect chains → summing.
//! Handles multi-band splitting, serial/parallel/mid-side routing,
//! oversampling, modulation routing, macro mapping, and XY morphing.

use super::crossover::CrossoverEngine;
use super::distortion::DistortionProcessor;
use super::filter::SvfFilter;
use super::granular::GranularProcessor;
use super::stft::StftProcessor;
use super::chorus::ChorusFlanger;
use super::chorus::Phaser;
use super::lofi::LofiProcessor;
use super::convolution::ConvolutionProcessor;
use super::oversample::OversamplingChain;
use super::hilbert::HilbertShifter;
use super::waveshaper::CustomWaveshaper;
use super::modulation::{Lfo, EnvelopeFollower, LorenzAttractor, LfoShape};
use super::params::{SmoothedParam, db_to_linear, linear_to_db};

const MAX_BANDS: usize = 6;
const MAX_MOD_ASSIGNMENTS: usize = 64;

/// Modulation assignment: source → target with amount.
#[derive(Clone)]
struct ModAssignment {
    source_id: u8,     // 0=lfo1, 1=lfo2, 2=env, 3=lorenz_x, 4=lorenz_z, 5-12=macro1-8
    target_param: u16, // encoded param identifier
    amount: f32,       // -1 to 1
    active: bool,
}

/// Macro mapping entry.
#[derive(Clone)]
struct MacroMapping {
    macro_index: u8,
    target_param: u16,
    min_value: f32,
    max_value: f32,
    active: bool,
}

/// Per-band processing chain with all effect modules.
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

    fn process_sample(&mut self, left: f32, right: f32) -> (f32, f32) {
        if !self.enabled || self.mute {
            return (0.0, 0.0);
        }

        let mut l = left;
        let mut r = right;

        // Distortion with optional oversampling
        if self.distortion_enabled {
            if self.oversampling_factor > 1 {
                // Upsample → process → downsample
                let up_l = self.oversampler_l.upsample(l);
                let mut processed_l = vec![0.0_f32; up_l.len()];
                for (i, &s) in up_l.iter().enumerate() {
                    processed_l[i] = self.distortion.process_sample(s);
                }
                l = self.oversampler_l.downsample(&processed_l);

                let up_r = self.oversampler_r.upsample(r);
                let mut processed_r = vec![0.0_f32; up_r.len()];
                for (i, &s) in up_r.iter().enumerate() {
                    processed_r[i] = self.distortion.process_sample(s);
                }
                r = self.oversampler_r.downsample(&processed_r);
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

        // Apply band gain
        let g = self.gain.next();
        l *= g;
        r *= g;

        // Update peak meter
        let peak = l.abs().max(r.abs());
        if peak > self.peak_level {
            self.peak_level = peak;
        } else {
            self.peak_level *= 0.9995;
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
struct MorphSnapshot {
    param_values: Vec<(String, f32)>,
}

impl MorphSnapshot {
    fn new() -> Self {
        Self { param_values: Vec::new() }
    }
}

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
    band_levels: [f32; MAX_BANDS],

    // Scratch buffers for band splitting
    bands_l: [f32; MAX_BANDS],
    bands_r: [f32; MAX_BANDS],
}

/// Simple step sequencer modulation source.
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
        let bands: Vec<BandChain> = (0..MAX_BANDS).map(|_| BandChain::new(sample_rate)).collect();

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
            snapshots: [MorphSnapshot::new(), MorphSnapshot::new(), MorphSnapshot::new(), MorphSnapshot::new()],
            input_peak: 0.0,
            output_peak: 0.0,
            band_levels: [0.0; MAX_BANDS],
            bands_l: [0.0; MAX_BANDS],
            bands_r: [0.0; MAX_BANDS],
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        // Parse band-prefixed params: "band0_drive", "band1_filterCutoff", etc.
        if name.starts_with("band") && name.len() > 5 {
            if let Some(idx_char) = name.chars().nth(4) {
                if let Some(band_idx) = idx_char.to_digit(10) {
                    let band_idx = band_idx as usize;
                    if band_idx < MAX_BANDS {
                        let param_name = &name[6..]; // skip "bandN_"
                        self.bands[band_idx].set_param(param_name, value);
                    }
                }
            }
            return;
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
                self.crossover.set_bands(self.band_count, &self.crossover_freqs);
            }
            "crossoverFreq1" => { self.crossover_freqs[0] = value; self.crossover.set_bands(self.band_count, &self.crossover_freqs); }
            "crossoverFreq2" => { self.crossover_freqs[1] = value; self.crossover.set_bands(self.band_count, &self.crossover_freqs); }
            "crossoverFreq3" => { self.crossover_freqs[2] = value; self.crossover.set_bands(self.band_count, &self.crossover_freqs); }
            "crossoverFreq4" => { self.crossover_freqs[3] = value; self.crossover.set_bands(self.band_count, &self.crossover_freqs); }
            "crossoverFreq5" => { self.crossover_freqs[4] = value; self.crossover.set_bands(self.band_count, &self.crossover_freqs); }
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
    pub fn add_macro_mapping(&mut self, macro_index: u8, target_param: u16, min_value: f32, max_value: f32) {
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
                self.input_peak *= 0.9999;
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

            // Split through crossover
            self.crossover.process_sample(in_l, in_r, &mut self.bands_l, &mut self.bands_r);

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
                        let (bl, br) = self.bands[b].process_sample(self.bands_l[b], self.bands_r[b]);
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
                        self.bands[0].process_sample(mid, mid)
                    } else { (mid, mid) };
                    let (ps, _) = if self.band_count > 1 {
                        self.bands[1].process_sample(side, side)
                    } else { (side, side) };

                    // Decode back to L/R
                    sum_l = pm + ps;
                    sum_r = pm - ps;

                    if self.band_count > 0 { self.band_levels[0] = self.bands[0].peak_level; }
                    if self.band_count > 1 { self.band_levels[1] = self.bands[1].peak_level; }
                }
            }

            // Apply output gain
            let og = self.output_gain.next();
            sum_l *= og;
            sum_r *= og;

            // Wet/dry mix
            let m = self.mix.next();
            left[i] = dry_l * (1.0 - m) + sum_l * m;
            right[i] = dry_r * (1.0 - m) + sum_r * m;

            // Update output peak
            let out_peak = left[i].abs().max(right[i].abs());
            if out_peak > self.output_peak {
                self.output_peak = out_peak;
            } else {
                self.output_peak *= 0.9999;
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

    pub fn latency_samples(&self) -> u32 {
        0 // LR4 crossover is zero-latency; linear-phase would report latency here
    }

    /// Get current modulation source values (for UI visualization).
    pub fn mod_source_values(&self) -> &[f32; 16] {
        &self.mod_values
    }
}
