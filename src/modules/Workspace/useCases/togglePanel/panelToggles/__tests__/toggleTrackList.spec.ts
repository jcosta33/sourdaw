import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleTrackList } from '../toggleTrackList';

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

describe('toggleTrackList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleTrackList();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('opens the track list when it was closed', () => {
        mocks.getWorkspaceState.mockReturnValue({ trackListOpen: false });

        toggleTrackList();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ trackListOpen: true });
    });

    it('closes the track list when it was open', () => {
        mocks.getWorkspaceState.mockReturnValue({ trackListOpen: true });

        toggleTrackList();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ trackListOpen: false });
    });
});
