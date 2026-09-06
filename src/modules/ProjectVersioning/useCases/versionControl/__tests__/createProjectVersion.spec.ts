import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ProjectSnapshot, type VersionControlState } from '../../../models/ProjectVersion';
import { createProjectVersion } from '../createProjectVersion';

import { makeVersionControlState } from './versionControlTestFixtures';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as VersionControlState | null },
    storeSet: vi.fn<(value: VersionControlState) => void>(),
    captureSnapshot: vi.fn<() => ProjectSnapshot | null>(),
}));

vi.mock('../../../stores/versionControlStore', () => ({
    versionControlStore: {
        get value() {
            return mocks.storeValue.value;
        },
        set: mocks.storeSet,
    },
}));

vi.mock('../snapshotHelpers/captureSnapshot', () => ({
    captureSnapshot: mocks.captureSnapshot,
}));

function makeState(): VersionControlState {
    return makeVersionControlState({
        branches: [
            { id: 'branch-main', name: 'main', headVersionId: '', createdAt: '2024-01-01T00:00:00.000Z' },
            { id: 'branch-other', name: 'other', headVersionId: 'ver-old', createdAt: '2024-01-01T00:00:00.000Z' },
        ],
        currentBranchId: 'branch-main',
    });
}

describe('createProjectVersion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
        mocks.captureSnapshot.mockReturnValue({
            ownerProjectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
            data: '{}',
            size: 2,
        });
    });

    it('does nothing without store state; else appends a version, moves the branch head, and defaults tags', () => {
        expect(createProjectVersion('Label')).toBe(false);
        expect(mocks.storeSet).not.toHaveBeenCalled();
        mocks.storeValue.value = makeState();
        expect(createProjectVersion('Label', 'desc', ['t1'])).toBe(true);
        const next = mocks.storeSet.mock.calls[0]![0];
        const version = next.versions[0]!;
        expect(version).toMatchObject({ label: 'Label', description: 'desc', tags: ['t1'], parentId: null });
        expect(version.snapshot).toEqual({
            ownerProjectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
            data: '{}',
            size: 2,
        });
        expect(next.currentVersionId).toBe(version.id);
        expect(next.branches.find((b) => b.id === 'branch-main')?.headVersionId).toBe(version.id);
        expect(next.branches.find((b) => b.id === 'branch-other')?.headVersionId).toBe('ver-old');
        mocks.storeValue.value = makeState();
        createProjectVersion('Label only');
        expect(mocks.storeSet.mock.calls[1]![0].versions[0]!).toMatchObject({ description: '', tags: [] });
    });

    it('preserves the catalog when the active project cannot own a checkpoint', () => {
        const state = makeState();
        mocks.storeValue.value = state;
        mocks.captureSnapshot.mockReturnValue(null);

        expect(createProjectVersion('Unavailable')).toBe(false);
        expect(mocks.storeSet).not.toHaveBeenCalled();
        expect(mocks.storeValue.value).toBe(state);
    });
});
