import { versionControlStore } from '../../stores/versionControlStore';
import { restoreSnapshot } from './snapshotHelpers';

export function restoreVersion(versionId: string): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }

    const version = state.versions.find((v) => v.id === versionId);
    if (!version || !version.snapshot.data) {
        return;
    }

    restoreSnapshot(version.snapshot);

    versionControlStore.set({
        ...state,
        currentVersionId: versionId,
    });
}
