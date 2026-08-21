import { describe, expect, it, vi } from 'vitest';

import { loadCachedWhisperModel as loadCachedNativeWhisperModel } from '../../../repositories/voiceNativeAdapter/loadCachedWhisperModel';
import { loadCachedWhisperModel } from '../loadCachedWhisperModel';

vi.mock('../../../repositories/voiceNativeAdapter/loadCachedWhisperModel', () => ({
    loadCachedWhisperModel: vi.fn().mockResolvedValue(undefined),
}));

describe('loadCachedWhisperModel', () => {
    it('delegates only to the cache-only native adapter', async () => {
        await loadCachedWhisperModel();

        expect(loadCachedNativeWhisperModel).toHaveBeenCalledOnce();
    });
});
