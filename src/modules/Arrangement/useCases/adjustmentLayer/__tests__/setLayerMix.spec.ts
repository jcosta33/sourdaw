import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setLayerMix } from '../setLayerMix';

import type { AdjustmentLayer, AdjustmentLayerState } from '../../../stores/adjustmentLayer';

const mocks = vi.hoisted(() => {
    const adjustmentLayerStoreValue: { value: AdjustmentLayerState | null } = { value: { layers: [] } };
    return {
        adjustmentLayerStoreValue,
        adjustmentLayerStoreSet: vi.fn<(state: AdjustmentLayerState) => void>(),
    };
});

vi.mock('../../../stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.adjustmentLayerStoreValue.value;
        },
        set: mocks.adjustmentLayerStoreSet,
    },
}));

function makeLayer(overrides: Partial<AdjustmentLayer> & Pick<AdjustmentLayer, 'id'>): AdjustmentLayer {
    return {
        name: 'Layer',
        effectType: 'volume',
        parameters: [],
        affectedTrackIds: [],
        insertionIndex: 0,
        regions: [],
        enabled: true,
        mix: 1,
        color: '#000',
        ...overrides,
    };
}

describe('setLayerMix', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates layer mix value clamped between 0 and 1', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [makeLayer({ id: 'l1', mix: 1 })],
        };

        setLayerMix('l1', 0.5);
        const firstCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected first adjustmentLayerStore.set call');
        }
        expect(firstCall[0].layers[0]?.mix).toBe(0.5);

        setLayerMix('l1', 1.5);
        const secondCall = mocks.adjustmentLayerStoreSet.mock.calls[1];
        if (!secondCall) {
            throw new Error('expected second adjustmentLayerStore.set call');
        }
        expect(secondCall[0].layers[0]?.mix).toBe(1);
    });

    it('is a no-op when the store has not loaded', () => {
        mocks.adjustmentLayerStoreValue.value = null;

        setLayerMix('l1', 0.5);

        expect(mocks.adjustmentLayerStoreSet).not.toHaveBeenCalled();
    });
});
