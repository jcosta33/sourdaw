import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setLayerParameter } from '../setLayerParameter';

const mocks = vi.hoisted(() => ({
    adjustmentLayerStoreValue: { value: { layers: [] } },
    adjustmentLayerStoreSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() { return mocks.adjustmentLayerStoreValue.value; },
        set: mocks.adjustmentLayerStoreSet,
    },
}));

describe('setLayerParameter', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates parameter value clamped to min/max', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                { 
                    id: 'l1', 
                    parameters: [{ name: 'Freq', value: 1000, min: 20, max: 20000 }] 
                }
            ]
        } as any;

        setLayerParameter('l1', 'Freq', 50000); // Should clamp to 20000

        const layer = mocks.adjustmentLayerStoreSet.mock.calls[0][0].layers[0];
        expect(layer.parameters[0].value).toBe(20000);
    });
});
