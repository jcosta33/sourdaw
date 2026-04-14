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
import { updateTrack } from '../updateTrack';

describe('updateTrack', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should update a specific track by ID', () => {
        const t1 = TrackDummy.create({ id: 't1', name: 'Old' });
        trackStore.set({ tracks: [t1], selectedTrackId: null });

        updateTrack('t1', (t) => ({ ...t, name: 'New' }));

        expect(trackStore.value!.tracks[0].name).toBe('New');
    });
});
