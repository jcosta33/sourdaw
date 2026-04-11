import { versionControlStore } from '../../../stores/versionControlStore';
import { createBranch } from '../../../models/ProjectVersion';

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