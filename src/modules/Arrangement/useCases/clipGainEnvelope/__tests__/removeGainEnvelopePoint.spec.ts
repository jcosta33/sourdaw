import { describe, it, expect, beforeEach } from 'vitest';

import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';

import { removeGainEnvelopePoint } from '../removeGainEnvelopePoint';

describe('removeGainEnvelopePoint', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
    });

    it('removes a point and keeps at least one anchor', () => {
        setEnvelope('c1', {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'only', beatOffset: 0, gainDb: 0 }],
        });

        removeGainEnvelopePoint('c1', 'only');

        expect(getEnvelope('c1')!.points).toHaveLength(1);
        expect(getEnvelope('c1')!.points[0]!.id).not.toBe('only');
    });
});
