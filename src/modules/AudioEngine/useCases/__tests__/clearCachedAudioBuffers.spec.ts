import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCachedAudioBuffers } from '../clearCachedAudioBuffers';
import { clearRuntimeCachedAudioBuffers } from '../clearRuntimeCachedAudioBuffers';

const mocks = vi.hoisted(() => ({
    audioBufferCacheClear: vi.fn(),
    audioBufferCacheClearRuntime: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        clear: mocks.audioBufferCacheClear,
        clearRuntime: mocks.audioBufferCacheClearRuntime,
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

        expect(mocks.audioBufferCacheClearRuntime).toHaveBeenCalledTimes(1);
        expect(mocks.audioBufferCacheClear).not.toHaveBeenCalled();
    });
});
