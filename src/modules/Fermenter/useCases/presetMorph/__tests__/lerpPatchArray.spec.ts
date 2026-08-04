import { describe, it, expect } from 'vitest';

import { DEFAULT_PATCH, type FermenterPatch } from '#/modules/Fermenter/models/FermenterPatch';

import { lerpPatch } from '../lerpPatch';

/**
 * Specs for the array (macros) interpolation branch of lerpPatch.
 * The existing presetMorph.spec.ts covers scalar/discrete paths but never
 * exercises the Array.isArray branch or its element-level fallback.
 */

function makePatch(macros: number[]): FermenterPatch {
    return { ...DEFAULT_PATCH, macros: macros as never };
}

describe('lerpPatch — macros array interpolation', () => {
    it('interpolates macros element-by-element at t=0.5', () => {
        const a = makePatch([0, 0, 0, 0, 0, 0, 0, 0]);
        const b = makePatch([1, 1, 1, 1, 1, 1, 1, 1]);
        const result = lerpPatch(a, b, 0.5);
        expect(result.macros).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    });

    it('interpolates macros at t=0.25', () => {
        const a = makePatch([0, 0, 0, 0, 0, 0, 0, 0]);
        const b = makePatch([1, 1, 1, 1, 1, 1, 1, 1]);
        const result = lerpPatch(a, b, 0.25);
        expect(result.macros).toEqual([0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]);
    });

    it('returns A macros at t=0', () => {
        const a = makePatch([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
        const b = makePatch([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]);
        const result = lerpPatch(a, b, 0);
        expect(result.macros).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    });

    it('returns B macros at t=1', () => {
        const a = makePatch([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
        const b = makePatch([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]);
        const result = lerpPatch(a, b, 1);
        const expected = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
        for (let i = 0; i < 8; i++) {
            expect(result.macros[i]).toBeCloseTo(expected[i]!, 10);
        }
    });

    it('clamps t > 1 to 1', () => {
        const a = makePatch([0, 0, 0, 0, 0, 0, 0, 0]);
        const b = makePatch([1, 1, 1, 1, 1, 1, 1, 1]);
        const result = lerpPatch(a, b, 2);
        expect(result.macros).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it('clamps t < 0 to 0', () => {
        const a = makePatch([0, 0, 0, 0, 0, 0, 0, 0]);
        const b = makePatch([1, 1, 1, 1, 1, 1, 1, 1]);
        const result = lerpPatch(a, b, -1);
        expect(result.macros).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('interpolates each macro independently', () => {
        const a = makePatch([0, 0.5, 1, 0, 0.5, 1, 0, 0.5]);
        const b = makePatch([1, 0.5, 0, 1, 0.5, 0, 1, 0.5]);
        const result = lerpPatch(a, b, 0.5);
        // Elements where a≠b: 0→0.5, 1→0.5. Elements where a===b: unchanged.
        expect(result.macros).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    });
});
