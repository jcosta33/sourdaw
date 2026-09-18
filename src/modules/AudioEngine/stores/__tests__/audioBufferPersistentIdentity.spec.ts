import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import {
    BUFFER_STORE,
    CHECKPOINT_AUDIO_VERSION_META_STORE,
    CHECKPOINT_AUDIO_VERSION_STORE,
    CHECKPOINT_RETENTION_STORE,
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

const CURRENT_STORES = [
    BUFFER_STORE,
    META_STORE,
    RECOVERY_STORE,
    CHECKPOINT_RETENTION_STORE,
    CHECKPOINT_AUDIO_VERSION_STORE,
    CHECKPOINT_AUDIO_VERSION_META_STORE,
] as const;
const PROJECT_OWNER_ID = 'project-owner';

type AudioRealm = {
    acquire: typeof import('../../useCases/acquireCheckpointAudioRetention').acquireCheckpointAudioRetention;
    cache: typeof import('../../useCases/cacheAudioBuffer').cacheAudioBuffer;
    clearRuntime: typeof import('../audioBufferCache').clearRuntimeAudioBufferCache;
    ensure: typeof import('../../useCases/ensureCachedAudioBuffersDurable').ensureCachedAudioBuffersDurable;
    get: typeof import('../../useCases/getCachedAudioBuffer').getCachedAudioBuffer;
    prepare: typeof import('../../useCases/prepareCachedAudioBuffersFromIdb').prepareCachedAudioBuffersFromIdb;
    release: typeof import('../../useCases/releaseCheckpointAudioRetention').releaseCheckpointAudioRetention;
    setOwnershipProvider: typeof import('../durableAudioBufferOwnership').setDurableAudioBufferOwnershipProvider;
    withStorageLock: typeof import('#/infra/storage/withProjectAudioStorageLock').withProjectAudioStorageLock;
};

type SourceAndReplacement = {
    replacement: AudioRealm;
    source: AudioRealm;
};

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

function committedSample(id: string): number | null {
    return controls.committed.get(id)?.channelData[0]?.[0] ?? null;
}

async function loadRealm(): Promise<AudioRealm> {
    const [acquire, cache, store, ensure, get, prepare, release, ownership, storage] = await Promise.all([
        import('../../useCases/acquireCheckpointAudioRetention'),
        import('../../useCases/cacheAudioBuffer'),
        import('../audioBufferCache'),
        import('../../useCases/ensureCachedAudioBuffersDurable'),
        import('../../useCases/getCachedAudioBuffer'),
        import('../../useCases/prepareCachedAudioBuffersFromIdb'),
        import('../../useCases/releaseCheckpointAudioRetention'),
        import('../durableAudioBufferOwnership'),
        import('#/infra/storage/withProjectAudioStorageLock'),
    ]);
    ownership.setDurableAudioBufferOwnershipProvider(() => Promise.resolve([]));
    const realm: AudioRealm = {
        acquire: acquire.acquireCheckpointAudioRetention,
        cache: cache.cacheAudioBuffer,
        clearRuntime: store.clearRuntimeAudioBufferCache,
        ensure: ensure.ensureCachedAudioBuffersDurable,
        get: get.getCachedAudioBuffer,
        prepare: prepare.prepareCachedAudioBuffersFromIdb,
        release: release.releaseCheckpointAudioRetention,
        setOwnershipProvider: ownership.setDurableAudioBufferOwnershipProvider,
        withStorageLock: storage.withProjectAudioStorageLock,
    };
    realms.push(realm);
    return realm;
}

async function requireDurableReceipt(realm: AudioRealm, id: string) {
    const receipt = await realm.ensure([id]);
    if (receipt.status !== 'durable') {
        throw new Error(`Expected durable receipt, received ${receipt.status}`);
    }
    return receipt;
}

async function persistSample(realm: AudioRealm, id: string, value: number): Promise<void> {
    realm.cache({ bufferId: id, buffer: runtimeBuffer(value) });
    const receipt = await requireDurableReceipt(realm, id);
    receipt.release();
    expect(cachedSample(realm, id)).toBe(Math.fround(value));
    expect(committedSample(id)).toBe(Math.fround(value));
    expect(controls.committedMeta.get(id)?.sizeInBytes).toBe(Float32Array.BYTES_PER_ELEMENT);
}

async function observeCheckpointRetentionPuts(): Promise<() => number> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('sourdaw-audio');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    const retentionStore = database.transaction(CHECKPOINT_RETENTION_STORE).objectStore(CHECKPOINT_RETENTION_STORE);
    const prototype = Object.getPrototypeOf(retentionStore) as IDBObjectStore;
    database.close();
    const originalPut = prototype.put;
    const retentionPutCalls: Parameters<IDBObjectStore['put']>[] = [];
    vi.spyOn(prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore['put']>
    ) {
        if (this.name === CHECKPOINT_RETENTION_STORE) {
            retentionPutCalls.push(args);
        }
        return originalPut.apply(this, args);
    });
    return () => retentionPutCalls.length;
}

async function setupPreviouslyDurableSource(id: string): Promise<SourceAndReplacement> {
    const source = await loadRealm();
    await persistSample(source, id, 0.25);

    vi.resetModules();
    const replacement = await loadRealm();
    expect(cachedSample(replacement, id)).toBeNull();
    return { source, replacement };
}

async function setupHydratedSource(id: string): Promise<SourceAndReplacement> {
    const replacement = await loadRealm();
    await persistSample(replacement, id, 0.25);

    vi.resetModules();
    const source = await loadRealm();
    expect(cachedSample(source, id)).toBeNull();
    const candidate = await source.prepare({ audioContext: audioContext(), bufferIds: [id] });
    expect(candidate?.publish()).toBe(1);
    expect(cachedSample(source, id)).toBe(Math.fround(0.25));
    return { source, replacement };
}

async function setupEvictedSource(id: string): Promise<SourceAndReplacement> {
    const realms = await setupPreviouslyDurableSource(id);
    for (let index = 0; index < 64; index++) {
        realms.source.cache({ bufferId: `${id}-filler-${index}`, buffer: runtimeBuffer(index / 64) });
    }
    expect(cachedSample(realms.source, id)).toBeNull();
    return realms;
}

async function overwriteWithReplacement(replacement: AudioRealm, id: string): Promise<void> {
    await persistSample(replacement, id, 0.75);
    expect(committedSample(id)).toBe(Math.fround(0.75));
    expect(controls.committedMeta.get(id)?.sizeInBytes).toBe(Float32Array.BYTES_PER_ELEMENT);
}

async function expectFreshEnsureRefusesReplacedSource(
    setup: (id: string) => Promise<SourceAndReplacement>,
    id: string,
    expectedSourceSample: number | null = Math.fround(0.25)
): Promise<void> {
    const retentionPutCount = await observeCheckpointRetentionPuts();
    const { source, replacement } = await setup(id);
    await overwriteWithReplacement(replacement, id);
    const result = await source.ensure([id]);
    try {
        expect(cachedSample(source, id)).toBe(expectedSourceSample);
        expect(committedSample(id)).toBe(Math.fround(0.75));
        expect(controls.committedMeta.get(id)?.sizeInBytes).toBe(Float32Array.BYTES_PER_ELEMENT);
        expect(retentionPutCount()).toBe(0);
        expect(controls.committedCheckpointRetentions.size).toBe(0);
        expect(result.status).not.toBe('durable');
    } finally {
        if (result.status === 'durable') {
            result.release();
        }
    }
}

async function expectReceiptRefusesReplacedSource(
    setup: (id: string) => Promise<SourceAndReplacement>,
    id: string
): Promise<void> {
    const retentionPutCount = await observeCheckpointRetentionPuts();
    const { source, replacement } = await setup(id);
    const receipt = await requireDurableReceipt(source, id);
    try {
        await overwriteWithReplacement(replacement, id);
        const result = await source.withStorageLock((scope) =>
            source.acquire({
                checkpointId: `checkpoint-${id}`,
                projectOwnerId: PROJECT_OWNER_ID,
                durabilityReceipt: receipt,
                scope,
            })
        );
        const retention = controls.committedCheckpointRetentions.get(`checkpoint-${id}`);
        expect({
            committedSample: committedSample(id),
            retention,
            retentionPutCount: retentionPutCount(),
            result,
            sourceSample: cachedSample(source, id),
        }).toEqual({
            committedSample: Math.fround(0.75),
            retention: undefined,
            retentionPutCount: 0,
            result: { status: 'superseded' },
            sourceSample: Math.fround(0.25),
        });
    } finally {
        receipt.release();
    }
}

describe('audio buffer persistent identity across module instances', () => {
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
        await lockManager.locks.request('sourdaw:project-audio-storage', { mode: 'exclusive' }, async () => undefined);
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('upgrades schema 4 by clearing obsolete retention while preserving ordinary and recovery PCM', async () => {
        controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE, CHECKPOINT_RETENTION_STORE],
        });
        controls.committed.set('ordinary', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.25])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        controls.committedMeta.set('ordinary', {
            lastAccessed: 1,
            persistenceRevision: 'ordinary-revision',
            sizeInBytes: 4,
        });
        controls.committedRecovery.set('recovery', new Float32Array([0.5]));
        controls.committedCheckpointRetentions.set('old-checkpoint', {
            schemaVersion: 1,
            checkpointId: 'old-checkpoint',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['ordinary'],
            ownershipToken: 'old-token',
        } as never);

        vi.resetModules();
        const realm = await loadRealm();
        const prepared = await realm.prepare({ audioContext: audioContext(), bufferIds: ['ordinary'] });
        expect(prepared?.publish()).toBe(1);
        expect(controls.storeNames()).toEqual(expect.arrayContaining([...CURRENT_STORES]));
        expect(controls.committedCheckpointRetentions.size).toBe(0);
        expect(controls.committed.get('ordinary')?.channelData[0]?.[0]).toBe(0.25);
        expect(controls.committedRecovery.has('recovery')).toBe(true);
        await expect(
            realm.release({
                checkpointId: 'old-checkpoint',
                projectOwnerId: PROJECT_OWNER_ID,
                ownershipToken: 'old-token',
            })
        ).resolves.toBe(false);
    });

    it('leaves schema 4 intact when the version upgrade aborts', async () => {
        controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE, CHECKPOINT_RETENTION_STORE],
        });
        controls.committed.set('ordinary', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.25])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        controls.committedCheckpointRetentions.set('old-checkpoint', {
            schemaVersion: 1,
            checkpointId: 'old-checkpoint',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['ordinary'],
            ownershipToken: 'old-token',
        } as never);
        controls.abortNextWrite();

        vi.resetModules();
        const { openAudioBufferCacheDatabase } = await import('../audioBufferCache');
        await expect(openAudioBufferCacheDatabase()).rejects.toThrow(/upgrade was aborted/i);
        expect(controls.storeNames()).not.toContain(CHECKPOINT_AUDIO_VERSION_STORE);
        expect(controls.storeNames()).not.toContain(CHECKPOINT_AUDIO_VERSION_META_STORE);
        expect(controls.committed.has('ordinary')).toBe(true);
        expect(controls.committedCheckpointRetentions.has('old-checkpoint')).toBe(true);
    });

    it('refuses a fresh durable result for a previously durable source replaced by another module instance', async () => {
        await expectFreshEnsureRefusesReplacedSource(setupPreviouslyDurableSource, 'previously-durable-fresh');
    });

    it('refuses a fresh durable result for a hydrated source replaced by another module instance', async () => {
        await expectFreshEnsureRefusesReplacedSource(setupHydratedSource, 'hydrated-fresh');
    });

    it('refuses a fresh durable result for an evicted known source replaced by another module instance', async () => {
        await expectFreshEnsureRefusesReplacedSource(setupEvictedSource, 'evicted-fresh', null);
    });

    it('preserves an evicted known source identity when its ID is explicitly retained', async () => {
        const retentionPutCount = await observeCheckpointRetentionPuts();
        const id = 'evicted-explicitly-retained';
        const { source, replacement } = await setupEvictedSource(id);
        await overwriteWithReplacement(replacement, id);

        source.clearRuntime({ retainedIds: [id] });
        const result = await source.ensure([id]);
        try {
            expect(result.status).not.toBe('durable');
            expect(retentionPutCount()).toBe(0);
            expect(controls.committedCheckpointRetentions.size).toBe(0);
        } finally {
            if (result.status === 'durable') {
                result.release();
            }
        }
    });

    it('does not authenticate replacement PCM by hydrating over an evicted known source', async () => {
        const id = 'evicted-hydration-replacement';
        const { source, replacement } = await setupEvictedSource(id);
        await overwriteWithReplacement(replacement, id);

        const candidate = await source.prepare({ audioContext: audioContext(), bufferIds: [id] });
        const published = candidate?.publish() ?? 0;
        const result = await source.ensure([id]);
        try {
            expect({
                cachedSample: cachedSample(source, id),
                ensureStatus: result.status,
                published,
            }).toEqual({
                cachedSample: null,
                ensureStatus: 'superseded',
                published: 0,
            });
        } finally {
            if (result.status === 'durable') {
                result.release();
            }
        }
    });

    it('publishes unknown valid durable PCM with its same-read identity', async () => {
        const replacement = await loadRealm();
        await persistSample(replacement, 'unknown-valid-hydration', 0.25);

        vi.resetModules();
        const source = await loadRealm();
        const candidate = await source.prepare({
            audioContext: audioContext(),
            bufferIds: ['unknown-valid-hydration'],
        });
        expect(candidate?.publish()).toBe(1);
        expect(cachedSample(source, 'unknown-valid-hydration')).toBe(Math.fround(0.25));
        const receipt = await requireDurableReceipt(source, 'unknown-valid-hydration');
        receipt.release();
    });

    it('hydrates matching durable PCM for a known evicted source', async () => {
        const id = 'matching-evicted-hydration';
        const { source } = await setupEvictedSource(id);
        const candidate = await source.prepare({ audioContext: audioContext(), bufferIds: [id] });

        expect(candidate?.publish()).toBe(1);
        expect(cachedSample(source, id)).toBe(Math.fround(0.25));
        const receipt = await requireDurableReceipt(source, id);
        receipt.release();
    });

    it('publishes matching evicted PCM after the Project prepare-retain-reset order', async () => {
        const id = 'matching-evicted-retained-hydration';
        const { source } = await setupEvictedSource(id);
        const candidate = await source.prepare({ audioContext: audioContext(), bufferIds: [id] });

        source.clearRuntime({ retainedIds: [id] });
        expect(candidate?.publish()).toBe(1);
        expect(cachedSample(source, id)).toBe(Math.fround(0.25));
        const receipt = await requireDurableReceipt(source, id);
        receipt.release();
    });

    it('does not overwrite a local replacement published after hydration staging', async () => {
        const replacement = await loadRealm();
        await persistSample(replacement, 'staged-local-replacement', 0.25);

        vi.resetModules();
        const source = await loadRealm();
        const candidate = await source.prepare({
            audioContext: audioContext(),
            bufferIds: ['staged-local-replacement'],
        });
        source.cache({ bufferId: 'staged-local-replacement', buffer: runtimeBuffer(0.9) });

        expect(candidate?.publish()).toBe(0);
        expect(cachedSample(source, 'staged-local-replacement')).toBe(Math.fround(0.9));
        const receipt = await requireDurableReceipt(source, 'staged-local-replacement');
        receipt.release();
        expect(committedSample('staged-local-replacement')).toBe(Math.fround(0.9));
    });

    it('keeps a staged hydration bound to its read token when another module overwrites disk before publish', async () => {
        const replacement = await loadRealm();
        await persistSample(replacement, 'staged-hydration', 0.25);

        vi.resetModules();
        const source = await loadRealm();
        const candidate = await source.prepare({ audioContext: audioContext(), bufferIds: ['staged-hydration'] });
        await overwriteWithReplacement(replacement, 'staged-hydration');

        expect(candidate?.publish()).toBe(1);
        expect(cachedSample(source, 'staged-hydration')).toBe(Math.fround(0.25));
        const result = await source.ensure(['staged-hydration']);
        try {
            expect(result.status).not.toBe('durable');
            expect(committedSample('staged-hydration')).toBe(Math.fround(0.75));
        } finally {
            if (result.status === 'durable') {
                result.release();
            }
        }
    });

    it('refuses checkpoint retention from a previously durable receipt replaced by another module instance', async () => {
        await expectReceiptRefusesReplacedSource(setupPreviouslyDurableSource, 'previously-durable-receipt');
    });

    it('refuses checkpoint retention from a hydrated receipt replaced by another module instance', async () => {
        await expectReceiptRefusesReplacedSource(setupHydratedSource, 'hydrated-receipt');
    });

    it('refuses a mixed checkpoint acquisition before writing when one receipt token was replaced', async () => {
        const retentionPutCount = await observeCheckpointRetentionPuts();
        const source = await loadRealm();
        await persistSample(source, 'mixed-stable', 0.25);
        await persistSample(source, 'mixed-replaced', 0.5);
        const receipt = await source.ensure(['mixed-stable', 'mixed-replaced']);
        if (receipt.status !== 'durable') {
            throw new Error(`Expected durable receipt, received ${receipt.status}`);
        }

        vi.resetModules();
        const replacement = await loadRealm();
        try {
            await overwriteWithReplacement(replacement, 'mixed-replaced');
            const result = await source.withStorageLock((scope) =>
                source.acquire({
                    checkpointId: 'checkpoint-mixed-source',
                    projectOwnerId: PROJECT_OWNER_ID,
                    durabilityReceipt: receipt,
                    scope,
                })
            );

            expect(result).toEqual({ status: 'superseded' });
            expect(retentionPutCount()).toBe(0);
            expect(controls.committedCheckpointRetentions.size).toBe(0);
        } finally {
            receipt.release();
        }
    });
});
