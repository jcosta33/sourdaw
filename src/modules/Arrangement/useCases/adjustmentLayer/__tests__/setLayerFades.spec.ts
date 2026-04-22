import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setLayerFades } from '../setLayerFades';

const mocks = vi.hoisted(() => ({
    adjustmentLayerStoreValue: { value: { layers: [] } },
    adjustmentLayerStoreSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.adjustmentLayerStoreValue.value;
        },
        set: mocks.adjustmentLayerStoreSet,
    },
}));

describe('setLayerFades', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates fade-in and fade-out values on the matching region', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                {
                    id: 'l1',
                    regions: [{ id: 'r1', startBeat: 0, endBeat: 4, fadeInBeats: 0.25, fadeOutBeats: 0.25 }],
                },
            ],
        } as any;

        setLayerFades('r1', 1, 2);

        const region = mocks.adjustmentLayerStoreSet.mock.calls[0][0].layers[0].regions[0];
        expect(region.fadeInBeats).toBe(1);
        expect(region.fadeOutBeats).toBe(2);
    });

    it('clamps negative fade values to zero', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [{ id: 'l1', regions: [{ id: 'r1' }] }],
        } as any;

        setLayerFades('r1', -1, -2);

        const region = mocks.adjustmentLayerStoreSet.mock.calls[0][0].layers[0].regions[0];
        expect(region.fadeInBeats).toBe(0);
        expect(region.fadeOutBeats).toBe(0);
    });
});
