import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createVersionBranch } from '../../../useCases/versionControl/branching/createVersionBranch';
import { createProjectVersion } from '../../../useCases/versionControl/createProjectVersion';
import { restoreVersion } from '../../../useCases/versionControl/restoreVersion';
import { handleCreateProjectVersion } from '../handleCreateProjectVersion';
import { handleCreateVersionBranch } from '../handleCreateVersionBranch';
import { handleRestoreProjectVersion } from '../handleRestoreProjectVersion';

vi.mock('../../../useCases/versionControl/createProjectVersion', () => ({
    createProjectVersion: vi.fn(),
}));

vi.mock('../../../useCases/versionControl/restoreVersion', () => ({
    restoreVersion: vi.fn(),
}));

vi.mock('../../../useCases/versionControl/branching/createVersionBranch', () => ({
    createVersionBranch: vi.fn(),
}));

const mockNotificationEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
};

describe('version control handlers', () => {
    beforeEach(() => {
        injectDependencies(notifyUser, { eventBus: mockNotificationEventBus });
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
