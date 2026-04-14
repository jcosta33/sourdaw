import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../stores/trackStore', () => {
    const internal = { value: { tracks: [], selectedTrackId: null } };
    return {
        trackStore: {
            get value() {
                return internal.value;
            },
            set: vi.fn((v) => {
                internal.value = v;
            }),
            update: vi.fn((cb) => {
                internal.value = cb(internal.value);
            }),
        },
    };
});

import { trackStore } from '../../../stores/trackStore';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { ClipDummy } from '../../../__tests__/ClipDummy';
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

        updateClip('c1', (c) => ({ ...c, name: 'New' }));

        expect(trackStore.value!.tracks[0].clips[0].name).toBe('New');
    });
});
