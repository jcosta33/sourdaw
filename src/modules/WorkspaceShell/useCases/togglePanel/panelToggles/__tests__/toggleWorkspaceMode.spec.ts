import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleWorkspaceMode } from '../toggleWorkspaceMode';

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

describe('toggleWorkspaceMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleWorkspaceMode();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('switches arrange mode to clip', () => {
        mocks.getWorkspaceState.mockReturnValue({ mode: 'arrange' });

        toggleWorkspaceMode();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ mode: 'clip' });
    });

    it('switches a non-arrange mode back to arrange', () => {
        mocks.getWorkspaceState.mockReturnValue({ mode: 'clip' });

        toggleWorkspaceMode();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ mode: 'arrange' });
    });
});
