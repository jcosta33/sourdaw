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
import { updateClip } from '../updateClip';

describe('updateClip', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should update a single clip by id across all tracks', () => {
        const clip = ClipDummy.create({ id: 'c1', name: 'Old' });
        const track = TrackDummy.create({ id: 't1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: null });

        updateClip('c1', (context) => ({ ...context, name: 'New' }));

        const storedClip = trackStore.value!.tracks[0]?.clips[0];
        if (!storedClip) {
            throw new Error('expected stored clip');
        }
        expect(storedClip.name).toBe('New');
    });
});
