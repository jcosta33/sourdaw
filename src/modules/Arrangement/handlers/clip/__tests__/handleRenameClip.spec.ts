import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRenameClip } from '../handleRenameClip';

const mocks = vi.hoisted(() => ({
    renameClip: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; clips: { id: string; name: string }[] }[] } | null>(),
}));

vi.mock('../../../useCases/clipEditing/renameClip', () => ({
    renameClip: mocks.renameClip,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleRenameClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('delegates to renameClip use case', () => {
        void handleRenameClip.execute({
            type: 'renameClip',
            payload: { clipId: 'c1', name: 'New Name' },
        });
        expect(mocks.renameClip).toHaveBeenCalledWith('c1', 'New Name');
    });

    it('describes an inverse restoring the previous name', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', name: 'Old Name' }] }],
        });

        const desc = handleRenameClip.describe({
            type: 'renameClip',
            payload: { clipId: 'c1', name: 'New Name' },
        });

        expect(desc.label).toBe('Rename clip to "New Name"');
        expect(desc.inverseAction).toEqual({
            type: 'renameClip',
            payload: { clipId: 'c1', name: 'Old Name' },
        });
    });

    it('describes a null inverse when the clip is not found', () => {
        const desc = handleRenameClip.describe({
            type: 'renameClip',
            payload: { clipId: 'missing', name: 'New Name' },
        });

        expect(desc.inverseAction).toBeNull();
    });
});
