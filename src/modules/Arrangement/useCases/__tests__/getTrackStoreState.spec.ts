import { describe, it, expect, vi } from 'vitest';

import { type TrackStoreState } from '../../stores/trackStore';
import { getTrackStoreState } from '../getTrackStoreState';

const storeMock = vi.hoisted(() => ({
    state: null as TrackStoreState | null,
}));

vi.mock('../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return storeMock.state;
        },
        set: vi.fn(),
    },
}));

describe('getTrackStoreState', () => {
    it('returns injected store value', () => {
        const snapshot: TrackStoreState = { tracks: [], selectedTrackId: null };
        storeMock.state = snapshot;
        expect(getTrackStoreState()).toBe(snapshot);
    });
});
