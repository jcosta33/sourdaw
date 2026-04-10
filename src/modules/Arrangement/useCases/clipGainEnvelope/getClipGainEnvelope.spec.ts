import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ClipGainEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { getClipGainEnvelope } from './getClipGainEnvelope';

describe('getClipGainEnvelope', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('creates and caches an envelope when missing', () => {
        const store = new Map<string, ClipGainEnvelope>();
        injectDependencies(getClipGainEnvelope, { gainEnvelopeStore: store });

        const first = getClipGainEnvelope('clip-a');
        const second = getClipGainEnvelope('clip-a');

        expect(first.clipId).toBe('clip-a');
        expect(second).toBe(first);
        expect(store.size).toBe(1);
    });
});
