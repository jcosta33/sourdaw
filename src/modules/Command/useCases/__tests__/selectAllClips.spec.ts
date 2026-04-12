import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectAllClips } from '../selectAllClips';

const mocks = vi.hoisted(() => ({
    updateWorkspaceState: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Workspace/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    updateWorkspaceState: mocks.updateWorkspaceState,
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('selectAllClips', () => {
    beforeEach(() => vi.clearAllMocks());

    it('collects all clip IDs and updates workspace state', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { clips: [{ id: 'c1' }, { id: 'c2' }] },
                { clips: [{ id: 'c3' }] }
            ]
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
