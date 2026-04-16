import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleRippleEditing } from '../rippleEditing';

const mocks = vi.hoisted(() => ({
    workspaceStoreValue: { value: { rippleEditing: false } },
    workspaceStoreSet: vi.fn(),
}));

vi.mock('../../stores/workspaceStore', () => ({
    workspaceStore: {
        get value() { return mocks.workspaceStoreValue.value; },
        set: mocks.workspaceStoreSet,
    }
}));

describe('toggleRippleEditing', () => {
    beforeEach(() => vi.clearAllMocks());

    it('toggles ripple editing state', () => {
        mocks.workspaceStoreValue.value = { rippleEditing: false } as any;
        toggleRippleEditing();
        expect(mocks.workspaceStoreSet).toHaveBeenCalledWith(expect.objectContaining({ rippleEditing: true }));

        mocks.workspaceStoreValue.value = { rippleEditing: true } as any;
        toggleRippleEditing();
        expect(mocks.workspaceStoreSet).toHaveBeenLastCalledWith(expect.objectContaining({ rippleEditing: false }));
    }, 15000);
});

describe('Initialization Regression', () => {
    it('can import Workspace through an Arrangement consumer without initialization failure', async () => {
        const arrangement = await import('#/modules/Arrangement/useCases');
        const workspace = await import('#/modules/Workspace/useCases');
        expect(arrangement).toBeDefined();
        expect(workspace).toBeDefined();
    }, 15000);
});
