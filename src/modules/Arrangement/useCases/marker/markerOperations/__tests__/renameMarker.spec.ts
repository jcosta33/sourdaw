import { describe, it, expect, vi, beforeEach } from 'vitest';

import { renameMarker } from '../renameMarker';

type MockMarker = { id: string; name: string };
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

describe('renameMarker', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates marker name', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'm1', name: 'Old' }],
        };

        renameMarker('m1', 'New');

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            markers: [{ id: 'm1', name: 'New' }],
        });
    });

    it('updates only the targeted marker and leaves others untouched', () => {
        mocks.markerStoreValue.value = {
            markers: [
                { id: 'm1', name: 'Verse' },
                { id: 'm2', name: 'Chorus' },
            ],
        };

        renameMarker('m1', 'Bridge');

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            markers: [
                { id: 'm1', name: 'Bridge' },
                { id: 'm2', name: 'Chorus' },
            ],
        });
    });

    it('is a no-op when the marker store has not loaded', () => {
        mocks.markerStoreValue.value = null;

        renameMarker('m1', 'New');

        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
    });
});
