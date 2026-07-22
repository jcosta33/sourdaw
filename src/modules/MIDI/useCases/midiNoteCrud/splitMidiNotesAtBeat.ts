import { createMidiNote, type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

export type SplitMidiNotesAtBeatInput = {
    sourceClipId: string;
    newClipId: string;
    splitBeat: number;
    /**
     * Optional end bound for range deletion (deleteTimeRange): notes and
     * note parts in `[discardBeforeBeat, splitBeat)` are dropped instead of
     * kept on the source clip. Notes straddling `discardBeforeBeat` are
     * trimmed to end at it; notes straddling `splitBeat` still emit their
     * right half at beat 0 on the new clip.
     */
    discardBeforeBeat?: number;
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
    const { sourceClipId, newClipId, splitBeat, discardBeforeBeat } = input;

    const state = midiStore.value;
    if (!state) {
        return;
    }

    const sourceNotes = state.notesByClipId[sourceClipId];
    if (!sourceNotes || sourceNotes.length === 0) {
        return;
    }

    const makeRightHalf = (note: MidiNote, duration: number): MidiNote => {
        const rightHalf = createMidiNote(note.pitch, 0, duration, note.velocity);
        return {
            ...rightHalf,
            probability: note.probability ?? rightHalf.probability,
            pressure: note.pressure,
            slide: note.slide,
            pitchBend: note.pitchBend,
        };
    };

    const leftNotes: MidiNote[] = [];
    const rightNotes: MidiNote[] = [];

    for (const note of sourceNotes) {
        const noteEnd = note.startBeat + note.duration;

        // Range deletion: everything in [discardBeforeBeat, splitBeat) goes
        // away — left straddlers are trimmed to the window start, fully
        // enclosed notes are dropped, and only post-window parts survive.
        if (discardBeforeBeat !== undefined) {
            if (noteEnd <= discardBeforeBeat) {
                leftNotes.push(note);
                continue;
            }
            if (note.startBeat < discardBeforeBeat) {
                leftNotes.push({ ...note, duration: discardBeforeBeat - note.startBeat });
                if (noteEnd > splitBeat) {
                    rightNotes.push(makeRightHalf(note, noteEnd - splitBeat));
                }
                continue;
            }
            if (note.startBeat >= splitBeat) {
                // Fully past the window: re-base onto the right clip.
                rightNotes.push({ ...note, startBeat: note.startBeat - splitBeat });
                continue;
            }
            if (noteEnd > splitBeat) {
                // Starts inside the window but crosses the split: only the
                // post-window part survives, at the right clip's start.
                rightNotes.push(makeRightHalf(note, noteEnd - splitBeat));
            }
            continue;
        }

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
        rightNotes.push(makeRightHalf(note, rightDuration));
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
