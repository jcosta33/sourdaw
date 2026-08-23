import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    BUFFER_STORE,
    flushIndexedDbTasks,
    installFakeAudioIndexedDb,
    META_STORE,
    RECOVERY_STORE,
    type StoredAudioBuffer,
    type StoredBufferMeta,
    type StoredRecoveryValue,
} from './fakeAudioBufferIndexedDb';
import {
    createAudioBuffer,
    createTestContext,
    encodeFloat32,
    installTestAudioBufferConstructor,
} from './preparedAudioBufferTestSupport';

let audioBufferCache: typeof import('../audioBufferCache').audioBufferCache;
let clearRuntimeAudioBufferCache: typeof import('../audioBufferCache').clearRuntimeAudioBufferCache;
let reclaimPreparedBufferOrphans: typeof import('../audioBufferCache').reclaimPreparedBufferOrphans;

beforeEach(async () => {
    vi.resetModules();
    installTestAudioBufferConstructor();
    ({ audioBufferCache, clearRuntimeAudioBufferCache, reclaimPreparedBufferOrphans } =
        await import('../audioBufferCache'));
});

afterEach(() => {
    audioBufferCache.clear();
    vi.unstubAllGlobals();
});

describe('prepared audio-buffer recovery and project admission', () => {
    it('upgrades a pre-existing v2 database before using the v3 recovery store', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE, META_STORE] });
        const source = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        source.getChannelData(0)[0] = 0.375;

        await expect(
            audioBufferCache.persistPreparedBuffer({
                id: 'v2-to-v3-prepared-buffer',
                buffer: source,
                leaseId: 'v2-to-v3-prepared-lease',
            })
        ).resolves.toEqual({
            status: 'persisted',
            bufferId: 'v2-to-v3-prepared-buffer',
            leaseId: 'v2-to-v3-prepared-lease',
        });
        expect(controls.storeNames()).toContain(RECOVERY_STORE);
    });

    it('does not open recovery storage after cancellation and degrades recovery read failure to zero publication', async () => {
        const controls = installFakeAudioIndexedDb();
        const context = createTestContext(vi.fn());

        await expect(
            audioBufferCache.prepareFromIdb({ context, ids: ['cancelled-recovery'], shouldContinue: () => false })
        ).resolves.toBeNull();
        expect(controls.openRequestCount()).toBe(0);

        controls.failRequestsFrom(META_STORE);
        await expect(audioBufferCache.restoreFromIdb({ context, ids: ['storage-failure-recovery'] })).resolves.toBe(0);
        expect(context.createBuffer).not.toHaveBeenCalled();
    });

    it('keeps historic prefixed ordinary IDs reachable while migrating only identified legacy recovery rows', async () => {
        const controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE],
            pendingLegacyRecoveryMigration: true,
        });
        const historicId = '\u0000sourdaw-prepared-recovery:historic-user-buffer';
        const recoveredId = 'legacy-recovery-project-buffer';
        const legacyRecoveryKey = `\u0000sourdaw-prepared-recovery:${recoveredId}`;
        const stored = (sample: number): StoredAudioBuffer => ({
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([sample])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        const historicMeta: StoredBufferMeta = { lastAccessed: 1, sizeInBytes: 4 };
        const recoveredMeta: StoredBufferMeta = {
            lastAccessed: 1,
            preparedOwner: {
                schemaVersion: 1,
                createdAtMs: 1,
                leaseId: 'legacy-recovery-lease',
                persistenceRevision: 'legacy-persistence-revision',
                status: 'temporary',
            },
            sizeInBytes: 4,
        };
        controls.committed.set(historicId, stored(0.25));
        controls.committedMeta.set(historicId, historicMeta);
        controls.committed.set(legacyRecoveryKey, stored(0.75));
        controls.committedMeta.set(legacyRecoveryKey, {
            id: recoveredId,
            metadata: recoveredMeta,
            operation: 'discard',
            revision: 'legacy-recovery-revision',
            schemaVersion: 1,
        } as unknown as StoredBufferMeta);
        const context = createTestContext(
            vi.fn((_channels: number, length: number, sampleRate: number) => createAudioBuffer({ length, sampleRate }))
        );

        await expect(audioBufferCache.restoreFromIdb({ context, ids: [historicId, recoveredId] })).resolves.toBe(2);
        expect(audioBufferCache.get(historicId)?.getChannelData(0)[0]).toBeCloseTo(0.25);
        expect(audioBufferCache.get(recoveredId)?.getChannelData(0)[0]).toBeCloseTo(0.75);
        expect(controls.committed.get(historicId)).toEqual(stored(0.25));
        expect(controls.committedMeta.get(historicId)).toEqual(historicMeta);
        expect(controls.committed.get(recoveredId)?.channelData[0]?.[0]).toBeCloseTo(0.75);
        expect(controls.committedMeta.get(recoveredId)).toEqual({
            ...recoveredMeta,
            preparedOwner: { ...recoveredMeta.preparedOwner!, status: 'project-owned' },
        });
        expect(controls.committed.has(legacyRecoveryKey)).toBe(false);
        expect(controls.committedMeta.has(legacyRecoveryKey)).toBe(false);
    });

    it('retains a mismatched legacy recovery key without touching its embedded target ID', async () => {
        const controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE],
            pendingLegacyRecoveryMigration: true,
        });
        const targetId = 'mismatched-legacy-target';
        const mismatchedKey = '\u0000sourdaw-prepared-recovery:different-id';
        const stored: StoredAudioBuffer = {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.875])],
            lastAccessed: 1,
            sizeInBytes: 4,
        };
        controls.committed.set(mismatchedKey, stored);
        controls.committedMeta.set(mismatchedKey, {
            id: targetId,
            metadata: {
                lastAccessed: 1,
                preparedOwner: {
                    schemaVersion: 1,
                    leaseId: 'mismatched-legacy-lease',
                    persistenceRevision: 'mismatched-legacy-persistence',
                    status: 'temporary',
                },
                sizeInBytes: 4,
            },
            operation: 'discard',
            revision: 'mismatched-legacy-revision',
            schemaVersion: 1,
        } as unknown as StoredBufferMeta);
        const context = createTestContext(vi.fn());

        await expect(audioBufferCache.restoreFromIdb({ context, ids: [targetId] })).resolves.toBe(0);
        expect(controls.committed.get(mismatchedKey)).toEqual(stored);
        expect(controls.committedMeta.has(mismatchedKey)).toBe(true);
        expect(controls.committed.has(targetId)).toBe(false);
        expect(controls.committedMeta.has(targetId)).toBe(false);
        expect(controls.committedRecovery.has(targetId)).toBe(false);
    });

    it('retries legacy recovery migration after its first transaction aborts', async () => {
        const controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE],
            pendingLegacyRecoveryMigration: true,
        });
        const id = 'retry-legacy-migration';
        const legacyKey = `\u0000sourdaw-prepared-recovery:${id}`;
        controls.committed.set(legacyKey, {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.625])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        controls.committedMeta.set(legacyKey, {
            id,
            metadata: {
                lastAccessed: 1,
                preparedOwner: {
                    schemaVersion: 1,
                    leaseId: 'retry-legacy-lease',
                    persistenceRevision: 'retry-legacy-persistence',
                    status: 'temporary',
                },
                sizeInBytes: 4,
            },
            operation: 'discard',
            revision: 'retry-legacy-revision',
            schemaVersion: 1,
        } as unknown as StoredBufferMeta);
        controls.abortNextWrite();
        const firstContext = createTestContext(vi.fn());

        await expect(audioBufferCache.restoreFromIdb({ context: firstContext, ids: [id] })).resolves.toBe(0);
        expect(controls.committed.has(legacyKey)).toBe(true);
        expect(controls.committedRecovery.has(id)).toBe(false);

        vi.resetModules();
        ({ audioBufferCache } = await import('../audioBufferCache'));
        const secondContext = createTestContext(
            vi.fn((_channels: number, length: number, sampleRate: number) => createAudioBuffer({ length, sampleRate }))
        );
        await expect(audioBufferCache.restoreFromIdb({ context: secondContext, ids: [id] })).resolves.toBe(1);
        expect(audioBufferCache.get(id)?.getChannelData(0)[0]).toBeCloseTo(0.625);
        expect(controls.committed.has(legacyKey)).toBe(false);
        expect(controls.committedRecovery.has(id)).toBe(false);
    });

    it('accepts prefixed ordinary set, import, and project IDs without touching isolated recovery', async () => {
        const controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE],
        });
        const setId = '\u0000sourdaw-prepared-recovery:ordinary-set';
        const importId = '\u0000sourdaw-prepared-recovery:ordinary-import';
        controls.committedRecovery.set('reserved-project-buffer', {
            data: {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.9])],
                lastAccessed: 1,
                sizeInBytes: 4,
            },
            id: 'reserved-project-buffer',
            metadata: {
                lastAccessed: 1,
                preparedOwner: {
                    schemaVersion: 1,
                    leaseId: 'reserved-project-lease',
                    persistenceRevision: 'reserved-project-persistence',
                    status: 'temporary',
                },
                sizeInBytes: 4,
            },
            operation: 'discard',
            revision: 'unrelated-recovery',
            schemaVersion: 1,
            stagedAtMs: 1,
        });
        const setBuffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        setBuffer.getChannelData(0)[0] = 0.4;
        audioBufferCache.set(setId, setBuffer);
        await flushIndexedDbTasks();

        const imported = audioBufferCache.importBuffers({
            buffers: {
                [importId]: {
                    sampleRate: 48_000,
                    numberOfChannels: 1,
                    channelData: [encodeFloat32([0.6])],
                },
            },
            cacheIds: [importId],
            context: createTestContext(
                vi.fn((_channels: number, length: number, sampleRate: number) =>
                    createAudioBuffer({ length, sampleRate })
                )
            ),
        });
        expect(imported?.publish()).toBe(1);
        await expect(imported?.persist()).resolves.toBe(true);

        await expect(audioBufferCache.exportBuffers([setId, importId])).resolves.toMatchObject({
            [setId]: { channelData: [encodeFloat32([0.4])] },
            [importId]: { channelData: [encodeFloat32([0.6])] },
        });
        expect(controls.committedRecovery.get('reserved-project-buffer')?.id).toBe('reserved-project-buffer');
    });

    it('accounts recovery PCM against quota and collects stale malformed rows without deleting project reservations', async () => {
        const controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE],
        });
        const recovery = (id: string, revision: string, sample: number, stagedAtMs: number) => ({
            data: {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([sample])],
                lastAccessed: stagedAtMs,
                sizeInBytes: 4,
            },
            id,
            metadata: {
                lastAccessed: stagedAtMs,
                preparedOwner: {
                    schemaVersion: 1 as const,
                    leaseId: `${id}-lease`,
                    persistenceRevision: `${id}-persistence`,
                    status: 'temporary' as const,
                },
                sizeInBytes: 4,
            },
            operation: 'discard' as const,
            revision,
            schemaVersion: 1 as const,
            stagedAtMs,
        });
        controls.committedRecovery.set('quota-buffer', recovery('quota-buffer', 'quota-recovery', 0.25, 1));
        controls.committed.set('recent-ordinary', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.5])],
            lastAccessed: 10_000,
            sizeInBytes: 4,
        });
        controls.committedMeta.set('recent-ordinary', { lastAccessed: 10_000, sizeInBytes: 4 });

        await expect(audioBufferCache.garbageCollectBySize(4)).resolves.toBe(1);
        expect(controls.committedRecovery.has('quota-buffer')).toBe(false);
        expect(controls.committed.has('recent-ordinary')).toBe(true);

        controls.committedRecovery.set('partial-buffer', {
            id: 'partial-buffer',
            revision: 'partial-recovery',
            schemaVersion: 1,
            stagedAtMs: 1,
        });
        controls.committedRecovery.set('reserved-buffer', recovery('reserved-buffer', 'reserved-recovery', 0.75, 1));
        const project = audioBufferCache.importBuffers({
            buffers: {},
            cacheIds: ['reserved-buffer'],
            context: createTestContext(vi.fn()),
        });
        expect(project?.publish()).toBe(0);

        vi.spyOn(Date, 'now').mockReturnValue(10_000);
        await expect(audioBufferCache.garbageCollectByAge(0)).resolves.toBe(1);
        expect(controls.committedRecovery.has('partial-buffer')).toBe(false);
        expect(controls.committedRecovery.has('reserved-buffer')).toBe(true);

        controls.committedRecovery.set('markerless-pcm', new Float32Array([0.125, 0.25]));
        await expect(audioBufferCache.garbageCollectBySize(0)).resolves.toBe(2);
        expect(controls.committedRecovery.has('markerless-pcm')).toBe(false);
        expect(controls.committedRecovery.has('reserved-buffer')).toBe(true);
        expect(controls.committedRecovery.has(0)).toBe(true);
    });

    it('uses the recovery-store key for project protection instead of borrowing the payload ID', async () => {
        const controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE],
        });
        const recovery = (id: string) => ({
            data: {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.5])],
                lastAccessed: 1,
                sizeInBytes: 4,
            },
            id,
            metadata: {
                lastAccessed: 1,
                preparedOwner: {
                    schemaVersion: 1 as const,
                    leaseId: `${id}-lease`,
                    persistenceRevision: `${id}-persistence`,
                    status: 'temporary' as const,
                },
                sizeInBytes: 4,
            },
            operation: 'discard' as const,
            revision: `${id}-recovery`,
            schemaVersion: 1 as const,
            stagedAtMs: 1,
        });
        controls.committedRecovery.set('unpinned-key', recovery('pinned-payload-id'));
        controls.committedRecovery.set('pinned-key', recovery('unpinned-payload-id'));
        const project = audioBufferCache.importBuffers({
            buffers: {},
            cacheIds: ['pinned-payload-id', 'pinned-key'],
            context: createTestContext(vi.fn()),
        });
        expect(project?.publish()).toBe(0);

        vi.spyOn(Date, 'now').mockReturnValue(10_000);
        await expect(audioBufferCache.garbageCollectByAge(0)).resolves.toBe(1);
        expect(controls.committedRecovery.has('unpinned-key')).toBe(false);
        expect(controls.committedRecovery.get('pinned-key')).toEqual(recovery('unpinned-payload-id'));
    });

    it('restores an exact recovery deleted just before the project reserves its key', async () => {
        const controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE],
        });
        const id = 'after-commit-project-reservation';
        const recovery = {
            data: {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.625])],
                lastAccessed: 1,
                sizeInBytes: 4,
            },
            id,
            metadata: {
                lastAccessed: 1,
                preparedOwner: {
                    schemaVersion: 1 as const,
                    leaseId: `${id}-lease`,
                    persistenceRevision: `${id}-persistence`,
                    status: 'temporary' as const,
                },
                sizeInBytes: 4,
            },
            operation: 'discard' as const,
            revision: `${id}-recovery`,
            schemaVersion: 1 as const,
            stagedAtMs: 1,
        };
        controls.committedRecovery.set(id, recovery);
        controls.pauseWriteSettlements();
        const collection = audioBufferCache.garbageCollectBySize(0);
        let collectionSettled = false;
        void collection.then(
            () => {
                collectionSettled = true;
            },
            () => {
                collectionSettled = true;
            }
        );
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.releaseNextWriteSettlement();
        const project = audioBufferCache.importBuffers({
            buffers: {},
            cacheIds: [id],
            context: createTestContext(vi.fn()),
        });
        expect(project?.publish()).toBe(0);
        for (let turn = 0; turn < 40 && !collectionSettled; turn++) {
            if (controls.pendingWriteSettlementCount() > 0) {
                controls.releaseNextWriteSettlement();
            }
            await flushIndexedDbTasks(1);
        }

        await expect(collection).resolves.toBe(0);
        expect(JSON.stringify(controls.committedRecovery.get(id))).toBe(JSON.stringify(recovery));
        expect(controls.committedRecovery.get(id)?.data?.channelData[0]?.[0]).toBeCloseTo(0.625);
    });

    it('charges structured-clone containers against recovery quota without looping on cycles', async () => {
        const controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE],
        });
        const cyclic = new Map<unknown, unknown>();
        const nestedSet = new Set<unknown>([new Uint8Array([1, 2, 3]), cyclic]);
        cyclic.set('nested', nestedSet);
        cyclic.set('self', cyclic);
        controls.committedRecovery.set('array-buffer-container', new ArrayBuffer(16) as unknown as StoredRecoveryValue);
        controls.committedRecovery.set('blob-container', new Blob(['recovery']) as unknown as StoredRecoveryValue);
        controls.committedRecovery.set('map-set-cycle', cyclic as unknown as StoredRecoveryValue);

        await expect(audioBufferCache.garbageCollectBySize(0)).resolves.toBe(3);
        expect(controls.committedRecovery.has('array-buffer-container')).toBe(false);
        expect(controls.committedRecovery.has('blob-container')).toBe(false);
        expect(controls.committedRecovery.has('map-set-cycle')).toBe(false);
    });

    it('rejects temporary reopen after the project reserves the exact buffer ID', async () => {
        const controls = installFakeAudioIndexedDb();
        const id = 'project-reserved-reopen';
        const leaseId = `${id}-lease`;
        await audioBufferCache.persistPreparedBuffer({
            id,
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            leaseId,
        });
        clearRuntimeAudioBufferCache();
        const project = audioBufferCache.importBuffers({
            buffers: {},
            cacheIds: [id],
            context: createTestContext(vi.fn()),
        });
        expect(project?.publish()).toBe(0);
        const createBuffer = vi.fn((_channels: number, length: number, sampleRate: number) =>
            createAudioBuffer({ length, sampleRate })
        );

        await expect(
            audioBufferCache.reopenPreparedBuffer({ id, leaseId, context: createTestContext(createBuffer) })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio buffer ID is reserved by the project.',
        });
        expect(createBuffer).not.toHaveBeenCalled();
        expect(audioBufferCache.has(id)).toBe(false);
        expect(controls.committed.has(id)).toBe(true);
        expect(controls.committedMeta.get(id)?.preparedOwner?.status).toBe('temporary');
    });

    it.each(['age', 'size'] as const)(
        'pins a buffer promoted after non-lease preparation through %s collection',
        async (collector) => {
            const controls = installFakeAudioIndexedDb();
            const id = `delayed-pin-${collector}`;
            const leaseId = `delayed-pin-${collector}-lease`;
            await audioBufferCache.persistPreparedBuffer({
                id,
                buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
                leaseId,
            });
            const prepared = await audioBufferCache.prepareFromIdb({
                context: createTestContext(
                    vi.fn((_channels: number, length: number, sampleRate: number) =>
                        createAudioBuffer({ length, sampleRate })
                    )
                ),
                ids: [id],
            });
            await expect(
                audioBufferCache.releasePreparedBuffer({ id, leaseId, disposition: 'project-owned' })
            ).resolves.toEqual({ status: 'released', disposition: 'project-owned' });

            expect(prepared?.publish()).toBe(0);
            if (collector === 'age') {
                await audioBufferCache.garbageCollectByAge(-1);
            } else {
                await audioBufferCache.garbageCollectBySize(0);
            }

            expect(controls.committed.has(id)).toBe(true);
            expect(controls.committedMeta.get(id)?.preparedOwner?.status).toBe('project-owned');
            expect(audioBufferCache.has(id)).toBe(true);
        }
    );

    it.each(['age', 'size'] as const)(
        'preserves crash-left promotion recovery through %s collection while collecting ordinary PCM',
        async (collector) => {
            const controls = installFakeAudioIndexedDb();
            const id = `crash-left-promotion-${collector}`;
            const leaseId = `${id}-lease`;
            const ordinaryId = `ordinary-collection-${collector}`;
            const invalidOwnerId = `invalid-owner-collection-${collector}`;
            const storedBuffer = (sample: number) => ({
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([sample])],
                lastAccessed: 1,
                sizeInBytes: 4,
            });
            controls.committed.set(id, storedBuffer(0.25));
            controls.committedMeta.set(id, {
                lastAccessed: 1,
                preparedOwner: {
                    schemaVersion: 1,
                    createdAtMs: 1,
                    leaseId,
                    promotionRevision: `${id}-promotion`,
                    status: 'project-owned',
                },
                sizeInBytes: 4,
            });
            controls.committed.set(ordinaryId, storedBuffer(0.5));
            controls.committedMeta.set(ordinaryId, { lastAccessed: 1, sizeInBytes: 4 });
            controls.committed.set(invalidOwnerId, storedBuffer(0.75));
            controls.committedMeta.set(invalidOwnerId, {
                lastAccessed: 1,
                preparedOwner: {
                    schemaVersion: 1,
                    leaseId: `${invalidOwnerId}-lease`,
                    promotionRevision: 42 as unknown as string,
                    status: 'project-owned',
                },
                sizeInBytes: 4,
            });

            vi.spyOn(Date, 'now').mockReturnValue(10_000_000_000);
            const deleted =
                collector === 'age'
                    ? await audioBufferCache.garbageCollectByAge(1)
                    : await audioBufferCache.garbageCollectBySize(8);

            expect(deleted).toBe(1);
            expect(controls.committed.has(ordinaryId)).toBe(false);
            expect(controls.committedMeta.has(ordinaryId)).toBe(false);
            expect(controls.committed.has(id)).toBe(true);
            expect(controls.committedMeta.get(id)?.preparedOwner).toMatchObject({
                leaseId,
                promotionRevision: `${id}-promotion`,
                status: 'project-owned',
            });
            expect(controls.committed.has(invalidOwnerId)).toBe(true);
            expect(controls.committedMeta.has(invalidOwnerId)).toBe(true);

            await expect(
                audioBufferCache.reopenPreparedBuffer({
                    id,
                    leaseId,
                    context: createTestContext(
                        vi.fn((_channels: number, length: number, sampleRate: number) =>
                            createAudioBuffer({ length, sampleRate })
                        )
                    ),
                })
            ).resolves.toEqual({ status: 'reopened', bufferId: id, ownership: 'temporary' });
            expect(controls.committed.get(id)?.channelData[0]?.[0]).toBe(0.25);
            expect(controls.committedMeta.get(id)?.preparedOwner).toMatchObject({
                leaseId,
                status: 'temporary',
            });
            expect(controls.committedMeta.get(id)?.preparedOwner?.promotionRevision).toBeUndefined();
            expect(audioBufferCache.has(id)).toBe(true);
        }
    );

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'rejects non-finite orphan cutoff %s before opening storage',
        async (createdBeforeMs) => {
            const controls = installFakeAudioIndexedDb();
            await expect(reclaimPreparedBufferOrphans({ createdBeforeMs, liveLeaseIds: [] })).resolves.toEqual({
                status: 'failed',
                reason: 'Prepared audio orphan cutoff is invalid.',
            });
            expect(controls.openRequestCount()).toBe(0);
        }
    );

    it('treats whitespace-only durable lease metadata as invalid and never reclaims it', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.committed.set('invalid-whitespace-owner', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.25])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        controls.committedMeta.set('invalid-whitespace-owner', {
            lastAccessed: 1,
            preparedOwner: { schemaVersion: 1, createdAtMs: 1, leaseId: '   ', status: 'temporary' },
            sizeInBytes: 4,
        });

        await expect(reclaimPreparedBufferOrphans({ createdBeforeMs: 2, liveLeaseIds: [] })).resolves.toEqual({
            status: 'reclaimed',
            count: 0,
        });
        await expect(
            audioBufferCache.reopenPreparedBuffer({
                id: 'invalid-whitespace-owner',
                leaseId: '   ',
                context: createTestContext(vi.fn()),
            })
        ).resolves.toMatchObject({ status: 'failed' });
        expect(controls.committed.has('invalid-whitespace-owner')).toBe(true);
    });

    it('aborts an orphan reclaim when the project admits the exact ID before commit', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.committed.set('reclaim-project-race', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.25])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        controls.committedMeta.set('reclaim-project-race', {
            lastAccessed: 1,
            preparedOwner: {
                schemaVersion: 1,
                createdAtMs: 1,
                leaseId: 'reclaim-project-lease',
                status: 'temporary',
            },
            sizeInBytes: 4,
        });
        controls.pauseWriteSettlements();
        const reclaim = reclaimPreparedBufferOrphans({ createdBeforeMs: 2, liveLeaseIds: [] });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        const project = audioBufferCache.importBuffers({
            buffers: {},
            cacheIds: ['reclaim-project-race'],
            context: createTestContext(vi.fn()),
        });
        expect(project?.publish()).toBe(0);
        controls.releaseNextWriteSettlement();

        await expect(reclaim).resolves.toMatchObject({ status: 'failed' });
        expect(controls.committed.has('reclaim-project-race')).toBe(true);
        expect(controls.committedMeta.has('reclaim-project-race')).toBe(true);
    });

    it('reconciles a committed orphan deletion when project admission lands after commit', async () => {
        const controls = installFakeAudioIndexedDb();
        const id = 'reclaim-after-commit-project-race';
        const leaseId = `${id}-lease`;
        controls.committed.set(id, {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.375])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        controls.committedMeta.set(id, {
            lastAccessed: 1,
            preparedOwner: { schemaVersion: 1, createdAtMs: 1, leaseId, status: 'temporary' },
            sizeInBytes: 4,
        });
        controls.pauseWriteSettlements();
        let reclaimSettled = false;
        const reclaim = reclaimPreparedBufferOrphans({ createdBeforeMs: 2, liveLeaseIds: [] }).then((result) => {
            reclaimSettled = true;
            return result;
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.releaseNextWriteSettlement();
        const project = audioBufferCache.importBuffers({
            buffers: {},
            cacheIds: [id],
            context: createTestContext(vi.fn()),
        });
        expect(project?.publish()).toBe(0);
        for (let turn = 0; turn < 40 && !reclaimSettled; turn++) {
            if (controls.pendingWriteSettlementCount() > 0) {
                controls.releaseNextWriteSettlement();
            }
            await flushIndexedDbTasks(1);
        }

        await expect(reclaim).resolves.toEqual({ status: 'reclaimed', count: 0 });
        expect(controls.committed.get(id)?.channelData[0]?.[0]).toBe(0.375);
        expect(controls.committedMeta.get(id)?.preparedOwner).toMatchObject({ leaseId, status: 'project-owned' });
    });
});
