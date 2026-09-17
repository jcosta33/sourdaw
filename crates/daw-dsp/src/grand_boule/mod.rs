//! Grand Boule — Sourdaw's modelled grand piano.
//!
//! Modal synthesis engine producing polyphonic piano audio from an inharmonic
//! string bank driven by a nonlinear felt-hammer interaction, followed by a
//! finite FIR body. Compiles to native and WASM hosts.
//!
//! The audio path is lock-free and allocation-free after construction.
//!
//! Provenance: implementation, body kernels, and tuning curves are
//! project-authored product voicings; standard MIDI, temperament, and piano
//! construction conventions are used only as general engineering inputs.

pub mod attack_sampler;
pub mod coupled_strings;
pub mod duplex;
pub mod engine;
pub mod hammer;
pub mod longitudinal;
pub mod mechanical_noise;
pub mod midi2;
pub mod parameters;
pub mod pedals;
mod radiation;
pub mod soundboard;
pub mod string;
pub mod sympathetic;
pub mod voice;

use crate::primitives::{sanitize_block, ProcessLifecycle};
use engine::{GrandBouleEngine, DEFAULT_VOICE_COUNT};
use parameters::Temperament;
use wasm_bindgen::prelude::*;

/// Frames one [`GrandBouleInstance::process`] call renders at most, and the
/// length of both channel buffers.
///
/// `process` clamps its argument to this without saying so, so a longer ask
/// renders this many frames and leaves the remainder of the caller's block
/// untouched. A host reading the returned pointers may therefore read at most
/// `min(asked, GRAND_BOULE_BLOCK_FRAMES)` frames out of either channel.
///
/// Restatement of the engine's callback ceiling,
/// `daw_engine::audio_thread::MAX_CALLBACK_FRAMES`: `daw-dsp` cannot depend
/// on the engine, so the figure is restated here and every copy must move
/// with the ceiling.
pub const GRAND_BOULE_BLOCK_FRAMES: usize = 4096;

/// Events one [`GrandBouleInstance::process`] call can hold offsets for.
///
/// Fixed and preallocated: the audio thread must not allocate, so the list is a
/// plain array rather than a `Vec` the `push_*` methods could grow. 256 is
/// twice what a native block can carry — `daw-engine` hands a body at most
/// `MIDI_EVENT_BUFFER_CAPACITY` (128) events per block and the list empties on
/// every `process` — and past it the `push_*` methods answer `false` instead of
/// dropping anything, so the caller carries the remainder into the next block.
/// The ceiling delays events; it never loses them.
const GRAND_BOULE_MAX_BLOCK_EVENTS: usize = 256;

/// [`GrandBouleEvent::kind`] — release the voices at the pitch. Zero so it is
/// what `Default` produces.
const GRAND_BOULE_EVENT_NOTE_OFF: u8 = 0;
/// [`GrandBouleEvent::kind`] — strike the pitch.
const GRAND_BOULE_EVENT_NOTE_ON: u8 = 1;
/// [`GrandBouleEvent::kind`] — MPE per-note expression on a sounding voice.
const GRAND_BOULE_EVENT_NOTE_EXPRESSION: u8 = 2;

/// One note event queued for the block [`GrandBouleInstance::process`] is about
/// to render, carrying the sample offset inside that block it takes effect on.
#[derive(Clone, Copy, Default)]
struct GrandBouleEvent {
    /// One of the `GRAND_BOULE_EVENT_*` constants. Anything else is ignored.
    kind: u8,
    note: u8,
    /// The `0..1` fraction the engine's note-on takes, not a MIDI byte.
    velocity: f32,
    /// MPE member channel. `None` on a note-off releases *every* voice at the
    /// pitch — the channel-unaware behaviour [`GrandBouleInstance::note_off`]
    /// has always had — and on the other kinds means member channel 0.
    channel: Option<u8>,
    /// Expression payload; read only for [`GRAND_BOULE_EVENT_NOTE_EXPRESSION`].
    bend_semitones: f32,
    pressure: f32,
    slide: f32,
    /// Sample offset within the block about to render.
    offset: u32,
}

/// Grand Boule host instance for native and WASM integration.
#[wasm_bindgen]
pub struct GrandBouleInstance {
    engine: GrandBouleEngine,
    left_buf: Vec<f32>,
    right_buf: Vec<f32>,
    /// Events queued for the next `process`, in the order they were pushed.
    events: [GrandBouleEvent; GRAND_BOULE_MAX_BLOCK_EVENTS],
    event_count: usize,
    nan_flush_count: u64,
}

#[wasm_bindgen]
impl GrandBouleInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32, voice_count: u32) -> Self {
        let count = if voice_count == 0 {
            DEFAULT_VOICE_COUNT
        } else {
            voice_count as usize
        };
        Self {
            engine: GrandBouleEngine::new(sample_rate, count),
            left_buf: vec![0.0; GRAND_BOULE_BLOCK_FRAMES],
            right_buf: vec![0.0; GRAND_BOULE_BLOCK_FRAMES],
            events: [GrandBouleEvent::default(); GRAND_BOULE_MAX_BLOCK_EVENTS],
            event_count: 0,
            nan_flush_count: 0,
        }
    }

    /// Trigger a note at the head of the next block. `midi_note` covers the
    /// full MIDI range; out-of-piano notes are silently ignored.
    ///
    /// The immediate tier of this instance's note API. It takes effect the
    /// moment it is called, so the next `process` renders every frame with the
    /// note already struck — which is what a key a player is pressing now
    /// wants, having no frame of its own to sound on. A note that *does* carry
    /// a frame belongs on the offset-queued tier ([`Self::push_note_on`] and
    /// its siblings), which sounds it on that frame inside the block.
    pub fn note_on(&mut self, midi_note: u8, velocity: f32) {
        self.engine.note_on(midi_note, velocity);
    }

    /// Begin the release phase for any voice holding this note.
    pub fn note_off(&mut self, midi_note: u8) {
        self.engine.note_off(midi_note);
    }

    /// Authoritative number of sounding voices in the playable pool.
    pub fn active_voices(&self) -> u32 {
        self.engine.active_voice_count() as u32
    }

    /// Trigger a note carrying its MPE member channel.
    pub fn note_on_with_channel(&mut self, midi_note: u8, velocity: f32, channel: u8) {
        self.engine
            .note_on_with_channel(midi_note, velocity, channel);
    }

    /// Note-off narrowed to one MPE member channel (audit MD-2).
    pub fn note_off_on_channel(&mut self, midi_note: u8, channel: u8) {
        self.engine.note_off_on_channel(midi_note, channel);
    }

    /// Apply MPE per-note expression to the voice held on `channel` at
    /// `midi_note` (audit MD-2).
    ///
    /// Grand Boule sounds `bend_semitones` only: the ringing modal strings are
    /// retuned in place. `pressure` and `slide` have no physical counterpart on
    /// a struck string and are dropped — the expression registry advertises
    /// pitch bend alone, so the editor never offers those lanes for this device.
    pub fn note_expression(
        &mut self,
        midi_note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
    ) {
        self.engine
            .note_expression(midi_note, channel, bend_semitones, pressure, slide);
    }

    /// Queue a note-on at `offset` samples into the next rendered block.
    ///
    /// The offset-queued tier of this instance's note API: the block's render
    /// splits at `offset` and the note is struck there, so a scheduled note
    /// sounds on the frame it was written for instead of on the block boundary.
    /// An `offset` at or past the block's own length sounds from the first
    /// frame of the block after it.
    ///
    /// Returns `false` when the block's event list is full, so the caller can
    /// hold the event back for the next block instead of losing it. Events are
    /// applied **in the order they were pushed** and are never sorted, so a
    /// note-off and a re-trigger of one pitch on the same sample keep the
    /// sequence the caller intended; an out-of-order offset is applied at the
    /// render cursor rather than retroactively, and the caller owns the
    /// ordering.
    pub fn push_note_on(&mut self, midi_note: u8, velocity: f32, channel: u8, offset: u32) -> bool {
        self.push_event(GrandBouleEvent {
            kind: GRAND_BOULE_EVENT_NOTE_ON,
            note: midi_note,
            velocity,
            channel: Some(channel),
            offset,
            ..GrandBouleEvent::default()
        })
    }

    /// Queue a note-off releasing every voice at `midi_note`, at `offset`
    /// samples into the next rendered block. Ordering and refusal as
    /// [`Self::push_note_on`].
    pub fn push_note_off(&mut self, midi_note: u8, offset: u32) -> bool {
        self.push_event(GrandBouleEvent {
            kind: GRAND_BOULE_EVENT_NOTE_OFF,
            note: midi_note,
            offset,
            ..GrandBouleEvent::default()
        })
    }

    /// Queue a note-off narrowed to one MPE member channel (audit MD-2), at
    /// `offset` samples into the next rendered block.
    pub fn push_note_off_on_channel(&mut self, midi_note: u8, channel: u8, offset: u32) -> bool {
        self.push_event(GrandBouleEvent {
            kind: GRAND_BOULE_EVENT_NOTE_OFF,
            note: midi_note,
            channel: Some(channel),
            offset,
            ..GrandBouleEvent::default()
        })
    }

    /// Queue MPE per-note expression at `offset` samples into the next block.
    ///
    /// Queued rather than immediate for an ordering reason, not a timing one:
    /// a host orders a `noteExpression` behind the `noteOn` it bends at the
    /// same frame, and a note-on deferred to its offset while the expression
    /// stayed immediate would bend a voice that does not exist yet. The engine
    /// sounds `bend_semitones` only, as [`Self::note_expression`] states.
    pub fn push_note_expression(
        &mut self,
        midi_note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
        offset: u32,
    ) -> bool {
        self.push_event(GrandBouleEvent {
            kind: GRAND_BOULE_EVENT_NOTE_EXPRESSION,
            note: midi_note,
            channel: Some(channel),
            bend_semitones,
            pressure,
            slide,
            offset,
            ..GrandBouleEvent::default()
        })
    }

    /// Set a global parameter (`master_gain`, `soundboard_send`,
    /// `sympathetic_send`).
    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    /// Set the sustain pedal position (0..1).
    pub fn set_sustain(&mut self, position: f32) {
        self.engine.set_sustain(position);
    }

    /// Set the una-corda pedal state.
    pub fn set_una_corda(&mut self, engaged: bool) {
        self.engine.set_una_corda(engaged);
    }

    /// Set the sostenuto pedal state.
    pub fn set_sostenuto(&mut self, engaged: bool) {
        self.engine.set_sostenuto(engaged);
    }

    /// Trigger a MIDI 2.0 note-on with 16-bit velocity and Q24 pitch offset.
    pub fn note_on_midi2(&mut self, midi_note: u8, velocity_16bit: u32, pitch_offset_q24: i32) {
        self.engine.note_on_midi2(
            midi_note,
            velocity_16bit.min(0xFFFF) as u16,
            pitch_offset_q24,
        );
    }

    /// Load an attack-sample clip into the hybrid sampled-attack set.
    pub fn load_attack_clip(&mut self, key: u32, samples: &[f32]) {
        self.engine.attack_samples_mut().set_clip(key, samples);
    }

    /// Set the historical temperament (0 = Equal, 1 = Werckmeister III,
    /// 2 = Kirnberger III, 3 = Vallotti, 4 = Young II, 5 = Meantone ¼-comma).
    pub fn set_temperament(&mut self, index: u8) {
        self.engine.set_temperament(Temperament::from_u8(index));
    }

    /// Panic: silence every voice immediately, and drop what has not sounded.
    ///
    /// The queued list is cleared with the voices: a panic asks for silence,
    /// and an event still waiting for its offset would strike a note after the
    /// user pressed the button.
    pub fn all_notes_off(&mut self) {
        self.event_count = 0;
        self.engine.all_notes_off();
    }

    /// Current DSP-owned render lifecycle for the worker host.
    ///
    /// A queued event means the host must render whatever the engine's own
    /// state says: the note has not sounded yet, and a sleeping instrument
    /// would never reach the block that sounds it.
    pub fn lifecycle_state(&self) -> u32 {
        if self.event_count > 0 {
            return ProcessLifecycle::CONTINUE_CODE;
        }
        self.engine.lifecycle().code()
    }

    /// Render a block of audio and return a pointer to the left channel.
    /// The caller reads both channels from WASM memory.
    ///
    /// Consumes every event queued since the last call, splitting the render at
    /// each event's sample offset, and empties the list. A block with nothing
    /// queued renders in one unsplit pass.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = (block_size as usize).min(self.left_buf.len());
        self.left_buf[..size].fill(0.0);
        self.right_buf[..size].fill(0.0);

        let event_count = self.event_count;
        self.event_count = 0;
        if event_count == 0 {
            self.engine
                .process_block(&mut self.left_buf[..size], &mut self.right_buf[..size]);
        } else {
            self.render_segmented(size, event_count);
        }

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

    /// Pointer to the right channel buffer (call after `process`).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.right_buf.as_ptr()
    }
}

/// Host-side facts about the instance that no JavaScript caller needs.
///
/// Deliberately outside the `#[wasm_bindgen]` block: an accessor added there
/// rewrites the generated glue and with it the committed wasm artifacts, and
/// nothing about the size of a buffer belongs on the worklet's wire.
impl GrandBouleInstance {
    /// Append to the block's event list. Bounded by
    /// [`GRAND_BOULE_MAX_BLOCK_EVENTS`], so this writes into already-owned
    /// storage and never allocates.
    fn push_event(&mut self, event: GrandBouleEvent) -> bool {
        if self.event_count >= GRAND_BOULE_MAX_BLOCK_EVENTS {
            return false;
        }
        self.events[self.event_count] = event;
        self.event_count += 1;
        true
    }

    /// Render `size` frames, splitting at each queued event's offset and
    /// applying it there.
    ///
    /// The cursor only ever moves forward: an offset behind it — an
    /// out-of-order push, or a second event on one sample — lands at the
    /// cursor, and one at or past `size` lands at `size`, after every frame of
    /// this block, so the note is struck for the block that follows. The quiet
    /// accounting runs once over the whole block, whatever it was split into.
    fn render_segmented(&mut self, size: usize, event_count: usize) {
        let mut cursor = 0;
        for index in 0..event_count {
            let event = self.events[index];
            let at = (event.offset as usize).min(size).max(cursor);
            if at > cursor {
                self.engine.render_segment(
                    &mut self.left_buf[cursor..at],
                    &mut self.right_buf[cursor..at],
                );
                cursor = at;
            }
            self.apply_event(event);
        }
        if cursor < size {
            self.engine.render_segment(
                &mut self.left_buf[cursor..size],
                &mut self.right_buf[cursor..size],
            );
        }
        self.engine
            .account_quiet_block(&self.left_buf[..size], &self.right_buf[..size]);
    }

    /// Apply one queued event to the engine, at the render cursor it was split
    /// at. A `kind` the list does not name is ignored.
    fn apply_event(&mut self, event: GrandBouleEvent) {
        match event.kind {
            GRAND_BOULE_EVENT_NOTE_ON => self.engine.note_on_with_channel(
                event.note,
                event.velocity,
                event.channel.unwrap_or(0),
            ),
            GRAND_BOULE_EVENT_NOTE_OFF => match event.channel {
                Some(channel) => self.engine.note_off_on_channel(event.note, channel),
                None => self.engine.note_off(event.note),
            },
            GRAND_BOULE_EVENT_NOTE_EXPRESSION => self.engine.note_expression(
                event.note,
                event.channel.unwrap_or(0),
                event.bend_semitones,
                event.pressure,
                event.slide,
            ),
            _ => {}
        }
    }

    /// Frames this instance's channel buffers hold — the ceiling
    /// [`Self::process`] silently clamps an ask down to.
    ///
    /// Read off the buffers rather than restating
    /// [`GRAND_BOULE_BLOCK_FRAMES`], so a native host can prove the constant
    /// it bounds its runs by is the size the instance was actually built at.
    pub fn block_frames(&self) -> usize {
        self.left_buf.len()
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::GrandBouleInstance;
    use crate::primitives::ProcessLifecycle;

    #[test]
    fn lifecycle_sleeps_cold_wakes_for_note_and_hard_stops() {
        let mut instance = GrandBouleInstance::new(48_000.0, 4);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        instance.note_on(60, 1.0);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);

        instance.process(128);
        instance.note_off(60);
        instance.process(128);
        assert_ne!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        instance.all_notes_off();
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);
    }

    /// A pushed note wakes a sleeping instance before it has rendered a frame,
    /// and the block that sounds it leaves it awake.
    ///
    /// Without the pending-event arm in `lifecycle_state` the host reads SLEEP
    /// on a queued note, parks the instrument, and never renders the block the
    /// note was queued for.
    #[test]
    fn lifecycle_wakes_for_a_pushed_note_before_the_block_that_sounds_it() {
        let mut instance = GrandBouleInstance::new(48_000.0, 4);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        assert!(instance.push_note_on(60, 0.8, 0, 64));
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);

        instance.process(128);
        assert_ne!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);
    }

    /// A panic drops what has not sounded, so nothing strikes after it.
    #[test]
    fn all_notes_off_drops_the_queued_events_with_the_voices() {
        let mut instance = GrandBouleInstance::new(48_000.0, 4);

        assert!(instance.push_note_on(60, 0.8, 0, 64));
        instance.all_notes_off();

        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);
        instance.process(128);
        assert_eq!(instance.active_voices(), 0);
    }
}
