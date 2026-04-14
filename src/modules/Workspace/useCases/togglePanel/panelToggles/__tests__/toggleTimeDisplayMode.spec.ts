import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleTimeDisplayMode } from '../toggleTimeDisplayMode';

const mocks = vi.hoisted(() => ({
    getWorkspaceState: vi.fn(),
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/workspace', () => ({
    getWorkspaceState: mocks.getWorkspaceState,
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
        mocks.getWorkspaceState.mockReturnValue({ timeDisplayMode: 'musical' } as any);

        toggleTimeDisplayMode();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ timeDisplayMode: 'time' });
    });
});
