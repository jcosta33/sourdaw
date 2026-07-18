import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleInspector } from '../toggleInspector';

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

describe('toggleInspector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleInspector();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('opens the inspector when it was closed', () => {
        mocks.getWorkspaceState.mockReturnValue({ inspectorOpen: false });

        toggleInspector();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ inspectorOpen: true });
    });

    it('closes the inspector when it was open', () => {
        mocks.getWorkspaceState.mockReturnValue({ inspectorOpen: true });

        toggleInspector();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ inspectorOpen: false });
    });
});
