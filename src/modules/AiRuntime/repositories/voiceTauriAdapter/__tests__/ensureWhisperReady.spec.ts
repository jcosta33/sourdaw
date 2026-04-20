import { describe, it, expect, vi } from 'vitest';

import { tauriInvoke } from '#/utils/tauriBridge';

import { ensureWhisperReady } from '../ensureWhisperReady';

vi.mock('#/utils/tauriBridge', () => ({
    tauriInvoke: vi.fn().mockResolvedValue(undefined),
}));

describe('ensureWhisperReady (voiceTauriAdapter)', () => {
    it('invokes ensure_whisper_ready command', async () => {
        await ensureWhisperReady();
        expect(tauriInvoke).toHaveBeenCalledWith('ensure_whisper_ready');
    });
});
