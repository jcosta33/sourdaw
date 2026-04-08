import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getWorkspaceState } from './workspaceQueries';
import { defaultWorkspaceState } from '../models/WorkspaceState';

describe('getWorkspaceState', () => {
    it('should forward to the workspace repository', () => {
        const snapshot = { ...defaultWorkspaceState };
        const repoGet = vi.fn(() => snapshot);
        injectDependencies(getWorkspaceState, { repoGetWorkspaceState: repoGet });

        expect(getWorkspaceState()).toBe(snapshot);
        expect(repoGet).toHaveBeenCalledTimes(1);
    });
});
