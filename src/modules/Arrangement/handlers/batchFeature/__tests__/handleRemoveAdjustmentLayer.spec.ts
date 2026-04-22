import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRemoveAdjustmentLayer } from '../handleRemoveAdjustmentLayer';

const mocks = vi.hoisted(() => ({
    removeAdjustmentLayer: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/removeAdjustmentLayer', () => ({
    removeAdjustmentLayer: mocks.removeAdjustmentLayer,
}));

describe('handleRemoveAdjustmentLayer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('invokes removeAdjustmentLayer with the payload layer id', () => {
        handleRemoveAdjustmentLayer.execute({
            type: 'removeAdjustmentLayer',
            payload: { layerId: 'layer-42' },
        });
        expect(mocks.removeAdjustmentLayer).toHaveBeenCalledWith('layer-42');
    });

    it('describes as Remove Adjustment Layer', () => {
        const desc = handleRemoveAdjustmentLayer.describe({
            type: 'removeAdjustmentLayer',
            payload: { layerId: 'layer-42' },
        });
        expect(desc.label).toBe('Remove Adjustment Layer');
    });

    it('is undoable', () => {
        expect(handleRemoveAdjustmentLayer.undoable).toBe(true);
    });
});
