import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeMarker } from '../removeMarker';

type MockMarker = { id: string };
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

describe('removeMarker', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes the specified marker', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'm1' }, { id: 'm2' }],
        };

        const removed = removeMarker('m1');

        expect(removed).toBe(true);
        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            markers: [{ id: 'm2' }],
        });
    });

    it('is a no-op when the marker store has not loaded', () => {
        mocks.markerStoreValue.value = null;

        const removed = removeMarker('m1');

        expect(removed).toBe(false);
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });

    it('is a no-op when the marker does not exist', () => {
        mocks.markerStoreValue.value = { markers: [{ id: 'm1' }] };

        const removed = removeMarker('missing');

        expect(removed).toBe(false);
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });
});
