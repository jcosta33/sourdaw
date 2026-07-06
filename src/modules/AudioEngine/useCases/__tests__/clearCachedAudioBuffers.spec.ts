import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCachedAudioBuffers } from '../clearCachedAudioBuffers';

const mocks = vi.hoisted(() => ({
    audioBufferCacheClear: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
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
});
