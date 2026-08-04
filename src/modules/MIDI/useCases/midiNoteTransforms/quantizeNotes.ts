import { midiStore } from '../../stores/midiStore';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';
import { quantizeMidiNotes } from '../../transformers/quantizeMidiNotes';

export function quantizeNotes(clipId: string, gridSize: number, strength: number = 1, swing: number = 0): boolean {
    const state = midiStore.value;
    const notes = state?.notesByClipId[clipId];
    if (!state || !notes || notes.length === 0) {
        return false;
    }

    const quantizedNotes = quantizeMidiNotes({ notes, gridSize, strength, swing });
    if (midiNotesEqual(notes, quantizedNotes)) {
        return false;
    }

    midiStore.set({
        ...state,
        notesByClipId: { ...state.notesByClipId, [clipId]: quantizedNotes },
    });
    return true;
}
