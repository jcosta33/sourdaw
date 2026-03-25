import { versionControlStore } from '../../stores/versionControlStore';
import { createBranch } from '../../models/ProjectVersion';
import { restoreSnapshot } from './snapshotHelpers';

export function createVersionBranch(name: string): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }

    const branch = createBranch(name, state.currentVersionId ?? '');

    versionControlStore.set({
        ...state,
        branches: [...state.branches, branch],
        currentBranchId: branch.id,
    });
}

export function switchBranch(branchId: string): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }

    const branch = state.branches.find((b) => b.id === branchId);
    if (!branch) {
        return;
    }

    const headVersion = state.versions.find((v) => v.id === branch.headVersionId);
    if (headVersion?.snapshot.data) {
        restoreSnapshot(headVersion.snapshot);
    }

    versionControlStore.set({
        ...state,
        currentBranchId: branchId,
        currentVersionId: branch.headVersionId || null,
    });
}

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
