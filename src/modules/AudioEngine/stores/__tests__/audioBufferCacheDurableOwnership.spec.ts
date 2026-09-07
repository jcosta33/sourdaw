import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import {
    BUFFER_STORE,
    META_STORE,
    flushIndexedDbTasks,
    installFakeAudioIndexedDb,
    type FakeAudioIndexedDbControls,
    type StoredAudioBuffer,
} from './fakeAudioBufferIndexedDb';

const mocks = vi.hoisted(() => ({
    loggerWarn: vi.fn<(...args: unknown[]) => void>(),
    loggerError: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn, error: mocks.loggerError, info: vi.fn(), debug: vi.fn() },
}));

/** Thirty days plus one, in milliseconds — the stale side of the production
 * age sweep's threshold. */
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 10_000_000_000_000;
const THIRTY_ONE_DAYS_AGO = NOW - 31 * DAY_MS;

type ProductionRoutes = {
    audioBufferCache: typeof import('../audioBufferCache').audioBufferCache;
    garbageCollectCachedAudioBuffersByAge: typeof import('../../useCases/garbageCollectCachedAudioBuffersByAge').garbageCollectCachedAudioBuffersByAge;
    garbageCollectCachedAudioBuffersBySize: typeof import('../../useCases/garbageCollectCachedAudioBuffersBySize').garbageCollectCachedAudioBuffersBySize;
    setDurableAudioBufferOwnershipProvider: typeof import('../durableAudioBufferOwnership').setDurableAudioBufferOwnershipProvider;
};

async function importProductionRoutes(): Promise<ProductionRoutes> {
    // Loaded fresh per test. The cache holds one IndexedDB connection and the
    // ownership seam one provider for the life of the module, and these tests
    // install a new `indexedDB` double per test — without the reset, every test
    // after the first would keep talking to the first test's double through the
    // memoized connection.
    const [cacheModule, byAgeModule, bySizeModule, seamModule] = await Promise.all([
        import('../audioBufferCache'),
        import('../../useCases/garbageCollectCachedAudioBuffersByAge'),
        import('../../useCases/garbageCollectCachedAudioBuffersBySize'),
        import('../durableAudioBufferOwnership'),
    ]);
    return {
        audioBufferCache: cacheModule.audioBufferCache,
        garbageCollectCachedAudioBuffersByAge: byAgeModule.garbageCollectCachedAudioBuffersByAge,
        garbageCollectCachedAudioBuffersBySize: bySizeModule.garbageCollectCachedAudioBuffersBySize,
        setDurableAudioBufferOwnershipProvider: seamModule.setDurableAudioBufferOwnershipProvider,
    };
}

function ordinaryRecord(lastAccessed: number, sizeInBytes = 100): StoredAudioBuffer {
    return {
        sampleRate: 48_000,
        numberOfChannels: 1,
        channelData: [new Float32Array([0.1])],
        lastAccessed,
        sizeInBytes,
    };
}

function seedOrdinaryEntry(
    controls: FakeAudioIndexedDbControls,
    id: string,
    lastAccessed: number,
    sizeInBytes = 100
): void {
    controls.committed.set(id, ordinaryRecord(lastAccessed, sizeInBytes));
    controls.committedMeta.set(id, { lastAccessed, sizeInBytes });
}

function seedFreezeEntry(controls: FakeAudioIndexedDbControls, id: string, freezeProjectId: number): void {
    controls.committed.set(id, ordinaryRecord(NOW));
    controls.committedMeta.set(id, { lastAccessed: NOW, sizeInBytes: 100, freezeProjectId });
}

function makeResidentAudioBuffer(): AudioBuffer {
    return {
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
        duration: 1 / 48_000,
        getChannelData: () => new Float32Array(1),
        length: 1,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
}

function residentAudioBufferWithSample(sample: number): AudioBuffer {
    const channel = new Float32Array([sample]);
    return {
        ...makeResidentAudioBuffer(),
        getChannelData: () => channel,
    };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let settle!: () => void;
    const promise = new Promise<void>((resolve) => {
        settle = resolve;
    });
    return { promise, resolve: settle };
}

describe('audioBufferCache durable ownership', () => {
    let controls: FakeAudioIndexedDbControls;
    let routes: ProductionRoutes;
    let lockManager: ReturnType<typeof createControlledLockManager>;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        lockManager = createControlledLockManager();
        vi.stubGlobal('navigator', { ...navigator, locks: lockManager.locks });
        vi.spyOn(Date, 'now').mockReturnValue(NOW);
        controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE, META_STORE] });
        routes = await importProductionRoutes();
    });

    afterEach(async () => {
        routes.setDurableAudioBufferOwnershipProvider(null);
        await flushIndexedDbTasks();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe('production age sweep', () => {
        // The two entries are identical except for durable ownership, so only
        // the ownership guard can produce the split this asserts.
        it('keeps an ordinary entry a saved project owns and collects an unowned one in the same run', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve(['owned-a']));
            seedOrdinaryEntry(controls, 'owned-a', THIRTY_ONE_DAYS_AGO);
            seedOrdinaryEntry(controls, 'unowned-b', THIRTY_ONE_DAYS_AGO);

            const deleted = await routes.garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });

            expect(deleted).toBe(1);
            expect(controls.committed.has('owned-a')).toBe(true);
            expect(controls.committedMeta.has('owned-a')).toBe(true);
            expect(controls.committed.has('unowned-b')).toBe(false);
            expect(controls.committedMeta.has('unowned-b')).toBe(false);
        });

        it('collects a durably owned entry under the normal age rule once ownership is released', async () => {
            const ownedIds = ['shared-x'];
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve([...ownedIds]));
            seedOrdinaryEntry(controls, 'shared-x', THIRTY_ONE_DAYS_AGO);

            const firstRun = await routes.garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });
            expect(firstRun).toBe(0);
            expect(controls.committed.has('shared-x')).toBe(true);

            ownedIds.length = 0;
            const secondRun = await routes.garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });

            expect(secondRun).toBe(1);
            expect(controls.committed.has('shared-x')).toBe(false);
        });

        it('skips a durably owned record in the legacy migration sweep while collecting the unowned one', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve(['legacy-owned']));
            controls.committed.set('legacy-owned', ordinaryRecord(THIRTY_ONE_DAYS_AGO));
            controls.committed.set('legacy-orphan', ordinaryRecord(THIRTY_ONE_DAYS_AGO));

            const deleted = await routes.garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });

            expect(deleted).toBe(1);
            expect(controls.committed.has('legacy-owned')).toBe(true);
            expect(controls.committed.has('legacy-orphan')).toBe(false);
        });

        it('deletes nothing and warns when the ownership enumeration fails', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.reject(new Error('enumeration down')));
            seedOrdinaryEntry(controls, 'unowned-b', THIRTY_ONE_DAYS_AGO);

            const deleted = await routes.garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });

            expect(deleted).toBe(0);
            expect(controls.committed.has('unowned-b')).toBe(true);
            expect(controls.committedMeta.has('unowned-b')).toBe(true);
            expect(mocks.loggerWarn).toHaveBeenCalledWith(
                '[audioBufferCache] Durable ownership enumeration failed; collection aborted without deleting',
                expect.objectContaining({ error: expect.anything() })
            );
        });

        it('deletes nothing when no ownership provider is registered', async () => {
            seedOrdinaryEntry(controls, 'ancient', THIRTY_ONE_DAYS_AGO);
            seedOrdinaryEntry(controls, 'fresh', NOW);

            const deleted = await routes.garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });

            expect(deleted).toBe(0);
            expect(controls.committed.has('ancient')).toBe(true);
            expect(controls.committed.has('fresh')).toBe(true);
            expect(mocks.loggerWarn).toHaveBeenCalledWith(
                '[audioBufferCache] Durable ownership provider is unavailable; deletion refused'
            );
        });
    });

    describe('production freeze sweep', () => {
        // cleanupUnusedFreezeFiles runs this sweep first in the unload chain,
        // before the age and size collectors — a freeze render the persisted
        // snapshot still references must survive it when the live track
        // reference is already gone.
        it('keeps a persisted freeze render a saved project owns and collects an unowned one in the same run', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve(['freeze-owned']));
            seedFreezeEntry(controls, 'freeze-owned', 200);
            seedFreezeEntry(controls, 'freeze-orphan', 200);

            await routes.audioBufferCache.garbageCollectFreezeFiles({ activeIds: new Set<string>(), projectId: 200 });

            expect(controls.committed.has('freeze-owned')).toBe(true);
            expect(controls.committedMeta.has('freeze-owned')).toBe(true);
            expect(controls.committed.has('freeze-orphan')).toBe(false);
            expect(controls.committedMeta.has('freeze-orphan')).toBe(false);
        });

        it('keeps a resident freeze render the saved project owns and collects the unowned resident one', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve(['freeze-resident-owned']));
            routes.audioBufferCache.set('freeze-resident-owned', makeResidentAudioBuffer(), { freezeProjectId: 200 });
            routes.audioBufferCache.set('freeze-resident-orphan', makeResidentAudioBuffer(), { freezeProjectId: 200 });
            await flushIndexedDbTasks();

            await routes.audioBufferCache.garbageCollectFreezeFiles({ activeIds: new Set<string>(), projectId: 200 });

            expect(routes.audioBufferCache.has('freeze-resident-owned')).toBe(true);
            expect(routes.audioBufferCache.has('freeze-resident-orphan')).toBe(false);
        });

        it('deletes nothing and warns when the ownership enumeration fails', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.reject(new Error('enumeration down')));
            seedFreezeEntry(controls, 'freeze-orphan', 200);

            await routes.audioBufferCache.garbageCollectFreezeFiles({ activeIds: new Set<string>(), projectId: 200 });

            expect(controls.committed.has('freeze-orphan')).toBe(true);
            expect(controls.committedMeta.has('freeze-orphan')).toBe(true);
            expect(mocks.loggerWarn).toHaveBeenCalledWith(
                '[audioBufferCache] Durable ownership enumeration failed; collection aborted without deleting',
                expect.objectContaining({ error: expect.anything() })
            );
        });
    });

    describe('production size sweep', () => {
        // The owned entry is deliberately the oldest: under the age-ordered
        // sweep it would be the first candidate, so only the durable-ownership
        // guard can explain its survival.
        it('does not spend the budget on an owned entry and collects past it', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve(['owned-oldest']));
            seedOrdinaryEntry(controls, 'owned-oldest', THIRTY_ONE_DAYS_AGO - 9 * DAY_MS);
            seedOrdinaryEntry(controls, 'unowned-middle', THIRTY_ONE_DAYS_AGO);
            seedOrdinaryEntry(controls, 'unowned-newest', NOW);

            const deleted = await routes.garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 200 });

            expect(deleted).toBe(1);
            expect(controls.committed.has('owned-oldest')).toBe(true);
            expect(controls.committed.has('unowned-middle')).toBe(false);
            expect(controls.committed.has('unowned-newest')).toBe(true);
        });

        it('deletes nothing and warns when the ownership enumeration fails', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.reject(new Error('enumeration down')));
            seedOrdinaryEntry(controls, 'unowned-middle', THIRTY_ONE_DAYS_AGO);
            seedOrdinaryEntry(controls, 'unowned-newest', NOW);

            const deleted = await routes.garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 100 });

            expect(deleted).toBe(0);
            expect(controls.committed.has('unowned-middle')).toBe(true);
            expect(controls.committed.has('unowned-newest')).toBe(true);
            expect(mocks.loggerWarn).toHaveBeenCalledWith(
                '[audioBufferCache] Durable ownership enumeration failed; collection aborted without deleting',
                expect.objectContaining({ error: expect.anything() })
            );
        });

        it('deletes nothing when the cross-renderer storage lock is unavailable', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve([]));
            seedOrdinaryEntry(controls, 'unowned-middle', THIRTY_ONE_DAYS_AGO);
            vi.stubGlobal('navigator', { ...navigator, locks: undefined });

            const deleted = await routes.garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 0 });

            expect(deleted).toBe(0);
            expect(controls.committed.has('unowned-middle')).toBe(true);
            expect(mocks.loggerWarn).toHaveBeenCalledWith(
                '[audioBufferCache] Size-based collection failed',
                expect.objectContaining({ error: expect.any(Error) })
            );
        });
    });

    describe('broad destructive operations', () => {
        it('remove preserves named-owned durable rows and deletes an unowned row', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve(['owned']));
            seedOrdinaryEntry(controls, 'owned', NOW);
            seedOrdinaryEntry(controls, 'unowned', NOW);

            routes.audioBufferCache.remove('owned');
            routes.audioBufferCache.remove('unowned');
            await flushIndexedDbTasks();

            expect(controls.committed.has('owned')).toBe(true);
            expect(controls.committedMeta.has('owned')).toBe(true);
            expect(controls.committed.has('unowned')).toBe(false);
            expect(controls.committedMeta.has('unowned')).toBe(false);
        });

        it('a named-owned removal re-tracks pending persistence and remains usable after settlement', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve(['pending-owned']));
            controls.pauseWriteSettlements();
            routes.audioBufferCache.set('pending-owned', residentAudioBufferWithSample(0.6));
            await vi.waitFor(() => expect(controls.pendingWriteSettlementCount()).toBe(1));

            routes.audioBufferCache.remove('pending-owned');
            controls.releaseNextWriteSettlement();
            const removalSettled = lockManager.locks.request(
                'sourdaw:project-audio-storage',
                { mode: 'exclusive' },
                async () => undefined
            );
            await vi.waitFor(() => expect(controls.pendingWriteSettlementCount()).toBe(1));
            controls.releaseNextWriteSettlement();
            await removalSettled;

            const durabilityPending = routes.audioBufferCache.ensureDurable(['pending-owned']);
            await vi.waitFor(() => expect(controls.pendingWriteSettlementCount()).toBe(1));
            controls.releaseNextWriteSettlement();
            const durability = await durabilityPending;
            expect(durability.status).toBe('durable');
            if (durability.status === 'durable') {
                expect(durability.isCurrent()).toBe(true);
                durability.release();
            }
            expect(controls.committed.has('pending-owned')).toBe(true);
        });

        it('clear preserves named-owned durable rows and deletes unowned rows', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve(['owned']));
            seedOrdinaryEntry(controls, 'owned', NOW);
            seedOrdinaryEntry(controls, 'unowned', NOW);

            routes.audioBufferCache.clear();
            await flushIndexedDbTasks();

            expect(controls.committed.has('owned')).toBe(true);
            expect(controls.committedMeta.has('owned')).toBe(true);
            expect(controls.committed.has('unowned')).toBe(false);
            expect(controls.committedMeta.has('unowned')).toBe(false);
        });

        it('remove and clear delete no durable rows when ownership is unknown', async () => {
            seedOrdinaryEntry(controls, 'remove-unknown', NOW);
            seedOrdinaryEntry(controls, 'clear-unknown', NOW);

            routes.audioBufferCache.remove('remove-unknown');
            routes.audioBufferCache.clear();
            await flushIndexedDbTasks();

            expect(controls.committed.has('remove-unknown')).toBe(true);
            expect(controls.committed.has('clear-unknown')).toBe(true);
        });

        it('a delayed old remove cannot delete or tombstone a newer replacement', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve([]));
            routes.audioBufferCache.set('replacement-race', residentAudioBufferWithSample(0.1));
            await flushIndexedDbTasks();
            const held = deferred();
            const holder = lockManager.locks.request(
                'sourdaw:project-audio-storage',
                { mode: 'exclusive' },
                async () => held.promise
            );

            routes.audioBufferCache.remove('replacement-race');
            routes.audioBufferCache.set('replacement-race', residentAudioBufferWithSample(0.9));
            await flushIndexedDbTasks();
            held.resolve();
            await holder;
            await lockManager.locks.request(
                'sourdaw:project-audio-storage',
                { mode: 'exclusive' },
                async () => undefined
            );

            expect(Array.from(controls.committed.get('replacement-race')?.channelData[0] ?? [])).toEqual([
                Math.fround(0.9),
            ]);
            const durability = await routes.audioBufferCache.ensureDurable(['replacement-race']);
            expect(durability.status).toBe('durable');
            if (durability.status === 'durable') {
                durability.release();
            }
        });

        it('a delayed clear does not delete a newer replacement', async () => {
            routes.setDurableAudioBufferOwnershipProvider(() => Promise.resolve([]));
            seedOrdinaryEntry(controls, 'replacement-after-clear', NOW);
            const held = deferred();
            const holder = lockManager.locks.request(
                'sourdaw:project-audio-storage',
                { mode: 'exclusive' },
                async () => held.promise
            );

            routes.audioBufferCache.clear();
            routes.audioBufferCache.set('replacement-after-clear', residentAudioBufferWithSample(0.9));
            await flushIndexedDbTasks();
            held.resolve();
            await holder;
            await lockManager.locks.request(
                'sourdaw:project-audio-storage',
                { mode: 'exclusive' },
                async () => undefined
            );

            expect(Array.from(controls.committed.get('replacement-after-clear')?.channelData[0] ?? [])).toEqual([
                Math.fround(0.9),
            ]);
        });
    });
});
