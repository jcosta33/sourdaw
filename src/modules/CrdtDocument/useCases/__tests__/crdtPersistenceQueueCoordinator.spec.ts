import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    flushAutomergeStorageWrites: vi.fn(),
}));
vi.mock('#/utils/HMR/createHmrPersistentState', () => ({
    createHmrPersistentState: vi.fn((_key: string, factory: () => unknown) => factory()),
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
        mockSaveAllToIdb: vi.fn(() => Promise.resolve()),
        mockSaveIncrementals: vi.fn(() => Promise.resolve({ savedChunks: 0 })),
        mockLoadSnapshot: vi.fn(() => Promise.resolve(null)),
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

import { crdtPersistenceQueueCoordinator } from '../crdtPersistenceQueueCoordinator';
import { sessionUndoWitnessStampPort } from '../sessionUndoWitnessStampPort';

describe('crdtPersistenceQueueCoordinator', () => {
    it('exposes runOperation and runLoad methods', () => {
        expect(typeof crdtPersistenceQueueCoordinator.runOperation).toBe('function');
        expect(typeof crdtPersistenceQueueCoordinator.runLoad).toBe('function');
    });

    it('runOperation with reset resolves immediately', async () => {
        await expect(crdtPersistenceQueueCoordinator.runOperation('reset')).resolves.toBeUndefined();
    });

    it('holds autosave behind a cross-store persistence barrier until publication commits', async () => {
        const order: string[] = [];
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

describe('crdtPersistenceQueueCoordinator / exact-heads collaboration persist does not force a pending write to land (#3331-repair-3, G1)', () => {
    beforeEach(async () => {
        await crdtPersistenceQueueCoordinator.runOperation('reset');
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
});
