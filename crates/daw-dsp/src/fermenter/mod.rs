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

use synth::{
    MasterSynth, MidiEvent, MIDI_EVENT_NOTE_EXPRESSION, MIDI_EVENT_NOTE_OFF, MIDI_EVENT_NOTE_ON,
};
use wasm_bindgen::prelude::*;
use crate::primitives::sanitize_block;

/// Events the engine can hold for one render block.
///
/// Fixed and preallocated: the audio thread must not allocate, so the list is a
/// plain array rather than a `Vec` that could grow inside `push_*`. 256 events
/// in a 128-frame block is two per sample. Past it the `push_*` methods return
/// `false` instead of dropping anything, so the caller carries the remainder
/// into the next block — the ceiling delays events, it does not lose them.
const MAX_BLOCK_EVENTS: usize = 256;

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

/// WASM-exported Fermenter instance for AudioWorklet.
#[wasm_bindgen]
pub struct FermenterInstance {
    synth: MasterSynth,
    left_buf: Vec<f32>,
    right_buf: Vec<f32>,
    /// Events queued for the next `process`, in the order they were pushed.
    events: [MidiEvent; MAX_BLOCK_EVENTS],
    event_count: usize,
    nan_flush_count: u64,
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
            events: [MidiEvent::default(); MAX_BLOCK_EVENTS],
            event_count: 0,
            nan_flush_count: 0,
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

    /// Queue a note-on at `offset` samples into the next rendered block.
    ///
    /// Returns `false` when the block's event list is full, so the caller can
    /// hold the event back for the next block instead of losing it. Events must
    /// be pushed in non-decreasing `offset` order — the engine applies them in
    /// the order given and never sorts, so a note-off and a re-trigger of one
    /// pitch on the same sample keep the sequence the caller intended.
    pub fn push_note_on(&mut self, note: u8, velocity: u8, channel: u8, offset: u32) -> bool {
        self.push_event(MidiEvent {
            kind: MIDI_EVENT_NOTE_ON,
            note,
            velocity,
            channel: Some(channel),
            offset,
            ..MidiEvent::default()
        })
    }

    /// Queue a note-off releasing every voice at `note`, at `offset` samples
    /// into the next rendered block.
    pub fn push_note_off(&mut self, note: u8, offset: u32) -> bool {
        self.push_event(MidiEvent {
            kind: MIDI_EVENT_NOTE_OFF,
            note,
            offset,
            ..MidiEvent::default()
        })
    }

    /// Queue a note-off narrowed to one MPE member channel (audit MD-2).
    pub fn push_note_off_on_channel(&mut self, note: u8, channel: u8, offset: u32) -> bool {
        self.push_event(MidiEvent {
            kind: MIDI_EVENT_NOTE_OFF,
            note,
            channel: Some(channel),
            offset,
            ..MidiEvent::default()
        })
    }

    /// Queue MPE per-note expression at `offset` samples into the next block.
    pub fn push_note_expression(
        &mut self,
        note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
        offset: u32,
    ) -> bool {
        self.push_event(MidiEvent {
            kind: MIDI_EVENT_NOTE_EXPRESSION,
            note,
            channel: Some(channel),
            bend_semitones,
            pressure,
            slide,
            offset,
            ..MidiEvent::default()
        })
    }

    /// Process a block of 128 samples. Returns pointer to left channel.
    /// Caller reads left + right from WASM memory.
    ///
    /// Consumes every event queued since the last call, splitting the render at
    /// each event's sample offset, and empties the list.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = (block_size as usize).min(self.left_buf.len());
        self.left_buf[..size].fill(0.0);
        self.right_buf[..size].fill(0.0);

        let event_count = self.event_count;
        self.event_count = 0;
        self.synth.process_block(
            &mut self.left_buf[..size],
            &mut self.right_buf[..size],
            &self.events[..event_count],
        );

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

    /// Get pointer to right channel buffer (call after process).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.right_buf.as_ptr()
    }

    /// Get number of currently sounding voices.
    pub fn active_voices(&self) -> u32 {
        self.synth.active_voice_count() as u32
    }
}

impl FermenterInstance {
    /// Append to the block's event list. Bounded by `MAX_BLOCK_EVENTS`, so this
    /// writes into already-owned storage and never allocates.
    fn push_event(&mut self, event: MidiEvent) -> bool {
        if self.event_count >= MAX_BLOCK_EVENTS {
            return false;
        }
        self.events[self.event_count] = event;
        self.event_count += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use assert_no_alloc::assert_no_alloc;

    use super::{FermenterInstance, MAX_BLOCK_EVENTS};

    /// Index of the first sample the instance rendered as non-zero.
    fn first_sounding_sample(instance: &FermenterInstance, size: usize) -> Option<usize> {
        (0..size).find(|&index| instance.left_buf[index] != 0.0 || instance.right_buf[index] != 0.0)
    }

    #[test]
    fn a_pushed_note_starts_on_its_own_sample_not_on_the_block_boundary() {
        // 37 is deliberately not a multiple of anything: the whole defect was
        // that `process` passed an empty event slice, so every scheduled note
        // collapsed onto sample 0 of the block.
        for offset in [0_u32, 1, 37, 64, 101, 127] {
            let mut instance = FermenterInstance::new(48_000.0, 8);

            assert!(instance.push_note_on(60, 100, 0, offset));
            instance.process(128);

            assert_eq!(
                first_sounding_sample(&instance, 128),
                Some(offset as usize),
                "note pushed at sample {offset} did not start there"
            );
        }
    }

    #[test]
    fn the_event_list_is_consumed_by_the_block_that_renders_it() {
        let mut instance = FermenterInstance::new(48_000.0, 8);
        instance.push_note_on(60, 100, 0, 64);

        instance.process(128);
        let voices_after_first_block = instance.active_voices();
        instance.process(128);

        // A list left un-emptied would re-apply the note-on and allocate a
        // second voice; a continuing block also renders from its first sample
        // rather than restarting at offset 64.
        assert_eq!(voices_after_first_block, 1);
        assert_eq!(instance.active_voices(), 1);
        assert_eq!(first_sounding_sample(&instance, 128), Some(0));
    }

    #[test]
    fn push_reports_a_full_block_event_list_instead_of_growing_it() {
        let mut instance = FermenterInstance::new(48_000.0, 8);

        for index in 0..MAX_BLOCK_EVENTS {
            assert!(
                instance.push_note_on(60, 100, 0, 0),
                "event {index} was refused below capacity"
            );
        }

        assert!(!instance.push_note_on(60, 100, 0, 0));
        assert!(!instance.push_note_off(60, 0));
        assert!(!instance.push_note_off_on_channel(60, 1, 0));
        assert!(!instance.push_note_expression(60, 0, 1.0, 0.5, 0.0, 0));

        // The refusal is per block: rendering clears the list and the next push
        // is accepted again.
        instance.process(128);
        assert!(instance.push_note_on(62, 100, 0, 0));
    }

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
}
