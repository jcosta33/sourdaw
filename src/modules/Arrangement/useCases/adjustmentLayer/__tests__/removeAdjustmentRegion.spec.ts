import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeAdjustmentRegion } from '../removeAdjustmentRegion';

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

describe('removeAdjustmentRegion', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes region from the specified layer', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', regions: [{ id: 'r1' }, { id: 'r2' }] }],
        } as any;

        removeAdjustmentRegion('l1', 'r1');

        expect(mocks.adjustmentLayerStoreSet).toHaveBeenCalledWith({
            layers: [{ id: 'l1', regions: [{ id: 'r2' }] }],
        });
    });
});
