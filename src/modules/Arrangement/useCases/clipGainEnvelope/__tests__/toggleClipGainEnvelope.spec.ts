import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    type ClipGainEnvelope,
    __resetGainEnvelopesForTest,
    getEnvelope,
} from '#/modules/Arrangement/stores/gainEnvelopeStore';

import { ensureClipGainEnvelope } from '../ensureClipGainEnvelope';
import { toggleClipGainEnvelope } from '../toggleClipGainEnvelope';

vi.mock('../ensureClipGainEnvelope', () => ({
    ensureClipGainEnvelope: vi.fn(),
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
        vi.mocked(ensureClipGainEnvelope).mockReturnValue(env);

        expect(toggleClipGainEnvelope('c1')).toBe(false);
        expect(getEnvelope('c1')!.enabled).toBe(false);
    });
});
