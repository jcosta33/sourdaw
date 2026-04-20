import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeMarker } from '../removeMarker';

const mocks = vi.hoisted(() => ({
    markerStoreValue: { value: { markers: [] } },
    markerStoreSet: vi.fn(),
}));

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

        removeMarker('m1');

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            markers: [{ id: 'm2' }],
        });
    });
});
