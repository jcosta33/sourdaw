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
import { setTrackState } from '../setTrackState';

describe('setTrackState', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('should set the whole track store state', () => {
        const state = { tracks: [], selectedTrackId: 't1' };
        setTrackState(state as { tracks: []; selectedTrackId: string });
        expect(trackStore.set).toHaveBeenCalledWith(state);
        expect(trackStore.value).toEqual(state);
    });
});
