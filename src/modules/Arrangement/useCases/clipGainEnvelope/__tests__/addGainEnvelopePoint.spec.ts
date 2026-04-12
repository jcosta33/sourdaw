import { describe, it, expect, beforeEach, vi } from 'vitest';
import { type ClipGainEnvelope, gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { addGainEnvelopePoint } from '../addGainEnvelopePoint';
import { getClipGainEnvelope } from '../getClipGainEnvelope';

vi.mock('../getClipGainEnvelope', () => ({
    getClipGainEnvelope: vi.fn(),
}));

describe('addGainEnvelopePoint', () => {
    beforeEach(() => {
        gainEnvelopeStore.clear();
        vi.clearAllMocks();
    });

    it('inserts a point in beat order', () => {
        const env: ClipGainEnvelope = {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'p0', beatOffset: 0, gainDb: 0 }],
        };
        vi.mocked(getClipGainEnvelope).mockReturnValue(env);

        addGainEnvelopePoint('c1', 0.5, -6);

        expect(env.points.map((p) => p.beatOffset)).toEqual([0, 0.5]);
        expect(gainEnvelopeStore.get('c1')).toBe(env);
    });
});
