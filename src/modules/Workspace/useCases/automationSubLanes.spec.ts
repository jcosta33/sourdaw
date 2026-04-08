import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    setAutomationSubLanes,
    addAutomationSubLane,
    removeAutomationSubLane,
    swapAutomationSubLaneParam,
} from './automationSubLanes';
import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspace';
import { defaultWorkspaceState } from '../models/WorkspaceState';

vi.mock('../repositories/workspace', () => ({
    getWorkspaceState: vi.fn(),
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
        injectDependencies(setAutomationSubLanes, { getWorkspaceState, updateWorkspaceState });

        setAutomationSubLanes('t1', ['gain', 'pan']);

        expect(updateWorkspaceState).toHaveBeenCalledWith({
            automationSubLanes: { t1: ['gain', 'pan'] },
        });
    });

    it('should append a parameter id via addAutomationSubLane', () => {
        injectDependencies(addAutomationSubLane, { getWorkspaceState });

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
        injectDependencies(removeAutomationSubLane, { getWorkspaceState });

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
        injectDependencies(swapAutomationSubLaneParam, { getWorkspaceState });

        swapAutomationSubLaneParam('t1', 0, 'z');

        expect(updateWorkspaceState).toHaveBeenCalledWith({
            automationSubLanes: { t1: ['z', 'b'] },
        });
    });
});
