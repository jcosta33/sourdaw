import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AdjustmentLayerState } from '../../../stores/adjustmentLayer';
import { createAdjustmentLayer } from '../createAdjustmentLayer';

const mocks = vi.hoisted(() => {
    const adjustmentLayerStoreValue: { value: AdjustmentLayerState | null } = { value: { layers: [] } };
    return {
        adjustmentLayerStoreValue,
        adjustmentLayerStoreSet: vi.fn<(value: AdjustmentLayerState | null) => void>(),
        getNextLayerId: vi.fn(() => 'layer-123'),
    };
});

vi.mock('../../../stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.adjustmentLayerStoreValue.value;
        },
        set: mocks.adjustmentLayerStoreSet,
    },
    getNextLayerId: mocks.getNextLayerId,
    EFFECT_PRESETS: { eq: [{ name: 'Freq', value: 1000, min: 20, max: 20000 }] },
    LAYER_COLORS: ['#f00'],
}));

describe('createAdjustmentLayer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.adjustmentLayerStoreValue.value = { layers: [] };
    });

    it('creates a new adjustment layer', () => {
        createAdjustmentLayer({ name: 'Master EQ', effectType: 'eq' });

        expect(mocks.adjustmentLayerStoreSet).toHaveBeenCalledTimes(1);
        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to be called');
        }
        const newState = setCall[0];
        if (!newState) {
            throw new Error('expected a non-null adjustment-layer state');
        }
        expect(newState.layers).toHaveLength(1);
        expect(newState.layers[0]).toMatchObject({
            id: 'layer-123',
            name: 'Master EQ',
            effectType: 'eq',
            parameters: [{ name: 'Freq', value: 1000 }],
        });
    });

    it('uses an explicit layerId and insertionIndex when supplied', () => {
        mocks.adjustmentLayerStoreValue.value = { layers: [] };

        createAdjustmentLayer({ name: 'EQ', effectType: 'eq', insertionIndex: 3, layerId: 'custom-layer' });

        expect(mocks.getNextLayerId).not.toHaveBeenCalled();
        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        const layer = setCall?.[0]?.layers[0];
        expect(layer).toMatchObject({ id: 'custom-layer', insertionIndex: 3 });
    });

    it('is a no-op when the store has not loaded', () => {
        mocks.adjustmentLayerStoreValue.value = null;

        createAdjustmentLayer({ name: 'EQ', effectType: 'eq' });

        expect(mocks.adjustmentLayerStoreSet).not.toHaveBeenCalled();
    });

    // F13: `EFFECT_PRESETS[effectType]` is a shared module-level array of
    // parameter objects. `[...EFFECT_PRESETS[type]]` only clones the outer
    // array, so every layer created with the same effect type points at the
    // SAME parameter objects — mutating one layer's parameter in place
    // (e.g. a future `param.value = x`) would corrupt every other layer of
    // that effect type, including ones created afterward.
    it('gives each created layer its own parameter objects, not shared references to EFFECT_PRESETS', () => {
        createAdjustmentLayer({ name: 'EQ One', effectType: 'eq', layerId: 'layer-a' });
        const firstCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        const firstLayer = firstCall?.[0]?.layers[0];
        if (!firstLayer) {
            throw new Error('expected the first layer to have been created');
        }
        mocks.adjustmentLayerStoreValue.value = { layers: [firstLayer] };

        createAdjustmentLayer({ name: 'EQ Two', effectType: 'eq', layerId: 'layer-b' });
        const secondCall = mocks.adjustmentLayerStoreSet.mock.calls[1];
        const secondLayer = secondCall?.[0]?.layers[1];
        if (!secondLayer) {
            throw new Error('expected the second layer to have been created');
        }

        expect(firstLayer.parameters[0]).not.toBe(secondLayer.parameters[0]);

        // Mutating one layer's parameter in place must not leak into the other.
        firstLayer.parameters[0]!.value = 9999;
        expect(secondLayer.parameters[0]!.value).not.toBe(9999);
    });
});
