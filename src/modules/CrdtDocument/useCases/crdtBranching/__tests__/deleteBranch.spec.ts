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
    captureRevision: vi.fn(() => 4),
    commit: vi.fn(async (): Promise<{ status: string; revision?: number; reason?: string }> => {
        return { status: 'committed', revision: 5 };
    }),
    compactProject: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: { removeDoc: mocks.removeDoc },
}));
vi.mock('../../../repositories/branchStateAuthority', () => ({
    branchStateAuthority: { captureRevision: mocks.captureRevision, commit: mocks.commit },
}));
vi.mock('../../../stores/branchStore', () => ({
    get branchStore() {
        return { value: mocks.storeValue };
    },
    MAIN_BRANCH_ID: 'main',
}));
vi.mock('../../compactProject', () => ({ compactProject: mocks.compactProject }));

describe('deleteBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.captureRevision.mockReturnValue(4);
        mocks.commit.mockResolvedValue({ status: 'committed', revision: 5 });
        mocks.compactProject.mockResolvedValue(undefined);
        mocks.storeValue.activeBranchId = 'main';
    });

    it('removes the branch doc and persists so its IDB bytes are dropped', async () => {
        await deleteBranch('feat');

        expect(mocks.commit).toHaveBeenCalledWith({
            expectedRevision: 4,
            next: {
                branches: [
                    { branchId: 'main', rootDocId: 'root' },
                    { branchId: 'other', rootDocId: 'branch_other' },
                ],
                activeBranchId: 'main',
            },
        });
        // Regression: removeDoc only evicts in-memory; without compaction the
        // branch_<uuid> bytes survive in IDB and reload re-materialises it.
        expect(mocks.removeDoc).toHaveBeenCalledWith('branch_feat');
        expect(mocks.compactProject).toHaveBeenCalledTimes(1);
        await Promise.resolve();
    });

    it('keeps the branch and its document when the removal cannot be persisted', async () => {
        mocks.commit.mockResolvedValue({ status: 'refused', reason: 'conflict' });

        await expect(deleteBranch('feat')).rejects.toThrow(/Branch deletion could not be persisted \(conflict\)/);

        // A branch whose removal was refused is a branch that was not deleted:
        // destroying its document here would leave it listed and unopenable,
        // with no compaction to clear its bytes. See #1557.
        expect(mocks.removeDoc).not.toHaveBeenCalled();
        expect(mocks.compactProject).not.toHaveBeenCalled();
    });

    it('refuses to delete the main branch and does not persist', async () => {
        await expect(deleteBranch('main')).rejects.toThrow(/Cannot delete the main branch/);
        expect(mocks.commit).not.toHaveBeenCalled();
        expect(mocks.removeDoc).not.toHaveBeenCalled();
        expect(mocks.compactProject).not.toHaveBeenCalled();
    });

    it('refuses to delete the active branch and does not persist', async () => {
        mocks.storeValue.activeBranchId = 'feat';

        await expect(deleteBranch('feat')).rejects.toThrow(/active branch/);
        expect(mocks.commit).not.toHaveBeenCalled();
        expect(mocks.removeDoc).not.toHaveBeenCalled();
        expect(mocks.compactProject).not.toHaveBeenCalled();
    });
});
