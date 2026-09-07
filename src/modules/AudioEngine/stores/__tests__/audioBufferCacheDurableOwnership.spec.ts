import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('audioBufferCache durable ownership', () => {
    let controls: FakeAudioIndexedDbControls;
    let routes: ProductionRoutes;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
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
        // Mutation probe for #3777: dropping `durableOwnedIds.has(key)` from the
        // age collector's guard reds this immediately — the owned entry goes out
        // with the unowned one and `deleted` reads 2 instead of 1.
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

        it('keeps today’s age rule for unowned entries when no provider is registered', async () => {
            seedOrdinaryEntry(controls, 'ancient', THIRTY_ONE_DAYS_AGO);
            seedOrdinaryEntry(controls, 'fresh', NOW);

            const deleted = await routes.garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });

            expect(deleted).toBe(1);
            expect(controls.committed.has('ancient')).toBe(false);
            expect(controls.committed.has('fresh')).toBe(true);
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
    });
});
