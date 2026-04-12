import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rippleDeleteClips } from '../rippleDeleteClips';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackState: vi.fn(),
    planRippleDelete: vi.fn(),
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

vi.mock('../planRippleDelete', () => ({
    planRippleDelete: mocks.planRippleDelete,
}));

describe('rippleDeleteClips', () => {
    beforeEach(() => vi.clearAllMocks());

    it('executes the plan and updates state', () => {
        const mockPlan = {
            removedClips: [{ id: 'c1' }],
            shiftedClips: [],
            nextClips: [{ id: 'c2' }],
        };
        mocks.planRippleDelete.mockReturnValue(mockPlan);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1' }, { id: 'c2' }] }]
        });

        const result = rippleDeleteClips({ trackId: 't1', clipIds: ['c1'] });

        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const newState = mocks.setTrackState.mock.calls[0][0];
        expect(newState.tracks[0].clips).toEqual([{ id: 'c2' }]);
        expect(result).toEqual({ removedClips: [{ id: 'c1' }], shiftedClips: [] });
    });

    it('returns null if plan fails', () => {
        mocks.planRippleDelete.mockReturnValue(null);
        expect(rippleDeleteClips({ trackId: 't1', clipIds: [] })).toBeNull();
    });
});
