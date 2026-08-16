import { describe, expect, it } from 'vitest';

import { getLinkedBandValues } from '../LinkedBandValues';

describe('getLinkedBandValues', () => {
    it('moves every band by the same offset when nothing reaches a rail', () => {
        const values = getLinkedBandValues({
            values: [-20, -18, -16, -14],
            representativeIndex: 0,
            requestedValue: -15,
            min: -60,
            max: 0,
        });

        expect(values).toEqual([-15, -13, -11, -9]);
    });

    it('stops the whole group at the top rail instead of flattening onto it', () => {
        // Requested +20 on the representative, but the highest band sits 14 from
        // the rail: the group offset caps at +14. A naive per-band clamp would
        // land every band on 0 and destroy the 2 dB tilt between them.
        const values = getLinkedBandValues({
            values: [-20, -18, -16, -14],
            representativeIndex: 0,
            requestedValue: 0,
            min: -60,
            max: 0,
        });

        expect(values).toEqual([-6, -4, -2, 0]);
    });

    it('stops the whole group at the bottom rail from the far side', () => {
        // The Warm exciter shape: band 3 sits 0.1 above the floor, so a -0.5
        // request on band 1 caps the group offset at -0.1 and the drive spread
        // survives.
        const values = getLinkedBandValues({
            values: [0.3, 0.2, 0.15, 0.1],
            representativeIndex: 1,
            requestedValue: -0.3,
            min: 0,
            max: 1,
        });

        expect(values[0]).toBeCloseTo(0.2);
        expect(values[1]).toBeCloseTo(0.1);
        expect(values[2]).toBeCloseTo(0.05);
        expect(values[3]).toBeCloseTo(0);
    });

    it('returns the values untouched when the representative index is out of range', () => {
        const values = [-20, -18];
        const result = getLinkedBandValues({
            values,
            representativeIndex: 5,
            requestedValue: 0,
            min: -60,
            max: 0,
        });

        expect(result).toEqual([-20, -18]);
        expect(result).not.toBe(values);
    });
});
