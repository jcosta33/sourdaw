import { describe, it, expect, vi } from 'vitest';

import { desktopInvoke } from '#/utils/desktopBridge';

import { ensureWhisperReady } from '../ensureWhisperReady';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn().mockResolvedValue(undefined),
}));

describe('ensureWhisperReady (voiceNativeAdapter)', () => {
    it('invokes ensure_whisper_ready command', async () => {
        await ensureWhisperReady();
        expect(desktopInvoke).toHaveBeenCalledWith('ensure_whisper_ready');
    });
});
