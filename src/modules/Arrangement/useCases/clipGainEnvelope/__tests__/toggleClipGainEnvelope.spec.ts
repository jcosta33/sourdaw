import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    type ClipGainEnvelope,
    __resetGainEnvelopesForTest,
    getEnvelope,
} from '#/modules/Arrangement/stores/gainEnvelopeStore';

import { getClipGainEnvelope } from '../getClipGainEnvelope';
import { toggleClipGainEnvelope } from '../toggleClipGainEnvelope';

vi.mock('../getClipGainEnvelope', () => ({
    getClipGainEnvelope: vi.fn(),
}));

describe('toggleClipGainEnvelope', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
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
        expect(getEnvelope('c1')!.enabled).toBe(false);
    });
});
