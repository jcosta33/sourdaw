import { describe, it, expect, beforeEach } from 'vitest';
import {
    __resetGainEnvelopesForTest,
    gainEnvelopeStore,
} from '../../../stores/gainEnvelopeStore';
import { getClipGainEnvelope } from '../getClipGainEnvelope';

describe('getClipGainEnvelope', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
    });

    it('creates and caches an envelope when missing', () => {
        const first = getClipGainEnvelope('clip-a');
        const second = getClipGainEnvelope('clip-a');

        expect(first.clipId).toBe('clip-a');
        expect(second).toEqual(first);
        expect(Object.keys(gainEnvelopeStore.value?.envelopes ?? {})).toHaveLength(1);
    });
});
