import { describe, it, expect } from 'vitest';

import { getRestoredProofChainOrder } from '../getRestoredProofChainOrder';

function makeParams(order: number[]): Record<string, number> {
    const params: Record<string, number> = {};
    for (let index = 0; index < order.length; index++) {
        params[`chain_order_${index}`] = order[index]!;
    }
    return params;
}

describe('getRestoredProofChainOrder — valid permutations', () => {
    it('returns the default order [0,1,2,3,4]', () => {
        expect(getRestoredProofChainOrder(makeParams([0, 1, 2, 3, 4]))).toEqual([0, 1, 2, 3, 4]);
    });

    it('returns a reversed order [4,3,2,1,0]', () => {
        expect(getRestoredProofChainOrder(makeParams([4, 3, 2, 1, 0]))).toEqual([4, 3, 2, 1, 0]);
    });

    it('returns an arbitrary valid permutation [2,0,1,4,3]', () => {
        expect(getRestoredProofChainOrder(makeParams([2, 0, 1, 4, 3]))).toEqual([2, 0, 1, 4, 3]);
    });
});

describe('getRestoredProofChainOrder — null rejections', () => {
    it('returns null when any key is absent', () => {
        expect(getRestoredProofChainOrder({ chain_order_0: 0, chain_order_1: 1 })).toBeNull();
    });

    it('returns null when no keys are present', () => {
        expect(getRestoredProofChainOrder({})).toBeNull();
    });

    it('returns null for a duplicate value (not a permutation)', () => {
        expect(getRestoredProofChainOrder(makeParams([0, 0, 2, 3, 4]))).toBeNull();
    });

    it('returns null for an out-of-range value (5)', () => {
        expect(getRestoredProofChainOrder(makeParams([5, 1, 2, 3, 4]))).toBeNull();
    });

    it('returns null for a missing module id', () => {
        // [0,1,2,3,5] — 5 is out of range and 4 is missing.
        expect(getRestoredProofChainOrder(makeParams([0, 1, 2, 3, 5]))).toBeNull();
    });
});
