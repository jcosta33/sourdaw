import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    createCrdtProject,
    loadCrdtProject,
    persistCrdtProject,
    compactProject,
    hasCrdtProject,
    getPersistenceBackend,
} from '../crdtProjectLifecycle';

const mocks = vi.hoisted(() => ({
    createProject: vi.fn(),
    loadAll: vi.fn(),
    saveAll: vi.fn(() => new Map()),
    saveDocIncremental: vi.fn(),
    getDoc: vi.fn(),
    replaceDoc: vi.fn(),
    loadAllFromIdb: vi.fn(),
    saveAllToIdb: vi.fn(),
    saveIncrementalToIdb: vi.fn(),
    clearIncrementalsFromIdb: vi.fn(),
    hasCrdtDocsInIdb: vi.fn(),
    isNativeCrdtAvailable: vi.fn(),
    branchStoreValue: { branches: [{ branchId: 'main', rootDocId: 'root' }], activeBranchId: 'main' } as {
        branches: { branchId: string; rootDocId: string }[];
        activeBranchId: string;
    } | null,
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        createProject: mocks.createProject,
        loadAll: mocks.loadAll,
        saveAll: mocks.saveAll,
        saveDocIncremental: mocks.saveDocIncremental,
        getDoc: mocks.getDoc,
        replaceDoc: mocks.replaceDoc,
    },
}));

vi.mock('../../stores/branchStore', () => ({
    get branchStore() {
        return { value: mocks.branchStoreValue };
    },
}));

vi.mock('../../repositories/crdtPersistence/loadAllFromIdb', () => ({ loadAllFromIdb: mocks.loadAllFromIdb }));
vi.mock('../../repositories/crdtPersistence/saveAllToIdb', () => ({ saveAllToIdb: mocks.saveAllToIdb }));
vi.mock('../../repositories/crdtPersistence/saveIncrementalToIdb', () => ({
    saveIncrementalToIdb: mocks.saveIncrementalToIdb,
}));
vi.mock('../../repositories/crdtPersistence/clearIncrementalsFromIdb', () => ({
    clearIncrementalsFromIdb: mocks.clearIncrementalsFromIdb,
}));
vi.mock('../../repositories/crdtPersistence/hasCrdtDocsInIdb', () => ({ hasCrdtDocsInIdb: mocks.hasCrdtDocsInIdb }));
vi.mock('../../repositories/nativeCrdtPersistence/isNativeCrdtAvailable', () => ({
    isNativeCrdtAvailable: mocks.isNativeCrdtAvailable,
}));

describe('crdtProjectLifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.branchStoreValue = {
            branches: [{ branchId: 'main', rootDocId: 'root' }],
            activeBranchId: 'main',
        };
        mocks.isNativeCrdtAvailable.mockReturnValue(false);
    });

    it('createCrdtProject initializes repo and compacts', async () => {
        await createCrdtProject('New Project');
        expect(mocks.createProject).toHaveBeenCalledWith('New Project');
        expect(mocks.saveAllToIdb).toHaveBeenCalled();
    });

    it('loadCrdtProject loads from IDB and updates repo', async () => {
        const mockBundle = new Map();
        mocks.loadAllFromIdb.mockResolvedValue(mockBundle);

        const result = await loadCrdtProject();

        expect(result).toBe(true);
        expect(mocks.loadAll).toHaveBeenCalledWith(mockBundle);
    });

    it('loadCrdtProject restores the last-active branch into the root slot', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.branchStoreValue = {
            branches: [
                { branchId: 'main', rootDocId: 'root' },
                { branchId: 'feat', rootDocId: 'branch_feat' },
            ],
            activeBranchId: 'feat',
        };
        const branchDoc = { tag: 'feat-doc' };
        mocks.getDoc.mockImplementation((id: string) => (id === 'branch_feat' ? branchDoc : undefined));

        await loadCrdtProject();

        // Regression: reopening must land on the active branch, not whatever doc
        // last occupied the root slot.
        expect(mocks.replaceDoc).toHaveBeenCalledWith('root', branchDoc);
    });

    it('loadCrdtProject leaves the root slot untouched when the active branch is main', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.branchStoreValue = {
            branches: [{ branchId: 'main', rootDocId: 'root' }],
            activeBranchId: 'main',
        };

        await loadCrdtProject();

        expect(mocks.replaceDoc).not.toHaveBeenCalled();
    });

    it('loadCrdtProject stays on the root slot when the active branch doc is absent', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.branchStoreValue = {
            branches: [
                { branchId: 'main', rootDocId: 'root' },
                { branchId: 'feat', rootDocId: 'branch_feat' },
            ],
            activeBranchId: 'feat',
        };
        mocks.getDoc.mockReturnValue(undefined);

        const result = await loadCrdtProject();

        expect(result).toBe(true);
        expect(mocks.replaceDoc).not.toHaveBeenCalled();
    });

    it('persistCrdtProject saves incremental chunk to IDB', async () => {
        mocks.saveDocIncremental.mockReturnValue(new Uint8Array([1, 2, 3]));

        await persistCrdtProject();

        expect(mocks.saveIncrementalToIdb).toHaveBeenCalledWith('root', expect.any(Uint8Array));
    });

    it('compactProject writes full bundle and clears incrementals', async () => {
        const mockBundle = new Map([['doc1', new Uint8Array([4, 5, 6])]]);
        mocks.saveAll.mockReturnValue(mockBundle);

        await compactProject();

        expect(mocks.saveAllToIdb).toHaveBeenCalledWith(mockBundle);
        expect(mocks.clearIncrementalsFromIdb).toHaveBeenCalledWith('root');
    });

    it('should check project existence through IDB persistence', async () => {
        mocks.hasCrdtDocsInIdb.mockResolvedValue(true);

        const result = await hasCrdtProject();

        expect(result).toBe(true);
        expect(mocks.hasCrdtDocsInIdb).toHaveBeenCalledOnce();
    });

    it('should report browser persistence when native is available but the lifecycle still uses IDB', () => {
        mocks.isNativeCrdtAvailable.mockReturnValue(true);

        expect(getPersistenceBackend()).toBe('browser');
    });
});
