import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { createSeededRandom, generateSeed } from '#/utils/SeededRandom/SeededRandom';

/**
 * Adds random timing and velocity variation to notes.
 * Accepts an optional seed for deterministic reproducibility (undo/redo).
 * Returns the seed used, so callers can store it for replay.
 */
export function humanizeNotes(clipId: string, timingAmount: number, velocityAmount?: number, seed?: number): number {
    const vAmount = velocityAmount ?? timingAmount;
    const state = midiStore.value;
    if (!state) {
        return 0;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return 0;
    }

    const usedSeed = seed ?? generateSeed();
    const rng = createSeededRandom(usedSeed);

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                startBeat: n.startBeat + (rng() - 0.5) * timingAmount * 0.25,
                velocity: Math.max(1, Math.min(127, n.velocity + Math.round((rng() - 0.5) * vAmount * 10))),
            })),
        },
    });

    return usedSeed;
}
