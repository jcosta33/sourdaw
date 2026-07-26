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
import { swapAutomationSubLaneParam } from '../swapAutomationSubLaneParam';

describe('swapAutomationSubLaneParam', () => {
    beforeEach(() => {
        vi.mocked(updateWorkspaceState).mockClear();
    });

    it('replaces the param id at the given index', () => {
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            automationSubLanes: { t1: ['gain', 'pan'] },
        });

        swapAutomationSubLaneParam('t1', 1, 'cutoff');

        expect(updateWorkspaceState).toHaveBeenCalledWith({
            automationSubLanes: { t1: ['gain', 'cutoff'] },
        });
    });

    it('does not mutate the existing lane list in place', () => {
        const original = ['gain', 'pan'];
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            automationSubLanes: { t1: original },
        });

        swapAutomationSubLaneParam('t1', 0, 'cutoff');

        // The source array must be copied, not mutated in place.
        expect(original).toEqual(['gain', 'pan']);
    });

    it('defaults to an empty list when the track has no lanes yet', () => {
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            automationSubLanes: {},
        });

        // Swapping index 0 on a non-existent list creates [newParamId].
        swapAutomationSubLaneParam('t1', 0, 'cutoff');

        expect(updateWorkspaceState).toHaveBeenCalledWith({
            automationSubLanes: { t1: ['cutoff'] },
        });
    });

    it('is a no-op when workspace state is null (guard branch)', () => {
        vi.mocked(getWorkspaceState).mockReturnValue(null);

        swapAutomationSubLaneParam('t1', 0, 'cutoff');

        expect(updateWorkspaceState).not.toHaveBeenCalled();
    });
});
