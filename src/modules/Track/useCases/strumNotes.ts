/**
 * Strum use case.
 * Applies a progressive timing offset to selected notes, simulating a guitar strum.
 *
 * All store access goes through midiStore.
 */

import { midiStore } from '../stores/midiStore';

export type StrumDirection = 'up' | 'down' | 'random';

/**
 * Apply strum offset to the given notes.
 *
 * Sorts notes by pitch, then offsets each note's startBeat by `strumAmount * index`
 * in the specified direction.
 *
 * @param clipId   - Target clip
 * @param noteIds  - IDs of notes to strum (must be 2+)
 * @param strumAmount - Beat offset per note (e.g. 0.04 = ~1/64th note feel)
 * @param direction - 'up' = low→high delay, 'down' = high→low, 'random'
 *
 * @returns Map of noteId → original startBeat (for undo)
 */
export function strumNotes(
    clipId: string,
    noteIds: string[],
    strumAmount = 0.04,
    direction: StrumDirection = 'up',
): Map<string, number> | null {
    const state = midiStore.value;
    if (!state) {
        return null;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return null;
    }

    const idSet = new Set(noteIds);
    const targetNotes = existing.filter((n) => idSet.has(n.id));

    if (targetNotes.length < 2) {
        return null;
    }

    // Sort by pitch for strum direction
    const sorted = [...targetNotes];
    if (direction === 'up') {
        sorted.sort((a, b) => a.pitch - b.pitch); // low → high gets progressive delay
    } else if (direction === 'down') {
        sorted.sort((a, b) => b.pitch - a.pitch); // high → low gets progressive delay
    }
    // 'random' keeps the array as-is (insertion order = pseudo-random for different chords)

    // Build offset map: noteId → offset delta
    const offsets = new Map<string, number>();
    for (let i = 0; i < sorted.length; i++) {
        const note = sorted[i]!;
        const offset = direction === 'random'
            ? (Math.random() - 0.3) * strumAmount * sorted.length
            : i * strumAmount;
        offsets.set(note.id, offset);
    }

    // Save original start beats for undo
    const originals = new Map<string, number>();
    for (const note of targetNotes) {
        originals.set(note.id, note.startBeat);
    }

    // Apply offsets
    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => {
                const offset = offsets.get(n.id);
                if (offset === undefined) {
                    return n;
                }
                return {
                    ...n,
                    startBeat: Math.max(0, n.startBeat + offset),
                };
            }),
        },
    });

    return originals;
}

/**
 * Restore original start beats (undo helper).
 */
export function restoreStrumOriginals(clipId: string, originals: Map<string, number>): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => {
                const orig = originals.get(n.id);
                if (orig === undefined) {
                    return n;
                }
                return { ...n, startBeat: orig };
            }),
        },
    });
}
