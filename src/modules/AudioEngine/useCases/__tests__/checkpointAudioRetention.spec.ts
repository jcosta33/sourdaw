import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    BUFFER_STORE,
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

const CURRENT_STORES = [BUFFER_STORE, META_STORE, RECOVERY_STORE, CHECKPOINT_RETENTION_STORE] as const;
const PROJECT_OWNER_ID = 'project-owner';

type RetentionApi = {
    acquire: typeof import('../acquireCheckpointAudioRetention').acquireCheckpointAudioRetention;
    release: typeof import('../releaseCheckpointAudioRetention').releaseCheckpointAudioRetention;
    collectByAge: typeof import('../garbageCollectCachedAudioBuffersByAge').garbageCollectCachedAudioBuffersByAge;
    collectBySize: typeof import('../garbageCollectCachedAudioBuffersBySize').garbageCollectCachedAudioBuffersBySize;
    collectFreeze: typeof import('../garbageCollectFreezeAudioBuffers').garbageCollectFreezeAudioBuffers;
    clear: typeof import('../clearCachedAudioBuffers').clearCachedAudioBuffers;
    remove: typeof import('../discardDecodedAudioFile').discardDecodedAudioFile;
    prepare: typeof import('../prepareCachedAudioBuffersFromIdb').prepareCachedAudioBuffersFromIdb;
};

async function importApi(): Promise<RetentionApi> {
    const [acquire, release, collectByAge, collectBySize, collectFreeze, clear, remove, prepare] = await Promise.all([
        import('../acquireCheckpointAudioRetention'),
        import('../releaseCheckpointAudioRetention'),
        import('../garbageCollectCachedAudioBuffersByAge'),
        import('../garbageCollectCachedAudioBuffersBySize'),
        import('../garbageCollectFreezeAudioBuffers'),
        import('../clearCachedAudioBuffers'),
        import('../discardDecodedAudioFile'),
        import('../prepareCachedAudioBuffersFromIdb'),
    ]);
    return {
        acquire: acquire.acquireCheckpointAudioRetention,
        release: release.releaseCheckpointAudioRetention,
        collectByAge: collectByAge.garbageCollectCachedAudioBuffersByAge,
        collectBySize: collectBySize.garbageCollectCachedAudioBuffersBySize,
        collectFreeze: collectFreeze.garbageCollectFreezeAudioBuffers,
        clear: clear.clearCachedAudioBuffers,
        remove: remove.discardDecodedAudioFile,
        prepare: prepare.prepareCachedAudioBuffersFromIdb,
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
    controls.committedMeta.set(id, storedMetadata(values, freezeProjectId));
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

function audioContext(): BaseAudioContext {
    return createTestContext(
        vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
            createAudioBuffer({ length, sampleRate })
        )
    );
}

describe('checkpoint audio retention', () => {
    let controls: FakeAudioIndexedDbControls;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        installTestAudioBufferConstructor();
        controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('stores canonical durable ownership and refuses duplicate checkpoint IDs', async () => {
        seedBuffer(controls, 'buffer-a');
        seedBuffer(controls, 'buffer-b');
        const { acquire } = await importApi();

        const ownership = await acquire({
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['buffer-b', 'buffer-a', 'buffer-b'],
        });

        expect(ownership.ownershipToken).toEqual(expect.any(String));
        expect(ownership.ownershipToken.length).toBeGreaterThan(0);
        expect(controls.committedCheckpointRetentions.get('checkpoint-a')).toEqual({
            schemaVersion: 1,
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['buffer-a', 'buffer-b'],
            ownershipToken: ownership.ownershipToken,
        });

        await expect(
            acquire({
                checkpointId: 'checkpoint-a',
                projectOwnerId: PROJECT_OWNER_ID,
                bufferIds: ['buffer-a'],
            })
        ).rejects.toThrow(/already exists/i);
        await expect(
            acquire({
                checkpointId: 'checkpoint-a',
                projectOwnerId: 'other-project',
                bufferIds: ['buffer-b'],
            })
        ).rejects.toThrow(/already exists/i);
        expect(controls.committedCheckpointRetentions.get('checkpoint-a')?.ownershipToken).toBe(
            ownership.ownershipToken
        );
    });

    it('rejects missing or invalid PCM without publishing ownership', async () => {
        seedBuffer(controls, 'valid');
        seedBuffer(controls, 'invalid');
        controls.committedMeta.set('invalid', { lastAccessed: 100, sizeInBytes: 999 });
        const { acquire } = await importApi();

        await expect(
            acquire({
                checkpointId: 'missing-checkpoint',
                projectOwnerId: PROJECT_OWNER_ID,
                bufferIds: ['valid', 'missing'],
            })
        ).rejects.toThrow(/missing or invalid/i);
        await expect(
            acquire({
                checkpointId: 'invalid-checkpoint',
                projectOwnerId: PROJECT_OWNER_ID,
                bufferIds: ['invalid'],
            })
        ).rejects.toThrow(/missing or invalid/i);
        await expect(
            acquire({
                checkpointId: 'sparse-checkpoint',
                projectOwnerId: PROJECT_OWNER_ID,
                bufferIds: sparseBufferIds(),
            })
        ).rejects.toThrow(/non-empty buffer IDs/i);
        expect(controls.committedCheckpointRetentions.size).toBe(0);
    });

    it('publishes no ownership when the acquisition transaction aborts', async () => {
        seedBuffer(controls, 'buffer-a');
        controls.abortNextWrite();
        const { acquire } = await importApi();

        await expect(
            acquire({
                checkpointId: 'checkpoint-a',
                projectOwnerId: PROJECT_OWNER_ID,
                bufferIds: ['buffer-a'],
            })
        ).rejects.toThrow();
        expect(controls.committedCheckpointRetentions.size).toBe(0);
    });

    it('requires the exact owner and token to release durable ownership', async () => {
        seedBuffer(controls, 'buffer-a');
        const { acquire, release } = await importApi();
        const ownership = await acquire({
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
        const { acquire, collectBySize, release } = await importApi();
        const first = await acquire({
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['shared'],
        });
        const second = await acquire({
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

    it('preserves retained ordinary and freeze PCM through every deletion route and module restart', async () => {
        const retainedIds = ['freeze-retained', 'age-retained', 'size-retained', 'remove-retained', 'clear-retained'];
        for (const id of retainedIds) {
            seedBuffer(controls, id, [0.25], id.startsWith('freeze-') ? 200 : undefined);
        }
        seedBuffer(controls, 'freeze-control', [0.5], 200);
        seedBuffer(controls, 'age-control');
        const api = await importApi();
        await api.acquire({
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
            schemaVersion: 1,
            checkpointId: 'invalid',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['not-sorted', 'also-not-sorted'],
            ownershipToken: 'token',
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
            schemaVersion: 1,
            checkpointId: 'sparse',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: sparseBufferIds(),
            ownershipToken: 'token',
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
        const acquisition = secondConnection.acquire({
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['freeze-candidate'],
        });

        controls.releaseNextWriteSettlement();
        await expect(collection).resolves.toBeUndefined();
        await waitForHeldWrite(controls);
        controls.releaseNextWriteSettlement();
        await expect(acquisition).rejects.toThrow(/missing or invalid/i);
        expect(controls.committedCheckpointRetentions.size).toBe(0);
    });

    it('preserves PCM when acquisition commits first and a collector follows on another connection', async () => {
        seedBuffer(controls, 'freeze-candidate', [0.25], 200);
        controls.pauseWriteSettlements();
        const firstConnection = await importApi();
        const acquisition = firstConnection.acquire({
            checkpointId: 'checkpoint-a',
            projectOwnerId: PROJECT_OWNER_ID,
            bufferIds: ['freeze-candidate'],
        });
        await waitForHeldWrite(controls);

        vi.resetModules();
        const secondConnection = await importApi();
        const collection = secondConnection.collectFreeze({ activeBufferIds: new Set(), projectId: 200 });

        controls.releaseNextWriteSettlement();
        await expect(acquisition).resolves.toEqual({ ownershipToken: expect.any(String) });
        await waitForHeldWrite(controls);
        controls.releaseNextWriteSettlement();
        await expect(collection).resolves.toBeUndefined();
        expect(controls.committed.has('freeze-candidate')).toBe(true);
    });
});
