import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addMarker } from '../addMarker';

const mocks = vi.hoisted(() => ({
    markerStoreValue: { value: { markers: [] } },
    markerStoreSet: vi.fn(),
}));

vi.mock('../../../../stores/markerStore', () => ({
    markerStore: {
        get value() { return mocks.markerStoreValue.value; },
        set: mocks.markerStoreSet,
    }
}));

describe('addMarker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.markerStoreValue.value = { markers: [] };
    });

    it('adds a marker to the store', () => {
        addMarker(16, 'Drop');

        expect(mocks.markerStoreSet).toHaveBeenCalledTimes(1);
        const newState = mocks.markerStoreSet.mock.calls[0][0];
        expect(newState.markers).toHaveLength(1);
        expect(newState.markers[0]).toMatchObject({
            beat: 16,
            name: 'Drop',
        });
    });

    it('bails if marker store is unavailable', () => {
        mocks.markerStoreValue.value = null;
        addMarker(0, 'X');
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });
});
