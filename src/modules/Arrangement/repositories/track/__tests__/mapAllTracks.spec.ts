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

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { mapAllTracks } from '../mapAllTracks';

describe('mapAllTracks', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should update all tracks via the mapper function', () => {
        const tracks = [TrackDummy.create({ id: 't1', name: 'A' }), TrackDummy.create({ id: 't2', name: 'B' })];
        trackStore.set({ tracks, selectedTrackId: null });

        mapAllTracks((time) => ({ ...time, name: `${time.name}!` }));

        expect(trackStore.value!.tracks[0].name).toBe('A!');
        expect(trackStore.value!.tracks[1].name).toBe('B!');
    });
});
