pub mod engine;
pub mod psola;
pub mod voicing;
pub mod yin;

use engine::KneadEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct KneadInstance {
    engine: KneadEngine,
    left_buf: Vec<f32>,
}

#[wasm_bindgen]
impl KneadInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let block_size = 128;
        Self {
            engine: KneadEngine::new(sample_rate),
            left_buf: vec![0.0; block_size],
        }
    }

    pub fn process(&mut self, frames: u32) -> *const f32 {
        let size = frames as usize;
        if self.left_buf.len() < size {
            self.left_buf.resize(size, 0.0);
        }

        // Apply processing into buffer natively
        self.engine.process_analysis_frame(&self.left_buf[..size]);

        self.left_buf.as_ptr()
    }
}
pub mod utils;
