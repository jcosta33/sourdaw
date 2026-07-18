import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { setSoloMode } from '../setSoloMode';

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

describe('setSoloMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        setSoloMode('afl');

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('writes the solo mode when workspace state exists', () => {
        mocks.getWorkspaceState.mockReturnValue({});

        setSoloMode('afl');

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ soloMode: 'afl' });
    });
});
