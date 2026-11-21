//! Notes a plugin produces, carried off the thread it produced them on.
//!
//! A MIDI effect — an arpeggiator, a chord generator — answers the notes it is
//! handed with notes of its own, written into the output event list of the
//! block that produced them. That is the audio thread, so the capture is a
//! fixed-capacity wait-free ring the control path drains, with every note it
//! had no room for counted rather than lost silently.
//!
//! Each note keeps the frame offset the plugin stamped it with, inside the
//! block it arrived in: a note routed onward sounds on the sample it was
//! written for, not at the head of whichever block carried it. Routing the
//! captured notes to another track is the MIDI routing work's to do.

use crate::traits::HostMidiEvent;
use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

/// How many plugin-produced notes one instance holds between drains.
///
/// A power of two so the ring indexes with a mask. Sized for a dense
/// arpeggio across many blocks between two control-path visits; a queue this
/// deep going full is reported through [`OutputNoteQueue::take_dropped`].
pub const OUTPUT_NOTE_CAPACITY: usize = 1024;

/// A fixed-capacity wait-free ring for plugin-produced notes.
///
/// # Real-time contract
///
/// [`push`](Self::push) runs on the audio thread after the plugin's `process`
/// returns. It is two atomic loads, one masked index, one plain store into
/// memory allocated when the queue was built and one atomic store — or, when
/// the queue is full, one atomic fetch-add instead. No allocation, no lock, no
/// syscall, no unbounded loop.
///
/// # Producer discipline
///
/// One producer at a time: the wrapper pushes only while it holds itself
/// exclusively (`&mut`), and the runtime owner never lets the audio path and
/// the control path into the wrapper at once. The consumer is single by the
/// same rule as `PluginParameterEventQueue`'s.
pub struct OutputNoteQueue {
    /// Preallocated slots, written only ahead of the read cursor.
    slots: Box<[UnsafeCell<HostMidiEvent>]>,
    /// Index mask; `slots.len()` is a power of two.
    mask: usize,
    /// Monotonic write cursor. Written by the producer only.
    write: AtomicUsize,
    /// Monotonic read cursor. Written by the consumer only.
    read: AtomicUsize,
    /// Notes the queue had no room for since the last time it was asked.
    dropped: AtomicU32,
}

// SAFETY: every field is immutable after construction or an atomic, and the
// slots are only touched under the single-producer / single-consumer index
// discipline documented on the type; the notes are owned `Copy` data with no
// thread affinity.
unsafe impl Send for OutputNoteQueue {}
// SAFETY: shared access goes through atomics, or through the slot cells under
// that discipline: a slot is written only while ahead of the read cursor and
// read only after the write cursor publishes it.
unsafe impl Sync for OutputNoteQueue {}

impl Default for OutputNoteQueue {
    fn default() -> Self {
        Self::with_capacity(OUTPUT_NOTE_CAPACITY)
    }
}

impl OutputNoteQueue {
    /// Build a queue holding `capacity` notes.
    ///
    /// # Panics
    /// When `capacity` is not a power of two. Every call site passes a
    /// constant, so this cannot fire for a reason a user could produce.
    pub fn with_capacity(capacity: usize) -> Self {
        assert!(
            capacity.is_power_of_two(),
            "output note queue capacity must be a power of two"
        );
        let empty = HostMidiEvent {
            note: 0,
            velocity: 0,
            channel: 0,
            is_note_on: false,
            frame_offset: 0,
        };
        let slots = (0..capacity)
            .map(|_| UnsafeCell::new(empty))
            .collect::<Vec<_>>()
            .into_boxed_slice();
        Self {
            mask: capacity - 1,
            slots,
            write: AtomicUsize::new(0),
            read: AtomicUsize::new(0),
            dropped: AtomicU32::new(0),
        }
    }

    /// Record one note. **Wait-free; safe on the audio thread.** A full queue
    /// counts the loss and answers `false`.
    pub fn push(&self, note: HostMidiEvent) -> bool {
        let write = self.write.load(Ordering::Relaxed);
        let read = self.read.load(Ordering::Acquire);

        if write.wrapping_sub(read) >= self.slots.len() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return false;
        }

        // SAFETY: the slot is ahead of the consumer's cursor, which the
        // capacity check above establishes, so nothing is reading it.
        unsafe { *self.slots[write & self.mask].get() = note };
        self.write.store(write.wrapping_add(1), Ordering::Release);
        true
    }

    /// Move every waiting note into `out`, in the order the plugin produced
    /// them. **Consumer thread only.**
    pub fn drain(&self, out: &mut Vec<HostMidiEvent>) {
        let read = self.read.load(Ordering::Relaxed);
        let write = self.write.load(Ordering::Acquire);

        let mut cursor = read;
        while cursor != write {
            // SAFETY: every index below `write` has been published by the
            // producer and is not written again until the read cursor passes it.
            out.push(unsafe { *self.slots[cursor & self.mask].get() });
            cursor = cursor.wrapping_add(1);
        }

        self.read.store(cursor, Ordering::Release);
    }

    /// Count a note lost before it reached the queue. **Wait-free.**
    pub fn count_dropped(&self) {
        self.dropped.fetch_add(1, Ordering::Relaxed);
    }

    /// Read and clear how many notes the queue had no room for.
    pub fn take_dropped(&self) -> u32 {
        self.dropped.swap(0, Ordering::AcqRel)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(note: u8, frame_offset: u32) -> HostMidiEvent {
        HostMidiEvent {
            note,
            velocity: 100,
            channel: 0,
            is_note_on: true,
            frame_offset,
        }
    }

    #[test]
    fn notes_drain_in_the_order_they_were_pushed_with_their_offsets() {
        let queue = OutputNoteQueue::with_capacity(4);
        assert!(queue.push(note(60, 3)));
        assert!(queue.push(note(64, 17)));

        let mut drained = Vec::new();
        queue.drain(&mut drained);

        assert_eq!(drained, [note(60, 3), note(64, 17)]);
        assert_eq!(queue.take_dropped(), 0);
    }

    #[test]
    fn a_full_queue_refuses_and_counts_every_note_it_could_not_hold() {
        let queue = OutputNoteQueue::with_capacity(2);
        assert!(queue.push(note(60, 0)));
        assert!(queue.push(note(62, 1)));
        assert!(!queue.push(note(64, 2)));
        assert!(!queue.push(note(65, 3)));

        let mut drained = Vec::new();
        queue.drain(&mut drained);

        assert_eq!(drained, [note(60, 0), note(62, 1)]);
        assert_eq!(queue.take_dropped(), 2);
        assert_eq!(queue.take_dropped(), 0, "the count clears when read");
        assert!(queue.push(note(67, 4)), "a drained queue takes notes again");
    }
}
