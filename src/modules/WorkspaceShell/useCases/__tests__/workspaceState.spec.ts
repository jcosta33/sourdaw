import { describe, it, expect, vi } from 'vitest';

import { updateWorkspaceState as updateWorkspaceStateRepo } from '../../repositories/updateWorkspaceState';
import { updateWorkspaceState } from '../workspaceState';

vi.mock('../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: vi.fn(),
}));

describe('updateWorkspaceState', () => {
    it('should forward partial patches to the repository', () => {
        updateWorkspaceState({ sidebarOpen: false });

        expect(updateWorkspaceStateRepo).toHaveBeenCalledWith({ sidebarOpen: false });
    });
});
