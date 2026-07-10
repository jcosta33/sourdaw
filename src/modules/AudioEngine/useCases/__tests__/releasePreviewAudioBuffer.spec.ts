import { beforeEach, describe, expect, it, vi } from 'vitest';

import { releasePreviewAudioBuffer } from '../releasePreviewAudioBuffer';

const mocks = vi.hoisted(() => ({
    audioBufferCacheRemove: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        remove: mocks.audioBufferCacheRemove,
    },
}));

describe('releasePreviewAudioBuffer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should release the cached preview buffer by id', () => {
        releasePreviewAudioBuffer('preview-buffer');

        expect(mocks.audioBufferCacheRemove).toHaveBeenCalledWith('preview-buffer');
    });
});
