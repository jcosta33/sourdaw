import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addAutomationSubLane } from '../addAutomationSubLane';
import { removeAutomationSubLane } from '../removeAutomationSubLane';
import { swapAutomationSubLaneParam } from '../swapAutomationSubLaneParam';

const mocks = vi.hoisted(() => ({
    getWorkspaceState: vi.fn(),
    setAutomationSubLanes: vi.fn(),
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: mocks.getWorkspaceState,
}));
vi.mock('../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

vi.mock('../helpers', () => ({
    setAutomationSubLanes: mocks.setAutomationSubLanes,
}));

describe('Automation Sub-Lanes', () => {
    beforeEach(() => vi.clearAllMocks());

    it('addAutomationSubLane appends a new paramId', () => {
        mocks.getWorkspaceState.mockReturnValue({
            automationSubLanes: { t1: ['p1'] },
        });

        addAutomationSubLane('t1', 'p2');

        expect(mocks.setAutomationSubLanes).toHaveBeenCalledWith('t1', ['p1', 'p2']);
    });

    it('removeAutomationSubLane removes paramId at index', () => {
        mocks.getWorkspaceState.mockReturnValue({
            automationSubLanes: { t1: ['p1', 'p2', 'p3'] },
        });

        removeAutomationSubLane('t1', 1); // remove p2

        expect(mocks.setAutomationSubLanes).toHaveBeenCalledWith('t1', ['p1', 'p3']);
    });

    it('swapAutomationSubLaneParam updates paramId at index', () => {
        mocks.getWorkspaceState.mockReturnValue({
            automationSubLanes: { t1: ['p1', 'p2'] },
        });

        swapAutomationSubLaneParam('t1', 0, 'new-p1');

        expect(mocks.setAutomationSubLanes).toHaveBeenCalledWith('t1', ['new-p1', 'p2']);
    });
});
