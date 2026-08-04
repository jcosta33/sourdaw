import { type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

type ApplyMidiNoteTransformInput = {
    clipId: string;
    transform: (notes: readonly MidiNote[]) => MidiNote[];
};

export function applyMidiNoteTransform(input: ApplyMidiNoteTransformInput): boolean {
    const state = midiStore.value;
    const notes = state?.notesByClipId[input.clipId];
    if (!state || !notes || notes.length === 0) {
        return false;
    }
    const transformed = input.transform(notes);
    if (midiNotesEqual(notes, transformed)) {
        return false;
    }
    midiStore.set({
        ...state,
        notesByClipId: { ...state.notesByClipId, [input.clipId]: transformed },
    });
    return true;
}
