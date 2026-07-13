import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadCrdtProject } from '../loadCrdtProject';

const mocks = vi.hoisted(() => ({
    loadAll: vi.fn<(input: { bundle: Map<string, Uint8Array>; shouldCommit?: () => boolean }) => Promise<boolean>>(),
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

        const result = await loadCrdtProject();

        expect(result).toBe(true);
        expect(mocks.loadAll).toHaveBeenCalledWith({ bundle: mockBundle, shouldCommit: undefined });
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

        await loadCrdtProject();

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

        await loadCrdtProject();

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

        const result = await loadCrdtProject();

        expect(result).toBe(true);
        expect(mocks.replaceDoc).not.toHaveBeenCalled();
    });

    it('does not restore branch state when repository commit is canceled', async () => {
        const should_commit = vi.fn(() => false);
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.loadAll.mockResolvedValue(false);

        const result = await loadCrdtProject({ shouldCommit: should_commit });

        expect(result).toBe(false);
        const loadInput = mocks.loadAll.mock.calls[0]?.[0];
        expect(loadInput?.bundle).toBeInstanceOf(Map);
        expect(loadInput?.shouldCommit).toBe(should_commit);
        expect(mocks.replaceDoc).not.toHaveBeenCalled();
    });
});
