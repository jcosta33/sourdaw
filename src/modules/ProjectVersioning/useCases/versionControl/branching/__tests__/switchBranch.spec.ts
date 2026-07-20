import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ProjectSnapshot, type VersionControlState } from '../../../../models/ProjectVersion';
import { makeVersion, makeVersionControlState } from '../../__tests__/versionControlTestFixtures';
import { switchBranch } from '../switchBranch';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as VersionControlState | null },
    storeSet: vi.fn<(value: VersionControlState) => void>(),
    restoreSnapshot: vi.fn<(snapshot: ProjectSnapshot) => void>(),
}));

vi.mock('../../../../stores/versionControlStore', () => ({
    versionControlStore: {
        get value() {
            return mocks.storeValue.value;
        },
        set: mocks.storeSet,
    },
}));

vi.mock('../../snapshotHelpers/restoreSnapshot', () => ({
    restoreSnapshot: mocks.restoreSnapshot,
}));

function makeState(): VersionControlState {
    return makeVersionControlState({
        versions: [makeVersion({ snapshot: { data: JSON.stringify({ tracks: [] }), size: 10 } })],
        branches: [
            { id: 'branch-a', name: 'a', headVersionId: 'ver-1', createdAt: '2024-01-01T00:00:00.000Z' },
            { id: 'branch-b', name: 'b', headVersionId: '', createdAt: '2024-01-01T00:00:00.000Z' },
        ],
        currentBranchId: 'branch-b',
    });
}

describe('switchBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('does nothing without store state or an unknown branch; else restores the snapshot and always switches', () => {
        switchBranch('branch-a');
        mocks.storeValue.value = makeState();
        switchBranch('branch-missing');
        expect(mocks.storeSet).not.toHaveBeenCalled();
        expect(mocks.restoreSnapshot).not.toHaveBeenCalled();
        switchBranch('branch-a');
        expect(mocks.restoreSnapshot).toHaveBeenCalledWith({ data: JSON.stringify({ tracks: [] }), size: 10 });
        expect(mocks.storeSet).toHaveBeenCalledWith(
            expect.objectContaining({ currentBranchId: 'branch-a', currentVersionId: 'ver-1' })
        );
        mocks.restoreSnapshot.mockClear();
        switchBranch('branch-b');
        expect(mocks.restoreSnapshot).not.toHaveBeenCalled();
        expect(mocks.storeSet).toHaveBeenCalledWith(
            expect.objectContaining({ currentBranchId: 'branch-b', currentVersionId: null })
        );
    });
});
