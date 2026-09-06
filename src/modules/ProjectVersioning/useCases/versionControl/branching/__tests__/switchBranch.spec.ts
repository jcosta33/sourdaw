import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ProjectSnapshot, type VersionControlState } from '../../../../models/ProjectVersion';
import { makeVersion, makeVersionControlState } from '../../__tests__/versionControlTestFixtures';
import { switchBranch } from '../switchBranch';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as VersionControlState | null },
    storeSet: vi.fn<(value: VersionControlState) => void>(),
    restoreSnapshot: vi.fn<(snapshot: ProjectSnapshot) => boolean>(),
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
        versions: [
            makeVersion({
                snapshot: {
                    ownerProjectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
                    data: JSON.stringify({ tracks: [] }),
                    size: 10,
                },
            }),
        ],
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
        mocks.restoreSnapshot.mockReturnValue(true);
    });

    it('restores a referenced branch head before switching selection', () => {
        mocks.storeValue.value = makeState();

        expect(switchBranch('branch-a')).toBe(true);
        expect(mocks.restoreSnapshot).toHaveBeenCalledWith({
            ownerProjectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
            data: JSON.stringify({ tracks: [] }),
            size: 10,
        });
        expect(mocks.storeSet).toHaveBeenCalledWith(
            expect.objectContaining({ currentBranchId: 'branch-a', currentVersionId: 'ver-1' })
        );
    });

    it('keeps selection unchanged when state, branch, head, or restore admission is unavailable', () => {
        expect(switchBranch('branch-a')).toBe(false);
        mocks.storeValue.value = makeState();

        expect(switchBranch('branch-missing')).toBe(false);
        mocks.storeValue.value = {
            ...makeState(),
            versions: [],
        };
        expect(switchBranch('branch-a')).toBe(false);
        mocks.storeValue.value = makeState();
        mocks.restoreSnapshot.mockReturnValue(false);
        expect(switchBranch('branch-a')).toBe(false);

        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('switches an empty branch without attempting a restore', () => {
        mocks.storeValue.value = makeState();

        expect(switchBranch('branch-b')).toBe(true);
        expect(mocks.restoreSnapshot).not.toHaveBeenCalled();
        expect(mocks.storeSet).toHaveBeenCalledWith(
            expect.objectContaining({ currentBranchId: 'branch-b', currentVersionId: null })
        );
    });
});
