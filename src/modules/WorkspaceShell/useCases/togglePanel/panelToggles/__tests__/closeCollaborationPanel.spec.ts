import { describe, it, expect, vi, beforeEach } from 'vitest';

import { closeCollaborationPanel } from '../closeCollaborationPanel';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

describe('closeCollaborationPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should set collaborationPanelOpen to false', () => {
        closeCollaborationPanel();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ collaborationPanelOpen: false });
    });
});
