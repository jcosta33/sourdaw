import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleBranchManager } from '../toggleBranchManager';

const mocks = vi.hoisted(() => ({
    getWorkspaceState: vi.fn<() => Partial<WorkspaceState> | null>(),
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: mocks.getWorkspaceState,
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

describe('toggleBranchManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleBranchManager();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('opens the branch manager when it was closed', () => {
        mocks.getWorkspaceState.mockReturnValue({ branchManagerOpen: false });

        toggleBranchManager();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ branchManagerOpen: true });
    });

    it('closes the branch manager when it was open', () => {
        mocks.getWorkspaceState.mockReturnValue({ branchManagerOpen: true });

        toggleBranchManager();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ branchManagerOpen: false });
    });
});
