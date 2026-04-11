import { describe, it, expect, beforeEach } from 'vitest';
import { type ClipGainEnvelope, gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { removeGainEnvelopePoint } from '../removeGainEnvelopePoint';

describe('removeGainEnvelopePoint', () => {
    beforeEach(() => {
        gainEnvelopeStore.clear();
    });

    it('removes a point and keeps at least one anchor', () => {
        gainEnvelopeStore.set('c1', {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'only', beatOffset: 0, gainDb: 0 }],
        });

        removeGainEnvelopePoint('c1', 'only');

        expect(gainEnvelopeStore.get('c1')!.points).toHaveLength(1);
        expect(gainEnvelopeStore.get('c1')!.points[0]!.id).not.toBe('only');
    });
});
