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
import { getAllTracks } from '../getAllTracks';

describe('getAllTracks', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should return all tracks from the store', () => {
        const tracks = [TrackDummy.create({ id: 't1' })];
        trackStore.set({ tracks, selectedTrackId: null });
        expect(getAllTracks()).toEqual(tracks);
    });

    it('should return an empty array when the store has not initialised', () => {
        trackStore.set(null);
        expect(getAllTracks()).toEqual([]);
    });
});
