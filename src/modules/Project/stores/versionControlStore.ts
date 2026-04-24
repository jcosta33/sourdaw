import { createStore } from '#/infra/store/createStore';

import { type VersionControlState, createDefaultState } from '../models/ProjectVersion';

export type { VersionControlState };

const VC_STORAGE_KEY = 'sourdaw-version-control';

function loadFromStorage(): VersionControlState {
    try {
        const raw = window.localStorage.getItem(VC_STORAGE_KEY);
        if (raw) {
            return JSON.parse(raw) as VersionControlState;
        }
    } catch {
        /* ignore */
    }
    return createDefaultState();
}

export const versionControlStore = createStore<VersionControlState>({
    initialData: loadFromStorage(),
});

function persistVersionControlState(value: VersionControlState): void {
    try {
        // Persist only metadata — not full snapshots (too large for localStorage)
        const lightweight: VersionControlState = {
            ...value,
            versions: value.versions.map((value1) => ({
                ...value1,
                snapshot: { data: '', size: value1.snapshot.size },
            })),
        };
        window.localStorage.setItem(VC_STORAGE_KEY, JSON.stringify(lightweight));
    } catch {
        /* storage full */
    }
}

versionControlStore.subscribe((value) => {
    if (!value) {
        return;
    }
    persistVersionControlState(value);
});
