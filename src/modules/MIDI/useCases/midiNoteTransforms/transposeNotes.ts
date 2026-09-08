import { midiStore } from '../../stores/midiStore';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';
import { transposeMidiNotes } from '../../transformers/transposeMidiNotes';

export function transposeNotes(clipId: string, semitones: number, noteIds?: readonly string[]): boolean {
    const state = midiStore.value;
    const notes = state?.notesByClipId[clipId];
    if (!state || !notes || notes.length === 0) {
        return false;
    }

    const transposedNotes = transposeMidiNotes({ notes, semitones, noteIds });
    if (midiNotesEqual(notes, transposedNotes)) {
        return false;
    }

    midiStore.set({
        ...state,
        notesByClipId: { ...state.notesByClipId, [clipId]: transposedNotes },
    });
    return true;
}
