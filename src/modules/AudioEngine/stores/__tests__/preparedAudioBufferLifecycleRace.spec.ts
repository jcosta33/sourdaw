import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPreparedAudioBufferLifecycle } from '../preparedAudioBufferLifecycle';

import { BUFFER_STORE, flushIndexedDbTasks, installFakeAudioIndexedDb, META_STORE } from './fakeAudioBufferIndexedDb';
import { createAudioBuffer, createTestContext, openAudioDatabase } from './preparedAudioBufferTestSupport';

let audioBufferCache: typeof import('../audioBufferCache').audioBufferCache;

beforeEach(async () => {
    vi.resetModules();
    ({ audioBufferCache } = await import('../audioBufferCache'));
});

afterEach(() => {
    audioBufferCache.clear();
    vi.unstubAllGlobals();
});

async function settlePendingWrites(
    controls: ReturnType<typeof installFakeAudioIndexedDb>,
    isSettled: () => boolean
): Promise<void> {
    for (let turn = 0; turn < 40 && !isSettled(); turn++) {
        if (controls.pendingWriteSettlementCount() > 0) {
            controls.releaseNextWriteSettlement();
        }
        await flushIndexedDbTasks(1);
    }
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
    for (let turn = 0; turn < 40; turn++) {
        if (condition()) {
            return;
        }
        await flushIndexedDbTasks(1);
    }
    throw new Error(message);
}

describe('prepared audio-buffer lifecycle races', () => {
    it.each(['project-owned', 'discard'] as const)(
        'does not let stale %s settlement cancel an admitted ordinary write',
        async (disposition) => {
            const controls = installFakeAudioIndexedDb();
            const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
            const persisted = await audioBufferCache.persistPreparedBuffer({
                id: `stale-${disposition}`,
                buffer: temporary,
                leaseId: `stale-${disposition}-lease`,
            });
            expect(persisted.status).toBe('persisted');
            controls.pauseWriteSettlements();

            const ordinary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
            ordinary.getChannelData(0)[0] = 0.8;
            audioBufferCache.set(`stale-${disposition}`, ordinary);
            let settlementSettled = false;
            const settlement = audioBufferCache
                .releasePreparedBuffer({
                    id: `stale-${disposition}`,
                    leaseId: `stale-${disposition}-lease`,
                    disposition,
                })
                .then((result) => {
                    settlementSettled = true;
                    return result;
                });

            await settlePendingWrites(controls, () => settlementSettled);
            const result = await settlement;
            await settlePendingWrites(
                controls,
                () => controls.committed.get(`stale-${disposition}`)?.channelData[0]?.[0] === 0.8
            );
            expect(result.status === 'failed' || result.status === 'mismatched').toBe(true);
            expect(controls.committed.get(`stale-${disposition}`)?.channelData[0]?.[0]).toBeCloseTo(0.8);
            expect(controls.committedMeta.get(`stale-${disposition}`)?.preparedOwner).toBeUndefined();
        }
    );

    it('does not let a stale lifecycle rollback demote a newer same-lease promotion', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE, META_STORE] });
        const id = 'promotion-revision-aba';
        const leaseId = 'shared-promotion-lease';
        const data = {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.5])],
            lastAccessed: 1,
            sizeInBytes: 4,
        };
        controls.committed.set(id, data);
        controls.committedMeta.set(id, {
            lastAccessed: 1,
            preparedOwner: { schemaVersion: 1, leaseId, status: 'temporary' },
            sizeInBytes: 4,
        });

        let releaseRollbackDatabase: ((database: IDBDatabase) => void) | undefined;
        let openCount = 0;
        const runtimeA = new Map<string, AudioBuffer>();
        const lifecycleA = createPreparedAudioBufferLifecycle({
            bufferStoreName: 'buffers',
            claimDurableMutation: () => 1,
            evictRuntime: (bufferId) => runtimeA.delete(bufferId),
            finishDurableMutation: () => undefined,
            hasPinnedReservation: () => false,
            hasRuntime: (bufferId) => runtimeA.has(bufferId),
            isDurableMutationCurrent: () => true,
            isValidSerializedBuffer: (candidate): candidate is typeof data => candidate?.sizeInBytes === 4,
            metadataStoreName: 'bufferMeta',
            openDatabase: async () => {
                openCount++;
                if (openCount === 3) {
                    return new Promise<IDBDatabase>((resolve) => {
                        releaseRollbackDatabase = resolve;
                    });
                }
                return openAudioDatabase();
            },
            publishRuntime: (bufferId, buffer) => runtimeA.set(bufferId, buffer),
            recoveryStoreName: 'preparedBufferRecovery',
        });
        const context = createTestContext(
            vi.fn((_channels: number, length: number, sampleRate: number) => createAudioBuffer({ length, sampleRate }))
        );
        await expect(lifecycleA.reopen({ id, leaseId, context })).resolves.toEqual({
            status: 'reopened',
            bufferId: id,
            ownership: 'temporary',
        });
        controls.pauseWriteSettlements();
        let staleSettled = false;
        const stalePromotion = lifecycleA.release({ id, leaseId, disposition: 'project-owned' }).then((result) => {
            staleSettled = true;
            return result;
        });
        await waitFor(
            () => controls.pendingWriteSettlementCount() > 0 || staleSettled,
            'first promotion never reached commit'
        );
        expect(staleSettled).toBe(false);
        controls.releaseNextWriteSettlement();
        lifecycleA.beginProjectTransition();
        await waitFor(() => releaseRollbackDatabase !== undefined, 'stale promotion never reached rollback');

        const runtimeB = new Map<string, AudioBuffer>();
        const lifecycleB = createPreparedAudioBufferLifecycle({
            bufferStoreName: 'buffers',
            claimDurableMutation: () => 1,
            evictRuntime: (bufferId) => runtimeB.delete(bufferId),
            finishDurableMutation: () => undefined,
            hasPinnedReservation: () => false,
            hasRuntime: (bufferId) => runtimeB.has(bufferId),
            isDurableMutationCurrent: () => true,
            isValidSerializedBuffer: (candidate): candidate is typeof data => candidate?.sizeInBytes === 4,
            metadataStoreName: 'bufferMeta',
            openDatabase: openAudioDatabase,
            publishRuntime: (bufferId, buffer) => runtimeB.set(bufferId, buffer),
            recoveryStoreName: 'preparedBufferRecovery',
        });
        let reopened = false;
        const recoveredReopen = lifecycleB.reopen({ id, leaseId, context }).then((result) => {
            reopened = true;
            return result;
        });
        await settlePendingWrites(controls, () => reopened);
        await expect(recoveredReopen).resolves.toEqual({
            status: 'reopened',
            bufferId: id,
            ownership: 'temporary',
        });
        let newerSettled = false;
        const newerPromotion = lifecycleB.release({ id, leaseId, disposition: 'project-owned' }).then((result) => {
            newerSettled = true;
            return result;
        });
        await settlePendingWrites(controls, () => newerSettled);
        await expect(newerPromotion).resolves.toEqual({ status: 'released', disposition: 'project-owned' });

        releaseRollbackDatabase!(await openAudioDatabase());
        await settlePendingWrites(controls, () => staleSettled);
        await expect(stalePromotion).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio promotion was superseded.',
        });
        expect(controls.committedMeta.get(id)?.preparedOwner?.status).toBe('project-owned');
    });
});
