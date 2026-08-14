import { createSeededRandom, generateSeed } from '#/utils/SeededRandom/SeededRandom';

import { midiStore } from '../../stores/midiStore';

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
 * @param seed - Optional RNG seed for `direction: 'random'`. Undo/redo replays
 *   this transform by re-invoking it, so a caller that wants the redo to land
 *   on the offsets it is replaying must pass the same seed both times, exactly
 *   as `humanizeNotes` and `arpeggiate` require. Raw `Math.random()` made that
 *   impossible.
 *
 * @returns Map of noteId → original startBeat (for undo)
 */
export function strumNotes(
    clipId: string,
    noteIds: string[],
    strumAmount = 0.04,
    direction: StrumDirection = 'up',
    seed?: number
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
    const targetNotes = existing.filter((node) => idSet.has(node.id));

    if (targetNotes.length < 2) {
        return null;
    }

    // Sort by pitch for strum direction
    const sorted = [...targetNotes];
    if (direction === 'up') {
        sorted.sort((alpha, b) => alpha.pitch - b.pitch); // low → high gets progressive delay
    } else if (direction === 'down') {
        sorted.sort((alpha, b) => b.pitch - alpha.pitch); // high → low gets progressive delay
    }
    // 'random' keeps the array as-is (insertion order = pseudo-random for different chords)

    // Build offset map: noteId → offset delta
    const random = createSeededRandom(seed ?? generateSeed());
    const offsets = new Map<string, number>();
    for (let index = 0; index < sorted.length; index++) {
        const note = sorted[index]!;
        if (direction === 'random') {
            offsets.set(note.id, (random() - 0.3) * strumAmount * sorted.length);
            continue;
        }
        offsets.set(note.id, index * strumAmount);
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
            [clipId]: existing.map((node) => {
                const offset = offsets.get(node.id);
                if (offset === undefined) {
                    return node;
                }
                return {
                    ...node,
                    startBeat: Math.max(0, node.startBeat + offset),
                };
            }),
        },
    });

    return originals;
}
