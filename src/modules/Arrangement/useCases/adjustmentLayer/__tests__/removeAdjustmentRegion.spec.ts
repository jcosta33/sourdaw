import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeAdjustmentRegion } from '../removeAdjustmentRegion';

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

describe('removeAdjustmentRegion', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes region from the specified layer', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', regions: [{ id: 'r1' }, { id: 'r2' }] }],
        };

        removeAdjustmentRegion('l1', 'r1');

        expect(mocks.adjustmentLayerStoreSet).toHaveBeenCalledWith({
            layers: [{ id: 'l1', regions: [{ id: 'r2' }] }],
        });
    });

    it('leaves other layers untouched when removing a region', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                { id: 'l1', regions: [{ id: 'r1' }] },
                { id: 'l2', regions: [{ id: 'r2' }] },
            ],
        };

        removeAdjustmentRegion('l1', 'r1');

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        // l2 is returned unchanged (the non-matching layerId branch)
        const layers = setCall[0].layers as Array<{ id: string; regions: Array<{ id: string }> }>;
        expect(layers[1]).toEqual({ id: 'l2', regions: [{ id: 'r2' }] });
    });

    it('is a no-op when the store has not loaded', () => {
        mocks.adjustmentLayerStoreValue.value = null;

        removeAdjustmentRegion('l1', 'r1');

        expect(mocks.adjustmentLayerStoreSet).not.toHaveBeenCalled();
    });
});
