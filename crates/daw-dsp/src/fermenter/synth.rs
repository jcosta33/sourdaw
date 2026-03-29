/// MasterSynth — top-level Fermenter engine.
/// Manages layers (each with their own voice pool), processes MIDI, renders audio blocks.

use super::effects::{Compressor, Distortion, FdnReverb, ParametricEq, PlateReverb, StereoChorus, StereoDelay, StereoPhaser, StereoWidth};
use super::layer::Layer;
use super::oscillator::Wavetable;
use super::params::SmoothedParam;

/// MIDI event passed from JS to WASM.
#[derive(Clone, Copy)]
pub struct MidiEvent {
    pub kind: u8,     // 0=noteOff, 1=noteOn
    pub note: u8,
    pub velocity: u8,
    pub offset: u32,  // Sample offset within the block
}

const MAX_LAYERS: usize = 4;

pub struct MasterSynth {
    layers: [Layer; MAX_LAYERS],
    num_active_layers: usize,  // 1-4
    active_layer: usize,       // which layer receives MIDI and param changes (0-3)

    tables: Vec<Wavetable>,

    // Global effects (shared across all layers)
    reverb: PlateReverb,
    fdn_reverb: FdnReverb,
    eq: ParametricEq,
    delay: StereoDelay,
    chorus: StereoChorus,
    phaser: StereoPhaser,
    distortion: Distortion,
    compressor: Compressor,

    // Reverb type: 0 = plate, 1 = FDN
    pub reverb_type: u8,

    // Global effect params
    pub reverb_mix: SmoothedParam,
    pub reverb_decay: SmoothedParam,

    // EQ parameters (low / mid / high)
    pub eq_low_freq: f32,
    pub eq_low_gain: f32,
    pub eq_low_q: f32,
    pub eq_mid_freq: f32,
    pub eq_mid_gain: f32,
    pub eq_mid_q: f32,
    pub eq_high_freq: f32,
    pub eq_high_gain: f32,
    pub eq_high_q: f32,

    // Delay parameters
    pub delay_time: f32,
    pub delay_feedback: f32,
    pub delay_mix: f32,

    // Chorus parameters
    pub chorus_rate: f32,
    pub chorus_depth: f32,
    pub chorus_mix: f32,

    // Phaser parameters
    pub phaser_rate: f32,
    pub phaser_depth: f32,
    pub phaser_mix: f32,

    // Distortion parameters
    pub dist_drive: f32,
    pub dist_tone: f32,
    pub dist_mix: f32,

    // Compressor parameters
    pub comp_threshold: f32,
    pub comp_ratio: f32,
    pub comp_attack: f32,
    pub comp_release: f32,
    pub comp_mix: f32,

    // Master
    pub master_gain: f32,
    pub stereo_width: f32,

    sample_rate: f32,
}

impl MasterSynth {
    pub fn new(sample_rate: f32, _max_voices: usize) -> Self {
        // Pre-compute band-limited wavetables
        let tables = vec![
            Wavetable::sine(),
            Wavetable::saw(),
            Wavetable::square(),
            Wavetable::triangle(),
        ];

        let layers = [
            Layer::new(sample_rate),
            Layer::new(sample_rate),
            Layer::new(sample_rate),
            Layer::new(sample_rate),
        ];

        Self {
            layers,
            num_active_layers: 1,
            active_layer: 0,
            tables,
            reverb: PlateReverb::new(sample_rate),
            fdn_reverb: FdnReverb::new(sample_rate),
            eq: ParametricEq::new(),
            delay: StereoDelay::new(sample_rate),
            chorus: StereoChorus::new(sample_rate),
            phaser: StereoPhaser::new(sample_rate),
            distortion: Distortion::new(),
            compressor: Compressor::new(),
            reverb_type: 0,
            reverb_mix: SmoothedParam::new(0.2, 10.0, sample_rate),
            reverb_decay: SmoothedParam::new(0.5, 10.0, sample_rate),
            eq_low_freq: 200.0,
            eq_low_gain: 0.0,
            eq_low_q: 1.0,
            eq_mid_freq: 1000.0,
            eq_mid_gain: 0.0,
            eq_mid_q: 1.0,
            eq_high_freq: 5000.0,
            eq_high_gain: 0.0,
            eq_high_q: 1.0,
            delay_time: 300.0,
            delay_feedback: 0.3,
            delay_mix: 0.0,
            chorus_rate: 1.0,
            chorus_depth: 0.5,
            chorus_mix: 0.0,
            phaser_rate: 1.0,
            phaser_depth: 0.5,
            phaser_mix: 0.0,
            dist_drive: 0.0,
            dist_tone: 0.5,
            dist_mix: 0.0,
            comp_threshold: -10.0,
            comp_ratio: 4.0,
            comp_attack: 10.0,
            comp_release: 100.0,
            comp_mix: 0.0,
            master_gain: 1.0,
            stereo_width: 1.0,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        // Layer management params
        match name {
            "active_layer" => {
                self.active_layer = (value as usize).min(MAX_LAYERS - 1);
                return;
            }
            "num_layers" => {
                self.num_active_layers = (value as usize).clamp(1, MAX_LAYERS);
                return;
            }
            _ => {}
        }

        // Global effect params — handled at MasterSynth level
        match name {
            "reverb_type" => { self.reverb_type = (value as u8).min(1); return; }
            "reverb_mix" => { self.reverb_mix.set(value.clamp(0.0, 1.0)); return; }
            "reverb_decay" => { self.reverb_decay.set(value.clamp(0.0, 0.99)); return; }
            "eq_low_freq" => { self.eq_low_freq = value.clamp(20.0, 20000.0); self.eq.set_band(0, self.eq_low_freq, self.eq_low_gain, self.eq_low_q, self.sample_rate); return; }
            "eq_low_gain" => { self.eq_low_gain = value.clamp(-24.0, 24.0); self.eq.set_band(0, self.eq_low_freq, self.eq_low_gain, self.eq_low_q, self.sample_rate); return; }
            "eq_low_q" => { self.eq_low_q = value.clamp(0.1, 20.0); self.eq.set_band(0, self.eq_low_freq, self.eq_low_gain, self.eq_low_q, self.sample_rate); return; }
            "eq_mid_freq" => { self.eq_mid_freq = value.clamp(20.0, 20000.0); self.eq.set_band(1, self.eq_mid_freq, self.eq_mid_gain, self.eq_mid_q, self.sample_rate); return; }
            "eq_mid_gain" => { self.eq_mid_gain = value.clamp(-24.0, 24.0); self.eq.set_band(1, self.eq_mid_freq, self.eq_mid_gain, self.eq_mid_q, self.sample_rate); return; }
            "eq_mid_q" => { self.eq_mid_q = value.clamp(0.1, 20.0); self.eq.set_band(1, self.eq_mid_freq, self.eq_mid_gain, self.eq_mid_q, self.sample_rate); return; }
            "eq_high_freq" => { self.eq_high_freq = value.clamp(20.0, 20000.0); self.eq.set_band(2, self.eq_high_freq, self.eq_high_gain, self.eq_high_q, self.sample_rate); return; }
            "eq_high_gain" => { self.eq_high_gain = value.clamp(-24.0, 24.0); self.eq.set_band(2, self.eq_high_freq, self.eq_high_gain, self.eq_high_q, self.sample_rate); return; }
            "eq_high_q" => { self.eq_high_q = value.clamp(0.1, 20.0); self.eq.set_band(2, self.eq_high_freq, self.eq_high_gain, self.eq_high_q, self.sample_rate); return; }
            "delay_time" => { self.delay_time = value.clamp(10.0, 2000.0); return; }
            "delay_feedback" => { self.delay_feedback = value.clamp(0.0, 0.95); return; }
            "delay_mix" => { self.delay_mix = value.clamp(0.0, 1.0); return; }
            "chorus_rate" => { self.chorus_rate = value.clamp(0.1, 5.0); return; }
            "chorus_depth" => { self.chorus_depth = value.clamp(0.0, 1.0); return; }
            "chorus_mix" => { self.chorus_mix = value.clamp(0.0, 1.0); return; }
            "phaser_rate" => { self.phaser_rate = value.clamp(0.1, 5.0); return; }
            "phaser_depth" => { self.phaser_depth = value.clamp(0.0, 1.0); return; }
            "phaser_mix" => { self.phaser_mix = value.clamp(0.0, 1.0); return; }
            "dist_drive" => { self.dist_drive = value.clamp(0.0, 10.0); return; }
            "dist_tone" => { self.dist_tone = value.clamp(0.0, 1.0); return; }
            "dist_mix" => { self.dist_mix = value.clamp(0.0, 1.0); return; }
            "comp_threshold" => { self.comp_threshold = value.clamp(-60.0, 0.0); return; }
            "comp_ratio" => { self.comp_ratio = value.clamp(1.0, 20.0); return; }
            "comp_attack" => { self.comp_attack = value.clamp(0.1, 100.0); return; }
            "comp_release" => { self.comp_release = value.clamp(10.0, 1000.0); return; }
            "comp_mix" => { self.comp_mix = value.clamp(0.0, 1.0); return; }
            "master_gain" => { self.master_gain = value.clamp(0.0, 2.0); return; }
            "stereo_width" => { self.stereo_width = value.clamp(0.0, 2.0); return; }
            _ => {}
        }

        // Everything else routes to the active layer
        self.layers[self.active_layer].set_param(name, value);
    }

    /// Process a block of audio with MIDI events.
    /// `left` and `right` are output buffers (will be overwritten).
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32], events: &[MidiEvent]) {
        let block_size = left.len().min(right.len());

        // Clear output
        left[..block_size].fill(0.0);
        right[..block_size].fill(0.0);

        // Process MIDI events (sorted by offset)
        for event in events {
            match event.kind {
                1 => self.note_on(event.note, event.velocity),
                0 => self.note_off(event.note),
                _ => {}
            }
        }

        // Check if any layer has solo enabled
        let any_solo = self.layers[..self.num_active_layers].iter().any(|l| l.solo);

        // Render each active layer
        for i in 0..self.num_active_layers {
            let layer = &mut self.layers[i];

            // Skip muted layers; if any layer is soloed, skip non-soloed layers
            if layer.muted {
                continue;
            }
            if any_solo && !layer.solo {
                continue;
            }

            layer.render(
                &mut left[..block_size],
                &mut right[..block_size],
                &self.tables,
                self.sample_rate,
            );
        }

        // ── Global effects ──────────────────────────────────────────

        // Apply distortion (pre-FX)
        if self.dist_mix > 0.001 {
            self.distortion.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.dist_drive,
                self.dist_tone,
                self.dist_mix,
            );
        }

        // Apply compressor (after distortion, before reverb)
        if self.comp_mix > 0.001 {
            self.compressor.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.comp_threshold,
                self.comp_ratio,
                self.comp_attack,
                self.comp_release,
                self.comp_mix,
                self.sample_rate,
            );
        }

        // Apply reverb (skip when mix is zero) — branch on reverb_type
        let reverb_mix = self.reverb_mix.tick();
        let reverb_decay = self.reverb_decay.tick();
        if reverb_mix > 0.001 {
            match self.reverb_type {
                1 => {
                    // FDN reverb
                    self.fdn_reverb.set_params(reverb_decay, reverb_mix, 0.5);
                    for i in 0..block_size {
                        let (rl, rr) = self.fdn_reverb.process(left[i], right[i]);
                        left[i] = rl;
                        right[i] = rr;
                    }
                }
                _ => {
                    // Plate reverb (default)
                    self.reverb.set_params(reverb_decay, reverb_mix, 0.5);
                    for i in 0..block_size {
                        let (rl, rr) = self.reverb.process(left[i], right[i]);
                        left[i] = rl;
                        right[i] = rr;
                    }
                }
            }
        }

        // Apply delay
        if self.delay_mix > 0.001 {
            self.delay.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.delay_time,
                self.delay_feedback,
                self.delay_mix,
            );
        }

        // Apply chorus
        if self.chorus_mix > 0.001 {
            self.chorus.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.chorus_rate,
                self.chorus_depth,
                self.chorus_mix,
            );
        }

        // Apply phaser (after chorus)
        if self.phaser_mix > 0.001 {
            self.phaser.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.phaser_rate,
                self.phaser_depth,
                self.phaser_mix,
            );
        }

        // Apply parametric EQ (after reverb/delay/chorus/phaser, before stereo width)
        self.eq.process_block(
            &mut left[..block_size],
            &mut right[..block_size],
        );

        // Apply stereo width (last effect before master gain)
        if (self.stereo_width - 1.0).abs() > 0.001 {
            StereoWidth::process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.stereo_width,
            );
        }

        // Apply master gain
        if (self.master_gain - 1.0).abs() > 0.001 {
            for i in 0..block_size {
                left[i] *= self.master_gain;
                right[i] *= self.master_gain;
            }
        }
    }

    pub fn note_on(&mut self, note: u8, velocity: u8) {
        // Send note to the active layer
        self.layers[self.active_layer].note_on(note, velocity);
    }

    pub fn note_off(&mut self, note: u8) {
        // Release on the active layer
        self.layers[self.active_layer].note_off(note);
    }

    pub fn active_voice_count(&self) -> usize {
        self.layers[..self.num_active_layers]
            .iter()
            .map(|l| l.active_voice_count())
            .sum()
    }
}
