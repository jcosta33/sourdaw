import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleClipInSelection } from '../toggleClipInSelection';

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

describe('toggleClipInSelection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleClipInSelection('clip-1');

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('adds a clip that was not part of the selection', () => {
        mocks.getWorkspaceState.mockReturnValue({ selectedClipIds: [] });

        toggleClipInSelection('clip-1');

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-1'],
        });
    });

    it('removes a clip that was already in the selection', () => {
        mocks.getWorkspaceState.mockReturnValue({ selectedClipIds: ['clip-1', 'clip-2'] });

        toggleClipInSelection('clip-1');

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-2'],
        });
    });
});
