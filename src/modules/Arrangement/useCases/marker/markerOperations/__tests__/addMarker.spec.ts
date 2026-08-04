import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addMarker } from '../addMarker';

import type { MarkerStoreState } from '../../../../stores/markerStore';

const mocks = vi.hoisted(() => {
    const markerStoreValue: { value: { markers: unknown[] } | null } = { value: { markers: [] } };
    return {
        markerStoreValue,
        markerStoreSet: vi.fn<(...args: unknown[]) => void>(),
    };
});

vi.mock('../../../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return mocks.markerStoreValue.value;
        },
        set: mocks.markerStoreSet,
    },
}));

describe('addMarker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.markerStoreValue.value = { markers: [] };
    });

    it('adds a marker to the store', () => {
        const didWrite = addMarker(16, 'Drop');

        expect(didWrite).toBe(true);
        expect(mocks.markerStoreSet).toHaveBeenCalledTimes(1);
        const newState = mocks.markerStoreSet.mock.calls[0]![0] as MarkerStoreState;
        expect(newState.markers).toHaveLength(1);
        expect(newState.markers[0]).toMatchObject({
            beat: 16,
            name: 'Drop',
        });
    });

    it('bails if marker store is unavailable', () => {
        mocks.markerStoreValue.value = null;
        const didWrite = addMarker(0, 'X');

        expect(didWrite).toBe(false);
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });
});
