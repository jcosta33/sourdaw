pub mod engine;
pub mod psola;
pub mod utils;
pub mod voicing;
pub mod yin;

use engine::KneadEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct KneadInstance {
    engine: KneadEngine,
    left_buf: Vec<f32>,
    right_buf: Vec<f32>,
}

#[wasm_bindgen]
impl KneadInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let block_size = 4096;
        Self {
            engine: KneadEngine::new(sample_rate),
            left_buf: vec![0.0; block_size],
            right_buf: vec![0.0; block_size],
        }
    }

    pub fn get_input_left_ptr(&mut self) -> *mut f32 {
        self.left_buf.as_mut_ptr()
    }

    pub fn get_input_right_ptr(&mut self) -> *mut f32 {
        self.right_buf.as_mut_ptr()
    }

    pub fn process(&mut self, frames: u32) -> *const f32 {
        let size = (frames as usize).min(self.left_buf.len());

        // Apply processing into buffers natively
        self.engine
            .process_block(&mut self.left_buf[..size], &mut self.right_buf[..size]);

        self.left_buf.as_ptr()
    }

    pub fn get_f0(&self) -> f32 {
        self.engine.get_f0().unwrap_or(0.0)
    }

    pub fn get_periodicity(&self) -> f32 {
        self.engine.get_periodicity()
    }

    pub fn is_voiced(&self) -> bool {
        self.engine.is_voiced()
    }
}
