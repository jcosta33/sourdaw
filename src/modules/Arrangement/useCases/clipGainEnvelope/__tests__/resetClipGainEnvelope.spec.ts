import { describe, it, expect, beforeEach } from 'vitest';
import { type ClipGainEnvelope, gainEnvelopeStore } from '../../../stores/gainEnvelopeStore';
import { resetClipGainEnvelope } from '../resetClipGainEnvelope';

describe('resetClipGainEnvelope', () => {
    beforeEach(() => {
        gainEnvelopeStore.clear();
    });

    it('writes a default envelope to the injected store', () => {
        resetClipGainEnvelope('c1');

        expect(gainEnvelopeStore.get('c1')?.enabled).toBe(true);
        expect(gainEnvelopeStore.get('c1')?.points).toHaveLength(1);
    });
});
