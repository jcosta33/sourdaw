import { versionControlStore } from '../../../stores/versionControlStore';

export function deleteBranch(branchId: string): void {
    const state = versionControlStore.value;
    if (!state || branchId === state.currentBranchId) {
        return; // Cannot delete current branch
    }

    versionControlStore.set({
        ...state,
        branches: state.branches.filter((b) => b.id !== branchId),
    });
}