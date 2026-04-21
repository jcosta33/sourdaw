import { createSeededRandom, generateSeed } from '#/utils/SeededRandom/SeededRandom';

import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

/**
 * Adds random timing and velocity variation to notes.
 * Accepts an optional seed for deterministic reproducibility (undo/redo).
 * Returns the seed used, so callers can store it for replay.
 */
export function humanizeNotes(clipId: string, timingAmount: number, velocityAmount?: number, seed?: number): number {
    const vAmount = velocityAmount ?? timingAmount;
    const usedSeed = seed ?? generateSeed();
    const rng = createSeededRandom(usedSeed);

    updateNotesForClip(clipId, (notes) =>
        notes.map((node) => ({
            ...node,
            startBeat: node.startBeat + (rng() - 0.5) * timingAmount * 0.25,
            velocity: Math.max(1, Math.min(127, node.velocity + Math.round((rng() - 0.5) * vAmount * 10))),
        }))
    );

    return usedSeed;
}
