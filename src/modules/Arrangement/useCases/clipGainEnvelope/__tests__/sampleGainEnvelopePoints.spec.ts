import { describe, it, expect } from 'vitest';

import { sampleGainEnvelopePoints } from '../sampleGainEnvelopePoints';

// Neither `addGainEnvelopePoint` nor `moveGainEnvelopePoint` dedupes, and a
// persisted envelope is not re-sorted on load, so two points at one
// `beatOffset` are a state the curve law has to answer for.
describe('sampleGainEnvelopePoints — coincident points', () => {
    it('returns the later point of a coincident pair closing the curve', () => {
        const points = [
            { id: 'a', beatOffset: 0, gainDb: 0 },
            { id: 'b', beatOffset: 2, gainDb: -6 },
            { id: 'c', beatOffset: 2, gainDb: 3 },
        ];

        expect(sampleGainEnvelopePoints(points, 2)).toBe(3);
    });

    it('reads a coincident pair mid-curve as the segment ending on it rather than dividing by zero', () => {
        const points = [
            { id: 'a', beatOffset: 0, gainDb: 0 },
            { id: 'b', beatOffset: 2, gainDb: -6 },
            { id: 'c', beatOffset: 2, gainDb: 3 },
            { id: 'd', beatOffset: 4, gainDb: -12 },
        ];

        expect(sampleGainEnvelopePoints(points, 2)).toBe(-6);
    });

    it('keeps interpolating past a coincident pair', () => {
        const points = [
            { id: 'a', beatOffset: 0, gainDb: 0 },
            { id: 'b', beatOffset: 2, gainDb: -6 },
            { id: 'c', beatOffset: 2, gainDb: 3 },
            { id: 'd', beatOffset: 4, gainDb: -12 },
        ];

        expect(sampleGainEnvelopePoints(points, 3)).toBeCloseTo(-4.5);
    });
});
