import { versionControlStore } from '../../../stores/versionControlStore';
import { restoreSnapshot } from '../snapshotHelpers/restoreSnapshot';

export function switchBranch(branchId: string): boolean {
    const state = versionControlStore.value;
    if (!state) {
        return false;
    }

    const branch = state.branches.find((b) => b.id === branchId);
    if (!branch) {
        return false;
    }

    if (!branch.headVersionId) {
        versionControlStore.set({
            ...state,
            currentBranchId: branchId,
            currentVersionId: null,
        });
        return true;
    }

    const headVersion = state.versions.find((value) => value.id === branch.headVersionId);
    if (!headVersion || !restoreSnapshot(headVersion.snapshot)) {
        return false;
    }

    versionControlStore.set({
        ...state,
        currentBranchId: branchId,
        currentVersionId: branch.headVersionId || null,
    });

    return true;
}
