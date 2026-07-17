import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { closeScratchPad } from '../closeScratchPad';

describe('closeScratchPad', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('closes the scratch pad', () => {
        closeScratchPad();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ scratchPadOpen: false });
    });
});
