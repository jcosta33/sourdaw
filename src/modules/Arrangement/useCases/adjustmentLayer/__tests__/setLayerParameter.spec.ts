import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setLayerParameter } from '../setLayerParameter';

const mocks = vi.hoisted(() => {
    type Parameter = { name: string; value: number; min: number; max: number };
    type Layer = { id: string; parameters: Parameter[] };
    type State = { layers: Layer[] };
    const adjustmentLayerStoreValue: { value: State | null } = { value: { layers: [] } };
    return {
        adjustmentLayerStoreValue,
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

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to have been called');
        }
        const parameter = setCall[0].layers[0]?.parameters[0];
        if (!parameter) {
            throw new Error('expected parameter in set state');
        }
        expect(parameter.value).toBe(20000);
    });

    it('is a no-op when the store has not loaded', () => {
        mocks.adjustmentLayerStoreValue.value = null;

        setLayerParameter('l1', 'Freq', 500);

        expect(mocks.adjustmentLayerStoreSet).not.toHaveBeenCalled();
    });
});
