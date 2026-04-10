import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ClipGainEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { resetClipGainEnvelope } from './resetClipGainEnvelope';

describe('resetClipGainEnvelope', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('writes a default envelope to the injected store', () => {
        const store = new Map<string, ClipGainEnvelope>();
        injectDependencies(resetClipGainEnvelope, { gainEnvelopeStore: store });

        resetClipGainEnvelope('c1');

        expect(store.get('c1')?.enabled).toBe(true);
        expect(store.get('c1')?.points).toHaveLength(1);
    });
});
