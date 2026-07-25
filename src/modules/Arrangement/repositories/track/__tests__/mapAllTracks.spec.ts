import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../stores/trackStore', () => {
    const internal = {
        value: { tracks: [], selectedTrackId: null } as { tracks: unknown[]; selectedTrackId: string | null } | null,
    };
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

        const [first, second] = trackStore.value!.tracks;
        if (!first || !second) {
            throw new Error('expected two tracks in store');
        }
        expect(first.name).toBe('A!');
        expect(second.name).toBe('B!');
    });

    it('should be a no-op when the store has not initialised', () => {
        trackStore.set(null);

        mapAllTracks((time) => ({ ...time, name: 'changed' }));

        expect(trackStore.value).toBeNull();
    });
});
