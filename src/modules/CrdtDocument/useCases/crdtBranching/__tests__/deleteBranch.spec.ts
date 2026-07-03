import { describe, it, expect, vi, beforeEach } from 'vitest';

import { deleteBranch } from '../deleteBranch';

const mocks = vi.hoisted(() => ({
    removeDoc: vi.fn(),
    storeValue: {
        branches: [
            { branchId: 'main', rootDocId: 'root' },
            { branchId: 'feat', rootDocId: 'branch_feat' },
            { branchId: 'other', rootDocId: 'branch_other' },
        ],
        activeBranchId: 'main',
    },
    storeSet: vi.fn(),
    compactProject: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: { removeDoc: mocks.removeDoc },
}));
vi.mock('../../../stores/branchStore', () => ({
    get branchStore() {
        return { value: mocks.storeValue, set: mocks.storeSet };
    },
    MAIN_BRANCH_ID: 'main',
}));
vi.mock('../../compactProject', () => ({ compactProject: mocks.compactProject }));

describe('deleteBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.compactProject.mockResolvedValue(undefined);
        mocks.storeValue.activeBranchId = 'main';
    });

    it('removes the branch doc and persists so its IDB bytes are dropped', async () => {
        deleteBranch('feat');

        // Regression: removeDoc only evicts in-memory; without compaction the
        // branch_<uuid> bytes survive in IDB and reload re-materialises it.
        expect(mocks.removeDoc).toHaveBeenCalledWith('branch_feat');
        expect(mocks.compactProject).toHaveBeenCalledTimes(1);
        // Let the fire-and-forget persistence settle.
        await Promise.resolve();

        const nextState = mocks.storeSet.mock.calls[0]?.[0] as {
            branches: { branchId: string }[];
        };
        expect(nextState.branches.map((b) => b.branchId)).not.toContain('feat');
    });

    it('refuses to delete the main branch and does not persist', () => {
        expect(() => deleteBranch('main')).toThrow(/Cannot delete the main branch/);
        expect(mocks.removeDoc).not.toHaveBeenCalled();
        expect(mocks.compactProject).not.toHaveBeenCalled();
    });

    it('refuses to delete the active branch and does not persist', () => {
        mocks.storeValue.activeBranchId = 'feat';
        expect(() => deleteBranch('feat')).toThrow(/active branch/);
        expect(mocks.removeDoc).not.toHaveBeenCalled();
        expect(mocks.compactProject).not.toHaveBeenCalled();
    });
});
