import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setLayerInsertionIndex } from '../setLayerInsertionIndex';

const mocks = vi.hoisted(() => {
    const adjustmentLayerStoreValue: { value: { layers: unknown[] } | null } = { value: { layers: [] } };
    return {
        adjustmentLayerStoreValue,
        adjustmentLayerStoreSet: vi.fn(),
    };
});

vi.mock('#/modules/Arrangement/stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.adjustmentLayerStoreValue.value;
        },
        set: mocks.adjustmentLayerStoreSet,
    },
}));

describe('setLayerInsertionIndex', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates insertionIndex and floors negatives to zero', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                { id: 'l1', insertionIndex: 0 },
                { id: 'l2', insertionIndex: 2 },
            ],
        };

        setLayerInsertionIndex('l2', -3);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        const layers = setCall[0].layers as Array<{ insertionIndex: number }>;
        expect(layers[1]?.insertionIndex).toBe(0);
    });

    it('floors fractional indices', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', insertionIndex: 0 }],
        };

        setLayerInsertionIndex('l1', 2.9);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        const layer = (setCall[0].layers as Array<{ insertionIndex: number }>)[0];
        expect(layer?.insertionIndex).toBe(2);
    });

    it('is a no-op when the store has not loaded', () => {
        mocks.adjustmentLayerStoreValue.value = null;

        setLayerInsertionIndex('l1', 2);

        expect(mocks.adjustmentLayerStoreSet).not.toHaveBeenCalled();
    });
});
