import { describe, it, expect, vi } from 'vitest';
import { getTrackStoreState } from '../getTrackStoreState';
import { trackStore } from '../../stores/trackStore';

vi.mock('../../stores/trackStore', () => ({
    trackStore: {
        value: null,
        set: vi.fn(),
    },
}));

describe('getTrackStoreState', () => {
    it('returns injected store value', () => {
        const snapshot = { tracks: [], selectedTrackId: null } as any;
        trackStore.value = snapshot;
        expect(getTrackStoreState()).toBe(snapshot);
    });
});
