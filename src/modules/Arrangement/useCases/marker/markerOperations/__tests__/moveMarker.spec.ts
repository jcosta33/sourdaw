import { describe, it, expect, vi, beforeEach } from 'vitest';

import { moveMarker } from '../moveMarker';

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

describe('moveMarker', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates marker beat and rounds to nearest integer', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'm1', beat: 0 }],
        };

        moveMarker('m1', 4.7);

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            markers: [{ id: 'm1', beat: 5 }],
        });
    });

    it('claps beat to 0', () => {
        mocks.markerStoreValue.value = {
            markers: [{ id: 'm1', beat: 10 }],
        };

        moveMarker('m1', -5);

        expect(mocks.markerStoreSet).toHaveBeenCalledWith({
            markers: [{ id: 'm1', beat: 0 }],
        });
    });
});
