import { describe, it, expect, beforeEach } from 'vitest';
import { type ClipGainEnvelope, gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { getClipGainEnvelope } from '../getClipGainEnvelope';

describe('getClipGainEnvelope', () => {
    beforeEach(() => {
        gainEnvelopeStore.clear();
    });

    it('creates and caches an envelope when missing', () => {
        const first = getClipGainEnvelope('clip-a');
        const second = getClipGainEnvelope('clip-a');

        expect(first.clipId).toBe('clip-a');
        expect(second).toBe(first);
        expect(gainEnvelopeStore.size).toBe(1);
    });
});
