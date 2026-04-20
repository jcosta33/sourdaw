import { describe, it, expect, vi, beforeEach } from 'vitest';

import { groupTracks } from '../groupTracks';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    mapAllTracks: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

describe('groupTracks', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should not map tracks when there is no track state', () => {
        mocks.getTrackState.mockReturnValue(null);

        groupTracks(['a', 'b'], 'My Group');

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('should assign the same group id to listed tracks only', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null } as any);

        groupTracks(['a'], 'My Group');

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);

        const mapper = mocks.mapAllTracks.mock.calls[0]![0] as (t: { id: string; groupId: string | null }) => {
            id: string;
            groupId: string | null;
        };

        const inGroup = mapper({ id: 'a', groupId: null });
        const outGroup = mapper({ id: 'b', groupId: null });

        expect(inGroup.id).toBe('a');
        expect(inGroup.groupId).toMatch(/^group-\d+$/);

        expect(outGroup).toEqual({ id: 'b', groupId: null });
    });
});
