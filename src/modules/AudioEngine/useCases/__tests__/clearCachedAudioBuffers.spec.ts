import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCachedAudioBuffers } from '../clearCachedAudioBuffers';
import { clearRuntimeCachedAudioBuffers } from '../clearRuntimeCachedAudioBuffers';

const mocks = vi.hoisted(() => ({
    audioBufferCacheClear: vi.fn(),
    clearRuntimeAudioBufferCache: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    clearRuntimeAudioBufferCache: mocks.clearRuntimeAudioBufferCache,
    audioBufferCache: {
        clear: mocks.audioBufferCacheClear,
    },
}));

describe('clearCachedAudioBuffers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should clear the AudioEngine-owned audio buffer cache', () => {
        clearCachedAudioBuffers();

        expect(mocks.audioBufferCacheClear).toHaveBeenCalledTimes(1);
    });

    it('clears only the runtime cache for project transitions', () => {
        clearRuntimeCachedAudioBuffers();

        expect(mocks.clearRuntimeAudioBufferCache).toHaveBeenCalledTimes(1);
        expect(mocks.audioBufferCacheClear).not.toHaveBeenCalled();
    });
});
