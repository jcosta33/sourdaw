import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setLayerAffectedTracks } from '../setLayerAffectedTracks';

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

describe('setLayerAffectedTracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('replaces the affectedTrackIds list on the target layer', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                { id: 'l1', affectedTrackIds: ['t0'] },
                { id: 'l2', affectedTrackIds: ['tx'] },
            ],
        } as any;

        setLayerAffectedTracks('l1', ['t1', 't2', 't2']);

        const setCall = mocks.adjustmentLayerStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected adjustmentLayerStore.set to be called');
        }
        const layers = setCall[0].layers;
        expect(layers[0].affectedTrackIds).toEqual(['t1', 't2']);
        expect(layers[1].affectedTrackIds).toEqual(['tx']);
    });
});
