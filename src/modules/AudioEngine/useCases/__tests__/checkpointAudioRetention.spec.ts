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
    type StoredAudioBuffer,
    type StoredBufferMeta,
} from '../../stores/__tests__/fakeAudioBufferIndexedDb';
import {
    createAudioBuffer,
    createTestContext,
    installTestAudioBufferConstructor,
} from '../../stores/__tests__/preparedAudioBufferTestSupport';

const mocks = vi.hoisted(() => ({
    loggerWarn: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const CURRENT_STORES = [
    BUFFER_STORE,
    META_STORE,
    RECOVERY_STORE,
    CHECKPOINT_RETENTION_STORE,
    CHECKPOINT_AUDIO_VERSION_STORE,
    CHECKPOINT_AUDIO_VERSION_META_STORE,
] as const;
const PROJECT_OWNER_ID = 'project-owner';

type RetentionApi = {
    acquire: typeof import('../acquireCheckpointAudioRetention').acquireCheckpointAudioRetention;
    cache: typeof import('../cacheAudioBuffer').cacheAudioBuffer;
    ensure: typeof import('../ensureCachedAudioBuffersDurable').ensureCachedAudioBuffersDurable;
    get: typeof import('../getCachedAudioBuffer').getCachedAudioBuffer;
    importBuffers: typeof import('../importCachedAudioBuffers').importCachedAudioBuffers;
    read: typeof import('../readCheckpointAudioRetention').readCheckpointAudioRetention;
    release: typeof import('../releaseCheckpointAudioRetention').releaseCheckpointAudioRetention;
    collectByAge: typeof import('../garbageCollectCachedAudioBuffersByAge').garbageCollectCachedAudioBuffersByAge;
    collectBySize: typeof import('../garbageCollectCachedAudioBuffersBySize').garbageCollectCachedAudioBuffersBySize;
    collectFreeze: typeof import('../garbageCollectFreezeAudioBuffers').garbageCollectFreezeAudioBuffers;
    clear: typeof import('../clearCachedAudioBuffers').clearCachedAudioBuffers;
    remove: typeof import('../discardDecodedAudioFile').discardDecodedAudioFile;
    prepare: typeof import('../prepareCachedAudioBuffersFromIdb').prepareCachedAudioBuffersFromIdb;
    withStorageLock: typeof import('#/infra/storage/withProjectAudioStorageLock').withProjectAudioStorageLock;
};

let lockManager: ReturnType<typeof createControlledLockManager>;
let setDurableAudioBufferOwnershipProvider:
    typeof import('../../stores/durableAudioBufferOwnership').setDurableAudioBufferOwnershipProvider | undefined;

async function importApi(): Promise<RetentionApi> {
    const [
        acquire,
        cache,
        ensure,
        get,
        importBuffers,
        read,
        release,
        collectByAge,
        collectBySize,
        collectFreeze,
        clear,
        remove,
        prepare,
        ownership,
        lock,
    ] = await Promise.all([
        import('../acquireCheckpointAudioRetention'),
        import('../cacheAudioBuffer'),
        import('../ensureCachedAudioBuffersDurable'),
        import('../getCachedAudioBuffer'),
        import('../importCachedAudioBuffers'),
        import('../readCheckpointAudioRetention'),
        import('../releaseCheckpointAudioRetention'),
        import('../garbageCollectCachedAudioBuffersByAge'),
        import('../garbageCollectCachedAudioBuffersBySize'),
        import('../garbageCollectFreezeAudioBuffers'),
        import('../clearCachedAudioBuffers'),
        import('../discardDecodedAudioFile'),
        import('../prepareCachedAudioBuffersFromIdb'),
        import('../../stores/durableAudioBufferOwnership'),
        import('#/infra/storage/withProjectAudioStorageLock'),
    ]);
    setDurableAudioBufferOwnershipProvider = ownership.setDurableAudioBufferOwnershipProvider;
    setDurableAudioBufferOwnershipProvider(() => Promise.resolve([]));
    return {
        acquire: acquire.acquireCheckpointAudioRetention,
        cache: cache.cacheAudioBuffer,
        ensure: ensure.ensureCachedAudioBuffersDurable,
        get: get.getCachedAudioBuffer,
        importBuffers: importBuffers.importCachedAudioBuffers,
        read: read.readCheckpointAudioRetention,
        release: release.releaseCheckpointAudioRetention,
        collectByAge: collectByAge.garbageCollectCachedAudioBuffersByAge,
        collectBySize: collectBySize.garbageCollectCachedAudioBuffersBySize,
        collectFreeze: collectFreeze.garbageCollectFreezeAudioBuffers,
        clear: clear.clearCachedAudioBuffers,
        remove: remove.discardDecodedAudioFile,
        prepare: prepare.prepareCachedAudioBuffersFromIdb,
        withStorageLock: lock.withProjectAudioStorageLock,
    };
}

function storedBuffer(values: readonly number[]): StoredAudioBuffer {
    return {
        sampleRate: 48_000,
        numberOfChannels: 1,
        channelData: [new Float32Array(values)],
        lastAccessed: 100,
        sizeInBytes: values.length * Float32Array.BYTES_PER_ELEMENT,
    };
}

function storedMetadata(values: readonly number[], freezeProjectId?: number): StoredBufferMeta {
    const metadata: StoredBufferMeta = {
        lastAccessed: 100,
        sizeInBytes: values.length * Float32Array.BYTES_PER_ELEMENT,
    };
    if (freezeProjectId !== undefined) {
        metadata.freezeProjectId = freezeProjectId;
    }
    return metadata;
}

function seedBuffer(
    controls: FakeAudioIndexedDbControls,
    id: string,
    values: readonly number[] = [0.25],
    freezeProjectId?: number
): void {
    controls.committed.set(id, storedBuffer(values));
    controls.committedMeta.set(id, {
        ...storedMetadata(values, freezeProjectId),
        persistenceRevision: `${id}-persistence`,
    });
}

type PcmFixture = {
    sampleRate: number;
    channels: readonly (readonly number[])[];
};

function seedPcmBuffer(controls: FakeAudioIndexedDbControls, id: string, fixture: PcmFixture): void {
    const channelData = fixture.channels.map((values) => new Float32Array(values));
    const sizeInBytes = channelData.reduce((total, channel) => total + channel.byteLength, 0);
    controls.committed.set(id, {
        sampleRate: fixture.sampleRate,
        numberOfChannels: channelData.length,
        channelData,
        lastAccessed: 100,
        sizeInBytes,
    });
    controls.committedMeta.set(id, {
        lastAccessed: 100,
        persistenceRevision: `${id}-persistence`,
        sizeInBytes,
    });
}

function runtimePcm(fixture: PcmFixture): AudioBuffer {
    const buffer = new AudioBuffer({
        length: fixture.channels[0]!.length,
        numberOfChannels: fixture.channels.length,
        sampleRate: fixture.sampleRate,
    });
    for (const [index, values] of fixture.channels.entries()) {
        buffer.getChannelData(index).set(values);
    }
    return buffer;
}

function expectRuntimePcm(actual: AudioBuffer | null | undefined, expected: PcmFixture): void {
    if (actual === null || actual === undefined) {
        throw new Error('Expected runtime PCM');
    }
    expect(actual.sampleRate).toBe(expected.sampleRate);
    expect(actual.numberOfChannels).toBe(expected.channels.length);
    expect(actual.length).toBe(expected.channels[0]!.length);
    for (const [index, values] of expected.channels.entries()) {
        expect(Array.from(actual.getChannelData(index))).toEqual(values);
    }
}

function expectSerializedPcm(
    actual:
        | {
              sampleRate: number;
              numberOfChannels: number;
              channelData: readonly Float32Array[];
          }
        | undefined,
    expected: PcmFixture
): void {
    if (actual === undefined) {
        throw new Error('Expected serialized PCM');
    }
    expect(actual.sampleRate).toBe(expected.sampleRate);
    expect(actual.numberOfChannels).toBe(expected.channels.length);
    expect(actual.channelData[0]?.length).toBe(expected.channels[0]!.length);
    for (const [index, values] of expected.channels.entries()) {
        expect(Array.from(actual.channelData[index] ?? [])).toEqual(values);
    }
}

function versionKey(id: string, persistenceRevision = `${id}-persistence`): string {
    return JSON.stringify([id, persistenceRevision]);
}

function sparseBufferIds(): string[] {
    const bufferIds: string[] = [];
    bufferIds.length = 1;
    return bufferIds;
}

async function waitForHeldWrite(controls: FakeAudioIndexedDbControls): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (controls.pendingWriteSettlementCount() > 0) {
            return;
        }
        await flushIndexedDbTasks(1);
    }
    throw new Error('Expected a held IndexedDB write transaction');
}

async function waitForHeldReadonly(controls: FakeAudioIndexedDbControls): Promise<void> {
    await vi.waitFor(() => expect(controls.pendingReadonlySettlementCount()).toBeGreaterThan(0));
}

function seedRecovery(controls: FakeAudioIndexedDbControls, id: string, values: readonly number[]): void {
    controls.committedRecovery.set(id, {
        data: {
            ...storedBuffer(values),
            lastAccessed: 1,
        },
        id,
        metadata: {
            lastAccessed: 1,
            preparedOwner: {
                schemaVersion: 1,
                leaseId: `${id}-lease`,
                persistenceRevision: `${id}-persistence`,
                status: 'temporary',
            },
            sizeInBytes: values.length * Float32Array.BYTES_PER_ELEMENT,
        },
        operation: 'discard',
        revision: `${id}-recovery`,
        schemaVersion: 1,
        stagedAtMs: 1,
    });
}

function audioContext(): BaseAudioContext {
    return createTestContext(
        vi.fn(
            (numberOfChannels: number, length: number, sampleRate: number) =>
                new AudioBuffer({ length, numberOfChannels, sampleRate })
        )
    );
}

function runtimeBuffer(value: number): AudioBuffer {
    const buffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
    buffer.getChannelData(0)[0] = value;
    return buffer;
}

async function requireDurabilityReceipt(api: RetentionApi, bufferIds: readonly string[]) {
    const receipt = await api.ensure(bufferIds);
    if (receipt.status !== 'durable') {
        throw new Error(`Expected durable receipt, received ${receipt.status}`);
    }
    return receipt;
}

async function acquireCurrentRetention(
    api: RetentionApi,
    {
        checkpointId,
        projectOwnerId = PROJECT_OWNER_ID,
        bufferIds,
    }: { checkpointId: string; projectOwnerId?: string; bufferIds: readonly string[] }
) {
    const durabilityReceipt = await requireDurabilityReceipt(api, bufferIds);
    try {
        const acquisition = await api.withStorageLock((scope) =>
            api.acquire({ checkpointId, projectOwnerId, durabilityReceipt, scope })
        );
        if (acquisition.status !== 'retained') {
            throw new Error(`Expected retained ownership, received ${acquisition.status}`);
        }
        return acquisition;
    } finally {
        durabilityReceipt.release();
    }
}

async function replaceSourceAfterMetadataRead(api: RetentionApi, bufferId: string, value: number) {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('sourdaw-audio');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    const metadataStore = database.transaction(META_STORE).objectStore(META_STORE);
    const prototype = Object.getPrototypeOf(metadataStore) as IDBObjectStore;
    database.close();
    const originalGet = prototype.get;
    let replacementObserved = false;
    vi.spyOn(prototype, 'get').mockImplementation(function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
        const request = originalGet.call(this, query);
        if (replacementObserved || this.name !== META_STORE || query !== bufferId) {
            return request;
        }
        let success = request.onsuccess;
        Object.defineProperty(request, 'onsuccess', {
            configurable: true,
            get: () => success,
            set: (listener: typeof request.onsuccess) => {
                success =
                    listener === null
                        ? null
                        : function (this: IDBRequest, event: Event) {
                              listener.call(this, event);
                              replacementObserved = true;
                              api.cache({ bufferId, buffer: runtimeBuffer(value) });
                          };
            },
        });
        return request;
    });
    return () => replacementObserved;
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

describe('checkpoint audio retention', () => {
    let controls: FakeAudioIndexedDbControls;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        lockManager = createControlledLockManager();
        vi.stubGlobal('navigator', { ...navigator, locks: lockManager.locks });
        installTestAudioBufferConstructor();
        controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
    });

    afterEach(async () => {
        await lockManager.locks.request('sourdaw:project-audio-storage', { mode: 'exclusive' }, async () => undefined);
        setDurableAudioBufferOwnershipProvider?.(null);
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('stores canonical durable ownership and refuses duplicate checkpoint IDs', async () => {
        seedBuffer(controls, 'buffer-a');
        seedBuffer(controls, 'buffer-b');
        const api = await importApi();

        const ownership = await acquireCurrentRetention(api, {
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['buffer-b', 'buffer-a', 'buffer-b'],
        });

        expect(ownership.ownershipToken).toEqual(expect.any(String));
        expect(ownership.ownershipToken.length).toBeGreaterThan(0);
        expect(controls.committedCheckpointRetentions.get('checkpoint-a')).toEqual({
            schemaVersion: 2,
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: ownership.ownershipToken,
            versionKeys: [versionKey('buffer-a'), versionKey('buffer-b')],
        });
        expect([...controls.committedCheckpointAudioVersions.keys()]).toEqual([
            versionKey('buffer-a'),
            versionKey('buffer-b'),
        ]);

        await expect(
            acquireCurrentRetention(api, {
                checkpointId: 'checkpoint-a',
                projectOwnerId: PROJECT_OWNER_ID,
                bufferIds: ['buffer-a'],
            })
        ).rejects.toThrow(/already exists/i);
        await expect(
            acquireCurrentRetention(api, {
                checkpointId: 'checkpoint-a',
                projectOwnerId: 'other-project',
                bufferIds: ['buffer-b'],
            })
        ).rejects.toThrow(/already exists/i);
        expect(controls.committedCheckpointRetentions.get('checkpoint-a')?.ownershipToken).toBe(
            ownership.ownershipToken
        );
    });

    it('reads immutable retained PCM across ordinary replacement, restart, and caller mutation', async () => {
        const originalPcm: PcmFixture = {
            sampleRate: 44_100,
            channels: [
                [0.25, -0.5, 0.75, -1],
                [0.125, -0.25, 0.5, -0.75],
            ],
        };
        const replacementPcm: PcmFixture = {
            sampleRate: 48_000,
            channels: [
                [-0.125, 0.375, -0.625, 0.875],
                [1, -0.875, 0.625, -0.375],
            ],
        };
        seedPcmBuffer(controls, 'same-id', originalPcm);
        const api = await importApi();
        const btoa = vi.spyOn(globalThis, 'btoa');
        const first = await acquireCurrentRetention(api, {
            checkpointId: 'checkpoint-a',
            bufferIds: ['same-id'],
        });
        const firstBacking = controls.committedCheckpointAudioVersions.get(versionKey('same-id'));
        const second = await acquireCurrentRetention(api, {
            checkpointId: 'checkpoint-b',
            bufferIds: ['same-id'],
        });
        expect(controls.committedCheckpointAudioVersions.size).toBe(1);
        expect(controls.committedCheckpointAudioVersions.get(versionKey('same-id'))).toBe(firstBacking);
        expectSerializedPcm(firstBacking, originalPcm);

        const replacement = await api.importBuffers({
            audioContext: audioContext(),
            buffers: {},
            decodedBuffers: { 'same-id': runtimePcm(replacementPcm) },
            cacheIds: ['same-id'],
        });
        expect(replacement?.publish()).toBe(1);
        await expect(replacement?.persist()).resolves.toBe(true);
        const replacementReceipt = await requireDurabilityReceipt(api, ['same-id']);
        const replacementRevision = controls.committedMeta.get('same-id')?.persistenceRevision;
        if (typeof replacementRevision !== 'string') {
            throw new TypeError('Expected the ordinary replacement to commit a canonical revision');
        }
        const third = await api.withStorageLock((scope) =>
            api.acquire({
                checkpointId: 'checkpoint-c',
                projectOwnerId: PROJECT_OWNER_ID,
                durabilityReceipt: replacementReceipt,
                scope,
            })
        );
        replacementReceipt.release();
        expect(third).toEqual({ status: 'retained', ownershipToken: expect.any(String) });
        if (third.status !== 'retained') {
            throw new Error('Expected replacement retention');
        }
        expect(controls.committedCheckpointAudioVersions.size).toBe(2);
        expectSerializedPcm(controls.committedCheckpointAudioVersions.get(versionKey('same-id')), originalPcm);
        expectSerializedPcm(
            controls.committedCheckpointAudioVersions.get(versionKey('same-id', replacementRevision)),
            replacementPcm
        );

        vi.resetModules();
        const reopened = await importApi();
        const ordinary = await reopened.prepare({ audioContext: audioContext(), bufferIds: ['same-id'] });
        expect(ordinary?.publish()).toBe(1);
        expectRuntimePcm(reopened.get({ bufferId: 'same-id' }), replacementPcm);

        const retainedA = await reopened.read({
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: first.ownershipToken,
            expectedBufferIds: ['same-id', 'same-id'],
            audioContext: audioContext(),
        });
        const retainedB = await reopened.read({
            checkpointId: 'checkpoint-b',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: second.ownershipToken,
            expectedBufferIds: ['same-id'],
            audioContext: audioContext(),
        });
        const retainedC = await reopened.read({
            checkpointId: 'checkpoint-c',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: third.ownershipToken,
            expectedBufferIds: ['same-id'],
            audioContext: audioContext(),
        });
        if (retainedA.status !== 'read' || retainedB.status !== 'read' || retainedC.status !== 'read') {
            throw new Error('Expected retained checkpoint PCM');
        }
        expectRuntimePcm(retainedA.decodedAudioBuffers['same-id'], originalPcm);
        expectRuntimePcm(retainedB.decodedAudioBuffers['same-id'], originalPcm);
        expectRuntimePcm(retainedC.decodedAudioBuffers['same-id'], replacementPcm);
        expect(btoa).not.toHaveBeenCalled();

        retainedA.decodedAudioBuffers['same-id']!.getChannelData(0)[2] = -0.25;
        retainedA.decodedAudioBuffers['same-id']!.getChannelData(1)[3] = 0.25;
        retainedA.decodedAudioBuffers['same-id'] = runtimeBuffer(-2);
        const reread = await reopened.read({
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: first.ownershipToken,
            expectedBufferIds: ['same-id'],
            audioContext: audioContext(),
        });
        if (reread.status !== 'read') {
            throw new Error('Expected retained checkpoint PCM reread');
        }
        expectRuntimePcm(reread.decodedAudioBuffers['same-id'], originalPcm);

        await reopened.release({
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: first.ownershipToken,
        });
        expect(controls.committedCheckpointAudioVersions.has(versionKey('same-id'))).toBe(true);
        await reopened.release({
            checkpointId: 'checkpoint-b',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: second.ownershipToken,
        });
        expect(controls.committedCheckpointAudioVersions.has(versionKey('same-id'))).toBe(false);
        expect(controls.committedCheckpointAudioVersions.has(versionKey('same-id', replacementRevision))).toBe(true);
        expect(btoa).not.toHaveBeenCalled();
    });

    it('returns own-property-safe decoded records and refuses before reading backing', async () => {
        seedBuffer(controls, '__proto__', [0.25]);
        const api = await importApi();
        const ownership = await acquireCurrentRetention(api, {
            checkpointId: 'prototype-checkpoint',
            bufferIds: ['__proto__'],
        });
        controls.failRequestsFrom(CHECKPOINT_AUDIO_VERSION_STORE);
        await expect(
            api.read({
                checkpointId: 'prototype-checkpoint',
                projectOwnerId: PROJECT_OWNER_ID,
                ownershipToken: 'wrong-token',
                expectedBufferIds: ['__proto__'],
                audioContext: audioContext(),
            })
        ).resolves.toEqual({ status: 'refused' });
        await expect(
            api.read({
                checkpointId: 'prototype-checkpoint',
                projectOwnerId: PROJECT_OWNER_ID,
                ownershipToken: ownership.ownershipToken,
                expectedBufferIds: [],
                audioContext: audioContext(),
            })
        ).resolves.toEqual({ status: 'refused' });
        controls.allowRequests();
        const result = await api.read({
            checkpointId: 'prototype-checkpoint',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: ownership.ownershipToken,
            expectedBufferIds: ['__proto__'],
            audioContext: audioContext(),
        });
        expect(result.status).toBe('read');
        expect(result.status === 'read' && Object.hasOwn(result.decodedAudioBuffers, '__proto__')).toBe(true);
        expect(result.status === 'read' && result.decodedAudioBuffers.__proto__?.getChannelData(0)[0]).toBe(0.25);

        controls.committedCheckpointAudioVersionMeta.delete(versionKey('__proto__'));
        await expect(
            api.read({
                checkpointId: 'prototype-checkpoint',
                projectOwnerId: PROJECT_OWNER_ID,
                ownershipToken: ownership.ownershipToken,
                expectedBufferIds: ['__proto__'],
                audioContext: audioContext(),
            })
        ).rejects.toThrow(/metadata is invalid/i);
    });

    it('does not acquire stale disk PCM after the runtime replaces a durable buffer ID', async () => {
        seedBuffer(controls, 'same-id', [0.25]);
        const api = await importApi();
        const receipt = await api.ensure(['same-id']);
        if (receipt.status !== 'durable') {
            throw new Error('Expected durable receipt');
        }

        try {
            await api.withStorageLock(async (scope) => {
                api.cache({ bufferId: 'same-id', buffer: runtimeBuffer(0.75) });
                expect(receipt.isCurrent()).toBe(false);
                receipt.isCurrent = () => true;
                await expect(
                    api.acquire({
                        checkpointId: 'stale-checkpoint',
                        projectOwnerId: PROJECT_OWNER_ID,
                        durabilityReceipt: receipt,
                        scope,
                    })
                ).resolves.toEqual({ status: 'superseded' });
                expect(controls.committedCheckpointRetentions.has('stale-checkpoint')).toBe(false);
            });
        } finally {
            receipt.release();
        }
    });

    it('requires exact active receipt and scope identities while supporting empty ownership', async () => {
        seedBuffer(controls, 'buffer-a');
        seedBuffer(controls, 'buffer-b');
        const api = await importApi();
        const bufferIds = ['buffer-b', 'buffer-a', 'buffer-b'];
        const receipt = await requireDurabilityReceipt(api, bufferIds);
        bufferIds.splice(0, bufferIds.length, 'mutated');
        const forgedReceipt = { ...receipt };
        let expiredScope!: Parameters<RetentionApi['acquire']>[0]['scope'];
        await api.withStorageLock(async (scope) => {
            expiredScope = scope;
            await expect(
                api.acquire({
                    checkpointId: 'forged-checkpoint',
                    projectOwnerId: PROJECT_OWNER_ID,
                    durabilityReceipt: forgedReceipt,
                    scope,
                })
            ).rejects.toThrow(/authentic active durability receipt/i);
            await expect(
                api.acquire({
                    checkpointId: '',
                    projectOwnerId: PROJECT_OWNER_ID,
                    durabilityReceipt: receipt,
                    scope,
                })
            ).rejects.toThrow(/checkpoint and project owner IDs/i);
        });
        await expect(
            api.acquire({
                checkpointId: 'expired-scope-checkpoint',
                projectOwnerId: PROJECT_OWNER_ID,
                durabilityReceipt: receipt,
                scope: expiredScope,
            })
        ).rejects.toThrow(/invalid or expired/i);

        const retained = await api.withStorageLock((scope) =>
            api.acquire({
                checkpointId: 'canonical-checkpoint',
                projectOwnerId: PROJECT_OWNER_ID,
                durabilityReceipt: receipt,
                scope,
            })
        );
        expect(retained).toEqual({ status: 'retained', ownershipToken: expect.any(String) });
        expect(controls.committedCheckpointRetentions.get('canonical-checkpoint')?.versionKeys).toEqual([
            versionKey('buffer-a'),
            versionKey('buffer-b'),
        ]);
        receipt.release();
        receipt.release();
        await api.withStorageLock(async (scope) => {
            await expect(
                api.acquire({
                    checkpointId: 'released-receipt-checkpoint',
                    projectOwnerId: PROJECT_OWNER_ID,
                    durabilityReceipt: receipt,
                    scope,
                })
            ).rejects.toThrow(/authentic active durability receipt/i);
        });

        vi.resetModules();
        const foreignApi = await importApi();
        const foreignReceipt = await requireDurabilityReceipt(foreignApi, ['buffer-a']);
        try {
            await api.withStorageLock(async (scope) => {
                await expect(
                    api.acquire({
                        checkpointId: 'foreign-receipt-checkpoint',
                        projectOwnerId: PROJECT_OWNER_ID,
                        durabilityReceipt: foreignReceipt,
                        scope,
                    })
                ).rejects.toThrow(/authentic active durability receipt/i);
            });
        } finally {
            foreignReceipt.release();
        }

        const emptyReceipt = await requireDurabilityReceipt(foreignApi, []);
        try {
            const empty = await foreignApi.withStorageLock((scope) =>
                foreignApi.acquire({
                    checkpointId: 'empty-checkpoint',
                    projectOwnerId: PROJECT_OWNER_ID,
                    durabilityReceipt: emptyReceipt,
                    scope,
                })
            );
            expect(empty).toEqual({ status: 'retained', ownershipToken: expect.any(String) });
            expect(controls.committedCheckpointRetentions.get('empty-checkpoint')?.versionKeys).toEqual([]);
            if (empty.status !== 'retained') {
                throw new Error('Expected empty retention ownership');
            }
            await expect(
                foreignApi.release({
                    checkpointId: 'empty-checkpoint',
                    projectOwnerId: PROJECT_OWNER_ID,
                    ownershipToken: empty.ownershipToken,
                })
            ).resolves.toBe(true);
        } finally {
            emptyReceipt.release();
        }
    });

    it('refuses publication when an actual source replacement lands after retention reads', async () => {
        seedBuffer(controls, 'same-id', [0.25]);
        const api = await importApi();
        const receipt = await requireDurabilityReceipt(api, ['same-id']);
        const retentionPutCount = await observeCheckpointRetentionPuts();
        const replacementObserved = await replaceSourceAfterMetadataRead(api, 'same-id', 0.75);
        try {
            await expect(
                api.withStorageLock((scope) =>
                    api.acquire({
                        checkpointId: 'pre-write-stale',
                        projectOwnerId: PROJECT_OWNER_ID,
                        durabilityReceipt: receipt,
                        scope,
                    })
                )
            ).resolves.toEqual({ status: 'superseded' });
            expect(replacementObserved()).toBe(true);
            expect(retentionPutCount()).toBe(0);
            expect(controls.committedCheckpointRetentions.has('pre-write-stale')).toBe(false);
        } finally {
            receipt.release();
        }
        await flushIndexedDbTasks(4);
    });

    it('cleans exact ownership when the source becomes stale after retention commits', async () => {
        seedBuffer(controls, 'same-id', [0.25]);
        const api = await importApi();
        const stable = await acquireCurrentRetention(api, {
            checkpointId: 'stable-checkpoint',
            bufferIds: ['same-id'],
        });
        const receipt = await requireDurabilityReceipt(api, ['same-id']);
        controls.pauseWriteSettlements();
        try {
            const acquisition = api.withStorageLock((scope) =>
                api.acquire({
                    checkpointId: 'committed-stale',
                    projectOwnerId: PROJECT_OWNER_ID,
                    durabilityReceipt: receipt,
                    scope,
                })
            );
            await waitForHeldWrite(controls);
            api.cache({ bufferId: 'same-id', buffer: runtimeBuffer(0.75) });
            controls.releaseNextWriteSettlement();
            await waitForHeldWrite(controls);
            const cleanupScope = controls.transactionScopes().at(-1);
            controls.releaseNextWriteSettlement();
            expect(cleanupScope).toEqual([
                CHECKPOINT_RETENTION_STORE,
                CHECKPOINT_AUDIO_VERSION_STORE,
                CHECKPOINT_AUDIO_VERSION_META_STORE,
            ]);
            await expect(acquisition).resolves.toEqual({ status: 'superseded' });
            expect(controls.committedCheckpointRetentions.has('committed-stale')).toBe(false);
            expect(controls.committedCheckpointRetentions.get('stable-checkpoint')?.ownershipToken).toBe(
                stable.ownershipToken
            );
            expect(controls.committedCheckpointAudioVersions.has(versionKey('same-id'))).toBe(true);

            await waitForHeldWrite(controls);
            controls.releaseNextWriteSettlement();
            await flushIndexedDbTasks(2);
        } finally {
            receipt.release();
        }
    });

    it('reports exact committed ownership when stale-publication cleanup aborts', async () => {
        seedBuffer(controls, 'same-id', [0.25]);
        const api = await importApi();
        const receipt = await requireDurabilityReceipt(api, ['same-id']);
        controls.pauseWriteSettlements();
        try {
            const acquisition = api.withStorageLock(async (scope) => {
                const result = await api.acquire({
                    checkpointId: 'cleanup-failed',
                    projectOwnerId: PROJECT_OWNER_ID,
                    durabilityReceipt: receipt,
                    scope,
                });
                controls.allowWrites();
                return result;
            });
            await waitForHeldWrite(controls);
            api.cache({ bufferId: 'same-id', buffer: runtimeBuffer(0.75) });
            controls.abortWritesTo(CHECKPOINT_RETENTION_STORE);
            controls.releaseNextWriteSettlement();
            await waitForHeldWrite(controls);
            const cleanupScope = controls.transactionScopes().at(-1);
            controls.releaseNextWriteSettlement();
            expect(cleanupScope).toEqual([
                CHECKPOINT_RETENTION_STORE,
                CHECKPOINT_AUDIO_VERSION_STORE,
                CHECKPOINT_AUDIO_VERSION_META_STORE,
            ]);
            const result = await acquisition;
            expect(result).toEqual({ status: 'cleanup-failed', ownershipToken: expect.any(String) });
            if (result.status !== 'cleanup-failed') {
                throw new Error('Expected cleanup failure');
            }
            expect(controls.committedCheckpointRetentions.get('cleanup-failed')?.ownershipToken).toBe(
                result.ownershipToken
            );

            await waitForHeldWrite(controls);
            controls.releaseNextWriteSettlement();
            const wrongRelease = api.release({
                checkpointId: 'cleanup-failed',
                projectOwnerId: PROJECT_OWNER_ID,
                ownershipToken: 'wrong-token',
            });
            await waitForHeldWrite(controls);
            controls.releaseNextWriteSettlement();
            await expect(wrongRelease).resolves.toBe(false);
            expect(controls.committedCheckpointRetentions.has('cleanup-failed')).toBe(true);

            const exactRelease = api.release({
                checkpointId: 'cleanup-failed',
                projectOwnerId: PROJECT_OWNER_ID,
                ownershipToken: result.ownershipToken,
            });
            await waitForHeldWrite(controls);
            controls.releaseNextWriteSettlement();
            await expect(exactRelease).resolves.toBe(true);
            expect(controls.committedCheckpointRetentions.has('cleanup-failed')).toBe(false);
        } finally {
            controls.allowWrites();
            receipt.release();
        }
    });

    it('rejects missing or invalid PCM without publishing ownership', async () => {
        seedBuffer(controls, 'valid');
        seedBuffer(controls, 'invalid');
        controls.committedMeta.set('invalid', { lastAccessed: 100, sizeInBytes: 999 });
        const api = await importApi();

        await expect(api.ensure(['valid', 'missing'])).resolves.toEqual({ status: 'failed', failedIds: ['missing'] });
        await expect(api.ensure(['invalid'])).resolves.toEqual({ status: 'failed', failedIds: ['invalid'] });
        expect(controls.committedCheckpointRetentions.size).toBe(0);
    });

    it('rejects a one-sided existing version pair before writing any missing version', async () => {
        seedBuffer(controls, 'a-new');
        seedBuffer(controls, 'z-corrupt');
        controls.committedCheckpointAudioVersions.set(versionKey('z-corrupt'), {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.25])],
            sizeInBytes: 4,
        });
        const api = await importApi();
        const receipt = await requireDurabilityReceipt(api, ['a-new', 'z-corrupt']);
        try {
            await expect(
                api.withStorageLock((scope) =>
                    api.acquire({
                        checkpointId: 'corrupt-pair',
                        projectOwnerId: PROJECT_OWNER_ID,
                        durabilityReceipt: receipt,
                        scope,
                    })
                )
            ).rejects.toThrow(/incomplete/i);
            expect([...controls.committedCheckpointAudioVersions.keys()]).toEqual([versionKey('z-corrupt')]);
            expect(controls.committedCheckpointAudioVersionMeta.size).toBe(0);
            expect(controls.committedCheckpointRetentions.size).toBe(0);
        } finally {
            receipt.release();
        }
    });

    it('preserves valid identifier whitespace and refuses noncanonical version-key bytes', async () => {
        const spacedId = ' spaced ';
        seedBuffer(controls, spacedId);
        const api = await importApi();
        const ownership = await acquireCurrentRetention(api, {
            checkpointId: ' spaced-checkpoint ',
            projectOwnerId: ' spaced-owner ',
            bufferIds: [spacedId],
        });
        expect(controls.committedCheckpointRetentions.get(' spaced-checkpoint ')?.versionKeys).toEqual([
            versionKey(spacedId),
        ]);

        controls.committedCheckpointRetentions.set('noncanonical', {
            schemaVersion: 2,
            checkpointId: 'noncanonical',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: 'token',
            versionKeys: ['["spaced", "spaced-persistence"]'],
        });
        controls.failRequestsFrom(CHECKPOINT_AUDIO_VERSION_STORE);
        await expect(
            api.read({
                checkpointId: 'noncanonical',
                projectOwnerId: PROJECT_OWNER_ID,
                ownershipToken: 'token',
                expectedBufferIds: ['spaced'],
                audioContext: audioContext(),
            })
        ).resolves.toEqual({ status: 'refused' });
        controls.allowRequests();
        await expect(
            api.read({
                checkpointId: ' spaced-checkpoint ',
                projectOwnerId: ' spaced-owner ',
                ownershipToken: ownership.ownershipToken,
                expectedBufferIds: [spacedId],
                audioContext: audioContext(),
            })
        ).resolves.toMatchObject({ status: 'read' });
    });

    it('publishes no ownership when the acquisition transaction aborts', async () => {
        seedBuffer(controls, 'buffer-a');
        const api = await importApi();
        const receipt = await requireDurabilityReceipt(api, ['buffer-a']);
        try {
            controls.abortNextWrite();
            await expect(
                api.withStorageLock((scope) =>
                    api.acquire({
                        checkpointId: 'checkpoint-a',
                        projectOwnerId: PROJECT_OWNER_ID,
                        durabilityReceipt: receipt,
                        scope,
                    })
                )
            ).rejects.toThrow();
            expect(controls.transactionScopes().at(-1)).toEqual([
                BUFFER_STORE,
                META_STORE,
                CHECKPOINT_RETENTION_STORE,
                CHECKPOINT_AUDIO_VERSION_STORE,
                CHECKPOINT_AUDIO_VERSION_META_STORE,
            ]);
            expect(controls.committedCheckpointRetentions.size).toBe(0);
            expect(controls.committedCheckpointAudioVersions.size).toBe(0);
            expect(controls.committedCheckpointAudioVersionMeta.size).toBe(0);
        } finally {
            receipt.release();
        }
    });

    it('requires the exact owner and token to release durable ownership', async () => {
        seedBuffer(controls, 'buffer-a');
        const api = await importApi();
        const { release } = api;
        const ownership = await acquireCurrentRetention(api, {
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['buffer-a'],
        });

        await expect(
            release({
                checkpointId: 'checkpoint-a',
                projectOwnerId: 'other-project',
                ownershipToken: ownership.ownershipToken,
            })
        ).resolves.toBe(false);
        await expect(
            release({
                checkpointId: 'checkpoint-a',
                projectOwnerId: PROJECT_OWNER_ID,
                ownershipToken: 'stale-token',
            })
        ).resolves.toBe(false);
        expect(controls.committedCheckpointRetentions.has('checkpoint-a')).toBe(true);

        await expect(
            release({
                checkpointId: 'checkpoint-a',
                projectOwnerId: PROJECT_OWNER_ID,
                ownershipToken: ownership.ownershipToken,
            })
        ).resolves.toBe(true);
        await expect(
            release({
                checkpointId: 'checkpoint-a',
                projectOwnerId: PROJECT_OWNER_ID,
                ownershipToken: ownership.ownershipToken,
            })
        ).resolves.toBe(false);
    });

    it('retains a shared buffer until its last checkpoint owner releases it', async () => {
        seedBuffer(controls, 'shared');
        const api = await importApi();
        const { collectBySize, release } = api;
        const first = await acquireCurrentRetention(api, {
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['shared'],
        });
        const second = await acquireCurrentRetention(api, {
            checkpointId: 'checkpoint-b',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['shared'],
        });

        await release({
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: first.ownershipToken,
        });
        await expect(collectBySize({ maxSizeBytes: 0 })).resolves.toBe(0);
        expect(controls.committed.has('shared')).toBe(true);

        await release({
            checkpointId: 'checkpoint-b',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: second.ownershipToken,
        });
        await expect(collectBySize({ maxSizeBytes: 0 })).resolves.toBe(1);
        expect(controls.committed.has('shared')).toBe(false);
    });

    it('reserves each shared immutable version once before recovery and ordinary size collection', async () => {
        const api = await importApi();
        const seedEqualRecoveries = () => {
            controls.committedRecovery.clear();
            seedRecovery(controls, 'recovery-a', [0.5, 0.75]);
            seedRecovery(controls, 'recovery-b', [0.5, 0.75]);
        };
        let upperBudget = 1;
        seedEqualRecoveries();
        while ((await api.collectBySize({ maxSizeBytes: upperBudget })) !== 0) {
            upperBudget *= 2;
            seedEqualRecoveries();
        }
        let lowerBudget = 0;
        while (lowerBudget < upperBudget) {
            const candidateBudget = Math.floor((lowerBudget + upperBudget) / 2);
            seedEqualRecoveries();
            const deletedCount = await api.collectBySize({ maxSizeBytes: candidateBudget });
            if (deletedCount === 0) {
                upperBudget = candidateBudget;
            } else {
                lowerBudget = candidateBudget + 1;
            }
        }

        seedEqualRecoveries();
        seedBuffer(controls, 'shared', [0.25]);
        const sharedPcmByteLength = controls.committed.get('shared')?.channelData[0]?.byteLength;
        if (sharedPcmByteLength === undefined) {
            throw new Error('Expected seeded shared PCM');
        }
        expect(sharedPcmByteLength).toBe(4);
        await acquireCurrentRetention(api, { checkpointId: 'checkpoint-a', bufferIds: ['shared'] });
        await acquireCurrentRetention(api, { checkpointId: 'checkpoint-b', bufferIds: ['shared'] });

        await expect(api.collectBySize({ maxSizeBytes: upperBudget })).resolves.toBe(1);
        expect([...controls.committedRecovery.keys()]).toEqual(['recovery-b']);
        const survivingRecovery = controls.committedRecovery.get('recovery-b');
        expect(survivingRecovery).toMatchObject({
            id: 'recovery-b',
            revision: 'recovery-b-recovery',
            schemaVersion: 1,
        });
        expect(Array.from(survivingRecovery?.data?.channelData[0] ?? [])).toEqual([0.5, 0.75]);
        expect(controls.committed.has('shared')).toBe(true);
        expect(controls.committedCheckpointAudioVersions.size).toBe(1);
        expect(controls.committedCheckpointAudioVersionMeta.size).toBe(1);

        const ordinaryAlias = controls.committed.get('shared');
        const immutableVersion = controls.committedCheckpointAudioVersions.get(versionKey('shared'));
        const immutableMetadata = controls.committedCheckpointAudioVersionMeta.get(versionKey('shared'));
        seedEqualRecoveries();
        const expectedRecoveries = [...controls.committedRecovery.entries()];
        await expect(api.collectBySize({ maxSizeBytes: upperBudget + sharedPcmByteLength })).resolves.toBe(0);
        expect([...controls.committedRecovery.keys()]).toEqual(['recovery-a', 'recovery-b']);
        for (const [recoveryId, expectedRecovery] of expectedRecoveries) {
            if (typeof recoveryId !== 'string') {
                throw new TypeError('Expected a string recovery ID');
            }
            const recovery = controls.committedRecovery.get(recoveryId);
            expect(recovery).toBe(expectedRecovery);
            expect(recovery).toMatchObject({
                id: recoveryId,
                revision: `${recoveryId}-recovery`,
                schemaVersion: 1,
            });
            expect(Array.from(recovery?.data?.channelData[0] ?? [])).toEqual([0.5, 0.75]);
        }
        expect(controls.committed.get('shared')).toBe(ordinaryAlias);
        expect(controls.committedCheckpointAudioVersions.get(versionKey('shared'))).toBe(immutableVersion);
        expect(controls.committedCheckpointAudioVersionMeta.get(versionKey('shared'))).toBe(immutableMetadata);
        expect([...controls.committedCheckpointAudioVersions.keys()]).toEqual([versionKey('shared')]);
        expect([...controls.committedCheckpointAudioVersionMeta.keys()]).toEqual([versionKey('shared')]);
    });

    it('holds the named lock from immutable census through acquire and release admission', async () => {
        seedBuffer(controls, 'shared', [0.25]);
        const api = await importApi();
        const first = await acquireCurrentRetention(api, { checkpointId: 'checkpoint-a', bufferIds: ['shared'] });
        const receipt = await requireDurabilityReceipt(api, ['shared']);
        controls.pauseReadonlySettlements();
        let collectionSettled = false;
        const collection = api.collectBySize({ maxSizeBytes: 8 }).then((result) => {
            collectionSettled = true;
            return result;
        });
        await waitForHeldReadonly(controls);

        let releaseSettled = false;
        const release = api
            .release({
                checkpointId: 'checkpoint-a',
                projectOwnerId: PROJECT_OWNER_ID,
                ownershipToken: first.ownershipToken,
            })
            .then((result) => {
                releaseSettled = true;
                return result;
            });
        let acquisitionSettled = false;
        const acquisition = api
            .withStorageLock((scope) =>
                api.acquire({
                    checkpointId: 'checkpoint-b',
                    projectOwnerId: PROJECT_OWNER_ID,
                    durabilityReceipt: receipt,
                    scope,
                })
            )
            .then((result) => {
                acquisitionSettled = true;
                return result;
            });
        expect(releaseSettled).toBe(false);
        expect(acquisitionSettled).toBe(false);

        controls.releaseNextReadonlySettlement();
        await vi.waitFor(() => {
            if (controls.pendingReadonlySettlementCount() > 0) {
                controls.releaseNextReadonlySettlement();
            }
            expect(collectionSettled).toBe(true);
        });
        await expect(collection).resolves.toBe(0);
        await expect(release).resolves.toBe(true);
        await expect(acquisition).resolves.toEqual({ status: 'retained', ownershipToken: expect.any(String) });
        receipt.release();
    });

    it('refuses immutable census corruption before deleting recovery PCM', async () => {
        seedRecovery(controls, 'recoverable', [0.5, 0.75]);
        const malformedKey = JSON.stringify(['broken', 'revision']);
        controls.committedCheckpointAudioVersions.set(malformedKey, {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.25])],
            sizeInBytes: 4,
        });
        const api = await importApi();

        await expect(api.collectBySize({ maxSizeBytes: 0 })).resolves.toBe(0);
        expect(controls.committedRecovery.has('recoverable')).toBe(true);
        expect(mocks.loggerWarn).toHaveBeenCalled();
    });

    it('preserves retained ordinary and freeze PCM through every deletion route and module restart', async () => {
        const retainedIds = ['freeze-retained', 'age-retained', 'size-retained', 'remove-retained', 'clear-retained'];
        for (const id of retainedIds) {
            seedBuffer(controls, id, [0.25], id.startsWith('freeze-') ? 200 : undefined);
        }
        seedBuffer(controls, 'freeze-control', [0.5], 200);
        seedBuffer(controls, 'age-control');
        const api = await importApi();
        await acquireCurrentRetention(api, {
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: retainedIds,
        });

        await api.collectFreeze({ activeBufferIds: new Set(), projectId: 200 });
        expect(controls.committed.has('freeze-control')).toBe(false);
        expect(controls.committed.has('freeze-retained')).toBe(true);

        vi.spyOn(Date, 'now').mockReturnValue(10_000_000_000);
        await api.collectByAge({ maxAgeDays: 1 });
        expect(controls.committed.has('age-control')).toBe(false);
        expect(controls.committed.has('age-retained')).toBe(true);

        seedBuffer(controls, 'size-control');
        expect(controls.committed.has('size-control')).toBe(true);
        await api.collectBySize({ maxSizeBytes: 0 });
        expect(controls.committed.has('size-control')).toBe(false);
        expect(controls.committed.has('size-retained')).toBe(true);

        seedBuffer(controls, 'remove-control');
        expect(controls.committed.has('remove-control')).toBe(true);
        api.remove('remove-retained');
        api.remove('remove-control');
        await flushIndexedDbTasks();
        expect(controls.committed.has('remove-control')).toBe(false);
        expect(controls.committed.has('remove-retained')).toBe(true);

        seedBuffer(controls, 'clear-control');
        expect(controls.committed.has('clear-control')).toBe(true);
        api.clear();
        await flushIndexedDbTasks();
        expect(controls.committed.has('clear-control')).toBe(false);
        expect(retainedIds.every((id) => controls.committed.has(id) && controls.committedMeta.has(id))).toBe(true);

        vi.resetModules();
        const restarted = await importApi();
        seedBuffer(controls, 'restart-size-control');
        await restarted.collectBySize({ maxSizeBytes: 0 });
        expect(controls.committed.has('restart-size-control')).toBe(false);
        expect(retainedIds.every((id) => controls.committed.has(id) && controls.committedMeta.has(id))).toBe(true);
        const prepared = await restarted.prepare({ audioContext: audioContext(), bufferIds: retainedIds });
        expect(prepared).not.toBeNull();
        expect(prepared?.publish()).toBe(retainedIds.length);
    });

    it('fails every deletion route closed when a retention row is invalid', async () => {
        const ids = ['freeze-candidate', 'age-candidate', 'size-candidate', 'remove-candidate', 'clear-candidate'];
        for (const id of ids) {
            seedBuffer(controls, id, [0.25], id.startsWith('freeze-') ? 200 : undefined);
        }
        controls.committedCheckpointRetentions.set('invalid', {
            schemaVersion: 2,
            checkpointId: 'invalid',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: 'token',
            versionKeys: ['not-sorted', 'also-not-sorted'],
        });
        const api = await importApi();

        await api.collectFreeze({ activeBufferIds: new Set(), projectId: 200 });
        await expect(api.collectByAge({ maxAgeDays: -1 })).resolves.toBe(0);
        await expect(api.collectBySize({ maxSizeBytes: 0 })).resolves.toBe(0);
        api.remove('remove-candidate');
        api.clear();
        await flushIndexedDbTasks();

        expect(ids.every((id) => controls.committed.has(id) && controls.committedMeta.has(id))).toBe(true);
        expect(mocks.loggerWarn).toHaveBeenCalled();
    });

    it('fails deletion closed when a retention row contains a sparse buffer list', async () => {
        seedBuffer(controls, 'candidate');
        controls.committedCheckpointRetentions.set('sparse', {
            schemaVersion: 2,
            checkpointId: 'sparse',
            projectOwnerId: PROJECT_OWNER_ID,
            ownershipToken: 'token',
            versionKeys: sparseBufferIds(),
        });
        const { collectBySize } = await importApi();

        await expect(collectBySize({ maxSizeBytes: 0 })).resolves.toBe(0);
        expect(controls.committed.has('candidate')).toBe(true);
        expect(controls.committedMeta.has('candidate')).toBe(true);
        expect(mocks.loggerWarn).toHaveBeenCalled();
    });

    it('fails deletion closed when retention ownership cannot be read', async () => {
        seedBuffer(controls, 'candidate');
        controls.failRequestsFrom(CHECKPOINT_RETENTION_STORE);
        const { collectByAge } = await importApi();

        await expect(collectByAge({ maxAgeDays: -1 })).resolves.toBe(0);
        expect(controls.committed.has('candidate')).toBe(true);
        expect(controls.committedMeta.has('candidate')).toBe(true);
        expect(mocks.loggerWarn).toHaveBeenCalled();
    });

    it('refuses acquisition when a collector commits first on another connection', async () => {
        seedBuffer(controls, 'freeze-candidate', [0.25], 200);
        controls.pauseWriteSettlements();
        const firstConnection = await importApi();
        const collection = firstConnection.collectFreeze({ activeBufferIds: new Set(), projectId: 200 });
        await waitForHeldWrite(controls);

        vi.resetModules();
        const secondConnection = await importApi();
        const durability = secondConnection.ensure(['freeze-candidate']);

        controls.releaseNextWriteSettlement();
        await expect(collection).resolves.toBeUndefined();
        await expect(durability).resolves.toEqual({ status: 'failed', failedIds: ['freeze-candidate'] });
        expect(controls.committedCheckpointRetentions.size).toBe(0);
    });

    it('preserves PCM when acquisition commits first and a collector follows on another connection', async () => {
        seedBuffer(controls, 'freeze-candidate', [0.25], 200);
        const firstConnection = await importApi();
        const durabilityReceipt = await requireDurabilityReceipt(firstConnection, ['freeze-candidate']);
        try {
            controls.pauseWriteSettlements();
            const acquisition = firstConnection.withStorageLock((scope) =>
                firstConnection.acquire({
                    checkpointId: 'checkpoint-a',
                    projectOwnerId: PROJECT_OWNER_ID,
                    durabilityReceipt,
                    scope,
                })
            );
            await waitForHeldWrite(controls);

            vi.resetModules();
            const secondConnection = await importApi();
            const collection = secondConnection.collectFreeze({ activeBufferIds: new Set(), projectId: 200 });

            controls.releaseNextWriteSettlement();
            await expect(acquisition).resolves.toEqual({ status: 'retained', ownershipToken: expect.any(String) });
            await waitForHeldWrite(controls);
            controls.releaseNextWriteSettlement();
            await expect(collection).resolves.toBeUndefined();
            expect(controls.committed.has('freeze-candidate')).toBe(true);
        } finally {
            durabilityReceipt.release();
        }
    });
});
