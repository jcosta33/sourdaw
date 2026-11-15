import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mockValue;
        },
    },
}));

vi.mock('../../../useCases/adjustmentLayer/commitAdjustmentLayerMutation', () => ({
    commitAdjustmentLayerMutation: vi.fn(({ mutation }: { mutation: () => void }) => {
        mutation();
        return true;
    }),
}));

import { commitAdjustmentLayerMutation } from '../../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { adjustmentLayerHandlers } from '../adjustmentLayerHandlers';

let mockValue: { layers: unknown[] } | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    mockValue = { layers: [] };
});

describe('adjustmentLayerHandlers — structure', () => {
    it('exports 12 handler keys', () => {
        const keys = Object.keys(adjustmentLayerHandlers);
        expect(keys).toHaveLength(12);
        expect(keys).toContain('createAdjustmentLayer');
        expect(keys).toContain('removeAdjustmentLayer');
        expect(keys).toContain('toggleAdjustmentLayer');
        expect(keys).toContain('setLayerParameter');
        expect(keys).toContain('setLayerMix');
        expect(keys).toContain('addAdjustmentRegion');
        expect(keys).toContain('removeAdjustmentRegion');
        expect(keys).toContain('moveAdjustmentRegion');
        expect(keys).toContain('setLayerFades');
        expect(keys).toContain('setLayerAffectedTracks');
        expect(keys).toContain('setLayerInsertionIndex');
        expect(keys).toContain('restoreAdjustmentLayerMutation');
    });

    it('all mutation handlers are undoable', () => {
        expect(adjustmentLayerHandlers.createAdjustmentLayer.undoable).toBe(true);
        expect(adjustmentLayerHandlers.removeAdjustmentLayer.undoable).toBe(true);
        expect(adjustmentLayerHandlers.setLayerParameter.undoable).toBe(true);
    });
});

describe('adjustmentLayerHandlers — describe creates inverse via store snapshot', () => {
    it('describe returns restoreAdjustmentLayerMutation inverse', () => {
        const result = adjustmentLayerHandlers.createAdjustmentLayer.describe({
            type: 'createAdjustmentLayer',
            payload: { name: 'Test', insertionIndex: 0 } as never,
        });
        expect(result.inverseAction?.type).toBe('restoreAdjustmentLayerMutation');
        const payload = (result.inverseAction as unknown as { payload: { layers: unknown[] } }).payload;
        expect(payload.layers).toEqual([]);
    });

    it('describe stores inverse in pendingInverseActions for execute', async () => {
        const action = { type: 'createAdjustmentLayer', payload: { name: 'Test', insertionIndex: 0 } } as never;
        const { inverseAction } = adjustmentLayerHandlers.createAdjustmentLayer.describe(action);
        // Only the wrapper is under test, so the sub-handler's mutation is not run.
        vi.mocked(commitAdjustmentLayerMutation).mockImplementationOnce(() => true);

        await adjustmentLayerHandlers.createAdjustmentLayer.execute(action);

        const committed = vi.mocked(commitAdjustmentLayerMutation).mock.calls[0]?.[0];
        expect(committed?.inverseAction).toBe(inverseAction);
    });
});

describe('adjustmentLayerHandlers — execute throws without prior describe', () => {
    it('throws Missing undo snapshot when describe was not called first', () => {
        const action = { type: 'toggleAdjustmentLayer', payload: { layerId: 'l1', enabled: true } } as never;
        expect(() => adjustmentLayerHandlers.toggleAdjustmentLayer.execute(action)).toThrow(/Missing undo snapshot/);
    });
});

describe('adjustmentLayerHandlers — describe on null store', () => {
    it('returns empty layers in inverse when store is null', () => {
        mockValue = null;
        const result = adjustmentLayerHandlers.setLayerMix.describe({
            type: 'setLayerMix',
            payload: { layerId: 'l1', mix: 0.5 },
        });
        const payload = (result.inverseAction as unknown as { payload: { layers: unknown[] } }).payload;
        expect(payload.layers).toEqual([]);
    });
});
