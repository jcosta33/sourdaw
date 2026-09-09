import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type ProjectAudioStorageLockScope,
    withProjectAudioStorageLock,
} from '#/infra/storage/withProjectAudioStorageLock';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import {
    BUFFER_STORE,
    META_STORE,
    RECOVERY_STORE,
    installFakeAudioIndexedDb,
    type FakeAudioIndexedDbControls,
} from '../../stores/__tests__/fakeAudioBufferIndexedDb';
import { installTestAudioBufferConstructor } from '../../stores/__tests__/preparedAudioBufferTestSupport';

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
    controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE] });
    [
        { garbageCollectCachedAudioBuffersBySize },
        { garbageCollectAudioBufferCacheBySize },
        { setDurableAudioBufferOwnershipProvider },
    ] = await Promise.all([
        import('../garbageCollectCachedAudioBuffersBySize'),
        import('../../stores/audioBufferCache'),
        import('../../stores/durableAudioBufferOwnership'),
    ]);
    setDurableAudioBufferOwnershipProvider(() => Promise.resolve([]));
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
        expect(lockManager.requestedNames).toEqual(['sourdaw:project-audio-storage', 'sourdaw:project-audio-storage']);
        expect(controls.openRequestCount()).toBe(0);

        releaseHolder?.();
        await holder;
        await expect(collection).resolves.toBe(1);
        expect(controls.committed.has('ordinary')).toBe(false);
    });

    it('rejects an expired scoped collector before it opens storage', async () => {
        seedOrdinaryBuffer();
        let expiredScope: ProjectAudioStorageLockScope | undefined;
        await withProjectAudioStorageLock(async (scope) => {
            expiredScope = scope;
        });
        if (!expiredScope) {
            throw new TypeError('Expected the owner to mint a storage scope');
        }

        await expect(garbageCollectAudioBufferCacheBySize(0, expiredScope)).rejects.toThrow(
            'Project audio storage lock scope is invalid or expired'
        );
        expect(controls.openRequestCount()).toBe(0);
        expect(controls.committed.has('ordinary')).toBe(true);
    });
});
