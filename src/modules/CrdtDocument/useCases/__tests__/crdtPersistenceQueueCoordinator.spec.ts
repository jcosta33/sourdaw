import { describe, expect, it, vi } from 'vitest';

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
            getHeads: vi.fn(() => []),
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

import { crdtPersistenceQueueCoordinator } from '../crdtPersistenceQueueCoordinator';

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
