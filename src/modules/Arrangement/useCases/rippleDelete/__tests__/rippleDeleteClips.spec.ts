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
            shiftedClips: [{ clipId: 'c2', origStartBeat: 8, origEndBeat: 10, automationDelta: -4 }],
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

    it('returns null and writes nothing when the track store has not loaded', () => {
        mocks.planRippleDelete.mockReturnValue({
            removedClips: [{ id: 'c1' }],
            shiftedClips: [],
            nextClips: [{ id: 'c2' }],
        });
        mocks.getTrackStoreState.mockReturnValue(null);

        const result = rippleDeleteClips({ trackId: 't1', clipIds: ['c1'] });

        expect(result).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('skips a shifted clip whose id is missing from the next-clips set', () => {
        const mockPlan = {
            removedClips: [{ id: 'c1' }],
            // shifted clip references c2, but nextClips only has c3 → no next
            shiftedClips: [{ clipId: 'c2', origStartBeat: 8, origEndBeat: 10, automationDelta: -4 }],
            nextClips: [{ id: 'c3', startBeat: 0, endBeat: 4 }],
        };
        mocks.planRippleDelete.mockReturnValue(mockPlan);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1' }, { id: 'c3' }] }],
        });

        rippleDeleteClips({ trackId: 't1', clipIds: ['c1'] });

        // c2 is not in nextClips → continue, no shift attempted
        expect(mocks.shiftClipAutomation).not.toHaveBeenCalled();
    });

    it('does not shift automation when the ripple delta is zero', () => {
        const mockPlan = {
            removedClips: [{ id: 'c1' }],
            // next clip starts at the same beat as before → delta 0
            shiftedClips: [{ clipId: 'c2', origStartBeat: 4, origEndBeat: 8, automationDelta: 0 }],
            nextClips: [{ id: 'c2', startBeat: 4, endBeat: 8 }],
        };
        mocks.planRippleDelete.mockReturnValue(mockPlan);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1' }, { id: 'c2' }] }],
        });

        rippleDeleteClips({ trackId: 't1', clipIds: ['c1'] });

        expect(mocks.shiftClipAutomation).not.toHaveBeenCalled();
    });

    it('leaves unrelated tracks untouched while applying the plan to the target track', () => {
        const mockPlan = {
            removedClips: [{ id: 'c1' }],
            shiftedClips: [],
            nextClips: [{ id: 'c2' }],
        };
        mocks.planRippleDelete.mockReturnValue(mockPlan);
        const otherTrack = { id: 'other', clips: [{ id: 'keep' }] };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1' }, { id: 'c2' }] }, otherTrack],
        });

        rippleDeleteClips({ trackId: 't1', clipIds: ['c1'] });

        const setCall = mocks.setTrackState.mock.calls[0];
        if (!setCall) {
            throw new Error('expected setTrackState to be called');
        }
        // The non-target track is returned by reference, unchanged.
        expect(setCall[0].tracks[1]).toBe(otherTrack);
    });
});
