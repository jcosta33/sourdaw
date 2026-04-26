import { branchStore, type BranchRecord } from '../../stores/branchStore';

/**
 * Get the active branch.
 */
export function getActiveBranch(): BranchRecord | null {
    const state = branchStore.value;
    if (!state) {
        return null;
    }
    return state.branches.find((b) => b.branchId === state.activeBranchId) ?? null;
}
