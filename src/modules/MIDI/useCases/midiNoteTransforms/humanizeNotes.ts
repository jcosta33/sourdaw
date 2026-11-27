import { generateSeed } from '#/utils/SeededRandom/SeededRandom';

import { humanizeMidiNotes } from '../../transformers/humanizeMidiNotes';
import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

/**
 * Adds random timing and velocity variation to notes.
 * Accepts an optional seed for deterministic reproducibility (undo/redo).
 * Returns the seed used, so callers can store it for replay.
 */
export function humanizeNotes(clipId: string, timingAmount: number, velocityAmount?: number, seed?: number): number {
    const vAmount = velocityAmount ?? timingAmount;
    const usedSeed = seed ?? generateSeed();

    updateNotesForClip(clipId, (notes) => humanizeMidiNotes(notes, timingAmount, vAmount, usedSeed));

    return usedSeed;
}
