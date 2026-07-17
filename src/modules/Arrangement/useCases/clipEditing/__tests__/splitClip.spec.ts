import { describe, it, expect, vi, beforeEach } from 'vitest';

import { splitClip } from '../splitClip';

import type { Clip, Track } from '#/modules/Arrangement/models/Track';
import type { getNextClipId as originalGetNextClipId } from '#/modules/Arrangement/repositories/clipIdCounter';
import type { getTrackState as originalGetTrackState } from '#/modules/Arrangement/repositories/track/getTrackState';
import type { setTrackState as originalSetTrackState } from '#/modules/Arrangement/repositories/track/setTrackState';
import type { snapToZeroCrossing as originalSnapToZeroCrossing } from '../../timelineInteractions/snapToZeroCrossing';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<typeof originalGetTrackState>(),
    setTrackState: vi.fn<typeof originalSetTrackState>(),
    getNextClipId: vi.fn<typeof originalGetNextClipId>(() => 'new-clip-id'),
    snapToZeroCrossing: vi.fn<typeof originalSnapToZeroCrossing>((_clip, splitBeat) => splitBeat),
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

vi.mock('../../timelineInteractions/snapToZeroCrossing', () => ({
    snapToZeroCrossing: mocks.snapToZeroCrossing,
}));

describe('splitClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('splits a clip into two at the specified beat', () => {
        const mockClip = {
            id: 'c1',
            name: 'Vocal',
            startBeat: 0,
            endBeat: 10,
            fadeOutBeats: 1,
        } as Partial<Clip> as Clip;
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: null,
            tracks: [{ id: 't1', clips: [mockClip] } as Partial<Track> as Track],
        });

        const rightId = splitClip('c1', 4);
        expect(rightId).toBe('new-clip-id');

        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const setCall = mocks.setTrackState.mock.calls[0];
        if (!setCall) {
            throw new Error('expected setTrackState to have been called');
        }
        const newState = setCall[0];
        const track = newState.tracks[0]!;

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
        const mockClip = { id: 'c1', startBeat: 4, endBeat: 8 } as Partial<Clip> as Clip;
        mocks.getTrackState.mockReturnValue({
            selectedTrackId: null,
            tracks: [{ id: 't1', clips: [mockClip] } as Partial<Track> as Track],
        });

        expect(splitClip('c1', 2)).toBeNull(); // Before
        expect(splitClip('c1', 9)).toBeNull(); // After

        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });
});
