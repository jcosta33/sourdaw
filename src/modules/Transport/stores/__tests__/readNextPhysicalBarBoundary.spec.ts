import { beforeEach, describe, expect, it } from 'vitest';

import { readNextPhysicalBarBoundary } from '../readNextPhysicalBarBoundary';
import { timeSignatureMapStore } from '../timeSignatureMapStore';
import { defaultTransportState, transportStore } from '../transportStore';

function boundary(beat: number, includeCurrent: boolean): number | null {
    return readNextPhysicalBarBoundary({ beat, includeCurrent });
}

describe('readNextPhysicalBarBoundary', () => {
    beforeEach(() => {
        transportStore.set(defaultTransportState);
        timeSignatureMapStore.set({ changes: [] });
    });

    it('reads the empty map from the base meter and distinguishes note ends from controllers on a line', () => {
        expect(boundary(0, false)).toBe(4);
        expect(boundary(1.5, true)).toBe(4);
        expect(boundary(4, true)).toBe(4);
        expect(boundary(4, false)).toBe(8);
    });

    it('uses the denominator for constant 3/4, 6/8, and fractional bar lengths', () => {
        transportStore.set({ ...defaultTransportState, timeSignatureNumerator: 3, timeSignatureDenominator: 4 });
        expect(boundary(0, false)).toBe(3);
        expect(boundary(3.5, true)).toBe(6);

        transportStore.set({ ...defaultTransportState, timeSignatureNumerator: 6, timeSignatureDenominator: 8 });
        expect(boundary(0, false)).toBe(3);
        expect(boundary(3, false)).toBe(6);

        transportStore.set({ ...defaultTransportState, timeSignatureNumerator: 7, timeSignatureDenominator: 16 });
        expect(boundary(1.75, true)).toBe(1.75);
        expect(boundary(1.75, false)).toBe(3.5);
    });

    it('cuts a physical bar at a mid-bar change and starts the next grid at the seam', () => {
        timeSignatureMapStore.set({ changes: [{ id: 'three-four', beat: 5, numerator: 3, denominator: 4 }] });
        expect(boundary(4.5, true)).toBe(5);
        expect(boundary(5, true)).toBe(5);
        expect(boundary(5, false)).toBe(8);
        expect(boundary(8, false)).toBe(11);
    });

    it('resolves a nondyadic grid line with the meter model tolerance', () => {
        timeSignatureMapStore.set({ changes: [{ id: 'five-thirds', beat: 1, numerator: 5, denominator: 3 }] });
        expect(boundary(1 + 5 * (4 / 3), true)).toBeCloseTo(1 + 5 * (4 / 3));
        expect(boundary(1 + 5 * (4 / 3), false)).toBeCloseTo(1 + 10 * (4 / 3));
    });

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuses an invalid beat %s', (beat) => {
        expect(boundary(beat, false)).toBeNull();
    });
});
