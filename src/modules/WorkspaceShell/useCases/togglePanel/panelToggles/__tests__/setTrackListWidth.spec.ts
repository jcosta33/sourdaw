import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { setTrackListWidth } from '../setTrackListWidth';

describe('setTrackListWidth', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes the track-list width', () => {
        setTrackListWidth(300);

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({ trackListWidth: 300 });
    });
});
