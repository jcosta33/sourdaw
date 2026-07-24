import { describe, it, expect, beforeEach } from 'vitest';

import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';

import { moveGainEnvelopePoint } from '../moveGainEnvelopePoint';

describe('moveGainEnvelopePoint', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
    });

    it('updates the point and re-sorts by beat', () => {
        setEnvelope('c1', {
            clipId: 'c1',
            enabled: true,
            points: [
                { id: 'p1', beatOffset: 0, gainDb: 0 },
                { id: 'p2', beatOffset: 2, gainDb: 0 },
            ],
        });

        moveGainEnvelopePoint('c1', 'p2', 0.5, 3);

        const pts = getEnvelope('c1')!.points;
        expect(pts.map((param) => param.id)).toEqual(['p1', 'p2']);
        expect(pts[1]!.beatOffset).toBe(0.5);
        expect(pts[1]!.gainDb).toBe(3);
    });

    it('is a no-op when the clip has no envelope', () => {
        // No envelope set for c1 -> getEnvelope returns null and nothing is written.
        moveGainEnvelopePoint('c1', 'p1', 1, 0);

        expect(getEnvelope('c1')).toBeUndefined();
    });

    it('clamps beat offset to a minimum of 0 and gain to [-60, 12]', () => {
        setEnvelope('c1', {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'p1', beatOffset: 1, gainDb: 0 }],
        });

        moveGainEnvelopePoint('c1', 'p1', -5, 99);

        const point = getEnvelope('c1')!.points[0]!;
        expect(point.beatOffset).toBe(0);
        expect(point.gainDb).toBe(12);

        moveGainEnvelopePoint('c1', 'p1', 2, -100);
        expect(getEnvelope('c1')!.points[0]!.gainDb).toBe(-60);
    });
});
