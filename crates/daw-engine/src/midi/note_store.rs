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
    /// Where a merge writes its result before the two buffers swap roles.
    /// Reserved with `entries` and for the same reason: the merge runs on the
    /// audio thread, so a scratch buffer taken per call would be exactly the
    /// allocation the reserve exists to avoid.
    scratch: Vec<TimedMidiNote>,
}

impl MidiNoteStore {
    /// Build an empty store, with its memory. Control thread only: these are
    /// the only allocations the store ever makes (ADR 0020), which is why it
    /// ships boxed on the command that registers the instrument it belongs to.
    pub fn new() -> Box<Self> {
        Box::new(Self {
            entries: Vec::with_capacity(MIDI_NOTE_STORE_CAPACITY),
            scratch: Vec::with_capacity(MIDI_NOTE_STORE_CAPACITY),
        })
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
    ///
    /// A batch naming a note MIDI itself has no address for is refused the
    /// same way, for a reason of the store's own: such a note cannot be
    /// tracked as sounding, so no stop, locate, wrap or clear could ever
    /// release it, and an instrument handed it would hold that key for good.
    pub fn try_extend(&mut self, notes: &[TimedMidiNote]) -> bool {
        if notes.len() > MIDI_NOTE_STORE_CAPACITY - self.entries.len() {
            return false;
        }
        if !is_frame_ordered(notes) {
            return false;
        }
        if !is_addressable(notes) {
            return false;
        }

        merge_frame_ordered_runs(&mut self.scratch, &self.entries, notes);
        std::mem::swap(&mut self.entries, &mut self.scratch);
        // Emptied rather than dropped: the buffer that just held the store
        // keeps its reserve and becomes the scratch the next merge writes into.
        self.scratch.clear();
        true
    }

    /// Drop every entry whose frame falls in the half-open window
    /// `from_frame..to_frame`. `0..u64::MAX` clears the store.
    ///
    /// Half-open so a producer can rewrite one bar by clearing exactly its
    /// span: the note starting the next bar is outside the window it borders.
    ///
    /// Every entry the window takes out is handed to `removed` on its way,
    /// because one of them may be the note-off a sounding note is waiting for
    /// and nothing outside the store can see that from the window alone.
    /// Reported rather than collected: this runs on the audio thread, where a
    /// list of the removals would be an allocation.
    pub fn clear_window(
        &mut self,
        from_frame: u64,
        to_frame: u64,
        mut removed: impl FnMut(&TimedMidiNote),
    ) {
        self.entries.retain(|entry| {
            if entry.at_frame < from_frame || entry.at_frame >= to_frame {
                return true;
            }
            removed(entry);
            false
        });
    }
}

/// Whether a batch is already in the frame order the store keeps.
fn is_frame_ordered(notes: &[TimedMidiNote]) -> bool {
    notes
        .windows(2)
        .all(|pair| pair[0].at_frame <= pair[1].at_frame)
}

/// Merge two frame-ordered runs into `out`, keeping an entry the store already
/// held ahead of one arriving on the same frame.
///
/// Linear rather than an insertion merge by rotation. Each entry of both runs
/// is written into `out` exactly once, so a merge costs the two run lengths and
/// nothing more. A rotation moves every entry it steps over instead, so a batch
/// landing ahead of a full store rewrites that store once per arriving entry —
/// quadratic work inside the deadline.
///
/// `out` is the store's own scratch: reserved at [`MIDI_NOTE_STORE_CAPACITY`],
/// emptied by the caller, and only ever asked to hold a total the caller has
/// already admitted against the free capacity. So nothing here reallocates,
/// which is what lets a merge run on the audio thread at all (ADR 0020).
fn merge_frame_ordered_runs(
    out: &mut Vec<TimedMidiNote>,
    stored: &[TimedMidiNote],
    arriving: &[TimedMidiNote],
) {
    let mut stored_index = 0;
    let mut arriving_index = 0;
    while stored_index < stored.len() && arriving_index < arriving.len() {
        // An equal frame takes the stored entry, which is what keeps the entry
        // stored earlier ahead of the one arriving now.
        if stored[stored_index].at_frame <= arriving[arriving_index].at_frame {
            out.push(stored[stored_index]);
            stored_index += 1;
            continue;
        }
        out.push(arriving[arriving_index]);
        arriving_index += 1;
    }
    out.extend_from_slice(&stored[stored_index..]);
    out.extend_from_slice(&arriving[arriving_index..]);
}

/// Whether every entry names a note [`NoteAddressSet`] can address.
fn is_addressable(notes: &[TimedMidiNote]) -> bool {
    notes
        .iter()
        .all(|entry| NoteAddressSet::address(entry.event.channel, entry.event.note).is_some())
}

/// MIDI channels a note can sound on.
const MIDI_CHANNELS: usize = 16;

/// Notes one MIDI channel can carry.
const NOTES_PER_CHANNEL: u8 = 128;

/// A set of note addresses: one bit per note per channel, across sixteen
/// channels and a hundred and twenty-eight notes.
///
/// Inline and fixed: the audio thread sets and clears bits on every delivery
/// and walks a whole set on a stop, a locate and a loop wrap, so a set that
/// allocated or hashed would put that work inside the deadline (ADR 0020).
///
/// The scheduler keeps one per device for the notes that device has sounded
/// and not yet released, one for the releases a clear stripped, and builds
/// them on the stack to answer questions about a store. Both deliveries reach
/// the sounding one: a note played live carries no scheduled release, so
/// without a bit there the key a player is holding would stay down for the
/// rest of the session.
///
/// One bit per (channel, note) means the sounding set admits at most one
/// sounding note per key at a time; a store that overlaps two notes on one
/// key is holding one bit for both, so one release answers both.
#[derive(Clone, Copy, Default)]
pub struct NoteAddressSet {
    held: [u128; MIDI_CHANNELS],
}

impl NoteAddressSet {
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

    /// Whether this note is held.
    pub fn is_held(&self, channel: i16, note: u8) -> bool {
        let Some((index, mask)) = Self::address(channel, note) else {
            return false;
        };
        self.held[index] & mask != 0
    }

    /// Hand every held note to `emit`, lowest channel and note first, and drop
    /// the ones it accepted.
    ///
    /// A note `emit` refuses stays held. The key is still down, so the release
    /// it is owed has to survive the attempt that could not deliver it and be
    /// retried at the next stop, locate, wrap or clear — dropping the bit
    /// would leave an instrument holding a note nothing could ever lift.
    pub fn drain(&mut self, mut emit: impl FnMut(i16, u8) -> bool) {
        for (index, held) in self.held.iter_mut().enumerate() {
            let mut pending = *held;
            while pending != 0 {
                let note = pending.trailing_zeros() as u8;
                let mask = 1u128 << note;
                pending &= !mask;
                if emit(index as i16, note) {
                    *held &= !mask;
                }
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
        assert_eq!(store.entries().len(), MIDI_NOTE_STORE_CAPACITY - 1);

        assert!(store.try_extend(&full[..1]));
        assert_eq!(store.entries().len(), MIDI_NOTE_STORE_CAPACITY);
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

    /// A batch landing entirely ahead of the store lands whole and in frame
    /// order. Two long runs sharing no frame read the merge's direction back
    /// directly: emitting the stored run first would leave every arriving
    /// frame behind every stored one.
    #[test]
    fn a_batch_ahead_of_the_whole_store_lands_in_frame_order() {
        const RUN: u64 = 1_024;

        let mut store = MidiNoteStore::new();
        let stored: Vec<TimedMidiNote> = (0..RUN).map(|frame| note_at(2_000 + frame, 60)).collect();
        let arriving: Vec<TimedMidiNote> = (0..RUN).map(|frame| note_at(frame, 61)).collect();

        assert!(store.try_extend(&stored));
        assert!(store.try_extend(&arriving));

        let frames: Vec<u64> = store.entries().iter().map(|entry| entry.at_frame).collect();
        assert!(
            frames.windows(2).all(|pair| pair[0] <= pair[1]),
            "the store stays in frame order across the merge"
        );
        assert_eq!(store.entries().len(), 2 * RUN as usize);
    }

    /// A batch whose frames fall between the stored ones interleaves the two
    /// runs, and a pair sharing a frame keeps the entry stored earlier ahead
    /// of the one arriving now.
    #[test]
    fn a_batch_landing_inside_the_store_keeps_both_runs_ordered() {
        let mut store = MidiNoteStore::new();
        assert!(store.try_extend(&[note_at(10, 60), note_at(30, 62), note_at(50, 64)]));
        assert!(store.try_extend(&[note_at(20, 61), note_at(30, 63), note_at(40, 65)]));

        let held: Vec<(u64, u8)> = store
            .entries()
            .iter()
            .map(|entry| (entry.at_frame, entry.event.note))
            .collect();
        assert_eq!(
            held,
            vec![(10, 60), (20, 61), (30, 62), (30, 63), (40, 65), (50, 64)]
        );
    }

    /// A note MIDI has no address for refuses its whole batch. Nothing could
    /// track it as sounding, so no stop, locate, wrap or clear could release
    /// it, and the instrument would hold that key for good.
    #[test]
    fn a_batch_with_an_unaddressable_note_is_refused_whole() {
        let mut store = MidiNoteStore::new();
        assert!(store.try_extend(&[note_at(10, 60)]));

        let mut off_channel = [note_at(20, 61), note_at(30, 62), note_at(40, 63)];
        off_channel[1].event.channel = 20;
        assert!(!store.try_extend(&off_channel));

        let mut off_note = [note_at(20, 61), note_at(30, 62), note_at(40, 63)];
        off_note[1].event.note = 128;
        assert!(!store.try_extend(&off_note));

        let held: Vec<u64> = store.entries().iter().map(|entry| entry.at_frame).collect();
        assert_eq!(held, vec![10], "neither batch left anything behind");
    }

    #[test]
    fn clearing_a_window_keeps_the_entry_on_its_far_edge() {
        let mut store = MidiNoteStore::new();
        assert!(store.try_extend(&[note_at(10, 60), note_at(20, 61), note_at(30, 62)]));

        store.clear_window(20, 30, |_| {});

        let held: Vec<u64> = store.entries().iter().map(|entry| entry.at_frame).collect();
        assert_eq!(held, vec![10, 30]);
    }
}
