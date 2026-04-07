/**
 * Seedable pseudo-random number generator using the mulberry32 algorithm.
 * Produces deterministic sequences from a given seed, enabling reproducible
 * randomness for undo/redo and testing.
 *
 * Usage:
 *   const rng = createSeededRandom(42);
 *   const value = rng();     // 0 <= value < 1
 *   const ranged = rng() * (max - min) + min;
 */

/**
 * Create a seeded PRNG function that returns values in [0, 1).
 * Uses the mulberry32 algorithm — fast, small state, good distribution.
 */
export function createSeededRandom(seed: number): () => number {
    let state = seed | 0;
    return (): number => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Generate a random seed from Math.random().
 * Use this when no seed is provided to create a "random but capturable" seed.
 */
export function generateSeed(): number {
    return (Math.random() * 4294967296) >>> 0;
}
