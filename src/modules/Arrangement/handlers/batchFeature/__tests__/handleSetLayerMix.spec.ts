import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetLayerMix } from '../handleSetLayerMix';

const mocks = vi.hoisted(() => ({
    setLayerMix: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/setLayerMix', () => ({
    setLayerMix: mocks.setLayerMix,
}));

describe('handleSetLayerMix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards layer id and mix value', () => {
        handleSetLayerMix.execute({ type: 'setLayerMix', payload: { layerId: 'L', mix: 0.5 } });
        expect(mocks.setLayerMix).toHaveBeenCalledWith('L', 0.5);
    });

    // Adjustment-layer writes model no inverse action yet, so the handler is not marked
    // undoable: an undo entry without an inverse is inert — `undo()` drops it and falls
    // through to the entry beneath — so recording one only hides the older edit the user
    // actually meant to undo.
    it('is not undoable, because it models no inverse action', () => {
        expect(handleSetLayerMix.undoable).toBe(false);
    });
});
