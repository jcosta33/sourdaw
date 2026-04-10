import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ClipGainEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { addGainEnvelopePoint } from './addGainEnvelopePoint';

describe('addGainEnvelopePoint', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('inserts a point in beat order', () => {
        const store = new Map<string, ClipGainEnvelope>();
        const env: ClipGainEnvelope = {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'p0', beatOffset: 0, gainDb: 0 }],
        };
        injectDependencies(addGainEnvelopePoint, {
            getClipGainEnvelope: () => env,
            gainEnvelopeStore: store,
        });

        addGainEnvelopePoint('c1', 0.5, -6);

        expect(env.points.map((p) => p.beatOffset)).toEqual([0, 0.5]);
        expect(store.get('c1')).toBe(env);
    });
});
