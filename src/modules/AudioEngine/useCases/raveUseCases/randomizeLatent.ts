import { type LatentVector } from '#/modules/AudioEngine/stores/rave';
import { createSeededRandom, generateSeed } from '#/helpers/SeededRandom/SeededRandom';

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

    const result = vectors.map((v) => ({
        timeSec: v.timeSec,
        values: v.values.map((val) => {
            const noise = (rng() * 2 - 1) * temperature;
            return Math.tanh(val + noise);
        }),
    }));

    return { result, seed: usedSeed };
}
