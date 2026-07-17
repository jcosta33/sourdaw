import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
}));

vi.mock('../../../../repositories/updateWorkspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

import { selectClipWithFocus } from '../selectClipWithFocus';

describe('selectClipWithFocus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('makes the clip the sole focused selection', () => {
        selectClipWithFocus('clip-1');

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-1'],
        });
    });
});
