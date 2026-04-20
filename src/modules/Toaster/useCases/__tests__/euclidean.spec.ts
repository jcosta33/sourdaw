import { describe, it, expect } from 'vitest';

import { euclidean } from '../euclidean';

describe('euclidean', () => {
    it('returns empty when steps <= 0', () => {
        expect(euclidean(3, 0)).toEqual([]);
        expect(euclidean(3, -1)).toEqual([]);
    });

    it('returns all-false when hits <= 0', () => {
        expect(euclidean(0, 4)).toEqual([false, false, false, false]);
    });

    it('returns all-true when hits >= steps', () => {
        expect(euclidean(4, 4)).toEqual([true, true, true, true]);
        expect(euclidean(8, 4)).toEqual([true, true, true, true]);
    });

    it('produces a length-N pattern with exactly K hits', () => {
        const pattern = euclidean(3, 8);
        expect(pattern).toHaveLength(8);
        expect(pattern.filter((b) => b).length).toBe(3);
    });

    it('rotation shifts the pattern', () => {
        const base = euclidean(3, 8);
        const rotated = euclidean(3, 8, 1);
        expect(rotated).toHaveLength(8);
        expect(rotated.filter((b) => b).length).toBe(3);
        // rotation by 1 shifts each step left by one (first element becomes last)
        expect(rotated).toEqual([...base.slice(1), base[0]]);
    });
});
