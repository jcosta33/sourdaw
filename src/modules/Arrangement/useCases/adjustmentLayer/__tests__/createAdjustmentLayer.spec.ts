import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AdjustmentLayerState } from '../../../stores/adjustmentLayer';
import { createAdjustmentLayer } from '../createAdjustmentLayer';

const mocks = vi.hoisted(() => ({
    adjustmentLayerStoreValue: { value: { layers: [] } },
    adjustmentLayerStoreSet: vi.fn<(value: AdjustmentLayerState | null) => void>(),
    getNextLayerId: vi.fn(() => 'layer-123'),
}));

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
});
