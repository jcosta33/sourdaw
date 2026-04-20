import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeAdjustmentLayer } from '../removeAdjustmentLayer';

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

describe('removeAdjustmentLayer', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes the specified layer', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1' }, { id: 'l2' }],
        } as any;

        removeAdjustmentLayer('l1');

        expect(mocks.adjustmentLayerStoreSet).toHaveBeenCalledWith({
            layers: [{ id: 'l2' }],
        });
    });
});
