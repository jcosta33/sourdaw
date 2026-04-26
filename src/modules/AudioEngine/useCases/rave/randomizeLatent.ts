import { createSeededRandom, generateSeed } from '#/utils/SeededRandom/SeededRandom';

import { type LatentVector } from '../../stores/rave';

/**
 * Randomize latent vectors with controlled temperature.
 * Accepts an optional seed for deterministic reproducibility (undo/redo).
 */
export function randomizeLatent(
    vectors: LatentVector[],
    temperature: number,
    seed?: number
): { result: LatentVector[]; seed: number } {
    const usedSeed = seed ?? generateSeed();
    const rng = createSeededRandom(usedSeed);

    const result = vectors.map((value) => ({
        timeSec: value.timeSec,
        values: value.values.map((val) => {
            const noise = (rng() * 2 - 1) * temperature;
            return Math.tanh(val + noise);
        }),
    }));

    return { result, seed: usedSeed };
}
