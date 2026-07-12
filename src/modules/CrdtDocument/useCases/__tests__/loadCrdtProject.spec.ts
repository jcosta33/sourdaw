import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadCrdtProject } from '../loadCrdtProject';

const mocks = vi.hoisted(() => ({
    loadAll: vi.fn(),
    getDoc: vi.fn(),
    replaceDoc: vi.fn(),
    loadAllFromIdb: vi.fn(),
    branchStoreValue: { branches: [{ branchId: 'main', rootDocId: 'root' }], activeBranchId: 'main' } as {
        branches: { branchId: string; rootDocId: string }[];
        activeBranchId: string;
    } | null,
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        loadAll: mocks.loadAll,
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

describe('loadCrdtProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loadAll.mockResolvedValue(true);
        mocks.branchStoreValue = {
            branches: [{ branchId: 'main', rootDocId: 'root' }],
            activeBranchId: 'main',
        };
    });

    it('should load from IDB and update the repository', async () => {
        const mockBundle = new Map();
        mocks.loadAllFromIdb.mockResolvedValue(mockBundle);

        const can_activate = () => true;
        const result = await loadCrdtProject({ canActivate: can_activate });

        expect(result).toBe('loaded');
        expect(mocks.loadAll).toHaveBeenCalledWith(mockBundle, can_activate);
    });

    it('should restore the last-active branch into the root slot', async () => {
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

        await loadCrdtProject({ canActivate: () => true });

        // Regression: reopening must land on the active branch, not whatever doc
        // last occupied the root slot.
        expect(mocks.replaceDoc).toHaveBeenCalledWith('root', branchDoc);
    });

    it('should leave the root slot untouched when the active branch is main', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.branchStoreValue = {
            branches: [{ branchId: 'main', rootDocId: 'root' }],
            activeBranchId: 'main',
        };

        await loadCrdtProject({ canActivate: () => true });

        expect(mocks.replaceDoc).not.toHaveBeenCalled();
    });

    it('should stay on the root slot when the active branch doc is absent', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.branchStoreValue = {
            branches: [
                { branchId: 'main', rootDocId: 'root' },
                { branchId: 'feat', rootDocId: 'branch_feat' },
            ],
            activeBranchId: 'feat',
        };
        mocks.getDoc.mockReturnValue(undefined);

        const result = await loadCrdtProject({ canActivate: () => true });

        expect(result).toBe('loaded');
        expect(mocks.replaceDoc).not.toHaveBeenCalled();
    });

    it('should not activate a bundle after transition ownership is lost', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        let current = true;
        mocks.loadAll.mockImplementation(async () => {
            current = false;
            return false;
        });

        const result = await loadCrdtProject({ canActivate: () => current });

        expect(result).toBe('stale');
        expect(mocks.replaceDoc).not.toHaveBeenCalled();
    });
});
