import { describe, it, expect, beforeEach } from 'vitest';

import { __resetGainEnvelopesForTest, setEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';

import { getGainAtBeat } from '../getGainAtBeat';

describe('getGainAtBeat', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
    });

    it('should return zero when there is no envelope or it is disabled', () => {
        expect(getGainAtBeat('missing', 0)).toBe(0);
        setEnvelope('c1', { clipId: 'c1', enabled: false, points: [{ id: 'p', beatOffset: 0, gainDb: 3 }] });
        expect(getGainAtBeat('c1', 0)).toBe(0);
        setEnvelope('c2', { clipId: 'c2', enabled: true, points: [] });
        expect(getGainAtBeat('c2', 0)).toBe(0);
    });

    it('should clamp to the first or last point outside the span', () => {
        setEnvelope('c3', {
            clipId: 'c3',
            enabled: true,
            points: [
                { id: 'a', beatOffset: 1, gainDb: -2 },
                { id: 'b', beatOffset: 3, gainDb: 4 },
            ],
        });
        expect(getGainAtBeat('c3', 0)).toBe(-2);
        expect(getGainAtBeat('c3', 10)).toBe(4);
    });

    it('should linearly interpolate between two points', () => {
        setEnvelope('c4', {
            clipId: 'c4',
            enabled: true,
            points: [
                { id: 'a', beatOffset: 0, gainDb: 0 },
                { id: 'b', beatOffset: 1, gainDb: 6 },
            ],
        });
        expect(getGainAtBeat('c4', 0.5)).toBeCloseTo(3);
    });
});
