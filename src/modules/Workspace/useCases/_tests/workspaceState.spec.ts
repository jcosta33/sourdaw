import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { updateWorkspaceState } from '../workspaceState';

describe('updateWorkspaceState', () => {
    it('should forward partial patches to the repository', () => {
        const repo = vi.fn();
        injectDependencies(updateWorkspaceState, { updateWorkspaceStateRepo: repo });

        updateWorkspaceState({ sidebarOpen: false });

        expect(repo).toHaveBeenCalledWith({ sidebarOpen: false });
    });
});
