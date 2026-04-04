import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type VersionControlState, createDefaultState } from '../models/ProjectVersion';

const logger = Container.getInstance().get(Logger);

const VC_STORAGE_KEY = 'sourdaw-version-control';

function loadFromStorage(): VersionControlState {
    try {
        const raw = localStorage.getItem(VC_STORAGE_KEY);
        if (raw) {
            return JSON.parse(raw) as VersionControlState;
        }
    } catch {
        /* ignore */
    }
    return createDefaultState();
}

export const versionControlStore = new Store<VersionControlState>(logger, {
    initialData: loadFromStorage(),
});

function persistVersionControlState(value: VersionControlState): void {
    try {
        // Persist only metadata — not full snapshots (too large for localStorage)
        const lightweight: VersionControlState = {
            ...value,
            versions: value.versions.map((v) => ({
                ...v,
                snapshot: { data: '', size: v.snapshot.size },
            })),
        };
        localStorage.setItem(VC_STORAGE_KEY, JSON.stringify(lightweight));
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
