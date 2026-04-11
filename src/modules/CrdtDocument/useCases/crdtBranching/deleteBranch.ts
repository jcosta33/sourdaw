import { createBranchError } from '../../errors/BranchError';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, MAIN_BRANCH_ID } from '../../stores/branchStore';

/**
 * Delete a branch. Cannot delete the main branch or the active branch.
 */
export const deleteBranch = (branchId: string): void => {
    if (branchId === MAIN_BRANCH_ID) {
        throw createBranchError('Cannot delete the main branch');
    }

    const state = branchStore.value;
    if (!state) {
        return;
    }

    if (state.activeBranchId === branchId) {
        throw createBranchError('Cannot delete the active branch — switch to another branch first');
    }

    const branch = state.branches.find((b) => b.branchId === branchId);
    if (branch) {
        automergeRepository.removeDoc(branch.rootDocId);
    }

    branchStore.set({
        ...state,
        branches: state.branches.filter((b) => b.branchId !== branchId),
    });
};