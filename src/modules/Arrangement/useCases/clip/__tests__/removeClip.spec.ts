import { describe, it, expect, vi, beforeEach } from 'vitest';
import { removeClip } from '../removeClip';

const mocks = vi.hoisted(() => ({
    mapAllTracks: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

describe('removeClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates to mapAllTracks with a filter function', () => {
        removeClip('c1');

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        const updater = mocks.mapAllTracks.mock.calls[0][0];

        const mockTrack = {
            clips: [
                { id: 'c1' },
                { id: 'c2' },
            ]
        };

        const updatedTrack = updater(mockTrack);
        expect(updatedTrack.clips).toEqual([{ id: 'c2' }]);
    });
});
