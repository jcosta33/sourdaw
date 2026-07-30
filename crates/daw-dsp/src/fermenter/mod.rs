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

use crate::primitives::{sanitize_block, TailLength};
use synth::{MasterSynth, MidiEvent};
use wasm_bindgen::prelude::*;

const AUTOMATION_PARAM_NAMES: [&str; 15] = [
    "osc_level",
    "cutoff",
    "resonance",
    "lfo_rate",
    "lfo_filter_amount",
    "mod_lfo_to_pitch",
    "mod_env_to_filter",
    "mseg_to_filter",
    "unison_spread",
    "fm_level2",
    "fm_feedback",
    "noise_level",
    "grain_density",
    "grain_size",
    "grain_spray",
];
const MAX_SCHEDULED_EVENTS: usize = 256;

/// WASM-exported Fermenter instance for AudioWorklet.
#[wasm_bindgen]
pub struct FermenterInstance {
    synth: MasterSynth,
    left_buf: Vec<f32>,
    right_buf: Vec<f32>,
    nan_flush_count: u64,
    scheduled_events: [MidiEvent; MAX_SCHEDULED_EVENTS],
    scheduled_event_count: usize,
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
            nan_flush_count: 0,
            scheduled_events: [MidiEvent::EMPTY; MAX_SCHEDULED_EVENTS],
            scheduled_event_count: 0,
        }
    }

    /// Set a named parameter value.
    pub fn set_param(&mut self, name: &str, value: f32) {
        self.synth.set_param(name, value);
    }

    /// Set a supported automation parameter without crossing the WASM string bridge.
    pub fn set_param_by_id(&mut self, param_id: u32, value: f32) {
        if let Some(name) = AUTOMATION_PARAM_NAMES.get(param_id as usize) {
            self.synth.set_param(name, value);
        }
    }

    /// Process a MIDI note on event.
    pub fn note_on(&mut self, note: u8, velocity: u8) {
        self.synth.note_on(note, velocity);
    }

    /// Process a MIDI note on carrying its MPE member channel.
    pub fn note_on_with_channel(&mut self, note: u8, velocity: u8, channel: u8) {
        self.synth.note_on_with_channel(note, velocity, channel);
    }

    /// Process a MIDI note off event. Releases every voice at that pitch.
    pub fn note_off(&mut self, note: u8) {
        self.synth.note_off(note);
    }

    /// Note-off narrowed to one MPE member channel, so releasing a note on one
    /// member channel cannot silence a different note sounding the same pitch
    /// on another (audit MD-2).
    pub fn note_off_on_channel(&mut self, note: u8, channel: u8) {
        self.synth.note_off_matching(note, Some(channel));
    }

    /// Apply MPE per-note expression to the voices held on `channel` at `note`
    /// (audit MD-2).
    ///
    /// `bend_semitones` is the member-channel pitch bend already resolved
    /// against the controller's bend range; `pressure` is 0..1; `slide` is the
    /// CC74 timbre as -1..1 with 0 neutral. Normalisation from wire units lives
    /// on the TypeScript side so the live and scheduled paths share one
    /// conversion.
    pub fn note_expression(
        &mut self,
        note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
    ) {
        self.synth
            .note_expression(note, channel, bend_semitones, pressure, slide);
    }

    /// Queue one sample-offset note-on for the next process call.
    pub fn schedule_note_on(&mut self, note: u8, velocity: u8, channel: u8, offset: u32) -> bool {
        self.push_scheduled_event(MidiEvent::note_on(note, velocity, channel, offset))
    }

    /// Queue one sample-offset note-off for the next process call. Channel 255 releases all channels.
    pub fn schedule_note_off(&mut self, note: u8, channel: u8, offset: u32) -> bool {
        self.push_scheduled_event(MidiEvent::note_off(note, channel, offset))
    }

    /// Queue one sample-offset MPE expression event for the next process call.
    pub fn schedule_note_expression(
        &mut self,
        note: u8,
        channel: u8,
        offset: u32,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
    ) -> bool {
        self.push_scheduled_event(MidiEvent::note_expression(
            note,
            channel,
            offset,
            bend_semitones,
            pressure,
            slide,
        ))
    }

    /// Process a block of 128 samples. Returns pointer to left channel.
    /// Caller reads left + right from WASM memory.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = (block_size as usize).min(self.left_buf.len());
        self.left_buf[..size].fill(0.0);
        self.right_buf[..size].fill(0.0);

        self.synth.process_block(
            &mut self.left_buf[..size],
            &mut self.right_buf[..size],
            &self.scheduled_events[..self.scheduled_event_count],
        );
        self.scheduled_event_count = 0;

        self.nan_flush_count += sanitize_block(&mut self.left_buf[..size]) as u64;
        self.nan_flush_count += sanitize_block(&mut self.right_buf[..size]) as u64;

        self.left_buf.as_ptr()
    }

    /// Advance control-rate smoothing while DSP is asleep.
    pub fn advance_silence(&mut self) {
        self.synth.advance_silent_block();
    }

    /// Stable numeric lifecycle code consumed by the AudioWorklet host.
    pub fn lifecycle_state(&self) -> u32 {
        self.synth.lifecycle().code()
    }

    /// Remaining finite tail samples, -1 for an infinite tail, or 0 outside tail state.
    pub fn tail_samples(&self) -> f64 {
        match self.synth.lifecycle().tail_samples() {
            Some(TailLength::Finite(samples)) => samples as f64,
            Some(TailLength::Infinite) => -1.0,
            None => 0.0,
        }
    }

    /// Number of non-finite output samples scrubbed to silence since
    /// construction (DSP-8). Non-zero means a poisoned block was caught at the
    /// wasm output boundary and surfaced for health telemetry.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
    }

    /// Get pointer to right channel buffer (call after process).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.right_buf.as_ptr()
    }

    /// Get number of currently sounding voices.
    pub fn active_voices(&self) -> u32 {
        self.synth.active_voice_count() as u32
    }

    fn push_scheduled_event(&mut self, event: MidiEvent) -> bool {
        let Some(slot) = self.scheduled_events.get_mut(self.scheduled_event_count) else {
            return false;
        };
        *slot = event;
        self.scheduled_event_count += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use assert_no_alloc::assert_no_alloc;

    use super::{FermenterInstance, MAX_SCHEDULED_EVENTS};
    use crate::primitives::ProcessLifecycle;

    #[test]
    fn numeric_automation_setter_does_not_allocate() {
        let mut instance = FermenterInstance::new(48_000.0, 32);
        assert_no_alloc(|| {
            for param_id in 0..15 {
                instance.set_param_by_id(param_id, 0.5);
            }
            instance.set_param_by_id(u32::MAX, 0.5);
        });
    }

    #[test]
    fn scheduled_note_starts_at_its_sample_offset() {
        let mut instance = FermenterInstance::new(48_000.0, 32);
        assert!(instance.schedule_note_on(60, 100, 0, 64));

        let left_ptr = instance.process(128);
        let right_ptr = instance.get_right_ptr();
        let left = unsafe { std::slice::from_raw_parts(left_ptr, 128) };
        let right = unsafe { std::slice::from_raw_parts(right_ptr, 128) };

        assert!(left[..64]
            .iter()
            .chain(&right[..64])
            .all(|sample| *sample == 0.0));
        let sounding_energy = left[64..]
            .iter()
            .chain(&right[64..])
            .map(|sample| sample.abs())
            .sum::<f32>();
        assert!(sounding_energy > 0.0);
    }

    #[test]
    fn scheduled_event_capacity_is_fixed_and_reports_overflow() {
        let mut instance = FermenterInstance::new(48_000.0, 32);

        for offset in 0..MAX_SCHEDULED_EVENTS {
            assert!(instance.schedule_note_on(60, 100, 0, offset as u32));
        }
        assert!(!instance.schedule_note_off(60, 0, 127));
    }

    #[test]
    fn scheduling_and_processing_events_does_not_allocate() {
        let mut instance = FermenterInstance::new(48_000.0, 32);

        assert_no_alloc(|| {
            assert!(instance.schedule_note_on(60, 100, 2, 16));
            assert!(instance.schedule_note_expression(60, 2, 32, 1.0, 0.5, -0.25));
            assert!(instance.schedule_note_off(60, 2, 96));
            instance.process(128);
        });
    }

    #[test]
    fn lifecycle_sleeps_cold_wakes_for_note_and_preserves_default_reverb_tail() {
        let mut instance = FermenterInstance::new(48_000.0, 32);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        instance.note_on(60, 100);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);
        instance.process(128);
        instance.note_off(60);

        let mut observed_tail = false;
        for _ in 0..4_000 {
            instance.process(128);
            let state = instance.lifecycle_state();
            observed_tail |= state == ProcessLifecycle::CONTINUE_IF_NOT_QUIET_CODE
                || state == ProcessLifecycle::TAIL_CODE;
            if state == ProcessLifecycle::SLEEP_CODE {
                break;
            }
        }

        assert!(observed_tail);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        let left_ptr = instance.process(128);
        let right_ptr = instance.get_right_ptr();
        let left = unsafe { std::slice::from_raw_parts(left_ptr, 128) };
        let right = unsafe { std::slice::from_raw_parts(right_ptr, 128) };
        let peak = left
            .iter()
            .chain(right)
            .fold(0.0f32, |current, sample| current.max(sample.abs()));
        assert!(
            peak <= 3.162_277_6e-8,
            "post-sleep peak {peak} exceeded the lifecycle quiet threshold"
        );

        instance.note_on(67, 90);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);
    }
}
