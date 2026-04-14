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
import { updateTrackState } from '../updateTrackState';

describe('updateTrackState', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should partially update the track store state', () => {
        trackStore.set({ tracks: [], selectedTrackId: 'old' });
        updateTrackState({ selectedTrackId: 'new' });
        expect(trackStore.value!.selectedTrackId).toBe('new');
    });
});
