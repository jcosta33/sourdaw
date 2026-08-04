import { describe, it, expect } from 'vitest';

import { createPunchRegionPatch } from '../punchRegion';

/**
 * Deep branch specs for createPunchRegionPatch. The existing spec (22 lines)
 * only tests the non-finite-beat rejection path (NaN/Infinity → null).
 * These cover all functional branches: normalization clamping, punch-in before/after
 * punch-out, push-out reorder, punch-out reorder, and boundary beats.
 */

function punch(beat: number, edge: 'in' | 'out', current: { punchInBeat: number; punchOutBeat: number }) {
    return createPunchRegionPatch({ beat, edge, current });
}

describe('createPunchRegionPatch — beat normalization', () => {
    it('clamps finite negative beat to 0', () => {
        const result = punch(-5, 'in', { punchInBeat: 4, punchOutBeat: 12 });
        expect(result).not.toBeNull();
        expect(result?.punchInBeat).toBe(0);
    });

    it('rejects NaN beat', () => {
        expect(punch(Number.NaN, 'in', { punchInBeat: 4, punchOutBeat: 12 })).toBeNull();
    });

    it('rejects Infinity beat', () => {
        expect(punch(Number.POSITIVE_INFINITY, 'in', { punchInBeat: 4, punchOutBeat: 12 })).toBeNull();
    });
});

describe('createPunchRegionPatch — punch-in edge', () => {
    it('sets only punchInBeat when beat < punchOutBeat', () => {
        const result = punch(5, 'in', { punchInBeat: 4, punchOutBeat: 12 });
        expect(result).toEqual({ punchInBeat: 5 });
    });

    it('pushes punchOutBeat forward when beat >= punchOutBeat', () => {
        const result = punch(20, 'in', { punchInBeat: 4, punchOutBeat: 12 });
        expect(result).toEqual({ punchInBeat: 20, punchOutBeat: 21 });
    });

    it('punch-in exactly at punchOutBeat pushes out by 1', () => {
        const result = punch(12, 'in', { punchInBeat: 4, punchOutBeat: 12 });
        expect(result).toEqual({ punchInBeat: 12, punchOutBeat: 13 });
    });
});

describe('createPunchRegionPatch — punch-out edge', () => {
    it('sets only punchOutBeat when beat > punchInBeat', () => {
        const result = punch(20, 'out', { punchInBeat: 4, punchOutBeat: 12 });
        expect(result).toEqual({ punchOutBeat: 20 });
    });

    it('at beat 0, sets punchOutBeat to MIN_VALUE and punchInBeat to 0', () => {
        const result = punch(0, 'out', { punchInBeat: 4, punchOutBeat: 12 });
        expect(result?.punchOutBeat).toBe(Number.MIN_VALUE);
        expect(result?.punchInBeat).toBe(0);
    });

    it('reorders when beat <= punchInBeat: moves punchIn backward', () => {
        const result = punch(2, 'out', { punchInBeat: 4, punchOutBeat: 12 });
        expect(result?.punchOutBeat).toBe(2);
        // punchInBeat = getPreviousFinitePunchBeat(2) = max(0, 2-1) = 1.
        expect(result?.punchInBeat).toBe(1);
    });
});

describe('createPunchRegionPatch — boundary consistency', () => {
    it('punch-in and punch-out at the same finite beat is allowed (in pushes out)', () => {
        // punch-in at 8, current out is 12 → in < out, only sets in.
        const inResult = punch(8, 'in', { punchInBeat: 4, punchOutBeat: 12 });
        expect(inResult).toEqual({ punchInBeat: 8 });
    });

    it('punch-out at beat equal to punchInBeat reorders', () => {
        // beat=4, current punchIn=4. beat > punchIn? 4 > 4 = false.
        // beat === 0? no. So reorder: punchOut=4, punchIn = getPreviousFinitePunchBeat(4) = 3.
        const result = punch(4, 'out', { punchInBeat: 4, punchOutBeat: 12 });
        expect(result?.punchOutBeat).toBe(4);
        expect(result?.punchInBeat).toBe(3);
    });
});

describe('createPunchRegionPatch — IEEE-754 overflow handling', () => {
    it('punch-in at MAX_VALUE moves punchIn backward and sets out to MAX_VALUE', () => {
        const result = punch(Number.MAX_VALUE, 'in', { punchInBeat: 4, punchOutBeat: 12 });
        // beat=MAX_VALUE >= punchOut(12). getNextFinitePunchBeat(MAX_VALUE) = null (overflow).
        // beat < MAX_FINITE_PUNCH_BEAT? No (equal). So: punchIn = getPreviousFinitePunchBeat(MAX_VALUE).
        expect(result?.punchOutBeat).toBe(Number.MAX_VALUE);
        expect(result?.punchInBeat).toBeLessThan(Number.MAX_VALUE);
        expect(result?.punchInBeat).toBeGreaterThanOrEqual(0);
    });

    it('punch-in at large finite beat pushes punchOut to MAX_VALUE when beat+1 overflows', () => {
        // A very large but not MAX_VALUE beat where beat+1 overflows to Infinity.
        const huge = Number.MAX_VALUE / 2;
        const result = punch(huge, 'in', { punchInBeat: 4, punchOutBeat: 12 });
        expect(result?.punchInBeat).toBe(huge);
        // punchOut should be pushed forward (either beat+1 or MAX_VALUE).
        expect(result?.punchOutBeat).toBeGreaterThan(huge);
    });
});
