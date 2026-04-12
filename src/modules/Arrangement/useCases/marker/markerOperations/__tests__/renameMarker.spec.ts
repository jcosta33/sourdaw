import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renameMarker } from '../renameMarker';

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

describe('renameMarker', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates marker name', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'm1', name: 'Old' }]
        };

        renameMarker('m1', 'New');

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            markers: [{ id: 'm1', name: 'New' }]
        });
    });
});
