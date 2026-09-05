import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    BUFFER_STORE,
    flushIndexedDbTasks,
    installFakeAudioIndexedDb,
    META_STORE,
    RECOVERY_STORE,
    type FakeAudioIndexedDbControls,
    type StoredAudioBuffer,
    type StoredBufferMeta,
    type StoredRecoveryRecord,
} from './fakeAudioBufferIndexedDb';
import {
    createAudioBuffer,
    createTestContext,
    installTestAudioBufferConstructor,
} from './preparedAudioBufferTestSupport';

let audioBufferCache: typeof import('../audioBufferCache').audioBufferCache;
let clearRuntimeAudioBufferCache: typeof import('../audioBufferCache').clearRuntimeAudioBufferCache;

const CURRENT_STORES = [BUFFER_STORE, META_STORE, RECOVERY_STORE] as const;

function makeBuffer(values: readonly number[]): AudioBuffer {
    const buffer = createAudioBuffer({ length: values.length, sampleRate: 48_000 });
    buffer.getChannelData(0).set(values);
    return buffer;
}

function makeStoredBuffer(values: readonly number[]): StoredAudioBuffer {
    return {
        sampleRate: 48_000,
        numberOfChannels: 1,
        channelData: [new Float32Array(values)],
        lastAccessed: 100,
        sizeInBytes: values.length * Float32Array.BYTES_PER_ELEMENT,
    };
}

function makeMetadata(values: readonly number[], freezeProjectId?: number): StoredBufferMeta {
    const metadata: StoredBufferMeta = {
        lastAccessed: 100,
        sizeInBytes: values.length * Float32Array.BYTES_PER_ELEMENT,
    };
    if (freezeProjectId !== undefined) {
        metadata.freezeProjectId = freezeProjectId;
    }
    return metadata;
}

function seedOrdinaryBuffer(
    controls: FakeAudioIndexedDbControls,
    id: string,
    values: readonly number[],
    freezeProjectId?: number
): void {
    controls.committed.set(id, makeStoredBuffer(values));
    controls.committedMeta.set(id, makeMetadata(values, freezeProjectId));
}

function makeRecovery(id: string, revision: string, values: readonly number[]): StoredRecoveryRecord {
    return {
        data: makeStoredBuffer(values),
        id,
        metadata: {
            ...makeMetadata(values),
            preparedOwner: {
                schemaVersion: 1,
                leaseId: `${id}-lease`,
                persistenceRevision: `${id}-persistence`,
                status: 'project-owned',
            },
        },
        operation: 'reclamation',
        revision,
        schemaVersion: 1,
        stagedAtMs: 100,
    };
}

function testContext(): BaseAudioContext {
    return createTestContext(
        vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
            createAudioBuffer({ length, sampleRate })
        )
    );
}

async function waitForPendingWrite(controls: FakeAudioIndexedDbControls): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (controls.pendingWriteSettlementCount() > 0) {
            return;
        }
        await flushIndexedDbTasks(1);
    }
    throw new Error('Expected a pending audio write settlement');
}

async function settlePromiseWithWrites<Result>(
    promise: Promise<Result>,
    controls: FakeAudioIndexedDbControls
): Promise<Result> {
    let settled = false;
    void promise.finally(() => {
        settled = true;
    });
    for (let attempt = 0; attempt < 100 && !settled; attempt++) {
        if (controls.pendingWriteSettlementCount() > 0) {
            controls.releaseNextWriteSettlement();
        }
        await flushIndexedDbTasks(1);
    }
    if (!settled) {
        throw new Error('Expected the audio operation to settle');
    }
    return promise;
}

async function expectDurableReceipt(ids: readonly string[]) {
    const result = await audioBufferCache.ensureDurable(ids);
    expect(result.status).toBe('durable');
    if (result.status !== 'durable') {
        throw new Error(`Expected durable receipt, received ${result.status}`);
    }
    return result;
}

beforeEach(async () => {
    vi.resetModules();
    installTestAudioBufferConstructor();
    ({ audioBufferCache, clearRuntimeAudioBufferCache } = await import('../audioBufferCache'));
});

afterEach(() => {
    clearRuntimeAudioBufferCache();
    vi.unstubAllGlobals();
});

describe('audio buffer save durability', () => {
    it('issues a current receipt for an empty snapshot without opening the audio database', async () => {
        const controls = installFakeAudioIndexedDb({ blockOpens: 'forever' });

        const receipt = await expectDurableReceipt([]);

        expect(controls.openRequestCount()).toBe(0);
        expect(receipt.isCurrent()).toBe(true);
        receipt.release();
    });

    it('does not report durability before an ordinary transaction commits', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        controls.pauseWriteSettlements();
        audioBufferCache.set('pending-buffer', makeBuffer([0.25]));

        const durability = audioBufferCache.ensureDurable(['pending-buffer']);
        let settled = false;
        void durability.then(() => {
            settled = true;
        });
        await waitForPendingWrite(controls);
        await flushIndexedDbTasks(2);

        expect(settled).toBe(false);
        controls.releaseNextWriteSettlement();
        const receipt = await durability;
        expect(receipt.status).toBe('durable');
        if (receipt.status === 'durable') {
            receipt.release();
        }
    });

    it('protects every required row while an admitted ordinary write is still settling', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        seedOrdinaryBuffer(controls, 'inactive-arrangement-buffer', [0.5]);
        expect(audioBufferCache.has('inactive-arrangement-buffer')).toBe(false);
        controls.pauseWriteSettlements();
        audioBufferCache.set('pending-buffer', makeBuffer([0.25]));
        const durability = audioBufferCache.ensureDurable(['inactive-arrangement-buffer', 'pending-buffer']);
        await waitForPendingWrite(controls);

        const collection = audioBufferCache.garbageCollectBySize(0);
        for (let attempt = 0; attempt < 100 && controls.writeTransactionCount() < 2; attempt++) {
            await flushIndexedDbTasks(1);
        }
        expect(controls.writeTransactionCount()).toBe(2);
        const [deleted, result] = await settlePromiseWithWrites(Promise.all([collection, durability]), controls);

        expect(deleted).toBe(0);
        expect(controls.committed.has('inactive-arrangement-buffer')).toBe(true);
        expect(result.status).toBe('durable');
        if (result.status === 'durable') {
            result.release();
        }
    });

    it('fails the admitted barrier when its pending ordinary attempt aborts and retries only on a later barrier', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        seedOrdinaryBuffer(controls, 'released-after-failure', [0.5]);
        controls.pauseWriteSettlements();
        controls.abortNextWrite();
        audioBufferCache.set('pending-failure', makeBuffer([0.25]));
        const durability = audioBufferCache.ensureDurable(['released-after-failure', 'pending-failure']);
        await waitForPendingWrite(controls);

        controls.releaseNextWriteSettlement();

        await expect(durability).resolves.toEqual({
            status: 'failed',
            failedIds: ['pending-failure'],
        });
        expect(controls.writeTransactionCount()).toBe(1);

        const collectedAfterFailure = await settlePromiseWithWrites(audioBufferCache.garbageCollectBySize(0), controls);
        expect(collectedAfterFailure).toBe(1);
        expect(controls.committed.has('released-after-failure')).toBe(false);

        const retry = audioBufferCache.ensureDurable(['pending-failure']);
        const receipt = await settlePromiseWithWrites(retry, controls);
        expect(receipt.status).toBe('durable');
        if (receipt.status === 'durable') {
            receipt.release();
        }
        expect(controls.writeTransactionCount()).toBe(4);
    });

    it('retains an exact failed source after LRU eviction, retries it once, and restores its samples', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        const values = [0.125, -0.5, 0.75];
        controls.abortWritesTo(BUFFER_STORE);
        audioBufferCache.set('failed-buffer', makeBuffer(values));
        await flushIndexedDbTasks();

        expect(controls.committed.has('failed-buffer')).toBe(false);
        expect(audioBufferCache.get('failed-buffer')?.getChannelData(0)).toEqual(new Float32Array(values));

        controls.allowWrites();
        for (let index = 0; index < 64; index++) {
            audioBufferCache.set(`filler-${index}`, makeBuffer([index / 64]));
        }
        await vi.waitFor(() => expect(controls.committed.size).toBe(64));
        expect(audioBufferCache.has('failed-buffer')).toBe(false);
        const receipt = await expectDurableReceipt(['failed-buffer']);
        receipt.release();

        expect(Array.from(controls.committed.get('failed-buffer')?.channelData[0] ?? [])).toEqual(values);
        clearRuntimeAudioBufferCache();
        await audioBufferCache.restoreFromIdb({ context: testContext(), ids: ['failed-buffer'] });
        expect(audioBufferCache.get('failed-buffer')?.getChannelData(0)).toEqual(new Float32Array(values));
    });

    it('accepts a valid current-format durable row when its decoded runtime buffer is absent', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        seedOrdinaryBuffer(controls, 'runtime-absent', [0.4]);

        const receipt = await expectDurableReceipt(['runtime-absent']);

        expect(audioBufferCache.has('runtime-absent')).toBe(false);
        expect(controls.writeTransactionCount()).toBe(0);
        receipt.release();
    });

    it.each(['missing PCM', 'malformed PCM', 'invalid ownership'] as const)(
        'rejects current-format required audio with %s',
        async (invalidity) => {
            const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
            if (invalidity !== 'missing PCM') {
                seedOrdinaryBuffer(controls, 'invalid-buffer', [0.4]);
            }
            if (invalidity === 'malformed PCM') {
                controls.committed.set('invalid-buffer', {
                    ...makeStoredBuffer([0.4]),
                    sizeInBytes: 8,
                });
            }
            if (invalidity === 'invalid ownership') {
                controls.committedMeta.set('invalid-buffer', {
                    ...makeMetadata([0.4]),
                    preparedOwner: {
                        schemaVersion: 1,
                        leaseId: '',
                        status: 'project-owned',
                    },
                });
            }

            await expect(audioBufferCache.ensureDurable(['invalid-buffer'])).resolves.toEqual({
                status: 'failed',
                failedIds: ['invalid-buffer'],
            });
        }
    );

    it.each(['replacement', 'removal', 'project transition'] as const)(
        'invalidates a held receipt synchronously on same-ID %s',
        async (superseder) => {
            const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
            seedOrdinaryBuffer(controls, 'held-receipt', [0.2]);
            const receipt = await expectDurableReceipt(['held-receipt']);

            if (superseder === 'replacement') {
                audioBufferCache.set('held-receipt', makeBuffer([0.8]));
            } else if (superseder === 'removal') {
                audioBufferCache.remove('held-receipt');
            } else {
                clearRuntimeAudioBufferCache();
            }

            expect(receipt.isCurrent()).toBe(false);
            receipt.release();
            await flushIndexedDbTasks();
        }
    );

    it('invalidates a held receipt when an imported buffer publishes the same ID', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        seedOrdinaryBuffer(controls, 'imported-replacement', [0.2]);
        const receipt = await expectDurableReceipt(['imported-replacement']);
        const imported = audioBufferCache.importBuffers({
            buffers: {},
            decodedBuffers: { 'imported-replacement': makeBuffer([0.8]) },
            context: testContext(),
        });
        if (!imported) {
            throw new Error('Expected a valid imported audio candidate');
        }

        expect(imported.publish()).toBe(1);
        expect(receipt.isCurrent()).toBe(false);
        receipt.release();
    });

    it('observes a failed import batch, then retries exact resident and nonresident sources on a later barrier', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        seedOrdinaryBuffer(controls, 'imported-replacement', [0.2]);
        const imported = audioBufferCache.importBuffers({
            buffers: {},
            cacheIds: ['imported-replacement'],
            decodedBuffers: {
                'imported-replacement': makeBuffer([0.8]),
                'inactive-import': makeBuffer([0.6]),
            },
            context: testContext(),
        });
        if (!imported) {
            throw new Error('Expected a valid imported audio candidate');
        }
        expect(imported.publish()).toBe(1);
        expect(audioBufferCache.has('inactive-import')).toBe(false);
        controls.pauseWriteSettlements();
        controls.abortNextWrite();
        const persistence = imported.persist();
        const firstBarrier = audioBufferCache.ensureDurable(['imported-replacement', 'inactive-import']);
        await waitForPendingWrite(controls);
        controls.releaseNextWriteSettlement();

        await expect(persistence).resolves.toBe(false);
        await expect(firstBarrier).resolves.toEqual({
            status: 'failed',
            failedIds: ['imported-replacement', 'inactive-import'],
        });
        expect(audioBufferCache.get('imported-replacement')?.getChannelData(0)[0]).toBeCloseTo(0.8);

        const retry = audioBufferCache.ensureDurable(['imported-replacement', 'inactive-import']);
        const receipt = await settlePromiseWithWrites(retry, controls);
        expect(receipt.status).toBe('durable');
        if (receipt.status !== 'durable') {
            return;
        }

        clearRuntimeAudioBufferCache();
        await audioBufferCache.restoreFromIdb({
            context: testContext(),
            ids: ['imported-replacement', 'inactive-import'],
        });
        expect(audioBufferCache.get('imported-replacement')?.getChannelData(0)[0]).toBeCloseTo(0.8);
        expect(audioBufferCache.get('inactive-import')?.getChannelData(0)[0]).toBeCloseTo(0.6);
        receipt.release();
    });

    it.each(['replacement', 'removal', 'project transition'] as const)(
        'returns superseded when same-ID %s happens before a receipt exists',
        async (superseder) => {
            const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
            controls.pauseWriteSettlements();
            audioBufferCache.set('pending-snapshot', makeBuffer([0.2]));
            const durability = audioBufferCache.ensureDurable(['pending-snapshot']);
            await waitForPendingWrite(controls);

            if (superseder === 'replacement') {
                audioBufferCache.set('pending-snapshot', makeBuffer([0.8]));
            } else if (superseder === 'removal') {
                audioBufferCache.remove('pending-snapshot');
            } else {
                clearRuntimeAudioBufferCache();
            }
            controls.releaseNextWriteSettlement();

            await expect(durability).resolves.toEqual({ status: 'superseded' });
            for (let attempt = 0; attempt < 10; attempt++) {
                await flushIndexedDbTasks(1);
                if (controls.pendingWriteSettlementCount() > 0) {
                    controls.releaseNextWriteSettlement();
                }
            }
        }
    );

    it.each(['age', 'size', 'freeze'] as const)(
        'keeps a held required record out of %s collection while collecting an eligible peer',
        async (collector) => {
            const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
            const projectId = 1_700_000_000_000;
            const requiredId = collector === 'freeze' ? 'freeze-required' : `${collector}-required`;
            const peerId = collector === 'freeze' ? 'freeze-peer' : `${collector}-peer`;
            seedOrdinaryBuffer(controls, requiredId, [0.1], collector === 'freeze' ? projectId : undefined);
            seedOrdinaryBuffer(controls, peerId, [0.2], collector === 'freeze' ? projectId : undefined);
            const receipt = await expectDurableReceipt([requiredId]);

            if (collector === 'age') {
                await audioBufferCache.garbageCollectByAge(0);
            } else if (collector === 'size') {
                await audioBufferCache.garbageCollectBySize(0);
            } else {
                await audioBufferCache.garbageCollectFreezeFiles({ activeIds: new Set(), projectId });
            }

            expect(controls.committed.has(requiredId)).toBe(true);
            expect(controls.committedMeta.has(requiredId)).toBe(true);
            expect(controls.committed.has(peerId)).toBe(false);
            expect(controls.committedMeta.has(peerId)).toBe(false);
            expect(receipt.isCurrent()).toBe(true);
            receipt.release();
        }
    );

    it('does not adopt or rewrite a temporary prepared owner', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        const persisted = await audioBufferCache.persistPreparedBuffer({
            id: 'temporary-owner',
            buffer: makeBuffer([0.35]),
            leaseId: 'temporary-owner-lease',
        });
        expect(persisted.status).toBe('persisted');

        await expect(audioBufferCache.ensureDurable(['temporary-owner'])).resolves.toEqual({
            status: 'failed',
            failedIds: ['temporary-owner'],
        });
        expect(controls.committedMeta.get('temporary-owner')?.preparedOwner).toMatchObject({
            leaseId: 'temporary-owner-lease',
            status: 'temporary',
        });
        expect(audioBufferCache.get('temporary-owner')?.getChannelData(0)[0]).toBeCloseTo(0.35);
    });

    it('waits for an exact in-flight promotion and blocks a later promotion while the receipt is held', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        await audioBufferCache.persistPreparedBuffer({
            id: 'promoting-owner',
            buffer: makeBuffer([0.45]),
            leaseId: 'promoting-owner-lease',
        });
        controls.pauseWriteSettlements();
        const promotion = audioBufferCache.releasePreparedBuffer({
            id: 'promoting-owner',
            leaseId: 'promoting-owner-lease',
            disposition: 'project-owned',
        });
        const durability = audioBufferCache.ensureDurable(['promoting-owner']);
        let durabilitySettled = false;
        void durability.then(() => {
            durabilitySettled = true;
        });
        await waitForPendingWrite(controls);

        expect(durabilitySettled).toBe(false);
        await expect(settlePromiseWithWrites(promotion, controls)).resolves.toEqual({
            status: 'released',
            disposition: 'project-owned',
        });
        const receipt = await durability;
        expect(receipt.status).toBe('durable');
        if (receipt.status !== 'durable') {
            return;
        }

        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: 'promoting-owner',
                leaseId: 'promoting-owner-lease',
                disposition: 'project-owned',
            })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio buffer ID is reserved by the project.',
        });
        expect(receipt.isCurrent()).toBe(true);
        receipt.release();
    });

    it('protects and awaits exact in-flight prepared persistence and promotion before strengthening the receipt', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        controls.pauseWriteSettlements();
        const persistence = audioBufferCache.persistPreparedBuffer({
            id: 'prepared-in-flight',
            buffer: makeBuffer([0.55]),
            leaseId: 'prepared-in-flight-lease',
        });
        await waitForPendingWrite(controls);
        const promotion = audioBufferCache.releasePreparedBuffer({
            id: 'prepared-in-flight',
            leaseId: 'prepared-in-flight-lease',
            disposition: 'project-owned',
        });
        const durability = audioBufferCache.ensureDurable(['prepared-in-flight']);
        let durabilitySettled = false;
        void durability.then(() => {
            durabilitySettled = true;
        });
        await flushIndexedDbTasks(2);
        expect(durabilitySettled).toBe(false);

        const [persisted, promoted, receipt] = await settlePromiseWithWrites(
            Promise.all([persistence, promotion, durability]),
            controls
        );

        expect(persisted).toEqual({
            status: 'persisted',
            bufferId: 'prepared-in-flight',
            leaseId: 'prepared-in-flight-lease',
        });
        expect(promoted).toEqual({ status: 'released', disposition: 'project-owned' });
        expect(receipt.status).toBe('durable');
        if (receipt.status === 'durable') {
            receipt.release();
        }
    });

    it('releases collection protection after an in-flight prepared persistence fails', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        seedOrdinaryBuffer(controls, 'released-after-prepared-failure', [0.5]);
        controls.pauseWriteSettlements();
        controls.abortNextWrite();
        const persistence = audioBufferCache.persistPreparedBuffer({
            id: 'prepared-in-flight-failure',
            buffer: makeBuffer([0.55]),
            leaseId: 'prepared-in-flight-failure-lease',
        });
        await waitForPendingWrite(controls);
        const durability = audioBufferCache.ensureDurable([
            'released-after-prepared-failure',
            'prepared-in-flight-failure',
        ]);

        controls.releaseNextWriteSettlement();
        await expect(persistence).resolves.toEqual({
            status: 'failed',
            reason: 'IDB transaction aborted',
        });
        await expect(durability).resolves.toEqual({
            status: 'failed',
            failedIds: ['prepared-in-flight-failure'],
        });

        const deleted = await settlePromiseWithWrites(audioBufferCache.garbageCollectBySize(0), controls);
        expect(deleted).toBe(1);
        expect(controls.committed.has('released-after-prepared-failure')).toBe(false);
    });

    it('restores only the exact finalized recovery source captured for the snapshot', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        controls.committedRecovery.set('recoverable-owner', makeRecovery('recoverable-owner', 'recovery-a', [0.6]));

        const receipt = await expectDurableReceipt(['recoverable-owner']);

        expect(Array.from(controls.committed.get('recoverable-owner')?.channelData[0] ?? [])).toEqual([
            Math.fround(0.6),
        ]);
        expect(controls.committedMeta.get('recoverable-owner')?.preparedOwner).toMatchObject({
            leaseId: 'recoverable-owner-lease',
            status: 'project-owned',
        });
        expect(controls.committedRecovery.has('recoverable-owner')).toBe(false);
        receipt.release();
    });

    it('returns superseded when a later recovery revision replaces the captured source', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        await audioBufferCache.restoreFromIdb({ context: testContext(), ids: [] });
        controls.committedRecovery.set('changed-recovery', makeRecovery('changed-recovery', 'recovery-a', [0.6]));
        controls.pauseReadonlySettlements();
        const durability = audioBufferCache.ensureDurable(['changed-recovery']);
        for (let attempt = 0; attempt < 100 && controls.pendingReadonlySettlementCount() === 0; attempt++) {
            await flushIndexedDbTasks(1);
        }
        expect(controls.pendingReadonlySettlementCount()).toBe(1);

        controls.committedRecovery.set('changed-recovery', makeRecovery('changed-recovery', 'recovery-b', [0.9]));
        controls.releaseNextReadonlySettlement();

        await expect(durability).resolves.toEqual({ status: 'superseded' });
        expect(controls.committed.has('changed-recovery')).toBe(false);
        expect(controls.committedRecovery.get('changed-recovery')).toMatchObject({ revision: 'recovery-b' });
    });

    it('aborts a held exact recovery on project transition and leaves its source recoverable', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        controls.committedRecovery.set(
            'transition-recovery',
            makeRecovery('transition-recovery', 'recovery-transition', [0.7])
        );
        controls.pauseWriteSettlements();
        const durability = audioBufferCache.ensureDurable(['transition-recovery']);
        await waitForPendingWrite(controls);

        clearRuntimeAudioBufferCache();

        await expect(durability).resolves.toEqual({ status: 'superseded' });
        expect(controls.committed.has('transition-recovery')).toBe(false);
        expect(controls.committedRecovery.get('transition-recovery')).toMatchObject({
            revision: 'recovery-transition',
        });
        controls.releaseNextWriteSettlement();
    });

    it('deduplicates shared IDs without touching unrelated durable rows', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        seedOrdinaryBuffer(controls, 'shared-buffer', [0.3]);
        seedOrdinaryBuffer(controls, 'unrelated-buffer', [0.9]);
        const unrelatedData = controls.committed.get('unrelated-buffer');
        const unrelatedMetadata = controls.committedMeta.get('unrelated-buffer');

        const receipt = await expectDurableReceipt(['shared-buffer', 'shared-buffer']);

        expect(controls.writeTransactionCount()).toBe(0);
        expect(controls.committed.get('unrelated-buffer')).toBe(unrelatedData);
        expect(controls.committedMeta.get('unrelated-buffer')).toBe(unrelatedMetadata);
        receipt.release();
    });
});
