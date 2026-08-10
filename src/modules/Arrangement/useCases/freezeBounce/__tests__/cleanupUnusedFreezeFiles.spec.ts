import { describe, it, expect, vi, beforeEach } from 'vitest';

import { arrangementStore, projectLoadFailureStore, projectStore } from '#/modules/Project/stores';

import { trackStore } from '../../../stores/trackStore';
import { cleanupUnusedFreezeFiles } from '../cleanupUnusedFreezeFiles';

import type { Track } from '../../../models/Track';

type SavedTrack = NonNullable<typeof arrangementStore.value>['arrangements'][number]['tracks']['tracks'][number];

function frozenTrack(id: string, frozenBufferId: string) {
    return { id, freezeState: { status: 'frozen' as const, frozenBufferId } };
}

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
        arrangementStore.set({ arrangements: [], activeArrangementId: 'active-arrangement' });
        projectLoadFailureStore.set(null);
        const project = projectStore.value;
        if (!project) {
            throw new Error('Expected project fixture');
        }
        projectStore.set({ ...project, createdAt: 200 });
    });

    it('should do nothing if store state is missing', async () => {
        trackStore.set(null);
        await cleanupUnusedFreezeFiles();
        expect(mocks.garbageCollectFreezeAudioBuffers).not.toHaveBeenCalled();
        expect(mocks.garbageCollectCachedAudioBuffersByAge).not.toHaveBeenCalled();
        expect(mocks.garbageCollectCachedAudioBuffersBySize).not.toHaveBeenCalled();
    });

    /**
     * An empty track list is truthy, so it sails past the `!state` guard and
     * every frozen buffer reads as unreferenced. After a load replaced the CRDT
     * authority and then failed, that is exactly what the store holds — and the
     * failure surface's Reload button fires `beforeunload`, which calls this.
     * One click would have deleted every frozen render of the project the
     * dialog says was not modified.
     */
    it('collects nothing while the track store is not the open project', async () => {
        projectLoadFailureStore.set({ message: 'session gone', projectName: 'Half Finished Song' });
        trackStore.set({ tracks: [], selectedTrackId: null });

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
            projectId: 200,
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

    it('retains freezes referenced by inactive saved arrangements after a switch', async () => {
        trackStore.set({
            tracks: [frozenTrack('active-track', 'active-freeze')] as Track[],
            selectedTrackId: null,
        });
        arrangementStore.set({
            arrangements: [
                {
                    id: 'inactive-arrangement',
                    name: 'Inactive arrangement',
                    tracks: {
                        tracks: [frozenTrack('inactive-track', 'inactive-freeze')] as unknown as SavedTrack[],
                        selectedTrackId: null,
                    },
                    automation: { lanes: [] },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
            ],
            activeArrangementId: 'active-arrangement',
        });
        await cleanupUnusedFreezeFiles();
        expect(mocks.garbageCollectFreezeAudioBuffers).toHaveBeenCalledWith({
            activeBufferIds: new Set(['active-freeze', 'inactive-freeze']),
            projectId: 200,
        });
    });
});
