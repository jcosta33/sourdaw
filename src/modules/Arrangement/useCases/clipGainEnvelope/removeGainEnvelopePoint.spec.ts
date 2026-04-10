import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ClipGainEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { removeGainEnvelopePoint } from './removeGainEnvelopePoint';

describe('removeGainEnvelopePoint', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('removes a point and keeps at least one anchor', () => {
        const store = new Map<string, ClipGainEnvelope>();
        store.set('c1', {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'only', beatOffset: 0, gainDb: 0 }],
        });
        injectDependencies(removeGainEnvelopePoint, { gainEnvelopeStore: store });

        removeGainEnvelopePoint('c1', 'only');

        expect(store.get('c1')!.points).toHaveLength(1);
        expect(store.get('c1')!.points[0]!.id).not.toBe('only');
    });
});
