import { describe, it, expect, vi } from 'vitest';
import { updateWorkspaceState } from '../workspaceState';
import { updateWorkspaceState as updateWorkspaceStateRepo } from '../../repositories/workspace';

vi.mock('../../repositories/workspace', () => ({
    updateWorkspaceState: vi.fn(),
}));

describe('updateWorkspaceState', () => {
    it('should forward partial patches to the repository', () => {
        updateWorkspaceState({ sidebarOpen: false });

        expect(updateWorkspaceStateRepo).toHaveBeenCalledWith({ sidebarOpen: false });
    });
});
