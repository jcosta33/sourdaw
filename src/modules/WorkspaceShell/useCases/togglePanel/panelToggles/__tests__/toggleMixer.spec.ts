import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleMixer } from '../toggleMixer';

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

describe('toggleMixer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleMixer();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('opens the mixer when it was closed', () => {
        mocks.getWorkspaceState.mockReturnValue({ mixerOpen: false });

        toggleMixer();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ mixerOpen: true });
    });

    it('closes the mixer when it was open', () => {
        mocks.getWorkspaceState.mockReturnValue({ mixerOpen: true });

        toggleMixer();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ mixerOpen: false });
    });
});
