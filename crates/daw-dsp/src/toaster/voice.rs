//! Drum voice — renders one active drum hit.
//!
//! Voices are pooled and recycled. When a pad is triggered, a free voice
//! (or the oldest voice) is assigned. Each voice holds its own synth
//! engine instance and filter/envelope state.

use std::f32::consts::TAU;

use super::engines::{DrumEngineType, DrumSynthEngine};
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
    engine: DrumSynthEngine,
    filter: SvfFilter,
    amp_env: ExpDecayEnv,
    filter_active: bool,
    choke_multiplier: f32,
    choke_decay: f32,
}

impl DrumVoice {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            active: false,
            pad_index: 0,
            velocity: 0.0,
            age: 0,
            engine: DrumSynthEngine::new(DrumEngineType::Kick, sample_rate),
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
        engine_type: DrumEngineType,
        velocity: f32,
        sample_rate: f32,
        filter_cutoff: f32,
        filter_resonance: f32,
        is_open: bool,
    ) {
        self.active = true;
        self.pad_index = pad_index;
        self.velocity = velocity;
        self.age = 0;
        self.choke_multiplier = 1.0;
        self.choke_decay = 1.0;

        // Re-create engine if type changed
        if self.engine.engine_type() != engine_type {
            self.engine = DrumSynthEngine::new(engine_type, sample_rate);
        }
        // Set open/closed state BEFORE trigger so HiHat engines read the correct
        // flag when computing their decay coefficient in trigger().
        self.engine.set_param("open", if is_open { 1.0 } else { 0.0 });
        self.engine.trigger(velocity, sample_rate);

        // Setup filter
        self.filter.reset();
        self.filter.set(filter_cutoff, filter_resonance);
        self.filter_active = filter_cutoff < 0.99;

        // Amp envelope (the engine has its own envelope, this is a
        // safety wrapper that ensures voice deactivation)
        self.amp_env.trigger(1.0, 2.0, sample_rate); // 2s max voice lifetime
    }

    pub fn release(&mut self) {
        self.engine.release();
        // ~10ms fast fade out at typical sample rates to prevent choke clicks
        self.choke_decay = 0.99;
    }

    /// Forward a parameter to the inner synth engine.
    pub fn set_engine_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    /// Process one sample, returns mono output.
    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if !self.active {
            return 0.0;
        }

        self.age += 1;

        let mut sample = self.engine.tick(sample_rate);

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
        if !self.engine.is_active() {
            self.active = false;
        }

        filtered
    }
}
