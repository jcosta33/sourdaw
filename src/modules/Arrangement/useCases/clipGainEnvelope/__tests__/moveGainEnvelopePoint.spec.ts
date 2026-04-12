import { describe, it, expect, beforeEach } from 'vitest';
import { type ClipGainEnvelope, gainEnvelopeStore } from '../../../stores/gainEnvelopeStore';
import { moveGainEnvelopePoint } from '../moveGainEnvelopePoint';

describe('moveGainEnvelopePoint', () => {
    beforeEach(() => {
        gainEnvelopeStore.clear();
    });

    it('updates the point and re-sorts by beat', () => {
        gainEnvelopeStore.set('c1', {
            clipId: 'c1',
            enabled: true,
            points: [
                { id: 'p1', beatOffset: 0, gainDb: 0 },
                { id: 'p2', beatOffset: 2, gainDb: 0 },
            ],
        });

        moveGainEnvelopePoint('c1', 'p2', 0.5, 3);

        const pts = gainEnvelopeStore.get('c1')!.points;
        expect(pts.map((p) => p.id)).toEqual(['p1', 'p2']);
        expect(pts[1]!.beatOffset).toBe(0.5);
        expect(pts[1]!.gainDb).toBe(3);
    });
});
