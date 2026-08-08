pub mod engine;
pub mod pitch_edit;
pub mod psola;
pub mod utils;
pub mod voicing;
pub mod yin;

use crate::primitives::sanitize_block;
use engine::KneadEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct KneadInstance {
    engine: KneadEngine,
    left_buf: Vec<f32>,
    right_buf: Vec<f32>,
    nan_flush_count: u64,
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
            nan_flush_count: 0,
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

    /// Retune speed in milliseconds: how long the rendered shift takes to
    /// arrive at a new blob's target. `0` snaps, which is what the engine did
    /// unconditionally before this export existed.
    pub fn set_retune_speed_ms(&mut self, ms: f32) {
        self.engine.set_retune_speed_ms(ms);
    }

    /// Formant correction. `true` (the default) keeps the spectral envelope
    /// where the singer put it while the fundamental moves; `false` lets the
    /// envelope track the pitch, the varispeed relation.
    pub fn set_formant_preserve(&mut self, preserve: bool) {
        self.engine.set_formant_preserve(preserve);
    }

    /// Samples of group delay this instance imposes, for plugin delay
    /// compensation. Mirrors `GlutenInstance::get_latency_samples`; the worklet
    /// forwards it on the ready handshake so PDC can offset the track.
    pub fn get_latency_samples(&self) -> u32 {
        self.engine.latency_samples()
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

    /// The wasm boundary must surface the engine's real group delay, not zero —
    /// the worklet reads exactly this export to populate the ready handshake that
    /// drives PDC.
    #[test]
    fn instance_reports_the_engine_group_delay_to_pdc() {
        let inst = KneadInstance::new(48000.0);
        assert_eq!(inst.get_latency_samples(), inst.engine.latency_samples());
        assert_eq!(inst.get_latency_samples(), 2047);
    }

    /// DSP-8 red→green: a non-finite sample injected into the signal reaches
    /// the raw engine output (the layer beneath the wasm boundary has no
    /// guard), and the `KneadInstance` output boundary scrubs it to silence
    /// while surfacing the flush on the telemetry counter. Knead at the default
    /// 0-semitone shift is a pure passthrough with no internal `is_finite`
    /// guard, so the poison survives to the buffer unless the boundary scrubs it.
    #[test]
    fn nan_in_signal_is_scrubbed_at_the_output_boundary() {
        // Feed more than one analysis frame (frame_size = 2048) so the engine's
        // ring buffer flushes the injected signal to its output in this block.
        let frames = 4096usize;
        let poison_l: Vec<f32> = vec![f32::NAN; frames];
        let poison_r: Vec<f32> = (0..frames)
            .map(|i| {
                if i % 2 == 0 {
                    f32::INFINITY
                } else {
                    f32::NEG_INFINITY
                }
            })
            .collect();

        // RED: the raw engine (the layer beneath the wasm boundary) has no
        // NaN/Inf guard, so the non-finite samples reach the output buffer.
        let mut engine = KneadEngine::new(48_000.0);
        let mut raw_l = poison_l.clone();
        let mut raw_r = poison_r.clone();
        engine.process_block(&mut raw_l, &mut raw_r);
        let raw_nonfinite = raw_l
            .iter()
            .chain(raw_r.iter())
            .filter(|s| !s.is_finite())
            .count();
        assert!(
            raw_nonfinite > 0,
            "precondition: the raw engine has no boundary guard and propagates the poison"
        );

        // GREEN: the instance boundary scrubs every non-finite sample to
        // silence and surfaces the exact flush count on the telemetry counter.
        let mut inst = KneadInstance::new(48_000.0);
        unsafe {
            let in_l = inst.get_input_left_ptr();
            let in_r = inst.get_input_right_ptr();
            for i in 0..frames {
                *in_l.add(i) = poison_l[i];
                *in_r.add(i) = poison_r[i];
            }
        }
        let out_l = inst.process(frames as u32);
        let out_r = inst.get_right_ptr();
        let left = unsafe { std::slice::from_raw_parts(out_l, frames) };
        let right = unsafe { std::slice::from_raw_parts(out_r, frames) };
        assert!(
            left.iter().chain(right.iter()).all(|s| s.is_finite()),
            "every non-finite output sample must be scrubbed at the boundary"
        );
        assert_eq!(
            inst.get_nan_flush_count(),
            raw_nonfinite as f64,
            "the flush counter surfaces exactly the non-finite samples the engine produced"
        );
    }

    /// DSP-8: the boundary guard is transparent for a well-behaved signal — a
    /// finite block is returned bit-for-bit identical to the raw engine output,
    /// and nothing is counted as flushed.
    #[test]
    fn boundary_guard_is_bit_exact_for_finite_signal() {
        let frames = 4096usize;
        let signal: Vec<f32> = (0..frames)
            .map(|i| ((i as f32) * 0.05).sin() * 0.5 - 0.123)
            .collect();

        let mut engine = KneadEngine::new(48_000.0);
        let mut raw_l = signal.clone();
        let mut raw_r = signal.clone();
        engine.process_block(&mut raw_l, &mut raw_r);

        let mut inst = KneadInstance::new(48_000.0);
        unsafe {
            let in_l = inst.get_input_left_ptr();
            let in_r = inst.get_input_right_ptr();
            for i in 0..frames {
                *in_l.add(i) = signal[i];
                *in_r.add(i) = signal[i];
            }
        }
        let out_l = inst.process(frames as u32);
        let out_r = inst.get_right_ptr();
        let left = unsafe { std::slice::from_raw_parts(out_l, frames) };
        let right = unsafe { std::slice::from_raw_parts(out_r, frames) };

        for i in 0..frames {
            assert_eq!(
                left[i].to_bits(),
                raw_l[i].to_bits(),
                "left sample {i} altered by the guard"
            );
            assert_eq!(
                right[i].to_bits(),
                raw_r[i].to_bits(),
                "right sample {i} altered by the guard"
            );
        }
        assert_eq!(
            inst.get_nan_flush_count(),
            0.0,
            "a finite block flushes nothing"
        );
    }
}
