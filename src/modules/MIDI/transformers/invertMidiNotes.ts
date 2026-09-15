import { clampMidiData7 } from '#/utils/midiData';

import { type MidiNote } from '../models/MidiNote';

export function invertMidiNotes(notes: readonly MidiNote[]): MidiNote[] {
    if (notes.length < 2) {
        return notes.map((note) => ({ ...note }));
    }

    let minPitch = Infinity;
    let maxPitch = -Infinity;
    for (const note of notes) {
        minPitch = Math.min(minPitch, note.pitch);
        maxPitch = Math.max(maxPitch, note.pitch);
    }
    const axis = minPitch + maxPitch;
    return notes.map((note) => ({
        ...note,
        pitch: clampMidiData7(axis - note.pitch),
    }));
}
