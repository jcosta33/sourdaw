import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCreateAdjustmentLayer } from '../handleCreateAdjustmentLayer';

import type { AppAction } from '#/utils/handlerContract';
import type { CreateAdjustmentLayerInput } from '../../../useCases/adjustmentLayer/createAdjustmentLayer';

const mocks = vi.hoisted(() => ({
    createAdjustmentLayer: vi.fn<(input: CreateAdjustmentLayerInput) => void>(),
}));

vi.mock('../../../useCases/adjustmentLayer/createAdjustmentLayer', () => ({
    createAdjustmentLayer: mocks.createAdjustmentLayer,
}));

describe('handleCreateAdjustmentLayer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes createAdjustmentLayer with a replay-stable layer id', () => {
        const action: Extract<AppAction, { type: 'createAdjustmentLayer' }> = {
            type: 'createAdjustmentLayer',
            payload: { name: 'Master EQ', effectType: 'eq' },
        };

        void handleCreateAdjustmentLayer.execute(action);

        const layerId = action.payload.layerId;
        if (!layerId) {
            throw new Error('Expected the handler to assign a layer id');
        }
        expect(mocks.createAdjustmentLayer).toHaveBeenCalledWith({
            name: 'Master EQ',
            effectType: 'eq',
            layerId,
        });
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
