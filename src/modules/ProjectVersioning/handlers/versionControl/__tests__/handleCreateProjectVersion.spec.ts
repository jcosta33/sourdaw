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
        vi.mocked(createProjectVersion).mockReturnValue(true);
        vi.mocked(restoreVersion).mockClear();
        vi.mocked(restoreVersion).mockReturnValue(true);
        vi.mocked(createVersionBranch).mockClear();
        mockNotificationEventBus.emit.mockClear();
    });

    it('handleCreateProjectVersion forwards label and description', async () => {
        const result = await handleCreateProjectVersion.execute({
            type: 'createProjectVersion',
            payload: { label: 'v1', description: 'notes' },
        });

        expect(createProjectVersion).toHaveBeenCalledWith('v1', 'notes');
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no write and notifies when snapshot capture is unavailable', async () => {
        vi.mocked(createProjectVersion).mockReturnValue(false);

        const result = await handleCreateProjectVersion.execute({
            type: 'createProjectVersion',
            payload: { label: 'v1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mockNotificationEventBus.emit).toHaveBeenCalledWith('ui.notify', {
            level: 'error',
            message: 'Project versions are unavailable until the project finishes loading',
        });
    });

    it('handleRestoreProjectVersion forwards version id', async () => {
        const result = await handleRestoreProjectVersion.execute({
            type: 'restoreProjectVersion',
            payload: { versionId: 'vid-1' },
        });

        expect(restoreVersion).toHaveBeenCalledWith('vid-1');
        expect(result).toEqual({ status: 'written' });
    });

    it('handleCreateVersionBranch forwards name', async () => {
        await handleCreateVersionBranch.execute({
            type: 'createVersionBranch',
            payload: { name: 'feature-a' },
        });

        expect(createVersionBranch).toHaveBeenCalledWith('feature-a');
    });
});
