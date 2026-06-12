import { describe, it, expect, vi, beforeEach } from 'vitest';

import { workspaceStore } from '#/modules/Workspace/stores';

import { copySelectedClip } from '../copySelectedClip';

vi.mock('#/modules/Workspace/stores', () => ({
    workspaceStore: { value: null },
}));

describe('copySelectedClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns early when workspace is unavailable', () => {
        workspaceStore.value = null;

        expect(() => {
            copySelectedClip();
        }).not.toThrow();
    });
});
