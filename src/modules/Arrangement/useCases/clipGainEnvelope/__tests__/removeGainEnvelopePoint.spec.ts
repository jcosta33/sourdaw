import { describe, it, expect, beforeEach } from 'vitest';

import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';

import { removeGainEnvelopePoint } from '../removeGainEnvelopePoint';

describe('removeGainEnvelopePoint', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
    });

    it('removes a point and keeps at least one anchor', () => {
        setEnvelope('c1', {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'only', beatOffset: 0, gainDb: 0 }],
        });

        removeGainEnvelopePoint('c1', 'only');

        expect(getEnvelope('c1')!.points).toHaveLength(1);
        expect(getEnvelope('c1')!.points[0]!.id).not.toBe('only');
    });

    it('removes only the targeted point when other points remain', () => {
        setEnvelope('c1', {
            clipId: 'c1',
            enabled: true,
            points: [
                { id: 'keep', beatOffset: 0, gainDb: 0 },
                { id: 'drop', beatOffset: 4, gainDb: -6 },
                { id: 'keep2', beatOffset: 8, gainDb: 0 },
            ],
        });

        removeGainEnvelopePoint('c1', 'drop');

        const points = getEnvelope('c1')!.points;
        expect(points).toHaveLength(2);
        expect(points.map((p) => p.id)).toEqual(['keep', 'keep2']);
    });

    it('is a no-op when no envelope exists for the clip', () => {
        expect(() => removeGainEnvelopePoint('no-such-clip', 'p1')).not.toThrow();
        expect(getEnvelope('no-such-clip')).toBeUndefined();
    });
});
