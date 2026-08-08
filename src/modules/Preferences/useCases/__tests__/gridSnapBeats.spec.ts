import { describe, expect, it } from 'vitest';

import { gridSnapBeats } from '../gridSnapBeats';

describe('gridSnapBeats', () => {
    it('should map known subdivisions to beat lengths', () => {
        expect(gridSnapBeats('bar')).toBe(4);
        expect(gridSnapBeats('beat')).toBe(1);
        expect(gridSnapBeats('1/2')).toBe(0.5);
        expect(gridSnapBeats('1/4')).toBe(0.25);
        expect(gridSnapBeats('1/8')).toBe(0.125);
        expect(gridSnapBeats('1/16')).toBe(0.0625);
        expect(gridSnapBeats('1/32')).toBe(0.03125);
        expect(gridSnapBeats('off')).toBe(0);
    });

    it('should map triplet and dotted options', () => {
        expect(gridSnapBeats('1/4T')).toBeCloseTo(1 / 6);
        expect(gridSnapBeats('1/8T')).toBeCloseTo(1 / 12);
        expect(gridSnapBeats('1/16T')).toBeCloseTo(1 / 24);
        expect(gridSnapBeats('1/4D')).toBe(0.375);
        expect(gridSnapBeats('1/8D')).toBe(0.1875);
    });

    it('fits three triplet steps into two straight steps of the same denomination', () => {
        expect(3 * gridSnapBeats('1/4T')).toBeCloseTo(2 * gridSnapBeats('1/4'));
        expect(3 * gridSnapBeats('1/8T')).toBeCloseTo(2 * gridSnapBeats('1/8'));
        expect(3 * gridSnapBeats('1/16T')).toBeCloseTo(2 * gridSnapBeats('1/16'));
    });

    it('makes a triplet grid finer than its straight sibling and a dotted grid coarser', () => {
        expect(gridSnapBeats('1/4T')).toBeLessThan(gridSnapBeats('1/4'));
        expect(gridSnapBeats('1/8T')).toBeLessThan(gridSnapBeats('1/8'));
        expect(gridSnapBeats('1/4D')).toBeGreaterThan(gridSnapBeats('1/4'));
        expect(gridSnapBeats('1/8D')).toBeGreaterThan(gridSnapBeats('1/8'));
    });

    it('should return 0 for an unknown option value', () => {
        expect(gridSnapBeats('not-a-grid-option' as Parameters<typeof gridSnapBeats>[0])).toBe(0);
    });
});
