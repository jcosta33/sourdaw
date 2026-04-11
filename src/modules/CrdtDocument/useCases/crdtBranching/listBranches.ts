import { branchStore, type BranchRecord } from '../../stores/branchStore';

/**
 * List all branches.
 */
export const listBranches = (): BranchRecord[] => {
    return branchStore.value?.branches ?? [];
};