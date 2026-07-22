import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleRippleEditing } from '../rippleEditing';

const mocks = vi.hoisted(() => {
    const workspaceStoreValue: { value: { rippleEditing: boolean } | null } = { value: { rippleEditing: false } };
    return { workspaceStoreValue, workspaceStoreSet: vi.fn() };
});

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
