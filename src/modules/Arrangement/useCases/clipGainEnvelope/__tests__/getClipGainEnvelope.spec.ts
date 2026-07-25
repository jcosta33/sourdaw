import { describe, it, expect, beforeEach } from 'vitest';

import { __resetGainEnvelopesForTest, gainEnvelopeStore, setEnvelope } from '../../../stores/gainEnvelopeStore';
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

    it('returns the cached envelope directly when one exists', () => {
        // Seed a real envelope with a recognizable point, then read it back.
        setEnvelope('clip-a', {
            clipId: 'clip-a',
            enabled: false,
            points: [
                { id: 'anchor', beatOffset: 2, gainDb: -3 },
                { id: 'end', beatOffset: 8, gainDb: 0 },
            ],
        });

        const result = getClipGainEnvelope('clip-a');

        // must return the stored envelope (not the synthesized default) with its real points
        expect(result.enabled).toBe(false);
        expect(result.points).toEqual([
            { id: 'anchor', beatOffset: 2, gainDb: -3 },
            { id: 'end', beatOffset: 8, gainDb: 0 },
        ]);
    });
});
