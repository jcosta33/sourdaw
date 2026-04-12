import { describe, it, expect, beforeEach } from 'vitest';
import { type ClipGainEnvelope, gainEnvelopeStore } from '../../../stores/gainEnvelopeStore';
import { getAllClipGainEnvelopes } from '../getAllClipGainEnvelopes';

describe('getAllClipGainEnvelopes', () => {
    beforeEach(() => {
        gainEnvelopeStore.clear();
    });

    it('returns the injected map reference', () => {
        expect(getAllClipGainEnvelopes()).toBe(gainEnvelopeStore);
    });
});
