import { describe, expect, it, vi } from 'vitest';

import { desktopInvoke } from '#/utils/desktopBridge';

import { loadCachedWhisperModel } from '../loadCachedWhisperModel';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn().mockResolvedValue(undefined),
}));

describe('loadCachedWhisperModel', () => {
    it('invokes the cache-only native command', async () => {
        await loadCachedWhisperModel();

        expect(desktopInvoke).toHaveBeenCalledWith('load_cached_whisper_model');
        expect(desktopInvoke).not.toHaveBeenCalledWith('ensure_whisper_ready');
    });
});
