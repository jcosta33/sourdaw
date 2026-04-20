import { createMidiNote, type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

import { CHORD_TYPES } from './helpers';

import type { ChordType } from './helpers';

/**
 * Stamp a chord at the given position, returning the created note IDs.
 */
export function stampChord(
    clipId: string,
    rootPitch: number,
    startBeat: number,
    duration: number,
    velocity: number,
    chordType: ChordType
): MidiNote[] {
    const state = midiStore.value;
    if (!state) {
        return [];
    }

    const intervals = CHORD_TYPES[chordType];
    const newNotes: MidiNote[] = [];

    for (const interval of intervals) {
        const pitch = rootPitch + interval;
        if (pitch >= 0 && pitch <= 127) {
            newNotes.push(createMidiNote(pitch, startBeat, duration, velocity));
        }
    }

    const existing = state.notesByClipId[clipId] ?? [];

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: [...existing, ...newNotes],
        },
    });

    return newNotes;
}
