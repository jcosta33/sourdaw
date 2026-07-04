import { describe, it, expect, beforeEach } from 'vitest';

import { __resetGainEnvelopesForTest, gainEnvelopeStore } from '../../../stores/gainEnvelopeStore';
import { ensureClipGainEnvelope } from '../ensureClipGainEnvelope';
import { getClipGainEnvelope } from '../getClipGainEnvelope';

describe('getClipGainEnvelope', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
    });

    it('returns a default envelope without caching when missing', () => {
        const first = getClipGainEnvelope('clip-a');

        expect(first.clipId).toBe('clip-a');
        expect(Object.keys(gainEnvelopeStore.value?.envelopes ?? {})).toHaveLength(0);
    });

    it('creates and caches an envelope when using ensureClipGainEnvelope', () => {
        const first = ensureClipGainEnvelope('clip-a');
        const second = ensureClipGainEnvelope('clip-a');

        expect(first.clipId).toBe('clip-a');
        expect(second).toEqual(first);
        expect(Object.keys(gainEnvelopeStore.value?.envelopes ?? {})).toHaveLength(1);
    });
});
