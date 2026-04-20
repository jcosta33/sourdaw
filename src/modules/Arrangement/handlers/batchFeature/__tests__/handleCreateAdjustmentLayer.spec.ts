import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCreateAdjustmentLayer } from '../handleCreateAdjustmentLayer';

const mocks = vi.hoisted(() => ({
    createAdjustmentLayer: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/createAdjustmentLayer', () => ({
    createAdjustmentLayer: mocks.createAdjustmentLayer,
}));

describe('handleCreateAdjustmentLayer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes createAdjustmentLayer with name and effectType', () => {
        void handleCreateAdjustmentLayer.execute({
            type: 'createAdjustmentLayer',
            payload: { name: 'Master EQ', effectType: 'EQ' },
        });

        expect(mocks.createAdjustmentLayer).toHaveBeenCalledWith('Master EQ', 'EQ');
    });

    it('provides a description', () => {
        const desc = handleCreateAdjustmentLayer.describe({
            type: 'createAdjustmentLayer',
            payload: { name: 'Test', effectType: 'EQ' },
        });
        expect(desc.label).toBe('Create Adjustment Layer');
    });

    it('is undoable', () => {
        expect(handleCreateAdjustmentLayer.undoable).toBe(true);
    });
});
