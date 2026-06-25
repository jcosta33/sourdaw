import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ProjectVersion, type VersionControlState } from '../../models/ProjectVersion';

const VC_STORAGE_KEY = 'sourdaw-version-control';

function makeVersion(overrides: Partial<ProjectVersion> = {}): ProjectVersion {
    return {
        id: 'ver-1',
        label: 'v1',
        createdAt: '2024-01-01T00:00:00.000Z',
        parentId: null,
        description: 'first',
        snapshot: { data: JSON.stringify({ tracks: { tracks: [] } }), size: 1234 },
        tags: [],
        ...overrides,
    };
}

function makeState(versions: ProjectVersion[]): VersionControlState {
    return {
        versions,
        branches: [{ id: 'branch-1', name: 'main', headVersionId: 'ver-1', createdAt: '2024-01-01T00:00:00.000Z' }],
        currentBranchId: 'branch-1',
        currentVersionId: null,
        autoSaveInterval: 5,
    };
}

describe('versionControlStore persistence', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.resetModules();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    it('does not advertise a non-zero snapshot size for versions whose payload cannot be persisted', async () => {
        const { versionControlStore } = await import('../versionControlStore');

        // Simulate a session writing a real version whose payload is stripped on persist.
        versionControlStore.set(makeState([makeVersion()]));

        const raw = window.localStorage.getItem(VC_STORAGE_KEY);
        expect(raw).not.toBeNull();
        const persisted = JSON.parse(raw as string) as VersionControlState;

        // The payload could not be stored in localStorage; the metadata must not
        // claim a non-zero size, otherwise a reloaded version appears restorable
        // while restoreVersion silently no-ops on the empty payload.
        expect(persisted.versions[0].snapshot.data).toBe('');
        expect(persisted.versions[0].snapshot.size).toBe(0);
    });
});
