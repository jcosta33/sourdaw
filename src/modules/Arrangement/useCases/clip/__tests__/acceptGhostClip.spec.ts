import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { acceptGhostClip } from '../acceptGhostClip';

import type { TrackStoreState } from '../../../stores/trackStore';

const mocks = vi.hoisted(() => ({
    appendClipToTrack: vi.fn<(trackId: string, clip: Clip) => boolean>(),
    state: { value: null as TrackStoreState | null },
    trackStoreSet: vi.fn<(state: TrackStoreState) => void>(),
    updateClipInStore: vi.fn<(clipId: string, updater: (clip: Clip) => Clip) => boolean>(),
}));

vi.mock('../../../stores/appendClipToTrack', () => ({
    appendClipToTrack: mocks.appendClipToTrack,
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mocks.state.value;
        },
        set: mocks.trackStoreSet,
    },
}));

vi.mock('../../../stores/updateClipInStore', () => ({
    updateClipInStore: mocks.updateClipInStore,
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
        color: '',
        locked: false,
        muted: false,
        isGhost: input.isGhost,
    };
}

describe('acceptGhostClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = null;
        mocks.appendClipToTrack.mockReturnValue(true);
        mocks.updateClipInStore.mockReturnValue(true);
    });

    it('returns false without publishing when the ghost insertion is rejected', () => {
        const ghost = createClip({ id: 'ghost-1', trackId: 'vca-1', isGhost: true });
        mocks.state.value = {
            tracks: [TrackDummy.create({ id: 'vca-1', clips: [] })],
            selectedTrackId: null,
            ghostClips: [ghost],
        };
        mocks.appendClipToTrack.mockReturnValue(false);

        expect(acceptGhostClip('ghost-1')).toBe(false);

        expect(mocks.appendClipToTrack).toHaveBeenCalledOnce();
        expect(mocks.trackStoreSet).not.toHaveBeenCalled();
        expect(mocks.state.value.ghostClips).toEqual([ghost]);
    });

    it('rejects duplicate matching ghosts without publishing or discarding either ghost', () => {
        const firstGhost = createClip({ id: 'ghost-1', trackId: 'track-1', isGhost: true });
        const secondGhost = createClip({ id: 'ghost-1', trackId: 'track-2', isGhost: true });
        const state: TrackStoreState = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [] }), TrackDummy.create({ id: 'track-2', clips: [] })],
            selectedTrackId: null,
            ghostClips: [firstGhost, secondGhost],
        };
        mocks.state.value = state;

        expect(acceptGhostClip('ghost-1')).toBe(false);

        expect(mocks.appendClipToTrack).not.toHaveBeenCalled();
        expect(mocks.updateClipInStore).not.toHaveBeenCalled();
        expect(mocks.trackStoreSet).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(state);
        expect(mocks.state.value.ghostClips).toEqual([firstGhost, secondGhost]);
    });

    it('rejects a matching ghost with an empty owner id without any write', () => {
        const ghost = createClip({ id: 'ghost-1', trackId: '', isGhost: true });
        const state: TrackStoreState = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [] })],
            selectedTrackId: null,
            ghostClips: [ghost],
        };
        mocks.state.value = state;

        expect(acceptGhostClip('ghost-1')).toBe(false);

        expect(mocks.appendClipToTrack).not.toHaveBeenCalled();
        expect(mocks.updateClipInStore).not.toHaveBeenCalled();
        expect(mocks.trackStoreSet).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(state);
    });

    it('returns false when the track store is empty', () => {
        expect(acceptGhostClip('ghost-1')).toBe(false);
        expect(mocks.appendClipToTrack).not.toHaveBeenCalled();
        expect(mocks.updateClipInStore).not.toHaveBeenCalled();
    });

    it('falls back to an empty ghost list when ghostClips is undefined', () => {
        // ghostClips omitted -> the ?? [] arm yields [] so no ghost matches,
        // routing through the legacy flag-clear gateway.
        const ghost = createClip({ id: 'ghost-1', trackId: 'track-1', isGhost: true });
        mocks.state.value = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [ghost] })],
            selectedTrackId: null,
        };

        expect(acceptGhostClip('ghost-1')).toBe(true);
        expect(mocks.updateClipInStore).toHaveBeenCalledWith('ghost-1', expect.any(Function));
    });

    it('rejects a ghost whose type is neither audio nor midi', () => {
        // Clip's type union is audio | midi at the type level, so the runtime
        // invalid-type guard is only reachable via a corrupted value.
        const ghost = createClip({ id: 'ghost-1', trackId: 'track-1', isGhost: true });
        Reflect.set(ghost, 'type', 'video');
        mocks.state.value = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [] })],
            selectedTrackId: null,
            ghostClips: [ghost],
        };

        expect(acceptGhostClip('ghost-1')).toBe(false);
        expect(mocks.appendClipToTrack).not.toHaveBeenCalled();
    });

    it('publishes a valid midi ghost clip', () => {
        const ghost = { ...createClip({ id: 'ghost-1', trackId: 'track-1', isGhost: true }), type: 'midi' as const };
        const state: TrackStoreState = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [] })],
            selectedTrackId: null,
            ghostClips: [ghost],
        };
        mocks.state.value = state;
        mocks.appendClipToTrack.mockImplementation(() => {
            mocks.state.value = state;
            return true;
        });

        expect(acceptGhostClip('ghost-1')).toBe(true);
        expect(mocks.appendClipToTrack).toHaveBeenCalledWith('track-1', { ...ghost, isGhost: false });
    });

    it('uses the clip-update gateway for legacy ghost flags and reports its result', () => {
        const ghost = createClip({ id: 'ghost-1', trackId: 'track-1', isGhost: true });
        mocks.state.value = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [ghost] })],
            selectedTrackId: null,
            ghostClips: [],
        };

        expect(acceptGhostClip('ghost-1')).toBe(true);

        expect(mocks.updateClipInStore).toHaveBeenCalledWith('ghost-1', expect.any(Function));
        const updater = mocks.updateClipInStore.mock.calls[0]?.[1];
        expect(updater?.(ghost)).toEqual({ ...ghost, isGhost: false });
        expect(mocks.trackStoreSet).not.toHaveBeenCalled();
    });

    it('publishes a valid ghost in the existing add-then-remove order', () => {
        const ghost = createClip({ id: 'ghost-1', trackId: 'track-1', isGhost: true });
        const state: TrackStoreState = {
            tracks: [TrackDummy.create({ id: 'track-1', clips: [] })],
            selectedTrackId: null,
            ghostClips: [ghost],
        };
        mocks.state.value = state;
        mocks.appendClipToTrack.mockImplementation(() => {
            mocks.state.value = state;
            return true;
        });

        expect(acceptGhostClip('ghost-1')).toBe(true);

        expect(mocks.appendClipToTrack).toHaveBeenCalledWith('track-1', { ...ghost, isGhost: false });
        expect(mocks.appendClipToTrack.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.trackStoreSet.mock.invocationCallOrder[0] ?? Infinity
        );
        expect(mocks.trackStoreSet).toHaveBeenCalledWith({ ...state, ghostClips: [] });
    });
});
