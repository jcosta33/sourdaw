import { describe, it, expect, vi } from 'vitest';

import { markerStore } from '../../stores/markerStore';
import { getMarkerState } from '../timelineQueries';

vi.mock('../../stores/markerStore', () => ({
    markerStore: {
        value: null,
        set: vi.fn(),
    },
}));

describe('getMarkerState', () => {
    it('returns the injected marker store value', () => {
        const state: MarkerStoreState = {
            markers: [],
            sections: [{ id: 's1', startBeat: 0, endBeat: 4, name: 'A', color: '#000' }],
        };
        markerStore.value = state;

        expect(getMarkerState()).toBe(state);
    });

    it('returns null when the store holds null', () => {
        markerStore.value = null;

        expect(getMarkerState()).toBeNull();
    });
});
