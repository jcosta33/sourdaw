import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { acceptGhostClip } from '../acceptGhostClip';

import type { TrackStoreState } from '../../../stores/trackStore';

const mocks = vi.hoisted(() => ({
    state: { value: null as TrackStoreState | null },
    trackStoreSet: vi.fn<(state: TrackStoreState) => void>(),
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mocks.state.value;
        },
        set: mocks.trackStoreSet,
    },
}));

function createClip(input: { id: string; trackId: string; isGhost?: boolean }): Clip {
    return {
        id: input.id,
        trackId: input.trackId,
        name: input.id,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: 'blue',
        locked: false,
        muted: false,
        isGhost: input.isGhost,
    };
}

describe('acceptGhostClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = null;
        mocks.trackStoreSet.mockImplementation((state) => {
            mocks.state.value = state;
        });
    });

    it('should move ghost clip to track and remove from ghost list', () => {
        const ghost = createClip({ id: 'g1', trackId: 't1', isGhost: true });
        mocks.state.value = {
            tracks: [TrackDummy.create({ id: 't1', clips: [] })],
            selectedTrackId: null,
            ghostClips: [ghost],
        };

        expect(acceptGhostClip('g1')).toBe(true);

        expect(mocks.trackStoreSet).toHaveBeenCalledTimes(2);
        expect(mocks.state.value.tracks[0]?.clips).toEqual([{ ...ghost, isGhost: false }]);
        expect(mocks.state.value.ghostClips).toEqual([]);
    });

    it('should handle legacy ghost-flag acceptance', () => {
        const ghost = createClip({ id: 'c1', trackId: 't1', isGhost: true });
        mocks.state.value = {
            tracks: [TrackDummy.create({ id: 't1', clips: [ghost] })],
            selectedTrackId: null,
            ghostClips: [],
        };

        expect(acceptGhostClip('c1')).toBe(true);

        expect(mocks.trackStoreSet).toHaveBeenCalledOnce();
        expect(mocks.state.value.tracks[0]?.clips).toEqual([{ ...ghost, isGhost: false }]);
        expect(mocks.state.value.ghostClips).toEqual([]);
    });
});
