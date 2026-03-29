//! Grinder — Sourdaw's drum machine DSP engine.
//!
//! Compiles to both native (Rust library) and WASM (AudioWorklet).
//! All DSP is lock-free, allocation-free in the audio path.

pub mod engines;
pub mod pad;
pub mod voice;
pub mod engine;
pub mod lofi;
pub mod transient;
pub mod euclidean;

use engine::GrinderEngine;
use wasm_bindgen::prelude::*;

/// WASM-exported Grinder instance for AudioWorklet.
#[wasm_bindgen]
pub struct GrinderInstance {
    engine: GrinderEngine,
    left_buf: Vec<f32>,
    right_buf: Vec<f32>,
}

#[wasm_bindgen]
impl GrinderInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32, num_pads: u32) -> Self {
        let block_size = 128;
        Self {
            engine: GrinderEngine::new(sample_rate, num_pads as usize),
            left_buf: vec![0.0; block_size],
            right_buf: vec![0.0; block_size],
        }
    }

    /// Trigger a drum pad. `midi_note` controls pitch (60 = default/center pitch).
    pub fn note_on(&mut self, pad: u8, velocity: f32, midi_note: u8) {
        self.engine.note_on(pad, velocity, midi_note);
    }

    /// Release a pad (for sustained sounds like open hi-hat).
    pub fn note_off(&mut self, pad: u8) {
        self.engine.note_off(pad);
    }

    /// Set a global parameter (master_gain, reverb_*, delay_*).
    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    /// Set a per-pad parameter (volume, pan, tune, filter_cutoff, etc.).
    pub fn set_pad_param(&mut self, pad: u8, name: &str, value: f32) {
        self.engine.set_pad_param(pad, name, value);
    }

    /// Process a block of audio. Returns pointer to left channel buffer.
    /// Caller reads left + right from WASM memory.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = block_size as usize;
        if self.left_buf.len() < size {
            self.left_buf.resize(size, 0.0);
            self.right_buf.resize(size, 0.0);
        }
        self.left_buf[..size].fill(0.0);
        self.right_buf[..size].fill(0.0);

        self.engine
            .process_block(&mut self.left_buf[..size], &mut self.right_buf[..size]);

        self.left_buf.as_ptr()
    }

    /// Get pointer to right channel buffer (call after process).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.right_buf.as_ptr()
    }
}
