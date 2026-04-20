import { versionControlStore } from '../../../stores/versionControlStore';
import { restoreSnapshot } from '../snapshotHelpers/restoreSnapshot';

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
