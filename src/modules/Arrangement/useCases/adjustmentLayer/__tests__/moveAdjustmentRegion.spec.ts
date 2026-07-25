import { describe, it, expect, vi, beforeEach } from 'vitest';

import { moveAdjustmentRegion } from '../moveAdjustmentRegion';

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
        };

        moveAdjustmentRegion('r2', -5, 9);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        const regions = setCall[0].layers[0].regions as Array<{ id: string; startBeat: number; endBeat: number }>;
        const r2 = regions.find((r) => r.id === 'r2');
        const r1 = regions.find((r) => r.id === 'r1');
        expect(r2).toMatchObject({ startBeat: 0, endBeat: 9 });
        expect(r1).toMatchObject({ startBeat: 2, endBeat: 4 });
        expect(regions[0]?.id).toBe('r2');
        expect(regions[1]?.id).toBe('r1');
    });

    it('clamps an inverted range so start does not exceed end', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', regions: [{ id: 'r1', startBeat: 0, endBeat: 4 }] }],
        };

        // startBeat(10) > endBeat(2): clampedStart = max(0, min(10,2)) = 2,
        // clampedEnd = max(2, 2) = 2 → start never exceeds end.
        moveAdjustmentRegion('r1', 10, 2);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        const regions = setCall[0].layers[0].regions as Array<{ startBeat: number; endBeat: number }>;
        const region = regions[0];
        expect(region).toMatchObject({ startBeat: 2, endBeat: 2 });
    });

    it('does nothing when the region id is not found', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', regions: [{ id: 'r1', startBeat: 0, endBeat: 4 }] }],
        };

        moveAdjustmentRegion('missing', 1, 2);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        const regions = setCall[0].layers[0].regions as Array<{ id: string; startBeat: number; endBeat: number }>;
        expect(regions).toEqual([{ id: 'r1', startBeat: 0, endBeat: 4 }]);
    });

    it('is a no-op when the store has not loaded', () => {
        mocks.adjustmentLayerStoreValue.value = null;

        moveAdjustmentRegion('r1', 1, 2);

        expect(mocks.adjustmentLayerStoreSet).not.toHaveBeenCalled();
    });
});
