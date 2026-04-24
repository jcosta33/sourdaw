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
import { getTrackById } from '../getTrackById';

describe('getTrackById', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should return the track with the given ID', () => {
        const t1 = TrackDummy.create({ id: 't1' });
        const tracks = [t1, TrackDummy.create({ id: 't2' })];
        trackStore.set({ tracks, selectedTrackId: null });
        expect(getTrackById('t1')).toEqual(t1);
    });

    it('should return undefined if track is not found', () => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        expect(getTrackById('non-existent')).toBeUndefined();
    });
});
