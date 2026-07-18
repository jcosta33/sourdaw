import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleRippleEditing } from '../rippleEditing';

const mocks = vi.hoisted(() => ({
    workspaceStoreValue: { value: { rippleEditing: false } as { rippleEditing: boolean } | null },
    workspaceStoreSet: vi.fn(),
}));

vi.mock('../../stores/workspaceStore', () => ({
    workspaceStore: {
        get value() {
            return mocks.workspaceStoreValue.value;
        },
        set: mocks.workspaceStoreSet,
    },
}));

describe('toggleRippleEditing', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns early if workspaceStore is null', () => {
        mocks.workspaceStoreValue.value = null;
        toggleRippleEditing();
        expect(mocks.workspaceStoreSet).not.toHaveBeenCalled();
    });

    it('toggles ripple editing state', () => {
        mocks.workspaceStoreValue.value = { rippleEditing: false };
        toggleRippleEditing();
        expect(mocks.workspaceStoreSet).toHaveBeenCalledWith(expect.objectContaining({ rippleEditing: true }));

        mocks.workspaceStoreValue.value = { rippleEditing: true };
        toggleRippleEditing();
        expect(mocks.workspaceStoreSet).toHaveBeenLastCalledWith(expect.objectContaining({ rippleEditing: false }));
    }, 15000);
});

describe('Initialization Regression', () => {
    it('can import Workspace through an Arrangement consumer without initialization failure', async () => {
        const arrangement = await import('#/modules/Arrangement/useCases');
        const workspace = await import('#/modules/WorkspaceShell/useCases');
        expect(arrangement).toBeDefined();
        expect(workspace).toBeDefined();
    }, 60000);
});
