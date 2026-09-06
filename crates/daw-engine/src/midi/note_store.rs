//! The timeline-addressed MIDI a hosted instrument is holding.
//!
//! A note scheduled here names an absolute timeline frame rather than a block,
//! so the producer writes it once and the render path delivers it on the sample
//! that carries that frame — on every pass a loop makes over it, and on none at
//! all when the playhead is located away from it.

use crate::plugin_slot::MidiNoteEvent;

/// Notes one instrument can hold at once.
///
/// Fixed, because the store is written from the audio thread and a store that
/// grew would allocate inside the deadline. A batch that would take the store
/// past it is refused whole and counted, so a producer hears the ceiling
/// instead of losing the tail of what it wrote.
pub const MIDI_NOTE_STORE_CAPACITY: usize = 2048;

/// One MIDI event and the timeline frame it sounds on.
#[derive(Clone, Copy)]
pub struct TimedMidiNote {
    /// The absolute timeline frame this event applies at.
    pub at_frame: u64,
    /// The event itself. Its own `frame_offset` is written by delivery, from
    /// `at_frame` and the first frame of the span that renders it, so whatever
    /// a producer puts there is overwritten rather than honoured.
    pub event: MidiNoteEvent,
}

/// The scheduled notes one instrument is holding.
///
/// Unsorted: delivery scans the whole of it per span, and keeping it ordered
/// would put a sort or an insertion shuffle on the thread that applies a batch.
/// Entries persist until they are cleared, which is what makes a loop pass and
/// a locate behave the way a musician expects — the store describes the
/// arrangement, not a queue the render path consumes.
pub struct MidiNoteStore {
    /// Reserved once at [`MIDI_NOTE_STORE_CAPACITY`] and never grown. Every
    /// route that adds entries refuses past the reserve, so no write from the
    /// audio thread can reallocate it.
    entries: Vec<TimedMidiNote>,
}

impl MidiNoteStore {
    /// Build an empty store, with its memory. Control thread only: this is the
    /// one allocation the store ever makes (ADR 0020), which is why it ships
    /// boxed on the command that registers the instrument it belongs to.
    pub fn new() -> Box<Self> {
        Box::new(Self {
            entries: Vec::with_capacity(MIDI_NOTE_STORE_CAPACITY),
        })
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn entries(&self) -> &[TimedMidiNote] {
        &self.entries
    }

    /// Append a whole batch, or refuse it whole.
    ///
    /// All-or-nothing because a partly stored batch is a phrase with notes
    /// missing from its middle and no note-off behind the note-ons that did
    /// land — worse to hear, and worse to diagnose, than a refusal the caller
    /// is told about.
    pub fn try_extend(&mut self, notes: &[TimedMidiNote]) -> bool {
        if notes.len() > MIDI_NOTE_STORE_CAPACITY - self.entries.len() {
            return false;
        }

        self.entries.extend_from_slice(notes);
        true
    }

    /// Drop every entry whose frame falls in the half-open window
    /// `from_frame..to_frame`. `0..u64::MAX` clears the store.
    ///
    /// Half-open so a producer can rewrite one bar by clearing exactly its
    /// span: the note starting the next bar is outside the window it borders.
    pub fn clear_window(&mut self, from_frame: u64, to_frame: u64) {
        self.entries
            .retain(|entry| entry.at_frame < from_frame || entry.at_frame >= to_frame);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note_at(at_frame: u64, note: u8) -> TimedMidiNote {
        TimedMidiNote {
            at_frame,
            event: MidiNoteEvent {
                note,
                velocity: 100,
                channel: 0,
                is_note_on: true,
                frame_offset: 0,
                probability_cutoff: crate::midi_fx::PROBABILITY_CUTOFF_RANGE,
                project_probability_seed: 0,
                clip_id_hash: 0,
                event_id_hash: 0,
                absolute_occurrence_index: 0,
            },
        }
    }

    #[test]
    fn a_batch_past_the_free_capacity_is_refused_whole() {
        let mut store = MidiNoteStore::new();
        let full: Vec<TimedMidiNote> = (0..MIDI_NOTE_STORE_CAPACITY as u64)
            .map(|frame| note_at(frame, 60))
            .collect();

        assert!(store.try_extend(&full[..MIDI_NOTE_STORE_CAPACITY - 1]));
        assert!(!store.try_extend(&full[..2]));
        assert_eq!(store.len(), MIDI_NOTE_STORE_CAPACITY - 1);

        assert!(store.try_extend(&full[..1]));
        assert_eq!(store.len(), MIDI_NOTE_STORE_CAPACITY);
    }

    #[test]
    fn clearing_a_window_keeps_the_entry_on_its_far_edge() {
        let mut store = MidiNoteStore::new();
        assert!(store.try_extend(&[note_at(10, 60), note_at(20, 61), note_at(30, 62)]));

        store.clear_window(20, 30);

        let held: Vec<u64> = store.entries().iter().map(|entry| entry.at_frame).collect();
        assert_eq!(held, vec![10, 30]);
    }
}
