import { type MidiNote, midiStore } from '#/modules/MIDI/stores';
import { valuesEqual } from '#/utils/structuralEquality';

import { type FreezeMidiNoteSnapshot } from './freezeMidiNoteSnapshot';

function sortedById(notes: MidiNote[]): MidiNote[] {
    return notes.toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Compares by value, not identity: a note write clones lists it did not change. Order is not
 * content, so the lists are compared by note id.
 */
export function freezeMidiNotesUnchanged(snapshot: FreezeMidiNoteSnapshot): boolean {
    return Object.entries(snapshot).every(([clipId, capturedNotes]) =>
        valuesEqual(sortedById(capturedNotes), sortedById(midiStore.value?.notesByClipId[clipId] ?? []))
    );
}
