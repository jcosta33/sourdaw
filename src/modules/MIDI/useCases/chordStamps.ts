/**
 * Chord stamp use cases.
 * Place a complete chord (multiple notes) at a given position in one action.
 *
 * All store access goes through midiStore.
 */

import { midiStore } from '../stores/midiStore';
import { createMidiNote, type MidiNote } from '../models/MidiNote';

export const CHORD_TYPES = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    '7': [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    dim7: [0, 3, 6, 9],
    aug7: [0, 4, 8, 10],
    '6': [0, 4, 7, 9],
    min6: [0, 3, 7, 9],
    '9': [0, 4, 7, 10, 14],
    add9: [0, 4, 7, 14],
    min9: [0, 3, 7, 10, 14],
    '7sus4': [0, 5, 7, 10],
} as const;

export type ChordType = keyof typeof CHORD_TYPES;

export const CHORD_TYPE_KEYS = Object.keys(CHORD_TYPES) as ChordType[];

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
