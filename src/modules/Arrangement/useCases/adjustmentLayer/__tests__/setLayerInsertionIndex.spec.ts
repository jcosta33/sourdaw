import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setLayerInsertionIndex } from '../setLayerInsertionIndex';

const mocks = vi.hoisted(() => ({
    adjustmentLayerStoreValue: { value: { layers: [] } },
    adjustmentLayerStoreSet: vi.fn(),
}));

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
        } as any;

        setLayerInsertionIndex('l2', -3);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        const layers = setCall[0].layers;
        expect(layers[1].insertionIndex).toBe(0);
    });

    it('floors fractional indices', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', insertionIndex: 0 }],
        } as any;

        setLayerInsertionIndex('l1', 2.9);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        expect(setCall[0].layers[0].insertionIndex).toBe(2);
    });
});
