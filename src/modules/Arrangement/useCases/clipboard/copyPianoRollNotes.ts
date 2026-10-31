import { type MidiNote } from '../../models/MidiNoteViewTypes';
import { setNoteClipboard } from '../../stores/clipboardStore';

/** Copy already projected piano-roll notes, including frozen take occurrences. */
export function copyPianoRollNotes(notes: readonly MidiNote[]): void {
    if (notes.length > 0) {
        setNoteClipboard({ notes: notes.map((note) => structuredClone(note)) });
    }
}
