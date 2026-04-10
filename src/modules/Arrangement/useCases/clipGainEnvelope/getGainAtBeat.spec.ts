import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ClipGainEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { getGainAtBeat } from './getGainAtBeat';

describe('getGainAtBeat', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('interpolates between envelope points', () => {
        const store = new Map<string, ClipGainEnvelope>();
        store.set('c1', {
            clipId: 'c1',
            enabled: true,
            points: [
                { id: 'a', beatOffset: 0, gainDb: 0 },
                { id: 'b', beatOffset: 1, gainDb: 12 },
            ],
        });
        injectDependencies(getGainAtBeat, { gainEnvelopeStore: store });

        expect(getGainAtBeat('c1', 0.5)).toBe(6);
    });
});
