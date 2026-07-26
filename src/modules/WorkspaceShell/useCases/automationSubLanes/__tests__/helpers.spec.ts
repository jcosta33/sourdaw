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
import { setAutomationSubLanes } from '../helpers';

describe('setAutomationSubLanes', () => {
    beforeEach(() => {
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            automationSubLanes: {},
        });
        vi.mocked(updateWorkspaceState).mockClear();
    });

    it('writes the param ids for the given track, preserving other tracks', () => {
        vi.mocked(getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            automationSubLanes: { t2: ['existing'] },
        });

        setAutomationSubLanes('t1', ['gain', 'pan']);

        expect(updateWorkspaceState).toHaveBeenCalledWith({
            automationSubLanes: { t2: ['existing'], t1: ['gain', 'pan'] },
        });
    });

    it('is a no-op when workspace state is null (guard branch)', () => {
        vi.mocked(getWorkspaceState).mockReturnValue(null);

        setAutomationSubLanes('t1', ['gain']);

        expect(updateWorkspaceState).not.toHaveBeenCalled();
    });
});
