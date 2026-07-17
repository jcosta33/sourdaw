import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleChatPanel } from '../toggleChatPanel';

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

describe('toggleChatPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleChatPanel();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('opens the chat panel when it was closed', () => {
        mocks.getWorkspaceState.mockReturnValue({ chatPanelOpen: false });

        toggleChatPanel();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ chatPanelOpen: true });
    });

    it('closes the chat panel when it was open', () => {
        mocks.getWorkspaceState.mockReturnValue({ chatPanelOpen: true });

        toggleChatPanel();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ chatPanelOpen: false });
    });
});
