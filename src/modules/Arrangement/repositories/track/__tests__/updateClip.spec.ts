import { vi, describe, it, expect, expectTypeOf, beforeEach } from 'vitest';

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

// F8 — `updateClip` is now a pure delegate to `stores/updateClipInStore.ts`
// (see that file's own spec for the write-target/clamp behaviour coverage).
// Spy on the real implementation (still called through, so the behavioural
// tests below stay meaningful) to prove this file's only line is actually
// reached, rather than re-testing `updateClipInStore`'s internals a second
// time under a different name.
vi.mock('../../../stores/updateClipInStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/updateClipInStore')>();
    return { updateClipInStore: vi.fn(actual.updateClipInStore) };
});

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip, type Track } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { updateClipInStore } from '../../../stores/updateClipInStore';
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

        expectTypeOf<ReturnType<typeof updateClip>>().toEqualTypeOf<boolean>();
        expectTypeOf(didWrite).toEqualTypeOf<boolean>();
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

    it('delegates to stores/updateClipInStore with the same clipId, updater, and return value (F8)', () => {
        // Proves `updateClip.ts` is reached and forwards its arguments, rather
        // than exercising `updateClipInStore`'s own write logic (that behaviour
        // is covered by `stores/__tests__/updateClipInStore.spec.ts`). Deleting
        // `updateClip.ts`'s delegation line leaves every other test in this
        // file green — this is the only one guarding it.
        const clip = ClipDummy.create({ id: 'c1', trackId: 't1', name: 'Old' });
        const track = TrackDummy.create({ id: 't1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: null });
        vi.mocked(updateClipInStore).mockClear();
        const updater = vi.fn((context: Clip) => ({ ...context, name: 'New' }));

        const result = updateClip('c1', updater);

        expect(updateClipInStore).toHaveBeenCalledTimes(1);
        expect(updateClipInStore).toHaveBeenCalledWith('c1', updater);
        expect(updateClipInStore).toHaveReturnedWith(result);
    });
});
