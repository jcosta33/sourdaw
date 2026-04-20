import { describe, it, expect, beforeEach } from 'vitest';

import { __resetGainEnvelopesForTest, setEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';

import { getAllClipGainEnvelopes } from '../getAllClipGainEnvelopes';

describe('getAllClipGainEnvelopes', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
    });

    it('returns all envelopes currently in the store', () => {
        expect(getAllClipGainEnvelopes()).toEqual([]);

        const env = {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'p', beatOffset: 0, gainDb: 0 }],
        };
        setEnvelope('c1', env);

        const all = getAllClipGainEnvelopes();
        expect(all).toHaveLength(1);
        expect(all[0]).toEqual(env);
    });
});
