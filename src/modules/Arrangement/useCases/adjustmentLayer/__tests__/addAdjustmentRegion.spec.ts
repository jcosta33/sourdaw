import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addAdjustmentRegion } from '../addAdjustmentRegion';

const mocks = vi.hoisted(() => ({
    adjustmentLayerStoreValue: { value: { layers: [] } },
    adjustmentLayerStoreSet: vi.fn(),
    getNextRegionId: vi.fn(() => 'reg-123'),
}));

vi.mock('#/modules/Arrangement/stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.adjustmentLayerStoreValue.value;
        },
        set: mocks.adjustmentLayerStoreSet,
    },
    getNextRegionId: mocks.getNextRegionId,
}));

describe('addAdjustmentRegion', () => {
    beforeEach(() => vi.clearAllMocks());

    it('adds a region to the correct layer and sorts by startBeat', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', regions: [{ id: 'r0', startBeat: 16, endBeat: 32 }] }],
        } as any;

        // Add region at beat 0 (should come first after sort)
        addAdjustmentRegion('l1', 0, 8, 0.5);

        expect(mocks.adjustmentLayerStoreSet).toHaveBeenCalledTimes(1);
        const regions = mocks.adjustmentLayerStoreSet.mock.calls[0][0].layers[0].regions;
        expect(regions).toHaveLength(2);
        expect(regions[0].id).toBe('reg-123');
        expect(regions[0].startBeat).toBe(0);
        expect(regions[1].id).toBe('r0');
    });
});
