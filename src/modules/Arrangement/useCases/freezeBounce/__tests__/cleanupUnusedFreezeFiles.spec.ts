import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackStore } from '../../../stores/trackStore';
import { cleanupUnusedFreezeFiles } from '../cleanupUnusedFreezeFiles';
import { audioBufferCache } from '#/modules/AudioEngine/stores';

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        garbageCollectFreezeFiles: vi.fn().mockResolvedValue(undefined),
        garbageCollectByAge: vi.fn().mockResolvedValue(undefined),
        garbageCollectBySize: vi.fn().mockResolvedValue(undefined),
    },
}));

describe('cleanupUnusedFreezeFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('does nothing if store state is missing', async () => {
        trackStore.set(null as any);
        await cleanupUnusedFreezeFiles();
        expect(audioBufferCache.garbageCollectFreezeFiles).not.toHaveBeenCalled();
    });

    it('collects active frozen buffer IDs and calls garbageCollectFreezeFiles', async () => {
        trackStore.set({
            tracks: [
                { id: 't1', freezeState: { frozenBufferId: 'buf-1' } },
                { id: 't2', freezeState: { frozenBufferId: 'buf-2' } },
                { id: 't3', freezeState: {} },
                { id: 't4' },
            ] as any,
            selectedTrackId: null,
        });

        await cleanupUnusedFreezeFiles();

        expect(audioBufferCache.garbageCollectFreezeFiles).toHaveBeenCalledWith(
            new Set(['buf-1', 'buf-2'])
        );
    });
});
