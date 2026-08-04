//! Drum voice — renders one active drum hit.
//!
//! Voices are pooled and recycled. When a pad is triggered, a free voice
//! (or the oldest voice) is assigned. Each voice holds its own synth
//! engine instance and filter/envelope state.

use std::f32::consts::TAU;

use super::{
    engines::{DrumEngineResources, DrumEngineType, DrumSynthEngine},
    pad::Pad,
};
use crate::primitives::flush_denormal;

/// Simple state-variable filter for per-voice filtering.
pub struct SvfFilter {
    ic1: f32,
    ic2: f32,
    cutoff: f32,    // normalized 0-1
    resonance: f32, // normalized 0-1
}

impl SvfFilter {
    pub fn new() -> Self {
        Self {
            ic1: 0.0,
            ic2: 0.0,
            cutoff: 1.0,
            resonance: 0.0,
        }
    }

    pub fn reset(&mut self) {
        self.ic1 = 0.0;
        self.ic2 = 0.0;
    }

    pub fn set(&mut self, cutoff: f32, resonance: f32) {
        self.cutoff = cutoff;
        self.resonance = resonance;
    }

    /// Process one sample, returns lowpass output.
    pub fn tick(&mut self, input: f32, sample_rate: f32) -> f32 {
        // Map normalized cutoff to frequency (20Hz - 20kHz, exponential)
        let freq = 20.0 * (self.cutoff * 10.0).exp2().min(20000.0);
        let g = (TAU * freq / sample_rate * 0.5).tan();
        let k = 2.0 - 1.9 * self.resonance; // Q from 0.5 to 20
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;

        let v3 = input - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        self.ic1 = flush_denormal(2.0 * v1 - self.ic1);
        self.ic2 = flush_denormal(2.0 * v2 - self.ic2);

        v2 // lowpass output
    }
}

/// Exponential decay envelope used for amplitude shaping.
pub struct ExpDecayEnv {
    pub value: f32,
    pub coeff: f32,
}

impl ExpDecayEnv {
    pub fn new() -> Self {
        Self {
            value: 0.0,
            coeff: 0.999,
        }
    }

    pub fn trigger(&mut self, level: f32, decay_time: f32, sample_rate: f32) {
        self.value = level;
        if decay_time > 0.0 {
            self.coeff = (-1.0 / (decay_time * sample_rate)).exp();
        } else {
            self.coeff = 0.0;
        }
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        self.value *= self.coeff;
        self.value
    }

    pub fn is_active(&self) -> bool {
        self.value > 1e-6
    }
}

/// A single drum voice that renders one active hit.
pub struct DrumVoice {
    pub active: bool,
    pub pad_index: u8,
    pub velocity: f32,
    pub age: u32,
    engines: [DrumSynthEngine; DrumEngineType::COUNT],
    active_engine_index: usize,
    filter: SvfFilter,
    amp_env: ExpDecayEnv,
    filter_active: bool,
    choke_multiplier: f32,
    choke_decay: f32,
}

impl DrumVoice {
    pub fn new(sample_rate: f32, resources: &DrumEngineResources) -> Self {
        Self {
            active: false,
            pad_index: 0,
            velocity: 0.0,
            age: 0,
            engines: DrumEngineType::ALL.map(|engine_type| {
                DrumSynthEngine::new_with_resources(engine_type, sample_rate, resources)
            }),
            active_engine_index: DrumEngineType::Kick.index(),
            filter: SvfFilter::new(),
            amp_env: ExpDecayEnv::new(),
            filter_active: false,
            choke_multiplier: 1.0,
            choke_decay: 1.0,
        }
    }

    /// Assign this voice to a pad and trigger it.
    pub fn trigger(
        &mut self,
        pad_index: u8,
        pad: &Pad,
        velocity: f32,
        midi_note: u8,
        sample_rate: f32,
    ) {
        self.active = true;
        self.pad_index = pad_index;
        self.velocity = velocity;
        self.age = 0;
        self.choke_multiplier = 1.0;
        self.choke_decay = 1.0;

        self.active_engine_index = pad.engine_type.index();
        let engine = &mut self.engines[self.active_engine_index];

        // A voice snapshots the pad before it starts. Several engines derive their
        // oscillator frequency and envelope coefficients inside `trigger`, so
        // applying these values afterwards makes a fresh/recycled voice play the
        // previous sound for its entire hit.
        let pitch_offset = midi_note as f32 - 60.0 + pad.tune;
        engine.reset_engine_params();
        engine.set_param("open", if pad.is_open { 1.0 } else { 0.0 });
        engine.set_param("tune", pitch_offset);
        engine.set_param("decay", pad.decay);
        engine.set_param("tone", pad.tone);
        engine.set_param("drive", pad.drive);
        engine.set_param("snappy", pad.snappy);
        engine.set_param("noise_color", pad.noise_color);
        if pad.base_freq > 1.0 {
            engine.set_param("base_freq", pad.base_freq);
        }
        engine.set_param("pitch_amount", pad.pitch_amount);
        engine.set_param("pitch_decay", pad.pitch_decay);
        engine.set_param("noise_level", pad.noise_level);
        // Engine-specific kit overrides belong after common controls: FM `tone`,
        // for example, maps to modulation amount and must remain effective unless
        // this kit explicitly carries a `mod_amount` override.
        if let Some(value) = pad.mod_ratio {
            engine.set_param("mod_ratio", value);
        }
        if let Some(value) = pad.mod_amount {
            engine.set_param("mod_amount", value);
        }
        if let Some(value) = pad.feedback {
            engine.set_param("feedback", value);
        }
        engine.trigger(velocity, sample_rate);

        // Setup filter
        self.filter.reset();
        self.filter.set(pad.filter_cutoff, pad.filter_resonance);
        self.filter_active = pad.filter_cutoff < 0.99;

        // Amp envelope (the engine has its own envelope, this is a
        // safety wrapper that ensures voice deactivation)
        self.amp_env.trigger(1.0, 2.0, sample_rate); // 2s max voice lifetime
    }

    pub fn release(&mut self) {
        self.engines[self.active_engine_index].release();
        // ~10ms fast fade out at typical sample rates to prevent choke clicks
        self.choke_decay = 0.99;
    }

    /// Process one sample, returns mono output.
    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if !self.active {
            return 0.0;
        }

        self.age += 1;

        let engine = &mut self.engines[self.active_engine_index];
        let mut sample = engine.tick(sample_rate);

        // Apply choke fade out if released
        sample *= self.choke_multiplier;
        if self.choke_decay < 1.0 {
            self.choke_multiplier *= self.choke_decay;
            if self.choke_multiplier < 1e-4 {
                self.active = false;
                self.choke_multiplier = 0.0;
            }
        }

        // Apply per-voice filter if cutoff is not fully open
        let filtered = if self.filter_active {
            self.filter.tick(sample, sample_rate)
        } else {
            sample
        };

        // Check if engine is done
        if !engine.is_active() {
            self.active = false;
        }

        filtered
    }
}
