import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getWorkspaceState } from '#/modules/Workspace/useCases';

import { getTrackStoreState } from '../../getTrackStoreState';
import { planRippleInsert } from '../planRippleInsert';

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Workspace/useCases', () => ({
    getWorkspaceState: vi.fn(),
}));

describe('planRippleInsert', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null if ripple editing is disabled', () => {
        (getWorkspaceState as any).mockReturnValue({ rippleEditing: false });
        expect(planRippleInsert({ trackId: 't1', insertBeat: 0, insertDuration: 1 })).toBeNull();
    });

    it('should return shifted clips forward in time from insert point', () => {
        (getWorkspaceState as any).mockReturnValue({ rippleEditing: true });
        (getTrackStoreState as any).mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 2 },
                        { id: 'c2', startBeat: 2, endBeat: 4 },
                        { id: 'c3', startBeat: 5, endBeat: 6 },
                    ],
                },
            ],
        });

        const plan = planRippleInsert({ trackId: 't1', insertBeat: 2, insertDuration: 1 });
        expect(plan?.shiftedClips.length).toBe(2);
        expect(plan?.shiftedClips.map((state) => state.clipId)).toEqual(['c2', 'c3']);
    });

    it('should return empty shifted clips if insertion point is at end', () => {
        (getWorkspaceState as any).mockReturnValue({ rippleEditing: true });
        (getTrackStoreState as any).mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', startBeat: 0, endBeat: 2 }],
                },
            ],
        });

        const plan = planRippleInsert({ trackId: 't1', insertBeat: 4, insertDuration: 1 });
        expect(plan?.shiftedClips.length).toBe(0);
    });
});
