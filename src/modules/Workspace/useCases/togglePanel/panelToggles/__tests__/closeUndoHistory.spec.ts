import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { closeUndoHistory } from '../closeUndoHistory';

describe('closeUndoHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('closes the undo history', () => {
        closeUndoHistory();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ undoHistoryOpen: false });
    });
});
