import { describe, it, expect, vi } from 'vitest';
import { ensureWhisperReady } from '../ensureWhisperReady';
import { tauriInvoke } from '#/utils/tauriBridge';

vi.mock('#/utils/tauriBridge', () => ({
    tauriInvoke: vi.fn().mockResolvedValue(undefined),
}));

describe('ensureWhisperReady (voiceTauriAdapter)', () => {
    it('invokes ensure_whisper_ready command', async () => {
        await ensureWhisperReady();
        expect(tauriInvoke).toHaveBeenCalledWith('ensure_whisper_ready');
    });
});
