import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    flushAutomergeStorageWrites: vi.fn(),
}));

const { hmrPersistentState } = vi.hoisted(() => ({ hmrPersistentState: new Map<string, unknown>() }));

vi.mock('#/utils/HMR/createHmrPersistentState', () => ({
    // Mirrors the real helper: one state object per key, handed back on every
    // later evaluation of the module that owns it. A factory call per
    // invocation would make the coordinator's own version migration — the
    // branch that decides what a reload carries over — unreachable.
    createHmrPersistentState: vi.fn((key: string, factory: () => unknown) => {
        if (!hmrPersistentState.has(key)) {
            hmrPersistentState.set(key, factory());
        }
        return hmrPersistentState.get(key);
    }),
}));

const { mockAutomergeRepo, mockSaveAllToIdb, mockSaveIncrementals, mockLoadSnapshot, mockCompactionState } = vi.hoisted(
    () => ({
        mockAutomergeRepo: {
            getAllDocs: vi.fn(() => new Map()),
            getDoc: vi.fn(() => null),
            getDocIds: vi.fn<() => string[]>(() => []),
            hasDoc: vi.fn(() => false),
            mergeBundle: vi.fn(),
            saveAll: vi.fn(),
            saveAllOffThread: vi.fn(),
            saveDocIncremental: vi.fn(),
            getHeads: vi.fn<(id: string) => string[]>(() => []),
            reserveSnapshotTransactionDocuments: vi.fn(),
            transactSnapshot: vi.fn(async (operation: (transaction: object) => Promise<void>) => {
                await operation({});
                return { before: new Map(), after: new Map() };
            }),
        },
        mockSaveAllToIdb: vi.fn<() => Promise<SaveAllToIdbResult>>(() =>
            Promise.resolve({
                status: 'committed',
                authority: { epoch: 'default-epoch', revision: 0, rootLineage: 'main' },
            })
        ),
        mockSaveIncrementals: vi.fn<() => Promise<SaveIncrementalsToIdbResult>>(() =>
            Promise.resolve({
                status: 'committed',
                authority: { epoch: 'default-epoch', revision: 0, rootLineage: 'main' },
            })
        ),
        mockLoadSnapshot: vi.fn<() => Promise<CrdtPersistenceSnapshot | null>>(() => Promise.resolve(null)),
        mockCompactionState: { incrementalSaveCount: 0 },
    })
);

vi.mock('../../repositories/automergeRepository', () => ({ automergeRepository: mockAutomergeRepo }));
vi.mock('../../repositories/crdtPersistence/saveAllToIdb', () => ({ saveAllToIdb: mockSaveAllToIdb }));
vi.mock('../../repositories/crdtPersistence/saveIncrementalsToIdb', () => ({
    saveIncrementalsToIdb: mockSaveIncrementals,
}));
vi.mock('../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb', () => ({
    loadPersistenceSnapshotFromIdb: mockLoadSnapshot,
}));
vi.mock('../crdtProjectCompactionState', () => ({
    CRDT_PROJECT_COMPACTION_THRESHOLD: 50,
    crdtProjectCompactionState: mockCompactionState,
}));

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { DEFAULT_CRDT_ROOT_LINEAGE } from '../../models/CrdtRootLineage';
import { advancePersistenceAuthority } from '../../repositories/crdtPersistence/advancePersistenceAuthority';
import { crdtPersistenceQueueCoordinator } from '../crdtPersistenceQueueCoordinator';
import { sessionUndoWitnessStampPort } from '../sessionUndoWitnessStampPort';

import type { CrdtPersistenceSnapshot } from '../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb';
import type { SaveAllToIdbResult } from '../../repositories/crdtPersistence/saveAllToIdb';
import type { SaveIncrementalsToIdbResult } from '../../repositories/crdtPersistence/saveIncrementalsToIdb';

describe('crdtPersistenceQueueCoordinator', () => {
    it('exposes runOperation and runLoad methods', () => {
        expect(typeof crdtPersistenceQueueCoordinator.runOperation).toBe('function');
        expect(typeof crdtPersistenceQueueCoordinator.runLoad).toBe('function');
    });

    // K5 — a replacement is the one event that means the project a caller was
    // working on is gone, and the count it advances is how that caller learns.
    it('advances the replacement count when a replacement begins', () => {
        const before = crdtPersistenceQueueCoordinator.currentReplacement();

        crdtPersistenceQueueCoordinator.beginReplacement({ epoch: 'epoch-generation', old: null });

        expect(crdtPersistenceQueueCoordinator.currentReplacement()).toBe(before + 1);
    });

    it('holds autosave behind a cross-store persistence barrier until publication commits', async () => {
        const order: string[] = [];
        // An ordinary autosave is the one being ordered here, so the queue has
        // to be in the state one runs from rather than mid-replacement.
        await loadRootOnlyProject();
        mockAutomergeRepo.getDocIds.mockReturnValue(['root']);
        let releaseBarrier: (() => void) | undefined;
        const blocked = new Promise<void>((resolve) => {
            releaseBarrier = resolve;
        });
        const barrier = crdtPersistenceQueueCoordinator.runBarrier(async () => {
            order.push('prepare-publication');
            await blocked;
            order.push('commit-publication');
        });
        const autosave = crdtPersistenceQueueCoordinator.runOperation('incremental').then(() => {
            order.push('autosave');
        });

        await Promise.resolve();
        expect(order).toEqual(['prepare-publication']);
        releaseBarrier?.();
        await Promise.all([barrier, autosave]);

        expect(order).toEqual(['prepare-publication', 'commit-publication', 'autosave']);
    });

    it('runOperation with root-lineage-transition throws on invalid lineage', () => {
        expect(() =>
            crdtPersistenceQueueCoordinator.runOperation({
                type: 'root-lineage-transition',
                from: '',
                to: 'valid-branch',
            })
        ).toThrow('Invalid root lineage transition');
    });

    it('runOperation with root-lineage-transition throws on invalid target lineage', () => {
        expect(() =>
            crdtPersistenceQueueCoordinator.runOperation({
                type: 'root-lineage-transition',
                from: 'valid-branch',
                to: '',
            })
        ).toThrow('Invalid root lineage transition');
    });

    it('runLoad returns false when the operation returns loaded=false', async () => {
        const result = await crdtPersistenceQueueCoordinator.runLoad(async () => ({
            loaded: false,
            snapshot: null,
        }));
        expect(result).toBe(false);
    });

    it('runLoad returns true when the operation returns loaded=true with a snapshot', async () => {
        const result = await crdtPersistenceQueueCoordinator.runLoad(async () => ({
            loaded: true,
            snapshot: {
                authority: {
                    epoch: 'test-epoch',
                    revision: 0,
                    rootLineage: 'main',
                },
                bundle: new Map([['root', new Uint8Array([1])]]),
            },
        }));
        expect(result).toBe(true);
    });
});

/**
 * The queue state an ordinary editing session sits in: a project loaded, its
 * durable authority adopted, and the root already a base record incrementals
 * can extend. Every incremental save runs from here — a queue with a
 * replacement still pending writes a full bundle instead.
 */
async function loadRootOnlyProject(): Promise<void> {
    await crdtPersistenceQueueCoordinator.runLoad(async () => ({
        loaded: true,
        snapshot: {
            authority: { epoch: 'epoch-loaded', revision: 1, rootLineage: DEFAULT_CRDT_ROOT_LINEAGE },
            bundle: new Map([['root', new Uint8Array([1])]]),
        },
    }));
}

describe('crdtPersistenceQueueCoordinator / exact-heads collaboration persist does not force a pending write to land (#3331)', () => {
    beforeEach(async () => {
        await loadRootOnlyProject();
        mockAutomergeRepo.getDocIds.mockReturnValue(['root']);
        mockAutomergeRepo.saveDocIncremental.mockClear();
        mockAutomergeRepo.saveDocIncremental.mockReturnValue(undefined);
        mockAutomergeRepo.getHeads.mockClear();
        mockAutomergeRepo.getHeads.mockReturnValue(['head-1']);
        vi.mocked(flushAutomergeStorageWrites).mockClear();
        vi.mocked(flushAutomergeStorageWrites).mockImplementation(() => undefined);
    });

    it('neither throws nor moves the root heads when a pending unscoped write would otherwise land inside the assertion window', async () => {
        // Simulates the hazard directly: if the coordinator forced this
        // generation's deferred writes to land here, this flush would move the
        // root heads the second assertExpectedRootHeads below re-checks.
        vi.mocked(flushAutomergeStorageWrites).mockImplementation(() => {
            mockAutomergeRepo.getHeads.mockReturnValue(['head-2']);
        });

        await expect(crdtPersistenceQueueCoordinator.runOperation('incremental', ['head-1'])).resolves.toBeUndefined();

        expect(flushAutomergeStorageWrites).not.toHaveBeenCalled();
        expect(mockAutomergeRepo.getHeads('root')).toEqual(['head-1']);
    });

    it('still stamps the undo witness when settling pending writes is skipped', async () => {
        const stampSpy = vi.spyOn(sessionUndoWitnessStampPort, 'stamp');

        await crdtPersistenceQueueCoordinator.runOperation('incremental', ['head-1']);

        expect(stampSpy).toHaveBeenCalled();
        stampSpy.mockRestore();
    });

    it("forces this generation's deferred writes to land before reading document bytes when no exact heads are expected", async () => {
        await crdtPersistenceQueueCoordinator.runOperation('incremental');

        expect(flushAutomergeStorageWrites).toHaveBeenCalled();
        const flushOrder = vi.mocked(flushAutomergeStorageWrites).mock.invocationCallOrder[0];
        const saveOrder = mockAutomergeRepo.saveDocIncremental.mock.invocationCallOrder[0];
        expect(flushOrder).toBeDefined();
        expect(saveOrder).toBeDefined();
        expect(flushOrder as number).toBeLessThan(saveOrder as number);
    });

    it("stamps the undo witness with the heads this generation's forced flush just landed", async () => {
        mockAutomergeRepo.getHeads.mockReturnValue(['pre-flush-head']);
        vi.mocked(flushAutomergeStorageWrites).mockImplementation(() => {
            mockAutomergeRepo.getHeads.mockReturnValue(['post-flush-head']);
        });
        let observedHeads: string[] | undefined;
        const stampSpy = vi.spyOn(sessionUndoWitnessStampPort, 'stamp').mockImplementation(() => {
            observedHeads = mockAutomergeRepo.getHeads('root');
        });

        await crdtPersistenceQueueCoordinator.runOperation('incremental');

        expect(observedHeads).toEqual(['post-flush-head']);
        stampSpy.mockRestore();
    });
});

describe('crdtPersistenceQueueCoordinator / compaction paths stamp the undo witness before the bundle read (#3331)', () => {
    beforeEach(async () => {
        await loadRootOnlyProject();
        mockAutomergeRepo.getDocIds.mockReturnValue(['root']);
        mockAutomergeRepo.saveDocIncremental.mockClear();
        mockAutomergeRepo.saveDocIncremental.mockReturnValue(undefined);
        mockAutomergeRepo.saveAllOffThread.mockClear();
        mockAutomergeRepo.saveAllOffThread.mockResolvedValue(new Map());
        mockSaveAllToIdb.mockClear();
        mockSaveAllToIdb.mockResolvedValue({
            status: 'committed',
            authority: { epoch: 'test-epoch', revision: 1, rootLineage: 'main' },
        });
        vi.mocked(flushAutomergeStorageWrites).mockClear();
        vi.mocked(flushAutomergeStorageWrites).mockImplementation(() => undefined);
    });

    it('stamps before the bundle read when a doc-shape change routes an incremental persist into compaction', async () => {
        // The load left 'root' as the only base record; a second active
        // document changes the persisted shape and routes into compactCrdtProject.
        mockAutomergeRepo.getDocIds.mockReturnValue(['arrangement', 'root']);
        const stampSpy = vi.spyOn(sessionUndoWitnessStampPort, 'stamp');

        await crdtPersistenceQueueCoordinator.runOperation('incremental');

        expect(stampSpy).toHaveBeenCalled();
        const stampOrder = stampSpy.mock.invocationCallOrder[0];
        const saveOrder = mockAutomergeRepo.saveAllOffThread.mock.invocationCallOrder[0];
        expect(stampOrder).toBeDefined();
        expect(saveOrder).toBeDefined();
        expect(stampOrder as number).toBeLessThan(saveOrder as number);
        stampSpy.mockRestore();
    });

    it('stamps before the bundle read on a direct compact operation', async () => {
        const stampSpy = vi.spyOn(sessionUndoWitnessStampPort, 'stamp');

        await crdtPersistenceQueueCoordinator.runOperation('compact');

        expect(stampSpy).toHaveBeenCalled();
        const stampOrder = stampSpy.mock.invocationCallOrder[0];
        const saveOrder = mockAutomergeRepo.saveAllOffThread.mock.invocationCallOrder[0];
        expect(stampOrder).toBeDefined();
        expect(saveOrder).toBeDefined();
        expect(stampOrder as number).toBeLessThan(saveOrder as number);
        stampSpy.mockRestore();
    });

    it('stamps the undo witness with the heads a chunk flush this compaction awaited just landed on a direct compact operation', async () => {
        // Leaves a chunk pending from a failed prior incremental attempt, so
        // `compactCrdtProject`'s own `await flushPendingChunks(generation)`
        // has real work to do rather than the no-op an empty queue gives it.
        mockAutomergeRepo.saveDocIncremental.mockReturnValueOnce(new Uint8Array([1, 2, 3]));
        mockSaveIncrementals.mockClear();
        mockSaveIncrementals.mockImplementationOnce(() =>
            Promise.reject(new Error('simulated transient chunk failure'))
        );
        mockAutomergeRepo.getHeads.mockReturnValue(['pre-flush-head']);

        await expect(crdtPersistenceQueueCoordinator.runOperation('incremental')).rejects.toThrow(
            'simulated transient chunk failure'
        );

        // The retried chunk flush lands the write; only a stamp placed after
        // that awaited flush should observe its heads.
        mockSaveIncrementals.mockImplementationOnce(() => {
            mockAutomergeRepo.getHeads.mockReturnValue(['post-chunk-flush-head']);
            return Promise.resolve({
                status: 'committed',
                authority: { epoch: 'test-epoch', revision: 2, rootLineage: 'main' },
            });
        });
        let observedHeads: string[] | undefined;
        const stampSpy = vi.spyOn(sessionUndoWitnessStampPort, 'stamp').mockImplementation(() => {
            observedHeads = mockAutomergeRepo.getHeads('root');
        });

        await crdtPersistenceQueueCoordinator.runOperation('compact');

        expect(observedHeads).toEqual(['post-chunk-flush-head']);
        stampSpy.mockRestore();
    });

    it('stamps the undo witness with the heads a full-snapshot retry this compaction awaited just landed on a direct compact operation', async () => {
        // Leaves a failed full snapshot pending from a prior compact attempt, so
        // `compactCrdtProject`'s own `await flushPendingFullSnapshot(generation)`
        // has a real retry to await rather than the no-op an empty queue gives it.
        const pendingBundle = new Map([['root', new Uint8Array([9])]]);
        mockAutomergeRepo.saveAllOffThread.mockResolvedValue(pendingBundle);
        mockSaveAllToIdb.mockClear();
        mockSaveAllToIdb.mockImplementationOnce(() =>
            Promise.reject(new Error('simulated transient full-save failure'))
        );

        await expect(crdtPersistenceQueueCoordinator.runOperation('compact')).rejects.toThrow(
            'simulated transient full-save failure'
        );

        // The retried full snapshot save lands the write; only a stamp placed
        // after that awaited flush should observe its heads.
        mockAutomergeRepo.getHeads.mockReturnValue(['pre-retry-head']);
        mockSaveAllToIdb.mockImplementationOnce(() => {
            mockAutomergeRepo.getHeads.mockReturnValue(['post-full-snapshot-retry-head']);
            return Promise.resolve({
                status: 'committed',
                authority: { epoch: 'test-epoch', revision: 2, rootLineage: 'main' },
            });
        });
        let observedHeads: string[] | undefined;
        const stampSpy = vi.spyOn(sessionUndoWitnessStampPort, 'stamp').mockImplementation(() => {
            observedHeads = mockAutomergeRepo.getHeads('root');
        });

        await crdtPersistenceQueueCoordinator.runOperation('compact');

        expect(observedHeads).toEqual(['post-full-snapshot-retry-head']);
        stampSpy.mockRestore();
    });
});

describe('crdtPersistenceQueueCoordinator / a failed pending-write settle still stamps and persists (#3331)', () => {
    beforeEach(async () => {
        await loadRootOnlyProject();
        mockAutomergeRepo.getDocIds.mockReturnValue(['root']);
        mockAutomergeRepo.saveDocIncremental.mockClear();
        mockAutomergeRepo.saveDocIncremental.mockReturnValue(new Uint8Array([1, 2, 3]));
        mockSaveIncrementals.mockClear();
        mockSaveIncrementals.mockResolvedValue({
            status: 'committed',
            authority: { epoch: 'test-epoch', revision: 1, rootLineage: 'main' },
        });
        vi.mocked(flushAutomergeStorageWrites).mockClear();
        vi.mocked(flushAutomergeStorageWrites).mockImplementation(() => {
            throw new Error('simulated matched-write-group rollback');
        });
    });

    it('still stamps the undo witness and still writes chunks when settling pending writes throws', async () => {
        const stampSpy = vi.spyOn(sessionUndoWitnessStampPort, 'stamp');

        await expect(crdtPersistenceQueueCoordinator.runOperation('incremental')).resolves.toBeUndefined();

        expect(stampSpy).toHaveBeenCalled();
        expect(mockSaveIncrementals).toHaveBeenCalled();
        stampSpy.mockRestore();
    });
});

describe('crdtPersistenceQueueCoordinator / a project replacement claims the authority its caller read (#4249)', () => {
    const outgoingAuthority = { epoch: 'epoch-outgoing', revision: 4, rootLineage: DEFAULT_CRDT_ROOT_LINEAGE };
    const replacementEpoch = 'epoch-replacement';
    const replacementAuthority = advancePersistenceAuthority(
        outgoingAuthority,
        replacementEpoch,
        DEFAULT_CRDT_ROOT_LINEAGE
    );

    beforeEach(() => {
        mockAutomergeRepo.getDocIds.mockReturnValue(['root']);
        mockAutomergeRepo.mergeBundle.mockClear();
        mockAutomergeRepo.mergeBundle.mockResolvedValue(undefined);
        mockAutomergeRepo.saveAll.mockReturnValue(new Map([['root', new Uint8Array([1])]]));
        mockAutomergeRepo.saveAllOffThread.mockClear();
        mockAutomergeRepo.saveAllOffThread.mockResolvedValue(new Map([['root', new Uint8Array([1])]]));
        // `mockReset`, not `mockClear`: a case that refuses before consuming its
        // queued follow-up save would otherwise hand that result to the next one.
        mockSaveAllToIdb.mockReset();
        mockSaveAllToIdb.mockResolvedValue({ status: 'committed', authority: replacementAuthority });
        mockLoadSnapshot.mockClear();
        mockLoadSnapshot.mockResolvedValue(null);
        vi.mocked(flushAutomergeStorageWrites).mockClear();
        vi.mocked(flushAutomergeStorageWrites).mockImplementation(() => undefined);
    });

    // K1 — the reset has to learn what another realm may have written, which
    // the cached authority cannot tell it.
    it('reads the durable authority from storage rather than the authority the queue already holds', async () => {
        const durableAuthority = { epoch: 'epoch-durable', revision: 9, rootLineage: DEFAULT_CRDT_ROOT_LINEAGE };
        mockLoadSnapshot.mockResolvedValue({ authority: durableAuthority, bundle: null });
        crdtPersistenceQueueCoordinator.beginReplacement({ epoch: replacementEpoch, old: outgoingAuthority });

        await expect(crdtPersistenceQueueCoordinator.readDurableAuthority()).resolves.toEqual(durableAuthority);

        // Reading storage must not adopt what it read: the replacement's
        // compare-and-swap still claims the authority its caller handed in.
        await crdtPersistenceQueueCoordinator.runOperation('compact');
        expect(mockSaveAllToIdb).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ expectedAuthority: outgoingAuthority })
        );
    });

    // K2
    it('swaps the replacement in against the authority the caller read, under the new epoch', async () => {
        crdtPersistenceQueueCoordinator.beginReplacement({ epoch: replacementEpoch, old: outgoingAuthority });

        await crdtPersistenceQueueCoordinator.runOperation('compact');

        expect(mockSaveAllToIdb).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                expectedAuthority: outgoingAuthority,
                nextEpoch: replacementEpoch,
                nextRootLineage: DEFAULT_CRDT_ROOT_LINEAGE,
            })
        );
        expect(crdtPersistenceQueueCoordinator.committedAuthority()).toEqual(replacementAuthority);
    });

    // K3 — merging here would fold the project the user just left into the one
    // they just created, so a lost swap has to surface as a failure instead.
    it('refuses to merge the project being replaced into the replacement when the swap is lost', async () => {
        crdtPersistenceQueueCoordinator.beginReplacement({ epoch: replacementEpoch, old: outgoingAuthority });
        const conflictAuthority = advancePersistenceAuthority(outgoingAuthority);
        // Only the first save conflicts: a merge would let the retry commit, so
        // a coordinator that merged here fails this case rather than looping on
        // an endlessly conflicting save.
        mockSaveAllToIdb.mockResolvedValueOnce({
            status: 'conflict',
            authority: conflictAuthority,
            bundle: new Map([['root', new Uint8Array([2])]]),
        });
        mockSaveAllToIdb.mockResolvedValueOnce({
            status: 'committed',
            authority: advancePersistenceAuthority(conflictAuthority),
        });

        await expect(crdtPersistenceQueueCoordinator.runOperation('compact')).rejects.toMatchObject({
            _tag: 'CrdtPersistenceReplacementConflict',
            expected: outgoingAuthority,
        });

        expect(mockAutomergeRepo.mergeBundle).not.toHaveBeenCalled();
        expect(crdtPersistenceQueueCoordinator.committedAuthority()).toBeNull();
    });

    // K6 — `beginPersistenceReplacement` seeds the root as already persisted,
    // so a root-only replacement passes the shape check the incremental path
    // uses. A chunk written there commits under the OUTGOING epoch, adopts that
    // authority and clears the replacement epoch, leaving the reset unable to
    // recognise the target it recorded.
    it('writes the replacement as a full snapshot rather than an incremental while its epoch is pending', async () => {
        mockSaveIncrementals.mockClear();
        mockAutomergeRepo.saveDocIncremental.mockClear();
        // A real chunk, so the incremental route would have something to commit.
        mockAutomergeRepo.saveDocIncremental.mockReturnValue(new Uint8Array([7, 8, 9]));
        crdtPersistenceQueueCoordinator.beginReplacement({ epoch: replacementEpoch, old: outgoingAuthority });

        await crdtPersistenceQueueCoordinator.runOperation('incremental');

        expect(mockSaveIncrementals).not.toHaveBeenCalled();
        expect(mockSaveAllToIdb).toHaveBeenCalledTimes(1);
        expect(mockSaveAllToIdb).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ expectedAuthority: outgoingAuthority, nextEpoch: replacementEpoch })
        );
        expect(crdtPersistenceQueueCoordinator.committedAuthority()).toEqual(replacementAuthority);
    });

    // K4 — the refusal belongs to replacements alone; two realms editing one
    // project both belong in the result.
    it('still merges an ordinary same-epoch conflict when no replacement is in flight', async () => {
        await crdtPersistenceQueueCoordinator.runLoad(async () => ({
            loaded: true,
            snapshot: { authority: outgoingAuthority, bundle: new Map([['root', new Uint8Array([1])]]) },
        }));
        const conflictAuthority = advancePersistenceAuthority(outgoingAuthority);
        mockSaveAllToIdb.mockResolvedValueOnce({
            status: 'conflict',
            authority: conflictAuthority,
            bundle: new Map([['root', new Uint8Array([2])]]),
        });
        mockSaveAllToIdb.mockResolvedValueOnce({
            status: 'committed',
            authority: advancePersistenceAuthority(conflictAuthority),
        });

        await crdtPersistenceQueueCoordinator.runOperation('compact');

        expect(mockAutomergeRepo.mergeBundle).toHaveBeenCalledTimes(1);
    });
});

describe('crdtPersistenceQueueCoordinator / an HMR state migration replaces no project (#4249)', () => {
    /** The key the coordinator stores its queue state under. */
    const QUEUE_STATE_KEY = 'crdtDocument.persistenceQueue';

    // K7 — a reload moves the queue on without replacing the project, so a
    // branch transition spanning the migration still has to see its own
    // project. Only the count can tell those apart, so only the count carries.
    it('carries the replacement count across the migration and advances only the generation', async () => {
        mockAutomergeRepo.getDocIds.mockReturnValue(['root']);
        mockAutomergeRepo.saveAllOffThread.mockResolvedValue(new Map([['root', new Uint8Array([1])]]));
        mockSaveAllToIdb.mockReset();
        mockSaveAllToIdb.mockResolvedValue({
            status: 'committed',
            authority: { epoch: 'epoch-migrated', revision: 1, rootLineage: DEFAULT_CRDT_ROOT_LINEAGE },
        });
        mockLoadSnapshot.mockClear();
        mockLoadSnapshot.mockResolvedValue(null);
        // What a state written before this version holds: the two counters and
        // the tail the migration recovery has to queue behind. Every other
        // field is one the migration writes rather than reads.
        const stale = { version: 6, persistenceGeneration: 11, replacementCount: 4, operationTail: Promise.resolve() };
        hmrPersistentState.set(QUEUE_STATE_KEY, stale);

        vi.resetModules();
        const { crdtPersistenceQueueCoordinator: migrated } = await import('../crdtPersistenceQueueCoordinator');
        // The migration installed its recovery as the new tail; awaiting it
        // keeps the compaction it schedules out of the next spec file.
        await stale.operationTail;

        expect(migrated.currentReplacement()).toBe(4);
        expect(stale.persistenceGeneration).toBe(12);
    });
});
