import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AdjustmentLayer, type AdjustmentLayerState } from '../../../stores/adjustmentLayer';
import { addAdjustmentRegion } from '../addAdjustmentRegion';

const mocks = vi.hoisted(() => {
    const adjustmentLayerStoreValue: { value: AdjustmentLayerState | null } = {
        value: { layers: [] as AdjustmentLayer[] },
    };
    return {
        adjustmentLayerStoreValue,
        adjustmentLayerStoreSet: vi.fn<(value: AdjustmentLayerState | null) => void>(),
        getNextRegionId: vi.fn(() => 'reg-123'),
    };
});

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

    it('uses an explicit regionId and defaults blend to 1 when omitted', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                {
                    id: 'l1',
                    name: 'Layer',
                    effectType: 'volume',
                    parameters: [],
                    affectedTrackIds: [],
                    insertionIndex: 0,
                    regions: [],
                    enabled: true,
                    mix: 1,
                    color: '#fff',
                },
            ],
        };

        addAdjustmentRegion({ layerId: 'l1', startBeat: 0, endBeat: 4, regionId: 'custom-id' });

        expect(mocks.getNextRegionId).not.toHaveBeenCalled();
        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        const region = setCall?.[0]?.layers[0]?.regions[0];
        expect(region?.id).toBe('custom-id');
        expect(region?.blend).toBe(1);
    });

    it('leaves non-matching layers untouched', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                {
                    id: 'other',
                    name: 'Other',
                    effectType: 'volume',
                    parameters: [],
                    affectedTrackIds: [],
                    insertionIndex: 0,
                    regions: [],
                    enabled: true,
                    mix: 1,
                    color: '#fff',
                },
            ],
        };

        addAdjustmentRegion({ layerId: 'l1', startBeat: 0, endBeat: 4 });

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        // the non-matching layer is returned unchanged (empty regions)
        expect(setCall?.[0]?.layers[0]?.regions).toEqual([]);
    });

    it('is a no-op when the store has not loaded', () => {
        mocks.adjustmentLayerStoreValue.value = null;

        addAdjustmentRegion({ layerId: 'l1', startBeat: 0, endBeat: 4 });

        expect(mocks.adjustmentLayerStoreSet).not.toHaveBeenCalled();
    });
});
