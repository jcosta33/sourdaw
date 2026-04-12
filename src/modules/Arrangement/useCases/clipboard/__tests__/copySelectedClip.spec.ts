import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copySelectedClip } from '../copySelectedClip';
import { getWorkspaceState } from '#/modules/Workspace/useCases';

vi.mock('#/modules/Workspace/useCases', () => ({
    getWorkspaceState: vi.fn(),
}));

describe('copySelectedClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns early when workspace is unavailable', () => {
        vi.mocked(getWorkspaceState).mockReturnValue(null as never);

        expect(() => {
            copySelectedClip();
        }).not.toThrow();
    });
});
