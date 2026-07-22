import { describe, it, expect, vi, beforeEach } from 'vitest';

import { rippleDeleteClips } from '../rippleDeleteClips';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackState: vi.fn(),
    planRippleDelete: vi.fn(),
    shiftClipAutomation: vi.fn<(clipId: string, delta: number) => void>(),
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

vi.mock('#/modules/Automation/useCases', () => ({
    shiftClipAutomation: mocks.shiftClipAutomation,
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
            tracks: [{ id: 't1', clips: [{ id: 'c1' }, { id: 'c2' }] }],
        });

        const result = rippleDeleteClips({ trackId: 't1', clipIds: ['c1'] });

        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const setCall = mocks.setTrackState.mock.calls[0];
        if (!setCall) {
            throw new Error('expected setTrackState to be called');
        }
        const newState = setCall[0];
        expect(newState.tracks[0].clips).toEqual([{ id: 'c2' }]);
        expect(result).toEqual({ removedClips: [{ id: 'c1' }], shiftedClips: [] });
    });

    it('shifts collateral clips automation by the ripple delta (regression: ledger M-025)', () => {
        const mockPlan = {
            removedClips: [{ id: 'c1' }],
            shiftedClips: [{ clipId: 'c2', origStartBeat: 8, origEndBeat: 10 }],
            nextClips: [{ id: 'c2', startBeat: 4, endBeat: 6 }],
        };
        mocks.planRippleDelete.mockReturnValue(mockPlan);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1' }, { id: 'c2' }] }],
        });

        rippleDeleteClips({ trackId: 't1', clipIds: ['c1'] });

        // The collateral clip moved 8 -> 4: its timeline-absolute automation
        // must follow by -4. Clip-relative MIDI notes follow on their own.
        expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c2', -4);
        expect(mocks.shiftClipAutomation).toHaveBeenCalledTimes(1);
    });

    it('returns null if plan fails', () => {
        mocks.planRippleDelete.mockReturnValue(null);
        expect(rippleDeleteClips({ trackId: 't1', clipIds: [] })).toBeNull();
    });
});
