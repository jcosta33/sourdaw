import { describe, it, expect, vi } from 'vitest';

import { getMarkerState } from '../timelineQueries';

import type { MarkerStoreState } from '../../stores/markerStore';

const mocks = vi.hoisted(() => ({
    markerStoreValue: { value: null as MarkerStoreState | null },
}));

vi.mock('../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return mocks.markerStoreValue.value;
        },
        set: vi.fn(),
    },
}));

describe('getMarkerState', () => {
    it('returns the injected marker store value', () => {
        const state: MarkerStoreState = {
            markers: [],
            sections: [{ id: 's1', startBeat: 0, endBeat: 4, name: 'A', color: '#000' }],
        };
        mocks.markerStoreValue.value = state;

        expect(getMarkerState()).toBe(state);
    });

    it('returns null when the store holds null', () => {
        mocks.markerStoreValue.value = null;

        expect(getMarkerState()).toBeNull();
    });
});
