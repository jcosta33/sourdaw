import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { toggleTimeDisplayMode } from '../toggleTimeDisplayMode';

const mocks = vi.hoisted(() => ({
    getWorkspaceState: vi.fn<() => WorkspaceState | null>(),
    updateWorkspaceState: vi.fn<typeof import('../../../../repositories/updateWorkspaceState').updateWorkspaceState>(),
}));

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: mocks.getWorkspaceState,
}));
vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

describe('toggleTimeDisplayMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should not update workspace when state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        toggleTimeDisplayMode();

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('should toggle musical display to time', () => {
        mocks.getWorkspaceState.mockReturnValue({ timeDisplayMode: 'musical' } as WorkspaceState);

        toggleTimeDisplayMode();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ timeDisplayMode: 'time' });
    });

    it('should toggle time display back to musical', () => {
        mocks.getWorkspaceState.mockReturnValue({ timeDisplayMode: 'time' } as WorkspaceState);

        toggleTimeDisplayMode();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ timeDisplayMode: 'musical' });
    });
});
