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

    // Adjustment-layer writes model no inverse action yet, so the handler is not marked
    // undoable: an undo entry without an inverse is inert — `undo()` drops it and falls
    // through to the entry beneath — so recording one only hides the older edit the user
    // actually meant to undo.
    it('is not undoable, because it models no inverse action', () => {
        expect(handleRemoveAdjustmentLayer.undoable).toBe(false);
    });
});
