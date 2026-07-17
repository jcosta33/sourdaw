import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { setClipSelection } from '../setClipSelection';

describe('setClipSelection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sets the selection and focuses the first clip', () => {
        setClipSelection(['clip-1', 'clip-2']);

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-1', 'clip-2'],
        });
    });

    it('clears the focused clip when the selection is empty', () => {
        setClipSelection([]);

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({
            selectedClipId: null,
            selectedClipIds: [],
        });
    });
});
