//! Toaster — Sourdaw's drum machine DSP engine.
//!
//! Compiles to both native (Rust library) and WASM (AudioWorklet).
//! All DSP is lock-free, allocation-free in the audio path.

pub mod adaa;
pub mod bridged_t;
pub mod dc_block;
pub mod engine;
pub mod engines;
pub mod euclidean;
pub mod lofi;
pub mod mu_law;
pub mod pad;
pub mod poly_blep;
pub mod sp1200;
pub mod tolerance;
pub mod transient;
pub mod voice;

use engine::ToasterEngine;
use wasm_bindgen::prelude::*;

const MAX_BLOCK_SIZE: usize = 4096;

/// WASM-exported Toaster instance for AudioWorklet.
#[wasm_bindgen]
pub struct ToasterInstance {
    engine: ToasterEngine,
    output_buf: Vec<f32>,
    num_pads: usize,
}

#[wasm_bindgen]
impl ToasterInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32, num_pads: u32) -> Self {
        let num_pads = num_pads as usize;
        let output_channels = 2 + num_pads * 2;
        Self {
            engine: ToasterEngine::new(sample_rate, num_pads),
            output_buf: vec![0.0; output_channels * MAX_BLOCK_SIZE],
            num_pads,
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

    /// Transfer or restore ownership of a pad's dry contribution to output 0.
    pub fn set_pad_dry_routed(&mut self, pad: u8, routed: bool) {
        self.engine.set_pad_dry_routed(pad, routed);
    }

    /// Restore legacy parent-mix ownership for every pad.
    pub fn reset_pad_dry_routing(&mut self) {
        self.engine.reset_pad_dry_routing();
    }

    /// Process a block of audio. Returns pointer to left channel buffer.
    /// Caller reads left + right from WASM memory.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = (block_size as usize).min(MAX_BLOCK_SIZE);
        let (left_buf, remaining) = self.output_buf.split_at_mut(MAX_BLOCK_SIZE);
        let (right_buf, pad_outputs) = remaining.split_at_mut(MAX_BLOCK_SIZE);
        let pad_output_len = self.num_pads * 2 * MAX_BLOCK_SIZE;
        self.engine.process_block_with_pad_outputs(
            &mut left_buf[..size],
            &mut right_buf[..size],
            &mut pad_outputs[..pad_output_len],
            MAX_BLOCK_SIZE,
        );

        self.output_buf.as_ptr()
    }

    /// Get pointer to right channel buffer (call after process).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.output_buf.as_ptr().wrapping_add(MAX_BLOCK_SIZE)
    }
}
