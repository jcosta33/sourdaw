import { describe, expect, it } from 'vitest';

import { floorToGridCell } from '../floorToGridCell';

describe('floorToGridCell', () => {
    it('keeps a beat in its own cell rather than rounding to the nearer line', () => {
        expect(floorToGridCell(1.4, 0.5)).toBeCloseTo(1);
        expect(floorToGridCell(1.49, 0.5)).toBeCloseTo(1);
        expect(floorToGridCell(1.51, 0.5)).toBeCloseTo(1.5);
    });

    it('gives a beat exactly on a grid line the cell that starts there', () => {
        expect(floorToGridCell(1, 0.5)).toBeCloseTo(1);
        expect(floorToGridCell(0, 0.25)).toBe(0);
    });

    it('absorbs the division error of a grid line reached through floating point', () => {
        // 0.3 / 0.1 === 2.9999999999999996, which a bare floor puts in cell 2.
        expect(0.3 / 0.1).toBeLessThan(3);
        expect(floorToGridCell(0.3, 0.1)).toBeCloseTo(0.3);
    });

    it('keeps a beat just short of a line in the cell below it', () => {
        expect(floorToGridCell(0.2999, 0.1)).toBeCloseTo(0.2);
    });

    it('returns the beat unchanged when the grid is off', () => {
        expect(floorToGridCell(3.777, 0)).toBe(3.777);
    });
});
