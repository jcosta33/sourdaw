//! Grand Boule — Sourdaw's physically-modelled grand piano.
//!
//! Modal synthesis engine producing polyphonic piano audio from an inharmonic
//! biquad bank driven by a nonlinear felt-hammer interaction. Compiles to
//! both native (Rust library) and WASM (AudioWorklet).
//!
//! The audio path is lock-free and allocation-free after construction, per
//! `docs/architecture/01-system.md §3.1`.

pub mod attack_sampler;
pub mod coupled_strings;
pub mod duplex;
pub mod engine;
pub mod hammer;
pub mod longitudinal;
pub mod mechanical_noise;
pub mod midi2;
pub mod parameters;
pub mod pedals;
mod radiation;
pub mod soundboard;
pub mod string;
pub mod sympathetic;
pub mod voice;

#[cfg(not(target_arch = "wasm32"))]
use crate::primitives::sanitize_block;
#[cfg(not(target_arch = "wasm32"))]
use engine::{GrandBouleEngine, DEFAULT_VOICE_COUNT};
#[cfg(not(target_arch = "wasm32"))]
use parameters::Temperament;
#[cfg(not(target_arch = "wasm32"))]
use wasm_bindgen::prelude::*;

/// Pre-allocated maximum block size exposed to the AudioWorklet side.
#[cfg(not(target_arch = "wasm32"))]
const MAX_BLOCK_SIZE: usize = 4096;

/// Native Grand Boule host instance retained while the WASM export is withheld.
#[cfg(not(target_arch = "wasm32"))]
#[wasm_bindgen]
pub struct GrandBouleInstance {
    engine: GrandBouleEngine,
    left_buf: Vec<f32>,
    right_buf: Vec<f32>,
    nan_flush_count: u64,
}

#[cfg(not(target_arch = "wasm32"))]
#[wasm_bindgen]
impl GrandBouleInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32, voice_count: u32) -> Self {
        let count = if voice_count == 0 {
            DEFAULT_VOICE_COUNT
        } else {
            voice_count as usize
        };
        Self {
            engine: GrandBouleEngine::new(sample_rate, count),
            left_buf: vec![0.0; MAX_BLOCK_SIZE],
            right_buf: vec![0.0; MAX_BLOCK_SIZE],
            nan_flush_count: 0,
        }
    }

    /// Trigger a note. `midi_note` covers the full MIDI range; out-of-piano
    /// notes are silently ignored.
    pub fn note_on(&mut self, midi_note: u8, velocity: f32) {
        self.engine.note_on(midi_note, velocity);
    }

    /// Begin the release phase for any voice holding this note.
    pub fn note_off(&mut self, midi_note: u8) {
        self.engine.note_off(midi_note);
    }

    /// Trigger a note carrying its MPE member channel.
    pub fn note_on_with_channel(&mut self, midi_note: u8, velocity: f32, channel: u8) {
        self.engine
            .note_on_with_channel(midi_note, velocity, channel);
    }

    /// Note-off narrowed to one MPE member channel (audit MD-2).
    pub fn note_off_on_channel(&mut self, midi_note: u8, channel: u8) {
        self.engine.note_off_on_channel(midi_note, channel);
    }

    /// Apply MPE per-note expression to the voice held on `channel` at
    /// `midi_note` (audit MD-2).
    ///
    /// Grand Boule sounds `bend_semitones` only: the ringing modal strings are
    /// retuned in place. `pressure` and `slide` have no physical counterpart on
    /// a struck string and are dropped — the expression registry advertises
    /// pitch bend alone, so the editor never offers those lanes for this device.
    pub fn note_expression(
        &mut self,
        midi_note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
    ) {
        self.engine
            .note_expression(midi_note, channel, bend_semitones, pressure, slide);
    }

    /// Set a global parameter (`master_gain`, `soundboard_send`,
    /// `sympathetic_send`).
    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    /// Set the sustain pedal position (0..1).
    pub fn set_sustain(&mut self, position: f32) {
        self.engine.set_sustain(position);
    }

    /// Set the una-corda pedal state.
    pub fn set_una_corda(&mut self, engaged: bool) {
        self.engine.set_una_corda(engaged);
    }

    /// Set the sostenuto pedal state.
    pub fn set_sostenuto(&mut self, engaged: bool) {
        self.engine.set_sostenuto(engaged);
    }

    /// Trigger a MIDI 2.0 note-on with 16-bit velocity and Q24 pitch offset.
    pub fn note_on_midi2(&mut self, midi_note: u8, velocity_16bit: u32, pitch_offset_q24: i32) {
        self.engine.note_on_midi2(
            midi_note,
            velocity_16bit.min(0xFFFF) as u16,
            pitch_offset_q24,
        );
    }

    /// Load an attack-sample clip into the hybrid sampled-attack set.
    pub fn load_attack_clip(&mut self, key: u32, samples: &[f32]) {
        self.engine.attack_samples_mut().set_clip(key, samples);
    }

    /// Set the historical temperament (0 = Equal, 1 = Werckmeister III,
    /// 2 = Kirnberger III, 3 = Vallotti, 4 = Young II, 5 = Meantone ¼-comma).
    pub fn set_temperament(&mut self, index: u8) {
        self.engine.set_temperament(Temperament::from_u8(index));
    }

    /// Panic: silence every voice immediately.
    pub fn all_notes_off(&mut self) {
        self.engine.all_notes_off();
    }

    /// Current DSP-owned render lifecycle for the worker host.
    pub fn lifecycle_state(&self) -> u32 {
        self.engine.lifecycle().code()
    }

    /// Render a block of audio and return a pointer to the left channel.
    /// The caller reads both channels from WASM memory.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = (block_size as usize).min(self.left_buf.len());
        self.left_buf[..size].fill(0.0);
        self.right_buf[..size].fill(0.0);

        self.engine
            .process_block(&mut self.left_buf[..size], &mut self.right_buf[..size]);

        self.nan_flush_count += sanitize_block(&mut self.left_buf[..size]) as u64;
        self.nan_flush_count += sanitize_block(&mut self.right_buf[..size]) as u64;

        self.left_buf.as_ptr()
    }

    /// Number of non-finite output samples scrubbed to silence since
    /// construction (DSP-8). Non-zero means a poisoned block was caught at the
    /// wasm output boundary and surfaced for health telemetry.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
    }

    /// Pointer to the right channel buffer (call after `process`).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.right_buf.as_ptr()
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod lifecycle_tests {
    use super::GrandBouleInstance;
    use crate::primitives::ProcessLifecycle;

    #[test]
    fn lifecycle_sleeps_cold_wakes_for_note_and_hard_stops() {
        let mut instance = GrandBouleInstance::new(48_000.0, 4);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        instance.note_on(60, 1.0);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);

        instance.process(128);
        instance.note_off(60);
        instance.process(128);
        assert_ne!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        instance.all_notes_off();
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);
    }
}
