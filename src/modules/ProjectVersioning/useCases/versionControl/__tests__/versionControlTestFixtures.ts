import { type ProjectVersion, type VersionBranch, type VersionControlState } from '../../../models/ProjectVersion';

export const TEST_OWNER_PROJECT_ID = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';

export function makeVersion(overrides: Partial<ProjectVersion> = {}): ProjectVersion {
    return {
        id: 'ver-1',
        label: 'v1',
        createdAt: '2024-01-01T00:00:00.000Z',
        parentId: null,
        description: '',
        snapshot: { ownerProjectId: TEST_OWNER_PROJECT_ID, data: '', size: 0 },
        tags: [],
        ...overrides,
    };
}

export function makeBranch(overrides: Partial<VersionBranch> = {}): VersionBranch {
    return {
        id: 'branch-1',
        name: 'main',
        headVersionId: '',
        createdAt: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

export function makeVersionControlState(overrides: Partial<VersionControlState> = {}): VersionControlState {
    return {
        versions: [],
        branches: [makeBranch()],
        currentBranchId: 'branch-1',
        currentVersionId: null,
        autoSaveInterval: 5,
        ...overrides,
    };
}
