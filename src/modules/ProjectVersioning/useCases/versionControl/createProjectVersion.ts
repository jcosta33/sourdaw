import { createVersion } from '../../models/ProjectVersion';
import { versionControlStore } from '../../stores/versionControlStore';

import { captureSnapshot } from './snapshotHelpers/captureSnapshot';

export function createProjectVersion(label: string, description: string = '', tags: string[] = []): boolean {
    const state = versionControlStore.value;
    if (!state) {
        return false;
    }

    const snapshot = captureSnapshot();
    if (!snapshot) {
        return false;
    }
    const version = createVersion(label, description, snapshot, state.currentVersionId, tags);

    const branches = state.branches.map((b) =>
        b.id === state.currentBranchId ? { ...b, headVersionId: version.id } : b
    );

    versionControlStore.set({
        ...state,
        versions: [...state.versions, version],
        branches,
        currentVersionId: version.id,
    });

    return true;
}
