import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getActiveLayersAtBeat } from '../getActiveLayersAtBeat';

const mocks = vi.hoisted(() => {
    const adjustmentLayerStoreValue: { value: { layers: unknown[] } | null } = { value: { layers: [] } };
    return { adjustmentLayerStoreValue };
});

vi.mock('#/modules/Arrangement/stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.adjustmentLayerStoreValue.value;
        },
    },
}));

describe('getActiveLayersAtBeat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns enabled layers that cover the specified beat', () => {
        mocks.adjustmentLayerStoreValue.value = {
            layers: [
                { id: 'l1', enabled: true, regions: [] }, // Applies everywhere
                { id: 'l2', enabled: true, regions: [{ startBeat: 0, endBeat: 8 }] }, // Covers 0-8
                { id: 'l3', enabled: true, regions: [{ startBeat: 16, endBeat: 32 }] }, // Covers 16-32
                { id: 'l4', enabled: false, regions: [] }, // Disabled
            ],
        };

        const activeAt4 = getActiveLayersAtBeat(4);
        expect(activeAt4.map((length) => length.id)).toEqual(['l1', 'l2']);

        const activeAt10 = getActiveLayersAtBeat(10);
        expect(activeAt10.map((length) => length.id)).toEqual(['l1']);

        const activeAt20 = getActiveLayersAtBeat(20);
        expect(activeAt20.map((length) => length.id)).toEqual(['l1', 'l3']);
    });

    it('returns empty array if store is unavailable', () => {
        mocks.adjustmentLayerStoreValue.value = null;
        expect(getActiveLayersAtBeat(0)).toEqual([]);
    });
});
