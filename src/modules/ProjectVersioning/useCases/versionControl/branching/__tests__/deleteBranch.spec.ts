import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type VersionControlState } from '../../../../models/ProjectVersion';
import { makeVersionControlState } from '../../__tests__/versionControlTestFixtures';
import { deleteBranch } from '../deleteBranch';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as VersionControlState | null },
    storeSet: vi.fn<(value: VersionControlState) => void>(),
}));

vi.mock('../../../../stores/versionControlStore', () => ({
    versionControlStore: {
        get value() {
            return mocks.storeValue.value;
        },
        set: mocks.storeSet,
    },
}));

function makeState(): VersionControlState {
    return makeVersionControlState({
        branches: [
            { id: 'branch-main', name: 'main', headVersionId: '', createdAt: '2024-01-01T00:00:00.000Z' },
            { id: 'branch-feature', name: 'feature', headVersionId: '', createdAt: '2024-01-01T00:00:00.000Z' },
        ],
        currentBranchId: 'branch-main',
    });
}

describe('deleteBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('does nothing without store state or when deleting the current branch; else removes a non-current one', () => {
        deleteBranch('branch-feature');
        expect(mocks.storeSet).not.toHaveBeenCalled();
        mocks.storeValue.value = makeState();
        deleteBranch('branch-main');
        expect(mocks.storeSet).not.toHaveBeenCalled();
        deleteBranch('branch-feature');
        expect(mocks.storeSet.mock.calls[0]![0].branches.map((b) => b.id)).toEqual(['branch-main']);
    });
});
