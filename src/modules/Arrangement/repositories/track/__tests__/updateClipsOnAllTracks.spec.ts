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
import { trackStore } from '../../../stores/trackStore';
import { updateClipsOnAllTracks } from '../updateClipsOnAllTracks';

describe('updateClipsOnAllTracks', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should update all clips across all tracks', () => {
        const c1 = ClipDummy.create({ id: 'c1', muted: false });
        const c2 = ClipDummy.create({ id: 'c2', muted: false });
        const t1 = TrackDummy.create({ id: 't1', clips: [c1] });
        const t2 = TrackDummy.create({ id: 't2', clips: [c2] });
        trackStore.set({ tracks: [t1, t2], selectedTrackId: null });

        updateClipsOnAllTracks((context) => ({ ...context, muted: true }));

        const clip1 = trackStore.value!.tracks[0]?.clips[0];
        const clip2 = trackStore.value!.tracks[1]?.clips[0];
        if (!clip1 || !clip2) {
            throw new Error('expected stored clips');
        }
        expect(clip1.muted).toBe(true);
        expect(clip2.muted).toBe(true);
    });
});
