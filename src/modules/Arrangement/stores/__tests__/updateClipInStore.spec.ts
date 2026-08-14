import { vi, describe, it, expect, expectTypeOf, beforeEach } from 'vitest';

vi.mock('../trackStore', () => {
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

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip, type Track } from '../../models/Track';
import { trackStore } from '../trackStore';
import { updateClipInStore } from '../updateClipInStore';

function setRuntimeKind(track: Track, kind: string): Track {
    Object.defineProperty(track, 'kind', { configurable: true, enumerable: true, value: kind });
    return track;
}

/**
 * F8 — this is the single source of truth for clip find-and-update logic
 * that `repositories/track/updateClip.ts` used to duplicate verbatim. That
 * repository function now delegates here, so this direct coverage is what
 * every one of its call sites (Arrangement, Knead, MIDI, Transport) relies
 * on transitively.
 */
describe('updateClipInStore', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('updates a single clip by id across all tracks, cloning only the containing track', () => {
        const clip = ClipDummy.create({ id: 'c1', trackId: 't1', name: 'Old' });
        const otherClip = ClipDummy.create({ id: 'c2', trackId: 't2', name: 'Untouched' });
        const track = TrackDummy.create({ id: 't1', clips: [clip] });
        const otherTrack = TrackDummy.create({ id: 't2', clips: [otherClip] });
        trackStore.set({ tracks: [track, otherTrack], selectedTrackId: null });
        vi.mocked(trackStore.set).mockClear();
        const updater = vi.fn((context: Clip) => ({ ...context, name: 'New' }));

        const didWrite = updateClipInStore('c1', updater);

        expectTypeOf<ReturnType<typeof updateClipInStore>>().toEqualTypeOf<boolean>();
        expectTypeOf(didWrite).toEqualTypeOf<boolean>();
        const nextState = trackStore.value!;
        const updatedTrack = nextState.tracks.find((candidate) => candidate.id === 't1')!;
        const unrelatedTrack = nextState.tracks.find((candidate) => candidate.id === 't2')!;
        expect(didWrite).toBe(true);
        expect(updater).toHaveBeenCalledTimes(1);
        expect(trackStore.set).toHaveBeenCalledTimes(1);
        expect(updatedTrack.clips[0]?.name).toBe('New');
        // The sibling track was cloned (new array reference from the state
        // spread) but its own clip content is untouched.
        expect(unrelatedTrack.clips[0]?.name).toBe('Untouched');
    });

    it('returns false without invoking the updater or store write when the clip is missing', () => {
        trackStore.set({ tracks: [TrackDummy.create({ id: 't1' })], selectedTrackId: null });
        vi.mocked(trackStore.set).mockClear();
        const updater = vi.fn((clip: Clip) => clip);

        expect(updateClipInStore('missing', updater)).toBe(false);
        expect(updater).not.toHaveBeenCalled();
        expect(trackStore.set).not.toHaveBeenCalled();
    });

    it('returns false without invoking the updater or store write for VCA-owned clips', () => {
        const clip = ClipDummy.create({ id: 'vca-clip', trackId: 'vca-1' });
        const vcaTrack = setRuntimeKind(TrackDummy.create({ id: 'vca-1', clips: [clip] }), 'vca');
        trackStore.set({ tracks: [vcaTrack], selectedTrackId: null });
        vi.mocked(trackStore.set).mockClear();
        const updater = vi.fn((context: Clip) => context);

        expect(updateClipInStore('vca-clip', updater)).toBe(false);
        expect(updater).not.toHaveBeenCalled();
        expect(trackStore.set).not.toHaveBeenCalled();
    });
});
