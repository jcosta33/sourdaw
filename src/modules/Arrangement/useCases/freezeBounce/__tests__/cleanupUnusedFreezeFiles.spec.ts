import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '../../../stores/trackStore';
import { cleanupUnusedFreezeFiles } from '../cleanupUnusedFreezeFiles';

import type { Track } from '../../../models/Track';
import type { TrackStoreState } from '../../../stores/trackStore';

const mocks = vi.hoisted(() => ({
    garbageCollectFreezeAudioBuffers: vi.fn<() => Promise<void>>().mockResolvedValue(),
    garbageCollectCachedAudioBuffersByAge: vi.fn<() => Promise<number>>().mockResolvedValue(0),
    garbageCollectCachedAudioBuffersBySize: vi.fn<() => Promise<number>>().mockResolvedValue(0),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    garbageCollectFreezeAudioBuffers: mocks.garbageCollectFreezeAudioBuffers,
    garbageCollectCachedAudioBuffersByAge: mocks.garbageCollectCachedAudioBuffersByAge,
    garbageCollectCachedAudioBuffersBySize: mocks.garbageCollectCachedAudioBuffersBySize,
}));

describe('cleanupUnusedFreezeFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should do nothing if store state is missing', async () => {
        trackStore.set(null as unknown as TrackStoreState);
        await cleanupUnusedFreezeFiles();
        expect(mocks.garbageCollectFreezeAudioBuffers).not.toHaveBeenCalled();
        expect(mocks.garbageCollectCachedAudioBuffersByAge).not.toHaveBeenCalled();
        expect(mocks.garbageCollectCachedAudioBuffersBySize).not.toHaveBeenCalled();
    });

    it('should collect active frozen buffer IDs and request cache garbage collection', async () => {
        trackStore.set({
            tracks: [
                { id: 't1', freezeState: { status: 'frozen', frozenBufferId: 'buf-1' } },
                { id: 't2', freezeState: { status: 'frozen', frozenBufferId: 'buf-2' } },
                { id: 't3', freezeState: { status: 'unfrozen' } },
                { id: 't4', freezeState: { status: 'unfrozen' } },
            ] as unknown as Track[],
            selectedTrackId: null,
        });

        await cleanupUnusedFreezeFiles();

        expect(mocks.garbageCollectFreezeAudioBuffers).toHaveBeenCalledWith({
            activeBufferIds: new Set(['buf-1', 'buf-2']),
        });
        expect(mocks.garbageCollectCachedAudioBuffersByAge).toHaveBeenCalledWith({ maxAgeDays: 30 });
        expect(mocks.garbageCollectCachedAudioBuffersBySize).toHaveBeenCalledWith({
            maxSizeBytes: 2 * 1024 * 1024 * 1024,
        });
        expect(mocks.garbageCollectFreezeAudioBuffers.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.garbageCollectCachedAudioBuffersByAge.mock.invocationCallOrder[0]!
        );
        expect(mocks.garbageCollectCachedAudioBuffersByAge.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.garbageCollectCachedAudioBuffersBySize.mock.invocationCallOrder[0]!
        );
    });
});
