import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Workspace/useCases/workspaceState', () => ({
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

vi.mock('#/modules/Workspace/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/Workspace/useCases')>(
        '#/modules/Workspace/useCases'
    );
    return { ...actual, updateWorkspaceState: mocks.updateWorkspaceState };
});

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/Arrangement/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/Arrangement/useCases')>(
        '#/modules/Arrangement/useCases'
    );
    return { ...actual, getTrackStoreState: mocks.getTrackStoreState };
});

import { selectAllClips } from '../selectAllClips';

describe('selectAllClips', () => {
    beforeEach(() => vi.clearAllMocks());

    it('collects all clip IDs and updates workspace state', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { clips: [{ id: 'c1' }, { id: 'c2' }] },
                { clips: [{ id: 'c3' }] },
            ],
        });

        selectAllClips();

        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({
            selectedClipIds: ['c1', 'c2', 'c3'],
            selectedClipId: null,
        });
    });

    it('handles empty arrangement', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        selectAllClips();
        expect(mocks.updateWorkspaceState).toHaveBeenCalledWith({
            selectedClipIds: [],
            selectedClipId: null,
        });
    });
});
