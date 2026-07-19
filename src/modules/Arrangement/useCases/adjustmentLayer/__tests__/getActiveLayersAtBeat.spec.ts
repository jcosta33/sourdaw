import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getActiveLayersAtBeat } from '../getActiveLayersAtBeat';

const mocks = vi.hoisted(() => ({
    adjustmentLayerStoreValue: { value: { layers: [] } as { layers: unknown[] } | null },
}));

vi.mock('#/modules/Arrangement/stores/adjustmentLayer', () => ({
    computeAdjustmentLayerBlendAtBeat: (
        layer: { enabled: boolean; regions: { startBeat: number; endBeat: number }[] },
        beat: number
    ) =>
        layer.enabled &&
        (layer.regions.length === 0 ||
            layer.regions.some((region) => beat >= region.startBeat && beat < region.endBeat))
            ? 1
            : 0,
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
        } as any;

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
