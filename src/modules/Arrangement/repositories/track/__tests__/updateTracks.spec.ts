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
import { updateTracks } from '../updateTracks';

describe('updateTracks', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should update tracks matching a predicate', () => {
        const tracks = [TrackDummy.create({ id: 't1', muted: false }), TrackDummy.create({ id: 't2', muted: false })];
        trackStore.set({ tracks, selectedTrackId: null });

        updateTracks((t) => t.id === 't1', (t) => ({ ...t, muted: true }));

        expect(trackStore.value!.tracks[0].muted).toBe(true);
        expect(trackStore.value!.tracks[1].muted).toBe(false);
    });
});
