import { versionControlStore } from '../../stores/versionControlStore';
import { createVersion } from '../../models/ProjectVersion';
import { captureSnapshot } from './snapshotHelpers';

export function createProjectVersion(label: string, description: string = '', tags: string[] = []): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }

    const snapshot = captureSnapshot();
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
}
