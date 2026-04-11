import { describe, it, expect, beforeEach } from 'vitest';
import { type ClipGainEnvelope, gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { getGainAtBeat } from '../getGainAtBeat';

describe('getGainAtBeat', () => {
    beforeEach(() => {
        gainEnvelopeStore.clear();
    });

    it('interpolates between envelope points', () => {
        gainEnvelopeStore.set('c1', {
            clipId: 'c1',
            enabled: true,
            points: [
                { id: 'a', beatOffset: 0, gainDb: 0 },
                { id: 'b', beatOffset: 1, gainDb: 12 },
            ],
        });

        expect(getGainAtBeat('c1', 0.5)).toBe(6);
    });
});
