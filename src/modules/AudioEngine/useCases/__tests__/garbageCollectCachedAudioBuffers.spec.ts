import { beforeEach, describe, expect, it, vi } from 'vitest';

import { garbageCollectCachedAudioBuffersByAge } from '../garbageCollectCachedAudioBuffersByAge';
import { garbageCollectCachedAudioBuffersBySize } from '../garbageCollectCachedAudioBuffersBySize';
import { garbageCollectFreezeAudioBuffers } from '../garbageCollectFreezeAudioBuffers';

const mocks = vi.hoisted(() => ({
    audioBufferCacheGarbageCollectFreezeFiles: vi
        .fn<(input: { activeIds: Set<string>; projectId: number }) => Promise<void>>()
        .mockResolvedValue(),
    audioBufferCacheGarbageCollectByAge: vi.fn<(maxAgeDays: number) => Promise<number>>().mockResolvedValue(0),
    audioBufferCacheGarbageCollectBySize: vi.fn<(maxSizeBytes: number) => Promise<number>>().mockResolvedValue(0),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        garbageCollectFreezeFiles: mocks.audioBufferCacheGarbageCollectFreezeFiles,
        garbageCollectByAge: mocks.audioBufferCacheGarbageCollectByAge,
        garbageCollectBySize: mocks.audioBufferCacheGarbageCollectBySize,
    },
}));

describe('garbage collect cached audio buffers use cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate freeze garbage collection to the private audio buffer cache', async () => {
        const activeBufferIds = new Set(['freeze-track-1', 'freeze-track-2']);

        await garbageCollectFreezeAudioBuffers({ activeBufferIds, projectId: 200 });

        expect(mocks.audioBufferCacheGarbageCollectFreezeFiles).toHaveBeenCalledWith({
            activeIds: activeBufferIds,
            projectId: 200,
        });
    });

    it('should delegate age garbage collection to the private audio buffer cache', async () => {
        mocks.audioBufferCacheGarbageCollectByAge.mockResolvedValueOnce(3);

        const deletedCount = await garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });

        expect(deletedCount).toBe(3);
        expect(mocks.audioBufferCacheGarbageCollectByAge).toHaveBeenCalledWith(30);
    });

    it('should delegate size garbage collection to the private audio buffer cache', async () => {
        mocks.audioBufferCacheGarbageCollectBySize.mockResolvedValueOnce(4);

        const deletedCount = await garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 2 * 1024 * 1024 * 1024 });

        expect(deletedCount).toBe(4);
        expect(mocks.audioBufferCacheGarbageCollectBySize).toHaveBeenCalledWith(2 * 1024 * 1024 * 1024);
    });
});
