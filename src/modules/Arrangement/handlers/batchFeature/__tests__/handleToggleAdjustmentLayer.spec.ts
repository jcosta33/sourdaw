import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleToggleAdjustmentLayer } from '../handleToggleAdjustmentLayer';

const mocks = vi.hoisted(() => ({
    toggleAdjustmentLayer: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/toggleAdjustmentLayer', () => ({
    toggleAdjustmentLayer: mocks.toggleAdjustmentLayer,
}));

describe('handleToggleAdjustmentLayer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('invokes toggleAdjustmentLayer with the payload layer id', () => {
        handleToggleAdjustmentLayer.execute({
            type: 'toggleAdjustmentLayer',
            payload: { layerId: 'layer-1' },
        });
        expect(mocks.toggleAdjustmentLayer).toHaveBeenCalledWith('layer-1');
    });

    it('describes as Toggle Adjustment Layer', () => {
        expect(
            handleToggleAdjustmentLayer.describe({
                type: 'toggleAdjustmentLayer',
                payload: { layerId: 'x' },
            }).label
        ).toBe('Toggle Adjustment Layer');
    });

    it('is undoable', () => {
        expect(handleToggleAdjustmentLayer.undoable).toBe(true);
    });
});
