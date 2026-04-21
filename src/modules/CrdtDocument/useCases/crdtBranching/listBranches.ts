import { branchStore, type BranchRecord } from '../../stores/branchStore';

/**
 * List all branches.
 */
export function listBranches(): BranchRecord[] {
    return branchStore.value?.branches ?? [];
}
