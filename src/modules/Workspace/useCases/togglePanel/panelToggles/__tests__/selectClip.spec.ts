import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { selectClip } from '../selectClip';

describe('selectClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sets the given clip as the focused clip', () => {
        selectClip('clip-1');

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ selectedClipId: 'clip-1' });
    });
});
