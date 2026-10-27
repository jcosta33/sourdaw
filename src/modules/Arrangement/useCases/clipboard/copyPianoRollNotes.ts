import { type MidiNote } from '../../models/MidiNoteViewTypes';
import { clipboardStore, setNoteClipboard } from '../../stores/clipboardStore';

/** Copy already projected piano-roll notes, including frozen take occurrences. */
export function copyPianoRollNotes(notes: readonly MidiNote[]): void {
    if (notes.length > 0) {
        setNoteClipboard({ notes: notes.map((note) => structuredClone(note)) });
    }
}

/** Read the shared note clipboard for a destination take's insertion route. */
export function getCopiedPianoRollNotes(): readonly MidiNote[] {
    return clipboardStore.value?.noteClipboard?.notes ?? [];
}
