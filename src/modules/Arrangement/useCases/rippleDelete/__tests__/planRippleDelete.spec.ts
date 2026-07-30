import { describe, it, expect, vi, beforeEach } from 'vitest';

import { planRippleDelete } from '../planRippleDelete';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    workspaceStore: { value: null as { rippleEditing?: boolean } | null },
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: mocks.workspaceStore,
}));

describe('planRippleDelete', () => {
    beforeEach(() => vi.clearAllMocks());

    it('plans a simple delete without ripple if disabled', () => {
        const mockClips = [
            { id: 'c1', startBeat: 0, endBeat: 4 },
            { id: 'c2', startBeat: 4, endBeat: 8 },
            { id: 'c3', startBeat: 8, endBeat: 12 },
        ];
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: mockClips }],
        });
        mocks.workspaceStore.value = { rippleEditing: false };

        const plan = planRippleDelete({ trackId: 't1', clipIds: ['c2'] });

        expect(plan?.removedClips).toEqual([{ id: 'c2', startBeat: 4, endBeat: 8 }]);
        expect(plan?.shiftedClips).toHaveLength(0);
        expect(plan?.nextClips).toEqual([
            { id: 'c1', startBeat: 0, endBeat: 4 },
            { id: 'c3', startBeat: 8, endBeat: 12 },
        ]);
    });

    it('plans a ripple delete if enabled', () => {
        const mockClips = [
            { id: 'c1', startBeat: 0, endBeat: 4 },
            { id: 'c2', startBeat: 4, endBeat: 8 },
            { id: 'c3', startBeat: 10, endBeat: 14 },
        ];
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: mockClips }],
        });
        mocks.workspaceStore.value = { rippleEditing: true };

        // Gap = c2 end (8) - c2 start (4) = 4.
        const plan = planRippleDelete({ trackId: 't1', clipIds: ['c2'] });

        expect(plan?.shiftedClips).toEqual([{ clipId: 'c3', origStartBeat: 10, origEndBeat: 14, automationDelta: -4 }]);
        expect(plan?.nextClips[1]).toMatchObject({
            id: 'c3',
            startBeat: 6, // 10 - 4
            endBeat: 10, // 14 - 4
        });
    });

    it('bails if track or clips not found', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        expect(planRippleDelete({ trackId: 't1', clipIds: ['c1'] })).toBeNull();
    });

    it('bails when the track store is empty', () => {
        mocks.getTrackStoreState.mockReturnValue(null);
        expect(planRippleDelete({ trackId: 't1', clipIds: ['c1'] })).toBeNull();
    });

    it('bails when none of the requested clip ids exist on the track', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
        });
        mocks.workspaceStore.value = { rippleEditing: true };
        expect(planRippleDelete({ trackId: 't1', clipIds: ['nope'] })).toBeNull();
    });

    it('defaults ripple to off when the workspace store is empty', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 4 },
                        { id: 'c2', startBeat: 4, endBeat: 8 },
                        { id: 'c3', startBeat: 8, endBeat: 12 },
                    ],
                },
            ],
        });
        mocks.workspaceStore.value = null;

        const plan = planRippleDelete({ trackId: 't1', clipIds: ['c2'] });

        // Ripple falls back to off, so c3 is not shifted.
        expect(plan?.shiftedClips).toHaveLength(0);
    });

    it('computes the delete span across multiple removed clips in any order', () => {
        // Removed clips given out of beat order exercise both arms of the
        // min/max span accumulators (startBeat >= deleteStart, endBeat <= deleteEnd).
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 2 },
                        { id: 'c2', startBeat: 4, endBeat: 6 },
                        { id: 'c3', startBeat: 8, endBeat: 10 },
                        { id: 'c4', startBeat: 12, endBeat: 14 },
                    ],
                },
            ],
        });
        mocks.workspaceStore.value = { rippleEditing: true };

        // Remove c3 (8-10) and c1 (0-2): span is [0,10), gap=10. c4 shifts by 10.
        const plan = planRippleDelete({ trackId: 't1', clipIds: ['c3', 'c1'] });

        expect(plan?.removedClips.map((clip) => clip.id).sort()).toEqual(['c1', 'c3']);
        expect(plan?.shiftedClips).toEqual([
            { clipId: 'c4', origStartBeat: 12, origEndBeat: 14, automationDelta: -10 },
        ]);
        const shifted = plan?.nextClips.find((clip) => clip.id === 'c4');
        expect(shifted).toMatchObject({ startBeat: 2, endBeat: 4 });
        // c2 lies before deleteEnd (10) so it stays put.
        const kept = plan?.nextClips.find((clip) => clip.id === 'c2');
        expect(kept).toMatchObject({ startBeat: 4, endBeat: 6 });
    });
});
