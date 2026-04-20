import { describe, it, expect, vi, beforeEach } from 'vitest';

import { splitClip } from '../splitClip';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    setTrackState: vi.fn(),
    getNextClipId: vi.fn(() => 'new-clip-id'),
    snapSplitBeatToZeroCrossing: vi.fn((c, b) => b),
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/track/setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/clipIdCounter', () => ({
    getNextClipId: mocks.getNextClipId,
}));

vi.mock('#/modules/Arrangement/services/snapSplitBeatToZeroCrossing', () => ({
    snapSplitBeatToZeroCrossing: mocks.snapSplitBeatToZeroCrossing,
}));

describe('splitClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('splits a clip into two at the specified beat', () => {
        const mockClip = { id: 'c1', name: 'Vocal', startBeat: 0, endBeat: 10, fadeOutBeats: 1 };
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [mockClip] }],
        });

        const rightId = splitClip('c1', 4);
        expect(rightId).toBe('new-clip-id');

        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const newState = mocks.setTrackState.mock.calls[0][0];
        const track = newState.tracks[0];

        expect(track.clips).toHaveLength(2);

        // Left clip
        expect(track.clips[0]).toMatchObject({
            id: 'c1',
            endBeat: 4,
            name: 'Vocal (L)',
            fadeOutBeats: 0,
        });

        // Right clip
        expect(track.clips[1]).toMatchObject({
            id: 'new-clip-id',
            startBeat: 4,
            endBeat: 10,
            name: 'Vocal (R)',
            fadeInBeats: 0,
            fadeOutBeats: 1,
            audioOffsetBeats: 4,
        });
    });

    it('bails if split beat is outside clip boundaries', () => {
        const mockClip = { id: 'c1', startBeat: 4, endBeat: 8 };
        mocks.getTrackState.mockReturnValue({ tracks: [{ clips: [mockClip] }] });

        expect(splitClip('c1', 2)).toBeNull(); // Before
        expect(splitClip('c1', 9)).toBeNull(); // After

        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });
});
