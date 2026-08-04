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

use crate::primitives::sanitize_block;
use engine::ToasterEngine;
use wasm_bindgen::prelude::*;

const MAX_BLOCK_SIZE: usize = 4096;

/// WASM-exported Toaster instance for AudioWorklet.
#[wasm_bindgen]
pub struct ToasterInstance {
    engine: ToasterEngine,
    output_buf: Vec<f32>,
    num_pads: usize,
    nan_flush_count: u64,
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
            nan_flush_count: 0,
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

    /// Set an automatable global parameter without string marshaling.
    pub fn set_param_by_id(&mut self, param_id: u32, value: f32) {
        self.engine.set_param_by_id(param_id, value);
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

    /// Advance control-rate state while the processor is intentionally asleep.
    pub fn advance_silence(&mut self, block_size: u32) {
        self.engine
            .advance_silence((block_size as usize).min(MAX_BLOCK_SIZE));
    }

    /// Stable processor lifecycle code shared with the AudioWorklet host.
    pub fn lifecycle_state(&self) -> u32 {
        self.engine.lifecycle().code()
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

        let mut scrubbed = sanitize_block(&mut left_buf[..size]);
        scrubbed += sanitize_block(&mut right_buf[..size]);
        for channel in pad_outputs[..pad_output_len].chunks_exact_mut(MAX_BLOCK_SIZE) {
            scrubbed += sanitize_block(&mut channel[..size]);
        }
        self.nan_flush_count += scrubbed as u64;

        self.output_buf.as_ptr()
    }

    /// Number of non-finite output samples scrubbed to silence since
    /// construction (DSP-8). Covers the main stereo pair and every pad output;
    /// non-zero means a poisoned block was caught at the wasm output boundary.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
    }

    /// Get pointer to right channel buffer (call after process).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.output_buf.as_ptr().wrapping_add(MAX_BLOCK_SIZE)
    }
}

#[cfg(test)]
mod tests {
    use assert_no_alloc::assert_no_alloc;

    use crate::primitives::ProcessLifecycle;

    use super::engine::{PlateReverb, StereoDelay};
    use super::{ToasterInstance, MAX_BLOCK_SIZE};

    #[test]
    fn numeric_mix_setter_does_not_allocate() {
        let mut instance = ToasterInstance::new(48_000.0, 16);
        assert_no_alloc(|| {
            for param_id in 0..3 {
                instance.set_param_by_id(param_id, 0.5);
            }
            instance.set_param_by_id(u32::MAX, 0.5);
        });
    }

    #[test]
    fn inactive_pad_capacity_is_not_scanned_as_rendered_output() {
        let mut instance = ToasterInstance::new(48_000.0, 16);
        let first_pad_output = 2 * MAX_BLOCK_SIZE;
        instance.output_buf[first_pad_output + 1] = f32::NAN;

        instance.process(1);

        assert_eq!(instance.get_nan_flush_count(), 0.0);
    }

    #[test]
    fn cold_instance_sleeps_and_note_on_wakes_it() {
        let mut instance = ToasterInstance::new(48_000.0, 16);

        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::Sleep.code());

        instance.note_on(0, 100.0, 60);

        assert_eq!(
            instance.lifecycle_state(),
            ProcessLifecycle::Continue.code()
        );
    }

    #[test]
    fn effect_tail_finishes_before_the_instance_sleeps() {
        let mut instance = ToasterInstance::new(48_000.0, 16);
        instance.set_pad_param(0, "send_reverb", 1.0);
        instance.set_param("reverb_mix", 1.0);
        instance.note_on(0, 127.0, 60);

        let mut saw_effect_tail = false;
        let mut reached_sleep = false;
        for _ in 0..8_000 {
            instance.process(128);
            let lifecycle = instance.lifecycle_state();
            if lifecycle == ProcessLifecycle::ContinueIfNotQuiet.code() {
                saw_effect_tail = true;
            }
            if lifecycle == ProcessLifecycle::Sleep.code() {
                reached_sleep = true;
                break;
            }
        }

        assert!(
            saw_effect_tail,
            "the reverb tail must outlive its drum voice"
        );
        assert!(
            reached_sleep,
            "the finite reverb tail must eventually settle"
        );
    }

    #[test]
    fn muted_delay_tail_remains_managed_until_it_settles() {
        let mut instance = ToasterInstance::new(48_000.0, 16);
        instance.set_pad_param(0, "send_delay", 1.0);
        instance.set_param("delay_mix", 0.0);
        instance.note_on(0, 127.0, 60);

        let mut saw_hidden_tail = false;
        let mut reached_sleep = false;
        for _ in 0..8_000 {
            instance.process(128);
            let lifecycle = instance.lifecycle_state();
            if lifecycle == ProcessLifecycle::ContinueIfNotQuiet.code() {
                saw_hidden_tail = true;
            }
            if lifecycle == ProcessLifecycle::Sleep.code() {
                reached_sleep = true;
                break;
            }
        }

        assert!(
            saw_hidden_tail,
            "delay state must remain managed even while its wet output is muted"
        );
        assert!(
            reached_sleep,
            "the finite muted delay tail must eventually settle"
        );
    }

    #[test]
    fn lifecycle_queries_and_silent_advance_do_not_allocate() {
        let mut instance = ToasterInstance::new(48_000.0, 16);

        assert_no_alloc(|| {
            for _ in 0..128 {
                let _ = instance.lifecycle_state();
                instance.advance_silence(128);
            }
        });
    }

    #[test]
    fn reverb_and_delay_mix_scale_their_wet_outputs() {
        let mut wet_reverb = PlateReverb::new(100.0);
        let mut muted_reverb = PlateReverb::new(100.0);
        wet_reverb.set_param("reverb_mix", 1.0);
        muted_reverb.set_param("reverb_mix", 0.0);
        let mut wet_energy = 0.0;
        let mut muted_energy = 0.0;
        for frame in 0..12 {
            let input = if frame == 0 { 1.0 } else { 0.0 };
            let wet = wet_reverb.process(input);
            let muted = muted_reverb.process(input);
            wet_energy += wet.0.abs() + wet.1.abs();
            muted_energy += muted.0.abs() + muted.1.abs();
        }

        let mut wet_delay = StereoDelay::new(100.0);
        let mut muted_delay = StereoDelay::new(100.0);
        for delay in [&mut wet_delay, &mut muted_delay] {
            delay.set_param("delay_time", 0.01, 100.0);
        }
        wet_delay.set_param("delay_mix", 1.0, 100.0);
        muted_delay.set_param("delay_mix", 0.0, 100.0);
        wet_delay.process(1.0);
        muted_delay.process(1.0);

        assert!(wet_energy > 0.0);
        assert_eq!(muted_energy, 0.0);
        assert!(wet_delay.process(0.0).0 > 0.0);
        assert_eq!(muted_delay.process(0.0), (0.0, 0.0));
    }
}
