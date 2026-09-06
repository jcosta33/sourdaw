import { versionControlStore } from '../../stores/versionControlStore';

import { restoreSnapshot } from './snapshotHelpers/restoreSnapshot';

/**
 * Restore a stored version's snapshot into the project.
 *
 * @returns `true` when the snapshot was restored; `false` when the version is
 * missing or has no payload to restore (e.g. a version reloaded from
 * localStorage, whose snapshot data is not persisted). Returning a result
 * instead of silently no-op'ing lets callers/UI surface the non-restorable case.
 */
export function restoreVersion(versionId: string): boolean {
    const state = versionControlStore.value;
    if (!state) {
        return false;
    }

    const version = state.versions.find((value) => value.id === versionId);
    if (!version || !version.snapshot.data) {
        return false;
    }

    if (!restoreSnapshot(version.snapshot)) {
        return false;
    }

    versionControlStore.set({
        ...state,
        currentVersionId: versionId,
    });

    return true;
}
