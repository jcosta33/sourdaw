//! Fermenter — Sourdaw's master synthesizer engine.
//!
//! Compiles to both native (Rust library) and WASM (AudioWorklet).
//! All DSP is lock-free, allocation-free in the audio path.

pub mod additive;
pub mod chaos;
pub mod effects;
pub mod envelope;
pub mod filter;
pub mod fm;
pub mod granular;
pub mod layer;
pub mod lfo;
pub mod modulation;
pub mod mseg;
pub mod noise;
pub mod oscillator;
pub mod params;
pub mod physical;
pub mod sampler;
pub mod spectral;
pub mod stepseq;
pub mod synth;
pub mod voice;

use synth::MasterSynth;
use wasm_bindgen::prelude::*;

/// WASM-exported Fermenter instance for AudioWorklet.
#[wasm_bindgen]
pub struct FermenterInstance {
    synth: MasterSynth,
    left_buf: Vec<f32>,
    right_buf: Vec<f32>,
}

#[wasm_bindgen]
impl FermenterInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32, max_voices: u32) -> Self {
        let block_size = 128;
        Self {
            synth: MasterSynth::new(sample_rate, max_voices as usize),
            left_buf: vec![0.0; block_size],
            right_buf: vec![0.0; block_size],
        }
    }

    /// Set a named parameter value.
    pub fn set_param(&mut self, name: &str, value: f32) {
        self.synth.set_param(name, value);
    }

    /// Process a MIDI note on event.
    pub fn note_on(&mut self, note: u8, velocity: u8) {
        self.synth.note_on(note, velocity);
    }

    /// Process a MIDI note off event.
    pub fn note_off(&mut self, note: u8) {
        self.synth.note_off(note);
    }

    /// Process a block of 128 samples. Returns pointer to left channel.
    /// Caller reads left + right from WASM memory.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = (block_size as usize).min(self.left_buf.len());
        self.left_buf[..size].fill(0.0);
        self.right_buf[..size].fill(0.0);

        self.synth
            .process_block(&mut self.left_buf[..size], &mut self.right_buf[..size], &[]);

        self.left_buf.as_ptr()
    }

    /// Get pointer to right channel buffer (call after process).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.right_buf.as_ptr()
    }

    /// Get number of currently sounding voices.
    pub fn active_voices(&self) -> u32 {
        self.synth.active_voice_count() as u32
    }
}
