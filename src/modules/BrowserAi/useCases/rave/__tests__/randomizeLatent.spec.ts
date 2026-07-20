import { describe, it, expect } from 'vitest';

import { randomizeLatent } from '../randomizeLatent';

describe('randomizeLatent', () => {
    it('produces deterministic output for the same seed', () => {
        const vectors = [{ timeSec: 0, values: [0.1, 0.2] }];

        const first = randomizeLatent(vectors, 0.5, 42);
        const second = randomizeLatent(vectors, 0.5, 42);

        expect(first).toEqual(second);
        expect(first.seed).toBe(42);
    });

    it('generates a seed when none is provided', () => {
        const vectors = [{ timeSec: 0, values: [0] }];

        const { seed } = randomizeLatent(vectors, 1);

        expect(Number.isInteger(seed)).toBe(true);
        expect(seed).toBeGreaterThanOrEqual(0);
    });

    it('preserves timeSec and returns tanh-bounded values when temperature is zero', () => {
        const vectors = [{ timeSec: 1.5, values: [5, -5] }];

        const { result } = randomizeLatent(vectors, 0, 1);

        expect(result[0]?.timeSec).toBe(1.5);
        expect(result[0]?.values).toEqual([Math.tanh(5), Math.tanh(-5)]);
    });

    it('produces different output for different seeds', () => {
        const vectors = [{ timeSec: 0, values: [0.3] }];

        const withSeedOne = randomizeLatent(vectors, 1, 1);
        const withSeedTwo = randomizeLatent(vectors, 1, 2);

        expect(withSeedOne.result).not.toEqual(withSeedTwo.result);
    });
});
