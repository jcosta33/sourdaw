import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createAdjustmentLayer } from '../createAdjustmentLayer';

import type { AdjustmentEffectType } from '../../stores/adjustmentLayer';

const mocks = vi.hoisted(() => ({
    adjustmentLayerStoreValue: { value: { layers: [] } },
    adjustmentLayerStoreSet: vi.fn(),
    getNextLayerId: vi.fn(() => 'layer-123'),
}));

vi.mock('#/modules/Arrangement/stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.adjustmentLayerStoreValue.value;
        },
        set: mocks.adjustmentLayerStoreSet,
    },
    getNextLayerId: mocks.getNextLayerId,
    EFFECT_PRESETS: { EQ: [{ name: 'Freq', value: 1000, min: 20, max: 20000 }] },
    LAYER_COLORS: ['#f00'],
}));

describe('createAdjustmentLayer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.adjustmentLayerStoreValue.value = { layers: [] };
    });

    it('creates a new adjustment layer', () => {
        createAdjustmentLayer('Master EQ', 'EQ' as unknown as AdjustmentEffectType);

        expect(mocks.adjustmentLayerStoreSet).toHaveBeenCalledTimes(1);
        const newState = mocks.adjustmentLayerStoreSet.mock.calls[0][0];
        expect(newState.layers).toHaveLength(1);
        expect(newState.layers[0]).toMatchObject({
            id: 'layer-123',
            name: 'Master EQ',
            effectType: 'EQ',
            parameters: [{ name: 'Freq', value: 1000 }],
        });
    });
});
