import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setLayerParameter } from '../setLayerParameter';

const mocks = vi.hoisted(() => {
    type Parameter = { name: string; value: number; min: number; max: number };
    type Layer = { id: string; parameters: Parameter[] };
    type State = { layers: Layer[] };
    return {
        adjustmentLayerStoreValue: { value: { layers: [] } as State },
        adjustmentLayerStoreSet: vi.fn<(newState: State) => void>(),
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

describe('setLayerParameter', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates parameter value clamped to min/max', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                {
                    id: 'l1',
                    parameters: [{ name: 'Freq', value: 1000, min: 20, max: 20000 }],
                },
            ],
        };

        setLayerParameter('l1', 'Freq', 50000); // Should clamp to 20000

        const layer = mocks.adjustmentLayerStoreSet.mock.calls[0][0].layers[0];
        expect(layer.parameters[0].value).toBe(20000);
    });
});
