import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveAllTracks } from '../handleRemoveAllTracks';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    removeTrack: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: mocks.removeTrack,
}));

describe('handleRemoveAllTracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bails if track store state is unavailable', () => {
        mocks.getTrackStoreState.mockReturnValue(null);

        void handleRemoveAllTracks.execute({ type: 'removeAllTracks', payload: {} });

        expect(mocks.removeTrack).not.toHaveBeenCalled();
    });

    it('removes all tracks in the store', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1' }, { id: 't2' }],
        });

        void handleRemoveAllTracks.execute({ type: 'removeAllTracks', payload: {} });

        expect(mocks.removeTrack).toHaveBeenCalledTimes(2);
        expect(mocks.removeTrack).toHaveBeenCalledWith('t1');
        expect(mocks.removeTrack).toHaveBeenCalledWith('t2');
    });

    it('provides a description', () => {
        const desc = handleRemoveAllTracks.describe({ type: 'removeAllTracks', payload: {} });
        expect(desc.label).toBe('Remove all tracks');
    });

    it('is undoable', () => {
        expect(handleRemoveAllTracks.undoable).toBe(true);
    });
});
