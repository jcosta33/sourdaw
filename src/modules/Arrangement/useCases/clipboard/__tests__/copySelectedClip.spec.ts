import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getWorkspaceState } from '#/modules/Workspace/useCases';

import { copySelectedClip } from '../copySelectedClip';

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
