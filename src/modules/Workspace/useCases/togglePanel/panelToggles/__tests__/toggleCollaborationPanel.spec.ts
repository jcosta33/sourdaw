import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleCollaborationPanel } from '../toggleCollaborationPanel';

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

describe('toggleCollaborationPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleCollaborationPanel();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('opens the collaboration panel when it was closed', () => {
        mocks.getWorkspaceState.mockReturnValue({ collaborationPanelOpen: false });

        toggleCollaborationPanel();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ collaborationPanelOpen: true });
    });

    it('closes the collaboration panel when it was open', () => {
        mocks.getWorkspaceState.mockReturnValue({ collaborationPanelOpen: true });

        toggleCollaborationPanel();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ collaborationPanelOpen: false });
    });
});
