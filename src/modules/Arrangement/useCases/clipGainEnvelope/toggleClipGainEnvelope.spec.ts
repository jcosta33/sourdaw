import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ClipGainEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { toggleClipGainEnvelope } from './toggleClipGainEnvelope';

describe('toggleClipGainEnvelope', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('flips enabled and persists on the store', () => {
        const store = new Map<string, ClipGainEnvelope>();
        const env: ClipGainEnvelope = {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'p', beatOffset: 0, gainDb: 0 }],
        };
        injectDependencies(toggleClipGainEnvelope, {
            getClipGainEnvelope: () => env,
            gainEnvelopeStore: store,
        });

        expect(toggleClipGainEnvelope('c1')).toBe(false);
        expect(store.get('c1')!.enabled).toBe(false);
    });
});
