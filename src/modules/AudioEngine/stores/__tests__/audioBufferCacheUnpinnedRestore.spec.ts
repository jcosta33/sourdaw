import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import {
    BUFFER_STORE,
    CHECKPOINT_AUDIO_VERSION_META_STORE,
    CHECKPOINT_AUDIO_VERSION_STORE,
    CHECKPOINT_RETENTION_STORE,
    flushIndexedDbTasks,
    installFakeAudioIndexedDb,
    META_STORE,
    RECOVERY_STORE,
    type FakeAudioIndexedDbControls,
} from './fakeAudioBufferIndexedDb';
import {
    createAudioBuffer,
    createTestContext,
    installTestAudioBufferConstructor,
} from './preparedAudioBufferTestSupport';

// Each realm is one launch: a fresh module instance over the same storage.
type AudioRealm = {
    cache: typeof import('../../useCases/cacheAudioBuffer').cacheAudioBuffer;
    clearRuntime: typeof import('../audioBufferCache').clearRuntimeAudioBufferCache;
    ensure: typeof import('../../useCases/ensureCachedAudioBuffersDurable').ensureCachedAudioBuffersDurable;
    get: typeof import('../../useCases/getCachedAudioBuffer').getCachedAudioBuffer;
    persistPrepared: typeof import('../audioBufferCache').audioBufferCache.persistPreparedBuffer;
    prepare: typeof import('../../useCases/prepareCachedAudioBuffersFromIdb').prepareCachedAudioBuffersFromIdb;
    remove: typeof import('../audioBufferCache').audioBufferCache.remove;
    restoreUnpinned: typeof import('../../useCases/restoreUnpinnedAudioBuffersFromIdb').restoreUnpinnedAudioBuffersFromIdb;
    setOwnershipProvider: typeof import('../durableAudioBufferOwnership').setDurableAudioBufferOwnershipProvider;
};

const CURRENT_STORES = [
    BUFFER_STORE,
    META_STORE,
    RECOVERY_STORE,
    CHECKPOINT_RETENTION_STORE,
    CHECKPOINT_AUDIO_VERSION_STORE,
    CHECKPOINT_AUDIO_VERSION_META_STORE,
] as const;
// MUST mirror MAX_AUDIO_BUFFER_ENTRIES in ../audioBufferCache.ts.
const MAX_AUDIO_BUFFER_ENTRIES = 64;

let controls: FakeAudioIndexedDbControls;
let lockManager: ReturnType<typeof createControlledLockManager>;
let realms: AudioRealm[];

function runtimeBuffer(value: number): AudioBuffer {
    const buffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
    buffer.getChannelData(0)[0] = value;
    return buffer;
}

function audioContext(): BaseAudioContext {
    return createTestContext(
        vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
            createAudioBuffer({ length, sampleRate })
        )
    );
}

function cachedSample(realm: AudioRealm, id: string): number | null {
    return realm.get({ bufferId: id })?.getChannelData(0)[0] ?? null;
}

async function loadRealm(): Promise<AudioRealm> {
    const [cache, store, ensure, get, prepare, restoreUnpinned, ownership] = await Promise.all([
        import('../../useCases/cacheAudioBuffer'),
        import('../audioBufferCache'),
        import('../../useCases/ensureCachedAudioBuffersDurable'),
        import('../../useCases/getCachedAudioBuffer'),
        import('../../useCases/prepareCachedAudioBuffersFromIdb'),
        import('../../useCases/restoreUnpinnedAudioBuffersFromIdb'),
        import('../durableAudioBufferOwnership'),
    ]);
    ownership.setDurableAudioBufferOwnershipProvider(() => Promise.resolve([]));
    const realm: AudioRealm = {
        cache: cache.cacheAudioBuffer,
        clearRuntime: store.clearRuntimeAudioBufferCache,
        ensure: ensure.ensureCachedAudioBuffersDurable,
        get: get.getCachedAudioBuffer,
        persistPrepared: store.audioBufferCache.persistPreparedBuffer,
        prepare: prepare.prepareCachedAudioBuffersFromIdb,
        remove: store.audioBufferCache.remove,
        restoreUnpinned: restoreUnpinned.restoreUnpinnedAudioBuffersFromIdb,
        setOwnershipProvider: ownership.setDurableAudioBufferOwnershipProvider,
    };
    realms.push(realm);
    return realm;
}

async function persistSample(realm: AudioRealm, id: string, value: number): Promise<void> {
    realm.cache({ bufferId: id, buffer: runtimeBuffer(value) });
    const receipt = await realm.ensure([id]);
    if (receipt.status !== 'durable') {
        throw new Error(`Expected durable receipt, received ${receipt.status}`);
    }
    receipt.release();
}

/** Unprotected writes enough to evict every buffer nothing protects. */
function evictUnprotected(realm: AudioRealm): void {
    for (let index = 0; index < MAX_AUDIO_BUFFER_ENTRIES; index++) {
        realm.cache({ bufferId: `filler-${index}`, buffer: runtimeBuffer(index / MAX_AUDIO_BUFFER_ENTRIES) });
    }
}

const AUDIO_STORAGE_LOCK = 'sourdaw:project-audio-storage';

/** Every storage write queued so far has settled once this resolves. */
async function settleQueuedWrites(): Promise<void> {
    await lockManager.locks.request(AUDIO_STORAGE_LOCK, { mode: 'exclusive' }, async () => undefined);
}

/** Holds the storage lock, so every write queued meanwhile stays pending. */
async function holdStorageWrites(): Promise<{ release: () => Promise<void> }> {
    let granted!: () => void;
    let releaseLock!: () => void;
    const grant = new Promise<void>((resolve) => {
        granted = resolve;
    });
    const held = lockManager.locks.request(AUDIO_STORAGE_LOCK, { mode: 'exclusive' }, () => {
        granted();
        return new Promise<void>((resolve) => {
            releaseLock = resolve;
        });
    });
    await grant;
    return {
        release: async () => {
            releaseLock();
            await held;
            await settleQueuedWrites();
        },
    };
}

/** A later launch: the stored records survive, nothing is resident. */
async function relaunch(): Promise<AudioRealm> {
    vi.resetModules();
    return loadRealm();
}

describe('restoring stored audio without pinning it', () => {
    beforeEach(() => {
        vi.resetModules();
        lockManager = createControlledLockManager();
        vi.stubGlobal('navigator', { ...navigator, locks: lockManager.locks });
        installTestAudioBufferConstructor();
        controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        realms = [];
    });

    afterEach(async () => {
        for (const realm of realms) {
            realm.setOwnershipProvider(null);
            realm.clearRuntime();
        }
        await settleQueuedWrites();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('restores PCM an earlier launch stored and leaves the stored record as it is', async () => {
        const earlier = await loadRealm();
        await persistSample(earlier, 'stored-sample', 0.25);
        const later = await relaunch();
        expect(cachedSample(later, 'stored-sample')).toBeNull();
        controls.resetByteCounters();

        const { absentIds, release } = await later.restoreUnpinned({ bufferIds: ['stored-sample'] });
        release();
        // Already persisted: a durable receipt needs no write either.
        const receipt = await later.ensure(['stored-sample']);
        if (receipt.status === 'durable') {
            receipt.release();
        }
        await flushIndexedDbTasks();

        expect(absentIds).toEqual([]);
        expect(cachedSample(later, 'stored-sample')).toBe(Math.fround(0.25));
        expect(receipt.status).toBe('durable');
        expect(controls.bytesWritten()).toBe(0);
        expect(controls.committed.get('stored-sample')?.channelData[0]?.[0]).toBe(Math.fround(0.25));
    });

    it('leaves the pinned set of the open project as it is', async () => {
        const earlier = await loadRealm();
        await persistSample(earlier, 'project-clip', 0.5);
        await persistSample(earlier, 'preview-sample', 0.25);
        const later = await relaunch();
        const projectLoad = await later.prepare({ audioContext: audioContext(), bufferIds: ['project-clip'] });
        expect(projectLoad?.publish()).toBe(1);

        const { release } = await later.restoreUnpinned({ bufferIds: ['preview-sample'] });
        release();
        evictUnprotected(later);

        expect(cachedSample(later, 'project-clip')).toBe(Math.fround(0.5));
        expect(cachedSample(later, 'preview-sample')).toBeNull();
    });

    it('reports an id with no stored record absent and leaves it out of the cache', async () => {
        const earlier = await loadRealm();
        await persistSample(earlier, 'stored-sample', 0.25);
        const later = await relaunch();

        const { absentIds, release } = await later.restoreUnpinned({
            bufferIds: ['stored-sample', 'never-stored'],
        });
        release();

        expect(absentIds).toEqual(['never-stored']);
        expect(later.get({ bufferId: 'never-stored' })).toBeNull();
        expect(cachedSample(later, 'stored-sample')).toBe(Math.fround(0.25));
    });

    it('restores an evicted sample whose write is still pending from the PCM this session holds', async () => {
        const realm = await loadRealm();
        const writes = await holdStorageWrites();
        realm.cache({ bufferId: 'pending-sample', buffer: runtimeBuffer(0.25) });
        evictUnprotected(realm);
        await flushIndexedDbTasks();
        expect(cachedSample(realm, 'pending-sample')).toBeNull();
        expect(controls.committed.has('pending-sample')).toBe(false);
        controls.resetByteCounters();

        const { absentIds, release } = await realm.restoreUnpinned({ bufferIds: ['pending-sample'] });
        release();
        const bytesWrittenByRestore = controls.bytesWritten();
        await writes.release();

        expect(absentIds).toEqual([]);
        expect(cachedSample(realm, 'pending-sample')).toBe(Math.fround(0.25));
        expect(bytesWrittenByRestore).toBe(0);
    });

    it('restores an evicted sample whose write failed from the PCM this session holds', async () => {
        const realm = await loadRealm();
        controls.failRequestsFrom(BUFFER_STORE);
        realm.cache({ bufferId: 'failed-sample', buffer: runtimeBuffer(0.25) });
        evictUnprotected(realm);
        await settleQueuedWrites();
        controls.allowRequests();
        expect(cachedSample(realm, 'failed-sample')).toBeNull();
        expect(controls.committed.has('failed-sample')).toBe(false);
        controls.resetByteCounters();

        const { absentIds, release } = await realm.restoreUnpinned({ bufferIds: ['failed-sample'] });
        release();
        await flushIndexedDbTasks();

        expect(absentIds).toEqual([]);
        expect(cachedSample(realm, 'failed-sample')).toBe(Math.fround(0.25));
        expect(controls.bytesWritten()).toBe(0);
    });

    it('reports a sample this session removed absent', async () => {
        const realm = await loadRealm();
        await persistSample(realm, 'removed-sample', 0.25);
        realm.remove('removed-sample');
        await settleQueuedWrites();
        expect(controls.committed.has('removed-sample')).toBe(false);

        const { absentIds, release } = await realm.restoreUnpinned({ bufferIds: ['removed-sample'] });
        release();

        expect(absentIds).toEqual(['removed-sample']);
        expect(realm.get({ bufferId: 'removed-sample' })).toBeNull();
    });

    it('reports nothing absent and restores nothing when storage cannot be read', async () => {
        const earlier = await loadRealm();
        await persistSample(earlier, 'stored-sample', 0.25);
        const later = await relaunch();
        controls.failRequestsFrom(BUFFER_STORE);

        const { absentIds, release } = await later.restoreUnpinned({
            bufferIds: ['stored-sample', 'never-stored'],
        });
        release();
        controls.allowRequests();

        expect(absentIds).toEqual([]);
        expect(later.get({ bufferId: 'stored-sample' })).toBeNull();
        expect(later.get({ bufferId: 'never-stored' })).toBeNull();
    });

    it('keeps out a stored record another launch wrote over the one this session stored', async () => {
        const first = await loadRealm();
        await persistSample(first, 'shared-sample', 0.25);
        evictUnprotected(first);
        await flushIndexedDbTasks();
        expect(cachedSample(first, 'shared-sample')).toBeNull();
        vi.resetModules();
        const second = await loadRealm();
        await persistSample(second, 'shared-sample', 0.75);
        expect(controls.committed.get('shared-sample')?.channelData[0]?.[0]).toBe(Math.fround(0.75));

        const { absentIds, release } = await first.restoreUnpinned({ bufferIds: ['shared-sample'] });
        release();

        expect(absentIds).toEqual([]);
        expect(first.get({ bufferId: 'shared-sample' })).toBeNull();
    });

    it('keeps out a record a prepared lease still holds', async () => {
        const earlier = await loadRealm();
        const persisted = await earlier.persistPrepared({
            id: 'leased-sample',
            buffer: runtimeBuffer(0.25),
            leaseId: 'leased-sample-lease',
        });
        expect(persisted.status).toBe('persisted');
        const later = await relaunch();

        const { absentIds, release } = await later.restoreUnpinned({ bufferIds: ['leased-sample'] });
        release();

        expect(absentIds).toEqual([]);
        expect(later.get({ bufferId: 'leased-sample' })).toBeNull();
    });
});
