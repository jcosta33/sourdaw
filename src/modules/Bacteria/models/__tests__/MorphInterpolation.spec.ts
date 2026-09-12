import { describe, expect, it } from 'vitest';

import { type BacteriaSnapshot } from '../BacteriaPatch';
import { interpolateMorphSnapshot, morphCornerWeights } from '../MorphInterpolation';

function corner(id: 'A' | 'B' | 'C' | 'D', paramValues: Record<string, number>): BacteriaSnapshot {
    return { id, name: id, paramValues };
}

describe('morphCornerWeights', () => {
    it('puts the whole weight on the corner the position names', () => {
        expect(morphCornerWeights(0, 0)).toEqual([1, 0, 0, 0]); // A
        expect(morphCornerWeights(1, 0)).toEqual([0, 1, 0, 0]); // B
        expect(morphCornerWeights(0, 1)).toEqual([0, 0, 1, 0]); // C
        expect(morphCornerWeights(1, 1)).toEqual([0, 0, 0, 1]); // D
    });

    it('splits the center evenly across the four corners', () => {
        expect(morphCornerWeights(0.5, 0.5)).toEqual([0.25, 0.25, 0.25, 0.25]);
    });

    it('weights only the edge the position travels', () => {
        // Half-way along the bottom edge: A and B share everything, C and D none.
        expect(morphCornerWeights(0.5, 0)).toEqual([0.5, 0.5, 0, 0]);
        expect(morphCornerWeights(0, 0.5)).toEqual([0.5, 0, 0.5, 0]);
    });

    it('clamps an out-of-range position onto the nearest corner', () => {
        expect(morphCornerWeights(-3, 0)).toEqual([1, 0, 0, 0]);
        expect(morphCornerWeights(2, 9)).toEqual([0, 0, 0, 1]);
    });
});

describe('interpolateMorphSnapshot', () => {
    it('returns the exact corner value at each corner', () => {
        const snapshots = [
            corner('A', { drive: 10 }),
            corner('B', { drive: 50 }),
            corner('C', { drive: 30 }),
            corner('D', { drive: 90 }),
        ];

        expect(interpolateMorphSnapshot(0, 0, snapshots)).toEqual({ drive: 10 });
        expect(interpolateMorphSnapshot(1, 0, snapshots)).toEqual({ drive: 50 });
        expect(interpolateMorphSnapshot(0, 1, snapshots)).toEqual({ drive: 30 });
        expect(interpolateMorphSnapshot(1, 1, snapshots)).toEqual({ drive: 90 });
    });

    it('averages all four corners at the center', () => {
        const snapshots = [
            corner('A', { drive: 0 }),
            corner('B', { drive: 100 }),
            corner('C', { drive: 0 }),
            corner('D', { drive: 100 }),
        ];

        expect(interpolateMorphSnapshot(0.5, 0.5, snapshots)).toEqual({ drive: 50 });
    });

    it('interpolates along one edge from the two corners that edge joins', () => {
        const snapshots = [
            corner('A', { mix: 0 }),
            corner('B', { mix: 1 }),
            corner('C', { mix: 0 }),
            corner('D', { mix: 1 }),
        ];

        expect(interpolateMorphSnapshot(0.25, 0, snapshots)).toEqual({ mix: 0.25 });
        expect(interpolateMorphSnapshot(0.5, 1, snapshots)).toEqual({ mix: 0.5 });
    });

    it('skips a parameter absent from any corner — a gap is not zero', () => {
        const snapshots = [
            corner('A', { drive: 0 }),
            corner('B', { drive: 100, mix: 1 }),
            corner('C', { drive: 0 }),
            corner('D', { drive: 100 }),
        ];

        const morphed = interpolateMorphSnapshot(1, 0, snapshots);
        // `mix` lives in B alone; the result must not smear it across the pad.
        expect(morphed).toEqual({ drive: 100 });
    });

    it('moves nothing while any corner has never been captured', () => {
        const snapshots = [corner('A', { drive: 10 }), corner('B', {}), corner('C', {}), corner('D', {})];

        expect(interpolateMorphSnapshot(0, 0, snapshots)).toEqual({});
        expect(interpolateMorphSnapshot(0.7, 0.3, snapshots)).toEqual({});
    });

    it('answers nothing for fewer than four corners', () => {
        expect(interpolateMorphSnapshot(0.5, 0.5, [corner('A', { drive: 10 })])).toEqual({});
        expect(interpolateMorphSnapshot(0.5, 0.5, [])).toEqual({});
    });
});
