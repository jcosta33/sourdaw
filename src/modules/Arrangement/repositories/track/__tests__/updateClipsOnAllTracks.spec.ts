import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../stores/trackStore', () => {
    const internal = { value: { tracks: [], selectedTrackId: null } };
    return {
        trackStore: {
            get value() {
                return internal.value;
            },
            set: vi.fn((value) => {
                internal.value = value;
            }),
            update: vi.fn((cb) => {
                internal.value = cb(internal.value);
            }),
        },
    };
});

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip, type Track } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { updateClipsOnAllTracks } from '../updateClipsOnAllTracks';

function setRuntimeKind(track: Track, kind: string): Track {
    Object.defineProperty(track, 'kind', { configurable: true, enumerable: true, value: kind });
    return track;
}

describe('updateClipsOnAllTracks', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should update all clips across all tracks', () => {
        const c1 = ClipDummy.create({ id: 'c1', trackId: 't1', muted: false });
        const c2 = ClipDummy.create({ id: 'c2', trackId: 't2', muted: false });
        const t1 = TrackDummy.create({ id: 't1', clips: [c1] });
        const t2 = TrackDummy.create({ id: 't2', clips: [c2] });
        trackStore.set({ tracks: [t1, t2], selectedTrackId: null });
        vi.mocked(trackStore.set).mockClear();
        const mapper = vi.fn((context: Clip) => ({ ...context, muted: true }));

        const didWrite = updateClipsOnAllTracks(mapper);

        const clip1 = trackStore.value!.tracks[0]?.clips[0];
        const clip2 = trackStore.value!.tracks[1]?.clips[0];
        if (!clip1 || !clip2) {
            throw new Error('expected stored clips');
        }
        expect(didWrite).toBe(true);
        expect(mapper).toHaveBeenCalledTimes(2);
        expect(trackStore.set).toHaveBeenCalledTimes(1);
        expect(clip1.muted).toBe(true);
        expect(clip2.muted).toBe(true);
    });

    it('maps only eligible clips and retains an ineligible track by identity', () => {
        const eligibleClip = ClipDummy.create({ id: 'eligible-clip', trackId: 'track-1', muted: false });
        const ineligibleClip = ClipDummy.create({ id: 'ineligible-clip', trackId: 'vca-1', muted: false });
        const eligibleTrack = TrackDummy.create({ id: 'track-1', clips: [eligibleClip] });
        const vcaTrack = setRuntimeKind(TrackDummy.create({ id: 'vca-1', clips: [ineligibleClip] }), 'vca');
        trackStore.set({ tracks: [eligibleTrack, vcaTrack], selectedTrackId: null });
        vi.mocked(trackStore.set).mockClear();
        const mapper = vi.fn((clip: Clip) => ({ ...clip, muted: true }));

        expect(updateClipsOnAllTracks(mapper)).toBe(true);

        expect(mapper).toHaveBeenCalledTimes(1);
        expect(mapper).toHaveBeenCalledWith(eligibleClip);
        expect(trackStore.set).toHaveBeenCalledTimes(1);
        expect(trackStore.value!.tracks[0]?.clips[0]?.muted).toBe(true);
        expect(trackStore.value!.tracks[1]).toBe(vcaTrack);
        expect(trackStore.value!.tracks[1]?.clips[0]).toBe(ineligibleClip);
    });

    it('returns false without mapper invocation or store publication when no eligible clip exists', () => {
        const clip = ClipDummy.create({ id: 'vca-clip', trackId: 'vca-1' });
        const vcaTrack = setRuntimeKind(TrackDummy.create({ id: 'vca-1', clips: [clip] }), 'vca');
        trackStore.set({ tracks: [vcaTrack], selectedTrackId: null });
        vi.mocked(trackStore.set).mockClear();
        const mapper = vi.fn((context: Clip) => context);

        expect(updateClipsOnAllTracks(mapper)).toBe(false);
        expect(mapper).not.toHaveBeenCalled();
        expect(trackStore.set).not.toHaveBeenCalled();
    });
});
