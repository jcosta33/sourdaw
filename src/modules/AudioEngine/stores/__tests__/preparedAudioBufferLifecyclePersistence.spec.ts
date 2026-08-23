import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushIndexedDbTasks, installFakeAudioIndexedDb, META_STORE } from './fakeAudioBufferIndexedDb';
import { createAudioBuffer, createTestContext } from './preparedAudioBufferTestSupport';

let audioBufferCache: typeof import('../audioBufferCache').audioBufferCache;
let clearRuntimeAudioBufferCache: typeof import('../audioBufferCache').clearRuntimeAudioBufferCache;

beforeEach(async () => {
    vi.resetModules();
    ({ audioBufferCache, clearRuntimeAudioBufferCache } = await import('../audioBufferCache'));
});

afterEach(() => {
    audioBufferCache.clear();
    vi.unstubAllGlobals();
});

describe('prepared audio-buffer persistence and admission', () => {
    it('rejects occupied legacy and project-owned ids without changing runtime PCM or either durable row', async () => {
        const controls = installFakeAudioIndexedDb();
        const legacy = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        legacy.getChannelData(0)[0] = 0.2;
        audioBufferCache.set('legacy-collision', legacy);
        await flushIndexedDbTasks();

        const project = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        project.getChannelData(0)[0] = 0.4;
        const stagedProject = await audioBufferCache.persistPreparedBuffer({
            id: 'project-collision',
            buffer: project,
        });
        if (stagedProject.status !== 'persisted') {
            throw new TypeError('Expected project collision fixture to persist');
        }
        await audioBufferCache.releasePreparedBuffer({
            id: 'project-collision',
            leaseId: stagedProject.leaseId,
            disposition: 'project-owned',
        });

        for (const [id, original] of [
            ['legacy-collision', legacy],
            ['project-collision', project],
        ] as const) {
            const durablePcm = structuredClone(controls.committed.get(id));
            const durableMeta = structuredClone(controls.committedMeta.get(id));
            const replacement = createAudioBuffer({ length: 1, sampleRate: 48_000 });
            replacement.getChannelData(0)[0] = 0.9;

            await expect(audioBufferCache.persistPreparedBuffer({ id, buffer: replacement })).resolves.toEqual({
                status: 'failed',
                reason: 'Prepared audio buffer ID is already occupied.',
            });
            expect(audioBufferCache.get(id)).toBe(original);
            expect(controls.committed.get(id)).toEqual(durablePcm);
            expect(controls.committedMeta.get(id)).toEqual(durableMeta);
        }
    });

    it('does not let immediate prepared persistence supersede an occupied ordinary set', async () => {
        const controls = installFakeAudioIndexedDb();
        const projectBuffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        projectBuffer.getChannelData(0)[0] = 0.15;
        audioBufferCache.set('ordinary-set-collision', projectBuffer);
        const prepared = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        prepared.getChannelData(0)[0] = 0.95;

        await expect(
            audioBufferCache.persistPreparedBuffer({ id: 'ordinary-set-collision', buffer: prepared })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio buffer ID is already occupied.',
        });
        await flushIndexedDbTasks();
        expect(audioBufferCache.get('ordinary-set-collision')).toBe(projectBuffer);
        expect(controls.committed.get('ordinary-set-collision')?.channelData[0]?.[0]).toBeCloseTo(0.15);
        expect(controls.committedMeta.get('ordinary-set-collision')?.preparedOwner).toBeUndefined();
    });

    it('does not publish prepared PCM over a newer ordinary runtime mutation when its durable write aborts', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.pauseWriteSettlements();
        const prepared = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        prepared.getChannelData(0)[0] = 0.25;
        const persistence = audioBufferCache.persistPreparedBuffer({ id: 'ordinary-abort-race', buffer: prepared });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.abortNextWrite();
        const ordinary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        ordinary.getChannelData(0)[0] = 0.85;
        audioBufferCache.set('ordinary-abort-race', ordinary);
        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await flushIndexedDbTasks(2);
        const persisted = await persistence;
        expect(persisted).toMatchObject({ status: 'persisted', bufferId: 'ordinary-abort-race' });

        expect(audioBufferCache.get('ordinary-abort-race')).toBe(ordinary);
        expect(controls.committed.get('ordinary-abort-race')?.channelData[0]?.[0]).toBeCloseTo(0.25);
        expect(controls.committedMeta.get('ordinary-abort-race')?.preparedOwner?.status).toBe('temporary');
    });

    it('keeps a newer same-lease reservation when an older persistence attempt aborts', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.pauseWriteSettlements();
        controls.abortNextWrite();
        const stale = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        stale.getChannelData(0)[0] = 0.25;
        const first = audioBufferCache.persistPreparedBuffer({
            id: 'same-lease-reservation-race',
            buffer: stale,
            leaseId: 'same-lease-reservation',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        const current = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        current.getChannelData(0)[0] = 0.75;
        const second = audioBufferCache.persistPreparedBuffer({
            id: 'same-lease-reservation-race',
            buffer: current,
            leaseId: 'same-lease-reservation',
        });
        while (controls.writeTransactionCount() < 2) {
            await flushIndexedDbTasks(1);
        }

        controls.releaseNextWriteSettlement();
        await expect(first).resolves.toMatchObject({ status: 'failed' });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();

        await expect(second).resolves.toEqual({
            status: 'persisted',
            bufferId: 'same-lease-reservation-race',
            leaseId: 'same-lease-reservation',
        });
        expect(audioBufferCache.get('same-lease-reservation-race')).toBe(current);
        expect(controls.committed.get('same-lease-reservation-race')?.channelData[0]?.[0]).toBeCloseTo(0.75);
    });

    it('keeps temporary prepared PCM out of non-lease restore and export until project promotion', async () => {
        installFakeAudioIndexedDb();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        temporary.getChannelData(0)[0] = 0.45;
        const persisted = await audioBufferCache.persistPreparedBuffer({
            id: 'temporary-isolation',
            buffer: temporary,
        });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected temporary isolation fixture to persist');
        }

        await expect(audioBufferCache.exportBuffers(['temporary-isolation'])).resolves.toEqual({});
        clearRuntimeAudioBufferCache();
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );
        const prepared = await audioBufferCache.prepareFromIdb({ context, ids: ['temporary-isolation'] });
        expect(prepared?.publish()).toBe(0);
        expect(audioBufferCache.has('temporary-isolation')).toBe(false);
        await expect(audioBufferCache.restoreFromIdb({ context, ids: ['temporary-isolation'] })).resolves.toBe(0);
        await expect(
            audioBufferCache.reopenPreparedBuffer({
                id: 'temporary-isolation',
                leaseId: persisted.leaseId,
                context,
            })
        ).resolves.toEqual({ status: 'reopened', bufferId: 'temporary-isolation', ownership: 'temporary' });

        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: 'temporary-isolation',
                leaseId: persisted.leaseId,
                disposition: 'project-owned',
            })
        ).resolves.toEqual({ status: 'released', disposition: 'project-owned' });
        await expect(audioBufferCache.exportBuffers(['temporary-isolation'])).resolves.toHaveProperty(
            'temporary-isolation'
        );
        clearRuntimeAudioBufferCache();
        await expect(audioBufferCache.restoreFromIdb({ context, ids: ['temporary-isolation'] })).resolves.toBe(1);
    });

    it('keeps resident temporary PCM out of export when ownership metadata cannot be read', async () => {
        const controls = installFakeAudioIndexedDb();
        await audioBufferCache.persistPreparedBuffer({
            id: 'metadata-failure-temporary',
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            leaseId: 'metadata-failure-lease',
        });
        expect(audioBufferCache.has('metadata-failure-temporary')).toBe(true);

        clearRuntimeAudioBufferCache();
        vi.resetModules();
        ({ audioBufferCache, clearRuntimeAudioBufferCache } = await import('../audioBufferCache'));
        controls.failRequestsFrom(META_STORE);

        await expect(audioBufferCache.exportBuffers(['metadata-failure-temporary'])).resolves.toEqual({});
    });

    it('does not publish prepared runtime PCM after a project-transition clear', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.pauseWriteSettlements();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        temporary.getChannelData(0)[0] = 0.55;
        const persistence = audioBufferCache.persistPreparedBuffer({ id: 'clear-race', buffer: temporary });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        clearRuntimeAudioBufferCache();
        controls.releaseNextWriteSettlement();
        const persisted = await persistence;
        expect(persisted).toMatchObject({ status: 'persisted', bufferId: 'clear-race' });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected clear-race prepared PCM to remain durable');
        }
        expect(audioBufferCache.has('clear-race')).toBe(false);
        expect(controls.committed.get('clear-race')?.channelData[0]?.[0]).toBeCloseTo(0.55);
        await expect(
            audioBufferCache.reopenPreparedBuffer({
                id: 'clear-race',
                leaseId: persisted.leaseId,
                context: createTestContext(
                    vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                        createAudioBuffer({ length, sampleRate })
                    )
                ),
            })
        ).resolves.toEqual({ status: 'reopened', bufferId: 'clear-race', ownership: 'temporary' });
    });

    it('does not let an empty to ordinary to empty ABA admit a stale reopen', async () => {
        const controls = installFakeAudioIndexedDb();
        const id = 'reopen-vacant-aba';
        const leaseId = 'reopen-vacant-aba-lease';
        await audioBufferCache.persistPreparedBuffer({
            id,
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            leaseId,
        });
        clearRuntimeAudioBufferCache();
        controls.pauseReadonlySettlements();
        const reopen = audioBufferCache.reopenPreparedBuffer({
            id,
            leaseId,
            context: createTestContext(
                vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                    createAudioBuffer({ length, sampleRate })
                )
            ),
        });
        while (controls.pendingReadonlySettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.abortNextWrite();
        audioBufferCache.set(id, createAudioBuffer({ length: 1, sampleRate: 48_000 }));
        audioBufferCache.remove(id);
        controls.releaseNextReadonlySettlement();

        await expect(reopen).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio reopen was superseded.',
        });
        expect(audioBufferCache.has(id)).toBe(false);
    });

    it('invalidates prepared persist and reopen publication across retained project transitions', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.pauseWriteSettlements();
        const source = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        const persistenceInput = { id: 'retained-transition-persist', buffer: source, leaseId: 'persist-lease' };
        const persistence = audioBufferCache.persistPreparedBuffer(persistenceInput);
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        clearRuntimeAudioBufferCache({ retainedIds: ['retained-project-buffer'] });
        controls.releaseNextWriteSettlement();
        await expect(persistence).resolves.toMatchObject({
            status: 'persisted',
            bufferId: 'retained-transition-persist',
        });
        expect(audioBufferCache.has('retained-transition-persist')).toBe(false);

        const reopenSource = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        const reopenInput = {
            id: 'retained-transition-reopen',
            buffer: reopenSource,
            leaseId: 'reopen-lease',
        };
        const reopenPersistence = audioBufferCache.persistPreparedBuffer(reopenInput);
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        const persisted = await reopenPersistence;
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected retained transition reopen fixture to persist');
        }
        clearRuntimeAudioBufferCache();
        controls.pauseReadonlySettlements();
        const reopen = audioBufferCache.reopenPreparedBuffer({
            id: 'retained-transition-reopen',
            leaseId: 'reopen-lease',
            context: createTestContext(
                vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                    createAudioBuffer({ length, sampleRate })
                )
            ),
        });
        while (controls.pendingReadonlySettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        clearRuntimeAudioBufferCache({ retainedIds: ['retained-project-buffer'] });
        controls.releaseNextReadonlySettlement();
        await expect(reopen).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio reopen was superseded.',
        });
        expect(audioBufferCache.has('retained-transition-reopen')).toBe(false);

        const retainedResident = audioBufferCache.persistPreparedBuffer({
            id: 'retained-temporary-publication',
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            leaseId: 'retained-temporary-lease',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await expect(retainedResident).resolves.toMatchObject({ status: 'persisted' });
        expect(audioBufferCache.has('retained-temporary-publication')).toBe(true);

        clearRuntimeAudioBufferCache({ retainedIds: ['retained-temporary-publication'] });
        expect(audioBufferCache.has('retained-temporary-publication')).toBe(false);
    });

    it('does not let exact reopen replace ordinary or different prepared project ownership', async () => {
        const controls = installFakeAudioIndexedDb();
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );
        const ordinaryTemporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        ordinaryTemporary.getChannelData(0)[0] = 0.25;
        const ordinaryLease = await audioBufferCache.persistPreparedBuffer({
            id: 'reopen-ordinary-collision',
            buffer: ordinaryTemporary,
            leaseId: 'ordinary-stale-lease',
        });
        if (ordinaryLease.status !== 'persisted') {
            throw new TypeError('Expected ordinary reopen collision fixture to persist');
        }
        controls.pauseWriteSettlements();
        controls.abortNextWrite();
        const ordinary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        ordinary.getChannelData(0)[0] = 0.85;
        audioBufferCache.set('reopen-ordinary-collision', ordinary);
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await flushIndexedDbTasks(2);

        await expect(
            audioBufferCache.reopenPreparedBuffer({
                id: 'reopen-ordinary-collision',
                leaseId: 'ordinary-stale-lease',
                context,
            })
        ).resolves.toEqual({ status: 'failed', reason: 'Prepared audio buffer ID is already occupied.' });
        expect(audioBufferCache.get('reopen-ordinary-collision')).toBe(ordinary);

        vi.resetModules();
        ({ audioBufferCache, clearRuntimeAudioBufferCache } = await import('../audioBufferCache'));
        const projectControls = installFakeAudioIndexedDb();
        const projectA = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        projectA.getChannelData(0)[0] = 0.35;
        const projectLease = await audioBufferCache.persistPreparedBuffer({
            id: 'reopen-project-collision',
            buffer: projectA,
            leaseId: 'project-lease-a',
        });
        if (projectLease.status !== 'persisted') {
            throw new TypeError('Expected project reopen collision fixture to persist');
        }
        await audioBufferCache.releasePreparedBuffer({
            id: 'reopen-project-collision',
            leaseId: 'project-lease-a',
            disposition: 'project-owned',
        });
        clearRuntimeAudioBufferCache();

        await expect(
            audioBufferCache.reopenPreparedBuffer({
                id: 'reopen-project-collision',
                leaseId: 'project-lease-b',
                context,
            })
        ).resolves.toEqual({ status: 'mismatched' });
        expect(audioBufferCache.has('reopen-project-collision')).toBe(false);
        expect(projectControls.committedMeta.get('reopen-project-collision')?.preparedOwner).toMatchObject({
            leaseId: 'project-lease-a',
            status: 'project-owned',
        });
    });

    it('treats missing pinned project buffer IDs as occupied by the project', async () => {
        const controls = installFakeAudioIndexedDb();
        const context = createTestContext(vi.fn());
        const project = audioBufferCache.importBuffers({ context, buffers: {}, cacheIds: ['reserved-buffer-id'] });
        expect(project?.publish()).toBe(0);

        await expect(
            audioBufferCache.persistPreparedBuffer({
                id: 'reserved-buffer-id',
                buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
                leaseId: 'unrelated-prepared-lease',
            })
        ).resolves.toEqual({ status: 'failed', reason: 'Prepared audio buffer ID is reserved by the project.' });
        expect(controls.committed.has('reserved-buffer-id')).toBe(false);
        expect(controls.committedMeta.has('reserved-buffer-id')).toBe(false);
    });

    it('aborts queued prepared persistence when the project pins the ID after admission', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.pauseWriteSettlements();
        const persistence = audioBufferCache.persistPreparedBuffer({
            id: 'late-project-pin',
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            leaseId: 'late-project-pin-lease',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        const project = audioBufferCache.importBuffers({
            buffers: {},
            cacheIds: ['late-project-pin'],
            context: createTestContext(vi.fn()),
        });
        expect(project?.publish()).toBe(0);
        controls.releaseNextWriteSettlement();

        await expect(persistence).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio buffer ID is reserved by the project.',
        });
        expect(controls.committed.has('late-project-pin')).toBe(false);
        expect(controls.committedMeta.has('late-project-pin')).toBe(false);
        expect(audioBufferCache.has('late-project-pin')).toBe(false);
    });
});
