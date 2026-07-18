import { describe, it, expect, vi, beforeEach } from 'vitest';

import { updateWorkspaceState } from '../workspaceState';

const mocks = vi.hoisted(() => ({
    repoUpdate: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.repoUpdate,
}));

describe('updateWorkspaceState', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should forward partial state to the workspace repository', () => {
        updateWorkspaceState({ sidebarOpen: true });

        expect(mocks.repoUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.repoUpdate).toHaveBeenCalledWith({ sidebarOpen: true });
    });
});
