import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ClipGainEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { getAllClipGainEnvelopes } from './getAllClipGainEnvelopes';

describe('getAllClipGainEnvelopes', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns the injected map reference', () => {
        const store = new Map<string, ClipGainEnvelope>();
        injectDependencies(getAllClipGainEnvelopes, { gainEnvelopeStore: store });

        expect(getAllClipGainEnvelopes()).toBe(store);
    });
});
