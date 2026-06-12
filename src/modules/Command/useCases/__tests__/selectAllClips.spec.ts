import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
    trackStoreValue: null as unknown,
}));

vi.mock('#/modules/Workspace/useCases/workspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

vi.mock('#/modules/Workspace/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/Workspace/useCases')>('#/modules/Workspace/useCases');
    return { ...actual, updateWorkspaceState: mocks.updateWorkspaceState };
});

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackStoreValue;
        },
    },
}));

import { selectAllClips } from '../selectAllClips';

describe('selectAllClips', () => {
    beforeEach(() => {
        mocks.trackStoreValue = null;
        mocks.updateWorkspaceState.mockReset();
    });

    it('collects all clip IDs and updates workspace state', () => {
        mocks.trackStoreValue = {
            tracks: [{ clips: [{ id: 'c1' }, { id: 'c2' }] }, { clips: [{ id: 'c3' }] }],
        };

        selectAllClips();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({
            selectedClipIds: ['c1', 'c2', 'c3'],
            selectedClipId: null,
        });
    });

    it('handles empty arrangement', () => {
        mocks.trackStoreValue = { tracks: [] };
        selectAllClips();
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({
            selectedClipIds: [],
            selectedClipId: null,
        });
    });
});
