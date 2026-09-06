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

/// The scheduled notes one instrument is holding, ordered by frame.
///
/// Ordered because a plugin must be handed a block's events in non-decreasing
/// time — CLAP states it outright, and a VST3 processor reads sample offsets
/// in the order the list gives them — so delivery may not hand over whatever
/// order the producers happened to write in. Among entries sharing a frame the
/// order is the order they were stored, which is the only order a producer can
/// express for two notes on one sample.
///
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

    /// Merge a frame-ordered batch into the store, or refuse it whole.
    ///
    /// All-or-nothing because a partly stored batch is a phrase with notes
    /// missing from its middle and no note-off behind the note-ons that did
    /// land — worse to hear, and worse to diagnose, than a refusal the caller
    /// is told about.
    ///
    /// The batch must already be ordered by frame. This runs on the audio
    /// thread, where a sort would allocate its scratch half or reorder equal
    /// frames, so an unordered batch is refused like any other batch the store
    /// cannot take: the caller is counted a refusal instead of the instrument
    /// receiving events out of time. [`crate::EngineHandle::schedule_midi_notes`]
    /// puts every batch in order control-side, which is where a sort belongs.
    pub fn try_extend(&mut self, notes: &[TimedMidiNote]) -> bool {
        if notes.len() > MIDI_NOTE_STORE_CAPACITY - self.entries.len() {
            return false;
        }
        if !is_frame_ordered(notes) {
            return false;
        }

        let merge_from = self.entries.len();
        self.entries.extend_from_slice(notes);
        merge_frame_ordered_runs(&mut self.entries, merge_from);
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

/// Whether a batch is already in the frame order the store keeps.
fn is_frame_ordered(notes: &[TimedMidiNote]) -> bool {
    notes
        .windows(2)
        .all(|pair| pair[0].at_frame <= pair[1].at_frame)
}

/// Merge the frame-ordered run at `merge_from..` into the frame-ordered run
/// ahead of it, in place and keeping insertion order among equal frames.
///
/// An insertion merge by rotation rather than a sort: the standard sorts
/// either allocate a scratch half (`sort_by_key`) or reorder equal keys
/// (`sort_unstable_by_key`). This runs on the audio thread, where the first is
/// forbidden (ADR 0020) and the second would silently swap two notes a
/// producer wrote for the same sample.
fn merge_frame_ordered_runs(entries: &mut [TimedMidiNote], merge_from: usize) {
    let mut head = 0;
    let mut tail = merge_from;
    while head < tail && tail < entries.len() {
        // An equal frame advances the head, which is what keeps the entry
        // stored earlier ahead of the one arriving now.
        if entries[head].at_frame <= entries[tail].at_frame {
            head += 1;
            continue;
        }
        entries[head..=tail].rotate_right(1);
        head += 1;
        tail += 1;
    }
}

/// MIDI channels a note can sound on.
const MIDI_CHANNELS: usize = 16;

/// Notes one MIDI channel can carry.
const NOTES_PER_CHANNEL: u8 = 128;

/// Which notes an instrument's store has sounded and not yet released.
///
/// One bit per note per channel, inline and fixed: the audio thread sets and
/// clears bits on every delivery and walks the whole set on a stop, a locate
/// and a loop wrap, so a set that allocated or hashed would put that work
/// inside the deadline (ADR 0020).
///
/// Only what the store delivered is tracked. A note played live has no
/// timeline position and no scheduled release, so a key the player is holding
/// stays held across a stop exactly as it does on hardware.
#[derive(Clone, Copy, Default)]
pub struct SoundingNotes {
    held: [u128; MIDI_CHANNELS],
}

impl SoundingNotes {
    /// Mark a note held.
    pub fn hold(&mut self, channel: i16, note: u8) {
        let Some((index, mask)) = Self::address(channel, note) else {
            return;
        };
        self.held[index] |= mask;
    }

    /// Mark a note no longer held.
    pub fn release(&mut self, channel: i16, note: u8) {
        let Some((index, mask)) = Self::address(channel, note) else {
            return;
        };
        self.held[index] &= !mask;
    }

    /// Hand every held note to `emit`, lowest channel and note first, and
    /// leave the set empty.
    pub fn drain(&mut self, mut emit: impl FnMut(i16, u8)) {
        for (index, held) in self.held.iter_mut().enumerate() {
            while *held != 0 {
                let note = held.trailing_zeros() as u8;
                *held &= *held - 1;
                emit(index as i16, note);
            }
        }
    }

    /// The bit one note on one channel occupies, or `None` for an address MIDI
    /// itself has no room for — which is an address no release could name
    /// either.
    fn address(channel: i16, note: u8) -> Option<(usize, u128)> {
        if channel < 0 || channel as usize >= MIDI_CHANNELS {
            return None;
        }
        if note >= NOTES_PER_CHANNEL {
            return None;
        }
        Some((channel as usize, 1u128 << note))
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

    /// A batch out of frame order is refused whole. Ordering it here would
    /// allocate on the thread that applies it, and storing it as it came would
    /// hand the instrument events out of time, so the store keeps what it had
    /// and the caller is counted a refusal.
    #[test]
    fn a_batch_out_of_frame_order_is_refused_and_leaves_the_store_untouched() {
        let mut store = MidiNoteStore::new();
        assert!(store.try_extend(&[note_at(10, 60), note_at(30, 62)]));

        assert!(!store.try_extend(&[note_at(40, 63), note_at(20, 61)]));

        let held: Vec<u64> = store.entries().iter().map(|entry| entry.at_frame).collect();
        assert_eq!(held, vec![10, 30]);
    }

    /// Two batches merge into one frame-ordered run, and two notes written for
    /// the same frame keep the order they were stored in — the only order a
    /// producer can express for a pair that sounds on one sample.
    #[test]
    fn merged_batches_hold_frame_order_and_insertion_order_among_equal_frames() {
        let mut store = MidiNoteStore::new();
        assert!(store.try_extend(&[note_at(10, 60), note_at(40, 63)]));
        assert!(store.try_extend(&[note_at(10, 61), note_at(25, 62)]));

        let held: Vec<(u64, u8)> = store
            .entries()
            .iter()
            .map(|entry| (entry.at_frame, entry.event.note))
            .collect();
        assert_eq!(held, vec![(10, 60), (10, 61), (25, 62), (40, 63)]);
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
