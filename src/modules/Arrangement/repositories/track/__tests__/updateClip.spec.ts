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
import { updateClip } from '../updateClip';

function setRuntimeKind(track: Track, kind: string): Track {
    Object.defineProperty(track, 'kind', { configurable: true, enumerable: true, value: kind });
    return track;
}

describe('updateClip', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should update a single clip by id across all tracks', () => {
        const clip = ClipDummy.create({ id: 'c1', trackId: 't1', name: 'Old' });
        const track = TrackDummy.create({ id: 't1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: null });
        vi.mocked(trackStore.set).mockClear();
        const updater = vi.fn((context: Clip) => ({ ...context, name: 'New' }));

        const didWrite = updateClip('c1', updater);

        const storedClip = trackStore.value!.tracks[0]?.clips[0];
        if (!storedClip) {
            throw new Error('expected stored clip');
        }
        expect(didWrite).toBe(true);
        expect(updater).toHaveBeenCalledTimes(1);
        expect(trackStore.set).toHaveBeenCalledTimes(1);
        expect(storedClip.name).toBe('New');
    });

    it('returns false without invoking the updater or store write when the clip is missing', () => {
        trackStore.set({ tracks: [TrackDummy.create({ id: 't1' })], selectedTrackId: null });
        vi.mocked(trackStore.set).mockClear();
        const updater = vi.fn((clip: Clip) => clip);

        expect(updateClip('missing', updater)).toBe(false);
        expect(updater).not.toHaveBeenCalled();
        expect(trackStore.set).not.toHaveBeenCalled();
    });

    it('returns false without invoking the updater or store write for VCA-owned clips', () => {
        const clip = ClipDummy.create({ id: 'vca-clip', trackId: 'vca-1' });
        const vcaTrack = setRuntimeKind(TrackDummy.create({ id: 'vca-1', clips: [clip] }), 'vca');
        trackStore.set({ tracks: [vcaTrack], selectedTrackId: null });
        vi.mocked(trackStore.set).mockClear();
        const updater = vi.fn((context: Clip) => context);

        expect(updateClip('vca-clip', updater)).toBe(false);
        expect(updater).not.toHaveBeenCalled();
        expect(trackStore.set).not.toHaveBeenCalled();
    });
});
