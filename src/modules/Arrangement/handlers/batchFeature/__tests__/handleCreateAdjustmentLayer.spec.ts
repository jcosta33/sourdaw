import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCreateAdjustmentLayer } from '../handleCreateAdjustmentLayer';

const mocks = vi.hoisted(() => ({
    createAdjustmentLayer: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/createAdjustmentLayer', () => ({
    createAdjustmentLayer: mocks.createAdjustmentLayer,
}));

vi.mock('../createAdjustmentLayerMutationInverse', () => ({
    createAdjustmentLayerMutationInverse: vi.fn(() => null),
    getAdjustmentLayerMutationId: vi.fn(() => 'mutation-id'),
}));

describe('handleCreateAdjustmentLayer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes createAdjustmentLayer with name and effectType', () => {
        void handleCreateAdjustmentLayer.execute({
            type: 'createAdjustmentLayer',
            payload: { name: 'Master EQ', effectType: 'eq' },
        });

        expect(mocks.createAdjustmentLayer).toHaveBeenCalledWith('Master EQ', 'eq', 0, expect.any(String));
    });

    it('provides a description', () => {
        const desc = handleCreateAdjustmentLayer.describe({
            type: 'createAdjustmentLayer',
            payload: { name: 'Test', effectType: 'eq' },
        });
        expect(desc.label).toBe('Create Adjustment Layer');
    });

    it('is undoable', () => {
        expect(handleCreateAdjustmentLayer.undoable).toBe(true);
    });
});
