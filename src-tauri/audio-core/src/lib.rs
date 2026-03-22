use wasm_bindgen::prelude::*;
use core::f32::consts::PI;

#[wasm_bindgen]
pub struct WasmAudioProcessor {
    sample_rate: f32,
    phase: f32,
    phase_increment: f32,
    output_buffer: Vec<f32>,
}

#[wasm_bindgen]
impl WasmAudioProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        
        let freq = 440.0;
        let phase_increment = freq * 2.0 * PI / sample_rate;
        
        Self {
            sample_rate,
            phase: 0.0,
            phase_increment,
            output_buffer: vec![0.0; 128],
        }
    }
    
    /// Process a block of frames and return the pointer so JS can read it.
    #[wasm_bindgen]
    pub fn process_and_get_ptr(&mut self, frames: usize) -> *const f32 {
        if self.output_buffer.len() < frames {
            self.output_buffer.resize(frames, 0.0);
        }
        
        for i in 0..frames {
            self.output_buffer[i] = self.phase.sin() * 0.1;
            self.phase += self.phase_increment;
            if self.phase >= 2.0 * PI {
                self.phase -= 2.0 * PI;
            }
        }
        
        self.output_buffer.as_ptr()
    }
}
