import { createStore } from '#/infra/store/createStore';
import { type StorageAdapter } from '#/infra/store/storage/types';

import { type VersionControlState, createDefaultState } from '../models/ProjectVersion';

export type { VersionControlState };

const VC_STORAGE_KEY = 'sourdaw-version-control';

type UnknownRecord = {
    [key: string]: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
    if (!Array.isArray(value)) {
        return false;
    }

    return value.every((item) => typeof item === 'string');
}

function isBrowserStorage(value: unknown): value is Storage {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.getItem === 'function' &&
        typeof value.setItem === 'function' &&
        typeof value.removeItem === 'function'
    );
}

function validateStoredVersion(value: unknown): VersionControlState['versions'][number] | null {
    if (!isRecord(value)) {
        return null;
    }

    if (
        typeof value.id !== 'string' ||
        typeof value.label !== 'string' ||
        typeof value.createdAt !== 'string' ||
        (value.parentId !== null && typeof value.parentId !== 'string') ||
        typeof value.description !== 'string' ||
        !isRecord(value.snapshot) ||
        typeof value.snapshot.ownerProjectId !== 'string' ||
        typeof value.snapshot.data !== 'string' ||
        !isFiniteNonNegativeNumber(value.snapshot.size) ||
        !isStringArray(value.tags)
    ) {
        return null;
    }

    return {
        id: value.id,
        label: value.label,
        createdAt: value.createdAt,
        parentId: value.parentId,
        description: value.description,
        snapshot: { ownerProjectId: value.snapshot.ownerProjectId, data: '', size: 0 },
        tags: value.tags,
    };
}

function validateStoredBranch(value: unknown): VersionControlState['branches'][number] | null {
    if (!isRecord(value)) {
        return null;
    }

    if (
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.headVersionId !== 'string' ||
        typeof value.createdAt !== 'string'
    ) {
        return null;
    }

    return {
        id: value.id,
        name: value.name,
        headVersionId: value.headVersionId,
        createdAt: value.createdAt,
    };
}

function validateStoredVersionControlState(value: unknown): VersionControlState {
    if (!isRecord(value)) {
        return createDefaultState();
    }

    if (
        !Array.isArray(value.versions) ||
        !Array.isArray(value.branches) ||
        typeof value.currentBranchId !== 'string' ||
        (value.currentVersionId !== null && typeof value.currentVersionId !== 'string') ||
        !isFiniteNonNegativeNumber(value.autoSaveInterval)
    ) {
        return createDefaultState();
    }

    const versions: VersionControlState['versions'] = [];
    for (const versionCandidate of value.versions) {
        const version = validateStoredVersion(versionCandidate);
        if (version === null) {
            return createDefaultState();
        }
        versions.push(version);
    }

    const branches: VersionControlState['branches'] = [];
    for (const branchCandidate of value.branches) {
        const branch = validateStoredBranch(branchCandidate);
        if (branch === null) {
            return createDefaultState();
        }
        branches.push(branch);
    }

    const currentBranchExists = branches.some((branch) => branch.id === value.currentBranchId);
    if (!currentBranchExists) {
        return createDefaultState();
    }

    const currentVersionExists =
        value.currentVersionId === null || versions.some((version) => version.id === value.currentVersionId);
    if (!currentVersionExists) {
        return createDefaultState();
    }

    return {
        versions,
        branches,
        currentBranchId: value.currentBranchId,
        currentVersionId: value.currentVersionId,
        autoSaveInterval: value.autoSaveInterval,
    };
}

function createLightweightVersionControlState(value: VersionControlState): VersionControlState {
    // Persist only metadata — not full snapshots (too large for localStorage).
    // The payload is dropped, so report size 0 as well: a reloaded version
    // with no data must not advertise a non-zero size (which makes it look
    // restorable while restoreVersion can only no-op on the empty payload).
    return {
        ...value,
        versions: value.versions.map((version) => ({
            ...version,
            snapshot: { ownerProjectId: version.snapshot.ownerProjectId, data: '', size: 0 },
        })),
    };
}

function getBrowserStorage(): Storage | null {
    try {
        const storage: unknown = Reflect.get(globalThis, 'localStorage');
        if (!isBrowserStorage(storage)) {
            return null;
        }

        return storage;
    } catch {
        return null;
    }
}

function createVersionControlStorage(): StorageAdapter<VersionControlState> {
    let cachedValue: VersionControlState | null | undefined = undefined;

    return {
        get(): VersionControlState | null {
            if (cachedValue !== undefined) {
                return cachedValue;
            }

            const storage = getBrowserStorage();
            if (storage === null) {
                cachedValue = createDefaultState();
                return cachedValue;
            }

            let raw: string | null;
            try {
                raw = storage.getItem(VC_STORAGE_KEY);
            } catch {
                cachedValue = createDefaultState();
                return cachedValue;
            }

            if (raw === null) {
                cachedValue = createDefaultState();
                return cachedValue;
            }

            try {
                const stored: unknown = JSON.parse(raw);
                cachedValue = validateStoredVersionControlState(stored);
            } catch {
                cachedValue = createDefaultState();
            }

            return cachedValue;
        },

        set(value: VersionControlState | null): void {
            cachedValue = value;

            const storage = getBrowserStorage();
            if (storage === null) {
                return;
            }

            try {
                if (value === null) {
                    storage.removeItem(VC_STORAGE_KEY);
                    return;
                }

                storage.setItem(VC_STORAGE_KEY, JSON.stringify(createLightweightVersionControlState(value)));
            } catch {
                /* storage full */
            }
        },

        clear(): void {
            cachedValue = null;
            const storage = getBrowserStorage();
            if (storage === null) {
                return;
            }

            try {
                storage.removeItem(VC_STORAGE_KEY);
            } catch {
                /* storage unavailable */
            }
        },

        isSupported(): boolean {
            return getBrowserStorage() !== null;
        },
    };
}

export const versionControlStore = createStore<VersionControlState>({
    storage: createVersionControlStorage(),
    initialData: createDefaultState(),
});
