import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeAdjustmentLayer } from '../removeAdjustmentLayer';

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

describe('removeAdjustmentLayer', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes the specified layer', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1' }, { id: 'l2' }],
        };

        removeAdjustmentLayer('l1');

        expect(mocks.adjustmentLayerStoreSet).toHaveBeenCalledWith({
            layers: [{ id: 'l2' }],
        });
    });

    it('is a no-op when the store has not loaded', () => {
        mocks.adjustmentLayerStoreValue.value = null;

        removeAdjustmentLayer('l1');

        expect(mocks.adjustmentLayerStoreSet).not.toHaveBeenCalled();
    });
});
