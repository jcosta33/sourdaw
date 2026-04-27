import { describe, it, expect, vi, beforeEach } from 'vitest';

import { workspaceStore } from '#/modules/Workspace/stores';

import { removeClip } from '../../clip/removeClip';
import { cutSelectedClip } from '../cutSelectedClip';

vi.mock('#/modules/Workspace/stores', () => ({
    workspaceStore: { value: null },
}));

vi.mock('../../clip/removeClip', () => ({
    removeClip: vi.fn(),
}));

describe('cutSelectedClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns early when workspace is unavailable without calling removeClip', () => {
        workspaceStore.value = null;

        cutSelectedClip();

        expect(removeClip).not.toHaveBeenCalled();
    });
});
