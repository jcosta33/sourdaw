import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getWorkspaceState } from '#/modules/Workspace/useCases';

import { removeClip } from '../../clip/removeClip';
import { cutSelectedClip } from '../cutSelectedClip';

vi.mock('#/modules/Workspace/useCases', () => ({
    getWorkspaceState: vi.fn(),
}));

vi.mock('../../clip/removeClip', () => ({
    removeClip: vi.fn(),
}));

describe('cutSelectedClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns early when workspace is unavailable without calling removeClip', () => {
        vi.mocked(getWorkspaceState).mockReturnValue(null as never);

        cutSelectedClip();

        expect(removeClip).not.toHaveBeenCalled();
    });
});
