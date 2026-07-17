import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleUndoHistory } from '../toggleUndoHistory';

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

describe('toggleUndoHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleUndoHistory();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('opens the undo history when it was closed', () => {
        mocks.getWorkspaceState.mockReturnValue({ undoHistoryOpen: false });

        toggleUndoHistory();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ undoHistoryOpen: true });
    });

    it('closes the undo history when it was open', () => {
        mocks.getWorkspaceState.mockReturnValue({ undoHistoryOpen: true });

        toggleUndoHistory();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ undoHistoryOpen: false });
    });
});
