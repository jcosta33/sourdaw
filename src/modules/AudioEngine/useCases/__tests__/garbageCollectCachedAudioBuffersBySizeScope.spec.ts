import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import {
    BUFFER_STORE,
    CHECKPOINT_AUDIO_VERSION_META_STORE,
    CHECKPOINT_AUDIO_VERSION_STORE,
    CHECKPOINT_RETENTION_STORE,
    META_STORE,
    RECOVERY_STORE,
    installFakeAudioIndexedDb,
    type FakeAudioIndexedDbControls,
} from '../../stores/__tests__/fakeAudioBufferIndexedDb';
import { installTestAudioBufferConstructor } from '../../stores/__tests__/preparedAudioBufferTestSupport';

import type { ProjectAudioStorageLockScope } from '#/infra/storage/withProjectAudioStorageLock';

let withProjectAudioStorageLock: typeof import('#/infra/storage/withProjectAudioStorageLock').withProjectAudioStorageLock;
let durableOwnershipProvider: ReturnType<typeof vi.fn<() => Promise<readonly string[]>>>;
let garbageCollectCachedAudioBuffersBySize: typeof import('../garbageCollectCachedAudioBuffersBySize').garbageCollectCachedAudioBuffersBySize;
let garbageCollectAudioBufferCacheBySize: typeof import('../../stores/audioBufferCache').garbageCollectAudioBufferCacheBySize;
let setDurableAudioBufferOwnershipProvider: typeof import('../../stores/durableAudioBufferOwnership').setDurableAudioBufferOwnershipProvider;
let lockManager: ReturnType<typeof createControlledLockManager>;
let controls: FakeAudioIndexedDbControls;

beforeEach(async () => {
    vi.resetModules();
    lockManager = createControlledLockManager();
    vi.stubGlobal('navigator', { ...navigator, locks: lockManager.locks });
    installTestAudioBufferConstructor();
    controls = installFakeAudioIndexedDb({
        existingStores: [
            BUFFER_STORE,
            META_STORE,
            RECOVERY_STORE,
            CHECKPOINT_RETENTION_STORE,
            CHECKPOINT_AUDIO_VERSION_STORE,
            CHECKPOINT_AUDIO_VERSION_META_STORE,
        ],
    });
    [
        { withProjectAudioStorageLock },
        { garbageCollectCachedAudioBuffersBySize },
        { garbageCollectAudioBufferCacheBySize },
        { setDurableAudioBufferOwnershipProvider },
    ] = await Promise.all([
        import('#/infra/storage/withProjectAudioStorageLock'),
        import('../garbageCollectCachedAudioBuffersBySize'),
        import('../../stores/audioBufferCache'),
        import('../../stores/durableAudioBufferOwnership'),
    ]);
    durableOwnershipProvider = vi.fn(() => Promise.resolve([]));
    setDurableAudioBufferOwnershipProvider(durableOwnershipProvider);
});

afterEach(() => {
    setDurableAudioBufferOwnershipProvider(null);
    vi.unstubAllGlobals();
});

function seedOrdinaryBuffer(): void {
    controls.committed.set('ordinary', {
        sampleRate: 48_000,
        numberOfChannels: 1,
        channelData: [new Float32Array([0.25])],
        lastAccessed: 1,
        sizeInBytes: 4,
    });
    controls.committedMeta.set('ordinary', { lastAccessed: 1, sizeInBytes: 4, persistenceRevision: 'ordinary' });
}

describe('size-based cache collection lock ownership', () => {
    it('keeps a trailing owner excluded until the public collector completes', async () => {
        let collectionEntered!: () => void;
        const collectionEnteredPromise = new Promise<void>((resolve) => {
            collectionEntered = resolve;
        });
        let releaseCollection!: () => void;

        vi.resetModules();
        const lockModule = await import('#/infra/storage/withProjectAudioStorageLock');
        vi.doMock('../../stores/audioBufferCache', () => ({
            openAudioBufferCacheDatabase: async () => {
                throw new Error('The lock-owner probe must not open IndexedDB');
            },
            garbageCollectAudioBufferCacheBySize: (_maxSizeBytes: number, scope: ProjectAudioStorageLockScope) =>
                lockModule.runInProjectAudioStorageLock(scope, async () => {
                    collectionEntered();
                    await new Promise<void>((resolve) => {
                        releaseCollection = resolve;
                    });
                    return 1;
                }),
        }));
        vi.doMock('../../repositories/checkpointAudioRetention', () => ({
            createCheckpointAudioRetentionRepository: () => ({
                collectCensus: async () => ({ immutableBytes: 0, retainedBufferIds: new Set<string>() }),
            }),
        }));
        try {
            const { garbageCollectCachedAudioBuffersBySize: collect } =
                await import('../garbageCollectCachedAudioBuffersBySize');
            const collection = collect({ maxSizeBytes: 0 });
            await collectionEnteredPromise;

            let trailingOwnerEntered = false;
            const trailingOwner = lockModule.withProjectAudioStorageLock(async () => {
                trailingOwnerEntered = true;
            });
            expect(lockManager.requestedNames).toEqual([
                'sourdaw:project-audio-storage',
                'sourdaw:project-audio-storage',
            ]);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(trailingOwnerEntered).toBe(false);

            releaseCollection();
            await expect(collection).resolves.toBe(1);
            await trailingOwner;
            expect(trailingOwnerEntered).toBe(true);
        } finally {
            releaseCollection?.();
            vi.doUnmock('../../stores/audioBufferCache');
            vi.doUnmock('../../repositories/checkpointAudioRetention');
            vi.resetModules();
        }
    });
    it('queues storage work behind the public owner lock and retains it until deletion commits', async () => {
        seedOrdinaryBuffer();
        let releaseHolder: (() => void) | undefined;
        let holderEntered!: () => void;
        const holderEnteredPromise = new Promise<void>((resolve) => {
            holderEntered = resolve;
        });
        const holder = withProjectAudioStorageLock(async () => {
            holderEntered();
            await new Promise<void>((resolve) => {
                releaseHolder = resolve;
            });
        });
        await holderEnteredPromise;

        const collection = garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 0 });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(lockManager.requestedNames).toEqual(['sourdaw:project-audio-storage', 'sourdaw:project-audio-storage']);
        expect(controls.openRequestCount()).toBe(0);

        releaseHolder?.();
        await holder;
        await expect(collection).resolves.toBe(1);
        expect(controls.committed.has('ordinary')).toBe(false);
    });

    it('collects through an authentic active scope', async () => {
        seedOrdinaryBuffer();
        await withProjectAudioStorageLock(async (scope) => {
            await expect(garbageCollectAudioBufferCacheBySize(0, scope, new Set())).resolves.toBe(1);
        });
        expect(controls.committed.has('ordinary')).toBe(false);
        expect(durableOwnershipProvider).toHaveBeenCalledOnce();
    });

    it('rejects an expired scoped collector before durable ownership or storage access', async () => {
        seedOrdinaryBuffer();
        let expiredScope: ProjectAudioStorageLockScope | undefined;
        await withProjectAudioStorageLock(async (scope) => {
            expiredScope = scope;
        });
        durableOwnershipProvider.mockClear();
        if (!expiredScope) {
            throw new TypeError('Expected the owner to mint a storage scope');
        }

        await expect(garbageCollectAudioBufferCacheBySize(0, expiredScope, new Set())).rejects.toThrow(
            'Project audio storage lock scope is invalid or expired'
        );
        expect(durableOwnershipProvider).not.toHaveBeenCalled();
        expect(controls.openRequestCount()).toBe(0);
        expect(controls.committed.has('ordinary')).toBe(true);
    });
});
