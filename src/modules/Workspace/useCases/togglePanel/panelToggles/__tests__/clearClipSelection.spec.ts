import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { clearClipSelection } from '../clearClipSelection';

describe('clearClipSelection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clears the focused clip and the whole selection', () => {
        clearClipSelection();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({
            selectedClipId: null,
            selectedClipIds: [],
        });
    });
});
