import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type VersionControlState } from '../../../models/ProjectVersion';
import { restoreVersion } from '../restoreVersion';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as VersionControlState | null },
    storeSet: vi.fn<(value: VersionControlState) => void>(),
    restoreSnapshot: vi.fn<() => boolean>(),
}));

vi.mock('../../../stores/versionControlStore', () => ({
    versionControlStore: {
        get value() {
            return mocks.storeValue.value;
        },
        set: mocks.storeSet,
    },
}));

vi.mock('../snapshotHelpers/restoreSnapshot', () => ({
    restoreSnapshot: mocks.restoreSnapshot,
}));

function makeState(snapshotData: string): VersionControlState {
    return {
        versions: [
            {
                id: 'ver-1',
                label: 'v1',
                createdAt: '2024-01-01T00:00:00.000Z',
                parentId: null,
                description: 'first',
                snapshot: {
                    ownerProjectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
                    data: snapshotData,
                    size: snapshotData.length,
                },
                tags: [],
            },
        ],
        branches: [{ id: 'branch-1', name: 'main', headVersionId: 'ver-1', createdAt: '2024-01-01T00:00:00.000Z' }],
        currentBranchId: 'branch-1',
        currentVersionId: null,
        autoSaveInterval: 5,
    };
}

describe('restoreVersion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
        mocks.restoreSnapshot.mockReturnValue(true);
    });

    it('preserves version selection when snapshot admission refuses the restore', () => {
        mocks.storeValue.value = makeState(JSON.stringify({ tracks: { tracks: [] } }));
        mocks.restoreSnapshot.mockReturnValue(false);

        expect(restoreVersion('ver-1')).toBe(false);
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('should export restoreVersion', () => {
        expect(restoreVersion).toBeDefined();
    });

    it('restores and reports success when the version has snapshot data', () => {
        mocks.storeValue.value = makeState(JSON.stringify({ tracks: { tracks: [] } }));

        const result = restoreVersion('ver-1');

        expect(result).toBe(true);
        expect(mocks.restoreSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.storeSet).toHaveBeenCalledWith(expect.objectContaining({ currentVersionId: 'ver-1' }));
    });

    it('reports failure (does not silently no-op) for a reloaded version whose payload was stripped', () => {
        // A version reloaded from localStorage has an empty payload — it must not
        // pretend the restore happened.
        mocks.storeValue.value = makeState('');

        const result = restoreVersion('ver-1');

        expect(result).toBe(false);
        expect(mocks.restoreSnapshot).not.toHaveBeenCalled();
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });
});
