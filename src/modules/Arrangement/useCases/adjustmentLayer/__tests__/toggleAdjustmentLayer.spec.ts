import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleAdjustmentLayer } from '../toggleAdjustmentLayer';

const mocks = vi.hoisted(() => ({
    adjustmentLayerStoreValue: { value: { layers: [] } },
    adjustmentLayerStoreSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() { return mocks.adjustmentLayerStoreValue.value; },
        set: mocks.adjustmentLayerStoreSet,
    },
}));

describe('toggleAdjustmentLayer', () => {
    beforeEach(() => vi.clearAllMocks());

    it('toggles enabled state', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', enabled: true }]
        } as any;

        toggleAdjustmentLayer('l1');
        expect(mocks.adjustmentLayerStoreSet.mock.calls[0][0].layers[0].enabled).toBe(false);

        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', enabled: false }]
        } as any;
        toggleAdjustmentLayer('l1');
        expect(mocks.adjustmentLayerStoreSet.mock.calls[1][0].layers[0].enabled).toBe(true);
    });
});
