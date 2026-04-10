import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCreateProjectVersion } from './handleCreateProjectVersion';
import { handleRestoreProjectVersion } from './handleRestoreProjectVersion';
import { handleCreateVersionBranch } from './handleCreateVersionBranch';

vi.mock('../../useCases/versionControl/createProjectVersion', () => ({
    createProjectVersion: vi.fn(),
}));

vi.mock('../../useCases/versionControl/restoreVersion', () => ({
    restoreVersion: vi.fn(),
}));

vi.mock('../../useCases/versionControl/branching', () => ({
    createVersionBranch: vi.fn(),
}));

import { createProjectVersion } from '../../useCases/versionControl/createProjectVersion';
import { restoreVersion } from '../../useCases/versionControl/restoreVersion';
import { createVersionBranch } from '../../useCases/versionControl/branching';

describe('version control handlers', () => {
    beforeEach(() => {
        vi.mocked(createProjectVersion).mockClear();
        vi.mocked(restoreVersion).mockClear();
        vi.mocked(createVersionBranch).mockClear();
    });

    it('handleCreateProjectVersion forwards label and description', async () => {
        await handleCreateProjectVersion.execute({
            type: 'createProjectVersion',
            payload: { label: 'v1', description: 'notes' },
        });

        expect(createProjectVersion).toHaveBeenCalledWith('v1', 'notes');
    });

    it('handleRestoreProjectVersion forwards version id', async () => {
        await handleRestoreProjectVersion.execute({
            type: 'restoreProjectVersion',
            payload: { versionId: 'vid-1' },
        });

        expect(restoreVersion).toHaveBeenCalledWith('vid-1');
    });

    it('handleCreateVersionBranch forwards name', async () => {
        await handleCreateVersionBranch.execute({
            type: 'createVersionBranch',
            payload: { name: 'feature-a' },
        });

        expect(createVersionBranch).toHaveBeenCalledWith('feature-a');
    });
});
