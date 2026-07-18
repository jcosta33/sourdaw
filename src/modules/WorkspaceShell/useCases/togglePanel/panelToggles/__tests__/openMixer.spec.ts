import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { openMixer } from '../openMixer';

describe('openMixer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens the mixer', () => {
        openMixer();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ mixerOpen: true });
    });
});
