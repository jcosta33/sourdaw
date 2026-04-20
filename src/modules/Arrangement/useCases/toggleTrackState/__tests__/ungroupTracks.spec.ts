import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ungroupTracks } from '../ungroupTracks';

const mocks = vi.hoisted(() => ({
    mapAllTracks: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

describe('ungroupTracks', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should clear groupId only for tracks in that group', () => {
        ungroupTracks('g1');

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);

        const mapper = mocks.mapAllTracks.mock.calls[0]![0] as (t: { id: string; groupId: string | null }) => {
            id: string;
            groupId: string | null;
        };

        expect(mapper({ id: 'a', groupId: 'g1' })).toEqual({ id: 'a', groupId: null });
        expect(mapper({ id: 'b', groupId: 'g2' })).toEqual({ id: 'b', groupId: 'g2' });
    });
});
