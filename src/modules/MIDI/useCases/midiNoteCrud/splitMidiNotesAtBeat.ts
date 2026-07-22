import { createMidiNote, type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

export type SplitMidiNotesAtBeatInput = {
    sourceClipId: string;
    newClipId: string;
    splitBeat: number;
};

/**
 * When an arrangement clip is split in two, its MIDI notes must follow.
 *
 * Notes are stored clip-relative (playback position is
 * `clip.startBeat + note.startBeat - clip.midiOffsetBeats`), and `splitBeat`
 * is the split point in the same clip-media coordinate space — the caller
 * converts the timeline-absolute split before invoking.
 *
 *  - Notes fully ending before the split stay on the source clip.
 *  - Notes fully starting at or after the split move to the new right clip,
 *    re-based by `-splitBeat` so they stay clip-relative (the right clip's
 *    media starts at the split point).
 *  - Notes straddling the split are cut: the left half (with its original id)
 *    stays on the source clip with shortened duration; the right half is
 *    created at beat 0 on the new clip, keeping pitch/velocity/etc.
 *
 * Without this, the notes beyond `splitBeat` remain keyed under the source
 * clip id which is now trimmed — they become invisible and unplayable even
 * though they still exist in the store.
 *
 * Writes both clip entries in a single store mutation so undo/redo and the
 * projection bridge see a consistent state.
 */
export function splitMidiNotesAtBeat(input: SplitMidiNotesAtBeatInput): void {
    const { sourceClipId, newClipId, splitBeat } = input;

    const state = midiStore.value;
    if (!state) {
        return;
    }

    const sourceNotes = state.notesByClipId[sourceClipId];
    if (!sourceNotes || sourceNotes.length === 0) {
        return;
    }

    const leftNotes: MidiNote[] = [];
    const rightNotes: MidiNote[] = [];

    for (const note of sourceNotes) {
        const noteEnd = note.startBeat + note.duration;
        if (noteEnd <= splitBeat) {
            leftNotes.push(note);
            continue;
        }
        if (note.startBeat >= splitBeat) {
            // Re-base onto the right clip: its media starts at the split.
            rightNotes.push({ ...note, startBeat: note.startBeat - splitBeat });
            continue;
        }
        // Straddles the split: trim the left, create a new note for the right.
        const leftDuration = splitBeat - note.startBeat;
        const rightDuration = noteEnd - splitBeat;
        leftNotes.push({ ...note, duration: leftDuration });
        const rightHalf = createMidiNote(note.pitch, 0, rightDuration, note.velocity);
        rightNotes.push({
            ...rightHalf,
            probability: note.probability ?? rightHalf.probability,
            pressure: note.pressure,
            slide: note.slide,
            pitchBend: note.pitchBend,
        });
    }

    const existingRight = state.notesByClipId[newClipId] ?? [];

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [sourceClipId]: leftNotes,
            [newClipId]: [...existingRight, ...rightNotes],
        },
    });
}
