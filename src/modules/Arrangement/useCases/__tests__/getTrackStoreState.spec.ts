import { describe, it, expect, vi } from 'vitest';

import { type TrackStoreState } from '../../stores/trackStore';
import { trackStore } from '../../stores/trackStore';
import { getTrackStoreState } from '../getTrackStoreState';

vi.mock('../../stores/trackStore', () => ({
    trackStore: {
        value: null,
        set: vi.fn(),
    },
}));

describe('getTrackStoreState', () => {
    it('returns injected store value', () => {
        const snapshot: TrackStoreState = { tracks: [], selectedTrackId: null };
        trackStore.value = snapshot;
        expect(getTrackStoreState()).toBe(snapshot);
    });
});
