import { describe, it, expect, vi, beforeEach } from 'vitest';

import { reorderTrack } from '../reorderTrack';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrackState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrackState', () => ({
    updateTrackState: mocks.updateTrackState,
}));

describe('reorderTrack', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reorders tracks by moving a track to a new index', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
        });

        // Move t1 to index 1 (between t2 and t3)
        reorderTrack('t1', 1);

        expect(mocks.updateTrackState).toHaveBeenCalledWith({
            tracks: [{ id: 't2' }, { id: 't1' }, { id: 't3' }],
        });
    });

    it('moves track to the end if newIndex is high', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1' }, { id: 't2' }],
        });

        reorderTrack('t1', 10);

        expect(mocks.updateTrackState).toHaveBeenCalledWith({
            tracks: [{ id: 't2' }, { id: 't1' }],
        });
    });

    it('bails if track not found', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1' }] });
        reorderTrack('missing', 0);
        expect(mocks.updateTrackState).not.toHaveBeenCalled();
    });
});
