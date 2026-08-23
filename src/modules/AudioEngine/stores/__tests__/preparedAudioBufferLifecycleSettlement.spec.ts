import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    BUFFER_STORE,
    flushIndexedDbTasks,
    installFakeAudioIndexedDb,
    META_STORE,
    RECOVERY_STORE,
    type StoredBufferMeta,
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

const malformedPreparedMetadataCases: ReadonlyArray<[string, (metadata: StoredBufferMeta) => void]> = [
    ['non-finite last-access time', (metadata) => (metadata.lastAccessed = Number.NaN)],
    ['mismatched byte size', (metadata) => (metadata.sizeInBytes += 4)],
    ['invalid freeze-project ID', (metadata) => (metadata.freezeProjectId = -1)],
];

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

describe('prepared audio-buffer settlement and recovery', () => {
    it('rejects promotion over newer ordinary runtime ownership and keeps stale durable PCM temporary', async () => {
        const controls = installFakeAudioIndexedDb();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        temporary.getChannelData(0)[0] = 0.25;
        const persisted = await audioBufferCache.persistPreparedBuffer({
            id: 'promotion-runtime-collision',
            buffer: temporary,
            leaseId: 'promotion-stale-lease',
        });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected promotion runtime collision fixture to persist');
        }
        controls.pauseWriteSettlements();
        controls.abortNextWrite();
        const ordinary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        ordinary.getChannelData(0)[0] = 0.85;
        audioBufferCache.set('promotion-runtime-collision', ordinary);
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await flushIndexedDbTasks(2);

        const promotion = audioBufferCache.releasePreparedBuffer({
            id: 'promotion-runtime-collision',
            leaseId: 'promotion-stale-lease',
            disposition: 'project-owned',
        });
        await expect(promotion).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio buffer ID is already occupied.',
        });
        expect(controls.committedMeta.get('promotion-runtime-collision')?.preparedOwner?.status).toBe('temporary');

        clearRuntimeAudioBufferCache();
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );
        await expect(audioBufferCache.restoreFromIdb({ context, ids: ['promotion-runtime-collision'] })).resolves.toBe(
            0
        );
        expect(audioBufferCache.has('promotion-runtime-collision')).toBe(false);
    });

    it('publishes the reconciled project owner when same-lease persistence overlaps promotion', async () => {
        const controls = installFakeAudioIndexedDb();
        const buffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        buffer.getChannelData(0)[0] = 0.65;
        await audioBufferCache.persistPreparedBuffer({
            id: 'same-lease-promotion',
            buffer,
            leaseId: 'same-lease-promotion-lease',
        });
        clearRuntimeAudioBufferCache();
        controls.pauseWriteSettlements();

        const retry = audioBufferCache.persistPreparedBuffer({
            id: 'same-lease-promotion',
            buffer,
            leaseId: 'same-lease-promotion-lease',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        const promotion = audioBufferCache.releasePreparedBuffer({
            id: 'same-lease-promotion',
            leaseId: 'same-lease-promotion-lease',
            disposition: 'project-owned',
        });
        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();

        await expect(promotion).resolves.toEqual({ status: 'released', disposition: 'project-owned' });
        await expect(retry).resolves.toEqual({
            status: 'persisted',
            bufferId: 'same-lease-promotion',
            leaseId: 'same-lease-promotion-lease',
        });
        await expect(audioBufferCache.exportBuffers(['same-lease-promotion'])).resolves.toHaveProperty(
            'same-lease-promotion'
        );
    });

    it('aborts every overlapping promotion retry at a project transition', async () => {
        const controls = installFakeAudioIndexedDb();
        await audioBufferCache.persistPreparedBuffer({
            id: 'overlapping-promotions',
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            leaseId: 'overlapping-promotion-lease',
        });
        controls.pauseWriteSettlements();
        const writeCountBeforePromotions = controls.writeTransactionCount();
        const first = audioBufferCache.releasePreparedBuffer({
            id: 'overlapping-promotions',
            leaseId: 'overlapping-promotion-lease',
            disposition: 'project-owned',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        const second = audioBufferCache.releasePreparedBuffer({
            id: 'overlapping-promotions',
            leaseId: 'overlapping-promotion-lease',
            disposition: 'project-owned',
        });
        while (controls.writeTransactionCount() < writeCountBeforePromotions + 2) {
            await flushIndexedDbTasks(1);
        }

        clearRuntimeAudioBufferCache();
        while (controls.pendingWriteSettlementCount() > 0) {
            controls.releaseNextWriteSettlement();
        }

        await expect(first).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio promotion was superseded.',
        });
        await expect(second).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio promotion was superseded.',
        });
        expect(controls.committedMeta.get('overlapping-promotions')?.preparedOwner?.status).toBe('temporary');
    });

    it.each(['ordinary replacement', 'project transition'] as const)(
        'rolls back a committed promotion superseded by a later %s',
        async (superseder) => {
            const controls = installFakeAudioIndexedDb();
            const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
            await audioBufferCache.persistPreparedBuffer({
                id: 'post-commit-promotion-race',
                buffer: temporary,
                leaseId: 'post-commit-promotion-lease',
            });
            controls.pauseWriteSettlements();
            const promotion = audioBufferCache.releasePreparedBuffer({
                id: 'post-commit-promotion-race',
                leaseId: 'post-commit-promotion-lease',
                disposition: 'project-owned',
            });
            let promotionSettled = false;
            void promotion.then(() => {
                promotionSettled = true;
            });
            while (controls.pendingWriteSettlementCount() === 0) {
                await flushIndexedDbTasks(1);
            }
            controls.releaseNextWriteSettlement();
            if (superseder === 'ordinary replacement') {
                controls.abortNextWrite();
                audioBufferCache.set(
                    'post-commit-promotion-race',
                    createAudioBuffer({ length: 1, sampleRate: 48_000 })
                );
            } else {
                clearRuntimeAudioBufferCache();
            }
            while (!promotionSettled) {
                if (controls.pendingWriteSettlementCount() > 0) {
                    controls.releaseNextWriteSettlement();
                }
                await flushIndexedDbTasks(1);
            }
            while (controls.pendingWriteSettlementCount() > 0) {
                controls.releaseNextWriteSettlement();
                await flushIndexedDbTasks(1);
            }

            await expect(promotion).resolves.toEqual({
                status: 'failed',
                reason: 'Prepared audio promotion was superseded.',
            });
            expect(controls.committedMeta.get('post-commit-promotion-race')?.preparedOwner?.status).toBe('temporary');
            if (superseder === 'ordinary replacement') {
                expect(audioBufferCache.get('post-commit-promotion-race')).not.toBe(temporary);
            } else {
                expect(audioBufferCache.has('post-commit-promotion-race')).toBe(false);
            }
        }
    );

    it.each(['ordinary runtime mutation', 'project transition'] as const)(
        'keeps a finalized promotion authoritative after a later %s',
        async (superseder) => {
            const controls = installFakeAudioIndexedDb();
            const id = `finalized-promotion-${superseder.replaceAll(' ', '-')}`;
            const leaseId = `${id}-lease`;
            const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
            temporary.getChannelData(0)[0] = 0.25;
            await audioBufferCache.persistPreparedBuffer({ id, buffer: temporary, leaseId });
            controls.pauseWriteSettlements();
            let promotionSettled = false;
            const promotion = audioBufferCache
                .releasePreparedBuffer({ id, leaseId, disposition: 'project-owned' })
                .then((result) => {
                    promotionSettled = true;
                    return result;
                });

            while (controls.pendingWriteSettlementCount() === 0) {
                await flushIndexedDbTasks(1);
            }
            controls.releaseNextWriteSettlement();
            while (controls.pendingWriteSettlementCount() === 0) {
                await flushIndexedDbTasks(1);
            }
            controls.releaseNextWriteSettlement();
            expect(controls.committedMeta.get(id)?.preparedOwner).toMatchObject({
                leaseId,
                status: 'project-owned',
            });
            expect(controls.committedMeta.get(id)?.preparedOwner?.promotionRevision).toBeUndefined();

            let newerRuntime: AudioBuffer | undefined;
            if (superseder === 'ordinary runtime mutation') {
                const ordinaryWriteCount = controls
                    .transactionScopes()
                    .filter((scope) => scope.includes('buffers') && scope.includes('bufferMeta')).length;
                controls.abortWrites();
                newerRuntime = createAudioBuffer({ length: 1, sampleRate: 48_000 });
                newerRuntime.getChannelData(0)[0] = 0.75;
                audioBufferCache.set(id, newerRuntime);
                while (
                    controls
                        .transactionScopes()
                        .filter((scope) => scope.includes('buffers') && scope.includes('bufferMeta')).length ===
                    ordinaryWriteCount
                ) {
                    await flushIndexedDbTasks(1);
                }
                while (controls.pendingWriteSettlementCount() === 0) {
                    await flushIndexedDbTasks(1);
                }
            } else {
                clearRuntimeAudioBufferCache();
            }
            for (let turn = 0; turn < 40 && !promotionSettled; turn++) {
                if (controls.pendingWriteSettlementCount() > 0) {
                    controls.releaseNextWriteSettlement();
                }
                await flushIndexedDbTasks(1);
            }
            await flushIndexedDbTasks(2);
            while (controls.pendingWriteSettlementCount() > 0) {
                controls.releaseNextWriteSettlement();
                await flushIndexedDbTasks(1);
            }

            await expect(promotion).resolves.toEqual({ status: 'released', disposition: 'project-owned' });
            expect(controls.committed.has(id)).toBe(true);
            expect(controls.committed.get(id)?.channelData[0]?.[0]).toBe(0.25);
            expect(controls.committedMeta.get(id)?.preparedOwner).toMatchObject({
                leaseId,
                status: 'project-owned',
            });
            expect(controls.committedMeta.get(id)?.preparedOwner?.promotionRevision).toBeUndefined();
            expect(Number.isFinite(controls.committedMeta.get(id)?.lastAccessed)).toBe(true);
            expect(controls.committedMeta.get(id)?.sizeInBytes).toBe(controls.committed.get(id)?.sizeInBytes);
            await expect(audioBufferCache.exportBuffers([id])).resolves.toHaveProperty(id);
            if (newerRuntime) {
                expect(audioBufferCache.get(id)).toBe(newerRuntime);
            } else {
                expect(audioBufferCache.has(id)).toBe(false);
            }
        }
    );

    it('keeps a doubly failed rollback fail-closed and recovers it as temporary after reload', async () => {
        const controls = installFakeAudioIndexedDb();
        const id = 'double-rollback-failure';
        const leaseId = 'double-rollback-failure-lease';
        await audioBufferCache.persistPreparedBuffer({
            id,
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            leaseId,
        });
        controls.pauseWriteSettlements();
        const writeCountBeforePromotion = controls.writeTransactionCount();
        let promotionSettled = false;
        const promotion = audioBufferCache
            .releasePreparedBuffer({ id, leaseId, disposition: 'project-owned' })
            .then((result) => {
                promotionSettled = true;
                return result;
            });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.abortWrites();
        controls.releaseNextWriteSettlement();
        clearRuntimeAudioBufferCache();
        for (let turn = 0; turn < 40 && !promotionSettled; turn++) {
            if (controls.pendingWriteSettlementCount() > 0) {
                controls.releaseNextWriteSettlement();
            }
            await flushIndexedDbTasks(1);
        }

        await expect(promotion).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio promotion was superseded.',
        });
        expect(controls.writeTransactionCount() - writeCountBeforePromotion).toBe(3);
        expect(controls.committedMeta.get(id)?.preparedOwner).toMatchObject({
            leaseId,
            status: 'project-owned',
        });
        expect(controls.committedMeta.get(id)?.preparedOwner?.promotionRevision).toEqual(expect.any(String));
        await expect(audioBufferCache.exportBuffers([id])).resolves.toEqual({});

        controls.allowWrites();
        vi.resetModules();
        ({ audioBufferCache } = await import('../audioBufferCache'));
        const reopen = audioBufferCache.reopenPreparedBuffer({
            id,
            leaseId,
            context: createTestContext(
                vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                    createAudioBuffer({ length, sampleRate })
                )
            ),
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await expect(reopen).resolves.toEqual({ status: 'reopened', bufferId: id, ownership: 'temporary' });
        expect(controls.committedMeta.get(id)?.preparedOwner).toMatchObject({ leaseId, status: 'temporary' });
    });

    it('does not let delayed non-lease publish evict a lease promoted after preparation', async () => {
        installFakeAudioIndexedDb();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        const persisted = await audioBufferCache.persistPreparedBuffer({
            id: 'delayed-prepare-promotion',
            buffer: temporary,
            leaseId: 'delayed-prepare-lease',
        });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected delayed prepare fixture to persist');
        }
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );
        const delayed = await audioBufferCache.prepareFromIdb({ context, ids: ['delayed-prepare-promotion'] });
        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: 'delayed-prepare-promotion',
                leaseId: 'delayed-prepare-lease',
                disposition: 'project-owned',
            })
        ).resolves.toEqual({ status: 'released', disposition: 'project-owned' });

        expect(delayed?.publish()).toBe(0);
        expect(audioBufferCache.get('delayed-prepare-promotion')).not.toBe(temporary);
        expect(audioBufferCache.get('delayed-prepare-promotion')?.getChannelData(0)[0]).toBeCloseTo(0);
    });

    it('blocks temporary reopens after project preparation without disturbing durable runtime owners', async () => {
        installFakeAudioIndexedDb();
        const completedId = 'delayed-project-completed-reopen';
        const activeId = 'delayed-project-active-reopen';
        const projectOwnedId = 'delayed-project-owned-runtime';
        const ordinaryId = 'delayed-project-ordinary-runtime';
        for (const id of [completedId, activeId]) {
            await audioBufferCache.persistPreparedBuffer({
                id,
                buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
                leaseId: `${id}-lease`,
            });
        }
        clearRuntimeAudioBufferCache();
        const ordinary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        audioBufferCache.set(ordinaryId, ordinary);
        await flushIndexedDbTasks();
        const projectOwned = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        const projectOwnedLeaseId = `${projectOwnedId}-lease`;
        await audioBufferCache.persistPreparedBuffer({
            id: projectOwnedId,
            buffer: projectOwned,
            leaseId: projectOwnedLeaseId,
        });
        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: projectOwnedId,
                leaseId: projectOwnedLeaseId,
                disposition: 'project-owned',
            })
        ).resolves.toEqual({ status: 'released', disposition: 'project-owned' });
        const project = await audioBufferCache.prepareFromIdb({
            context: createTestContext(
                vi.fn((_channels: number, length: number, sampleRate: number) =>
                    createAudioBuffer({ length, sampleRate })
                )
            ),
            ids: [completedId, activeId, projectOwnedId, ordinaryId],
        });

        for (const id of [completedId, activeId]) {
            await expect(
                audioBufferCache.reopenPreparedBuffer({
                    id,
                    leaseId: `${id}-lease`,
                    context: createTestContext(
                        vi.fn((_channels: number, length: number, sampleRate: number) =>
                            createAudioBuffer({ length, sampleRate })
                        )
                    ),
                })
            ).resolves.toEqual({
                status: 'failed',
                reason: 'Prepared audio buffer ID is reserved by the project.',
            });
        }

        expect(project?.publish()).toBe(0);
        expect(audioBufferCache.has(completedId)).toBe(false);
        expect(audioBufferCache.has(activeId)).toBe(false);
        expect(audioBufferCache.get(projectOwnedId)).not.toBe(projectOwned);
        expect(audioBufferCache.get(projectOwnedId)?.getChannelData(0)[0]).toBeCloseTo(0);
        expect(audioBufferCache.get(ordinaryId)).toBe(ordinary);
        expect(project?.publish()).toBe(0);
        expect(audioBufferCache.has(completedId)).toBe(false);
        expect(audioBufferCache.has(activeId)).toBe(false);
    });

    it('retries committed prepared persistence by caller-known lease after a module reload', async () => {
        const controls = installFakeAudioIndexedDb();
        const source = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        source.getChannelData(0)[0] = 0.45;
        const input = { id: 'caller-known-retry', buffer: source, leaseId: 'caller-known-lease' };

        await expect(audioBufferCache.persistPreparedBuffer(input)).resolves.toEqual({
            status: 'persisted',
            bufferId: 'caller-known-retry',
            leaseId: 'caller-known-lease',
        });
        delete controls.committedMeta.get(input.id)?.preparedOwner?.persistenceRevision;
        vi.resetModules();
        ({ audioBufferCache } = await import('../audioBufferCache'));
        await expect(audioBufferCache.persistPreparedBuffer(input)).resolves.toEqual({
            status: 'persisted',
            bufferId: 'caller-known-retry',
            leaseId: 'caller-known-lease',
        });
        expect(controls.committedMeta.get(input.id)?.preparedOwner?.persistenceRevision).toEqual(expect.any(String));
        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: 'caller-known-retry',
                leaseId: 'caller-known-lease',
                disposition: 'discard',
            })
        ).resolves.toEqual({ status: 'released', disposition: 'discarded' });
    });

    it.each(malformedPreparedMetadataCases)(
        'rejects exact-lease retry with %s after reload without publishing runtime PCM',
        async (_label, corruptMetadata) => {
            const controls = installFakeAudioIndexedDb();
            const source = createAudioBuffer({ length: 1, sampleRate: 48_000 });
            source.getChannelData(0)[0] = 0.45;
            const input = { id: 'malformed-retry', buffer: source, leaseId: 'malformed-retry-lease' };
            await expect(audioBufferCache.persistPreparedBuffer(input)).resolves.toMatchObject({
                status: 'persisted',
            });
            clearRuntimeAudioBufferCache();
            const metadata = controls.committedMeta.get(input.id)!;
            corruptMetadata(metadata);
            vi.resetModules();
            ({ audioBufferCache } = await import('../audioBufferCache'));

            await expect(audioBufferCache.persistPreparedBuffer(input)).resolves.toEqual({
                status: 'failed',
                reason: 'Prepared audio PCM metadata is invalid.',
            });
            expect(audioBufferCache.has(input.id)).toBe(false);
            expect(controls.committed.has(input.id)).toBe(true);
            expect(controls.committedMeta.get(input.id)).toBe(metadata);
        }
    );

    it.each(['temporary', 'project-owned'] as const)(
        'rejects %s promotion success when the durable metadata pair is malformed',
        async (ownerStatus) => {
            const controls = installFakeAudioIndexedDb();
            const id = `malformed-${ownerStatus}-promotion`;
            const leaseId = `malformed-${ownerStatus}-lease`;
            await audioBufferCache.persistPreparedBuffer({
                id,
                buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
                leaseId,
            });
            if (ownerStatus === 'project-owned') {
                await audioBufferCache.releasePreparedBuffer({ id, leaseId, disposition: 'project-owned' });
            }
            clearRuntimeAudioBufferCache();
            controls.committedMeta.get(id)!.lastAccessed = Number.NaN;
            vi.resetModules();
            ({ audioBufferCache } = await import('../audioBufferCache'));

            await expect(
                audioBufferCache.releasePreparedBuffer({ id, leaseId, disposition: 'project-owned' })
            ).resolves.toEqual({ status: 'failed', reason: 'Prepared audio PCM metadata is invalid.' });
            expect(audioBufferCache.has(id)).toBe(false);
            expect(controls.committedMeta.get(id)?.preparedOwner?.status).toBe(ownerStatus);
        }
    );

    it('leaves malformed temporary PCM exact and durable when discard validation fails', async () => {
        const controls = installFakeAudioIndexedDb();
        const id = 'malformed-temporary-discard';
        const leaseId = `${id}-lease`;
        const source = createAudioBuffer({ length: 2, sampleRate: 48_000 });
        source.getChannelData(0).set([0.375, -0.625]);
        await audioBufferCache.persistPreparedBuffer({ id, buffer: source, leaseId });
        clearRuntimeAudioBufferCache();
        const durablePcm = structuredClone(controls.committed.get(id));
        const durableMetadata = controls.committedMeta.get(id)!;
        durableMetadata.lastAccessed = Number.NaN;

        await expect(audioBufferCache.releasePreparedBuffer({ id, leaseId, disposition: 'discard' })).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio PCM metadata is invalid.',
        });
        expect(controls.committed.get(id)).toEqual(durablePcm);
        expect(controls.committedMeta.get(id)).toBe(durableMetadata);
        expect(controls.committedRecovery.has(id)).toBe(false);

        vi.resetModules();
        ({ audioBufferCache } = await import('../audioBufferCache'));
        await expect(
            audioBufferCache.reopenPreparedBuffer({ id, leaseId, context: createTestContext(vi.fn()) })
        ).resolves.toEqual({ status: 'failed', reason: 'Prepared audio metadata does not match its PCM.' });
        expect([...controls.committed.get(id)!.channelData[0]!]).toEqual([0.375, -0.625]);
        expect(controls.committedRecovery.has(id)).toBe(false);
    });

    it('reclaims only expired unowned prepared PCM after restart', async () => {
        const controls = installFakeAudioIndexedDb();
        await audioBufferCache.persistPreparedBuffer({
            id: 'orphan-pcm',
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            leaseId: 'orphan-lease',
        });
        await audioBufferCache.persistPreparedBuffer({
            id: 'live-pcm',
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            leaseId: 'live-lease',
        });
        await audioBufferCache.persistPreparedBuffer({
            id: 'project-pcm',
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            leaseId: 'project-lease',
        });
        await audioBufferCache.releasePreparedBuffer({
            id: 'project-pcm',
            leaseId: 'project-lease',
            disposition: 'project-owned',
        });
        controls.committed.set('legacy-temporary-pcm', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.4])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        controls.committedMeta.set('legacy-temporary-pcm', {
            lastAccessed: 1,
            sizeInBytes: 4,
            preparedOwner: { schemaVersion: 1, leaseId: 'legacy-lease', status: 'temporary' },
        });

        vi.resetModules();
        ({ audioBufferCache, clearRuntimeAudioBufferCache, reclaimPreparedBufferOrphans } =
            await import('../audioBufferCache'));
        await expect(
            reclaimPreparedBufferOrphans({
                createdBeforeMs: Number.MAX_SAFE_INTEGER,
                liveLeaseIds: ['live-lease'],
            })
        ).resolves.toEqual({ status: 'reclaimed', count: 1 });

        expect(controls.committed.has('orphan-pcm')).toBe(false);
        expect(controls.committedMeta.has('orphan-pcm')).toBe(false);
        expect(controls.committed.has('live-pcm')).toBe(true);
        expect(controls.committed.has('project-pcm')).toBe(true);
        expect(controls.committed.has('legacy-temporary-pcm')).toBe(true);
    });

    it('rejects empty prepared identities and suppresses invalid durable owners from non-lease reads', async () => {
        const controls = installFakeAudioIndexedDb();
        await expect(
            audioBufferCache.persistPreparedBuffer({
                id: '',
                buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
                leaseId: 'valid-lease',
            })
        ).resolves.toEqual({ status: 'failed', reason: 'Prepared audio buffer ID is invalid.' });
        await expect(
            audioBufferCache.persistPreparedBuffer({
                id: 'valid-id',
                buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
                leaseId: '',
            })
        ).resolves.toEqual({ status: 'failed', reason: 'Prepared audio lease ID is invalid.' });

        controls.committed.set('invalid-owner-pcm', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.4])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        controls.committedMeta.set('invalid-owner-pcm', {
            lastAccessed: 1,
            sizeInBytes: 4,
            preparedOwner: { schemaVersion: 1, leaseId: '', status: 'temporary' },
        });
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );

        await expect(audioBufferCache.restoreFromIdb({ context, ids: ['invalid-owner-pcm'] })).resolves.toBe(0);
        await expect(audioBufferCache.exportBuffers(['invalid-owner-pcm'])).resolves.toEqual({});
        expect(audioBufferCache.has('invalid-owner-pcm')).toBe(false);
    });

    it('totally validates malformed promotion ownership in the final export transaction', async () => {
        const controls = installFakeAudioIndexedDb();
        const stored = {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.4])],
            lastAccessed: 1,
            sizeInBytes: 4,
        };
        controls.committed.set('malformed-promotion-owner', structuredClone(stored));
        controls.committedMeta.set('malformed-promotion-owner', {
            lastAccessed: 1,
            sizeInBytes: 4,
            preparedOwner: {
                schemaVersion: 1,
                leaseId: 'malformed-promotion-lease',
                promotionRevision: 42 as unknown as string,
                status: 'project-owned',
            },
        });
        controls.committed.set('legacy-data-only', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.4])],
        });
        controls.committedMeta.set('metadata-only', {
            lastAccessed: 1,
            sizeInBytes: 4,
            preparedOwner: {
                schemaVersion: 1,
                leaseId: 'metadata-only-lease',
                status: 'project-owned',
            },
        });

        await expect(
            audioBufferCache.reopenPreparedBuffer({
                id: 'malformed-promotion-owner',
                leaseId: 'malformed-promotion-lease',
                context: createTestContext(vi.fn()),
            })
        ).resolves.toEqual({ status: 'failed', reason: 'Prepared audio ownership metadata is invalid.' });
        await expect(
            audioBufferCache.exportBuffers(['malformed-promotion-owner', 'legacy-data-only', 'metadata-only'])
        ).resolves.toEqual({
            'legacy-data-only': {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [encodeFloat32([0.4])],
            },
        });
    });

    it('does not let prepared discard evict a newer ordinary runtime buffer', async () => {
        const controls = installFakeAudioIndexedDb();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        temporary.getChannelData(0)[0] = 0.25;
        const persisted = await audioBufferCache.persistPreparedBuffer({ id: 'discard-race', buffer: temporary });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected discard-race prepared PCM to persist');
        }

        controls.pauseWriteSettlements();
        let discardSettled = false;
        const discard = audioBufferCache
            .releasePreparedBuffer({
                id: 'discard-race',
                leaseId: persisted.leaseId,
                disposition: 'discard',
            })
            .then((result) => {
                discardSettled = true;
                return result;
            });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        const ordinary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        ordinary.getChannelData(0)[0] = 0.85;
        audioBufferCache.set('discard-race', ordinary);

        controls.releaseNextWriteSettlement();
        for (let turn = 0; turn < 40 && !discardSettled; turn++) {
            if (controls.pendingWriteSettlementCount() > 0) {
                controls.releaseNextWriteSettlement();
            }
            await flushIndexedDbTasks(1);
        }
        await expect(discard).resolves.toEqual({ status: 'released', disposition: 'discarded' });
        await flushIndexedDbTasks(2);
        expect(audioBufferCache.get('discard-race')).toBe(ordinary);
        expect(controls.committed.get('discard-race')?.channelData[0]?.[0]).toBeCloseTo(0.85);
        expect(controls.committedMeta.get('discard-race')?.preparedOwner).toBeUndefined();
    });

    it('does not report or evict discard when newer same-lease persistence commits before cleanup', async () => {
        const controls = installFakeAudioIndexedDb();
        const id = 'discard-same-lease-persistence-race';
        const leaseId = `${id}-lease`;
        const original = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        original.getChannelData(0)[0] = 0.25;
        await audioBufferCache.persistPreparedBuffer({ id, leaseId, buffer: original });

        controls.pauseWriteSettlements();
        const discard = audioBufferCache.releasePreparedBuffer({ id, leaseId, disposition: 'discard' });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        const replacement = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        replacement.getChannelData(0)[0] = 0.75;
        const replacementPersistence = audioBufferCache.persistPreparedBuffer({ id, leaseId, buffer: replacement });
        while (controls.writeTransactionCount() < 3) {
            await flushIndexedDbTasks(1);
        }

        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();

        await expect(replacementPersistence).resolves.toEqual({ status: 'persisted', bufferId: id, leaseId });
        await expect(discard).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio discard was superseded.',
        });
        expect(audioBufferCache.get(id)).not.toBe(replacement);
        expect(audioBufferCache.get(id)?.getChannelData(0)[0]).toBeCloseTo(0.75);
        expect(controls.committed.get(id)?.channelData[0]?.[0]).toBeCloseTo(0.75);
        expect(controls.committedMeta.get(id)?.preparedOwner).toMatchObject({ leaseId, status: 'temporary' });
    });

    it('rejects discard when the project already pins the prepared PCM', async () => {
        const controls = installFakeAudioIndexedDb();
        const id = 'discard-existing-project-pin';
        const buffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        const persisted = await audioBufferCache.persistPreparedBuffer({
            id,
            buffer,
            leaseId: 'discard-existing-project-pin-lease',
        });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected discard-existing-project-pin prepared PCM to persist');
        }
        const metadata = structuredClone(controls.committedMeta.get(id));
        const project = audioBufferCache.importBuffers({
            buffers: {},
            cacheIds: [id],
            context: createTestContext(vi.fn()),
        });
        expect(project?.publish()).toBe(0);

        await expect(
            audioBufferCache.releasePreparedBuffer({ id, leaseId: persisted.leaseId, disposition: 'discard' })
        ).resolves.toEqual({ status: 'failed', reason: 'Prepared audio buffer ID is reserved by the project.' });
        expect(controls.committed.has(id)).toBe(true);
        expect(controls.committedMeta.get(id)).toEqual(metadata);
        expect(audioBufferCache.has(id)).toBe(false);
    });

    it.each(['before-settlement', 'after-commit'] as const)(
        'preserves prepared PCM when a project pin lands %s during discard',
        async (pinTiming) => {
            const controls = installFakeAudioIndexedDb();
            const id = `discard-late-project-pin-${pinTiming}`;
            const buffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
            buffer.getChannelData(0)[0] = 0.65;
            const persisted = await audioBufferCache.persistPreparedBuffer({
                id,
                buffer,
                leaseId: `discard-late-project-pin-${pinTiming}-lease`,
            });
            if (persisted.status !== 'persisted') {
                throw new TypeError('Expected late-pin discard fixture to persist');
            }
            const stored = structuredClone(controls.committed.get(id));
            const metadata = structuredClone(controls.committedMeta.get(id));
            if (!stored || !metadata) {
                throw new TypeError('Expected late-pin discard fixture to remain durable');
            }
            controls.pauseWriteSettlements();
            const discard = audioBufferCache.releasePreparedBuffer({
                id,
                leaseId: persisted.leaseId,
                disposition: 'discard',
            });
            while (controls.pendingWriteSettlementCount() === 0) {
                await flushIndexedDbTasks(1);
            }

            if (pinTiming === 'after-commit') {
                controls.releaseNextWriteSettlement();
                while (controls.pendingWriteSettlementCount() === 0) {
                    await flushIndexedDbTasks(1);
                }
            }
            const project = audioBufferCache.importBuffers({
                buffers: {},
                cacheIds: [id],
                context: createTestContext(vi.fn()),
            });
            expect(project?.publish()).toBe(0);
            controls.releaseNextWriteSettlement();
            if (pinTiming === 'after-commit') {
                while (controls.pendingWriteSettlementCount() === 0) {
                    await flushIndexedDbTasks(1);
                }
                controls.releaseNextWriteSettlement();
            }

            await expect(discard).resolves.toEqual({
                status: 'failed',
                reason: 'Prepared audio buffer ID is reserved by the project.',
            });
            while (controls.pendingWriteSettlementCount() > 0) {
                controls.releaseNextWriteSettlement();
                await flushIndexedDbTasks(1);
            }
            expect(controls.committed.get(id)).toEqual(stored);
            expect(controls.committedMeta.get(id)).toEqual(
                pinTiming === 'after-commit'
                    ? {
                          ...metadata,
                          preparedOwner: { ...metadata.preparedOwner!, status: 'project-owned' },
                      }
                    : metadata
            );
            expect(audioBufferCache.has(id)).toBe(false);
        }
    );

    it('keeps an exact durable recovery copy when late project admission outlives failed discard restoration', async () => {
        const controls = installFakeAudioIndexedDb();
        const id = 'discard-durable-recovery';
        const leaseId = `${id}-lease`;
        const source = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        source.getChannelData(0)[0] = 0.625;
        await audioBufferCache.persistPreparedBuffer({ id, buffer: source, leaseId });
        controls.pauseWriteSettlements();
        const discard = audioBufferCache.releasePreparedBuffer({ id, leaseId, disposition: 'discard' });
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
        controls.abortNextWrite();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();

        await expect(discard).resolves.toMatchObject({ status: 'failed' });
        expect(controls.committed.has(id)).toBe(false);
        expect(
            [...controls.committedRecovery.values()].find((recovery) => recovery.id === id)?.data?.channelData[0]?.[0]
        ).toBe(0.625);

        const context = createTestContext(
            vi.fn((_channels: number, length: number, sampleRate: number) => createAudioBuffer({ length, sampleRate }))
        );
        await expect(audioBufferCache.restoreFromIdb({ context })).resolves.toBe(0);

        const settlePausedWrite = async <Result>(operation: Promise<Result>): Promise<Result> => {
            let settled = false;
            void operation.then(
                () => {
                    settled = true;
                },
                () => {
                    settled = true;
                }
            );
            for (let turn = 0; turn < 80 && !settled; turn++) {
                if (controls.pendingWriteSettlementCount() > 0) {
                    controls.releaseNextWriteSettlement();
                }
                await flushIndexedDbTasks(1);
            }
            return operation;
        };
        await expect(settlePausedWrite(audioBufferCache.garbageCollectByAge(-1))).resolves.toBe(0);
        await expect(settlePausedWrite(audioBufferCache.garbageCollectBySize(0))).resolves.toBe(0);
        await expect(
            settlePausedWrite(
                reclaimPreparedBufferOrphans({ createdBeforeMs: Number.MAX_SAFE_INTEGER, liveLeaseIds: [] })
            )
        ).resolves.toEqual({ status: 'reclaimed', count: 0 });
        await expect(
            settlePausedWrite(audioBufferCache.garbageCollectFreezeFiles({ activeIds: new Set(), projectId: 1 }))
        ).resolves.toBeUndefined();
        expect(controls.committed.has(id)).toBe(false);
        expect(
            [...controls.committedRecovery.values()].find((recovery) => recovery.id === id)?.data?.channelData[0]?.[0]
        ).toBe(0.625);

        controls.allowWrites();
        vi.resetModules();
        ({ audioBufferCache, clearRuntimeAudioBufferCache, reclaimPreparedBufferOrphans } =
            await import('../audioBufferCache'));
        const recovery = audioBufferCache.prepareFromIdb({
            context,
            ids: [id],
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        const prepared = await recovery;
        expect(prepared?.publish()).toBe(1);
        expect(audioBufferCache.get(id)?.getChannelData(0)[0]).toBeCloseTo(0.625);
        expect(controls.committed.get(id)?.channelData[0]?.[0]).toBe(0.625);
        expect(controls.committedMeta.get(id)?.preparedOwner?.status).toBe('project-owned');
        expect([...controls.committedRecovery.values()].some((recovery) => recovery.id === id)).toBe(false);
        await expect(
            audioBufferCache.reopenPreparedBuffer({
                id,
                leaseId,
                context: createTestContext(vi.fn()),
            })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio buffer ID is reserved by the project.',
        });
    });

    it('evicts matching prepared PCM after overlapping discard retries commit deletion', async () => {
        const controls = installFakeAudioIndexedDb();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        const persisted = await audioBufferCache.persistPreparedBuffer({ id: 'discard-retry', buffer: temporary });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected discard-retry prepared PCM to persist');
        }

        controls.pauseWriteSettlements();
        const firstDiscard = audioBufferCache.releasePreparedBuffer({
            id: 'discard-retry',
            leaseId: persisted.leaseId,
            disposition: 'discard',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        const retryDiscard = audioBufferCache.releasePreparedBuffer({
            id: 'discard-retry',
            leaseId: persisted.leaseId,
            disposition: 'discard',
        });

        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await expect(firstDiscard).resolves.toEqual({ status: 'released', disposition: 'discarded' });
        await expect(retryDiscard).resolves.toEqual({ status: 'missing' });
        expect(audioBufferCache.has('discard-retry')).toBe(false);
        expect(controls.committed.has('discard-retry')).toBe(false);
        expect(controls.committedMeta.has('discard-retry')).toBe(false);
    });

    it('exports newer ordinary runtime PCM when its aborted write leaves temporary metadata durable', async () => {
        const controls = installFakeAudioIndexedDb();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        temporary.getChannelData(0)[0] = 0.25;
        const persisted = await audioBufferCache.persistPreparedBuffer({
            id: 'ordinary-export-abort',
            buffer: temporary,
        });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected ordinary-export-abort prepared PCM to persist');
        }

        controls.pauseWriteSettlements();
        controls.abortNextWrite();
        const ordinary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        ordinary.getChannelData(0)[0] = 0.85;
        audioBufferCache.set('ordinary-export-abort', ordinary);
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await flushIndexedDbTasks(2);

        await expect(audioBufferCache.exportBuffers(['ordinary-export-abort'])).resolves.toEqual({
            'ordinary-export-abort': {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [encodeFloat32([0.85])],
            },
        });
        expect(controls.committedMeta.get('ordinary-export-abort')?.preparedOwner?.status).toBe('temporary');
    });

    it('rejects a settled temporary owner after reload while preserving its lease and exact PCM', async () => {
        const controls = installFakeAudioIndexedDb();
        const original = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        original.getChannelData(0)[0] = 0.35;
        const first = await audioBufferCache.persistPreparedBuffer({ id: 'settled-reload', buffer: original });
        if (first.status !== 'persisted') {
            throw new TypeError('Expected settled prepared PCM fixture to persist');
        }

        vi.resetModules();
        ({ audioBufferCache } = await import('../audioBufferCache'));
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );
        await expect(
            audioBufferCache.reopenPreparedBuffer({ id: 'settled-reload', leaseId: first.leaseId, context })
        ).resolves.toEqual({ status: 'reopened', bufferId: 'settled-reload', ownership: 'temporary' });
        const reopenedRuntime = audioBufferCache.get('settled-reload');
        const durablePcm = structuredClone(controls.committed.get('settled-reload'));
        const durableMeta = structuredClone(controls.committedMeta.get('settled-reload'));
        const unrelated = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        unrelated.getChannelData(0)[0] = 0.85;

        await expect(
            audioBufferCache.persistPreparedBuffer({ id: 'settled-reload', buffer: unrelated })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio buffer ID is already occupied.',
        });
        expect(audioBufferCache.get('settled-reload')).toBe(reopenedRuntime);
        expect(controls.committed.get('settled-reload')).toEqual(durablePcm);
        expect(controls.committedMeta.get('settled-reload')).toEqual(durableMeta);
        await expect(
            audioBufferCache.reopenPreparedBuffer({ id: 'settled-reload', leaseId: first.leaseId, context })
        ).resolves.toEqual({ status: 'reopened', bufferId: 'settled-reload', ownership: 'temporary' });
        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: 'settled-reload',
                leaseId: first.leaseId,
                disposition: 'project-owned',
            })
        ).resolves.toEqual({ status: 'released', disposition: 'project-owned' });
    });

    it('does not let a stale reopen overwrite a newer prepared buffer in memory after it commits', async () => {
        const controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE],
        });
        controls.pauseWriteSettlements();
        const original = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        original.getChannelData(0)[0] = 0.25;
        const firstLeaseId = 'reopen-race-first-lease';
        const first = audioBufferCache.persistPreparedBuffer({
            id: 'reopen-race',
            buffer: original,
            leaseId: firstLeaseId,
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.pauseReadonlySettlements();
        const staleReopen = audioBufferCache.reopenPreparedBuffer({
            id: 'reopen-race',
            leaseId: firstLeaseId,
            context: createTestContext(
                vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                    createAudioBuffer({ length, sampleRate })
                )
            ),
        });
        const replacement = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        replacement.getChannelData(0)[0] = 0.75;
        const second = audioBufferCache.persistPreparedBuffer({
            id: 'reopen-race',
            buffer: replacement,
            leaseId: 'reopen-race-second-lease',
        });
        controls.releaseNextWriteSettlement();
        while (controls.pendingReadonlySettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextReadonlySettlement();
        await expect(staleReopen).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio reopen was superseded.',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.releaseNextWriteSettlement();
        const persisted = await second;
        expect(persisted).toMatchObject({ status: 'persisted', bufferId: 'reopen-race' });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected replacement prepared PCM to persist');
        }
        while (controls.pendingReadonlySettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextReadonlySettlement();
        await expect(first).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio persistence was superseded.',
        });
        const projectRelease = audioBufferCache.releasePreparedBuffer({
            id: 'reopen-race',
            leaseId: persisted.leaseId,
            disposition: 'project-owned',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await expect(projectRelease).resolves.toEqual({ status: 'released', disposition: 'project-owned' });

        expect(audioBufferCache.get('reopen-race')).not.toBe(replacement);
        expect(audioBufferCache.get('reopen-race')?.getChannelData(0)[0]).toBeCloseTo(0.75);
        expect(controls.committed.get('reopen-race')?.channelData[0]?.[0]).toBeCloseTo(0.75);
        expect(controls.committedMeta.get('reopen-race')?.preparedOwner?.leaseId).toBe(persisted.leaseId);
        expect(controls.committedMeta.get('reopen-race')?.preparedOwner?.status).toBe('project-owned');
    });

    it('reports a committed owner as persisted when a superseding prepared write later aborts', async () => {
        const controls = installFakeAudioIndexedDb({
            existingStores: [BUFFER_STORE, META_STORE, RECOVERY_STORE],
        });
        controls.pauseWriteSettlements();
        const firstBuffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        firstBuffer.getChannelData(0)[0] = 0.25;
        const first = audioBufferCache.persistPreparedBuffer({ id: 'commit-truth', buffer: firstBuffer });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.abortNextWrite();
        const secondBuffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        secondBuffer.getChannelData(0)[0] = 0.75;
        const second = audioBufferCache.persistPreparedBuffer({ id: 'commit-truth', buffer: secondBuffer });
        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult).toMatchObject({ status: 'persisted', bufferId: 'commit-truth' });
        expect(secondResult).toMatchObject({ status: 'failed', reason: 'IDB transaction aborted' });
        expect(controls.committed.get('commit-truth')?.channelData[0]?.[0]).toBeCloseTo(0.25);
        expect(controls.committedMeta.get('commit-truth')?.preparedOwner?.leaseId).toBe(
            firstResult.status === 'persisted' ? firstResult.leaseId : undefined
        );
        expect(audioBufferCache.get('commit-truth')).not.toBe(firstBuffer);
        expect(audioBufferCache.get('commit-truth')?.getChannelData(0)[0]).toBeCloseTo(0.25);
    });
});
