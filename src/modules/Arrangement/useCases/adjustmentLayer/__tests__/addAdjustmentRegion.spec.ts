import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AdjustmentLayer, type AdjustmentLayerState } from '../../../stores/adjustmentLayer';
import { addAdjustmentRegion } from '../addAdjustmentRegion';

const mocks = vi.hoisted(() => ({
    adjustmentLayerStoreValue: { value: { layers: [] as AdjustmentLayer[] } },
    adjustmentLayerStoreSet: vi.fn<(value: AdjustmentLayerState | null) => void>(),
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
            layers: [
                {
                    id: 'l1',
                    name: 'Layer',
                    effectType: 'volume',
                    parameters: [],
                    affectedTrackIds: [],
                    insertionIndex: 0,
                    regions: [
                        {
                            id: 'r0',
                            startBeat: 16,
                            endBeat: 32,
                            blend: 1,
                            fadeInBeats: 0.25,
                            fadeOutBeats: 0.25,
                        },
                    ],
                    enabled: true,
                    mix: 1,
                    color: '#fff',
                },
            ],
        };

        // Add region at beat 0 (should come first after sort)
        addAdjustmentRegion({ layerId: 'l1', startBeat: 0, endBeat: 8, blend: 0.5 });

        expect(mocks.adjustmentLayerStoreSet).toHaveBeenCalledTimes(1);
        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to be called');
        }
        const newState = setCall[0];
        if (!newState) {
            throw new Error('expected a non-null adjustment-layer state');
        }
        const layer = newState.layers[0];
        if (!layer) {
            throw new Error('expected the target adjustment layer');
        }
        const regions = layer.regions;
        expect(regions).toHaveLength(2);
        const [firstRegion, secondRegion] = regions;
        if (!firstRegion || !secondRegion) {
            throw new Error('expected both adjustment regions');
        }
        expect(firstRegion.id).toBe('reg-123');
        expect(firstRegion.startBeat).toBe(0);
        expect(secondRegion.id).toBe('r0');
    });
});
