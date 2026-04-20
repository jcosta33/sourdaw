import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setMarkerColor } from '../setMarkerColor';

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
});
