import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setMarkerColor } from '../setMarkerColor';

type MockMarker = { id: string; color: string };
type MarkerHolder = { value: { markers: MockMarker[] } | null };

const mocks = vi.hoisted(() => {
    const holder: MarkerHolder = { value: { markers: [] } };
    return {
        markerStoreValue: holder,
        markerStoreSet: vi.fn(),
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

describe('setMarkerColor', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates marker color', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'm1', color: '#000' }],
        };

        setMarkerColor('m1', '#fff');

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            markers: [{ id: 'm1', color: '#fff' }],
        });
    });

    it('is a no-op when the marker store has not loaded', () => {
        mocks.markerStoreValue.value = null;

        setMarkerColor('m1', '#fff');

        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });
});
