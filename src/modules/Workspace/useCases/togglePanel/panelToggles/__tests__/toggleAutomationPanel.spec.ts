import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleAutomationPanel } from '../toggleAutomationPanel';

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

describe('toggleAutomationPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleAutomationPanel();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('opens the automation panel when it was closed', () => {
        mocks.getWorkspaceState.mockReturnValue({ automationPanelOpen: false });

        toggleAutomationPanel();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ automationPanelOpen: true });
    });

    it('closes the automation panel when it was open', () => {
        mocks.getWorkspaceState.mockReturnValue({ automationPanelOpen: true });

        toggleAutomationPanel();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ automationPanelOpen: false });
    });
});
