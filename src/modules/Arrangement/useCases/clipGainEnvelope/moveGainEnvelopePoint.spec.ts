import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ClipGainEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { moveGainEnvelopePoint } from './moveGainEnvelopePoint';

describe('moveGainEnvelopePoint', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('updates the point and re-sorts by beat', () => {
        const store = new Map<string, ClipGainEnvelope>();
        store.set('c1', {
            clipId: 'c1',
            enabled: true,
            points: [
                { id: 'p1', beatOffset: 0, gainDb: 0 },
                { id: 'p2', beatOffset: 2, gainDb: 0 },
            ],
        });
        injectDependencies(moveGainEnvelopePoint, { gainEnvelopeStore: store });

        moveGainEnvelopePoint('c1', 'p2', 0.5, 3);

        const pts = store.get('c1')!.points;
        expect(pts.map((p) => p.id)).toEqual(['p1', 'p2']);
        expect(pts[1]!.beatOffset).toBe(0.5);
        expect(pts[1]!.gainDb).toBe(3);
    });
});
