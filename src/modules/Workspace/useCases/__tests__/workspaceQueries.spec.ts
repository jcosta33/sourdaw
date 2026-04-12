import { describe, it, expect, vi } from 'vitest';
import { getWorkspaceState } from '../workspaceQueries/getWorkspaceState';
import { defaultWorkspaceState } from '../../models/WorkspaceState';
import { getWorkspaceState as repoGetWorkspaceState } from '../../repositories/workspace';

vi.mock('../../repositories/workspace', () => ({
    getWorkspaceState: vi.fn(),
}));

describe('getWorkspaceState', () => {
    it('should forward to the workspace repository', () => {
        const snapshot = { ...defaultWorkspaceState };
        vi.mocked(repoGetWorkspaceState).mockReturnValue(snapshot as any);

        expect(getWorkspaceState()).toBe(snapshot);
        expect(repoGetWorkspaceState).toHaveBeenCalledTimes(1);
    });
});
