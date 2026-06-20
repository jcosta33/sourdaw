import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultWorkspaceState } from '../../models/WorkspaceState';
import { getWorkspaceState } from '../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../repositories/updateWorkspaceState';
import { addAutomationSubLane } from '../automationSubLanes/addAutomationSubLane';
import { setAutomationSubLanes } from '../automationSubLanes/helpers';
import { removeAutomationSubLane } from '../automationSubLanes/removeAutomationSubLane';
import { swapAutomationSubLaneParam } from '../automationSubLanes/swapAutomationSubLaneParam';

vi.mock('../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: vi.fn(),
}));
vi.mock('../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: vi.fn(),
}));

describe('automationSubLanes injectables', () => {
    beforeEach(() => {
        vi.mocked(updateWorkspaceState).mockClear();
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            automationSubLanes: {},
        });
    });

    it('should merge automation sub-lanes for a track', () => {
        setAutomationSubLanes('t1', ['gain', 'pan']);

        expect(updateWorkspaceState).toHaveBeenCalledWith({
            automationSubLanes: { t1: ['gain', 'pan'] },
        });
    });

    it('should append a parameter id via addAutomationSubLane', () => {
        addAutomationSubLane('t1', 'cutoff');

        expect(updateWorkspaceState).toHaveBeenCalledWith({
            automationSubLanes: { t1: ['cutoff'] },
        });
    });

    it('should remove a lane index via removeAutomationSubLane', () => {
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            automationSubLanes: { t1: ['a', 'b', 'c'] },
        });

        removeAutomationSubLane('t1', 1);

        expect(updateWorkspaceState).toHaveBeenCalledWith({
            automationSubLanes: { t1: ['a', 'c'] },
        });
    });

    it('should swap a parameter at an index via swapAutomationSubLaneParam', () => {
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            automationSubLanes: { t1: ['a', 'b'] },
        });

        swapAutomationSubLaneParam('t1', 0, 'z');

        expect(updateWorkspaceState).toHaveBeenCalledWith({
            automationSubLanes: { t1: ['z', 'b'] },
        });
    });
});
