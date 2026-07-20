import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type VersionControlState } from '../../../../models/ProjectVersion';
import { makeVersionControlState } from '../../__tests__/versionControlTestFixtures';
import { createVersionBranch } from '../createVersionBranch';

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

describe('createVersionBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('does nothing without store state; else appends a branch at the current (or empty) head and switches to it', () => {
        createVersionBranch('feature');
        expect(mocks.storeSet).not.toHaveBeenCalled();
        mocks.storeValue.value = makeVersionControlState({ currentVersionId: 'ver-current' });
        createVersionBranch('feature');
        const next = mocks.storeSet.mock.calls[0]![0];
        expect(next.branches).toHaveLength(2);
        const newBranch = next.branches[1]!;
        expect(newBranch).toMatchObject({ name: 'feature', headVersionId: 'ver-current' });
        expect(newBranch.id).toMatch(/^branch-/);
        expect(next.currentBranchId).toBe(newBranch.id);
        mocks.storeValue.value = makeVersionControlState({ currentVersionId: null });
        createVersionBranch('feature');
        expect(mocks.storeSet.mock.calls[1]![0].branches[1]!.headVersionId).toBe('');
    });
});
