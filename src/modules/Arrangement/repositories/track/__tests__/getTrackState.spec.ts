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
import { getTrackState } from '../getTrackState';

describe('getTrackState', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should return the whole track store state', () => {
        const state = { tracks: [], selectedTrackId: 't1' };
        trackStore.set(state as { tracks: []; selectedTrackId: string });
        expect(getTrackState()).toEqual(state);
    });
});
