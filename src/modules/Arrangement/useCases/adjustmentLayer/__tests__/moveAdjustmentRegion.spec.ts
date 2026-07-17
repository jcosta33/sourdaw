import { describe, it, expect, vi, beforeEach } from 'vitest';

import { moveAdjustmentRegion } from '../moveAdjustmentRegion';

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

describe('moveAdjustmentRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates the region beats and clamps negative starts to zero', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                {
                    id: 'l1',
                    regions: [
                        { id: 'r1', startBeat: 2, endBeat: 4 },
                        { id: 'r2', startBeat: 8, endBeat: 12 },
                    ],
                },
            ],
        } as any;

        moveAdjustmentRegion('r2', -5, 9);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        const regions = setCall[0].layers[0].regions;
        const r2 = regions.find((r: { id: string }) => r.id === 'r2');
        const r1 = regions.find((r: { id: string }) => r.id === 'r1');
        expect(r2).toMatchObject({ startBeat: 0, endBeat: 9 });
        expect(r1).toMatchObject({ startBeat: 2, endBeat: 4 });
        expect(regions[0].id).toBe('r2');
        expect(regions[1].id).toBe('r1');
    });

    it('does nothing when the region id is not found', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', regions: [{ id: 'r1', startBeat: 0, endBeat: 4 }] }],
        } as any;

        moveAdjustmentRegion('missing', 1, 2);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        const regions = setCall[0].layers[0].regions;
        expect(regions).toEqual([{ id: 'r1', startBeat: 0, endBeat: 4 }]);
    });
});
