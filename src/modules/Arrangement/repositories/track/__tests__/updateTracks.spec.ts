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
import { updateTracks } from '../updateTracks';

describe('updateTracks', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should update tracks matching a predicate', () => {
        const tracks = [TrackDummy.create({ id: 't1', muted: false }), TrackDummy.create({ id: 't2', muted: false })];
        trackStore.set({ tracks, selectedTrackId: null });

        updateTracks(
            (time) => time.id === 't1',
            (time) => ({ ...time, muted: true })
        );

        const [first, second] = trackStore.value!.tracks;
        if (!first || !second) {
            throw new Error('expected two tracks in store');
        }
        expect(first.muted).toBe(true);
        expect(second.muted).toBe(false);
    });

    it('should be a no-op when the store has not initialised', () => {
        trackStore.set(null);

        updateTracks(
            () => true,
            (time) => ({ ...time, muted: true })
        );

        expect(trackStore.value).toBeNull();
    });
});
