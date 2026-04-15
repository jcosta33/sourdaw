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
import { mapAllTracks } from '../mapAllTracks';

describe('mapAllTracks', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should update all tracks via the mapper function', () => {
        const tracks = [TrackDummy.create({ id: 't1', name: 'A' }), TrackDummy.create({ id: 't2', name: 'B' })];
        trackStore.set({ tracks, selectedTrackId: null });

        mapAllTracks((t) => ({ ...t, name: `${t.name}!` }));

        expect(trackStore.value!.tracks[0].name).toBe('A!');
        expect(trackStore.value!.tracks[1].name).toBe('B!');
    });
});
