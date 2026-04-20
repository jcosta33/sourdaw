import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type ClipGainEnvelope, __resetGainEnvelopesForTest, getEnvelope } from '../../../stores/gainEnvelopeStore';
import { addGainEnvelopePoint } from '../addGainEnvelopePoint';
import { ensureClipGainEnvelope } from '../getClipGainEnvelope';

vi.mock('../getClipGainEnvelope', () => ({
    ensureClipGainEnvelope: vi.fn(),
}));

describe('addGainEnvelopePoint', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
        vi.clearAllMocks();
    });

    it('inserts a point in beat order', () => {
        const env: ClipGainEnvelope = {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'p0', beatOffset: 0, gainDb: 0 }],
        };
        vi.mocked(ensureClipGainEnvelope).mockReturnValue(env);

        addGainEnvelopePoint('c1', 0.5, -6);

        const stored = getEnvelope('c1');
        expect(stored?.points.map((p) => p.beatOffset)).toEqual([0, 0.5]);
    });
});
