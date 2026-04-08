import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    executeCreateProjectVersion,
    executeRestoreProjectVersion,
    executeCreateVersionBranch,
} from './versionControlHandlers';

describe('versionControlHandlers execute', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeCreateProjectVersion forwards label and description', async () => {
        const createProjectVersion = vi.fn();
        injectDependencies(executeCreateProjectVersion, { createProjectVersion });

        await executeCreateProjectVersion({
            payload: { label: 'v1', description: 'notes' },
        });

        expect(createProjectVersion).toHaveBeenCalledWith('v1', 'notes');
    });

    it('executeRestoreProjectVersion forwards version id', async () => {
        const restoreVersion = vi.fn();
        injectDependencies(executeRestoreProjectVersion, { restoreVersion });

        await executeRestoreProjectVersion({ payload: { versionId: 'vid-1' } });

        expect(restoreVersion).toHaveBeenCalledWith('vid-1');
    });

    it('executeCreateVersionBranch forwards name', async () => {
        const createVersionBranch = vi.fn();
        injectDependencies(executeCreateVersionBranch, { createVersionBranch });

        await executeCreateVersionBranch({ payload: { name: 'feature-a' } });

        expect(createVersionBranch).toHaveBeenCalledWith('feature-a');
    });
});
