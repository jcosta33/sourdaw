pub mod pitch_edit;
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

    /// Right-channel output of the last `process` call (mirrors
    /// `GlutenInstance::get_right_ptr`).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.right_buf.as_ptr()
    }

    /// Set the real-time pitch shift in semitones. Without this export the
    /// worklet's per-quantum `set_shift_semitones` call throws a TypeError
    /// and the processor faults into permanent passthrough.
    pub fn set_shift_semitones(&mut self, semitones: f32) {
        self.engine.set_shift_semitones(semitones);
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The worklet drives the instance through raw pointers; the shift setter
    /// and right-output getter must exist and reach the engine.
    #[test]
    fn instance_exposes_shift_setter_and_right_output() {
        let mut inst = KneadInstance::new(48000.0);
        inst.set_shift_semitones(3.0);
        assert_eq!(inst.engine.shift_semitones, 3.0);

        let frames = 128usize;
        unsafe {
            let in_l = inst.get_input_left_ptr();
            let in_r = inst.get_input_right_ptr();
            for i in 0..frames {
                *in_l.add(i) = 0.1;
                *in_r.add(i) = -0.1;
            }
        }
        let out_l = inst.process(frames as u32);
        let out_r = inst.get_right_ptr();
        assert_ne!(out_l, out_r, "right output must be a distinct buffer");
    }
}
