import { describe, expect, it } from 'vitest';

import { isValidProofChainOrder } from '../isValidProofChainOrder';

describe('isValidProofChainOrder', () => {
    it('accepts any permutation of the five module ids', () => {
        expect(isValidProofChainOrder([0, 1, 2, 3, 4])).toBe(true);
        expect(isValidProofChainOrder([4, 3, 2, 1, 0])).toBe(true);
        expect(isValidProofChainOrder([2, 0, 4, 1, 3])).toBe(true);
    });

    it('rejects an order with fewer than five entries', () => {
        expect(isValidProofChainOrder([0, 1, 2, 3])).toBe(false);
    });

    it('rejects an order with more than five entries', () => {
        expect(isValidProofChainOrder([0, 1, 2, 3, 4, 0])).toBe(false);
    });

    it('rejects a repeated module id', () => {
        expect(isValidProofChainOrder([0, 0, 1, 2, 3])).toBe(false);
    });

    it('rejects a module id below the valid range', () => {
        expect(isValidProofChainOrder([-1, 1, 2, 3, 4])).toBe(false);
    });

    it('rejects a module id above the valid range', () => {
        expect(isValidProofChainOrder([0, 1, 2, 3, 5])).toBe(false);
    });

    it('rejects a non-integer module id', () => {
        expect(isValidProofChainOrder([0.5, 1, 2, 3, 4])).toBe(false);
    });
});
