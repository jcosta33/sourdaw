import { describe, it, expect, vi, beforeEach } from 'vitest';
import { planRippleMove } from '../planRippleMove';
import { getTrackStoreState } from '../../getTrackStoreState';
import { getWorkspaceState } from '#/modules/Workspace/useCases';

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Workspace/useCases', () => ({
    getWorkspaceState: vi.fn(),
}));

describe('planRippleMove', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null if ripple editing is disabled', () => {
        (getWorkspaceState as any).mockReturnValue({ rippleEditing: false });
        expect(planRippleMove({ trackId: 't1', clipId: 'c1', oldStartBeat: 0, newStartBeat: 2, clipDuration: 2 })).toBeNull();
    });

    it('should identify gap-closed and destination-opened clips', () => {
        (getWorkspaceState as any).mockReturnValue({ rippleEditing: true });
        (getTrackStoreState as any).mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 2 },
                        { id: 'c2', startBeat: 2, endBeat: 4 },
                        { id: 'c3', startBeat: 10, endBeat: 12 },
                        { id: 'c4', startBeat: 12, endBeat: 14 },
                    ],
                },
            ],
        });

        // Move c1 from 0 to 8. Duration is 2.
        // Old end was 2. c2 is at 2. Gap closed: c2.
        // New start is 8. c3 is at 10. Destination opened: c3, c4.
        const plan = planRippleMove({
            trackId: 't1',
            clipId: 'c1',
            oldStartBeat: 0,
            newStartBeat: 8,
            clipDuration: 2,
        });

        expect(plan?.gapClosedClips.map(s => s.clipId)).toEqual(['c2', 'c3', 'c4']);
        expect(plan?.destinationOpenedClips.map(s => s.clipId)).toEqual(['c3', 'c4']);
    });
});
