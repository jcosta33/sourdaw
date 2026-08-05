import { describe, expect, it } from 'vitest';

import { isValidDynCrossoverFreqs } from '../isValidDynCrossoverFreqs';

describe('isValidDynCrossoverFreqs', () => {
    it('accepts strictly ordered finite frequencies within the allowed range', () => {
        expect(isValidDynCrossoverFreqs([100, 1000, 5000])).toBe(true);
    });

    it('rejects when any value is not finite', () => {
        expect(isValidDynCrossoverFreqs([Number.NaN, 1000, 5000])).toBe(false);
        expect(isValidDynCrossoverFreqs([100, Number.POSITIVE_INFINITY, 5000])).toBe(false);
        expect(isValidDynCrossoverFreqs([100, 1000, Number.NaN])).toBe(false);
    });

    it('rejects when low is below the minimum', () => {
        expect(isValidDynCrossoverFreqs([10, 1000, 5000])).toBe(false);
    });

    it('rejects when high is above the maximum', () => {
        expect(isValidDynCrossoverFreqs([100, 1000, 30_000])).toBe(false);
    });

    it('rejects when frequencies are not strictly ordered', () => {
        // low === mid (not strictly less)
        expect(isValidDynCrossoverFreqs([500, 500, 5000])).toBe(false);
        // mid === high
        expect(isValidDynCrossoverFreqs([100, 1000, 1000])).toBe(false);
        // low > mid
        expect(isValidDynCrossoverFreqs([2000, 1000, 5000])).toBe(false);
        // mid > high
        expect(isValidDynCrossoverFreqs([100, 5000, 1000])).toBe(false);
    });
});
