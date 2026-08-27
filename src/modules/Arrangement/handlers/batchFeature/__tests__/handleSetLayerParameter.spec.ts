import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetLayerParameter } from '../handleSetLayerParameter';

const mocks = vi.hoisted(() => ({
    setLayerParameter: vi.fn(),
}));

vi.mock('../../../useCases/adjustmentLayer/setLayerParameter', () => ({
    setLayerParameter: mocks.setLayerParameter,
}));

describe('handleSetLayerParameter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards the full payload', () => {
        handleSetLayerParameter.execute({
            type: 'setLayerParameter',
            payload: { layerId: 'L', paramName: 'Gain', value: 3 },
        });
        expect(mocks.setLayerParameter).toHaveBeenCalledWith('L', 'Gain', 3);
    });

    // The raw handler models no inverse of its own — the composed map in
    // `adjustmentLayerHandlers` wraps it with a snapshot inverse — so it is not marked
    // undoable here: an undo entry without an inverse is inert — `undo()` drops it and
    // falls through to the entry beneath — so recording one only hides the older edit
    // the user actually meant to undo.
    it('is not undoable, because it models no inverse action', () => {
        expect(handleSetLayerParameter.undoable).toBe(false);
    });
});
