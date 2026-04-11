import { describe, it, expect, beforeEach, vi } from 'vitest';
import { type ClipGainEnvelope, gainEnvelopeStore } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { toggleClipGainEnvelope } from '../toggleClipGainEnvelope';
import { getClipGainEnvelope } from '../getClipGainEnvelope';

vi.mock('../getClipGainEnvelope', () => ({
    getClipGainEnvelope: vi.fn(),
}));

describe('toggleClipGainEnvelope', () => {
    beforeEach(() => {
        gainEnvelopeStore.clear();
        vi.clearAllMocks();
    });

    it('flips enabled and persists on the store', () => {
        const env: ClipGainEnvelope = {
            clipId: 'c1',
            enabled: true,
            points: [{ id: 'p', beatOffset: 0, gainDb: 0 }],
        };
        vi.mocked(getClipGainEnvelope).mockReturnValue(env);

        expect(toggleClipGainEnvelope('c1')).toBe(false);
        expect(gainEnvelopeStore.get('c1')!.enabled).toBe(false);
    });
});
