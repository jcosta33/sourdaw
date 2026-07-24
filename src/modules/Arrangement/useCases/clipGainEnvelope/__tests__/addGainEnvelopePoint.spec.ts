import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type ClipGainEnvelope, __resetGainEnvelopesForTest, getEnvelope } from '../../../stores/gainEnvelopeStore';
import { addGainEnvelopePoint } from '../addGainEnvelopePoint';
import { ensureClipGainEnvelope } from '../ensureClipGainEnvelope';

vi.mock('../ensureClipGainEnvelope', () => ({
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
        expect(stored?.points.map((param) => param.beatOffset)).toEqual([0, 0.5]);
    });

    it('appends a point when its beat offset is past every existing point', () => {
        const env: ClipGainEnvelope = {
            clipId: 'c1',
            enabled: true,
            points: [
                { id: 'p0', beatOffset: 0, gainDb: 0 },
                { id: 'p1', beatOffset: 4, gainDb: -3 },
            ],
        };
        vi.mocked(ensureClipGainEnvelope).mockReturnValue(env);

        addGainEnvelopePoint('c1', 8, 0);

        const stored = getEnvelope('c1');
        // no existing point has beatOffset > 8, so findIndex returns -1 → append
        expect(stored?.points.map((param) => param.beatOffset)).toEqual([0, 4, 8]);
        expect(stored?.points[2]?.id).not.toBe('p0');
    });

    it('clamps the gain to the [-60, 12] dB range and the beat offset to non-negative', () => {
        const env: ClipGainEnvelope = {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'p0', beatOffset: 0, gainDb: 0 }],
        };
        vi.mocked(ensureClipGainEnvelope).mockReturnValue(env);

        addGainEnvelopePoint('c1', -5, 99);

        const stored = getEnvelope('c1');
        const added = stored?.points.find((param) => param.beatOffset === 0 && param.gainDb === 12);
        expect(added).toBeDefined();
    });
});
