/**
 * Chord stamp use cases.
 * Place a complete chord (multiple notes) at a given position in one action.
 *
 * All store access goes through midiStore.
 */

import { midiStore } from '../stores/midiStore';
import { createMidiNote, type MidiNote } from '../models/MidiNote';
import { CHORD_TYPES, CHORD_TYPE_KEYS, type ChordType } from '../models/ChordTypes';

// Re-export for backward compatibility
export { CHORD_TYPES, CHORD_TYPE_KEYS, type ChordType };

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

/**
 * Remove multiple notes by IDs (for undo support).
 */
export function removeNotesByIds(clipId: string, noteIds: string[]): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return;
    }

    const idSet = new Set(noteIds);
    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.filter((n) => !idSet.has(n.id)),
        },
    });
}
