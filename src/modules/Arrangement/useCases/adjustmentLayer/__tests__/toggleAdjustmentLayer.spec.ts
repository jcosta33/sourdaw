import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleAdjustmentLayer } from '../toggleAdjustmentLayer';

import type { AdjustmentLayer, AdjustmentLayerState } from '#/modules/Arrangement/stores/adjustmentLayer';

const mocks = vi.hoisted(() => ({
    adjustmentLayerStoreValue: { value: { layers: [] } as AdjustmentLayerState },
    adjustmentLayerStoreSet: vi.fn<(state: AdjustmentLayerState) => void>(),
}));

vi.mock('#/modules/Arrangement/stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.adjustmentLayerStoreValue.value;
        },
        set: mocks.adjustmentLayerStoreSet,
    },
}));

describe('toggleAdjustmentLayer', () => {
    beforeEach(() => vi.clearAllMocks());

    it('toggles enabled state', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', enabled: true } as Partial<AdjustmentLayer> as AdjustmentLayer],
        };

        toggleAdjustmentLayer('l1');
        const firstCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected first adjustmentLayerStore.set call');
        }
        expect(firstCall[0].layers[0]?.enabled).toBe(false);

        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', enabled: false } as Partial<AdjustmentLayer> as AdjustmentLayer],
        };
        toggleAdjustmentLayer('l1');
        const secondCall = mocks.adjustmentLayerStoreSet.mock.calls[1];
        if (!secondCall) {
            throw new Error('expected second adjustmentLayerStore.set call');
        }
        expect(secondCall[0].layers[0]?.enabled).toBe(true);
    });
});
