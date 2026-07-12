import { describe, it, expect, vi, beforeEach } from 'vitest';

import { crossfadeClips } from '../crossfadeClips';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    mapAllTracks: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/mapAllTracks', () => ({ mapAllTracks: mocks.mapAllTracks }));

describe('crossfadeClips', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does nothing with no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        crossfadeClips('a', 'b');
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('processes crossfade with valid clips', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'a', startBeat: 0, endBeat: 4, type: 'audio' },
                        { id: 'b', startBeat: 3.5, endBeat: 8, type: 'audio' },
                    ],
                },
            ],
            selectedTrackId: 't1',
        } as never);
        expect(() => crossfadeClips('a', 'b', 0.5)).not.toThrow();
    });

    it('handles missing clips gracefully', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [] }],
            selectedTrackId: 't1',
        } as never);
        expect(() => crossfadeClips('missing-a', 'missing-b')).not.toThrow();
    });
});
