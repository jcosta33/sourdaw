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

    it('throws on an unsupported adjustment effect type rather than silently dropping the action', () => {
        expect(() =>
            handleCreateAdjustmentLayer.execute({
                type: 'createAdjustmentLayer',
                payload: { name: 'Bad', effectType: 'not-a-real-effect' },
            })
        ).toThrow(/Unsupported adjustment effect type/);

        expect(mocks.createAdjustmentLayer).not.toHaveBeenCalled();
    });

    it('honors a caller-supplied layer id instead of minting one', () => {
        const action = {
            type: 'createAdjustmentLayer' as const,
            payload: { name: 'Master EQ', effectType: 'eq', layerId: 'layer-fixed' },
        };

        void handleCreateAdjustmentLayer.execute(action);

        expect(mocks.createAdjustmentLayer).toHaveBeenCalledWith({
            name: 'Master EQ',
            effectType: 'eq',
            layerId: 'layer-fixed',
        });
    });

    // Adjustment-layer writes model no inverse action yet, so the handler is not marked
    // undoable: an undo entry without an inverse is inert — `undo()` drops it and falls
    // through to the entry beneath — so recording one only hides the older edit the user
    // actually meant to undo.
    it('is not undoable, because it models no inverse action', () => {
        expect(handleCreateAdjustmentLayer.undoable).toBe(false);
    });
});
