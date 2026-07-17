import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type WorkspaceState } from '../../../../models/WorkspaceState';
import { setSnapValue } from '../setSnapValue';

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

describe('setSnapValue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not update when workspace state is missing', () => {
        mocks.getWorkspaceState.mockReturnValue(null);

        setSnapValue(0.25);

        expect(mocks.updateWorkspaceState).not.toHaveBeenCalled();
    });

    it('writes the snap value when workspace state exists', () => {
        mocks.getWorkspaceState.mockReturnValue({});

        setSnapValue(0.25);

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ snapValue: 0.25 });
    });
});
