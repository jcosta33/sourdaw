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

        expect(plan?.shiftedClips).toEqual([{ clipId: 'c3', origStartBeat: 10, origEndBeat: 14 }]);
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
});
