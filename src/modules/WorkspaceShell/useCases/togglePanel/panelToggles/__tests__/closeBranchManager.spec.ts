import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { closeBranchManager } from '../closeBranchManager';

describe('closeBranchManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('closes the branch manager', () => {
        closeBranchManager();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ branchManagerOpen: false });
    });
});
