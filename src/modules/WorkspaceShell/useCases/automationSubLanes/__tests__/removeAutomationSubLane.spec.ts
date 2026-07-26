import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: vi.fn(),
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: vi.fn(),
}));

import { defaultWorkspaceState } from '../../../models/WorkspaceState';
import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';
import { removeAutomationSubLane } from '../removeAutomationSubLane';

describe('removeAutomationSubLane', () => {
    beforeEach(() => {
        vi.mocked(updateWorkspaceState).mockClear();
    });

    it('removes the lane at the given index, keeping the rest in order', () => {
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            automationSubLanes: { t1: ['a', 'b', 'c'] },
        });

        removeAutomationSubLane('t1', 1);

        expect(updateWorkspaceState).toHaveBeenCalledWith({
            automationSubLanes: { t1: ['a', 'c'] },
        });
    });

    it('defaults to an empty list when the track has no lanes yet', () => {
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            automationSubLanes: {},
        });

        // Removing index 0 from a non-existent list → empty list (no throw).
        removeAutomationSubLane('t1', 0);

        expect(updateWorkspaceState).toHaveBeenCalledWith({
            automationSubLanes: { t1: [] },
        });
    });

    it('is a no-op when workspace state is null (guard branch)', () => {
        vi.mocked(getWorkspaceState).mockReturnValue(null);

        removeAutomationSubLane('t1', 0);

        expect(updateWorkspaceState).not.toHaveBeenCalled();
    });
});
