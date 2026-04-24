import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setLayerMix } from '../setLayerMix';

import type { AdjustmentLayerState } from '../../stores/adjustmentLayer';

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

describe('setLayerMix', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates layer mix value clamped between 0 and 1', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', mix: 1 }],
        } as unknown as AdjustmentLayerState;

        setLayerMix('l1', 0.5);
        expect(mocks.adjustmentLayerStoreSet.mock.calls[0][0].layers[0].mix).toBe(0.5);

        setLayerMix('l1', 1.5);
        expect(mocks.adjustmentLayerStoreSet.mock.calls[1][0].layers[0].mix).toBe(1);
    });
});
