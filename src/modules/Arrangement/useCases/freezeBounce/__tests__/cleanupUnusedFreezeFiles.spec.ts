import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioBufferCache } from '#/modules/AudioEngine/stores';

import { trackStore } from '../../../stores/trackStore';
import { cleanupUnusedFreezeFiles } from '../cleanupUnusedFreezeFiles';

import type { Track } from '../../../models/Track';
import type { TrackStoreState } from '../../../stores/trackStore';

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        garbageCollectFreezeFiles: vi.fn<() => Promise<void>>().mockResolvedValue(),
        garbageCollectByAge: vi.fn<() => Promise<void>>().mockResolvedValue(),
        garbageCollectBySize: vi.fn<() => Promise<void>>().mockResolvedValue(),
    },
}));

describe('cleanupUnusedFreezeFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('does nothing if store state is missing', async () => {
        trackStore.set(null as unknown as TrackStoreState);
        await cleanupUnusedFreezeFiles();
        expect(audioBufferCache.garbageCollectFreezeFiles).not.toHaveBeenCalled();
    });

    it('collects active frozen buffer IDs and calls garbageCollectFreezeFiles', async () => {
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

        expect(audioBufferCache.garbageCollectFreezeFiles).toHaveBeenCalledWith(new Set(['buf-1', 'buf-2']));
    });
});
