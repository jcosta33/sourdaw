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
 * Notes in `notesByClipId[sourceClipId]` are partitioned at `splitBeat`:
 *
 *  - Notes fully ending before the split stay on the source clip.
 *  - Notes fully starting at or after the split move to the new right clip.
 *  - Notes straddling the split are cut: the left half (with its original id)
 *    stays on the source clip with shortened duration; the right half is
 *    created as a new note on the new clip, keeping pitch/velocity/etc.
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
            rightNotes.push(note);
            continue;
        }
        // Straddles the split: trim the left, create a new note for the right.
        const leftDuration = splitBeat - note.startBeat;
        const rightDuration = noteEnd - splitBeat;
        leftNotes.push({ ...note, duration: leftDuration });
        const rightHalf = createMidiNote(note.pitch, splitBeat, rightDuration, note.velocity);
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
